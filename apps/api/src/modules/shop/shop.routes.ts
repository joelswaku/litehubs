import { Router, type Request, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import { storage } from "../../config/storage";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { validate } from "../../middleware/validation.middleware";
import { BadRequestError } from "../../utils/errors";
import type { ChatContext } from "../chat/chat.service";
import { organizationSlugSchema } from "../organization/organization.validation";
import * as service from "./shop.service";

const id = z.string().uuid();
const organizationParams = z.object({ orgSlug: organizationSlugSchema });
const productParams = organizationParams.extend({ productId: id });
const categoryParams = organizationParams.extend({ categoryId: id });
const orderParams = organizationParams.extend({ orderId: id });
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const httpsUrl = z.string().trim().url().max(1000).refine((value) => value.startsWith("https://") || value.startsWith("/"), "Lien https requis");

const settingsInput = z.object({
  enabled: z.boolean(),
  deliveryEnabled: z.boolean(),
  pickupEnabled: z.boolean(),
  deliveryNote: optionalText(1000),
  paymentNote: optionalText(1000),
  orderNote: optionalText(1000),
});
const categoryInput = z.object({
  nameFr: z.string().trim().min(1).max(80),
  nameEn: optionalText(80),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isVisible: z.boolean().optional(),
});
const productInput = z.object({
  price: z.number().min(0).max(1e12).nullable().optional(),
  isAvailable: z.boolean().optional(),
  minimumQuantity: z.number().min(0).max(1e9).optional(),
  web: z.object({
    visible: z.boolean(),
    title: optionalText(160),
    description: optionalText(2000),
    imageUrl: httpsUrl.nullable().optional(),
    categoryId: id.nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    quantityStep: z.number().positive().max(1e6).optional(),
    unitLabel: optionalText(60),
  }),
});
const site = z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,80}$/);
const publicParams = z.object({ site });
const trackParams = publicParams.extend({ token: z.string().regex(/^[A-Za-z0-9_-]{20,60}$/) });
const orderInput = z.object({
  items: z.array(z.object({ productId: id, quantity: z.number().positive().max(1e6) })).min(1).max(50),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(40),
  email: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  deliveryMode: z.enum(["delivery", "pickup"]),
  address: z.string().trim().max(500).optional(),
  note: z.string().trim().max(1000).optional(),
  website: z.string().max(0).optional(), // honeypot
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

export const shopRoutes = Router();
const base = "/organizations/:orgSlug/shop";

shopRoutes.get(base, ...inside(organizationParams), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await service.adminOverview(context(req)));
});
shopRoutes.put(`${base}/settings`, ...inside(organizationParams, settingsInput), async (req, res) => {
  res.json(await service.saveSettings(context(req), req.body as Parameters<typeof service.saveSettings>[1]));
});
shopRoutes.post(`${base}/categories`, ...inside(organizationParams, categoryInput), async (req, res) => {
  res.json(await service.saveCategory(context(req), null, req.body as z.infer<typeof categoryInput>));
});
shopRoutes.put(`${base}/categories/:categoryId`, ...inside(categoryParams, categoryInput), async (req, res) => {
  res.json(await service.saveCategory(context(req), param(req, "categoryId"), req.body as z.infer<typeof categoryInput>));
});
shopRoutes.delete(`${base}/categories/:categoryId`, ...inside(categoryParams), async (req, res) => {
  res.json(await service.deleteCategory(context(req), param(req, "categoryId")));
});
shopRoutes.put(`${base}/products/:productId`, ...inside(productParams, productInput), async (req, res) => {
  res.json(await service.saveProduct(context(req), param(req, "productId"), req.body as z.infer<typeof productInput>));
});
shopRoutes.post(`${base}/images`, authenticate, oneImage, validate({ params: organizationParams }), requireOrganization, async (req, res) => {
  if (!req.file) throw new BadRequestError("Choisissez une image");
  res.status(201).json(await service.uploadProductImage(context(req), req.file));
});
shopRoutes.get(`${base}/orders`, ...inside(organizationParams), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await service.listWebOrders(context(req), (req.query as { filter?: string }).filter === "all" ? "all" : "todo"));
});
shopRoutes.post(`${base}/orders/:orderId/cancel`, ...inside(orderParams, z.object({ reason: z.string().max(300).default("") })), async (req, res) => {
  res.json(await service.cancelWebOrder(context(req), param(req, "orderId"), (req.body as { reason: string }).reason));
});

/* Public shop (no login). */
const readLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false });
const orderLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "SHOP_RATE_LIMITED", message: "Trop de commandes. Réessayez plus tard ou appelez-nous." } },
});
shopRoutes.get("/public/shop/:site", readLimiter, validate({ params: publicParams }), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await service.publicCatalog(param(req, "site")));
});
shopRoutes.post("/public/shop/:site/orders", orderLimiter, validate({ params: publicParams, body: orderInput }), async (req, res) => {
  res.status(201).json(await service.placeOrder(param(req, "site"), req.body as z.infer<typeof orderInput>));
});
shopRoutes.get("/public/shop/:site/orders/:token", readLimiter, validate({ params: trackParams }), async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await service.publicOrder(param(req, "site"), param(req, "token")));
});
