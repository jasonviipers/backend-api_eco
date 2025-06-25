import { Hono } from "hono";
import { query } from "../config/postgresql";
import { executeQuery } from "../config/cassandra";
import { authenticateToken, requireAdmin } from "../middleware/auth";
import { validateRequest } from "../middleware/validation";
import { asyncHandler } from "../middleware/erroHandler";
import { createVideoSchema, videoQuerySchema } from "../schemas/user";
import { cloudinary } from "../config/cloudinary";
import { queueVideoProcessing, videoQueue } from "../utils/videoQueue";
import { logger } from "../utils/logger";
import { getFile, uploadMiddleware } from "../utils/hono-upload";

export const videoRoutes = new Hono();

videoRoutes.get(
	"/",
	validateRequest({ query: videoQuerySchema }),
	asyncHandler(async (c) => {
		const { page = "1", limit = "20", userId, tag } = c.req.query();
		const pageNum = Number.parseInt(page);
		const limitNum = Number.parseInt(limit);
		const offset = (pageNum - 1) * limitNum;

		const whereConditions = ["v.is_active = true"];
		const queryParams: unknown[] = [];
		let paramIndex = 1;

		if (userId) {
			whereConditions.push(`v.user_id = $${paramIndex}`);
			queryParams.push(userId);
			paramIndex++;
		}

		if (tag) {
			whereConditions.push(`$${paramIndex} = ANY(v.tags)`);
			queryParams.push(tag);
			paramIndex++;
		}

		const whereClause =
			whereConditions.length > 0
				? `WHERE ${whereConditions.join(" AND ")}`
				: "";

		const videosResult = await query(
			`
    SELECT 
      v.id, v.title, v.description, v.video_url, v.thumbnail_url,
      v.duration, v.view_count, v.like_count, v.comment_count,
      v.created_at, v.tags,
      u.full_name, u.id as user_id
    FROM short_videos v
    JOIN users u ON v.user_id = u.id
    ${whereClause}
    ORDER BY v.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `,
			[...queryParams, limit, offset],
		);

		const countResult = await query(
			`
    SELECT COUNT(*) as total
    FROM short_videos v
    JOIN users u ON v.user_id = u.id
    ${whereClause}
  `,
			queryParams,
		);

		const videos = videosResult.rows;
		const total = Number.parseInt(countResult.rows[0].total);

		return c.json({
			videos,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limitNum),
			},
		});
	}),
);
videoRoutes.get(
	"/:id",
	asyncHandler(async (c) => {
		const { id } = c.req.param();

		const videoResult = await query(
			`
    SELECT 
      v.*, 
      u.full_name, u.id as user_id
    FROM short_videos v
    JOIN users u ON v.user_id = u.id
    WHERE v.id = $1 AND v.is_active = true
  `,
			[id],
		);

		if (videoResult.rows.length === 0) {
			return c.json({ error: "Video not found" }, 404);
		}

		const video = videoResult.rows[0];

		// Get featured products if any
		if (video.product_ids && video.product_ids.length > 0) {
			const productsResult = await query(
				"SELECT id, name, price, images FROM products WHERE id = ANY($1)",
				[video.product_ids],
			);
			video.products = productsResult.rows;
		}

		// Increment view count
		await query(
			"UPDATE short_videos SET view_count = view_count + 1 WHERE id = $1",
			[id],
		);

		// Track view in Cassandra
		await executeQuery(
			"INSERT INTO video_views (video_id, user_id, event_type, timestamp) VALUES (?, ?, ?, ?)",
			[id, c.get("user").id || "anonymous", "view", new Date()],
		);

		return c.json(video);
	}),
);

