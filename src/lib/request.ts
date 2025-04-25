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
  const payload = {
    query: operation.document,
    variables: operation.variables,
  };

  const body = createRequestBody(payload);
  return fetch(endpoint, {
    ...fetchOptions,
    method: "POST",
    body,
    headers: { ...fetchOptions.headers, "Content-Type": "application/json" },
  });
}

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
  return fetch(endpoint, {
    ...fetchOptions,
    method: "POST",
    body,
    headers: { ...fetchOptions.headers, "Content-Type": "application/json" },
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
  let url: URL;
  let extensions: ReturnType<typeof getPersistedQueryExtension> | undefined;

  if (operation.documentId) {
    extensions = alwaysIncludeQuery
      ? getPersistedQueryExtension(operation.document)
      : undefined;
    url = createUrl(endpoint, operation, extensions);
  } else {
    extensions = getPersistedQueryExtension(operation.document);
    url = createUrl(endpoint, operation, extensions);
  }

  const fallbackExtensions =
    alwaysIncludeQuery || !operation.documentId ? extensions : undefined;

  const response = await fetch(url.toString(), {
    ...fetchOptions,
    method: "GET",
    body: undefined,
    headers: fetchOptions.headers,
  });

  if (response.ok) {
    const responseClone = response.clone();
    try {
      const potentialErrorData = await responseClone.json();
      if (!isPersistedQueryNotFoundError(potentialErrorData)) {
        return response;
      }
    } catch (e) {
      // If the response is not valid JSON, return the original response
      // This would need to be handled by the caller
      return response;
    }
  }

  return apqPostFallback({
    endpoint,
    operation,
    fetchOptions,
    extensions: fallbackExtensions,
  });
}

/** APQ POST fallback request for queries */
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
