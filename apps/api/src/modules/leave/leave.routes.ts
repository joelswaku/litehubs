import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import {
  requireAnyPermission,
  requirePermission,
} from "../../middleware/permissions.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./leave.controller";
import {
  cancelLeaveSchema,
  createLeaveTypeSchema,
  decideLeaveSchema,
  leaveRequestParams,
  leaveRequestQuery,
  leaveTypeParams,
  organizationParams,
  requestLeaveSchema,
  updateLeaveTypeSchema,
} from "./leave.validation";
export const leaveRoutes = Router();
const inside = [
  authenticate,
  validate({ params: organizationParams }),
  requireOrganization,
] as const;
leaveRoutes.get(
  "/organizations/:orgSlug/leave-types",
  ...inside,
  requirePermission("leave.read"),
  controller.listTypes,
);
leaveRoutes.post(
  "/organizations/:orgSlug/leave-types",
  ...inside,
  requirePermission("leave.update"),
  validate({ body: createLeaveTypeSchema }),
  controller.createType,
);
leaveRoutes.patch(
  "/organizations/:orgSlug/leave-types/:leaveTypeId",
  authenticate,
  validate({ params: leaveTypeParams }),
  requireOrganization,
  requirePermission("leave.update"),
  validate({ body: updateLeaveTypeSchema }),
  controller.updateType,
);
leaveRoutes.get(
  "/organizations/:orgSlug/leave-me",
  ...inside,
  requirePermission("leave.read"),
  controller.currentEmployee,
);
leaveRoutes.get(
  "/organizations/:orgSlug/leave-requests",
  ...inside,
  requirePermission("leave.read"),
  validate({ query: leaveRequestQuery }),
  controller.listRequests,
);
leaveRoutes.post(
  "/organizations/:orgSlug/leave-requests",
  ...inside,
  requirePermission("leave.create"),
  validate({ body: requestLeaveSchema }),
  controller.requestLeave,
);
leaveRoutes.post(
  "/organizations/:orgSlug/leave-requests/:leaveRequestId/decision",
  authenticate,
  validate({ params: leaveRequestParams }),
  requireOrganization,
  requirePermission("leave.approve"),
  validate({ body: decideLeaveSchema }),
  controller.decideLeave,
);
leaveRoutes.post(
  "/organizations/:orgSlug/leave-requests/:leaveRequestId/cancel",
  authenticate,
  validate({ params: leaveRequestParams }),
  requireOrganization,
  requireAnyPermission("leave.create", "leave.update"),
  validate({ body: cancelLeaveSchema }),
  controller.cancelLeave,
);
leaveRoutes.get(
  "/organizations/:orgSlug/leave-summary",
  ...inside,
  requirePermission("leave.read"),
  controller.summary,
);
