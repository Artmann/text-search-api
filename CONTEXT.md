# Domain language

## Document

The unit of data the API stores and searches. A document belongs to a
**namespace** and is identified within that namespace by a **key**. It carries a
title, a content body, and an optional metadata map of scalar values.

## Stored vector

A Vectorize record produced by encoding a document. Its `id` is
`` `${namespace}:${key}` ``. Its `metadata` blob carries the document's title
and content alongside any caller-supplied metadata. Its `values` are the
embedding of `` `${title}\n\n${content}` ``.

## Encoder

The seam between Document and Stored Vector. Owns the id format, the
title/content-in-metadata convention, truncation limits, and the embedding model
name. See `src/documents/encoder.ts`.

The encoder also exposes `embedText` for embedding a search query — anything
that needs to talk to Workers AI for embeddings should go through it so the
model name and the response cast live in exactly one file.

## Key

Identifies a document within its namespace. Must not contain `:` (the id
separator). Otherwise unconstrained at the API layer.

## Namespace

Isolates documents from each other. Matches `/^[a-zA-Z0-9_-]{1,63}$/`. Validated
by the `validateNamespace` middleware in `src/middleware.ts`.
