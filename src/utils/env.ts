import { z } from "zod";

const envSchema = {
	// Server Configuration
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	PORT: z.coerce.number().default(5000),
	CLIENT_URL: z.string().url().default("http://localhost:3000"),
	APP_URL: z.string().url(),
	APP_NAME: z.string().optional(),
	SUPPORT_EMAIL: z.string().email().optional(),

	// Database Configuration
	POSTGRES_HOST: z.string().default("localhost"),
	POSTGRES_PORT: z.coerce.number().default(5432),
	POSTGRES_DB: z.string().default("ecommerce_platform"),
	POSTGRES_USER: z.string().default("postgres"),
	POSTGRES_PASSWORD: z.string().default("password"),
	POSTGRES_SSL: z
		.enum(["true", "false"])
		.default("false")
		.transform((val) => val === "true"),

	// Cassandra Configuration
	CASSANDRA_HOST: z.string().default("cassandra"),
	CASSANDRA_DATACENTER: z.string().default("datacenter1"),
	CASSANDRA_KEYSPACE: z.string().default("ecommerce_analytics"),
	CASSANDRA_USERNAME: z.string().default("cassandra"),
	CASSANDRA_PASSWORD: z.string().default("cassandra"),

	// Redis Configuration
	REDIS_URL: z.string().default("redis://localhost:6379"),
	REDIS_PASSWORD: z.string().optional(),

	// JWT Configuration
	JWT_SECRET: z.string().min(1, "JWT secret is required"),
	JWT_REFRESH_SECRET: z.string().min(1, "JWT refresh secret is required"),
	JWT_EXPIRATION_TIME: z.string().optional(),

	// Email Configuration
	SMTP_HOST: z.string().default("smtp.gmail.com"),
	SMTP_PORT: z.coerce.number().default(587),
	SMTP_USER: z.string().email().min(1, "SMTP username is required"),
	SMTP_PASS: z.string().min(1, "SMTP password is required"),
	FROM_EMAIL: z.string().email().min(1, "From email is required"),

	// Cloudinary Configuration
	CLOUDINARY_CLOUD_NAME: z.string().min(1, "Cloudinary cloud name is required"),
	CLOUDINARY_API_KEY: z.string().min(1, "Cloudinary API key is required"),
	CLOUDINARY_API_SECRET: z.string().min(1, "Cloudinary API secret is required"),

	// Stripe Configuration
	STRIPE_SECRET_KEY: z.string().min(1, "Stripe secret key is required"),
	STRIPE_WEBHOOK_SECRET: z.string().min(1, "Stripe webhook secret is required"),

	// Media Server Configuration
	RTMP_PORT: z.coerce.number().default(1935),
	MEDIA_HTTP_PORT: z.coerce.number().default(8000),
	RTMP_SECRET: z.string().default("supersecret"),

	// Logging
	LOG_LEVEL: z
		.enum(["error", "warn", "info", "http", "verbose", "debug", "silly"])
		.default("info"),
};

export type EnvSchema = typeof envSchema;

export const validateEnv = () => {
	const schema = z.object(envSchema);
	const result: Record<string, any> = {};

	for (const [key, validator] of Object.entries(envSchema)) {
		try {
			result[key] = validator.parse(Bun.env[key]);
		} catch (error) {
			console.error(`Environment validation error for ${key}:`, error);
			throw error;
		}
	}

	return result as z.infer<typeof schema>;
};

export const env = validateEnv();
