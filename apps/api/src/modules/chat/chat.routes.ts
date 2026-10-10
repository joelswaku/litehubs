import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { storage } from "../../config/storage";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { validate } from "../../middleware/validation.middleware";
import { BadRequestError } from "../../utils/errors";
import * as controller from "./chat.controller";
import {
  chatAccessInput,
  conversationParams,
  directionInput,
  directionLabelInput,
  messageInput,
  messageParams,
  organizationParams,
  pinInput,
  publicHumanInput,
  publicSendInput,
  publicSessionParams,
  publicSiteParams,
  publicStartInput,
  visitorReplyInput,
  visitorSessionParams,
  visitorUpdateInput,
} from "./chat.validation";

/** Every active member of the workspace can use the team chat; access to
 * private threads and moderation is checked in the service. */
export const chatRoutes = Router();
const base = "/organizations/:orgSlug/chat";
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: storage.maxUploadBytes } });
const oneFile: RequestHandler = (req, res, next) =>
  upload.single("file")(req, res, (error: unknown) =>
    error ? next(new BadRequestError("Fichier trop volumineux ou invalide")) : next(),
  );

chatRoutes.get(`${base}`, authenticate, validate({ params: organizationParams }), requireOrganization, controller.overview);
chatRoutes.get(`${base}/unread`, authenticate, validate({ params: organizationParams }), requireOrganization, controller.unread);
chatRoutes.post(`${base}/direction`, authenticate, validate({ params: organizationParams, body: directionInput }), requireOrganization, controller.openDirection);
chatRoutes.get(`${base}/access`, authenticate, validate({ params: organizationParams }), requireOrganization, controller.access);
chatRoutes.put(`${base}/access`, authenticate, validate({ params: organizationParams, body: chatAccessInput }), requireOrganization, controller.saveAccess);
chatRoutes.get(`${base}/conversations/:conversationId/messages`, authenticate, validate({ params: conversationParams }), requireOrganization, controller.messages);
chatRoutes.post(`${base}/conversations/:conversationId/messages`, authenticate, oneFile, validate({ params: conversationParams, body: messageInput }), requireOrganization, controller.send);
chatRoutes.delete(`${base}/messages/:messageId`, authenticate, validate({ params: messageParams }), requireOrganization, controller.remove);
chatRoutes.patch(`${base}/messages/:messageId/pin`, authenticate, validate({ params: messageParams, body: pinInput }), requireOrganization, controller.pin);
chatRoutes.get(`${base}/messages/:messageId/file`, authenticate, validate({ params: messageParams }), requireOrganization, controller.file);
chatRoutes.put(`${base}/direction-label`, authenticate, validate({ params: organizationParams, body: directionLabelInput }), requireOrganization, controller.saveLabel);

/* Website chat: team side */
chatRoutes.get(`${base}/visitors`, authenticate, validate({ params: organizationParams }), requireOrganization, controller.visitorSessions);
chatRoutes.get(`${base}/visitors/:sessionId`, authenticate, validate({ params: visitorSessionParams }), requireOrganization, controller.visitorSession);
chatRoutes.post(`${base}/visitors/:sessionId/messages`, authenticate, validate({ params: visitorSessionParams, body: visitorReplyInput }), requireOrganization, controller.visitorReply);
chatRoutes.patch(`${base}/visitors/:sessionId`, authenticate, validate({ params: visitorSessionParams, body: visitorUpdateInput }), requireOrganization, controller.visitorUpdate);

/* Website chat: public visitors (no login).  Conversations are identified by
 * a random token kept in the visitor's browser. */
const limiter = (windowMinutes: number, limit: number) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1_000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: { code: "WEBSITE_CHAT_RATE_LIMITED", message: "Trop de messages. Réessayez dans quelques minutes." } },
  });
const startLimiter = limiter(60, 10);
const readLimiter = limiter(5, 150);
const writeLimiter = limiter(10, 30);
const publicBase = "/public/website-chat/:site/sessions";
chatRoutes.get("/public/website-chat/:site", readLimiter, validate({ params: publicSiteParams }), controller.publicInfo);
chatRoutes.post(publicBase, startLimiter, validate({ params: publicSiteParams, body: publicStartInput }), controller.publicStart);
chatRoutes.get(`${publicBase}/:token/messages`, readLimiter, validate({ params: publicSessionParams }), controller.publicMessages);
chatRoutes.post(`${publicBase}/:token/messages`, writeLimiter, validate({ params: publicSessionParams, body: publicSendInput }), controller.publicSend);
chatRoutes.post(`${publicBase}/:token/human`, writeLimiter, validate({ params: publicSessionParams, body: publicHumanInput }), controller.publicHuman);
