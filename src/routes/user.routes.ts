import { Hono } from "hono";
import { executeQuery } from "../config/cassandra";
import { query } from "../config/postgresql";
import { deleteCache, getCache, setCache } from "../config/redis";
import { authenticateToken } from "../middleware/auth";
import { asyncHandler } from "../middleware/erroHandler";
import { validateRequest } from "../middleware/validation";
import {
	addressSchema,
	changePasswordSchema,
	updateProfileSchema,
} from "../schemas/user";
import { EmailService } from "../email/email.service";

export const userRouter = new Hono();
userRouter
	.get(
		"/profile",
		authenticateToken,
		asyncHandler(async (c) => {
			const userId = c.get("user").id;
			const cacheKey = `user_profile:${userId}`;
			const cachedProfile = await getCache(cacheKey);
			if (cachedProfile) {
				return c.json(cachedProfile);
			}
			const userResult = await query(
				`
    SELECT 
      id, email, full_name, phone, role, avatar,
      email_verified, created_at, last_login
    FROM users 
    WHERE id = $1
  `,
				[userId],
			);

			if (userResult.rows.length === 0) {
				return c.json({ error: "User not found" }, 404);
			}

			const user = userResult.rows[0];
			// Get user statistics
			const statsResult = await query(
				`
        SELECT 
          (SELECT COUNT(*) FROM orders WHERE user_id = $1) as total_orders,
          (SELECT COUNT(*) FROM wishlists WHERE user_id = $1) as wishlist_count,
          (SELECT COUNT(*) FROM reviews WHERE user_id = $1) as review_count
      `,
				[userId],
			);

			const stats = statsResult.rows[0];

			const profile = {
				...user,
				statistics: {
					totalOrders: Number.parseInt(stats.total_orders),
					wishlistCount: Number.parseInt(stats.wishlist_count),
					reviewCount: Number.parseInt(stats.review_count),
				},
			};

			// Cache for 10 minutes
			await setCache(cacheKey, profile, 600);

			return c.json(profile);
		}),
	)
	.put(
		"/profile",
		authenticateToken,
		validateRequest({ body: updateProfileSchema }),
		asyncHandler(async (c) => {
			const userId = await c.get("user").id;
			const updateData = await c.req.json();

			const updateFields = [];
			const updateValues = [];
			let paramIndex = 1;

			Object.entries(updateData).forEach(([key, value]) => {
				if (value !== undefined) {
					updateFields.push(`${key} = $${paramIndex}`);
					updateValues.push(value);
					paramIndex++;
				}
			});
			if (updateFields.length === 0) {
				return c.json({ error: "No fields to update" }, 400);
			}
			updateFields.push("updated_at = $" + paramIndex);
			updateValues.push(new Date());
			updateValues.push(userId);

			const updateQuery = `
    UPDATE users 
    SET ${updateFields.join(", ")}
    WHERE id = $${paramIndex + 1}
    RETURNING id, email, full_name, phone, avatar
  `;
			const result = await query(updateQuery, updateValues);
			const updatedUser = result.rows[0];

			// Clear cache
			await deleteCache(`user_profile:${userId}`);

			// Track activity
			await executeQuery(
				"INSERT INTO user_activities (user_id, timestamp, activity_type, entity_type, entity_id) VALUES (?, ?, ?, ?, ?)",
				[userId, new Date(), "profile_update", "user", userId],
			);

			return c.json({
				message: "Profile updated successfully",
				user: updatedUser,
			});
		}),
	);

// Change password
userRouter.put(
	"/change-password",
	authenticateToken,
	validateRequest({ body: changePasswordSchema }),
	asyncHandler(async (c) => {
		const userId = c.get("userId");
		const { currentPassword, newPassword } = await c.req.json();

		// Get current password
		const userResult = await query("SELECT password FROM users WHERE id = $1", [
			userId,
		]);

		if (userResult.rows.length === 0) {
			return c.json({ error: "User not found" }, 404);
		}

		const user = userResult.rows[0];

		// Verify current password
		const isValidPassword = await Bun.password.verify(
			currentPassword,
			user.password,
		);
		if (!isValidPassword) {
			return c.json({ error: "Current password is incorrect" }, 400);
		}

		// Hash new password
		const hashedPassword = await Bun.password.hash(newPassword);

		// Update password
		await query(
			"UPDATE users SET password = $1, updated_at = $2 WHERE id = $3",
			[hashedPassword, new Date(), userId],
		);

		// Send notification email
		const userInfo = await query(
			"SELECT email, full_name FROM users WHERE id = $1",
			[userId],
		);

		await EmailService.sendPasswordChangeConfirmationEmail(
			{
				name: userInfo.rows[0].full_name,
				email: userInfo.rows[0].email,
			}
		);

		return c.json({ message: "Password changed successfully" });
	}),
);

