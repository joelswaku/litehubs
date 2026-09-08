/**
 * Applies database/seeds/*.sql. Unlike migrations these are re-runnable, so
 * every seed file must be written idempotently (ON CONFLICT ... DO NOTHING or
 * DO UPDATE).
 *
 *   npm run db:seed                  apply every seed file
 *   npm run db:seed -- roles.sql     apply just one
 *
 * Order matters: roles and permissions come before the grants that reference
 * them, which filename order already gives us.
 */
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const SEEDS_DIR = path.resolve(__dirname, "../database/seeds");

// Seeds whose rows other seeds depend on, applied first and in this order.
// industries before role presets (FK), permissions before role presets (FK).
const PRIORITY = [
  "industries.sql",
  "platform-permissions.sql",
  "platform-roles.sql",
  "permissions.sql",
  "role-presets.sql",
];

async function main(): Promise<void> {
  // Seeds write platform-level catalogue rows and must not be filtered by the
  // tenant RLS policies, so they run as the admin role.
  const databaseUrl =
    process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "DATABASE_ADMIN_URL (or DATABASE_URL) is not set (expected in apps/.env)",
    );
    process.exit(1);
  }

  const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));

  const available = (await fs.readdir(SEEDS_DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const unknown = requested.filter((name) => !available.includes(name));
  if (unknown.length > 0) {
    console.error(`No such seed file: ${unknown.join(", ")}`);
    process.exit(1);
  }

  const selected = requested.length > 0 ? requested : available;
  const ordered = [
    ...PRIORITY.filter((name) => selected.includes(name)),
    ...selected.filter((name) => !PRIORITY.includes(name)),
  ];

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  let appliedCount = 0;
  let skippedCount = 0;

  try {
    for (const file of ordered) {
      const contents = await fs.readFile(path.join(SEEDS_DIR, file), "utf8");
      // Most seed files are still empty scaffolding.
      if (contents.trim() === "") {
        skippedCount++;
        continue;
      }

      const startedAt = Date.now();
      await client.query("BEGIN");
      try {
        await client.query(contents);
        await client.query("COMMIT");
        appliedCount++;
        console.log(`  seeded ${file} (${Date.now() - startedAt} ms)`);
      } catch (error) {
        await client.query("ROLLBACK");
        console.error(`  FAILED ${file}`);
        throw error;
      }
    }

    console.log(
      `Done — ${appliedCount} seed file(s) applied, ${skippedCount} empty file(s) skipped.`,
    );
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
