import type { Context, Next } from "hono";
import { verify } from "hono/jwt";

import { query } from "../config/postgresql";
import { logger } from "../utils/logger";
import { env } from "../utils/env";

type AuthVariables = {
	user?: {
		id: string;
		email: string;
		role: string;
		vendorId?: string;
	};
};

export const authenticateToken = async (c: Context, next: Next) => {
	try {
		const authHeader = c.req.header("authorization");
		const token = authHeader && authHeader.split(" ")[1];

		if (!token) {
			return c.json({ message: "Access token required" }, 401);
		}

		const decoded = (await verify(token, env.JWT_SECRET)) as {
			id: string;
		};

		const userResult = await query(
			"SELECT id, email, role, is_active FROM users WHERE id = $1",
			[decoded.id],
		);

		if (userResult.rows.length === 0 || !userResult.rows[0].is_active) {
			return c.json({ message: "Invalid or inactive user" }, 401);
		}

		const user = userResult.rows[0];
		const { id, email, role } = user;
		c.set("user", { id, email, role });

		if (user.role === "vendor") {
			const vendorResult = await query(
				"SELECT id FROM vendors WHERE user_id = $1",
				[id],
			);
			if (vendorResult.rows.length === 0) {
				return c.json({ message: "Vendor not found" }, 404);
			}
			const vendorId = vendorResult.rows[0].id;
			c.set("vendorId", vendorId);
		}

		return next();
	} catch (error) {
		logger.error(error);
		return c.json({ message: "Invalid or expired token" }, 403);
	}
};

export const requireRole = (roles: string[]) => {
	return async (
		c: Context<{ Variables: AuthVariables }>,
		next: () => Promise<void>,
	): Promise<void | Response> => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Authentication required" }, 401);
		}

		if (!roles.includes(user.role)) {
			return c.json({ error: "Insufficient permissions" }, 403);
		}

		await next();
	};
};

export const requireVendor = async (
	c: Context<{ Variables: AuthVariables }>,
	next: () => Promise<void>,
): Promise<void | Response> => {
	const user = c.get("user");
	if (!user || user.role !== "vendor") {
		return c.json({ error: "Vendor access required" }, 403);
	}

	if (!user.vendorId) {
		return c.json({ error: "Vendor profile not found" }, 403);
	}

	await next();
};

export const requireAdmin = async (
	c: Context<{ Variables: AuthVariables }>,
	next: () => Promise<void>,
): Promise<void | Response> => {
	const user = c.get("user");
	if (!user || user.role !== "admin") {
		return c.json({ error: "Admin access required" }, 403);
	}

	await next();
};
