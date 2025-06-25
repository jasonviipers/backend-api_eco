import { Hono } from "hono";
import { cloudinary } from "../config/cloudinary";
import { query } from "../config/postgresql";
import { executeQuery } from "../config/cassandra";
import { setCache, getCache, deleteCache } from "../config/redis";
import {
	authenticateToken,
	requireVendor,
	requireAdmin,
} from "../middleware/auth";
import { validateRequest } from "../middleware/validation";
import {
	updateVendorSchema,
	vendorQuerySchema,
	vendorRegistrationSchema,
} from "../schemas/vendor";
import { asyncHandler } from "../middleware/erroHandler";
import { getFile, uploadMiddleware } from "../utils/hono-upload";
import { EmailService } from "../email/email.service";

export const vendorRouter = new Hono();

vendorRouter.post(
	"/register",
	authenticateToken,
	validateRequest({ body: vendorRegistrationSchema }),
	asyncHandler(async (c) => {
		const userId = await c.get("user").id;
		const vendorData = await c.req.json();

		// Check if user is already a vendor
		const existingVendor = await query(
			"SELECT id FROM vendors WHERE user_id = $1",
			[userId],
		);

		if (existingVendor.rows.length > 0) {
			return c.json({ error: "User is already registered as a vendor" }, 409);
		}

		// Check if user role is customer (needs to be updated to vendor)
		if (c.get("userRole") === "customer") {
			await query("UPDATE users SET role = $1 WHERE id = $2", [
				"vendor",
				userId,
			]);
		}

		// Create vendor profile
		const vendorResult = await query(
			`
      INSERT INTO vendors (
        user_id, business_name, description, business_address, business_phone,
        business_email, tax_id, business_type, website, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `,
			[
				userId,
				vendorData.businessName,
				vendorData.description,
				vendorData.businessAddress,
				vendorData.businessPhone,
				vendorData.businessEmail,
				vendorData.taxId,
				vendorData.businessType,
				vendorData.website,
				"pending",
			],
		);

		const vendor = vendorResult.rows[0];

		// Send notification to admin
		await query(
			`
    INSERT INTO notifications (user_id, type, title, message, data)
    SELECT id, 'vendor_registration', 'New Vendor Registration', 
           'A new vendor has registered and is pending approval', 
           $1
    FROM users WHERE role = 'admin'
  `,
			[
				JSON.stringify({
					vendorId: vendor.id,
					businessName: vendorData.businessName,
				}),
			],
		);

		await EmailService.sendVendorRegistrationConfirmation({
			name: c.get("user").full_name,
			email: vendorData.businessEmail,
			businessName: vendorData.businessName,
		});
		return c.json(
			{
				message:
					"Vendor registration submitted successfully. Awaiting approval.",
				vendor: {
					id: vendor.id,
					businessName: vendor.business_name,
					status: vendor.status,
				},
			},
			201,
		);
	}),
);

// Get vendors list (public)
vendorRouter.get(
	"/",
	validateRequest({ query: vendorQuerySchema }),
	asyncHandler(async (c) => {
		const {
			page = "1",
			limit = "10",
			status,
			search,
			sortBy = "created_at",
			sortOrder = "desc",
		} = c.req.query();
		const offset = (Number(page) - 1) * Number(limit);

		// Build cache key
		const cacheKey = `vendors:${JSON.stringify(c.req.query())}`;
		const cachedResult = await getCache(cacheKey);
		if (cachedResult) {
			return c.json(cachedResult);
		}

		const whereConditions = ["v.status = 'approved'"]; // Only show approved vendors publicly
		const queryParams: any[] = [];
		let paramIndex = 1;

		if (status && c.get("userRole") === "admin") {
			whereConditions[0] = "v.status = $1";
			queryParams.push(status);
			paramIndex++;
		}

		if (search) {
			whereConditions.push(
				`(v.business_name ILIKE $${paramIndex} OR v.description ILIKE $${paramIndex})`,
			);
			queryParams.push(`%${search}%`);
			paramIndex++;
		}

		const whereClause =
			whereConditions.length > 0
				? `WHERE ${whereConditions.join(" AND ")}`
				: "";

		const orderByClause = `ORDER BY v.${sortBy} ${sortOrder.toUpperCase()}`;

		const vendorsResult = await query(
			`
      SELECT 
        v.id, v.business_name, v.description, v.logo_url, v.rating,
        v.total_sales, v.follower_count, v.created_at,
        u.full_name, u.email,
      FROM vendors v
      JOIN users u ON v.user_id = u.id
      ${whereClause}
      ${orderByClause}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `,
			[...queryParams, limit, offset],
		);

		const countResult = await query(
			`
      SELECT COUNT(*) as total
      FROM vendors v
      JOIN users u ON v.user_id = u.id
      ${whereClause}
    `,
			queryParams,
		);

		const vendors = vendorsResult.rows;
		const total = Number.parseInt(countResult.rows[0].total);

		const result = {
			vendors,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / Number(limit)),
			},
		};

		// Cache for 5 minutes
		await setCache(cacheKey, result, 300);

		return c.json(result);
	}),
);

