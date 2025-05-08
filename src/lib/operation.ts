import { createHash } from "node:crypto";
import { getDocumentType } from "./document";
import { pruneObject } from "./helpers";
import type { OperationType } from "./types";

export interface Operation<TVariables> {
	type: OperationType;
	operationName: string;
	document: string;
	/**
	 * The id of the document, this is used for Persisted documents and predefined
	 */
	documentId?: string;
	variables: TVariables | undefined;
}

/**
 * Extract the operation name from a GraphQL document string
 * @param document - The GraphQL document string
 * @returns The operation name or a fallback
 */
function extractOperationName(document: string): string {
	// Simple regex to extract operation name
	// Looks for: query OperationName, mutation OperationName, etc.
	const match = document.match(
		/(?:query|mutation|subscription)\s+([A-Za-z0-9_]+)/,
	);
	return match?.[1] || "(GraphQL)";
}

/**
 * Create a GraphQL operation
 * This contains all of the (meta)data for a GraphQL operation
 * including the document, variables, documentId, includeQuery and extensions
 *
 * This can then be used to create request bodies or assert the kind of request needed based on the operation
 */
export function createOperation<TVariables>({
	document,
	variables,
	documentId,
}: {
	document: string;
	variables: TVariables | undefined;
	documentId?: string;
}): Operation<TVariables> {
	return {
		type: getDocumentType(document),
		operationName: extractOperationName(document),
		document,
		variables,
		documentId,
	};
}

/**
 * Generates the APQ extension object.
 */
export function getPersistedQueryExtension(document: string): {
	persistedQuery: { version: number; sha256Hash: string };
} {
	return {
		persistedQuery: {
			version: 1,
			sha256Hash: createHash("sha-256").update(document).digest("hex"),
		},
	};
}

/**
 * Create a URL for a persisted GraphQL operation
 * This is used when the operation is not sent in the request body
 */
export function createUrl<TVariables>(
	url: string,
	operation: Operation<TVariables>,
	extensions?: Record<string, unknown>,
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

	if (extensions) {
		result.searchParams.set("extensions", JSON.stringify(extensions));
	}

	return result;
}

/**
 * Create a request body for a non-persisted GraphQL operation
 * This is used when doing POST requests
 */
export function createRequestBody<TVariables>(payload: {
	documentId?: string;
	query?: string;
	variables?: TVariables;
	extensions?: Record<string, unknown>;
}): string {
	return JSON.stringify(pruneObject(payload));
}
