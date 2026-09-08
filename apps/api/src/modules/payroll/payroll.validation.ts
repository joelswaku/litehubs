import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Enter a valid identifier");
const date = z.string().date("Use YYYY-MM-DD");
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => requiredText(max).optional();
const nullableText = (max: number) => optionalText(max).nullable();
const money = z.coerce.number().finite().min(0).max(999_999_999_999);
const nullableMoney = z.union([money, z.null()]).optional();
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a three-letter currency code");
const payrollStatus = z.enum([
  "draft",
  "calculated",
  "approved",
  "paid",
  "cancelled",
]);
const componentType = z.enum(["earning", "deduction", "employer_cost"]);
const calculation = z.enum([
  "fixed",
  "percentage_of_basic",
  "percentage_of_gross",
  "per_day",
  "per_hour",
  "formula",
]);

export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const componentParams = organizationParams.extend({ componentId: id });
export const compensationParams = organizationParams.extend({
  compensationId: id,
});
export const employeeComponentParams = organizationParams.extend({
  employeeComponentId: id,
});
export const runParams = organizationParams.extend({ runId: id });
export const payslipParams = organizationParams.extend({ payslipId: id });

export const createComponentSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z][a-z0-9_]{1,62}$/,
        "Use lowercase letters, numbers and underscores",
      ),
    name: requiredText(120),
    componentType,
    calculation: calculation.default("fixed"),
    percentage: z
      .union([z.coerce.number().min(0).max(1000), z.null()])
      .optional(),
    defaultAmount: nullableMoney,
    isTaxable: z.boolean().default(true),
    affectsGross: z.boolean().default(true),
    ledgerAccountId: z.union([id, z.null()]).optional(),
    sortOrder: z.coerce.number().int().min(0).max(100_000).default(100),
    isActive: z.boolean().default(true),
    notes: nullableText(2_000),
  })
  .superRefine((value, ctx) => {
    if (
      ["percentage_of_basic", "percentage_of_gross"].includes(
        value.calculation,
      ) &&
      value.percentage == null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["percentage"],
        message: "A percentage is required for this calculation",
      });
    }
  });
export const updateComponentSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z][a-z0-9_]{1,62}$/,
        "Use lowercase letters, numbers and underscores",
      )
      .optional(),
    name: requiredText(120).optional(),
    componentType: componentType.optional(),
    calculation: calculation.optional(),
    percentage: z
      .union([z.coerce.number().min(0).max(1000), z.null()])
      .optional(),
    defaultAmount: nullableMoney,
    isTaxable: z.boolean().optional(),
    affectsGross: z.boolean().optional(),
    ledgerAccountId: z.union([id, z.null()]).optional(),
    sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
    isActive: z.boolean().optional(),
    notes: nullableText(2_000),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one value to change",
  });
