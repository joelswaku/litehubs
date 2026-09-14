import type { PoolClient } from "pg";
import { query } from "../../config/database";
import { logger } from "../../config/logger";
import {
  deletePrivateDocument,
  deleteStoredImage,
} from "../../services/file-storage.service";
import { verifyCurrentPassword } from "../auth/auth.service";
import { withUserContext } from "../../utils/tenant-query";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../utils/errors";

/**
 * The tenant registry is deliberately split into two views. Every platform
 * staff member who has the normal read permission can see the commercial
 * registry. The deletion detail view is limited to a Platform Super Admin and
 * uses the narrow RLS policies introduced in migration 082 to expose aggregate
 * counts only — never lists of employee, payroll, or operational data.
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
  deletionStatus: "none" | "scheduled" | "cancelled" | "purging" | "purged";
  deletionRequestedAt: Date | null;
  purgeAfter: Date | null;
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
  deletion_status: TenantSummary["deletionStatus"];
  deletion_requested_at: Date | null;
  purge_after: Date | null;
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
    deletionStatus: row.deletion_status ?? "none",
    deletionRequestedAt: row.deletion_requested_at,
    purgeAfter: row.purge_after,
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
         o.deletion_status, o.deletion_requested_at, o.purge_after,
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

export interface TenantDeletionContext {
  tenant: TenantSummary;
  owner: { fullName: string; email: string } | null;
  counts: {
    members: number;
    employees: number;
    projects: number;
    documents: number;
    projectDocuments: number;
    operationalRecords: number;
    poultryFlocks: number;
    pigGroups: number;
    agricultureFarms: number;
    dailyReports: number;
    stockMovements: number;
    maintenanceWorkOrders: number;
  };
}

type DeletionContextRow = TenantRow & {
  owner_full_name: string | null;
  owner_email: string | null;
  members: string;
  employees: string;
  projects: string;
  documents: string;
  project_documents: string;
  poultry_flocks: string;
  pig_groups: string;
  agriculture_farms: string;
  daily_reports: string;
  stock_movements: string;
  maintenance_work_orders: string;
};

/** Aggregate-only, Super-Admin-only data needed to judge a deletion safely. */
export async function getTenantDeletionContext(
  staffUserId: string,
  slug: string,
): Promise<TenantDeletionContext> {
  const row = await withUserContext(staffUserId, async (client) => {
    const result = await client.query<DeletionContextRow>(
      `${TENANT_SELECT.replace(
        "\n    FROM organizations o",
        ", owner.full_name AS owner_full_name, owner.email AS owner_email\n    FROM organizations o",
      )}
       LEFT JOIN LATERAL (
         SELECT u.full_name, u.email
           FROM organization_members m
           JOIN users u ON u.id = m.user_id
          WHERE m.organization_id = o.id AND m.is_owner
          ORDER BY m.joined_at
          LIMIT 1
       ) owner ON true
       WHERE o.slug = $1`,
      [slug.trim().toLowerCase()],
    );

    const tenant = result.rows[0];
    if (!tenant) return undefined;

    const counts = await client.query<{
      members: string;
      employees: string;
      projects: string;
      documents: string;
      project_documents: string;
      poultry_flocks: string;
      pig_groups: string;
      agriculture_farms: string;
      daily_reports: string;
      stock_movements: string;
      maintenance_work_orders: string;
    }>(
      `SELECT
        (SELECT count(*)::text FROM organization_members WHERE organization_id = $1) AS members,
        (SELECT count(*)::text FROM employees WHERE organization_id = $1) AS employees,
        (SELECT count(*)::text FROM management_projects WHERE organization_id = $1) AS projects,
        (SELECT count(*)::text FROM documents WHERE organization_id = $1) AS documents,
        (SELECT count(*)::text FROM management_document_links WHERE organization_id = $1) AS project_documents,
        (SELECT count(*)::text FROM poultry_flocks WHERE organization_id = $1) AS poultry_flocks,
        (SELECT count(*)::text FROM pig_groups WHERE organization_id = $1) AS pig_groups,
        (SELECT count(*)::text FROM agriculture_farms WHERE organization_id = $1) AS agriculture_farms,
        (SELECT count(*)::text FROM daily_reports WHERE organization_id = $1) AS daily_reports,
        (SELECT count(*)::text FROM management_inventory_stock_movements WHERE organization_id = $1) AS stock_movements,
        (SELECT count(*)::text FROM management_maintenance_work_orders WHERE organization_id = $1) AS maintenance_work_orders`,
      [tenant.id],
    );
    return { tenant, counts: counts.rows[0] };
  });

  if (!row?.tenant || !row.counts) throw new NotFoundError("No such organization");
  const count = (value: string | undefined) => Number(value ?? 0);
  const totalOperational =
    count(row.counts.poultry_flocks) +
    count(row.counts.pig_groups) +
    count(row.counts.agriculture_farms) +
    count(row.counts.daily_reports) +
    count(row.counts.stock_movements) +
    count(row.counts.maintenance_work_orders);

  return {
    tenant: toTenant(row.tenant),
    owner:
      row.tenant.owner_full_name && row.tenant.owner_email
        ? { fullName: row.tenant.owner_full_name, email: row.tenant.owner_email }
        : null,
    counts: {
      members: count(row.counts.members),
      employees: count(row.counts.employees),
      projects: count(row.counts.projects),
      documents: count(row.counts.documents),
      projectDocuments: count(row.counts.project_documents),
      operationalRecords: totalOperational,
      poultryFlocks: count(row.counts.poultry_flocks),
      pigGroups: count(row.counts.pig_groups),
      agricultureFarms: count(row.counts.agriculture_farms),
      dailyReports: count(row.counts.daily_reports),
      stockMovements: count(row.counts.stock_movements),
      maintenanceWorkOrders: count(row.counts.maintenance_work_orders),
    },
  };
}

