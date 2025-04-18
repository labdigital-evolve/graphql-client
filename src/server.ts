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
import { print } from "graphql";
import { isNode } from "graphql/language/ast";
import { getDocumentIdFromMeta, getDocumentType } from "./lib/document";
import { parseErrorBody } from "./lib/helpers";
import { createOperation, createOperationRequestBody } from "./lib/operation";
import type { BeforeRequest } from "./lib/types";

// Define this near your other types, perhaps in a dedicated errors file later
export class GraphQLClientError extends Error {
  response: Response;
  body?: unknown; // Use unknown instead of any for better type safety

  constructor(message: string, response: Response, body?: unknown) {
    super(message);
    this.name = "GraphQLClientError";
    this.response = response;
    this.body = body;
    // Ensure prototype chain is correct
    Object.setPrototypeOf(this, GraphQLClientError.prototype);
  }
}

export type DocumentIdGenerator = <TResponse = unknown, TVariables = unknown>(
  document: DocumentTypeDecoration<TResponse, TVariables>
) => string | undefined;

export type AfterResponse<TResponseData = unknown> = (
  response: Response,
  parsedData: TResponseData
) => Promise<void> | void;

interface ServerClientConfig<TRequestInit extends RequestInit = RequestInit> {
  endpoint: string;
  beforeRequest?: BeforeRequest<TRequestInit>;
  /**
   * Hook that is called after the response is received. This returns the original response object and the parsed json data.
   * This can be used to modify the response or the parsed data before it is returned to the caller or debug the response.
   */
  afterResponse?: AfterResponse;
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
    beforeRequest,
    afterResponse,
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
      // --- Merge Fetch Options ---
      // Start with default options, then merge per-request options
      const mergedFetchOptions = {
        ...defaultFetchOptions,
        ...options.fetchOptions,
        // Special handling for headers: merge default and per-request headers
        headers: {
          ...(defaultFetchOptions?.headers ?? {}), // Use empty object if default headers are null/undefined
          ...(options.fetchOptions?.headers ?? {}), // Use empty object if per-request headers are null/undefined
          // Always set the content type to application/json, potentially overriding others
          "Content-Type": "application/json",
        },
      };

      // Handle before request hook with *original* per-request fetch options
      await beforeRequest?.(options.fetchOptions);

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

      const operation = await createOperation({
        document: documentString,
        documentId,
        variables: options.variables,
        includeQuery: alwaysIncludeQuery,
      });

      // Get the document type, either a query or a mutation
      const documentType = getDocumentType(documentString);

      /**
       * ================================
       * Fetch request
       * ================================
       */

      // Headers are already handled in mergedFetchOptions
      const headers = mergedFetchOptions.headers; // Use the merged headers

      if (documentType === "query") {
        // If document is a query, run a persisted query
        // If not a persisted query and it has a PersistedQueryNotFoundError, run a POST request
      }

      // If persisted requests are disabled, run a POST request without document id or persisted query extension
      const body = disablePersistedOperations
        ? createOperationRequestBody(operation)
        : createOperationRequestBody({
            ...operation,
            // Remove the document id and extensions to disable persisted queries
            documentId: undefined,
            extensions: {},
          });

      // If document is a mutation, run a POST request
      const response = await fetch(endpoint, {
        ...mergedFetchOptions, // Use the merged fetch options
        method: "POST",
        body,
        // headers are already part of mergedFetchOptions
      });

      // Check for HTTP errors first
      if (!response.ok) {
        // Use the helper function to get the error body
        const errorBody = await parseErrorBody(response);

        // Throw the error with the potentially parsed body or text body
        throw new GraphQLClientError(
          `HTTP Error: ${response.status} ${response.statusText}`,
          response, // Pass the original response
          errorBody
        );
      }

      // If response is OK, proceed to parse and handle hooks
      let parsedData: TResponse; // Declared as TResponse, assignment will happen in try block
      let responseClone: Response | undefined = undefined;

      try {
        // Clone only if the hook exists, before parsing the original
        if (afterResponse) {
          responseClone = response.clone();
        }

        // Parse the JSON from the original response
        // If this fails, the catch block below handles it
        parsedData = await response.json();
      } catch (error) {
        // Handle JSON parsing errors (or other errors during cloning/parsing)
        // Use the original response for the error context
        throw new GraphQLClientError(
          error instanceof Error
            ? error.message
            : "Failed to process response body",
          response, // Use the original response object
          // Attempt to read body as text again if json parsing failed
          await response
            .clone()
            .text()
            .catch(() => undefined)
        );
      }

      // --- Success Path ---
      // If we reach here, response was OK and parsing succeeded.
      // parsedData is guaranteed to be of type TResponse.

      // Call the afterResponse hook if provided
      if (afterResponse && responseClone) {
        // No cast needed for parsedData, TS should infer TResponse
        // responseClone is guaranteed to be defined here
        await afterResponse(responseClone, parsedData);
      }

      // Return the successfully parsed data
      // No cast needed, TS should infer TResponse
      return parsedData;
    },
  };
}
