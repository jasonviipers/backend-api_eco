import { Hono } from 'hono'
import { query } from '../config/postgresql'
import { getCache, setCache } from '../config/redis'
import { authenticateToken, requireVendor } from '../middleware/auth'
import { asyncHandler } from '../middleware/erroHandler'
import { validateRequest } from '../middleware/validation'
import { createProductSchema, productQuerySchema, updateProductSchema } from '../schemas/product'

export const productRouter = new Hono()

productRouter.get('/', validateRequest({ query: productQuerySchema }),
    asyncHandler(async (c) => {
        const { page = '1', limit = '10', category, minPrice, maxPrice, search, sortBy = 'created_at', sortOrder = 'desc', vendorId } = c.req.query()

        const offset = (Number(page) - 1) * Number(limit)

        const cacheKey = `products:${JSON.stringify(c.req.query())}`

        const cachedResult = await getCache(cacheKey)
        if (cachedResult) {
            return c.json(cachedResult)
        }

        const whereConditions = ['p.is_active = true']
        const queryParams: any[] = []
        let paramIndex = 1

        if (category) {
            whereConditions.push(`c.slug = $${paramIndex}`)
            queryParams.push(category)
            paramIndex++
        }

        if (minPrice) {
            whereConditions.push(`p.price >= $${paramIndex}`)
            queryParams.push(Number(minPrice))
            paramIndex++
        }

        if (maxPrice) {
            whereConditions.push(`p.price <= $${paramIndex}`)
            queryParams.push(Number(maxPrice))
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

        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

        // Ensure sortOrder is valid and has a default value
        const validSortOrder = sortOrder && ['asc', 'desc'].includes(sortOrder.toLowerCase())
            ? sortOrder.toUpperCase()
            : 'DESC'

        let orderByClause = ''
        switch (sortBy) {
            case 'name':
                orderByClause = `ORDER BY p.name ${validSortOrder}`
                break
            case 'price':
                orderByClause = `ORDER BY p.price ${validSortOrder}`
                break
            case 'popularity':
                orderByClause = `ORDER BY p.view_count ${validSortOrder}`
                break
            case 'rating':
                orderByClause = `ORDER BY p.rating ${validSortOrder}`
                break
            case 'created_at':
            default:
                orderByClause = `ORDER BY p.created_at ${validSortOrder}`
        }

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

        queryParams.push(Number(limit), offset)

        const countQuery = `
        SELECT COUNT(*) as total
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN vendors v ON p.vendor_id = v.id
        ${whereClause}
      `

        const [productsResult, countResult] = await Promise.all([
            query(productsQuery, queryParams),
            query(countQuery, queryParams.slice(0, -2)),
        ])

        const products = productsResult.rows
        const total = Number.parseInt(countResult.rows[0].total)
        const totalPages = Math.ceil(total / Number(limit))

        const result = {
            products,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                totalPages,
                hasNext: Number(page) < totalPages,
                hasPrev: Number(page) > 1,
            },
        }

        // Cache for 5 minutes
        await setCache(cacheKey, result, 300)

        return c.json(result)
    }))

productRouter.get('/:id', asyncHandler(async (c) => {
    const id = c.req.param('id')

    const cacheKey = `product:${id}`
    const cachedProduct = await getCache(cacheKey)
    if (cachedProduct) {
        return c.json(cachedProduct)
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
        return c.json({ error: 'Product not found' }, 404)
    }

    const product = productResult.rows[0]

    // Get product variants
    const variantsResult = await query('SELECT * FROM product_variants WHERE product_id = $1', [id])
    product.variants = variantsResult.rows

    // Increment view count
    await query('UPDATE products SET view_count = view_count + 1 WHERE id = $1', [id])

    // Cache for 10 minutes
    await setCache(cacheKey, product, 600)

    return c.json(product)
}))

