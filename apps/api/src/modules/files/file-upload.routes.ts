import { Router, type RequestHandler } from "express";
import multer from "multer";
import {
  isAllowedDocumentMimeType,
  isAllowedUploadMimeType,
  storage,
} from "../../config/storage";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { validate } from "../../middleware/validation.middleware";
import { BadRequestError } from "../../utils/errors";
import * as controller from "./file-upload.controller";
import {
  attachmentImageParams,
  attachmentStoredFileParams,
  attachmentTargetParams,
  attachmentUploadBody,
  expenseEvidenceParams,
  receiptEvidenceParams,
  taskEvidenceParams,
} from "./file-upload.validation";

export const fileUploadRoutes = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: storage.maxUploadBytes },
  fileFilter: (_req, file, callback) => {
    if (!isAllowedUploadMimeType(file.mimetype))
      return callback(
        new BadRequestError(
          "Unsupported image type. Upload JPEG, PNG, WebP, GIF, HEIC, or HEIF.",
        ),
      );
    callback(null, true);
  },
});
const oneImage: RequestHandler = (req, res, next) =>
  upload.single("file")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError)
      return next(
        new BadRequestError(
          error.code === "LIMIT_FILE_SIZE"
            ? "The uploaded image is larger than the allowed limit"
            : "Attach exactly one valid image",
          { maxUploadBytes: storage.maxUploadBytes },
        ),
      );
    next(error);
  });
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: storage.maxUploadBytes },
  fileFilter: (_req, file, callback) => {
    if (!isAllowedDocumentMimeType(file.mimetype))
      return callback(
        new BadRequestError(
          "Unsupported evidence type. Upload a PDF or a supported image.",
        ),
      );
    callback(null, true);
  },
});
const oneEvidenceDocument: RequestHandler = (req, res, next) =>
  evidenceUpload.single("file")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError)
      return next(
        new BadRequestError(
          error.code === "LIMIT_FILE_SIZE"
            ? "The uploaded evidence file is larger than the allowed limit"
            : "Attach exactly one evidence file",
          { maxUploadBytes: storage.maxUploadBytes },
        ),
      );
    next(error);
  });
const inOrganization = [
  authenticate,
  validate({ params: attachmentTargetParams }),
  requireOrganization,
] as const;
const taskEvidenceInOrganization = [
  authenticate,
  validate({ params: taskEvidenceParams }),
  requireOrganization,
] as const;
fileUploadRoutes.get(
  "/organizations/:orgSlug/files/:fileId/preview",
  authenticate,
  validate({ params: attachmentStoredFileParams }),
  requireOrganization,
  controller.previewAttachment,
);
fileUploadRoutes.get(
  "/organizations/:orgSlug/files/:fileId/download",
  authenticate,
  validate({ params: attachmentStoredFileParams }),
  requireOrganization,
  controller.downloadAttachment,
);
fileUploadRoutes.get(
  "/organizations/:orgSlug/images/:module/:resource/:recordId",
  ...inOrganization,
  controller.listAttachments,
);
fileUploadRoutes.post(
  "/organizations/:orgSlug/images/:module/:resource/:recordId",
  ...inOrganization,
  oneImage,
  validate({ body: attachmentUploadBody }),
  controller.uploadAttachment,
);
fileUploadRoutes.post(
  "/organizations/:orgSlug/task-evidence/:taskId",
  ...taskEvidenceInOrganization,
  oneEvidenceDocument,
  validate({ body: attachmentUploadBody }),
  controller.uploadTaskEvidence,
);
fileUploadRoutes.post(
  "/organizations/:orgSlug/receipt-evidence/:receiptId",
  authenticate,
  validate({ params: receiptEvidenceParams }),
  requireOrganization,
  oneEvidenceDocument,
  validate({ body: attachmentUploadBody }),
  controller.uploadReceiptEvidence,
);
fileUploadRoutes.post(
  "/organizations/:orgSlug/expense-evidence/:expenseId",
  authenticate,
  validate({ params: expenseEvidenceParams }),
  requireOrganization,
  oneEvidenceDocument,
  validate({ body: attachmentUploadBody }),
  controller.uploadExpenseEvidence,
);fileUploadRoutes.delete(
  "/organizations/:orgSlug/images/:imageId",
  authenticate,
  validate({ params: attachmentImageParams }),
  requireOrganization,
  controller.deleteAttachment,
);
