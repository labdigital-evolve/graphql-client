import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { print } from "graphql";
import { isNode } from "graphql/language/ast";
import { getDocumentIdFromMeta, getDocumentType } from "./lib/document";
import { createOperation, createOperationRequestBody } from "./lib/operation";
import type { BeforeRequest } from "./lib/types";

export type DocumentIdGenerator = <TResponse = unknown, TVariables = unknown>(
  document: DocumentTypeDecoration<TResponse, TVariables>
) => string | undefined;

interface ServerClientConfig<TRequestInit extends RequestInit = RequestInit> {
  endpoint: string;
  beforeRequest?: BeforeRequest<TRequestInit>;
  // Always include the hashed query in a persisted query request even if a documentId is provided
  alwaysIncludeQuery?: boolean;

  // Disable persisted requests
  disablePersistedRequests?: boolean;

  createDocumentIdFn?: DocumentIdGenerator;
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
    alwaysIncludeQuery = false,
    disablePersistedRequests = false,
    createDocumentIdFn = getDocumentIdFromMeta,
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
      // Handle before request hook with fetch options
      await beforeRequest?.(options.fetchOptions);

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

      // Merge default headers with fetch options
      const headers = {
        ...options.fetchOptions?.headers,
        // Always set the content type to application/json
        "Content-Type": "application/json",
      };

      // Get the document type, either a query or a mutation
      const documentType = getDocumentType(documentString);

      // If persisted requests are disabled, run a POST request without document id or persisted query extension
      if (disablePersistedRequests) {
        const response = await fetch(endpoint, {
          ...options.fetchOptions,
          method: "POST",
          headers,
          body: createOperationRequestBody(operation),
        });
        return response.json();
      }
      // TODO: How do we want to handle cache disabling? Could be a flag on the constructor or in beforeRequest

      // If document is a mutation, run a POST request

      // If document is a query, run a persisted query
      // If not a persisted query and it has a PersistedQueryNotFoundError, run a POST request

      // Fetch (REPLACE WITH ACTUAL FETCH!)
      const response = await fetch(endpoint, {
        ...options.fetchOptions,
        method: "POST",
        headers,
      });
      return response.json();
    },
  };
}
