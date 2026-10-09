import { Router, type RequestHandler } from "express";
import multer from "multer";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { requirePermission } from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import { BadRequestError } from "../../utils/errors";
import * as controller from "./mail.controller";
import {
  aiDraftInput,
  attachmentParams,
  folderQuery,
  mailboxInput,
  mailboxParams,
  messageFlagsInput,
  messageListQuery,
  messageMoveInput,
  messageParams,
  organizationParams,
  sendInput,
} from "./mail.validation";

export const mailRoutes = Router();
const base = "/organizations/:orgSlug/mail";
const read = requirePermission("mail.read");

// Hostinger accepts messages up to about 35 MB; keep attachments well below.
const uploadAttachments = multer({
  storage: multer.memoryStorage(),
  limits: { files: 10, fileSize: 15 * 1024 * 1024 },
});
const attachments: RequestHandler = (req, res, next) =>
  uploadAttachments.array("attachments", 10)(req, res, (error: unknown) =>
    error ? next(new BadRequestError("Attachments: 10 files maximum, 15 MB each")) : next(),
  );

mailRoutes.get(`${base}/mailboxes`, authenticate, validate({ params: organizationParams }), requireOrganization, read, controller.mailboxes);
mailRoutes.post(`${base}/mailboxes`, authenticate, validate({ params: organizationParams, body: mailboxInput }), requireOrganization, requirePermission("mail.manage"), controller.createMailbox);
mailRoutes.put(`${base}/mailboxes/:mailboxId`, authenticate, validate({ params: mailboxParams, body: mailboxInput }), requireOrganization, requirePermission("mail.manage"), controller.updateMailbox);
mailRoutes.delete(`${base}/mailboxes/:mailboxId`, authenticate, validate({ params: mailboxParams }), requireOrganization, requirePermission("mail.manage"), controller.deleteMailbox);
mailRoutes.get(`${base}/mailboxes/:mailboxId/folders`, authenticate, validate({ params: mailboxParams }), requireOrganization, read, controller.folders);
mailRoutes.get(`${base}/mailboxes/:mailboxId/messages`, authenticate, validate({ params: mailboxParams, query: messageListQuery }), requireOrganization, read, controller.messages);
mailRoutes.get(`${base}/mailboxes/:mailboxId/messages/:uid`, authenticate, validate({ params: messageParams, query: folderQuery }), requireOrganization, read, controller.message);
mailRoutes.get(`${base}/mailboxes/:mailboxId/messages/:uid/attachments/:index`, authenticate, validate({ params: attachmentParams }), requireOrganization, read, controller.attachment);
mailRoutes.patch(`${base}/mailboxes/:mailboxId/messages/:uid`, authenticate, validate({ params: messageParams, body: messageFlagsInput }), requireOrganization, read, controller.flags);
mailRoutes.post(`${base}/mailboxes/:mailboxId/messages/:uid/move`, authenticate, validate({ params: messageParams, body: messageMoveInput }), requireOrganization, read, controller.move);
mailRoutes.post(`${base}/mailboxes/:mailboxId/send`, authenticate, attachments, validate({ params: mailboxParams, body: sendInput }), requireOrganization, requirePermission("mail.send"), controller.send);
mailRoutes.post(`${base}/mailboxes/:mailboxId/ai-draft`, authenticate, validate({ params: mailboxParams, body: aiDraftInput }), requireOrganization, requirePermission("mail.send"), controller.aiDraft);
