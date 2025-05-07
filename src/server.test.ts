import type { TypedDocumentNode } from "@graphql-typed-document-node/core";
import { describe, expect, it } from "vitest";
import { createServerClient } from "./server";

describe("Server client", () => {
  it("should be able to create a server client", () => {
    const serverClient = createServerClient({
      endpoint: "http://localhost:3000/graphql",
    });

    expect(serverClient).toBeDefined();
  });

  it("should be able to fetch a query", async () => {
    const serverClient = createServerClient({
      endpoint: "http://localhost:3000/graphql",
      disablePersistedOperations: true,
    });

    const result = await serverClient.fetch({
      document: `
        query ListPostIds {
          posts { id }
        }
      ` as unknown as TypedDocumentNode<{ posts: { id: number }[] }, undefined>,
      variables: undefined,
    });

    expect(result).toEqual({
      data: { posts: [{ id: 1 }] },
    });
  });

  it("should return an error on 401 with the response", async () => {
    const serverClient = createServerClient({
      endpoint: "http://localhost:3000/graphql",
      disablePersistedOperations: true,
    });

    await expect(() =>
      serverClient.fetch({
        document: `
        query ListPostsFail {
          posts { id }
        }
      ` as unknown as TypedDocumentNode<{ posts: { id: number }[] }, undefined>,
        variables: undefined,
      })
    ).rejects.toThrowError(/401 Unauthorized/);
  });
});
