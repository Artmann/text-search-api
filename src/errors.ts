import type { ErrorHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import type { AppEnv } from './types'

export class ApiError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const handleError: ErrorHandler<AppEnv> = (error, context) => {
  if (error instanceof ApiError) {
    return context.json(
      { error: error.code, message: error.message },
      error.status
    )
  }

  if (
    error instanceof SyntaxError ||
    (error instanceof HTTPException &&
      error.message === 'Malformed JSON in request body')
  ) {
    return context.json(
      {
        error: 'invalid_json',
        message: `Request body is not valid JSON: ${error.message}. Check for trailing commas, unquoted keys, or missing braces.`
      },
      400
    )
  }

  if (error instanceof HTTPException) {
    return error.getResponse()
  }

  console.error(error)

  return context.json(
    {
      error: 'internal_error',
      message:
        'The server hit an unexpected error. Try again, and if it keeps happening, check the worker logs.'
    },
    500
  )
}