export interface PlatformSummary {
  tenants: { total: number; byStatus: Record<string, number>; scheduledForDeletion: number };
  subscriptions: { byPlan: Record<string, number>; byStatus: Record<string, number> };
  industries: { code: string; name: string; tenantCount: number }[];
  recentSignups: { slug: string; displayName: string; createdAt: Date }[];
}

export async function platformSummary(staffUserId: string): Promise<PlatformSummary> {
  return withUserContext(staffUserId, async (client) => {
    const [byStatus, scheduled, byPlan, industries, recent] = await Promise.all([
      client.query<{ status: string; count: string }>(
        "SELECT status, count(*) AS count FROM organizations GROUP BY status",
      ),
      client.query<{ count: string }>(
        "SELECT count(*) AS count FROM organizations WHERE deletion_status = 'scheduled'",
      ),
      client.query<{ plan_code: string; status: string; count: string }>(
        `SELECT plan_code, status, count(*) AS count
           FROM organization_subscriptions
          GROUP BY plan_code, status`,
      ),
      client.query<{ code: string; name: string; tenant_count: string }>(
        `SELECT i.code, i.name, count(o.id) AS tenant_count
           FROM industries i
           LEFT JOIN organizations o ON o.industry_code = i.code
          WHERE i.is_active
          GROUP BY i.code, i.name, i.sort_order
          ORDER BY i.sort_order`,
      ),
      client.query<{ slug: string; display_name: string; created_at: Date }>(
        `SELECT slug, display_name, created_at
           FROM organizations
          ORDER BY created_at DESC
          LIMIT 8`,
      ),
    ]);

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
      subscriptionStatus[row.status] = (subscriptionStatus[row.status] ?? 0) + count;
    }

    return {
      tenants: {
        total,
        byStatus: statusCounts,
        scheduledForDeletion: Number(scheduled.rows[0]?.count ?? 0),
      },
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

export async function setTenantStatus(
  staffUserId: string,
  slug: string,
  status: "active" | "suspended",
): Promise<TenantSummary> {
  const updated = await withUserContext(staffUserId, async (client) => {
    const result = await client.query<{ id: string }>(
      `UPDATE organizations SET status = $2
        WHERE slug = $1
          AND status <> 'archived'
          AND deletion_status NOT IN ('scheduled', 'purging')
        RETURNING id`,
      [slug.trim().toLowerCase(), status],
    );
    return result.rowCount ?? 0;
  });

  if (updated === 0) {
    throw new NotFoundError("No such organization, it is archived, or deletion is scheduled");
  }
  logger.warn({ staffUserId, slug, status }, "Tenant status changed by platform staff");
  return getTenant(staffUserId, slug);
}

type DeletionTargetRow = {
  id: string;
  slug: string;
  legal_name: string;
  display_name: string;
  deletion_status: TenantSummary["deletionStatus"];
  purge_after: Date | null;
};

async function readDeletionTarget(client: PoolClient, slug: string): Promise<DeletionTargetRow> {
  const result = await client.query(
    `SELECT id, slug, legal_name, display_name, deletion_status, purge_after
       FROM organizations
      WHERE slug = $1
      FOR UPDATE`,
    [slug.trim().toLowerCase()],
  );
  const target = result.rows[0] as DeletionTargetRow | undefined;
  if (!target) throw new NotFoundError("No such organization");
  return target;
}

function assertExactCompanyName(target: DeletionTargetRow, confirmationName: string): void {
  if (confirmationName.trim() !== target.legal_name) {
    throw new BadRequestError("Enter the organization legal name exactly to continue");
  }
}

async function appendDeletionAudit(
  client: PoolClient,
  input: {
    organizationId: string;
    slug: string;
    name: string;
    actorUserId: string;
    eventType: "deletion_requested" | "deletion_cancelled" | "organization_restored" | "permanent_purge";
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO platform_organization_deletion_audit
       (organization_id, organization_slug, organization_name, actor_user_id, event_type, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.organizationId,
      input.slug,
      input.name,
      input.actorUserId,
      input.eventType,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function scheduleTenantDeletion(
  staffUserId: string,
  slug: string,
  input: { confirmationName: string; currentPassword: string },
): Promise<TenantSummary> {
  await verifyCurrentPassword(staffUserId, input.currentPassword);
  const scheduled = await withUserContext(staffUserId, async (client) => {
    const target = await readDeletionTarget(client, slug);
    assertExactCompanyName(target, input.confirmationName);
    if (target.deletion_status === "scheduled" || target.deletion_status === "purging") {
      throw new ConflictError("This organization is already scheduled for deletion");
    }

    await client.query(
      `UPDATE organizations
          SET deletion_requested_at = now(),
              deletion_requested_by = $2,
              purge_after = now() + interval '30 days',
              deletion_status = 'scheduled'
        WHERE id = $1`,
      [target.id, staffUserId],
    );
    const state = await client.query<TenantRow>(
      `${TENANT_SELECT} WHERE o.id = $1`,
      [target.id],
    );
    await appendDeletionAudit(client, {
      organizationId: target.id,
      slug: target.slug,
      name: target.legal_name,
      actorUserId: staffUserId,
      eventType: "deletion_requested",
      metadata: { purgeAfter: state.rows[0]?.purge_after?.toISOString() ?? null },
    });
    return state.rows[0];
  });

  if (!scheduled) throw new NotFoundError("No such organization");
  logger.warn({ staffUserId, slug, purgeAfter: scheduled.purge_after }, "Organization deletion scheduled");
  return toTenant(scheduled);
}

async function clearDeletionState(
  staffUserId: string,
  slug: string,
  eventType: "deletion_cancelled" | "organization_restored",
): Promise<TenantSummary> {
  const restored = await withUserContext(staffUserId, async (client) => {
    const target = await readDeletionTarget(client, slug);
    if (target.deletion_status !== "scheduled") {
      throw new BadRequestError("This organization is not scheduled for deletion");
    }
    const status = eventType === "deletion_cancelled" ? "cancelled" : "none";
    await client.query(
      `UPDATE organizations
          SET deletion_status = $2,
              deletion_requested_at = NULL,
              deletion_requested_by = NULL,
              purge_after = NULL
        WHERE id = $1`,
      [target.id, status],
    );
    const result = await client.query<TenantRow>(`${TENANT_SELECT} WHERE o.id = $1`, [target.id]);
    await appendDeletionAudit(client, {
      organizationId: target.id,
      slug: target.slug,
      name: target.legal_name,
      actorUserId: staffUserId,
      eventType,
    });
    return result.rows[0];
  });
  if (!restored) throw new NotFoundError("No such organization");
  logger.warn({ staffUserId, slug, eventType }, "Organization deletion state cleared");
  return toTenant(restored);
}

export function cancelTenantDeletion(staffUserId: string, slug: string) {
  return clearDeletionState(staffUserId, slug, "deletion_cancelled");
}

export function restoreTenant(staffUserId: string, slug: string) {
  return clearDeletionState(staffUserId, slug, "organization_restored");
}

type PurgeFile = { storage_provider: "private_document" | "cloudinary"; storage_key: string };

async function queueOwnedFilesForPurge(
  client: PoolClient,
  organizationId: string,
): Promise<void> {
  const [documents, cloudinary] = await Promise.all([
    client.query(
      `SELECT storage_path AS storage_key
         FROM documents
        WHERE organization_id = $1`,
      [organizationId],
    ),
    client.query(
      `SELECT storage_public_id AS storage_key
         FROM management_document_links
        WHERE organization_id = $1
          AND storage_provider = 'cloudinary'
          AND storage_public_id IS NOT NULL`,
      [organizationId],
    ),
  ]);
  const files: PurgeFile[] = [
    ...documents.rows.map((row: { storage_key: string }) => ({
      storage_provider: "private_document" as const,
      storage_key: row.storage_key,
    })),
    ...cloudinary.rows.map((row: { storage_key: string }) => ({
      storage_provider: "cloudinary" as const,
      storage_key: row.storage_key,
    })),
  ];
  for (const file of files) {
    await client.query(
      `INSERT INTO platform_organization_file_purge_jobs
         (organization_id, storage_provider, storage_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, storage_provider, storage_key) DO NOTHING`,
      [organizationId, file.storage_provider, file.storage_key],
    );
  }
}

/**
 * Irreversible step. The endpoint refuses before the 30-day window ends. The
 * organization delete is a single tenant-scoped transaction: a failed foreign
 * key cascade rolls the whole operation back instead of leaving partial data.
 */
export async function permanentlyPurgeTenant(
  staffUserId: string,
  slug: string,
  input: { confirmationName: string; currentPassword: string },
): Promise<void> {
  await verifyCurrentPassword(staffUserId, input.currentPassword);
  const purgedOrganizationId = await withUserContext(staffUserId, async (client) => {
    const target = await readDeletionTarget(client, slug);
    assertExactCompanyName(target, input.confirmationName);
    if (target.deletion_status !== "scheduled" || !target.purge_after) {
      throw new BadRequestError("Only a scheduled organization can be permanently purged");
    }
    if (target.purge_after > new Date()) {
      throw new BadRequestError("The 30-day restoration period has not ended");
    }

    await queueOwnedFilesForPurge(client, target.id);
    await appendDeletionAudit(client, {
      organizationId: target.id,
      slug: target.slug,
      name: target.legal_name,
      actorUserId: staffUserId,
      eventType: "permanent_purge",
      metadata: { scheduledPurgeAfter: target.purge_after.toISOString() },
    });
    const deleted = await client.query<{ id: string }>(
      `DELETE FROM organizations
        WHERE id = $1
          AND deletion_status = 'scheduled'
          AND purge_after <= now()
        RETURNING id`,
      [target.id],
    );
    if (!deleted.rows[0]) {
      throw new ConflictError("The organization deletion state changed; nothing was purged");
    }
    return target.id;
  });

  // Remote storage is not transaction-capable. Jobs were recorded before the
  // database commit, so failures remain retryable and cannot orphan data from a
  // different tenant.
  await processOrganizationFilePurgeJobs(purgedOrganizationId);
  logger.warn({ staffUserId, slug, organizationId: purgedOrganizationId }, "Organization permanently purged");
}

export async function processOrganizationFilePurgeJobs(organizationId: string): Promise<void> {
  const jobs = await query<{
    id: string;
    storage_provider: "private_document" | "cloudinary";
    storage_key: string;
  }>(
    `SELECT id, storage_provider, storage_key
       FROM platform_organization_file_purge_jobs
      WHERE organization_id = $1 AND completed_at IS NULL
      ORDER BY created_at`,
    [organizationId],
  );

  for (const job of jobs.rows) {
    try {
      if (job.storage_provider === "private_document") {
        await deletePrivateDocument(job.storage_key);
      } else {
        await deleteStoredImage({ provider: "cloudinary", publicId: job.storage_key });
      }
      await query(
        `UPDATE platform_organization_file_purge_jobs
            SET attempts = attempts + 1, completed_at = now(), last_error = NULL
          WHERE id = $1`,
        [job.id],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : "Unknown storage deletion error";
      await query(
        `UPDATE platform_organization_file_purge_jobs
            SET attempts = attempts + 1, last_error = $2
          WHERE id = $1`,
        [job.id, message],
      );
      logger.error({ err: error, organizationId, purgeJobId: job.id }, "Organization file purge will be retried");
    }
  }
}