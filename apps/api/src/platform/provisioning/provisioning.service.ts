import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "../../config/database";
import { logger } from "../../config/logger";
import { ConflictError, BadRequestError } from "../../utils/errors";
import { setRequestContext } from "../../utils/tenant-query";

/**
 * The company's postal address. Optional throughout: a company that has not got
 * its paperwork to hand must still be able to finish signing up.
 */
export interface OrganizationAddress {
  addressLine1?: string | undefined;
  addressLine2?: string | undefined;
  city?: string | undefined;
  /** Province / state / county — whatever the country calls it. */
  region?: string | undefined;
  postalCode?: string | undefined;
}

export interface CreateOrganizationInput {
  slug: string;
  legalName: string;
  displayName?: string;
  industryCode?: string | null;
  /** ISO 3166-1 alpha-2. The country half of the address. */
  country?: string | null;
  address?: OrganizationAddress | undefined;
  timezone?: string;
  currency?: string;
  /** Becomes the first member, holding the owner role. */
  ownerUserId: string;
}

/**
 * Callers reach here from HTTP, from the CLI, and from tests. Only the HTTP path
 * has been through Zod, so trimming happens here too rather than trusting it.
 */
function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export interface ProvisionResult {
  organizationId: string;
  slug: string;
  ownerMemberId: string;
  rolesCreated: number;
  permissionsGranted: number;
  ownerRoleCode: string;
}

/**
 * Creates an organization and everything it needs to be usable, in one
 * transaction: settings, a trial subscription, its own copy of the role presets
 * with their grants, and the creating user as owner.
 *
 * Runs as the ordinary app role, deliberately — no admin connection and no RLS
 * bypass. It works because app.organization_id is pinned to the new row as soon
 * as it exists, so every subsequent insert satisfies the tenant policy. If this
 * ever fails on a policy, that is a real finding about the policy, not a reason
 * to escalate privileges.
 */
export async function provisionOrganization(
  input: CreateOrganizationInput,
): Promise<ProvisionResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await provisionOrganizationIn(client, input);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The same work, joining a transaction the caller already opened.
 *
 * Registration needs this: the new user row and their organization have to
 * commit together. Without it, a slug that turns out to be taken would leave
 * behind an account whose email is now also taken — so the person could neither
 * finish signing up nor try again.
 *
 * The caller owns BEGIN/COMMIT/ROLLBACK and the request context afterwards;
 * this function leaves `app.organization_id` pinned to the organization it
 * created, which is what a caller continuing to write tenant rows wants.
 */
