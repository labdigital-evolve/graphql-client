import { createHash } from "node:crypto";

type RequestObject<TVariables> = {
  operationName: string;
  document: string;
  documentId?: string;
  variables: TVariables | undefined;
  includeQuery: boolean;
  extensions: Record<string, unknown>;
};

/**
 * Create a request object for a GraphQL request
 * @param document - The document string
 * @param variables - The variables for the request
 * @returns The request object
 */
export async function createRequestObject<TVariables>({
  document,
  variables,
  documentId,
  includeQuery = false,
}: {
  document: string;
  variables: TVariables | undefined;
  documentId?: string;
  includeQuery: boolean;
}): Promise<RequestObject<TVariables>> {
  // TODO: Extract correct operationName
  const operationName = "(GraphQL)";

  // Add persisted query extension if documentId is not available or includeQuery is true
  // When document id's are used, the persisted query extension is not needed as persisted documents are sent in the request body
  const extensions =
    !documentId || includeQuery
      ? {
          persistedQuery: {
            version: 1,
            sha256Hash: createHash("sha-256").update(document).digest("hex"),
          },
        }
      : {};

  return {
    operationName,
    document,
    variables,
    includeQuery,
    documentId,
    extensions,
  };
}
