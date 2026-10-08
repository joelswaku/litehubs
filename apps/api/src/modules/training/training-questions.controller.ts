import type { Request, RequestHandler } from "express";
import * as service from "./training-questions.service";
import type { TrainingContext } from "./training.service";

function context(req: Request): TrainingContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
    permissions: req.membership!.permissions,
  };
}
const param = (req: Request, key: string) =>
  Array.isArray(req.params[key])
    ? req.params[key]![0]!
    : (req.params[key] ?? "");

export const lessonNotesAndQuestions: RequestHandler = async (req, res) =>
  res.json(
    await service.lessonNotesAndQuestions(
      context(req),
      param(req, "assignmentId"),
      param(req, "lessonId"),
    ),
  );

export const saveLessonNote: RequestHandler = async (req, res) =>
  res.json(
    await service.saveLessonNote(
      context(req),
      param(req, "assignmentId"),
      param(req, "lessonId"),
      String((req.body as { note: string }).note ?? ""),
    ),
  );

export const askLessonQuestion: RequestHandler = async (req, res) =>
  res.status(201).json({
    question: await service.askLessonQuestion(
      context(req),
      param(req, "assignmentId"),
      param(req, "lessonId"),
      String((req.body as { question: string }).question),
    ),
  });

export const listLessonQuestions: RequestHandler = async (req, res) =>
  res.json({
    questions: await service.listLessonQuestions(
      context(req),
      (req.query.status as "open" | "answered" | "all" | undefined) ?? "all",
    ),
  });

export const answerLessonQuestion: RequestHandler = async (req, res) =>
  res.json({
    question: await service.answerLessonQuestion(
      context(req),
      param(req, "questionId"),
      String((req.body as { answer: string }).answer),
    ),
  });
