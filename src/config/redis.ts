import { createClient } from "redis";
import { logger } from "../utils/logger";
import { env } from "../utils/env";

let redisClient: ReturnType<typeof createClient>;

export const connectRedis = async (): Promise<void> => {
	try {
		redisClient = createClient({
			url: env.REDIS_URL,
			password: env.REDIS_PASSWORD,
		});

		redisClient.on("error", (err) => {
			logger.error("Redis Client Error:", err);
		});

		redisClient.on("connect", () => {
			logger.info("Redis connected successfully");
		});

		await redisClient.connect();
	} catch (error) {
		logger.error("Redis connection failed:", error);
		throw error;
	}
};

export const getRedisClient = () => {
	if (!redisClient) {
		throw new Error("Redis client not initialized");
	}
	return redisClient;
};

// Cache utilities
export const setCache = async (
	key: string,
	value: any,
	expireInSeconds?: number,
): Promise<void> => {
	try {
		const stringValue =
			typeof value === "string" ? value : JSON.stringify(value);
		if (expireInSeconds) {
			await redisClient.setEx(key, expireInSeconds, stringValue);
		} else {
			await redisClient.set(key, stringValue);
		}
	} catch (error) {
		logger.error("Redis set error:", error);
	}
};

export const getCache = async (key: string): Promise<any> => {
	try {
		const value = await redisClient.get(key);
		if (!value) return null;

		try {
			return JSON.parse(value);
		} catch {
			return value;
		}
	} catch (error) {
		logger.error("Redis get error:", error);
		return null;
	}
};

export const deleteCache = async (key: string): Promise<void> => {
	try {
		await redisClient.del(key);
	} catch (error) {
		logger.error("Redis delete error:", error);
	}
};
