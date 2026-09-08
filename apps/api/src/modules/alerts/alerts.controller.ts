import type { Request, RequestHandler } from "express";
import { evaluateAutomaticAlerts } from "./alert-engine.service";
import * as service from "./alerts.service";
import type { ListAlertsInput } from "./alerts.validation";

function contextOf(req: Request): service.AlertContext {
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

export const listAlerts: RequestHandler = async (req, res) => {
  const result = await service.listAlerts(
    contextOf(req),
    req.query as unknown as ListAlertsInput,
  );
  res.json(result);
};

export const evaluateAlerts: RequestHandler = async (req, res) => {
  res.json({ evaluation: await evaluateAutomaticAlerts(contextOf(req)) });
};

export const getAlert: RequestHandler = async (req, res) => {
  res.json({
    alert: await service.getAlert(contextOf(req), parameter(req, "alertId")),
  });
};

export const createAlert: RequestHandler = async (req, res) => {
  const alert = await service.createAlert(contextOf(req), req.body);
  res.status(201).json({ alert });
};

export const updateAlert: RequestHandler = async (req, res) => {
  res.json({
    alert: await service.updateAlert(
      contextOf(req),
      parameter(req, "alertId"),
      req.body,
    ),
  });
};

export const acknowledgeAlert: RequestHandler = async (req, res) => {
  res.json({
    alert: await service.acknowledgeAlert(
      contextOf(req),
      parameter(req, "alertId"),
    ),
  });
};

export const resolveAlert: RequestHandler = async (req, res) => {
  res.json({
    alert: await service.resolveAlert(
      contextOf(req),
      parameter(req, "alertId"),
      req.body.resolutionNote,
    ),
  });
};

export const dismissAlert: RequestHandler = async (req, res) => {
  res.json({
    alert: await service.dismissAlert(
      contextOf(req),
      parameter(req, "alertId"),
      req.body.resolutionNote,
    ),
  });
};

export const deleteAlert: RequestHandler = async (req, res) => {
  await service.deleteAlert(contextOf(req), parameter(req, "alertId"));
  res.status(204).send();
};
