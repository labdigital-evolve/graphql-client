import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { type Span, trace } from "@opentelemetry/api";
import { print } from "graphql";
import { isNode } from "graphql/language/ast";
import { getDocumentIdFromMeta } from "./lib/document";
import { setErrorStatus } from "./lib/helpers";
import { type Operation, createOperation } from "./lib/operation";
import { getPackageName, getPackageVersion } from "./lib/package";
import { apqQuery, mutationPost, standardPost } from "./lib/request";
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
   * Executes the appropriate request strategy
   * This will return a response object that can be processed by the processResponse function
   */
  async function executeRequest<TVariables>({
    operation,
    fetchOptions,
  }: {
    operation: Operation<TVariables>;
    fetchOptions: TRequestInit;
  }): Promise<Response> {
    if (operation.type === "subscription") {
      throw new Error("Subscriptions are not supported");
    }

    if (disablePersistedOperations) {
      return standardPost({
        endpoint,
        operation,
        fetchOptions,
      });
    }
    if (operation.type === "mutation") {
      return mutationPost({
        endpoint,
        operation,
        fetchOptions,
        alwaysIncludeQuery,
      });
    }
    return apqQuery({
      endpoint,
      operation,
      fetchOptions,
      alwaysIncludeQuery,
    });
  }

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
    // Implementation with unified types to handle both overloads
    async fetch<TResponse, TVariables>({
      document,
      variables,
      fetchOptions,
    }: {
      document: DocumentTypeDecoration<TResponse, TVariables>;
      variables?: TVariables;
      fetchOptions?: TRequestInit;
    }): Promise<TResponse> {
      const combinedHeaders = new Headers(defaultFetchOptions?.headers);
      if (fetchOptions?.headers) {
        new Headers(fetchOptions.headers).forEach((value, key) => {
          combinedHeaders.set(key, value); // Per-request overrides default
        });
      }

      // Start with merged options
      fetchOptions = {
        ...defaultFetchOptions,
        ...fetchOptions,
        headers: combinedHeaders,
      } as TRequestInit;

      if (onRequest) {
        fetchOptions = await onRequest(fetchOptions);
      }

      // Create document (either from string or by parsing the document ast node)
      const documentString = isNode(document)
        ? print(document)
        : document.toString();

      const operation = createOperation({
        document: documentString,
        documentId: createDocumentIdFn(document),
        variables: variables,
      });

      // Start the request span
      return tracer.startActiveSpan(operation.operationName, async (span) => {
        try {
          // Execute the request using the appropriate strategy
          const response = await executeRequest({
            operation,
            fetchOptions,
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
