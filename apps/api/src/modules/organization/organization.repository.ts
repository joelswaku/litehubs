import { withTenantContext } from "../../utils/tenant-query";

export interface OrganizationAddressFields {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  /** Province / state / county. */
  region: string | null;
  postalCode: string | null;
  /** ISO 3166-1 alpha-2, kept on the organization itself since 003. */
  country: string | null;
}

export interface OrganizationProfile {
  id: string;
  slug: string;
  legalName: string;
  displayName: string;
  industryCode: string | null;
  /** Also present inside `address`, where a form or an invoice wants it. */
  country: string | null;
  address: OrganizationAddressFields;
  timezone: string;
  currency: string;
  status: string;
  createdAt: Date;
  memberCount: number;
  operationalServices: string[] | null;
  logoUrl: string | null;
  subscription: {
    planCode: string;
    status: string;
    seats: number;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
  } | null;
}

interface ProfileRow {
  id: string;
  slug: string;
  legal_name: string;
  display_name: string;
  industry_code: string | null;
  country: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  timezone: string;
  currency: string;
  status: string;
  created_at: Date;
  member_count: string;
  plan_code: string | null;
  subscription_status: string | null;
  seats: number | null;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
  preferences: Record<string, unknown> | null;
  logo_url: string | null;
}

/**
 * The workspace's own profile. Read under tenant context, so the query is
 * filtered to this organization by row-level security whatever the WHERE clause
 * says — the `id = $1` below is the fast path, not the safety net.
 */
export async function findProfile(
  userId: string,
  organizationId: string,
): Promise<OrganizationProfile | undefined> {
  return withTenantContext({ userId, organizationId }, async (client) => {
    const result = await client.query<ProfileRow>(
      `SELECT o.id,
              o.slug,
              o.legal_name,
              o.display_name,
              o.industry_code,
              o.country,
              o.address_line1,
              o.address_line2,
              o.city,
              o.region,
              o.postal_code,
              o.timezone,
              o.currency,
              o.status,
              o.created_at,
              (SELECT count(*)
                 FROM organization_members m
                WHERE m.organization_id = o.id
                  AND m.status = 'active') AS member_count,
              s.plan_code,
              s.status AS subscription_status,
              s.seats,
              s.trial_ends_at,
              s.current_period_end,
              os.preferences,
              os.logo_url
         FROM organizations o
         LEFT JOIN organization_subscriptions s
           ON s.organization_id = o.id
         LEFT JOIN organization_settings os
           ON os.organization_id = o.id
        WHERE o.id = $1`,
      [organizationId],
    );

    const row = result.rows[0];
    if (!row) return undefined;

    return {
      id: row.id,
      slug: row.slug,
      legalName: row.legal_name,
      displayName: row.display_name,
      industryCode: row.industry_code,
      country: row.country,
      address: {
        addressLine1: row.address_line1,
        addressLine2: row.address_line2,
        city: row.city,
        region: row.region,
        postalCode: row.postal_code,
        country: row.country,
      },
      timezone: row.timezone,
      currency: row.currency.trim(),
      status: row.status,
      createdAt: row.created_at,
      memberCount: Number(row.member_count),
      operationalServices: Array.isArray(row.preferences?.operationalServices) ? row.preferences.operationalServices.filter((item): item is string => typeof item === "string") : null,
      logoUrl: row.logo_url,
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
  });
}
