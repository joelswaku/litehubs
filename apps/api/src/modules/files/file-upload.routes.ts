import { Router, type RequestHandler } from "express";
import multer from "multer";
import { isAllowedUploadMimeType, storage } from "../../config/storage";
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
const inOrganization = [
  authenticate,
  validate({ params: attachmentTargetParams }),
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
fileUploadRoutes.delete(
  "/organizations/:orgSlug/images/:imageId",
  authenticate,
  validate({ params: attachmentImageParams }),
  requireOrganization,
  controller.deleteAttachment,
);
