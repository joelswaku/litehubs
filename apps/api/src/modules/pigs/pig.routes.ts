import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { requirePermission } from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import { ForbiddenError } from "../../utils/errors";
import * as controller from "./pig.controller";
import * as pdf from "./pig-pdf";
import {
  pigPenSheetParams,
  pigTreatmentReportParams,
  pigVaccinationCalendarQuery,
} from "./pig-pdf";
import {
  organizationParams,
  parsePigBody,
  pigListQuery,
  pigOverviewQuery,
  pigRecordParams,
  pigResourceParams,
  type PigResource,
} from "./pig.validation";

export const pigRoutes = Router();

const permissionResource: Record<PigResource, string> = {
  pens: "pens",
  groups: "groups",
  animals: "animals",
  "daily-records": "daily_records",
  feed: "feed",
  water: "water",
  weights: "weights",
  movements: "movements",
  mortality: "mortality",
  losses: "losses",
  breeding: "breeding",
  pregnancies: "pregnancies",
  farrowing: "farrowing",
  piglets: "piglets",
  health: "health",
  vaccinations: "vaccinations",
  treatments: "treatments",
  quarantine: "quarantine",
  veterinary: "veterinary",
};

const inOrganization = [
  authenticate,
  validate({ params: organizationParams }),
  requireOrganization,
] as const;

function resourceOf(req: Parameters<RequestHandler>[0]): PigResource {
  const resource = req.params.resource;
  return (Array.isArray(resource) ? resource[0] : resource) as PigResource;
}

function requirePigPermission(
  action: "create" | "read" | "update" | "delete",
): RequestHandler {
  return (req, _res, next) => {
    try {
      const code = `pigs.${permissionResource[resourceOf(req)]}.${action}`;
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

function validatePigBody(mode: "create" | "update"): RequestHandler {
  return (req, _res, next) => {
    try {
      req.body = parsePigBody(resourceOf(req), req.body, mode);
      next();
    } catch (error) {
      next(error);
    }
  };
}

pigRoutes.get(
  "/organizations/:orgSlug/pigs/overview",
  ...inOrganization,
  requirePermission("pigs.pens.read", "pigs.animals.read"),
  validate({ query: pigOverviewQuery }),
  controller.pigOverview,
);

/* Printable documents — same access as reading the underlying records. */
pigRoutes.get(
  "/organizations/:orgSlug/pigs/pens/:penId/sheet.pdf",
  authenticate,
  validate({ params: pigPenSheetParams }),
  requireOrganization,
  requirePermission("pigs.pens.read"),
  pdf.downloadPenSheetPdf,
);

pigRoutes.get(
  "/organizations/:orgSlug/pigs/treatments/:recordId/report.pdf",
  authenticate,
  validate({ params: pigTreatmentReportParams }),
  requireOrganization,
  requirePermission("pigs.treatments.read"),
  pdf.downloadTreatmentReportPdf,
);

pigRoutes.get(
  "/organizations/:orgSlug/pigs/vaccinations/calendar/export.pdf",
  ...inOrganization,
  requirePermission("pigs.vaccinations.read"),
  validate({ query: pigVaccinationCalendarQuery }),
  pdf.downloadVaccinationCalendarPdf,
);

pigRoutes.get(
  "/organizations/:orgSlug/pigs/:resource",
  ...inOrganization,
  validate({ params: pigResourceParams, query: pigListQuery }),
  requirePigPermission("read"),
  controller.listPigRecords,
);

pigRoutes.post(
  "/organizations/:orgSlug/pigs/:resource",
  ...inOrganization,
  validate({ params: pigResourceParams }),
  requirePigPermission("create"),
  validatePigBody("create"),
  controller.createPigRecord,
);

pigRoutes.get(
  "/organizations/:orgSlug/pigs/:resource/:recordId",
  authenticate,
  validate({ params: pigRecordParams }),
  requireOrganization,
  requirePigPermission("read"),
  controller.getPigRecord,
);

pigRoutes.patch(
  "/organizations/:orgSlug/pigs/:resource/:recordId",
  authenticate,
  validate({ params: pigRecordParams }),
  requireOrganization,
  requirePigPermission("update"),
  validatePigBody("update"),
  controller.updatePigRecord,
);

pigRoutes.delete(
  "/organizations/:orgSlug/pigs/:resource/:recordId",
  authenticate,
  validate({ params: pigRecordParams }),
  requireOrganization,
  requirePigPermission("delete"),
  controller.deletePigRecord,
);
