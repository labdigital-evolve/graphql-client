import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { type Span, trace } from "@opentelemetry/api";
import { print } from "graphql";
import { isNode } from "graphql/language/ast";
import { getDocumentIdFromMeta, getDocumentType } from "./lib/document";
import { setErrorStatus } from "./lib/helpers";
import { createOperation } from "./lib/operation";
import { getPackageName, getPackageVersion } from "./lib/package";
import { executeRequest } from "./lib/request";
import {
  GraphQLClientError,
  type BeforeRequest as OnRequest,
} from "./lib/types";

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

  /**
   * Processes the response from a given execution
   *
   * This will run the onResponse hook, check the HTTP status and try to parse the response as JSON.
   */
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

      /**
       * ================================
       * Fetch request
       * ================================
       */
      return tracer.startActiveSpan(operation.operationName, async (span) => {
        try {
          // Execute the request using the generator-based approach
          const response = await executeRequest({
            endpoint,
            documentType,
            operation,
            fetchOptions,
            alwaysIncludeQuery,
            disablePersistedOperations,
          });

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
