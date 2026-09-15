import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permissions.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./payroll.controller";
import {
  componentParams,
  compensationParams,
  createCompensationSchema,
  createComponentSchema,
  createEmployeeComponentSchema,
  createRunSchema,
  createRunExclusionSchema,
  employeeComponentParams,
  markPaidSchema,
  payslipParams,
  organizationParams,
  rejectRunSchema,
  runParams,
  runExclusionParams,
  runQuery,
  updateCompensationSchema,
  updateComponentSchema,
  updateEmployeeComponentSchema,
  updateRunSchema,
} from "./payroll.validation";
export const payrollRoutes = Router();
const inside = [
  authenticate,
  validate({ params: organizationParams }),
  requireOrganization,
] as const;
payrollRoutes.get(
  "/organizations/:orgSlug/payroll-components",
  ...inside,
  requirePermission("payroll.read"),
  controller.listComponents,
);
payrollRoutes.post(
  "/organizations/:orgSlug/payroll-components",
  ...inside,
  requirePermission("payroll.create"),
  validate({ body: createComponentSchema }),
  controller.createComponent,
);
payrollRoutes.patch(
  "/organizations/:orgSlug/payroll-components/:componentId",
  authenticate,
  validate({ params: componentParams }),
  requireOrganization,
  requirePermission("payroll.update"),
  validate({ body: updateComponentSchema }),
  controller.updateComponent,
);
payrollRoutes.get(
  "/organizations/:orgSlug/employee-compensation",
  ...inside,
  requirePermission("payroll.read"),
  controller.listCompensations,
);
payrollRoutes.post(
  "/organizations/:orgSlug/employee-compensation",
  ...inside,
  requirePermission("payroll.create"),
  validate({ body: createCompensationSchema }),
  controller.createCompensation,
);
payrollRoutes.patch(
  "/organizations/:orgSlug/employee-compensation/:compensationId",
  authenticate,
  validate({ params: compensationParams }),
  requireOrganization,
  requirePermission("payroll.update"),
  validate({ body: updateCompensationSchema }),
  controller.updateCompensation,
);
payrollRoutes.get(
  "/organizations/:orgSlug/employee-payroll-components",
  ...inside,
  requirePermission("payroll.read"),
  controller.listEmployeeComponents,
);
payrollRoutes.post(
  "/organizations/:orgSlug/employee-payroll-components",
  ...inside,
  requirePermission("payroll.create"),
  validate({ body: createEmployeeComponentSchema }),
  controller.createEmployeeComponent,
);
payrollRoutes.patch(
  "/organizations/:orgSlug/employee-payroll-components/:employeeComponentId",
  authenticate,
  validate({ params: employeeComponentParams }),
  requireOrganization,
  requirePermission("payroll.update"),
  validate({ body: updateEmployeeComponentSchema }),
  controller.updateEmployeeComponent,
);
payrollRoutes.get(
  "/organizations/:orgSlug/payroll-runs",
  ...inside,
  requirePermission("payroll.read"),
  validate({ query: runQuery }),
  controller.listRuns,
);
payrollRoutes.post(
  "/organizations/:orgSlug/payroll-runs",
  ...inside,
  requirePermission("payroll.create"),
  validate({ body: createRunSchema }),
  controller.createRun,
);
payrollRoutes.patch(
  "/organizations/:orgSlug/payroll-runs/:runId",
  authenticate,
  validate({ params: runParams }),
  requireOrganization,
  requirePermission("payroll.update"),
  validate({ body: updateRunSchema }),
  controller.updateRun,
);
payrollRoutes.get(
  "/organizations/:orgSlug/payroll-runs/:runId/exclusions",
  authenticate,
  validate({ params: runParams }),
  requireOrganization,
  requirePermission("payroll.read"),
  controller.listRunExclusions,
);
payrollRoutes.post(
  "/organizations/:orgSlug/payroll-runs/:runId/exclusions",
  authenticate,
  validate({ params: runParams }),
  requireOrganization,
  requirePermission("payroll.update"),
  validate({ body: createRunExclusionSchema }),
  controller.excludeEmployeeFromRun,
);
payrollRoutes.delete(
  "/organizations/:orgSlug/payroll-runs/:runId/exclusions/:employeeId",
  authenticate,
  validate({ params: runExclusionParams }),
  requireOrganization,
  requirePermission("payroll.update"),
  controller.includeEmployeeInRun,
);
payrollRoutes.post(
  "/organizations/:orgSlug/payroll-runs/:runId/calculate",
  authenticate,
  validate({ params: runParams }),
  requireOrganization,
  requirePermission("payroll.create"),
  controller.calculateRun,
);
payrollRoutes.post(
  "/organizations/:orgSlug/payroll-runs/:runId/approve",
  authenticate,
  validate({ params: runParams }),
  requireOrganization,
  requirePermission("payroll.approve"),
  controller.approveRun,
);
payrollRoutes.post(
  "/organizations/:orgSlug/payroll-runs/:runId/reject",
  authenticate,
  validate({ params: runParams }),
  requireOrganization,
  requirePermission("payroll.reject"),
  validate({ body: rejectRunSchema }),
  controller.rejectRun,
);
payrollRoutes.post(
  "/organizations/:orgSlug/payroll-runs/:runId/mark-paid",
  authenticate,
  validate({ params: runParams }),
  requireOrganization,
  requirePermission("payroll.approve"),
  validate({ body: markPaidSchema }),
  controller.markPaid,
);
payrollRoutes.get(
  "/organizations/:orgSlug/payroll-runs/:runId/payslips",
  authenticate,
  validate({ params: runParams }),
  requireOrganization,
  requirePermission("payroll.read"),
  controller.listPayslips,
);
payrollRoutes.get(
  "/organizations/:orgSlug/payslips/:payslipId/pdf",
  authenticate,
  validate({ params: payslipParams }),
  requireOrganization,
  requirePermission("payroll.read"),
  controller.downloadPayslipPdf,
);
payrollRoutes.get(
  "/organizations/:orgSlug/payroll-summary",
  ...inside,
  requirePermission("payroll.read"),
  controller.summary,
);
