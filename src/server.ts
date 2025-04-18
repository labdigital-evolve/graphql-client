/**
 * @fileoverview Creates a server-side GraphQL client with support for hooks,
 * persisted queries (TODO), and robust error handling.
 *
 * The core `createServerClient` function configures and returns a client object
 * with a `fetch` method. The `fetch` method orchestrates the following steps:
 *
 * 1. **Configuration:** Extracts endpoint, hooks (`beforeRequest`, `afterResponse`),
 *    and options (persisted queries, document ID generation) from the initial config.
 * 2. **`beforeRequest` Hook:** Executes the optional `beforeRequest` hook, allowing
 *    modification of fetch options before the request is sent.
 * 3. **Document Processing:** Converts the GraphQL document (AST or string) into a
 *    string representation and generates a document ID using the configured function.
 * 4. **Operation Setup:** Creates the operation payload, including the query string,
 *    variables, and potentially the document ID or extensions for persisted queries.
 * 5. **Fetch Execution:**
 *    - If `disablePersistedRequests` is true, sends a standard POST request.
 *    - (TODO: Implement persisted query flow - attempt GET/POST with ID, fallback POST).
 *    - Currently sends a basic POST request.
 * 6. **Error Handling:**
 *    - Checks if `response.ok` is true.
 *    - If not OK, attempts to parse the body first as JSON, then as text (using
 *      `parseErrorBody`), and throws a `GraphQLClientError` containing the original
 *      response and the parsed/text body.
 * 7. **Success Handling:**
 *    - If response is OK, attempts to parse the body as JSON.
 *    - If JSON parsing fails, throws a `GraphQLClientError`.
 * 8. **`afterResponse` Hook:** If the request was successful (OK status and JSON
 *    parsed), executes the optional `afterResponse` hook with a clone of the
 *    original response and the parsed data.
 * 9. **Return Value:** Returns the parsed JSON data (`TResponse`) on success, or
 *    throws a `GraphQLClientError` on failure.
 */

import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { print } from "graphql";
import { isNode } from "graphql/language/ast";
import { getDocumentIdFromMeta, getDocumentType } from "./lib/document";
import { createOperation } from "./lib/operation";
import { getPackageName, getPackageVersion } from "./lib/package";
import type { ExecuteStrategyOptions } from "./lib/request";
import {
  executeApqQueryStrategy,
  executeMutationPost,
  executeStandardPost,
} from "./lib/request";
import type { BeforeRequest as OnRequest } from "./lib/types";

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
      const requestOptions: ExecuteStrategyOptions<TVariables, TRequestInit> = {
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
        // === Execute the request using the new executor ===
        let response: Response;
        const { config } = requestOptions;
        const { disablePersistedOperations, documentType } = config;

        try {
          // --- Select Execution Strategy ---
          // 1. Override: Standard POST
          if (disablePersistedOperations) {
            response = await executeStandardPost(requestOptions);
          }
          // 2. Mutations: Always POST
          else if (documentType === "mutation") {
            response = await executeMutationPost(requestOptions);
          }
          // 3. Queries: APQ Flow
          else {
            response = await executeApqQueryStrategy(requestOptions);
          }
        } catch (error) {
          const errorMessage = `Request failed for ${
            operation.operationName
          }: ${error instanceof Error ? error.message : String(error)}`;
          span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
          span.end();

          // We have no response object yet, so we throw the original error
          throw error;
        }

        // Clone the response early if the hook exists
        let responseClone: Response | undefined = undefined;
        if (onResponse) {
          responseClone = response.clone();
          await onResponse(responseClone);
        }

        // Check for HTTP errors first
        if (!response.ok) {
          const errorMessage = `HTTP Error: ${response.status} ${response.statusText}`;
          span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
          // Throw the error with the potentially parsed body or text body
          throw new GraphQLClientError(
            errorMessage,
            response // Pass the original response
          );
        }

        // If response is OK, proceed to parse and handle hooks
        let parsedData: TResponse; // Declared as TResponse, assignment will happen in try block

        try {
          // Parse the JSON from the original response
          // If this fails, the catch block below handles it
          parsedData = await response.json();
        } catch (error) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : "Failed to process response body";
          span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
          // Throw a more specific error for JSON parsing issues
          throw new GraphQLClientError(
            errorMessage,
            response // Use the original response object
          );
        }

        span.end();

        // Return the parsed data on success
        return parsedData;
      });
    },
  };
}
