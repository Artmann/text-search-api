import { Hono } from 'hono'

import { handleError } from './errors'
import { requireAuth, validateNamespace } from './middleware'
import { getDocument, upsertDocument } from './routes/documents'
import { search } from './routes/search'
import type { AppEnv } from './types'

const app = new Hono<AppEnv>()

app.onError(handleError)

app.use('*', requireAuth)
app.use('/:namespace/*', validateNamespace)

app.get('/:namespace/documents/:key', ...getDocument)
app.put('/:namespace/documents/:key', ...upsertDocument)
app.post('/:namespace/search', ...search)

export default app
