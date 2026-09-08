import type { PoolClient } from "pg";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type {
  CreateGoalInput,
  CreateReviewInput,
  ReviewQuery,
  UpdateGoalInput,
  UpdateReviewInput,
  AnalyticsQuery,
  PerformancePolicyInput,
} from "./performance.validation";

export interface PerformanceContext {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
  permissions: string[];
}
type Scope = "organization" | "province" | "self";
type ReviewStatus = "draft" | "submitted" | "acknowledged" | "closed";
type GoalStatus = "not_started" | "in_progress" | "achieved" | "cancelled";
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
interface ReviewRow {
  id: string;
  employee_id: string;
  period_start: string;
  period_end: string;
  review_type: string;
  reviewed_on: string | null;
  overall_rating: string | null;
  strengths: string | null;
  areas_to_improve: string | null;
  goals: string | null;
  employee_comments: string | null;
  status: ReviewStatus;
  reviewer_id: string | null;
  acknowledged_at: Date | null;
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
  reviewer_name: string | null;
  goal_count?: string;
  achieved_goal_count?: string;
}
interface GoalRow {
  id: string;
  review_id: string;
  title: string;
  description: string | null;
  target: string | null;
  due_on: string | null;
  weight: string | null;
  progress: string;
  status: GoalStatus;
  created_at: Date;
  updated_at: Date;
}
const reviewFields = `r.id,r.employee_id,r.period_start::text,r.period_end::text,r.review_type,r.reviewed_on::text,r.overall_rating::text,r.strengths,r.areas_to_improve,r.goals,r.employee_comments,r.status,r.reviewer_id,r.acknowledged_at,r.created_at,r.updated_at,e.member_id AS employee_member_id,e.employee_number,e.full_name AS employee_name,e.job_title AS employee_job_title,e.province_id,p.name AS province_name,e.site_id,s.name AS site_name,reviewer.full_name AS reviewer_name`;
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
function mapReview(row: ReviewRow) {
  return {
    id: row.id,
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
    periodStart: row.period_start,
    periodEnd: row.period_end,
    reviewType: row.review_type,
    reviewedOn: row.reviewed_on,
    overallRating:
      row.overall_rating === null ? null : Number(row.overall_rating),
    strengths: row.strengths,
    areasToImprove: row.areas_to_improve,
    goals: row.goals,
    employeeComments: row.employee_comments,
    status: row.status,
    reviewer: row.reviewer_id
      ? { id: row.reviewer_id, fullName: row.reviewer_name }
      : null,
    acknowledgedAt: row.acknowledged_at,
    goalCount: Number(row.goal_count ?? 0),
    achievedGoalCount: Number(row.achieved_goal_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function mapGoal(row: GoalRow) {
  return {
    id: row.id,
    reviewId: row.review_id,
    title: row.title,
    description: row.description,
    target: row.target,
    dueOn: row.due_on,
    weight: row.weight === null ? null : Number(row.weight),
    progress: Number(row.progress),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
async function scopeOf(
  client: PoolClient,
  context: PerformanceContext,
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
async function assertEmployeeScope(
  client: PoolClient,
  context: PerformanceContext,
  employee: Pick<EmployeeRow, "member_id" | "province_id">,
) {
  const scope = await scopeOf(client, context);
  if (scope === "organization") return;
  if (scope === "self") {
    if (employee.member_id !== context.memberId)
      throw new NotFoundError("Performance review not found");
    return;
  }
  if (!employee.province_id)
    throw new NotFoundError("Performance review not found");
  const allowed = await client.query(
    `SELECT 1 FROM member_provinces WHERE organization_id=$1 AND member_id=$2 AND province_id=$3`,
    [context.organizationId, context.memberId, employee.province_id],
  );
  if ((allowed.rowCount ?? 0) === 0)
    throw new NotFoundError("Performance review not found");
}
async function employeeFor(
  client: PoolClient,
  context: PerformanceContext,
  id: string,
) {
  const result = await client.query<EmployeeRow>(
    `SELECT e.id,e.member_id,e.employee_number,e.full_name,e.job_title,e.province_id,p.name AS province_name,e.site_id,s.name AS site_name,e.employment_status FROM employees e LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=e.organization_id AND s.id=e.site_id WHERE e.organization_id=$1 AND e.id=$2`,
    [context.organizationId, id],
  );
  const employee = result.rows[0];
  if (
    !employee ||
    !["active", "probation", "on_leave", "terminated"].includes(
      employee.employment_status,
    )
  )
    throw new NotFoundError("Employee not found");
  await assertEmployeeScope(client, context, employee);
  return employee;
}
async function reviewerFor(
  client: PoolClient,
  context: PerformanceContext,
  id: string | null | undefined,
) {
  if (!id) return null;
  const result = await client.query<EmployeeRow>(
    `SELECT e.id,e.member_id,e.employee_number,e.full_name,e.job_title,e.province_id,p.name AS province_name,e.site_id,s.name AS site_name,e.employment_status FROM employees e LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=e.organization_id AND s.id=e.site_id WHERE e.organization_id=$1 AND e.id=$2`,
    [context.organizationId, id],
  );
  if (!result.rows[0]) throw new NotFoundError("Reviewer not found");
  return result.rows[0];
}
async function reviewFor(
  client: PoolClient,
  context: PerformanceContext,
  id: string,
): Promise<ReviewRow> {
  const result = await client.query<ReviewRow>(
    `SELECT ${reviewFields},COUNT(g.id)::text AS goal_count,COUNT(g.id) FILTER (WHERE g.status='achieved')::text AS achieved_goal_count FROM performance_reviews r JOIN employees e ON e.organization_id=r.organization_id AND e.id=r.employee_id LEFT JOIN provinces p ON p.organization_id=r.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=r.organization_id AND s.id=e.site_id LEFT JOIN employees reviewer_employee ON reviewer_employee.organization_id=r.organization_id AND reviewer_employee.id=r.reviewer_id LEFT JOIN users reviewer ON reviewer.id=(SELECT m.user_id FROM organization_members m WHERE m.organization_id=r.organization_id AND m.id=reviewer_employee.member_id) LEFT JOIN performance_review_goals g ON g.organization_id=r.organization_id AND g.review_id=r.id WHERE r.organization_id=$1 AND r.id=$2 GROUP BY r.id,e.id,p.id,s.id,reviewer.full_name`,
    [context.organizationId, id],
  );
  const review = result.rows[0];
  if (!review) throw new NotFoundError("Performance review not found");
  await assertEmployeeScope(client, context, {
    member_id: review.employee_member_id,
    province_id: review.province_id,
  });
  return review;
}
export async function listReviews(
  context: PerformanceContext,
  query: ReviewQuery,
) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context);
    const params: unknown[] = [context.organizationId];
    const where = ["r.organization_id=$1"];
    if (query.employeeId) {
      params.push(query.employeeId);
      where.push(`r.employee_id=$${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      where.push(`r.status=$${params.length}`);
    }
    if (query.reviewType) {
      params.push(query.reviewType);
      where.push(`r.review_type=$${params.length}`);
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
    const result = await client.query<ReviewRow>(
      `SELECT ${reviewFields},COUNT(g.id)::text AS goal_count,COUNT(g.id) FILTER (WHERE g.status='achieved')::text AS achieved_goal_count FROM performance_reviews r JOIN employees e ON e.organization_id=r.organization_id AND e.id=r.employee_id LEFT JOIN provinces p ON p.organization_id=r.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=r.organization_id AND s.id=e.site_id LEFT JOIN employees reviewer_employee ON reviewer_employee.organization_id=r.organization_id AND reviewer_employee.id=r.reviewer_id LEFT JOIN users reviewer ON reviewer.id=(SELECT m.user_id FROM organization_members m WHERE m.organization_id=r.organization_id AND m.id=reviewer_employee.member_id) LEFT JOIN performance_review_goals g ON g.organization_id=r.organization_id AND g.review_id=r.id WHERE ${where.join(" AND ")} GROUP BY r.id,e.id,p.id,s.id,reviewer.full_name ORDER BY CASE r.status WHEN 'draft' THEN 0 WHEN 'submitted' THEN 1 WHEN 'acknowledged' THEN 2 ELSE 3 END,r.period_end DESC`,
      params,
    );
    return result.rows.map(mapReview);
  });
}
export async function createReview(
  context: PerformanceContext,
  input: CreateReviewInput,
) {
  return withTenantContext(context, async (client) => {
    const employee = await employeeFor(client, context, input.employeeId);
    if (input.periodEnd < input.periodStart)
      throw new BadRequestError("Period end must be on or after period start", {
        field: "periodEnd",
      });
    const reviewer = await reviewerFor(client, context, input.reviewerId);
    if (reviewer?.id === employee.id)
      throw new BadRequestError("An employee cannot review themselves", {
        field: "reviewerId",
      });
    const result = await client.query<{ id: string }>(
      `INSERT INTO performance_reviews (organization_id,employee_id,province_id,site_id,period_start,period_end,review_type,reviewed_on,overall_rating,strengths,areas_to_improve,goals,employee_comments,status,reviewer_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [
        context.organizationId,
        employee.id,
        employee.province_id,
        employee.site_id,
        input.periodStart,
        input.periodEnd,
        input.reviewType ?? "annual",
        input.reviewedOn ?? null,
        input.overallRating ?? null,
        input.strengths ?? null,
        input.areasToImprove ?? null,
        input.goals ?? null,
        input.employeeComments ?? null,
        input.status ?? "draft",
        reviewer?.id ?? null,
      ],
    );
    return mapReview(await reviewFor(client, context, result.rows[0]!.id));
  });
}
export async function updateReview(
  context: PerformanceContext,
  id: string,
  input: UpdateReviewInput,
) {
  return withTenantContext(context, async (client) => {
    const old = await reviewFor(client, context, id);
    if ((await scopeOf(client, context)) === "self")
      throw new ForbiddenError("Use acknowledgement to add your comments");
    const periodStart = input.periodStart ?? old.period_start;
    const periodEnd = input.periodEnd ?? old.period_end;
    if (periodEnd < periodStart)
      throw new BadRequestError("Period end must be on or after period start", {
        field: "periodEnd",
      });
    const reviewer =
      input.reviewerId === undefined
        ? { id: old.reviewer_id ?? null }
        : await reviewerFor(client, context, input.reviewerId);
    if (reviewer?.id === old.employee_id)
      throw new BadRequestError("An employee cannot review themselves", {
        field: "reviewerId",
      });
    if (input.status === "acknowledged")
      throw new BadRequestError(
        "Only the employee can acknowledge this review",
        { field: "status" },
      );
    await client.query(
      `UPDATE performance_reviews SET period_start=$3,period_end=$4,review_type=$5,reviewed_on=$6,overall_rating=$7,strengths=$8,areas_to_improve=$9,goals=$10,employee_comments=$11,status=$12,reviewer_id=$13 WHERE organization_id=$1 AND id=$2`,
      [
        context.organizationId,
        id,
        periodStart,
        periodEnd,
        input.reviewType ?? old.review_type,
        input.reviewedOn === undefined ? old.reviewed_on : input.reviewedOn,
        input.overallRating === undefined
          ? old.overall_rating
          : input.overallRating,
        input.strengths === undefined ? old.strengths : input.strengths,
        input.areasToImprove === undefined
          ? old.areas_to_improve
          : input.areasToImprove,
        input.goals === undefined ? old.goals : input.goals,
        input.employeeComments === undefined
          ? old.employee_comments
          : input.employeeComments,
        input.status ?? old.status,
        reviewer?.id ?? null,
      ],
    );
    return mapReview(await reviewFor(client, context, id));
  });
}
export async function acknowledge(
  context: PerformanceContext,
  id: string,
  input: { employeeComments?: string | null },
) {
  return withTenantContext(context, async (client) => {
    const review = await reviewFor(client, context, id);
    if ((await scopeOf(client, context)) !== "self")
      throw new ForbiddenError(
        "Only the reviewed employee can acknowledge this review",
      );
    if (review.status !== "submitted")
      throw new BadRequestError("Only a submitted review can be acknowledged");
    await client.query(
      `UPDATE performance_reviews SET status='acknowledged',acknowledged_at=now(),employee_comments=$3 WHERE organization_id=$1 AND id=$2`,
      [
        context.organizationId,
        id,
        input.employeeComments === undefined
          ? review.employee_comments
          : input.employeeComments,
      ],
    );
    return mapReview(await reviewFor(client, context, id));
  });
}
export async function listGoals(context: PerformanceContext, reviewId: string) {
  return withTenantContext(context, async (client) => {
    await reviewFor(client, context, reviewId);
    const r = await client.query<GoalRow>(
      `SELECT * FROM performance_review_goals WHERE organization_id=$1 AND review_id=$2 ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'not_started' THEN 1 WHEN 'achieved' THEN 2 ELSE 3 END,due_on NULLS LAST,created_at`,
      [context.organizationId, reviewId],
    );
    return r.rows.map(mapGoal);
  });
}
export async function createGoal(
  context: PerformanceContext,
  reviewId: string,
  input: CreateGoalInput,
) {
  return withTenantContext(context, async (client) => {
    if ((await scopeOf(client, context)) === "self")
      throw new ForbiddenError("Employees cannot create review objectives");
    await reviewFor(client, context, reviewId);
    const r = await client.query<GoalRow>(
      `INSERT INTO performance_review_goals (organization_id,review_id,title,description,target,due_on,weight,progress,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        context.organizationId,
        reviewId,
        input.title,
        input.description ?? null,
        input.target ?? null,
        input.dueOn ?? null,
        input.weight ?? null,
        input.progress ?? 0,
        input.status ?? "not_started",
      ],
    );
    return mapGoal(r.rows[0]!);
  });
}
export async function updateGoal(
  context: PerformanceContext,
  goalId: string,
  input: UpdateGoalInput,
) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<
      GoalRow & {
        employee_member_id: string | null;
        province_id: string | null;
      }
    >(
      `SELECT g.*,e.member_id AS employee_member_id,e.province_id FROM performance_review_goals g JOIN performance_reviews r ON r.organization_id=g.organization_id AND r.id=g.review_id JOIN employees e ON e.organization_id=r.organization_id AND e.id=r.employee_id WHERE g.organization_id=$1 AND g.id=$2`,
      [context.organizationId, goalId],
    );
    const old = result.rows[0];
    if (!old) throw new NotFoundError("Performance objective not found");
    await assertEmployeeScope(client, context, {
      member_id: old.employee_member_id,
      province_id: old.province_id,
    });
    const self = (await scopeOf(client, context)) === "self";
    if (
      self &&
      (input.title !== undefined ||
        input.description !== undefined ||
        input.target !== undefined ||
        input.dueOn !== undefined ||
        input.weight !== undefined)
    )
      throw new ForbiddenError(
        "You can only update progress on your own objectives",
      );
    const status = input.status ?? old.status;
    const progress = input.progress ?? Number(old.progress);
    await client.query(
      `UPDATE performance_review_goals SET title=$3,description=$4,target=$5,due_on=$6,weight=$7,progress=$8,status=$9 WHERE organization_id=$1 AND id=$2`,
      [
        context.organizationId,
        goalId,
        input.title ?? old.title,
        input.description === undefined ? old.description : input.description,
        input.target === undefined ? old.target : input.target,
        input.dueOn === undefined ? old.due_on : input.dueOn,
        input.weight === undefined ? old.weight : input.weight,
        status === "achieved" ? 100 : progress,
        status,
      ],
    );
    const next = await client.query<GoalRow>(
      `SELECT * FROM performance_review_goals WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, goalId],
    );
    return mapGoal(next.rows[0]!);
  });
}
export async function summary(context: PerformanceContext) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context);
    const params: unknown[] = [context.organizationId];
    let access = "";
    if (scope === "self") {
      params.push(context.memberId);
      access = " AND e.member_id=$2";
    } else if (scope === "province") {
      params.push(context.memberId);
      access =
        " AND e.province_id IN (SELECT province_id FROM member_provinces WHERE organization_id=$1 AND member_id=$2)";
    }
    const r = await client.query<{
      total: string;
      draft: string;
      submitted: string;
      acknowledged: string;
      average: string;
    }>(
      `SELECT COUNT(*)::text AS total,COUNT(*) FILTER (WHERE r.status='draft')::text AS draft,COUNT(*) FILTER (WHERE r.status='submitted')::text AS submitted,COUNT(*) FILTER (WHERE r.status='acknowledged')::text AS acknowledged,COALESCE(AVG(r.overall_rating),0)::text AS average FROM performance_reviews r JOIN employees e ON e.organization_id=r.organization_id AND e.id=r.employee_id WHERE r.organization_id=$1 ${access}`,
      params,
    );
    const row = r.rows[0];
    return {
      metrics: {
        total: Number(row?.total ?? 0),
        draft: Number(row?.draft ?? 0),
        submitted: Number(row?.submitted ?? 0),
        acknowledged: Number(row?.acknowledged ?? 0),
        averageRating: Number(row?.average ?? 0),
      },
    };
  });
}

