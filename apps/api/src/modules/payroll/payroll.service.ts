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
const compensationFields = `c.id,c.employee_id,c.effective_from::text,c.effective_to::text,c.currency,c.basic_salary::text,c.pay_frequency,c.contract_hours_per_week::text,c.payment_method,c.bank_name,c.bank_account,c.mobile_money_number,c.notes,c.created_at,c.updated_at,e.employee_number,e.full_name AS employee_name,e.job_title AS employee_job_title,e.member_id AS employee_member_id,e.province_id,p.name AS province_name,e.site_id,s.name AS site_name`;
const componentFields = `id,code,name,component_type,calculation,percentage::text,default_amount::text,is_taxable,affects_gross,ledger_account_id,sort_order,is_active,notes,created_at,updated_at`;
const employeeComponentFields = `ec.id,ec.employee_id,ec.component_id,ec.amount::text,ec.percentage::text,ec.effective_from::text,ec.effective_to::text,ec.total_to_recover::text,ec.recovered_to_date::text,ec.is_active,ec.notes,ec.created_at,ec.updated_at,e.employee_number,e.full_name AS employee_name,e.job_title AS employee_job_title,e.member_id AS employee_member_id,e.province_id,p.name AS province_name,pc.code AS component_code,pc.name AS component_name,pc.component_type,pc.calculation,pc.default_amount::text AS default_amount,pc.percentage::text AS default_percentage,pc.sort_order`;
const runFields = `r.id,r.reference,r.period_start::text,r.period_end::text,r.pay_date::text,r.currency,r.status,r.province_id,p.name AS province_name,r.employee_count,r.gross_total::text,r.deduction_total::text,r.net_total::text,r.employer_cost_total::text,r.notes,r.created_by,creator.full_name AS created_by_name,r.approved_by,approver.full_name AS approved_by_name,r.approved_at,r.paid_at,r.created_at,r.updated_at`;
const payslipFields = `p.id,p.run_id,p.employee_id,p.employee_number,p.employee_name,p.job_title,p.province_id,pr.name AS province_name,p.site_id,s.name AS site_name,p.department_id,d.name AS department_name,p.currency,p.basic_salary::text,p.days_worked::text,p.days_absent::text,p.overtime_hours::text,p.leave_days_unpaid::text,p.gross_pay::text,p.total_deductions::text,p.net_pay::text,p.employer_cost::text,p.payment_method,p.payment_reference,p.notes,p.created_at,p.updated_at`;
const n = (value: string | null | undefined) =>
  value == null ? null : Number(value);
