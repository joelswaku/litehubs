import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import {
  requireOwner,
  requirePermission,
} from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./company-setup.controller";
import {
  createDepartmentSchema,
  createInvitationSchema,
  createProvinceSchema,
  createRoleSchema,
  createSiteSchema,
  departmentParams,
  invitationParams,
  memberParams,
  organizationParams,
  provinceParams,
  replaceMemberProvincesSchema,
  replaceMemberRolesSchema,
  roleParams,
  siteParams,
  updateDepartmentSchema,
  updateProvinceSchema,
  updateRoleSchema,
  updateSiteSchema,
} from "./company-setup.validation";

export const companySetupRoutes = Router();

const inOrganization = [
  authenticate,
  validate({ params: organizationParams }),
  requireOrganization,
] as const;

// ------------------------------------------------------------- locations ----

companySetupRoutes.get(
  "/organizations/:orgSlug/provinces",
  ...inOrganization,
  requirePermission("sites.read"),
  controller.listProvinces,
);

companySetupRoutes.post(
  "/organizations/:orgSlug/provinces",
  ...inOrganization,
  requireOwner,
  requirePermission("sites.create"),
  validate({ body: createProvinceSchema }),
  controller.createProvince,
);

companySetupRoutes.patch(
  "/organizations/:orgSlug/provinces/:provinceId",
  authenticate,
  validate({ params: provinceParams }),
  requireOrganization,
  requireOwner,
  requirePermission("sites.update"),
  validate({ body: updateProvinceSchema }),
  controller.updateProvince,
);

companySetupRoutes.delete(
  "/organizations/:orgSlug/provinces/:provinceId",
  authenticate,
  validate({ params: provinceParams }),
  requireOrganization,
  requireOwner,
  requirePermission("sites.delete"),
  controller.deleteProvince,
);

companySetupRoutes.get(
  "/organizations/:orgSlug/sites",
  ...inOrganization,
  requirePermission("sites.read"),
  controller.listSites,
);

companySetupRoutes.post(
  "/organizations/:orgSlug/sites",
  ...inOrganization,
  requireOwner,
  requirePermission("sites.create"),
  validate({ body: createSiteSchema }),
  controller.createSite,
);

companySetupRoutes.patch(
  "/organizations/:orgSlug/sites/:siteId",
  authenticate,
  validate({ params: siteParams }),
  requireOrganization,
  requireOwner,
  requirePermission("sites.update"),
  validate({ body: updateSiteSchema }),
  controller.updateSite,
);

companySetupRoutes.delete(
  "/organizations/:orgSlug/sites/:siteId",
  authenticate,
  validate({ params: siteParams }),
  requireOrganization,
  requireOwner,
  requirePermission("sites.delete"),
  controller.deleteSite,
);

companySetupRoutes.get(
  "/organizations/:orgSlug/departments",
  ...inOrganization,
  requirePermission("departments.read"),
  controller.listDepartments,
);

companySetupRoutes.post(
  "/organizations/:orgSlug/departments",
  ...inOrganization,
  requirePermission("departments.create"),
  validate({ body: createDepartmentSchema }),
  controller.createDepartment,
);

companySetupRoutes.patch(
  "/organizations/:orgSlug/departments/:departmentId",
  authenticate,
  validate({ params: departmentParams }),
  requireOrganization,
  requirePermission("departments.update"),
  validate({ body: updateDepartmentSchema }),
  controller.updateDepartment,
);

companySetupRoutes.delete(
  "/organizations/:orgSlug/departments/:departmentId",
  authenticate,
  validate({ params: departmentParams }),
  requireOrganization,
  requirePermission("departments.delete"),
  controller.deleteDepartment,
);

// ----------------------------------------------------------------- roles ----

companySetupRoutes.get(
  "/organizations/:orgSlug/roles",
  ...inOrganization,
  requirePermission("roles.read"),
  controller.listRoles,
);

companySetupRoutes.get(
  "/organizations/:orgSlug/permissions",
  ...inOrganization,
  requirePermission("roles.read"),
  controller.listPermissions,
);

companySetupRoutes.post(
  "/organizations/:orgSlug/roles",
  ...inOrganization,
  requireOwner,
  requirePermission("roles.create"),
  validate({ body: createRoleSchema }),
  controller.createRole,
);

companySetupRoutes.patch(
  "/organizations/:orgSlug/roles/:roleId",
  authenticate,
  validate({ params: roleParams }),
  requireOrganization,
  requireOwner,
  requirePermission("roles.update"),
  validate({ body: updateRoleSchema }),
  controller.updateRole,
);

companySetupRoutes.delete(
  "/organizations/:orgSlug/roles/:roleId",
  authenticate,
  validate({ params: roleParams }),
  requireOrganization,
  requireOwner,
  requirePermission("roles.delete"),
  controller.deleteRole,
);

// ---------------------------------------------------------- team members ----

companySetupRoutes.get(
  "/organizations/:orgSlug/members",
  ...inOrganization,
  requirePermission("members.read"),
  controller.listMembers,
);

companySetupRoutes.put(
  "/organizations/:orgSlug/members/:memberId/roles",
  authenticate,
  validate({ params: memberParams }),
  requireOrganization,
  requireOwner,
  requirePermission("members.update"),
  validate({ body: replaceMemberRolesSchema }),
  controller.replaceMemberRoles,
);

companySetupRoutes.put(
  "/organizations/:orgSlug/members/:memberId/provinces",
  authenticate,
  validate({ params: memberParams }),
  requireOrganization,
  requireOwner,
  requirePermission("members.update"),
  validate({ body: replaceMemberProvincesSchema }),
  controller.replaceMemberProvinces,
);

// ------------------------------------------------------------- invitations ----

companySetupRoutes.get(
  "/organizations/:orgSlug/invitations",
  ...inOrganization,
  requirePermission("invitations.read"),
  controller.listInvitations,
);

companySetupRoutes.post(
  "/organizations/:orgSlug/invitations",
  ...inOrganization,
  requireOwner,
  requirePermission("invitations.create"),
  validate({ body: createInvitationSchema }),
  controller.createInvitation,
);

companySetupRoutes.delete(
  "/organizations/:orgSlug/invitations/:invitationId",
  authenticate,
  validate({ params: invitationParams }),
  requireOrganization,
  requireOwner,
  requirePermission("invitations.update"),
  controller.revokeInvitation,
);
