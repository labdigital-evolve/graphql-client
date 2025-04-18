// Assuming GraphQLClientError is defined/exported from server.ts for now
import { isPersistedQueryNotFoundError } from "./helpers";
import type { Operation } from "./operation";
import {
  createRequestBody,
  createUrl,
  getPersistedQueryExtension,
} from "./operation";

export type PostPayload<TVariables> = {
  query?: string;
  variables?: TVariables;
  documentId?: string;
  extensions?: Record<string, unknown>;
};

/**
 * Request generator that yields fetch requests and handles retry logic
 */
export async function* createRequestGenerator<
  TVariables,
  TRequestInit extends RequestInit
>({
  endpoint,
  operation,
  fetchOptions,
  documentType,
  alwaysIncludeQuery = false,
  disablePersistedOperations = false,
}: {
  endpoint: string;
  operation: Operation<TVariables>;
  fetchOptions: TRequestInit;
  documentType: "query" | "mutation";
  alwaysIncludeQuery?: boolean;
  disablePersistedOperations?: boolean;
}): AsyncGenerator<Request, Response, Response> {
  // Standard POST - always just one request
  if (disablePersistedOperations) {
    const payload = {
      query: operation.document,
      variables: operation.variables,
    };

    const body = createRequestBody(payload);
    const request = new Request(endpoint, {
      ...fetchOptions,
      method: "POST",
      body,
      headers: { ...fetchOptions.headers, "Content-Type": "application/json" },
    });

    const response = yield request;
    return response;
  }

  // Mutation POST - always just one request
  if (documentType === "mutation") {
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

    const body = createRequestBody(payload);
    const request = new Request(endpoint, {
      ...fetchOptions,
      method: "POST",
      body,
      headers: { ...fetchOptions.headers, "Content-Type": "application/json" },
    });

    const response = yield request;
    return response;
  }

  // APQ Query - can have multiple requests (GET -> POST fallback)
  let url: URL;
  let extensions: ReturnType<typeof getPersistedQueryExtension> | undefined;

  if (operation.documentId) {
    extensions = alwaysIncludeQuery
      ? getPersistedQueryExtension(operation.document)
      : undefined;
    url = createUrl(endpoint, operation, extensions, alwaysIncludeQuery);
  } else {
    extensions = getPersistedQueryExtension(operation.document);
    url = createUrl(endpoint, operation, extensions, alwaysIncludeQuery);
  }

  const fallbackExtensions =
    alwaysIncludeQuery || !operation.documentId ? extensions : undefined;

  const headers = new Headers(fetchOptions.headers);
  headers.delete("Content-Type"); // GET requests shouldn't have Content-Type header

  // First try GET request
  const getRequest = new Request(url.toString(), {
    ...fetchOptions,
    method: "GET",
    body: undefined,
    headers,
  });

  let response = yield getRequest;

  if (response.ok) {
    const responseClone = response.clone();
    try {
      const potentialErrorData = await responseClone.json();
      if (!isPersistedQueryNotFoundError(potentialErrorData)) {
        return response;
      }
    } catch (e) {
      // If the response is not valid JSON, return the original response
      return response;
    }
  }

  // Fall back to POST request if needed
  const payload: PostPayload<TVariables> = {
    query: operation.document,
    variables: operation.variables,
  };

  if (operation.documentId) {
    payload.documentId = operation.documentId;
  }

  if (fallbackExtensions) {
    payload.extensions = fallbackExtensions;
  }

  const body = createRequestBody(payload);
  const postRequest = new Request(endpoint, {
    ...fetchOptions,
    method: "POST",
    body,
    headers: { ...fetchOptions.headers, "Content-Type": "application/json" },
  });

  response = yield postRequest;
  return response;
}

/**
 * Execute a request using the request generator
 */
export async function executeRequest<
  TVariables,
  TRequestInit extends RequestInit
>(options: {
  endpoint: string;
  operation: Operation<TVariables>;
  fetchOptions: TRequestInit;
  documentType: "query" | "mutation";
  alwaysIncludeQuery: boolean;
  disablePersistedOperations?: boolean;
}): Promise<Response> {
  const generator = createRequestGenerator(options);

  let result = await generator.next();

  while (!result.done) {
    const request = result.value;
    const response = await fetch(request);
    result = await generator.next(response);
  }

  return result.value;
}

// Legacy functions kept for backwards compatibility - delegating to the new implementation

/** Standard POST request when persisted operations are disabled */
export async function standardPost<
  TVariables,
  TRequestInit extends RequestInit
>({
  endpoint,
  operation,
  fetchOptions,
}: {
  endpoint: string;
  operation: Operation<TVariables>;
  fetchOptions: TRequestInit;
}): Promise<Response> {
  return executeRequest({
    endpoint,
    operation,
    fetchOptions,
    documentType: "query",
    alwaysIncludeQuery: false,
    disablePersistedOperations: true,
  });
}

/** Mutation POST requests */
export async function mutationPost<
  TVariables,
  TRequestInit extends RequestInit
>({
  endpoint,
  operation,
  fetchOptions,
  alwaysIncludeQuery,
}: {
  endpoint: string;
  operation: Operation<TVariables>;
  fetchOptions: TRequestInit;
  alwaysIncludeQuery: boolean;
}): Promise<Response> {
  return executeRequest({
    endpoint,
    operation,
    fetchOptions,
    documentType: "mutation",
    alwaysIncludeQuery,
  });
}

/** APQ GET request for queries with POST fallback */
export async function apqQuery<TVariables, TRequestInit extends RequestInit>({
  endpoint,
  operation,
  fetchOptions,
  alwaysIncludeQuery,
}: {
  endpoint: string;
  operation: Operation<TVariables>;
  fetchOptions: TRequestInit;
  alwaysIncludeQuery: boolean;
}): Promise<Response> {
  return executeRequest({
    endpoint,
    operation,
    fetchOptions,
    documentType: "query",
    alwaysIncludeQuery,
  });
}

// This function is now handled internally by the generator
export async function apqPostFallback<
  TVariables,
  TRequestInit extends RequestInit
>({
  endpoint,
  operation,
  fetchOptions,
  extensions,
}: {
  endpoint: string;
  operation: Operation<TVariables>;
  fetchOptions: TRequestInit;
  extensions?: ReturnType<typeof getPersistedQueryExtension>;
}): Promise<Response> {
  const payload: PostPayload<TVariables> = {
    query: operation.document,
    variables: operation.variables,
  };

  if (operation.documentId) {
    payload.documentId = operation.documentId;
  }

  if (extensions) {
    payload.extensions = extensions;
  }

  const body = createRequestBody(payload);
  return fetch(endpoint, {
    ...fetchOptions,
    method: "POST",
    body,
    headers: { ...fetchOptions.headers, "Content-Type": "application/json" },
  });
}
