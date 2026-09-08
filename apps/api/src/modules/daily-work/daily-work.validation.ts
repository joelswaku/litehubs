import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Enter a valid identifier");
const date = z.string().date("Use YYYY-MM-DD");
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).nullable().optional();
const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9_]{1,62}$/,
    "Use lowercase letters, numbers and underscores",
  );

export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const templateParams = organizationParams.extend({ templateId: id });
export const templateItemParams = templateParams.extend({ itemId: id });
export const runParams = organizationParams.extend({ runId: id });
export const runItemParams = runParams.extend({ itemId: id });
export const reportParams = organizationParams.extend({ reportId: id });
export const handoverParams = organizationParams.extend({ handoverId: id });

export const dailyWorkQuery = z.object({
  workDate: date.optional(),
  provinceId: id.optional(),
  siteId: id.optional(),
  status: z.string().trim().min(1).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type DailyWorkQuery = z.infer<typeof dailyWorkQuery>;

const domains = [
  "general",
  "poultry",
  "pigs",
  "agriculture",
  "security",
  "maintenance",
  "biosecurity",
  "safety",
  "hygiene",
  "inventory",
] as const;
export const templateBody = z.object({
  code,
  name: text(160),
  description: optionalText(2000),
  domain: z.enum(domains).default("general"),
  frequency: z
    .enum(["per_shift", "daily", "weekly", "monthly", "ad_hoc"])
    .default("daily"),
  siteId: id.nullable().optional(),
  departmentId: id.nullable().optional(),
  isActive: z.boolean().optional(),
});
export const templateUpdateBody = templateBody
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one value to change",
  );
export const itemBody = z.object({
  position: z.number().int().positive(),
  prompt: text(500),
  responseType: z
    .enum(["boolean", "number", "text", "choice", "photo"])
    .default("boolean"),
  unit: optionalText(30),
  isRequired: z.boolean().default(true),
  criticalControlId: id.nullable().optional(),
  guidance: optionalText(2000),
});
export const itemUpdateBody = itemBody
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one value to change",
  );
export const runBody = z.object({
  templateId: id,
  workDate: date.optional(),
  siteId: id.optional(),
  shiftId: id.nullable().optional(),
  notes: optionalText(4000),
});
export const responseBody = z
  .object({
    booleanValue: z.boolean().optional(),
    numberValue: z.number().finite().optional(),
    textValue: text(8000).optional(),
    passed: z.boolean().default(true),
    comment: optionalText(4000),
  })
  .superRefine((value, issue) => {
    const count = [
      value.booleanValue,
      value.numberValue,
      value.textValue,
    ].filter((entry) => entry !== undefined).length;
    if (count !== 1)
      issue.addIssue({
        code: "custom",
        path: ["booleanValue"],
        message: "Provide exactly one response value",
      });
  });
export const reportBody = z.object({
  workDate: date.optional(),
  reportLevel: z
    .enum(["employee", "supervisor", "manager", "owner_digest"])
    .default("supervisor"),
  provinceId: id.nullable().optional(),
  siteId: id.nullable().optional(),
  departmentId: id.nullable().optional(),
  shiftId: id.nullable().optional(),
  employeeId: id.nullable().optional(),
  parentReportId: id.nullable().optional(),
  summary: text(4000),
  workDone: optionalText(8000),
  problems: optionalText(8000),
  helpNeeded: optionalText(8000),
  metrics: z
    .record(
      z.string().max(80),
      z.union([z.string().max(200), z.number().finite(), z.boolean()]),
    )
    .default({}),
  status: z.enum(["draft", "submitted"]).default("submitted"),
});
export const reportUpdateBody = reportBody
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one value to change",
  );
export const reviewBody = z.object({
  status: z.enum(["reviewed", "flagged"]),
  reviewNote: optionalText(4000),
});
export const handoverBody = z.object({
  workDate: date.optional(),
  provinceId: id.nullable().optional(),
  siteId: id,
  outgoingShiftId: id.nullable().optional(),
  incomingShiftId: id.nullable().optional(),
  outgoingEmployeeId: id.nullable().optional(),
  incomingEmployeeId: id.nullable().optional(),
  summary: text(4000),
  outstandingWork: optionalText(8000),
  urgentItems: optionalText(8000),
  equipmentStatus: optionalText(4000),
});