// Get single vendor profile
vendorRouter.get(
	"/:id",
	asyncHandler(async (c) => {
		const { id } = c.req.param();

		const cacheKey = `vendor:${id}`;
		const cachedVendor = await getCache(cacheKey);
		if (cachedVendor) {
			return c.json(cachedVendor);
		}

		const vendorResult = await query(
			`
      SELECT 
        v.*, 
        u.full_name, u.email
      FROM vendors v
      JOIN users u ON v.user_id = u.id
      WHERE v.id = $1 AND v.status = 'approved'
    `,
			[id],
		);

		if (vendorResult.rows.length === 0) {
			return c.json({ error: "Vendor not found" }, 404);
		}

		const vendor = vendorResult.rows[0];

		// Get vendor statistics
		const statsResult = await query(
			`
      SELECT 
        COUNT(DISTINCT p.id) as product_count,
        COUNT(DISTINCT o.id) as order_count,
        COALESCE(AVG(r.rating), 0) as avg_rating,
        COUNT(DISTINCT r.id) as review_count
      FROM vendors v
      LEFT JOIN products p ON v.id = p.vendor_id AND p.is_active = true
      LEFT JOIN order_items oi ON v.id = oi.vendor_id
      LEFT JOIN orders o ON oi.order_id = o.id
      LEFT JOIN reviews r ON p.id = r.product_id
      WHERE v.id = $1
    `,
			[id],
		);

		const stats = statsResult.rows[0];

		vendor.statistics = {
			productCount: Number.parseInt(stats.product_count),
			orderCount: Number.parseInt(stats.order_count),
			avgRating: Number.parseFloat(stats.avg_rating),
			reviewCount: Number.parseInt(stats.review_count),
		};

		// Cache for 10 minutes
		await setCache(cacheKey, vendor, 600);

		return c.json(vendor);
	}),
);

