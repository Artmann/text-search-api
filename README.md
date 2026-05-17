# text-search-api

A small HTTP API on Cloudflare Workers for storing text documents and finding
them with semantic + metadata-filtered search.

Built on:

- **Hono** for the HTTP layer
- **Workers AI** (`@cf/baai/bge-base-en-v1.5`, 768 dims) for embeddings
- **Vectorize** as the vector store (cosine similarity)

Documents are bucketed by a caller-supplied **namespace** so a single Vectorize
index can serve multiple apps without collisions.

## Setup

```sh
bun install
```

Create the two Vectorize indexes (once per Cloudflare account):

```sh
npx wrangler vectorize create text-search-dev  --dimensions=768 --metric=cosine
npx wrangler vectorize create text-search-prod --dimensions=768 --metric=cosine
```

Declare any metadata fields you want to filter on (repeat per field, per index):

```sh
npx wrangler vectorize create-metadata-index text-search-dev  --property-name=type --type=string
npx wrangler vectorize create-metadata-index text-search-prod --property-name=type --type=string
```

Set the API bearer token:

- **Local dev** — put it in `.dev.vars.dev` (gitignored):
  ```
  API_TOKEN="your-dev-token"
  ```
- **Prod** — push it as a Worker secret:
  ```sh
  npx wrangler secret put API_TOKEN
  ```

## Run

```sh
bun run dev       # local, binds VECTORIZE → text-search-dev (remote)
bun run deploy    # production, binds VECTORIZE → text-search-prod
bun run test      # vitest endpoint tests against the dev index
```

All requests require:

```
Authorization: Bearer <API_TOKEN>
Content-Type: application/json
```

The `:namespace` URL segment must match `^[a-zA-Z0-9_-]{1,63}$`.

## Endpoints

### `PUT /:namespace/documents/:key` — upsert

Embeds `title + content` and stores it in Vectorize under the given namespace.
Re-PUTting the same `:key` overwrites the previous document.

**Body**

| Field      | Type                                          | Required | Notes                                                                                              |
| ---------- | --------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `title`    | string (≥1 char)                              | yes      | Embedded together with `content`. Returned in matches.                                             |
| `content`  | string (≥1 char)                              | yes      | Embedded together with `title`. Returned in matches.                                               |
| `metadata` | `Record<string, string \| number \| boolean>` | no       | Arbitrary tags. Filterable fields must be declared via `wrangler vectorize create-metadata-index`. |

**Example**

```sh
curl -X PUT http://localhost:8787/blog/documents/post-1 \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Hybrid search on Cloudflare",
    "content": "Using Workers AI and Vectorize together to build a small search API.",
    "metadata": { "type": "blog", "author": "art" }
  }'
```

**Response — `200 OK`**

```json
{ "namespace": "blog", "key": "post-1", "status": "upserted" }
```

### `POST /:namespace/search` — search

Embeds `query`, runs a vector similarity search scoped to `:namespace`, and
applies any metadata filter.

**Body**

| Field    | Type                             | Required | Notes                                                                  |
| -------- | -------------------------------- | -------- | ---------------------------------------------------------------------- |
| `query`  | string (≥1 char)                 | yes      | Free-form text. Matched semantically against stored `title + content`. |
| `topK`   | int 1–100                        | no       | Max results to return (default `10`).                                  |
| `filter` | Vectorize metadata-filter object | no       | Same syntax as Vectorize's `filter` parameter — see below.             |

**Filter syntax** (subset of Vectorize)

```jsonc
{ "type":   { "$eq": "blog" } }
{ "author": { "$in": ["art", "kira"] } }
{ "year":   { "$gte": 2024 } }
```

Supported ops: `$eq`, `$ne`, `$lt`, `$lte`, `$gt`, `$gte`, `$in`, `$nin`. Each
field used here must have a matching metadata index declared at the Vectorize
level.

**Example**

```sh
curl -X POST http://localhost:8787/blog/search \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "semantic search with cloudflare",
    "topK": 5,
    "filter": { "type": { "$eq": "blog" } }
  }'
```

**Response — `200 OK`**

```json
{
  "matches": [
    {
      "key": "post-1",
      "score": 0.87,
      "title": "Hybrid search on Cloudflare",
      "content": "Using Workers AI and Vectorize together…",
      "metadata": {
        "title": "…",
        "content": "…",
        "type": "blog",
        "author": "art"
      }
    }
  ]
}
```

`score` is cosine similarity (1.0 = identical direction). Matches are ordered
best-first.

## Errors

All errors share one shape:

```json
{ "error": "<code>", "message": "<human-readable explanation>" }
```

| HTTP | `error`             | When                                                            |
| ---- | ------------------- | --------------------------------------------------------------- |
| 400  | `invalid_json`      | Request body isn't valid JSON.                                  |
| 400  | `invalid_namespace` | `:namespace` doesn't match `[a-zA-Z0-9_-]{1,63}`.               |
| 400  | `invalid_body`      | A body field fails validation (Zod). `message` names the field. |
| 401  | `unauthorized`      | Missing or wrong `Authorization: Bearer …` header.              |
| 500  | `internal_error`    | Unexpected error. Check the Worker logs.                        |

## Notes

- One vector per document; the embedding is computed from
  `` `${title}\n\n${content}` ``.
- Internal vector ids are stored as `${namespace}:${key}`. The `:key` you sent
  is what comes back in `matches[].key`.
- `text-search-dev` is the only index touched by `bun run dev` and
  `bun run test`. `text-search-prod` is only written by deployed Workers.
