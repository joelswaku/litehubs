import type { Request, RequestHandler } from "express";
import * as service from "./performance.service";
import type {
  CreateGoalInput,
  CreateReviewInput,
  ReviewQuery,
  UpdateGoalInput,
  UpdateReviewInput,
  AnalyticsQuery,
  PerformancePolicyInput,
} from "./performance.validation";
function context(req: Request): service.PerformanceContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
    permissions: req.membership!.permissions,
  };
}
function param(req: Request, key: string): string {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
export const listReviews: RequestHandler = async (req, res) =>
  res.json({
    reviews: await service.listReviews(context(req), req.query as ReviewQuery),
  });
export const createReview: RequestHandler = async (req, res) =>
  res
    .status(201)
    .json({
      review: await service.createReview(
        context(req),
        req.body as CreateReviewInput,
      ),
    });
export const updateReview: RequestHandler = async (req, res) =>
  res.json({
    review: await service.updateReview(
      context(req),
      param(req, "reviewId"),
      req.body as UpdateReviewInput,
    ),
  });
export const acknowledge: RequestHandler = async (req, res) =>
  res.json({
    review: await service.acknowledge(
      context(req),
      param(req, "reviewId"),
      req.body as { employeeComments?: string | null },
    ),
  });
export const listGoals: RequestHandler = async (req, res) =>
  res.json({
    goals: await service.listGoals(context(req), param(req, "reviewId")),
  });
export const createGoal: RequestHandler = async (req, res) =>
  res
    .status(201)
    .json({
      goal: await service.createGoal(
        context(req),
        param(req, "reviewId"),
        req.body as CreateGoalInput,
      ),
    });
export const updateGoal: RequestHandler = async (req, res) =>
  res.json({
    goal: await service.updateGoal(
      context(req),
      param(req, "goalId"),
      req.body as UpdateGoalInput,
    ),
  });
export const summary: RequestHandler = async (req, res) =>
  res.json(await service.summary(context(req)));

export const getPolicy: RequestHandler = async (req, res) =>
  res.json({ policy: await service.getPolicy(context(req)) });
export const updatePolicy: RequestHandler = async (req, res) =>
  res.json({ policy: await service.updatePolicy(context(req), req.body as PerformancePolicyInput) });
export const analytics: RequestHandler = async (req, res) =>
  res.json(await service.analytics(context(req), req.query as AnalyticsQuery));
export const myPerformance: RequestHandler = async (req, res) =>
  res.json(
    await service.myPerformance(context(req), req.query as AnalyticsQuery),
  );