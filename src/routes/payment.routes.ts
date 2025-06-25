import { Hono } from "hono";
import { query } from "../config/postgresql";
import { logger } from "../utils/logger";
import { authenticateToken, requireAdmin } from "../middleware/auth";
import {
	confirmPaymentSchema,
	createPaymentIntentSchema,
	refundSchema,
} from "../schemas/user";
import { validateRequest } from "../middleware/validation";
import { asyncHandler } from "../middleware/erroHandler";
import { getStripe } from "../config/stripe";
import { EmailService } from "../email/email.service";

type Variables = {
	user?: {
		id: string;
		email: string;
		role: string;
	};
};

export const paymentRouter = new Hono<{ Variables: Variables }>();

paymentRouter.post(
	"/create-intent",
	authenticateToken,
	validateRequest({ body: createPaymentIntentSchema }),
	asyncHandler(async (c) => {
		const stripe = getStripe();
		const userId = c.get("user").id;
		const { orderId, paymentMethodId, savePaymentMethod } = await c.req.json();

		// Get order details
		const orderResult = await query(
			`
        SELECT 
          o.*, 
          json_agg(
            json_build_object(
              'vendor_id', oi.vendor_id,
              'total_price', oi.total_price,
              'commission_amount', oi.commission_amount
            )
          ) as items
        FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        WHERE o.id = $1 AND o.user_id = $2 AND o.payment_status = 'pending'
        GROUP BY o.id
      `,
			[orderId, userId],
		);

		if (orderResult.rows.length === 0) {
			return c.json({ error: "Order not found or already paid" }, 404);
		}

		const order = orderResult.rows[0];

		try {
			// Get or create Stripe customer
			let customerId = null;
			const customerResult = await query(
				"SELECT stripe_customer_id FROM users WHERE id = $1",
				[userId],
			);

			if (customerResult.rows[0]?.stripe_customer_id) {
				customerId = customerResult.rows[0].stripe_customer_id;
			} else {
				const customer = await stripe.customers.create({
					email: c.get("user").email,
					metadata: {
						userId: userId,
					},
				});
				customerId = customer.id;

				// Save customer ID
				await query("UPDATE users SET stripe_customer_id = $1 WHERE id = $2", [
					customerId,
					userId,
				]);
			}

			// Calculate application fee (platform commission)
			const applicationFeeAmount = Math.round(
				order.items.reduce(
					(total: number, item: any) =>
						total + Number.parseFloat(item.commission_amount || 0),
					0,
				) * 100,
			);

			// Create payment intent
			const paymentIntentData: any = {
				amount: Math.round(Number.parseFloat(order.total_amount) * 100), // Convert to cents
				currency: order.currency.toLowerCase(),
				customer: customerId,
				metadata: {
					orderId: order.id,
					userId: userId,
				},
				automatic_payment_methods: {
					enabled: true,
				},
			};

			// Add application fee if there are multiple vendors
			if (applicationFeeAmount > 0) {
				paymentIntentData.application_fee_amount = applicationFeeAmount;
			}

			// Add payment method if provided
			if (paymentMethodId) {
				paymentIntentData.payment_method = paymentMethodId;
				paymentIntentData.confirmation_method = "manual";
				paymentIntentData.confirm = true;
			}

			const paymentIntent =
				await stripe.paymentIntents.create(paymentIntentData);

			// Save payment intent to database
			await query(
				`
          INSERT INTO payments (order_id, stripe_payment_intent_id, amount, currency, status)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (order_id) DO UPDATE SET
            stripe_payment_intent_id = $2,
            amount = $3,
            status = $5,
            updated_at = CURRENT_TIMESTAMP
        `,
				[
					orderId,
					paymentIntent.id,
					order.total_amount,
					order.currency,
					paymentIntent.status,
				],
			);

			return c.json({
				clientSecret: paymentIntent.client_secret,
				paymentIntentId: paymentIntent.id,
				status: paymentIntent.status,
			});
		} catch (error) {
			logger.error("Payment intent creation failed:", error);
			return c.json({ error: "Failed to create payment intent" }, 500);
		}
	}),
);

