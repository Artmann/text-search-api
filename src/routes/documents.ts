import { zValidator } from '@hono/zod-validator'
import { createFactory } from 'hono/factory'
import invariant from 'tiny-invariant'

import {
  formatId,
  fromStoredVector,
  toStoredVector
} from '../documents/encoder'
import { ApiError } from '../errors'
import { onValidationError, upsertBodySchema } from '../schemas'
import type { AppEnv } from '../types'

const factory = createFactory<AppEnv>()

export const getDocument = factory.createHandlers(async (context) => {
  const namespace = context.req.param('namespace')
  const key = context.req.param('key')
  invariant(namespace, 'namespace param is required by the route pattern')
  invariant(key, 'key param is required by the route pattern')

  const [vector] = await context.env.VECTORIZE.getByIds([formatId(namespace, key)])

  if (!vector) {
    throw new ApiError(
      404,
      'not_found',
      `No document at /${namespace}/documents/${key}. Upsert it first with PUT.`
    )
  }

  return context.json({ document: fromStoredVector(vector) })
})

export const upsertDocument = factory.createHandlers(
  zValidator('json', upsertBodySchema, onValidationError),
  async (context) => {
    const namespace = context.req.param('namespace')
    const key = context.req.param('key')
    invariant(namespace, 'namespace param is required by the route pattern')
    invariant(key, 'key param is required by the route pattern')

    const { content, metadata, title } = context.req.valid('json')

    const vector = await toStoredVector(context.env.AI, {
      content,
      key,
      metadata,
      namespace,
      title
    })

    await context.env.VECTORIZE.upsert([vector])

    return context.json({ key, namespace, status: 'upserted' })
  }
)
