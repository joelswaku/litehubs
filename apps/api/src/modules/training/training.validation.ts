import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Choose a valid record");
const date = z.string().date("Use YYYY-MM-DD");
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).optional();
const nullableText = (max: number) => optionalText(max).nullable();
const decimal = z.coerce.number().finite();
const quizQuestion = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  question: text(600),
  options: z.array(text(300)).min(2).max(8),
  correctOption: z.coerce.number().int().min(0).max(7),
}).superRefine((value, context) => {
  if (value.correctOption >= value.options.length)
    context.addIssue({ code: "custom", path: ["correctOption"], message: "Choose a valid correct answer" });
});

export const trainingCategories = [
  "general",
  "safety",
  "biosecurity",
  "technical",
  "compliance",
  "induction",
  "management",
] as const;
export const assignmentStatuses = [
  "assigned",
  "in_progress",
  "awaiting_review",
  "completed",
  "overdue",
  "waived",
] as const;
export const trainingResults = [
  "passed",
  "failed",
  "attended",
  "in_progress",
] as const;

const courseCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9_]{1,62}$/,
    "Use lowercase letters, numbers and underscores",
  );

export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const courseParams = organizationParams.extend({ courseId: id });
export const assignmentParams = organizationParams.extend({ assignmentId: id });
export const materialParams = organizationParams.extend({ materialId: id });
export const myTrainingMaterialParams = assignmentParams.extend({ materialId: id });

const courseFields = z.object({
  code: courseCode.optional(),
  name: optionalText(160),
  description: nullableText(4_000),
  category: z.enum(trainingCategories).optional(),
  validityMonths: z.coerce.number().int().min(1).max(600).nullable().optional(),
  isMandatory: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export const createCourseSchema = courseFields.extend({
  code: courseCode,
  name: text(160),
});
export const updateCourseSchema = courseFields.refine(
  (value) => Object.keys(value).length > 0,
  "Provide at least one value to change",
);

const materialFields = z.object({
  title: optionalText(200),
  description: nullableText(2_000),
  materialType: z
    .enum(["document", "video", "link", "assessment", "other"])
    .optional(),
  externalUrl: z.string().trim().url("Use a valid URL").nullable().optional(),
  documentId: id.nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
  estimatedDurationMinutes: z.coerce.number().int().min(1).max(1440).nullable().optional(),
  requiresAcknowledgment: z.boolean().optional(),
  quizQuestions: z.array(quizQuestion).min(1).max(50).nullable().optional(),
  quizPassingScore: decimal.min(0).max(100).nullable().optional(),
  isRequired: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export const createMaterialSchema = materialFields
  .extend({
    title: text(200),
    materialType: z.enum(["document", "video", "link", "assessment", "other"]),
  })
  .superRefine((value, context) => {
    const quizOnly = value.materialType === "assessment" && Boolean(value.quizQuestions?.length);
    if (!value.externalUrl && !value.documentId && !quizOnly)
      context.addIssue({
        code: "custom",
        path: ["externalUrl"],
        message: "Add a secure document, video link, or assessment questions",
      });
    if (value.quizPassingScore !== undefined && value.quizPassingScore !== null && !value.quizQuestions?.length)
      context.addIssue({
        code: "custom",
        path: ["quizPassingScore"],
        message: "Add quiz questions before setting a passing score",
      });
  });
export const updateMaterialSchema = materialFields.refine(
  (value) => Object.keys(value).length > 0,
  "Provide at least one value to change",
);

export const assignmentQuery = z.object({
  courseId: id.optional(),
  employeeId: id.optional(),
  status: z.enum(assignmentStatuses).optional(),
  mine: z.coerce.boolean().optional(),
});
export const createAssignmentSchema = z.object({
  courseId: id,
  employeeIds: z.array(id).min(1).max(100),
  dueOn: date.nullable().optional(),
  notes: nullableText(2_000),
});
export const updateAssignmentSchema = z
  .object({
    status: z.enum(assignmentStatuses).optional(),
    dueOn: date.nullable().optional(),
    score: decimal.min(0).max(100).nullable().optional(),
    notes: nullableText(2_000),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one value to change",
  });

export const learnerLessonProgressSchema = z
  .object({
    opened: z.boolean().optional(),
    completed: z.boolean().optional(),
    acknowledged: z.boolean().optional(),
    quizAnswers: z.array(z.number().int().min(0).max(100)).max(100).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Open the lesson, mark it complete, acknowledge it, or submit quiz answers",
  });

export const recordQuery = z.object({
  courseId: id.optional(),
  employeeId: id.optional(),
});
export const createRecordSchema = z.object({
  employeeId: id,
  courseId: id,
  completedOn: date,
  result: z.enum(trainingResults).default("passed"),
  score: decimal.min(0).max(100).nullable().optional(),
  trainer: nullableText(200),
  certificateNumber: nullableText(160),
  notes: nullableText(2_000),
});

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;
export type AssignmentQuery = z.infer<typeof assignmentQuery>;
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;
export type LearnerLessonProgressInput = z.infer<typeof learnerLessonProgressSchema>;
export type RecordQuery = z.infer<typeof recordQuery>;
export type CreateRecordInput = z.infer<typeof createRecordSchema>;
