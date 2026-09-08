import multer from "multer";
import { Router, type RequestHandler } from "express";
import { storage, isAllowedDocumentMimeType } from "../../config/storage";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { requirePermission } from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import { BadRequestError } from "../../utils/errors";
import * as controller from "./documents.controller";
import {
  documentParams,
  documentQuery,
  organizationParams,
  updateDocumentSchema,
  uploadDocumentSchema,
} from "./documents.validation";

export const documentsRoutes = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: storage.maxUploadBytes },
  fileFilter: (_req, file, callback) =>
    isAllowedDocumentMimeType(file.mimetype)
      ? callback(null, true)
      : callback(
          new BadRequestError(
            "Upload a PDF, Office file, text file, supported image, video, or audio file",
          ),
        ),
});
const oneDocument: RequestHandler = (req, res, next) =>
  upload.single("file")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError)
      return next(
        new BadRequestError(
          error.code === "LIMIT_FILE_SIZE"
            ? "The uploaded document is larger than the allowed limit"
            : "Attach exactly one document",
        ),
      );
    next(error);
  });
const inside = [
  authenticate,
  validate({ params: organizationParams }),
  requireOrganization,
] as const;
documentsRoutes.get(
  "/organizations/:orgSlug/documents",
  ...inside,
  requirePermission("documents.read"),
  validate({ query: documentQuery }),
  controller.list,
);
documentsRoutes.get(
  "/organizations/:orgSlug/documents-summary",
  ...inside,
  requirePermission("documents.read"),
  controller.summary,
);
documentsRoutes.post(
  "/organizations/:orgSlug/documents",
  ...inside,
  requirePermission("documents.create"),
  oneDocument,
  validate({ body: uploadDocumentSchema }),
  controller.upload,
);
documentsRoutes.patch(
  "/organizations/:orgSlug/documents/:documentId",
  authenticate,
  validate({ params: documentParams }),
  requireOrganization,
  requirePermission("documents.update"),
  validate({ body: updateDocumentSchema }),
  controller.update,
);
documentsRoutes.delete(
  "/organizations/:orgSlug/documents/:documentId",
  authenticate,
  validate({ params: documentParams }),
  requireOrganization,
  requirePermission("documents.delete"),
  controller.remove,
);
documentsRoutes.get(
  "/organizations/:orgSlug/documents/:documentId/preview",
  authenticate,
  validate({ params: documentParams }),
  requireOrganization,
  requirePermission("documents.read"),
  controller.preview,
);
documentsRoutes.get(
  "/organizations/:orgSlug/documents/:documentId/download",
  authenticate,
  validate({ params: documentParams }),
  requireOrganization,
  requirePermission("documents.read"),
  controller.download,
);
