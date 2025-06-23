import { z } from "zod";

export const updateProfileSchema = z.object({
	firstName: z.string().min(1, "First name is required").optional(),
	lastName: z.string().min(1, "Last name is required").optional(),
	phone: z.string().optional(),
	avatar: z.string().url().optional(),
});

export const changePasswordSchema = z.object({
	currentPassword: z.string().min(1, "Current password is required"),
	newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export const addressSchema = z.object({
	type: z.enum(["shipping", "billing"]).default("shipping"),
	firstName: z.string().min(1, "First name is required"),
	lastName: z.string().min(1, "Last name is required"),
	company: z.string().optional(),
	addressLine1: z.string().min(1, "Address line 1 is required"),
	addressLine2: z.string().optional(),
	city: z.string().min(1, "City is required"),
	state: z.string().min(1, "State is required"),
	postalCode: z.string().min(1, "Postal code is required"),
	country: z.string().min(1, "Country is required"),
	phone: z.string().optional(),
	isDefault: z.boolean().default(false),
});

export const createStreamSchema = z.object({
	title: z.string().min(1, "Stream title is required"),
	description: z.string().optional(),
	scheduledFor: z.string().datetime().optional(),
	productIds: z.array(z.string().uuid()).optional(),
	thumbnailUrl: z.string().url().optional(),
});

export const updateStreamSchema = createStreamSchema.partial();

export const createVideoSchema = z.object({
	title: z.string().min(1, "Video title is required"),
	description: z.string().optional(),
	tags: z.array(z.string()).optional(),
	productIds: z.array(z.string().uuid()).optional(),
});

export const videoQuerySchema = z.object({
	page: z
		.string()
		.transform(Number)
		.pipe(z.number().int().positive())
		.default("1"),
	limit: z
		.string()
		.transform(Number)
		.pipe(z.number().int().positive().max(50))
		.default("20"),
	userId: z.string().uuid().optional(),
	tag: z.string().optional(),
});
