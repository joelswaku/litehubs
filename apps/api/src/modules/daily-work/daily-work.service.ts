import type { PoolClient } from "pg";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type { DailyWorkQuery } from "./daily-work.validation";

export interface DailyWorkContext {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
}
type Row = Record<string, unknown>;
type Scope = "organization" | "province" | "self";
const today = () => new Date().toISOString().slice(0, 10);
const camel = (name: string) =>
  name.replace(/_([a-z0-9])/g, (_, character: string) =>
    character.toUpperCase(),
  );
const mapRow = (row: Row): Row =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      camel(key),
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
function conflict(error: unknown): never {
  if ((error as { code?: string }).code === "23505")
    throw new ConflictError("A record with that value already exists");
  throw error;
}

async function scopeOf(
  client: PoolClient,
  context: DailyWorkContext,
): Promise<Scope> {
  if (context.isOwner) return "organization";
  const result = await client.query<{
    organization_scope: boolean;
    province_scope: boolean;
  }>(
    `SELECT EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id = mr.organization_id AND r.id = mr.role_id WHERE mr.organization_id = $1 AND mr.member_id = $2 AND r.data_scope = 'organization') AS organization_scope, EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id = mr.organization_id AND r.id = mr.role_id WHERE mr.organization_id = $1 AND mr.member_id = $2 AND r.data_scope = 'province') AS province_scope`,
    [context.organizationId, context.memberId],
  );
  return result.rows[0]?.organization_scope
    ? "organization"
    : result.rows[0]?.province_scope
      ? "province"
      : "self";
}
async function provinceIds(
  client: PoolClient,
  context: DailyWorkContext,
): Promise<string[] | null> {
  if ((await scopeOf(client, context)) === "organization") return null;
  const result = await client.query<{ province_id: string }>(
    "SELECT province_id FROM member_provinces WHERE organization_id = $1 AND member_id = $2",
    [context.organizationId, context.memberId],
  );
  return result.rows.map((row) => row.province_id);
}
async function ownEmployeeId(
  client: PoolClient,
  context: DailyWorkContext,
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM employees WHERE organization_id = $1 AND member_id = $2 AND employment_status = 'active'",
    [context.organizationId, context.memberId],
  );
  return result.rows[0]?.id ?? null;
}
function addProvinceFilter(
  values: unknown[],
  conditions: string[],
  provinces: string[] | null,
  field: string,
) {
  if (provinces !== null) {
    values.push(provinces);
    conditions.push(`${field} = ANY($${values.length}::uuid[])`);
  }
}
async function assertProvince(
  client: PoolClient,
  context: DailyWorkContext,
  provinceId: string | null,
): Promise<void> {
  const scope = await scopeOf(client, context);
  if (scope === "organization") return;
  if (!provinceId || scope === "self")
    throw new NotFoundError("Record not found");
  const found = await client.query(
    "SELECT 1 FROM member_provinces WHERE organization_id = $1 AND member_id = $2 AND province_id = $3",
    [context.organizationId, context.memberId, provinceId],
  );
  if (!found.rowCount) throw new NotFoundError("Record not found");
}
async function siteLocation(
  client: PoolClient,
  context: DailyWorkContext,
  siteId: string,
): Promise<{ provinceId: string; siteId: string }> {
  const result = await client.query<{ province_id: string }>(
    "SELECT province_id FROM sites WHERE organization_id = $1 AND id = $2 AND is_active",
    [context.organizationId, siteId],
  );
  const provinceId = result.rows[0]?.province_id;
  if (!provinceId) throw new NotFoundError("Active site not found");
  await assertProvince(client, context, provinceId);
  return { provinceId, siteId };
}
async function optionalLocation(
  client: PoolClient,
  context: DailyWorkContext,
  siteId: unknown,
  provinceId: unknown,
) {
  if (siteId) return siteLocation(client, context, String(siteId));
  if (provinceId) {
    await assertProvince(client, context, String(provinceId));
    return { provinceId: String(provinceId), siteId: null as string | null };
  }
  return { provinceId: null as string | null, siteId: null as string | null };
}
async function record(
  client: PoolClient,
  context: DailyWorkContext,
  table: string,
  id: string,
): Promise<Row> {
  const found = await client.query<Row>(
    `SELECT * FROM ${table} WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, id],
  );
  const row = found.rows[0];
  if (!row) throw new NotFoundError("Record not found");
  return row;
}
async function assertTemplate(
  client: PoolClient,
  context: DailyWorkContext,
  id: string,
): Promise<Row> {
  const row = await record(client, context, "checklist_templates", id);
  if (row.site_id) {
    const location = await siteLocation(client, context, String(row.site_id));
    await assertProvince(client, context, location.provinceId);
  } else if ((await scopeOf(client, context)) === "self")
    throw new NotFoundError("Checklist template not found");
  return row;
}
async function assertRun(
  client: PoolClient,
  context: DailyWorkContext,
  id: string,
): Promise<Row> {
  const row = await record(client, context, "checklist_runs", id);
  const scope = await scopeOf(client, context);
  if (scope === "self") {
    if (row.created_by_member_id !== context.memberId)
      throw new NotFoundError("Checklist run not found");
  } else await assertProvince(client, context, String(row.province_id ?? ""));
  return row;
}
async function refreshRunCounts(
  client: PoolClient,
  organizationId: string,
  runId: string,
) {
  await client.query(
    `UPDATE checklist_runs r SET items_total = (SELECT count(*) FROM checklist_template_items i WHERE i.organization_id = r.organization_id AND i.template_id = r.template_id), items_completed = (SELECT count(*) FROM checklist_responses x WHERE x.organization_id = r.organization_id AND x.run_id = r.id), items_failed = (SELECT count(*) FROM checklist_responses x WHERE x.organization_id = r.organization_id AND x.run_id = r.id AND x.passed = false) WHERE r.organization_id = $1 AND r.id = $2`,
    [organizationId, runId],
  );
}

function templateMap(row: Row) {
  return mapRow(row);
}
export async function listTemplates(
  context: DailyWorkContext,
  input: DailyWorkQuery,
) {
  return withTenantContext(context, async (client) => {
    const provinces = await provinceIds(client, context);
    const values: unknown[] = [context.organizationId];
    const conditions = ["t.organization_id = $1"];
    if (input.siteId) {
      values.push(input.siteId);
      conditions.push(`t.site_id = $${values.length}`);
    }
    if (provinces !== null) {
      values.push(provinces);
      conditions.push(
        `(t.site_id IS NULL OR s.province_id = ANY($${values.length}::uuid[]))`,
      );
    }
    const result = await client.query<Row>(
      `SELECT t.*, s.name AS site_name, d.name AS department_name, (SELECT count(*) FROM checklist_template_items i WHERE i.organization_id = t.organization_id AND i.template_id = t.id) AS item_count, COALESCE((SELECT json_agg(json_build_object('id', i.id, 'position', i.position, 'prompt', i.prompt, 'responseType', i.response_type, 'unit', i.unit, 'isRequired', i.is_required, 'criticalControlId', i.critical_control_id, 'guidance', i.guidance) ORDER BY i.position) FROM checklist_template_items i WHERE i.organization_id = t.organization_id AND i.template_id = t.id), '[]'::json) AS items FROM checklist_templates t LEFT JOIN sites s ON s.organization_id = t.organization_id AND s.id = t.site_id LEFT JOIN departments d ON d.organization_id = t.organization_id AND d.id = t.department_id WHERE ${conditions.join(" AND ")} ORDER BY t.domain, t.name`,
      values,
    );
    return result.rows.map(templateMap);
  });
}
export async function createTemplate(
  context: DailyWorkContext,
  input: Record<string, unknown>,
) {
  try {
    return await withTenantContext(context, async (client) => {
      if (input.siteId)
        await siteLocation(client, context, String(input.siteId));
      if ((await scopeOf(client, context)) === "self")
        throw new NotFoundError("Checklist template not found");
      const result = await client.query<Row>(
        `INSERT INTO checklist_templates (organization_id, code, name, description, domain, frequency, site_id, department_id, is_active, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,true),$10) RETURNING *`,
        [
          context.organizationId,
          input.code,
          input.name,
          input.description ?? null,
          input.domain ?? "general",
          input.frequency ?? "daily",
          input.siteId ?? null,
          input.departmentId ?? null,
          input.isActive,
          context.userId,
        ],
      );
      return mapRow(result.rows[0]!);
    });
  } catch (error) {
    return conflict(error);
  }
}
export async function updateTemplate(
  context: DailyWorkContext,
  id: string,
  input: Record<string, unknown>,
) {
  return withTenantContext(context, async (client) => {
    await assertTemplate(client, context, id);
    if (input.siteId) await siteLocation(client, context, String(input.siteId));
    const allowed = [
      "code",
      "name",
      "description",
      "domain",
      "frequency",
      "siteId",
      "departmentId",
      "isActive",
    ];
    const entries = Object.entries(input).filter(
      ([key, value]) => allowed.includes(key) && value !== undefined,
    );
    if (!entries.length)
      throw new BadRequestError("Provide at least one value to change");
    const values: unknown[] = [
      context.organizationId,
      id,
      ...entries.map(([, v]) => v),
    ];
    await client.query(
      `UPDATE checklist_templates SET ${entries.map(([key], i) => `${key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)} = $${i + 3}`).join(", ")} WHERE organization_id = $1 AND id = $2`,
      values,
    );
    return mapRow(await record(client, context, "checklist_templates", id));
  });
}
export async function deleteTemplate(context: DailyWorkContext, id: string) {
  return withTenantContext(context, async (client) => {
    await assertTemplate(client, context, id);
    const count = await client.query(
      "SELECT 1 FROM checklist_runs WHERE organization_id=$1 AND template_id=$2 LIMIT 1",
      [context.organizationId, id],
    );
    if (count.rowCount)
      throw new BadRequestError(
        "A checklist template with recorded runs cannot be deleted; deactivate it instead",
      );
    await client.query(
      "DELETE FROM checklist_templates WHERE organization_id=$1 AND id=$2",
      [context.organizationId, id],
    );
  });
}
export async function createTemplateItem(
  context: DailyWorkContext,
  templateId: string,
  input: Record<string, unknown>,
) {
  try {
    return await withTenantContext(context, async (client) => {
      await assertTemplate(client, context, templateId);
      const result = await client.query<Row>(
        `INSERT INTO checklist_template_items (organization_id,template_id,position,prompt,response_type,unit,is_required,critical_control_id,guidance) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,true),$8,$9) RETURNING *`,
        [
          context.organizationId,
          templateId,
          input.position,
          input.prompt,
          input.responseType ?? "boolean",
          input.unit ?? null,
          input.isRequired,
          input.criticalControlId ?? null,
          input.guidance ?? null,
        ],
      );
      return mapRow(result.rows[0]!);
    });
  } catch (error) {
    return conflict(error);
  }
}
export async function updateTemplateItem(
  context: DailyWorkContext,
  templateId: string,
  itemId: string,
  input: Record<string, unknown>,
) {
  return withTenantContext(context, async (client) => {
    await assertTemplate(client, context, templateId);
    const found = await client.query<Row>(
      "SELECT * FROM checklist_template_items WHERE organization_id=$1 AND id=$2 AND template_id=$3",
      [context.organizationId, itemId, templateId],
    );
    if (!found.rowCount) throw new NotFoundError("Checklist item not found");
    const allowed = [
      "position",
      "prompt",
      "responseType",
      "unit",
      "isRequired",
      "criticalControlId",
      "guidance",
    ];
    const entries = Object.entries(input).filter(
      ([key, value]) => allowed.includes(key) && value !== undefined,
    );
    if (!entries.length)
      throw new BadRequestError("Provide at least one value to change");
    const values: unknown[] = [
      context.organizationId,
      itemId,
      ...entries.map(([, v]) => v),
    ];
    await client.query(
      `UPDATE checklist_template_items SET ${entries.map(([key], i) => `${key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}=$${i + 3}`).join(", ")} WHERE organization_id=$1 AND id=$2`,
      values,
    );
    return mapRow(
      (
        await client.query<Row>(
          "SELECT * FROM checklist_template_items WHERE organization_id=$1 AND id=$2",
          [context.organizationId, itemId],
        )
      ).rows[0]!,
    );
  });
}
export async function deleteTemplateItem(
  context: DailyWorkContext,
  templateId: string,
  itemId: string,
) {
  return withTenantContext(context, async (client) => {
    await assertTemplate(client, context, templateId);
    const result = await client.query(
      "DELETE FROM checklist_template_items WHERE organization_id=$1 AND id=$2 AND template_id=$3",
      [context.organizationId, itemId, templateId],
    );
    if (!result.rowCount) throw new NotFoundError("Checklist item not found");
  });
}

async function runDetail(
  client: PoolClient,
  context: DailyWorkContext,
  id: string,
) {
  const run = await assertRun(client, context, id);
  const info = await client.query<Row>(
    `SELECT r.*,t.name AS template_name,t.domain,s.name AS site_name,p.name AS province_name FROM checklist_runs r JOIN checklist_templates t ON t.organization_id=r.organization_id AND t.id=r.template_id LEFT JOIN sites s ON s.organization_id=r.organization_id AND s.id=r.site_id LEFT JOIN provinces p ON p.organization_id=r.organization_id AND p.id=r.province_id WHERE r.organization_id=$1 AND r.id=$2`,
    [context.organizationId, id],
  );
  const items = await client.query<Row>(
    `SELECT i.*,x.boolean_value,x.number_value,x.text_value,x.passed,x.comment,x.answered_at,x.alert_id FROM checklist_template_items i LEFT JOIN checklist_responses x ON x.organization_id=i.organization_id AND x.item_id=i.id AND x.run_id=$2 WHERE i.organization_id=$1 AND i.template_id=$3 ORDER BY i.position`,
    [context.organizationId, id, run.template_id],
  );
  return { ...mapRow(info.rows[0]!), items: items.rows.map(mapRow) };
}
export async function listRuns(
  context: DailyWorkContext,
  input: DailyWorkQuery,
) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context),
      provinces = await provinceIds(client, context),
      values: unknown[] = [context.organizationId],
      conditions = ["r.organization_id=$1"];
    if (input.workDate) {
      values.push(input.workDate);
      conditions.push(`r.work_date=$${values.length}::date`);
    }
    if (input.siteId) {
      values.push(input.siteId);
      conditions.push(`r.site_id=$${values.length}`);
    }
    if (input.status) {
      values.push(input.status);
      conditions.push(`r.status=$${values.length}`);
    }
    if (scope === "self") {
      values.push(context.memberId);
      conditions.push(`r.created_by_member_id=$${values.length}`);
    } else addProvinceFilter(values, conditions, provinces, "r.province_id");
    const result = await client.query<Row>(
      `SELECT r.*,t.name AS template_name,t.domain,s.name AS site_name,p.name AS province_name FROM checklist_runs r JOIN checklist_templates t ON t.organization_id=r.organization_id AND t.id=r.template_id LEFT JOIN sites s ON s.organization_id=r.organization_id AND s.id=r.site_id LEFT JOIN provinces p ON p.organization_id=r.organization_id AND p.id=r.province_id WHERE ${conditions.join(" AND ")} ORDER BY r.work_date DESC,r.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, input.limit, input.offset],
    );
    return result.rows.map(mapRow);
  });
}
export async function createRun(
  context: DailyWorkContext,
  input: Record<string, unknown>,
) {
  try {
    return await withTenantContext(context, async (client) => {
      const template = await assertTemplate(
        client,
        context,
        String(input.templateId),
      );
      const siteId = String(input.siteId ?? template.site_id ?? "");
      if (!siteId)
        throw new BadRequestError("Select a site for this checklist run");
      const location = await siteLocation(client, context, siteId);
      const workDate = String(input.workDate ?? today());
      const result = await client.query<{ id: string }>(
        `INSERT INTO checklist_runs (organization_id,template_id,province_id,site_id,shift_id,work_date,notes,created_by_member_id,items_total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT count(*) FROM checklist_template_items WHERE organization_id=$1 AND template_id=$2)) RETURNING id`,
        [
          context.organizationId,
          template.id,
          location.provinceId,
          siteId,
          input.shiftId ?? null,
          workDate,
          input.notes ?? null,
          context.memberId,
        ],
      );
      return runDetail(client, context, result.rows[0]!.id);
    });
  } catch (error) {
    return conflict(error);
  }
}
export async function getRun(context: DailyWorkContext, id: string) {
  return withTenantContext(context, (client) => runDetail(client, context, id));
}
export async function answerRunItem(
  context: DailyWorkContext,
  runId: string,
  itemId: string,
  input: Record<string, unknown>,
) {
  return withTenantContext(context, async (client) => {
    const run = await assertRun(client, context, runId);
    if (run.status !== "in_progress")
      throw new BadRequestError(
        "Only an in-progress checklist can be answered",
      );
    const item = (
      await client.query<Row>(
        "SELECT * FROM checklist_template_items WHERE organization_id=$1 AND id=$2 AND template_id=$3",
        [context.organizationId, itemId, run.template_id],
      )
    ).rows[0];
    if (!item) throw new NotFoundError("Checklist item not found");
    const type = String(item.response_type);
    if (
      (type === "boolean") !== (input.booleanValue !== undefined) ||
      (type === "number") !== (input.numberValue !== undefined) ||
      ["text", "choice", "photo"].includes(type) !==
        (input.textValue !== undefined)
    )
      throw new BadRequestError(
        "The response must match the checklist item type",
      );
    let alertId: null | string = null;
    if (input.passed === false && item.critical_control_id) {
      const reference = `CHK-${Date.now().toString(36).toUpperCase()}-${itemId.slice(0, 4).toUpperCase()}`;
      const alert = await client.query<{ id: string }>(
        `INSERT INTO alerts (organization_id,control_id,province_id,site_id,reference,title,detail,domain,severity,status,source,subject_table,subject_id,raised_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'high','open','manual','checklist_runs',$9,$10) RETURNING id`,
        [
          context.organizationId,
          item.critical_control_id,
          run.province_id,
          run.site_id,
          reference,
          `Checklist failed: ${item.prompt}`,
          input.comment ?? item.guidance ?? null,
          "daily_operations",
          runId,
          context.userId,
        ],
      );
      alertId = alert.rows[0]!.id;
    }
    const employeeId = await ownEmployeeId(client, context);
    await client.query(
      `INSERT INTO checklist_responses (organization_id,run_id,item_id,boolean_value,number_value,text_value,passed,answered_by,comment,alert_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (organization_id,run_id,item_id) DO UPDATE SET boolean_value=EXCLUDED.boolean_value,number_value=EXCLUDED.number_value,text_value=EXCLUDED.text_value,passed=EXCLUDED.passed,answered_at=now(),answered_by=EXCLUDED.answered_by,comment=EXCLUDED.comment,alert_id=COALESCE(EXCLUDED.alert_id,checklist_responses.alert_id)`,
      [
        context.organizationId,
        runId,
        itemId,
        input.booleanValue ?? null,
        input.numberValue ?? null,
        input.textValue ?? null,
        input.passed,
        employeeId,
        input.comment ?? null,
        alertId,
      ],
    );
    await refreshRunCounts(client, context.organizationId, runId);
    return runDetail(client, context, runId);
  });
}
export async function completeRun(context: DailyWorkContext, id: string) {
  return withTenantContext(context, async (client) => {
    const run = await assertRun(client, context, id);
    if (run.status !== "in_progress")
      throw new BadRequestError(
        "Only an in-progress checklist can be completed",
      );
    const missing = await client.query(
      `SELECT 1 FROM checklist_template_items i WHERE i.organization_id=$1 AND i.template_id=$2 AND i.is_required AND NOT EXISTS (SELECT 1 FROM checklist_responses x WHERE x.organization_id=i.organization_id AND x.run_id=$3 AND x.item_id=i.id) LIMIT 1`,
      [context.organizationId, run.template_id, id],
    );
    if (missing.rowCount)
      throw new BadRequestError("Complete every required checklist item first");
    const employee = await ownEmployeeId(client, context);
    await refreshRunCounts(client, context.organizationId, id);
    await client.query(
      "UPDATE checklist_runs SET status='completed',completed_at=now(),completed_by=$3 WHERE organization_id=$1 AND id=$2",
      [context.organizationId, id, employee],
    );
    return runDetail(client, context, id);
  });
}
export async function verifyRun(context: DailyWorkContext, id: string) {
  return withTenantContext(context, async (client) => {
    const run = await assertRun(client, context, id);
    if (run.status !== "completed")
      throw new BadRequestError("Only a completed checklist can be verified");
    await client.query(
      "UPDATE checklist_runs SET status='verified',verified_at=now(),verified_by=$3 WHERE organization_id=$1 AND id=$2",
      [context.organizationId, id, context.memberId],
    );
    return runDetail(client, context, id);
  });
}

