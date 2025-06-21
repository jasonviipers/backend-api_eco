import express from "express"
import multer from "multer"
import { cloudinary } from "../config/cloudinary"
import { query } from "../config/postgresql"
import { executeQuery } from "../config/cassandra"
import { authenticateToken, type AuthRequest } from "../middleware/auth"
import { validateRequest } from "../middleware/validation"
import { asyncHandler } from "../middleware/errorHandler"
import { z } from "zod"
import { processVideo } from "../utils/videoProcessor"
import { logger } from "../utils/logger"

const router = express.Router()

// Configure multer for video uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true)
    } else {
      cb(new Error("Only video files are allowed"))
    }
  },
})

const createVideoSchema = z.object({
  title: z.string().min(1, "Video title is required"),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  productIds: z.array(z.string().uuid()).optional(),
})

const videoQuerySchema = z.object({
  page: z.string().transform(Number).pipe(z.number().int().positive()).default("1"),
  limit: z.string().transform(Number).pipe(z.number().int().positive().max(50)).default("20"),
  userId: z.string().uuid().optional(),
  tag: z.string().optional(),
})

// Get videos feed
router.get(
  "/",
  validateRequest({ query: videoQuerySchema }),
  asyncHandler(async (req, res) => {
    const { page, limit, userId, tag } = req.query as any
    const offset = (page - 1) * limit

    const whereConditions = ["v.is_active = true"]
    const queryParams: any[] = []
    let paramIndex = 1

    if (userId) {
      whereConditions.push(`v.user_id = $${paramIndex}`)
      queryParams.push(userId)
      paramIndex++
    }

    if (tag) {
      whereConditions.push(`$${paramIndex} = ANY(v.tags)`)
      queryParams.push(tag)
      paramIndex++
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : ""

    const videosResult = await query(
      `
    SELECT 
      v.id, v.title, v.description, v.video_url, v.thumbnail_url,
      v.duration, v.view_count, v.like_count, v.comment_count,
      v.created_at, v.tags,
      u.first_name, u.last_name, u.id as user_id
    FROM short_videos v
    JOIN users u ON v.user_id = u.id
    ${whereClause}
    ORDER BY v.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `,
      [...queryParams, limit, offset],
    )

    const countResult = await query(
      `
    SELECT COUNT(*) as total
    FROM short_videos v
    JOIN users u ON v.user_id = u.id
    ${whereClause}
  `,
      queryParams,
    )

    const videos = videosResult.rows
    const total = Number.parseInt(countResult.rows[0].total)

    res.json({
      videos,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  }),
)

// Get single video
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params

    const videoResult = await query(
      `
    SELECT 
      v.*, 
      u.first_name, u.last_name, u.id as user_id
    FROM short_videos v
    JOIN users u ON v.user_id = u.id
    WHERE v.id = $1 AND v.is_active = true
  `,
      [id],
    )

    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: "Video not found" })
    }

    const video = videoResult.rows[0]

    // Get featured products if any
    if (video.product_ids && video.product_ids.length > 0) {
      const productsResult = await query("SELECT id, name, price, images FROM products WHERE id = ANY($1)", [
        video.product_ids,
      ])
      video.products = productsResult.rows
    }

    // Increment view count
    await query("UPDATE short_videos SET view_count = view_count + 1 WHERE id = $1", [id])

    // Track view in Cassandra
    await executeQuery("INSERT INTO video_views (video_id, user_id, event_type, timestamp) VALUES (?, ?, ?, ?)", [
      id,
      req.user?.id || "anonymous",
      "view",
      new Date(),
    ])

    res.json(video)
  }),
)

