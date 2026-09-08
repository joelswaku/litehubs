import type { PoolClient } from "pg";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import {
  createNotificationInTransaction,
  notifyOrganizationOwnersInTransaction,
} from "../notifications/notifications.service";
import { readPrivateDocument } from "../../services/file-storage.service";
import type {
  AssignmentQuery,
  CreateAssignmentInput,
  CreateCourseInput,
  CreateMaterialInput,
  CreateRecordInput,
  RecordQuery,
  UpdateAssignmentInput,
  UpdateCourseInput,
  UpdateMaterialInput,
} from "./training.validation";

export interface TrainingContext {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
  permissions: string[];
}
type Scope = "organization" | "province" | "self";
type AssignmentStatus =
  | "assigned"
  | "in_progress"
  | "awaiting_review"
  | "completed"
  | "overdue"
  | "waived";
type RecordResult = "passed" | "failed" | "attended" | "in_progress";

interface CourseRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  validity_months: number | null;
  default_due_days?: number | null;
  is_mandatory: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  assignment_count?: string;
  completed_count?: string;
}
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
interface MaterialRow {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  material_type: "document" | "video" | "link" | "assessment" | "other";
  external_url: string | null;
  document_id: string | null;
  sort_order: number;
  estimated_duration_minutes: number | null;
  requires_acknowledgment: boolean;
  quiz_questions: unknown;
  quiz_passing_score: string | null;
  is_required: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}
interface AssignmentRow {
  id: string;
  course_id: string;
  employee_id: string;
  assigned_on: string;
  due_on: string | null;
  status: AssignmentStatus;
  started_on: string | null;
  completed_on: string | null;
  submitted_on: string | null;
  score: string | null;
  progress_percent: string;
  is_professional: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  course_code: string;
  course_name: string;
  course_category: string;
  course_is_mandatory: boolean;
  course_validity_months: number | null;
  employee_number: string;
  employee_name: string;
  employee_job_title: string;
  employee_member_id: string | null;
  province_id: string | null;
  province_name: string | null;
  site_id: string | null;
  site_name: string | null;
  assigned_by_name: string | null;
}
interface RecordRow {
  id: string;
  employee_id: string;
  course_id: string;
  completed_on: string;
  expires_on: string | null;
  result: RecordResult;
  score: string | null;
  trainer: string | null;
  certificate_number: string | null;
  notes: string | null;
  created_at: Date;
  employee_number: string;
  employee_name: string;
  course_code: string;
  course_name: string;
  category: string;
  recorded_by_name: string | null;
}

const courseFields = `c.id,c.code,c.name,c.description,c.category,c.validity_months,c.default_due_days,c.is_mandatory,c.is_active,c.created_at,c.updated_at`;
const assignmentFields = `a.id,a.course_id,a.employee_id,a.assigned_on::text,a.due_on::text,a.status,a.started_on::text,a.completed_on::text,a.submitted_on::text,a.score::text,a.progress_percent::text,a.notes,a.created_at,a.updated_at,c.code AS course_code,c.name AS course_name,c.category AS course_category,c.is_mandatory AS course_is_mandatory,c.validity_months AS course_validity_months,e.employee_number,e.full_name AS employee_name,e.job_title AS employee_job_title,e.member_id AS employee_member_id,e.province_id,p.name AS province_name,e.site_id,s.name AS site_name,assigner.full_name AS assigned_by_name,EXISTS(SELECT 1 FROM training_modules tm WHERE tm.organization_id=a.organization_id AND tm.version_id=a.course_version_id) AS is_professional`;
const recordFields = `r.id,r.employee_id,r.course_id,r.completed_on::text,r.expires_on::text,r.result,r.score::text,r.trainer,r.certificate_number,r.notes,r.created_at,e.employee_number,e.full_name AS employee_name,c.code AS course_code,c.name AS course_name,c.category,recorder.full_name AS recorded_by_name`;

