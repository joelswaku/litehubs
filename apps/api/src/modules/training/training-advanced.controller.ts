import type { Request, RequestHandler } from "express";
import type { TrainingContext } from "./training.service";
import * as service from "./training-advanced.service";
import type {
  CreateQuestionBankInput,
  CreateQuestionInput,
  CreateTemplateDraftInput,
  CourseAudienceInput,
} from "./training-advanced.validation";

const context = (req: Request): TrainingContext => ({
  organizationId: req.organization!.id,
  userId: req.user!.id,
  memberId: req.membership!.memberId,
  isOwner: req.membership!.isOwner,
  permissions: req.membership!.permissions,
});
const param = (req: Request, key: string) =>
  Array.isArray(req.params[key])
    ? req.params[key]![0]!
    : (req.params[key] ?? "");

export const templates: RequestHandler = async (_req, res) =>
  res.json({ templates: service.listCourseTemplates() });
export const createTemplateDraft: RequestHandler = async (req, res) =>
  res.status(201).json({
    course: await service.createCourseDraftFromTemplate(
      context(req),
      req.body as CreateTemplateDraftInput,
    ),
  });
export const questionBanks: RequestHandler = async (req, res) =>
  res.json({ questionBanks: await service.listQuestionBanks(context(req)) });
export const createQuestionBank: RequestHandler = async (req, res) =>
  res.status(201).json({
    questionBank: await service.createQuestionBank(
      context(req),
      req.body as CreateQuestionBankInput,
    ),
  });
export const questions: RequestHandler = async (req, res) =>
  res.json({
    questions: await service.listQuestions(context(req), param(req, "bankId")),
  });
export const createQuestion: RequestHandler = async (req, res) =>
  res.status(201).json({
    question: await service.createQuestion(
      context(req),
      param(req, "bankId"),
      req.body as CreateQuestionInput,
    ),
  });
export const courseAudiences: RequestHandler = async (req, res) =>
  res.json({
    audiences: await service.listCourseAudiences(
      context(req),
      param(req, "courseId"),
    ),
  });
export const replaceAudiences: RequestHandler = async (req, res) =>
  res.json({
    audiences: await service.replaceCourseAudiences(
      context(req),
      param(req, "courseId"),
      (req.body as { audiences: CourseAudienceInput[] }).audiences,
    ),
  });
export const coursePrerequisites: RequestHandler = async (req, res) =>
  res.json({
    prerequisites: await service.listCoursePrerequisites(
      context(req),
      param(req, "courseId"),
    ),
  });
export const addPrerequisite: RequestHandler = async (req, res) =>
  res.status(201).json({
    prerequisite: await service.addCoursePrerequisite(
      context(req),
      param(req, "courseId"),
      (req.body as { prerequisiteCourseId: string }).prerequisiteCourseId,
    ),
  });
export const report: RequestHandler = async (req, res) =>
  res.json({ report: await service.trainingManagerReport(context(req)) });
export const revokeCertificate: RequestHandler = async (req, res) =>
  res.json({
    certificate: await service.revokeCertificate(
      context(req),
      param(req, "certificateId"),
      (req.body as { reason: string }).reason,
    ),
  });
