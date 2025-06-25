import { getCache, setCache } from "../config/redis";
import { err, ok, Result } from "./result";

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	resetTime: number;
	totalHits: number;
}

export interface RateLimitOptions {
	maxAttempts: number;
	windowMs: number;
	keyPrefix?: string;
}

export const rateLimiter = async (
	identifier: string,
	options: RateLimitOptions,
): Promise<Result<RateLimitResult, Error>> => {
	try {
		const { maxAttempts, windowMs, keyPrefix = "rl" } = options;
		const key = `${keyPrefix}:${identifier}`;

		const now = Date.now();
		const resetTime = now + windowMs;

		// Get current hits
		const cached = await getCache(key);
		const hits = cached ? parseInt(cached) : 0;

		if (hits >= maxAttempts) {
			return ok({
				allowed: false,
				remaining: 0,
				resetTime,
				totalHits: hits,
			});
		}

		// Increment hits
		const newHits = hits + 1;
		await setCache(key, newHits.toString(), Math.ceil(windowMs / 1000));

		return ok({
			allowed: true,
			remaining: Math.max(0, maxAttempts - newHits),
			resetTime,
			totalHits: newHits,
		});
	} catch (error) {
		return err(error instanceof Error ? error : new Error("Rate limit error"));
	}
};

export const passwordResetRateLimit = async (
	email: string,
): Promise<Result<RateLimitResult, Error>> => {
	const options: RateLimitOptions = {
		maxAttempts: 3,
		windowMs: 60 * 60 * 1000, // 1 hour
		keyPrefix: "password_reset",
	};
	return await rateLimiter(email, options);
};

export const loginRateLimit = async (
	ip: string,
): Promise<Result<RateLimitResult, Error>> => {
	const options: RateLimitOptions = {
		maxAttempts: 5,
		windowMs: 15 * 60 * 1000, // 15 minutes
		keyPrefix: "login",
	};
	return await rateLimiter(ip, options);
};

export const otpRateLimit = async (
	email: string,
	type: "verification" | "reset",
): Promise<Result<RateLimitResult, Error>> => {
	const options: RateLimitOptions = {
		maxAttempts: 3,
		windowMs: 15 * 60 * 1000, // 15 minutes
		keyPrefix: type === "verification" ? "otp_verification" : "otp_reset",
	};
	return await rateLimiter(email, options);
};
