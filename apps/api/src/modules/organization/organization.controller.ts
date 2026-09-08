import type { RequestHandler } from "express";
import { BadRequestError } from "../../utils/errors";
import { env } from "../../config/env";
import { authService } from "../auth";
import { ACCESS_COOKIE } from "../auth/auth.controller";
import * as service from "./organization.service";
import type { CreateOrganizationInput, UpdateOrganizationProfileInput } from "./organization.validation";

export const listIndustries: RequestHandler = async (_req, res) => {
  res.json({ industries: await service.listIndustries() });
};

/** The workspace picker: every organization the caller can enter. */
export const listMine: RequestHandler = (req, res) => {
  const memberships = service.listMine(req.user!);
  res.json({
    organizations: memberships.map((membership) => ({
      id: membership.organizationId,
      slug: membership.slug,
      displayName: membership.displayName,
      isOwner: membership.isOwner,
      url: `/${membership.slug}/dashboard`,
    })),
  });
};

export const create: RequestHandler = async (req, res) => {
  const input = req.body as CreateOrganizationInput;
  const result = await service.createWorkspace(req.user!, input);

  // Creating a workspace also enters it, so the session's active organization
  // moves with a fresh access token rather than leaving the client to switch.
  res.cookie(ACCESS_COOKIE, result.accessToken, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: authService.authTokenTtl.accessSeconds * 1000,
  });

  res.status(201).json({
    organization: {
      id: result.membership.organizationId,
      slug: result.membership.slug,
      displayName: result.membership.displayName,
      isOwner: result.membership.isOwner,
      url: `/${result.membership.slug}/dashboard`,
    },
    accessToken: result.accessToken,
    expiresAt: result.expiresAt.toISOString(),
  });
};

/** The active workspace's own profile. `requireOrganization` proved access. */
export const profile: RequestHandler = async (req, res) => {
  res.json({
    organization: await service.getProfile(req.user!.id, req.organization!.id),
    membership: {
      memberId: req.membership!.memberId,
      isOwner: req.membership!.isOwner,
      roles: req.membership!.roles,
      permissions: req.membership!.permissions,
    },
  });
};

export const updateProfile: RequestHandler = async (req, res) => {
  res.json({ organization: await service.updateProfile(req.user!.id, req.organization!.id, req.body as UpdateOrganizationProfileInput) });
};

export const uploadLogo: RequestHandler = async (req, res) => {
  if (!req.file) throw new BadRequestError("Attach one official PNG or JPEG logo in the file field");
  res.status(201).json({ organization: await service.uploadCompanyLogo(req.user!.id, req.organization!.id, req.file) });
};
export const getOperationalServices: RequestHandler = async (req,res) => res.json({ services: await service.operationalServices(req.user!.id,req.organization!.id) });
export const setOperationalServices: RequestHandler = async (req,res) => res.json({ services: await service.updateOperationalServices(req.user!.id,req.organization!.id,(req.body as {services:string[]}).services) });