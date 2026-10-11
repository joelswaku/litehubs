import type { Request, RequestHandler } from "express";
import { BadRequestError } from "../../utils/errors";
import * as service from "./file-upload.service";
import type {
  AttachmentTarget,
  AttachmentUploadInput,
} from "./file-upload.validation";

function contextOf(req: Request): service.FileContext {
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
function targetOf(req: Request): AttachmentTarget {
  return {
    orgSlug: parameter(req, "orgSlug"),
    module: parameter(req, "module") as AttachmentTarget["module"],
    resource: parameter(req, "resource"),
    recordId: parameter(req, "recordId"),
  };
}
export const listAttachments: RequestHandler = async (req, res) => {
  res.json({
    images: await service.listAttachments(contextOf(req), targetOf(req)),
  });
};
export const uploadAttachment: RequestHandler = async (req, res) => {
  if (!req.file)
    throw new BadRequestError("Attach one image in the 'file' form-data field");
  res.status(201).json({
    image: await service.uploadAttachment(
      contextOf(req),
      targetOf(req),
      req.body as AttachmentUploadInput,
      req.file,
    ),
  });
};
export const uploadTaskEvidence: RequestHandler = async (req, res) => {
  if (!req.file)
    throw new BadRequestError(
      "Attach one evidence file in the 'file' form-data field",
    );
  res.status(201).json({
    document: await service.uploadTaskEvidence(
      contextOf(req),
      parameter(req, "taskId"),
      req.body as AttachmentUploadInput,
      req.file,
    ),
  });
};
export const uploadReceiptEvidence: RequestHandler = async (req, res) => {
  if (!req.file)
    throw new BadRequestError(
      "Attach one delivery or receipt document in the 'file' form-data field",
    );
  res.status(201).json({
    document: await service.uploadReceiptEvidence(
      contextOf(req),
      parameter(req, "receiptId"),
      req.body as AttachmentUploadInput,
      req.file,
    ),
  });
};
export const uploadExpenseEvidence: RequestHandler = async (req, res) => {
  if (!req.file)
    throw new BadRequestError(
      "Attach one invoice, receipt or payment document in the 'file' form-data field",
    );
  res.status(201).json({
    document: await service.uploadExpenseEvidence(
      contextOf(req),
      parameter(req, "expenseId"),
      req.body as AttachmentUploadInput,
      req.file,
    ),
  });
};

function sendAttachment(
  res: Parameters<RequestHandler>[1],
  file: Record<string, unknown>,
  disposition: "inline" | "attachment",
) {
  const buffer = file.buffer;
  const fileName = String(file.title ?? "document").replace(/[\r\n"]/g, "");
  if (Buffer.isBuffer(buffer)) {
    res.type(String(file.mimeType ?? "application/octet-stream"));
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename="${fileName}"`,
    );
    res.send(buffer);
    return;
  }
  const url = typeof file.storageUrl === "string" ? file.storageUrl : null;
  if (!url) throw new BadRequestError("This document has no preview URL");
  res.redirect(302, url);
}

export const previewAttachment: RequestHandler = async (req, res) => {
  const file = await service.getStoredAttachment(
    contextOf(req),
    parameter(req, "fileId"),
    "preview",
  );
  sendAttachment(res, file, "inline");
};

export const downloadAttachment: RequestHandler = async (req, res) => {
  const file = await service.getStoredAttachment(
    contextOf(req),
    parameter(req, "fileId"),
    "download",
  );
  sendAttachment(res, file, "attachment");
};
export const deleteAttachment: RequestHandler = async (req, res) => {
  await service.deleteAttachment(contextOf(req), parameter(req, "imageId"));
  res.status(204).send();
};

function queryText(req: Request, name: string): string | undefined {
  const value = (req.query as Record<string, unknown>)[name];
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === "string" && text.trim() ? text.trim().slice(0, 120) : undefined;
}
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const listDocumentTrash: RequestHandler = async (req, res) => {
  const projectId = parameter(req, "projectId");
  if (!UUID.test(projectId)) throw new BadRequestError("Projet invalide");
  const from = queryText(req, "from");
  const to = queryText(req, "to");
  const categoryId = queryText(req, "categoryId");
  res.setHeader("Cache-Control", "no-store");
  res.json({
    items: await service.listDocumentTrash(contextOf(req), projectId, {
      from: from && DAY.test(from) ? from : undefined,
      to: to && DAY.test(to) ? to : undefined,
      q: queryText(req, "q"),
      categoryId: categoryId && UUID.test(categoryId) ? categoryId : undefined,
    }),
  });
};
export const restoreDocumentTrash: RequestHandler = async (req, res) => {
  const trashId = parameter(req, "trashId");
  if (!UUID.test(trashId)) throw new BadRequestError("Élément invalide");
  res.json(await service.restoreDocumentTrash(contextOf(req), trashId));
};
export const purgeDocumentTrash: RequestHandler = async (req, res) => {
  const trashId = parameter(req, "trashId");
  if (!UUID.test(trashId)) throw new BadRequestError("Élément invalide");
  res.json(await service.purgeDocumentTrash(contextOf(req), trashId));
};
