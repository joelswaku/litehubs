import { withUserContext } from "../../utils/tenant-query";
import { logger } from "../../config/logger";
import { NotFoundError } from "../../utils/errors";

/**
 * The tenant registry, for the staff console.
 *
 * Every read here runs under **user context**, not organization context, and
 * that is the whole mechanism. Migration 033 added a SELECT policy on
 * `organizations` and `organization_subscriptions` gated on
 * `platform.organizations.read`, so pinning only `app.user_id` is what lets a
 * platform admin see the registry.
 *
 * What that deliberately does not do: the same context reads *zero* rows from
 * employees, payslips, the ledger, or organization_members, because no policy
 * was added to those. Staff can see that a company exists and what it pays;
 * they cannot see inside it. structure.md §1 requires exactly that — a platform
 * admin is not implicitly a member of anything.
 *
 * There is no admin connection and no RLS bypass anywhere in this file. If a
 * query here returns nothing, the answer is a missing policy or a missing
 * permission, never a reason to escalate.
 */

export interface TenantSummary {
  id: string;
  slug: string;
  legalName: string;
  displayName: string;
  industryCode: string | null;
  country: string | null;
  city: string | null;
  currency: string;
  status: string;
  createdAt: Date;
  subscription: {
    planCode: string;
    status: string;
    seats: number;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
  } | null;
}

interface TenantRow {
  id: string;
  slug: string;
  legal_name: string;
  display_name: string;
  industry_code: string | null;
  country: string | null;
  city: string | null;
  currency: string;
  status: string;
  created_at: Date;
  plan_code: string | null;
  subscription_status: string | null;
  seats: number | null;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
}

function toTenant(row: TenantRow): TenantSummary {
  return {
    id: row.id,
    slug: row.slug,
    legalName: row.legal_name,
    displayName: row.display_name,
    industryCode: row.industry_code,
    country: row.country,
    city: row.city,
    currency: row.currency.trim(),
    status: row.status,
    createdAt: row.created_at,
    subscription: row.plan_code
      ? {
          planCode: row.plan_code,
          status: row.subscription_status ?? "unknown",
          seats: row.seats ?? 0,
          trialEndsAt: row.trial_ends_at,
          currentPeriodEnd: row.current_period_end,
        }
      : null,
  };
}

const TENANT_SELECT = `
  SELECT o.id, o.slug, o.legal_name, o.display_name, o.industry_code,
         o.country, o.city, o.currency, o.status, o.created_at,
         s.plan_code, s.status AS subscription_status, s.seats,
         s.trial_ends_at, s.current_period_end
    FROM organizations o
    LEFT JOIN organization_subscriptions s ON s.organization_id = o.id`;

