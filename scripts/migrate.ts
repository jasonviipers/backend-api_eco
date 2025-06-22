import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "../src/utils/logger";
import { connectPostgreSQL, query } from "../src/config/postgresql";


function splitSQLStatements(sql: string): string[] {
    const statements: string[] = [];
    let currentStatement = '';
    let inFunction = false;
    let inDollarQuote = false;
    let dollarTag = '';

    for (const line of sql.split('\n')) {
        // Check for function start
        if (line.trim().startsWith('CREATE OR REPLACE FUNCTION') && !inFunction) {
            inFunction = true;
        }

        // Check for dollar quote start
        if (line.includes('$$') && !inDollarQuote) {
            inDollarQuote = true;
            const match = line.match(/\$([^\$]*)\$/);
            dollarTag = match ? match[1] : '';
        } else if (line.includes('$$') && inDollarQuote && line.includes(`$$${dollarTag}$$`)) {
            inDollarQuote = false;
        }

        currentStatement += line + '\n';

        // Only split on semicolons when not in a function or dollar-quoted block
        if (line.trim().endsWith(';') && !inFunction && !inDollarQuote) {
            statements.push(currentStatement.trim());
            currentStatement = '';
        }

        // Check for function end
        if (inFunction && line.trim() === '$$ language \'plpgsql\';') {
            inFunction = false;
            statements.push(currentStatement.trim());
            currentStatement = '';
        }
    }

    if (currentStatement.trim()) {
        statements.push(currentStatement.trim());
    }

    return statements.filter(statement => statement.length > 0);
}

async function runPostgreSQLMigrations() {
    try {
        const sql = await readFile(join(__dirname, "../src/db/postgresql-schema.sql"), "utf8");
        const statements = splitSQLStatements(sql);

        for (const statement of statements) {
            try {
                await query(statement);
                logger.info(`Executed PostgreSQL statement: ${statement.split("\n")[0].substring(0, 50)}...`);
            } catch (error) {
                if (error instanceof Error)
                    logger.error(`Error executing PostgreSQL statement: ${error.message}`);
                logger.debug(`Failed statement: ${statement}`);
            }
        }

        logger.info("PostgreSQL migrations completed successfully");
    } catch (error) {
        logger.error("PostgreSQL migration failed:", error);
        throw error;
    }
}

async function migrate() {
    try {
        logger.info("Starting database migrations...");

        // Connect to databases
        await connectPostgreSQL();
        // await connectCassandra();

        // Run migrations
        await runPostgreSQLMigrations();
        // await runCassandraMigrations();

        logger.info("All database migrations completed successfully");
        process.exit(0);
    } catch (error) {
        logger.error("Migration failed:", error);
        process.exit(1);
    }
}

migrate();