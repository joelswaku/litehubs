import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { validate } from "../../middleware/validation.middleware";
import { organizationSlugSchema } from "../organization/organization.validation";
import * as service from "./displays.service";

const id = z.string().uuid();
const organizationParams = z.object({ orgSlug: organizationSlugSchema });
const displayParams = organizationParams.extend({ displayId: id });
const displayInput = z.object({
  name: z.string().trim().min(2).max(80),
  siteId: id.nullable().optional(),
  sections: z.array(z.enum(["poultry", "pigs", "agriculture"])).max(3),
  rotateSeconds: z.number().int().min(8).max(300),
  videoDocumentIds: z.array(id).max(20),
  videosBetween: z.boolean(),
  message: z.string().trim().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
});

const context = (req: Request): service.DisplayContext => ({
  organizationId: req.organization!.id,
  userId: req.user!.id,
  memberId: req.membership!.memberId,
  isOwner: req.membership!.isOwner,
  permissions: req.membership!.permissions,
});
const param = (req: Request, key: string) => {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
};
const inside = (params: z.ZodTypeAny, body?: z.ZodTypeAny) =>
  [authenticate, validate(body ? { params, body } : { params }), requireOrganization] as const;

export const displayRoutes = Router();
const base = "/organizations/:orgSlug/displays";

displayRoutes.get(base, ...inside(organizationParams), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await service.listDisplays(context(req)));
});
displayRoutes.post(base, ...inside(organizationParams, displayInput), async (req, res) => {
  res.status(201).json(await service.createDisplay(context(req), req.body as service.DisplayInput));
});
displayRoutes.put(`${base}/:displayId`, ...inside(displayParams, displayInput), async (req, res) => {
  res.json(await service.updateDisplay(context(req), param(req, "displayId"), req.body as service.DisplayInput));
});
displayRoutes.post(`${base}/:displayId/regenerate`, ...inside(displayParams), async (req, res) => {
  res.json(await service.regenerateDisplayLink(context(req), param(req, "displayId")));
});
displayRoutes.delete(`${base}/:displayId`, ...inside(displayParams), async (req, res) => {
  res.json(await service.deleteDisplay(context(req), param(req, "displayId")));
});

/* Public screen: the secret link is the access. */
const screenLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false });
displayRoutes.get("/public/displays/:token", screenLimiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  res.json(await service.publicDisplay(param(req, "token")));
});
displayRoutes.get("/public/displays/:token/videos/:documentId", screenLimiter, async (req: Request, res: Response) => {
  const documentId = id.parse(param(req, "documentId"));
  const video = await service.publicDisplayVideo(param(req, "token"), documentId);
  const total = video.buffer.length;
  res.type(video.mimeType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = Math.min(match?.[2] ? Number(match[2]) : total - 1, total - 1);
    if (!match || !Number.isSafeInteger(start) || start >= total || end < start) {
      res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
      return;
    }
    res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.setHeader("Content-Length", String(end - start + 1));
    res.end(video.buffer.subarray(start, end + 1));
    return;
  }
  res.setHeader("Content-Length", String(total));
  res.end(video.buffer);
});