paymentRouter.post(
    "/confirm",
    authenticateToken,
    validateRequest({ body: confirmPaymentSchema }),
    asyncHandler(async (c) => {
        const stripe = getStripe();
        const userId = c.get("user").id;
        const { paymentIntentId, paymentMethodId } = await c.req.json();

        try {
            let paymentIntent;

            if (paymentMethodId) {
                // Confirm with payment method
                paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
                    payment_method: paymentMethodId,
                });
            } else {
                // Retrieve payment intent status
                paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
            }

            // Update payment status in database
            await query(
                "UPDATE payments SET status = $1, updated_at = $2 WHERE stripe_payment_intent_id = $3",
                [paymentIntent.status, new Date(), paymentIntentId],
            );

            if (paymentIntent.status === "succeeded") {
                // Get order details
                const orderResult = await query(
                    `
                    SELECT o.*, p.order_id
                    FROM orders o
                    JOIN payments p ON o.id = p.order_id
                    WHERE p.stripe_payment_intent_id = $1
                    `,
                    [paymentIntentId],
                );

                if (orderResult.rows.length > 0) {
                    const order = orderResult.rows[0];

                    // Update order status
                    await query(
                        "UPDATE orders SET payment_status = $1, status = $2, updated_at = $3 WHERE id = $4",
                        ["completed", "confirmed", new Date(), order.id],
                    );

                    // Update product inventory
                    await query(
                        `
                        UPDATE products 
                        SET inventory = inventory - oi.quantity
                        FROM order_items oi
                        WHERE products.id = oi.product_id AND oi.order_id = $1
                        `,
                        [order.id],
                    );

                    // Get order items with product names for the email
                    const orderItemsResult = await query(
                        `
                        SELECT p.name as product_name, oi.quantity, oi.unit_price
                        FROM order_items oi
                        JOIN products p ON oi.product_id = p.id
                        WHERE oi.order_id = $1
                        `,
                        [order.id]
                    );

                    // Send order confirmation email
                    await EmailService.sendOrderConfirmation(
                        {
                            name: c.get("user").full_name,
                            email: c.get("user").email
                        },
                        {
                            orderNumber: order.order_number,
                            total: Number(order.total_amount),
                            items: orderItemsResult.rows
                        }
                    );

                    // Create notification
                    await query(
                        "INSERT INTO notifications (user_id, type, title, message, data) VALUES ($1, $2, $3, $4, $5)",
                        [
                            userId,
                            "order_confirmed",
                            "Order Confirmed",
                            `Your order #${order.order_number} has been confirmed and payment processed.`,
                            JSON.stringify({
                                orderId: order.id,
                                orderNumber: order.order_number,
                            }),
                        ],
                    );
                }
            }

            return c.json({
                status: paymentIntent.status,
                paymentIntentId: paymentIntent.id,
            });
        } catch (error) {
            logger.error("Payment confirmation failed:", error);
            return c.json({ error: "Failed to confirm payment" }, 500);
        }
    }),
);

