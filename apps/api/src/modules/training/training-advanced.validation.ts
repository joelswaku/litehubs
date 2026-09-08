import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Choose a valid record");
const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => text(max).nullable().optional();
const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9_]{1,62}$/,
    "Use lowercase letters, numbers and underscores",
  );

export const advancedOrgParams = z.object({ orgSlug: organizationSlugSchema });
export const advancedCourseParams = advancedOrgParams.extend({ courseId: id });
export const questionBankParams = advancedOrgParams.extend({ bankId: id });
export const certificateParams = advancedOrgParams.extend({
  certificateId: id,
});

export const courseAudienceSchema = z.object({
  targetType: z.enum([
    "organization",
    "province",
    "site",
    "department",
    "role",
    "employee_category",
    "employee",
  ]),
  targetId: id.nullable().optional(),
  targetValue: nullableText(100),
});
export const replaceCourseAudienceSchema = z.object({
  audiences: z.array(courseAudienceSchema).max(100),
});
export const prerequisiteSchema = z.object({ prerequisiteCourseId: id });

export const createQuestionBankSchema = z.object({
  name: text(160),
  description: nullableText(2_000),
  category: nullableText(80),
});
export const createQuestionSchema = z.object({
  questionType: z.enum([
    "single_choice",
    "multiple_choice",
    "true_false",
    "matching",
    "ordering",
    "fill_blank",
    "numerical",
    "short_written",
    "scenario",
    "image_based",
  ]),
  prompt: text(8_000),
  options: z.array(z.unknown()).max(100).default([]),
  correctAnswer: z.unknown(),
  explanation: nullableText(4_000),
  sourceReference: nullableText(2_000),
  points: z.coerce.number().positive().max(1_000).default(1),
  requiresManualGrading: z.boolean().default(false),
});

export const createTemplateDraftSchema = z.object({
  templateId: z.string().trim().min(2).max(100),
  code,
  completionMode: z
    .enum(["automatic", "manager_validation"])
    .default("manager_validation"),
});
export const revokeCertificateSchema = z.object({ reason: text(2_000) });

export type CourseAudienceInput = z.infer<typeof courseAudienceSchema>;
export type CreateQuestionBankInput = z.infer<typeof createQuestionBankSchema>;
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type CreateTemplateDraftInput = z.infer<
  typeof createTemplateDraftSchema
>;
