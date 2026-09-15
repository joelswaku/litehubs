import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireActiveEmployeeProfile, requirePermission } from "../../middleware/permissions.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./training.controller";
import * as lmsController from "./lms.controller";
import {
  assignmentParams,
  assignmentQuery,
  courseParams,
  createAssignmentSchema,
  createCourseSchema,
  createMaterialSchema,
  createRecordSchema,
  materialParams,
  myTrainingMaterialParams,
  organizationParams,
  recordQuery,
  updateAssignmentSchema,
  updateCourseSchema,
  updateMaterialSchema,
  learnerLessonProgressSchema,
} from "./training.validation";

import * as advancedController from "./training-advanced.controller";
import {
  advancedCourseParams,
  advancedOrgParams,
  certificateParams,
  createQuestionBankSchema,
  createQuestionSchema,
  createTemplateDraftSchema,
  questionBankParams,
  replaceCourseAudienceSchema,
  prerequisiteSchema,
  revokeCertificateSchema,
} from "./training-advanced.validation";
import {
  lmsAssignmentParams,
  lmsBlockParams,
  learnerBlockParams,
  learnerBlockProgressSchema,
  lmsCourseParams,
  lmsLessonParams,
  lmsModuleParams,
  lmsVersionParams,
  certificateTokenParams,
  createBlockSchema,
  createLessonSchema,
  createModuleSchema,
  createProfessionalCourseSchema,
  publishVersionSchema,
  quizSubmissionSchema,
  validateAssignmentSchema,
  trainingAiAssistantSchema,
  applyAiOutlineSchema,
  updateBlockSchema,
} from "./lms.validation";
export const trainingRoutes = Router();
trainingRoutes.get(
  "/training-certificates/verify/:token",
  validate({ params: certificateTokenParams }),
  lmsController.publicCertificateVerification,
);

const inside = [
  authenticate,
  validate({ params: organizationParams }),
  requireOrganization,
] as const;

// Learner portal: the guard requires a linked active employee; services derive it again and scope every assignment to that employee.
trainingRoutes.get(
  "/organizations/:orgSlug/my-trainings",
  ...inside,
  requireActiveEmployeeProfile,
  controller.listMyTrainings,
);
trainingRoutes.get(
  "/organizations/:orgSlug/my-trainings/:assignmentId",
  authenticate,
  validate({ params: assignmentParams }),
  requireOrganization,
  requireActiveEmployeeProfile,
  controller.myTrainingDetail,
);
trainingRoutes.post(
  "/organizations/:orgSlug/my-trainings/:assignmentId/start",
  authenticate,
  validate({ params: assignmentParams }),
  requireOrganization,
  requireActiveEmployeeProfile,
  controller.startMyTraining,
);
trainingRoutes.patch(
  "/organizations/:orgSlug/my-trainings/:assignmentId/materials/:materialId/progress",
  authenticate,
  validate({ params: myTrainingMaterialParams }),
  requireOrganization,
  requireActiveEmployeeProfile,
  validate({ body: learnerLessonProgressSchema }),
  controller.updateMyTrainingMaterial,
);
trainingRoutes.post(
  "/organizations/:orgSlug/my-trainings/:assignmentId/submit",
  authenticate,
  validate({ params: assignmentParams }),
  requireOrganization,
  requireActiveEmployeeProfile,
  controller.submitMyTraining,
);
trainingRoutes.get(
  "/organizations/:orgSlug/my-trainings/:assignmentId/certificate",
  authenticate,
  validate({ params: assignmentParams }),
  requireOrganization,
  requireActiveEmployeeProfile,
  controller.myTrainingCertificate,
);
trainingRoutes.get(
  "/organizations/:orgSlug/my-trainings/:assignmentId/materials/:materialId/content",
  authenticate,
  validate({ params: myTrainingMaterialParams }),
  requireOrganization,
  requireActiveEmployeeProfile,
  controller.myTrainingMaterialContent,
);
trainingRoutes.get(
  "/organizations/:orgSlug/training-courses",
  ...inside,
  requirePermission("training.create"),
  controller.listCourses,
);
trainingRoutes.post(
  "/organizations/:orgSlug/training-courses",
  ...inside,
  requirePermission("training.create"),
  validate({ body: createCourseSchema }),
  controller.createCourse,
);
trainingRoutes.patch(
  "/organizations/:orgSlug/training-courses/:courseId",
  authenticate,
  validate({ params: courseParams }),
  requireOrganization,
  requirePermission("training.create"),
  validate({ body: updateCourseSchema }),
  controller.updateCourse,
);
trainingRoutes.get(
  "/organizations/:orgSlug/training-courses/:courseId/materials",
  authenticate,
  validate({ params: courseParams }),
  requireOrganization,
  requirePermission("training.create"),
  controller.listMaterials,
);
trainingRoutes.post(
  "/organizations/:orgSlug/training-courses/:courseId/materials",
  authenticate,
  validate({ params: courseParams }),
  requireOrganization,
  requirePermission("training.create"),
  validate({ body: createMaterialSchema }),
  controller.createMaterial,
);
trainingRoutes.patch(
  "/organizations/:orgSlug/training-materials/:materialId",
  authenticate,
  validate({ params: materialParams }),
  requireOrganization,
  requirePermission("training.create"),
  validate({ body: updateMaterialSchema }),
  controller.updateMaterial,
);
trainingRoutes.get(
  "/organizations/:orgSlug/training-assignments",
  ...inside,
  requirePermission("training.create"),
  validate({ query: assignmentQuery }),
  controller.listAssignments,
);
trainingRoutes.post(
  "/organizations/:orgSlug/training-assignments",
  ...inside,
  requirePermission("training.create"),
  validate({ body: createAssignmentSchema }),
  controller.createAssignments,
);
trainingRoutes.patch(
  "/organizations/:orgSlug/training-assignments/:assignmentId",
  authenticate,
  validate({ params: assignmentParams }),
  requireOrganization,
  requirePermission("training.create"),
  validate({ body: updateAssignmentSchema }),
  controller.updateAssignment,
);
trainingRoutes.get(
  "/organizations/:orgSlug/training-records",
  ...inside,
  requirePermission("training.create"),
  validate({ query: recordQuery }),
  controller.listRecords,
);
trainingRoutes.post(
  "/organizations/:orgSlug/training-records",
  ...inside,
  requirePermission("training.create"),
  validate({ body: createRecordSchema }),
  controller.createRecord,
);
trainingRoutes.get(
  "/organizations/:orgSlug/training-summary",
  ...inside,
  requirePermission("training.create"),
  controller.summary,
);
trainingRoutes.get(
  "/organizations/:orgSlug/training-me",
  ...inside,
  controller.currentEmployee,
);