// Get vendor dashboard (vendor only)
vendorRouter.get(
	"/dashboard/overview",
	authenticateToken,
	requireVendor,
	asyncHandler(async (c) => {
		const vendorId = c.get("vendorId");

		const cacheKey = `vendor_dashboard:${vendorId}`;
		const cachedDashboard = await getCache(cacheKey);
		if (cachedDashboard) {
			return c.json(cachedDashboard);
		}

		// Get basic statistics
		const statsResult = await query(
			`
      SELECT 
        COUNT(DISTINCT p.id) as total_products,
        COUNT(DISTINCT CASE WHEN p.is_active THEN p.id END) as active_products,
        COUNT(DISTINCT oi.order_id) as total_orders,
        COALESCE(SUM(oi.total_price), 0) as total_revenue,
        COALESCE(SUM(oi.commission_amount), 0) as total_commission,
        COUNT(DISTINCT ls.id) as total_streams,
        COUNT(DISTINCT CASE WHEN ls.status = 'live' THEN ls.id END) as live_streams
      FROM vendors v
      LEFT JOIN products p ON v.id = p.vendor_id
      LEFT JOIN order_items oi ON v.id = oi.vendor_id
      LEFT JOIN live_streams ls ON v.id = ls.vendor_id
      WHERE v.id = $1
    `,
			[vendorId],
		);

		const stats = statsResult.rows[0];

		// Get recent orders
		const recentOrdersResult = await query(
			`
      SELECT 
        o.id, o.order_number, o.status, o.total_amount, o.created_at,
        u.full_name
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN users u ON o.user_id = u.id
      WHERE oi.vendor_id = $1
      ORDER BY o.created_at DESC
      LIMIT 10
    `,
			[vendorId],
		);

		// Get top products
		const topProductsResult = await query(
			`
      SELECT 
        p.id, p.name, p.price, p.view_count, p.rating,
        COUNT(oi.id) as order_count,
        COALESCE(SUM(oi.quantity), 0) as total_sold
      FROM products p
      LEFT JOIN order_items oi ON p.id = oi.product_id
      WHERE p.vendor_id = $1 AND p.is_active = true
      GROUP BY p.id
      ORDER BY total_sold DESC, p.view_count DESC
      LIMIT 5
    `,
			[vendorId],
		);

		const dashboard = {
			statistics: {
				totalProducts: Number.parseInt(stats.total_products),
				activeProducts: Number.parseInt(stats.active_products),
				totalOrders: Number.parseInt(stats.total_orders),
				totalRevenue: Number.parseFloat(stats.total_revenue),
				totalCommission: Number.parseFloat(stats.total_commission),
				totalStreams: Number.parseInt(stats.total_streams),
				liveStreams: Number.parseInt(stats.live_streams),
			},
			recentOrders: recentOrdersResult.rows,
			topProducts: topProductsResult.rows,
		};

		// Cache for 5 minutes
		await setCache(cacheKey, dashboard, 300);

		return c.json(dashboard);
	}),
);

// Update vendor profile
vendorRouter.put(
	"/profile",
	authenticateToken,
	requireVendor,
	validateRequest({ body: updateVendorSchema }),
	asyncHandler(async (c) => {
		const vendorId = await c.get("vendorId");
		const updateData = await c.req.json();

		// Build update query
		const updateFields = [];
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

		updateFields.push("updated_at = $" + paramIndex);
		updateValues.push(new Date());
		updateValues.push(vendorId);

		const updateQuery = `
      UPDATE vendors 
      SET ${updateFields.join(", ")}
      WHERE id = $${paramIndex + 1}
      RETURNING *
    `;

		const result = await query(updateQuery, updateValues);
		const updatedVendor = result.rows[0];

		// Clear caches
		await Promise.all([
			deleteCache(`vendor:${vendorId}`),
			deleteCache(`vendor_dashboard:${vendorId}`),
		]);

		return c.json({
			message: "Vendor profile updated successfully",
			vendor: updatedVendor,
		});
	}),
);

// Upload vendor documents
vendorRouter.post(
	"/documents",
	authenticateToken,
	requireVendor,
	uploadMiddleware({
		maxFileSize: 10 * 1024 * 1024, // 10MB limit
		accept: ["image/*", "application/pdf"],
		maxFiles: 5,
		fieldName: "documents",
	}),
	asyncHandler(async (c) => {
		const vendorId = c.get("vendorId");
		const files = getFile(c, "documents");

		if (!files || !Array.isArray(files) || files.length === 0) {
			return c.json({ error: "No files uploaded" }, 400);
		}

		try {
			const uploadPromises = files.map((file) => {
				return new Promise((resolve, reject) => {
					cloudinary.uploader
						.upload_stream(
							{
								resource_type: "auto",
								folder: "vendor_documents",
								public_id: `${vendorId}_${Date.now()}_${file.name}`,
							},
							(error, result) => {
								if (error) reject(error);
								else resolve(result);
							},
						)
						.end(file.data);
				});
			});

			const uploadResults = (await Promise.all(uploadPromises)) as any[];

			// Save document URLs to database
			const documentUrls = uploadResults.map((result) => ({
				url: result.secure_url,
				publicId: result.public_id,
				originalName: result.original_filename,
				uploadedAt: new Date(),
			}));

			await query("UPDATE vendors SET documents = $1 WHERE id = $2", [
				JSON.stringify(documentUrls),
				vendorId,
			]);

			return c.json({
				message: "Documents uploaded successfully",
				documents: documentUrls,
			});
		} catch (error) {
			return c.json({ error: "Failed to upload documents" }, 500);
		}
	}),
);