function mapCourse(row: CourseRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    category: row.category,
    validityMonths: row.validity_months,
    isMandatory: row.is_mandatory,
    isActive: row.is_active,
    assignmentCount: Number(row.assignment_count ?? 0),
    completedCount: Number(row.completed_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
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
function mapMaterial(row: MaterialRow) {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    description: row.description,
    materialType: row.material_type,
    externalUrl: row.external_url,
    documentId: row.document_id,
    sortOrder: row.sort_order,
    estimatedDurationMinutes: row.estimated_duration_minutes,
    requiresAcknowledgment: row.requires_acknowledgment,
    quizQuestions: row.quiz_questions,
    quizPassingScore:
      row.quiz_passing_score === null ? null : Number(row.quiz_passing_score),
    isRequired: row.is_required,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function effectiveStatus(row: AssignmentRow): AssignmentStatus {
  if (
    ["assigned", "in_progress"].includes(row.status) &&
    row.due_on &&
    row.due_on < new Date().toISOString().slice(0, 10)
  )
    return "overdue";
  return row.status;
}
function mapAssignment(row: AssignmentRow) {
  return {
    id: row.id,
    course: {
      id: row.course_id,
      code: row.course_code,
      name: row.course_name,
      category: row.course_category,
      isMandatory: row.course_is_mandatory,
      validityMonths: row.course_validity_months,
    },
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
    assignedOn: row.assigned_on,
    dueOn: row.due_on,
    status: effectiveStatus(row),
    startedOn: row.started_on,
    completedOn: row.completed_on,
    submittedOn: row.submitted_on,
    score: row.score === null ? null : Number(row.score),
    progressPercent: Number(row.progress_percent ?? 0),
    isProfessional: row.is_professional,
    notes: row.notes,
    assignedByName: row.assigned_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function mapRecord(row: RecordRow) {
  return {
    id: row.id,
    employee: {
      id: row.employee_id,
      employeeNumber: row.employee_number,
      fullName: row.employee_name,
    },
    course: {
      id: row.course_id,
      code: row.course_code,
      name: row.course_name,
      category: row.category,
    },
    completedOn: row.completed_on,
    expiresOn: row.expires_on,
    result: row.result,
    score: row.score === null ? null : Number(row.score),
    trainer: row.trainer,
    certificateNumber: row.certificate_number,
    notes: row.notes,
    recordedByName: row.recorded_by_name,
    createdAt: row.created_at,
  };
}
async function scopeOf(
  client: PoolClient,
  context: TrainingContext,
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

async function assertTrainingManager(
  client: PoolClient,
  context: TrainingContext,
) {
  if ((await scopeOf(client, context)) === "self")
    throw new ForbiddenError(
      "Only an authorized training manager can manage the training catalogue",
    );
}

async function assertMaterialDocument(
  client: PoolClient,
  context: TrainingContext,
  documentId: string | null | undefined,
) {
  if (!documentId) return;
  const result = await client.query<{
    id: string;
    province_id: string | null;
    is_confidential: boolean;
  }>(
    "SELECT id, province_id, is_confidential FROM documents WHERE organization_id=$1 AND id=$2",
    [context.organizationId, documentId],
  );
  const document = result.rows[0];
  if (!document)
    throw new BadRequestError("Choose a document from this company", {
      field: "documentId",
    });
  if (document.is_confidential && !context.isOwner)
    throw new ForbiddenError(
      "Only the workspace owner can use a confidential document as training material",
    );
  if (document.province_id && (await scopeOf(client, context)) === "province") {
    const allowed = await client.query(
      "SELECT 1 FROM member_provinces WHERE organization_id=$1 AND member_id=$2 AND province_id=$3",
      [context.organizationId, context.memberId, document.province_id],
    );
    if ((allowed.rowCount ?? 0) === 0)
      throw new NotFoundError("Training document not found");
  }
}
async function assertEmployeeScope(
  client: PoolClient,
  context: TrainingContext,
  employee: Pick<EmployeeRow, "member_id" | "province_id">,
) {
  const scope = await scopeOf(client, context);
  if (scope === "organization") return;
  if (scope === "self") {
    if (employee.member_id !== context.memberId)
      throw new NotFoundError("Training assignment not found");
    return;
  }
  if (!employee.province_id)
    throw new NotFoundError("Training assignment not found");
  const allowed = await client.query(
    `SELECT 1 FROM member_provinces WHERE organization_id=$1 AND member_id=$2 AND province_id=$3`,
    [context.organizationId, context.memberId, employee.province_id],
  );
  if ((allowed.rowCount ?? 0) === 0)
    throw new NotFoundError("Training assignment not found");
}
async function employeeFor(
  client: PoolClient,
  context: TrainingContext,
  employeeId: string,
): Promise<EmployeeRow> {
  const result = await client.query<EmployeeRow>(
    `SELECT e.id,e.member_id,e.employee_number,e.full_name,e.job_title,e.province_id,p.name AS province_name,e.site_id,s.name AS site_name,e.employment_status FROM employees e LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=e.organization_id AND s.id=e.site_id WHERE e.organization_id=$1 AND e.id=$2`,
    [context.organizationId, employeeId],
  );
  const employee = result.rows[0];
  if (
    !employee ||
    !["active", "probation", "on_leave"].includes(employee.employment_status)
  )
    throw new NotFoundError("Active employee not found");
  await assertEmployeeScope(client, context, employee);
  return employee;
}
async function courseFor(
  client: PoolClient,
  organizationId: string,
  courseId: string,
): Promise<CourseRow> {
  const result = await client.query<CourseRow>(
    `SELECT ${courseFields} FROM training_courses c WHERE c.organization_id=$1 AND c.id=$2`,
    [organizationId, courseId],
  );
  if (!result.rows[0]) throw new NotFoundError("Training course not found");
  return result.rows[0];
}
async function assignmentFor(
  client: PoolClient,
  context: TrainingContext,
  assignmentId: string,
): Promise<AssignmentRow> {
  const result = await client.query<AssignmentRow>(
    `SELECT ${assignmentFields} FROM training_assignments a JOIN training_courses c ON c.organization_id=a.organization_id AND c.id=a.course_id JOIN employees e ON e.organization_id=a.organization_id AND e.id=a.employee_id LEFT JOIN provinces p ON p.organization_id=a.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=a.organization_id AND s.id=e.site_id LEFT JOIN users assigner ON assigner.id=a.assigned_by WHERE a.organization_id=$1 AND a.id=$2`,
    [context.organizationId, assignmentId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Training assignment not found");
  await assertEmployeeScope(client, context, {
    member_id: row.employee_member_id,
    province_id: row.province_id,
  });
  return row;
}
function expiryDate(completedOn: string, months: number | null): string | null {
  if (!months) return null;
  const value = new Date(`${completedOn}T00:00:00.000Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
}
async function insertRecord(
  client: PoolClient,
  context: TrainingContext,
  input: {
    employee: EmployeeRow;
    course: CourseRow;
    completedOn: string;
    result: RecordResult;
    score?: number | null;
    trainer?: string | null;
    certificateNumber?: string | null;
    notes?: string | null;
  },
): Promise<RecordRow> {
  const expiresOn =
    input.result === "passed"
      ? expiryDate(input.completedOn, input.course.validity_months)
      : null;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO training_records (organization_id,employee_id,course_id,province_id,site_id,completed_on,expires_on,result,score,trainer,certificate_number,notes,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [
      context.organizationId,
      input.employee.id,
      input.course.id,
      input.employee.province_id,
      input.employee.site_id,
      input.completedOn,
      expiresOn,
      input.result,
      input.score ?? null,
      input.trainer ?? null,
      input.certificateNumber ?? null,
      input.notes ?? null,
      context.userId,
    ],
  );
  const record = await client.query<RecordRow>(
    `SELECT ${recordFields} FROM training_records r JOIN employees e ON e.organization_id=r.organization_id AND e.id=r.employee_id JOIN training_courses c ON c.organization_id=r.organization_id AND c.id=r.course_id LEFT JOIN users recorder ON recorder.id=r.recorded_by WHERE r.organization_id=$1 AND r.id=$2`,
    [context.organizationId, inserted.rows[0]!.id],
  );
  return record.rows[0]!;
}

export async function listCourses(context: TrainingContext) {
  return withTenantContext(context, async (client) => {
    await assertTrainingManager(client, context);
    const scope = await scopeOf(client, context);
    const canSeeInactive = context.permissions.includes("training.create");
    const params: unknown[] = [context.organizationId];
    const access =
      scope === "self"
        ? " AND EXISTS (SELECT 1 FROM training_assignments a JOIN employees e ON e.organization_id=a.organization_id AND e.id=a.employee_id WHERE a.organization_id=c.organization_id AND a.course_id=c.id AND e.member_id=$2)"
        : "";
    if (access) params.push(context.memberId);
    const result = await client.query<CourseRow>(
      `SELECT ${courseFields},COUNT(a.id)::text AS assignment_count,COUNT(a.id) FILTER (WHERE a.status='completed')::text AS completed_count FROM training_courses c LEFT JOIN training_assignments a ON a.organization_id=c.organization_id AND a.course_id=c.id WHERE c.organization_id=$1 ${canSeeInactive ? "" : "AND c.is_active"} ${access} GROUP BY c.id ORDER BY c.is_active DESC,c.is_mandatory DESC,c.name`,
      params,
    );
    return result.rows.map(mapCourse);
  });
}
export async function createCourse(
  context: TrainingContext,
  input: CreateCourseInput,
) {
  return withTenantContext(context, async (client) => {
    await assertTrainingManager(client, context);
    const result = await client.query<CourseRow>(
      `INSERT INTO training_courses (organization_id,code,name,description,category,validity_months,is_mandatory,is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        context.organizationId,
        input.code,
        input.name,
        input.description ?? null,
        input.category ?? "general",
        input.validityMonths ?? null,
        input.isMandatory ?? false,
        input.isActive ?? true,
      ],
    );
    return mapCourse(result.rows[0]!);
  });
}
export async function updateCourse(
  context: TrainingContext,
  courseId: string,
  input: UpdateCourseInput,
) {
  return withTenantContext(context, async (client) => {
    await assertTrainingManager(client, context);
    const old = await courseFor(client, context.organizationId, courseId);
    const result = await client.query<CourseRow>(
      `UPDATE training_courses SET code=$3,name=$4,description=$5,category=$6,validity_months=$7,is_mandatory=$8,is_active=$9 WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [
        context.organizationId,
        courseId,
        input.code ?? old.code,
        input.name ?? old.name,
        input.description === undefined ? old.description : input.description,
        input.category ?? old.category,
        input.validityMonths === undefined
          ? old.validity_months
          : input.validityMonths,
        input.isMandatory ?? old.is_mandatory,
        input.isActive ?? old.is_active,
      ],
    );
    return mapCourse(result.rows[0]!);
  });
}
export async function listMaterials(
  context: TrainingContext,
  courseId: string,
) {
  return withTenantContext(context, async (client) => {
    await assertTrainingManager(client, context);
    const course = await courseFor(client, context.organizationId, courseId);
    const scope = await scopeOf(client, context);
    if (scope === "self") {
      const allowed = await client.query(
        `SELECT 1 FROM training_assignments a JOIN employees e ON e.organization_id=a.organization_id AND e.id=a.employee_id WHERE a.organization_id=$1 AND a.course_id=$2 AND e.member_id=$3`,
        [context.organizationId, course.id, context.memberId],
      );
      if ((allowed.rowCount ?? 0) === 0)
        throw new NotFoundError("Training materials not found");
    }
    const result = await client.query<MaterialRow>(
      `SELECT * FROM training_materials WHERE organization_id=$1 AND course_id=$2 ${scope === "self" ? "AND is_active" : ""} ORDER BY sort_order,title`,
      [context.organizationId, course.id],
    );
    return result.rows.map(mapMaterial);
  });
}
export async function createMaterial(
  context: TrainingContext,
  courseId: string,
  input: CreateMaterialInput,
) {
  return withTenantContext(context, async (client) => {
    await assertTrainingManager(client, context);
    await courseFor(client, context.organizationId, courseId);
    await assertMaterialDocument(client, context, input.documentId);
    const result = await client.query<MaterialRow>(
      `INSERT INTO training_materials (organization_id,course_id,title,description,material_type,external_url,document_id,sort_order,estimated_duration_minutes,requires_acknowledgment,quiz_questions,quiz_passing_score,is_required,is_active,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16) RETURNING *`,
      [
        context.organizationId,
        courseId,
        input.title,
        input.description ?? null,
        input.materialType,
        input.externalUrl ?? null,
        input.documentId ?? null,
        input.sortOrder ?? 0,
        input.estimatedDurationMinutes ?? null,
        input.requiresAcknowledgment ?? false,
        input.quizQuestions === undefined
          ? null
          : JSON.stringify(input.quizQuestions),
        input.quizPassingScore ?? null,
        input.isRequired ?? true,
        input.isActive ?? true,
        context.userId,
      ],
    );
    return mapMaterial(result.rows[0]!);
  });
}
export async function updateMaterial(
  context: TrainingContext,
  materialId: string,
  input: UpdateMaterialInput,
) {
  return withTenantContext(context, async (client) => {
    await assertTrainingManager(client, context);
    const existing = await client.query<MaterialRow>(
      `SELECT * FROM training_materials WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, materialId],
    );
    const old = existing.rows[0];
    if (!old) throw new NotFoundError("Training material not found");
    const externalUrl =
      input.externalUrl === undefined ? old.external_url : input.externalUrl;
    const documentId =
      input.documentId === undefined ? old.document_id : input.documentId;
    const materialType = input.materialType ?? old.material_type;
    const quizQuestions =
      input.quizQuestions === undefined
        ? old.quiz_questions
        : input.quizQuestions;
    const quizPassingScore =
      input.quizPassingScore === undefined
        ? old.quiz_passing_score
        : input.quizPassingScore;
    if (
      !externalUrl &&
      !documentId &&
      !(
        materialType === "assessment" &&
        Array.isArray(quizQuestions) &&
        quizQuestions.length
      )
    )
      throw new ConflictError(
        "A training material needs a document, video link, or assessment questions",
        { field: "externalUrl" },
      );
    await assertMaterialDocument(client, context, documentId);
    const result = await client.query<MaterialRow>(
      `UPDATE training_materials SET title=$3,description=$4,material_type=$5,external_url=$6,document_id=$7,sort_order=$8,estimated_duration_minutes=$9,requires_acknowledgment=$10,quiz_questions=$11::jsonb,quiz_passing_score=$12,is_required=$13,is_active=$14 WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [
        context.organizationId,
        materialId,
        input.title ?? old.title,
        input.description === undefined ? old.description : input.description,
        materialType,
        externalUrl,
        documentId,
        input.sortOrder ?? old.sort_order,
        input.estimatedDurationMinutes === undefined
          ? old.estimated_duration_minutes
          : input.estimatedDurationMinutes,
        input.requiresAcknowledgment ?? old.requires_acknowledgment,
        quizQuestions === null ? null : JSON.stringify(quizQuestions),
        quizPassingScore === null ? null : quizPassingScore,
        input.isRequired ?? old.is_required,
        input.isActive ?? old.is_active,
      ],
    );
    return mapMaterial(result.rows[0]!);
  });
}
export async function listAssignments(
  context: TrainingContext,
  query: AssignmentQuery,
) {
  return withTenantContext(context, async (client) => {
    await assertTrainingManager(client, context);
    const scope = await scopeOf(client, context);
    const params: unknown[] = [context.organizationId];
    const where = ["a.organization_id=$1"];
    if (query.courseId) {
      params.push(query.courseId);
      where.push(`a.course_id=$${params.length}`);
    }
    if (query.employeeId) {
      params.push(query.employeeId);
      where.push(`a.employee_id=$${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      where.push(`a.status=$${params.length}`);
    }
    if (scope === "self" || query.mine) {
      params.push(context.memberId);
      where.push(`e.member_id=$${params.length}`);
    } else if (scope === "province") {
      params.push(context.memberId);
      where.push(
        `e.province_id IN (SELECT province_id FROM member_provinces WHERE organization_id=$1 AND member_id=$${params.length})`,
      );
    }
    const result = await client.query<AssignmentRow>(
      `SELECT ${assignmentFields} FROM training_assignments a JOIN training_courses c ON c.organization_id=a.organization_id AND c.id=a.course_id JOIN employees e ON e.organization_id=a.organization_id AND e.id=a.employee_id LEFT JOIN provinces p ON p.organization_id=a.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=a.organization_id AND s.id=e.site_id LEFT JOIN users assigner ON assigner.id=a.assigned_by WHERE ${where.join(" AND ")} ORDER BY CASE WHEN a.status IN ('assigned','in_progress') AND a.due_on < CURRENT_DATE THEN 0 ELSE 1 END,a.due_on NULLS LAST,a.created_at DESC`,
      params,
    );
    return result.rows.map(mapAssignment);
  });
}
export async function createAssignments(
  context: TrainingContext,
  input: CreateAssignmentInput,
) {
  return withTenantContext(context, async (client) => {
    await assertTrainingManager(client, context);
    const course = await courseFor(
      client,
      context.organizationId,
      input.courseId,
    );
    if (!course.is_active)
      throw new ConflictError("Inactive courses cannot be assigned");
    const result: AssignmentRow[] = [];
    for (const employeeId of [...new Set(input.employeeIds)]) {
      const employee = await employeeFor(client, context, employeeId);
      const duplicate = await client.query(
        `SELECT 1 FROM training_assignments WHERE organization_id=$1 AND course_id=$2 AND employee_id=$3 AND status IN ('assigned','in_progress','overdue')`,
        [context.organizationId, course.id, employee.id],
      );
      if ((duplicate.rowCount ?? 0) > 0)
        throw new ConflictError(
          "This employee already has this training assignment",
          { field: "employeeIds", employeeId },
        );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO training_assignments (organization_id,course_id,employee_id,province_id,site_id,assigned_by,due_on,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          context.organizationId,
          course.id,
          employee.id,
          employee.province_id,
          employee.site_id,
          context.userId,
          input.dueOn ??
            (course.default_due_days
              ? new Date(
                  Date.now() + course.default_due_days * 86_400_000,
                )
                  .toISOString()
                  .slice(0, 10)
              : null),
          input.notes ?? null,
        ],
      );
      const assignment = await assignmentFor(
        client,
        context,
        inserted.rows[0]!.id,
      );
      result.push(assignment);
      if (
        assignment.employee_member_id &&
        assignment.employee_member_id !== context.memberId
      )
        await createNotificationInTransaction(client, {
          organizationId: context.organizationId,
          recipientMemberId: assignment.employee_member_id,
          recipientEmployeeId: assignment.employee_id,
          actorUserId: context.userId,
          provinceId: assignment.province_id,
          siteId: assignment.site_id,
          type: "training_assigned",
          category: "training",
          priority: assignment.course_is_mandatory ? "high" : "normal",
          title: "Training assigned",
          message: assignment.course_name,
          actionUrl: `/my-trainings/${assignment.id}`,
          entityType: "training_assignment",
          entityId: assignment.id,
          deduplicationKey: `training-assignment:${assignment.id}`,
        });
    }
    return result.map(mapAssignment);
  });
}
export async function updateAssignment(
  context: TrainingContext,
  assignmentId: string,
  input: UpdateAssignmentInput,
) {
  return withTenantContext(context, async (client) => {
    await assertTrainingManager(client, context);
    const old = await assignmentFor(client, context, assignmentId);
    const self = (await scopeOf(client, context)) === "self";
    if (
      self &&
      input.status &&
      !["in_progress", "awaiting_review"].includes(input.status)
    )
      throw new ForbiddenError(
        "You can only start or submit your assigned training for review",
      );
    if (self && (input.dueOn !== undefined || input.score !== undefined))
      throw new ForbiddenError(
        "Only a training manager can change due dates or scores",
      );
    const nextStatus = input.status ?? old.status;
    if (
      self &&
      nextStatus === "awaiting_review" &&
      old.status !== "in_progress"
    )
      throw new ConflictError(
        "Start the training before submitting it for review",
        { field: "status" },
      );
    const today = new Date().toISOString().slice(0, 10);
    const startedOn =
      nextStatus === "in_progress" ? (old.started_on ?? today) : old.started_on;
    const completedOn =
      nextStatus === "completed"
        ? (old.completed_on ?? today)
        : old.completed_on;
    const submittedOn =
      nextStatus === "awaiting_review"
        ? (old.submitted_on ?? today)
        : old.submitted_on;
    await client.query(
      `UPDATE training_assignments SET status=$3,due_on=$4,started_on=$5,completed_on=$6,submitted_on=$7,score=$8,notes=$9 WHERE organization_id=$1 AND id=$2`,
      [
        context.organizationId,
        assignmentId,
        nextStatus,
        input.dueOn === undefined ? old.due_on : input.dueOn,
        startedOn,
        completedOn,
        submittedOn,
        input.score === undefined ? old.score : input.score,
        input.notes === undefined ? old.notes : input.notes,
      ],
    );
    if (nextStatus === "completed" && old.status !== "completed") {
      const employee = await employeeFor(client, context, old.employee_id);
      const course = await courseFor(
        client,
        context.organizationId,
        old.course_id,
      );
      await insertRecord(client, context, {
        employee,
        course,
        completedOn: completedOn!,
        result: "passed",
        score: input.score ?? (old.score === null ? null : Number(old.score)),
        notes: input.notes ?? old.notes,
      });
      if (old.employee_member_id)
        await createNotificationInTransaction(client, {
          organizationId: context.organizationId,
          recipientMemberId: old.employee_member_id,
          recipientEmployeeId: old.employee_id,
          actorUserId: context.userId,
          provinceId: old.province_id,
          siteId: old.site_id,
          type: "training_completed",
          category: "training",
          priority: "normal",
          title: "Training completed",
          message: old.course_name,
          actionUrl: `/my-trainings/${assignmentId}`,
          entityType: "training_assignment",
          entityId: assignmentId,
          deduplicationKey: `training-completed:${assignmentId}`,
        });
    }
    return mapAssignment(await assignmentFor(client, context, assignmentId));
  });
}
export async function listRecords(
  context: TrainingContext,
  query: RecordQuery,
) {
  return withTenantContext(context, async (client) => {
    await assertTrainingManager(client, context);
    const scope = await scopeOf(client, context);
    const params: unknown[] = [context.organizationId];
    const where = ["r.organization_id=$1"];
    if (query.courseId) {
      params.push(query.courseId);
      where.push(`r.course_id=$${params.length}`);
    }
    if (query.employeeId) {
      params.push(query.employeeId);
      where.push(`r.employee_id=$${params.length}`);
    }
    if (scope === "self") {
      params.push(context.memberId);
      where.push(`e.member_id=$${params.length}`);
    } else if (scope === "province") {
      params.push(context.memberId);
      where.push(
        `e.province_id IN (SELECT province_id FROM member_provinces WHERE organization_id=$1 AND member_id=$${params.length})`,
      );
    }
    const result = await client.query<RecordRow>(
      `SELECT ${recordFields} FROM training_records r JOIN employees e ON e.organization_id=r.organization_id AND e.id=r.employee_id JOIN training_courses c ON c.organization_id=r.organization_id AND c.id=r.course_id LEFT JOIN users recorder ON recorder.id=r.recorded_by WHERE ${where.join(" AND ")} ORDER BY r.completed_on DESC,r.created_at DESC`,
      params,
    );
    return result.rows.map(mapRecord);
  });
}
export async function createRecord(
  context: TrainingContext,
  input: CreateRecordInput,
) {
  return withTenantContext(context, async (client) => {
    await assertTrainingManager(client, context);
    const employee = await employeeFor(client, context, input.employeeId);
    const course = await courseFor(
      client,
      context.organizationId,
      input.courseId,
    );
    const record = await insertRecord(client, context, {
      employee,
      course,
      ...input,
    });
    return mapRecord(record);
  });
}
export async function summary(context: TrainingContext) {
  return withTenantContext(context, async (client) => {
    await assertTrainingManager(client, context);
    const scope = await scopeOf(client, context);
    const params: unknown[] = [context.organizationId];
    let access = "";
    if (scope === "self") {
      params.push(context.memberId);
      access = ` AND e.member_id=$2`;
    } else if (scope === "province") {
      params.push(context.memberId);
      access = ` AND e.province_id IN (SELECT province_id FROM member_provinces WHERE organization_id=$1 AND member_id=$2)`;
    }
    const metrics = await client.query<{
      courses: string;
      assigned: string;
      completed: string;
      due_soon: string;
      overdue: string;
    }>(
      `SELECT (SELECT COUNT(*)::text FROM training_courses c WHERE c.organization_id=$1 AND c.is_active) AS courses,COUNT(a.id)::text AS assigned,COUNT(a.id) FILTER (WHERE a.status='completed')::text AS completed,COUNT(a.id) FILTER (WHERE a.status IN ('assigned','in_progress') AND a.due_on BETWEEN CURRENT_DATE AND CURRENT_DATE+14)::text AS due_soon,COUNT(a.id) FILTER (WHERE a.status IN ('assigned','in_progress') AND a.due_on<CURRENT_DATE)::text AS overdue FROM training_assignments a JOIN employees e ON e.organization_id=a.organization_id AND e.id=a.employee_id WHERE a.organization_id=$1 ${access}`,
      params,
    );
    const row = metrics.rows[0];
    return {
      metrics: {
        courses: Number(row?.courses ?? 0),
        assigned: Number(row?.assigned ?? 0),
        completed: Number(row?.completed ?? 0),
        dueSoon: Number(row?.due_soon ?? 0),
        overdue: Number(row?.overdue ?? 0),
      },
    };
  });
}
export async function currentEmployee(context: TrainingContext) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<EmployeeRow>(
      `SELECT e.id,e.member_id,e.employee_number,e.full_name,e.job_title,e.province_id,p.name AS province_name,e.site_id,s.name AS site_name,e.employment_status FROM employees e LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=e.organization_id AND s.id=e.site_id WHERE e.organization_id=$1 AND e.member_id=$2 AND e.employment_status IN ('active','probation','on_leave') ORDER BY e.created_at LIMIT 1`,
      [context.organizationId, context.memberId],
    );
    return result.rows[0] ? mapEmployee(result.rows[0]) : null;
  });
}

type LearnerAssignmentRow = AssignmentRow & {
  progress_percent: string;
  last_opened_at: Date | null;
  course_description: string | null;
  course_requires_acknowledgment: boolean;
};
type LearnerMaterialRow = MaterialRow & {
  estimated_duration_minutes: number | null;
  requires_acknowledgment: boolean;
  quiz_questions: unknown;
  quiz_passing_score: string | null;
  started_at: Date | null;
  last_opened_at: Date | null;
  completed_at: Date | null;
  acknowledged_at: Date | null;
  quiz_score: string | null;
};

async function learnerEmployeeFor(
  client: PoolClient,
  context: TrainingContext,
) {
  const result = await client.query<EmployeeRow>(
    `SELECT e.id,e.member_id,e.employee_number,e.full_name,e.job_title,e.province_id,p.name AS province_name,e.site_id,s.name AS site_name,e.employment_status
       FROM employees e
       LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id
       LEFT JOIN sites s ON s.organization_id=e.organization_id AND s.id=e.site_id
      WHERE e.organization_id=$1 AND e.member_id=$2
        AND e.employment_status IN ('active','probation','on_leave')
      ORDER BY e.created_at LIMIT 1`,
    [context.organizationId, context.memberId],
  );
  const employee = result.rows[0];
  if (!employee)
    throw new NotFoundError(
      "No active employee profile was found for this account",
    );
  return employee;
}

const learnerAssignmentFields = `${assignmentFields},a.progress_percent::text,a.last_opened_at,c.description AS course_description,c.requires_acknowledgment AS course_requires_acknowledgment`;

function mapLearnerAssignment(row: LearnerAssignmentRow) {
  const assignment = mapAssignment(row);
  return {
    ...assignment,
    progressPercent: Number(row.progress_percent ?? 0),
    lastOpenedAt: row.last_opened_at?.toISOString() ?? null,
    course: {
      ...assignment.course,
      description: row.course_description,
      requiresAcknowledgment: row.course_requires_acknowledgment,
    },
  };
}

function learnerQuiz(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      const value =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      return {
        id: typeof value.id === "string" ? value.id : String(index + 1),
        question: typeof value.question === "string" ? value.question : "",
        options: Array.isArray(value.options)
          ? value.options.filter(
              (option): option is string => typeof option === "string",
            )
          : [],
      };
    })
    .filter((question) => question.question && question.options.length > 1);
}

