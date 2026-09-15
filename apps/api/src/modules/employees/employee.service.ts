import type { PoolClient } from "pg";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type {
  CreateEmployeeInput,
  UpdateEmployeeInput,
} from "./employee.validation";

export interface EmployeeContext {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
}

interface EmployeeRow {
  id: string;
  member_id: string | null;
  employee_number: string;
  position_category: string;
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
  member_user_id: string | null;
  member_email: string | null;
  member_full_name: string | null;
  employment_status: string;
  employment_type: string;
  start_date: string | null;
  phone: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

interface LocationInput {
  provinceId: string | null;
  siteId: string | null;
  departmentId: string | null;
}

interface EmployeeCreationAllowanceRow {
  id: string;
  member_id: string;
  member_name: string;
  member_email: string;
  province_id: string;
  province_code: string;
  province_name: string;
  max_employees: number;
  used_employees: number;
  created_at: Date;
  updated_at: Date;
}

const employeeFields = [
  "e.id",
  "e.member_id",
  "e.employee_number",
  "e.position_category",
  "e.full_name",
  "e.job_title",
  "e.province_id",
  "p.code AS province_code",
  "p.name AS province_name",
  "e.site_id",
  "s.code AS site_code",
  "s.name AS site_name",
  "e.department_id",
  "d.code AS department_code",
  "d.name AS department_name",
  "member_user.id AS member_user_id",
  "member_user.email::text AS member_email",
  "member_user.full_name AS member_full_name",
  "e.employment_status",
  "e.employment_type",
  "e.start_date",
  "e.phone",
  "e.emergency_contact_name",
  "e.emergency_contact_phone",
  "e.notes",
  "e.created_at",
  "e.updated_at",
].join(", ");

function mapEmployeeCreationAllowance(row: EmployeeCreationAllowanceRow) {
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: row.member_name,
    memberEmail: row.member_email,
    province: {
      id: row.province_id,
      code: row.province_code,
      name: row.province_name,
    },
    maxEmployees: row.max_employees,
    usedEmployees: row.used_employees,
    remainingEmployees: row.max_employees - row.used_employees,
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
    positionCategory: row.position_category,
    member: row.member_id
      ? {
          memberId: row.member_id,
          userId: row.member_user_id,
          email: row.member_email,
          fullName: row.member_full_name,
        }
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
    department: row.department_id
      ? {
          id: row.department_id,
          code: row.department_code,
          name: row.department_name,
        }
      : null,
    employment: {
      status: row.employment_status,
      type: row.employment_type,
      startDate: row.start_date,
    },
    contact: {
      phone: row.phone,
      emergencyContactName: row.emergency_contact_name,
      emergencyContactPhone: row.emergency_contact_phone,
    },
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function translateConflict(error: unknown): never {
  const pg = error as { code?: string; constraint?: string };
  if (pg.code === "23505") {
    throw new ConflictError(
      pg.constraint === "employees_member_unique_per_org"
        ? "This team member already has an employee profile"
        : pg.constraint === "users_email_key"
          ? "That LiteHubs sign-in email is already in use"
          : "An employee with that number already exists",
    );
  }
  throw error;
}

async function organizationScope(
  client: PoolClient,
  context: EmployeeContext,
): Promise<boolean> {
  if (context.isOwner) return true;
  const result = await client.query<{ has_scope: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id = mr.organization_id AND r.id = mr.role_id WHERE mr.organization_id = $1 AND mr.member_id = $2 AND r.data_scope = 'organization') AS has_scope",
    [context.organizationId, context.memberId],
  );
  return result.rows[0]?.has_scope ?? false;
}

async function requireOrganizationScope(
  client: PoolClient,
  context: EmployeeContext,
): Promise<void> {
  if (!(await organizationScope(client, context))) {
    throw new ForbiddenError(
      "This action requires a company-wide role such as Owner, General Manager or HR Officer",
    );
  }
}

/**
 * Job category changes alter the human-readable employee number range
 * (10000 worker, 20000 supervisor, 30000 officer, 40000 manager).  They are
 * therefore an organisational decision, not ordinary HR data entry.  The API
 * verifies the caller independently of the screen so a forged request cannot
 * promote a worker through this field.
 */
async function canManagePositionCategory(
  client: PoolClient,
  context: EmployeeContext,
): Promise<boolean> {
  if (context.isOwner) return true;
  const result = await client.query<{ allowed: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM member_roles mr
         JOIN roles r
           ON r.organization_id = mr.organization_id AND r.id = mr.role_id
        WHERE mr.organization_id = $1
          AND mr.member_id = $2
          AND (r.code = 'manager' OR r.code LIKE '%\\_manager' ESCAPE '\\')
     ) AS allowed`,
    [context.organizationId, context.memberId],
  );
  return result.rows[0]?.allowed ?? false;
}

async function assertCanManagePositionCategory(
  client: PoolClient,
  context: EmployeeContext,
): Promise<void> {
  if (!(await canManagePositionCategory(client, context))) {
    throw new ForbiddenError(
      "Only an Owner or Manager can change an employee's position level",
    );
  }
}

async function assertOwner(context: EmployeeContext): Promise<void> {
  if (!context.isOwner) {
    throw new ForbiddenError(
      "Only the Owner can manage employee creation limits",
    );
  }
}

async function assertEligibleEmployeeCreator(
  client: PoolClient,
  organizationId: string,
  memberId: string,
): Promise<void> {
  const result = await client.query<{ status: string; allowed: boolean }>(
    `SELECT m.status,
            EXISTS (
              SELECT 1
                FROM member_roles mr
                JOIN roles r
                  ON r.organization_id = mr.organization_id AND r.id = mr.role_id
               WHERE mr.organization_id = m.organization_id
                 AND mr.member_id = m.id
                 AND (r.code = 'hr_officer' OR r.code = 'manager' OR r.code LIKE '%\\_manager' ESCAPE '\\')
            ) AS allowed
       FROM organization_members m
      WHERE m.organization_id = $1 AND m.id = $2`,
    [organizationId, memberId],
  );
  const member = result.rows[0];
  if (!member || member.status !== "active") {
    throw new NotFoundError("Active HR Officer or Manager not found");
  }
  if (!member.allowed) {
    throw new BadRequestError(
      "Employee creation limits can only be assigned to an HR Officer or Manager",
      { field: "memberId" },
    );
  }
}

async function assertMemberProvince(
  client: PoolClient,
  organizationId: string,
  memberId: string,
  provinceId: string,
): Promise<void> {
  const result = await client.query(
    `SELECT 1
       FROM member_provinces
      WHERE organization_id = $1 AND member_id = $2 AND province_id = $3`,
    [organizationId, memberId, provinceId],
  );
  if (result.rowCount === 0) {
    throw new BadRequestError(
      "Assign this province to the team member before granting an employee creation limit",
      { field: "provinceId" },
    );
  }
}

async function consumeEmployeeCreationAllowance(
  client: PoolClient,
  context: EmployeeContext,
  provinceId: string,
): Promise<void> {
  if (context.isOwner) return;
  await assertEligibleEmployeeCreator(
    client,
    context.organizationId,
    context.memberId,
  );

  // This conditional update is the reservation. It is atomic, so two browser
  // tabs cannot both consume the final remaining employee slot.
  const reserved = await client.query<{
    max_employees: number;
    used_employees: number;
  }>(
    `UPDATE employee_creation_allowances
        SET used_employees = used_employees + 1
      WHERE organization_id = $1
        AND member_id = $2
        AND province_id = $3
        AND used_employees < max_employees
      RETURNING max_employees, used_employees`,
    [context.organizationId, context.memberId, provinceId],
  );
  if ((reserved.rowCount ?? 0) > 0) return;

  const allowance = await client.query<{
    province_name: string;
    max_employees: number;
    used_employees: number;
  }>(
    `SELECT p.name AS province_name, a.max_employees, a.used_employees
       FROM employee_creation_allowances a
       JOIN provinces p ON p.organization_id = a.organization_id AND p.id = a.province_id
      WHERE a.organization_id = $1 AND a.member_id = $2 AND a.province_id = $3`,
    [context.organizationId, context.memberId, provinceId],
  );
  const row = allowance.rows[0];
  if (!row) {
    throw new ForbiddenError(
      "The Owner has not authorised you to add employees in this province",
      { field: "provinceId", reason: "employee_creation_not_allowed" },
    );
  }
  throw new ConflictError(
    `Employee creation limit reached for ${row.province_name} (${row.used_employees} of ${row.max_employees})`,
    {
      field: "provinceId",
      reason: "employee_creation_limit_reached",
      usedEmployees: row.used_employees,
      maxEmployees: row.max_employees,
    },
  );
}

async function assertProvinceAccess(
  client: PoolClient,
  context: EmployeeContext,
  provinceId: string,
): Promise<void> {
  if (await organizationScope(client, context)) return;
  const result = await client.query(
    "SELECT 1 FROM member_provinces WHERE organization_id = $1 AND member_id = $2 AND province_id = $3",
    [context.organizationId, context.memberId, provinceId],
  );
  if (result.rowCount === 0) throw new NotFoundError("Province not found");
}

async function assertActiveMember(
  client: PoolClient,
  organizationId: string,
  memberId: string,
): Promise<void> {
  const result = await client.query(
    "SELECT 1 FROM organization_members WHERE organization_id = $1 AND id = $2 AND status = 'active'",
    [organizationId, memberId],
  );
  if (result.rowCount === 0) {
    throw new NotFoundError("Active team member not found");
  }
}

async function siteProvince(
  client: PoolClient,
  organizationId: string,
  siteId: string,
): Promise<string> {
  const result = await client.query<{ province_id: string }>(
    "SELECT province_id FROM sites WHERE organization_id = $1 AND id = $2",
    [organizationId, siteId],
  );
  const provinceId = result.rows[0]?.province_id;
  if (!provinceId) throw new NotFoundError("Site not found");
  return provinceId;
}

async function departmentSite(
  client: PoolClient,
  organizationId: string,
  departmentId: string,
): Promise<string | null> {
  const result = await client.query<{ site_id: string | null }>(
    "SELECT site_id FROM departments WHERE organization_id = $1 AND id = $2",
    [organizationId, departmentId],
  );
  if (result.rowCount === 0) throw new NotFoundError("Department not found");
  return result.rows[0]!.site_id;
}

async function resolveLocation(
  client: PoolClient,
  context: EmployeeContext,
  input: LocationInput,
): Promise<LocationInput> {
  let provinceId = input.provinceId;
  let siteId = input.siteId;
  const departmentId = input.departmentId;

  if (departmentId) {
    const departmentSiteId = await departmentSite(
      client,
      context.organizationId,
      departmentId,
    );
    if (departmentSiteId) {
      if (siteId && siteId !== departmentSiteId) {
        throw new BadRequestError(
          "The selected department belongs to a different site",
        );
      }
      siteId = departmentSiteId;
    }
  }

  if (siteId) {
    const siteProvinceId = await siteProvince(
      client,
      context.organizationId,
      siteId,
    );
    if (provinceId && provinceId !== siteProvinceId) {
      throw new BadRequestError(
        "The selected site belongs to a different province",
      );
    }
    provinceId = siteProvinceId;
  }

  if (provinceId) {
    await assertProvinceAccess(client, context, provinceId);
  } else {
    await requireOrganizationScope(client, context);
  }
  return { provinceId, siteId, departmentId };
}

async function selectEmployee(
  client: PoolClient,
  organizationId: string,
  employeeId: string,
): Promise<EmployeeRow | undefined> {
  const result = await client.query<EmployeeRow>(
    [
      "SELECT " + employeeFields,
      "FROM employees e",
      "LEFT JOIN provinces p ON p.organization_id = e.organization_id AND p.id = e.province_id",
      "LEFT JOIN sites s ON s.organization_id = e.organization_id AND s.id = e.site_id",
      "LEFT JOIN departments d ON d.organization_id = e.organization_id AND d.id = e.department_id",
      "LEFT JOIN organization_members m ON m.organization_id = e.organization_id AND m.id = e.member_id",
      "LEFT JOIN users member_user ON member_user.id = m.user_id",
      "WHERE e.organization_id = $1 AND e.id = $2",
    ].join("\n"),
    [organizationId, employeeId],
  );
  return result.rows[0];
}

async function assertEmployeeAccess(
  client: PoolClient,
  context: EmployeeContext,
  employeeId: string,
): Promise<EmployeeRow> {
  const employee = await selectEmployee(
    client,
    context.organizationId,
    employeeId,
  );
  if (!employee) throw new NotFoundError("Employee not found");
  if (await organizationScope(client, context)) return employee;
  if (!employee.province_id) throw new NotFoundError("Employee not found");

  const result = await client.query(
    "SELECT 1 FROM member_provinces WHERE organization_id = $1 AND member_id = $2 AND province_id = $3",
    [context.organizationId, context.memberId, employee.province_id],
  );
  if (result.rowCount === 0) throw new NotFoundError("Employee not found");
  return employee;
}

function employeeListSql(provinceOnly: boolean): string {
  const joins = [
    "FROM employees e",
    ...(provinceOnly
      ? [
          "JOIN member_provinces mp ON mp.organization_id = e.organization_id AND mp.province_id = e.province_id",
        ]
      : []),
    "LEFT JOIN provinces p ON p.organization_id = e.organization_id AND p.id = e.province_id",
    "LEFT JOIN sites s ON s.organization_id = e.organization_id AND s.id = e.site_id",
    "LEFT JOIN departments d ON d.organization_id = e.organization_id AND d.id = e.department_id",
    "LEFT JOIN organization_members m ON m.organization_id = e.organization_id AND m.id = e.member_id",
    "LEFT JOIN users member_user ON member_user.id = m.user_id",
  ];
  return [
    "SELECT " + employeeFields,
    ...joins,
    provinceOnly
      ? "WHERE e.organization_id = $1 AND mp.member_id = $2"
      : "WHERE e.organization_id = $1",
    "ORDER BY e.full_name",
  ].join("\n");
}

export async function listEmployees(context: EmployeeContext) {
  return withTenantContext(context, async (client) => {
    const companyWide = await organizationScope(client, context);
    const result = await client.query<EmployeeRow>(
      employeeListSql(!companyWide),
      companyWide
        ? [context.organizationId]
        : [context.organizationId, context.memberId],
    );
    return result.rows.map(mapEmployee);
  });
}

export async function getEmployee(
  context: EmployeeContext,
  employeeId: string,
) {
  return withTenantContext(context, async (client) =>
    mapEmployee(await assertEmployeeAccess(client, context, employeeId)),
  );
}

type MyAccountShiftRow = {
  assignment_id: string;
  id: string;
  code: string;
  name: string;
  starts_at: string;
  ends_at: string;
  weekly_schedule: unknown;
  effective_from: string;
  effective_to: string | null;
  site_name: string;
  province_name: string;
  department_name: string | null;
};

type MyAccountScheduleExceptionRow = {
  id: string;
  work_date: string;
  is_working: boolean;
  starts_at: string | null;
  ends_at: string | null;
  break_minutes: number;
  note: string | null;
};
type MyAccountAttendanceRow = {
  id: string;
  work_date: string;
  status: string;
  clock_in_at: Date | null;
  clock_out_at: Date | null;
  expected_minutes: string | null;
  worked_minutes: string | null;
  overtime_minutes: string | null;
  shift_name: string | null;
  site_name: string | null;
};
type MyAccountLeaveBalanceRow = {
  id: string;
  leave_type_name: string;
  is_paid: boolean;
  entitled_days: string;
  carried_over_days: string;
  taken_days: string;
};
type MyAccountLeaveRequestRow = {
  id: string;
  leave_type_name: string;
  is_paid: boolean;
  starts_on: string;
  ends_on: string;
  requested_days: string;
  status: string;
};
type MyAccountPayslipRow = {
  id: string;
  reference: string;
  payroll_run_reference: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  currency: string;
  status: string;
  gross_pay: string;
  total_deductions: string;
  net_pay: string;
  payment_method: string | null;
  payment_reference: string | null;
};

type MyAccountPayslipLineRow = {
  id: string;
  payslip_id: string;
  component_code: string;
  component_name: string;
  component_type: "earning" | "deduction" | "employer_cost";
  amount: string;
  basis: string | null;
  sort_order: number;
};

type MyAccountOrganizationRow = {
  display_name: string | null;
  logo_url: string | null;
};

/**
 * A deliberately self-scoped employee account.  This endpoint is separate
 * from the HR and payroll workspaces so an employee with a supervisor role
 * can see their own employment information without acquiring access to anyone
 * else's profile, schedule, leave or salary.
 */
export async function getMyAccount(context: EmployeeContext) {
  return withTenantContext(context, async (client) => {
    const own = await client.query<{ id: string }>(
      `SELECT id
         FROM employees
        WHERE organization_id = $1 AND member_id = $2
        LIMIT 1`,
      [context.organizationId, context.memberId],
    );
    const employeeId = own.rows[0]?.id;
    if (!employeeId) {
      throw new NotFoundError(
        "No employee profile is linked to this LiteHubs account",
      );
    }

    const employee = await selectEmployee(
      client,
      context.organizationId,
      employeeId,
    );
    if (!employee) throw new NotFoundError("Employee not found");

    const [
      schedule,
      attendance,
      leaveBalances,
      leaveRequests,
      payslips,
      organization,
    ] = await Promise.all([
      client.query<MyAccountShiftRow>(
        `SELECT a.id AS assignment_id, s.id, s.code, s.name, s.starts_at::text, s.ends_at::text, s.weekly_schedule,
                  a.effective_from::text, a.effective_to::text,
                  site.name AS site_name, p.name AS province_name,
                  d.name AS department_name
             FROM shift_assignments a
             JOIN shifts s
               ON s.organization_id = a.organization_id AND s.id = a.shift_id
             JOIN provinces p
               ON p.organization_id = s.organization_id AND p.id = s.province_id
             JOIN sites site
               ON site.organization_id = s.organization_id AND site.id = s.site_id
             LEFT JOIN departments d
               ON d.organization_id = s.organization_id AND d.id = s.department_id
            WHERE a.organization_id = $1
              AND a.employee_id = $2
              AND s.is_active
              AND a.effective_from <= CURRENT_DATE
              AND (a.effective_to IS NULL OR a.effective_to >= CURRENT_DATE)
            ORDER BY a.effective_from DESC
            LIMIT 1`,
        [context.organizationId, employeeId],
      ),
      client.query<MyAccountAttendanceRow>(
        `SELECT a.id, a.work_date::text, a.status, a.clock_in_at, a.clock_out_at,
                  a.expected_minutes::text, a.worked_minutes::text, a.overtime_minutes::text,
                  s.name AS shift_name, site.name AS site_name
             FROM attendance_records a
             LEFT JOIN shifts s
               ON s.organization_id = a.organization_id AND s.id = a.shift_id
             LEFT JOIN sites site
               ON site.organization_id = a.organization_id AND site.id = a.site_id
            WHERE a.organization_id = $1 AND a.employee_id = $2
            ORDER BY a.work_date DESC, a.created_at DESC
            LIMIT 12`,
        [context.organizationId, employeeId],
      ),
      client.query<MyAccountLeaveBalanceRow>(
        `SELECT b.id, t.name AS leave_type_name, t.is_paid,
                  b.entitled_days::text, b.carried_over_days::text, b.taken_days::text
             FROM leave_balances b
             JOIN leave_types t
               ON t.organization_id = b.organization_id AND t.id = b.leave_type_id
            WHERE b.organization_id = $1
              AND b.employee_id = $2
              AND b.leave_year = EXTRACT(YEAR FROM CURRENT_DATE)::integer
            ORDER BY t.name`,
        [context.organizationId, employeeId],
      ),
      client.query<MyAccountLeaveRequestRow>(
        `SELECT r.id, t.name AS leave_type_name, t.is_paid,
                  r.starts_on::text, r.ends_on::text, r.requested_days::text, r.status
             FROM leave_requests r
             JOIN leave_types t
               ON t.organization_id = r.organization_id AND t.id = r.leave_type_id
            WHERE r.organization_id = $1 AND r.employee_id = $2
            ORDER BY r.starts_on DESC, r.created_at DESC
            LIMIT 8`,
        [context.organizationId, employeeId],
      ),
      client.query<MyAccountPayslipRow>(
        `SELECT p.id, p.reference, r.reference AS payroll_run_reference, r.period_start::text, r.period_end::text,
                  r.pay_date::text, p.currency, r.status,
                  p.gross_pay::text, p.total_deductions::text, p.net_pay::text,
                  p.payment_method, p.payment_reference
             FROM payslips p
             JOIN payroll_runs r
               ON r.organization_id = p.organization_id AND r.id = p.run_id
            WHERE p.organization_id = $1
              AND p.employee_id = $2
              AND r.status IN ('approved', 'paid')
            ORDER BY r.period_end DESC, p.created_at DESC`,
        [context.organizationId, employeeId],
      ),
      client.query<MyAccountOrganizationRow>(
        `SELECT o.display_name, settings.logo_url
             FROM organizations o
             LEFT JOIN organization_settings settings
               ON settings.organization_id = o.id
            WHERE o.id = $1
            LIMIT 1`,
        [context.organizationId],
      ),
    ]);

    // These line items are fetched only for the authenticated employee's own
    // approved or paid payslips. The employee never receives payroll lines
    // belonging to another person or to a draft cycle.
    const payslipLines = payslips.rows.length
      ? await client.query<MyAccountPayslipLineRow>(
          `SELECT id, payslip_id, component_code, component_name, component_type, amount::text, basis, sort_order
             FROM payslip_lines
            WHERE organization_id = $1
              AND payslip_id = ANY($2::uuid[])
            ORDER BY sort_order, component_name`,
          [context.organizationId, payslips.rows.map((row) => row.id)],
        )
      : { rows: [] as MyAccountPayslipLineRow[] };

    const scheduleRow = schedule.rows[0];
    const scheduleExceptions = scheduleRow
      ? await client.query<MyAccountScheduleExceptionRow>(
          `SELECT id, work_date::text, is_working, starts_at::text, ends_at::text, break_minutes, note
             FROM shift_assignment_exceptions
            WHERE organization_id = $1 AND shift_assignment_id = $2
            ORDER BY work_date`,
          [context.organizationId, scheduleRow.assignment_id],
        )
      : { rows: [] as MyAccountScheduleExceptionRow[] };
    const company = organization.rows[0];
    return {
      organization: {
        name: company?.display_name?.trim() || "LiteHubs",
        logoUrl: company?.logo_url ?? null,
      },
      employee: mapEmployee(employee),
      schedule: scheduleRow
        ? {
            id: scheduleRow.id,
            code: scheduleRow.code,
            name: scheduleRow.name,
            startsAt: scheduleRow.starts_at.slice(0, 5),
            endsAt: scheduleRow.ends_at.slice(0, 5),
            weeklySchedule: Array.isArray(scheduleRow.weekly_schedule)
              ? scheduleRow.weekly_schedule
              : [],
            exceptions: scheduleExceptions.rows.map((row) => ({
              id: row.id,
              workDate: row.work_date,
              isWorking: row.is_working,
              startsAt: row.starts_at?.slice(0, 5) ?? null,
              endsAt: row.ends_at?.slice(0, 5) ?? null,
              breakMinutes: Number(row.break_minutes),
              note: row.note,
            })),
            effectiveFrom: scheduleRow.effective_from,
            effectiveTo: scheduleRow.effective_to,
            provinceName: scheduleRow.province_name,
            siteName: scheduleRow.site_name,
            departmentName: scheduleRow.department_name,
          }
        : null,
      attendance: attendance.rows.map((row) => ({
        id: row.id,
        workDate: row.work_date,
        status: row.status,
        clockInAt: row.clock_in_at,
        clockOutAt: row.clock_out_at,
        expectedHours:
          row.expected_minutes === null
            ? null
            : Number(row.expected_minutes) / 60,
        workedHours:
          row.worked_minutes === null ? null : Number(row.worked_minutes) / 60,
        overtimeHours:
          row.overtime_minutes === null
            ? null
            : Number(row.overtime_minutes) / 60,
        shiftName: row.shift_name,
        siteName: row.site_name,
      })),
      leave: {
        balances: leaveBalances.rows.map((row) => ({
          id: row.id,
          type: row.leave_type_name,
          isPaid: row.is_paid,
          entitledDays: Number(row.entitled_days),
          carriedOverDays: Number(row.carried_over_days),
          takenDays: Number(row.taken_days),
          remainingDays:
            Number(row.entitled_days) +
            Number(row.carried_over_days) -
            Number(row.taken_days),
        })),
        requests: leaveRequests.rows.map((row) => ({
          id: row.id,
          type: row.leave_type_name,
          isPaid: row.is_paid,
          startsOn: row.starts_on,
          endsOn: row.ends_on,
          requestedDays: Number(row.requested_days),
          status: row.status,
        })),
      },
      payslips: payslips.rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        payrollRunReference: row.payroll_run_reference,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        payDate: row.pay_date,
        currency: row.currency,
        status: row.status,
        grossPay: Number(row.gross_pay),
        totalDeductions: Number(row.total_deductions),
        netPay: Number(row.net_pay),
        paymentMethod: row.payment_method,
        paymentReference: row.payment_reference,
        lines: payslipLines.rows
          .filter((line) => line.payslip_id === row.id)
          .map((line) => ({
            id: line.id,
            code: line.component_code,
            name: line.component_name,
            type: line.component_type,
            amount: Number(line.amount),
            basis: line.basis,
          })),
      })),
    };
  });
}

export async function createEmployee(
  context: EmployeeContext,
  input: CreateEmployeeInput,
) {
  try {
    return await withTenantContext(context, async (client) => {
      const memberId = input.memberId ?? null;
      if (memberId) {
        await assertActiveMember(client, context.organizationId, memberId);
      }
      const positionCategory = await positionCategoryForMember(
        client,
        context,
        memberId,
      );
      const location = await resolveLocation(client, context, {
        provinceId: input.provinceId ?? null,
        siteId: input.siteId ?? null,
        departmentId: input.departmentId ?? null,
      });
      if (!context.isOwner) {
        if (!location.provinceId) {
          throw new BadRequestError(
            "Choose a province approved by the Owner before adding an employee",
            { field: "provinceId" },
          );
        }
        await consumeEmployeeCreationAllowance(
          client,
          context,
          location.provinceId,
        );
      }
      const employeeNumber = await nextEmployeeNumber(
        client,
        context,
        positionCategory,
      );
      const result = await client.query<{ id: string }>(
        [
          "INSERT INTO employees (organization_id, member_id, employee_number, full_name, job_title, position_category, province_id, site_id, department_id, employment_status, employment_type, start_date, phone, emergency_contact_name, emergency_contact_phone, notes, created_by_member_id)",
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)",
          "RETURNING id",
        ].join("\n"),
        [
          context.organizationId,
          memberId,
          employeeNumber,
          input.fullName,
          input.jobTitle,
          positionCategory,
          location.provinceId,
          location.siteId,
          location.departmentId,
          input.employmentStatus,
          input.employmentType,
          input.startDate ?? null,
          input.phone ?? null,
          input.emergencyContactName ?? null,
          input.emergencyContactPhone ?? null,
          input.notes ?? null,
          context.memberId,
        ],
      );
      return mapEmployee(
        (await selectEmployee(
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

export async function updateEmployee(
  context: EmployeeContext,
  employeeId: string,
  input: UpdateEmployeeInput,
) {
  try {
    return await withTenantContext(context, async (client) => {
      const current = await assertEmployeeAccess(client, context, employeeId);
      if (
        input.loginEmail !== undefined &&
        input.loginEmail.toLowerCase() !==
          (current.member_email ?? "").toLowerCase()
      ) {
        if (!context.isOwner) {
          throw new ForbiddenError(
            "Only the Owner can change an employee's LiteHubs sign-in email",
            { field: "loginEmail" },
          );
        }
        if (!current.member_id || !current.member_user_id) {
          throw new BadRequestError(
            "Link a LiteHubs account before changing its sign-in email",
            { field: "loginEmail" },
          );
        }
        const changed = await client.query<{ email: string }>(
          `UPDATE users
              SET email = $1
            WHERE id = $2
            RETURNING email::text AS email`,
          [input.loginEmail.toLowerCase(), current.member_user_id],
        );
        if (!changed.rows[0]) {
          throw new NotFoundError(
            "The linked LiteHubs account no longer exists",
          );
        }
        // Existing browser sessions must not continue after a login identifier is
        // reassigned. The employee signs in again using the new address.
        await client.query(
          "UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
          [current.member_user_id],
        );
        await client.query(
          `INSERT INTO audit_log
             (organization_id, user_id, member_id, actor_email, actor_name, action, entity_table, entity_id, entity_label, changes)
           SELECT $1, $2, $3, u.email::text, u.full_name, 'update', 'users', $4, $5,
                  jsonb_build_object('field', 'login_email', 'previous', $6, 'next', $7)
             FROM users u WHERE u.id = $2`,
          [
            context.organizationId,
            context.userId,
            context.memberId,
            current.member_user_id,
            current.full_name,
            current.member_email,
            changed.rows[0].email,
          ],
        );
      }
      const memberId =
        input.memberId === undefined ? current.member_id : input.memberId;
      if (memberId) {
        await assertActiveMember(client, context.organizationId, memberId);
      }
      const positionCategory =
        input.memberId === undefined
          ? (current.position_category as PositionCategory)
          : await positionCategoryForMember(client, context, memberId);
      // An employee number is permanent. Role changes update the displayed HR
      // level, not the identifier used by attendance and historical records.
      const employeeNumber = current.employee_number;
      const location = await resolveLocation(client, context, {
        provinceId:
          input.provinceId === undefined
            ? current.province_id
            : input.provinceId,
        siteId: input.siteId === undefined ? current.site_id : input.siteId,
        departmentId:
          input.departmentId === undefined
            ? current.department_id
            : input.departmentId,
      });
      await client.query(
        [
          "UPDATE employees",
          "SET member_id = $3, employee_number = $4, full_name = $5, job_title = $6, position_category = $7, province_id = $8, site_id = $9, department_id = $10, employment_status = $11, employment_type = $12, start_date = $13, phone = $14, emergency_contact_name = $15, emergency_contact_phone = $16, notes = $17",
          "WHERE organization_id = $1 AND id = $2",
        ].join("\n"),
        [
          context.organizationId,
          employeeId,
          memberId,
          employeeNumber,
          input.fullName ?? current.full_name,
          input.jobTitle ?? current.job_title,
          positionCategory,
          location.provinceId,
          location.siteId,
          location.departmentId,
          input.employmentStatus ?? current.employment_status,
          input.employmentType ?? current.employment_type,
          input.startDate === undefined ? current.start_date : input.startDate,
          input.phone === undefined ? current.phone : input.phone,
          input.emergencyContactName === undefined
            ? current.emergency_contact_name
            : input.emergencyContactName,
          input.emergencyContactPhone === undefined
            ? current.emergency_contact_phone
            : input.emergencyContactPhone,
          input.notes === undefined ? current.notes : input.notes,
        ],
      );
      return mapEmployee(
        (await selectEmployee(client, context.organizationId, employeeId))!,
      );
    });
  } catch (error) {
    return translateConflict(error);
  }
}

export async function listEmployeeCreationAllowances(context: EmployeeContext) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<EmployeeCreationAllowanceRow>(
      `SELECT a.id, a.member_id, u.full_name AS member_name, u.email::text AS member_email,
              a.province_id, p.code AS province_code, p.name AS province_name,
              a.max_employees, a.used_employees, a.created_at, a.updated_at
         FROM employee_creation_allowances a
         JOIN organization_members m
           ON m.organization_id = a.organization_id AND m.id = a.member_id
         JOIN users u ON u.id = m.user_id
         JOIN provinces p
           ON p.organization_id = a.organization_id AND p.id = a.province_id
        WHERE a.organization_id = $1
          AND ($2::boolean OR a.member_id = $3)
        ORDER BY u.full_name, p.name`,
      [context.organizationId, context.isOwner, context.memberId],
    );
    return result.rows.map(mapEmployeeCreationAllowance);
  });
}

export async function setEmployeeCreationAllowance(
  context: EmployeeContext,
  memberId: string,
  provinceId: string,
  input: { maxEmployees: number },
) {
  await assertOwner(context);
  try {
    return await withTenantContext(context, async (client) => {
      await assertEligibleEmployeeCreator(
        client,
        context.organizationId,
        memberId,
      );
      await assertMemberProvince(
        client,
        context.organizationId,
        memberId,
        provinceId,
      );
      const result = await client.query<EmployeeCreationAllowanceRow>(
        `INSERT INTO employee_creation_allowances (
           organization_id, member_id, province_id, max_employees, granted_by_member_id
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (organization_id, member_id, province_id) DO UPDATE
           SET max_employees = EXCLUDED.max_employees,
               granted_by_member_id = EXCLUDED.granted_by_member_id
         RETURNING id, member_id,
           (SELECT u.full_name FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = employee_creation_allowances.organization_id AND m.id = employee_creation_allowances.member_id) AS member_name,
           (SELECT u.email::text FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = employee_creation_allowances.organization_id AND m.id = employee_creation_allowances.member_id) AS member_email,
           province_id,
           (SELECT code FROM provinces WHERE organization_id = employee_creation_allowances.organization_id AND id = employee_creation_allowances.province_id) AS province_code,
           (SELECT name FROM provinces WHERE organization_id = employee_creation_allowances.organization_id AND id = employee_creation_allowances.province_id) AS province_name,
           max_employees, used_employees, created_at, updated_at`,
        [
          context.organizationId,
          memberId,
          provinceId,
          input.maxEmployees,
          context.memberId,
        ],
      );
      return mapEmployeeCreationAllowance(result.rows[0]!);
    });
  } catch (error) {
    const pg = error as { code?: string; constraint?: string };
    if (
      pg.code === "23514" &&
      pg.constraint === "employee_creation_allowances_usage_check"
    ) {
      throw new BadRequestError(
        "The new limit cannot be lower than the number of employees already created",
        { field: "maxEmployees" },
      );
    }
    throw error;
  }
}

export async function deleteEmployeeCreationAllowance(
  context: EmployeeContext,
  memberId: string,
  provinceId: string,
) {
  await assertOwner(context);
  return withTenantContext(context, async (client) => {
    const result = await client.query(
      `DELETE FROM employee_creation_allowances
        WHERE organization_id = $1 AND member_id = $2 AND province_id = $3`,
      [context.organizationId, memberId, provinceId],
    );
    if (result.rowCount === 0)
      throw new NotFoundError("Employee creation limit not found");
  });
}
export async function deleteEmployee(
  context: EmployeeContext,
  employeeId: string,
) {
  return withTenantContext(context, async (client) => {
    await assertEmployeeAccess(client, context, employeeId);
    const result = await client.query(
      "DELETE FROM employees WHERE organization_id = $1 AND id = $2",
      [context.organizationId, employeeId],
    );
    if (result.rowCount === 0) throw new NotFoundError("Employee not found");
  });
}
type PositionCategory = "manager" | "supervisor" | "officer" | "employee";

const positionCategoryBases: Record<PositionCategory, number> = {
  employee: 10_000,
  supervisor: 20_000,
  officer: 30_000,
  manager: 40_000,
};

async function positionCategoryForMember(
  client: PoolClient,
  context: EmployeeContext,
  memberId: string | null,
): Promise<PositionCategory> {
  if (!memberId) return "employee";

  const result = await client.query<{ code: string }>(
    `SELECT r.code
       FROM member_roles mr
       JOIN roles r
         ON r.organization_id = mr.organization_id AND r.id = mr.role_id
      WHERE mr.organization_id = $1 AND mr.member_id = $2`,
    [context.organizationId, memberId],
  );
  const roleCodes = result.rows.map((row) => row.code);
  if (
    roleCodes.some((code) =>
      [
        "owner",
        "general_manager",
        "provincial_manager",
        "site_manager",
        "farm_operations_manager",
        "farm_manager",
        "project_manager",
      ].includes(code),
    )
  )
    return "manager";
  if (
    roleCodes.some((code) =>
      [
        "supervisor",
        "poultry_supervisor",
        "pig_supervisor",
        "agriculture_supervisor",
        "veterinarian",
        "agronomist",
      ].includes(code),
    )
  )
    return "supervisor";
  if (
    roleCodes.some((code) =>
      ["hr_officer", "accountant", "storekeeper", "security_officer"].includes(
        code,
      ),
    )
  )
    return "officer";
  return "employee";
}

async function nextEmployeeNumber(
  client: PoolClient,
  context: EmployeeContext,
  category: PositionCategory,
): Promise<string> {
  const result = await client.query<{ last_number: number }>(
    `INSERT INTO organization_employee_category_counters AS counter
       (organization_id, position_category, last_number)
     VALUES ($1, $2, 1)
     ON CONFLICT (organization_id, position_category) DO UPDATE
       SET last_number = counter.last_number + 1
     RETURNING last_number`,
    [context.organizationId, category],
  );
  const number = result.rows[0]!.last_number;
  return String(positionCategoryBases[category] + number);
}
