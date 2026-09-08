import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { requirePermission } from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./alerts.controller";
import {
  alertParams,
  createAlertBody,
  listAlertsQuery,
  organizationParams,
  resolveAlertBody,
  updateAlertBody,
} from "./alerts.validation";

export const alertRoutes = Router();

const inOrganization = [
  authenticate,
  validate({ params: organizationParams }),
  requireOrganization,
] as const;

alertRoutes.get(
  "/organizations/:orgSlug/alerts",
  ...inOrganization,
  requirePermission("alerts.read"),
  validate({ query: listAlertsQuery }),
  controller.listAlerts,
);

alertRoutes.post(
  "/organizations/:orgSlug/alerts",
  ...inOrganization,
  requirePermission("alerts.create"),
  validate({ body: createAlertBody }),
  controller.createAlert,
);

alertRoutes.post(
  "/organizations/:orgSlug/alerts/evaluate",
  ...inOrganization,
  requirePermission("alerts.create"),
  controller.evaluateAlerts,
);
alertRoutes.get(
  "/organizations/:orgSlug/alerts/:alertId",
  authenticate,
  validate({ params: alertParams }),
  requireOrganization,
  requirePermission("alerts.read"),
  controller.getAlert,
);

alertRoutes.post(
  "/organizations/:orgSlug/alerts/:alertId/acknowledge",
  authenticate,
  validate({ params: alertParams }),
  requireOrganization,
  requirePermission("alerts.update"),
  controller.acknowledgeAlert,
);

alertRoutes.post(
  "/organizations/:orgSlug/alerts/:alertId/resolve",
  authenticate,
  validate({ params: alertParams, body: resolveAlertBody }),
  requireOrganization,
  requirePermission("alerts.update"),
  controller.resolveAlert,
);

alertRoutes.post(
  "/organizations/:orgSlug/alerts/:alertId/dismiss",
  authenticate,
  validate({ params: alertParams, body: resolveAlertBody }),
  requireOrganization,
  requirePermission("alerts.update"),
  controller.dismissAlert,
);

alertRoutes.patch(
  "/organizations/:orgSlug/alerts/:alertId",
  authenticate,
  validate({ params: alertParams, body: updateAlertBody }),
  requireOrganization,
  requirePermission("alerts.update"),
  controller.updateAlert,
);

// Automated alerts are retained as their audit trail. Only a human-raised alert
// may be permanently removed; normal workflow is acknowledge, resolve, dismiss.
alertRoutes.delete(
  "/organizations/:orgSlug/alerts/:alertId",
  authenticate,
  validate({ params: alertParams }),
  requireOrganization,
  requirePermission("alerts.delete"),
  controller.deleteAlert,
);