function scoreQuiz(raw: unknown, answers: number[]) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const questions = raw
    .map((item) =>
      item && typeof item === "object"
        ? (item as Record<string, unknown>)
        : null,
    )
    .filter((item): item is Record<string, unknown> => Boolean(item));
  if (!questions.length) return null;
  let correct = 0;
  questions.forEach((question, index) => {
    if (
      typeof question.correctOption === "number" &&
      answers[index] === question.correctOption
    )
      correct += 1;
  });
  return Number(((correct / questions.length) * 100).toFixed(2));
}

async function learnerAssignmentFor(
  client: PoolClient,
  context: TrainingContext,
  assignmentId: string,
): Promise<LearnerAssignmentRow> {
  const employee = await learnerEmployeeFor(client, context);
  const result = await client.query<LearnerAssignmentRow>(
    `SELECT ${learnerAssignmentFields}
       FROM training_assignments a
       JOIN training_courses c ON c.organization_id=a.organization_id AND c.id=a.course_id
       JOIN employees e ON e.organization_id=a.organization_id AND e.id=a.employee_id
       LEFT JOIN provinces p ON p.organization_id=a.organization_id AND p.id=e.province_id
       LEFT JOIN sites s ON s.organization_id=a.organization_id AND s.id=e.site_id
       LEFT JOIN users assigner ON assigner.id=a.assigned_by
      WHERE a.organization_id=$1 AND a.id=$2 AND a.employee_id=$3`,
    [context.organizationId, assignmentId, employee.id],
  );
  const assignment = result.rows[0];
  if (!assignment) throw new NotFoundError("Training assignment not found");
  return assignment;
}

