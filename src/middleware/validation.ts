import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError, type ZodSchema } from "zod";

export const validateRequest = (schema: {
	body?: ZodSchema;
	query?: ZodSchema;
	params?: ZodSchema;
}) => {
	return async (c: Context, next: Next): Promise<void> => {
		try {
			if (schema.body) {
				const body = await c.req.json().catch(() => ({}));
				const validatedBody = schema.body.parse(body);
				c.set("validatedBody", validatedBody);
			}

			if (schema.query) {
				const query = Object.fromEntries(
					new URL(c.req.url).searchParams.entries(),
				);
				const validatedQuery = schema.query.parse(query);
				c.set("validatedQuery", validatedQuery);
			}

			if (schema.params) {
				const params = c.req.param();
				const validatedParams = schema.params.parse(params);
				c.set("validatedParams", validatedParams);
			}

			await next();
		} catch (error) {
			if (error instanceof ZodError) {
				const errorMessages = error.errors.map((err) => ({
					field: err.path.join("."),
					message: err.message,
				}));

				throw new HTTPException(400, {
					message: JSON.stringify({
						error: "Validation failed",
						details: errorMessages,
					}),
				});
			}
			throw error;
		}
	};
};

// Utility functions to get validated data from context
export const getValidatedBody = <T>(c: Context): T => {
	return c.get("validatedBody") as T;
};

export const getValidatedQuery = <T>(c: Context): T => {
	return c.get("validatedQuery") as T;
};

export const getValidatedParams = <T>(c: Context): T => {
	return c.get("validatedParams") as T;
};

// Usage example with type safety:
/*
import { Hono } from 'hono'
import { z } from 'zod'
import { validateRequest, getValidatedBody, getValidatedParams } from './validation'

const app = new Hono()

// Define schemas
const createUserSchema = {
  body: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    age: z.number().min(0)
  }),
  params: z.object({
    id: z.string()
  })
}

// Use validation middleware
app.post('/users/:id', 
  validateRequest(createUserSchema),
  (c) => {
    // Get validated data with type safety
    const body = getValidatedBody<z.infer<typeof createUserSchema.body>>(c)
    const params = getValidatedParams<z.infer<typeof createUserSchema.params>>(c)
    
    return c.json({ 
      message: 'User created',
      data: { body, params }
    })
  }
)

// Alternative: Direct usage without storing in context
app.put('/users/:id',
  validateRequestBuiltIn({
    body: z.object({
      name: z.string(),
      email: z.string().email()
    })
  }),
  async (c) => {
    // Re-parse if needed (data is already validated)
    const body = await c.req.json()
    return c.json({ message: 'User updated', data: body })
  }
)
*/
