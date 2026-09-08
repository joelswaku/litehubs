import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Enter a valid identifier");
const date = z.string().date("Use YYYY-MM-DD");
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).optional();
const nullableText = (max: number) => optionalText(max).nullable();
const decimal = z.coerce.number().finite();
const status = z.enum([
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "taken",
]);

export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const leaveTypeParams = organizationParams.extend({ leaveTypeId: id });
export const leaveRequestParams = organizationParams.extend({
  leaveRequestId: id,
});
export const requestLeaveSchema = z
  .object({
    employeeId: id,
    leaveTypeId: id,
    startsOn: date,
    endsOn: date,
    requestedDays: decimal.min(0.5).max(366),
    reason: optionalText(2_000),
  })
  .refine((value) => value.endsOn >= value.startsOn, {
    path: ["endsOn"],
    message: "End date must be on or after the start date",
  });
export const decideLeaveSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  decisionNote: nullableText(2_000),
});
export const cancelLeaveSchema = z.object({ notes: nullableText(2_000) });
export const createLeaveTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z][a-z0-9_]{1,62}$/,
      "Use lowercase letters, numbers and underscores",
    ),
  name: text(120),
  annualEntitlementDays: decimal.min(0).max(366).nullable().optional(),
  isPaid: z.boolean().default(true),
  requiresApproval: z.boolean().default(true),
  allowsBackdating: z.boolean().default(false),
  notes: optionalText(2_000),
});
export const updateLeaveTypeSchema = createLeaveTypeSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one value to change",
  });
export const leaveRequestQuery = z.object({
  status: status.optional(),
  employeeId: id.optional(),
  year: z.coerce.number().int().min(2000).max(2200).optional(),
});
export type RequestLeaveInput = z.infer<typeof requestLeaveSchema>;
export type DecideLeaveInput = z.infer<typeof decideLeaveSchema>;
export type CancelLeaveInput = z.infer<typeof cancelLeaveSchema>;
export type CreateLeaveTypeInput = z.infer<typeof createLeaveTypeSchema>;
export type UpdateLeaveTypeInput = z.infer<typeof updateLeaveTypeSchema>;
export type LeaveRequestQuery = z.infer<typeof leaveRequestQuery>;
