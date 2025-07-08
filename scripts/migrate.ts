import { readFileSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import { env } from "../src/utils/env";
import { logger } from "../src/utils/logger";

interface MigrationConfig {
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
	ssl?: { rejectUnauthorized: boolean };
}

class DatabaseMigrator {
	private pool: Pool;
	private schemaPath: string;

	constructor() {
		const config: MigrationConfig = {
			host: env.POSTGRES_HOST,
			port: env.POSTGRES_PORT,
			database: env.POSTGRES_DB,
			user: env.POSTGRES_USER,
			password: env.POSTGRES_PASSWORD,
			ssl: env.POSTGRES_SSL ? { rejectUnauthorized: false } : undefined,
		};

		this.pool = new Pool({
			...config,
			max: 5,
			idleTimeoutMillis: 30000,
			connectionTimeoutMillis: 5000,
		});

		this.schemaPath = join(__dirname, "../src/db/postgresql-schema.sql");
	}

	private async testConnection(): Promise<void> {
		try {
			const client = await this.pool.connect();
			await client.query("SELECT NOW()");
			client.release();
			logger.info("Database connection successful");
		} catch (error) {
			logger.error("Database connection failed:", error);
			throw new Error("Unable to connect to database");
		}
	}

	private readSchemaFile(): string {
		try {
			const schema = readFileSync(this.schemaPath, "utf8");
			logger.info(`Schema file loaded from: ${this.schemaPath}`);
			return schema;
		} catch (error) {
			logger.error(`Failed to read schema file: ${this.schemaPath}`, error);
			throw new Error("Unable to read schema file");
		}
	}

	private splitStatements(sql: string): string[] {
		// Remove comments and empty lines
		const cleanSql = sql
			.split("\n")
			.filter(line => {
				const trimmed = line.trim();
				return trimmed && !trimmed.startsWith("--");
			})
			.join("\n");

		// Split by semicolon but be careful with function definitions
		const statements: string[] = [];
		let currentStatement = "";
		let inFunction = false;
		let dollarQuoteTag = "";

		const lines = cleanSql.split("\n");
		
		for (const line of lines) {
			const trimmedLine = line.trim();
			
			// Check for dollar-quoted strings (used in functions)
			const dollarQuoteMatch = trimmedLine.match(/\$([^$]*)\$/);
			if (dollarQuoteMatch) {
				if (!inFunction) {
					inFunction = true;
					dollarQuoteTag = dollarQuoteMatch[0];
				} else if (trimmedLine.includes(dollarQuoteTag)) {
					inFunction = false;
					dollarQuoteTag = "";
				}
			}

			currentStatement += line + "\n";

			// If we hit a semicolon and we're not in a function, end the statement
			if (trimmedLine.endsWith(";") && !inFunction) {
				const statement = currentStatement.trim();
				if (statement) {
					statements.push(statement);
				}
				currentStatement = "";
			}
		}

		// Add any remaining statement
		if (currentStatement.trim()) {
			statements.push(currentStatement.trim());
		}

		return statements.filter(stmt => stmt.length > 0);
	}

	private async executeStatement(statement: string): Promise<void> {
		const client = await this.pool.connect();
		try {
			await client.query(statement);
		} finally {
			client.release();
		}
	}

	private async checkIfTableExists(tableName: string): Promise<boolean> {
		const client = await this.pool.connect();
		try {
			const result = await client.query(
				"SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)",
				[tableName]
			);
			return result.rows[0].exists;
		} finally {
			client.release();
		}
	}

	private async createMigrationsTable(): Promise<void> {
		const createMigrationsTable = `
			CREATE TABLE IF NOT EXISTS migrations (
				id SERIAL PRIMARY KEY,
				name VARCHAR(255) NOT NULL UNIQUE,
				executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`;

		await this.executeStatement(createMigrationsTable);
		logger.info("Migrations table created/verified");
	}

	private async isMigrationExecuted(migrationName: string): Promise<boolean> {
		const client = await this.pool.connect();
		try {
			const result = await client.query(
				"SELECT EXISTS (SELECT 1 FROM migrations WHERE name = $1)",
				[migrationName]
			);
			return result.rows[0].exists;
		} finally {
			client.release();
		}
	}

	private async recordMigration(migrationName: string): Promise<void> {
		await this.executeStatement(
			"INSERT INTO migrations (name) VALUES ($1)"
		);
		await this.pool.query("INSERT INTO migrations (name) VALUES ($1)", [migrationName]);
	}

	public async migrate(): Promise<void> {
		const migrationName = "initial_schema";

		try {
			logger.info("Starting database migration...");

			// Test connection
			await this.testConnection();

			// Create migrations table
			await this.createMigrationsTable();

			// Check if migration already executed
			const alreadyExecuted = await this.isMigrationExecuted(migrationName);
			if (alreadyExecuted) {
				logger.info("Migration already executed, skipping...");
				return;
			}

			// Read and parse schema file
			const schema = this.readSchemaFile();
			const statements = this.splitStatements(schema);

			logger.info(`Executing ${statements.length} SQL statements...`);

			// Execute statements in transaction
			const client = await this.pool.connect();
			try {
				await client.query("BEGIN");

				for (let i = 0; i < statements.length; i++) {
					const statement = statements[i];
					try {
						logger.info(`Executing statement ${i + 1}/${statements.length}`);
						await client.query(statement);
					} catch (error) {
						logger.error(`Error executing statement ${i + 1}:`, statement.substring(0, 100));
						throw error;
					}
				}

				// Record migration
				await client.query("INSERT INTO migrations (name) VALUES ($1)", [migrationName]);
				
				await client.query("COMMIT");
				logger.info("Migration completed successfully!");

			} catch (error) {
				await client.query("ROLLBACK");
				throw error;
			} finally {
				client.release();
			}

		} catch (error) {
			logger.error("Migration failed:", error);
			throw error;
		} finally {
			await this.pool.end();
		}
	}

	public async rollback(): Promise<void> {
		logger.info("Starting rollback...");
		
		try {
			await this.testConnection();

			const client = await this.pool.connect();
			try {
				await client.query("BEGIN");

				// Get list of all tables to drop
				const tablesResult = await client.query(`
					SELECT tablename FROM pg_tables 
					WHERE schemaname = 'public' 
					AND tablename != 'migrations'
				`);

				const tables = tablesResult.rows.map(row => row.tablename);
				
				// Drop all tables
				for (const table of tables) {
					await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
					logger.info(`Dropped table: ${table}`);
				}

				// Remove migration record
				await client.query("DELETE FROM migrations WHERE name = 'initial_schema'");

				await client.query("COMMIT");
				logger.info("Rollback completed successfully!");

			} catch (error) {
				await client.query("ROLLBACK");
				throw error;
			} finally {
				client.release();
			}

		} catch (error) {
			logger.error("Rollback failed:", error);
			throw error;
		} finally {
			await this.pool.end();
		}
	}

	public async status(): Promise<void> {
		try {
			await this.testConnection();

			const client = await this.pool.connect();
			try {
				// Check if migrations table exists
				const migrationsExists = await this.checkIfTableExists("migrations");
				
				if (!migrationsExists) {
					logger.info("No migrations have been run yet");
					return;
				}

				// Get migration status
				const result = await client.query("SELECT * FROM migrations ORDER BY executed_at");
				
				if (result.rows.length === 0) {
					logger.info("No migrations have been executed");
				} else {
					logger.info("Migration history:");
					result.rows.forEach(row => {
						logger.info(`- ${row.name} (executed: ${row.executed_at})`);
					});
				}

				// Check table count
				const tablesResult = await client.query(`
					SELECT COUNT(*) as count FROM information_schema.tables 
					WHERE table_schema = 'public' AND table_name != 'migrations'
				`);
				
				logger.info(`Total tables: ${tablesResult.rows[0].count}`);

			} finally {
				client.release();
			}

		} catch (error) {
			logger.error("Status check failed:", error);
			throw error;
		} finally {
			await this.pool.end();
		}
	}
}

// CLI Interface
async function main() {
	const args = process.argv.slice(2);
	const command = args[0] || "migrate";

	const migrator = new DatabaseMigrator();

	try {
		switch (command) {
			case "migrate":
			case "up":
				await migrator.migrate();
				break;
			case "rollback":
			case "down":
				await migrator.rollback();
				break;
			case "status":
				await migrator.status();
				break;
			default:
				console.log("Usage:");
				console.log("  bun run scripts/migrate.ts [migrate|rollback|status]");
				console.log("");
				console.log("Commands:");
				console.log("  migrate, up    - Run pending migrations");
				console.log("  rollback, down - Rollback all migrations");
				console.log("  status         - Show migration status");
				process.exit(1);
		}
	} catch (error) {
		logger.error("Migration script failed:", error);
		process.exit(1);
	}
}

// Run if called directly
if (import.meta.main) {
	main();
}