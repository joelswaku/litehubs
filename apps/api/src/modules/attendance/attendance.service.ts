import type { PoolClient } from "pg";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type {
  AssignEmployeeInput,
  ChangeAssignmentInput,
  ClockInput,
  CorrectAttendanceInput,
  CreateShiftInput,
  ListAttendanceInput,
  UpdateShiftInput,
  ScheduleExceptionInput,
} from "./attendance.validation";

export interface WorkforceContext {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
  permissions: string[];
}

type Scope = "organization" | "province" | "self";
type AttendanceStatus = "present" | "late" | "absent" | "leave";

interface WeeklyScheduleDay {
  day: number;
  enabled: boolean;
  startsAt?: string;
  endsAt?: string;
  breakMinutes: number;
}

interface Location {
  provinceId: string;
  siteId: string;
  departmentId: string | null;
}

interface ShiftRow {
  id: string;
  code: string;
  name: string;
  province_id: string;
  province_code: string;
  province_name: string;
  site_id: string;
  site_code: string;
  site_name: string;
  department_id: string | null;
  department_code: string | null;
  department_name: string | null;
  starts_at: string;
  ends_at: string;
  weekly_schedule: unknown;
  is_active: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

interface EmployeeRow {
  id: string;
  member_id: string | null;
  employee_number: string;
  full_name: string;
  job_title: string;
  province_id: string | null;
  province_code: string | null;
  province_name: string | null;
  site_id: string | null;
  site_code: string | null;
  site_name: string | null;
  department_id: string | null;
  department_code: string | null;
  department_name: string | null;
}

interface AssignmentRow {
  id: string;
  shift_id: string;
  employee_id: string;
  effective_from: string;
  effective_to: string | null;
  employee_number: string;
  employee_name: string;
  employee_job_title: string;
}

interface ActiveShiftRow extends ShiftRow {
  assignment_id: string;
}

interface ScheduleExceptionRow {
  id: string;
  shift_assignment_id: string;
  work_date: string;
  is_working: boolean;
  starts_at: string | null;
  ends_at: string | null;
  break_minutes: number;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

interface AttendanceRow {
  id: string;
  employee_id: string;
  employee_number: string;
  employee_name: string;
  employee_job_title: string;
  employee_member_id: string | null;
  shift_id: string | null;
  shift_code: string | null;
  shift_name: string | null;
  province_id: string;
  province_code: string;
  province_name: string;
  site_id: string;
  site_code: string;
  site_name: string;
  department_id: string | null;
  department_code: string | null;
  department_name: string | null;
  work_date: string;
  status: AttendanceStatus;
  clock_in_at: Date | null;
  clock_out_at: Date | null;
  expected_minutes: number | null;
  worked_minutes: number | null;
  overtime_minutes: number | null;
  correction_note: string | null;
  approved_at: Date | null;
  approved_by_name: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

const shiftFields = [
  "s.id",
  "s.code",
  "s.name",
  "s.province_id",
  "p.code AS province_code",
  "p.name AS province_name",
  "s.site_id",
  "site.code AS site_code",
  "site.name AS site_name",
  "s.department_id",
  "d.code AS department_code",
  "d.name AS department_name",
  "s.starts_at::text",
  "s.ends_at::text",
  "s.weekly_schedule",
  "s.is_active",
  "s.notes",
  "s.created_at",
  "s.updated_at",
].join(", ");

const employeeFields = [
  "e.id",
  "e.member_id",
  "e.employee_number",
  "e.full_name",
  "e.job_title",
  "e.province_id",
  "p.code AS province_code",
  "p.name AS province_name",
  "e.site_id",
  "site.code AS site_code",
  "site.name AS site_name",
  "e.department_id",
  "d.code AS department_code",
  "d.name AS department_name",
].join(", ");

const attendanceFields = [
  "a.id",
  "a.employee_id",
  "e.employee_number",
  "e.full_name AS employee_name",
  "e.job_title AS employee_job_title",
  "e.member_id AS employee_member_id",
  "a.shift_id",
  "s.code AS shift_code",
  "s.name AS shift_name",
  "a.province_id",
  "p.code AS province_code",
  "p.name AS province_name",
  "a.site_id",
  "site.code AS site_code",
  "site.name AS site_name",
  "a.department_id",
  "d.code AS department_code",
  "d.name AS department_name",
  "a.work_date::text",
  "a.status",
  "a.clock_in_at",
  "a.clock_out_at",
  "a.expected_minutes",
  "a.worked_minutes",
  "a.overtime_minutes",
  "a.correction_note",
  "a.approved_at",
  "approver.full_name AS approved_by_name",
  "a.notes",
  "a.created_at",
  "a.updated_at",
].join(", ");

function defaultWeeklySchedule(
  startsAt: string,
  endsAt: string,
  includeEveryDay = false,
): WeeklyScheduleDay[] {
  return Array.from({ length: 7 }, (_, index) => ({
    day: index + 1,
    enabled: includeEveryDay || index < 5,
    startsAt,
    endsAt,
    breakMinutes: 0,
  }));
}

function normaliseWeeklySchedule(
  value: unknown,
  fallbackStartsAt: string,
  fallbackEndsAt: string,
): WeeklyScheduleDay[] {
  const fallback = defaultWeeklySchedule(
    fallbackStartsAt.slice(0, 5),
    fallbackEndsAt.slice(0, 5),
    true,
  );
  if (!Array.isArray(value)) return fallback;
  return fallback.map((fallbackDay) => {
    const item = value.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        Number((candidate as { day?: unknown }).day) === fallbackDay.day,
    ) as Record<string, unknown> | undefined;
    if (!item) return fallbackDay;
    const enabled = item.enabled === true;
    const startsAt =
      typeof item.startsAt === "string" ? item.startsAt.slice(0, 5) : fallbackDay.startsAt;
    const endsAt =
      typeof item.endsAt === "string" ? item.endsAt.slice(0, 5) : fallbackDay.endsAt;
    const breakMinutes = Number.isFinite(Number(item.breakMinutes))
      ? Math.max(0, Math.min(720, Number(item.breakMinutes)))
      : 0;
    return { day: fallbackDay.day, enabled, startsAt, endsAt, breakMinutes };
  });
}

function timeMinutes(value: string): number {
  const [hour = "0", minute = "0"] = value.slice(0, 5).split(":");
  return Number(hour) * 60 + Number(minute);
}

function plannedMinutes(day: WeeklyScheduleDay): number {
  if (!day.enabled || !day.startsAt || !day.endsAt) return 0;
  const start = timeMinutes(day.startsAt);
  const end = timeMinutes(day.endsAt);
  const span = (end - start + 1_440) % 1_440 || 1_440;
  return Math.max(0, span - day.breakMinutes);
}

function plannedDayForDate(shift: ShiftRow, workDate: string): WeeklyScheduleDay {
  const dayOfWeek = new Date(`${workDate}T12:00:00Z`).getUTCDay() || 7;
  return (
    normaliseWeeklySchedule(
      shift.weekly_schedule,
      shift.starts_at,
      shift.ends_at,
    ).find((day) => day.day === dayOfWeek) ?? {
      day: dayOfWeek,
      enabled: false,
      breakMinutes: 0,
    }
  );
}

function exceptionDayForDate(
  exception: ScheduleExceptionRow | undefined,
  workDate: string,
): WeeklyScheduleDay | undefined {
  if (!exception) return undefined;
  const dayOfWeek = new Date(`${workDate}T12:00:00Z`).getUTCDay() || 7;
  return {
    day: dayOfWeek,
    enabled: exception.is_working,
    startsAt: exception.starts_at?.slice(0, 5) ?? undefined,
    endsAt: exception.ends_at?.slice(0, 5) ?? undefined,
    breakMinutes: Number(exception.break_minutes ?? 0),
  };
}

function mapScheduleException(row: ScheduleExceptionRow) {
  return {
    id: row.id,
    assignmentId: row.shift_assignment_id,
    workDate: row.work_date,
    isWorking: row.is_working,
    startsAt: row.starts_at?.slice(0, 5) ?? null,
    endsAt: row.ends_at?.slice(0, 5) ?? null,
    breakMinutes: Number(row.break_minutes),
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function workedMinutes(clockIn: Date, clockOut: Date): number {
  return Math.max(0, Math.round((clockOut.getTime() - clockIn.getTime()) / 60_000));
}
function mapShift(row: ShiftRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    province: {
      id: row.province_id,
      code: row.province_code,
      name: row.province_name,
    },
    site: { id: row.site_id, code: row.site_code, name: row.site_name },
    department: row.department_id
      ? {
          id: row.department_id,
          code: row.department_code,
          name: row.department_name,
        }
      : null,
    startsAt: row.starts_at.slice(0, 5),
    endsAt: row.ends_at.slice(0, 5),
    weeklySchedule: normaliseWeeklySchedule(
      row.weekly_schedule,
      row.starts_at,
      row.ends_at,
    ),
    isActive: row.is_active,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAttendance(row: AttendanceRow) {
  return {
    id: row.id,
    workDate: row.work_date,
    status: row.status,
    employee: {
      id: row.employee_id,
      employeeNumber: row.employee_number,
      fullName: row.employee_name,
      jobTitle: row.employee_job_title,
    },
    shift: row.shift_id
      ? { id: row.shift_id, code: row.shift_code, name: row.shift_name }
      : null,
    province: {
      id: row.province_id,
      code: row.province_code,
      name: row.province_name,
    },
    site: { id: row.site_id, code: row.site_code, name: row.site_name },
    department: row.department_id
      ? {
          id: row.department_id,
          code: row.department_code,
          name: row.department_name,
        }
      : null,
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at,
    expectedHours:
      row.expected_minutes == null ? null : Number(row.expected_minutes) / 60,
    workedHours:
      row.worked_minutes == null ? null : Number(row.worked_minutes) / 60,
    overtimeHours:
      row.overtime_minutes == null ? null : Number(row.overtime_minutes) / 60,
    correctionNote: row.correction_note,
    approval: row.approved_at
      ? { approvedAt: row.approved_at, approvedByName: row.approved_by_name }
      : null,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hasPermission(context: WorkforceContext, code: string): boolean {
  return context.permissions.includes(code);
}

async function scopeOf(
  client: PoolClient,
  context: WorkforceContext,
): Promise<Scope> {
  if (context.isOwner) return "organization";
  const result = await client.query<{
    organization_scope: boolean;
    province_scope: boolean;
  }>(
    `SELECT
       EXISTS (
         SELECT 1 FROM member_roles mr JOIN roles r
           ON r.organization_id = mr.organization_id AND r.id = mr.role_id
          WHERE mr.organization_id = $1 AND mr.member_id = $2
            AND r.data_scope = 'organization'
       ) AS organization_scope,
       EXISTS (
         SELECT 1 FROM member_roles mr JOIN roles r
           ON r.organization_id = mr.organization_id AND r.id = mr.role_id
          WHERE mr.organization_id = $1 AND mr.member_id = $2
            AND r.data_scope = 'province'
       ) AS province_scope`,
    [context.organizationId, context.memberId],
  );
  if (result.rows[0]?.organization_scope) return "organization";
  return result.rows[0]?.province_scope ? "province" : "self";
}

async function assertProvinceAccess(
  client: PoolClient,
  context: WorkforceContext,
  provinceId: string,
): Promise<void> {
  if ((await scopeOf(client, context)) === "organization") return;
  const result = await client.query(
    `SELECT 1 FROM member_provinces
      WHERE organization_id = $1 AND member_id = $2 AND province_id = $3`,
    [context.organizationId, context.memberId, provinceId],
  );
  if (result.rowCount === 0) throw new NotFoundError("Province not found");
}

async function resolveLocation(
  client: PoolClient,
  context: WorkforceContext,
  siteId: string,
  departmentId: string | null,
): Promise<Location> {
  const site = await client.query<{ province_id: string }>(
    `SELECT province_id FROM sites
      WHERE organization_id = $1 AND id = $2 AND is_active`,
    [context.organizationId, siteId],
  );
  const provinceId = site.rows[0]?.province_id;
  if (!provinceId) throw new NotFoundError("Active site not found");

  if (departmentId) {
    const department = await client.query<{ site_id: string | null }>(
      `SELECT site_id FROM departments
        WHERE organization_id = $1 AND id = $2 AND is_active`,
      [context.organizationId, departmentId],
    );
    if (department.rowCount === 0)
      throw new NotFoundError("Active department not found");
    if (department.rows[0]!.site_id !== siteId) {
      throw new BadRequestError(
        "The selected department must belong to the selected site",
      );
    }
  }
  await assertProvinceAccess(client, context, provinceId);
  return { provinceId, siteId, departmentId };
}

async function selectShift(
  client: PoolClient,
  organizationId: string,
  shiftId: string,
): Promise<ShiftRow | undefined> {
  const result = await client.query<ShiftRow>(
    `SELECT ${shiftFields}
       FROM shifts s
       JOIN provinces p ON p.organization_id = s.organization_id AND p.id = s.province_id
       JOIN sites site ON site.organization_id = s.organization_id AND site.id = s.site_id
       LEFT JOIN departments d ON d.organization_id = s.organization_id AND d.id = s.department_id
      WHERE s.organization_id = $1 AND s.id = $2`,
    [organizationId, shiftId],
  );
  return result.rows[0];
}

async function assertShiftAccess(
  client: PoolClient,
  context: WorkforceContext,
  shiftId: string,
): Promise<ShiftRow> {
  const shift = await selectShift(client, context.organizationId, shiftId);
  if (!shift) throw new NotFoundError("Shift not found");
  const scope = await scopeOf(client, context);
  if (scope === "organization") return shift;
  if (scope === "self") throw new NotFoundError("Shift not found");
  await assertProvinceAccess(client, context, shift.province_id);
  return shift;
}

async function selectEmployee(
  client: PoolClient,
  organizationId: string,
  where: "id" | "number",
  value: string,
): Promise<EmployeeRow | undefined> {
  const column = where === "id" ? "e.id" : "e.employee_number";
  const result = await client.query<EmployeeRow>(
    `SELECT ${employeeFields}
       FROM employees e
       LEFT JOIN provinces p ON p.organization_id = e.organization_id AND p.id = e.province_id
       LEFT JOIN sites site ON site.organization_id = e.organization_id AND site.id = e.site_id
       LEFT JOIN departments d ON d.organization_id = e.organization_id AND d.id = e.department_id
      WHERE e.organization_id = $1 AND ${column} = $2`,
    [organizationId, value],
  );
  return result.rows[0];
}

async function assertEmployeeAccess(
  client: PoolClient,
  context: WorkforceContext,
  employee: EmployeeRow,
  allowSelf: boolean,
): Promise<void> {
  if (allowSelf && employee.member_id === context.memberId) return;
  const scope = await scopeOf(client, context);
  if (scope === "organization") return;
  if (scope !== "province" || !employee.province_id) {
    throw new NotFoundError("Employee not found");
  }
  await assertProvinceAccess(client, context, employee.province_id);
}

async function attendanceRow(
  client: PoolClient,
  organizationId: string,
  attendanceId: string,
): Promise<AttendanceRow | undefined> {
  const result = await client.query<AttendanceRow>(
    `SELECT ${attendanceFields}
       FROM attendance_records a
       JOIN employees e ON e.organization_id = a.organization_id AND e.id = a.employee_id
       LEFT JOIN shifts s ON s.organization_id = a.organization_id AND s.id = a.shift_id
       JOIN provinces p ON p.organization_id = a.organization_id AND p.id = a.province_id
       JOIN sites site ON site.organization_id = a.organization_id AND site.id = a.site_id
       LEFT JOIN departments d ON d.organization_id = a.organization_id AND d.id = a.department_id
       LEFT JOIN users approver ON approver.id = a.approved_by_user_id
      WHERE a.organization_id = $1 AND a.id = $2`,
    [organizationId, attendanceId],
  );
  return result.rows[0];
}

async function assertAttendanceAccess(
  client: PoolClient,
  context: WorkforceContext,
  attendanceId: string,
  allowSelf: boolean,
): Promise<AttendanceRow> {
  const record = await attendanceRow(
    client,
    context.organizationId,
    attendanceId,
  );
  if (!record) throw new NotFoundError("Attendance record not found");
  if (allowSelf && record.employee_member_id === context.memberId)
    return record;
  const scope = await scopeOf(client, context);
  if (scope === "organization") return record;
  if (scope !== "province")
    throw new NotFoundError("Attendance record not found");
  await assertProvinceAccess(client, context, record.province_id);
  return record;
}

function translateConflict(error: unknown): never {
  const pg = error as { code?: string; constraint?: string };
  if (pg.code === "23505") {
    throw new ConflictError(
      pg.constraint === "attendance_employee_day_unique"
        ? "This employee already has an attendance record for this work date"
        : pg.constraint === "shift_assignments_unique"
          ? "This employee is already assigned to this schedule. Choose another schedule or use a date exception."
          : pg.constraint === "shift_assignment_exceptions_one_per_day"
            ? "A date exception already exists for this employee and date"
            : "A schedule with this code already exists, or this employee is already assigned to it",
    );
  }
  throw error;
}

export async function listShifts(context: WorkforceContext) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context);
    if (scope === "self") return [];
    const result = await client.query<ShiftRow>(
      `SELECT ${shiftFields}
         FROM shifts s
         JOIN provinces p ON p.organization_id = s.organization_id AND p.id = s.province_id
         JOIN sites site ON site.organization_id = s.organization_id AND site.id = s.site_id
         LEFT JOIN departments d ON d.organization_id = s.organization_id AND d.id = s.department_id
         ${scope === "province" ? "JOIN member_provinces mp ON mp.organization_id = s.organization_id AND mp.province_id = s.province_id" : ""}
        WHERE s.organization_id = $1
          ${scope === "province" ? "AND mp.member_id = $2" : ""}
        ORDER BY s.name`,
      scope === "province"
        ? [context.organizationId, context.memberId]
        : [context.organizationId],
    );
    return result.rows.map(mapShift);
  });
}

export async function createShift(
  context: WorkforceContext,
  input: CreateShiftInput,
) {
  try {
    return await withTenantContext(context, async (client) => {
      const location = await resolveLocation(
        client,
        context,
        input.siteId,
        input.departmentId ?? null,
      );
      const weeklySchedule =
        input.weeklySchedule ??
        defaultWeeklySchedule(input.startsAt, input.endsAt);
      const result = await client.query<{ id: string }>(
        `INSERT INTO shifts
          (organization_id, province_id, site_id, department_id, code, name, starts_at, ends_at, weekly_schedule, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::time, $8::time, $9::jsonb, $10, $11)
         RETURNING id`,
        [
          context.organizationId,
          location.provinceId,
          location.siteId,
          location.departmentId,
          input.code,
          input.name,
          input.startsAt,
          input.endsAt,
          JSON.stringify(weeklySchedule),
          input.notes ?? null,
          context.userId,
        ],
      );
      return mapShift(
        (await selectShift(
          client,
          context.organizationId,
          result.rows[0]!.id,
        ))!,
      );
    });
  } catch (error) {
    return translateConflict(error);
  }
}

export async function updateShift(
  context: WorkforceContext,
  shiftId: string,
  input: UpdateShiftInput,
) {
  try {
    return await withTenantContext(context, async (client) => {
      const current = await assertShiftAccess(client, context, shiftId);
      const location = await resolveLocation(
        client,
        context,
        input.siteId ?? current.site_id,
        input.departmentId === undefined
          ? current.department_id
          : input.departmentId,
      );
      const currentSchedule = normaliseWeeklySchedule(
        current.weekly_schedule,
        current.starts_at,
        current.ends_at,
      );
      const weeklySchedule = input.weeklySchedule ??
        (input.startsAt || input.endsAt
          ? currentSchedule.map((day) =>
              day.enabled
                ? {
                    ...day,
                    startsAt: input.startsAt ?? day.startsAt,
                    endsAt: input.endsAt ?? day.endsAt,
                  }
                : day,
            )
          : currentSchedule);
      await client.query(
        `UPDATE shifts
            SET province_id = $3, site_id = $4, department_id = $5, code = $6,
                name = $7, starts_at = $8::time, ends_at = $9::time,
                weekly_schedule = $10::jsonb, is_active = $11, notes = $12
          WHERE organization_id = $1 AND id = $2`,
        [
          context.organizationId,
          shiftId,
          location.provinceId,
          location.siteId,
          location.departmentId,
          input.code ?? current.code,
          input.name ?? current.name,
          input.startsAt ?? current.starts_at.slice(0, 5),
          input.endsAt ?? current.ends_at.slice(0, 5),
          JSON.stringify(weeklySchedule),
          input.isActive ?? current.is_active,
          input.notes === undefined ? current.notes : input.notes,
        ],
      );
      return mapShift(
        (await selectShift(client, context.organizationId, shiftId))!,
      );
    });
  } catch (error) {
    return translateConflict(error);
  }
}

export async function deleteShift(context: WorkforceContext, shiftId: string) {
  return withTenantContext(context, async (client) => {
    await assertShiftAccess(client, context, shiftId);
    const result = await client.query(
      "DELETE FROM shifts WHERE organization_id = $1 AND id = $2",
      [context.organizationId, shiftId],
    );
    if (result.rowCount === 0) throw new NotFoundError("Shift not found");
  });
}

export async function assignEmployee(
  context: WorkforceContext,
  shiftId: string,
  input: AssignEmployeeInput,
) {
  try {
    return await withTenantContext(context, async (client) => {
      const shift = await assertShiftAccess(client, context, shiftId);
      const employee = await selectEmployee(
        client,
        context.organizationId,
        "id",
        input.employeeId,
      );
      if (!employee) throw new NotFoundError("Employee not found");
      await assertEmployeeAccess(client, context, employee, false);
      if (employee.province_id !== shift.province_id) {
        throw new BadRequestError(
          "An employee can only be assigned to a shift in their work province",
        );
      }
      const overlap = await client.query(
        `SELECT 1 FROM shift_assignments
          WHERE organization_id = $1 AND employee_id = $2
            AND effective_from <= COALESCE($4::date, 'infinity'::date)
            AND COALESCE(effective_to, 'infinity'::date) >= $3::date`,
        [
          context.organizationId,
          employee.id,
          input.effectiveFrom,
          input.effectiveTo ?? null,
        ],
      );
      if ((overlap.rowCount ?? 0) > 0) {
        throw new ConflictError(
          "This employee already has a shift assignment covering these dates",
        );
      }
      const result = await client.query<AssignmentRow>(
        `INSERT INTO shift_assignments
          (organization_id, shift_id, employee_id, effective_from, effective_to, assigned_by)
         VALUES ($1, $2, $3, $4::date, $5::date, $6)
         RETURNING id, shift_id, employee_id, effective_from::text, effective_to::text`,
        [
          context.organizationId,
          shift.id,
          employee.id,
          input.effectiveFrom,
          input.effectiveTo ?? null,
          context.userId,
        ],
      );
      return {
        id: result.rows[0]!.id,
        shiftId: shift.id,
        employee: {
          id: employee.id,
          employeeNumber: employee.employee_number,
          fullName: employee.full_name,
          jobTitle: employee.job_title,
        },
        effectiveFrom: result.rows[0]!.effective_from,
        effectiveTo: result.rows[0]!.effective_to,
      };
    });
  } catch (error) {
    return translateConflict(error);
  }
}

export async function changeAssignment(
  context: WorkforceContext,
  shiftId: string,
  assignmentId: string,
  input: ChangeAssignmentInput,
) {
  try {
    return await withTenantContext(context, async (client) => {
      const sourceShift = await assertShiftAccess(client, context, shiftId);
      const targetShift = await assertShiftAccess(
        client,
        context,
        input.targetShiftId,
      );
      if (sourceShift.id === targetShift.id) {
        throw new BadRequestError("Choose a different shift for this employee");
      }

      const assignmentResult = await client.query<{
        id: string;
        employee_id: string;
        effective_from: string;
        effective_to: string | null;
      }>(
        `SELECT id, employee_id, effective_from::text, effective_to::text
           FROM shift_assignments
          WHERE organization_id = $1 AND shift_id = $2 AND id = $3
          FOR UPDATE`,
        [context.organizationId, sourceShift.id, assignmentId],
      );
      const assignment = assignmentResult.rows[0];
      if (!assignment) throw new NotFoundError("Shift assignment not found");

      const employee = await selectEmployee(
        client,
        context.organizationId,
        "id",
        assignment.employee_id,
      );
      if (!employee) throw new NotFoundError("Employee not found");
      await assertEmployeeAccess(client, context, employee, false);
      if (employee.province_id !== targetShift.province_id) {
        throw new BadRequestError(
          "An employee can only be assigned to a shift in their work province",
        );
      }
      if (input.effectiveFrom <= assignment.effective_from) {
        throw new BadRequestError(
          "Choose a new-shift date after the current assignment start date",
        );
      }
      if (assignment.effective_to && input.effectiveFrom > assignment.effective_to) {
        throw new BadRequestError(
          "The current assignment does not cover the chosen new-shift date",
        );
      }

      const overlap = await client.query(
        `SELECT 1 FROM shift_assignments
          WHERE organization_id = $1 AND employee_id = $2 AND id <> $3
            AND effective_from <= 'infinity'::date
            AND COALESCE(effective_to, 'infinity'::date) >= $4::date`,
        [
          context.organizationId,
          employee.id,
          assignment.id,
          input.effectiveFrom,
        ],
      );
      if ((overlap.rowCount ?? 0) > 0) {
        throw new ConflictError(
          "This employee already has another shift assignment covering that date",
        );
      }

      await client.query(
        `UPDATE shift_assignments
            SET effective_to = ($4::date - INTERVAL '1 day')::date
          WHERE organization_id = $1 AND shift_id = $2 AND id = $3`,
        [
          context.organizationId,
          sourceShift.id,
          assignment.id,
          input.effectiveFrom,
        ],
      );
      const created = await client.query<{
        id: string;
        shift_id: string;
        effective_from: string;
        effective_to: string | null;
      }>(
        `INSERT INTO shift_assignments
          (organization_id, shift_id, employee_id, effective_from, effective_to, assigned_by)
         VALUES ($1, $2, $3, $4::date, NULL, $5)
         RETURNING id, shift_id, effective_from::text, effective_to::text`,
        [
          context.organizationId,
          targetShift.id,
          employee.id,
          input.effectiveFrom,
          context.userId,
        ],
      );
      const row = created.rows[0]!;
      return {
        id: row.id,
        shiftId: row.shift_id,
        employee: {
          id: employee.id,
          employeeNumber: employee.employee_number,
          fullName: employee.full_name,
          jobTitle: employee.job_title,
        },
        effectiveFrom: row.effective_from,
        effectiveTo: row.effective_to,
      };
    });
  } catch (error) {
    return translateConflict(error);
  }
}
export async function listAssignments(
  context: WorkforceContext,
  shiftId: string,
) {
  return withTenantContext(context, async (client) => {
    const shift = await assertShiftAccess(client, context, shiftId);
    const result = await client.query<AssignmentRow>(
      `SELECT a.id, a.shift_id, a.employee_id, a.effective_from::text, a.effective_to::text,
              e.employee_number, e.full_name AS employee_name, e.job_title AS employee_job_title
         FROM shift_assignments a
         JOIN employees e ON e.organization_id = a.organization_id AND e.id = a.employee_id
        WHERE a.organization_id = $1 AND a.shift_id = $2
        ORDER BY a.effective_from DESC, e.full_name`,
      [context.organizationId, shift.id],
    );
    return result.rows.map((row) => ({
      id: row.id,
      shiftId: row.shift_id,
      employee: {
        id: row.employee_id,
        employeeNumber: row.employee_number,
        fullName: row.employee_name,
        jobTitle: row.employee_job_title,
      },
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
    }));
  });
}

async function assignmentForShift(
  client: PoolClient,
  context: WorkforceContext,
  shiftId: string,
  assignmentId: string,
): Promise<AssignmentRow> {
  await assertShiftAccess(client, context, shiftId);
  const result = await client.query<AssignmentRow>(
    `SELECT a.id, a.shift_id, a.employee_id, a.effective_from::text, a.effective_to::text,
            e.employee_number, e.full_name AS employee_name, e.job_title AS employee_job_title
       FROM shift_assignments a
       JOIN employees e ON e.organization_id = a.organization_id AND e.id = a.employee_id
      WHERE a.organization_id = $1 AND a.shift_id = $2 AND a.id = $3`,
    [context.organizationId, shiftId, assignmentId],
  );
  const assignment = result.rows[0];
  if (!assignment) throw new NotFoundError("Shift assignment not found");
  return assignment;
}

async function exceptionRow(
  client: PoolClient,
  organizationId: string,
  exceptionId: string,
): Promise<ScheduleExceptionRow | undefined> {
  const result = await client.query<ScheduleExceptionRow>(
    `SELECT id, shift_assignment_id, work_date::text, is_working,
            starts_at::text, ends_at::text, break_minutes, note, created_at, updated_at
       FROM shift_assignment_exceptions
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, exceptionId],
  );
  return result.rows[0];
}

async function assertNoAttendanceForException(
  client: PoolClient,
  organizationId: string,
  assignment: AssignmentRow,
  workDate: string,
) {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM attendance_records
        WHERE organization_id = $1 AND employee_id = $2 AND work_date = $3::date
     ) AS exists`,
    [organizationId, assignment.employee_id, workDate],
  );
  if (result.rows[0]?.exists) {
    throw new ConflictError("A schedule exception cannot be changed after attendance is recorded for that date");
  }
}

export async function listAssignmentExceptions(
  context: WorkforceContext,
  shiftId: string,
  assignmentId: string,
) {
  return withTenantContext(context, async (client) => {
    await assignmentForShift(client, context, shiftId, assignmentId);
    const result = await client.query<ScheduleExceptionRow>(
      `SELECT id, shift_assignment_id, work_date::text, is_working,
              starts_at::text, ends_at::text, break_minutes, note, created_at, updated_at
         FROM shift_assignment_exceptions
        WHERE organization_id = $1 AND shift_assignment_id = $2
        ORDER BY work_date DESC`,
      [context.organizationId, assignmentId],
    );
    return result.rows.map(mapScheduleException);
  });
}

export async function saveAssignmentException(
  context: WorkforceContext,
  shiftId: string,
  assignmentId: string,
  input: ScheduleExceptionInput,
) {
  return withTenantContext(context, async (client) => {
    const assignment = await assignmentForShift(client, context, shiftId, assignmentId);
    if (input.workDate < assignment.effective_from || (assignment.effective_to && input.workDate > assignment.effective_to)) {
      throw new BadRequestError("The exception date must fall within this employee assignment");
    }
    await assertNoAttendanceForException(client, context.organizationId, assignment, input.workDate);
    const saved = await client.query<{ id: string }>(
      `INSERT INTO shift_assignment_exceptions
        (organization_id, shift_assignment_id, work_date, is_working, starts_at, ends_at, break_minutes, note, created_by)
       VALUES ($1, $2, $3::date, $4, $5::time, $6::time, $7, $8, $9)
       ON CONFLICT (organization_id, shift_assignment_id, work_date) DO UPDATE
         SET is_working = EXCLUDED.is_working, starts_at = EXCLUDED.starts_at,
             ends_at = EXCLUDED.ends_at, break_minutes = EXCLUDED.break_minutes, note = EXCLUDED.note
       RETURNING id`,
      [
        context.organizationId,
        assignmentId,
        input.workDate,
        input.isWorking,
        input.isWorking ? input.startsAt : null,
        input.isWorking ? input.endsAt : null,
        input.isWorking ? input.breakMinutes : 0,
        input.note ?? null,
        context.userId,
      ],
    );
    return mapScheduleException((await exceptionRow(client, context.organizationId, saved.rows[0]!.id))!);
  });
}

export async function deleteAssignmentException(
  context: WorkforceContext,
  shiftId: string,
  assignmentId: string,
  exceptionId: string,
) {
  return withTenantContext(context, async (client) => {
    const assignment = await assignmentForShift(client, context, shiftId, assignmentId);
    const exception = await exceptionRow(client, context.organizationId, exceptionId);
    if (!exception || exception.shift_assignment_id !== assignmentId) {
      throw new NotFoundError("Schedule exception not found");
    }
    await assertNoAttendanceForException(client, context.organizationId, assignment, exception.work_date);
    await client.query(
      `DELETE FROM shift_assignment_exceptions
        WHERE organization_id = $1 AND id = $2 AND shift_assignment_id = $3`,
      [context.organizationId, exceptionId, assignmentId],
    );
  });
}
async function activeShiftForEmployee(
  client: PoolClient,
  organizationId: string,
  employeeId: string,
  workDate: string,
): Promise<{ shift: ShiftRow; plannedDay: WeeklyScheduleDay }> {
  const result = await client.query<ActiveShiftRow>(
    `SELECT ${shiftFields}, a.id AS assignment_id
       FROM shift_assignments a
       JOIN shifts s ON s.organization_id = a.organization_id AND s.id = a.shift_id
       JOIN provinces p ON p.organization_id = s.organization_id AND p.id = s.province_id
       JOIN sites site ON site.organization_id = s.organization_id AND site.id = s.site_id
       LEFT JOIN departments d ON d.organization_id = s.organization_id AND d.id = s.department_id
      WHERE a.organization_id = $1 AND a.employee_id = $2
        AND a.effective_from <= $3::date
        AND COALESCE(a.effective_to, 'infinity'::date) >= $3::date
        AND s.is_active
      ORDER BY s.starts_at
      LIMIT 1`,
    [organizationId, employeeId, workDate],
  );
  const active = result.rows[0];
  if (!active) {
    throw new NotFoundError("No active shift assignment found for this employee and work date");
  }
  const exceptionResult = await client.query<ScheduleExceptionRow>(
    `SELECT id, shift_assignment_id, work_date::text, is_working,
            starts_at::text, ends_at::text, break_minutes, note, created_at, updated_at
       FROM shift_assignment_exceptions
      WHERE organization_id = $1 AND shift_assignment_id = $2 AND work_date = $3::date`,
    [organizationId, active.assignment_id, workDate],
  );
  const plannedDay = exceptionDayForDate(exceptionResult.rows[0], workDate) ?? plannedDayForDate(active, workDate);
  if (!plannedDay.enabled) {
    throw new BadRequestError("This employee is not scheduled to work on the selected day");
  }
  return { shift: active, plannedDay };
}
async function assertClockAccess(
  client: PoolClient,
  context: WorkforceContext,
  employee: EmployeeRow,
): Promise<void> {
  if (
    employee.member_id === context.memberId &&
    hasPermission(context, "attendance.clock_self")
  ) {
    return;
  }
  if (!hasPermission(context, "attendance.clock_others")) {
    throw new ForbiddenError(
      "You may only clock in or out your own employee profile",
    );
  }
  await assertEmployeeAccess(client, context, employee, false);
}

function attendanceStatus(
  workDate: string,
  startsAt: string,
  clockedAt: Date,
  graceMinutes = 15,
): AttendanceStatus {
  const scheduledAt = new Date(`${workDate}T${startsAt.slice(0, 5)}:00.000Z`);
  return clockedAt.getTime() > scheduledAt.getTime() + graceMinutes * 60 * 1000
    ? "late"
    : "present";
}

async function findAttendanceForEmployee(
  client: PoolClient,
  organizationId: string,
  employeeId: string,
  workDate: string,
): Promise<AttendanceRow | undefined> {
  const result = await client.query<AttendanceRow>(
    `SELECT ${attendanceFields}
       FROM attendance_records a
       JOIN employees e ON e.organization_id = a.organization_id AND e.id = a.employee_id
       LEFT JOIN shifts s ON s.organization_id = a.organization_id AND s.id = a.shift_id
       JOIN provinces p ON p.organization_id = a.organization_id AND p.id = a.province_id
       JOIN sites site ON site.organization_id = a.organization_id AND site.id = a.site_id
       LEFT JOIN departments d ON d.organization_id = a.organization_id AND d.id = a.department_id
       LEFT JOIN users approver ON approver.id = a.approved_by_user_id
      WHERE a.organization_id = $1 AND a.employee_id = $2 AND a.work_date = $3::date`,
    [organizationId, employeeId, workDate],
  );
  return result.rows[0];
}

export async function clockIn(context: WorkforceContext, input: ClockInput) {
  try {
    return await withTenantContext(context, async (client) => {
      const employee = await selectEmployee(
        client,
        context.organizationId,
        "number",
        input.employeeNumber,
      );
      if (!employee) throw new NotFoundError("Employee number not found");
      await assertClockAccess(client, context, employee);
      const activeShift = await activeShiftForEmployee(
        client,
        context.organizationId,
        employee.id,
        input.workDate,
      );
      const { shift, plannedDay } = activeShift;
      if (employee.province_id !== shift.province_id) {
        throw new BadRequestError(
          "The employee work province does not match their assigned shift",
        );
      }
      const existing = await findAttendanceForEmployee(
        client,
        context.organizationId,
        employee.id,
        input.workDate,
      );
      if (existing?.clock_in_at)
        throw new ConflictError(
          "This employee is already clocked in for this work date",
        );
      const occurredAt = input.occurredAt
        ? new Date(input.occurredAt)
        : new Date();
      const expectedMinutes = plannedMinutes(plannedDay);
      const performancePolicy = await client.query<{ grace_minutes: number }>(
        "SELECT grace_minutes FROM performance_policies WHERE organization_id=$1",
        [context.organizationId],
      );
      const status = attendanceStatus(
        input.workDate,
        plannedDay.startsAt ?? shift.starts_at,
        occurredAt,
        performancePolicy.rows[0]?.grace_minutes ?? 15,
      );
      const result = await client.query<{ id: string }>(
        `INSERT INTO attendance_records
          (organization_id, employee_id, shift_id, province_id, site_id, department_id, work_date,
           status, clock_in_at, expected_minutes, clock_in_by_user_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          context.organizationId,
          employee.id,
          shift.id,
          shift.province_id,
          shift.site_id,
          shift.department_id,
          input.workDate,
          status,
          occurredAt,
          expectedMinutes,
          context.userId,
          input.notes ?? null,
        ],
      );
      return mapAttendance(
        (await attendanceRow(
          client,
          context.organizationId,
          result.rows[0]!.id,
        ))!,
      );
    });
  } catch (error) {
    return translateConflict(error);
  }
}

export async function clockOut(context: WorkforceContext, input: ClockInput) {
  try {
    return await withTenantContext(context, async (client) => {
      const employee = await selectEmployee(
        client,
        context.organizationId,
        "number",
        input.employeeNumber,
      );
      if (!employee) throw new NotFoundError("Employee number not found");
      await assertClockAccess(client, context, employee);
      const existing = await findAttendanceForEmployee(
        client,
        context.organizationId,
        employee.id,
        input.workDate,
      );
      if (!existing?.clock_in_at)
        throw new NotFoundError(
          "No clock-in record found for this employee and work date",
        );
      if (existing.clock_out_at)
        throw new ConflictError(
          "This employee is already clocked out for this work date",
        );
      const occurredAt = input.occurredAt
        ? new Date(input.occurredAt)
        : new Date();
      if (occurredAt < existing.clock_in_at)
        throw new BadRequestError(
          "Clock-out time cannot be before clock-in time",
        );
      const verifiedWorkedMinutes = workedMinutes(existing.clock_in_at, occurredAt);
      const historicalShift = existing.shift_id
        ? await selectShift(client, context.organizationId, existing.shift_id)
        : undefined;
      const expectedMinutes =
        existing.expected_minutes ??
        (historicalShift
          ? plannedMinutes(plannedDayForDate(historicalShift, input.workDate))
          : 0);
      const verifiedOvertimeMinutes = Math.max(
        0,
        verifiedWorkedMinutes - expectedMinutes,
      );
      await client.query(
        `UPDATE attendance_records
            SET clock_out_at = $3, clock_out_by_user_id = $4,
                worked_minutes = $5, overtime_minutes = $6,
                notes = COALESCE($7, notes)
          WHERE organization_id = $1 AND id = $2`,
        [
          context.organizationId,
          existing.id,
          occurredAt,
          context.userId,
          verifiedWorkedMinutes,
          verifiedOvertimeMinutes,
          input.notes ?? null,
        ],
      );
      return mapAttendance(
        (await attendanceRow(client, context.organizationId, existing.id))!,
      );
    });
  } catch (error) {
    return translateConflict(error);
  }
}

export async function listAttendance(
  context: WorkforceContext,
  filters: ListAttendanceInput,
) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context);
    const conditions = ["a.organization_id = $1"];
    const values: unknown[] = [context.organizationId];
    if (filters.workDate) {
      values.push(filters.workDate);
      conditions.push(`a.work_date = $${values.length}::date`);
    }
    if (filters.employeeId) {
      values.push(filters.employeeId);
      conditions.push(`a.employee_id = $${values.length}`);
    }
    if (scope === "province") {
      values.push(context.memberId);
      conditions.push(
        `EXISTS (SELECT 1 FROM member_provinces mp WHERE mp.organization_id = a.organization_id AND mp.member_id = $${values.length} AND mp.province_id = a.province_id)`,
      );
    }
    if (scope === "self") {
      values.push(context.memberId);
      conditions.push(`e.member_id = $${values.length}`);
    }
    const result = await client.query<AttendanceRow>(
      `SELECT ${attendanceFields}
         FROM attendance_records a
         JOIN employees e ON e.organization_id = a.organization_id AND e.id = a.employee_id
         LEFT JOIN shifts s ON s.organization_id = a.organization_id AND s.id = a.shift_id
         JOIN provinces p ON p.organization_id = a.organization_id AND p.id = a.province_id
         JOIN sites site ON site.organization_id = a.organization_id AND site.id = a.site_id
         LEFT JOIN departments d ON d.organization_id = a.organization_id AND d.id = a.department_id
         LEFT JOIN users approver ON approver.id = a.approved_by_user_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY a.work_date DESC, e.full_name`,
      values,
    );
    return result.rows.map(mapAttendance);
  });
}

export async function correctAttendance(
  context: WorkforceContext,
  attendanceId: string,
  input: CorrectAttendanceInput,
) {
  return withTenantContext(context, async (client) => {
    const current = await assertAttendanceAccess(
      client,
      context,
      attendanceId,
      false,
    );
    const clockInAt =
      input.clockInAt === undefined
        ? current.clock_in_at
        : input.clockInAt
          ? new Date(input.clockInAt)
          : null;
    const clockOutAt =
      input.clockOutAt === undefined
        ? current.clock_out_at
        : input.clockOutAt
          ? new Date(input.clockOutAt)
          : null;
    if (clockOutAt && !clockInAt)
      throw new BadRequestError("Clock-out needs a clock-in time");
    if (clockInAt && clockOutAt && clockOutAt < clockInAt) {
      throw new BadRequestError(
        "Clock-out time cannot be before clock-in time",
      );
    }
    const historicalShift = current.shift_id
      ? await selectShift(client, context.organizationId, current.shift_id)
      : undefined;
    const expectedMinutes =
      current.expected_minutes ??
      (historicalShift
        ? plannedMinutes(plannedDayForDate(historicalShift, current.work_date))
        : 0);
    const verifiedWorkedMinutes =
      clockInAt && clockOutAt ? workedMinutes(clockInAt, clockOutAt) : null;
    const verifiedOvertimeMinutes =
      verifiedWorkedMinutes === null
        ? null
        : Math.max(0, verifiedWorkedMinutes - expectedMinutes);
    await client.query(
      `UPDATE attendance_records
          SET status = $3, clock_in_at = $4, clock_out_at = $5,
              notes = $6, correction_note = $7, expected_minutes = COALESCE(expected_minutes, $8),
              worked_minutes = $9, overtime_minutes = $10
        WHERE organization_id = $1 AND id = $2`,
      [
        context.organizationId,
        attendanceId,
        input.status ?? current.status,
        clockInAt,
        clockOutAt,
        input.notes === undefined ? current.notes : input.notes,
        input.correctionNote,
        expectedMinutes,
        verifiedWorkedMinutes,
        verifiedOvertimeMinutes,
      ],
    );
    return mapAttendance(
      (await attendanceRow(client, context.organizationId, attendanceId))!,
    );
  });
}

export async function approveAttendance(
  context: WorkforceContext,
  attendanceId: string,
) {
  return withTenantContext(context, async (client) => {
    await assertAttendanceAccess(client, context, attendanceId, false);
    await client.query(
      `UPDATE attendance_records
          SET approved_by_user_id = $3, approved_at = now()
        WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, attendanceId, context.userId],
    );
    return mapAttendance(
      (await attendanceRow(client, context.organizationId, attendanceId))!,
    );
  });
}
