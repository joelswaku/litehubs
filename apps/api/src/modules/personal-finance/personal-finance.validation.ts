import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid();
const currency = z.enum(["USD", "CDF"]);
const money = z.coerce.number().positive().max(1_000_000_000_000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date YYYY-MM-DD");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional();

export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const recordParams = organizationParams.extend({ id });

export const summaryQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mois YYYY-MM")
    .optional(),
});

export const settingsBody = z.object({
  cdfPerUsd: z.coerce.number().positive().max(1_000_000).optional(),
  displayCurrency: currency.optional(),
});

export const categoryBody = z.object({
  kind: z.enum(["income", "expense"]),
  name: z.string().trim().min(1).max(80),
  monthlyBudget: z.coerce.number().min(0).max(1_000_000_000).nullable().optional(),
  budgetCurrency: currency.default("USD"),
  color: optionalText(20),
});
export const categoryUpdateBody = categoryBody.partial().extend({ archived: z.boolean().optional() });

export const transactionBody = z
  .object({
    kind: z.enum(["income", "expense", "debt_payment"]),
    amount: money,
    currency,
    categoryId: id.nullable().optional(),
    debtId: id.nullable().optional(),
    occurredOn: day.optional(),
    note: optionalText(500),
  })
  .refine((value) => value.kind !== "debt_payment" || value.debtId, {
    message: "Choisissez la dette remboursée.",
    path: ["debtId"],
  });
export const transactionUpdateBody = z.object({
  amount: money.optional(),
  currency: currency.optional(),
  categoryId: id.nullable().optional(),
  occurredOn: day.optional(),
  note: optionalText(500),
});

export const debtBody = z.object({
  direction: z.enum(["i_owe", "owed_to_me"]).default("i_owe"),
  name: z.string().trim().min(1).max(120),
  counterparty: optionalText(120),
  amount: money,
  currency,
  startedOn: day.nullable().optional(),
  dueOn: day.nullable().optional(),
  note: optionalText(1000),
});
export const debtUpdateBody = debtBody.partial().extend({ closed: z.boolean().optional() });

export const recurringBody = z
  .object({
    kind: z.enum(["income", "expense", "debt_payment"]),
    label: z.string().trim().min(1).max(120),
    amount: money,
    currency,
    categoryId: id.nullable().optional(),
    debtId: id.nullable().optional(),
    dayOfMonth: z.coerce.number().int().min(1).max(28).default(1),
    active: z.boolean().default(true),
  })
  .refine((value) => value.kind !== "debt_payment" || value.debtId, {
    message: "Choisissez la dette remboursée.",
    path: ["debtId"],
  });
export const recurringUpdateBody = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  amount: money.optional(),
  currency: currency.optional(),
  categoryId: id.nullable().optional(),
  dayOfMonth: z.coerce.number().int().min(1).max(28).optional(),
  active: z.boolean().optional(),
});

export type SettingsInput = z.infer<typeof settingsBody>;
export type CategoryInput = z.infer<typeof categoryBody>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateBody>;
export type TransactionInput = z.infer<typeof transactionBody>;
export type TransactionUpdateInput = z.infer<typeof transactionUpdateBody>;
export type DebtInput = z.infer<typeof debtBody>;
export type DebtUpdateInput = z.infer<typeof debtUpdateBody>;
export type RecurringInput = z.infer<typeof recurringBody>;
export type RecurringUpdateInput = z.infer<typeof recurringUpdateBody>;