const optionalDate = (v: string | null | undefined) => v ?? null;

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
    const r = await c.query<CompensationRow>(
      `WITH made AS (INSERT INTO employee_compensation (organization_id,employee_id,effective_from,effective_to,currency,basic_salary,pay_frequency,contract_hours_per_week,payment_method,bank_name,bank_account,mobile_money_number,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id) SELECT ${compensationFields} FROM made JOIN employee_compensation c ON c.id=made.id JOIN employees e ON e.organization_id=c.organization_id AND e.id=c.employee_id LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=e.organization_id AND s.id=e.site_id`,
      [
        context.organizationId,
        input.employeeId,
        input.effectiveFrom,
        input.effectiveTo ?? null,
        input.currency,
        input.basicSalary,
        input.payFrequency,
        input.contractHoursPerWeek ?? null,
        input.paymentMethod,
        input.bankName ?? null,
        input.bankAccount ?? null,
        input.mobileMoneyNumber ?? null,
        input.notes ?? null,
        context.userId,
      ],
    );
    return mapCompensation(r.rows[0]!);
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
    const r = await c.query<CompensationRow>(
      `WITH made AS (UPDATE employee_compensation SET effective_from=$3,effective_to=$4,currency=$5,basic_salary=$6,pay_frequency=$7,contract_hours_per_week=$8,payment_method=$9,bank_name=$10,bank_account=$11,mobile_money_number=$12,notes=$13 WHERE organization_id=$1 AND id=$2 RETURNING id) SELECT ${compensationFields} FROM made JOIN employee_compensation c ON c.id=made.id JOIN employees e ON e.organization_id=c.organization_id AND e.id=c.employee_id LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id LEFT JOIN sites s ON s.organization_id=e.organization_id AND s.id=e.site_id`,
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
        input.paymentMethod ?? old.payment_method,
        input.bankName === undefined ? old.bank_name : input.bankName,
        input.bankAccount === undefined ? old.bank_account : input.bankAccount,
        input.mobileMoneyNumber === undefined
          ? old.mobile_money_number
          : input.mobileMoneyNumber,
        input.notes === undefined ? old.notes : input.notes,
      ],
    );
    return mapCompensation(r.rows[0]!);
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
      `WITH made AS (INSERT INTO employee_payroll_components (organization_id,employee_id,component_id,amount,percentage,effective_from,effective_to,total_to_recover,recovered_to_date,is_active,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id) SELECT ${employeeComponentFields} FROM made JOIN employee_payroll_components ec ON ec.id=made.id JOIN employees e ON e.organization_id=ec.organization_id AND e.id=ec.employee_id JOIN payroll_components pc ON pc.organization_id=ec.organization_id AND pc.id=ec.component_id LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id`,
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
      `WITH made AS (UPDATE employee_payroll_components SET amount=$3,percentage=$4,effective_from=$5,effective_to=$6,total_to_recover=$7,recovered_to_date=$8,is_active=$9,notes=$10 WHERE organization_id=$1 AND id=$2 RETURNING id) SELECT ${employeeComponentFields} FROM made JOIN employee_payroll_components ec ON ec.id=made.id JOIN employees e ON e.organization_id=ec.organization_id AND e.id=ec.employee_id JOIN payroll_components pc ON pc.organization_id=ec.organization_id AND pc.id=ec.component_id LEFT JOIN provinces p ON p.organization_id=e.organization_id AND p.id=e.province_id`,
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
    const r = await c.query<RunRow>(
      `WITH made AS (INSERT INTO payroll_runs (organization_id,reference,period_start,period_end,pay_date,currency,province_id,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id) SELECT ${runFields} FROM made JOIN payroll_runs r ON r.id=made.id LEFT JOIN provinces p ON p.organization_id=r.organization_id AND p.id=r.province_id LEFT JOIN users creator ON creator.id=r.created_by LEFT JOIN users approver ON approver.id=r.approved_by`,
      [
        context.organizationId,
        input.reference,
        input.periodStart,
        input.periodEnd,
        input.payDate,
        input.currency,
        input.provinceId ?? null,
        input.notes ?? null,
        context.userId,
      ],
    );
    return mapRun(r.rows[0]!);
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
    const r = await c.query<{ id: string }>(
      `UPDATE payroll_runs SET pay_date=$3,province_id=$4,notes=$5,status=$6 WHERE organization_id=$1 AND id=$2 RETURNING id`,
      [
        context.organizationId,
        id,
        input.payDate ?? old.pay_date,
        input.provinceId === undefined ? old.province_id : input.provinceId,
        input.notes === undefined ? old.notes : input.notes,
        input.status ?? old.status,
      ],
    );
    return mapRun(await runFor(c, context, r.rows[0]!.id));
  });
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
  if (component.total_to_recover != null)
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
    ];
    let where = `e.organization_id=$1 AND e.employment_status IN ('active','probation','on_leave') AND c.effective_from <= $2::date AND (c.effective_to IS NULL OR c.effective_to >= $3::date)`;
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
      const basic = worker.basicSalary;
      let gross = basic,
        deductions = 0,
        employer = 0;
      const result = await c.query<{ id: string }>(
        `INSERT INTO payslips (organization_id,run_id,employee_id,employee_number,employee_name,job_title,province_id,site_id,department_id,currency,basic_salary,gross_pay,total_deductions,net_pay,employer_cost,payment_method,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT department_id FROM employees WHERE organization_id=$1 AND id=$3),$9,$10,0,0,0,0,$11,$12) RETURNING id`,
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
          worker.paymentMethod,
          worker.notes ?? null,
        ],
      );
      const payslipId = result.rows[0]!.id;
      await c.query(
        `INSERT INTO payslip_lines (organization_id,payslip_id,component_code,component_name,component_type,amount,basis,sort_order) VALUES ($1,$2,'basic_salary','Basic salary','earning',$3,'Compensation in force for the payroll period',0)`,
        [context.organizationId, payslipId, basic],
      );
      for (const itemRaw of components.rows) {
        const item = mapEmployeeComponent(itemRaw);
        const amount = componentAmount(itemRaw, basic, gross);
        if (item.component.componentType === "earning") gross += amount;
        else if (item.component.componentType === "deduction")
          deductions += amount;
        else employer += amount;
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
