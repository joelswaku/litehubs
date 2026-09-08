import type { Request, RequestHandler } from "express";
import * as service from "./training.service";
import type {
  AssignmentQuery,
  CreateAssignmentInput,
  CreateCourseInput,
  CreateMaterialInput,
  CreateRecordInput,
  RecordQuery,
  UpdateAssignmentInput,
  UpdateCourseInput,
  UpdateMaterialInput,
} from "./training.validation";

function context(req: Request): service.TrainingContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
    permissions: req.membership!.permissions,
  };
}
function param(req: Request, key: string): string {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
export const listCourses: RequestHandler = async (req, res) =>
  res.json({ courses: await service.listCourses(context(req)) });
export const createCourse: RequestHandler = async (req, res) =>
  res.status(201).json({
    course: await service.createCourse(
      context(req),
      req.body as CreateCourseInput,
    ),
  });
export const updateCourse: RequestHandler = async (req, res) =>
  res.json({
    course: await service.updateCourse(
      context(req),
      param(req, "courseId"),
      req.body as UpdateCourseInput,
    ),
  });
export const listMaterials: RequestHandler = async (req, res) =>
  res.json({
    materials: await service.listMaterials(
      context(req),
      param(req, "courseId"),
    ),
  });
export const createMaterial: RequestHandler = async (req, res) =>
  res.status(201).json({
    material: await service.createMaterial(
      context(req),
      param(req, "courseId"),
      req.body as CreateMaterialInput,
    ),
  });
export const updateMaterial: RequestHandler = async (req, res) =>
  res.json({
    material: await service.updateMaterial(
      context(req),
      param(req, "materialId"),
      req.body as UpdateMaterialInput,
    ),
  });
export const listAssignments: RequestHandler = async (req, res) =>
  res.json({
    assignments: await service.listAssignments(
      context(req),
      req.query as AssignmentQuery,
    ),
  });
export const createAssignments: RequestHandler = async (req, res) =>
  res.status(201).json({
    assignments: await service.createAssignments(
      context(req),
      req.body as CreateAssignmentInput,
    ),
  });
export const updateAssignment: RequestHandler = async (req, res) =>
  res.json({
    assignment: await service.updateAssignment(
      context(req),
      param(req, "assignmentId"),
      req.body as UpdateAssignmentInput,
    ),
  });
export const listRecords: RequestHandler = async (req, res) =>
  res.json({
    records: await service.listRecords(context(req), req.query as RecordQuery),
  });
export const createRecord: RequestHandler = async (req, res) =>
  res.status(201).json({
    record: await service.createRecord(
      context(req),
      req.body as CreateRecordInput,
    ),
  });
export const summary: RequestHandler = async (req, res) =>
  res.json(await service.summary(context(req)));
export const currentEmployee: RequestHandler = async (req, res) =>
  res.json({ employee: await service.currentEmployee(context(req)) });

export const listMyTrainings: RequestHandler = async (req, res) =>
  res.json({ assignments: await service.listMyTrainings(context(req)) });
export const myTrainingDetail: RequestHandler = async (req, res) =>
  res.json(await service.myTrainingDetail(context(req), param(req, "assignmentId")));
export const startMyTraining: RequestHandler = async (req, res) =>
  res.json(await service.startMyTraining(context(req), param(req, "assignmentId")));
export const updateMyTrainingMaterial: RequestHandler = async (req, res) =>
  res.json(await service.updateMyTrainingMaterial(
    context(req),
    param(req, "assignmentId"),
    param(req, "materialId"),
    req.body as { opened?: boolean; completed?: boolean; acknowledged?: boolean; quizAnswers?: number[] },
  ));
export const submitMyTraining: RequestHandler = async (req, res) =>
  res.json(await service.submitMyTraining(context(req), param(req, "assignmentId")));
export const myTrainingCertificate: RequestHandler = async (req, res) =>
  res.json(await service.myTrainingCertificate(context(req), param(req, "assignmentId")));
export const myTrainingMaterialContent: RequestHandler = async (req, res) => {
  const file = await service.myTrainingMaterialFile(
    context(req),
    param(req, "assignmentId"),
    param(req, "materialId"),
  );
  res.type(file.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${file.fileName.replace(/[\r\n"]/g, "")}"`);
  res.send(file.buffer);
};