async function updateLearnerProgress(
  client: PoolClient,
  context: TrainingContext,
  assignmentId: string,
) {
  const count = await client.query<{ total: string; completed: string }>(
    `SELECT COUNT(m.id)::text AS total,
            COUNT(m.id) FILTER (WHERE p.completed_at IS NOT NULL)::text AS completed
       FROM training_materials m
       LEFT JOIN training_assignment_material_progress p
         ON p.organization_id=m.organization_id AND p.assignment_id=$3 AND p.material_id=m.id
      WHERE m.organization_id=$1 AND m.course_id=(SELECT course_id FROM training_assignments WHERE organization_id=$1 AND id=$2)
        AND m.is_active`,
    [context.organizationId, assignmentId, assignmentId],
  );
  const total = Number(count.rows[0]?.total ?? 0);
  const completed = Number(count.rows[0]?.completed ?? 0);
  const progress = total ? Math.round((completed / total) * 100) : 0;
  await client.query(
    `UPDATE training_assignments SET progress_percent=$3 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, assignmentId, progress],
  );
  return progress;
}

async function trainingAudit(
  client: PoolClient,
  context: TrainingContext,
  action: "read" | "update",
  assignmentId: string,
  label: string,
  changes: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO audit_log (organization_id,user_id,member_id,actor_email,actor_name,action,entity_table,entity_id,entity_label,changes)
       SELECT $1,$2,$3,u.email::text,u.full_name,$4,'training_assignments',$5,$6,$7::jsonb
         FROM users u WHERE u.id=$2`,
    [
      context.organizationId,
      context.userId,
      context.memberId,
      action,
      assignmentId,
      label,
      JSON.stringify(changes),
    ],
  );
}

