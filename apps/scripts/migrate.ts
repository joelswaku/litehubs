/**
 * Applies database/migrations/*.sql in filename order, once each.
 *
 *   npm run db:migrate            apply everything pending
 *   npm run db:migrate -- --status just report what is pending
 *
 * Each file runs inside its own transaction, so a failure leaves no partial
 * migration behind. Applied files are checksummed: editing a migration that
 * has already run is reported as an error rather than silently ignored.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const MIGRATIONS_DIR = path.resolve(__dirname, "../database/migrations");
const statusOnly = process.argv.includes("--status");

// 064 originally granted a function to litehubs_app unconditionally. That
// prevented a first Railway migration before db:setup had created the
// least-privilege role. Existing databases may have the old, semantically
// compatible migration checksum, so accept only this exact audited transition.
const approvedChecksumTransitions = new Map([
  [
    "018_pig_operations.sql",
    {
      // The original version inserted preset grants with literal role codes.
      // It failed on installations that had not provisioned every role preset.
      // The current idempotent SELECT-from-role_presets form was reviewed and
      // applied only to the migration record, never re-run against production.
      from: new Set([
        "e646bc39e8bb775f7ba2be478a1154b2120279c3e3b13dd5031ad1345ed66b96",
      ]),
      to: "a91fb1f573a93dfdbf4b9f57161daf67cbb0f324536c00fed3854bfde43d48f9",
    },
  ],
  [
    "064_notification_centre.sql",
    {
      from: new Set([
        "dd767ea771ac3b4806d0f70c2289c64cef680056b14d83533b13c48f5e0caa3c",
      ]),
      to: "f8e1804ebf0866531d077422892ac7e4377c8ee60f78aa8355ffd8630ca770d3",
    },
  ],
]);

interface AppliedRow {
  filename: string;
  checksum: string;
}

function checksum(contents: string): string {
  // Normalise line endings so a CRLF checkout does not look like a change.
  return crypto
    .createHash("sha256")
    .update(contents.replace(/\r\n/g, "\n"))
    .digest("hex");
}

async function main(): Promise<void> {
  // Migrations create and own schema objects, so they run as the admin role.
  // The app role deliberately has no CREATE privilege.
  const databaseUrl =
    process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "DATABASE_ADMIN_URL (or DATABASE_URL) is not set (expected in apps/.env)",
    );
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename     text PRIMARY KEY,
        checksum     text NOT NULL,
        applied_at   timestamptz NOT NULL DEFAULT now(),
        execution_ms integer NOT NULL
      )
    `);

    const applied = new Map<string, string>();
    const appliedResult = await client.query<AppliedRow>(
      "SELECT filename, checksum FROM schema_migrations",
    );
    for (const row of appliedResult.rows) {
      applied.set(row.filename, row.checksum);
    }

    const files = (await fs.readdir(MIGRATIONS_DIR))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.log("No migration files found.");
      return;
    }

    const pending: string[] = [];
    const drifted: string[] = [];

    for (const file of files) {
      const contents = await fs.readFile(
        path.join(MIGRATIONS_DIR, file),
        "utf8",
      );
      // An empty scaffolded file is not a migration; skip until written.
      if (contents.trim() === "") continue;

      const previous = applied.get(file);
      if (previous === undefined) {
        pending.push(file);
        continue;
      }

      const currentChecksum = checksum(contents);
      const approvedTransition = approvedChecksumTransitions.get(file);
      const isApprovedTransition =
        approvedTransition?.to === currentChecksum &&
        approvedTransition.from.has(previous);

      if (previous !== currentChecksum && !isApprovedTransition) {
        drifted.push(file);
      }
    }

    if (drifted.length > 0) {
      console.error(
        `These migrations changed after being applied:\n${drifted
          .map((f) => `  - ${f}`)
          .join("\n")}\n` +
          "Write a new migration instead of editing an applied one.",
      );
      process.exit(1);
    }

    if (statusOnly) {
      console.log(`applied: ${applied.size}`);
      console.log(`pending: ${pending.length}`);
      for (const file of pending) console.log(`  - ${file}`);
      return;
    }

    if (pending.length === 0) {
      console.log(`Up to date — ${applied.size} migration(s) already applied.`);
      return;
    }

    for (const file of pending) {
      const contents = await fs.readFile(
        path.join(MIGRATIONS_DIR, file),
        "utf8",
      );
      const startedAt = Date.now();

      await client.query("BEGIN");
      try {
        await client.query(contents);
        const elapsed = Date.now() - startedAt;
        await client.query(
          `INSERT INTO schema_migrations (filename, checksum, execution_ms)
           VALUES ($1, $2, $3)`,
          [file, checksum(contents), elapsed],
        );
        await client.query("COMMIT");
        console.log(`  applied ${file} (${elapsed} ms)`);
      } catch (error) {
        await client.query("ROLLBACK");
        console.error(`  FAILED  ${file}`);
        throw error;
      }
    }

    console.log(`Done — ${pending.length} migration(s) applied.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exit(1);
});