export const createCompensationSchema = z
  .object({
    employeeId: id,
    effectiveFrom: date,
    effectiveTo: z.union([date, z.null()]).optional(),
    currency,
    basicSalary: money,
    payFrequency: z
      .enum(["monthly", "fortnightly", "weekly", "daily", "hourly"])
      .default("monthly"),
    contractHoursPerWeek: z
      .union([z.coerce.number().positive().max(168), z.null()])
      .optional(),
    paymentMethod: z
      .enum(["bank_transfer", "cash", "mobile_money", "cheque"])
      .default("bank_transfer"),
    bankName: nullableText(140),
    bankAccount: nullableText(160),
    mobileMoneyNumber: nullableText(80),
    notes: nullableText(2_000),
  })
  .refine(
    (value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom,
    {
      path: ["effectiveTo"],
      message: "End date must be on or after the start date",
    },
  );
export const updateCompensationSchema = z
  .object({
    effectiveFrom: date.optional(),
    effectiveTo: z.union([date, z.null()]).optional(),
    currency: currency.optional(),
    basicSalary: money.optional(),
    payFrequency: z
      .enum(["monthly", "fortnightly", "weekly", "daily", "hourly"])
      .optional(),
    contractHoursPerWeek: z
      .union([z.coerce.number().positive().max(168), z.null()])
      .optional(),
    paymentMethod: z
      .enum(["bank_transfer", "cash", "mobile_money", "cheque"])
      .optional(),
    bankName: nullableText(140),
    bankAccount: nullableText(160),
    mobileMoneyNumber: nullableText(80),
    notes: nullableText(2_000),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one value to change",
  })
  .refine(
    (value) =>
      !value.effectiveTo ||
      !value.effectiveFrom ||
      value.effectiveTo >= value.effectiveFrom,
    {
      path: ["effectiveTo"],
      message: "End date must be on or after the start date",
    },
  );
export const createEmployeeComponentSchema = z
  .object({
    employeeId: id,
    componentId: id,
    amount: nullableMoney,
    percentage: z
      .union([z.coerce.number().min(0).max(1000), z.null()])
      .optional(),
    effectiveFrom: date,
    effectiveTo: z.union([date, z.null()]).optional(),
    totalToRecover: nullableMoney,
    recoveredToDate: money.default(0),
    isActive: z.boolean().default(true),
    notes: nullableText(2_000),
  })
  .refine(
    (value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom,
    {
      path: ["effectiveTo"],
      message: "End date must be on or after the start date",
    },
  );
export const updateEmployeeComponentSchema = z
  .object({
    amount: nullableMoney,
    percentage: z
      .union([z.coerce.number().min(0).max(1000), z.null()])
      .optional(),
    effectiveFrom: date.optional(),
    effectiveTo: z.union([date, z.null()]).optional(),
    totalToRecover: nullableMoney,
    recoveredToDate: money.optional(),
    isActive: z.boolean().optional(),
    notes: nullableText(2_000),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one value to change",
  })
  .refine(
    (value) =>
      !value.effectiveTo ||
      !value.effectiveFrom ||
      value.effectiveTo >= value.effectiveFrom,
    {
      path: ["effectiveTo"],
      message: "End date must be on or after the start date",
    },
  );
export const createRunSchema = z
  .object({
    reference: z
      .string()
      .trim()
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9_/-]{0,62}$/,
        "Use letters, numbers, underscores, hyphens or slashes",
      ),
    periodStart: date,
    periodEnd: date,
    payDate: date,
    currency,
    provinceId: z.union([id, z.null()]).optional(),
    notes: nullableText(2_000),
  })
  .refine((value) => value.periodEnd >= value.periodStart, {
    path: ["periodEnd"],
    message: "Period end must be on or after period start",
  })
  .refine((value) => value.payDate >= value.periodStart, {
    path: ["payDate"],
    message: "Pay date must be on or after period start",
  });
export const updateRunSchema = z
  .object({
    payDate: date.optional(),
    provinceId: z.union([id, z.null()]).optional(),
    notes: nullableText(2_000),
    status: z.enum(["cancelled"]).optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one value to change",
  );
export const rejectRunSchema = z.object({ notes: nullableText(2_000) });
export const markPaidSchema = z.object({
  paidAt: z.union([date, z.null()]).optional(),
  notes: nullableText(2_000),
});
export const runQuery = z.object({
  status: payrollStatus.optional(),
  provinceId: id.optional(),
});

export type CreateComponentInput = z.infer<typeof createComponentSchema>;
export type UpdateComponentInput = z.infer<typeof updateComponentSchema>;
export type CreateCompensationInput = z.infer<typeof createCompensationSchema>;
export type UpdateCompensationInput = z.infer<typeof updateCompensationSchema>;
export type CreateEmployeeComponentInput = z.infer<
  typeof createEmployeeComponentSchema
>;
export type UpdateEmployeeComponentInput = z.infer<
  typeof updateEmployeeComponentSchema
>;
export type CreateRunInput = z.infer<typeof createRunSchema>;
export type UpdateRunInput = z.infer<typeof updateRunSchema>;
export type MarkPaidInput = z.infer<typeof markPaidSchema>;
export type RunQuery = z.infer<typeof runQuery>;
