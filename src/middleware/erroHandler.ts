import type { Context, Next } from "hono"
import { HTTPException } from "hono/http-exception"
import { logger } from "../utils/logger"
import { ContentfulStatusCode } from "hono/utils/http-status"

export interface AppError extends Error {
  statusCode?: number
  isOperational?: boolean
}

export const errorHandler = async (error: AppError | HTTPException, c: Context) => {
  let statusCode = error instanceof HTTPException ? error.status : (error.statusCode || 500)
  let message = error.message

  // Get client IP and User-Agent from headers
  const clientIP = c.req.header("cf-connecting-ip") || 
                   c.req.header("x-forwarded-for") || 
                   c.req.header("x-real-ip") || 
                   "unknown"
  const userAgent = c.req.header("user-agent") || "unknown"

  // Log error
  logger.error("Error occurred:", {
    error: error.message,
    stack: error.stack,
    url: c.req.url,
    method: c.req.method,
    ip: clientIP,
    userAgent: userAgent,
  })

  // Handle specific error types
  if (error.name === "ValidationError") {
    statusCode = 400
    message = "Validation failed"
  } else if (error.name === "JsonWebTokenError") {
    statusCode = 401
    message = "Invalid token"
  } else if (error.name === "TokenExpiredError") {
    statusCode = 401
    message = "Token expired"
  } else if (error.message.includes("duplicate key")) {
    statusCode = 409
    message = "Resource already exists"
  }

  // Don't leak error details in production
  if (process.env.NODE_ENV === "production" && statusCode === 500) {
    message = "Internal server error"
  }

  return c.json(
    {
      error: message,
      ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
    },
    statusCode as ContentfulStatusCode
  )
}

// Error handling middleware for Hono
export const errorMiddleware = async (c: Context, next: Next) => {
  try {
    await next()
  } catch (error) {
    return errorHandler(error as AppError | HTTPException, c)
  }
}

// Alternative: Global error handler (use with app.onError)
export const globalErrorHandler = (error: Error, c: Context) => {
  if (error instanceof HTTPException) {
    return errorHandler(error, c)
  }
  return errorHandler(error as AppError, c)
}

export const createError = (message: string, statusCode = 500): AppError => {
  const error: AppError = new Error(message)
  error.statusCode = statusCode
  error.isOperational = true
  return error
}

// Create HTTPException for Hono (recommended)
export const createHTTPError = (message: string, statusCode = 500) => {
  return new HTTPException(statusCode as ContentfulStatusCode, { message })
}

// Async handler wrapper for Hono
export const asyncHandler = <T extends any[]>(
  fn: (c: Context, next: Next, ...args: T) => Promise<Response | void>
) => {
  return async (c: Context, next: Next, ...args: T) => {
    try {
      return await fn(c, next, ...args)
    } catch (error) {
      throw error // Let the error middleware handle it
    }
  }
}