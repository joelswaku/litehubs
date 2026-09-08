import type { Request, RequestHandler } from "express";
import * as service from "./employee.service";
import * as reports from "./hr-report.service";
import * as authService from "../auth/auth.service";
import type {
  CreateEmployeeInput,
  UpdateEmployeeInput,
} from "./employee.validation";

function contextOf(req: Request): service.EmployeeContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
  };
}

function parameter(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export const listEmployees: RequestHandler = async (req, res) => {
  res.json({ employees: await service.listEmployees(contextOf(req)) });
};

function reportContext(req: Request): reports.HrReportContext {
  return {
    ...contextOf(req),
    permissions: req.membership!.permissions,
  };
}

export const downloadHrReport: RequestHandler = async (req, res) => {
  const report = parameter(req, "report");
  reports.assertHrReportKind(report);
  const french = String(req.query.lang ?? "fr").toLowerCase() !== "en";
  const employeeId = String(req.query.employeeId ?? "").trim() || undefined;
  const pdf = await reports.exportHrReport(reportContext(req), report, {
    employeeId,
    french,
  });
  res
    .status(200)
    .type("application/pdf")
    .setHeader("Content-Disposition", `attachment; filename="${report}-report.pdf"`)
    .send(pdf);
};

export const getMyAccount: RequestHandler = async (req, res) => {
  res.json({ account: await service.getMyAccount(contextOf(req)) });
};

export const getEmployee: RequestHandler = async (req, res) => {
  res.json({
    employee: await service.getEmployee(
      contextOf(req),
      parameter(req, "employeeId"),
    ),
  });
};

export const createEmployee: RequestHandler = async (req, res) => {
  const employee = await service.createEmployee(
    contextOf(req),
    req.body as CreateEmployeeInput,
  );
  res.status(201).json({ employee });
};

export const updateEmployee: RequestHandler = async (req, res) => {
  const input = req.body as UpdateEmployeeInput;
  const employee = await service.updateEmployee(
    contextOf(req),
    parameter(req, "employeeId"),
    input,
  );
  if (input.loginEmail) {
    // The old login sessions were revoked by the employee service. The new
    // mailbox receives a one-time password setup link, never a password.
    await authService.requestPasswordReset(input.loginEmail, {
      ipAddress: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
  }
  res.json({ employee, loginEmailResetSent: Boolean(input.loginEmail) });
};

export const deleteEmployee: RequestHandler = async (req, res) => {
  await service.deleteEmployee(contextOf(req), parameter(req, "employeeId"));
  res.status(204).send();
};
export const listEmployeeCreationAllowances: RequestHandler = async (
  req,
  res,
) => {
  res.json({
    allowances: await service.listEmployeeCreationAllowances(contextOf(req)),
  });
};

export const setEmployeeCreationAllowance: RequestHandler = async (
  req,
  res,
) => {
  res.json({
    allowance: await service.setEmployeeCreationAllowance(
      contextOf(req),
      parameter(req, "memberId"),
      parameter(req, "provinceId"),
      req.body as { maxEmployees: number },
    ),
  });
};

export const deleteEmployeeCreationAllowance: RequestHandler = async (
  req,
  res,
) => {
  await service.deleteEmployeeCreationAllowance(
    contextOf(req),
    parameter(req, "memberId"),
    parameter(req, "provinceId"),
  );
  res.status(204).send();
};
