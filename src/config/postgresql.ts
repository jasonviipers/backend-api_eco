import { Pool, type PoolConfig } from "pg";
import { logger } from "../utils/logger";

let pool: Pool;

export const connectPostgreSQL = async (): Promise<void> => {
	try {
		const config: PoolConfig = {
			host: process.env.POSTGRES_HOST || "localhost",
			port: Number.parseInt(process.env.POSTGRES_PORT || "5432"),
			database: process.env.POSTGRES_DB || "ecommerce_platform",
			user: process.env.POSTGRES_USER || "postgres",
			password: process.env.POSTGRES_PASSWORD || "password",
			max: 20,
			idleTimeoutMillis: 30000,
			connectionTimeoutMillis: 2000,
			ssl:
				process.env.POSTGRES_SSL === "true"
					? {
							rejectUnauthorized: false,
						}
					: false,
		};

		pool = new Pool(config);

		// Test connection
		const client = await pool.connect();
		await client.query("SELECT NOW()");
		client.release();

		logger.info("PostgreSQL connected successfully");
	} catch (error) {
		logger.error("PostgreSQL connection failed:", error);
		throw error;
	}
};

export const getPostgreSQLPool = (): Pool => {
	if (!pool) {
		throw new Error("PostgreSQL pool not initialized");
	}
	return pool;
};

export const query = async (text: string, params?: any[]): Promise<any> => {
	const client = await pool.connect();
	try {
		const result = await client.query(text, params);
		return result;
	} finally {
		client.release();
	}
};
