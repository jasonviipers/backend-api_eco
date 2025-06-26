import { Hono } from "hono";
import { query } from "../config/postgresql";
import { deleteCache } from "../config/redis";
import { authenticateToken, requireVendor } from "../middleware/auth";
import { asyncHandler } from "../middleware/erroHandler";
import { validateRequest } from "../middleware/validation";
import { getStripe } from "../config/stripe";
import { EmailService } from "../email/email.service";
import { logger } from "../utils/logger";
import {
	createOrderSchema,
	orderQuerySchema,
	updateOrderStatusSchema,
} from "../schemas/order";
import { getTrackingUrl } from "../utils/opt";
import { OrderItem, ProductRow, ShippingInfo, VendorOrderItem } from "../types";

export const orderRouter = new Hono();

// Create new order
orderRouter.post(
	"/",
	authenticateToken,
	validateRequest({ body: createOrderSchema }),
	asyncHandler(async (c) => {
		const userId = c.get("user").id;
		const orderData = await c.req.json();

		// Start transaction
		await query("BEGIN");

		try {
			// Validate products and calculate totals
			const productIds = orderData.items.map(
				(item: { productId: string }) => item.productId,
			);
			const productsResult = await query(
				`SELECT 
          p.id, p.name, p.price, p.inventory, 
          v.id as vendor_id, v.commission_rate
        FROM products p
        JOIN vendors v ON p.vendor_id = v.id
        WHERE p.id = ANY($1) AND p.is_active = true`,
				[productIds],
			);

			if (productsResult.rows.length !== productIds.length) {
				await query("ROLLBACK");
				return c.json({ error: "One or more products not found" }, 404);
			}

			const products = productsResult.rows as ProductRow[];
			const productsMap = new Map(products.map((p) => [p.id, p]));

			// Validate inventory and calculate totals
			let subtotal = 0;
			let taxAmount = 0;
			let shippingAmount = orderData.shippingAmount || 0;
			const orderItems: OrderItem[] = [];
			const vendorItems = new Map<string, VendorOrderItem[]>();

			for (const item of orderData.items) {
				const product = productsMap.get(item.productId);
				if (!product) {
					await query("ROLLBACK");
					return c.json({ error: `Product ${item.productId} not found` }, 404);
				}

				if (product.inventory < item.quantity) {
					await query("ROLLBACK");
					return c.json(
						{ error: `Insufficient inventory for product ${product.name}` },
						400,
					);
				}

				const itemTotal = product.price * item.quantity;
				subtotal += itemTotal;

				// Calculate commission (if any)
				const commissionRate = product.commission_rate || 0;
				const commissionAmount = itemTotal * (commissionRate / 100);

				// Group by vendor for order items
				if (!vendorItems.has(product.vendor_id)) {
					vendorItems.set(product.vendor_id, []);
				}

				vendorItems.get(product.vendor_id)?.push({
					productId: product.id,
					productName: product.name,
					quantity: item.quantity,
					unitPrice: product.price,
					totalPrice: itemTotal,
					commissionRate,
					commissionAmount,
				});

				orderItems.push({
					productId: product.id,
					productName: product.name,
					price: product.price,
					quantity: item.quantity,
					vendorId: product.vendor_id,
				});
			}

			// Calculate tax if provided
			if (orderData.taxRate) {
				taxAmount = subtotal * (orderData.taxRate / 100);
			}

			const totalAmount = subtotal + taxAmount + shippingAmount;

			// Generate order number
			const orderNumber = `ORD-${Date.now()}-${Math.floor(
				Math.random() * 1000,
			)}`;

			// Create order
			const orderResult = await query(
				`INSERT INTO orders (
          user_id, order_number, status, subtotal, tax_amount, 
          shipping_amount, total_amount, shipping_address, billing_address, 
          payment_method, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id, order_number, status, total_amount, created_at`,
				[
					userId,
					orderNumber,
					"pending",
					subtotal,
					taxAmount,
					shippingAmount,
					totalAmount,
					JSON.stringify(orderData.shippingAddress),
					JSON.stringify(orderData.billingAddress || orderData.shippingAddress),
					orderData.paymentMethod,
					orderData.notes,
				],
			);

			const order = orderResult.rows[0];

			// Create order items and update inventory
			for (const [vendorId, items] of vendorItems.entries()) {
				for (const item of items) {
					await query(
						`INSERT INTO order_items (
              order_id, product_id, vendor_id, product_name, 
              quantity, unit_price, total_price, 
              commission_rate, commission_amount
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
						[
							order.id,
							item.productId,
							vendorId,
							item.productName,
							item.quantity,
							item.unitPrice,
							item.totalPrice,
							item.commissionRate,
							item.commissionAmount,
						],
					);

					// Update product inventory
					await query(
						"UPDATE products SET inventory = inventory - $1 WHERE id = $2",
						[item.quantity, item.productId],
					);
				}
			}

			// Create payment record if payment method is provided
			if (orderData.paymentMethod && orderData.paymentMethod !== "cash") {
				await query(
					`INSERT INTO payments (
            order_id, amount, currency, payment_method, status
          ) VALUES ($1, $2, $3, $4, $5)`,
					[order.id, totalAmount, "USD", orderData.paymentMethod, "pending"],
				);
			}

			await query("COMMIT");

			// Clear any cached cart data
			await deleteCache(`user_cart:${userId}`);

			// Send order confirmation email
			await EmailService.sendOrderConfirmation(
				{
					name: c.get("user").full_name,
					email: c.get("user").email,
				},
				{
					orderNumber: order.order_number,
					total: Number(order.total_amount),
					items: orderItems.map((item) => ({
						product_name: item.productName,
						quantity: item.quantity,
						unit_price: item.price,
					})),
				},
			);

			return c.json(
				{
					message: "Order created successfully",
					order: {
						id: order.id,
						orderNumber: order.order_number,
						status: order.status,
						totalAmount: order.total_amount,
						createdAt: order.created_at,
					},
				},
				201,
			);
		} catch (error) {
			await query("ROLLBACK");
			logger.error("Order creation failed:", error);
			return c.json({ error: "Failed to create order" }, 500);
		}
	}),
);

// Get order details
orderRouter.get(
	"/:id",
	authenticateToken,
	asyncHandler(async (c) => {
		const orderId = c.req.param("id");
		const userId = c.get("user").id;
		const userRole = c.get("user").role;

		const orderResult = await query(
			`SELECT 
        o.*,
        json_agg(
          json_build_object(
            'id', oi.id,
            'productId', oi.product_id,
            'productName', oi.product_name,
            'quantity', oi.quantity,
            'unitPrice', oi.unit_price,
            'totalPrice', oi.total_price,
            'vendorId', oi.vendor_id,
            'commissionRate', oi.commission_rate,
            'commissionAmount', oi.commission_amount
          )
        ) as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.id = $1 AND (o.user_id = $2 OR $3 = 'admin' OR $3 = 'vendor' AND oi.vendor_id = (
        SELECT id FROM vendors WHERE user_id = $2
      ))
      GROUP BY o.id`,
			[orderId, userId, userRole],
		);

		if (orderResult.rows.length === 0) {
			return c.json({ error: "Order not found or access denied" }, 404);
		}

		const order = orderResult.rows[0];
		return c.json(order);
	}),
);

// Get orders list
orderRouter.get(
	"/",
	authenticateToken,
	validateRequest({ query: orderQuerySchema }),
	asyncHandler(async (c) => {
		const userId = c.get("user").id;
		const userRole = c.get("user").role;
		const {
			page = "1",
			limit = "20",
			status,
			fromDate,
			toDate,
			vendorId,
		} = c.req.query();

		const pageNum = Number.parseInt(page);
		const limitNum = Number.parseInt(limit);
		const offset = (pageNum - 1) * limitNum;

		const whereConditions: string[] = [];
		const queryParams: (string | number | Date)[] = [];
		let paramIndex = 1;

		if (userRole === "customer") {
			whereConditions.push(`o.user_id = $${paramIndex}`);
			queryParams.push(userId);
			paramIndex++;
		} else if (userRole === "vendor") {
			const vendorResult = await query(
				"SELECT id FROM vendors WHERE user_id = $1",
				[userId],
			);
			if (vendorResult.rows.length === 0) {
				return c.json({ error: "Vendor not found" }, 404);
			}
			whereConditions.push(`oi.vendor_id = $${paramIndex}`);
			queryParams.push(vendorResult.rows[0].id);
			paramIndex++;
		}

		if (status) {
			whereConditions.push(`o.status = $${paramIndex}`);
			queryParams.push(status);
			paramIndex++;
		}

		if (vendorId && userRole === "admin") {
			whereConditions.push(`oi.vendor_id = $${paramIndex}`);
			queryParams.push(vendorId);
			paramIndex++;
		}

		if (fromDate) {
			whereConditions.push(`o.created_at >= $${paramIndex}`);
			queryParams.push(new Date(fromDate));
			paramIndex++;
		}

		if (toDate) {
			whereConditions.push(`o.created_at <= $${paramIndex}`);
			queryParams.push(new Date(toDate));
			paramIndex++;
		}

		const whereClause =
			whereConditions.length > 0
				? `WHERE ${whereConditions.join(" AND ")}`
				: "";

		const ordersQuery = `
      SELECT 
        o.id, o.order_number, o.status, o.total_amount, o.created_at,
        COUNT(oi.id) as item_count,
        json_agg(
          json_build_object(
            'vendorId', oi.vendor_id,
            'totalPrice', oi.total_price
          )
        ) as vendor_totals
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      ${whereClause}
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

		const countQuery = `
      SELECT COUNT(DISTINCT o.id) as total
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      ${whereClause}
    `;

		const [ordersResult, countResult] = await Promise.all([
			query(ordersQuery, [...queryParams, limitNum, offset]),
			query(countQuery, queryParams),
		]);

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

// Update order status
orderRouter.put(
	"/:id/status",
	authenticateToken,
	validateRequest({ body: updateOrderStatusSchema }),
	asyncHandler(async (c) => {
		const orderId = c.req.param("id");
		const userId = c.get("user").id;
		const userRole = c.get("user").role;
		const { status, notes } = await c.req.json();

		// Check order exists and user has permission
		const orderResult = await query(
			`SELECT 
        o.*, 
        v.id as vendor_id
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN vendors v ON oi.vendor_id = v.id
      WHERE o.id = $1 AND (
        o.user_id = $2 OR 
        $3 = 'admin' OR 
        ($3 = 'vendor' AND v.user_id = $2)
      )
      LIMIT 1`,
			[orderId, userId, userRole],
		);

		if (orderResult.rows.length === 0) {
			return c.json({ error: "Order not found or access denied" }, 404);
		}

		const order = orderResult.rows[0];

		// Validate status transition
		const validTransitions: Record<string, string[]> = {
			pending: ["confirmed", "cancelled"],
			confirmed: ["processing", "cancelled"],
			processing: ["shipped"],
			shipped: ["delivered"],
			delivered: [],
			cancelled: [],
			refunded: [],
		};

		if (!validTransitions[order.status]?.includes(status)) {
			return c.json(
				{
					error: `Invalid status transition from ${order.status} to ${status}`,
				},
				400,
			);
		}

		// Update order status
		await query(
			"UPDATE orders SET status = $1, updated_at = $2, notes = COALESCE($3, notes) WHERE id = $4",
			[status, new Date(), notes, orderId],
		);

		// If order is cancelled or refunded, restore inventory
		if (status === "cancelled" || status === "refunded") {
			await query(
				`UPDATE products p
        SET inventory = p.inventory + oi.quantity
        FROM order_items oi
        WHERE p.id = oi.product_id AND oi.order_id = $1`,
				[orderId],
			);
		}

		// Send notifications based on status change
		if (status === "shipped") {
			const shippingInfo = notes ? JSON.parse(notes) : {};
			await EmailService.sendOrderShippedNotification(
				{
					name: c.get("user").full_name,
					email: c.get("user").email,
				},
				{
					orderNumber: order.order_number,
					trackingNumber: shippingInfo.trackingNumber,
					carrier: shippingInfo.carrier,
				},
			);
		}

		return c.json({
			message: "Order status updated successfully",
			order: {
				id: orderId,
				status,
				updatedAt: new Date(),
			},
		});
	}),
);

// Cancel order
orderRouter.post(
	"/:id/cancel",
	authenticateToken,
	asyncHandler(async (c) => {
		const orderId = c.req.param("id");
		const userId = c.get("user").id;

		// Check order exists and belongs to user
		const orderResult = await query(
			"SELECT id, status, order_number FROM orders WHERE id = $1 AND user_id = $2",
			[orderId, userId],
		);

		if (orderResult.rows.length === 0) {
			return c.json({ error: "Order not found or access denied" }, 404);
		}

		const order = orderResult.rows[0];

		// Only allow cancellation if order is pending or confirmed
		if (!["pending", "confirmed"].includes(order.status)) {
			return c.json(
				{
					error: `Order cannot be cancelled in its current state (${order.status})`,
				},
				400,
			);
		}

		// Start transaction
		await query("BEGIN");

		try {
			// Update order status
			await query(
				"UPDATE orders SET status = 'cancelled', updated_at = $1 WHERE id = $2",
				[new Date(), orderId],
			);

			// Restore inventory
			await query(
				`UPDATE products p
        SET inventory = p.inventory + oi.quantity
        FROM order_items oi
        WHERE p.id = oi.product_id AND oi.order_id = $1`,
				[orderId],
			);

			// If payment was made, initiate refund
			const paymentResult = await query(
				"SELECT id, stripe_payment_intent_id, amount FROM payments WHERE order_id = $1 AND status = 'succeeded'",
				[orderId],
			);

			if (paymentResult.rows.length > 0) {
				const payment = paymentResult.rows[0];
				const stripe = getStripe();

				// Create refund in Stripe
				const refund = await stripe.refunds.create({
					payment_intent: payment.stripe_payment_intent_id,
					amount: Math.round(payment.amount * 100),
					reason: "requested_by_customer",
				});

				// Record refund in database
				await query(
					`INSERT INTO refunds (
            order_id, stripe_refund_id, amount, reason, status, processed_by
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
					[
						orderId,
						refund.id,
						payment.amount,
						"Order cancelled by customer",
						refund.status,
						userId,
					],
				);

				// Update order status to refunded
				await query(
					"UPDATE orders SET status = 'refunded', updated_at = $1 WHERE id = $2",
					[new Date(), orderId],
				);
			}

			await query("COMMIT");

			// Send notification
			await EmailService.sendRefundNotification(
				{
					name: c.get("user").full_name,
					email: c.get("user").email,
				},
				{
					orderNumber: order.order_number,
					amount: paymentResult.rows[0]?.amount || 0,
					reason: "Order cancelled by customer",
				},
			);

			return c.json({
				message: "Order cancelled successfully",
				refundInitiated: paymentResult.rows.length > 0,
			});
		} catch (error) {
			await query("ROLLBACK");
			logger.error("Order cancellation failed:", error);
			return c.json({ error: "Failed to cancel order" }, 500);
		}
	}),
);

// Vendor: Get orders for vendor
orderRouter.get(
	"/vendor/orders",
	authenticateToken,
	requireVendor,
	validateRequest({ query: orderQuerySchema }),
	asyncHandler(async (c) => {
		const vendorId = c.get("vendorId");
		const {
			page = "1",
			limit = "20",
			status,
			fromDate,
			toDate,
		} = c.req.query();

		const pageNum = Number.parseInt(page);
		const limitNum = Number.parseInt(limit);
		const offset = (pageNum - 1) * limitNum;

		const whereConditions = ["oi.vendor_id = $1"];
		const queryParams: (string | Date)[] = [vendorId];
		let paramIndex = 2;

		if (status) {
			whereConditions.push(`o.status = $${paramIndex}`);
			queryParams.push(status);
			paramIndex++;
		}

		if (fromDate) {
			whereConditions.push(`o.created_at >= $${paramIndex}`);
			queryParams.push(new Date(fromDate));
			paramIndex++;
		}

		if (toDate) {
			whereConditions.push(`o.created_at <= $${paramIndex}`);
			queryParams.push(new Date(toDate));
			paramIndex++;
		}

		const whereClause =
			whereConditions.length > 0
				? `WHERE ${whereConditions.join(" AND ")}`
				: "";

		const ordersQuery = `
      SELECT 
        o.id, o.order_number, o.status, o.total_amount, o.created_at,
        u.full_name as customer_name,
        json_agg(
          json_build_object(
            'productId', oi.product_id,
            'productName', oi.product_name,
            'quantity', oi.quantity,
            'unitPrice', oi.unit_price,
            'totalPrice', oi.total_price
          )
        ) as items
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN users u ON o.user_id = u.id
      ${whereClause}
      GROUP BY o.id, u.full_name
      ORDER BY o.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

		const countQuery = `
      SELECT COUNT(DISTINCT o.id) as total
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      ${whereClause}
    `;

		const [ordersResult, countResult] = await Promise.all([
			query(ordersQuery, [...queryParams, limitNum, offset]),
			query(countQuery, queryParams),
		]);

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

// Get order tracking information
orderRouter.get(
	"/:id/tracking",
	authenticateToken,
	asyncHandler(async (c) => {
		const orderId = c.req.param("id");
		const userId = c.get("user").id;
		const userRole = c.get("user").role;

		// Check order exists and user has permission
		const orderResult = await query(
			`SELECT 
                o.id, o.order_number, o.status, o.notes,
                o.shipping_address->>'trackingNumber' as tracking_number,
                o.shipping_address->>'carrier' as carrier,
                o.shipping_address->>'estimatedDelivery' as estimated_delivery
            FROM orders o
            LEFT JOIN order_items oi ON o.id = oi.order_id
            LEFT JOIN vendors v ON oi.vendor_id = v.id
            WHERE o.id = $1 AND (
                o.user_id = $2 OR 
                $3 = 'admin' OR 
                ($3 = 'vendor' AND v.user_id = $2)
            LIMIT 1`,
			[orderId, userId, userRole],
		);
		if (orderResult.rows.length === 0) {
			return c.json({ error: "Order not found or access denied" }, 404);
		}
		const order = orderResult.rows[0];

		// Only provide tracking info if order is shipped or delivered
		if (!["shipped", "delivered"].includes(order.status)) {
			return c.json(
				{
					error: "Tracking information is not available yet",
					status: order.status,
				},
				400,
			);
		}

		// Parse the notes JSON if it exists
		let shippingInfo = {} as ShippingInfo;
		try {
			shippingInfo = order.notes ? JSON.parse(order.notes) : {};
		} catch (error) {
			logger.error("Failed to parse order notes:", error);
		}

		const trackingInfo = {
			orderId: order.id,
			orderNumber: order.order_number,
			status: order.status,
			carrier: order.carrier || shippingInfo.carrier || "Unknown",
			trackingNumber:
				order.tracking_number || shippingInfo.trackingNumber || null,
			estimatedDelivery:
				order.estimated_delivery || shippingInfo.estimatedDelivery || null,
			shippingInfo: shippingInfo,
			lastUpdated: new Date().toISOString(),
			trackingUrl: order.carrier
				? getTrackingUrl(order.carrier, order.tracking_number)
				: null,
		};

		await EmailService.sendOrderShippedNotification(
			{
				name: c.get("user").full_name,
				email: c.get("user").email,
			},
			{
				orderNumber: order.order_number,
				trackingNumber: order.tracking_number,
				carrier: order.carrier,
			},
		);

		return c.json(trackingInfo);
	}),
);
