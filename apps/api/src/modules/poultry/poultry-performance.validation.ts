import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const idSchema = z.string().uuid("Enter a valid identifier");
const dateSchema = z.string().date("Use YYYY-MM-DD");
const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const nullableText = (maximum: number) => text(maximum).nullable().optional();
const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9_]{1,62}$/,
    "Use lowercase letters, numbers and underscores",
  );
const percent = z.number().min(0).max(100);
const adjustmentPercent = z.number().min(-90).max(500);
const nonEmptyUpdate = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one value to change",
  });

export const performanceOrganizationParams = z.object({
  orgSlug: organizationSlugSchema,
});
export const climateProfileParams = performanceOrganizationParams.extend({
  climateProfileId: idSchema,
});
export const performanceModelParams = performanceOrganizationParams.extend({
  modelId: idSchema,
});
export const weeklyTargetParams = performanceModelParams.extend({
  targetId: idSchema,
});
export const vaccineScheduleParams = performanceModelParams.extend({
  scheduleId: idSchema,
});
export const flockPerformanceParams = performanceOrganizationParams.extend({
  flockId: idSchema,
});
export const dailyWorkParams = performanceOrganizationParams.extend({
  workItemId: idSchema,
});

const climateClasses = z.enum([
  "hot_humid",
  "hot_dry",
  "temperate",
  "cool",
  "highland",
  "other",
]);
const productionTypes = z.enum(["broiler", "layer", "breeder"]);

export const climateProfileCreate = z.object({
  code,
  name: text(150),
  provinceId: idSchema.nullable().optional(),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .default("CD"),
  climateClass: climateClasses.default("other"),
  season: nullableText(100),
  temperatureC: z.number().min(-30).max(70).nullable().optional(),
  humidityPercent: percent.nullable().optional(),
  waterAdjustmentPercent: adjustmentPercent.default(0),
  feedAdjustmentPercent: adjustmentPercent.default(0),
  operationalNote: nullableText(2_000),
  isActive: z.boolean().default(true),
});
export const climateProfileUpdate = nonEmptyUpdate({
  code: code.optional(),
  name: text(150).optional(),
  provinceId: idSchema.nullable().optional(),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  climateClass: climateClasses.optional(),
  season: nullableText(100),
  temperatureC: z.number().min(-30).max(70).nullable().optional(),
  humidityPercent: percent.nullable().optional(),
  waterAdjustmentPercent: adjustmentPercent.optional(),
  feedAdjustmentPercent: adjustmentPercent.optional(),
  operationalNote: nullableText(2_000),
  isActive: z.boolean().optional(),
});

export const performanceModelCreate = z.object({
  code,
  name: text(150),
  productionType: productionTypes,
  strain: nullableText(150),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .default("CD"),
  climateProfileId: idSchema.nullable().optional(),
  version: z.number().int().positive().default(1),
  isActive: z.boolean().default(true),
  notes: nullableText(4_000),
});
export const performanceModelUpdate = nonEmptyUpdate({
  code: code.optional(),
  name: text(150).optional(),
  productionType: productionTypes.optional(),
  strain: nullableText(150),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  climateProfileId: idSchema.nullable().optional(),
  version: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  notes: nullableText(4_000),
});

const targetFields = {
  targetWeightG: z.number().positive().nullable().optional(),
  feedGPerBirdPerDay: z.number().min(0).nullable().optional(),
  waterLitersPerBirdPerDay: z.number().min(0).nullable().optional(),
  expectedCumulativeMortalityPercent: percent.nullable().optional(),
  targetEggLayPercent: percent.nullable().optional(),
  maxRejectedEggPercent: percent.nullable().optional(),
  cumulativeFeedGPerBird: z.number().min(0).nullable().optional(),
  targetFcr: z.number().min(0).nullable().optional(),
  targetDailyGainG: z.number().min(0).nullable().optional(),
  targetEggCount: z.number().int().min(0).nullable().optional(),
  targetEggWeightG: z.number().positive().nullable().optional(),
  expectedLiveBirdPercent: percent.nullable().optional(),
  minTemperatureC: z.number().min(-30).max(70).nullable().optional(),
  maxTemperatureC: z.number().min(-30).max(70).nullable().optional(),
  minHumidityPercent: percent.nullable().optional(),
  maxHumidityPercent: percent.nullable().optional(),
};
const targetPresent = (value: Record<string, unknown>) =>
  Object.keys(targetFields).some(
    (name) => value[name] !== undefined && value[name] !== null,
  );

