/**
 * Audits the schema for the tenant-isolation rules in structure.md §4.
 *
 *   npm run db:check-isolation
 *
 * Exits non-zero on any finding, so it can gate CI. This exists because the
 * rules are invisible at the call site: a developer adding a table gets no
 * feedback that they forgot `enable_tenant_rls` or wrote a single-column
 * foreign key, and the symptom is one company reading another's data — the
 * exact failure that no amount of later testing reliably surfaces.
 *
 * What it deliberately does NOT flag:
 *
 *   - `UNIQUE (id)` and other all-uuid keys. A uuid is globally unique, so it
 *     cannot collide across tenants. §4.3 is about *business* keys — a site
 *     code, a SKU — where the second company must be free to reuse "MAIN".
 *   - Platform-plane tables. `users`, `refresh_tokens`, `platform_roles`,
 *     `industries` and friends are global by design (§4.5): a session belongs
 *     to a person, not to a company.
 */
import path from "node:path";
import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

/**
 * Tables that are global on purpose. Anything not listed here and lacking an
 * `organization_id` is reported, so a new unscoped table cannot slip in
 * unnoticed — the list is the allowlist, not a suppression.
 */
const PLATFORM_TABLES = new Set([
  "schema_migrations",
  "users",
  "refresh_tokens",
  "password_reset_tokens",
  "platform_roles",
  "platform_permissions",
  "platform_role_permissions",
  "user_platform_roles",
  "permissions",
  "role_presets",
  "role_preset_permissions",
  "industries",
]);

/** Tenant tables whose tenant key is `id` rather than `organization_id`. */
const TENANT_ROOTS = new Set(["organizations"]);

/**
 * Individually reviewed exceptions, each with the reason it is correct.
 *
 * Keyed by `table:constraint`. Listing them here rather than loosening a query
 * keeps the rule strict: a *new* violation of the same rule still fails, and
 * anyone adding an entry has to write down why.
 */
const REVIEWED_EXCEPTIONS = new Map<string, string>([
  [
    "organization_invitations:organization_invitations_token_hash_key",
    "An invite is looked up by its token alone, before any organization context " +
      "exists, so the hash has to be unique across the whole platform.",
  ],
]);

function isReviewedException(
  table: string,
  detail: string,
): string | undefined {
  for (const [key, reason] of REVIEWED_EXCEPTIONS) {
    const [exceptionTable, constraint] = key.split(":");
    if (
      table === exceptionTable &&
      constraint &&
      detail.startsWith(constraint)
    ) {
      return reason;
    }
  }
  return undefined;
}

interface Finding {
  rule: string;
  table: string;
  detail: string;
}

const QUERIES: { rule: string; sql: string }[] = [
  {
    rule: "§4.1 organization_id must be NOT NULL",
    sql: `
      SELECT c.relname AS table_name, 'organization_id is nullable' AS detail
        FROM pg_class c
        JOIN pg_attribute a ON a.attrelid = c.oid
                           AND a.attname = 'organization_id' AND a.attnum > 0
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
         AND NOT a.attnotnull`,
  },
  {
    rule: "§4.2 every tenant table needs RLS enabled",
    sql: `
      SELECT c.relname AS table_name, 'has organization_id but RLS is off' AS detail
        FROM pg_class c
        JOIN pg_attribute a ON a.attrelid = c.oid
                           AND a.attname = 'organization_id' AND a.attnum > 0
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
         AND NOT c.relrowsecurity`,
  },
  {
    rule: "§4.2 RLS without a policy is a dead table",
    sql: `
      SELECT c.relname AS table_name, 'RLS enabled but no policy defined' AS detail
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
         AND c.relrowsecurity
         AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)`,
  },
  {
    rule: "§4.2 RLS must be FORCED, or the table owner bypasses it",
    sql: `
      SELECT c.relname AS table_name, 'RLS enabled but not forced' AS detail
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
         AND c.relrowsecurity AND NOT c.relforcerowsecurity`,
  },
  {
    rule: "§4.3 business keys must include organization_id",
    sql: `
      SELECT c.relname AS table_name,
             i.relname || ' (' || (
               SELECT string_agg(a.attname, ', ' ORDER BY x.ord)
                 FROM unnest(x.indkey::int[]) WITH ORDINALITY AS x(att, ord)
                 JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = x.att
             ) || ')' AS detail
        FROM pg_index x
        JOIN pg_class c ON c.oid = x.indrelid
        JOIN pg_class i ON i.oid = x.indexrelid
       WHERE c.relnamespace = 'public'::regnamespace AND x.indisunique
         AND EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attname = 'organization_id'
                        AND a.attnum > 0)
         AND NOT EXISTS (SELECT 1 FROM unnest(x.indkey::int[]) k
                           JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k
                          WHERE a.attname = 'organization_id')
         -- Only *business* keys. A key made entirely of machine-generated
         -- surrogates cannot collide across tenants, so it is not a §4.3
         -- concern: a uuid is globally unique by construction, and a
         -- sequence-backed integer (serial / GENERATED ... AS IDENTITY) draws
         -- from one shared sequence across every tenant. What §4.3 protects is
         -- a human-meaningful key — a site code, a SKU, an invoice number —
         -- where the second company must be free to reuse "MAIN".
         AND EXISTS (
               SELECT 1 FROM unnest(x.indkey::int[]) k
                 JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k
                 LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
                WHERE format_type(a.atttypid, NULL) <> 'uuid'
                  AND a.attidentity = ''
                  AND COALESCE(pg_get_expr(d.adbin, d.adrelid), '')
                        NOT LIKE 'nextval(%')`,
  },
  {
    rule: "§4.4 tenant-to-tenant foreign keys must be composite",
    sql: `
      SELECT c.relname AS table_name,
             con.conname || ' -> ' || rc.relname AS detail
        FROM pg_constraint con
        JOIN pg_class c  ON c.oid = con.conrelid
        JOIN pg_class rc ON rc.oid = con.confrelid
       WHERE con.contype = 'f' AND c.relnamespace = 'public'::regnamespace
         AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
                      AND a.attname = 'organization_id' AND a.attnum > 0)
         AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = rc.oid
                      AND a.attname = 'organization_id' AND a.attnum > 0)
         AND NOT EXISTS (SELECT 1 FROM unnest(con.conkey) k
                           JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k
                          WHERE a.attname = 'organization_id')`,
  },
  {
    rule: "§4.4 a referenced tenant table needs UNIQUE (organization_id, id)",
    sql: `
      SELECT c.relname AS table_name,
             'referenced by a composite FK but has no UNIQUE (organization_id, id)' AS detail
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
         AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
                      AND a.attname = 'organization_id' AND a.attnum > 0)
         AND EXISTS (SELECT 1 FROM pg_constraint con
                      WHERE con.confrelid = c.oid AND con.contype = 'f')
         AND NOT EXISTS (
               SELECT 1 FROM pg_index x
                WHERE x.indrelid = c.oid AND x.indisunique
                  AND x.indnatts = 2
                  AND (SELECT count(*) FROM unnest(x.indkey::int[]) k
                         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k
                        WHERE a.attname IN ('organization_id', 'id')) = 2)`,
  },
];

