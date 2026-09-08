/**
 * Creates a LiteHubs staff account — someone who administers the platform.
 *
 *   npm run create:platform-admin -- --email you@litehubs.io --name "Your Name"
 *   npm run create:platform-admin -- --email x@y.z --name "X" --role platform_support
 *
 * A platform role grants nothing inside any customer organization. Reaching
 * tenant data still requires a membership, which is what create-organization
 * creates. This is the replacement for the old create-owner.ts, which conflated
 * the two.
 */
import crypto from "node:crypto";
import path from "node:path";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const BCRYPT_ROUNDS = 12;
const DEFAULT_ROLE = "platform_super_admin";

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** Guarantees the policy in auth.validation.ts is satisfied. */
function generatePassword(): string {
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = lower + upper + digits;

  const pick = (set: string): string =>
    set[crypto.randomInt(0, set.length)] as string;

  const chars = [pick(lower), pick(upper), pick(digits)];
  while (chars.length < 16) chars.push(pick(all));

  // Fisher-Yates with a CSPRNG, so the guaranteed characters are not always
  // in the first three positions.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join("");
}

async function main(): Promise<void> {
  const databaseUrl =
    process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_ADMIN_URL is not set (expected in apps/.env)");
    process.exit(1);
  }

  const email = readFlag("email")?.trim().toLowerCase();
  const fullName = readFlag("name")?.trim();
  const roleCode = readFlag("role")?.trim() ?? DEFAULT_ROLE;
  const providedPassword = readFlag("password");

  if (!email || !fullName) {
    console.error(
      'Usage: npm run create:platform-admin -- --email <email> --name "<full name>" [--role <code>] [--password <password>]',
    );
    process.exit(1);
  }
  if (!email.includes("@")) {
    console.error(`Not a valid email: ${email}`);
    process.exit(1);
  }
  if (providedPassword !== undefined && providedPassword.length < 10) {
    console.error("Password must be at least 10 characters");
    process.exit(1);
  }

  const password = providedPassword ?? generatePassword();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("BEGIN");

    const role = await client.query<{ id: string; name: string }>(
      "SELECT id, name FROM platform_roles WHERE code = $1",
      [roleCode],
    );
    if (role.rowCount === 0) {
      const available = await client.query<{ code: string }>(
        "SELECT code FROM platform_roles ORDER BY level",
      );
      throw new Error(
        `Unknown platform role "${roleCode}". Available: ${
          available.rows.map((r) => r.code).join(", ") ||
          "(none — run npm run db:seed)"
        }`,
      );
    }

    const upsert = await client.query<{ id: string; created: boolean }>(
      `INSERT INTO users (email, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (email) DO UPDATE
         SET full_name = EXCLUDED.full_name, status = 'active'
       RETURNING id, (created_at = updated_at) AS created`,
      [email, passwordHash, fullName],
    );
    const user = upsert.rows[0]!;

    await client.query(
      `INSERT INTO user_platform_roles (user_id, platform_role_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [user.id, role.rows[0]!.id],
    );

    // Only touch the password when we created the account, or the caller asked.
    if (user.created || providedPassword !== undefined) {
      await client.query("UPDATE users SET password_hash = $2 WHERE id = $1", [
        user.id,
        passwordHash,
      ]);
    }

    await client.query("COMMIT");

    console.log(`Platform admin ready: ${email}`);
    console.log(`  role:    ${roleCode} (${role.rows[0]!.name})`);
    console.log(`  user id: ${user.id}`);
    if (!user.created && providedPassword === undefined) {
      console.log("  password left unchanged (account already existed)");
    } else if (providedPassword === undefined) {
      console.log(`  password: ${password}`);
      console.log("  Store it now — it is not saved anywhere.");
    }
    console.log(
      "\nThis grants no access to any customer organization. Use create:organization for that.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
