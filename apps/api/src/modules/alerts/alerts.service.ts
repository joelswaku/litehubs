import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import { createNotificationInTransaction } from "../notifications/notifications.service";
import type {
  AlertStatus,
  CreateAlertInput,
  ListAlertsInput,
  UpdateAlertInput,
} from "./alerts.validation";

export interface AlertContext {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
}

interface AlertRow {
  id: string;
  control_id: string | null;
  province_id: string | null;
  province_code: string | null;
  province_name: string | null;
  site_id: string | null;
  site_code: string | null;
  site_name: string | null;
  reference: string;
  title: string;
  detail: string | null;
  domain: string;
  severity: "low" | "medium" | "high" | "critical";
  status: AlertStatus;
  source: "job" | "manual" | "import" | "integration";
  observed_value: string | number | null;
  threshold_value: string | number | null;
  subject_table: string | null;
  subject_id: string | null;
  raised_by: string | null;
  raised_by_name: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  due_at: Date | null;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: Date;
  updated_at: Date;
}

const alertFields = `
  a.id, a.control_id, a.province_id, p.code AS province_code, p.name AS province_name,
  a.site_id, s.code AS site_code, s.name AS site_name, a.reference, a.title,
  a.detail, a.domain, a.severity, a.status, a.source, a.observed_value,
  a.threshold_value, a.subject_table, a.subject_id, a.raised_by,
  raised.full_name AS raised_by_name, a.assigned_to, assignee.full_name AS assigned_to_name,
  a.due_at, a.acknowledged_at, a.acknowledged_by, a.resolved_at, a.resolved_by,
  a.resolution_note, a.created_at, a.updated_at
`;

const alertJoins = `
  LEFT JOIN provinces p
    ON p.organization_id = a.organization_id AND p.id = a.province_id
  LEFT JOIN sites s
    ON s.organization_id = a.organization_id AND s.id = a.site_id
  LEFT JOIN users raised ON raised.id = a.raised_by
  LEFT JOIN organization_members assigned_member
    ON assigned_member.organization_id = a.organization_id AND assigned_member.id = a.assigned_to
  LEFT JOIN users assignee ON assignee.id = assigned_member.user_id
`;

function numericOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function mapAlert(row: AlertRow) {
  return {
    id: row.id,
    controlId: row.control_id,
    reference: row.reference,
    title: row.title,
    detail: row.detail,
    domain: row.domain,
    severity: row.severity,
    status: row.status,
    source: row.source,
    observedValue: numericOrNull(row.observed_value),
    thresholdValue: numericOrNull(row.threshold_value),
    subject: row.subject_id
      ? { table: row.subject_table, id: row.subject_id }
      : null,
    province: row.province_id
      ? {
          id: row.province_id,
          code: row.province_code,
          name: row.province_name,
        }
      : null,
    site: row.site_id
      ? { id: row.site_id, code: row.site_code, name: row.site_name }
      : null,
    raisedBy: row.raised_by
      ? { userId: row.raised_by, fullName: row.raised_by_name }
      : null,
    assignedTo: row.assigned_to
      ? { memberId: row.assigned_to, fullName: row.assigned_to_name }
      : null,
    dueAt: row.due_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function conflict(error: unknown, message: string): never {
  if ((error as { code?: string }).code === "23505")
    throw new ConflictError(message);
  throw error;
}

async function hasOrganizationScope(
  client: PoolClient,
  context: AlertContext,
): Promise<boolean> {
  if (context.isOwner) return true;
  const result = await client.query<{ has_scope: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM member_roles mr
       JOIN roles r ON r.organization_id = mr.organization_id AND r.id = mr.role_id
       WHERE mr.organization_id = $1 AND mr.member_id = $2 AND r.data_scope = 'organization'
     ) AS has_scope`,
    [context.organizationId, context.memberId],
  );
  return result.rows[0]?.has_scope ?? false;
}

async function assertProvinceAccess(
  client: PoolClient,
  context: AlertContext,
  provinceId: string,
): Promise<void> {
  const found = await client.query(
    `SELECT 1 FROM provinces WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, provinceId],
  );
  if (found.rowCount === 0) throw new NotFoundError("Province not found");
  if (await hasOrganizationScope(client, context)) return;
  const access = await client.query(
    `SELECT 1 FROM member_provinces
      WHERE organization_id = $1 AND member_id = $2 AND province_id = $3`,
    [context.organizationId, context.memberId, provinceId],
  );
  if (access.rowCount === 0) throw new NotFoundError("Province not found");
}

