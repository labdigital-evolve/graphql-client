/**
 * Creates a server-side GraphQL client with support for hooks,
 * persisted queries, and error handling.
 */

import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { print } from "graphql";
import { isNode } from "graphql/language/ast";
import { getDocumentIdFromMeta, getDocumentType } from "./lib/document";
import { createOperation } from "./lib/operation";
import { getPackageName, getPackageVersion } from "./lib/package";
import type { StrategyOptions } from "./lib/request";
import { apqQuery, mutationPost, standardPost } from "./lib/request";
import type { BeforeRequest as OnRequest } from "./lib/types";

// Helper to set error status on span
function setErrorStatus(span: Span, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
}

// Define this near your other types, perhaps in a dedicated errors file later
export class GraphQLClientError extends Error {
  response: Response;

  constructor(message: string, response: Response) {
    super(message);
    this.name = "GraphQLClientError";
    this.response = response;
    // Ensure prototype chain is correct
    Object.setPrototypeOf(this, GraphQLClientError.prototype);
  }
}

const tracer = trace.getTracer(getPackageName(), getPackageVersion());

export type DocumentIdGenerator = <TResponse = unknown, TVariables = unknown>(
  document: DocumentTypeDecoration<TResponse, TVariables>
) => string | undefined;

export type OnResponse = (response: Response) => Promise<void> | void;

interface ServerClientConfig<TRequestInit extends RequestInit = RequestInit> {
  endpoint: string;
  onRequest?: OnRequest<TRequestInit>;
  /**
   * Hook that is called after the response is received. This returns the original response object and the parsed json data.
   * This can be used to modify the response or the parsed data before it is returned to the caller or debug the response.
   */
  onResponse?: OnResponse;
  /**
   * Always include the hashed query in a persisted query request even if a documentId is provided
   * This is useful for debugging and for ensuring that the query is always sent to the server when persisted documents are not used
   */
  alwaysIncludeQuery?: boolean;

  // Disable persisted operations
  disablePersistedOperations?: boolean;

  createDocumentIdFn?: DocumentIdGenerator;

  /** Default fetch options to be applied to every request. Per-request options will override these defaults. */
  defaultFetchOptions?: TRequestInit;
}

/**
 * Interface for the Server client
 * Defines the public API for performing GraphQL operations
 */
export interface ServerClient<TRequestInit extends RequestInit = RequestInit> {
  endpoint: string;

  /**
   * Overload for queries without variables
   */
  fetch<TResponse>(options: {
    document: DocumentTypeDecoration<TResponse, Record<string, never>>;
    variables?: undefined;
    fetchOptions?: TRequestInit;
  }): Promise<TResponse>;

  /**
   * Fetch the GraphQL document with the given variables and return the response
   */
  fetch<TResponse, TVariables>(options: {
    document: DocumentTypeDecoration<TResponse, TVariables>;
    variables: TVariables;
    fetchOptions?: TRequestInit;
  }): Promise<TResponse>;
}

/**
 * Create a new server client
 *
 * This client supports:
 * - Persisted documents and APQ (automatic persisted queries)
 * - Running hooks beforeRequest which can also modify the request
 * - Fetcher with extended GraphQL support
 *
 * @param config - Configuration for the server client
 * @returns A new server client
 */
export function createServerClient<
  TRequestInit extends RequestInit = RequestInit
>(config: ServerClientConfig<TRequestInit>): ServerClient<TRequestInit> {
  // Extract configuration with defaults
  const {
    endpoint,
    onRequest,
    onResponse,
    alwaysIncludeQuery = false,
    disablePersistedOperations = false,
    createDocumentIdFn = getDocumentIdFromMeta,
    defaultFetchOptions, // Extract the new default options
  } = config;

  // Helper to execute the appropriate request strategy
  async function executeRequest<TVariables>(
    options: StrategyOptions<TVariables, TRequestInit>
  ): Promise<Response> {
    const { config } = options;
    const { disablePersistedOperations, documentType } = config;

    if (disablePersistedOperations) {
      return standardPost(options);
    }
    if (documentType === "mutation") {
      return mutationPost(options);
    }
    return apqQuery(options);
  }

  // Helper to process response and handle errors
  async function processResponse<TResponse>(
    response: Response,
    span: Span
  ): Promise<TResponse> {
    // Process onResponse hook if provided
    if (onResponse) {
      const responseClone = response.clone();
      await onResponse(responseClone);
    }

    // Check for HTTP errors
    if (!response.ok) {
      const errorMessage = `HTTP Error: ${response.status} ${response.statusText}`;
      setErrorStatus(span, errorMessage);
      throw new GraphQLClientError(errorMessage, response);
    }

    // Parse JSON response
    try {
      return (await response.json()) as TResponse;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to process response body";
      setErrorStatus(span, errorMessage);
      throw new GraphQLClientError(errorMessage, response);
    }
  }

  // Create the client object that implements the ServerClient interface
  return {
    endpoint,

    // Implementation with unified types to handle both overloads
    async fetch<TResponse, TVariables>(options: {
      document: DocumentTypeDecoration<TResponse, TVariables>;
      variables?: TVariables;
      fetchOptions?: TRequestInit;
    }): Promise<TResponse> {
      // --- Prepare Fetch Options ---
      const baseOptions = {
        ...defaultFetchOptions,
        ...options.fetchOptions,
      };

      const headers = new Headers(defaultFetchOptions?.headers);
      if (options.fetchOptions?.headers) {
        new Headers(options.fetchOptions.headers).forEach((value, key) => {
          headers.set(key, value);
        });
      }
      headers.set("Content-Type", "application/json");

      // Start with merged options
      let fetchOptions = {
        ...baseOptions,
        headers: headers,
      } as TRequestInit;

      // --- Run onRequest Hook (if provided) ---
      // The hook receives the current options and returns the options to use.
      if (onRequest) {
        fetchOptions = await onRequest(fetchOptions);
      }

      /**
       * ================================
       * GraphQL operation processing
       * ================================
       */
      // Create document (either from string or by parsing the document ast node)
      const documentString = isNode(options.document)
        ? print(options.document)
        : options.document.toString();

      // Create document id (for use in persisted documents)
      const documentId = createDocumentIdFn(options.document);

      const operation = createOperation({
        document: documentString,
        documentId,
        variables: options.variables,
      });

      // Get the document type, either a query or a mutation
      const documentType = getDocumentType(documentString);

      // Construct the options object needed by the strategy functions
      const requestOptions: StrategyOptions<TVariables, TRequestInit> = {
        endpoint,
        operation,
        config: {
          disablePersistedOperations,
          alwaysIncludeQuery,
          documentType,
        },
        fetchOptions,
      };

      /**
       * ================================
       * Fetch request
       * ================================
       */
      return tracer.startActiveSpan(operation.operationName, async (span) => {
        try {
          // Execute the request using the appropriate strategy
          const response = await executeRequest(requestOptions);

          // Process the response
          const result = await processResponse<TResponse>(response, span);

          span.end();
          return result;
        } catch (error) {
          // If error hasn't been processed by a more specific handler
          if (!(error instanceof GraphQLClientError)) {
            setErrorStatus(span, error);
          }

          span.end();
          throw error;
        }
      });
    },
  };
}
