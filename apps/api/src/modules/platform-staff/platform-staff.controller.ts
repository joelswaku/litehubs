import type { RequestHandler } from "express";
import * as service from "./platform-staff.service";
import type {
  CreateStaffUserInput,
  UpdateStaffRolesInput,
  UpdateStaffStatusInput,
} from "./platform-staff.validation";

function userId(req: Parameters<RequestHandler>[0]): string {
  const value = req.params.userId;
  return Array.isArray(value) ? value[0]! : value!;
}

export const listRoles: RequestHandler = async (_req, res) => {
  res.json({ roles: await service.listPlatformRoles() });
};

export const listStaff: RequestHandler = async (_req, res) => {
  res.json({ staff: await service.listPlatformStaff() });
};

export const createStaff: RequestHandler = async (req, res) => {
  res.status(201).json({
    staff: await service.createPlatformStaff(req.body as CreateStaffUserInput),
  });
};

export const replaceRoles: RequestHandler = async (req, res) => {
  res.json({
    staff: await service.replacePlatformStaffRoles(
      req.user!.id,
      userId(req),
      req.body as UpdateStaffRolesInput,
    ),
  });
};

export const updateStatus: RequestHandler = async (req, res) => {
  res.json({
    staff: await service.updatePlatformStaffStatus(
      req.user!.id,
      userId(req),
      (req.body as UpdateStaffStatusInput).status,
    ),
  });
};
