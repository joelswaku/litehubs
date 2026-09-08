import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permissions.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./discipline.controller";
import {
  actionParams,
  actionQuery,
  createActionSchema,
  decisionSchema,
  organizationParams,
  updateActionSchema,
} from "./discipline.validation";

export const disciplineRoutes = Router();
const inside = [
  authenticate,
  validate({ params: organizationParams }),
  requireOrganization,
] as const;

disciplineRoutes.get(
  "/organizations/:orgSlug/disciplinary-actions",
  ...inside,
  requirePermission("disciplinary_actions.read"),
  validate({ query: actionQuery }),
  controller.listActions,
);
disciplineRoutes.post(
  "/organizations/:orgSlug/disciplinary-actions",
  ...inside,
  requirePermission("disciplinary_actions.create"),
  validate({ body: createActionSchema }),
  controller.createAction,
);
disciplineRoutes.patch(
  "/organizations/:orgSlug/disciplinary-actions/:actionId",
  authenticate,
  validate({ params: actionParams }),
  requireOrganization,
  requirePermission("disciplinary_actions.update"),
  validate({ body: updateActionSchema }),
  controller.updateAction,
);
disciplineRoutes.post(
  "/organizations/:orgSlug/disciplinary-actions/:actionId/decision",
  authenticate,
  validate({ params: actionParams }),
  requireOrganization,
  requirePermission("disciplinary_actions.update"),
  validate({ body: decisionSchema }),
  controller.decideAction,
);
disciplineRoutes.get(
  "/organizations/:orgSlug/disciplinary-summary",
  ...inside,
  requirePermission("disciplinary_actions.read"),
  controller.summary,
);
