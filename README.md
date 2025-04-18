# Evolve GraphQL client

Client that handles GraphQL fetching for Evolve and it's derived platforms.
Has both a server client for server-only requests and a browser client for client-side requests.

## Features

Server client
- Before and after request hooks
    - Access to fetch options before request
    - Access to data after response
- GraphQL document parsing
- Opentelemetry tracing
- Persisted documents
    - With custom document id generator
- APQ (automatic persisted queries)
    - Includes fallback to POST if persisted query is not available

Extends fetch with:
- Correct headers



## Server request decision tree


- If mutation
    - Always send a POST request
- If query
    - Try APQ Get request
    - If `PersistedQueryNotFound` error then send a POST request

-- individual calls

- When using POST requests (non-APQ)
    - If `alwaysIncludeQuery` or no `documentId` available
        - Add query to request
    - Else
        - Only send documentId, variables and extensions

- When using GET requests (Persisted documents or APQ) with search parameters
    - Add documentId and variables to search parameters, add extensions if `documentId` is not set or `alwaysIncludeQuery` is enabled
