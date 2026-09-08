import type { Request, RequestHandler } from "express";
import * as service from "./poultry-performance.service";
import type { PoultryContext } from "./poultry.service";

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

export const listClimateProfiles: RequestHandler = async (req, res) =>
  res.json({
    climateProfiles: await service.listClimateProfiles(contextOf(req)),
  });
export const getClimateProfile: RequestHandler = async (req, res) =>
  res.json({
    climateProfile: await service.getClimateProfile(
      contextOf(req),
      parameter(req, "climateProfileId"),
    ),
  });
export const createClimateProfile: RequestHandler = async (req, res) =>
  res.status(201).json({
    climateProfile: await service.createClimateProfile(
      contextOf(req),
      req.body,
    ),
  });
export const updateClimateProfile: RequestHandler = async (req, res) =>
  res.json({
    climateProfile: await service.updateClimateProfile(
      contextOf(req),
      parameter(req, "climateProfileId"),
      req.body,
    ),
  });
export const deleteClimateProfile: RequestHandler = async (req, res) => {
  await service.deleteClimateProfile(
    contextOf(req),
    parameter(req, "climateProfileId"),
  );
  res.status(204).send();
};

export const listPerformanceModels: RequestHandler = async (req, res) =>
  res.json({
    performanceModels: await service.listPerformanceModels(contextOf(req)),
  });
export const getPerformanceModel: RequestHandler = async (req, res) =>
  res.json({
    performanceModel: await service.getPerformanceModel(
      contextOf(req),
      parameter(req, "modelId"),
    ),
  });
export const createPerformanceModel: RequestHandler = async (req, res) =>
  res.status(201).json({
    performanceModel: await service.createPerformanceModel(
      contextOf(req),
      req.body,
    ),
  });
export const updatePerformanceModel: RequestHandler = async (req, res) =>
  res.json({
    performanceModel: await service.updatePerformanceModel(
      contextOf(req),
      parameter(req, "modelId"),
      req.body,
    ),
  });
export const deletePerformanceModel: RequestHandler = async (req, res) => {
  await service.deletePerformanceModel(
    contextOf(req),
    parameter(req, "modelId"),
  );
  res.status(204).send();
};

export const listWeeklyTargets: RequestHandler = async (req, res) =>
  res.json({
    weeklyTargets: await service.listWeeklyTargets(
      contextOf(req),
      parameter(req, "modelId"),
    ),
  });
export const createWeeklyTarget: RequestHandler = async (req, res) =>
  res.status(201).json({
    weeklyTarget: await service.createWeeklyTarget(
      contextOf(req),
      parameter(req, "modelId"),
      req.body,
    ),
  });
export const updateWeeklyTarget: RequestHandler = async (req, res) =>
  res.json({
    weeklyTarget: await service.updateWeeklyTarget(
      contextOf(req),
      parameter(req, "modelId"),
      parameter(req, "targetId"),
      req.body,
    ),
  });
export const deleteWeeklyTarget: RequestHandler = async (req, res) => {
  await service.deleteWeeklyTarget(
    contextOf(req),
    parameter(req, "modelId"),
    parameter(req, "targetId"),
  );
  res.status(204).send();
};

export const listVaccineSchedules: RequestHandler = async (req, res) =>
  res.json({
    vaccineSchedules: await service.listVaccineSchedules(
      contextOf(req),
      parameter(req, "modelId"),
    ),
  });
export const createVaccineSchedule: RequestHandler = async (req, res) =>
  res.status(201).json({
    vaccineSchedule: await service.createVaccineSchedule(
      contextOf(req),
      parameter(req, "modelId"),
      req.body,
    ),
  });
export const updateVaccineSchedule: RequestHandler = async (req, res) =>
  res.json({
    vaccineSchedule: await service.updateVaccineSchedule(
      contextOf(req),
      parameter(req, "modelId"),
      parameter(req, "scheduleId"),
      req.body,
    ),
  });
export const deleteVaccineSchedule: RequestHandler = async (req, res) => {
  await service.deleteVaccineSchedule(
    contextOf(req),
    parameter(req, "modelId"),
    parameter(req, "scheduleId"),
  );
  res.status(204).send();
};

export const flockPerformance: RequestHandler = async (req, res) =>
  res.json({
    performance: await service.flockPerformance(
      contextOf(req),
      parameter(req, "flockId"),
      req.query,
    ),
  });
export const listDailyWork: RequestHandler = async (req, res) =>
  res.json({
    dailyWork: await service.listDailyWork(
      contextOf(req),
      parameter(req, "flockId"),
      req.query,
    ),
  });
export const listMyDailyWork: RequestHandler = async (req, res) =>
  res.json({
    dailyWork: await service.listMyDailyWork(contextOf(req), req.query),
  });
export const createDailyWork: RequestHandler = async (req, res) =>
  res.status(201).json({
    workItem: await service.createDailyWork(
      contextOf(req),
      parameter(req, "flockId"),
      req.body,
    ),
  });
export const updateDailyWork: RequestHandler = async (req, res) =>
  res.json({
    workItem: await service.updateDailyWork(
      contextOf(req),
      parameter(req, "workItemId"),
      req.body,
    ),
  });
export const reviewDailyWork: RequestHandler = async (req, res) =>
  res.json({
    workItem: await service.reviewDailyWork(
      contextOf(req),
      parameter(req, "workItemId"),
      req.body,
    ),
  });
export const generateDailyWork: RequestHandler = async (req, res) =>
  res.json({
    dailyWork: await service.generateDailyWork(
      contextOf(req),
      parameter(req, "flockId"),
      req.body,
    ),
  });
