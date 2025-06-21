import express from "express"
import { v4 as uuidv4 } from "uuid"
import { query } from "../config/postgresql"
import { executeQuery } from "../config/cassandra"
import { authenticateToken, requireVendor, type AuthRequest } from "../middleware/auth"
import { validateRequest } from "../middleware/validation"
import { asyncHandler } from "../middleware/errorHandler"
import { z } from "zod"

const router = express.Router()

const createStreamSchema = z.object({
  title: z.string().min(1, "Stream title is required"),
  description: z.string().optional(),
  scheduledFor: z.string().datetime().optional(),
  productIds: z.array(z.string().uuid()).optional(),
  thumbnailUrl: z.string().url().optional(),
})

const updateStreamSchema = createStreamSchema.partial()

// Get live streams
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const page = Number.parseInt(req.query.page as string) || 1
    const limit = Number.parseInt(req.query.limit as string) || 20
    const status = (req.query.status as string) || "live"
    const offset = (page - 1) * limit

    const streamsResult = await query(
      `
    SELECT 
      s.id, s.title, s.description, s.thumbnail_url, s.status,
      s.started_at, s.scheduled_for, s.viewer_count,
      v.business_name as vendor_name, v.id as vendor_id
    FROM live_streams s
    JOIN vendors v ON s.vendor_id = v.id
    WHERE s.status = $1
    ORDER BY s.started_at DESC, s.scheduled_for ASC
    LIMIT $2 OFFSET $3
  `,
      [status, limit, offset],
    )

    const countResult = await query("SELECT COUNT(*) as total FROM live_streams WHERE status = $1", [status])

    const streams = streamsResult.rows
    const total = Number.parseInt(countResult.rows[0].total)

    res.json({
      streams,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  }),
)

// Get single stream
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params

    const streamResult = await query(
      `
    SELECT 
      s.*, 
      v.business_name as vendor_name, v.id as vendor_id
    FROM live_streams s
    JOIN vendors v ON s.vendor_id = v.id
    WHERE s.id = $1
  `,
      [id],
    )

    if (streamResult.rows.length === 0) {
      return res.status(404).json({ error: "Stream not found" })
    }

    const stream = streamResult.rows[0]

    // Get featured products
    if (stream.product_ids && stream.product_ids.length > 0) {
      const productsResult = await query("SELECT id, name, price, images FROM products WHERE id = ANY($1)", [
        stream.product_ids,
      ])
      stream.products = productsResult.rows
    }

    res.json(stream)
  }),
)

// Create stream (vendor only)
router.post(
  "/",
  authenticateToken,
  requireVendor,
  validateRequest({ body: createStreamSchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const streamData = req.body
    const vendorId = req.user!.vendorId
    const streamKey = uuidv4()

    const streamResult = await query(
      `
    INSERT INTO live_streams (
      vendor_id, title, description, scheduled_for, product_ids, 
      thumbnail_url, stream_key, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `,
      [
        vendorId,
        streamData.title,
        streamData.description,
        streamData.scheduledFor ? new Date(streamData.scheduledFor) : null,
        streamData.productIds || [],
        streamData.thumbnailUrl,
        streamKey,
        streamData.scheduledFor ? "scheduled" : "ready",
      ],
    )

    const stream = streamResult.rows[0]

    res.status(201).json({
      message: "Stream created successfully",
      stream: {
        ...stream,
        rtmpUrl: `rtmp://localhost:1935/live/${streamKey}`,
        streamKey: streamKey,
      },
    })
  }),
)