// Upload video
videoRoutes.post(
	"/",
	authenticateToken,
	uploadMiddleware({
		maxFileSize: 100 * 1024 * 1024, // 100MB limit
		accept: ["video/*"],
		fieldName: "video",
		required: true,
	}),
	validateRequest({ body: createVideoSchema }),
	asyncHandler(async (c) => {
		const file = getFile(c, "video");
		if (!file) {
			return c.json({ error: "Video file is required" }, 400);
		}

		const { title, description, tags, productIds } = c.get("body") || {};
		const userId = c.get("user").id;

		try {
			// Read file into buffer
			const buffer = await file.arrayBuffer();

			// Upload original video to Cloudinary
			const videoUpload = (await new Promise((resolve, reject) => {
				cloudinary.uploader
					.upload_stream(
						{
							resource_type: "video",
							folder: "original_videos",
							transformation: [{ quality: "auto" }, { format: "mp4" }],
						},
						(error, result) => {
							if (error) reject(error);
							else resolve(result);
						},
					)
					.end(Buffer.from(buffer));
			})) as any;

			// Generate initial thumbnail from Cloudinary
			const thumbnailUrl = cloudinary.url(videoUpload.public_id, {
				resource_type: "video",
				format: "jpg",
				transformation: [
					{ width: 320, height: 180, crop: "fill" },
					{ quality: "auto" },
				],
			});

			// Save video to database
			const videoResult = await query(
				`
		INSERT INTO short_videos (
		  user_id, title, description, video_url, thumbnail_url,
		  duration, tags, product_ids, cloudinary_id, processing_status,
		  original_size
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING *
	  `,
				[
					userId,
					title,
					description,
					videoUpload.secure_url,
					thumbnailUrl,
					videoUpload.duration || 0,
					tags || [],
					productIds || [],
					videoUpload.public_id,
					"pending",
					videoUpload.bytes || 0,
				],
			);

			const video = videoResult.rows[0];

			// Queue video for processing
			await queueVideoProcessing(video.id, videoUpload.secure_url, {
				generateThumbnails: true,
				thumbnailCount: 5,
				formats: ["360p", "720p", "1080p"],
				maxDuration: 300, // 5 minutes max
				watermark: {
					text: "YourPlatform",
					position: "bottom-right",
				},
			});

			return c.json(
				{
					message: "Video uploaded successfully and queued for processing",
					video: {
						...video,
						processingStatus: "pending",
					},
				},
				201,
			);
		} catch (error) {
			logger.error("Video upload error:", error);
			return c.json({ error: "Failed to upload video" }, 500);
		}
	}),
);

// Like video
videoRoutes.post(
	"/:id/like",
	authenticateToken,
	asyncHandler(async (c) => {
		const { id } = c.req.param();
		const userId = c.get("userId");

		// Check if video exists
		const videoResult = await query(
			"SELECT id FROM short_videos WHERE id = $1 AND is_active = true",
			[id],
		);

		if (videoResult.rows.length === 0) {
			return c.json({ error: "Video not found" }, 404);
		}

		// Check if already liked
		const existingLike = await query(
			"SELECT id FROM video_likes WHERE video_id = $1 AND user_id = $2",
			[id, userId],
		);

		if (existingLike.rows.length > 0) {
			// Unlike
			await query(
				"DELETE FROM video_likes WHERE video_id = $1 AND user_id = $2",
				[id, userId],
			);
			await query(
				"UPDATE short_videos SET like_count = like_count - 1 WHERE id = $1",
				[id],
			);

			return c.json({ message: "Video unliked", liked: false });
		} else {
			// Like
			await query(
				"INSERT INTO video_likes (video_id, user_id) VALUES ($1, $2)",
				[id, userId],
			);
			await query(
				"UPDATE short_videos SET like_count = like_count + 1 WHERE id = $1",
				[id],
			);

			// Track like in Cassandra
			await executeQuery(
				"INSERT INTO video_views (video_id, user_id, event_type, timestamp) VALUES (?, ?, ?, ?)",
				[id, userId, "like", new Date()],
			);

			return c.json({ message: "Video liked", liked: true });
		}
	}),
);

// Comment on video
videoRoutes.post(
	"/:id/comment",
	authenticateToken,
	asyncHandler(async (c) => {
		const { id } = c.req.param();
		const { comment } = await c.req.json();
		const userId = c.get("userId");

		if (!comment || comment.trim().length === 0) {
			return c.json({ error: "Comment is required" }, 400);
		}

		// Check if video exists
		const videoResult = await query(
			"SELECT id FROM short_videos WHERE id = $1 AND is_active = true",
			[id],
		);

		if (videoResult.rows.length === 0) {
			return c.json({ error: "Video not found" }, 404);
		}

		// Add comment
		const commentResult = await query(
			`
	  INSERT INTO video_comments (video_id, user_id, comment)
	  VALUES ($1, $2, $3)
	  RETURNING *
	`,
			[id, userId, comment.trim()],
		);

		// Update comment count
		await query(
			"UPDATE short_videos SET comment_count = comment_count + 1 WHERE id = $1",
			[id],
		);

		// Get user info for response
		const userResult = await query(
			"SELECT full_name FROM users WHERE id = $1",
			[userId],
		);

		const newComment = {
			...commentResult.rows[0],
			full_name: userResult.rows[0].full_name,
		};

		return c.json(
			{
				message: "Comment added successfully",
				comment: newComment,
			},
			201,
		);
	}),
);