// Get user orders
userRouter.get(
	"/orders",
	authenticateToken,
	asyncHandler(async (c) => {
		const userId = c.get("userId");
		const { page = "1", limit = "10", status } = c.req.query();
		const pageNum = Number.parseInt(page);
		const limitNum = Number.parseInt(limit);
		const offset = (pageNum - 1) * limitNum;

		const whereConditions = ["o.user_id = $1"];
		const queryParams: any[] = [userId];
		let paramIndex = 2;

		if (status) {
			whereConditions.push(`o.status = $${paramIndex}`);
			queryParams.push(status);
			paramIndex++;
		}

		const whereClause = whereConditions.join(" AND ");

		const ordersResult = await query(
			`
    SELECT 
      o.id, o.order_number, o.status, o.total_amount, o.currency,
      o.payment_status, o.created_at, o.updated_at,
      COUNT(oi.id) as item_count
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    WHERE ${whereClause}
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `,
			[...queryParams, limitNum, offset],
		);

		const countResult = await query(
			`SELECT COUNT(*) as total FROM orders o WHERE ${whereClause}`,
			queryParams.slice(0, -2),
		);

		const orders = ordersResult.rows;
		const total = Number.parseInt(countResult.rows[0].total);

		return c.json({
			orders,
			pagination: {
				page: pageNum,
				limit: limitNum,
				total,
				totalPages: Math.ceil(total / limitNum),
			},
		});
	}),
);

// Get single order
userRouter.get(
	"/orders/:id",
	authenticateToken,
	asyncHandler(async (c) => {
		const userId = c.get("userId");
		const { id } = c.req.param();

		const orderResult = await query(
			`
    SELECT 
      o.*, 
      json_agg(
        json_build_object(
          'id', oi.id,
          'product_name', oi.product_name,
          'product_image', oi.product_image,
          'quantity', oi.quantity,
          'unit_price', oi.unit_price,
          'total_price', oi.total_price,
          'vendor_id', oi.vendor_id
        )
      ) as items
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    WHERE o.id = $1 AND o.user_id = $2
    GROUP BY o.id
  `,
			[id, userId],
		);

		if (orderResult.rows.length === 0) {
			return c.json({ error: "Order not found" }, 404);
		}

		const order = orderResult.rows[0];
		return c.json(order);
	}),
);

// Get user addresses
userRouter.get(
	"/addresses",
	authenticateToken,
	asyncHandler(async (c) => {
		const userId = c.get("userId");

		const addressesResult = await query(
			`
    SELECT * FROM addresses 
    WHERE user_id = $1 
    ORDER BY is_default DESC, created_at DESC
  `,
			[userId],
		);

		return c.json({ addresses: addressesResult.rows });
	}),
);

// Add new address
userRouter.post(
	"/addresses",
	authenticateToken,
	validateRequest({ body: addressSchema }),
	asyncHandler(async (c) => {
		const userId = c.get("userId");
		const addressData = await c.req.json();

		// If this is set as default, unset other defaults
		if (addressData.isDefault) {
			await query(
				"UPDATE addresses SET is_default = false WHERE user_id = $1 AND type = $2",
				[userId, addressData.type],
			);
		}

		const addressResult = await query(
			`
    INSERT INTO addresses (
      user_id, type, full_name, company, address_line_1,
      address_line_2, city, state, postal_code, country, phone, is_default
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `,
			[
				userId,
				addressData.type,
				addressData.full_name,
				addressData.company,
				addressData.addressLine1,
				addressData.addressLine2,
				addressData.city,
				addressData.state,
				addressData.postalCode,
				addressData.country,
				addressData.phone,
				addressData.isDefault,
			],
		);

		return c.json(
			{
				message: "Address added successfully",
				address: addressResult.rows[0],
			},
			201,
		);
	}),
);