export async function listMyTrainings(context: TrainingContext) {
  return withTenantContext(context, async (client) => {
    const employee = await learnerEmployeeFor(client, context);
    const result = await client.query<LearnerAssignmentRow>(
      `SELECT ${learnerAssignmentFields}
         FROM training_assignments a
         JOIN training_courses c ON c.organization_id=a.organization_id AND c.id=a.course_id
         JOIN employees e ON e.organization_id=a.organization_id AND e.id=a.employee_id
         LEFT JOIN provinces p ON p.organization_id=a.organization_id AND p.id=e.province_id
         LEFT JOIN sites s ON s.organization_id=a.organization_id AND s.id=e.site_id
         LEFT JOIN users assigner ON assigner.id=a.assigned_by
        WHERE a.organization_id=$1 AND a.employee_id=$2
        ORDER BY CASE WHEN a.status IN ('assigned','in_progress') AND a.due_on<CURRENT_DATE THEN 0 ELSE 1 END,
                 a.due_on NULLS LAST,a.created_at DESC`,
      [context.organizationId, employee.id],
    );
    return result.rows.map(mapLearnerAssignment);
  });
}

export async function myTrainingDetail(
  context: TrainingContext,
  assignmentId: string,
) {
  return withTenantContext(context, async (client) => {
    const assignment = await learnerAssignmentFor(
      client,
      context,
      assignmentId,
    );
    await client.query(
      `UPDATE training_assignments SET last_opened_at=now() WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, assignment.id],
    );
    const materials = await client.query<LearnerMaterialRow>(
      `SELECT m.*,p.started_at,p.last_opened_at,p.completed_at,p.acknowledged_at,p.quiz_score
         FROM training_materials m
         LEFT JOIN training_assignment_material_progress p
           ON p.organization_id=m.organization_id AND p.assignment_id=$3 AND p.material_id=m.id
        WHERE m.organization_id=$1 AND m.course_id=$2 AND m.is_active
        ORDER BY m.sort_order,m.created_at`,
      [context.organizationId, assignment.course_id, assignment.id],
    );
    await trainingAudit(
      client,
      context,
      "read",
      assignment.id,
      assignment.course_name,
      { event: "opened" },
    );
    return {
      assignment: mapLearnerAssignment(assignment),
      materials: materials.rows.map((material) => ({
        ...mapMaterial(material),
        estimatedDurationMinutes: material.estimated_duration_minutes,
        requiresAcknowledgment: material.requires_acknowledgment,
        progress: {
          startedAt: material.started_at?.toISOString() ?? null,
          lastOpenedAt: material.last_opened_at?.toISOString() ?? null,
          completedAt: material.completed_at?.toISOString() ?? null,
          acknowledgedAt: material.acknowledged_at?.toISOString() ?? null,
          quizScore:
            material.quiz_score === null ? null : Number(material.quiz_score),
        },
        quiz: material.quiz_questions
          ? {
              questions: learnerQuiz(material.quiz_questions),
              passingScore:
                material.quiz_passing_score === null
                  ? 0
                  : Number(material.quiz_passing_score),
            }
          : null,
      })),
    };
  });
}

export async function startMyTraining(
  context: TrainingContext,
  assignmentId: string,
) {
  return withTenantContext(context, async (client) => {
    const assignment = await learnerAssignmentFor(
      client,
      context,
      assignmentId,
    );
    if (["completed", "waived", "awaiting_review"].includes(assignment.status))
      throw new ConflictError(
        "This training cannot be started in its current status",
        { field: "status" },
      );
    await client.query(
      `UPDATE training_assignments
          SET status='in_progress',started_on=COALESCE(started_on,CURRENT_DATE),last_opened_at=now()
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, assignment.id],
    );
    await trainingAudit(
      client,
      context,
      "update",
      assignment.id,
      assignment.course_name,
      { event: "started" },
    );
    return { started: true, assignmentId: assignment.id };
  });
}

