import {
  env,
  createExecutionContext,
  waitOnExecutionContext
} from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import app from './index'

const token = 'test-token'
const created: Array<{ ns: string; key: string }> = []

async function call(path: string, init: RequestInit = {}) {
  const request = new Request(`http://test${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {})
    }
  })
  const ctx = createExecutionContext()
  const response = await app.fetch(request, env, ctx)
  await waitOnExecutionContext(ctx)
  return response
}

async function upsert(ns: string, key: string, body: object) {
  created.push({ ns, key })
  return call(`/${ns}/documents/${key}`, {
    method: 'PUT',
    body: JSON.stringify(body)
  })
}

async function search<T = unknown>(ns: string, query: object): Promise<T> {
  const response = await call(`/${ns}/search`, {
    method: 'POST',
    body: JSON.stringify(query)
  })
  return (await response.json()) as T
}

// Vectorize writes are eventually consistent — upserts can take several
// seconds to be queryable. Poll the search endpoint until the predicate is
// satisfied or we give up.
async function searchUntil<T extends { matches: unknown[] }>(
  ns: string,
  query: object,
  predicate: (body: T) => boolean,
  options: { attempts?: number; delayMs?: number } = {}
): Promise<T> {
  const attempts = options.attempts ?? 30
  const delayMs = options.delayMs ?? 1000
  let last: T = { matches: [] } as unknown as T

  for (let i = 0; i < attempts; i++) {
    last = await search<T>(ns, query)
    if (predicate(last)) {
      return last
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  return last
}

afterEach(async () => {
  if (created.length === 0) {
    return
  }

  await env.VECTORIZE.deleteByIds(created.map((c) => `${c.ns}:${c.key}`))
  created.length = 0
})

describe('text-search-api', () => {
  it('upserts a document and finds it via semantic search', async () => {
    const ns = `test-${crypto.randomUUID()}`
    const upsertResponse = await upsert(ns, 'post-1', {
      title: 'Hybrid search on Cloudflare',
      content:
        'Using Workers AI and Vectorize together to build a small search API.',
      metadata: { type: 'blog' }
    })
    expect(upsertResponse.status).toEqual(200)

    const body = await searchUntil<{
      matches: Array<{ key: string; score: number }>
    }>(
      ns,
      { query: 'semantic search with cloudflare' },
      (b) => b.matches.length > 0
    )

    expect(body.matches[0]?.key).toEqual('post-1')
    expect(body.matches[0]?.score).toBeGreaterThan(0.5)
  })

  it('isolates documents across namespaces', async () => {
    const a = `test-${crypto.randomUUID()}`
    const b = `test-${crypto.randomUUID()}`
    await upsert(a, 'shared', {
      title: 'A',
      content: 'apples are red fruits'
    })
    await upsert(b, 'shared', {
      title: 'B',
      content: 'bananas are yellow fruits'
    })

    const inA = await searchUntil<{ matches: Array<{ title: string }> }>(
      a,
      { query: 'apple' },
      (body) => body.matches.length > 0
    )
    expect(inA.matches.map((match) => match.title)).toEqual(['A'])

    const inB = await searchUntil<{ matches: Array<{ title: string }> }>(
      b,
      { query: 'banana' },
      (body) => body.matches.length > 0
    )
    expect(inB.matches.map((match) => match.title)).toEqual(['B'])
  })

  it('rejects an invalid namespace', async () => {
    const response = await call('/bad%20ns/documents/x', {
      method: 'PUT',
      body: JSON.stringify({ title: 't', content: 'c' })
    })
    expect(response.status).toEqual(400)
  })

  it('rejects an unauthenticated request', async () => {
    const ns = `test-${crypto.randomUUID()}`
    const request = new Request(`http://test/${ns}/search`, {
      method: 'POST',
      body: JSON.stringify({ query: 'x' }),
      headers: { 'content-type': 'application/json' }
    })
    const ctx = createExecutionContext()
    const response = await app.fetch(request, env, ctx)
    await waitOnExecutionContext(ctx)
    expect(response.status).toEqual(401)
  })
})
