import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { requirePermission } from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./reports.controller";
import { organizationParams, reportQuery } from "./reports.validation";

export const reportsRoutes = Router();
const inside = [authenticate, validate({ params: organizationParams }), requireOrganization] as const;
reportsRoutes.get("/organizations/:orgSlug/reports/overview", ...inside, requirePermission("reports.read"), validate({ query: reportQuery }), controller.overview);
reportsRoutes.get("/organizations/:orgSlug/reports/export.pdf", ...inside, requirePermission("reports.export"), validate({ query: reportQuery }), controller.downloadPdf);
reportsRoutes.get("/organizations/:orgSlug/reports/export.xlsx", ...inside, requirePermission("reports.export"), validate({ query: reportQuery }), controller.downloadExcel);