async function assertReport(
  client: PoolClient,
  context: DailyWorkContext,
  id: string,
) {
  const row = await record(client, context, "daily_reports", id);
  const scope = await scopeOf(client, context);
  if (scope === "self") {
    const employee = await ownEmployeeId(client, context);
    if (!employee || row.employee_id !== employee)
      throw new NotFoundError("Daily report not found");
  } else await assertProvince(client, context, String(row.province_id ?? ""));
  return row;
}
async function reportRows(
  client: PoolClient,
  context: DailyWorkContext,
  query: DailyWorkQuery,
) {
  const scope = await scopeOf(client, context),
    provinces = await provinceIds(client, context),
    values: unknown[] = [context.organizationId],
    conditions = ["r.organization_id=$1"];
  if (query.workDate) {
    values.push(query.workDate);
    conditions.push(`r.work_date=$${values.length}::date`);
  }
  if (query.siteId) {
    values.push(query.siteId);
    conditions.push(`r.site_id=$${values.length}`);
  }
  if (query.status) {
    values.push(query.status);
    conditions.push(`r.status=$${values.length}`);
  }
  if (scope === "self") {
    const employee = await ownEmployeeId(client, context);
    if (!employee) return [];
    values.push(employee);
    conditions.push(`r.employee_id=$${values.length}`);
  } else addProvinceFilter(values, conditions, provinces, "r.province_id");
  const result = await client.query<Row>(
    `SELECT r.*,p.name AS province_name,s.name AS site_name,d.name AS department_name,e.full_name AS employee_name,reviewer.full_name AS reviewer_name FROM daily_reports r LEFT JOIN provinces p ON p.organization_id=r.organization_id AND p.id=r.province_id LEFT JOIN sites s ON s.organization_id=r.organization_id AND s.id=r.site_id LEFT JOIN departments d ON d.organization_id=r.organization_id AND d.id=r.department_id LEFT JOIN employees e ON e.organization_id=r.organization_id AND e.id=r.employee_id LEFT JOIN organization_members rm ON rm.organization_id=r.organization_id AND rm.id=r.reviewed_by LEFT JOIN users reviewer ON reviewer.id=rm.user_id WHERE ${conditions.join(" AND ")} ORDER BY r.work_date DESC,r.submitted_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, query.limit, query.offset],
  );
  return result.rows.map(mapRow);
}
export async function listReports(
  context: DailyWorkContext,
  query: DailyWorkQuery,
) {
  return withTenantContext(context, (client) =>
    reportRows(client, context, query),
  );
}
export async function createReport(
  context: DailyWorkContext,
  input: Record<string, unknown>,
) {
  return withTenantContext(context, async (client) => {
    const level = String(input.reportLevel ?? "supervisor");
    const location = await optionalLocation(
      client,
      context,
      input.siteId,
      input.provinceId,
    );
    let employeeId = input.employeeId ? String(input.employeeId) : null;
    if (level === "employee") {
      employeeId = await ownEmployeeId(client, context);
      if (!employeeId)
        throw new BadRequestError(
          "Your account must be linked to an active employee record to file an employee report",
        );
    }
    const result = await client.query<Row>(
      `INSERT INTO daily_reports (organization_id,work_date,report_level,province_id,site_id,department_id,shift_id,employee_id,parent_report_id,summary,work_done,problems,help_needed,metrics,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        context.organizationId,
        input.workDate ?? today(),
        level,
        location.provinceId,
        location.siteId,
        input.departmentId ?? null,
        input.shiftId ?? null,
        employeeId,
        input.parentReportId ?? null,
        input.summary,
        input.workDone ?? null,
        input.problems ?? null,
        input.helpNeeded ?? null,
        JSON.stringify(input.metrics ?? {}),
        input.status ?? "submitted",
      ],
    );
    return mapRow(result.rows[0]!);
  });
}
export async function updateReport(
  context: DailyWorkContext,
  id: string,
  input: Record<string, unknown>,
) {
  return withTenantContext(context, async (client) => {
    const current = await assertReport(client, context, id);
    if (!["draft", "submitted"].includes(String(current.status)))
      throw new BadRequestError("A reviewed or flagged report is locked");
    const allowed = [
      "summary",
      "workDone",
      "problems",
      "helpNeeded",
      "metrics",
      "status",
      "siteId",
      "provinceId",
      "departmentId",
      "shiftId",
      "parentReportId",
    ];
    const entries = Object.entries(input).filter(
      ([key, value]) => allowed.includes(key) && value !== undefined,
    );
    if (!entries.length)
      throw new BadRequestError("Provide at least one value to change");
    const values: unknown[] = [
      context.organizationId,
      id,
      ...entries.map(([key, v]) => (key === "metrics" ? JSON.stringify(v) : v)),
    ];
    await client.query(
      `UPDATE daily_reports SET ${entries.map(([key], i) => `${key.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)}=$${i + 3}`).join(", ")} WHERE organization_id=$1 AND id=$2`,
      values,
    );
    return mapRow(await record(client, context, "daily_reports", id));
  });
}
export async function reviewReport(
  context: DailyWorkContext,
  id: string,
  input: Record<string, unknown>,
) {
  return withTenantContext(context, async (client) => {
    const report = await assertReport(client, context, id);
    if (report.status !== "submitted")
      throw new BadRequestError("Only a submitted report can be reviewed");
    await client.query(
      "UPDATE daily_reports SET status=$3,reviewed_by=$4,reviewed_at=now(),review_note=$5 WHERE organization_id=$1 AND id=$2",
      [
        context.organizationId,
        id,
        input.status,
        context.memberId,
        input.reviewNote ?? null,
      ],
    );
    return mapRow(await record(client, context, "daily_reports", id));
  });
}

