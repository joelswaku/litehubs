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
  ClockInput,
  CorrectAttendanceInput,
  CreateShiftInput,
  ListAttendanceInput,
  UpdateShiftInput,
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
  "a.correction_note",
  "a.approved_at",
  "approver.full_name AS approved_by_name",
  "a.notes",
  "a.created_at",
  "a.updated_at",
].join(", ");

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
        : "A record with that code or assignment already exists",
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
      const result = await client.query<{ id: string }>(
        `INSERT INTO shifts
          (organization_id, province_id, site_id, department_id, code, name, starts_at, ends_at, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::time, $8::time, $9, $10)
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
      await client.query(
        `UPDATE shifts
            SET province_id = $3, site_id = $4, department_id = $5, code = $6,
                name = $7, starts_at = $8::time, ends_at = $9::time,
                is_active = $10, notes = $11
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

async function activeShiftForEmployee(
  client: PoolClient,
  organizationId: string,
  employeeId: string,
  workDate: string,
): Promise<ShiftRow> {
  const result = await client.query<ShiftRow>(
    `SELECT ${shiftFields}
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
  const shift = result.rows[0];
  if (!shift)
    throw new NotFoundError(
      "No active shift assignment found for this employee and work date",
    );
  return shift;
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
      const shift = await activeShiftForEmployee(
        client,
        context.organizationId,
        employee.id,
        input.workDate,
      );
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
      const performancePolicy = await client.query<{ grace_minutes: number }>(
        "SELECT grace_minutes FROM performance_policies WHERE organization_id=$1",
        [context.organizationId],
      );
      const status = attendanceStatus(
        input.workDate,
        shift.starts_at,
        occurredAt,
        performancePolicy.rows[0]?.grace_minutes ?? 15,
      );
      const result = await client.query<{ id: string }>(
        `INSERT INTO attendance_records
          (organization_id, employee_id, shift_id, province_id, site_id, department_id, work_date,
           status, clock_in_at, clock_in_by_user_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11)
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
      await client.query(
        `UPDATE attendance_records
            SET clock_out_at = $3, clock_out_by_user_id = $4,
                notes = COALESCE($5, notes)
          WHERE organization_id = $1 AND id = $2`,
        [
          context.organizationId,
          existing.id,
          occurredAt,
          context.userId,
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
    await client.query(
      `UPDATE attendance_records
          SET status = $3, clock_in_at = $4, clock_out_at = $5,
              notes = $6, correction_note = $7
        WHERE organization_id = $1 AND id = $2`,
      [
        context.organizationId,
        attendanceId,
        input.status ?? current.status,
        clockInAt,
        clockOutAt,
        input.notes === undefined ? current.notes : input.notes,
        input.correctionNote,
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