async function main(): Promise<void> {
  const databaseUrl =
    process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_ADMIN_URL (or DATABASE_URL) is not set");
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const findings: Finding[] = [];
  const allowed: string[] = [];

  try {
    for (const { rule, sql } of QUERIES) {
      const result = await client.query<{ table_name: string; detail: string }>(
        sql,
      );
      for (const row of result.rows) {
        if (PLATFORM_TABLES.has(row.table_name)) continue;
        if (TENANT_ROOTS.has(row.table_name)) continue;

        const reason = isReviewedException(row.table_name, row.detail);
        if (reason) {
          allowed.push(`${row.table_name}: ${row.detail} — ${reason}`);
          continue;
        }
        findings.push({ rule, table: row.table_name, detail: row.detail });
      }
    }

    // A table with neither organization_id nor a place on the platform list is
    // the most dangerous shape of all: nothing scopes it and nothing complains.
    const unscoped = await client.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
          AND NOT EXISTS (SELECT 1 FROM pg_attribute a
                           WHERE a.attrelid = c.oid
                             AND a.attname = 'organization_id' AND a.attnum > 0)
        ORDER BY 1`,
    );
    for (const row of unscoped.rows) {
      if (PLATFORM_TABLES.has(row.relname) || TENANT_ROOTS.has(row.relname))
        continue;
      findings.push({
        rule: "§4.1 every tenant table carries organization_id",
        table: row.relname,
        detail:
          "no organization_id and not a known platform table — add the column, " +
          "or add it to PLATFORM_TABLES in this script if it is genuinely global",
      });
    }

    const counts = await client.query<{
      tables: string;
      with_rls: string;
      composite_fks: string;
    }>(
      `SELECT (SELECT count(*) FROM pg_class
                WHERE relnamespace='public'::regnamespace AND relkind='r') AS tables,
              (SELECT count(*) FROM pg_class
                WHERE relnamespace='public'::regnamespace AND relkind='r'
                  AND relrowsecurity) AS with_rls,
              (SELECT count(*) FROM pg_constraint con
                 JOIN pg_class c ON c.oid=con.conrelid
                WHERE con.contype='f' AND c.relnamespace='public'::regnamespace
                  AND EXISTS (SELECT 1 FROM unnest(con.conkey) k
                                JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k
                               WHERE a.attname='organization_id')) AS composite_fks`,
    );
    const summary = counts.rows[0]!;

    console.log(
      `Tenant isolation: ${summary.tables} tables, ` +
        `${summary.with_rls} with RLS, ${summary.composite_fks} composite FKs.`,
    );

    if (allowed.length > 0) {
      console.log(`\n${allowed.length} reviewed exception(s):`);
      for (const entry of allowed) console.log(`  ${entry}`);
    }

    if (findings.length === 0) {
      console.log("\nNo findings — every rule in structure.md §4 holds.");
      return;
    }

    console.error(`\n${findings.length} finding(s):\n`);
    let currentRule = "";
    for (const finding of findings) {
      if (finding.rule !== currentRule) {
        currentRule = finding.rule;
        console.error(`  ${currentRule}`);
      }
      console.error(`    ${finding.table}: ${finding.detail}`);
    }
    console.error("");
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
