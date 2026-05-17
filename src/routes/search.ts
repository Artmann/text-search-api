import { zValidator } from '@hono/zod-validator'
import { createFactory } from 'hono/factory'

import { embed } from '../embed'
import { onValidationError, searchBodySchema } from '../schemas'
import type { AppEnv } from '../types'

const factory = createFactory<AppEnv>()

export const search = factory.createHandlers(
  zValidator('json', searchBodySchema, onValidationError),
  async (context) => {
    const ns = context.req.param('namespace')
    const { query, filter, topK } = context.req.valid('json')

    const qvec = await embed(context.env.AI, query)

    const result = await context.env.VECTORIZE.query(qvec, {
      filter: filter as VectorizeVectorMetadataFilter | undefined,
      namespace: ns,
      returnMetadata: 'all',
      topK: topK ?? 10,
    })

    const prefix = `${ns}:`

    return context.json({
      matches: result.matches.map((match) => ({
        content: match.metadata?.content,
        key: match.id.startsWith(prefix)
          ? match.id.slice(prefix.length)
          : match.id,
        metadata: match.metadata,
        score: match.score,
        title: match.metadata?.title
      }))
    })
  }
)
