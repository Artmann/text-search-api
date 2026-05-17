import { zValidator } from '@hono/zod-validator'
import { createFactory } from 'hono/factory'

import { embed } from '../embed'
import { onValidationError, upsertBodySchema } from '../schemas'
import type { AppEnv } from '../types'

const factory = createFactory<AppEnv>()

export const upsertDocument = factory.createHandlers(
  zValidator('json', upsertBodySchema, onValidationError),
  async (context) => {
    const ns = context.req.param('namespace')
    const key = context.req.param('key')
    const { title, content, metadata } = context.req.valid('json')

    const truncatedTitle = title.length > 100 ? title.slice(0, 100) : title
    const truncatedContent = content.length > 5_000 ? content.slice(0, 5_000) : content

    const values = await embed(context.env.AI, `${truncatedTitle}\n\n${truncatedContent}`)

    await context.env.VECTORIZE.upsert([
      {
        id: `${ns}:${key}`,
        values,
        namespace: ns,
        metadata: { title: truncatedTitle, content: truncatedContent, ...(metadata ?? {}) }
      }
    ])

    return context.json({ namespace: ns, key, status: 'upserted' })
  }
)