productRouter.post('/', authenticateToken, requireVendor, validateRequest({ body: createProductSchema }),
    asyncHandler(async (c) => {
        const productData = await c.req.json()
        const vendorId = c.get('user').vendorId

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
                JSON.stringify(productData.images || []),
                productData.weight,
                JSON.stringify(productData.dimensions || {}),
                productData.isActive ?? true,
            ],
        )

        const product = productResult.rows[0]

        // Create variants if provided
        if (productData.variants && productData.variants.length > 0) {
            for (const variant of productData.variants) {
                await query('INSERT INTO product_variants (product_id, name, value, price_modifier, inventory) VALUES ($1, $2, $3, $4, $5)', [
                    product.id,
                    variant.name,
                    variant.value,
                    variant.priceModifier || 0,
                    variant.inventory || 0,
                ])
            }
        }

        // Create tags if provided
        if (productData.tags && productData.tags.length > 0) {
            for (const tag of productData.tags) {
                await query('INSERT INTO product_tags (product_id, tag) VALUES ($1, $2)', [product.id, tag])
            }
        }

        // Clear related caches
        await Promise.all([
            setCache(`product:${product.id}`, null, 0),
            setCache('products:*', null, 0),
        ])

        return c.json(
            {
                message: 'Product created successfully',
                product,
            },
            201
        )
    })
)

productRouter.put('/:id', authenticateToken, requireVendor,
    validateRequest({ body: updateProductSchema }),
    asyncHandler(async (c) => {
        const id = c.req.param('id')
        const updateData = await c.req.json()
        const vendorId = c.get('user').vendorId

        // Check if product belongs to vendor
        const existingProduct = await query('SELECT id FROM products WHERE id = $1 AND vendor_id = $2', [id, vendorId])

        if (existingProduct.rows.length === 0) {
            return c.json({ error: 'Product not found or access denied' }, 404)
        }

        // Build update query dynamically
        const updateFields = []
        const updateValues = []
        let paramIndex = 1

        // Map of frontend field names to database column names
        const fieldMapping: { [key: string]: string } = {
            categoryId: 'category_id',
            isActive: 'is_active',
            comparePrice: 'compare_price',
            costPrice: 'cost_price',
            isFeatured: 'is_featured',
        }

        Object.entries(updateData).forEach(([key, value]) => {
            if (value !== undefined) {
                const dbColumn = fieldMapping[key] || key

                if (key === 'images' || key === 'dimensions') {
                    updateFields.push(`${dbColumn} = $${paramIndex}`)
                    updateValues.push(JSON.stringify(value))
                } else {
                    updateFields.push(`${dbColumn} = $${paramIndex}`)
                    updateValues.push(value)
                }
                paramIndex++
            }
        })

        if (updateFields.length === 0) {
            return c.json({ error: 'No valid fields to update' }, 400)
        }

        updateFields.push('updated_at = CURRENT_TIMESTAMP')
        updateValues.push(id)

        const updateQuery = `
        UPDATE products 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `

        const result = await query(updateQuery, updateValues)
        const updatedProduct = result.rows[0]

        // Clear caches
        await Promise.all([
            setCache(`product:${id}`, null, 0),
            setCache('products:*', null, 0)
        ])

        return c.json({
            message: 'Product updated successfully',
            product: updatedProduct,
        })
    })
)

productRouter.delete('/:id', authenticateToken, requireVendor,
    asyncHandler(async (c) => {
        const id = c.req.param('id')
        const vendorId = c.get('user').vendorId

        // Check if product belongs to vendor
        const existingProduct = await query('SELECT id FROM products WHERE id = $1 AND vendor_id = $2', [id, vendorId])

        if (existingProduct.rows.length === 0) {
            return c.json({ error: 'Product not found or access denied' }, 404)
        }

        // Soft delete (set is_active to false)
        await query('UPDATE products SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id])

        // Clear caches
        await Promise.all([
            setCache(`product:${id}`, null, 0),
            setCache('products:*', null, 0)
        ])

        return c.json({ message: 'Product deleted successfully' })
    })
)

productRouter.get('/:id/reviews',
    asyncHandler(async (c) => {
        const id = c.req.param('id')
        const page = Number(c.req.query('page')) || 1
        const limit = Number(c.req.query('limit')) || 10
        const offset = (page - 1) * limit

        const reviewsResult = await query(
            `
        SELECT 
          r.*, 
          u.full_name, u.avatar
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        WHERE r.product_id = $1
        ORDER BY r.created_at DESC
        LIMIT $2 OFFSET $3
      `,
            [id, limit, offset],
        )

        const countResult = await query('SELECT COUNT(*) as total FROM reviews WHERE product_id = $1', [id])

        const reviews = reviewsResult.rows
        const total = Number.parseInt(countResult.rows[0].total)

        return c.json({
            reviews,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1,
            },
        })
    })
)