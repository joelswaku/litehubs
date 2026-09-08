import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { requirePermission } from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import { ForbiddenError } from "../../utils/errors";
import * as controller from "./poultry-performance.controller";
import {
  climateProfileCreate,
  climateProfileParams,
  climateProfileUpdate,
  dailyWorkCreate,
  dailyWorkGenerateBody,
  dailyWorkListQuery,
  dailyWorkParams,
  dailyWorkReview,
  dailyWorkUpdate,
  flockPerformanceParams,
  performanceDateQuery,
  performanceModelCreate,
  performanceModelParams,
  performanceModelUpdate,
  performanceOrganizationParams,
  vaccineScheduleCreate,
  vaccineScheduleParams,
  vaccineScheduleUpdate,
  weeklyTargetCreate,
  weeklyTargetParams,
  weeklyTargetUpdate,
} from "./poultry-performance.validation";

export const poultryPerformanceRoutes = Router();

const inOrganization = [
  authenticate,
  validate({ params: performanceOrganizationParams }),
  requireOrganization,
] as const;

function performancePermission(
  resource: "performance_models" | "climate_profiles",
  action: "create" | "read" | "update" | "delete",
): RequestHandler {
  return (req, _res, next) => {
    const code = `poultry.${resource}.${action}`;
    if (!req.membership!.permissions.includes(code)) {
      next(
        new ForbiddenError("You do not have permission to do that", {
          required: [code],
        }),
      );
      return;
    }
    next();
  };
}

poultryPerformanceRoutes.get(
  "/organizations/:orgSlug/poultry/climate-profiles",
  ...inOrganization,
  performancePermission("climate_profiles", "read"),
  controller.listClimateProfiles,
);
poultryPerformanceRoutes.post(
  "/organizations/:orgSlug/poultry/climate-profiles",
  ...inOrganization,
  performancePermission("climate_profiles", "create"),
  validate({ body: climateProfileCreate }),
  controller.createClimateProfile,
);
poultryPerformanceRoutes.get(
  "/organizations/:orgSlug/poultry/climate-profiles/:climateProfileId",
  authenticate,
  validate({ params: climateProfileParams }),
  requireOrganization,
  performancePermission("climate_profiles", "read"),
  controller.getClimateProfile,
);
poultryPerformanceRoutes.patch(
  "/organizations/:orgSlug/poultry/climate-profiles/:climateProfileId",
  authenticate,
  validate({ params: climateProfileParams, body: climateProfileUpdate }),
  requireOrganization,
  performancePermission("climate_profiles", "update"),
  controller.updateClimateProfile,
);
poultryPerformanceRoutes.delete(
  "/organizations/:orgSlug/poultry/climate-profiles/:climateProfileId",
  authenticate,
  validate({ params: climateProfileParams }),
  requireOrganization,
  performancePermission("climate_profiles", "delete"),
  controller.deleteClimateProfile,
);

poultryPerformanceRoutes.get(
  "/organizations/:orgSlug/poultry/performance-models",
  ...inOrganization,
  performancePermission("performance_models", "read"),
  controller.listPerformanceModels,
);
poultryPerformanceRoutes.post(
  "/organizations/:orgSlug/poultry/performance-models",
  ...inOrganization,
  performancePermission("performance_models", "create"),
  validate({ body: performanceModelCreate }),
  controller.createPerformanceModel,
);
poultryPerformanceRoutes.get(
  "/organizations/:orgSlug/poultry/performance-models/:modelId",
  authenticate,
  validate({ params: performanceModelParams }),
  requireOrganization,
  performancePermission("performance_models", "read"),
  controller.getPerformanceModel,
);
poultryPerformanceRoutes.patch(
  "/organizations/:orgSlug/poultry/performance-models/:modelId",
  authenticate,
  validate({ params: performanceModelParams, body: performanceModelUpdate }),
  requireOrganization,
  performancePermission("performance_models", "update"),
  controller.updatePerformanceModel,
);
poultryPerformanceRoutes.delete(
  "/organizations/:orgSlug/poultry/performance-models/:modelId",
  authenticate,
  validate({ params: performanceModelParams }),
  requireOrganization,
  performancePermission("performance_models", "delete"),
  controller.deletePerformanceModel,
);

