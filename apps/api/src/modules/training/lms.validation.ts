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
const jsonObject = z.record(z.string(), z.unknown());

export const orgParams = z.object({ orgSlug: organizationSlugSchema });
export const lmsCourseParams = orgParams.extend({ courseId: id });
export const lmsVersionParams = lmsCourseParams.extend({ versionId: id });
export const lmsModuleParams = orgParams.extend({ moduleId: id });
export const lmsLessonParams = orgParams.extend({ lessonId: id });
export const lmsBlockParams = orgParams.extend({ blockId: id });
export const lmsAssignmentParams = orgParams.extend({ assignmentId: id });

export const createProfessionalCourseSchema = z.object({
  code,
  name: text(160),
  summary: nullableText(600),
  description: nullableText(8000),
  category: z.enum([
    "general",
    "safety",
    "biosecurity",
    "technical",
    "compliance",
    "induction",
    "management",
  ]),
  learningObjectives: z.array(text(500)).max(30).default([]),
  estimatedDurationMinutes: z.coerce
    .number()
    .int()
    .min(1)
    .max(10080)
    .nullable()
    .optional(),
  difficulty: z
    .enum(["foundation", "intermediate", "advanced"])
    .default("foundation"),
  languages: z
    .array(z.enum(["fr", "en"]))
    .min(1)
    .max(2)
    .default(["fr"]),
  instructorUserId: id.nullable().optional(),
  tags: z.array(text(80)).max(30).default([]),
  isMandatory: z.boolean().default(false),
  validityMonths: z.coerce.number().int().min(1).max(600).nullable().optional(),
  completionMode: z
    .enum(["automatic", "manager_validation"])
    .default("manager_validation"),
  renewalMonths: z.coerce.number().int().min(1).max(600).nullable().optional(),
  renewalRequired: z.boolean().default(false),
  autoAssignNewEmployees: z.boolean().default(false),
  defaultDueDays: z.coerce
    .number()
    .int()
    .min(1)
    .max(3650)
    .nullable()
    .optional(),
});

export const createModuleSchema = z.object({
  versionId: id,
  code,
  title: text(200),
  introduction: nullableText(4000),
  summary: nullableText(4000),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  isRequired: z.boolean().default(true),
});
export const createLessonSchema = z.object({
  versionId: id,
  code,
  title: text(200),
  summary: nullableText(4000),
  estimatedDurationMinutes: z.coerce
    .number()
    .int()
    .min(1)
    .max(1440)
    .nullable()
    .optional(),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  isRequired: z.boolean().default(true),
  requireSequential: z.boolean().default(false),
  completionMode: z
    .enum(["learner_confirmation", "supervisor_validation"])
    .default("learner_confirmation"),
});
export const blockTypes = [
  "heading",
  "text",
  "image",
  "document",
  "video",
  "audio",
  "file",
  "link",
  "callout",
  "checklist",
  "procedure",
  "acknowledgment",
  "reflection",
  "single_question",
  "quiz",
  "supervisor_verification",
] as const;
export const createBlockSchema = z.object({
  blockType: z.enum(blockTypes),
  title: nullableText(200),
  content: jsonObject.default({}),
  documentId: id.nullable().optional(),
  externalUrl: z.string().trim().url().nullable().optional(),
  captions: nullableText(8000),
  transcript: nullableText(30000),
  minimumWatchedPercent: z.coerce.number().min(1).max(100).default(90),
  allowDownload: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
  isRequired: z.boolean().default(true),
});
export const updateBlockSchema = z.object({
  blockType: z.enum(blockTypes).optional(),
  title: nullableText(200),
  content: jsonObject.optional(),
  documentId: id.nullable().optional(),
  externalUrl: z.string().trim().url().nullable().optional(),
  captions: nullableText(8000),
  transcript: nullableText(30000),
  minimumWatchedPercent: z.coerce.number().min(1).max(100).optional(),
  allowDownload: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
  isRequired: z.boolean().optional(),
});

export const trainingAiAssistantSchema = z.object({
  action: z.enum([
    "course_outline",
    "objectives",
    "policy_to_lessons",
    "quiz_questions",
    "simplify",
    "translate",
    "quiz_source_check",
  ]),
  sourceText: text(60_000),
  courseTitle: nullableText(200),
  targetLanguage: z.enum(["fr", "en"]).default("fr"),
  audience: nullableText(300),
});
const aiOutlineText = (max: number) => z.string().trim().min(1).max(max);
const aiOutlineMinutes = z.coerce.number().int().min(1).max(1440).optional();
const aiOutlineLessonSchema = z
  .object({
    title: aiOutlineText(200).optional(),
    titre: aiOutlineText(200).optional(),
    summary: nullableText(4000),
    description: nullableText(4000),
    contenu: nullableText(4000),
    estimatedDurationMinutes: aiOutlineMinutes,
    estimated_duration_minutes: aiOutlineMinutes,
    duree_estimee_minutes: aiOutlineMinutes,
  })
  .passthrough()
  .refine((lesson) => Boolean(lesson.title || lesson.titre), {
    message: "Each AI lesson needs a title",
    path: ["title"],
  });
