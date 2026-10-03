import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { requireActiveEmployeeProfile, requirePermission } from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./employee.controller";
import {
  createEmployeeSchema,
  employeeDossierDocumentSchema,
  employeeCreationAllowanceProvinceParams,
  employeeParams,
  organizationParams,
  setEmployeeCreationAllowanceSchema,
  updateEmployeeSchema,
} from "./employee.validation";

export const employeeRoutes = Router();

const inOrganization = [
  authenticate,
  validate({ params: organizationParams }),
  requireOrganization,
] as const;

employeeRoutes.get(
  "/organizations/:orgSlug/employees",
  ...inOrganization,
  requirePermission("employees.read"),
  controller.listEmployees,
);

employeeRoutes.get(
  "/organizations/:orgSlug/hr-reports/:report.pdf",
  ...inOrganization,
  controller.downloadHrReport,
);

// Personal employee workspace. This route has self-service access only and
// never exposes the company directory or payroll register.
employeeRoutes.get(
  "/organizations/:orgSlug/my-account",
  ...inOrganization,
  requireActiveEmployeeProfile,
  controller.getMyAccount,
);

employeeRoutes.post(
  "/organizations/:orgSlug/employees",
  ...inOrganization,
  requirePermission("employees.create"),
  validate({ body: createEmployeeSchema }),
  controller.createEmployee,
);

// This is intentionally separate from the directory. Only the employee
// service permits Owner/HR to receive the private recruitment bridge.
employeeRoutes.get(
  "/organizations/:orgSlug/employees/recruitment-candidates",
  ...inOrganization,
  requirePermission("employees.create"),
  controller.listRecruitmentCandidates,
);

employeeRoutes.get(
  "/organizations/:orgSlug/employees/:employeeId",
  authenticate,
  validate({ params: employeeParams }),
  requireOrganization,
  requirePermission("employees.read"),
  controller.getEmployee,
);

// Identity, permits, contracts and payslips are one confidential employee
// dossier. The service further limits this to Owner/HR Officer, even when a
// caller can see the general employee directory.
employeeRoutes.get(
  "/organizations/:orgSlug/employees/:employeeId/dossier",
  authenticate,
  validate({ params: employeeParams }),
  requireOrganization,
  requirePermission("employees.read"),
  controller.listEmployeeDossierDocuments,
);
employeeRoutes.post(
  "/organizations/:orgSlug/employees/:employeeId/dossier/documents",
  authenticate,
  validate({ params: employeeParams, body: employeeDossierDocumentSchema }),
  requireOrganization,
  requirePermission("employees.update"),
  controller.linkEmployeeDossierDocument,
);

employeeRoutes.patch(
  "/organizations/:orgSlug/employees/:employeeId",
  authenticate,
  validate({ params: employeeParams }),
  requireOrganization,
  requirePermission("employees.update"),
  validate({ body: updateEmployeeSchema }),
  controller.updateEmployee,
);

employeeRoutes.delete(
  "/organizations/:orgSlug/employees/:employeeId",
  authenticate,
  validate({ params: employeeParams }),
  requireOrganization,
  requirePermission("employees.delete"),
  controller.deleteEmployee,
);
// Owner-managed creation limits. A non-owner can only read their own allowance;
// mutations are checked again in the service with the active membership.
employeeRoutes.get(
  "/organizations/:orgSlug/employee-creation-allowances",
  ...inOrganization,
  requirePermission("employees.read"),
  controller.listEmployeeCreationAllowances,
);

employeeRoutes.put(
  "/organizations/:orgSlug/employee-creation-allowances/:memberId/provinces/:provinceId",
  authenticate,
  validate({ params: employeeCreationAllowanceProvinceParams }),
  requireOrganization,
  requirePermission("members.update"),
  validate({ body: setEmployeeCreationAllowanceSchema }),
  controller.setEmployeeCreationAllowance,
);

employeeRoutes.delete(
  "/organizations/:orgSlug/employee-creation-allowances/:memberId/provinces/:provinceId",
  authenticate,
  validate({ params: employeeCreationAllowanceProvinceParams }),
  requireOrganization,
  requirePermission("members.update"),
  controller.deleteEmployeeCreationAllowance,
);
