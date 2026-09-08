import multer from "multer";
import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { requireOwner } from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import { storage } from "../../config/storage";
import { BadRequestError } from "../../utils/errors";
import * as controller from "./organization.controller";
import {
  createOrganizationSchema,
  operationalServicesSchema,
  updateOrganizationProfileSchema,
  organizationSlugParams,
} from "./organization.validation";

export const organizationRoutes = Router();
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: Math.min(storage.maxUploadBytes, 2_000_000) },
  fileFilter: (_req, file, callback) =>
    ["image/png", "image/jpeg"].includes(file.mimetype)
      ? callback(null, true)
      : callback(new BadRequestError("Upload the official logo as a PNG or JPEG image")),
});
const oneCompanyLogo: RequestHandler = (req, res, next) =>
  logoUpload.single("file")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      return next(new BadRequestError(
        error.code === "LIMIT_FILE_SIZE"
          ? "The official logo is larger than the 2 MB limit"
          : "Attach one PNG or JPEG company logo",
      ));
    }
    next(error);
  });

// The industry catalogue is public: the onboarding form needs it before the
// user has an account, let alone a workspace.
organizationRoutes.get("/industries", controller.listIndustries);

organizationRoutes.get("/organizations", authenticate, controller.listMine);

organizationRoutes.post(
  "/organizations",
  authenticate,
  validate({ body: createOrganizationSchema }),
  controller.create,
);

organizationRoutes.patch(
  "/organizations/:orgSlug/profile",
  authenticate,
  validate({ params: organizationSlugParams, body: updateOrganizationProfileSchema }),
  requireOrganization,
  requireOwner,
  controller.updateProfile,
);
organizationRoutes.post(
  "/organizations/:orgSlug/profile/logo",
  authenticate,
  validate({ params: organizationSlugParams }),
  requireOrganization,
  requireOwner,
  oneCompanyLogo,
  controller.uploadLogo,
);
organizationRoutes.get(
  "/organizations/:orgSlug/operational-services",
  authenticate,
  validate({ params: organizationSlugParams }),
  requireOrganization,
  controller.getOperationalServices,
);

organizationRoutes.put(
  "/organizations/:orgSlug/operational-services",
  authenticate,
  validate({ params: organizationSlugParams, body: operationalServicesSchema }),
  requireOrganization,
  requireOwner,
  controller.setOperationalServices,
);

/**
 * Slug in the path, matching the frontend's /congo-omega/… routes.
 * `requireOrganization` reads `orgSlug`, so this is the shape every
 * tenant-scoped router should mount under.
 */
organizationRoutes.get(
  "/organizations/:orgSlug",
  authenticate,
  validate({ params: organizationSlugParams }),
  requireOrganization,
  controller.profile,
);