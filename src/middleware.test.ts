import { beforeEach, describe, expect, it } from 'vitest'

import { callRoute, createTestEnv, type TestEnv } from './test-helpers/harness'

interface ErrorBody {
  error: string
  message: string
}

let env: TestEnv

beforeEach(() => {
  env = createTestEnv()
})

describe('requireAuth middleware', () => {
  it('rejects requests without an authorization header', async () => {
    const response = await callRoute(env, '/posts/search', {
      body: JSON.stringify({ query: 'q' }),
      method: 'POST',
      auth: false
    })

    expect(response.status).toEqual(401)
    const body = (await response.json()) as ErrorBody
    expect(body.error).toEqual('unauthorized')
    expect(body.message).toContain('Bearer')
  })

  it('rejects requests with a non-bearer authorization scheme', async () => {
    const response = await callRoute(env, '/posts/search', {
      body: JSON.stringify({ query: 'q' }),
      headers: { Authorization: 'Basic dGVzdC10b2tlbg==' },
      method: 'POST',
      auth: false
    })

    expect(response.status).toEqual(401)
  })

  it('rejects requests with an incorrect bearer token', async () => {
    const response = await callRoute(env, '/posts/search', {
      auth: 'not-the-real-token',
      body: JSON.stringify({ query: 'q' }),
      method: 'POST'
    })

    expect(response.status).toEqual(401)
  })
})

describe('validateNamespace middleware', () => {
  it.each([
    ['containing a space', 'bad ns'],
    ['containing a special character', 'bad!ns'],
    ['containing a slash', 'bad/ns'],
    ['that is 64 characters long', 'a'.repeat(64)]
  ])('rejects a namespace %s', async (_label, namespace) => {
    const response = await callRoute(
      env,
      `/${encodeURIComponent(namespace)}/search`,
      {
        body: JSON.stringify({ query: 'q' }),
        method: 'POST'
      }
    )

    expect(response.status).toEqual(400)
    const body = (await response.json()) as ErrorBody
    expect(body.error).toEqual('invalid_namespace')
    expect(body.message).toContain('1–63 characters')
  })

  it('accepts a namespace at the 63-character upper bound', async () => {
    const namespace = 'a'.repeat(63)
    const response = await callRoute(env, `/${namespace}/search`, {
      body: JSON.stringify({ query: 'q' }),
      method: 'POST'
    })

    expect(response.status).toEqual(200)
  })

  it('accepts a namespace with underscores and hyphens', async () => {
    const response = await callRoute(env, '/my_ns-1/search', {
      body: JSON.stringify({ query: 'q' }),
      method: 'POST'
    })

    expect(response.status).toEqual(200)
  })
})
