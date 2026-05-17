import { createMiddleware } from 'hono/factory'

import { ApiError } from './errors'
import type { AppEnv } from './types'

const namespaceRegex = /^[a-zA-Z0-9_-]{1,63}$/

export const requireAuth = createMiddleware<AppEnv>(async (context, next) => {
  if (
    context.req.header('Authorization') !== `Bearer ${context.env.API_TOKEN}`
  ) {
    throw new ApiError(
      401,
      'unauthorized',
      'Missing or invalid bearer token. Send "Authorization: Bearer <API_TOKEN>".'
    )
  }

  await next()
})

export const validateNamespace = createMiddleware<AppEnv>(
  async (context, next) => {
    const ns = context.req.param('namespace')

    if (!ns || !namespaceRegex.test(ns)) {
      throw new ApiError(
        400,
        'invalid_namespace',
        `Namespace "${ns}" is invalid. Use 1–63 characters of letters, digits, "_" or "-".`
      )
    }

    await next()
  }
)
