import { z } from "zod";

const addressSchema = z.object({
	fullName: z.string().min(1, "Full name is required"),
	company: z.string().optional(),
	addressLine1: z.string().min(1, "Address line 1 is required"),
	addressLine2: z.string().optional(),
	city: z.string().min(1, "City is required"),
	state: z.string().min(1, "State is required"),
	postalCode: z.string().min(1, "Postal code is required"),
	country: z.string().min(1, "Country is required"),
	phone: z.string().optional(),
});

const orderItemSchema = z.object({
	productId: z.string().uuid("Invalid product ID"),
	quantity: z.number().int().positive("Quantity must be positive"),
	variantId: z.string().uuid("Invalid variant ID").optional(),
});

export const createOrderSchema = z.object({
	items: z.array(orderItemSchema).min(1, "At least one item is required"),
	shippingAddress: addressSchema,
	billingAddress: addressSchema.optional(),
	paymentMethod: z.string().min(1, "Payment method is required"),
	shippingAmount: z.number().nonnegative().default(0),
	taxRate: z.number().nonnegative().optional(),
	notes: z.string().optional(),
});

export const updateOrderStatusSchema = z.object({
	status: z.enum([
		"pending",
		"confirmed",
		"processing",
		"shipped",
		"delivered",
		"cancelled",
		"refunded",
	]),
	notes: z.string().optional(),
});

export const orderQuerySchema = z.object({
	page: z
		.string()
		.transform(Number)
		.pipe(z.number().int().positive())
		.default("1"),
	limit: z
		.string()
		.transform(Number)
		.pipe(z.number().int().positive().max(100))
		.default("20"),
	status: z
		.enum([
			"pending",
			"confirmed",
			"processing",
			"shipped",
			"delivered",
			"cancelled",
			"refunded",
		])
		.optional(),
	fromDate: z.string().optional(),
	toDate: z.string().optional(),
	vendorId: z.string().uuid("Invalid vendor ID").optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type OrderQueryParams = z.infer<typeof orderQuerySchema>;
