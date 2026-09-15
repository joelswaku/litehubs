import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireActiveEmployeeProfile, requireOwner, requirePermission } from "../../middleware/permissions.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./performance.controller";
import {
  acknowledgeSchema,
  analyticsQuery,
  createGoalSchema,
  createReviewSchema,
  goalParams,
  organizationParams,
  reviewParams,
  reviewQuery,
  updateGoalSchema,
  updateReviewSchema,
  performancePolicySchema,
} from "./performance.validation";
export const performanceRoutes = Router();
const inside = [
  authenticate,
  validate({ params: organizationParams }),
  requireOrganization,
] as const;
performanceRoutes.get(
  "/organizations/:orgSlug/performance-reviews",
  ...inside,
  requirePermission("performance.read"),
  validate({ query: reviewQuery }),
  controller.listReviews,
);
performanceRoutes.post(
  "/organizations/:orgSlug/performance-reviews",
  ...inside,
  requirePermission("performance.create"),
  validate({ body: createReviewSchema }),
  controller.createReview,
);
performanceRoutes.patch(
  "/organizations/:orgSlug/performance-reviews/:reviewId",
  authenticate,
  validate({ params: reviewParams }),
  requireOrganization,
  requirePermission("performance.update"),
  validate({ body: updateReviewSchema }),
  controller.updateReview,
);
performanceRoutes.post(
  "/organizations/:orgSlug/performance-reviews/:reviewId/acknowledge",
  authenticate,
  validate({ params: reviewParams, body: acknowledgeSchema }),
  requireOrganization,
  requirePermission("performance.update"),
  controller.acknowledge,
);
performanceRoutes.get(
  "/organizations/:orgSlug/performance-reviews/:reviewId/goals",
  authenticate,
  validate({ params: reviewParams }),
  requireOrganization,
  requirePermission("performance.read"),
  controller.listGoals,
);
performanceRoutes.post(
  "/organizations/:orgSlug/performance-reviews/:reviewId/goals",
  authenticate,
  validate({ params: reviewParams }),
  requireOrganization,
  requirePermission("performance.create"),
  validate({ body: createGoalSchema }),
  controller.createGoal,
);
performanceRoutes.patch(
  "/organizations/:orgSlug/performance-goals/:goalId",
  authenticate,
  validate({ params: goalParams }),
  requireOrganization,
  requirePermission("performance.update"),
  validate({ body: updateGoalSchema }),
  controller.updateGoal,
);
performanceRoutes.get(
  "/organizations/:orgSlug/performance-summary",
  ...inside,
  requirePermission("performance.read"),
  controller.summary,
);

performanceRoutes.get(
  "/organizations/:orgSlug/performance-policy",
  ...inside,
  requirePermission("performance.read"),
  controller.getPolicy,
);
performanceRoutes.patch(
  "/organizations/:orgSlug/performance-policy",
  ...inside,
  requireOwner,
  requirePermission("performance.update"),
  validate({ body: performancePolicySchema }),
  controller.updatePolicy,
);
performanceRoutes.get(
  "/organizations/:orgSlug/performance-analytics",
  ...inside,
  requirePermission("performance.read"),
  validate({ query: analyticsQuery }),
  controller.analytics,
);
/**
 * Personal employee data. The API derives the employee record from the
 * authenticated membership, never from a browser-supplied employee id.
 */
performanceRoutes.get(
  "/organizations/:orgSlug/my-performance",
  ...inside,
  requireActiveEmployeeProfile,
  validate({ query: analyticsQuery }),
  controller.myPerformance,
);