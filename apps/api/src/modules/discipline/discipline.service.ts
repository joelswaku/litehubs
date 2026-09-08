import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type {
  ActionQuery,
  CreateActionInput,
  DecisionInput,
  UpdateActionInput,
} from "./discipline.validation";

export interface DisciplineContext {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
  permissions: string[];
}
type Scope = "organization" | "province" | "self";
type Status =
  "open" | "under_review" | "upheld" | "dismissed" | "appealed" | "closed";
interface EmployeeRow {
  id: string;
  member_id: string | null;
  employee_number: string;
  full_name: string;
  job_title: string;
  province_id: string | null;
  province_name: string | null;
  site_id: string | null;
  site_name: string | null;
  employment_status: string;
}
interface ActionRow {
  id: string;
  employee_id: string;
  reference: string;
  occurred_on: string;
  reported_on: string;
  category: string;
  severity: string;
  action_taken: string;
  description: string;
  employee_statement: string | null;
  status: Status;
  expires_on: string | null;
  decision_note: string | null;
  decided_at: Date | null;
  created_at: Date;
  updated_at: Date;
  employee_member_id: string | null;
  employee_number: string;
  employee_name: string;
  employee_job_title: string;
  province_id: string | null;
  province_name: string | null;
  site_id: string | null;
  site_name: string | null;
  raised_by: string | null;
  submitted_by: string | null;
  submitted_at: Date | null;
  raised_by_name: string | null;
  submitted_by_name: string | null;
  decided_by_name: string | null;
}
const actionFields = `a.id,a.employee_id,a.reference,a.occurred_on::text,a.reported_on::text,a.category,a.severity,a.action_taken,a.description,a.employee_statement,a.status,a.expires_on::text,a.decision_note,a.decided_at,a.raised_by,a.submitted_by,a.submitted_at,a.created_at,a.updated_at,e.member_id AS employee_member_id,e.employee_number,e.full_name AS employee_name,e.job_title AS employee_job_title,e.province_id,p.name AS province_name,e.site_id,s.name AS site_name,raiser.full_name AS raised_by_name,submitter.full_name AS submitted_by_name,decider.full_name AS decided_by_name`;
function mapEmployee(row: EmployeeRow) {
  return {
    id: row.id,
    employeeNumber: row.employee_number,
    fullName: row.full_name,
    jobTitle: row.job_title,
    province: row.province_id
      ? { id: row.province_id, name: row.province_name }
      : null,
    site: row.site_id ? { id: row.site_id, name: row.site_name } : null,
  };
}
function mapAction(row: ActionRow) {
  return {
    id: row.id,
    reference: row.reference,
    employee: {
      id: row.employee_id,
      employeeNumber: row.employee_number,
      fullName: row.employee_name,
      jobTitle: row.employee_job_title,
    },
    province: row.province_id
      ? { id: row.province_id, name: row.province_name }
      : null,
    site: row.site_id ? { id: row.site_id, name: row.site_name } : null,
    occurredOn: row.occurred_on,
    reportedOn: row.reported_on,
    category: row.category,
    severity: row.severity,
    actionTaken: row.action_taken,
    description: row.description,
    employeeStatement: row.employee_statement,
    status: row.status,
    expiresOn: row.expires_on,
    raisedByName: row.raised_by_name,
    submission: row.submitted_at
      ? { submittedAt: row.submitted_at, submittedByName: row.submitted_by_name }
      : null,
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
  context: DisciplineContext,
): Promise<Scope> {
  if (context.isOwner) return "organization";
  const result = await client.query<{
    organization: boolean;
    province: boolean;
  }>(
    `SELECT EXISTS(SELECT 1 FROM member_roles mr JOIN roles ro ON ro.organization_id=mr.organization_id AND ro.id=mr.role_id WHERE mr.organization_id=$1 AND mr.member_id=$2 AND ro.data_scope='organization') AS organization, EXISTS(SELECT 1 FROM member_roles mr JOIN roles ro ON ro.organization_id=mr.organization_id AND ro.id=mr.role_id WHERE mr.organization_id=$1 AND mr.member_id=$2 AND ro.data_scope='province') AS province`,
    [context.organizationId, context.memberId],
  );
  return result.rows[0]?.organization
    ? "organization"
    : result.rows[0]?.province
      ? "province"
      : "self";
}
async function assertCanSubmitForDecision(
  client: PoolClient,
  context: DisciplineContext,
) {
  if (context.permissions.includes("disciplinary_actions.submit")) return;
  throw new ForbiddenError(
    "Only an authorized HR or performance officer can submit a disciplinary case for decision",
  );
}

async function assertCanMakeFinalDecision(
  client: PoolClient,
  context: DisciplineContext,
) {
  if (context.isOwner) return;
  const result = await client.query<{ allowed: boolean }>(
    `SELECT EXISTS(
      SELECT 1
      FROM member_roles mr
      JOIN roles r ON r.organization_id=mr.organization_id AND r.id=mr.role_id
      WHERE mr.organization_id=$1 AND mr.member_id=$2 AND r.code='general_manager'
    ) AS allowed`,
    [context.organizationId, context.memberId],
  );
  if (!result.rows[0]?.allowed)
    throw new ForbiddenError(
      "Only the workspace owner or General Manager can make a final disciplinary decision",
    );
}
async function assertProvince(
  client: PoolClient,
  context: DisciplineContext,
  employee: Pick<EmployeeRow, "province_id"> & { member_id?: string | null },
) {
  const scope = await scopeOf(client, context);
  if (scope === "organization") return;
  if (scope === "self")
    throw new ForbiddenError(
      "Disciplinary records are managed by authorized staff",
    );
  if (!employee.province_id)
    throw new NotFoundError("Disciplinary record not found");
  const allowed = await client.query(
    `SELECT 1 FROM member_provinces WHERE organization_id=$1 AND member_id=$2 AND province_id=$3`,
    [context.organizationId, context.memberId, employee.province_id],
  );
  if ((allowed.rowCount ?? 0) === 0)
    throw new NotFoundError("Disciplinary record not found");
}
async function employeeFor(
  client: PoolClient,
  context: DisciplineContext,
  employeeId: string,
) {
  const result = await client.query<EmployeeRow>(
    `SELECT e.id,e.member_id,e.employee_number,e.full_name,e.job_title,e.province_id,p.name AS province_name,e.site_id,s.name AS site_name,e.employment_status FROM employees e LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=e.organization_id AND s.id=e.site_id WHERE e.organization_id=$1 AND e.id=$2`,
    [context.organizationId, employeeId],
  );
  const employee = result.rows[0];
  if (
    !employee ||
    !["active", "probation", "on_leave", "terminated"].includes(
      employee.employment_status,
    )
  )
    throw new NotFoundError("Employee not found");
  await assertProvince(client, context, employee);
  return employee;
}
async function actionFor(
  client: PoolClient,
  context: DisciplineContext,
  actionId: string,
) {
  const result = await client.query<ActionRow>(
    `SELECT ${actionFields} FROM disciplinary_actions a JOIN employees e ON e.organization_id=a.organization_id AND e.id=a.employee_id LEFT JOIN provinces p ON p.organization_id=a.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=a.organization_id AND s.id=e.site_id LEFT JOIN users raiser ON raiser.id=a.raised_by LEFT JOIN users submitter ON submitter.id=a.submitted_by LEFT JOIN users decider ON decider.id=a.decided_by WHERE a.organization_id=$1 AND a.id=$2`,
    [context.organizationId, actionId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Disciplinary record not found");
  await assertProvince(client, context, { province_id: row.province_id });
  return row;
}
function generatedReference() {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `DISC-${day}-${randomUUID().slice(0, 7).toUpperCase()}`;
}
export async function listActions(
  context: DisciplineContext,
  query: ActionQuery,
) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context);
    if (scope === "self")
      throw new ForbiddenError(
        "Disciplinary records are not available in self-service",
      );
    const params: unknown[] = [context.organizationId];
    const where = ["a.organization_id=$1"];
    if (query.status) {
      params.push(query.status);
      where.push(`a.status=$${params.length}`);
    }
    if (query.employeeId) {
      params.push(query.employeeId);
      where.push(`a.employee_id=$${params.length}`);
    }
    if (query.category) {
      params.push(query.category);
      where.push(`a.category=$${params.length}`);
    }
    if (query.severity) {
      params.push(query.severity);
      where.push(`a.severity=$${params.length}`);
    }
    if (scope === "province") {
      params.push(context.memberId);
      where.push(
        `a.province_id IN (SELECT province_id FROM member_provinces WHERE organization_id=$1 AND member_id=$${params.length})`,
      );
    }
    const result = await client.query<ActionRow>(
      `SELECT ${actionFields} FROM disciplinary_actions a JOIN employees e ON e.organization_id=a.organization_id AND e.id=a.employee_id LEFT JOIN provinces p ON p.organization_id=a.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=a.organization_id AND s.id=e.site_id LEFT JOIN users raiser ON raiser.id=a.raised_by LEFT JOIN users submitter ON submitter.id=a.submitted_by LEFT JOIN users decider ON decider.id=a.decided_by WHERE ${where.join(" AND ")} ORDER BY CASE a.status WHEN 'open' THEN 0 WHEN 'under_review' THEN 1 WHEN 'appealed' THEN 2 ELSE 3 END,a.occurred_on DESC,a.created_at DESC`,
      params,
    );
    return result.rows.map(mapAction);
  });
}
export async function createAction(
  context: DisciplineContext,
  input: CreateActionInput,
) {
  return withTenantContext(context, async (client) => {
    const employee = await employeeFor(client, context, input.employeeId);
    const reportedOn =
      input.reportedOn ?? new Date().toISOString().slice(0, 10);
    if (reportedOn < input.occurredOn)
      throw new BadRequestError(
        "Reported date cannot be before incident date",
        { field: "reportedOn" },
      );
    if (input.expiresOn && input.expiresOn < input.occurredOn)
      throw new BadRequestError("Expiry cannot be before incident date", {
        field: "expiresOn",
      });
    const result = await client.query<{ id: string }>(
      `INSERT INTO disciplinary_actions (organization_id,employee_id,province_id,site_id,reference,occurred_on,reported_on,category,severity,action_taken,description,employee_statement,expires_on,raised_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [
        context.organizationId,
        employee.id,
        employee.province_id,
        employee.site_id,
        input.reference ?? generatedReference(),
        input.occurredOn,
        reportedOn,
        input.category,
        input.severity ?? "minor",
        input.actionTaken ?? "verbal_warning",
        input.description,
        input.employeeStatement ?? null,
        input.expiresOn ?? null,
        context.userId,
      ],
    );
    return mapAction(await actionFor(client, context, result.rows[0]!.id));
  });
}
export async function updateAction(
  context: DisciplineContext,
  actionId: string,
  input: UpdateActionInput,
) {
  return withTenantContext(context, async (client) => {
    const old = await actionFor(client, context, actionId);
    if (
      input.status &&
      ["upheld", "dismissed", "closed"].includes(input.status)
    )
      throw new BadRequestError(
        "Use the final decision action to resolve a disciplinary record",
        { field: "status" },
      );
    const submittingForDecision = input.status === "under_review";
    if (submittingForDecision) {
      if (old.status !== "open")
        throw new BadRequestError(
          "Only an open disciplinary case can be submitted for decision",
          { field: "status" },
        );
      await assertCanSubmitForDecision(client, context);
    }
    const occurredOn = input.occurredOn ?? old.occurred_on;
    const reportedOn = input.reportedOn ?? old.reported_on;
    const expiresOn =
      input.expiresOn === undefined ? old.expires_on : input.expiresOn;
    if (reportedOn < occurredOn)
      throw new BadRequestError(
        "Reported date cannot be before incident date",
        { field: "reportedOn" },
      );
    if (expiresOn && expiresOn < occurredOn)
      throw new BadRequestError("Expiry cannot be before incident date", {
        field: "expiresOn",
      });
    await client.query(
      `UPDATE disciplinary_actions
         SET reference=$3,occurred_on=$4,reported_on=$5,category=$6,severity=$7,action_taken=$8,
             description=$9,employee_statement=$10,status=$11,expires_on=$12,
             submitted_by=CASE WHEN $13 THEN $14 ELSE submitted_by END,
             submitted_at=CASE WHEN $13 THEN now() ELSE submitted_at END
       WHERE organization_id=$1 AND id=$2`,
      [
        context.organizationId,
        actionId,
        input.reference ?? old.reference,
        occurredOn,
        reportedOn,
        input.category ?? old.category,
        input.severity ?? old.severity,
        input.actionTaken ?? old.action_taken,
        input.description ?? old.description,
        input.employeeStatement === undefined
          ? old.employee_statement
          : input.employeeStatement,
        input.status ?? old.status,
        expiresOn,
        submittingForDecision,
        context.userId,
      ],
    );
    return mapAction(await actionFor(client, context, actionId));
  });
}
export async function decideAction(
  context: DisciplineContext,
  actionId: string,
  input: DecisionInput,
) {
  return withTenantContext(context, async (client) => {
    const old = await actionFor(client, context, actionId);
    if (!["under_review", "appealed"].includes(old.status))
      throw new BadRequestError(
        "This disciplinary record must first be submitted for decision, or be awaiting an appeal decision",
        { field: "status" },
      );
    await assertCanMakeFinalDecision(client, context);
    if (old.submitted_by === context.userId)
      throw new ForbiddenError(
        "The person who submitted a disciplinary case cannot make its final decision",
      );
    const expiresOn =
      input.expiresOn === undefined ? old.expires_on : input.expiresOn;
    if (expiresOn && expiresOn < old.occurred_on)
      throw new BadRequestError("Expiry cannot be before incident date", {
        field: "expiresOn",
      });
    await client.query(
      `UPDATE disciplinary_actions SET status=$3,action_taken=$4,expires_on=$5,decision_note=$6,decided_by=$7,decided_at=now() WHERE organization_id=$1 AND id=$2`,
      [
        context.organizationId,
        actionId,
        input.status,
        input.actionTaken ?? old.action_taken,
        expiresOn,
        input.decisionNote ?? null,
        context.userId,
      ],
    );
    return mapAction(await actionFor(client, context, actionId));
  });
}
export async function summary(context: DisciplineContext) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context);
    if (scope === "self")
      throw new ForbiddenError(
        "Disciplinary records are not available in self-service",
      );
    const params: unknown[] = [context.organizationId];
    const access =
      scope === "province"
        ? " AND a.province_id IN (SELECT province_id FROM member_provinces WHERE organization_id=$1 AND member_id=$2)"
        : "";
    if (scope === "province") params.push(context.memberId);
    const result = await client.query<{
      open: string;
      review: string;
      appealed: string;
      closed: string;
      serious: string;
    }>(
      `SELECT COUNT(*) FILTER (WHERE a.status='open')::text AS open,COUNT(*) FILTER (WHERE a.status='under_review')::text AS review,COUNT(*) FILTER (WHERE a.status='appealed')::text AS appealed,COUNT(*) FILTER (WHERE a.status IN ('upheld','dismissed','closed'))::text AS closed,COUNT(*) FILTER (WHERE a.status IN ('open','under_review','appealed') AND a.severity IN ('serious','gross'))::text AS serious FROM disciplinary_actions a WHERE a.organization_id=$1 ${access}`,
      params,
    );
    const row = result.rows[0];
    return {
      metrics: {
        open: Number(row?.open ?? 0),
        underReview: Number(row?.review ?? 0),
        appealed: Number(row?.appealed ?? 0),
        closed: Number(row?.closed ?? 0),
        serious: Number(row?.serious ?? 0),
      },
    };
  });
}
