import express from "express"
import { query } from "../config/postgresql"
import { setCache, getCache } from "../config/redis"
import { authenticateToken, requireVendor, type AuthRequest } from "../middleware/auth"
import { validateRequest } from "../middleware/validation"
import { asyncHandler } from "../middleware/errorHandler"
import { createProductSchema, updateProductSchema, productQuerySchema } from "../schemas/product"

const router = express.Router()

// Get products with filters and pagination
router.get(
  "/",
  validateRequest({ query: productQuerySchema }),
  asyncHandler(async (req, res) => {
    const { page, limit, category, minPrice, maxPrice, search, sortBy, sortOrder, vendorId } = req.query as any

    const offset = (page - 1) * limit

    // Build cache key
    const cacheKey = `products:${JSON.stringify(req.query)}`

    // Try to get from cache first
    const cachedResult = await getCache(cacheKey)
    if (cachedResult) {
      return res.json(cachedResult)
    }

    // Build query
    const whereConditions = ["p.is_active = true"]
    const queryParams: any[] = []
    let paramIndex = 1

    if (category) {
      whereConditions.push(`c.slug = $${paramIndex}`)
      queryParams.push(category)
      paramIndex++
    }

    if (minPrice) {
      whereConditions.push(`p.price >= $${paramIndex}`)
      queryParams.push(minPrice)
      paramIndex++
    }

    if (maxPrice) {
      whereConditions.push(`p.price <= $${paramIndex}`)
      queryParams.push(maxPrice)
      paramIndex++
    }

    if (search) {
      whereConditions.push(`(p.name ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`)
      queryParams.push(`%${search}%`)
      paramIndex++
    }

    if (vendorId) {
      whereConditions.push(`p.vendor_id = $${paramIndex}`)
      queryParams.push(vendorId)
      paramIndex++
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : ""

    // Order by clause
    let orderByClause = ""
    switch (sortBy) {
      case "name":
        orderByClause = `ORDER BY p.name ${sortOrder.toUpperCase()}`
        break
      case "price":
        orderByClause = `ORDER BY p.price ${sortOrder.toUpperCase()}`
        break
      case "popularity":
        orderByClause = `ORDER BY p.view_count ${sortOrder.toUpperCase()}`
        break
      default:
        orderByClause = `ORDER BY p.created_at ${sortOrder.toUpperCase()}`
    }

    // Get products
    const productsQuery = `
    SELECT 
      p.id, p.name, p.description, p.price, p.images, p.inventory,
      p.created_at, p.view_count, p.rating, p.review_count,
      c.name as category_name, c.slug as category_slug,
      v.business_name as vendor_name, v.id as vendor_id
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN vendors v ON p.vendor_id = v.id
    ${whereClause}
    ${orderByClause}
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `

    queryParams.push(limit, offset)

    // Get total count
    const countQuery = `
    SELECT COUNT(*) as total
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN vendors v ON p.vendor_id = v.id
    ${whereClause}
  `

    const [productsResult, countResult] = await Promise.all([
      query(productsQuery, queryParams),
      query(countQuery, queryParams.slice(0, -2)), // Remove limit and offset for count
    ])

    const products = productsResult.rows
    const total = Number.parseInt(countResult.rows[0].total)
    const totalPages = Math.ceil(total / limit)

    const result = {
      products,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    }

    // Cache for 5 minutes
    await setCache(cacheKey, result, 300)

    res.json(result)
  }),
)

// Get single product
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params

    // Try cache first
    const cacheKey = `product:${id}`
    const cachedProduct = await getCache(cacheKey)
    if (cachedProduct) {
      return res.json(cachedProduct)
    }

    const productResult = await query(
      `
    SELECT 
      p.*, 
      c.name as category_name, c.slug as category_slug,
      v.business_name as vendor_name, v.id as vendor_id,
      v.rating as vendor_rating
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN vendors v ON p.vendor_id = v.id
    WHERE p.id = $1 AND p.is_active = true
  `,
      [id],
    )

    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" })
    }

    const product = productResult.rows[0]

    // Get product variants
    const variantsResult = await query("SELECT * FROM product_variants WHERE product_id = $1", [id])

    product.variants = variantsResult.rows

    // Increment view count
    await query("UPDATE products SET view_count = view_count + 1 WHERE id = $1", [id])

    // Cache for 10 minutes
    await setCache(cacheKey, product, 600)

    res.json(product)
  }),
)

