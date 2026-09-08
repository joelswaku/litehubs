import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { requirePermission } from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import { ForbiddenError } from "../../utils/errors";
import * as controller from "./poultry.controller";
import { poultryPerformanceRoutes } from "./poultry-performance.routes";
import {
  flockProfileParams,
  organizationParams,
  parsePoultryBody,
  poultryListQuery,
  poultryOverviewQuery,
  poultryRecordParams,
  poultryResourceParams,
  type PoultryResource,
} from "./poultry.validation";

export const poultryRoutes = Router();

const permissionResource: Record<PoultryResource, string> = {
  houses: "houses",
  flocks: "flocks",
  "daily-records": "daily_records",
  mortality: "mortality",
  feed: "feed",
  water: "water",
  weights: "weights",
  eggs: "eggs",
  health: "health",
  vaccinations: "vaccinations",
  treatments: "treatments",
  sanitation: "sanitation",
  biosecurity: "biosecurity",
  "production-targets": "production_targets",
  losses: "losses",
};

const inOrganization = [
  authenticate,
  validate({ params: organizationParams }),
  requireOrganization,
] as const;

function parameterResource(
  req: Parameters<RequestHandler>[0],
): PoultryResource {
  const item = req.params.resource;
  return (Array.isArray(item) ? item[0] : item) as PoultryResource;
}

function requirePoultryPermission(
  action: "create" | "read" | "update" | "delete",
): RequestHandler {
  return (req, _res, next) => {
    try {
      const resource = parameterResource(req);
      const code = `poultry.${permissionResource[resource]}.${action}`;
      if (!req.membership!.permissions.includes(code)) {
        throw new ForbiddenError("You do not have permission to do that", {
          required: [code],
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

function validatePoultryBody(mode: "create" | "update"): RequestHandler {
  return (req, _res, next) => {
    try {
      req.body = parsePoultryBody(parameterResource(req), req.body, mode);
      next();
    } catch (error) {
      next(error);
    }
  };
}

poultryRoutes.get(
  "/organizations/:orgSlug/poultry/overview",
  ...inOrganization,
  requirePermission("poultry.flocks.read", "poultry.mortality.read"),
  validate({ query: poultryOverviewQuery }),
  controller.poultryOverview,
);

poultryRoutes.use(poultryPerformanceRoutes);

poultryRoutes.get(
  "/organizations/:orgSlug/poultry/flocks/:flockId/profile.pdf",
  authenticate,
  validate({ params: flockProfileParams }),
  requireOrganization,
  requirePermission("poultry.flocks.read"),
  controller.downloadFlockProfilePdf,
);


poultryRoutes.get(
  "/organizations/:orgSlug/poultry/:resource",
  ...inOrganization,
  validate({ params: poultryResourceParams, query: poultryListQuery }),
  requirePoultryPermission("read"),
  controller.listPoultryRecords,
);

poultryRoutes.post(
  "/organizations/:orgSlug/poultry/:resource",
  ...inOrganization,
  validate({ params: poultryResourceParams }),
  requirePoultryPermission("create"),
  validatePoultryBody("create"),
  controller.createPoultryRecord,
);

poultryRoutes.get(
  "/organizations/:orgSlug/poultry/:resource/:recordId",
  authenticate,
  validate({ params: poultryRecordParams }),
  requireOrganization,
  requirePoultryPermission("read"),
  controller.getPoultryRecord,
);

poultryRoutes.patch(
  "/organizations/:orgSlug/poultry/:resource/:recordId",
  authenticate,
  validate({ params: poultryRecordParams }),
  requireOrganization,
  requirePoultryPermission("update"),
  validatePoultryBody("update"),
  controller.updatePoultryRecord,
);

poultryRoutes.delete(
  "/organizations/:orgSlug/poultry/:resource/:recordId",
  authenticate,
  validate({ params: poultryRecordParams }),
  requireOrganization,
  requirePoultryPermission("delete"),
  controller.deletePoultryRecord,
);