export const weeklyTargetCreate = z
  .object({
    weekNumber: z.number().int().min(1).max(150),
    ...targetFields,
    tolerancePercent: percent.default(5),
    notes: nullableText(2_000),
  })
  .refine(targetPresent, { message: "Provide at least one weekly target" })
  .refine(
    (value) =>
      value.minTemperatureC == null ||
      value.maxTemperatureC == null ||
      value.minTemperatureC <= value.maxTemperatureC,
    { message: "Minimum temperature cannot exceed maximum temperature" },
  )
  .refine(
    (value) =>
      value.minHumidityPercent == null ||
      value.maxHumidityPercent == null ||
      value.minHumidityPercent <= value.maxHumidityPercent,
    { message: "Minimum humidity cannot exceed maximum humidity" },
  );
export const weeklyTargetUpdate = nonEmptyUpdate({
  ...targetFields,
  tolerancePercent: percent.optional(),
  notes: nullableText(2_000),
});

export const vaccineScheduleCreate = z.object({
  dayAge: z.number().int().min(0).max(1_000),
  vaccineName: text(150),
  dose: nullableText(150),
  administrationRoute: nullableText(150),
  notes: nullableText(2_000),
  isRequired: z.boolean().default(true),
});
export const vaccineScheduleUpdate = nonEmptyUpdate({
  dayAge: z.number().int().min(0).max(1_000).optional(),
  vaccineName: text(150).optional(),
  dose: nullableText(150),
  administrationRoute: nullableText(150),
  notes: nullableText(2_000),
  isRequired: z.boolean().optional(),
});

const workTypes = z.enum([
  "feed_record",
  "water_record",
  "live_bird_check",
  "weight_check",
  "egg_collection",
  "mortality_review",
  "vaccination",
  "health_check",
  "health_follow_up",
  "treatment_follow_up",
  "climate_check",
  "biosecurity_check",
  "performance_model_setup",
  "other",
]);
const workStatus = z.enum([
  "planned",
  "in_progress",
  "completed",
  "skipped",
  "missed",
]);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
export const dailyWorkCreate = z.object({
  workDate: dateSchema,
  workType: workTypes,
  title: text(200),
  details: nullableText(2_000),
  dueAt: time.nullable().optional(),
  assignedMemberId: idSchema.nullable().optional(),
  requiresSupervisorApproval: z.boolean().default(true),
});
export const dailyWorkUpdate = nonEmptyUpdate({
  workDate: dateSchema.optional(),
  workType: workTypes.optional(),
  title: text(200).optional(),
  details: nullableText(2_000),
  dueAt: time.nullable().optional(),
  assignedMemberId: idSchema.nullable().optional(),
  status: workStatus.optional(),
  completionNote: nullableText(2_000),
  requiresSupervisorApproval: z.boolean().optional(),
});

export const dailyWorkReview = z
  .object({
    decision: z.enum(["approved", "returned"]),
    reviewNotes: nullableText(2_000),
  })
  .superRefine((value, context) => {
    if (value.decision === "returned" && !value.reviewNotes)
      context.addIssue({
        code: "custom",
        path: ["reviewNotes"],
        message: "Explain what must be corrected before returning work",
      });
  });

export const performanceDateQuery = z.object({ date: dateSchema.optional() });
export const dailyWorkListQuery = z.object({ date: dateSchema.optional() });
export const dailyWorkGenerateBody = z.object({
  workDate: dateSchema.optional(),
  assignedMemberId: idSchema.nullable().optional(),
  requiresSupervisorApproval: z.boolean().default(true),
});

export type ClimateProfileCreate = z.infer<typeof climateProfileCreate>;
export type ClimateProfileUpdate = z.infer<typeof climateProfileUpdate>;
export type PerformanceModelCreate = z.infer<typeof performanceModelCreate>;
export type PerformanceModelUpdate = z.infer<typeof performanceModelUpdate>;
export type WeeklyTargetCreate = z.infer<typeof weeklyTargetCreate>;
export type WeeklyTargetUpdate = z.infer<typeof weeklyTargetUpdate>;
export type VaccineScheduleCreate = z.infer<typeof vaccineScheduleCreate>;
export type VaccineScheduleUpdate = z.infer<typeof vaccineScheduleUpdate>;
export type DailyWorkCreate = z.infer<typeof dailyWorkCreate>;
export type DailyWorkUpdate = z.infer<typeof dailyWorkUpdate>;
export type DailyWorkReview = z.infer<typeof dailyWorkReview>;
export type PerformanceDateQuery = z.infer<typeof performanceDateQuery>;
export type DailyWorkListQuery = z.infer<typeof dailyWorkListQuery>;
export type DailyWorkGenerateBody = z.infer<typeof dailyWorkGenerateBody>;