// Get vendor analytics
// vendorRouter.get(
//     "/analytics/overview",
//     authenticateToken,
//     requireVendor,
//     asyncHandler(async (c) => {
//         const vendorId = c.get("vendorId");
//         const { days = "30" } = c.req.query();
//         const daysNum = Number.parseInt(days);

//         try {
//             // Get analytics from Cassandra
//             const endDate = new Date();
//             const startDate = new Date(
//                 endDate.getTime() - daysNum * 24 * 60 * 60 * 1000,
//             );

//             const analyticsResult = await executeQuery(
//                 `
//         SELECT date, total_sales, total_orders, total_views, avg_rating, commission_earned
//         FROM vendor_analytics
//         WHERE vendor_id = ? AND date >= ? AND date <= ?
//         ORDER BY date DESC
//       `,
//                 [vendorId, startDate, endDate],
//             );

//             const analytics = analyticsResult.rows;

//             // Calculate totals
//             const totals = analytics.reduce(
//                 (acc, row) => ({
//                     totalSales: acc.totalSales + (row.total_sales || 0),
//                     totalOrders: acc.totalOrders + (row.total_orders || 0),
//                     totalViews: acc.totalViews + (row.total_views || 0),
//                     totalCommission: acc.totalCommission + (row.commission_earned || 0),
//                 }),
//                 { totalSales: 0, totalOrders: 0, totalViews: 0, totalCommission: 0 },
//             );

//             return c.json({
//                 analytics,
//                 totals,
//                 period: {
//                     days: daysNum,
//                     startDate,
//                     endDate,
//                 },
//             });
//         } catch (error) {
//             // Fallback to PostgreSQL if Cassandra is not available
//             const fallbackResult = await query(
//                 `
//         SELECT
//           DATE(created_at) as date,
//           COUNT(*) as total_orders,
//           SUM(total_price) as total_sales,
//           SUM(commission_amount) as commission_earned
//         FROM order_items
//         WHERE vendor_id = $1 AND created_at >= $2
//         GROUP BY DATE(created_at)
//         ORDER BY date DESC
//       `,
//                 [vendorId, new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000)],
//             );

//             return c.json({
//                 analytics: fallbackResult.rows,
//                 totals: {
//                     totalSales: fallbackResult.rows.reduce(
//                         (sum, row) => sum + Number.parseFloat(row.total_sales || 0),
//                         0,
//                     ),
//                     totalOrders: fallbackResult.rows.reduce(
//                         (sum, row) => sum + Number.parseInt(row.total_orders || 0),
//                         0,
//                     ),
//                     totalViews: 0,
//                     totalCommission: fallbackResult.rows.reduce(
//                         (sum, row) => sum + Number.parseFloat(row.commission_earned || 0),
//                         0,
//                     ),
//                 },
//                 period: {
//                     days: daysNum,
//                     startDate: new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000),
//                     endDate: new Date(),
//                 },
//             });
//         }
//     }),
// );

