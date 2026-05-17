import { z } from 'zod'
import { ApiError } from './errors'

export const upsertBodySchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
})

export const searchBodySchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().positive().max(100).optional(),
  filter: z.record(z.string(), z.any()).optional()
})

// Generic across schema output type so a single hook works for every route.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const onValidationError = (result: any) => {
  if (result.success) return
  const issue = result.error.issues[0]
  const path = issue.path.join('.') || 'body'
  throw new ApiError(400, 'invalid_body', `${path}: ${issue.message}`)
}
