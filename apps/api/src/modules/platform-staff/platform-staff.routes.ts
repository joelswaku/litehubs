import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import {
  requirePlatformPermission,
  requirePlatformRole,
  requirePlatformStaff,
} from "../../middleware/platform.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./platform-staff.controller";
import * as tenants from "./platform-tenants.controller";
import {
  createStaffUserBody,
  staffUserParams,
  updateStaffRolesBody,
  updateStaffStatusBody,
} from "./platform-staff.validation";
import {
  confirmTenantDeletionBody,
  listTenantsQuery,
  setTenantStatusBody,
  tenantSlugParams,
} from "./platform-tenants.validation";

export const platformStaffRoutes = Router();

/* -------------------------------------------------------- tenant registry -- */
/* Gated on platform.* permissions rather than a role code, so a customer-facing
   support tier can be given read access without being made an admin.           */

platformStaffRoutes.get(
  "/platform/summary",
  authenticate,
  requirePlatformStaff,
  tenants.summary,
);

platformStaffRoutes.get(
  "/platform/organizations",
  authenticate,
  requirePlatformPermission("platform.organizations.read"),
  validate({ query: listTenantsQuery }),
  tenants.listTenants,
);

platformStaffRoutes.get(
  "/platform/organizations/:slug",
  authenticate,
  requirePlatformPermission("platform.organizations.read"),
  validate({ params: tenantSlugParams }),
  tenants.getTenant,
);

// Suspending a tenant stops its staff working, so it needs its own permission —
// read access does not confer it.
platformStaffRoutes.patch(
  "/platform/organizations/:slug/status",
  authenticate,
  requirePlatformPermission("platform.organizations.update"),
  validate({ params: tenantSlugParams, body: setTenantStatusBody }),
  tenants.setStatus,
);

// Company removal is intentionally not a general organizations.update action.
// Only a Platform Super Admin can inspect deletion counts, schedule removal,
// restore a workspace, or execute the post-retention purge.
platformStaffRoutes.get(
  "/platform/organizations/:slug/deletion-context",
  authenticate,
  requirePlatformRole("platform_super_admin"),
  validate({ params: tenantSlugParams }),
  tenants.getDeletionContext,
);

platformStaffRoutes.post(
  "/platform/organizations/:slug/deletion",
  authenticate,
  requirePlatformRole("platform_super_admin"),
  validate({ params: tenantSlugParams, body: confirmTenantDeletionBody }),
  tenants.scheduleDeletion,
);

platformStaffRoutes.delete(
  "/platform/organizations/:slug/deletion",
  authenticate,
  requirePlatformRole("platform_super_admin"),
  validate({ params: tenantSlugParams }),
  tenants.cancelDeletion,
);

platformStaffRoutes.post(
  "/platform/organizations/:slug/restore",
  authenticate,
  requirePlatformRole("platform_super_admin"),
  validate({ params: tenantSlugParams }),
  tenants.restore,
);

platformStaffRoutes.post(
  "/platform/organizations/:slug/purge",
  authenticate,
  requirePlatformRole("platform_super_admin"),
  validate({ params: tenantSlugParams, body: confirmTenantDeletionBody }),
  tenants.purge,
);

platformStaffRoutes.get(
  "/platform/staff/roles",
  authenticate,
  requirePlatformStaff,
  controller.listRoles,
);

// Assigning staff roles is intentionally Super Admin only. A Platform Admin
// cannot promote itself or turn an ordinary account into a platform operator.
platformStaffRoutes.get(
  "/platform/staff/users",
  authenticate,
  requirePlatformRole("platform_super_admin"),
  controller.listStaff,
);

platformStaffRoutes.post(
  "/platform/staff/users",
  authenticate,
  requirePlatformRole("platform_super_admin"),
  validate({ body: createStaffUserBody }),
  controller.createStaff,
);

platformStaffRoutes.put(
  "/platform/staff/users/:userId/roles",
  authenticate,
  requirePlatformRole("platform_super_admin"),
  validate({ params: staffUserParams, body: updateStaffRolesBody }),
  controller.replaceRoles,
);

platformStaffRoutes.patch(
  "/platform/staff/users/:userId/status",
  authenticate,
  requirePlatformRole("platform_super_admin"),
  validate({ params: staffUserParams, body: updateStaffStatusBody }),
  controller.updateStatus,
);
