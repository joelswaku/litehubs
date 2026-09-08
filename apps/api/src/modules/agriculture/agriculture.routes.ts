import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { requirePermission } from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import { ForbiddenError } from "../../utils/errors";
import * as controller from "./agriculture.controller";
import {
  agricultureListQuery,
  agricultureOverviewQuery,
  agricultureRecordParams,
  agricultureResourceParams,
  organizationParams,
  parseAgricultureBody,
  type AgricultureResource,
} from "./agriculture.validation";

export const agricultureRoutes = Router();

const permissionResource: Record<AgricultureResource, string> = {
  farms: "farms",
  fields: "fields",
  plots: "plots",
  crops: "crops",
  seasons: "seasons",
  plantings: "plantings",
  operations: "operations",
  irrigation: "irrigation",
  fertilizer: "fertilizer",
  pesticides: "pesticides",
  scouting: "scouting",
  weather: "weather",
  harvest: "harvest",
  "production-targets": "production_targets",
  losses: "losses",
};

const inOrganization = [
  authenticate,
  validate({ params: organizationParams }),
  requireOrganization,
] as const;

function resourceOf(req: Parameters<RequestHandler>[0]): AgricultureResource {
  const value = req.params.resource;
  return (Array.isArray(value) ? value[0] : value) as AgricultureResource;
}

function requireAgriculturePermission(
  action: "create" | "read" | "update" | "delete",
): RequestHandler {
  return (req, _res, next) => {
    try {
      const code =
        "agriculture." + permissionResource[resourceOf(req)] + "." + action;
      if (!req.membership!.permissions.includes(code))
        throw new ForbiddenError("You do not have permission to do that", {
          required: [code],
        });
      next();
    } catch (error) {
      next(error);
    }
  };
}

function validateAgricultureBody(mode: "create" | "update"): RequestHandler {
  return (req, _res, next) => {
    try {
      req.body = parseAgricultureBody(resourceOf(req), req.body, mode);
      next();
    } catch (error) {
      next(error);
    }
  };
}

agricultureRoutes.get(
  "/organizations/:orgSlug/agriculture/overview",
  ...inOrganization,
  requirePermission("agriculture.farms.read", "agriculture.fields.read"),
  validate({ query: agricultureOverviewQuery }),
  controller.agricultureOverview,
);

agricultureRoutes.get(
  "/organizations/:orgSlug/agriculture/:resource",
  ...inOrganization,
  validate({ params: agricultureResourceParams, query: agricultureListQuery }),
  requireAgriculturePermission("read"),
  controller.listAgricultureRecords,
);

agricultureRoutes.post(
  "/organizations/:orgSlug/agriculture/:resource",
  ...inOrganization,
  validate({ params: agricultureResourceParams }),
  requireAgriculturePermission("create"),
  validateAgricultureBody("create"),
  controller.createAgricultureRecord,
);

agricultureRoutes.get(
  "/organizations/:orgSlug/agriculture/:resource/:recordId",
  authenticate,
  validate({ params: agricultureRecordParams }),
  requireOrganization,
  requireAgriculturePermission("read"),
  controller.getAgricultureRecord,
);

agricultureRoutes.patch(
  "/organizations/:orgSlug/agriculture/:resource/:recordId",
  authenticate,
  validate({ params: agricultureRecordParams }),
  requireOrganization,
  requireAgriculturePermission("update"),
  validateAgricultureBody("update"),
  controller.updateAgricultureRecord,
);

agricultureRoutes.delete(
  "/organizations/:orgSlug/agriculture/:resource/:recordId",
  authenticate,
  validate({ params: agricultureRecordParams }),
  requireOrganization,
  requireAgriculturePermission("delete"),
  controller.deleteAgricultureRecord,
);