async function siteProvinceId(
  client: PoolClient,
  context: AlertContext,
  siteId: string,
): Promise<string> {
  const result = await client.query<{ province_id: string }>(
    `SELECT province_id FROM sites WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, siteId],
  );
  const provinceId = result.rows[0]?.province_id;
  if (!provinceId) throw new NotFoundError("Site not found");
  await assertProvinceAccess(client, context, provinceId);
  return provinceId;
}

async function assertMember(
  client: PoolClient,
  context: AlertContext,
  memberId: string,
): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM organization_members
      WHERE organization_id = $1 AND id = $2 AND status = 'active'`,
    [context.organizationId, memberId],
  );
  if (result.rowCount === 0)
    throw new BadRequestError("Assigned member is not active in this company");
}

async function visibleAlertRow(
  client: PoolClient,
  context: AlertContext,
  alertId: string,
): Promise<AlertRow> {
  const companyWide = await hasOrganizationScope(client, context);
  const result = await client.query<AlertRow>(
    `SELECT ${alertFields}
       FROM alerts a
       ${alertJoins}
      WHERE a.organization_id = $1 AND a.id = $2
      ${
        companyWide
          ? ""
          : `AND EXISTS (
        SELECT 1 FROM member_provinces mp
         WHERE mp.organization_id = a.organization_id
           AND mp.member_id = $3 AND mp.province_id = a.province_id
      )`
      }`,
    companyWide
      ? [context.organizationId, alertId]
      : [context.organizationId, alertId, context.memberId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Alert not found");
  return row;
}

function newReference(): string {
  return `ALT-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function listAlerts(
  context: AlertContext,
  input: ListAlertsInput,
) {
  return withTenantContext(context, async (client) => {
    const companyWide = await hasOrganizationScope(client, context);
    if (input.provinceId)
      await assertProvinceAccess(client, context, input.provinceId);
    if (input.siteId) await siteProvinceId(client, context, input.siteId);

    const values: unknown[] = [context.organizationId];
    const where = ["a.organization_id = $1"];
    const add = (condition: (index: number) => string, value: unknown) => {
      values.push(value);
      where.push(condition(values.length));
    };
    if (!companyWide)
      add(
        (index) =>
          `EXISTS (SELECT 1 FROM member_provinces mp WHERE mp.organization_id = a.organization_id AND mp.member_id = $${index} AND mp.province_id = a.province_id)`,
        context.memberId,
      );
    if (input.status) add((index) => `a.status = $${index}`, input.status);
    if (input.severity)
      add((index) => `a.severity = $${index}`, input.severity);
    if (input.provinceId)
      add((index) => `a.province_id = $${index}`, input.provinceId);
    if (input.siteId) add((index) => `a.site_id = $${index}`, input.siteId);
    values.push(input.limit, input.offset);

    const result = await client.query<
      AlertRow & { total_count: string | number }
    >(
      `SELECT ${alertFields}, COUNT(*) OVER() AS total_count
         FROM alerts a
         ${alertJoins}
        WHERE ${where.join(" AND ")}
        ORDER BY CASE a.severity
          WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
          a.due_at ASC NULLS LAST, a.created_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      alerts: result.rows.map(mapAlert),
      pagination: {
        limit: input.limit,
        offset: input.offset,
        total: Number(result.rows[0]?.total_count ?? 0),
      },
    };
  });
}

export async function getAlert(context: AlertContext, alertId: string) {
  return withTenantContext(context, async (client) =>
    mapAlert(await visibleAlertRow(client, context, alertId)),
  );
}

export async function createAlert(
  context: AlertContext,
  input: CreateAlertInput,
) {
  try {
    return await withTenantContext(context, async (client) => {
      let provinceId = input.provinceId ?? null;
      const siteId = input.siteId ?? null;
      if (siteId) {
        const siteProvince = await siteProvinceId(client, context, siteId);
        if (provinceId && provinceId !== siteProvince)
          throw new BadRequestError(
            "The selected site does not belong to the selected province",
          );
        provinceId = siteProvince;
      }
      if (provinceId) await assertProvinceAccess(client, context, provinceId);
      if (!provinceId && !(await hasOrganizationScope(client, context))) {
        throw new BadRequestError(
          "Choose a province for an alert created by a provincial role",
        );
      }
      if (input.assignedTo)
        await assertMember(client, context, input.assignedTo);

      const created = await client.query<{ id: string }>(
        `INSERT INTO alerts (
           organization_id, province_id, site_id, reference, title, detail, domain,
           severity, status, source, observed_value, threshold_value, subject_table,
           subject_id, raised_by, assigned_to, due_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, 'open', 'manual', $9, $10, $11, $12, $13, $14, $15
         ) RETURNING id`,
        [
          context.organizationId,
          provinceId,
          siteId,
          input.reference ?? newReference(),
          input.title,
          input.detail ?? null,
          input.domain,
          input.severity,
          input.observedValue ?? null,
          input.thresholdValue ?? null,
          input.subjectTable ?? null,
          input.subjectId ?? null,
          context.userId,
          input.assignedTo ?? null,
          input.dueAt ?? null,
        ],
      );
      const alert = mapAlert(
        await visibleAlertRow(client, context, created.rows[0]!.id),
      );
      if (input.assignedTo && input.assignedTo !== context.memberId)
        await createNotificationInTransaction(client, {
          organizationId: context.organizationId,
          recipientMemberId: input.assignedTo,
          actorUserId: context.userId,
          provinceId,
          siteId,
          type: "alert_assigned",
          category: "alert",
          priority: input.severity === "critical" ? "urgent" : input.severity === "high" ? "high" : "normal",
          title: "Alert assigned",
          message: input.title,
          actionUrl: "/alerts",
          entityType: "alert",
          entityId: created.rows[0]!.id,
          deduplicationKey: `alert-assigned:${created.rows[0]!.id}:${input.assignedTo}`,
        });
      return alert;
    });
  } catch (error) {
    return conflict(error, "An alert with that reference already exists");
  }
}

