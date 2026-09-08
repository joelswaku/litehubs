import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { requirePermission } from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./daily-work.controller";
import {
  dailyWorkQuery,
  handoverBody,
  handoverParams,
  itemBody,
  itemUpdateBody,
  organizationParams,
  reportBody,
  reportParams,
  reportUpdateBody,
  responseBody,
  reviewBody,
  runBody,
  runItemParams,
  runParams,
  templateBody,
  templateItemParams,
  templateParams,
  templateUpdateBody,
} from "./daily-work.validation";

export const dailyWorkRoutes = Router();
const inOrganization = [
  authenticate,
  validate({ params: organizationParams }),
  requireOrganization,
] as const;

dailyWorkRoutes.get(
  "/organizations/:orgSlug/daily-work/overview",
  ...inOrganization,
  requirePermission("daily_operations.read"),
  validate({ query: dailyWorkQuery }),
  controller.overview,
);
dailyWorkRoutes.get(
  "/organizations/:orgSlug/daily-work/templates",
  ...inOrganization,
  requirePermission("daily_operations.read"),
  validate({ query: dailyWorkQuery }),
  controller.listTemplates,
);
dailyWorkRoutes.post(
  "/organizations/:orgSlug/daily-work/templates",
  ...inOrganization,
  requirePermission("daily_operations.create"),
  validate({ body: templateBody }),
  controller.createTemplate,
);
dailyWorkRoutes.patch(
  "/organizations/:orgSlug/daily-work/templates/:templateId",
  authenticate,
  validate({ params: templateParams, body: templateUpdateBody }),
  requireOrganization,
  requirePermission("daily_operations.update"),
  controller.updateTemplate,
);
dailyWorkRoutes.delete(
  "/organizations/:orgSlug/daily-work/templates/:templateId",
  authenticate,
  validate({ params: templateParams }),
  requireOrganization,
  requirePermission("daily_operations.delete"),
  controller.deleteTemplate,
);
dailyWorkRoutes.post(
  "/organizations/:orgSlug/daily-work/templates/:templateId/items",
  authenticate,
  validate({ params: templateParams, body: itemBody }),
  requireOrganization,
  requirePermission("daily_operations.create"),
  controller.createTemplateItem,
);
dailyWorkRoutes.patch(
  "/organizations/:orgSlug/daily-work/templates/:templateId/items/:itemId",
  authenticate,
  validate({ params: templateItemParams, body: itemUpdateBody }),
  requireOrganization,
  requirePermission("daily_operations.update"),
  controller.updateTemplateItem,
);
dailyWorkRoutes.delete(
  "/organizations/:orgSlug/daily-work/templates/:templateId/items/:itemId",
  authenticate,
  validate({ params: templateItemParams }),
  requireOrganization,
  requirePermission("daily_operations.delete"),
  controller.deleteTemplateItem,
);
dailyWorkRoutes.get(
  "/organizations/:orgSlug/daily-work/runs",
  ...inOrganization,
  requirePermission("daily_operations.read"),
  validate({ query: dailyWorkQuery }),
  controller.listRuns,
);
dailyWorkRoutes.post(
  "/organizations/:orgSlug/daily-work/runs",
  ...inOrganization,
  requirePermission("daily_operations.create"),
  validate({ body: runBody }),
  controller.createRun,
);
dailyWorkRoutes.get(
  "/organizations/:orgSlug/daily-work/runs/:runId",
  authenticate,
  validate({ params: runParams }),
  requireOrganization,
  requirePermission("daily_operations.read"),
  controller.getRun,
);
dailyWorkRoutes.put(
  "/organizations/:orgSlug/daily-work/runs/:runId/items/:itemId/response",
  authenticate,
  validate({ params: runItemParams, body: responseBody }),
  requireOrganization,
  requirePermission("daily_operations.update"),
  controller.answerRunItem,
);
dailyWorkRoutes.post(
  "/organizations/:orgSlug/daily-work/runs/:runId/complete",
  authenticate,
  validate({ params: runParams }),
  requireOrganization,
  requirePermission("daily_operations.update"),
  controller.completeRun,
);
dailyWorkRoutes.post(
  "/organizations/:orgSlug/daily-work/runs/:runId/verify",
  authenticate,
  validate({ params: runParams }),
  requireOrganization,
  requirePermission("daily_operations.approve"),
  controller.verifyRun,
);
dailyWorkRoutes.get(
  "/organizations/:orgSlug/daily-work/reports",
  ...inOrganization,
  requirePermission("daily_operations.read"),
  validate({ query: dailyWorkQuery }),
  controller.listReports,
);
dailyWorkRoutes.post(
  "/organizations/:orgSlug/daily-work/reports",
  ...inOrganization,
  requirePermission("daily_operations.create"),
  validate({ body: reportBody }),
  controller.createReport,
);
dailyWorkRoutes.patch(
  "/organizations/:orgSlug/daily-work/reports/:reportId",
  authenticate,
  validate({ params: reportParams, body: reportUpdateBody }),
  requireOrganization,
  requirePermission("daily_operations.update"),
  controller.updateReport,
);
dailyWorkRoutes.post(
  "/organizations/:orgSlug/daily-work/reports/:reportId/review",
  authenticate,
  validate({ params: reportParams, body: reviewBody }),
  requireOrganization,
  requirePermission("daily_operations.approve"),
  controller.reviewReport,
);
dailyWorkRoutes.get(
  "/organizations/:orgSlug/daily-work/handovers",
  ...inOrganization,
  requirePermission("daily_operations.read"),
  validate({ query: dailyWorkQuery }),
  controller.listHandovers,
);
dailyWorkRoutes.post(
  "/organizations/:orgSlug/daily-work/handovers",
  ...inOrganization,
  requirePermission("daily_operations.create"),
  validate({ body: handoverBody }),
  controller.createHandover,
);
dailyWorkRoutes.post(
  "/organizations/:orgSlug/daily-work/handovers/:handoverId/acknowledge",
  authenticate,
  validate({ params: handoverParams }),
  requireOrganization,
  requirePermission("daily_operations.update"),
  controller.acknowledgeHandover,
);
