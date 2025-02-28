import { createHash } from "node:crypto";
import { pruneObject } from "./helpers";

type Operation<TVariables> = {
  operationName: string;
  document: string;
  documentId?: string;
  variables: TVariables | undefined;
  includeQuery: boolean;
  extensions: Record<string, unknown>;
};

/**
 * Extract the operation name from a GraphQL document string
 * @param document - The GraphQL document string
 * @returns The operation name or a fallback
 */
function extractOperationName(document: string): string {
  // Simple regex to extract operation name
  // Looks for: query OperationName, mutation OperationName, etc.
  const match = document.match(
    /(?:query|mutation|subscription)\s+([A-Za-z0-9_]+)/
  );
  return match?.[1] || "(GraphQL)";
}

/**
 * Determines if the request is using a persisted document
 * @param operation - The operation
 * @returns True if this is a persisted document request
 */
export function isPersistedDocumentRequest<TVariables>(
  operation: Operation<TVariables>
): boolean {
  return !!operation.documentId && !operation.includeQuery;
}

/**
 * Determines if the request is using a persisted query
 * @param operation - The operation
 * @returns True if this is a persisted query request
 */
export function isPersistedQueryRequest<TVariables>(
  operation: Operation<TVariables>
): boolean {
  return !!operation.extensions.persistedQuery;
}

/**
 * Create a GraphQL operation
 * This contains all of the (meta)data for a GraphQL operation
 * including the document, variables, documentId, includeQuery and extensions
 *
 * This can then be used to create request bodies or assert the kind of request needed based on the operation
 */
export async function createOperation<TVariables>({
  document,
  variables,
  documentId,
  includeQuery = false,
}: {
  document: string;
  variables: TVariables | undefined;
  documentId?: string;
  includeQuery: boolean;
}): Promise<Operation<TVariables>> {
  const operation = {
    operationName: extractOperationName(document),
    document,
    variables,
    includeQuery,
    documentId,
    extensions: {},
  };

  // Add persisted query extension if documentId is not available or includeQuery is true
  // When document id's are used, the persisted query extension is not needed as persisted documents are sent in the request body
  if (!documentId || includeQuery) {
    operation.extensions = {
      persistedQuery: {
        version: 1,
        sha256Hash: createHash("sha-256").update(document).digest("hex"),
      },
    };
  }

  return operation;
}

/**
 * Create a URL for a persisted GraphQL operation
 * This is used when the operation is not sent in the request body
 */
export function createOperationURL<TVariables>(
  url: string,
  operation: Operation<TVariables>
): URL {
  const result = new URL(url);

  // The operation name can be used to identify the operation when debugging which is a nice help
  result.searchParams.set("op", operation.operationName);

  if (operation.documentId) {
    result.searchParams.set("documentId", operation.documentId);
  }

  if (operation.variables && Object.keys(operation.variables).length > 0) {
    result.searchParams.set("variables", JSON.stringify(operation.variables));
  }

  // Add APQ extension if it exists
  // In the old fetcher we also checked whether we could include the query but extensions are empty if we're not allowed to anyways
  if (operation.extensions) {
    result.searchParams.set("extensions", JSON.stringify(operation.extensions));
  }

  return result;
}

/**
 * Create a request body for a non-persisted GraphQL operation
 * This is used when doing POST requests
 */
export function createOperationRequestBody<TVariables>(
  operation: Operation<TVariables>
): string {
  // Include the query in the request body or when there is no document id
  if (!operation.documentId || operation.includeQuery) {
    return JSON.stringify(
      pruneObject({
        documentId: operation.documentId,
        query: operation.document,
        variables: operation.variables,
        extensions: operation.extensions,
      })
    );
  }
  // Do not include the query in the request body when using a persisted document
  return JSON.stringify(
    pruneObject({
      documentId: operation.documentId,
      variables: operation.variables,
      extensions: operation.extensions,
    })
  );
}
