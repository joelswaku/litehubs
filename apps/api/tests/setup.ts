import { afterAll, beforeAll } from "vitest";
import { closeDatabase, query } from "../src/config/database";

/**
 * Every tenancy assertion in this suite depends on row-level security actually
 * being enforced against the connection under test. A superuser, the table
 * owner, or any role with BYPASSRLS skips policies entirely — so those tests
 * would all pass while proving nothing.
 *
 * Checking it once, loudly, is the difference between a suite that guards the
 * tenant boundary and a suite that only looks like it does.
 */
beforeAll(async () => {
  const result = await query<{
    role: string;
    is_superuser: boolean;
    bypasses_rls: boolean;
  }>(
    `SELECT current_user AS role,
            rolsuper   AS is_superuser,
            rolbypassrls AS bypasses_rls
       FROM pg_roles
      WHERE rolname = current_user`,
  );

  const row = result.rows[0];
  if (!row) throw new Error("Could not identify the database role in use");

  if (row.is_superuser || row.bypasses_rls) {
    throw new Error(
      `DATABASE_URL connects as "${row.role}", which bypasses row-level ` +
        "security. Tenancy tests against it would pass without proving " +
        "anything. Point DATABASE_URL at the least-privilege app role " +
        "(npm run db:setup creates it).",
    );
  }
});

afterAll(async () => {
  await closeDatabase();
});
