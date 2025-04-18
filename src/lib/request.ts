// Assuming GraphQLClientError is defined/exported from server.ts for now
// Consider moving it to its own errors.ts file later
import type { getDocumentType } from "./document"; // Only need the function
import type { Operation } from "./operation";
import {
  createRequestBody,
  createUrl,
  getPersistedQueryExtension,
} from "./operation";

// Basic type for a GraphQL error object - can be refined further if needed
type GraphQLError = {
  message: string;
  locations?: { line: number; column: number }[];
  path?: (string | number)[];
  extensions?: Record<string, unknown>; // Use unknown instead of any
};

// Helper to check for APQ "Not Found" errors
function isPersistedQueryNotFoundError(responseData: unknown): boolean {
  // Refined type guard
  if (
    typeof responseData === "object" &&
    responseData !== null &&
    Object.prototype.hasOwnProperty.call(responseData, "errors")
  ) {
    // Now check if the errors property is an array
    const errors = (responseData as { errors?: unknown }).errors;
    if (Array.isArray(errors)) {
      // We have an array of errors (or an empty array)
      return errors.some((err: unknown) => {
        // Guard inside the callback
        if (typeof err !== "object" || err === null) return false;
        // Assume err fits GraphQLError structure
        const error = err as GraphQLError;
        return (
          error.message?.includes("PersistedQueryNotFound") ||
          error.extensions?.code === "PERSISTED_QUERY_NOT_FOUND"
        );
      });
    }
  }
  return false; // Return false if not the expected structure or errors is not an array
}

// Define a type for the expected payload structure for POST requests
type PostPayload<TVariables> = {
  query?: string;
  variables?: TVariables;
  documentId?: string;
  extensions?: Record<string, unknown>;
};

// --- Configuration for executeRequest --- //
interface RequestExecutionConfig {
  /** Disable persisted operations, force standard POST */
  disablePersistedOperations: boolean;
  /** Always include the query field, even for persisted requests */
  alwaysIncludeQuery: boolean;
  /** Document type (query or mutation) - use return type of getDocumentType */
  documentType: ReturnType<typeof getDocumentType>;
}

// --- Options Objects --- //

interface ExecutePostOptions<TVariables, TRequestInit extends RequestInit> {
  endpoint: string;
  payload: PostPayload<TVariables>;
  fetchOptions: TRequestInit; // Renamed from mergedFetchOptions
}

interface ExecuteRequestOptions<TVariables, TRequestInit extends RequestInit> {
  endpoint: string;
  operation: Operation<TVariables>;
  config: RequestExecutionConfig;
  fetchOptions: TRequestInit; // Renamed from mergedFetchOptions
}

// --- Internal POST Helper --- //
async function executePost<TVariables, TRequestInit extends RequestInit>({
  endpoint,
  payload,
  fetchOptions,
}: ExecutePostOptions<TVariables, TRequestInit>): Promise<Response> {
  // Assuming createRequestBody handles pruning and stringifying
  const body = createRequestBody(payload);
  return fetch(endpoint, {
    ...fetchOptions,
    method: "POST",
    body,
    headers: { ...fetchOptions.headers, "Content-Type": "application/json" },
  });
}

/**
 * Executes the GraphQL request, simplifying the strategy selection.
 */
export async function executeRequest<
  TVariables,
  TRequestInit extends RequestInit
>(options: ExecuteRequestOptions<TVariables, TRequestInit>): Promise<Response> {
  const { endpoint, operation, config, fetchOptions } = options;
  const { disablePersistedOperations, alwaysIncludeQuery, documentType } =
    config;

  // --- Override ---
  if (disablePersistedOperations) {
    return executePost({
      endpoint,
      payload: {
        query: operation.document,
        variables: operation.variables,
      },
      fetchOptions,
    });
  }

  // --- Mutations ---
  if (documentType === "mutation") {
    let payload: object;
    if (operation.documentId) {
      payload = {
        documentId: operation.documentId,
        variables: operation.variables,
        query: alwaysIncludeQuery ? operation.document : undefined,
      };
    } else {
      payload = {
        query: operation.document,
        variables: operation.variables,
      };
    }
    return executePost({
      endpoint,
      payload,
      fetchOptions,
    });
  }

  // --- Queries ---

  // 1. Persisted Document POST (if ID exists and query not forced)
  if (operation.documentId && !alwaysIncludeQuery) {
    return executePost({
      endpoint,
      payload: {
        documentId: operation.documentId,
        variables: operation.variables,
        // No query needed
      },
      fetchOptions,
    });
  }

  // 2. APQ (GET -> POST Fallback) - Handles no documentId OR alwaysIncludeQuery
  const extensions = getPersistedQueryExtension(operation.document);
  const getUrl = createUrl(endpoint, operation, { extensions });

  try {
    // Attempt APQ GET
    const getHeaders = new Headers(fetchOptions.headers);
    getHeaders.delete("Content-Type");
    const getResponse = await fetch(getUrl.toString(), {
      ...fetchOptions,
      method: "GET",
      body: undefined,
      headers: getHeaders,
    });

    // Check GET response
    if (getResponse.ok) {
      const responseClone = getResponse.clone();
      try {
        const potentialErrorData = await responseClone.json();
        if (!isPersistedQueryNotFoundError(potentialErrorData)) {
          return getResponse; // SUCCESS (GET request worked)
        }
        // APQ GET failed with PersistedQueryNotFound, continue to POST fallback
      } catch (e) {
        return getResponse; // SUCCESS (GET request worked - non-standard response)
      }
    } else {
      // APQ GET failed (non-200 status), continue to POST fallback
    }
  } catch (networkError) {
    // APQ GET failed (network error), continue to POST fallback
  }

  // Fallback: Execute APQ POST
  return executePost({
    endpoint,
    payload: {
      query: operation.document, // APQ POST always includes query
      variables: operation.variables,
      extensions,
      documentId:
        alwaysIncludeQuery && operation.documentId
          ? operation.documentId
          : undefined,
    },
    fetchOptions,
  });
}
