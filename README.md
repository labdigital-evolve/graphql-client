# Evolve GraphQL Client

A specialized GraphQL client for Evolve and its derived platforms that provides robust server-side and browser-side GraphQL operations.

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Features

### Server Client
- **Advanced Request Management**
  - Before request hooks with access to fetch options
  - After response hooks with access to response data
  - OpenTelemetry tracing integration

- **Flexible Document Handling**
  - GraphQL document parsing
  - Support for both string and AST document nodes
  - Operation name detection

- **Performance Optimizations**
  - Automatic Persisted Queries (APQ)
  - Custom document ID generation
  - Fallback to POST if APQ fails

- **Enhanced Fetch Integration**
  - Proper Content-Type headers
  - Structured error handling
  - Default fetch options

### Browser Client
- Client-side GraphQL operations (Coming soon)

## Installation

```bash
# Using npm
npm install @labdigital/evolve-graphql-client

# Using yarn
yarn add @labdigital/evolve-graphql-client

# Using pnpm
pnpm add @labdigital/evolve-graphql-client

# Using bun
bun add @labdigital/evolve-graphql-client
```

## Usage

### Basic Query

```typescript
import { createServerClient } from 'evolve-graphql-client/server';
import { gql } from 'graphql-tag';

const client = createServerClient({
  endpoint: 'https://your-graphql-api.com/graphql',
});

// Using a typed document node
const GET_USER = gql`
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      name
      email
    }
  }
`;

// Execute the query
const response = await client.fetch({
  document: GET_USER,
  variables: { id: '123' },
});

console.log(response.user);
```

### Advanced Configuration

```typescript
import { createServerClient } from 'evolve-graphql-client/server';

const client = createServerClient({
  endpoint: 'https://your-graphql-api.com/graphql',

  // Hook executed before each request
  onRequest: async (fetchOptions) => {
    // Add authentication header
    fetchOptions.headers.set('Authorization', `Bearer ${getToken()}`);
    return fetchOptions;
  },

  // Hook executed after each response
  onResponse: async (response) => {
    // Log response headers for debugging
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
  },

  // Control persisted operations
  alwaysIncludeQuery: process.env.NODE_ENV === 'development',
  disablePersistedOperations: false,

  // Set default fetch options
  defaultFetchOptions: {
    credentials: 'include',
    cache: 'no-store',
  },
});
```

## Request Processing

The server client intelligently handles GraphQL operations based on type:

### Request Decision Flow
1. **For Mutations:**
   - Always sends a POST request with the full query

2. **For Queries:**
   - First attempts an APQ GET request using document ID
   - Falls back to POST if `PersistedQueryNotFound` error occurs

### Request Content Logic
- **POST requests (non-APQ):**
  - Includes full query if `alwaysIncludeQuery` is true or no `documentId` is available
  - Otherwise sends only documentId, variables, and extensions

- **GET requests (Persisted or APQ):**
  - Adds documentId and variables to search parameters
  - Includes extensions if needed based on configuration

## TypeScript Support

This library has full TypeScript support and integrates with the GraphQL typed document node specification.