const aiOutlineModuleSchema = z
  .object({
    title: aiOutlineText(200).optional(),
    titre: aiOutlineText(200).optional(),
    summary: nullableText(4000),
    description: nullableText(4000),
    introduction: nullableText(4000),
    learningObjectives: z.array(aiOutlineText(500)).max(30).optional(),
    objectifs_pedagogiques: z.array(aiOutlineText(500)).max(30).optional(),
    estimatedDurationMinutes: aiOutlineMinutes,
    estimated_duration_minutes: aiOutlineMinutes,
    duree_estimee_minutes: aiOutlineMinutes,
    lessons: z.array(aiOutlineLessonSchema).max(100).optional(),
    lecons: z.array(aiOutlineLessonSchema).max(100).optional(),
  })
  .passthrough()
  .refine((module) => Boolean(module.title || module.titre), {
    message: "Each AI module needs a title",
    path: ["title"],
  })
  .refine(
    (module) =>
      (Array.isArray(module.lessons) && module.lessons.length > 0) ||
      (Array.isArray(module.lecons) && module.lecons.length > 0),
    { message: "Each AI module needs at least one lesson", path: ["lessons"] },
  );
const aiOutlineAcknowledgmentSchema = z
  .object({
    text: aiOutlineText(2000).optional(),
    texte: aiOutlineText(2000).optional(),
    required: z.boolean().optional(),
    reponse_requise: z.boolean().optional(),
  })
  .passthrough()
  .refine((item) => Boolean(item.text || item.texte), {
    message: "Each acknowledgment needs text",
    path: ["text"],
  });
const aiOutlineDraftSchema = z
  .object({
    title: aiOutlineText(200).optional(),
    titre: aiOutlineText(200).optional(),
    summary: nullableText(600),
    description: nullableText(8000),
    learningObjectives: z.array(aiOutlineText(500)).max(30).optional(),
    objectifs_pedagogiques: z.array(aiOutlineText(500)).max(30).optional(),
    estimatedDurationMinutes: z.coerce.number().int().min(1).max(10080).optional(),
    estimated_duration_minutes: z.coerce.number().int().min(1).max(10080).optional(),
    duree_totale_estimee_minutes: z.coerce.number().int().min(1).max(10080).optional(),
    modules: z.array(aiOutlineModuleSchema).min(1).max(50),
    acknowledgments: z.array(aiOutlineAcknowledgmentSchema).max(20).optional(),
    attestations_obligatoires: z.array(aiOutlineAcknowledgmentSchema).max(20).optional(),
  })
  .passthrough();
export const applyAiOutlineSchema = z.object({
  versionId: id,
  draft: aiOutlineDraftSchema,
  // Never replace existing draft content unless the authorised administrator
  // makes that explicit in the builder.
  replaceExisting: z.boolean().default(false),
  applyCourseDetails: z.boolean().default(true),
});
export const publishVersionSchema = z.object({
  changeSummary: nullableText(2000),
  requiresRetake: z.boolean().default(false),
});
export const learnerBlockProgressSchema = z.object({
  action: z.enum([
    "open",
    "confirm",
    "heartbeat",
    "checklist",
    "acknowledge",
    "response",
  ]),
  videoPositionSeconds: z.coerce.number().int().min(0).max(172800).optional(),
  checklistItemIds: z
    .array(z.string().trim().min(1).max(120))
    .max(100)
    .optional(),
  responseText: z.string().trim().min(1).max(10000).optional(),
});
export const learnerBlockParams = lmsAssignmentParams.extend({ blockId: id });
export const quizSubmissionSchema = z.object({
  answers: z.array(z.unknown()).min(1).max(100),
});
export const certificateTokenParams = z.object({ token: id });

export const validateAssignmentSchema = z.object({
  approved: z.boolean(),
  note: nullableText(2000),
});

export type CreateProfessionalCourseInput = z.infer<
  typeof createProfessionalCourseSchema
>;
export type CreateModuleInput = z.infer<typeof createModuleSchema>;
export type CreateLessonInput = z.infer<typeof createLessonSchema>;
export type CreateBlockInput = z.infer<typeof createBlockSchema>;
export type UpdateBlockInput = z.infer<typeof updateBlockSchema>;
export type TrainingAiAssistantInput = z.infer<
  typeof trainingAiAssistantSchema
>;
export type ApplyAiOutlineInput = z.infer<typeof applyAiOutlineSchema>;
export type LearnerBlockProgressInput = z.infer<
  typeof learnerBlockProgressSchema
>;