export async function updateAlert(
  context: AlertContext,
  alertId: string,
  input: UpdateAlertInput,
) {
  return withTenantContext(context, async (client) => {
    const current = await visibleAlertRow(client, context, alertId);
    const currentResolved =
      current.status === "resolved" || current.status === "dismissed";
    if (currentResolved && input.status && input.status !== current.status) {
      throw new BadRequestError(
        "A resolved or dismissed alert cannot be reopened",
      );
    }

    let provinceId =
      input.provinceId === undefined ? current.province_id : input.provinceId;
    const siteId = input.siteId === undefined ? current.site_id : input.siteId;
    if (siteId) {
      const siteProvince = await siteProvinceId(client, context, siteId);
      if (input.provinceId && input.provinceId !== siteProvince)
        throw new BadRequestError(
          "The selected site does not belong to the selected province",
        );
      provinceId = siteProvince;
    }
    if (provinceId) await assertProvinceAccess(client, context, provinceId);
    if (!provinceId && !(await hasOrganizationScope(client, context)))
      throw new BadRequestError(
        "A provincial alert must remain linked to a province",
      );
    if (input.assignedTo) await assertMember(client, context, input.assignedTo);

    const nextStatus = input.status ?? current.status;
    const resolved = nextStatus === "resolved" || nextStatus === "dismissed";
    const resolutionNote =
      input.resolutionNote === undefined
        ? current.resolution_note
        : input.resolutionNote;
    if (resolved && !resolutionNote?.trim())
      throw new BadRequestError(
        "A resolution note is required to resolve or dismiss an alert",
      );

    const values: unknown[] = [context.organizationId, alertId];
    const sets = ["updated_at = now()"];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (input.title !== undefined) add("title", input.title);
    if (input.detail !== undefined) add("detail", input.detail);
    if (input.severity !== undefined) add("severity", input.severity);
    if (input.provinceId !== undefined || input.siteId !== undefined) {
      add("province_id", provinceId);
      add("site_id", siteId);
    }
    if (input.assignedTo !== undefined) add("assigned_to", input.assignedTo);
    if (input.dueAt !== undefined) add("due_at", input.dueAt);
    if (input.resolutionNote !== undefined)
      add("resolution_note", input.resolutionNote);
    if (input.status !== undefined) {
      add("status", input.status);
      if (input.status === "acknowledged" && !current.acknowledged_at) {
        sets.push("acknowledged_at = now()");
        add("acknowledged_by", context.userId);
      }
      if (resolved) {
        sets.push("resolved_at = now()");
        add("resolved_by", context.userId);
        if (input.resolutionNote === undefined)
          add("resolution_note", resolutionNote);
      }
    }

    await client.query(
      `UPDATE alerts SET ${sets.join(", ")} WHERE organization_id = $1 AND id = $2`,
      values,
    );
    return mapAlert(await visibleAlertRow(client, context, alertId));
  });
}

export async function acknowledgeAlert(context: AlertContext, alertId: string) {
  return updateAlert(context, alertId, { status: "acknowledged" });
}

export async function resolveAlert(
  context: AlertContext,
  alertId: string,
  resolutionNote: string,
) {
  return updateAlert(context, alertId, { status: "resolved", resolutionNote });
}

export async function dismissAlert(
  context: AlertContext,
  alertId: string,
  resolutionNote: string,
) {
  return updateAlert(context, alertId, { status: "dismissed", resolutionNote });
}

export async function deleteAlert(context: AlertContext, alertId: string) {
  return withTenantContext(context, async (client) => {
    const current = await visibleAlertRow(client, context, alertId);
    if (current.source !== "manual")
      throw new BadRequestError(
        "Automated alerts are kept as an audit record; dismiss or resolve this alert instead",
      );
    const result = await client.query(
      `DELETE FROM alerts WHERE organization_id = $1 AND id = $2 AND source = 'manual'`,
      [context.organizationId, alertId],
    );
    if (result.rowCount === 0) throw new NotFoundError("Alert not found");
  });
}
