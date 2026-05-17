import {
  env,
  createExecutionContext,
  waitOnExecutionContext
} from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import app from './index'

const TOKEN = 'test-token'
const created: Array<{ ns: string; key: string }> = []

async function call(path: string, init: RequestInit = {}) {
  const req = new Request(`http://test${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...(init.headers ?? {})
    }
  })
  const ctx = createExecutionContext()
  const res = await app.fetch(req, env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

async function upsert(ns: string, key: string, body: object) {
  created.push({ ns, key })
  return call(`/${ns}/documents/${key}`, {
    method: 'PUT',
    body: JSON.stringify(body)
  })
}

afterEach(async () => {
  if (created.length === 0) return
  await env.VECTORIZE.deleteByIds(created.map((c) => `${c.ns}:${c.key}`))
  created.length = 0
})

describe('text-search-api', () => {
  it('upserts a document and finds it via semantic search', async () => {
    const ns = `test-${crypto.randomUUID()}`
    const up = await upsert(ns, 'post-1', {
      title: 'Hybrid search on Cloudflare',
      content:
        'Using Workers AI and Vectorize together to build a small search API.',
      metadata: { type: 'blog' }
    })
    expect(up.status).toBe(200)

    const res = await call(`/${ns}/search`, {
      method: 'POST',
      body: JSON.stringify({ query: 'semantic search with cloudflare' })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      matches: Array<{ key: string; score: number }>
    }
    expect(body.matches[0]?.key).toBe('post-1')
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

    const inA = (await (
      await call(`/${a}/search`, {
        method: 'POST',
        body: JSON.stringify({ query: 'apple' })
      })
    ).json()) as { matches: Array<{ title: string }> }
    expect(inA.matches.map((m) => m.title)).toEqual(['A'])

    const inB = (await (
      await call(`/${b}/search`, {
        method: 'POST',
        body: JSON.stringify({ query: 'banana' })
      })
    ).json()) as { matches: Array<{ title: string }> }
    expect(inB.matches.map((m) => m.title)).toEqual(['B'])
  })

  it('rejects an invalid namespace', async () => {
    const res = await call('/bad%20ns/documents/x', {
      method: 'PUT',
      body: JSON.stringify({ title: 't', content: 'c' })
    })
    expect(res.status).toBe(400)
  })

  it('rejects an unauthenticated request', async () => {
    const ns = `test-${crypto.randomUUID()}`
    const req = new Request(`http://test/${ns}/search`, {
      method: 'POST',
      body: JSON.stringify({ query: 'x' }),
      headers: { 'content-type': 'application/json' }
    })
    const ctx = createExecutionContext()
    const res = await app.fetch(req, env, ctx)
    await waitOnExecutionContext(ctx)
    expect(res.status).toBe(401)
  })
})
