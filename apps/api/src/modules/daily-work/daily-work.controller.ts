import type { Request, RequestHandler } from "express";
import * as service from "./daily-work.service";
import type { DailyWorkQuery } from "./daily-work.validation";
const contextOf = (req: Request): service.DailyWorkContext => ({
  organizationId: req.organization!.id,
  userId: req.user!.id,
  memberId: req.membership!.memberId,
  isOwner: req.membership!.isOwner,
});
const parameter = (req: Request, name: string) =>
  Array.isArray(req.params[name])
    ? (req.params[name][0] ?? "")
    : (req.params[name] ?? "");
export const overview: RequestHandler = async (req, res) =>
  res.json({
    overview: await service.overview(
      contextOf(req),
      req.query as unknown as DailyWorkQuery,
    ),
  });
export const listTemplates: RequestHandler = async (req, res) =>
  res.json({
    templates: await service.listTemplates(
      contextOf(req),
      req.query as unknown as DailyWorkQuery,
    ),
  });
export const createTemplate: RequestHandler = async (req, res) =>
  res
    .status(201)
    .json({ template: await service.createTemplate(contextOf(req), req.body) });
export const updateTemplate: RequestHandler = async (req, res) =>
  res.json({
    template: await service.updateTemplate(
      contextOf(req),
      parameter(req, "templateId"),
      req.body,
    ),
  });
export const deleteTemplate: RequestHandler = async (req, res) => {
  await service.deleteTemplate(contextOf(req), parameter(req, "templateId"));
  res.status(204).send();
};
export const createTemplateItem: RequestHandler = async (req, res) =>
  res
    .status(201)
    .json({
      item: await service.createTemplateItem(
        contextOf(req),
        parameter(req, "templateId"),
        req.body,
      ),
    });
export const updateTemplateItem: RequestHandler = async (req, res) =>
  res.json({
    item: await service.updateTemplateItem(
      contextOf(req),
      parameter(req, "templateId"),
      parameter(req, "itemId"),
      req.body,
    ),
  });
export const deleteTemplateItem: RequestHandler = async (req, res) => {
  await service.deleteTemplateItem(
    contextOf(req),
    parameter(req, "templateId"),
    parameter(req, "itemId"),
  );
  res.status(204).send();
};
export const listRuns: RequestHandler = async (req, res) =>
  res.json({
    runs: await service.listRuns(
      contextOf(req),
      req.query as unknown as DailyWorkQuery,
    ),
  });
export const createRun: RequestHandler = async (req, res) =>
  res
    .status(201)
    .json({ run: await service.createRun(contextOf(req), req.body) });
export const getRun: RequestHandler = async (req, res) =>
  res.json({
    run: await service.getRun(contextOf(req), parameter(req, "runId")),
  });
export const answerRunItem: RequestHandler = async (req, res) =>
  res.json({
    run: await service.answerRunItem(
      contextOf(req),
      parameter(req, "runId"),
      parameter(req, "itemId"),
      req.body,
    ),
  });
export const completeRun: RequestHandler = async (req, res) =>
  res.json({
    run: await service.completeRun(contextOf(req), parameter(req, "runId")),
  });
export const verifyRun: RequestHandler = async (req, res) =>
  res.json({
    run: await service.verifyRun(contextOf(req), parameter(req, "runId")),
  });
export const listReports: RequestHandler = async (req, res) =>
  res.json({
    reports: await service.listReports(
      contextOf(req),
      req.query as unknown as DailyWorkQuery,
    ),
  });
export const createReport: RequestHandler = async (req, res) =>
  res
    .status(201)
    .json({ report: await service.createReport(contextOf(req), req.body) });
export const updateReport: RequestHandler = async (req, res) =>
  res.json({
    report: await service.updateReport(
      contextOf(req),
      parameter(req, "reportId"),
      req.body,
    ),
  });
export const reviewReport: RequestHandler = async (req, res) =>
  res.json({
    report: await service.reviewReport(
      contextOf(req),
      parameter(req, "reportId"),
      req.body,
    ),
  });
export const listHandovers: RequestHandler = async (req, res) =>
  res.json({
    handovers: await service.listHandovers(
      contextOf(req),
      req.query as unknown as DailyWorkQuery,
    ),
  });
export const createHandover: RequestHandler = async (req, res) =>
  res
    .status(201)
    .json({ handover: await service.createHandover(contextOf(req), req.body) });
export const acknowledgeHandover: RequestHandler = async (req, res) =>
  res.json({
    handover: await service.acknowledgeHandover(
      contextOf(req),
      parameter(req, "handoverId"),
    ),
  });
