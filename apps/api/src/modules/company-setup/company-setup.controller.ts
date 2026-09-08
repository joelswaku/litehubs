import type { Request, RequestHandler } from "express";
import * as service from "./company-setup.service";
import type {
  CreateDepartmentInput,
  CreateInvitationInput,
  CreateProvinceInput,
  CreateRoleInput,
  CreateSiteInput,
  ReplaceMemberProvincesInput,
  ReplaceMemberRolesInput,
  UpdateDepartmentInput,
  UpdateProvinceInput,
  UpdateRoleInput,
  UpdateSiteInput,
} from "./company-setup.validation";

function contextOf(req: Request): service.SetupContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
    permissions: req.membership!.permissions,
  };
}

function parameter(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export const listProvinces: RequestHandler = async (req, res) => {
  res.json({ provinces: await service.listProvinces(contextOf(req)) });
};

export const createProvince: RequestHandler = async (req, res) => {
  const province = await service.createProvince(
    contextOf(req),
    req.body as CreateProvinceInput,
  );
  res.status(201).json({ province });
};

export const updateProvince: RequestHandler = async (req, res) => {
  const province = await service.updateProvince(
    contextOf(req),
    parameter(req, "provinceId"),
    req.body as UpdateProvinceInput,
  );
  res.json({ province });
};

export const deleteProvince: RequestHandler = async (req, res) => {
  await service.deleteProvince(contextOf(req), parameter(req, "provinceId"));
  res.status(204).send();
};

export const listSites: RequestHandler = async (req, res) => {
  res.json({ sites: await service.listSites(contextOf(req)) });
};

export const createSite: RequestHandler = async (req, res) => {
  const site = await service.createSite(
    contextOf(req),
    req.body as CreateSiteInput,
  );
  res.status(201).json({ site });
};

export const updateSite: RequestHandler = async (req, res) => {
  const site = await service.updateSite(
    contextOf(req),
    parameter(req, "siteId"),
    req.body as UpdateSiteInput,
  );
  res.json({ site });
};

export const deleteSite: RequestHandler = async (req, res) => {
  await service.deleteSite(contextOf(req), parameter(req, "siteId"));
  res.status(204).send();
};

export const listDepartments: RequestHandler = async (req, res) => {
  res.json({ departments: await service.listDepartments(contextOf(req)) });
};

export const createDepartment: RequestHandler = async (req, res) => {
  const department = await service.createDepartment(
    contextOf(req),
    req.body as CreateDepartmentInput,
  );
  res.status(201).json({ department });
};

export const updateDepartment: RequestHandler = async (req, res) => {
  const department = await service.updateDepartment(
    contextOf(req),
    parameter(req, "departmentId"),
    req.body as UpdateDepartmentInput,
  );
  res.json({ department });
};

export const deleteDepartment: RequestHandler = async (req, res) => {
  await service.deleteDepartment(
    contextOf(req),
    parameter(req, "departmentId"),
  );
  res.status(204).send();
};

export const listRoles: RequestHandler = async (req, res) => {
  res.json({ roles: await service.listRoles(contextOf(req)) });
};

export const listPermissions: RequestHandler = async (req, res) => {
  res.json({ permissions: await service.listPermissions(contextOf(req)) });
};

export const createRole: RequestHandler = async (req, res) => {
  const role = await service.createRole(
    contextOf(req),
    req.body as CreateRoleInput,
  );
  res.status(201).json({ role });
};

export const updateRole: RequestHandler = async (req, res) => {
  const role = await service.updateRole(
    contextOf(req),
    parameter(req, "roleId"),
    req.body as UpdateRoleInput,
  );
  res.json({ role });
};

export const deleteRole: RequestHandler = async (req, res) => {
  await service.deleteRole(contextOf(req), parameter(req, "roleId"));
  res.status(204).send();
};

export const listMembers: RequestHandler = async (req, res) => {
  res.json({ members: await service.listMembers(contextOf(req)) });
};

export const replaceMemberRoles: RequestHandler = async (req, res) => {
  const assignment = await service.replaceMemberRoles(
    contextOf(req),
    parameter(req, "memberId"),
    req.body as ReplaceMemberRolesInput,
  );
  res.json({ assignment });
};

export const replaceMemberProvinces: RequestHandler = async (req, res) => {
  const assignment = await service.replaceMemberProvinces(
    contextOf(req),
    parameter(req, "memberId"),
    req.body as ReplaceMemberProvincesInput,
  );
  res.json({ assignment });
};

export const listInvitations: RequestHandler = async (req, res) => {
  res.json({ invitations: await service.listInvitations(contextOf(req)) });
};

export const createInvitation: RequestHandler = async (req, res) => {
  const result = await service.createInvitation(
    contextOf(req),
    req.body as CreateInvitationInput,
  );
  res.status(201).json(result);
};

export const revokeInvitation: RequestHandler = async (req, res) => {
  await service.revokeInvitation(
    contextOf(req),
    parameter(req, "invitationId"),
  );
  res.status(204).send();
};