// Update stream (vendor only)
router.put(
  "/:id",
  authenticateToken,
  requireVendor,
  validateRequest({ body: updateStreamSchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params
    const updateData = req.body
    const vendorId = req.user!.vendorId

    // Check if stream belongs to vendor
    const existingStream = await query("SELECT id FROM live_streams WHERE id = $1 AND vendor_id = $2", [id, vendorId])

    if (existingStream.rows.length === 0) {
      return res.status(404).json({ error: "Stream not found or access denied" })
    }

    // Build update query
    const updateFields = []
    const updateValues = []
    let paramIndex = 1

    Object.entries(updateData).forEach(([key, value]) => {
      if (value !== undefined) {
        if (key === "productIds") {
          updateFields.push(`product_ids = $${paramIndex}`)
          updateValues.push(value)
        } else if (key === "scheduledFor") {
          updateFields.push(`scheduled_for = $${paramIndex}`)
          updateValues.push(new Date(value as string))
        } else {
          updateFields.push(`${key.replace(/([A-Z])/g, "_$1").toLowerCase()} = $${paramIndex}`)
          updateValues.push(value)
        }
        paramIndex++
      }
    })

    if (updateFields.length === 0) {
      return res.status(400).json({ error: "No valid fields to update" })
    }

    updateFields.push("updated_at = $" + paramIndex)
    updateValues.push(new Date())
    updateValues.push(id)

    const updateQuery = `
    UPDATE live_streams 
    SET ${updateFields.join(", ")}
    WHERE id = $${paramIndex + 1}
    RETURNING *
  `

    const result = await query(updateQuery, updateValues)
    const updatedStream = result.rows[0]

    res.json({
      message: "Stream updated successfully",
      stream: updatedStream,
    })
  }),
)

// Start stream (vendor only)
router.put(
  "/:id/start",
  authenticateToken,
  requireVendor,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params
    const vendorId = req.user!.vendorId

    // Check if stream belongs to vendor
    const streamResult = await query("SELECT id, status FROM live_streams WHERE id = $1 AND vendor_id = $2", [
      id,
      vendorId,
    ])

    if (streamResult.rows.length === 0) {
      return res.status(404).json({ error: "Stream not found or access denied" })
    }

    const stream = streamResult.rows[0]

    if (stream.status === "live") {
      return res.status(400).json({ error: "Stream is already live" })
    }

    // Update stream status
    await query("UPDATE live_streams SET status = $1, started_at = $2 WHERE id = $3", ["live", new Date(), id])

    res.json({ message: "Stream started successfully" })
  }),
)

// End stream (vendor only)
router.put(
  "/:id/end",
  authenticateToken,
  requireVendor,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params
    const vendorId = req.user!.vendorId

    // Check if stream belongs to vendor
    const streamResult = await query("SELECT id, status FROM live_streams WHERE id = $1 AND vendor_id = $2", [
      id,
      vendorId,
    ])

    if (streamResult.rows.length === 0) {
      return res.status(404).json({ error: "Stream not found or access denied" })
    }

    const stream = streamResult.rows[0]

    if (stream.status !== "live") {
      return res.status(400).json({ error: "Stream is not currently live" })
    }

    // Update stream status
    await query("UPDATE live_streams SET status = $1, ended_at = $2 WHERE id = $3", ["ended", new Date(), id])

    res.json({ message: "Stream ended successfully" })
  }),
)

// Get stream analytics (vendor only)
router.get(
  "/:id/analytics",
  authenticateToken,
  requireVendor,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params
    const vendorId = req.user!.vendorId

    // Check if stream belongs to vendor
    const streamResult = await query("SELECT id FROM live_streams WHERE id = $1 AND vendor_id = $2", [id, vendorId])

    if (streamResult.rows.length === 0) {
      return res.status(404).json({ error: "Stream not found or access denied" })
    }

    // Get analytics from Cassandra
    const viewerAnalytics = await executeQuery(
      "SELECT COUNT(*) as total_viewers FROM stream_analytics WHERE stream_id = ? AND event_type = ?",
      [id, "viewer_joined"],
    )

    const peakViewers = await executeQuery(
      "SELECT MAX(concurrent_viewers) as peak_viewers FROM stream_analytics WHERE stream_id = ?",
      [id],
    )

    const chatMessages = await executeQuery(
      "SELECT COUNT(*) as total_messages FROM chat_messages WHERE stream_id = ?",
      [id],
    )

    const analytics = {
      totalViewers: viewerAnalytics.rows[0]?.total_viewers || 0,
      peakViewers: peakViewers.rows[0]?.peak_viewers || 0,
      totalMessages: chatMessages.rows[0]?.total_messages || 0,
    }

    res.json(analytics)
  }),
)

// Get stream chat history
router.get(
  "/:id/chat",
  asyncHandler(async (req, res) => {
    const { id } = req.params
    const limit = Number.parseInt(req.query.limit as string) || 50

    const messages = await executeQuery(
      "SELECT * FROM chat_messages WHERE stream_id = ? ORDER BY timestamp DESC LIMIT ?",
      [id, limit],
    )

    res.json({
      messages: messages.rows.reverse(), // Reverse to show oldest first
    })
  }),
)

export default router
