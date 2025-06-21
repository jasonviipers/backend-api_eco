import type { Request, Response, NextFunction } from "express"
import { type ZodSchema, ZodError } from "zod"

export const validateRequest = (schema: {
  body?: ZodSchema
  query?: ZodSchema
  params?: ZodSchema
}) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schema.body) {
        req.body = schema.body.parse(req.body)
      }
      if (schema.query) {
        req.query = schema.query.parse(req.query)
      }
      if (schema.params) {
        req.params = schema.params.parse(req.params)
      }
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        const errorMessages = error.errors.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        }))
        res.status(400).json({
          error: "Validation failed",
          details: errorMessages,
        })
        return
      }
      next(error)
    }
  }
}
