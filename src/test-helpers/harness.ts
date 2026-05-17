import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'

import app from '../index'
import type { Bindings } from '../types'
import {
  createFakeAi,
  createFakeVectorize,
  type FakeAi,
  type FakeVectorize
} from './fakes'

export const testToken = 'test-token'

export interface TestEnv {
  AI: FakeAi
  API_TOKEN: string
  VECTORIZE: FakeVectorize
}

export function createTestEnv(): TestEnv {
  return {
    AI: createFakeAi(),
    API_TOKEN: testToken,
    VECTORIZE: createFakeVectorize()
  }
}

export interface CallOptions extends Omit<RequestInit, 'headers'> {
  auth?: false | string
  headers?: Record<string, string>
  rawBody?: string
}

export async function callRoute(
  env: TestEnv,
  path: string,
  options: CallOptions = {}
): Promise<Response> {
  const { auth, body, headers: extraHeaders, rawBody, ...rest } = options

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(extraHeaders ?? {})
  }

  if (auth !== false) {
    headers.Authorization = `Bearer ${auth ?? testToken}`
  }

  const request = new Request(`http://test${path}`, {
    ...rest,
    body: rawBody ?? body,
    headers
  })

  const context = createExecutionContext()
  const response = await app.fetch(request, env as unknown as Bindings, context)
  await waitOnExecutionContext(context)

  return response
}

export async function putDocument(
  env: TestEnv,
  namespace: string,
  key: string,
  body: object,
  options: Omit<CallOptions, 'method' | 'body'> = {}
): Promise<Response> {
  return callRoute(env, `/${namespace}/documents/${key}`, {
    ...options,
    body: JSON.stringify(body),
    method: 'PUT'
  })
}

export async function getDocument(
  env: TestEnv,
  namespace: string,
  key: string,
  options: Omit<CallOptions, 'method' | 'body'> = {}
): Promise<Response> {
  return callRoute(env, `/${namespace}/documents/${key}`, {
    ...options,
    method: 'GET'
  })
}

export async function searchDocuments(
  env: TestEnv,
  namespace: string,
  body: object,
  options: Omit<CallOptions, 'method' | 'body'> = {}
): Promise<Response> {
  return callRoute(env, `/${namespace}/search`, {
    ...options,
    body: JSON.stringify(body),
    method: 'POST'
  })
}
