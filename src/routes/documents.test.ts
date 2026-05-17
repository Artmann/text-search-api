import { beforeEach, describe, expect, it } from 'vitest'

import { embedModelName } from '../embed'
import {
  callRoute,
  createTestEnv,
  getDocument,
  putDocument,
  type TestEnv
} from '../test-helpers/harness'

interface ErrorBody {
  error: string
  message: string
}

let env: TestEnv

beforeEach(() => {
  env = createTestEnv()
})

describe('PUT /:namespace/documents/:key', () => {
  it('upserts a document and stores it in vectorize', async () => {
    const response = await putDocument(env, 'posts', 'post-1', {
      title: 'Hybrid search',
      content: 'Using Workers AI and Vectorize together.',
      metadata: { type: 'blog', views: 12, published: true }
    })

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({
      key: 'post-1',
      namespace: 'posts',
      status: 'upserted'
    })

    expect(env.VECTORIZE.store.size).toEqual(1)
    const stored = env.VECTORIZE.store.get('posts:post-1')
    expect(stored).toBeDefined()
    expect(stored?.id).toEqual('posts:post-1')
    expect(stored?.namespace).toEqual('posts')
    expect(stored?.metadata).toEqual({
      content: 'Using Workers AI and Vectorize together.',
      published: true,
      title: 'Hybrid search',
      type: 'blog',
      views: 12
    })
    expect(Array.isArray(stored?.values)).toEqual(true)
    expect(stored?.values.length).toBeGreaterThan(0)
  })

  it('embeds the combined title and content via Workers AI', async () => {
    await putDocument(env, 'posts', 'post-1', {
      title: 'Title here',
      content: 'Content here'
    })

    expect(env.AI.calls).toEqual([
      { model: embedModelName, text: 'Title here\n\nContent here' }
    ])
  })

  it('upserts a document with no custom metadata', async () => {
    const response = await putDocument(env, 'posts', 'post-1', {
      title: 'T',
      content: 'C'
    })

    expect(response.status).toEqual(200)
    expect(env.VECTORIZE.store.get('posts:post-1')?.metadata).toEqual({
      content: 'C',
      title: 'T'
    })
  })

  it('overwrites an existing document with the same key', async () => {
    await putDocument(env, 'posts', 'post-1', {
      title: 'First',
      content: 'First content'
    })
    await putDocument(env, 'posts', 'post-1', {
      title: 'Second',
      content: 'Second content'
    })

    expect(env.VECTORIZE.store.size).toEqual(1)
    expect(env.VECTORIZE.store.get('posts:post-1')?.metadata).toEqual({
      content: 'Second content',
      title: 'Second'
    })
  })

  it('truncates titles longer than 100 characters', async () => {
    const longTitle = 'x'.repeat(150)
    await putDocument(env, 'posts', 'post-1', {
      title: longTitle,
      content: 'C'
    })

    const stored = env.VECTORIZE.store.get('posts:post-1')
    expect((stored?.metadata.title as string).length).toEqual(100)
    expect(env.AI.calls[0]?.text.startsWith('x'.repeat(100) + '\n\n')).toEqual(
      true
    )
  })

  it('truncates content longer than 5000 characters', async () => {
    const longContent = 'y'.repeat(6_000)
    await putDocument(env, 'posts', 'post-1', {
      title: 'T',
      content: longContent
    })

    const stored = env.VECTORIZE.store.get('posts:post-1')
    expect((stored?.metadata.content as string).length).toEqual(5_000)
  })

  it('rejects a missing title', async () => {
    const response = await putDocument(env, 'posts', 'post-1', {
      content: 'C'
    })

    expect(response.status).toEqual(400)
    const body = (await response.json()) as ErrorBody
    expect(body.error).toEqual('invalid_body')
    expect(body.message).toContain('title')
  })

  it('rejects a missing content', async () => {
    const response = await putDocument(env, 'posts', 'post-1', {
      title: 'T'
    })

    expect(response.status).toEqual(400)
    const body = (await response.json()) as ErrorBody
    expect(body.error).toEqual('invalid_body')
    expect(body.message).toContain('content')
  })

  it('rejects an empty title', async () => {
    const response = await putDocument(env, 'posts', 'post-1', {
      title: '',
      content: 'C'
    })

    expect(response.status).toEqual(400)
    expect(((await response.json()) as ErrorBody).error).toEqual('invalid_body')
  })

  it('rejects an empty content', async () => {
    const response = await putDocument(env, 'posts', 'post-1', {
      title: 'T',
      content: ''
    })

    expect(response.status).toEqual(400)
    expect(((await response.json()) as ErrorBody).error).toEqual('invalid_body')
  })

  it('rejects non-scalar metadata values', async () => {
    const response = await putDocument(env, 'posts', 'post-1', {
      title: 'T',
      content: 'C',
      metadata: { nested: { not: 'allowed' } }
    })

    expect(response.status).toEqual(400)
    expect(((await response.json()) as ErrorBody).error).toEqual('invalid_body')
  })

  it('rejects a malformed JSON body', async () => {
    const response = await callRoute(env, '/posts/documents/post-1', {
      method: 'PUT',
      rawBody: '{ not json'
    })

    expect(response.status).toEqual(400)
    expect(((await response.json()) as ErrorBody).error).toEqual('invalid_json')
  })

  it('rejects a request with no authorization header', async () => {
    const response = await putDocument(
      env,
      'posts',
      'post-1',
      { title: 'T', content: 'C' },
      { auth: false }
    )

    expect(response.status).toEqual(401)
    expect(((await response.json()) as ErrorBody).error).toEqual('unauthorized')
  })

  it('rejects a request with an incorrect bearer token', async () => {
    const response = await putDocument(
      env,
      'posts',
      'post-1',
      { title: 'T', content: 'C' },
      { auth: 'wrong-token' }
    )

    expect(response.status).toEqual(401)
  })

  it.each([
    ['contains a space', 'bad ns'],
    ['contains an exclamation mark', 'bad!ns'],
    ['contains a slash', 'bad/ns'],
    ['is 64 characters long', 'a'.repeat(64)]
  ])('rejects a namespace that %s', async (_label, namespace) => {
    const response = await callRoute(
      env,
      `/${encodeURIComponent(namespace)}/documents/x`,
      {
        body: JSON.stringify({ title: 'T', content: 'C' }),
        method: 'PUT'
      }
    )

    expect(response.status).toEqual(400)
    expect(((await response.json()) as ErrorBody).error).toEqual(
      'invalid_namespace'
    )
  })

  it('returns 500 when the AI embedding call fails', async () => {
    env.AI.failNext(new Error('embedding service down'))

    const response = await putDocument(env, 'posts', 'post-1', {
      title: 'T',
      content: 'C'
    })

    expect(response.status).toEqual(500)
    expect(((await response.json()) as ErrorBody).error).toEqual(
      'internal_error'
    )
    expect(env.VECTORIZE.store.size).toEqual(0)
  })

  it('returns 500 when the vectorize upsert fails', async () => {
    env.VECTORIZE.failNext('upsert', new Error('vectorize unavailable'))

    const response = await putDocument(env, 'posts', 'post-1', {
      title: 'T',
      content: 'C'
    })

    expect(response.status).toEqual(500)
    expect(((await response.json()) as ErrorBody).error).toEqual(
      'internal_error'
    )
    expect(env.VECTORIZE.store.size).toEqual(0)
  })
})

