import type { Request, RequestHandler } from "express";
import * as service from "./discipline.service";
import type {
  ActionQuery,
  CreateActionInput,
  DecisionInput,
  UpdateActionInput,
} from "./discipline.validation";

function context(req: Request): service.DisciplineContext {
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
export const listActions: RequestHandler = async (req, res) =>
  res.json({
    actions: await service.listActions(context(req), req.query as ActionQuery),
  });
export const createAction: RequestHandler = async (req, res) =>
  res.status(201).json({
    action: await service.createAction(
      context(req),
      req.body as CreateActionInput,
    ),
  });
export const updateAction: RequestHandler = async (req, res) =>
  res.json({
    action: await service.updateAction(
      context(req),
      param(req, "actionId"),
      req.body as UpdateActionInput,
    ),
  });
export const decideAction: RequestHandler = async (req, res) =>
  res.json({
    action: await service.decideAction(
      context(req),
      param(req, "actionId"),
      req.body as DecisionInput,
    ),
  });
export const summary: RequestHandler = async (req, res) =>
  res.json(await service.summary(context(req)));