poultryPerformanceRoutes.get(
  "/organizations/:orgSlug/poultry/performance-models/:modelId/weekly-targets",
  authenticate,
  validate({ params: performanceModelParams }),
  requireOrganization,
  performancePermission("performance_models", "read"),
  controller.listWeeklyTargets,
);
poultryPerformanceRoutes.post(
  "/organizations/:orgSlug/poultry/performance-models/:modelId/weekly-targets",
  authenticate,
  validate({ params: performanceModelParams, body: weeklyTargetCreate }),
  requireOrganization,
  performancePermission("performance_models", "update"),
  controller.createWeeklyTarget,
);
poultryPerformanceRoutes.patch(
  "/organizations/:orgSlug/poultry/performance-models/:modelId/weekly-targets/:targetId",
  authenticate,
  validate({ params: weeklyTargetParams, body: weeklyTargetUpdate }),
  requireOrganization,
  performancePermission("performance_models", "update"),
  controller.updateWeeklyTarget,
);
poultryPerformanceRoutes.delete(
  "/organizations/:orgSlug/poultry/performance-models/:modelId/weekly-targets/:targetId",
  authenticate,
  validate({ params: weeklyTargetParams }),
  requireOrganization,
  performancePermission("performance_models", "update"),
  controller.deleteWeeklyTarget,
);

poultryPerformanceRoutes.get(
  "/organizations/:orgSlug/poultry/performance-models/:modelId/vaccine-schedules",
  authenticate,
  validate({ params: performanceModelParams }),
  requireOrganization,
  performancePermission("performance_models", "read"),
  controller.listVaccineSchedules,
);
poultryPerformanceRoutes.post(
  "/organizations/:orgSlug/poultry/performance-models/:modelId/vaccine-schedules",
  authenticate,
  validate({ params: performanceModelParams, body: vaccineScheduleCreate }),
  requireOrganization,
  performancePermission("performance_models", "update"),
  controller.createVaccineSchedule,
);
poultryPerformanceRoutes.patch(
  "/organizations/:orgSlug/poultry/performance-models/:modelId/vaccine-schedules/:scheduleId",
  authenticate,
  validate({ params: vaccineScheduleParams, body: vaccineScheduleUpdate }),
  requireOrganization,
  performancePermission("performance_models", "update"),
  controller.updateVaccineSchedule,
);
poultryPerformanceRoutes.delete(
  "/organizations/:orgSlug/poultry/performance-models/:modelId/vaccine-schedules/:scheduleId",
  authenticate,
  validate({ params: vaccineScheduleParams }),
  requireOrganization,
  performancePermission("performance_models", "update"),
  controller.deleteVaccineSchedule,
);

poultryPerformanceRoutes.get(
  "/organizations/:orgSlug/poultry/daily-work/mine",
  authenticate,
  validate({
    params: performanceOrganizationParams,
    query: dailyWorkListQuery,
  }),
  requireOrganization,
  requirePermission("poultry.daily_records.read"),
  controller.listMyDailyWork,
);

poultryPerformanceRoutes.get(
  "/organizations/:orgSlug/poultry/flocks/:flockId/performance",
  authenticate,
  validate({ params: flockPerformanceParams, query: performanceDateQuery }),
  requireOrganization,
  requirePermission("poultry.flocks.read"),
  controller.flockPerformance,
);
poultryPerformanceRoutes.get(
  "/organizations/:orgSlug/poultry/flocks/:flockId/daily-work",
  authenticate,
  validate({ params: flockPerformanceParams, query: dailyWorkListQuery }),
  requireOrganization,
  requirePermission("poultry.daily_records.read"),
  controller.listDailyWork,
);
poultryPerformanceRoutes.post(
  "/organizations/:orgSlug/poultry/flocks/:flockId/daily-work",
  authenticate,
  validate({ params: flockPerformanceParams, body: dailyWorkCreate }),
  requireOrganization,
  requirePermission("poultry.daily_records.create"),
  controller.createDailyWork,
);
poultryPerformanceRoutes.post(
  "/organizations/:orgSlug/poultry/flocks/:flockId/daily-work/generate",
  authenticate,
  validate({ params: flockPerformanceParams, body: dailyWorkGenerateBody }),
  requireOrganization,
  requirePermission("poultry.daily_records.create"),
  controller.generateDailyWork,
);
poultryPerformanceRoutes.post(
  "/organizations/:orgSlug/poultry/daily-work/:workItemId/review",
  authenticate,
  validate({ params: dailyWorkParams, body: dailyWorkReview }),
  requireOrganization,
  requirePermission("poultry.daily_records.update"),
  controller.reviewDailyWork,
);

poultryPerformanceRoutes.patch(
  "/organizations/:orgSlug/poultry/daily-work/:workItemId",
  authenticate,
  validate({ params: dailyWorkParams, body: dailyWorkUpdate }),
  requireOrganization,
  requirePermission("poultry.daily_records.update"),
  controller.updateDailyWork,
);
