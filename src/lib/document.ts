import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core";

/**
 * Get the document id from the meta object
 * which is supplied by GraphQL Codegen using the client preset
 */
export const getDocumentIdFromMeta = <TResult, TVariables>(
  query: DocumentTypeDecoration<TResult, TVariables>
  // biome-ignore lint/suspicious/noExplicitAny: Typing is only dynamically available if you enable it in client preset
): string | undefined => (query as any)?.__meta__?.documentId;

/**
 * Get document hash for automatic persisted queries
 *
 * This is reliant on properly setting up the client preset for GraphQL Codegen
 * to include the hash in the meta object, see [client-preset docs](https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#normalized-caches-urql-and-apollo-client)
 * for more information.
 * @returns SHA256 hash of the query if it exists
 *
 * @example
 * ```ts
 * const documentHash = getDocumentHash(document); // "sha256-hash"
 * ```
 */
export const getDocumentHashFromMeta = <TResult, TVariables>(
  query: DocumentTypeDecoration<TResult, TVariables>
  // biome-ignore lint/suspicious/noExplicitAny: Typing is only dynamically available if you enable it in client preset
): string | undefined => (query as any)?.__meta__?.hash;

/**
 * Get the document type from the stringified document
 * @param document - The document string
 * @returns The document type, either "query" or "mutation"
 *
 * @example
 * ```ts
 * const document = `
 *   query MyQuery {
 *     myField
 *   }
 * `;
 * const documentType = getDocumentType(document); // "query"
 * ```
 */
export const getDocumentType = (document: string): "query" | "mutation" =>
  document.trim().startsWith("query") ? "query" : "mutation";