async function assertHandover(
  client: PoolClient,
  context: DailyWorkContext,
  id: string,
) {
  const row = await record(client, context, "shift_handovers", id);
  const scope = await scopeOf(client, context);
  if (scope === "self") {
    const employee = await ownEmployeeId(client, context);
    if (
      !employee ||
      ![row.incoming_employee_id, row.outgoing_employee_id].includes(employee)
    )
      throw new NotFoundError("Handover not found");
  } else await assertProvince(client, context, String(row.province_id ?? ""));
  return row;
}
export async function listHandovers(
  context: DailyWorkContext,
  query: DailyWorkQuery,
) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context),
      provinces = await provinceIds(client, context),
      values: unknown[] = [context.organizationId],
      conditions = ["h.organization_id=$1"];
    if (query.workDate) {
      values.push(query.workDate);
      conditions.push(`h.work_date=$${values.length}::date`);
    }
    if (query.siteId) {
      values.push(query.siteId);
      conditions.push(`h.site_id=$${values.length}`);
    }
    if (scope === "self") {
      const employee = await ownEmployeeId(client, context);
      if (!employee) return [];
      values.push(employee);
      conditions.push(
        `(h.incoming_employee_id=$${values.length} OR h.outgoing_employee_id=$${values.length})`,
      );
    } else addProvinceFilter(values, conditions, provinces, "h.province_id");
    const result = await client.query<Row>(
      `SELECT h.*,s.name AS site_name,p.name AS province_name,outgoing.full_name AS outgoing_employee_name,incoming.full_name AS incoming_employee_name FROM shift_handovers h JOIN sites s ON s.organization_id=h.organization_id AND s.id=h.site_id LEFT JOIN provinces p ON p.organization_id=h.organization_id AND p.id=h.province_id LEFT JOIN employees outgoing ON outgoing.organization_id=h.organization_id AND outgoing.id=h.outgoing_employee_id LEFT JOIN employees incoming ON incoming.organization_id=h.organization_id AND incoming.id=h.incoming_employee_id WHERE ${conditions.join(" AND ")} ORDER BY h.work_date DESC,h.handed_over_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, query.limit, query.offset],
    );
    return result.rows.map(mapRow);
  });
}
export async function createHandover(
  context: DailyWorkContext,
  input: Record<string, unknown>,
) {
  return withTenantContext(context, async (client) => {
    const location = await siteLocation(client, context, String(input.siteId));
    const result = await client.query<Row>(
      `INSERT INTO shift_handovers (organization_id,work_date,province_id,site_id,outgoing_shift_id,incoming_shift_id,outgoing_employee_id,incoming_employee_id,summary,outstanding_work,urgent_items,equipment_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        context.organizationId,
        input.workDate ?? today(),
        location.provinceId,
        location.siteId,
        input.outgoingShiftId ?? null,
        input.incomingShiftId ?? null,
        input.outgoingEmployeeId ?? null,
        input.incomingEmployeeId ?? null,
        input.summary,
        input.outstandingWork ?? null,
        input.urgentItems ?? null,
        input.equipmentStatus ?? null,
      ],
    );
    return mapRow(result.rows[0]!);
  });
}
export async function acknowledgeHandover(
  context: DailyWorkContext,
  id: string,
) {
  return withTenantContext(context, async (client) => {
    const handover = await assertHandover(client, context, id);
    if (handover.acknowledged_at)
      throw new BadRequestError("This handover has already been acknowledged");
    const employee = await ownEmployeeId(client, context);
    if (!employee)
      throw new BadRequestError(
        "Your account must be linked to an employee record to acknowledge a handover",
      );
    await client.query(
      "UPDATE shift_handovers SET acknowledged_at=now(),acknowledged_by=$3 WHERE organization_id=$1 AND id=$2",
      [context.organizationId, id, employee],
    );
    return mapRow(await record(client, context, "shift_handovers", id));
  });
}