export async function updateMyTrainingMaterial(
  context: TrainingContext,
  assignmentId: string,
  materialId: string,
  input: {
    opened?: boolean;
    completed?: boolean;
    acknowledged?: boolean;
    quizAnswers?: number[];
  },
) {
  return withTenantContext(context, async (client) => {
    const assignment = await learnerAssignmentFor(
      client,
      context,
      assignmentId,
    );
    if (!["assigned", "in_progress", "overdue"].includes(assignment.status))
      throw new ConflictError("This training is no longer open for learning", {
        field: "status",
      });
    const materialResult = await client.query<LearnerMaterialRow>(
      `SELECT m.*,p.started_at,p.last_opened_at,p.completed_at,p.acknowledged_at,p.quiz_score
         FROM training_materials m
         LEFT JOIN training_assignment_material_progress p
           ON p.organization_id=m.organization_id AND p.assignment_id=$3 AND p.material_id=m.id
        WHERE m.organization_id=$1 AND m.id=$2 AND m.course_id=$4 AND m.is_active`,
      [context.organizationId, materialId, assignment.id, assignment.course_id],
    );
    const material = materialResult.rows[0];
    if (!material) throw new NotFoundError("Training lesson not found");
    const acknowledged =
      input.acknowledged === true || Boolean(material.acknowledged_at);
    const quizScore =
      input.quizAnswers === undefined
        ? material.quiz_score === null
          ? null
          : Number(material.quiz_score)
        : scoreQuiz(material.quiz_questions, input.quizAnswers);
    const passingScore =
      material.quiz_passing_score === null
        ? null
        : Number(material.quiz_passing_score);
    if (input.completed && material.requires_acknowledgment && !acknowledged)
      throw new ConflictError(
        "Acknowledge this required lesson before completing it",
        { field: "acknowledged" },
      );
    if (
      input.completed &&
      passingScore !== null &&
      (quizScore === null || quizScore < passingScore)
    )
      throw new ConflictError("Pass the quiz before completing this lesson", {
        field: "quizAnswers",
      });
    const completed =
      input.completed === true || Boolean(material.completed_at);
    await client.query(
      `INSERT INTO training_assignment_material_progress
         (organization_id,assignment_id,material_id,started_at,last_opened_at,completed_at,acknowledged_at,quiz_score,quiz_answers)
       VALUES ($1,$2,$3,now(),now(),CASE WHEN $4 THEN now() ELSE NULL END,CASE WHEN $5 THEN now() ELSE NULL END,$6,$7::jsonb)
       ON CONFLICT (organization_id,assignment_id,material_id) DO UPDATE SET
         started_at=COALESCE(training_assignment_material_progress.started_at,EXCLUDED.started_at),
         last_opened_at=now(),
         completed_at=CASE WHEN $4 THEN COALESCE(training_assignment_material_progress.completed_at,now()) ELSE training_assignment_material_progress.completed_at END,
         acknowledged_at=CASE WHEN $5 THEN COALESCE(training_assignment_material_progress.acknowledged_at,now()) ELSE training_assignment_material_progress.acknowledged_at END,
         quiz_score=COALESCE(EXCLUDED.quiz_score,training_assignment_material_progress.quiz_score),
         quiz_answers=COALESCE(EXCLUDED.quiz_answers,training_assignment_material_progress.quiz_answers)`,
      [
        context.organizationId,
        assignment.id,
        material.id,
        completed,
        acknowledged,
        quizScore,
        input.quizAnswers === undefined
          ? null
          : JSON.stringify(input.quizAnswers),
      ],
    );
    const progress = await updateLearnerProgress(
      client,
      context,
      assignment.id,
    );
    await trainingAudit(
      client,
      context,
      "update",
      assignment.id,
      assignment.course_name,
      {
        event: completed ? "lesson_completed" : "lesson_opened",
        materialId: material.id,
        progressPercent: progress,
      },
    );
    return { assignmentId: assignment.id, progressPercent: progress };
  });
}