// Update address
userRouter.put(
	"/addresses/:id",
	authenticateToken,
	validateRequest({ body: addressSchema.partial() }),
	asyncHandler(async (c) => {
		const userId = c.get("userId");
		const { id } = c.req.param();
		const updateData = await c.req.json();

		// Check if address belongs to user
		const existingAddress = await query(
			"SELECT id, type FROM addresses WHERE id = $1 AND user_id = $2",
			[id, userId],
		);

		if (existingAddress.rows.length === 0) {
			return c.json({ error: "Address not found" }, 404);
		}

		// If setting as default, unset other defaults
		if (updateData.isDefault) {
			await query(
				"UPDATE addresses SET is_default = false WHERE user_id = $1 AND type = $2",
				[userId, existingAddress.rows[0].type],
			);
		}

		// Build update query
		const updateFields: string[] = [];
		const updateValues = [];
		let paramIndex = 1;

		Object.entries(updateData).forEach(([key, value]) => {
			if (value !== undefined) {
				const dbField = key.replace(/([A-Z])/g, "_$1").toLowerCase();
				updateFields.push(`${dbField} = $${paramIndex}`);
				updateValues.push(value);
				paramIndex++;
			}
		});

		if (updateFields.length === 0) {
			return c.json({ error: "No valid fields to update" }, 400);
		}

		updateValues.push(id);

		const updateQuery = `
    UPDATE addresses 
    SET ${updateFields.join(", ")}
    WHERE id = $${paramIndex}
    RETURNING *
  `;

		const result = await query(updateQuery, updateValues);

		return c.json({
			message: "Address updated successfully",
			address: result.rows[0],
		});
	}),
);

// Delete address
userRouter.delete(
	"/addresses/:id",
	authenticateToken,
	asyncHandler(async (c) => {
		const userId = c.get("userId");
		const { id } = c.req.param();

		// Check if address belongs to user
		const existingAddress = await query(
			"SELECT id FROM addresses WHERE id = $1 AND user_id = $2",
			[id, userId],
		);

		if (existingAddress.rows.length === 0) {
			return c.json({ error: "Address not found" }, 404);
		}

		await query("DELETE FROM addresses WHERE id = $1", [id]);

		return c.json({ message: "Address deleted successfully" });
	}),
);

// Get user wishlist
userRouter.get(
	"/wishlist",
	authenticateToken,
	asyncHandler(async (c) => {
		const userId = c.get("userId");
		const { page = "1", limit = "20" } = c.req.query();
		const pageNum = Number.parseInt(page);
		const limitNum = Number.parseInt(limit);
		const offset = (pageNum - 1) * limitNum;

		const wishlistResult = await query(
			`
    SELECT 
      w.id as wishlist_id, w.created_at as added_at,
      p.id, p.name, p.price, p.images, p.rating, p.inventory,
      v.business_name as vendor_name
    FROM wishlists w
    JOIN products p ON w.product_id = p.id
    JOIN vendors v ON p.vendor_id = v.id
    WHERE w.user_id = $1 AND p.is_active = true
    ORDER BY w.created_at DESC
    LIMIT $2 OFFSET $3
  `,
			[userId, limitNum, offset],
		);

		const countResult = await query(
			"SELECT COUNT(*) as total FROM wishlists WHERE user_id = $1",
			[userId],
		);

		const wishlist = wishlistResult.rows;
		const total = Number.parseInt(countResult.rows[0].total);

		return c.json({
			wishlist,
			pagination: {
				page: pageNum,
				limit: limitNum,
				total,
				totalPages: Math.ceil(total / limitNum),
			},
		});
	}),
);

// Add to wishlist
userRouter.post(
	"/wishlist/:productId",
	authenticateToken,
	asyncHandler(async (c) => {
		const userId = c.get("userId");
		const { productId } = c.req.param();

		// Check if product exists
		const productResult = await query(
			"SELECT id FROM products WHERE id = $1 AND is_active = true",
			[productId],
		);

		if (productResult.rows.length === 0) {
			return c.json({ error: "Product not found" }, 404);
		}

		// Check if already in wishlist
		const existingWishlist = await query(
			"SELECT id FROM wishlists WHERE user_id = $1 AND product_id = $2",
			[userId, productId],
		);

		if (existingWishlist.rows.length > 0) {
			return c.json({ error: "Product already in wishlist" }, 409);
		}

		// Add to wishlist
		await query("INSERT INTO wishlists (user_id, product_id) VALUES ($1, $2)", [
			userId,
			productId,
		]);

		return c.json({ message: "Product added to wishlist" }, 201);
	}),
);

// Remove from wishlist
userRouter.delete(
	"/wishlist/:productId",
	authenticateToken,
	asyncHandler(async (c) => {
		const userId = c.get("userId");
		const { productId } = c.req.param();

		const result = await query(
			"DELETE FROM wishlists WHERE user_id = $1 AND product_id = $2",
			[userId, productId],
		);

		if (result.rowCount === 0) {
			return c.json({ error: "Product not found in wishlist" }, 404);
		}

		return c.json({ message: "Product removed from wishlist" });
	}),
);

