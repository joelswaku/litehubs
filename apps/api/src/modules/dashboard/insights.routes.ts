import { Router, type Request } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { validate } from "../../middleware/validation.middleware";
import { organizationSlugSchema } from "../organization/organization.validation";
import * as service from "./insights.service";

const organizationParams = z.object({ orgSlug: organizationSlugSchema });
const insightsQuery = z.object({
  days: z
    .enum(["7", "30", "90"])
    .optional()
    .transform((value) => Number(value ?? "30") as 7 | 30 | 90),
});

const context = (req: Request): service.InsightsContext => ({
  organizationId: req.organization!.id,
  userId: req.user!.id,
  memberId: req.membership!.memberId,
  isOwner: req.membership!.isOwner,
  permissions: req.membership!.permissions,
});

export const dashboardRoutes = Router();

/**
 * Executive dashboard snapshot. No route-level permission: every block inside
 * is gated by its own module's read permission and the caller's data scope.
 */
dashboardRoutes.get(
  "/organizations/:orgSlug/dashboard/insights",
  authenticate,
  validate({ params: organizationParams, query: insightsQuery }),
  requireOrganization,
  async (req, res) => {
    // Express 5 re-parses req.query on access, so parse it here for the value.
    const { days } = insightsQuery.parse(req.query);
    res.setHeader("Cache-Control", "no-store");
    res.json(await service.getInsights(context(req), days));
  },
);