export async function provisionOrganizationIn(
  client: PoolClient,
  input: CreateOrganizationInput,
): Promise<ProvisionResult> {
  const slug = input.slug.trim().toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
    throw new BadRequestError(
      "Slug must be lowercase letters, digits and hyphens, 2-63 characters",
    );
  }

  // Checked here rather than in each caller so the CLI, onboarding and
  // registration cannot disagree. The foreign key already rejects an unknown
  // code; what it cannot see is whether the industry is still offered.
  if (input.industryCode) {
    const industry = await client.query<{ code: string }>(
      "SELECT code FROM industries WHERE code = $1 AND is_active",
      [input.industryCode],
    );
    if (industry.rowCount === 0) {
      const offered = await client.query<{ code: string }>(
        "SELECT code FROM industries WHERE is_active ORDER BY sort_order",
      );
      throw new BadRequestError(
        `Unknown or inactive industry "${input.industryCode}"`,
        { available: offered.rows.map((row) => row.code) },
      );
    }
  }

  {
    // The id is generated here rather than by the column default, because the
    // obvious alternative — let the default fill it and read it back with
    // RETURNING — is rejected by RLS.
    //
    // Under row-level security a written row must also be visible through the
    // SELECT policy, or the insert fails. A brand-new organization satisfies
    // neither leg of organization_visibility: it is not the active organization
    // and it has no members yet. So `INSERT ... RETURNING id` died with "new row
    // violates row-level security policy" even though migration 006 explicitly
    // permits the insert. That error names the policy on the write, which is
    // misleading — the write was fine, the read-back was not.
    //
    // Generating the id first lets the context be pinned before the row exists,
    // so no read-back is needed and every later insert in this transaction is
    // already checked against the right organization.
    const organizationId = randomUUID();

    await setRequestContext(client, {
      userId: input.ownerUserId,
      organizationId,
    });

    // A slug pre-check is pointless here: RLS hides other tenants' rows, so the
    // lookup would always come back empty. The unique constraint is the only
    // honest arbiter, and it is race-free.
    const address = input.address ?? {};

    await client
      .query(
        `INSERT INTO organizations
         (id, slug, legal_name, display_name, industry_code, country,
          address_line1, address_line2, city, region, postal_code,
          timezone, currency, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               'provisioning', $14)`,
        [
          organizationId,
          slug,
          input.legalName,
          input.displayName ?? input.legalName,
          input.industryCode ?? null,
          input.country ?? null,
          // Blank strings are refused by the table's CHECK constraints, so an
          // empty form field becomes "not recorded" rather than a stored blank
          // that would print as an empty line on an invoice.
          blankToNull(address.addressLine1),
          blankToNull(address.addressLine2),
          blankToNull(address.city),
          blankToNull(address.region),
          blankToNull(address.postalCode),
          input.timezone ?? "UTC",
          (input.currency ?? "USD").toUpperCase(),
          input.ownerUserId,
        ],
      )
      .catch((error: unknown) => {
        const pgError = error as { code?: string; constraint?: string };
        if (
          pgError.code === "23505" &&
          pgError.constraint === "organizations_slug_key"
        ) {
          throw new ConflictError(
            `The workspace address "${slug}" is already taken`,
          );
        }
        throw error;
      });

    await client.query(
      "INSERT INTO organization_settings (organization_id) VALUES ($1)",
      [organizationId],
    );

    await client.query(
      `INSERT INTO organization_subscriptions
         (organization_id, plan_code, status, seats, trial_ends_at,
          current_period_start, current_period_end)
       VALUES ($1, 'trial', 'trialing', 5, now() + interval '30 days',
               now(), now() + interval '30 days')`,
      [organizationId],
    );

    // Copy the presets that apply to this industry into the org's own roles.
    const roles = await client.query<{ code: string }>(
      `INSERT INTO roles
         (organization_id, code, name, description, level, data_scope, is_system)
       SELECT $1, rp.code, rp.name, rp.description, rp.level, rp.data_scope, true
         FROM role_presets rp
        WHERE rp.industry_code IS NULL
           OR rp.industry_code = $2
       RETURNING code`,
      [organizationId, input.industryCode ?? null],
    );

    if (roles.rowCount === 0) {
      throw new BadRequestError(
        "No role presets are seeded — run: npm run db:seed -- role-presets.sql",
      );
    }

    const grants = await client.query(
      `INSERT INTO role_permissions (organization_id, role_id, permission_id)
       SELECT $1, r.id, p.id
         FROM roles r
         JOIN role_preset_permissions rpp ON rpp.role_preset_code = r.code
         JOIN permissions p ON p.code = rpp.permission_code
        WHERE r.organization_id = $1`,
      [organizationId],
    );

    const ownerRole = await client.query<{ code: string }>(
      "SELECT code FROM role_presets WHERE is_owner_role LIMIT 1",
    );
    const ownerRoleCode = ownerRole.rows[0]?.code;
    if (!ownerRoleCode) {
      throw new BadRequestError("No preset is marked as the owner role");
    }

    const member = await client.query<{ id: string }>(
      `INSERT INTO organization_members
         (organization_id, user_id, status, is_owner)
       VALUES ($1, $2, 'active', true)
       RETURNING id`,
      [organizationId, input.ownerUserId],
    );
    const ownerMemberId = member.rows[0]!.id;

    await client.query(
      `INSERT INTO member_roles (organization_id, member_id, role_id)
       SELECT $1, $2, r.id
         FROM roles r
        WHERE r.organization_id = $1 AND r.code = $3`,
      [organizationId, ownerMemberId, ownerRoleCode],
    );

    await client.query(
      "UPDATE organizations SET status = 'active' WHERE id = $1",
      [organizationId],
    );

    logger.info(
      {
        organizationId,
        slug,
        roles: roles.rowCount,
        grants: grants.rowCount,
      },
      "Organization provisioned",
    );

    return {
      organizationId,
      slug,
      ownerMemberId,
      rolesCreated: roles.rowCount ?? 0,
      permissionsGranted: grants.rowCount ?? 0,
      ownerRoleCode,
    };
  }
}