trainingRoutes.post(
  "/organizations/:orgSlug/training-ai",
  ...inside,
  requirePermission("training.create"),
  validate({ body: trainingAiAssistantSchema }),
  lmsController.aiDraft,
);
// Advanced LMS administration. These routes are deliberately separate from the
// learner portal and all require the existing training.create permission.
trainingRoutes.get(
  "/organizations/:orgSlug/training-course-templates",
  ...inside,
  requirePermission("training.create"),
  advancedController.templates,
);
trainingRoutes.post(
  "/organizations/:orgSlug/training-course-templates/drafts",
  ...inside,
  requirePermission("training.create"),
  validate({ body: createTemplateDraftSchema }),
  advancedController.createTemplateDraft,
);
trainingRoutes.get(
  "/organizations/:orgSlug/training-question-banks",
  ...inside,
  requirePermission("training.create"),
  advancedController.questionBanks,
);
trainingRoutes.post(
  "/organizations/:orgSlug/training-question-banks",
  ...inside,
  requirePermission("training.create"),
  validate({ body: createQuestionBankSchema }),
  advancedController.createQuestionBank,
);
trainingRoutes.get(
  "/organizations/:orgSlug/training-question-banks/:bankId/questions",
  authenticate,
  validate({ params: questionBankParams }),
  requireOrganization,
  requirePermission("training.create"),
  advancedController.questions,
);
trainingRoutes.post(
  "/organizations/:orgSlug/training-question-banks/:bankId/questions",
  authenticate,
  validate({ params: questionBankParams, body: createQuestionSchema }),
  requireOrganization,
  requirePermission("training.create"),
  advancedController.createQuestion,
);
trainingRoutes.get(
  "/organizations/:orgSlug/training-courses/:courseId/audiences",
  authenticate,
  validate({ params: advancedCourseParams }),
  requireOrganization,
  requirePermission("training.create"),
  advancedController.courseAudiences,
);
trainingRoutes.put(
  "/organizations/:orgSlug/training-courses/:courseId/audiences",
  authenticate,
  validate({ params: advancedCourseParams, body: replaceCourseAudienceSchema }),
  requireOrganization,
  requirePermission("training.create"),
  advancedController.replaceAudiences,
);
trainingRoutes.get(
  "/organizations/:orgSlug/training-courses/:courseId/prerequisites",
  authenticate,
  validate({ params: advancedCourseParams }),
  requireOrganization,
  requirePermission("training.create"),
  advancedController.coursePrerequisites,
);
trainingRoutes.post(
  "/organizations/:orgSlug/training-courses/:courseId/prerequisites",
  authenticate,
  validate({ params: advancedCourseParams, body: prerequisiteSchema }),
  requireOrganization,
  requirePermission("training.create"),
  advancedController.addPrerequisite,
);
trainingRoutes.get(
  "/organizations/:orgSlug/training-manager-report",
  authenticate,
  validate({ params: advancedOrgParams }),
  requireOrganization,
  requirePermission("training.create"),
  advancedController.report,
);
trainingRoutes.patch(
  "/organizations/:orgSlug/training-certificates/:certificateId/revoke",
  authenticate,
  validate({ params: certificateParams, body: revokeCertificateSchema }),
  requireOrganization,
  requirePermission("training.create"),
  advancedController.revokeCertificate,
);
// Professional LMS builder. Existing catalogue routes remain available for legacy courses.
trainingRoutes.post(
  "/organizations/:orgSlug/professional-training-courses",
  ...inside,
  requirePermission("training.create"),
  validate({ body: createProfessionalCourseSchema }),
  lmsController.createCourse,
);
trainingRoutes.get(
  "/organizations/:orgSlug/training-courses/:courseId/builder",
  authenticate,
  validate({ params: lmsCourseParams }),
  requireOrganization,
  requirePermission("training.create"),
  lmsController.builder,
);
trainingRoutes.post(
  "/organizations/:orgSlug/training-courses/:courseId/ai-outline",
  authenticate,
  validate({ params: lmsCourseParams, body: applyAiOutlineSchema }),
  requireOrganization,
  requirePermission("training.create"),
  lmsController.importAiOutline,
);
trainingRoutes.post(
  "/organizations/:orgSlug/training-courses/:courseId/modules",
  authenticate,
  validate({ params: lmsCourseParams, body: createModuleSchema }),
  requireOrganization,
  requirePermission("training.create"),
  lmsController.addModule,
);
trainingRoutes.post(
  "/organizations/:orgSlug/training-modules/:moduleId/lessons",
  authenticate,
  validate({ params: lmsModuleParams, body: createLessonSchema }),
  requireOrganization,
  requirePermission("training.create"),
  lmsController.addLesson,
);
trainingRoutes.post(
  "/organizations/:orgSlug/training-lessons/:lessonId/blocks",
  authenticate,
  validate({ params: lmsLessonParams, body: createBlockSchema }),
  requireOrganization,
  requirePermission("training.create"),
  lmsController.addBlock,
);
trainingRoutes.patch(
  "/organizations/:orgSlug/training-blocks/:blockId",
  authenticate,
  validate({ params: lmsBlockParams, body: updateBlockSchema }),
  requireOrganization,
  requirePermission("training.create"),
  lmsController.updateBlock,
);
trainingRoutes.delete(
  "/organizations/:orgSlug/training-blocks/:blockId",
  authenticate,
  validate({ params: lmsBlockParams }),
  requireOrganization,
  requirePermission("training.create"),
  lmsController.deleteBlock,
);
trainingRoutes.post(
  "/organizations/:orgSlug/training-courses/:courseId/versions/:versionId/publish",
  authenticate,
  validate({ params: lmsVersionParams, body: publishVersionSchema }),
  requireOrganization,
  requirePermission("training.create"),
  lmsController.publish,
);
trainingRoutes.get(
  "/organizations/:orgSlug/my-trainings/:assignmentId/course",
  authenticate,
  validate({ params: lmsAssignmentParams }),
  requireOrganization,
  requireActiveEmployeeProfile,
  lmsController.learnerCourse,
);
trainingRoutes.patch(
  "/organizations/:orgSlug/my-trainings/:assignmentId/blocks/:blockId/progress",
  authenticate,
  validate({ params: learnerBlockParams, body: learnerBlockProgressSchema }),
  requireOrganization,
  requireActiveEmployeeProfile,
  lmsController.learnerBlockProgress,
);
trainingRoutes.post(
  "/organizations/:orgSlug/my-trainings/:assignmentId/blocks/:blockId/quiz-attempts",
  authenticate,
  validate({ params: learnerBlockParams, body: quizSubmissionSchema }),
  requireOrganization,
  requireActiveEmployeeProfile,
  lmsController.submitQuiz,
);
trainingRoutes.get(
  "/organizations/:orgSlug/my-trainings/:assignmentId/blocks/:blockId/content",
  authenticate,
  validate({ params: learnerBlockParams }),
  requireOrganization,
  requireActiveEmployeeProfile,
  lmsController.learnerBlockFile,
);
trainingRoutes.patch(
  "/organizations/:orgSlug/training-assignments/:assignmentId/professional-validation",
  authenticate,
  validate({ params: lmsAssignmentParams, body: validateAssignmentSchema }),
  requireOrganization,
  requirePermission("training.create"),
  lmsController.validateAssignment,
);
trainingRoutes.post(
  "/organizations/:orgSlug/training-courses/:courseId/revisions",
  authenticate,
  validate({ params: lmsCourseParams }),
  requireOrganization,
  requirePermission("training.create"),
  lmsController.createRevision,
);

trainingRoutes.get(
  "/organizations/:orgSlug/my-trainings/:assignmentId/professional-certificate.pdf",
  authenticate,
  validate({ params: lmsAssignmentParams }),
  requireOrganization,
  requireActiveEmployeeProfile,
  lmsController.learnerCertificatePdf,
);
