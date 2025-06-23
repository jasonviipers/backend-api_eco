import { z } from "zod";

export const createProductSchema = z.object({
	name: z.string().min(1, "Product name is required"),
	description: z.string().min(1, "Product description is required"),
	price: z.number().positive("Price must be positive"),
	categoryId: z.string().uuid("Invalid category ID"),
	inventory: z.number().int().min(0, "Inventory cannot be negative"),
	images: z.array(z.string().url()).min(1, "At least one image is required"),
	variants: z
		.array(
			z.object({
				name: z.string(),
				value: z.string(),
				priceModifier: z.number().default(0),
			}),
		)
		.optional(),
	tags: z.array(z.string()).optional(),
	weight: z.number().positive().optional(),
	dimensions: z
		.object({
			length: z.number().positive(),
			width: z.number().positive(),
			height: z.number().positive(),
		})
		.optional(),
	isActive: z.boolean().default(true),
});

export const updateProductSchema = createProductSchema.partial();

export const productQuerySchema = z.object({
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
	category: z.string().optional(),
	minPrice: z.string().transform(Number).pipe(z.number().positive()).optional(),
	maxPrice: z.string().transform(Number).pipe(z.number().positive()).optional(),
	search: z.string().optional(),
	sortBy: z
		.enum(["name", "price", "createdAt", "popularity"])
		.default("createdAt"),
	sortOrder: z.enum(["asc", "desc"]).default("desc"),
	vendorId: z.string().uuid().optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductQueryInput = z.infer<typeof productQuerySchema>;
