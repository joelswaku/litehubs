/**
 * Drops the public schema and rebuilds it from migrations and seeds.
 *
 *   npm run db:reset -- --yes
 *   npm run db:reset -- --yes --no-seed
 *
 * Every table, every row, gone. Refuses to run in production, and refuses to
 * run at all without --yes, because there is no undo.
 *
 * Why this exists rather than a patch migration: while the schema is still
 * being shaped, retrofitting a change onto an applied migration leaves a seam
 * in the foundation forever. Resetting is one command and yields a clean
 * schema — see structure.md §5. Once real customer data exists, this script
 * stops being the answer and forward migrations become the only option.
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const confirmed = process.argv.includes("--yes");
const skipSeed = process.argv.includes("--no-seed");

function run(script: string, args: string[] = []): void {
  const result = spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs"),
      path.resolve(__dirname, script),
      ...args,
    ],
    { stdio: "inherit" },
  );

  if (result.status !== 0) {
    throw new Error(`${script} exited with code ${result.status}`);
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to reset a production database.");
    process.exit(1);
  }

  if (!confirmed) {
    console.error(
      "This drops every table and every row in the database.\n" +
        "Re-run with --yes if that is what you want:\n\n" +
        "  npm run db:reset -- --yes\n",
    );
    process.exit(1);
  }

  const databaseUrl =
    process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "DATABASE_ADMIN_URL (or DATABASE_URL) is not set (expected in apps/.env)",
    );
    process.exit(1);
  }

  const database = new URL(databaseUrl).pathname.replace(/^\//, "");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    console.log(`Dropping the public schema of "${database}"...`);
    // CASCADE takes the tables, views, functions and policies with it. The
    // app role survives — it is a cluster-level object, not a schema one — but
    // its grants do not, which is why db:setup runs again below.
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }

  // Re-grants the app role's privileges on the newly created schema.
  console.log("\nRecreating the app role's grants...");
  run("setup-database.ts");

  console.log("\nApplying migrations...");
  run("migrate.ts");

  if (skipSeed) {
    console.log("\nSkipping seeds (--no-seed).");
  } else {
    console.log("\nSeeding...");
    run("seed.ts");
  }

  console.log(
    "\nDatabase reset.\n" +
      '  next: npm run create:platform-admin -- --email you@example.com --name "Your Name"\n' +
      '        npm run create:organization    -- --slug my-company --name "My Company" \\\n' +
      '                                         --owner-email you@example.com --owner-name "Your Name"\n',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
