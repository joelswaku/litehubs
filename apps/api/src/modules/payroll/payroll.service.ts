import PDFDocument from "pdfkit";
import type { PoolClient } from "pg";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type {
  CreateCompensationInput,
  CreateComponentInput,
  CreateEmployeeComponentInput,
  CreateRunExclusionInput,
  CreateRunInput,
  MarkPaidInput,
  RunQuery,
  UpdateCompensationInput,
  UpdateComponentInput,
  UpdateEmployeeComponentInput,
  UpdateRunInput,
} from "./payroll.validation";

export interface PayrollContext {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
  permissions: string[];
}
type Scope = "organization" | "province" | "self";
type RunStatus = "draft" | "calculated" | "approved" | "paid" | "cancelled";
type ComponentType = "earning" | "deduction" | "employer_cost";
type Calculation =
  | "fixed"
  | "percentage_of_basic"
  | "percentage_of_gross"
  | "per_day"
  | "per_hour"
  | "formula";
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
  department_id: string | null;
  department_name: string | null;
  employment_status: string;
}
interface ComponentRow {
  id: string;
  code: string;
  name: string;
  component_type: ComponentType;
  calculation: Calculation;
  percentage: string | null;
  default_amount: string | null;
  is_taxable: boolean;
  affects_gross: boolean;
  ledger_account_id: string | null;
  sort_order: number;
  is_active: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}
