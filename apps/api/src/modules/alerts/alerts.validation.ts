import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Enter a valid identifier");
const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const nullableText = (maximum: number) => text(maximum).nullable().optional();
const optionalText = (maximum: number) => text(maximum).optional();
const dateTime = z
  .string()
  .datetime({ offset: true, message: "Use an ISO date and time" });
const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9_]{1,62}$/,
    "Use lowercase letters, numbers and underscores",
  );
const reference = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9_/-]{0,62}$/,
    "Use letters, numbers, underscores, slashes or hyphens",
  );

export const alertSeverities = ["low", "medium", "high", "critical"] as const;
export const alertStatuses = [
  "open",
  "acknowledged",
  "in_progress",
  "resolved",
  "dismissed",
] as const;
export type AlertStatus = (typeof alertStatuses)[number];

export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const alertParams = organizationParams.extend({ alertId: id });

export const listAlertsQuery = z.object({
  status: z.enum(alertStatuses).optional(),
  severity: z.enum(alertSeverities).optional(),
  provinceId: id.optional(),
  siteId: id.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const location = {
  provinceId: id.nullable().optional(),
  siteId: id.nullable().optional(),
};

export const createAlertBody = z
  .object({
    reference: reference.optional(),
    title: text(240),
    detail: nullableText(8_000),
    domain: domain.default("general"),
    severity: z.enum(alertSeverities).default("medium"),
    ...location,
    assignedTo: id.nullable().optional(),
    dueAt: dateTime.nullable().optional(),
    observedValue: z.number().finite().nullable().optional(),
    thresholdValue: z.number().finite().nullable().optional(),
    subjectTable: domain.nullable().optional(),
    subjectId: id.nullable().optional(),
  })
  .superRefine((value, context) => {
    if (
      (value.subjectTable === null || value.subjectTable === undefined) !==
      (value.subjectId === null || value.subjectId === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["subjectId"],
        message: "Provide both subjectTable and subjectId",
      });
    }
  });

export const updateAlertBody = z
  .object({
    title: optionalText(240),
    detail: nullableText(8_000),
    severity: z.enum(alertSeverities).optional(),
    status: z.enum(alertStatuses).optional(),
    ...location,
    assignedTo: id.nullable().optional(),
    dueAt: dateTime.nullable().optional(),
    resolutionNote: nullableText(8_000),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one value to change",
  });

export const resolveAlertBody = z.object({
  resolutionNote: text(8_000),
});

export type CreateAlertInput = z.infer<typeof createAlertBody>;
export type UpdateAlertInput = z.infer<typeof updateAlertBody>;
export type ListAlertsInput = z.infer<typeof listAlertsQuery>;