export async function overview(
  context: DailyWorkContext,
  query: DailyWorkQuery,
) {
  return withTenantContext(context, async (client) => {
    const date = query.workDate ?? today();
    const scope = await scopeOf(client, context);
    const provinces = await provinceIds(client, context);
    if (query.provinceId)
      await assertProvince(client, context, query.provinceId);
    const reportList = await reportRows(client, context, {
      ...query,
      workDate: date,
      limit: 12,
      offset: 0,
    });
    const handovers = await listHandovers(context, {
      ...query,
      workDate: date,
      limit: 12,
      offset: 0,
    });
    const runList = await listRuns(context, {
      ...query,
      workDate: date,
      limit: 12,
      offset: 0,
    });
    if (scope === "self") {
      const employeeTasks = await client.query<Row>(
        "SELECT t.id, t.title, t.status, t.priority, t.due_date, t.project_id FROM management_project_tasks t WHERE t.organization_id = $1 AND t.assigned_member_id = $2 AND COALESCE(t.task_type, 'work') = 'work' AND t.status IN ('not_started', 'in_progress', 'blocked', 'waiting_approval') AND (t.due_date IS NULL OR t.due_date <= $3::date) ORDER BY t.due_date NULLS LAST LIMIT 12",
        [context.organizationId, context.memberId, date],
      );
      return {
        workDate: date,
        scope,
        summary: {
          checklists: runList.length,
          reports: reportList.length,
          handovers: handovers.length,
          alerts: 0,
          tasks: employeeTasks.rowCount,
        },
        production: {
          poultry: { records: 0, birds: 0, mortality: 0 },
          pigs: { records: 0, animals: 0, mortality: 0 },
          agriculture: { operations: 0, labourHours: 0 },
        },
        checklists: runList,
        reports: reportList,
        handovers,
        tasks: employeeTasks.rows.map(mapRow),
        alerts: [],
      };
    }

    const scopeSql = (alias: string, siteColumn: string) => {
      const values: unknown[] = [context.organizationId, date];
      const conditions = ["$2::date IS NOT NULL"];
      if (query.siteId) {
        values.push(query.siteId);
        conditions.push(`${alias}.${siteColumn} = $${values.length}`);
      }
      if (query.provinceId) {
        values.push(query.provinceId);
        conditions.push(`s.province_id = $${values.length}`);
      } else if (provinces !== null) {
        values.push(provinces);
        conditions.push(`s.province_id = ANY($${values.length}::uuid[])`);
      }
      return { values, where: conditions.join(" AND ") };
    };
    const alertValues: unknown[] = [context.organizationId];
    const alertWhere = [
      "organization_id = $1",
      "status IN ('open','acknowledged','in_progress')",
    ];
    if (query.siteId) {
      alertValues.push(query.siteId);
      alertWhere.push(`site_id = $${alertValues.length}`);
    }
    if (query.provinceId) {
      alertValues.push(query.provinceId);
      alertWhere.push(`province_id = $${alertValues.length}`);
    } else if (provinces !== null) {
      alertValues.push(provinces);
      alertWhere.push(`province_id = ANY($${alertValues.length}::uuid[])`);
    }
    const alerts = await client.query<Row>(
      `SELECT id,reference,title,severity,status,domain,created_at FROM alerts WHERE ${alertWhere.join(" AND ")} ORDER BY created_at DESC LIMIT 12`,
      alertValues,
    );
    const taskValues: unknown[] = [context.organizationId, date];
    const taskWhere = [
      "t.organization_id=$1",
      "COALESCE(t.task_type, 'work') = 'work'",
      "t.status IN ('not_started','in_progress','blocked','waiting_approval')",
      "(t.due_date IS NULL OR t.due_date <= $2::date)",
    ];

    if (query.siteId) {
      taskValues.push(query.siteId);
      taskWhere.push(`p.site_id=$${taskValues.length}`);
    }
    if (query.provinceId) {
      taskValues.push(query.provinceId);
      taskWhere.push(`p.province_id=$${taskValues.length}`);
    } else if (provinces !== null) {
      taskValues.push(provinces);
      taskWhere.push(`p.province_id=ANY($${taskValues.length}::uuid[])`);
    }
    const tasks = await client.query<Row>(
      `SELECT t.id,t.title,t.status,t.priority,t.due_date,t.project_id FROM management_project_tasks t JOIN management_projects p ON p.organization_id=t.organization_id AND p.id=t.project_id WHERE ${taskWhere.join(" AND ")} ORDER BY t.due_date NULLS LAST LIMIT 12`,
      taskValues,
    );
    const poultryScope = scopeSql("h", "site_id");
    const poultry = await client.query<Row>(
      `SELECT count(d.*)::int AS records,COALESCE(sum(d.live_bird_count),0)::int AS birds,COALESCE(sum(m.mortality),0)::int AS mortality FROM poultry_daily_records d JOIN poultry_flocks f ON f.organization_id=d.organization_id AND f.id=d.flock_id JOIN poultry_houses h ON h.organization_id=f.organization_id AND h.id=f.house_id JOIN sites s ON s.organization_id=h.organization_id AND s.id=h.site_id LEFT JOIN LATERAL (SELECT COALESCE(sum(death_count),0) AS mortality FROM poultry_mortality_records m WHERE m.organization_id=d.organization_id AND m.flock_id=d.flock_id AND m.mortality_date=$2::date) m ON true WHERE d.organization_id=$1 AND d.record_date=$2::date AND ${poultryScope.where}`,
      poultryScope.values,
    );
    const pigScope = scopeSql("pen", "site_id");
    const pigs = await client.query<Row>(
      `SELECT count(d.*)::int AS records,COALESCE(sum(d.closing_count),0)::int AS animals,COALESCE(sum(d.mortality_count),0)::int AS mortality FROM pig_daily_records d JOIN pig_pens pen ON pen.organization_id=d.organization_id AND pen.id=d.pen_id JOIN sites s ON s.organization_id=pen.organization_id AND s.id=pen.site_id WHERE d.organization_id=$1 AND d.record_date=$2::date AND ${pigScope.where}`,
      pigScope.values,
    );
    const agricultureScope = scopeSql("farm", "site_id");
    const agriculture = await client.query<Row>(
      `SELECT count(*)::int AS operations,COALESCE(sum(o.labour_hours),0) AS labour_hours FROM agriculture_operations o JOIN agriculture_fields field ON field.organization_id=o.organization_id AND field.id=o.field_id JOIN agriculture_farms farm ON farm.organization_id=field.organization_id AND farm.id=field.farm_id JOIN sites s ON s.organization_id=farm.organization_id AND s.id=farm.site_id WHERE o.organization_id=$1 AND o.operation_date=$2::date AND o.status='completed' AND ${agricultureScope.where}`,
      agricultureScope.values,
    );
    return {
      workDate: date,
      scope,
      summary: {
        checklists: runList.length,
        reports: reportList.length,
        handovers: handovers.length,
        alerts: alerts.rowCount,
        tasks: tasks.rowCount,
      },
      production: {
        poultry: mapRow(poultry.rows[0] ?? {}),
        pigs: mapRow(pigs.rows[0] ?? {}),
        agriculture: mapRow(agriculture.rows[0] ?? {}),
      },
      checklists: runList,
      reports: reportList,
      handovers,
      tasks: tasks.rows.map(mapRow),
      alerts: alerts.rows.map(mapRow),
    };
  });
}