paymentRouter.post(
    "/refund",
    authenticateToken,
    validateRequest({ body: refundSchema }),
    asyncHandler(async (c) => {
        const stripe = getStripe();
        const { orderId, amount, reason } = await c.req.json();
        const userId = c.get("user").id;

        // Get order and payment details
        const orderResult = await query(
            `
            SELECT 
              o.*, p.stripe_payment_intent_id, p.amount as payment_amount
            FROM orders o
            JOIN payments p ON o.id = p.order_id
            WHERE o.id = $1 AND (o.user_id = $2 OR $3 = ANY(SELECT role FROM users WHERE id = $2))
            `,
            [orderId, userId, "admin"],
        );

        if (orderResult.rows.length === 0) {
            return c.json({ error: "Order not found or access denied" }, 404);
        }

        const order = orderResult.rows[0];

        if (order.payment_status !== "completed") {
            return c.json({ error: "Order payment is not completed" }, 400);
        }

        try {
            // Calculate refund amount
            const refundAmount = amount
                ? Math.round(amount * 100)
                : Math.round(Number.parseFloat(order.payment_amount) * 100);

            // Create refund in Stripe
            const refund = await stripe.refunds.create({
                payment_intent: order.stripe_payment_intent_id,
                amount: refundAmount,
                reason: reason || "requested_by_customer",
                metadata: {
                    orderId: order.id,
                    userId: userId,
                },
            });

            // Update order status
            await query(
                "UPDATE orders SET status = $1, payment_status = $2, updated_at = $3 WHERE id = $4",
                ["refunded", "refunded", new Date(), orderId],
            );

            // Create refund record
            await query(
                `
                INSERT INTO refunds (order_id, stripe_refund_id, amount, reason, status, processed_by)
                VALUES ($1, $2, $3, $4, $5, $6)
                `,
                [orderId, refund.id, refundAmount / 100, reason, refund.status, userId],
            );

            // Restore product inventory
            await query(
                `
                UPDATE products 
                SET inventory = inventory + oi.quantity
                FROM order_items oi
                WHERE products.id = oi.product_id AND oi.order_id = $1
                `,
                [orderId],
            );

            // Get user details for notification
            const userResult = await query(
                "SELECT email, full_name FROM users WHERE id = $1",
                [order.user_id],
            );
            const user = userResult.rows[0];

            // Send refund notification email
            await EmailService.sendRefundNotification(
                {
                    name: user.full_name,
                    email: user.email
                },
                {
                    orderNumber: order.order_number,
                    amount: refundAmount / 100,
                    reason: reason
                }
            );

            // Create notification
            await query(
                "INSERT INTO notifications (user_id, type, title, message, data) VALUES ($1, $2, $3, $4, $5)",
                [
                    order.user_id,
                    "refund_processed",
                    "Refund Processed",
                    `Your refund for order #${order.order_number} has been processed.`,
                    JSON.stringify({
                        orderId: order.id,
                        refundAmount: refundAmount / 100,
                    }),
                ],
            );

            return c.json({
                message: "Refund processed successfully",
                refund: {
                    id: refund.id,
                    amount: refundAmount / 100,
                    status: refund.status,
                },
            });
        } catch (error) {
            logger.error("Refund processing failed:", error);
            return c.json({ error: "Failed to process refund" }, 500);
        }
    }),
);

// Get payment methods
paymentRouter.get(
	"/methods",
	authenticateToken,
	asyncHandler(async (c) => {
		const stripe = getStripe();
		const userId = c.get("user").id;

		try {
			// Get Stripe customer ID
			const customerResult = await query(
				"SELECT stripe_customer_id FROM users WHERE id = $1",
				[userId],
			);

			if (!customerResult.rows[0]?.stripe_customer_id) {
				return c.json({ paymentMethods: [] });
			}

			const customerId = customerResult.rows[0].stripe_customer_id;

			// Get payment methods from Stripe
			const paymentMethods = await stripe.paymentMethods.list({
				customer: customerId,
				type: "card",
			});

			return c.json({
				paymentMethods: paymentMethods.data.map((pm) => ({
					id: pm.id,
					type: pm.type,
					card: pm.card
						? {
							brand: pm.card.brand,
							last4: pm.card.last4,
							expMonth: pm.card.exp_month,
							expYear: pm.card.exp_year,
						}
						: null,
				})),
			});
		} catch (error) {
			logger.error("Failed to fetch payment methods:", error);
			return c.json({ error: "Failed to fetch payment methods" }, 500);
		}
	}),
);

// Delete payment method
paymentRouter.delete(
	"/methods/:id",
	authenticateToken,
	asyncHandler(async (c) => {
		const stripe = getStripe();
		const id = c.req.param("id");

		try {
			await stripe.paymentMethods.detach(id);
			return c.json({ message: "Payment method removed successfully" });
		} catch (error) {
			logger.error("Failed to remove payment method:", error);
			return c.json({ error: "Failed to remove payment method" }, 500);
		}
	}),
);