// Upload video
router.post(
  "/",
  authenticateToken,
  upload.single("video"),
  validateRequest({ body: createVideoSchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Video file is required" })
    }

    const { title, description, tags, productIds } = req.body
    const userId = req.user!.id

    try {
      // Upload video to Cloudinary
      const videoUpload = (await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            {
              resource_type: "video",
              folder: "short_videos",
              transformation: [{ quality: "auto" }, { format: "mp4" }],
            },
            (error, result) => {
              if (error) reject(error)
              else resolve(result)
            },
          )
          .end(req.file!.buffer)
      })) as any

      // Generate thumbnail
      const thumbnailUrl = cloudinary.url(videoUpload.public_id, {
        resource_type: "video",
        format: "jpg",
        transformation: [{ width: 300, height: 400, crop: "fill" }, { quality: "auto" }],
      })

      // Process video for additional formats if needed
      const processedVideo = await processVideo(videoUpload.secure_url)

      // Save video to database
      const videoResult = await query(
        `
      INSERT INTO short_videos (
        user_id, title, description, video_url, thumbnail_url,
        duration, tags, product_ids, cloudinary_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
        [
          userId,
          title,
          description,
          videoUpload.secure_url,
          thumbnailUrl,
          videoUpload.duration,
          tags || [],
          productIds || [],
          videoUpload.public_id,
        ],
      )

      const video = videoResult.rows[0]

      res.status(201).json({
        message: "Video uploaded successfully",
        video,
      })
    } catch (error) {
      logger.error("Video upload error:", error)
      res.status(500).json({ error: "Failed to upload video" })
    }
  }),
)

// Like video
router.post(
  "/:id/like",
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params
    const userId = req.user!.id

    // Check if video exists
    const videoResult = await query("SELECT id FROM short_videos WHERE id = $1 AND is_active = true", [id])

    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: "Video not found" })
    }

    // Check if already liked
    const existingLike = await query("SELECT id FROM video_likes WHERE video_id = $1 AND user_id = $2", [id, userId])

    if (existingLike.rows.length > 0) {
      // Unlike
      await query("DELETE FROM video_likes WHERE video_id = $1 AND user_id = $2", [id, userId])
      await query("UPDATE short_videos SET like_count = like_count - 1 WHERE id = $1", [id])

      res.json({ message: "Video unliked", liked: false })
    } else {
      // Like
      await query("INSERT INTO video_likes (video_id, user_id) VALUES ($1, $2)", [id, userId])
      await query("UPDATE short_videos SET like_count = like_count + 1 WHERE id = $1", [id])

      // Track like in Cassandra
      await executeQuery("INSERT INTO video_views (video_id, user_id, event_type, timestamp) VALUES (?, ?, ?, ?)", [
        id,
        userId,
        "like",
        new Date(),
      ])

      res.json({ message: "Video liked", liked: true })
    }
  }),
)

// Comment on video
router.post(
  "/:id/comment",
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params
    const { comment } = req.body
    const userId = req.user!.id

    if (!comment || comment.trim().length === 0) {
      return res.status(400).json({ error: "Comment is required" })
    }

    // Check if video exists
    const videoResult = await query("SELECT id FROM short_videos WHERE id = $1 AND is_active = true", [id])

    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: "Video not found" })
    }

    // Add comment
    const commentResult = await query(
      `
    INSERT INTO video_comments (video_id, user_id, comment)
    VALUES ($1, $2, $3)
    RETURNING *
  `,
      [id, userId, comment.trim()],
    )

    // Update comment count
    await query("UPDATE short_videos SET comment_count = comment_count + 1 WHERE id = $1", [id])

    // Get user info for response
    const userResult = await query("SELECT first_name, last_name FROM users WHERE id = $1", [userId])

    const newComment = {
      ...commentResult.rows[0],
      first_name: userResult.rows[0].first_name,
      last_name: userResult.rows[0].last_name,
    }

    res.status(201).json({
      message: "Comment added successfully",
      comment: newComment,
    })
  }),
)

// Get video comments
router.get(
  "/:id/comments",
  asyncHandler(async (req, res) => {
    const { id } = req.params
    const page = Number.parseInt(req.query.page as string) || 1
    const limit = Number.parseInt(req.query.limit as string) || 20
    const offset = (page - 1) * limit

    const commentsResult = await query(
      `
    SELECT 
      c.*, 
      u.first_name, u.last_name
    FROM video_comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.video_id = $1
    ORDER BY c.created_at DESC
    LIMIT $2 OFFSET $3
  `,
      [id, limit, offset],
    )

    const countResult = await query("SELECT COUNT(*) as total FROM video_comments WHERE video_id = $1", [id])

    const comments = commentsResult.rows
    const total = Number.parseInt(countResult.rows[0].total)

    res.json({
      comments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  }),
)

// Delete video (owner only)
router.delete(
  "/:id",
  authenticateToken,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params
    const userId = req.user!.id

    // Check if video belongs to user
    const videoResult = await query("SELECT cloudinary_id FROM short_videos WHERE id = $1 AND user_id = $2", [
      id,
      userId,
    ])

    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: "Video not found or access denied" })
    }

    const video = videoResult.rows[0]

    try {
      // Delete from Cloudinary
      if (video.cloudinary_id) {
        await cloudinary.uploader.destroy(video.cloudinary_id, { resource_type: "video" })
      }

      // Soft delete from database
      await query("UPDATE short_videos SET is_active = false WHERE id = $1", [id])

      res.json({ message: "Video deleted successfully" })
    } catch (error) {
      logger.error("Video deletion error:", error)
      res.status(500).json({ error: "Failed to delete video" })
    }
  }),
)

export default router
