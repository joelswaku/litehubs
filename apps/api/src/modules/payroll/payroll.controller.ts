import type { Request, RequestHandler } from "express";
import * as service from "./payroll.service";
import type {
  CreateCompensationInput,
  CreateComponentInput,
  CreateEmployeeComponentInput,
  CreateRunInput,
  CreateRunExclusionInput,
  MarkPaidInput,
  RunQuery,
  UpdateCompensationInput,
  UpdateComponentInput,
  UpdateEmployeeComponentInput,
  UpdateRunInput,
} from "./payroll.validation";
function context(req: Request): service.PayrollContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
    permissions: req.membership!.permissions,
  };
}
function param(req: Request, key: string) {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
export const listComponents: RequestHandler = async (req, res) =>
  res.json({ components: await service.listComponents(context(req)) });
export const createComponent: RequestHandler = async (req, res) =>
  res.status(201).json({
    component: await service.createComponent(
      context(req),
      req.body as CreateComponentInput,
    ),
  });
export const updateComponent: RequestHandler = async (req, res) =>
  res.json({
    component: await service.updateComponent(
      context(req),
      param(req, "componentId"),
      req.body as UpdateComponentInput,
    ),
  });
export const listCompensations: RequestHandler = async (req, res) =>
  res.json({ compensations: await service.listCompensations(context(req)) });
export const createCompensation: RequestHandler = async (req, res) =>
  res.status(201).json({
    compensation: await service.createCompensation(
      context(req),
      req.body as CreateCompensationInput,
    ),
  });
export const updateCompensation: RequestHandler = async (req, res) =>
  res.json({
    compensation: await service.updateCompensation(
      context(req),
      param(req, "compensationId"),
      req.body as UpdateCompensationInput,
    ),
  });
export const listEmployeeComponents: RequestHandler = async (req, res) =>
  res.json({ assignments: await service.listEmployeeComponents(context(req)) });
export const createEmployeeComponent: RequestHandler = async (req, res) =>
  res.status(201).json({
    assignment: await service.createEmployeeComponent(
      context(req),
      req.body as CreateEmployeeComponentInput,
    ),
  });
export const updateEmployeeComponent: RequestHandler = async (req, res) =>
  res.json({
    assignment: await service.updateEmployeeComponent(
      context(req),
      param(req, "employeeComponentId"),
      req.body as UpdateEmployeeComponentInput,
    ),
  });
export const listRuns: RequestHandler = async (req, res) =>
  res.json({
    payrollRuns: await service.listRuns(context(req), req.query as RunQuery),
  });
export const createRun: RequestHandler = async (req, res) =>
  res.status(201).json({
    payrollRun: await service.createRun(
      context(req),
      req.body as CreateRunInput,
    ),
  });
export const updateRun: RequestHandler = async (req, res) =>
  res.json({
    payrollRun: await service.updateRun(
      context(req),
      param(req, "runId"),
      req.body as UpdateRunInput,
    ),
  });
export const listRunExclusions: RequestHandler = async (req, res) =>
  res.json({
    exclusions: await service.listRunExclusions(
      context(req),
      param(req, "runId"),
    ),
  });
export const excludeEmployeeFromRun: RequestHandler = async (req, res) =>
  res.json({
    payrollRun: await service.excludeEmployeeFromRun(
      context(req),
      param(req, "runId"),
      req.body as CreateRunExclusionInput,
    ),
  });
export const includeEmployeeInRun: RequestHandler = async (req, res) =>
  res.json({
    payrollRun: await service.includeEmployeeInRun(
      context(req),
      param(req, "runId"),
      param(req, "employeeId"),
    ),
  });
export const calculateRun: RequestHandler = async (req, res) =>
  res.json({
    payrollRun: await service.calculateRun(context(req), param(req, "runId")),
  });
export const approveRun: RequestHandler = async (req, res) =>
  res.json({
    payrollRun: await service.approveRun(context(req), param(req, "runId")),
  });
export const rejectRun: RequestHandler = async (req, res) =>
  res.json({
    payrollRun: await service.rejectRun(
      context(req),
      param(req, "runId"),
      String(req.body?.notes ?? "").trim() || null,
    ),
  });
export const markPaid: RequestHandler = async (req, res) =>
  res.json({
    payrollRun: await service.markPaid(
      context(req),
      param(req, "runId"),
      req.body as MarkPaidInput,
    ),
  });
export const listPayslips: RequestHandler = async (req, res) =>
  res.json({
    payslips: await service.listPayslips(context(req), param(req, "runId")),
  });
export const downloadPayslipPdf: RequestHandler = async (req, res) => {
  const french = String(req.query.lang ?? "fr").toLowerCase() !== "en";
  const pdf = await service.exportPayslipPdf(
    context(req),
    param(req, "payslipId"),
    french,
  );
  res
    .status(200)
    .type("application/pdf")
    .setHeader("Content-Disposition", `attachment; filename="${pdf.fileName}"`)
    .send(pdf.buffer);
};
export const summary: RequestHandler = async (req, res) =>
  res.json({ summary: await service.summary(context(req)) });