// Webhook handler for Stripe events
paymentRouter.post(
	"/webhook",
	asyncHandler(async (c) => {
		const stripe = getStripe();
		const sig = c.req.header("stripe-signature") as string;
		const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
		const rawBody = await c.req.raw.arrayBuffer();

		let event;

		try {
			event = stripe.webhooks.constructEvent(
				Buffer.from(rawBody),
				sig,
				webhookSecret,
			);
		} catch (err: any) {
			logger.error("Webhook signature verification failed:", err.message);
			return c.json({ error: `Webhook Error: ${err.message}` }, 400);
		}

		// Handle the event
		switch (event.type) {
			case "payment_intent.succeeded":
				const paymentIntent = event.data.object;
				logger.info(`Payment succeeded: ${paymentIntent.id}`);

				// Update payment status
				await query(
					"UPDATE payments SET status = $1, updated_at = $2 WHERE stripe_payment_intent_id = $3",
					["succeeded", new Date(), paymentIntent.id],
				);
				break;

			case "payment_intent.payment_failed":
				const failedPayment = event.data.object;
				logger.error(`Payment failed: ${failedPayment.id}`);

				// Update payment status
				await query(
					"UPDATE payments SET status = $1, updated_at = $2 WHERE stripe_payment_intent_id = $3",
					["failed", new Date(), failedPayment.id],
				);
				break;

			case "refund.created":
				const refund = event.data.object;
				logger.info(`Refund created: ${refund.id}`);
				break;

			default:
				logger.info(`Unhandled event type: ${event.type}`);
		}

		return c.json({ received: true });
	}),
);

// Get payment history
paymentRouter.get(
	"/history",
	authenticateToken,
	asyncHandler(async (c) => {
		const userId = c.get("user").id;
		const page = Number(c.req.query("page")) || 1;
		const limit = Number(c.req.query("limit")) || 20;
		const offset = (page - 1) * limit;

		const paymentsResult = await query(
			`
        SELECT 
          p.*, o.order_number, o.total_amount, o.created_at as order_date
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE o.user_id = $1
        ORDER BY p.created_at DESC
        LIMIT $2 OFFSET $3
      `,
			[userId, limit, offset],
		);

		const countResult = await query(
			`
        SELECT COUNT(*) as total
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        WHERE o.user_id = $1
      `,
			[userId],
		);

		const payments = paymentsResult.rows;
		const total = Number.parseInt(countResult.rows[0].total);

		return c.json({
			payments,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
			},
		});
	}),
);

// Admin: Get all payments
paymentRouter.get(
	"/admin/all",
	authenticateToken,
	requireAdmin,
	asyncHandler(async (c) => {
		const page = Number(c.req.query("page")) || 1;
		const limit = Number(c.req.query("limit")) || 50;
		const status = c.req.query("status") as string;
		const offset = (page - 1) * limit;

		const whereConditions = [];
		const queryParams: any[] = [];
		let paramIndex = 1;

		if (status) {
			whereConditions.push(`p.status = $${paramIndex}`);
			queryParams.push(status);
			paramIndex++;
		}

		const whereClause =
			whereConditions.length > 0
				? `WHERE ${whereConditions.join(" AND ")}`
				: "";

		const paymentsResult = await query(
			`
        SELECT 
          p.*, o.order_number, o.total_amount, o.user_id,
          u.full_name,, u.email
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        JOIN users u ON o.user_id = u.id
        ${whereClause}
        ORDER BY p.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
			[...queryParams, limit, offset],
		);

		const countResult = await query(
			`
        SELECT COUNT(*) as total
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        JOIN users u ON o.user_id = u.id
        ${whereClause}
      `,
			queryParams,
		);

		const payments = paymentsResult.rows;
		const total = Number.parseInt(countResult.rows[0].total);

		return c.json({
			payments,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
			},
		});
	}),
);
