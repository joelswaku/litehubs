import type { Request, RequestHandler } from "express";
import { evaluateAutomaticAlerts } from "../alerts/alert-engine.service";
import * as service from "./agriculture.service";
import type { AgricultureResource } from "./agriculture.validation";
import type { AgricultureListQuery } from "./agriculture.validation";

function contextOf(req: Request): service.AgricultureContext {
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

const alertingResources = new Set<AgricultureResource>(["scouting", "losses"]);
async function refreshAlerts(req: Request, resource: AgricultureResource) {
  if (alertingResources.has(resource))
    await evaluateAutomaticAlerts(contextOf(req), ["agriculture"]);
}
function resourceOf(req: Request): AgricultureResource {
  return parameter(req, "resource") as AgricultureResource;
}

export const listAgricultureRecords: RequestHandler = async (req, res) => {
  res.json({
    resource: resourceOf(req),
    records: await service.listAgricultureRecords(
      contextOf(req),
      resourceOf(req),
      req.query as unknown as AgricultureListQuery,
    ),
  });
};

export const getAgricultureRecord: RequestHandler = async (req, res) => {
  res.json({
    record: await service.getAgricultureRecord(
      contextOf(req),
      resourceOf(req),
      parameter(req, "recordId"),
    ),
  });
};

export const createAgricultureRecord: RequestHandler = async (req, res) => {
  const resource = resourceOf(req);
  const record = await service.createAgricultureRecord(
    contextOf(req),
    resource,
    req.body,
  );
  await refreshAlerts(req, resource);
  res.status(201).json({ record });
};

export const updateAgricultureRecord: RequestHandler = async (req, res) => {
  const resource = resourceOf(req);
  const record = await service.updateAgricultureRecord(
    contextOf(req),
    resource,
    parameter(req, "recordId"),
    req.body,
  );
  await refreshAlerts(req, resource);
  res.json({ record });
};

export const deleteAgricultureRecord: RequestHandler = async (req, res) => {
  await service.deleteAgricultureRecord(
    contextOf(req),
    resourceOf(req),
    parameter(req, "recordId"),
  );
  res.status(204).send();
};

export const agricultureOverview: RequestHandler = async (req, res) => {
  res.json({
    overview: await service.agricultureOverview(contextOf(req), req.query),
  });
};
