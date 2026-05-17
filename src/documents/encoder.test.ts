import { describe, expect, it } from 'vitest'

import { ApiError } from '../errors'
import { createFakeAi, type FakeAi } from '../test-helpers/fakes'
import {
  embedModelName,
  fromStoredVector,
  maxContentLength,
  maxTitleLength,
  toStoredVector,
  validateKey
} from './encoder'

function createAi(): { ai: Ai; fake: FakeAi } {
  const fake = createFakeAi()
  return { ai: fake as unknown as Ai, fake }
}

describe('validateKey', () => {
  it('accepts a plain key', () => {
    expect(() => validateKey('post-1')).not.toThrow()
  })

  it('accepts a key with dots and slashes', () => {
    expect(() => validateKey('docs/2024.01/post.md')).not.toThrow()
  })

  it('rejects a key containing ":"', () => {
    try {
      validateKey('bad:key')
      throw new Error('expected validateKey to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      const apiError = error as ApiError
      expect(apiError.status).toEqual(400)
      expect(apiError.code).toEqual('invalid_body')
      expect(apiError.message).toContain('":"')
    }
  })
})

describe('toStoredVector', () => {
  it('builds a vector with the namespaced id, the embedding, and title/content in metadata', async () => {
    const { ai } = createAi()

    const vector = await toStoredVector(ai, {
      content: 'apples are red fruits',
      key: 'apples',
      metadata: { category: 'fruit', views: 3 },
      namespace: 'posts',
      title: 'Apples'
    })

    expect(vector.id).toEqual('posts:apples')
    expect(vector.namespace).toEqual('posts')
    expect(vector.metadata).toEqual({
      category: 'fruit',
      content: 'apples are red fruits',
      title: 'Apples',
      views: 3
    })
    expect(Array.isArray(vector.values)).toEqual(true)
    expect((vector.values as number[]).length).toBeGreaterThan(0)
  })

  it('embeds the combined title and content via the configured model', async () => {
    const { ai, fake } = createAi()

    await toStoredVector(ai, {
      content: 'content body',
      key: 'k',
      namespace: 'ns',
      title: 'the title'
    })

    expect(fake.calls).toEqual([
      { model: embedModelName, text: 'the title\n\ncontent body' }
    ])
  })

  it('canonical title/content win over caller metadata of the same name', async () => {
    const { ai } = createAi()

    const vector = await toStoredVector(ai, {
      content: 'real content',
      key: 'k',
      metadata: { content: 'hijacked content', title: 'hijacked title' },
      namespace: 'ns',
      title: 'real title'
    })

    expect(vector.metadata?.title).toEqual('real title')
    expect(vector.metadata?.content).toEqual('real content')
  })

  it('rejects a key containing ":" before doing any work', async () => {
    const { ai, fake } = createAi()

    await expect(
      toStoredVector(ai, {
        content: 'c',
        key: 'a:b',
        namespace: 'ns',
        title: 't'
      })
    ).rejects.toBeInstanceOf(ApiError)

    expect(fake.calls).toEqual([])
  })

  it('propagates errors from the AI binding', async () => {
    const { ai, fake } = createAi()
    fake.failNext(new Error('embedding service down'))

    await expect(
      toStoredVector(ai, {
        content: 'c',
        key: 'k',
        namespace: 'ns',
        title: 't'
      })
    ).rejects.toThrow('embedding service down')
  })

  describe('truncation', () => {
    it.each([
      ['under the limit', maxTitleLength - 1, maxTitleLength - 1],
      ['exactly at the limit', maxTitleLength, maxTitleLength],
      ['over the limit', maxTitleLength + 1, maxTitleLength]
    ])('title %s', async (_label, inputLength, expectedLength) => {
      const { ai } = createAi()

      const vector = await toStoredVector(ai, {
        content: 'c',
        key: 'k',
        namespace: 'ns',
        title: 'x'.repeat(inputLength)
      })

      expect((vector.metadata?.title as string).length).toEqual(expectedLength)
    })

    it.each([
      ['under the limit', maxContentLength - 1, maxContentLength - 1],
      ['exactly at the limit', maxContentLength, maxContentLength],
      ['over the limit', maxContentLength + 1, maxContentLength]
    ])('content %s', async (_label, inputLength, expectedLength) => {
      const { ai } = createAi()

      const vector = await toStoredVector(ai, {
        content: 'y'.repeat(inputLength),
        key: 'k',
        namespace: 'ns',
        title: 't'
      })

      expect((vector.metadata?.content as string).length).toEqual(
        expectedLength
      )
    })
  })
})

describe('fromStoredVector', () => {
  it('decomposes a stored vector back into a document', () => {
    const decoded = fromStoredVector({
      id: 'posts:apples',
      metadata: {
        category: 'fruit',
        content: 'apples are red fruits',
        title: 'Apples'
      }
    })

    expect(decoded).toEqual({
      content: 'apples are red fruits',
      key: 'apples',
      metadata: { category: 'fruit' },
      namespace: 'posts',
      title: 'Apples'
    })
  })

  it('returns an empty metadata object when no extra fields were stored', () => {
    const decoded = fromStoredVector({
      id: 'posts:apples',
      metadata: { content: 'c', title: 't' }
    })

    expect(decoded.metadata).toEqual({})
  })

  it('handles a vector with missing metadata', () => {
    const decoded = fromStoredVector({ id: 'posts:apples' })

    expect(decoded.namespace).toEqual('posts')
    expect(decoded.key).toEqual('apples')
    expect(decoded.metadata).toEqual({})
  })

  it('round-trips with toStoredVector', async () => {
    const { ai } = createAi()

    const document = {
      content: 'content body',
      key: 'apples',
      metadata: { category: 'fruit', views: 3 },
      namespace: 'posts',
      title: 'Apples'
    }

    const stored = await toStoredVector(ai, document)
    const decoded = fromStoredVector(stored)

    expect(decoded).toEqual(document)
  })
})
