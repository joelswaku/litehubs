import type { RequestHandler } from "express";
import * as service from "./platform-tenants.service";

/**
 * The staff console's tenant endpoints.
 *
 * Every handler passes `req.user!.id` into the service, which pins it as
 * `app.user_id` so migration 033's policies apply. The caller's identity is
 * therefore what decides visibility, at the database — not a `WHERE` clause the
 * handler could forget.
 */

export const summary: RequestHandler = async (req, res) => {
  res.json({ summary: await service.platformSummary(req.user!.id) });
};

export const listTenants: RequestHandler = async (req, res) => {
  const query = req.query as {
    status?: string;
    industryCode?: string;
    search?: string;
    limit?: number;
    offset?: number;
  };

  const result = await service.listTenants(req.user!.id, {
    status: query.status,
    industryCode: query.industryCode,
    search: query.search,
    limit: query.limit,
    offset: query.offset,
  });

  res.json(result);
};

export const getTenant: RequestHandler = async (req, res) => {
  const slug = String(req.params.slug);
  res.json({ tenant: await service.getTenant(req.user!.id, slug) });
};

export const setStatus: RequestHandler = async (req, res) => {
  const slug = String(req.params.slug);
  const { status } = req.body as { status: "active" | "suspended" };
  res.json({
    tenant: await service.setTenantStatus(req.user!.id, slug, status),
  });
};
