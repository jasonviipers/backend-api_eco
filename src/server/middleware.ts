import { Hono } from "hono";
import { poweredBy } from "hono/powered-by";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import { rateLimiter } from "../middleware/rateLimiter";
import { env } from "../utils/env";

export function registerGlobalMiddleware(app: Hono) {
	app.use("*", poweredBy());
	app.use("*", secureHeaders());
	app.use(
		"*",
		cors({
			origin: env.CLIENT_URL?.split(","),
			credentials: true,
			allowHeaders: ["Content-Type", "Authorization"],
			allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		}),
	);
	app.use("*", rateLimiter);
	app.use("*", async (c, next) => {
		if (["POST", "PUT"].includes(c.req.method)) {
			try {
				const body = await c.req.json();
				c.req.addValidatedData("json", body);
			} catch {
				return c.json({ error: "Invalid JSON body" }, 400);
			}
		}
		await next();
	});
}