export interface ListTenantsFilter {
  status?: string | undefined;
  industryCode?: string | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export async function listTenants(
  staffUserId: string,
  filter: ListTenantsFilter = {},
): Promise<{ tenants: TenantSummary[]; total: number }> {
  const limit = Math.min(filter.limit ?? 50, 200);
  const offset = filter.offset ?? 0;

  return withUserContext(staffUserId, async (client) => {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.status) {
      params.push(filter.status);
      conditions.push(`o.status = $${params.length}`);
    }
    if (filter.industryCode) {
      params.push(filter.industryCode);
      conditions.push(`o.industry_code = $${params.length}`);
    }
    if (filter.search) {
      params.push(`%${filter.search.trim().toLowerCase()}%`);
      conditions.push(
        `(lower(o.slug) LIKE $${params.length}
          OR lower(o.legal_name) LIKE $${params.length}
          OR lower(o.display_name) LIKE $${params.length})`,
      );
    }

    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";

    // Counted through the same policy as the list, so the total can never
    // exceed what the caller is allowed to see.
    const counted = await client.query<{ total: string }>(
      `SELECT count(*) AS total FROM organizations o${where}`,
      params,
    );

    params.push(limit, offset);
    const result = await client.query<TenantRow>(
      `${TENANT_SELECT}${where}
        ORDER BY o.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      tenants: result.rows.map(toTenant),
      total: Number(counted.rows[0]?.total ?? 0),
    };
  });
}

export async function getTenant(
  staffUserId: string,
  slug: string,
): Promise<TenantSummary> {
  const tenant = await withUserContext(staffUserId, async (client) => {
    const result = await client.query<TenantRow>(
      `${TENANT_SELECT} WHERE o.slug = $1`,
      [slug.trim().toLowerCase()],
    );
    return result.rows[0];
  });

  if (!tenant) throw new NotFoundError("No such organization");
  return toTenant(tenant);
}

/**
 * Platform-wide counts for the staff console's headline figures.
 *
 * `memberCount` is deliberately absent: organization_members has no platform
 * policy, so it reads as zero here. Reporting "0 members" would be a lie, and
 * a policy to fix it would hand staff every customer's staff list — the wrong
 * trade. Seat counts come from the subscription instead, which is the
 * commercially meaningful number anyway.
 */
export interface PlatformSummary {
  tenants: { total: number; byStatus: Record<string, number> };
  subscriptions: {
    byPlan: Record<string, number>;
    byStatus: Record<string, number>;
  };
  industries: { code: string; name: string; tenantCount: number }[];
  recentSignups: { slug: string; displayName: string; createdAt: Date }[];
}

export async function platformSummary(
  staffUserId: string,
): Promise<PlatformSummary> {
  return withUserContext(staffUserId, async (client) => {
    const byStatus = await client.query<{ status: string; count: string }>(
      "SELECT status, count(*) AS count FROM organizations GROUP BY status",
    );

    const byPlan = await client.query<{
      plan_code: string;
      status: string;
      count: string;
    }>(
      `SELECT plan_code, status, count(*) AS count
         FROM organization_subscriptions
        GROUP BY plan_code, status`,
    );

    // industries has no RLS at all (platform-owned catalogue), but the join to
    // organizations still goes through the policy — so a staff member without
    // platform.organizations.read gets the industry list with zero counts
    // rather than an error.
    const industries = await client.query<{
      code: string;
      name: string;
      tenant_count: string;
    }>(
      `SELECT i.code, i.name, count(o.id) AS tenant_count
         FROM industries i
         LEFT JOIN organizations o ON o.industry_code = i.code
        WHERE i.is_active
        GROUP BY i.code, i.name, i.sort_order
        ORDER BY i.sort_order`,
    );

    const recent = await client.query<{
      slug: string;
      display_name: string;
      created_at: Date;
    }>(
      `SELECT slug, display_name, created_at
         FROM organizations
        ORDER BY created_at DESC
        LIMIT 8`,
    );

    const statusCounts: Record<string, number> = {};
    let total = 0;
    for (const row of byStatus.rows) {
      const count = Number(row.count);
      statusCounts[row.status] = count;
      total += count;
    }

    const planCounts: Record<string, number> = {};
    const subscriptionStatus: Record<string, number> = {};
    for (const row of byPlan.rows) {
      const count = Number(row.count);
      planCounts[row.plan_code] = (planCounts[row.plan_code] ?? 0) + count;
      subscriptionStatus[row.status] =
        (subscriptionStatus[row.status] ?? 0) + count;
    }

    return {
      tenants: { total, byStatus: statusCounts },
      subscriptions: { byPlan: planCounts, byStatus: subscriptionStatus },
      industries: industries.rows.map((row) => ({
        code: row.code,
        name: row.name,
        tenantCount: Number(row.tenant_count),
      })),
      recentSignups: recent.rows.map((row) => ({
        slug: row.slug,
        displayName: row.display_name,
        createdAt: row.created_at,
      })),
    };
  });
}

/**
 * Suspends or reactivates a tenant.
 *
 * Behind `platform.organizations.update`, which read access does not confer, and
 * logged — suspending a customer stops their staff working, so it must be
 * traceable to a person.
 */
export async function setTenantStatus(
  staffUserId: string,
  slug: string,
  status: "active" | "suspended",
): Promise<TenantSummary> {
  const updated = await withUserContext(staffUserId, async (client) => {
    const result = await client.query<{ id: string }>(
      `UPDATE organizations SET status = $2
        WHERE slug = $1 AND status <> 'archived'
        RETURNING id`,
      [slug.trim().toLowerCase(), status],
    );
    return result.rowCount ?? 0;
  });

  if (updated === 0) {
    throw new NotFoundError("No such organization, or it is archived");
  }

  logger.warn(
    { staffUserId, slug, status },
    "Tenant status changed by platform staff",
  );

  return getTenant(staffUserId, slug);
}
