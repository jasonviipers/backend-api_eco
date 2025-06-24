import { getRedisClient } from "../config/redis";
import { logger } from "../utils/logger";

// Rate limiter configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // Max requests per window
const RATE_LIMIT_SKIP_PATHS = ["/health"]; // Paths to exclude from rate limiting

export const rateLimiter = async (c: any, next: Function) => {
	// Skip rate limiting for certain paths
	if (RATE_LIMIT_SKIP_PATHS.includes(c.req.path)) {
		return next();
	}

	const ip =
		c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
	const redis = getRedisClient();
	const key = `rate_limit:${ip}`;

	try {
		const current = await redis.get(key);
		const currentCount = current ? parseInt(current) : 0;

		if (currentCount >= RATE_LIMIT_MAX_REQUESTS) {
			logger.warn(`Rate limit exceeded for IP: ${ip}`);
			return c.json(
				{ error: "Too many requests, please try again later" },
				429,
			);
		}

		// Increment the count
		await redis
			.multi()
			.incr(key)
			.expire(key, RATE_LIMIT_WINDOW_MS / 1000)
			.exec();

		// Add rate limit headers to response
		c.header("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS.toString());
		c.header(
			"X-RateLimit-Remaining",
			(RATE_LIMIT_MAX_REQUESTS - currentCount - 1).toString(),
		);
		c.header(
			"X-RateLimit-Reset",
			(Math.floor(Date.now() / 1000) + RATE_LIMIT_WINDOW_MS / 1000).toString(),
		);

		return next();
	} catch (error) {
		logger.error("Rate limiter error:", error);
		// Fail open - allow the request if Redis fails
		return next();
	}
};
