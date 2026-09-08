import type { Request, RequestHandler } from "express";
import * as service from "./leave.service";
import type {
  CancelLeaveInput,
  CreateLeaveTypeInput,
  DecideLeaveInput,
  LeaveRequestQuery,
  RequestLeaveInput,
  UpdateLeaveTypeInput,
} from "./leave.validation";
function context(req: Request): service.LeaveContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
    permissions: req.membership!.permissions,
  };
}
function param(req: Request, key: string) {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
export const listTypes: RequestHandler = async (req, res) =>
  res.json({ leaveTypes: await service.listTypes(context(req)) });
export const createType: RequestHandler = async (req, res) =>
  res.status(201).json({
    leaveType: await service.createType(
      context(req),
      req.body as CreateLeaveTypeInput,
    ),
  });
export const updateType: RequestHandler = async (req, res) =>
  res.json({
    leaveType: await service.updateType(
      context(req),
      param(req, "leaveTypeId"),
      req.body as UpdateLeaveTypeInput,
    ),
  });
export const listRequests: RequestHandler = async (req, res) =>
  res.json({
    requests: await service.listRequests(
      context(req),
      req.query as LeaveRequestQuery,
    ),
  });
export const requestLeave: RequestHandler = async (req, res) =>
  res.status(201).json({
    request: await service.requestLeave(
      context(req),
      req.body as RequestLeaveInput,
    ),
  });
export const decideLeave: RequestHandler = async (req, res) =>
  res.json({
    request: await service.decideLeave(
      context(req),
      param(req, "leaveRequestId"),
      req.body as DecideLeaveInput,
    ),
  });
export const cancelLeave: RequestHandler = async (req, res) =>
  res.json({
    request: await service.cancelLeave(
      context(req),
      param(req, "leaveRequestId"),
      req.body as CancelLeaveInput,
    ),
  });
export const summary: RequestHandler = async (req, res) =>
  res.json(
    await service.summary(
      context(req),
      Number(req.query.year ?? new Date().getUTCFullYear()),
    ),
  );
export const currentEmployee: RequestHandler = async (req, res) =>
  res.json({ employee: await service.currentEmployee(context(req)) });
