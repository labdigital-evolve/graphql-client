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
export function isPersistedQueryNotFoundError(responseData: unknown): boolean {
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
export type PostPayload<TVariables> = {
  query?: string;
  variables?: TVariables;
  documentId?: string;
  extensions?: Record<string, unknown>;
};

// --- Configuration for executeRequest --- //
export interface RequestExecutionConfig {
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
  fetchOptions: TRequestInit;
}

interface ExecuteGetOptions<TRequestInit extends RequestInit> {
  url: string;
  fetchOptions: TRequestInit;
}

// This options object is now used by all strategy functions
export interface ExecuteStrategyOptions<
  TVariables,
  TRequestInit extends RequestInit
> {
  endpoint: string;
  operation: Operation<TVariables>;
  config: RequestExecutionConfig;
  fetchOptions: TRequestInit;
}

// --- Internal Fetch Helpers --- //

async function executePost<TVariables, TRequestInit extends RequestInit>({
  endpoint,
  payload,
  fetchOptions,
}: ExecutePostOptions<TVariables, TRequestInit>): Promise<Response> {
  const body = createRequestBody(payload); // Handles pruning/stringifying
  return fetch(endpoint, {
    ...fetchOptions,
    method: "POST",
    body,
    headers: { ...fetchOptions.headers, "Content-Type": "application/json" },
  });
}

async function executeGet<TRequestInit extends RequestInit>({
  url,
  fetchOptions,
}: ExecuteGetOptions<TRequestInit>): Promise<Response> {
  const getHeaders = new Headers(fetchOptions.headers);
  getHeaders.delete("Content-Type"); // GET requests shouldn't have Content-Type body header
  return fetch(url, {
    ...fetchOptions,
    method: "GET",
    body: undefined, // Explicitly set body to undefined for GET
    headers: getHeaders,
  });
}

// --- Strategy Specific Execution Functions --- //

/** Handles the standard POST request when persisted operations are disabled. */
export async function executeStandardPost<
  TVariables,
  TRequestInit extends RequestInit
>(
  options: ExecuteStrategyOptions<TVariables, TRequestInit>
): Promise<Response> {
  const { endpoint, operation, fetchOptions } = options;
  return executePost({
    endpoint,
    payload: {
      query: operation.document,
      variables: operation.variables,
    },
    fetchOptions,
  });
}

/** Handles all mutation POST requests. */
export async function executeMutationPost<
  TVariables,
  TRequestInit extends RequestInit
>(
  options: ExecuteStrategyOptions<TVariables, TRequestInit>
): Promise<Response> {
  const { endpoint, operation, config, fetchOptions } = options;
  const { alwaysIncludeQuery } = config;

  let payload: PostPayload<TVariables>;
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
  return executePost({ endpoint, payload, fetchOptions });
}

/** Attempts the APQ GET request for queries. */
export async function executeApqQueryStrategy<
  TVariables,
  TRequestInit extends RequestInit
>(
  options: ExecuteStrategyOptions<TVariables, TRequestInit>
): Promise<Response> {
  const { endpoint, operation, config, fetchOptions } = options;
  const { alwaysIncludeQuery } = config;

  // --- Prepare for GET ---
  let getUrl: URL;
  let extensions: ReturnType<typeof getPersistedQueryExtension> | undefined;

  if (operation.documentId) {
    // DocumentId exists. Extensions are only needed if alwaysIncludeQuery is true.
    extensions = alwaysIncludeQuery
      ? getPersistedQueryExtension(operation.document)
      : undefined;
    getUrl = createUrl(endpoint, operation, extensions, alwaysIncludeQuery);
  } else {
    // No DocumentId. Always need extensions for APQ.
    extensions = getPersistedQueryExtension(operation.document);
    getUrl = createUrl(endpoint, operation, extensions, alwaysIncludeQuery);
  }

  // Determine potential extensions needed for POST fallback *before* the try block
  // Only relevant for standard APQ (!alwaysIncludeQuery) when documentId is missing
  const potentialPostFallbackExtensions =
    !alwaysIncludeQuery && !operation.documentId ? extensions : undefined;

  // --- Attempt GET ---
  try {
    const getResponse = await executeGet({
      url: getUrl.toString(),
      fetchOptions,
    });

    if (getResponse.ok) {
      const responseClone = getResponse.clone();
      try {
        const potentialErrorData = await responseClone.json();
        if (!isPersistedQueryNotFoundError(potentialErrorData)) {
          return getResponse; // APQ GET Success
        }
        // PersistedQueryNotFound found, proceed to POST fallback below
      } catch (e) {
        // Non-JSON response from GET (maybe success, maybe error).
        // Treat as success for now, don't fallback.
        console.warn("APQ GET response was not valid JSON:", e);
        return getResponse;
      }
    }
    // GET response was not ok (e.g., 404, 500), proceed to POST fallback below
  } catch (networkError) {
    // Network error during GET, proceed to POST fallback below
    console.warn("APQ GET request failed, falling back to POST:", networkError);
  }

  // --- Fallback: Execute APQ POST ---
  return executeApqPostFallback(options, potentialPostFallbackExtensions);
}

/** Executes the APQ POST fallback request for queries. */
export async function executeApqPostFallback<
  TVariables,
  TRequestInit extends RequestInit
>(
  options: ExecuteStrategyOptions<TVariables, TRequestInit>,
  getExtensions?: ReturnType<typeof getPersistedQueryExtension> // Extensions from GET attempt
): Promise<Response> {
  const { endpoint, operation, fetchOptions } = options;

  // Base payload includes query and variables
  const payload: PostPayload<TVariables> = {
    query: operation.document, // APQ POST *always* includes query
    variables: operation.variables,
  };

  // Always include documentId if it exists
  if (operation.documentId) {
    payload.documentId = operation.documentId;
  }

  // Include extensions ONLY for standard APQ (!alwaysIncludeQuery) when documentId was absent during GET
  // TODO: Verify if extensions are truly needed in the fallback POST body
  // when alwaysIncludeQuery is true, as the server might have already processed
  // the hash from the GET request.
  if (getExtensions) {
    // Add extensions if they were generated for the GET attempt
    payload.extensions = getExtensions;
  }

  return executePost({
    endpoint,
    payload, // Use the constructed payload
    fetchOptions,
  });
}
