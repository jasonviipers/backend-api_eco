import express from "express"
import cors from "cors"
import helmet from "helmet"
import compression from "compression"
import { createServer } from "http"
import { Server as SocketIOServer } from "socket.io"
import dotenv from "dotenv"
import rateLimit from "express-rate-limit"

// Import configurations and middleware
import { connectPostgreSQL } from "./config/postgresql"
import { connectCassandra } from "./config/cassandra"
import { connectRedis } from "./config/redis"
import { initializeCloudinary } from "./config/cloudinary"
import { initializeStripe } from "./config/stripe"
import { setupSocketIO } from "./config/socket"
import { setupMediaServer } from "./config/mediaServer"
import { errorHandler } from "./middleware/errorHandler"
import { logger } from "./utils/logger"

// Import routes
import authRoutes from "./routes/auth"
import userRoutes from "./routes/users"
import vendorRoutes from "./routes/vendors"
import productRoutes from "./routes/products"
import orderRoutes from "./routes/orders"
import streamRoutes from "./routes/streams"
import videoRoutes from "./routes/videos"
import paymentRoutes from "./routes/payments"
import analyticsRoutes from "./routes/analytics"

dotenv.config()

const app = express()
const server = createServer(app)
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
})

const PORT = process.env.PORT || 5000

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
})

// Middleware
app.use(helmet())
app.use(compression())
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  }),
)
app.use(limiter)
app.use(express.json({ limit: "50mb" }))
app.use(express.urlencoded({ extended: true, limit: "50mb" }))

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

// API Routes
app.use("/api/auth", authRoutes)
app.use("/api/users", userRoutes)
app.use("/api/vendors", vendorRoutes)
app.use("/api/products", productRoutes)
app.use("/api/orders", orderRoutes)
app.use("/api/streams", streamRoutes)
app.use("/api/videos", videoRoutes)
app.use("/api/payments", paymentRoutes)
app.use("/api/analytics", analyticsRoutes)

// Error handling middleware
app.use(errorHandler)

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" })
})

// Initialize services
async function initializeServices() {
  try {
    // Database connections
    await connectPostgreSQL()
    await connectCassandra()
    await connectRedis()

    // External services
    initializeCloudinary()
    initializeStripe()

    // Socket.IO setup
    setupSocketIO(io)

    // Media server setup
    setupMediaServer()

    logger.info("All services initialized successfully")
  } catch (error) {
    logger.error("Failed to initialize services:", error)
    process.exit(1)
  }
}

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully")
  server.close(() => {
    logger.info("Process terminated")
    process.exit(0)
  })
})

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully")
  server.close(() => {
    logger.info("Process terminated")
    process.exit(0)
  })
})

// Start server
async function startServer() {
  await initializeServices()

  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`)
    logger.info(`Environment: ${process.env.NODE_ENV || "development"}`)
  })
}

startServer().catch((error) => {
  logger.error("Failed to start server:", error)
  process.exit(1)
})

export { app, io }