describe('GET /:namespace/documents/:key', () => {
  it('returns a stored document with its metadata', async () => {
    await putDocument(env, 'posts', 'post-1', {
      title: 'Hybrid search',
      content: 'Using Workers AI and Vectorize together.',
      metadata: { type: 'blog', views: 12 }
    })

    const response = await getDocument(env, 'posts', 'post-1')

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({
      document: {
        content: 'Using Workers AI and Vectorize together.',
        key: 'post-1',
        metadata: { type: 'blog', views: 12 },
        namespace: 'posts',
        title: 'Hybrid search'
      }
    })
  })

  it('returns a document with an empty metadata object when no custom fields were stored', async () => {
    await putDocument(env, 'posts', 'post-1', {
      title: 'T',
      content: 'C'
    })

    const response = await getDocument(env, 'posts', 'post-1')

    expect(await response.json()).toEqual({
      document: {
        content: 'C',
        key: 'post-1',
        metadata: {},
        namespace: 'posts',
        title: 'T'
      }
    })
  })

  it('returns 404 when the document does not exist', async () => {
    const response = await getDocument(env, 'posts', 'missing-key')

    expect(response.status).toEqual(404)
    const body = (await response.json()) as ErrorBody
    expect(body.error).toEqual('not_found')
    expect(body.message).toContain('Upsert it first')
  })

  it('isolates documents across namespaces', async () => {
    await putDocument(env, 'posts', 'shared', { title: 'A', content: 'a' })

    const response = await getDocument(env, 'comments', 'shared')

    expect(response.status).toEqual(404)
  })

  it('rejects a request with no authorization header', async () => {
    const response = await getDocument(env, 'posts', 'post-1', { auth: false })

    expect(response.status).toEqual(401)
  })

  it('rejects an invalid namespace', async () => {
    const response = await callRoute(env, '/bad%20ns/documents/x', {
      method: 'GET'
    })

    expect(response.status).toEqual(400)
    expect(((await response.json()) as ErrorBody).error).toEqual(
      'invalid_namespace'
    )
  })

  it('returns 500 when vectorize.getByIds fails', async () => {
    env.VECTORIZE.failNext('getByIds', new Error('vectorize unavailable'))

    const response = await getDocument(env, 'posts', 'post-1')

    expect(response.status).toEqual(500)
    expect(((await response.json()) as ErrorBody).error).toEqual(
      'internal_error'
    )
  })
})
