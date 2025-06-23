import { Hono } from "hono";
import uploadMiddleware from "hono-upload";
import { query } from "../config/postgresql";
import { executeQuery } from "../config/cassandra";
import { authenticateToken, requireVendor } from "../middleware/auth";
import { validateRequest } from "../middleware/validation";
import { asyncHandler } from "../middleware/erroHandler";
import { createId } from "@paralleldrive/cuid2";
import { createVideoSchema, videoQuerySchema } from "../schemas/user";
import { cloudinary, CloudinaryUploadResult } from "../config/cloudinary";
import { queueVideoProcessing } from "../utils/videoQueue";
import { logger } from "../utils/logger";
import { HTTPException } from "hono/http-exception";
import { validateVideoFile } from "../utils/opt";

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
      u.first_name, u.last_name, u.id as user_id
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
      u.first_name, u.last_name, u.id as user_id
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