// Create product (vendor only)
router.post(
  "/",
  authenticateToken,
  requireVendor,
  validateRequest({ body: createProductSchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const productData = req.body
    const vendorId = req.user!.vendorId

    const productResult = await query(
      `
    INSERT INTO products (
      vendor_id, name, description, price, category_id, inventory, 
      images, weight, dimensions, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `,
      [
        vendorId,
        productData.name,
        productData.description,
        productData.price,
        productData.categoryId,
        productData.inventory,
        JSON.stringify(productData.images),
        productData.weight,
        JSON.stringify(productData.dimensions),
        productData.isActive,
      ],
    )

    const product = productResult.rows[0]

    // Create variants if provided
    if (productData.variants && productData.variants.length > 0) {
      for (const variant of productData.variants) {
        await query("INSERT INTO product_variants (product_id, name, value, price_modifier) VALUES ($1, $2, $3, $4)", [
          product.id,
          variant.name,
          variant.value,
          variant.priceModifier,
        ])
      }
    }

    // Create tags if provided
    if (productData.tags && productData.tags.length > 0) {
      for (const tag of productData.tags) {
        await query("INSERT INTO product_tags (product_id, tag) VALUES ($1, $2)", [product.id, tag])
      }
    }

    // Clear related caches
    await Promise.all([
      setCache(`product:${product.id}`, null, 0), // Delete cache
      setCache("products:*", null, 0), // Clear products list cache pattern
    ])

    res.status(201).json({
      message: "Product created successfully",
      product,
    })
  }),
)

// Update product (vendor only)
router.put(
  "/:id",
  authenticateToken,
  requireVendor,
  validateRequest({ body: updateProductSchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params
    const updateData = req.body
    const vendorId = req.user!.vendorId

    // Check if product belongs to vendor
    const existingProduct = await query("SELECT id FROM products WHERE id = $1 AND vendor_id = $2", [id, vendorId])

    if (existingProduct.rows.length === 0) {
      return res.status(404).json({ error: "Product not found or access denied" })
    }

    // Build update query dynamically
    const updateFields = []
    const updateValues = []
    let paramIndex = 1

    Object.entries(updateData).forEach(([key, value]) => {
      if (value !== undefined) {
        if (key === "images" || key === "dimensions") {
          updateFields.push(`${key} = $${paramIndex}`)
          updateValues.push(JSON.stringify(value))
        } else {
          updateFields.push(`${key} = $${paramIndex}`)
          updateValues.push(value)
        }
        paramIndex++
      }
    })

    if (updateFields.length === 0) {
      return res.status(400).json({ error: "No valid fields to update" })
    }

    updateFields.push("updated_at = $" + paramIndex)
    updateValues.push(new Date())
    updateValues.push(id)

    const updateQuery = `
    UPDATE products 
    SET ${updateFields.join(", ")}
    WHERE id = $${paramIndex + 1}
    RETURNING *
  `

    const result = await query(updateQuery, updateValues)
    const updatedProduct = result.rows[0]

    // Clear caches
    await Promise.all([setCache(`product:${id}`, null, 0), setCache("products:*", null, 0)])

    res.json({
      message: "Product updated successfully",
      product: updatedProduct,
    })
  }),
)

// Delete product (vendor only)
router.delete(
  "/:id",
  authenticateToken,
  requireVendor,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params
    const vendorId = req.user!.vendorId

    // Check if product belongs to vendor
    const existingProduct = await query("SELECT id FROM products WHERE id = $1 AND vendor_id = $2", [id, vendorId])

    if (existingProduct.rows.length === 0) {
      return res.status(404).json({ error: "Product not found or access denied" })
    }

    // Soft delete (set is_active to false)
    await query("UPDATE products SET is_active = false WHERE id = $1", [id])

    // Clear caches
    await Promise.all([setCache(`product:${id}`, null, 0), setCache("products:*", null, 0)])

    res.json({ message: "Product deleted successfully" })
  }),
)

// Get product reviews
router.get(
  "/:id/reviews",
  asyncHandler(async (req, res) => {
    const { id } = req.params
    const page = Number.parseInt(req.query.page as string) || 1
    const limit = Number.parseInt(req.query.limit as string) || 10
    const offset = (page - 1) * limit

    const reviewsResult = await query(
      `
    SELECT 
      r.*, 
      u.first_name, u.last_name
    FROM reviews r
    JOIN users u ON r.user_id = u.id
    WHERE r.product_id = $1
    ORDER BY r.created_at DESC
    LIMIT $2 OFFSET $3
  `,
      [id, limit, offset],
    )

    const countResult = await query("SELECT COUNT(*) as total FROM reviews WHERE product_id = $1", [id])

    const reviews = reviewsResult.rows
    const total = Number.parseInt(countResult.rows[0].total)

    res.json({
      reviews,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  }),
)

export default router