interface CompensationRow {
  id: string;
  employee_id: string;
  effective_from: string;
  effective_to: string | null;
  currency: string;
  basic_salary: string;
  pay_frequency: string;
  contract_hours_per_week: string | null;
  overtime_multiplier: string | null;
  payment_method: string;
  bank_name: string | null;
  bank_account: string | null;
  mobile_money_number: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  employee_number: string;
  employee_name: string;
  employee_job_title: string;
  employee_member_id: string | null;
  province_id: string | null;
  province_name: string | null;
  site_id: string | null;
  site_name: string | null;
}
interface EmployeeComponentRow {
  id: string;
  employee_id: string;
  component_id: string;
  amount: string | null;
  percentage: string | null;
  effective_from: string;
  effective_to: string | null;
  total_to_recover: string | null;
  recovered_to_date: string;
  is_active: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  employee_number: string;
  employee_name: string;
  employee_job_title: string;
  employee_member_id: string | null;
  province_id: string | null;
  province_name: string | null;
  component_code: string;
  component_name: string;
  component_type: ComponentType;
  calculation: Calculation;
  default_amount: string | null;
  default_percentage: string | null;
  sort_order: number;
}
interface RunRow {
  id: string;
  reference: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  currency: string;
  status: RunStatus;
  province_id: string | null;
  province_name: string | null;
  employee_count: number;
  gross_total: string;
  deduction_total: string;
  net_total: string;
  employer_cost_total: string;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: Date | null;
  paid_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
interface PayslipRow {
  id: string;
  reference: string;
  run_id: string;
  employee_id: string;
  employee_number: string;
  employee_name: string;
  job_title: string | null;
  province_id: string | null;
  province_name: string | null;
  site_id: string | null;
  site_name: string | null;
  department_id: string | null;
  department_name: string | null;
  currency: string;
  basic_salary: string;
  days_worked: string | null;
  days_absent: string | null;
  overtime_hours: string | null;
  leave_days_unpaid: string | null;
  gross_pay: string;
  total_deductions: string;
  net_pay: string;
  employer_cost: string;
  payment_method: string | null;
  payment_reference: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}
interface RunExclusionRow {
  id: string;
  run_id: string;
  employee_id: string;
  employee_number: string;
  employee_name: string;
  employee_job_title: string | null;
  reason: string | null;
  created_at: Date;
}
interface PayslipLineRow {
  id: string;
  payslip_id: string;
  component_id: string | null;
  component_code: string;
  component_name: string;
  component_type: ComponentType;
  amount: string;
  basis: string | null;
  sort_order: number;
}

const employeeFields = `e.id,e.member_id,e.employee_number,e.full_name,e.job_title,e.province_id,p.name AS province_name,e.site_id,s.name AS site_name,e.department_id,d.name AS department_name,e.employment_status`;
const compensationFields = `c.id,c.employee_id,c.effective_from::text,c.effective_to::text,c.currency,c.basic_salary::text,c.pay_frequency,c.contract_hours_per_week::text,c.overtime_multiplier::text,c.payment_method,c.bank_name,c.bank_account,c.mobile_money_number,c.notes,c.created_at,c.updated_at,e.employee_number,e.full_name AS employee_name,e.job_title AS employee_job_title,e.member_id AS employee_member_id,e.province_id,p.name AS province_name,e.site_id,s.name AS site_name`;
const componentFields = `id,code,name,component_type,calculation,percentage::text,default_amount::text,is_taxable,affects_gross,ledger_account_id,sort_order,is_active,notes,created_at,updated_at`;
const employeeComponentFields = `ec.id,ec.employee_id,ec.component_id,ec.amount::text,ec.percentage::text,ec.effective_from::text,ec.effective_to::text,ec.total_to_recover::text,ec.recovered_to_date::text,ec.is_active,ec.notes,ec.created_at,ec.updated_at,e.employee_number,e.full_name AS employee_name,e.job_title AS employee_job_title,e.member_id AS employee_member_id,e.province_id,p.name AS province_name,pc.code AS component_code,pc.name AS component_name,pc.component_type,pc.calculation,pc.default_amount::text AS default_amount,pc.percentage::text AS default_percentage,pc.sort_order`;
const runFields = `r.id,r.reference,r.period_start::text,r.period_end::text,r.pay_date::text,r.currency,r.status,r.province_id,p.name AS province_name,r.employee_count,r.gross_total::text,r.deduction_total::text,r.net_total::text,r.employer_cost_total::text,r.notes,r.created_by,creator.full_name AS created_by_name,r.approved_by,approver.full_name AS approved_by_name,r.approved_at,r.paid_at,r.created_at,r.updated_at`;
const payslipFields = `p.id,p.reference,p.run_id,p.employee_id,p.employee_number,p.employee_name,p.job_title,p.province_id,pr.name AS province_name,p.site_id,s.name AS site_name,p.department_id,d.name AS department_name,p.currency,p.basic_salary::text,p.days_worked::text,p.days_absent::text,p.overtime_hours::text,p.leave_days_unpaid::text,p.gross_pay::text,p.total_deductions::text,p.net_pay::text,p.employer_cost::text,p.payment_method,p.payment_reference,p.notes,p.created_at,p.updated_at`;
const n = (value: string | null | undefined) =>
  value == null ? null : Number(value);
const optionalDate = (v: string | null | undefined) => v ?? null;

function mapRunExclusion(row: RunExclusionRow) {
  return {
    id: row.id,
    employee: {
      id: row.employee_id,
      employeeNumber: row.employee_number,
      fullName: row.employee_name,
      jobTitle: row.employee_job_title ?? "",
    },
    reason: row.reason,
    createdAt: row.created_at,
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
    department: row.department_id
      ? { id: row.department_id, name: row.department_name }
      : null,
  };
}
function mapComponent(row: ComponentRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    componentType: row.component_type,
    calculation: row.calculation,
    percentage: n(row.percentage),
    defaultAmount: n(row.default_amount),
    isTaxable: row.is_taxable,
    affectsGross: row.affects_gross,
    ledgerAccountId: row.ledger_account_id,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function mapCompensation(row: CompensationRow) {
  return {
    id: row.id,
    employee: {
      id: row.employee_id,
      employeeNumber: row.employee_number,
      fullName: row.employee_name,
      jobTitle: row.employee_job_title,
    },
    effectiveFrom: row.effective_from,
    effectiveTo: optionalDate(row.effective_to),
    currency: row.currency,
    basicSalary: Number(row.basic_salary),
    payFrequency: row.pay_frequency,
    contractHoursPerWeek: n(row.contract_hours_per_week),
    overtimeMultiplier: n(row.overtime_multiplier),
    paymentMethod: row.payment_method,
    bankName: row.bank_name,
    bankAccount: row.bank_account,
    mobileMoneyNumber: row.mobile_money_number,
    notes: row.notes,
    province: row.province_id
      ? { id: row.province_id, name: row.province_name }
      : null,
    site: row.site_id ? { id: row.site_id, name: row.site_name } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function mapEmployeeComponent(row: EmployeeComponentRow) {
  return {
    id: row.id,
    employee: {
      id: row.employee_id,
      employeeNumber: row.employee_number,
      fullName: row.employee_name,
      jobTitle: row.employee_job_title,
    },
    component: {
      id: row.component_id,
      code: row.component_code,
      name: row.component_name,
      componentType: row.component_type,
      calculation: row.calculation,
      defaultAmount: n(row.default_amount),
      percentage: n(row.default_percentage),
      sortOrder: row.sort_order,
    },
    amount: n(row.amount),
    percentage: n(row.percentage),
    effectiveFrom: row.effective_from,
    effectiveTo: optionalDate(row.effective_to),
    totalToRecover: n(row.total_to_recover),
    recoveredToDate: Number(row.recovered_to_date),
    isActive: row.is_active,
    notes: row.notes,
    province: row.province_id
      ? { id: row.province_id, name: row.province_name }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function mapRun(row: RunRow) {
  return {
    id: row.id,
    reference: row.reference,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    payDate: row.pay_date,
    currency: row.currency,
    status: row.status,
    province: row.province_id
      ? { id: row.province_id, name: row.province_name }
      : null,
    employeeCount: row.employee_count,
    grossTotal: Number(row.gross_total),
    deductionTotal: Number(row.deduction_total),
    netTotal: Number(row.net_total),
    employerCostTotal: Number(row.employer_cost_total),
    notes: row.notes,
    createdBy: row.created_by
      ? { id: row.created_by, fullName: row.created_by_name }
      : null,
    approvedBy: row.approved_by
      ? { id: row.approved_by, fullName: row.approved_by_name }
      : null,
    approvedAt: row.approved_at,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function mapPayslip(row: PayslipRow, lines: PayslipLineRow[]) {
  return {
    id: row.id,
    reference: row.reference,
    runId: row.run_id,
    employee: {
      id: row.employee_id,
      employeeNumber: row.employee_number,
      fullName: row.employee_name,
      jobTitle: row.job_title,
    },
    province: row.province_id
      ? { id: row.province_id, name: row.province_name }
      : null,
    site: row.site_id ? { id: row.site_id, name: row.site_name } : null,
    department: row.department_id
      ? { id: row.department_id, name: row.department_name }
      : null,
    currency: row.currency,
    basicSalary: Number(row.basic_salary),
    daysWorked: n(row.days_worked),
    daysAbsent: n(row.days_absent),
    overtimeHours: n(row.overtime_hours),
    leaveDaysUnpaid: n(row.leave_days_unpaid),
    grossPay: Number(row.gross_pay),
    totalDeductions: Number(row.total_deductions),
    netPay: Number(row.net_pay),
    employerCost: Number(row.employer_cost),
    paymentMethod: row.payment_method,
    paymentReference: row.payment_reference,
    notes: row.notes,
    lines: lines.map((l) => ({
      id: l.id,
      componentId: l.component_id,
      code: l.component_code,
      name: l.component_name,
      type: l.component_type,
      amount: Number(l.amount),
      basis: l.basis,
      sortOrder: l.sort_order,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function scopeOf(
  client: PoolClient,
  context: PayrollContext,
): Promise<Scope> {
  if (context.isOwner) return "organization";
  const r = await client.query<{ organization: boolean; province: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM member_roles mr JOIN roles ro ON ro.organization_id=mr.organization_id AND ro.id=mr.role_id WHERE mr.organization_id=$1 AND mr.member_id=$2 AND ro.data_scope='organization') AS organization, EXISTS(SELECT 1 FROM member_roles mr JOIN roles ro ON ro.organization_id=mr.organization_id AND ro.id=mr.role_id WHERE mr.organization_id=$1 AND mr.member_id=$2 AND ro.data_scope='province') AS province`,
    [context.organizationId, context.memberId],
  );
  return r.rows[0]?.organization
    ? "organization"
    : r.rows[0]?.province
      ? "province"
      : "self";
}
async function assertProvince(
  client: PoolClient,
  context: PayrollContext,
  provinceId: string | null,
  message = "Payroll record not found",
) {
  const scope = await scopeOf(client, context);
  if (scope === "organization") return;
  if (!provinceId || scope === "self") throw new NotFoundError(message);
  const r = await client.query(
    `SELECT 1 FROM member_provinces WHERE organization_id=$1 AND member_id=$2 AND province_id=$3`,
    [context.organizationId, context.memberId, provinceId],
  );
  if (!r.rowCount) throw new NotFoundError(message);
}
async function employeeFor(
  client: PoolClient,
  context: PayrollContext,
  id: string,
) {
  const r = await client.query<EmployeeRow>(
    `SELECT ${employeeFields} FROM employees e LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=e.organization_id AND s.id=e.site_id LEFT JOIN departments d ON d.organization_id=e.organization_id AND d.id=e.department_id WHERE e.organization_id=$1 AND e.id=$2`,
    [context.organizationId, id],
  );
  const employee = r.rows[0];
  if (!employee) throw new NotFoundError("Employee not found");
  await assertProvince(
    client,
    context,
    employee.province_id,
    "Employee not found",
  );
  return employee;
}
async function componentFor(client: PoolClient, org: string, id: string) {
  const r = await client.query<ComponentRow>(
    `SELECT ${componentFields} FROM payroll_components WHERE organization_id=$1 AND id=$2`,
    [org, id],
  );
  if (!r.rows[0]) throw new NotFoundError("Payroll component not found");
  return r.rows[0];
}
async function runFor(client: PoolClient, context: PayrollContext, id: string) {
  const r = await client.query<RunRow>(
    `SELECT ${runFields} FROM payroll_runs r LEFT JOIN provinces p ON p.organization_id=r.organization_id AND p.id=r.province_id LEFT JOIN users creator ON creator.id=r.created_by LEFT JOIN users approver ON approver.id=r.approved_by WHERE r.organization_id=$1 AND r.id=$2`,
    [context.organizationId, id],
  );
  const run = r.rows[0];
  if (!run) throw new NotFoundError("Payroll run not found");
  await assertProvince(
    client,
    context,
    run.province_id,
    "Payroll run not found",
  );
  return run;
}
async function compensationFor(
  client: PoolClient,
  context: PayrollContext,
  id: string,
) {
  const r = await client.query<CompensationRow>(
    `SELECT ${compensationFields} FROM employee_compensation c JOIN employees e ON e.organization_id=c.organization_id AND e.id=c.employee_id LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=e.organization_id AND s.id=e.site_id WHERE c.organization_id=$1 AND c.id=$2`,
    [context.organizationId, id],
  );
  const item = r.rows[0];
  if (!item) throw new NotFoundError("Compensation record not found");
  await assertProvince(
    client,
    context,
    item.province_id,
    "Compensation record not found",
  );
  return item;
}
async function employeeComponentFor(
  client: PoolClient,
  context: PayrollContext,
  id: string,
) {
  const r = await client.query<EmployeeComponentRow>(
    `SELECT ${employeeComponentFields} FROM employee_payroll_components ec JOIN employees e ON e.organization_id=ec.organization_id AND e.id=ec.employee_id JOIN payroll_components pc ON pc.organization_id=ec.organization_id AND pc.id=ec.component_id LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id WHERE ec.organization_id=$1 AND ec.id=$2`,
    [context.organizationId, id],
  );
  const item = r.rows[0];
  if (!item) throw new NotFoundError("Employee payroll component not found");
  await assertProvince(
    client,
    context,
    item.province_id,
    "Employee payroll component not found",
  );
  return item;
}

export async function listComponents(context: PayrollContext) {
  return withTenantContext(context, async (c) =>
    (
      await c.query<ComponentRow>(
        `SELECT ${componentFields} FROM payroll_components WHERE organization_id=$1 ORDER BY is_active DESC,sort_order,name`,
        [context.organizationId],
      )
    ).rows.map(mapComponent),
  );
}
export async function createComponent(
  context: PayrollContext,
  input: CreateComponentInput,
) {
  return withTenantContext(context, async (c) => {
    const r = await c.query<ComponentRow>(
      `INSERT INTO payroll_components (organization_id,code,name,component_type,calculation,percentage,default_amount,is_taxable,affects_gross,ledger_account_id,sort_order,is_active,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${componentFields}`,
      [
        context.organizationId,
        input.code,
        input.name,
        input.componentType,
        input.calculation,
        input.percentage ?? null,
        input.defaultAmount ?? null,
        input.isTaxable,
        input.affectsGross,
        input.ledgerAccountId ?? null,
        input.sortOrder,
        input.isActive,
        input.notes ?? null,
      ],
    );
    return mapComponent(r.rows[0]!);
  });
}
export async function updateComponent(
  context: PayrollContext,
  id: string,
  input: UpdateComponentInput,
) {
  return withTenantContext(context, async (c) => {
    const old = await componentFor(c, context.organizationId, id);
    const next = { ...mapComponent(old), ...input };
    if (
      ["percentage_of_basic", "percentage_of_gross"].includes(
        next.calculation,
      ) &&
      next.percentage == null
    )
      throw new BadRequestError(
        "A percentage is required for this calculation",
        { field: "percentage" },
      );
    const r = await c.query<ComponentRow>(
      `UPDATE payroll_components SET code=$3,name=$4,component_type=$5,calculation=$6,percentage=$7,default_amount=$8,is_taxable=$9,affects_gross=$10,ledger_account_id=$11,sort_order=$12,is_active=$13,notes=$14 WHERE organization_id=$1 AND id=$2 RETURNING ${componentFields}`,
      [
        context.organizationId,
        id,
        next.code,
        next.name,
        next.componentType,
        next.calculation,
        next.percentage,
        next.defaultAmount,
        next.isTaxable,
        next.affectsGross,
        next.ledgerAccountId,
        next.sortOrder,
        next.isActive,
        next.notes,
      ],
    );
    return mapComponent(r.rows[0]!);
  });
}

export async function listCompensations(context: PayrollContext) {
  return withTenantContext(context, async (c) => {
    const scope = await scopeOf(c, context);
    const params: unknown[] = [context.organizationId];
    let where = "c.organization_id=$1";
    if (scope === "province") {
      params.push(context.memberId);
      where += ` AND e.province_id IN (SELECT province_id FROM member_provinces WHERE organization_id=$1 AND member_id=$${params.length})`;
    } else if (scope === "self") {
      params.push(context.memberId);
      where += ` AND e.member_id=$${params.length}`;
    }
    const r = await c.query<CompensationRow>(
      `SELECT ${compensationFields} FROM employee_compensation c JOIN employees e ON e.organization_id=c.organization_id AND e.id=c.employee_id LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=e.organization_id AND s.id=e.site_id WHERE ${where} ORDER BY c.effective_from DESC,e.full_name`,
      params,
    );
    return r.rows.map(mapCompensation);
  });
}
async function assertNoCompensationOverlap(
  c: PoolClient,
  org: string,
  employeeId: string,
  start: string,
  end: string | null,
  ignoreId?: string,
) {
  const r = await c.query(
    `SELECT id FROM employee_compensation WHERE organization_id=$1 AND employee_id=$2 AND ($5::uuid IS NULL OR id<>$5) AND daterange(effective_from,effective_to,'[]') && daterange($3::date,$4::date,'[]') LIMIT 1`,
    [org, employeeId, start, end, ignoreId ?? null],
  );
  if (r.rowCount)
    throw new ConflictError(
      "This employee already has compensation covering these dates",
      { field: "effectiveFrom" },
    );
}
export async function createCompensation(
  context: PayrollContext,
  input: CreateCompensationInput,
) {
  return withTenantContext(context, async (c) => {
    await employeeFor(c, context, input.employeeId);
    await assertNoCompensationOverlap(
      c,
      context.organizationId,
      input.employeeId,
      input.effectiveFrom,
      input.effectiveTo ?? null,
    );
    const r = await c.query<{ id: string }>(
      `INSERT INTO employee_compensation (organization_id,employee_id,effective_from,effective_to,currency,basic_salary,pay_frequency,contract_hours_per_week,overtime_multiplier,payment_method,bank_name,bank_account,mobile_money_number,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [
        context.organizationId,
        input.employeeId,
        input.effectiveFrom,
        input.effectiveTo ?? null,
        input.currency,
        input.basicSalary,
        input.payFrequency,
        input.contractHoursPerWeek ?? null,
        input.overtimeMultiplier ?? null,
        input.paymentMethod,
        input.bankName ?? null,
        input.bankAccount ?? null,
        input.mobileMoneyNumber ?? null,
        input.notes ?? null,
        context.userId,
      ],
    );
    return mapCompensation(await compensationFor(c, context, r.rows[0]!.id));
  });
}
export async function updateCompensation(
  context: PayrollContext,
  id: string,
  input: UpdateCompensationInput,
) {
  return withTenantContext(context, async (c) => {
    const old = await compensationFor(c, context, id);
    const effectiveFrom = input.effectiveFrom ?? old.effective_from,
      effectiveTo =
        input.effectiveTo === undefined ? old.effective_to : input.effectiveTo;
    if (effectiveTo && effectiveTo < effectiveFrom)
      throw new BadRequestError("End date must be on or after the start date", {
        field: "effectiveTo",
      });
    await assertNoCompensationOverlap(
      c,
      context.organizationId,
      old.employee_id,
      effectiveFrom,
      effectiveTo,
      id,
    );
    const r = await c.query<{ id: string }>(
      `UPDATE employee_compensation SET effective_from=$3,effective_to=$4,currency=$5,basic_salary=$6,pay_frequency=$7,contract_hours_per_week=$8,overtime_multiplier=$9,payment_method=$10,bank_name=$11,bank_account=$12,mobile_money_number=$13,notes=$14 WHERE organization_id=$1 AND id=$2 RETURNING id`,
      [
        context.organizationId,
        id,
        effectiveFrom,
        effectiveTo,
        input.currency ?? old.currency,
        input.basicSalary ?? Number(old.basic_salary),
        input.payFrequency ?? old.pay_frequency,
        input.contractHoursPerWeek === undefined
          ? n(old.contract_hours_per_week)
          : input.contractHoursPerWeek,
        input.overtimeMultiplier === undefined
          ? n(old.overtime_multiplier)
          : input.overtimeMultiplier,
        input.paymentMethod ?? old.payment_method,
        input.bankName === undefined ? old.bank_name : input.bankName,
        input.bankAccount === undefined ? old.bank_account : input.bankAccount,
        input.mobileMoneyNumber === undefined
          ? old.mobile_money_number
          : input.mobileMoneyNumber,
        input.notes === undefined ? old.notes : input.notes,
      ],
    );
    return mapCompensation(await compensationFor(c, context, r.rows[0]!.id));
  });
}

export async function listEmployeeComponents(context: PayrollContext) {
  return withTenantContext(context, async (c) => {
    const scope = await scopeOf(c, context);
    const params: unknown[] = [context.organizationId];
    let where = "ec.organization_id=$1";
    if (scope === "province") {
      params.push(context.memberId);
      where += ` AND e.province_id IN (SELECT province_id FROM member_provinces WHERE organization_id=$1 AND member_id=$${params.length})`;
    } else if (scope === "self") {
      params.push(context.memberId);
      where += ` AND e.member_id=$${params.length}`;
    }
    const r = await c.query<EmployeeComponentRow>(
      `SELECT ${employeeComponentFields} FROM employee_payroll_components ec JOIN employees e ON e.organization_id=ec.organization_id AND e.id=ec.employee_id JOIN payroll_components pc ON pc.organization_id=ec.organization_id AND pc.id=ec.component_id LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id WHERE ${where} ORDER BY ec.is_active DESC,e.full_name,pc.sort_order,pc.name`,
      params,
    );
    return r.rows.map(mapEmployeeComponent);
  });
}
export async function createEmployeeComponent(
  context: PayrollContext,
  input: CreateEmployeeComponentInput,
) {
  return withTenantContext(context, async (c) => {
    await employeeFor(c, context, input.employeeId);
    await componentFor(c, context.organizationId, input.componentId);
    const r = await c.query<EmployeeComponentRow>(
      `WITH made AS (INSERT INTO employee_payroll_components (organization_id,employee_id,component_id,amount,percentage,effective_from,effective_to,total_to_recover,recovered_to_date,is_active,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *) SELECT ${employeeComponentFields} FROM made ec JOIN employees e ON e.organization_id=ec.organization_id AND e.id=ec.employee_id JOIN payroll_components pc ON pc.organization_id=ec.organization_id AND pc.id=ec.component_id LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id`,
      [
        context.organizationId,
        input.employeeId,
        input.componentId,
        input.amount ?? null,
        input.percentage ?? null,
        input.effectiveFrom,
        input.effectiveTo ?? null,
        input.totalToRecover ?? null,
        input.recoveredToDate,
        input.isActive,
        input.notes ?? null,
      ],
    );
    return mapEmployeeComponent(r.rows[0]!);
  });
}
export async function updateEmployeeComponent(
  context: PayrollContext,
  id: string,
  input: UpdateEmployeeComponentInput,
) {
  return withTenantContext(context, async (c) => {
    const old = await employeeComponentFor(c, context, id);
    const effectiveFrom = input.effectiveFrom ?? old.effective_from,
      effectiveTo =
        input.effectiveTo === undefined ? old.effective_to : input.effectiveTo;
    if (effectiveTo && effectiveTo < effectiveFrom)
      throw new BadRequestError("End date must be on or after the start date", {
        field: "effectiveTo",
      });
    const r = await c.query<EmployeeComponentRow>(
      `WITH made AS (UPDATE employee_payroll_components SET amount=$3,percentage=$4,effective_from=$5,effective_to=$6,total_to_recover=$7,recovered_to_date=$8,is_active=$9,notes=$10 WHERE organization_id=$1 AND id=$2 RETURNING *) SELECT ${employeeComponentFields} FROM made ec JOIN employees e ON e.organization_id=ec.organization_id AND e.id=ec.employee_id JOIN payroll_components pc ON pc.organization_id=ec.organization_id AND pc.id=ec.component_id LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id`,
      [
        context.organizationId,
        id,
        input.amount === undefined ? old.amount : input.amount,
        input.percentage === undefined ? old.percentage : input.percentage,
        effectiveFrom,
        effectiveTo,
        input.totalToRecover === undefined
          ? n(old.total_to_recover)
          : input.totalToRecover,
        input.recoveredToDate ?? Number(old.recovered_to_date),
        input.isActive ?? old.is_active,
        input.notes === undefined ? old.notes : input.notes,
      ],
    );
    return mapEmployeeComponent(r.rows[0]!);
  });
}

export async function listRuns(context: PayrollContext, query: RunQuery) {
  return withTenantContext(context, async (c) => {
    const scope = await scopeOf(c, context);
    const params: unknown[] = [context.organizationId];
    let where = "r.organization_id=$1";
    if (query.status) {
      params.push(query.status);
      where += ` AND r.status=$${params.length}`;
    }
    if (query.provinceId) {
      params.push(query.provinceId);
      where += ` AND r.province_id=$${params.length}`;
    }
    if (scope === "province") {
      params.push(context.memberId);
      where += ` AND r.province_id IN (SELECT province_id FROM member_provinces WHERE organization_id=$1 AND member_id=$${params.length})`;
    } else if (scope === "self") where += " AND false";
    const r = await c.query<RunRow>(
      `SELECT ${runFields} FROM payroll_runs r LEFT JOIN provinces p ON p.organization_id=r.organization_id AND p.id=r.province_id LEFT JOIN users creator ON creator.id=r.created_by LEFT JOIN users approver ON approver.id=r.approved_by WHERE ${where} ORDER BY r.period_end DESC,r.created_at DESC`,
      params,
    );
    return r.rows.map(mapRun);
  });
}

async function nextPayrollRunReference(
  c: PoolClient,
  organizationId: string,
  periodStart: string,
) {
  const month = periodStart.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month))
    throw new BadRequestError("A valid payroll period start date is required", {
      field: "periodStart",
    });

  const prefix = `PAIE${month.replace("-", "")}`;
  // Serialize reference generation within one organization and month. This
  // prevents two concurrent requests from receiving the same next number.
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `payroll-run-reference:${organizationId}:${month}`,
  ]);
  const sequence = await c.query<{ next_number: string }>(
    `SELECT (COALESCE(MAX(NULLIF(SUBSTRING(reference FROM '([0-9]{3})$'), '')::integer), 0) + 1)::text AS next_number
       FROM payroll_runs
      WHERE organization_id=$1 AND reference LIKE $2`,
    [organizationId, `${prefix}%`],
  );
  const next = Number(sequence.rows[0]?.next_number ?? 1);
  return `${prefix}${String(next).padStart(3, "0")}`;
}

export async function createRun(
  context: PayrollContext,
  input: CreateRunInput,
) {
  return withTenantContext(context, async (c) => {
    await assertProvince(
      c,
      context,
      input.provinceId ?? null,
      "Province not available",
    );
    const reference = await nextPayrollRunReference(
      c,
      context.organizationId,
      input.periodStart,
    );
    const r = await c.query<{ id: string }>(
      `INSERT INTO payroll_runs (organization_id,reference,period_start,period_end,pay_date,currency,province_id,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        context.organizationId,

        reference,

        input.periodStart,
        input.periodEnd,
        input.payDate,
        input.currency,
        input.provinceId ?? null,
        input.notes ?? null,
        context.userId,
      ],
    );
    return mapRun(await runFor(c, context, r.rows[0]!.id));
  });
}
export async function updateRun(
  context: PayrollContext,
  id: string,
  input: UpdateRunInput,
) {
  return withTenantContext(context, async (c) => {
    const old = await runFor(c, context, id);
    if (!["draft", "calculated"].includes(old.status))
      throw new ConflictError(
        "Approved, paid or cancelled payroll cannot be changed",
      );
    if (input.provinceId !== undefined)
      await assertProvince(
        c,
        context,
        input.provinceId,
        "Province not available",
      );
    const periodStart = input.periodStart ?? old.period_start;
    const periodEnd = input.periodEnd ?? old.period_end;
    const payDate = input.payDate ?? old.pay_date;
    if (periodEnd < periodStart)
      throw new BadRequestError("Period end must be on or after period start", {
        field: "periodEnd",
      });
    if (payDate < periodStart)
      throw new BadRequestError("Pay date must be on or after period start", {
        field: "payDate",
      });
    const provinceId =
      input.provinceId === undefined ? old.province_id : input.provinceId;
    const currency = input.currency ?? old.currency;
    const calculationChanged =
      periodStart !== old.period_start ||
      periodEnd !== old.period_end ||
      currency !== old.currency ||
      provinceId !== old.province_id;
    if (calculationChanged && old.status === "calculated")
      await c.query(
        `DELETE FROM payslips WHERE organization_id=$1 AND run_id=$2`,
        [context.organizationId, id],
      );
    const nextStatus =
      input.status ?? (calculationChanged ? "draft" : old.status);
    const r = await c.query<{ id: string }>(
      `UPDATE payroll_runs
          SET reference=$3,
              period_start=$4,
              period_end=$5,
              pay_date=$6,
              currency=$7,
              province_id=$8,
              notes=$9,
              status=$10,
              employee_count=CASE WHEN $11 THEN 0 ELSE employee_count END,
              gross_total=CASE WHEN $11 THEN 0 ELSE gross_total END,
              deduction_total=CASE WHEN $11 THEN 0 ELSE deduction_total END,
              net_total=CASE WHEN $11 THEN 0 ELSE net_total END,
              employer_cost_total=CASE WHEN $11 THEN 0 ELSE employer_cost_total END
        WHERE organization_id=$1 AND id=$2
        RETURNING id`,
      [
        context.organizationId,
        id,
        input.reference ?? old.reference,
        periodStart,
        periodEnd,
        payDate,
        currency,
        provinceId,
        input.notes === undefined ? old.notes : input.notes,
        nextStatus,
        calculationChanged,
      ],
    );
    return mapRun(await runFor(c, context, r.rows[0]!.id));
  });
}
function assertRunCanBeChanged(run: RunRow) {
  if (!["draft", "calculated"].includes(run.status))
    throw new ConflictError(
      "Approved, paid or cancelled payroll cannot be changed",
    );
}

export async function listRunExclusions(
  context: PayrollContext,
  runId: string,
) {
  return withTenantContext(context, async (c) => {
    await runFor(c, context, runId);
    const rows = await c.query<RunExclusionRow>(
      `SELECT x.id,x.run_id,x.employee_id,x.reason,x.created_at,
              e.employee_number,e.full_name AS employee_name,e.job_title AS employee_job_title
         FROM payroll_run_exclusions x
         JOIN employees e
           ON e.organization_id=x.organization_id AND e.id=x.employee_id
        WHERE x.organization_id=$1 AND x.run_id=$2
        ORDER BY e.full_name`,
      [context.organizationId, runId],
    );
    return rows.rows.map(mapRunExclusion);
  });
}

export async function excludeEmployeeFromRun(
  context: PayrollContext,
  runId: string,
  input: CreateRunExclusionInput,
) {
  return withTenantContext(context, async (c) => {
    const run = await runFor(c, context, runId);
    assertRunCanBeChanged(run);
    const employee = await employeeFor(c, context, input.employeeId);
    if (run.province_id && employee.province_id !== run.province_id)
      throw new BadRequestError(
        "Employee is outside this payroll run province",
        {
          field: "employeeId",
        },
      );
    await c.query(
      `INSERT INTO payroll_run_exclusions (organization_id,run_id,employee_id,reason,created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (organization_id,run_id,employee_id)
       DO UPDATE SET reason=EXCLUDED.reason,created_by=EXCLUDED.created_by,created_at=now()`,
      [
        context.organizationId,
        runId,
        input.employeeId,
        input.reason ?? null,
        context.userId,
      ],
    );
    return mapRun(await runFor(c, context, runId));
  });
}

export async function includeEmployeeInRun(
  context: PayrollContext,
  runId: string,
  employeeId: string,
) {
  return withTenantContext(context, async (c) => {
    const run = await runFor(c, context, runId);
    assertRunCanBeChanged(run);
    await c.query(
      `DELETE FROM payroll_run_exclusions
        WHERE organization_id=$1 AND run_id=$2 AND employee_id=$3`,
      [context.organizationId, runId, employeeId],
    );
    return mapRun(await runFor(c, context, runId));
  });
}
function isIncomeTaxComponent(code: string) {
  return /(income_?tax|taxe?|impot|withholding)/i.test(code);
}

function componentAmount(
  component: EmployeeComponentRow,
  basic: number,
  gross: number,
) {
  const pct = Number(component.percentage ?? component.default_percentage ?? 0);
  const fixed = Number(component.amount ?? component.default_amount ?? 0);
  let amount =
    component.calculation === "percentage_of_basic"
      ? (basic * pct) / 100
      : component.calculation === "percentage_of_gross"
        ? (gross * pct) / 100
        : fixed;
  // A recovery ceiling belongs only to a deduction such as an employee
  // advance. Older clients could send `0` for an omitted recovery total on
  // an earning. Applying that ceiling to an allowance silently reduced it to
  // zero, even though the configured amount was valid.
  if (
    component.component_type === "deduction" &&
    component.total_to_recover != null
  )
    amount = Math.min(
      amount,
      Math.max(
        0,
        Number(component.total_to_recover) -
          Number(component.recovered_to_date),
      ),
    );
  return Math.max(0, Math.round((amount + Number.EPSILON) * 100) / 100);
}
export async function calculateRun(context: PayrollContext, id: string) {
  return withTenantContext(context, async (c) => {
    const run = await runFor(c, context, id);
    if (!["draft", "calculated"].includes(run.status))
      throw new ConflictError(
        "Only a draft or calculated payroll can be recalculated",
      );
    await c.query(
      `DELETE FROM payslips WHERE organization_id=$1 AND run_id=$2`,
      [context.organizationId, id],
    );
    const params: unknown[] = [
      context.organizationId,
      run.period_end,
      run.period_start,
      id,
    ];
    let where = `e.organization_id=$1 AND e.employment_status IN ('active','probation','on_leave') AND c.effective_from <= $2::date AND (c.effective_to IS NULL OR c.effective_to >= $3::date) AND NOT EXISTS (SELECT 1 FROM payroll_run_exclusions excluded WHERE excluded.organization_id=$1 AND excluded.run_id=$4 AND excluded.employee_id=e.id)`;
    if (run.province_id) {
      params.push(run.province_id);
      where += ` AND e.province_id=$${params.length}`;
    }
    const workers = await c.query<CompensationRow>(
      `SELECT ${compensationFields} FROM employee_compensation c JOIN employees e ON e.organization_id=c.organization_id AND e.id=c.employee_id LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=e.organization_id AND s.id=e.site_id WHERE ${where} ORDER BY e.full_name`,
      params,
    );
    let grossTotal = 0,
      deductionTotal = 0,
      netTotal = 0,
      employerTotal = 0;
    for (const workerRow of workers.rows) {
      const worker = mapCompensation(workerRow);
      const components = await c.query<EmployeeComponentRow>(
        `SELECT ${employeeComponentFields} FROM employee_payroll_components ec JOIN employees e ON e.organization_id=ec.organization_id AND e.id=ec.employee_id JOIN payroll_components pc ON pc.organization_id=ec.organization_id AND pc.id=ec.component_id LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id WHERE ec.organization_id=$1 AND ec.employee_id=$2 AND ec.is_active AND ec.effective_from <= $3::date AND (ec.effective_to IS NULL OR ec.effective_to >= $4::date) AND pc.is_active ORDER BY pc.sort_order,pc.name`,
        [
          context.organizationId,
          worker.employee.id,
          run.period_end,
          run.period_start,
        ],
      );
      const attendance = await c.query<{
        days_worked: string;
        days_absent: string;
        overtime_minutes: string;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('present', 'late') AND clock_out_at IS NOT NULL)::text AS days_worked,
           COUNT(*) FILTER (WHERE status = 'absent')::text AS days_absent,
           COALESCE(SUM(overtime_minutes) FILTER (WHERE status IN ('present', 'late') AND clock_out_at IS NOT NULL), 0)::text AS overtime_minutes
         FROM attendance_records
         WHERE organization_id = $1
           AND employee_id = $2
           AND work_date BETWEEN $3::date AND $4::date`,
        [
          context.organizationId,
          worker.employee.id,
          run.period_start,
          run.period_end,
        ],
      );
      const attendanceSnapshot = attendance.rows[0] ?? {
        days_worked: "0",
        days_absent: "0",
        overtime_minutes: "0",
      };
      const daysWorked = Number(attendanceSnapshot.days_worked);
      const daysAbsent = Number(attendanceSnapshot.days_absent);
      const overtimeHours = Number(attendanceSnapshot.overtime_minutes) / 60;
      const basic = worker.basicSalary;
      let gross = basic,
        deductions = 0,
        employer = 0;
      const result = await c.query<{ id: string }>(
        `INSERT INTO payslips (organization_id,run_id,employee_id,employee_number,employee_name,job_title,province_id,site_id,department_id,currency,basic_salary,days_worked,days_absent,overtime_hours,gross_pay,total_deductions,net_pay,employer_cost,payment_method,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT department_id FROM employees WHERE organization_id=$1 AND id=$3),$9,$10,$11,$12,$13,0,0,0,0,$14,$15) RETURNING id`,
        [
          context.organizationId,
          id,
          worker.employee.id,
          worker.employee.employeeNumber,
          worker.employee.fullName,
          worker.employee.jobTitle,
          worker.province?.id ?? null,
          worker.site?.id ?? null,
          run.currency,
          basic,
          daysWorked,
          daysAbsent,
          overtimeHours,
          worker.paymentMethod,
          worker.notes ?? null,
        ],
      );
      const payslipId = result.rows[0]!.id;
      await c.query(
        `INSERT INTO payslip_lines (organization_id,payslip_id,component_code,component_name,component_type,amount,basis,sort_order) VALUES ($1,$2,'basic_salary','Basic salary','earning',$3,'Compensation in force for the payroll period',0)`,
        [context.organizationId, payslipId, basic],
      );
      const monthlyReferenceHours =
        worker.payFrequency === "monthly" && worker.contractHoursPerWeek
          ? (worker.contractHoursPerWeek * 52) / 12
          : null;
      const overtimePay =
        overtimeHours > 0 &&
        worker.overtimeMultiplier !== null &&
        monthlyReferenceHours &&
        monthlyReferenceHours > 0
          ? Math.round(
              ((basic / monthlyReferenceHours) *
                overtimeHours *
                worker.overtimeMultiplier +
                Number.EPSILON) *
                100,
            ) / 100
          : 0;
      if (overtimePay > 0) {
        gross += overtimePay;
        await c.query(
          `INSERT INTO payslip_lines (organization_id,payslip_id,component_code,component_name,component_type,amount,basis,sort_order) VALUES ($1,$2,'verified_overtime','Verified overtime','earning',$3,$4,5)`,
          [
            context.organizationId,
            payslipId,
            overtimePay,
            `${overtimeHours.toFixed(2)} verified hours × ${worker.overtimeMultiplier} × monthly hourly reference`,
          ],
        );
      }
      const orderedComponents = [
        ...components.rows.filter(
          (item) =>
            !(
              item.component_type === "deduction" &&
              isIncomeTaxComponent(item.component_code)
            ),
        ),
        ...components.rows.filter(
          (item) =>
            item.component_type === "deduction" &&
            isIncomeTaxComponent(item.component_code),
        ),
      ];
      let hasIncomeTax = false;
      for (const itemRaw of orderedComponents) {
        const item = mapEmployeeComponent(itemRaw);
        const amount = componentAmount(itemRaw, basic, gross);
        if (item.component.componentType === "earning") gross += amount;
        else if (item.component.componentType === "deduction") {
          deductions += amount;
          if (isIncomeTaxComponent(item.component.code)) hasIncomeTax = true;
        } else employer += amount;
        await c.query(
          `INSERT INTO payslip_lines (organization_id,payslip_id,component_id,component_code,component_name,component_type,amount,basis,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            context.organizationId,
            payslipId,
            item.component.id,
            item.component.code,
            item.component.name,
            item.component.componentType,
            amount,
            item.component.calculation === "percentage_of_basic"
              ? `${item.percentage ?? item.component.percentage ?? 0}% of basic salary`
              : item.component.calculation === "percentage_of_gross"
                ? `${item.percentage ?? item.component.percentage ?? 0}% of gross pay`
                : "Configured amount",
            item.component.sortOrder,
          ],
        );
      }
      if (!hasIncomeTax) {
        await c.query(
          `INSERT INTO payslip_lines (organization_id,payslip_id,component_code,component_name,component_type,amount,basis,sort_order) VALUES ($1,$2,'income_tax','Income tax','deduction',0,'No tax withholding configured',900)`,
          [context.organizationId, payslipId],
        );
      }
      const net = Math.max(0, gross - deductions);
      await c.query(
        `UPDATE payslips SET gross_pay=$3,total_deductions=$4,net_pay=$5,employer_cost=$6 WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, payslipId, gross, deductions, net, employer],
      );
      grossTotal += gross;
      deductionTotal += deductions;
      netTotal += net;
      employerTotal += employer;
    }
    await c.query(
      `UPDATE payroll_runs SET status='calculated',employee_count=$3,gross_total=$4,deduction_total=$5,net_total=$6,employer_cost_total=$7 WHERE organization_id=$1 AND id=$2`,
      [
        context.organizationId,
        id,
        workers.rowCount ?? 0,
        grossTotal,
        deductionTotal,
        netTotal,
        employerTotal,
      ],
    );
    return mapRun(await runFor(c, context, id));
  });
}
export async function approveRun(context: PayrollContext, id: string) {
  return withTenantContext(context, async (c) => {
    const old = await runFor(c, context, id);
    if (old.status !== "calculated")
      throw new ConflictError("Calculate the payroll before approving it");
    const r = await c.query(
      `UPDATE payroll_runs SET status='approved',approved_by=$3,approved_at=now() WHERE organization_id=$1 AND id=$2 RETURNING id`,
      [context.organizationId, id, context.userId],
    );
    return mapRun(await runFor(c, context, r.rows[0]!.id));
  });
}
export async function rejectRun(
  context: PayrollContext,
  id: string,
  notes: string | null,
) {
  return withTenantContext(context, async (c) => {
    const old = await runFor(c, context, id);
    if (!["draft", "calculated"].includes(old.status))
      throw new ConflictError(
        "Only a draft or calculated payroll can be cancelled",
      );
    const r = await c.query(
      `UPDATE payroll_runs SET status='cancelled',notes=$3 WHERE organization_id=$1 AND id=$2 RETURNING id`,
      [context.organizationId, id, notes ?? old.notes],
    );
    return mapRun(await runFor(c, context, r.rows[0]!.id));
  });
}
export async function markPaid(
  context: PayrollContext,
  id: string,
  input: MarkPaidInput,
) {
  return withTenantContext(context, async (c) => {
    const old = await runFor(c, context, id);
    if (old.status !== "approved")
      throw new ConflictError("Only an approved payroll can be marked paid");
    const r = await c.query(
      `UPDATE payroll_runs SET status='paid',paid_at=COALESCE($3::date, CURRENT_DATE),notes=$4 WHERE organization_id=$1 AND id=$2 RETURNING id`,
      [
        context.organizationId,
        id,
        input.paidAt ?? null,
        input.notes === undefined ? old.notes : input.notes,
      ],
    );
    return mapRun(await runFor(c, context, r.rows[0]!.id));
  });
}
export async function listPayslips(context: PayrollContext, runId: string) {
  return withTenantContext(context, async (c) => {
    await runFor(c, context, runId);
    const slips = await c.query<PayslipRow>(
      `SELECT ${payslipFields} FROM payslips p LEFT JOIN provinces pr ON pr.organization_id=p.organization_id AND pr.id=p.province_id LEFT JOIN sites s ON s.organization_id=p.organization_id AND s.id=p.site_id LEFT JOIN departments d ON d.organization_id=p.organization_id AND d.id=p.department_id WHERE p.organization_id=$1 AND p.run_id=$2 ORDER BY p.employee_name`,
      [context.organizationId, runId],
    );
    const ids = slips.rows.map((x) => x.id);
    const lines = ids.length
      ? (
          await c.query<PayslipLineRow>(
            `SELECT id,payslip_id,component_id,component_code,component_name,component_type,amount::text,basis,sort_order FROM payslip_lines WHERE organization_id=$1 AND payslip_id=ANY($2::uuid[]) ORDER BY sort_order,component_name`,
            [context.organizationId, ids],
          )
        ).rows
      : [];
    return slips.rows.map((item) =>
      mapPayslip(
        item,
        lines.filter((line) => line.payslip_id === item.id),
      ),
    );
  });
}
type PayslipPdfOrganization = {
  name: string;
  address: string;
  logoUrl?: string | null;
};
type PayslipPdfRun = {
  reference: string;
  payrollReference: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: RunStatus;
};
const payrollPdfMoney = (value: number, currency: string, french: boolean) =>
  new Intl.NumberFormat(french ? "fr-FR" : "en-US", {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
const payrollPdfDate = (value: string, french: boolean) =>
  new Intl.DateTimeFormat(french ? "fr-FR" : "en-US", {
    dateStyle: "medium",
  }).format(new Date(value.slice(0, 10) + "T12:00:00"));
const payrollPdfLabel = (french: boolean, en: string, fr: string) =>
  french ? fr : en;
const payrollPdfIncomeTax = (line: { code: string; type: string }) =>
  line.type === "deduction" &&
  /(income_?tax|taxe?|impot|withholding)/i.test(line.code);

async function payrollPdfLogo(
  url: string | null | undefined,
): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !/(^|\.)res\.cloudinary\.com$/i.test(parsed.hostname)
    )
      return null;
    const response = await fetch(parsed, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      !contentType.includes("image/png") &&
      !contentType.includes("image/jpeg")
    )
      return null;
    const declaredSize = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredSize) && declaredSize > 2_000_000) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length && bytes.length <= 2_000_000 ? bytes : null;
  } catch {
    // Branding must never block a payroll document from being generated.
    return null;
  }
}

/** A controlled, read-only statement generated from an approved payroll record. */
export async function createPayslipPdf(
  organization: PayslipPdfOrganization,
  run: PayslipPdfRun,
  payslip: ReturnType<typeof mapPayslip>,
  french: boolean,
): Promise<Buffer> {
  const label = (en: string, fr: string) => payrollPdfLabel(french, en, fr);
  const navy = "#121c70";
  const navySoft = "#182d72";
  const blue = "#3868ff";
  const ink = "#1e293b";
  const muted = "#64748b";
  const border = "#d9e2ec";
  const pale = "#eff6ff";
  const pageMargin = 48;
  const logo = await payrollPdfLogo(organization.logoUrl);
  const earnings = payslip.lines.filter((item) => item.type === "earning");
  const deductions = payslip.lines.filter((item) => item.type === "deduction");
  const taxLines = deductions.filter(payrollPdfIncomeTax);
  const incomeTax = taxLines.reduce((sum, item) => sum + item.amount, 0);
  const taxLine =
    taxLines[0] ??
    ({
      id: "income-tax-zero",
      code: "income_tax",
      name: label("Income tax", "Impôt sur le revenu"),
      type: "deduction" as ComponentType,
      amount: 0,
      basis: label(
        "No tax withholding configured",
        "Aucune retenue fiscale configurée",
      ),
    } as const);
  const otherDeductions = deductions.filter(
    (item) => !payrollPdfIncomeTax(item),
  );
  const initials =
    organization.name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.slice(0, 1).toUpperCase())
      .join("") || "CO";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: pageMargin,
      info: {
        Title:
          label("Payslip", "Bulletin de paie") +
          " - " +
          payslip.employee.fullName,
        Author: organization.name,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const contentWidth = pageWidth - pageMargin * 2;
    const drawHeader = () => {
      doc.rect(0, 0, pageWidth, 108).fill(navy);
      doc
        .save()
        .fillOpacity(0.8)
        .ellipse(-42, 94, 252, 66)
        .fill(blue)
        .restore();
      doc
        .save()
        .fillOpacity(0.22)
        .ellipse(pageWidth - 20, 90, 250, 60)
        .fill("#5b7cff")
        .restore();

      doc.roundedRect(pageMargin, 28, 46, 46, 8).fill("#ffffff");
      if (logo) {
        try {
          doc.image(logo, pageMargin + 6, 34, { fit: [34, 34] });
        } catch {
          doc
            .fillColor(navySoft)
            .font("Helvetica-Bold")
            .fontSize(15)
            .text(initials, pageMargin, 43, { width: 46, align: "center" });
        }
      } else {
        doc
          .fillColor(navySoft)
          .font("Helvetica-Bold")
          .fontSize(15)
          .text(initials, pageMargin, 43, { width: 46, align: "center" });
      }

      doc
        .fillColor("#dbeafe")
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .text(organization.name.toUpperCase(), pageMargin + 58, 34, {
          width: 230,
        });
      doc
        .fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(17)
        .text(label("PAYSLIP", "BULLETIN DE PAIE"), pageMargin + 58, 48, {
          width: 250,
        });
      doc
        .fillColor("#dbeafe")
        .font("Helvetica")
        .fontSize(7.5)
        .text(
          organization.address ||
            label("Approved payroll statement", "Document de paie approuvé"),
          pageMargin + 58,
          72,
          { width: 270, ellipsis: true },
        );
      const status =
        run.status === "paid"
          ? label("Paid", "Payé")
          : label("Approved", "Approuvé");
      doc
        .roundedRect(pageWidth - pageMargin - 98, 31, 98, 22, 11)
        .fill("#ffffff");
      doc
        .fillColor(navySoft)
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .text(status, pageWidth - pageMargin - 94, 38, {
          width: 90,
          align: "center",
        });
      doc
        .fillColor("#dbeafe")
        .font("Helvetica")
        .fontSize(7.5)
        .text(run.reference, pageWidth - pageMargin - 190, 72, {
          width: 190,
          align: "right",
        });
    };

    const field = (
      x: number,
      y: number,
      width: number,
      name: string,
      value: string,
      rightBorder = false,
      bottomBorder = false,
    ) => {
      doc.rect(x, y, width, 46).lineWidth(0.55).strokeColor(border).stroke();
      if (rightBorder || bottomBorder) {
        // The rectangle already provides a controlled grid edge.
      }
      doc
        .fillColor(muted)
        .font("Helvetica-Bold")
        .fontSize(6.5)
        .text(name.toUpperCase(), x + 10, y + 9, { width: width - 20 });
      doc
        .fillColor(ink)
        .font("Helvetica-Bold")
        .fontSize(8.8)
        .text(value || "—", x + 10, y + 22, {
          width: width - 20,
          ellipsis: true,
        });
    };

    const sectionLabel = (
      name: string,
      x: number,
      y: number,
      width: number,
    ) => {
      doc.rect(x, y, width, 20).fill(navySoft);
      doc
        .fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(7.2)
        .text(name.toUpperCase(), x + 9, y + 7, { width: width - 18 });
    };

    const rowHeight = (item: { basis?: string | null }) =>
      item.basis ? 38 : 30;
    const detailHeight = (items: Array<{ basis?: string | null }>) =>
      Math.max(54, items.reduce((sum, item) => sum + rowHeight(item), 0) + 20);
    const drawDetail = (
      x: number,
      y: number,
      width: number,
      title: string,
      items: Array<{
        id: string;
        name: string;
        basis?: string | null;
        amount: number;
      }>,
      deduction = false,
    ) => {
      sectionLabel(title, x, y, width);
      const height = detailHeight(items);
      doc
        .rect(x, y + 20, width, height)
        .lineWidth(0.55)
        .strokeColor(border)
        .stroke();
      if (!items.length) {
        doc
          .fillColor(muted)
          .font("Helvetica")
          .fontSize(8)
          .text(
            label("No entries recorded.", "Aucun élément enregistré."),
            x + 10,
            y + 34,
            { width: width - 20 },
          );
        return height + 20;
      }
      let itemY = y + 29;
      for (const item of items) {
        const heightForRow = rowHeight(item);
        doc
          .fillColor(ink)
          .font("Helvetica-Bold")
          .fontSize(8)
          .text(item.name, x + 10, itemY, {
            width: width - 87,
            ellipsis: true,
          });
        doc
          .fillColor(deduction ? "#b91c1c" : ink)
          .font("Helvetica-Bold")
          .fontSize(8)
          .text(
            (deduction ? "-" : "") +
              payrollPdfMoney(item.amount, payslip.currency, french),
            x + width - 82,
            itemY,
            { width: 72, align: "right" },
          );
        if (item.basis) {
          doc
            .fillColor(muted)
            .font("Helvetica")
            .fontSize(6.5)
            .text(item.basis, x + 10, itemY + 12, {
              width: width - 20,
              ellipsis: true,
            });
        }
        doc
          .moveTo(x + 10, itemY + heightForRow - 6)
          .lineTo(x + width - 10, itemY + heightForRow - 6)
          .lineWidth(0.45)
          .strokeColor(border)
          .stroke();
        itemY += heightForRow;
      }
      return height + 20;
    };

    const summary = (y: number) => {
      const cells = [
        [label("Gross pay", "Brut"), payslip.grossPay],
        [label("Income tax", "Impôt"), incomeTax],
        [label("Deductions", "Retenues"), payslip.totalDeductions],
        [label("Net to pay", "Net à payer"), payslip.netPay],
      ] as const;
      const width = contentWidth / cells.length;
      cells.forEach(([name, value], index) => {
        const x = pageMargin + width * index;
        doc
          .rect(x, y, width - 1, 60)
          .fill(index === cells.length - 1 ? navySoft : pale);
        doc
          .fillColor(index === cells.length - 1 ? "#dbeafe" : muted)
          .font("Helvetica-Bold")
          .fontSize(6.5)
          .text(name.toUpperCase(), x + 9, y + 11, { width: width - 18 });
        doc
          .fillColor(index === cells.length - 1 ? "#ffffff" : ink)
          .font("Helvetica-Bold")
          .fontSize(10)
          .text(
            payrollPdfMoney(value, payslip.currency, french),
            x + 9,
            y + 30,
            {
              width: width - 18,
              align: "left",
            },
          );
      });
    };

    drawHeader();
    let y = 130;
    doc
      .fillColor(navySoft)
      .font("Helvetica-Bold")
      .fontSize(7)
      .text(
        label("Payslip reference", "Référence du bulletin").toUpperCase(),
        pageMargin,
        y,
      );
    doc
      .fillColor(ink)
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(run.reference, pageMargin, y + 12);
    doc
      .fillColor(muted)
      .font("Helvetica-Bold")
      .fontSize(7)
      .text(
        label("Payment date", "Date de paiement").toUpperCase(),
        pageWidth - pageMargin - 150,
        y,
        { width: 150, align: "right" },
      );
    doc
      .fillColor(ink)
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(
        payrollPdfDate(run.payDate, french),
        pageWidth - pageMargin - 150,
        y + 12,
        {
          width: 150,
          align: "right",
        },
      );
    y += 43;

    sectionLabel(
      label("Employee information", "Informations employé"),
      pageMargin,
      y,
      230,
    );
    y += 20;
    const half = contentWidth / 2;
    field(
      pageMargin,
      y,
      half,
      label("Full name", "Nom complet"),
      payslip.employee.fullName,
    );
    field(
      pageMargin + half,
      y,
      half,
      label("Employee number", "Matricule"),
      "#" + payslip.employee.employeeNumber,
    );
    y += 46;
    field(
      pageMargin,
      y,
      half,
      label("Position", "Poste"),
      payslip.employee.jobTitle || "—",
    );
    field(
      pageMargin + half,
      y,
      half,
      label("Pay period", "Période de paie"),
      payrollPdfDate(run.periodStart, french) +
        " - " +
        payrollPdfDate(run.periodEnd, french),
    );
    y += 65;

    const taxAndDeductions = [taxLine, ...otherDeductions];
    const detailRequired =
      Math.max(detailHeight(earnings), detailHeight(taxAndDeductions)) + 104;
    if (y + detailRequired > pageHeight - 54) {
      doc.addPage();
      drawHeader();
      y = 130;
    }
    const gap = 12;
    const columnWidth = (contentWidth - gap) / 2;
    const leftHeight = drawDetail(
      pageMargin,
      y,
      columnWidth,
      label("Earnings", "Gains"),
      earnings,
    );
    const rightHeight = drawDetail(
      pageMargin + columnWidth + gap,
      y,
      columnWidth,
      label("Tax and deductions", "Impôt et retenues"),
      taxAndDeductions,
      true,
    );
    y += Math.max(leftHeight, rightHeight) + 16;
    summary(y);
    y += 78;
    doc
      .moveTo(pageMargin, y)
      .lineTo(pageWidth - pageMargin, y)
      .lineWidth(0.55)
      .strokeColor(border)
      .stroke();
    doc
      .fillColor(muted)
      .font("Helvetica")
      .fontSize(7)
      .text(
        label(
          "This personal document was issued by " +
            organization.name +
            " from its approved payroll cycle.",
          "Ce document personnel est émis par " +
            organization.name +
            " dans le cadre de son cycle de paie approuvé.",
        ),
        pageMargin,
        y + 10,
        { width: contentWidth, align: "center" },
      );
    doc
      .fillColor(muted)
      .font("Helvetica-Bold")
      .fontSize(6.5)
      .text(
        label("Payroll reference", "Référence de paie") +
          ": " +
          run.payrollReference,
        pageMargin,
        y + 23,
        { width: contentWidth, align: "center" },
      );
    doc.end();
  });
}
export async function exportPayslipPdf(
  context: PayrollContext,
  payslipId: string,
  french: boolean,
) {
  return withTenantContext(context, async (c) => {
    const record = await c.query<
      PayslipRow & {
        period_start: string;
        period_end: string;
        pay_date: string;
        payroll_reference: string;
        run_status: RunStatus;
      }
    >(
      `SELECT ${payslipFields}, r.reference AS payroll_reference, r.period_start::text, r.period_end::text,
              r.pay_date::text, r.status AS run_status
         FROM payslips p
         JOIN payroll_runs r ON r.organization_id=p.organization_id AND r.id=p.run_id
         LEFT JOIN provinces pr ON pr.organization_id=p.organization_id AND pr.id=p.province_id
         LEFT JOIN sites s ON s.organization_id=p.organization_id AND s.id=p.site_id
         LEFT JOIN departments d ON d.organization_id=p.organization_id AND d.id=p.department_id
        WHERE p.organization_id=$1 AND p.id=$2`,
      [context.organizationId, payslipId],
    );
    const row = record.rows[0];
    if (!row) throw new NotFoundError("Payslip not found");
    if (!["approved", "paid"].includes(row.run_status))
      throw new ConflictError(
        "A payslip can be downloaded only after payroll approval",
      );
    const lines = await c.query<PayslipLineRow>(
      `SELECT id,payslip_id,component_id,component_code,component_name,component_type,
              amount::text,basis,sort_order
         FROM payslip_lines
        WHERE organization_id=$1 AND payslip_id=$2
        ORDER BY sort_order,component_name`,
      [context.organizationId, payslipId],
    );
    const company = await c.query<{
      name: string;
      address_line1: string | null;
      address_line2: string | null;
      city: string | null;
      region: string | null;
      postal_code: string | null;
      logo_url: string | null;
    }>(
      `SELECT COALESCE(display_name,legal_name,slug) AS name,address_line1,address_line2,
              city,region,postal_code,settings.logo_url
         FROM organizations LEFT JOIN organization_settings settings ON settings.organization_id=organizations.id WHERE organizations.id=$1`,
      [context.organizationId],
    );
    const organization = company.rows[0];
    const name = organization?.name?.trim() || "Entreprise";
    const address = [
      organization?.address_line1,
      organization?.address_line2,
      organization?.city,
      organization?.region,
      organization?.postal_code,
    ]
      .filter((part): part is string => Boolean(part?.trim()))
      .join(", ");
    const payslip = mapPayslip(row, lines.rows);
    const buffer = await createPayslipPdf(
      { name, address, logoUrl: organization?.logo_url ?? null },
      {
        reference: payslip.reference,
        payrollReference: row.payroll_reference,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        payDate: row.pay_date,
        status: row.run_status,
      },
      payslip,
      french,
    );
    return {
      buffer,
      fileName: `${row.reference}-${row.employee_number}-payslip.pdf`.replace(
        /[^A-Za-z0-9_.-]/g,
        "_",
      ),
    };
  });
}
export async function summary(context: PayrollContext) {
  return withTenantContext(context, async (c) => {
    const scope = await scopeOf(c, context);
    const params: unknown[] = [context.organizationId];
    let where = "organization_id=$1";
    if (scope === "province") {
      params.push(context.memberId);
      where += ` AND province_id IN (SELECT province_id FROM member_provinces WHERE organization_id=$1 AND member_id=$${params.length})`;
    } else if (scope === "self") where += " AND false";
    const r = await c.query<{
      runs: string;
      draft: string;
      calculated: string;
      approved: string;
      paid: string;
      net_paid: string;
    }>(
      `SELECT COUNT(*)::text AS runs,COUNT(*) FILTER (WHERE status='draft')::text AS draft,COUNT(*) FILTER (WHERE status='calculated')::text AS calculated,COUNT(*) FILTER (WHERE status='approved')::text AS approved,COUNT(*) FILTER (WHERE status='paid')::text AS paid,COALESCE(SUM(net_total) FILTER (WHERE status='paid' AND date_trunc('month',paid_at)=date_trunc('month',CURRENT_DATE)),0)::text AS net_paid FROM payroll_runs WHERE ${where}`,
      params,
    );
    const row = r.rows[0]!;
    return {
      totalRuns: Number(row.runs),
      draft: Number(row.draft),
      readyForApproval: Number(row.calculated),
      approved: Number(row.approved),
      paid: Number(row.paid),
      paidThisMonth: Number(row.net_paid),
    };
  });
}
