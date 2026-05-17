import { zValidator } from '@hono/zod-validator'
import { createFactory } from 'hono/factory'

import { embedText, fromStoredVector } from '../documents/encoder'
import { onValidationError, searchBodySchema } from '../schemas'
import type { AppEnv } from '../types'

const factory = createFactory<AppEnv>()

export const search = factory.createHandlers(
  zValidator('json', searchBodySchema, onValidationError),
  async (context) => {
    const namespace = context.req.param('namespace')
    const { filter, query, topK } = context.req.valid('json')

    const queryVector = await embedText(context.env.AI, query)

    const result = await context.env.VECTORIZE.query(queryVector, {
      filter: filter as VectorizeVectorMetadataFilter | undefined,
      namespace,
      returnMetadata: 'all',
      topK: topK ?? 10
    })

    return context.json({
      matches: result.matches.map((match) => {
        const decoded = fromStoredVector(match)

        return {
          content: decoded.content,
          key: decoded.key,
          metadata: decoded.metadata,
          score: match.score,
          title: decoded.title
        }
      })
    })
  }
)
