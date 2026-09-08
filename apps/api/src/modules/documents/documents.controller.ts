import type { Request, RequestHandler } from "express";
import { BadRequestError } from "../../utils/errors";
import * as service from "./documents.service";
import type {
  DocumentQuery,
  DocumentUpdateInput,
  DocumentUploadInput,
} from "./documents.validation";

function context(req: Request): service.DocumentsContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
  };
}
function param(req: Request, key: string) {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
export const list: RequestHandler = async (req, res) =>
  res.json({
    documents: await service.listDocuments(
      context(req),
      req.query as DocumentQuery,
    ),
  });
export const upload: RequestHandler = async (req, res) => {
  if (!req.file)
    throw new BadRequestError(
      "Attach one document in the 'file' form-data field",
    );
  res
    .status(201)
    .json({
      document: await service.uploadDocument(
        context(req),
        req.body as DocumentUploadInput,
        req.file,
      ),
    });
};
export const update: RequestHandler = async (req, res) =>
  res.json({
    document: await service.updateDocument(
      context(req),
      param(req, "documentId"),
      req.body as DocumentUpdateInput,
    ),
  });
export const remove: RequestHandler = async (req, res) => {
  await service.removeDocument(context(req), param(req, "documentId"));
  res.status(204).send();
};
export const preview: RequestHandler = async (req, res) => {
  const file = await service.fileFor(context(req), param(req, "documentId"));
  res.type(String(file.document.mimeType));
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${String(file.document.fileName).replace(/[\r\n"]/g, "")}"`,
  );
  res.send(file.buffer);
};
export const download: RequestHandler = async (req, res) => {
  const file = await service.fileFor(context(req), param(req, "documentId"));
  res.type(String(file.document.mimeType));
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${String(file.document.fileName).replace(/[\r\n"]/g, "")}"`,
  );
  res.send(file.buffer);
};
export const summary: RequestHandler = async (req, res) =>
  res.json(await service.summary(context(req)));
