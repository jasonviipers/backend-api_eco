import { Hono } from 'hono'
import { errorHandler } from '../middleware/erroHandler'

export function registerErrorHandlers(app: Hono) {
  app.onError(errorHandler)
  app.notFound(c => c.json({ error: 'Endpoint not found' }, 404))
}