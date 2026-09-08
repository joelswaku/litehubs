import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Choose a valid record");
const date = z.string().date("Use YYYY-MM-DD");
const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => text(max).nullable().optional();
const decimal = z.coerce.number().finite();
export const reviewTypes = [
  "probation",
  "quarterly",
  "half_year",
  "annual",
  "promotion",
  "exit",
] as const;
export const reviewStatuses = [
  "draft",
  "submitted",
  "acknowledged",
  "closed",
] as const;
export const goalStatuses = [
  "not_started",
  "in_progress",
  "achieved",
  "cancelled",
] as const;

export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const reviewParams = organizationParams.extend({ reviewId: id });
export const goalParams = organizationParams.extend({ goalId: id });
const reviewFields = z.object({
  periodStart: date.optional(),
  periodEnd: date.optional(),
  reviewType: z.enum(reviewTypes).optional(),
  reviewedOn: date.nullable().optional(),
  overallRating: decimal.min(1).max(5).nullable().optional(),
  strengths: nullableText(4_000),
  areasToImprove: nullableText(4_000),
  goals: nullableText(4_000),
  employeeComments: nullableText(4_000),
  status: z.enum(reviewStatuses).optional(),
  reviewerId: id.nullable().optional(),
});
export const createReviewSchema = reviewFields
  .extend({ employeeId: id, periodStart: date, periodEnd: date })
  .refine((value) => value.periodEnd >= value.periodStart, {
    path: ["periodEnd"],
    message: "Period end must be on or after period start",
  });
export const updateReviewSchema = reviewFields.refine(
  (value) => Object.keys(value).length > 0,
  "Provide at least one value to change",
);
export const acknowledgeSchema = z.object({
  employeeComments: nullableText(4_000),
});
const goalFields = z.object({
  title: text(200).optional(),
  description: nullableText(2_000),
  target: nullableText(500),
  dueOn: date.nullable().optional(),
  weight: decimal.min(0.01).max(100).nullable().optional(),
  progress: decimal.min(0).max(100).optional(),
  status: z.enum(goalStatuses).optional(),
});
export const createGoalSchema = goalFields.extend({ title: text(200) });
export const updateGoalSchema = goalFields.refine(
  (value) => Object.keys(value).length > 0,
  "Provide at least one value to change",
);
export const reviewQuery = z.object({
  employeeId: id.optional(),
  status: z.enum(reviewStatuses).optional(),
  reviewType: z.enum(reviewTypes).optional(),
  mine: z.coerce.boolean().optional(),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;
export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
export type ReviewQuery = z.infer<typeof reviewQuery>;

const policyNumber = z.coerce.number().finite().min(0).max(100);
export const performancePolicySchema = z.object({
  attendanceWeight: policyNumber,
  punctualityWeight: policyNumber,
  dailyReportWeight: policyNumber,
  taskWeight: policyNumber,
  conductWeight: policyNumber,
  workingDays: z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7).transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  dailyReportsRequired: z.boolean(),
  graceMinutes: z.coerce.number().int().min(0).max(180),
  minimumObservations: z.coerce.number().int().min(1).max(60),
  minorDeduction: policyNumber,
  seriousDeduction: policyNumber,
  grossDeduction: policyNumber,
  flaggedReportDeduction: policyNumber,
}).superRefine((value, context) => {
  const total = value.attendanceWeight + value.punctualityWeight + value.dailyReportWeight + value.taskWeight + value.conductWeight;
  if (Math.abs(total - 100) > 0.001) context.addIssue({ code: "custom", path: ["attendanceWeight"], message: "Performance weights must total 100" });
});
export const analyticsQuery = z.object({
  employeeId: id.optional(),
  from: date.optional(),
  to: date.optional(),
}).superRefine((value, context) => {
  if (value.from && value.to && value.to < value.from) context.addIssue({ code: "custom", path: ["to"], message: "End date must be on or after start date" });
});
export type PerformancePolicyInput = z.infer<typeof performancePolicySchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuery>;