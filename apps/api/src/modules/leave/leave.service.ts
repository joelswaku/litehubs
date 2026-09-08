import type { PoolClient } from "pg";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type {
  CancelLeaveInput,
  CreateLeaveTypeInput,
  DecideLeaveInput,
  LeaveRequestQuery,
  RequestLeaveInput,
  UpdateLeaveTypeInput,
} from "./leave.validation";

export interface LeaveContext {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
  permissions: string[];
}
type Scope = "organization" | "province" | "self";
type RequestStatus =
  "pending" | "approved" | "rejected" | "cancelled" | "taken";
interface TypeRow {
  id: string;
  code: string;
  name: string;
  annual_entitlement_days: string | null;
  is_paid: boolean;
  requires_approval: boolean;
  allows_backdating: boolean;
  is_active: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}
interface RequestRow {
  id: string;
  employee_id: string;
  employee_number: string;
  employee_name: string;
  employee_job_title: string;
  employee_member_id: string | null;
  leave_type_id: string;
  leave_type_code: string;
  leave_type_name: string;
  is_paid: boolean;
  province_id: string | null;
  province_name: string | null;
  site_id: string | null;
  site_name: string | null;
  starts_on: string;
  ends_on: string;
  requested_days: string;
  reason: string | null;
  status: RequestStatus;
  requested_by_name: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  created_at: Date;
  updated_at: Date;
}
const requestFields = `r.id, r.employee_id, e.employee_number, e.full_name AS employee_name, e.job_title AS employee_job_title, e.member_id AS employee_member_id, r.leave_type_id, t.code AS leave_type_code, t.name AS leave_type_name, t.is_paid, r.province_id, p.name AS province_name, r.site_id, s.name AS site_name, r.starts_on::text, r.ends_on::text, r.requested_days::text, r.reason, r.status, requester.full_name AS requested_by_name, decider.full_name AS decided_by_name, r.decided_at, r.decision_note, r.created_at, r.updated_at`;
function mapType(row: TypeRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    annualEntitlementDays:
      row.annual_entitlement_days === null
        ? null
        : Number(row.annual_entitlement_days),
    isPaid: row.is_paid,
    requiresApproval: row.requires_approval,
    allowsBackdating: row.allows_backdating,
    isActive: row.is_active,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function mapRequest(row: RequestRow) {
  return {
    id: row.id,
    employee: {
      id: row.employee_id,
      employeeNumber: row.employee_number,
      fullName: row.employee_name,
      jobTitle: row.employee_job_title,
    },
    leaveType: {
      id: row.leave_type_id,
      code: row.leave_type_code,
      name: row.leave_type_name,
      isPaid: row.is_paid,
    },
    province: row.province_id
      ? { id: row.province_id, name: row.province_name }
      : null,
    site: row.site_id ? { id: row.site_id, name: row.site_name } : null,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    requestedDays: Number(row.requested_days),
    reason: row.reason,
    status: row.status,
    requestedByName: row.requested_by_name,
    decision: row.decided_at
      ? {
          decidedAt: row.decided_at,
          decidedByName: row.decided_by_name,
          note: row.decision_note,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
async function scopeOf(
  client: PoolClient,
  context: LeaveContext,
): Promise<Scope> {
  if (context.isOwner) return "organization";
  const r = await client.query<{ org: boolean; province: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM member_roles mr JOIN roles ro ON ro.organization_id=mr.organization_id AND ro.id=mr.role_id WHERE mr.organization_id=$1 AND mr.member_id=$2 AND ro.data_scope='organization') AS org, EXISTS(SELECT 1 FROM member_roles mr JOIN roles ro ON ro.organization_id=mr.organization_id AND ro.id=mr.role_id WHERE mr.organization_id=$1 AND mr.member_id=$2 AND ro.data_scope='province') AS province`,
    [context.organizationId, context.memberId],
  );
  return r.rows[0]?.org
    ? "organization"
    : r.rows[0]?.province
      ? "province"
      : "self";
}
async function provinceAllowed(
  client: PoolClient,
  context: LeaveContext,
  provinceId: string | null,
) {
  const scope = await scopeOf(client, context);
  if (scope === "organization") return;
  if (!provinceId) throw new NotFoundError("Leave request not found");
  if (scope === "self") throw new NotFoundError("Leave request not found");
  const r = await client.query(
    `SELECT 1 FROM member_provinces WHERE organization_id=$1 AND member_id=$2 AND province_id=$3`,
    [context.organizationId, context.memberId, provinceId],
  );
  if ((r.rowCount ?? 0) === 0)
    throw new NotFoundError("Leave request not found");
}
async function employeeFor(
  client: PoolClient,
  context: LeaveContext,
  employeeId: string,
) {
  const r = await client.query<{
    id: string;
    member_id: string | null;
    province_id: string | null;
    site_id: string | null;
    employment_status: string;
  }>(
    `SELECT id, member_id, province_id, site_id, employment_status FROM employees WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, employeeId],
  );
  const e = r.rows[0];
  if (!e || !["active", "probation", "on_leave"].includes(e.employment_status))
    throw new NotFoundError("Active employee not found");
  const scope = await scopeOf(client, context);
  if (scope === "self") {
    if (e.member_id !== context.memberId)
      throw new ForbiddenError("You can only request your own leave");
    return e;
  }
  await provinceAllowed(client, context, e.province_id);
  return e;
}
async function typeFor(client: PoolClient, org: string, id: string) {
  const r = await client.query<TypeRow>(
    `SELECT * FROM leave_types WHERE organization_id=$1 AND id=$2 AND is_active`,
    [org, id],
  );
  if (!r.rows[0]) throw new NotFoundError("Active leave type not found");
  return r.rows[0];
}
async function requestFor(client: PoolClient, org: string, id: string) {
  const r = await client.query<RequestRow>(
    `SELECT ${requestFields} FROM leave_requests r JOIN employees e ON e.organization_id=r.organization_id AND e.id=r.employee_id JOIN leave_types t ON t.organization_id=r.organization_id AND t.id=r.leave_type_id LEFT JOIN provinces p ON p.organization_id=r.organization_id AND p.id=r.province_id LEFT JOIN sites s ON s.organization_id=r.organization_id AND s.id=r.site_id LEFT JOIN users requester ON requester.id=r.requested_by LEFT JOIN users decider ON decider.id=r.decided_by WHERE r.organization_id=$1 AND r.id=$2`,
    [org, id],
  );
  if (!r.rows[0]) throw new NotFoundError("Leave request not found");
  return r.rows[0];
}
async function ensureBalance(
  client: PoolClient,
  org: string,
  employeeId: string,
  type: TypeRow,
  year: number,
) {
  await client.query(
    `INSERT INTO leave_balances (organization_id,employee_id,leave_type_id,leave_year,entitled_days) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (organization_id,employee_id,leave_type_id,leave_year) DO NOTHING`,
    [org, employeeId, type.id, year, type.annual_entitlement_days ?? 0],
  );
  const r = await client.query<{ id: string; remaining: string }>(
    `SELECT id,(entitled_days+carried_over_days-taken_days)::text AS remaining FROM leave_balances WHERE organization_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND leave_year=$4`,
    [org, employeeId, type.id, year],
  );
  return r.rows[0]!;
}
async function chargeBalance(
  client: PoolClient,
  context: LeaveContext,
  row: RequestRow,
  type: TypeRow,
) {
  if (type.annual_entitlement_days === null) return;
  const year = Number(row.starts_on.slice(0, 4));
  const balance = await ensureBalance(
    client,
    context.organizationId,
    row.employee_id,
    type,
    year,
  );
  if (Number(balance.remaining) < Number(row.requested_days))
    throw new ConflictError(
      "This employee does not have enough leave balance",
      { field: "requestedDays", remainingDays: Number(balance.remaining) },
    );
  await client.query(
    `UPDATE leave_balances SET taken_days=taken_days+$2 WHERE organization_id=$1 AND id=$3`,
    [context.organizationId, row.requested_days, balance.id],
  );
}
export async function listTypes(context: LeaveContext) {
  return withTenantContext(context, async (c) => {
    const r = await c.query<TypeRow>(
      `SELECT * FROM leave_types WHERE organization_id=$1 ORDER BY is_active DESC,name`,
      [context.organizationId],
    );
    return r.rows.map(mapType);
  });
}
export async function createType(
  context: LeaveContext,
  input: CreateLeaveTypeInput,
) {
  return withTenantContext(context, async (c) => {
    const r = await c.query<TypeRow>(
      `INSERT INTO leave_types (organization_id,code,name,annual_entitlement_days,is_paid,requires_approval,allows_backdating,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        context.organizationId,
        input.code,
        input.name,
        input.annualEntitlementDays ?? null,
        input.isPaid,
        input.requiresApproval,
        input.allowsBackdating,
        input.notes ?? null,
      ],
    );
    return mapType(r.rows[0]!);
  });
}
export async function updateType(
  context: LeaveContext,
  id: string,
  input: UpdateLeaveTypeInput,
) {
  return withTenantContext(context, async (c) => {
    const old = await c.query<TypeRow>(
      `SELECT * FROM leave_types WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, id],
    );
    if (!old.rows[0]) throw new NotFoundError("Leave type not found");
    const o = old.rows[0];
    const r = await c.query<TypeRow>(
      `UPDATE leave_types SET code=$3,name=$4,annual_entitlement_days=$5,is_paid=$6,requires_approval=$7,allows_backdating=$8,is_active=$9,notes=$10 WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [
        context.organizationId,
        id,
        input.code ?? o.code,
        input.name ?? o.name,
        input.annualEntitlementDays === undefined
          ? o.annual_entitlement_days
          : input.annualEntitlementDays,
        input.isPaid ?? o.is_paid,
        input.requiresApproval ?? o.requires_approval,
        input.allowsBackdating ?? o.allows_backdating,
        input.isActive ?? o.is_active,
        input.notes === undefined ? o.notes : input.notes,
      ],
    );
    return mapType(r.rows[0]!);
  });
}
export async function listRequests(
  context: LeaveContext,
  query: LeaveRequestQuery,
) {
  return withTenantContext(context, async (c) => {
    const scope = await scopeOf(c, context);
    const params: unknown[] = [context.organizationId];
    let where = `r.organization_id=$1`;
    if (query.status) {
      params.push(query.status);
      where += ` AND r.status=$${params.length}`;
    }
    if (query.employeeId) {
      params.push(query.employeeId);
      where += ` AND r.employee_id=$${params.length}`;
    }
    if (query.year) {
      params.push(query.year);
      where += ` AND EXTRACT(YEAR FROM r.starts_on)=$${params.length}`;
    }
    if (scope === "self") {
      params.push(context.memberId);
      where += ` AND e.member_id=$${params.length}`;
    } else if (scope === "province") {
      params.push(context.memberId);
      where += ` AND r.province_id IN (SELECT province_id FROM member_provinces WHERE organization_id=$1 AND member_id=$${params.length})`;
    }
    const r = await c.query<RequestRow>(
      `SELECT ${requestFields} FROM leave_requests r JOIN employees e ON e.organization_id=r.organization_id AND e.id=r.employee_id JOIN leave_types t ON t.organization_id=r.organization_id AND t.id=r.leave_type_id LEFT JOIN provinces p ON p.organization_id=r.organization_id AND p.id=r.province_id LEFT JOIN sites s ON s.organization_id=r.organization_id AND s.id=r.site_id LEFT JOIN users requester ON requester.id=r.requested_by LEFT JOIN users decider ON decider.id=r.decided_by WHERE ${where} ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.starts_on DESC`,
      params,
    );
    return r.rows.map(mapRequest);
  });
}
export async function requestLeave(
  context: LeaveContext,
  input: RequestLeaveInput,
) {
  return withTenantContext(context, async (c) => {
    const employee = await employeeFor(c, context, input.employeeId);
    const type = await typeFor(c, context.organizationId, input.leaveTypeId);
    const today = new Date().toISOString().slice(0, 10);
    if (!type.allows_backdating && input.startsOn < today)
      throw new BadRequestError("This leave type cannot be backdated", {
        field: "startsOn",
      });
    const status: RequestStatus = type.requires_approval
      ? "pending"
      : "approved";
    const r = await c.query<{ id: string }>(
      `INSERT INTO leave_requests (organization_id,employee_id,leave_type_id,province_id,site_id,starts_on,ends_on,requested_days,reason,status,requested_by,decided_by,decided_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        context.organizationId,
        employee.id,
        type.id,
        employee.province_id,
        employee.site_id,
        input.startsOn,
        input.endsOn,
        input.requestedDays,
        input.reason ?? null,
        status,
        context.userId,
        status === "approved" ? context.userId : null,
        status === "approved" ? new Date() : null,
      ],
    );
    const row = await requestFor(c, context.organizationId, r.rows[0]!.id);
    if (status === "approved") await chargeBalance(c, context, row, type);
    return mapRequest(await requestFor(c, context.organizationId, row.id));
  });
}
export async function decideLeave(
  context: LeaveContext,
  id: string,
  input: DecideLeaveInput,
) {
  return withTenantContext(context, async (c) => {
    const row = await requestFor(c, context.organizationId, id);
    await provinceAllowed(c, context, row.province_id);
    if (row.status !== "pending")
      throw new ConflictError("Only pending leave can be decided");
    if ((await scopeOf(c, context)) === "self")
      throw new ForbiddenError("You cannot decide leave requests");
    const type = await typeFor(c, context.organizationId, row.leave_type_id);
    if (input.status === "approved") await chargeBalance(c, context, row, type);
    await c.query(
      `UPDATE leave_requests SET status=$3,decided_by=$4,decided_at=now(),decision_note=$5 WHERE organization_id=$1 AND id=$2`,
      [
        context.organizationId,
        id,
        input.status,
        context.userId,
        input.decisionNote ?? null,
      ],
    );
    return mapRequest(await requestFor(c, context.organizationId, id));
  });
}
export async function cancelLeave(
  context: LeaveContext,
  id: string,
  input: CancelLeaveInput,
) {
  return withTenantContext(context, async (c) => {
    const row = await requestFor(c, context.organizationId, id);
    const scope = await scopeOf(c, context);
    if (scope === "self") {
      if (row.employee_member_id !== context.memberId)
        throw new ForbiddenError("You can only cancel your own leave");
    } else {
      await provinceAllowed(c, context, row.province_id);
    }
    if (!["pending", "approved"].includes(row.status))
      throw new ConflictError("This leave request can no longer be cancelled");
    if (row.status === "approved")
      throw new ConflictError(
        "Approved leave must be reversed by HR before cancellation",
      );
    await c.query(
      `UPDATE leave_requests SET status='cancelled',decision_note=COALESCE($3,decision_note) WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, id, input.notes ?? null],
    );
    return mapRequest(await requestFor(c, context.organizationId, id));
  });
}
export async function summary(context: LeaveContext, year: number) {
  return withTenantContext(context, async (c) => {
    const scope = await scopeOf(c, context);
    const params: unknown[] = [context.organizationId, year];
    let access = "";
    if (scope === "self") {
      params.push(context.memberId);
      access = ` AND e.member_id=$${params.length}`;
    } else if (scope === "province") {
      params.push(context.memberId);
      access = ` AND e.province_id IN (SELECT province_id FROM member_provinces WHERE organization_id=$1 AND member_id=$${params.length})`;
    }
    const r = await c.query<{
      pending: string;
      approved: string;
      taken: string;
      people: string;
      days: string;
    }>(
      `SELECT COUNT(*) FILTER (WHERE r.status='pending')::text AS pending,COUNT(*) FILTER (WHERE r.status='approved')::text AS approved,COUNT(*) FILTER (WHERE r.status='taken')::text AS taken,COUNT(DISTINCT r.employee_id)::text AS people,COALESCE(SUM(r.requested_days) FILTER (WHERE r.status IN ('approved','taken')),0)::text AS days FROM leave_requests r JOIN employees e ON e.organization_id=r.organization_id AND e.id=r.employee_id WHERE r.organization_id=$1 AND EXTRACT(YEAR FROM r.starts_on)=$2 ${access}`,
      params,
    );
    const balances = await c.query<{
      employee_id: string;
      employee_number: string;
      employee_name: string;
      type_id: string;
      type_name: string;
      entitled: string;
      carried: string;
      taken: string;
    }>(
      `SELECT b.employee_id,e.employee_number,e.full_name AS employee_name,b.leave_type_id,t.name AS type_name,b.entitled_days::text AS entitled,b.carried_over_days::text AS carried,b.taken_days::text AS taken FROM leave_balances b JOIN employees e ON e.organization_id=b.organization_id AND e.id=b.employee_id JOIN leave_types t ON t.organization_id=b.organization_id AND t.id=b.leave_type_id WHERE b.organization_id=$1 AND b.leave_year=$2 ${access.replaceAll("e.", "e.")}`,
      params,
    );
    return {
      metrics: {
        pending: Number(r.rows[0]?.pending ?? 0),
        approved: Number(r.rows[0]?.approved ?? 0),
        taken: Number(r.rows[0]?.taken ?? 0),
        people: Number(r.rows[0]?.people ?? 0),
        days: Number(r.rows[0]?.days ?? 0),
      },
      balances: balances.rows.map((b) => ({
        employee: {
          id: b.employee_id,
          employeeNumber: b.employee_number,
          fullName: b.employee_name,
        },
        leaveType: { id: b.type_id, name: b.type_name },
        entitledDays: Number(b.entitled),
        carriedOverDays: Number(b.carried),
        takenDays: Number(b.taken),
        remainingDays: Number(b.entitled) + Number(b.carried) - Number(b.taken),
      })),
    };
  });
}
export async function currentEmployee(context: LeaveContext) {
  return withTenantContext(context, async (c) => {
    const r = await c.query<{
      id: string;
      employee_number: string;
      full_name: string;
      job_title: string;
      province_id: string | null;
      province_name: string | null;
      site_id: string | null;
      site_name: string | null;
    }>(
      `SELECT e.id,e.employee_number,e.full_name,e.job_title,e.province_id,p.name AS province_name,e.site_id,s.name AS site_name FROM employees e LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=e.organization_id AND s.id=e.site_id WHERE e.organization_id=$1 AND e.member_id=$2 AND e.employment_status IN ('active','probation','on_leave') ORDER BY e.created_at LIMIT 1`,
      [context.organizationId, context.memberId],
    );
    const row = r.rows[0];
    return row
      ? {
          id: row.id,
          employeeNumber: row.employee_number,
          fullName: row.full_name,
          jobTitle: row.job_title,
          province: row.province_id
            ? { id: row.province_id, name: row.province_name }
            : null,
          site: row.site_id ? { id: row.site_id, name: row.site_name } : null,
        }
      : null;
  });
}
