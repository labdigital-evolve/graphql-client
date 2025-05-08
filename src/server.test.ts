import { http, HttpResponse } from "msw";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { server } from "../vitest.setup";
import { TypedDocumentString } from "./lib/test";
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

    const document = new TypedDocumentString(
      `
        query ListPostIds {
          posts { id }
        }
      `,
      undefined
    );

    const result = await serverClient.fetch({
      document,
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

    const document = new TypedDocumentString(
      `
        query ListPostsFail {
          posts { id }
        }
      `,
      undefined
    );

    await expect(() =>
      serverClient.fetch({
        document,
        variables: undefined,
      })
    ).rejects.toThrowError(/401 Unauthorized/);
  });

  it("works with APQ by hashing the document", async () => {
    const serverClient = createServerClient({
      endpoint: "http://localhost:3000/graphql",
    });

    const document = new TypedDocumentString(
      `
        query ListPostIds {
          posts { id }
        }
      `,
      undefined
    );

    const expectedHash = createHash("sha-256")
      .update(document.toString())
      .digest("hex");

    // Handler for APQ request that contains the expected hash
    server.use(
      http.get("http://localhost:3000/graphql", ({ request }) => {
        const params = new URL(request.url).searchParams;

        if (params.get("extensions")?.includes("persistedQuery")) {
          const extensions = JSON.parse(params.get("extensions") || "{}");
          const hash = extensions.persistedQuery.sha256Hash;

          // Check whether the given hash in the url is the same as us manually hashing the document
          if (hash === expectedHash) {
            return HttpResponse.json({
              data: { posts: [{ id: 1 }] },
            });
          }
        }

        return new HttpResponse("Not found", { status: 404 });
      })
    );

    const result = await serverClient.fetch({
      document,
      variables: undefined,
    });

    expect(result).toEqual({
      data: { posts: [{ id: 1 }] },
    });
  });

  it("falls back to the query body if APQ fails", async () => {
    const serverClient = createServerClient({
      endpoint: "http://localhost:3000/graphql",
    });

    const document = new TypedDocumentString(
      `
        query ListPostIds {
          posts { id }
        }
      `,
      undefined
    );

    server.use(
      http.get("http://localhost:3000/graphql", ({ request }) => {
        const params = new URL(request.url).searchParams;

        // Just making sure that the op is being called
        if (params.get("op") !== "ListPostIds") {
          return HttpResponse.json({}, { status: 200 });
        }

        return HttpResponse.json({
          errors: [
            {
              message: "PersistedQueryNotFound",
            },
          ],
        });
      })
    );

    const result = await serverClient.fetch({
      document,
      variables: undefined,
    });

    expect(result).toEqual({
      data: { posts: [{ id: 1 }] },
    });
  });
});
