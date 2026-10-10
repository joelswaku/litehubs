import { Router, type Request, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { storage } from "../../config/storage";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { validate } from "../../middleware/validation.middleware";
import { BadRequestError } from "../../utils/errors";
import type { ChatContext } from "../chat/chat.service";
import { organizationSlugSchema } from "../organization/organization.validation";
import { validSignature } from "./meta-graph";
import * as service from "./social.service";

const id = z.string().uuid();
const organizationParams = z.object({ orgSlug: organizationSlugSchema });
const accountParams = organizationParams.extend({ accountId: id });
const commentParams = organizationParams.extend({ commentId: id });
const postParams = organizationParams.extend({ postId: id });
const httpsUrl = z.string().trim().url().max(1000).refine((value) => value.startsWith("https://"), "Lien https requis");
const postInput = z.object({
  message: z.string().max(5000).default(""),
  imageUrl: httpsUrl.nullable().optional(),
  linkUrl: httpsUrl.nullable().optional(),
  toFacebook: z.boolean(),
  toInstagram: z.boolean(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
});

function context(req: Request): ChatContext {
  return {
    organizationId: req.organization!.id,
    organizationSlug: req.organization!.slug,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
    permissions: req.membership!.permissions,
  };
}
const param = (req: Request, key: string) => {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
};
const inside = (params: z.ZodTypeAny, body?: z.ZodTypeAny) =>
  [authenticate, validate(body ? { params, body } : { params }), requireOrganization] as const;
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: storage.maxUploadBytes } });
const oneImage: RequestHandler = (req, res, next) =>
  upload.single("file")(req, res, (error: unknown) => (error ? next(new BadRequestError("Image trop lourde ou invalide")) : next()));

export const socialRoutes = Router();
const base = "/organizations/:orgSlug/social";

socialRoutes.get(base, ...inside(organizationParams), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await service.overview(context(req)));
});
socialRoutes.post(`${base}/connect`, ...inside(organizationParams), (req, res) => {
  res.json(service.connectUrl(context(req)));
});
socialRoutes.patch(`${base}/accounts/:accountId`, ...inside(accountParams, z.object({ status: z.enum(["active", "paused"]) })), async (req, res) => {
  res.json(await service.updateAccount(context(req), param(req, "accountId"), (req.body as { status: "active" | "paused" }).status));
});
socialRoutes.delete(`${base}/accounts/:accountId`, ...inside(accountParams), async (req, res) => {
  res.json(await service.disconnect(context(req), param(req, "accountId")));
});

socialRoutes.get(`${base}/comments`, ...inside(organizationParams), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const filter = (req.query as { filter?: string }).filter === "all" ? "all" : "todo";
  res.json(await service.listComments(context(req), filter));
});
socialRoutes.post(`${base}/comments/:commentId/reply`, ...inside(commentParams, z.object({ body: z.string().trim().min(1).max(2000) })), async (req, res) => {
  res.json(await service.replyToComment(context(req), param(req, "commentId"), (req.body as { body: string }).body));
});
socialRoutes.post(`${base}/comments/:commentId/suggest`, ...inside(commentParams), async (req, res) => {
  res.json(await service.suggestCommentReply(context(req), param(req, "commentId")));
});
socialRoutes.patch(`${base}/comments/:commentId`, ...inside(commentParams, z.object({ done: z.boolean() })), async (req, res) => {
  res.json(await service.markComment(context(req), param(req, "commentId"), (req.body as { done: boolean }).done));
});

socialRoutes.get(`${base}/posts`, ...inside(organizationParams), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await service.listPosts(context(req)));
});
socialRoutes.post(`${base}/posts`, ...inside(organizationParams, postInput), async (req, res) => {
  res.status(201).json(await service.createPost(context(req), req.body as z.infer<typeof postInput>));
});
socialRoutes.post(`${base}/posts/:postId/retry`, ...inside(postParams), async (req, res) => {
  res.json(await service.retryPost(context(req), param(req, "postId")));
});
socialRoutes.delete(`${base}/posts/:postId`, ...inside(postParams), async (req, res) => {
  res.json(await service.deletePost(context(req), param(req, "postId")));
});
socialRoutes.post(`${base}/images`, authenticate, oneImage, validate({ params: organizationParams }), requireOrganization, async (req, res) => {
  if (!req.file) throw new BadRequestError("Choisissez une image");
  res.status(201).json(await service.uploadPostImage(context(req), req.file));
});

/* Meta callbacks (public). */
const metaLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: "draft-7", legacyHeaders: false });

socialRoutes.get("/public/meta/oauth/callback", metaLimiter, async (req, res) => {
  res.redirect(302, await service.finishConnect(req.query as Record<string, string>));
});

// Webhook verification: Meta sends the verify token chosen in the app settings.
socialRoutes.get("/public/meta/webhook", metaLimiter, (req, res) => {
  const query = req.query as Record<string, string>;
  if (env.meta.verifyToken && query["hub.mode"] === "subscribe" && query["hub.verify_token"] === env.meta.verifyToken) {
    res.type("text/plain").send(query["hub.challenge"] ?? "");
    return;
  }
  res.sendStatus(403);
});

socialRoutes.post("/public/meta/webhook", metaLimiter, (req, res) => {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  const payload = (req.body ?? {}) as { object?: string; entry?: Array<{ id?: string }> };
  logger.info(
    { object: payload.object, entries: (payload.entry ?? []).map((entry) => entry.id), bytes: raw?.length ?? 0 },
    "Meta webhook received",
  );
  if (!validSignature(raw, req.get("x-hub-signature-256") ?? undefined)) {
    logger.warn("Meta webhook with an invalid signature");
    res.sendStatus(401);
    return;
  }
  res.sendStatus(200);
  void service.processWebhook(req.body as Parameters<typeof service.processWebhook>[0]).catch((error: unknown) =>
    logger.error({ err: error }, "Meta webhook processing failed"),
  );
});