type PolicyRow = {
  attendance_weight: string; punctuality_weight: string; daily_report_weight: string; task_weight: string; conduct_weight: string;
  working_days: unknown; daily_reports_required: boolean; grace_minutes: number; minimum_observations: number;
  minor_deduction: string; serious_deduction: string; gross_deduction: string; flagged_report_deduction: string;
};
type AutomaticEmployee = EmployeeRow & { member_id: string | null };
type CountRow = Record<string, string | number | null>;

const defaultPolicy = {
  attendanceWeight: 35, punctualityWeight: 15, dailyReportWeight: 20, taskWeight: 20, conductWeight: 10,
  workingDays: [1, 2, 3, 4, 5], dailyReportsRequired: true, graceMinutes: 15, minimumObservations: 3,
  minorDeduction: 5, seriousDeduction: 15, grossDeduction: 35, flaggedReportDeduction: 5,
};
const metricNumber = (row: CountRow | undefined, key: string) => Number(row?.[key] ?? 0);
function policyFrom(row?: PolicyRow) {
  if (!row) return defaultPolicy;
  const savedDays = Array.isArray(row.working_days) ? row.working_days.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7) : [];
  return {
    attendanceWeight: Number(row.attendance_weight), punctualityWeight: Number(row.punctuality_weight), dailyReportWeight: Number(row.daily_report_weight), taskWeight: Number(row.task_weight), conductWeight: Number(row.conduct_weight),
    workingDays: savedDays.length ? [...new Set(savedDays)].sort((a, b) => a - b) : defaultPolicy.workingDays,
    dailyReportsRequired: row.daily_reports_required, graceMinutes: row.grace_minutes, minimumObservations: row.minimum_observations,
    minorDeduction: Number(row.minor_deduction), seriousDeduction: Number(row.serious_deduction), grossDeduction: Number(row.gross_deduction), flaggedReportDeduction: Number(row.flagged_report_deduction),
  };
}
async function policyFor(client: PoolClient, organizationId: string) {
  const result = await client.query<PolicyRow>(`SELECT attendance_weight,punctuality_weight,daily_report_weight,task_weight,conduct_weight,working_days,daily_reports_required,grace_minutes,minimum_observations,minor_deduction,serious_deduction,gross_deduction,flagged_report_deduction FROM performance_policies WHERE organization_id=$1`, [organizationId]);
  return policyFrom(result.rows[0]);
}
export async function getPolicy(context: PerformanceContext) {
  return withTenantContext(context, async (client) => policyFor(client, context.organizationId));
}
export async function updatePolicy(context: PerformanceContext, input: PerformancePolicyInput) {
  if (!context.isOwner) throw new ForbiddenError("Only the workspace owner can change automatic performance rules");
  return withTenantContext(context, async (client) => {
    const row = await client.query<PolicyRow>(`INSERT INTO performance_policies (organization_id,attendance_weight,punctuality_weight,daily_report_weight,task_weight,conduct_weight,working_days,daily_reports_required,grace_minutes,minimum_observations,minor_deduction,serious_deduction,gross_deduction,flagged_report_deduction,created_by_user_id,updated_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$15) ON CONFLICT (organization_id) DO UPDATE SET attendance_weight=EXCLUDED.attendance_weight,punctuality_weight=EXCLUDED.punctuality_weight,daily_report_weight=EXCLUDED.daily_report_weight,task_weight=EXCLUDED.task_weight,conduct_weight=EXCLUDED.conduct_weight,working_days=EXCLUDED.working_days,daily_reports_required=EXCLUDED.daily_reports_required,grace_minutes=EXCLUDED.grace_minutes,minimum_observations=EXCLUDED.minimum_observations,minor_deduction=EXCLUDED.minor_deduction,serious_deduction=EXCLUDED.serious_deduction,gross_deduction=EXCLUDED.gross_deduction,flagged_report_deduction=EXCLUDED.flagged_report_deduction,updated_by_user_id=EXCLUDED.updated_by_user_id RETURNING attendance_weight,punctuality_weight,daily_report_weight,task_weight,conduct_weight,working_days,daily_reports_required,grace_minutes,minimum_observations,minor_deduction,serious_deduction,gross_deduction,flagged_report_deduction`, [context.organizationId,input.attendanceWeight,input.punctualityWeight,input.dailyReportWeight,input.taskWeight,input.conductWeight,JSON.stringify(input.workingDays),input.dailyReportsRequired,input.graceMinutes,input.minimumObservations,input.minorDeduction,input.seriousDeduction,input.grossDeduction,input.flaggedReportDeduction,context.userId]);
    return policyFrom(row.rows[0]);
  });
}
function scoreLabel(score: number | null) {
  if (score === null) return "not_enough_data";
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 60) return "medium";
  if (score >= 40) return "needs_improvement";
  return "critical";
}
function percentage(value: number, total: number) { return total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : null; }
async function analyticsEmployees(client: PoolClient, context: PerformanceContext, employeeId?: string) {
  const scope = await scopeOf(client, context); const params: unknown[] = [context.organizationId]; const where = ["e.organization_id=$1", "e.employment_status IN ('active','probation','on_leave')"];
  if (employeeId) { params.push(employeeId); where.push(`e.id=$${params.length}`); }
  if (scope === "self") { params.push(context.memberId); where.push(`e.member_id=$${params.length}`); }
  else if (scope === "province") { params.push(context.memberId); where.push(`e.province_id IN (SELECT province_id FROM member_provinces WHERE organization_id=$1 AND member_id=$${params.length})`); }
  const result = await client.query<AutomaticEmployee>(`SELECT e.id,e.member_id,e.employee_number,e.full_name,e.job_title,e.province_id,p.name AS province_name,e.site_id,s.name AS site_name,e.employment_status FROM employees e LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=e.organization_id AND s.id=e.site_id WHERE ${where.join(" AND ")} ORDER BY e.full_name`, params);
  if (employeeId && !result.rows.length) throw new NotFoundError("Employee performance was not found");
  return result.rows;
}
export async function analytics(context: PerformanceContext, query: AnalyticsQuery) {
  return withTenantContext(context, async (client) => {
    const policy = await policyFor(client, context.organizationId);
    const to = query.to ?? new Date().toISOString().slice(0, 10);
    const date = new Date(`${to}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - 29); const from = query.from ?? date.toISOString().slice(0, 10);
    if (from > to) throw new BadRequestError("Period end must be on or after period start", { field: "to" });
    const employees = await analyticsEmployees(client, context, query.employeeId);
    if (!employees.length) return { policy, period: { from, to }, employees: [], generatedAt: new Date().toISOString() };
    const employeeIds = employees.map((employee) => employee.id);
    const memberIds = employees.flatMap((employee) => employee.member_id ? [employee.member_id] : []);
    const attendanceRows = await client.query<CountRow>(`SELECT employee_id::text AS employee_id,COUNT(*) FILTER (WHERE status='present')::text AS present_days,COUNT(*) FILTER (WHERE status='late')::text AS late_days,COUNT(*) FILTER (WHERE status='absent')::text AS absent_days,COUNT(*) FILTER (WHERE status='leave')::text AS leave_days FROM attendance_records WHERE organization_id=$1 AND employee_id=ANY($2::uuid[]) AND work_date BETWEEN $3::date AND $4::date GROUP BY employee_id`, [context.organizationId, employeeIds, from, to]);
    const scheduledRows = await client.query<CountRow>(`SELECT sa.employee_id::text AS employee_id,COUNT(DISTINCT d.work_date::date)::text AS scheduled_days FROM shift_assignments sa JOIN generate_series($3::date,$4::date,interval '1 day') AS d(work_date) ON d.work_date::date BETWEEN GREATEST(sa.effective_from,$3::date) AND LEAST(COALESCE(sa.effective_to,$4::date),$4::date) WHERE sa.organization_id=$1 AND sa.employee_id=ANY($2::uuid[]) AND EXTRACT(ISODOW FROM d.work_date)::int = ANY($5::int[]) GROUP BY sa.employee_id`, [context.organizationId, employeeIds, from, to, policy.workingDays]);
    const reportRows = await client.query<CountRow>(`SELECT employee_id::text AS employee_id,COUNT(*) FILTER (WHERE status IN ('submitted','reviewed','flagged'))::text AS submitted_reports,COUNT(*) FILTER (WHERE status='flagged')::text AS flagged_reports FROM daily_reports WHERE organization_id=$1 AND employee_id=ANY($2::uuid[]) AND report_level='employee' AND work_date BETWEEN $3::date AND $4::date GROUP BY employee_id`, [context.organizationId, employeeIds, from, to]);
    const taskRows = memberIds.length ? await client.query<CountRow>(`SELECT assigned_member_id::text AS member_id,COUNT(*) FILTER (WHERE status <> 'cancelled')::text AS assigned_tasks,COUNT(*) FILTER (WHERE status='completed')::text AS completed_tasks,COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled') AND due_date < CURRENT_DATE)::text AS overdue_tasks FROM management_project_tasks WHERE organization_id=$1 AND assigned_member_id=ANY($2::uuid[]) AND COALESCE(due_date,start_date,created_at::date) BETWEEN $3::date AND $4::date GROUP BY assigned_member_id`, [context.organizationId, memberIds, from, to]) : { rows: [] as CountRow[] };
    const disciplineRows = await client.query<CountRow>(`SELECT employee_id::text AS employee_id,COUNT(*) FILTER (WHERE severity='minor')::text AS minor_actions,COUNT(*) FILTER (WHERE severity='serious')::text AS serious_actions,COUNT(*) FILTER (WHERE severity='gross')::text AS gross_actions FROM disciplinary_actions WHERE organization_id=$1 AND employee_id=ANY($2::uuid[]) AND status IN ('upheld','closed') AND action_taken <> 'none' AND occurred_on BETWEEN $3::date AND $4::date GROUP BY employee_id`, [context.organizationId, employeeIds, from, to]);
    const by = (rows: CountRow[], key: string) => new Map(rows.map((row) => [String(row[key]), row]));
    const attendance = by(attendanceRows.rows, "employee_id"), scheduled = by(scheduledRows.rows, "employee_id"), reports = by(reportRows.rows, "employee_id"), tasks = by(taskRows.rows, "member_id"), discipline = by(disciplineRows.rows, "employee_id");
    const scores = employees.map((employee) => {
      const a = attendance.get(employee.id), s = scheduled.get(employee.id), r = reports.get(employee.id), task = employee.member_id ? tasks.get(employee.member_id) : undefined, d = discipline.get(employee.id);
      const present = metricNumber(a, "present_days"), late = metricNumber(a, "late_days"), absent = metricNumber(a, "absent_days"), leave = metricNumber(a, "leave_days"), scheduledDays = Math.max(metricNumber(s, "scheduled_days"), present + late + absent + leave), attended = present + late, unrecordedDays = Math.max(0, scheduledDays - (present + late + absent + leave));
      const submittedReports = metricNumber(r, "submitted_reports"), flaggedReports = metricNumber(r, "flagged_reports"), assignedTasks = metricNumber(task, "assigned_tasks"), completedTasks = metricNumber(task, "completed_tasks"), overdueTasks = metricNumber(task, "overdue_tasks");
      const minorActions = metricNumber(d, "minor_actions"), seriousActions = metricNumber(d, "serious_actions"), grossActions = metricNumber(d, "gross_actions");
      const components: Array<{ key: string; score: number; weight: number }> = [];
      const attendanceScore = percentage(attended, scheduledDays); if (attendanceScore !== null && policy.attendanceWeight > 0) components.push({ key: "attendance", score: attendanceScore, weight: policy.attendanceWeight });
      const punctualityScore = percentage(present, attended); if (punctualityScore !== null && policy.punctualityWeight > 0) components.push({ key: "punctuality", score: punctualityScore, weight: policy.punctualityWeight });
      const expectedReports = policy.dailyReportsRequired ? attended : 0; const reportingScore = percentage(Math.min(submittedReports, expectedReports), expectedReports); if (reportingScore !== null && policy.dailyReportWeight > 0) components.push({ key: "dailyReports", score: reportingScore, weight: policy.dailyReportWeight });
      const taskScore = percentage(completedTasks, assignedTasks); if (taskScore !== null && policy.taskWeight > 0) components.push({ key: "tasks", score: taskScore, weight: policy.taskWeight });
      const observations = attended + submittedReports + assignedTasks; const conductObserved = observations > 0 || minorActions + seriousActions + grossActions + flaggedReports > 0; const conductScore = conductObserved ? Math.max(0, 100 - minorActions * policy.minorDeduction - seriousActions * policy.seriousDeduction - grossActions * policy.grossDeduction - flaggedReports * policy.flaggedReportDeduction) : null; if (conductScore !== null && policy.conductWeight > 0) components.push({ key: "conduct", score: conductScore, weight: policy.conductWeight });
      const weight = components.reduce((total, component) => total + component.weight, 0); const score = weight ? Math.round((components.reduce((total, component) => total + component.score * component.weight, 0) / weight) * 10) / 10 : null;
      const issues: string[] = []; if (unrecordedDays > 0) issues.push("missing_attendance"); if (absent > 0) issues.push("absent_days"); if (late > 0) issues.push("late_arrivals"); if (expectedReports > submittedReports) issues.push("missing_daily_reports"); if (overdueTasks > 0) issues.push("overdue_tasks"); if (minorActions + seriousActions + grossActions > 0) issues.push("disciplinary_actions"); if (flaggedReports > 0) issues.push("flagged_reports");
      return { employee: mapEmployee(employee), score, level: scoreLabel(score), provisional: observations < policy.minimumObservations, observations, issues, attendance: { scheduledDays, presentDays: present, lateDays: late, absentDays: absent, leaveDays: leave, unrecordedDays, score: attendanceScore }, dailyReports: { expected: expectedReports, submitted: submittedReports, missing: Math.max(0, expectedReports - submittedReports), flagged: flaggedReports, score: reportingScore }, tasks: { assigned: assignedTasks, completed: completedTasks, overdue: overdueTasks, score: taskScore }, conduct: { minorActions, seriousActions, grossActions, score: conductScore }, components: Object.fromEntries(components.map((component) => [component.key, Math.round(component.score * 10) / 10])) };
    }).sort((left, right) => (left.score ?? 101) - (right.score ?? 101) || left.employee.fullName.localeCompare(right.employee.fullName));
    return { policy, period: { from, to }, employees: scores, generatedAt: new Date().toISOString() };
  });
}