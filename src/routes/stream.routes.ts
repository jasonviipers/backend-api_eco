import { createId } from "@paralleldrive/cuid2";
import { Hono } from "hono";
import { executeQuery } from "../config/cassandra";
import { query } from "../config/postgresql";
import { getCache, setCache } from "../config/redis";
import { authenticateToken, requireVendor } from "../middleware/auth";
import { asyncHandler } from "../middleware/erroHandler";
import { validateRequest } from "../middleware/validation";
import { createStreamSchema, updateStreamSchema } from "../schemas/user";

const streamRouter = new Hono();
streamRouter.get(
	"/",
	asyncHandler(async (c) => {
		const { page = "1", limit = "20", status = "live" } = c.req.query();
		const pageNum = Number.parseInt(page);
		const limitNum = Number.parseInt(limit);
		const offset = (pageNum - 1) * limitNum;

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
			[status, limitNum, offset],
		);

		const countResult = await query(
			"SELECT COUNT(*) as total FROM live_streams WHERE status = $1",
			[status],
		);

		const streams = streamsResult.rows;
		const total = Number.parseInt(countResult.rows[0].total);

		return c.json({
			streams,
			pagination: {
				page: pageNum,
				limit: limitNum,
				total,
				totalPages: Math.ceil(total / limitNum),
			},
		});
	}),
);
streamRouter.get(
	"/:id",
	asyncHandler(async (c) => {
		const { id } = c.req.param();

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
		);

		if (streamResult.rows.length === 0) {
			return c.json({ error: "Stream not found" }, 404);
		}

		const stream = streamResult.rows[0];

		// Get featured products
		if (stream.product_ids && stream.product_ids.length > 0) {
			const productsResult = await query(
				"SELECT id, name, price, images FROM products WHERE id = ANY($1)",
				[stream.product_ids],
			);
			stream.products = productsResult.rows;
		}

		return c.json(stream);
	}),
);

streamRouter.post(
	"/",
	authenticateToken,
	requireVendor,
	validateRequest({ body: createStreamSchema }),
	asyncHandler(async (c) => {
		const streamData = await c.req.json();
		const vendorId = c.get("vendorId");
		const streamKey = createId();

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
		);

		const stream = streamResult.rows[0];

		return c.json(
			{
				message: "Stream created successfully",
				stream: {
					...stream,
					rtmpUrl: `rtmp://localhost:1935/live/${streamKey}`,
					streamKey: streamKey,
				},
			},
			201,
		);
	}),
);

streamRouter.put(
	"/:id",
	authenticateToken,
	requireVendor,
	validateRequest({ body: updateStreamSchema }),
	asyncHandler(async (c) => {
		const { id } = c.req.param();
		const updateData = await c.req.json();
		const vendorId = c.get("vendorId");

		// Check if stream belongs to vendor
		const existingStream = await query(
			"SELECT id FROM live_streams WHERE id = $1 AND vendor_id = $2",
			[id, vendorId],
		);

		if (existingStream.rows.length === 0) {
			return c.json({ error: "Stream not found or access denied" }, 404);
		}

		// Build update query
		const updateFields = [];
		const updateValues = [];
		let paramIndex = 1;

		Object.entries(updateData).forEach(([key, value]) => {
			if (value !== undefined) {
				if (key === "productIds") {
					updateFields.push(`product_ids = $${paramIndex}`);
					updateValues.push(value);
				} else if (key === "scheduledFor") {
					updateFields.push(`scheduled_for = $${paramIndex}`);
					updateValues.push(new Date(value as string));
				} else {
					updateFields.push(
						`${key.replace(/([A-Z])/g, "_$1").toLowerCase()} = $${paramIndex}`,
					);
					updateValues.push(value);
				}
				paramIndex++;
			}
		});

		if (updateFields.length === 0) {
			return c.json({ error: "No valid fields to update" }, 400);
		}

		updateFields.push("updated_at = $" + paramIndex);
		updateValues.push(new Date());
		updateValues.push(id);

		const updateQuery = `
            UPDATE live_streams 
            SET ${updateFields.join(", ")}
            WHERE id = $${paramIndex + 1}
            RETURNING *
        `;

		const result = await query(updateQuery, updateValues);
		const updatedStream = result.rows[0];

		return c.json({
			message: "Stream updated successfully",
			stream: updatedStream,
		});
	}),
);

