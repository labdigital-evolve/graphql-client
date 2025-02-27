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

