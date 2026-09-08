import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Choose a valid record");
const date = z.string().date("Use YYYY-MM-DD");
const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => text(max).nullable().optional();
const optionalText = (max: number) => text(max).optional();

export const categories = [
  "attendance",
  "conduct",
  "performance",
  "safety",
  "biosecurity",
  "theft",
  "insubordination",
  "other",
] as const;
export const severities = ["minor", "serious", "gross"] as const;
export const actions = [
  "none",
  "verbal_warning",
  "written_warning",
  "final_warning",
  "suspension",
  "demotion",
  "dismissal",
] as const;
export const statuses = [
  "open",
  "under_review",
  "upheld",
  "dismissed",
  "appealed",
  "closed",
] as const;

export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const actionParams = organizationParams.extend({ actionId: id });
const reference = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_/-]{0,62}$/,
    "Use letters, numbers, underscores, hyphens or slashes",
  );
const fields = z.object({
  reference: reference.optional(),
  occurredOn: date.optional(),
  reportedOn: date.optional(),
  category: z.enum(categories).optional(),
  severity: z.enum(severities).optional(),
  actionTaken: z.enum(actions).optional(),
  description: optionalText(4_000),
  employeeStatement: nullableText(4_000),
  expiresOn: date.nullable().optional(),
});
export const createActionSchema = fields
  .extend({
    employeeId: id,
    occurredOn: date,
    category: z.enum(categories),
    description: text(4_000),
  })
  .refine(
    (value) => !value.reportedOn || value.reportedOn >= value.occurredOn,
    {
      path: ["reportedOn"],
      message: "Reported date cannot be before incident date",
    },
  )
  .refine((value) => !value.expiresOn || value.expiresOn >= value.occurredOn, {
    path: ["expiresOn"],
    message: "Expiry cannot be before incident date",
  });
export const updateActionSchema = fields
  .extend({ status: z.enum(statuses).optional() })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one value to change",
  );
export const decisionSchema = z.object({
  status: z.enum(["upheld", "dismissed", "closed"]),
  actionTaken: z.enum(actions).optional(),
  expiresOn: date.nullable().optional(),
  decisionNote: nullableText(4_000),
});
export const actionQuery = z.object({
  status: z.enum(statuses).optional(),
  employeeId: id.optional(),
  category: z.enum(categories).optional(),
  severity: z.enum(severities).optional(),
});

export type CreateActionInput = z.infer<typeof createActionSchema>;
export type UpdateActionInput = z.infer<typeof updateActionSchema>;
export type DecisionInput = z.infer<typeof decisionSchema>;
export type ActionQuery = z.infer<typeof actionQuery>;
