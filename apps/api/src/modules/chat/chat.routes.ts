import { Router, type RequestHandler } from "express";
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