export async function submitMyTraining(
  context: TrainingContext,
  assignmentId: string,
) {
  return withTenantContext(context, async (client) => {
    const assignment = await learnerAssignmentFor(
      client,
      context,
      assignmentId,
    );
    if (!["assigned", "in_progress", "overdue"].includes(assignment.status))
      throw new ConflictError(
        "This training cannot be submitted in its current status",
        { field: "status" },
      );
    const required = await client.query<LearnerMaterialRow>(
      `SELECT m.*,p.completed_at,p.acknowledged_at,p.quiz_score
         FROM training_materials m
         LEFT JOIN training_assignment_material_progress p
           ON p.organization_id=m.organization_id AND p.assignment_id=$3 AND p.material_id=m.id
        WHERE m.organization_id=$1 AND m.course_id=$2 AND m.is_active AND m.is_required
        ORDER BY m.sort_order,m.created_at`,
      [context.organizationId, assignment.course_id, assignment.id],
    );
    const incomplete = required.rows.filter(
      (material) =>
        !material.completed_at ||
        (material.requires_acknowledgment && !material.acknowledged_at) ||
        (material.quiz_passing_score !== null &&
          (material.quiz_score === null ||
            Number(material.quiz_score) < Number(material.quiz_passing_score))),
    );
    if (incomplete.length)
      throw new ConflictError(
        "Complete every required lesson, acknowledgement and quiz before submitting",
        {
          field: "materials",
          outstanding: incomplete.map((material) => material.title),
        },
      );
    await client.query(
      `UPDATE training_assignments
          SET status='awaiting_review',submitted_on=CURRENT_DATE,progress_percent=100,last_opened_at=now()
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, assignment.id],
    );
    await trainingAudit(
      client,
      context,
      "update",
      assignment.id,
      assignment.course_name,
      { event: "submitted_for_validation", progressPercent: 100 },
    );
    await notifyOrganizationOwnersInTransaction(client, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      provinceId: assignment.province_id,
      siteId: assignment.site_id,
      type: "training_validation_required",
      category: "training",
      priority: "normal",
      title: "Training needs validation",
      message: assignment.course_name,
      actionUrl: "/training",
      entityType: "training_assignment",
      entityId: assignment.id,
      deduplicationKey: `training-validation:${assignment.id}`,
    });
    return { submitted: true, assignmentId: assignment.id };
  });
}

export async function myTrainingCertificate(
  context: TrainingContext,
  assignmentId: string,
) {
  return withTenantContext(context, async (client) => {
    const assignment = await learnerAssignmentFor(
      client,
      context,
      assignmentId,
    );
    if (assignment.status !== "completed") return { certificate: null };
    const professional = await client.query<{
      certificate_number: string;
      issued_at: Date;
      expires_on: string | null;
      score: string | null;
      verification_token: string;
    }>(
      `SELECT certificate_number,issued_at,expires_on,score::text,verification_token
         FROM training_certificates
        WHERE organization_id=$1 AND assignment_id=$2 AND revoked_at IS NULL
        LIMIT 1`,
      [context.organizationId, assignment.id],
    );
    if (professional.rows[0]) {
      const certificate = professional.rows[0];
      return {
        certificate: {
          certificateNumber: certificate.certificate_number,
          completedOn: certificate.issued_at.toISOString(),
          expiresOn: certificate.expires_on,
          score: certificate.score === null ? null : Number(certificate.score),
          verificationToken: certificate.verification_token,
        },
      };
    }
    const record = await client.query<RecordRow>(
      `SELECT ${recordFields}
         FROM training_records r
         JOIN employees e ON e.organization_id=r.organization_id AND e.id=r.employee_id
         JOIN training_courses c ON c.organization_id=r.organization_id AND c.id=r.course_id
         LEFT JOIN users recorder ON recorder.id=r.recorded_by
        WHERE r.organization_id=$1 AND r.employee_id=$2 AND r.course_id=$3
        ORDER BY r.completed_on DESC,r.created_at DESC LIMIT 1`,
      [context.organizationId, assignment.employee_id, assignment.course_id],
    );
    return { certificate: record.rows[0] ? mapRecord(record.rows[0]) : null };
  });
}

export async function myTrainingMaterialFile(
  context: TrainingContext,
  assignmentId: string,
  materialId: string,
) {
  return withTenantContext(context, async (client) => {
    const assignment = await learnerAssignmentFor(
      client,
      context,
      assignmentId,
    );
    const result = await client.query<{
      storage_path: string;
      mime_type: string;
      file_name: string;
    }>(
      `SELECT d.storage_path,d.mime_type,d.file_name
         FROM training_materials m
         JOIN documents d ON d.organization_id=m.organization_id AND d.id=m.document_id
        WHERE m.organization_id=$1 AND m.id=$2 AND m.course_id=$3 AND m.is_active`,
      [context.organizationId, materialId, assignment.course_id],
    );
    const document = result.rows[0];
    if (!document) throw new NotFoundError("Training document not found");
    return {
      fileName: document.file_name,
      mimeType: document.mime_type,
      buffer: await readPrivateDocument(document.storage_path),
    };
  });
}