// Request payout (vendor only)
vendorRouter.post(
	"/payout",
	authenticateToken,
	requireVendor,
	asyncHandler(async (c) => {
		const vendorId = c.get("vendorId");
		const { amount, paymentMethod } = await c.req.json();

		if (!amount || amount <= 0) {
			return c.json({ error: "Invalid payout amount" }, 400);
		}

		// Check vendor's available balance
		const balanceResult = await query(
			`
      SELECT 
        COALESCE(SUM(oi.commission_amount), 0) - COALESCE(
          (SELECT SUM(amount) FROM payouts WHERE vendor_id = $1 AND status IN ('pending', 'completed')), 0
        ) as available_balance
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE oi.vendor_id = $1 AND o.payment_status = 'completed'
    `,
			[vendorId],
		);

		const availableBalance = Number.parseFloat(
			balanceResult.rows[0].available_balance,
		);

		if (amount > availableBalance) {
			return c.json(
				{
					error: "Insufficient balance",
					availableBalance,
					requestedAmount: amount,
				},
				400,
			);
		}

		// Create payout request
		const payoutResult = await query(
			`
      INSERT INTO payouts (vendor_id, amount, payment_method, status)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
			[vendorId, amount, paymentMethod || "bank_transfer", "pending"],
		);

		const payout = payoutResult.rows[0];

		// Send notification to admin
		await query(
			`
      INSERT INTO notifications (user_id, type, title, message, data)
      SELECT id, 'payout_request', 'New Payout Request', 
             'A vendor has requested a payout', 
             $1
      FROM users WHERE role = 'admin'
    `,
			[JSON.stringify({ vendorId, amount, payoutId: payout.id })],
		);

		await EmailService.sendVendorPayoutNotification(
			{
				name: c.get("user").full_name,
				email: c.get("user").email,
			},
			{
				amount: payout.amount,
				status: payout.status,
				payoutId: payout.id,
			},
		);
		return c.json(
			{
				message: "Payout request submitted successfully",
				payout,
			},
			201,
		);
	}),
);

// Get vendor payouts
vendorRouter.get(
	"/payouts",
	authenticateToken,
	requireVendor,
	asyncHandler(async (c) => {
		const vendorId = c.get("vendorId");
		const { page = "1", limit = "20" } = c.req.query();
		const pageNum = Number.parseInt(page);
		const limitNum = Number.parseInt(limit);
		const offset = (pageNum - 1) * limitNum;

		const payoutsResult = await query(
			`
      SELECT * FROM payouts 
      WHERE vendor_id = $1 
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `,
			[vendorId, limitNum, offset],
		);

		const countResult = await query(
			"SELECT COUNT(*) as total FROM payouts WHERE vendor_id = $1",
			[vendorId],
		);

		const payouts = payoutsResult.rows;
		const total = Number.parseInt(countResult.rows[0].total);

		return c.json({
			payouts,
			pagination: {
				page: pageNum,
				limit: limitNum,
				total,
				totalPages: Math.ceil(total / limitNum),
			},
		});
	}),
);

// Admin: Approve/Reject vendor (admin only)
vendorRouter.put(
	"/:id/status",
	authenticateToken,
	requireAdmin,
	asyncHandler(async (c) => {
		const { id } = c.req.param();
		const { status, reason } = await c.req.json();

		if (!["approved", "rejected", "suspended"].includes(status)) {
			return c.json({ error: "Invalid status" }, 400);
		}

		// Update vendor status
		const result = await query(
			"UPDATE vendors SET status = $1, status_reason = $2, updated_at = $3 WHERE id = $4 RETURNING *",
			[status, reason, new Date(), id],
		);

		if (result.rows.length === 0) {
			return c.json({ error: "Vendor not found" }, 404);
		}

		const vendor = result.rows[0];

		// Get vendor user info for notification
		const userResult = await query(
			"SELECT email, full_name FROM users WHERE id = $1",
			[vendor.user_id],
		);
		const user = userResult.rows[0];

		// Send notification email
		const statusMessages = {
			approved: "Congratulations! Your vendor application has been approved.",
			rejected: "Unfortunately, your vendor application has been rejected.",
			suspended: "Your vendor account has been suspended.",
		};
		await EmailService.sendVendorStatusUpdate(
			{
				name: user.full_name,
				email: user.email,
				businessName: vendor.business_name,
			},
			status as "approved" | "rejected" | "suspended",
			reason,
		);

		// Create notification
		await query(
			"INSERT INTO notifications (user_id, type, title, message) VALUES ($1, $2, $3, $4)",
			[
				vendor.user_id,
				"vendor_status_update",
				`Vendor Application ${status}`,
				statusMessages[status as keyof typeof statusMessages],
			],
		);

		return c.json({
			message: `Vendor ${status} successfully`,
			vendor,
		});
	}),
);
