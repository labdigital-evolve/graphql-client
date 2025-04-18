// Assuming GraphQLClientError is defined/exported from server.ts for now
import type { getDocumentType } from "./document";
import type { Operation } from "./operation";
import {
  createRequestBody,
  createUrl,
  getPersistedQueryExtension,
} from "./operation";

type GraphQLError = {
  message: string;
  locations?: { line: number; column: number }[];
  path?: (string | number)[];
  extensions?: Record<string, unknown>;
};

export function isPersistedQueryNotFoundError(responseData: unknown): boolean {
  if (
    typeof responseData === "object" &&
    responseData !== null &&
    Object.prototype.hasOwnProperty.call(responseData, "errors")
  ) {
    const errors = (responseData as { errors?: unknown }).errors;
    if (Array.isArray(errors)) {
      return errors.some((err: unknown) => {
        if (typeof err !== "object" || err === null) return false;
        const error = err as GraphQLError;
        return (
          error.message?.includes("PersistedQueryNotFound") ||
          error.extensions?.code === "PERSISTED_QUERY_NOT_FOUND"
        );
      });
    }
  }
  return false;
}

export type PostPayload<TVariables> = {
  query?: string;
  variables?: TVariables;
  documentId?: string;
  extensions?: Record<string, unknown>;
};

export interface RequestConfig {
  disablePersistedOperations: boolean;
  alwaysIncludeQuery: boolean;
  documentType: ReturnType<typeof getDocumentType>;
}

export interface StrategyOptions<TVariables, TRequestInit extends RequestInit> {
  endpoint: string;
  operation: Operation<TVariables>;
  config: RequestConfig;
  fetchOptions: TRequestInit;
}

/** Standard POST request when persisted operations are disabled */
export async function standardPost<
  TVariables,
  TRequestInit extends RequestInit
>(options: StrategyOptions<TVariables, TRequestInit>): Promise<Response> {
  const { endpoint, operation, fetchOptions } = options;
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

/** Mutation POST requests */
export async function mutationPost<
  TVariables,
  TRequestInit extends RequestInit
>(options: StrategyOptions<TVariables, TRequestInit>): Promise<Response> {
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

  const body = createRequestBody(payload);
  return fetch(endpoint, {
    ...fetchOptions,
    method: "POST",
    body,
    headers: { ...fetchOptions.headers, "Content-Type": "application/json" },
  });
}

/** APQ GET request for queries with POST fallback */
export async function apqQuery<TVariables, TRequestInit extends RequestInit>(
  options: StrategyOptions<TVariables, TRequestInit>
): Promise<Response> {
  const { endpoint, operation, config, fetchOptions } = options;
  const { alwaysIncludeQuery } = config;

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

  const response = await fetch(url.toString(), {
    ...fetchOptions,
    method: "GET",
    body: undefined,
    headers,
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

  return apqPostFallback(options, fallbackExtensions);
}

/** APQ POST fallback request for queries */
export async function apqPostFallback<
  TVariables,
  TRequestInit extends RequestInit
>(
  options: StrategyOptions<TVariables, TRequestInit>,
  extensions?: ReturnType<typeof getPersistedQueryExtension>
): Promise<Response> {
  const { endpoint, operation, fetchOptions } = options;

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
