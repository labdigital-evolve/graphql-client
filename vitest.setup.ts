import { HttpResponse, graphql } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

const posts = [
  {
    userId: 1,
    id: 1,
    title: "first post title",
    body: "first post body",
  },
];

const graphqlHandlers = [
  graphql.query("ListPosts", () => {
    return HttpResponse.json({
      data: { posts },
    });
  }),
  graphql.query("ListPostIds", () => {
    return HttpResponse.json({
      data: { posts: posts.map((post) => ({ id: post.id })) },
    });
  }),
];

const server = setupServer(...graphqlHandlers);

// Start server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

// Close server after all tests
afterAll(() => server.close());

// Reset handlers after each test for test isolation
afterEach(() => server.resetHandlers());
