import { zValidator } from '@hono/zod-validator'
import { createFactory } from 'hono/factory'

import { embed } from '../embed'
import { ApiError } from '../errors'
import { onValidationError, upsertBodySchema } from '../schemas'
import type { AppEnv } from '../types'

const factory = createFactory<AppEnv>()

export const getDocument = factory.createHandlers(async (context) => {
  const ns = context.req.param('namespace')
  const key = context.req.param('key')
  const id = `${ns}:${key}`

  const [vector] = await context.env.VECTORIZE.getByIds([id])

  if (!vector) {
    throw new ApiError(
      404,
      'not_found',
      `No document at /${ns}/documents/${key}. Upsert it first with PUT.`
    )
  }

  const metadata = vector.metadata ?? {}
  const { title, content, ...rest } = metadata as Record<string, unknown>

  return context.json({
    document: {
      namespace: ns,
      key,
      title,
      content,
      metadata: rest
    }
  })
})

export const upsertDocument = factory.createHandlers(
  zValidator('json', upsertBodySchema, onValidationError),
  async (context) => {
    const ns = context.req.param('namespace')
    const key = context.req.param('key')
    const { title, content, metadata } = context.req.valid('json')

    const truncatedTitle = title.length > 100 ? title.slice(0, 100) : title
    const truncatedContent =
      content.length > 5_000 ? content.slice(0, 5_000) : content

    const values = await embed(
      context.env.AI,
      `${truncatedTitle}\n\n${truncatedContent}`
    )

    await context.env.VECTORIZE.upsert([
      {
        id: `${ns}:${key}`,
        values,
        namespace: ns,
        metadata: {
          title: truncatedTitle,
          content: truncatedContent,
          ...(metadata ?? {})
        }
      }
    ])

    return context.json({ namespace: ns, key, status: 'upserted' })
  }
)
