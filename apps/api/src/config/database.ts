import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";
import { env } from "./env";
import { logger } from "./logger";

export const db = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.isProduction ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// Fires for errors on *idle* clients (e.g. the server dropped the connection).
// Without a handler here Node treats it as an unhandled 'error' and exits.
db.on("error", (error) => {
  logger.error({ err: error }, "Unexpected PostgreSQL client error");
});

db.on("connect", () => {
  logger.debug({ total: db.totalCount }, "PostgreSQL client connected");
});

/** Run a single query against the pool. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[],
): Promise<QueryResult<T>> {
  const startedAt = process.hrtime.bigint();
  try {
    return await db.query<T>(text, params as unknown[] | undefined);
  } finally {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    if (ms > 200) {
      logger.warn({ ms: Math.round(ms), text }, "Slow query");
    }
  }
}

/**
 * Run `handler` inside a transaction, committing on success and rolling back on
 * any thrown error. Always use this for multi-statement writes.
 */
export async function transaction<T>(
  handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch((rollbackError) => {
      logger.error({ err: rollbackError }, "Transaction rollback failed");
    });
    throw error;
  } finally {
    client.release();
  }
}

/** True if the database answers a trivial query. Used by /health. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await db.query("SELECT 1");
    return true;
  } catch (error) {
    logger.error({ err: error }, "Database ping failed");
    return false;
  }
}

/** Throws if the database is unreachable. Called once at startup. */
export async function verifyDatabaseConnection(): Promise<void> {
  const result = await db.query<{ db: string; version: string }>(
    "SELECT current_database() AS db, version() AS version",
  );
  const row = result.rows[0];
  logger.info(
    { database: row?.db, server: row?.version.split(",")[0] },
    "PostgreSQL connected",
  );
}

export async function closeDatabase(): Promise<void> {
  await db.end();
  logger.info("PostgreSQL pool closed");
}
