import { Hono } from 'hono'

// Import configurations and middleware
import { connectPostgreSQL } from "./config/postgresql"
import { connectCassandra } from "./config/cassandra"
import { connectRedis } from "./config/redis"
// import { initializeCloudinary } from "./config/cloudinary"
// import { initializeStripe } from "./config/stripe"
// import { setupSocketIO } from "./config/socket"
// import { setupMediaServer } from "./config/mediaServer"
// import { errorHandler } from "./middleware/errorHandler"
import { logger } from "./utils/logger"

// Import routes
import { auth } from './routes/auth.routes'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})
  .route('/auth', auth)

// Initialize services
async function initializeServices() {
  try {
    // Database connections
    await connectPostgreSQL()
    // await connectCassandra()
    await connectRedis()

    logger.info("All services initialized successfully")
  } catch (error) {
    logger.error("Failed to initialize services:", error)
    process.exit(1)
  }
}

await initializeServices()

export default app
