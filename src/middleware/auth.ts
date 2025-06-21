import type { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"
import { query } from "../config/postgresql"
import { logger } from "../utils/logger"

export interface AuthRequest extends Request {
  user?: {
    id: string
    email: string
    role: string
    vendorId?: string
  }
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers["authorization"]
    const token = authHeader && authHeader.split(" ")[1]

    if (!token) {
      res.status(401).json({ error: "Access token required" })
      return
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any

    // Verify user still exists and is active
    const userResult = await query("SELECT id, email, role, is_active FROM users WHERE id = $1", [decoded.userId])

    if (userResult.rows.length === 0 || !userResult.rows[0].is_active) {
      res.status(401).json({ error: "Invalid or inactive user" })
      return
    }

    const user = userResult.rows[0]
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
    }

    // If user is a vendor, get vendor ID
    if (user.role === "vendor") {
      const vendorResult = await query("SELECT id FROM vendors WHERE user_id = $1", [user.id])
      if (vendorResult.rows.length > 0) {
        req.user.vendorId = vendorResult.rows[0].id
      }
    }

    next()
  } catch (error) {
    logger.error("Authentication error:", error)
    res.status(403).json({ error: "Invalid token" })
  }
}

export const requireRole = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" })
      return
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" })
      return
    }

    next()
  }
}

export const requireVendor = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (!req.user || req.user.role !== "vendor") {
    res.status(403).json({ error: "Vendor access required" })
    return
  }

  if (!req.user.vendorId) {
    res.status(403).json({ error: "Vendor profile not found" })
    return
  }

  next()
}

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" })
    return
  }

  next()
}
