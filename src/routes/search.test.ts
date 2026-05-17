import { beforeEach, describe, expect, it } from 'vitest'

import { embedModelName } from '../documents/encoder'
import {
  callRoute,
  createTestEnv,
  putDocument,
  searchDocuments,
  type TestEnv
} from '../test-helpers/harness'

interface ErrorBody {
  error: string
  message: string
}

interface Match {
  content: string
  key: string
  metadata: Record<string, unknown>
  score: number
  title: string
}

interface SearchResponse {
  matches: Match[]
}

let env: TestEnv

beforeEach(() => {
  env = createTestEnv()
})

describe('POST /:namespace/search', () => {
  it('returns matches sorted by descending score with the namespace prefix stripped', async () => {
    await putDocument(env, 'posts', 'apples', {
      title: 'Apples',
      content: 'apples are red fruits',
      metadata: { category: 'fruit' }
    })
    await putDocument(env, 'posts', 'bananas', {
      title: 'Bananas',
      content: 'bananas are yellow fruits',
      metadata: { category: 'fruit' }
    })

    const response = await searchDocuments(env, 'posts', { query: 'apples' })

    expect(response.status).toEqual(200)
    const body = (await response.json()) as SearchResponse
    expect(body.matches.length).toEqual(2)
    expect(body.matches[0]?.key).toEqual('apples')
    expect(body.matches[0]?.title).toEqual('Apples')
    expect(body.matches[0]?.content).toEqual('apples are red fruits')
    expect(body.matches[0]?.metadata).toEqual({ category: 'fruit' })
    expect(typeof body.matches[0]?.score).toEqual('number')
    expect(body.matches[0]?.score).toBeGreaterThanOrEqual(body.matches[1].score)
  })

  it('embeds the query via Workers AI', async () => {
    await searchDocuments(env, 'posts', { query: 'apples' })

    expect(env.AI.calls).toEqual([{ model: embedModelName, text: 'apples' }])
  })

  it('defaults to a topK of 10', async () => {
    for (let index = 0; index < 12; index++) {
      await putDocument(env, 'posts', `post-${index}`, {
        title: `Title ${index}`,
        content: `content ${index}`
      })
    }

    const response = await searchDocuments(env, 'posts', { query: 'content' })

    const body = (await response.json()) as SearchResponse
    expect(body.matches.length).toEqual(10)
  })

  it('honors an explicit topK', async () => {
    for (let index = 0; index < 5; index++) {
      await putDocument(env, 'posts', `post-${index}`, {
        title: `Title ${index}`,
        content: `content ${index}`
      })
    }

    const response = await searchDocuments(env, 'posts', {
      query: 'content',
      topK: 3
    })

    const body = (await response.json()) as SearchResponse
    expect(body.matches.length).toEqual(3)
  })

  it('filters matches by metadata equality', async () => {
    await putDocument(env, 'posts', 'apples', {
      title: 'Apples',
      content: 'apples are red',
      metadata: { category: 'fruit' }
    })
    await putDocument(env, 'posts', 'carrots', {
      title: 'Carrots',
      content: 'carrots are orange',
      metadata: { category: 'vegetable' }
    })

    const response = await searchDocuments(env, 'posts', {
      query: 'fresh produce',
      filter: { category: 'fruit' }
    })

    const body = (await response.json()) as SearchResponse
    expect(body.matches.map((match) => match.key)).toEqual(['apples'])
  })

  it('returns an empty matches array when the namespace has no documents', async () => {
    const response = await searchDocuments(env, 'empty', { query: 'anything' })

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({ matches: [] })
  })

  it('isolates results across namespaces', async () => {
    await putDocument(env, 'fruits', 'apples', {
      title: 'Apples',
      content: 'apples are red fruits'
    })
    await putDocument(env, 'veggies', 'carrots', {
      title: 'Carrots',
      content: 'carrots are orange vegetables'
    })

    const fruitsResponse = await searchDocuments(env, 'fruits', {
      query: 'food'
    })
    const veggiesResponse = await searchDocuments(env, 'veggies', {
      query: 'food'
    })

    const fruits = (await fruitsResponse.json()) as SearchResponse
    const veggies = (await veggiesResponse.json()) as SearchResponse

    expect(fruits.matches.map((match) => match.title)).toEqual(['Apples'])
    expect(veggies.matches.map((match) => match.title)).toEqual(['Carrots'])
  })

  it('rejects a missing query', async () => {
    const response = await searchDocuments(env, 'posts', {})

    expect(response.status).toEqual(400)
    expect(((await response.json()) as ErrorBody).error).toEqual('invalid_body')
  })

  it('rejects an empty query', async () => {
    const response = await searchDocuments(env, 'posts', { query: '' })

    expect(response.status).toEqual(400)
    expect(((await response.json()) as ErrorBody).error).toEqual('invalid_body')
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['greater than 100', 101],
    ['not an integer', 1.5]
  ])('rejects topK that is %s', async (_label, topK) => {
    const response = await searchDocuments(env, 'posts', {
      query: 'q',
      topK
    })

    expect(response.status).toEqual(400)
    expect(((await response.json()) as ErrorBody).error).toEqual('invalid_body')
  })

  it('rejects a malformed JSON body', async () => {
    const response = await callRoute(env, '/posts/search', {
      method: 'POST',
      rawBody: '{ "query":'
    })

    expect(response.status).toEqual(400)
    expect(((await response.json()) as ErrorBody).error).toEqual('invalid_json')
  })

  it('rejects a request with no authorization header', async () => {
    const response = await searchDocuments(
      env,
      'posts',
      { query: 'q' },
      { auth: false }
    )

    expect(response.status).toEqual(401)
  })

  it('rejects an invalid namespace', async () => {
    const response = await callRoute(env, '/bad%20ns/search', {
      body: JSON.stringify({ query: 'q' }),
      method: 'POST'
    })

    expect(response.status).toEqual(400)
    expect(((await response.json()) as ErrorBody).error).toEqual(
      'invalid_namespace'
    )
  })

  it('returns 500 when the AI embedding call fails', async () => {
    env.AI.failNext(new Error('embedding service down'))

    const response = await searchDocuments(env, 'posts', { query: 'q' })

    expect(response.status).toEqual(500)
    expect(((await response.json()) as ErrorBody).error).toEqual(
      'internal_error'
    )
  })

  it('returns 500 when vectorize.query fails', async () => {
    env.VECTORIZE.failNext('query', new Error('vectorize unavailable'))

    const response = await searchDocuments(env, 'posts', { query: 'q' })

    expect(response.status).toEqual(500)
    expect(((await response.json()) as ErrorBody).error).toEqual(
      'internal_error'
    )
  })
})
