import type { RequestHandler } from "express";
import * as service from "./platform-tenants.service";

/** Every mutation is guarded by platform_super_admin in the router. */
export const summary: RequestHandler = async (req, res) => {
  res.json({ summary: await service.platformSummary(req.user!.id) });
};

export const listTenants: RequestHandler = async (req, res) => {
  const query = req.query as { status?: string; industryCode?: string; search?: string; limit?: number; offset?: number };
  res.json(await service.listTenants(req.user!.id, query));
};

export const getTenant: RequestHandler = async (req, res) => {
  res.json({ tenant: await service.getTenant(req.user!.id, String(req.params.slug)) });
};

export const getDeletionContext: RequestHandler = async (req, res) => {
  res.json({ detail: await service.getTenantDeletionContext(req.user!.id, String(req.params.slug)) });
};

export const setStatus: RequestHandler = async (req, res) => {
  const { status } = req.body as { status: "active" | "suspended" };
  res.json({ tenant: await service.setTenantStatus(req.user!.id, String(req.params.slug), status) });
};

export const scheduleDeletion: RequestHandler = async (req, res) => {
  const input = req.body as { confirmationName: string; currentPassword: string };
  res.json({ tenant: await service.scheduleTenantDeletion(req.user!.id, String(req.params.slug), input) });
};

export const cancelDeletion: RequestHandler = async (req, res) => {
  res.json({ tenant: await service.cancelTenantDeletion(req.user!.id, String(req.params.slug)) });
};

export const restore: RequestHandler = async (req, res) => {
  res.json({ tenant: await service.restoreTenant(req.user!.id, String(req.params.slug)) });
};

export const purge: RequestHandler = async (req, res) => {
  const input = req.body as { confirmationName: string; currentPassword: string };
  await service.permanentlyPurgeTenant(req.user!.id, String(req.params.slug), input);
  res.status(204).send();
};