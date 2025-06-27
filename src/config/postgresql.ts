import { Pool, type PoolConfig } from "pg";
import { logger } from "../utils/logger";
import { env } from "../utils/env";

let pool: Pool;

export const connectPostgreSQL = async (): Promise<void> => {
	try {
		const config: PoolConfig = {
			host: env.POSTGRES_HOST,
			port: env.POSTGRES_PORT,
			database: env.POSTGRES_DB,
			user: env.POSTGRES_USER,
			password: env.POSTGRES_PASSWORD,
			max: 20,
			idleTimeoutMillis: 30000,
			connectionTimeoutMillis: 2000,
			ssl: env.POSTGRES_SSL ? { rejectUnauthorized: false } : undefined,
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