// Get video comments
videoRoutes.get(
	"/:id/comments",
	asyncHandler(async (c) => {
		const { id } = c.req.param();
		const { page = "1", limit = "20" } = c.req.query();
		const pageNum = Number.parseInt(page);
		const limitNum = Number.parseInt(limit);
		const offset = (pageNum - 1) * limitNum;

		const commentsResult = await query(
			`
	  SELECT 
		c.*, 
		u.full_name,
	  FROM video_comments c
	  JOIN users u ON c.user_id = u.id
	  WHERE c.video_id = $1
	  ORDER BY c.created_at DESC
	  LIMIT $2 OFFSET $3
	`,
			[id, limitNum, offset],
		);

		const countResult = await query(
			"SELECT COUNT(*) as total FROM video_comments WHERE video_id = $1",
			[id],
		);

		const comments = commentsResult.rows;
		const total = Number.parseInt(countResult.rows[0].total);

		return c.json({
			comments,
			pagination: {
				page: pageNum,
				limit: limitNum,
				total,
				totalPages: Math.ceil(total / limitNum),
			},
		});
	}),
);

// Delete video (owner only)
videoRoutes.delete(
	"/:id",
	authenticateToken,
	asyncHandler(async (c) => {
		const { id } = c.req.param();
		const userId = c.get("userId");

		// Check if video belongs to user
		const videoResult = await query(
			"SELECT cloudinary_id FROM short_videos WHERE id = $1 AND user_id = $2",
			[id, userId],
		);

		if (videoResult.rows.length === 0) {
			return c.json({ error: "Video not found or access denied" }, 404);
		}

		const video = videoResult.rows[0];

		try {
			// Delete from Cloudinary
			if (video.cloudinary_id) {
				await cloudinary.uploader.destroy(video.cloudinary_id, {
					resource_type: "video",
				});
			}

			// Soft delete from database
			await query("UPDATE short_videos SET is_active = false WHERE id = $1", [
				id,
			]);

			return c.json({ message: "Video deleted successfully" });
		} catch (error) {
			logger.error("Video deletion error:", error);
			return c.json({ error: "Failed to delete video" }, 500);
		}
	}),
);

// Admin: Get video processing status
videoRoutes.get(
	"/admin/processing-status",
	authenticateToken,
	requireAdmin,
	asyncHandler(async (c) => {
		const statusResult = await query(
			`
	  SELECT 
		processing_status,
		COUNT(*) as count
	  FROM short_videos 
	  GROUP BY processing_status
	  ORDER BY processing_status
	`,
		);

		const recentFailures = await query(
			`
	  SELECT id, title, created_at, cloudinary_id
	  FROM short_videos 
	  WHERE processing_status = 'failed'
	  ORDER BY created_at DESC
	  LIMIT 10
	`,
		);

		const queueStatus = videoQueue.getQueueStatus();

		return c.json({
			statusBreakdown: statusResult.rows,
			recentFailures: recentFailures.rows,
			queueStatus,
		});
	}),
);

// Admin: Retry failed video processing
videoRoutes.post(
	"/admin/:id/retry-processing",
	authenticateToken,
	requireAdmin,
	asyncHandler(async (c) => {
		const { id } = c.req.param();

		const videoResult = await query(
			"SELECT id, video_url, processing_status FROM short_videos WHERE id = $1",
			[id],
		);

		if (videoResult.rows.length === 0) {
			return c.json({ error: "Video not found" }, 404);
		}

		const video = videoResult.rows[0];

		if (video.processing_status !== "failed") {
			return c.json({ error: "Video is not in failed state" }, 400);
		}

		// Reset status and queue for processing
		await query(
			"UPDATE short_videos SET processing_status = $1 WHERE id = $2",
			["pending", id],
		);

		await queueVideoProcessing(id, video.video_url, {
			generateThumbnails: true,
			thumbnailCount: 5,
			formats: ["360p", "720p", "1080p"],
		});

		return c.json({ message: "Video queued for reprocessing" });
	}),
);

// Get video processing details
videoRoutes.get(
	"/:id/processing",
	asyncHandler(async (c) => {
		const { id } = c.req.param();

		const videoResult = await query(
			`
	  SELECT 
		id, title, processing_status, processed_formats, thumbnails,
		metadata, original_size, created_at
	  FROM short_videos 
	  WHERE id = $1
	`,
			[id],
		);

		if (videoResult.rows.length === 0) {
			return c.json({ error: "Video not found" }, 404);
		}

		const video = videoResult.rows[0];

		return c.json({
			id: video.id,
			title: video.title,
			processingStatus: video.processing_status,
			formats: video.processed_formats || [],
			thumbnails: video.thumbnails || [],
			metadata: video.metadata || {},
			originalSize: video.original_size,
			createdAt: video.created_at,
		});
	}),
);
