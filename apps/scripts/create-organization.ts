/**
 * Creates a tenant organization and its owner.
 *
 *   npm run create:organization -- \
 *     --slug congo-omega --name "Congo Omega SARL" --industry poultry \
 *     --owner-email joel@gmail.com --owner-name "Joel"
 *
 * Deliberately calls the same provisionOrganization() the onboarding endpoint
 * will use, rather than duplicating the SQL — so the CLI path and the product
 * path cannot drift, and both are exercised against RLS as the app role.
 */
import crypto from "node:crypto";
import path from "node:path";
import bcrypt from "bcrypt";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

import { closeDatabase, query } from "../api/src/config/database";
import { provisionOrganization } from "../api/src/platform/provisioning/provisioning.service";

const BCRYPT_ROUNDS = 12;

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function generatePassword(): string {
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = lower + upper + digits;
  const pick = (set: string): string =>
    set[crypto.randomInt(0, set.length)] as string;

  const chars = [pick(lower), pick(upper), pick(digits)];
  while (chars.length < 16) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join("");
}

async function main(): Promise<void> {
  const slug = readFlag("slug")?.trim().toLowerCase();
  const legalName = readFlag("name")?.trim();
  const industryCode = readFlag("industry")?.trim() ?? null;
  const ownerEmail = readFlag("owner-email")?.trim().toLowerCase();
  const ownerName = readFlag("owner-name")?.trim();
  const providedPassword = readFlag("owner-password");
  const country = readFlag("country")?.trim() ?? null;
  const timezone = readFlag("timezone")?.trim();
  const currency = readFlag("currency")?.trim();

  // Every part optional, matching the API: an operator setting up a workspace
  // often has the name before the paperwork.
  const address = {
    addressLine1: readFlag("address")?.trim(),
    addressLine2: readFlag("address2")?.trim(),
    city: readFlag("city")?.trim(),
    region: readFlag("region")?.trim(),
    postalCode: readFlag("postal-code")?.trim(),
  };

  if (!slug || !legalName || !ownerEmail || !ownerName) {
    console.error(
      'Usage: npm run create:organization -- --slug <slug> --name "<legal name>" ' +
        '--owner-email <email> --owner-name "<full name>" ' +
        "[--industry <code>] [--owner-password <pw>] [--country XX] [--timezone Area/City] [--currency XXX]\n" +
        "       address: [--address <street>] [--address2 <line 2>] [--city <city>] " +
        "[--region <province>] [--postal-code <code>]",
    );
    process.exit(1);
  }

  if (industryCode) {
    const industry = await query(
      "SELECT 1 FROM industries WHERE code = $1 AND is_active",
      [industryCode],
    );
    if (industry.rowCount === 0) {
      const options = await query<{ code: string }>(
        "SELECT code FROM industries WHERE is_active ORDER BY sort_order",
      );
      console.error(
        `Unknown or inactive industry "${industryCode}". Available: ${options.rows
          .map((r) => r.code)
          .join(", ")}`,
      );
      process.exit(1);
    }
  }

  // Reuse the person if they already have a LiteHubs login — a user can own
  // more than one organization.
  const existing = await query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1",
    [ownerEmail],
  );

  let ownerUserId: string;
  let generatedPassword: string | undefined;

  if (existing.rowCount && existing.rowCount > 0) {
    ownerUserId = existing.rows[0]!.id;
    console.log(`  reusing existing user ${ownerEmail}`);
  } else {
    const password = providedPassword ?? generatePassword();
    if (password.length < 10) {
      console.error("Owner password must be at least 10 characters");
      process.exit(1);
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const created = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id`,
      [ownerEmail, passwordHash, ownerName],
    );
    ownerUserId = created.rows[0]!.id;
    if (providedPassword === undefined) generatedPassword = password;
    console.log(`  created user ${ownerEmail}`);
  }

  const result = await provisionOrganization({
    slug,
    legalName,
    displayName: readFlag("display-name")?.trim() ?? legalName,
    industryCode,
    country,
    address,
    ...(timezone ? { timezone } : {}),
    ...(currency ? { currency } : {}),
    ownerUserId,
  });

  console.log(`\nOrganization ready: ${result.slug}`);
  console.log(`  organization id:     ${result.organizationId}`);
  console.log(`  industry:            ${industryCode ?? "(none)"}`);
  console.log(`  roles created:       ${result.rolesCreated}`);
  console.log(`  permissions granted: ${result.permissionsGranted}`);
  console.log(`  owner:               ${ownerEmail} (${result.ownerRoleCode})`);
  console.log(`  workspace url:       /${result.slug}/dashboard`);
  if (generatedPassword) {
    console.log(`\n  owner password: ${generatedPassword}`);
    console.log("  Store it now — it is not saved anywhere.");
  }
}

main()
  .then(() => closeDatabase())
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    await closeDatabase().catch(() => {});
    process.exit(1);
  });
