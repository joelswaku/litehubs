import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { requirePermission } from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import { ForbiddenError } from "../../utils/errors";
import { evaluateAutomaticAlerts } from "../alerts/alert-engine.service";
import * as service from "./poultry-insights.service";
import type { PoultryContext } from "./poultry.service";
import { organizationParams } from "./poultry.validation";

const idSchema = z.string().uuid("Enter a valid identifier");

const insightsQuery = z.object({
  siteId: idSchema.optional(),
  provinceId: idSchema.optional(),
  productionType: z.enum(["broiler", "layer", "breeder"]).optional(),
  closedWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
  targetWeightG: z.coerce.number().int().min(300).max(8000).optional(),
});
const flockParams = organizationParams.extend({ flockId: idSchema });
const costParams = flockParams.extend({ costId: idSchema });
const costCreate = z.object({
  costDate: z.string().date("Use YYYY-MM-DD"),
  category: z.enum(service.FLOCK_COST_CATEGORIES),
  description: z.string().trim().max(300).nullable().optional(),
  amount: z.number().nonnegative().max(1_000_000_000),
});

function contextOf(req: Request): PoultryContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
  };
}
function parameter(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
/** Money is shown to the owner and to managers who can change flocks. */
function seesFinance(req: Request) {
  return (
    req.membership!.isOwner ||
    req.membership!.permissions.includes("poultry.flocks.update")
  );
}
const requireFinance: RequestHandler = (req, _res, next) => {
  if (seesFinance(req)) return next();
  next(new ForbiddenError("You do not have permission to see flock costs"));
};

export const poultryInsightsRoutes = Router();

poultryInsightsRoutes.get(
  "/organizations/:orgSlug/poultry/insights",
  authenticate,
  validate({ params: organizationParams, query: insightsQuery }),
  requireOrganization,
  requirePermission("poultry.flocks.read"),
  async (req, res) => {
    res.json({
      insights: await service.poultryInsights(
        contextOf(req),
        req.query as service.InsightsQuery,
        { includeFinance: seesFinance(req) },
      ),
    });
  },
);

poultryInsightsRoutes.get(
  "/organizations/:orgSlug/poultry/flocks/:flockId/costs",
  authenticate,
  validate({ params: flockParams }),
  requireOrganization,
  requirePermission("poultry.flocks.read"),
  requireFinance,
  async (req, res) => {
    res.json({
      costs: await service.listFlockCosts(
        contextOf(req),
        parameter(req, "flockId"),
      ),
    });
  },
);

poultryInsightsRoutes.post(
  "/organizations/:orgSlug/poultry/flocks/:flockId/costs",
  authenticate,
  validate({ params: flockParams, body: costCreate }),
  requireOrganization,
  requirePermission("poultry.flocks.update"),
  async (req, res) => {
    res.status(201).json({
      cost: await service.createFlockCost(
        contextOf(req),
        parameter(req, "flockId"),
        req.body,
      ),
    });
  },
);

poultryInsightsRoutes.delete(
  "/organizations/:orgSlug/poultry/flocks/:flockId/costs/:costId",
  authenticate,
  validate({ params: costParams }),
  requireOrganization,
  requirePermission("poultry.flocks.update"),
  async (req, res) => {
    res.json(
      await service.deleteFlockCost(
        contextOf(req),
        parameter(req, "flockId"),
        parameter(req, "costId"),
      ),
    );
  },
);

/** Re-runs the automatic checks so early warnings reach the alert centre now. */
poultryInsightsRoutes.post(
  "/organizations/:orgSlug/poultry/insights/evaluate-alerts",
  authenticate,
  validate({ params: organizationParams }),
  requireOrganization,
  requirePermission("poultry.flocks.read"),
  async (req, res) => {
    res.json({
      result: await evaluateAutomaticAlerts(contextOf(req), ["poultry"]),
    });
  },
);
