import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { compress } from 'hono/compress'
import { poweredBy } from 'hono/powered-by'
import { Server as HttpServer } from 'node:http'
import { Server as SocketIOServer } from 'socket.io'
import dotenv from 'dotenv'
import { rateLimiter } from 'hono-rate-limiter'
import { secureHeaders } from 'hono/secure-headers'

// Import configurations and middleware
import { connectPostgreSQL } from './config/postgresql'
import { connectCassandra } from './config/cassandra'
import { connectRedis } from './config/redis'
import { initializeCloudinary } from './config/cloudinary'
import { initializeStripe } from './config/stripe'
import { setupSocketIO } from './config/socket'
import { setupMediaServer } from './config/mediaServer'
import { errorHandler } from './middleware/erroHandler'
import { logger } from './utils/logger'

// Routes
import auth from './routes/auth.routes'
import { userRouter } from './routes/user.routes'
import { jwt } from 'hono/jwt'


const app = new Hono()
const io = new SocketIOServer(app as unknown as HttpServer)

// Middleware
app.use('*', poweredBy())
app.use('*', secureHeaders())
// app.use('*', compress())
app.use(
  '*',
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
  })
)
// app.use('*', limiter)
app.use('*', async (c, next) => {
  if (c.req.method === 'POST' || c.req.method === 'PUT') {
    const body = await c.req.json()
    c.req.addValidatedData('json', body)
  }
  await next()
})

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})
// API Routes
app.route('/auth', auth)
app.route('/user', userRouter)

// Initialize services
async function initializeServices() {
  try {
    // Database connections
    await connectPostgreSQL()
    // await connectCassandra()
    await connectRedis()

    // External services
    initializeCloudinary()
    initializeStripe()

    // Socket.IO setup
    setupSocketIO(io)

    logger.info("All services initialized successfully")
  } catch (error) {
    logger.error("Failed to initialize services:", error)
    process.exit(1)
  }
}

await initializeServices()

export default app
