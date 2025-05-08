import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { createServerClient } from "../src/server";

declare global {
	interface RequestInit {
		next?: {
			revalidate?: number | false;
			tags?: string[];
		};
	}
}

/**
 * You can use beforeRequest to disable cache for specific requests
 */
const serverClient = createServerClient({
	onRequest: async (fetchOptions) => {
		if (process.env.DISABLE_CACHE === "true") {
			if (fetchOptions) {
				// Disable cache
				fetchOptions.cache = "no-store";
				fetchOptions.next = undefined;
			}
		}

		return fetchOptions;
	},
	endpoint: "http://localhost:3000/graphql",
});

serverClient.fetch({
	document: `
    query {
      hello
    }
  ` as unknown as TypedDocumentNode<{ hello: string }, undefined>,
	variables: undefined,
	fetchOptions: {
		cache: "force-cache",
	},
});
