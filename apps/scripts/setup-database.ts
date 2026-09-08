/**
 * Creates the least-privilege role the API connects as.
 *
 *   npm run db:setup
 *
 * Why this exists: PostgreSQL **superusers bypass row-level security entirely**,
 * and so do roles with BYPASSRLS. If the API connected as `postgres`, every RLS
 * policy in this schema would be silently inert and tenant isolation would rest
 * on nothing but remembering a WHERE clause.
 *
 * So there are two connection strings:
 *   DATABASE_ADMIN_URL - superuser. Owns the schema. Used by migrate/seed/this.
 *   DATABASE_URL       - the app role. No superuser, no BYPASSRLS, no CREATE.
 *
 * Idempotent: safe to re-run after adding tables (it re-grants).
 */
import path from "node:path";
import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

interface AppCredentials {
  user: string;
  password: string;
  database: string;
}

function parseAppUrl(raw: string): AppCredentials {
  const url = new URL(raw);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const database = url.pathname.slice(1);

  if (!user || !password || !database) {
    throw new Error(
      "DATABASE_URL must include a username, password and database name",
    );
  }
  return { user, password, database };
}

/** Doubles any embedded quote so the literal cannot break out. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function main(): Promise<void> {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  const appUrl = process.env.DATABASE_URL;

  if (!adminUrl || !appUrl) {
    console.error(
      "Both DATABASE_ADMIN_URL and DATABASE_URL must be set in apps/.env",
    );
    process.exit(1);
  }

  const app = parseAppUrl(appUrl);
  const adminDatabase = new URL(adminUrl).pathname.slice(1);

  if (adminDatabase !== app.database) {
    console.error(
      `DATABASE_ADMIN_URL points at "${adminDatabase}" but DATABASE_URL at "${app.database}" — they must be the same database`,
    );
    process.exit(1);
  }

  const client = new Client({ connectionString: adminUrl });
  await client.connect();

  try {
    const existing = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [app.user],
    );

    const ident = quoteIdent(app.user);
    const secret = quoteLiteral(app.password);

    if (existing.rowCount === 0) {
      await client.query(
        `CREATE ROLE ${ident} LOGIN PASSWORD ${secret}
           NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT`,
      );
      console.log(`  created role ${app.user}`);
    } else {
      // Keep the password in step with .env, and re-assert the safety flags.
      await client.query(
        `ALTER ROLE ${ident} LOGIN PASSWORD ${secret}
           NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
      );
      console.log(
        `  role ${app.user} already existed — password and flags reset`,
      );
    }

    await client.query(
      `GRANT CONNECT ON DATABASE ${quoteIdent(app.database)} TO ${ident}`,
    );
    await client.query(`GRANT USAGE ON SCHEMA public TO ${ident}`);

    // The app reads and writes rows; it never changes the schema.
    await client.query(`REVOKE CREATE ON SCHEMA public FROM ${ident}`);

    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ident}`,
    );
    await client.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ident}`,
    );
    await client.query(
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${ident}`,
    );

    // Cover tables created by future migrations without re-running this.
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public
         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ident}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public
         GRANT USAGE, SELECT ON SEQUENCES TO ${ident}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public
         GRANT EXECUTE ON FUNCTIONS TO ${ident}`,
    );

    const check = await client.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1", [
      app.user,
    ]);
    const row = check.rows[0];

    if (!row || row.rolsuper || row.rolbypassrls) {
      console.error(
        `  ${app.user} can still bypass RLS — refusing to report success`,
      );
      process.exit(1);
    }

    console.log(`  ${app.user}: rolsuper=false rolbypassrls=false`);
    console.log("Done — RLS policies will apply to the API connection.");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