// Follow vendor
userRouter.post(
	"/follow/:vendorId",
	authenticateToken,
	asyncHandler(async (c) => {
		const userId = c.get("userId");
		const { vendorId } = c.req.param();

		// Check if vendor exists
		const vendorResult = await query(
			"SELECT id FROM vendors WHERE id = $1 FOR UPDATE",
			[vendorId],
		);

		if (vendorResult.rows.length === 0) {
			await query("ROLLBACK");
			return c.json({ error: "Vendor not found" }, 404);
		}

		// Check if already following
		const existingFollow = await query(
			"SELECT id FROM vendor_followers WHERE user_id = $1 AND vendor_id = $2",
			[userId, vendorId],
		);

		if (existingFollow.rows.length > 0) {
			// Unfollow
			await query(
				"DELETE FROM vendor_followers WHERE user_id = $1 AND vendor_id = $2",
				[userId, vendorId],
			);

			// Recalculate follower count from actual data
			const countResult = await query(
				"SELECT COUNT(*) as count FROM vendor_followers WHERE vendor_id = $1",
				[vendorId],
			);

			await query("UPDATE vendors SET follower_count = $1 WHERE id = $2", [
				parseInt(countResult.rows[0].count),
				vendorId,
			]);

			await query("COMMIT");
			return c.json({ message: "Vendor unfollowed", following: false });
		} else {
			// Follow
			await query(
				"INSERT INTO vendor_followers (user_id, vendor_id) VALUES ($1, $2)",
				[userId, vendorId],
			);

			// Recalculate follower count from actual data
			const countResult = await query(
				"SELECT COUNT(*) as count FROM vendor_followers WHERE vendor_id = $1",
				[vendorId],
			);

			await query("UPDATE vendors SET follower_count = $1 WHERE id = $2", [
				parseInt(countResult.rows[0].count),
				vendorId,
			]);

			await query("COMMIT");
			return c.json({ message: "Vendor followed", following: true });
		}
	}),
);

// Get user notifications
userRouter.get(
	"/notifications",
	authenticateToken,
	asyncHandler(async (c) => {
		const userId = c.get("userId");
		const { page = "1", limit = "20" } = c.req.query();
		const pageNum = Number.parseInt(page);
		const limitNum = Number.parseInt(limit);
		const offset = (pageNum - 1) * limitNum;

		const notificationsResult = await query(
			`
    SELECT * FROM notifications 
    WHERE user_id = $1 
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `,
			[userId, limitNum, offset],
		);

		const countResult = await query(
			"SELECT COUNT(*) as total FROM notifications WHERE user_id = $1",
			[userId],
		);

		const notifications = notificationsResult.rows;
		const total = Number.parseInt(countResult.rows[0].total);
		const unreadCount = notifications.filter(
			(notification: { is_read: boolean }) => !notification.is_read,
		).length;

		return c.json({
			notifications,
			unreadCount,
			pagination: {
				page: pageNum,
				limit: limitNum,
				total,
				totalPages: Math.ceil(total / limitNum),
			},
		});
	}),
);

// Mark notification as read
userRouter.put(
	"/notifications/:id/read",
	authenticateToken,
	asyncHandler(async (c) => {
		const userId = c.get("userId");
		const { id } = c.req.param();

		const result = await query(
			"UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2",
			[id, userId],
		);

		if (result.rowCount === 0) {
			return c.json({ error: "Notification not found" }, 404);
		}

		return c.json({ message: "Notification marked as read" });
	}),
);

// Mark all notifications as read
userRouter.put(
	"/notifications/read-all",
	authenticateToken,
	asyncHandler(async (c) => {
		const userId = c.get("userId");

		await query(
			"UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false",
			[userId],
		);

		return c.json({ message: "All notifications marked as read" });
	}),
);

// Get user activity history
userRouter.get(
	"/activity",
	authenticateToken,
	asyncHandler(async (c) => {
		const userId = c.get("userId");
		const { page = "1", limit = "20" } = c.req.query();
		const limitNum = Number.parseInt(limit);

		try {
			const activities = await executeQuery(
				"SELECT * FROM user_activities WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?",
				[userId, limitNum],
			);

			return c.json({
				activities: activities.rows,
				pagination: {
					page: Number.parseInt(page),
					limit: limitNum,
					hasMore: activities.rows.length === limitNum,
				},
			});
		} catch (error) {
			return c.json({
				activities: [],
				pagination: {
					page: Number.parseInt(page),
					limit: limitNum,
					hasMore: false,
				},
			});
		}
	}),
);
