import { z } from "zod";

export const vendorRegistrationSchema = z.object({
	businessName: z.string().min(1, "Business name is required"),
	description: z.string().optional(),
	businessAddress: z.string().min(1, "Business address is required"),
	businessPhone: z.string().min(1, "Business phone is required"),
	businessEmail: z.string().email("Invalid business email"),
	taxId: z.string().min(1, "Tax ID is required"),
	businessType: z.string().min(1, "Business type is required"),
	website: z.string().url().optional(),
});

export const updateVendorSchema = vendorRegistrationSchema.partial();

export const vendorQuerySchema = z.object({
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
	status: z.enum(["pending", "approved", "rejected", "suspended"]).optional(),
	search: z.string().optional(),
	sortBy: z
		.enum(["business_name", "created_at", "rating", "total_sales"])
		.default("created_at"),
	sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