streamRouter.put(
	"/:id/start",
	authenticateToken,
	requireVendor,
	asyncHandler(async (c) => {
		const { id } = c.req.param();
		const vendorId = c.get("vendorId");

		// Check if stream belongs to vendor
		const streamResult = await query(
			"SELECT id, status FROM live_streams WHERE id = $1 AND vendor_id = $2",
			[id, vendorId],
		);

		if (streamResult.rows.length === 0) {
			return c.json({ error: "Stream not found or access denied" }, 404);
		}

		const stream = streamResult.rows[0];

		if (stream.status === "live") {
			return c.json({ error: "Stream is already live" }, 400);
		}

		// Update stream status
		await query(
			"UPDATE live_streams SET status = $1, started_at = $2 WHERE id = $3",
			["live", new Date(), id],
		);

		return c.json({ message: "Stream started successfully" });
	}),
);

streamRouter.put(
	"/:id/end",
	authenticateToken,
	requireVendor,
	asyncHandler(async (c) => {
		const { id } = c.req.param();
		const vendorId = c.get("vendorId");

		// Check if stream belongs to vendor
		const streamResult = await query(
			"SELECT id, status FROM live_streams WHERE id = $1 AND vendor_id = $2",
			[id, vendorId],
		);

		if (streamResult.rows.length === 0) {
			return c.json({ error: "Stream not found or access denied" }, 404);
		}

		const stream = streamResult.rows[0];

		if (stream.status !== "live") {
			return c.json({ error: "Stream is not currently live" }, 400);
		}

		// Update stream status
		await query(
			"UPDATE live_streams SET status = $1, ended_at = $2 WHERE id = $3",
			["ended", new Date(), id],
		);

		return c.json({ message: "Stream ended successfully" });
	}),
);

streamRouter.get(
	"/:id/analytics",
	authenticateToken,
	requireVendor,
	asyncHandler(async (c) => {
		const { id } = c.req.param();
		const vendorId = c.get("vendorId");

		// Check if stream belongs to vendor
		const streamResult = await query(
			"SELECT id FROM live_streams WHERE id = $1 AND vendor_id = $2",
			[id, vendorId],
		);

		if (streamResult.rows.length === 0) {
			return c.json({ error: "Stream not found or access denied" }, 404);
		}

		// Get analytics from Cassandra
		const viewerAnalytics = await executeQuery(
			"SELECT COUNT(*) as total_viewers FROM stream_analytics WHERE stream_id = ? AND event_type = ?",
			[id, "viewer_joined"],
		);

		const peakViewers = await executeQuery(
			"SELECT MAX(concurrent_viewers) as peak_viewers FROM stream_analytics WHERE stream_id = ?",
			[id],
		);

		const chatMessages = await executeQuery(
			"SELECT COUNT(*) as total_messages FROM chat_messages WHERE stream_id = ?",
			[id],
		);

		const analytics = {
			totalViewers: viewerAnalytics.rows[0]?.total_viewers || 0,
			peakViewers: peakViewers.rows[0]?.peak_viewers || 0,
			totalMessages: chatMessages.rows[0]?.total_messages || 0,
		};

		return c.json(analytics);
	}),
);

streamRouter.get(
	"/:id/chat",
	asyncHandler(async (c) => {
		const { id } = c.req.param();
		const { limit = "50" } = c.req.query();
		const limitNum = Number.parseInt(limit);

		const messages = await executeQuery(
			"SELECT * FROM chat_messages WHERE stream_id = ? ORDER BY timestamp DESC LIMIT ?",
			[id, limitNum],
		);

		return c.json({
			messages: messages.rows.reverse(),
		});
	}),
);

export default streamRouter;
