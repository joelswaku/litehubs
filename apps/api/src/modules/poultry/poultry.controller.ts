import type { Request, RequestHandler } from "express";
import { evaluateAutomaticAlerts } from "../alerts/alert-engine.service";
import * as service from "./poultry.service";
import type { PoultryResource } from "./poultry.validation";

function contextOf(req: Request): service.PoultryContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
  };
}

function parameter(req: Request, name: string): string {
  const item = req.params[name];
  return Array.isArray(item) ? (item[0] ?? "") : (item ?? "");
}

const alertingResources = new Set<PoultryResource>([
  "mortality",
  "health",
  "weights",
  "vaccinations",
]);
async function refreshAlerts(req: Request, resource: PoultryResource) {
  if (alertingResources.has(resource))
    await evaluateAutomaticAlerts(contextOf(req), ["poultry"]);
}
function resourceOf(req: Request): PoultryResource {
  return parameter(req, "resource") as PoultryResource;
}

export const listPoultryRecords: RequestHandler = async (req, res) => {
  const resource = resourceOf(req);
  res.json({
    resource,
    records: await service.listPoultryRecords(
      contextOf(req),
      resource,
      req.query,
    ),
  });
};

export const getPoultryRecord: RequestHandler = async (req, res) => {
  const resource = resourceOf(req);
  res.json({
    record: await service.getPoultryRecord(
      contextOf(req),
      resource,
      parameter(req, "recordId"),
    ),
  });
};

export const createPoultryRecord: RequestHandler = async (req, res) => {
  const resource = resourceOf(req);
  const record = await service.createPoultryRecord(
    contextOf(req),
    resource,
    req.body,
  );
  await refreshAlerts(req, resource);
  res.status(201).json({ record });
};

export const updatePoultryRecord: RequestHandler = async (req, res) => {
  const resource = resourceOf(req);
  const record = await service.updatePoultryRecord(
    contextOf(req),
    resource,
    parameter(req, "recordId"),
    req.body,
  );
  await refreshAlerts(req, resource);
  res.json({ record });
};

export const deletePoultryRecord: RequestHandler = async (req, res) => {
  await service.deletePoultryRecord(
    contextOf(req),
    resourceOf(req),
    parameter(req, "recordId"),
  );
  res.status(204).send();
};

export const poultryOverview: RequestHandler = async (req, res) => {
  res.json({
    overview: await service.poultryOverview(contextOf(req), req.query),
  });
};
export const downloadFlockProfilePdf: RequestHandler = async (req, res) => {
  const bytes = await service.flockProfilePdf(
    contextOf(req),
    parameter(req, "flockId"),
  );
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="flock-profile-${parameter(req, "flockId")}.pdf"`);
  res.send(bytes);
};