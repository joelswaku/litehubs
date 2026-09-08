import type { Request, RequestHandler } from "express";
import { evaluateAutomaticAlerts } from "../alerts/alert-engine.service";
import * as service from "./pig.service";
import type { PigResource } from "./pig.validation";

function contextOf(req: Request): service.PigContext {
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

const alertingResources = new Set<PigResource>(["mortality", "health"]);
async function refreshAlerts(req: Request, resource: PigResource) {
  if (alertingResources.has(resource))
    await evaluateAutomaticAlerts(contextOf(req), ["pigs"]);
}
function resourceOf(req: Request): PigResource {
  return parameter(req, "resource") as PigResource;
}

export const listPigRecords: RequestHandler = async (req, res) => {
  const resource = resourceOf(req);
  res.json({
    resource,
    records: await service.listPigRecords(contextOf(req), resource, req.query),
  });
};

export const getPigRecord: RequestHandler = async (req, res) => {
  const resource = resourceOf(req);
  res.json({
    record: await service.getPigRecord(
      contextOf(req),
      resource,
      parameter(req, "recordId"),
    ),
  });
};

export const createPigRecord: RequestHandler = async (req, res) => {
  const record = await service.createPigRecord(
    contextOf(req),
    resourceOf(req),
    req.body,
  );
  await refreshAlerts(req, resourceOf(req));
  res.status(201).json({ record });
};

export const updatePigRecord: RequestHandler = async (req, res) => {
  const resource = resourceOf(req);
  const record = await service.updatePigRecord(
    contextOf(req),
    resource,
    parameter(req, "recordId"),
    req.body,
  );
  await refreshAlerts(req, resource);
  res.json({ record });
};

export const deletePigRecord: RequestHandler = async (req, res) => {
  await service.deletePigRecord(
    contextOf(req),
    resourceOf(req),
    parameter(req, "recordId"),
  );
  res.status(204).send();
};

export const pigOverview: RequestHandler = async (req, res) => {
  res.json({ overview: await service.pigOverview(contextOf(req), req.query) });
};
