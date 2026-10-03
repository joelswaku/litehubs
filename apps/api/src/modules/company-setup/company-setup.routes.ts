import multer from "multer";
import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { storage, isAllowedUploadMimeType } from "../../config/storage";
import { BadRequestError } from "../../utils/errors";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import {
  requireOwner,
  requirePermission,
} from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./company-setup.controller";
import {
  createDepartmentSchema,
  createInvitationSchema,
  companyRulesInputSchema,
  createProvinceSchema,
  createRoleSchema,
  createSiteSchema,
  departmentParams,
  invitationParams,
  memberParams,
  organizationParams,
  provinceParams,
  replaceMemberProvincesSchema,
  replaceMemberRolesSchema,
  roleParams,
  siteParams,
  updateDepartmentSchema,
  updateProvinceSchema,
  updateRoleSchema,
  updateSiteSchema,
  publicWebsitePageParams,
  publicWebsiteDomainParams,
  publicWebsiteContactInputSchema,
  websitePageCreateSchema,
  websitePageOrderSchema,
  websitePageParams,
  websitePageUpdateSchema,
  websitePublicationInputSchema,
  websiteSectionsInputSchema,
  websiteSettingsInputSchema,
  websiteMediaParams,
} from "./company-setup.validation";

export const companySetupRoutes = Router();

// A published company site must be reachable without a LiteHubs account, but
// its contact form must not become a mail relay or a spam source.
const publicWebsiteContactLimiter = rateLimit({
  windowMs: 60 * 60 * 1_000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: {
      code: "TOO_MANY_WEBSITE_MESSAGES",
      message: "Too many messages were sent. Please try again later.",
    },
  },
});

// Website media is separate from private LiteHubs documents. Owners may upload
// a gallery in one go; only real image formats are accepted.
const websiteMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 30, fileSize: Math.min(storage.maxUploadBytes, 8_000_000) },
  fileFilter: (_req, file, callback) =>
    isAllowedUploadMimeType(file.mimetype)
      ? callback(null, true)
      : callback(
          new BadRequestError(
            "Upload JPEG, PNG, WebP, GIF, HEIC, or HEIF images only",
          ),
        ),
});
const websiteMediaFiles: RequestHandler = (req, res, next) =>
  websiteMediaUpload.array("files", 30)(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      return next(
        new BadRequestError(
          error.code === "LIMIT_FILE_SIZE"
            ? "Each website image must be 8 MB or smaller"
            : "Upload up to 30 website images at once",
        ),
      );
    }
    next(error);
  });

const inOrganization = [
  authenticate,
  validate({ params: organizationParams }),
  requireOrganization,
] as const;

// Public website rendering is purposefully outside the workspace session.
// It returns only owner-published content through the narrow database function
// introduced with the builder; it has no operational-data joins.
companySetupRoutes.get(
  "/public/organizations/:orgSlug/website",
  validate({ params: organizationParams }),
  controller.publicWebsite,
);
companySetupRoutes.get(
  "/public/organizations/:orgSlug/website/pages/:pageSlug",
  validate({ params: publicWebsitePageParams }),
  controller.publicWebsite,
);
companySetupRoutes.get(
  "/public/websites/domains/:domain",
  validate({ params: publicWebsiteDomainParams }),
  controller.publicWebsiteDomain,
);
companySetupRoutes.get(
  "/public/websites/domains/:domain/pages/:pageSlug",
  validate({ params: publicWebsiteDomainParams }),
  controller.publicWebsiteDomain,
);
companySetupRoutes.post(
  "/public/websites/domains/:domain/contact",
  publicWebsiteContactLimiter,
  validate({
    params: publicWebsiteDomainParams,
    body: publicWebsiteContactInputSchema,
  }),
  controller.sendPublicWebsiteContact,
);

// Every company member can read the rulebook. Only its owner publishes a new
// version; the service stores prior versions for audit and accountability.
companySetupRoutes.get(
  "/organizations/:orgSlug/company-rules",
  ...inOrganization,
  controller.getCompanyRules,
);
companySetupRoutes.get(
  "/organizations/:orgSlug/company-rules/export.pdf",
  ...inOrganization,
  controller.downloadCompanyRulesPdf,
);
companySetupRoutes.get(
  "/organizations/:orgSlug/company-rules/versions",
  ...inOrganization,
  controller.listCompanyRulesVersions,
);
companySetupRoutes.put(
  "/organizations/:orgSlug/company-rules",
  ...inOrganization,
  requireOwner,
  validate({ body: companyRulesInputSchema }),
  controller.publishCompanyRules,
);

// The website builder has one owner-only entry point in the workspace. Pages,
// blocks, design settings, preview and publication stay behind this single
// module instead of being scattered through the operational sidebar.
companySetupRoutes.get(
  "/organizations/:orgSlug/website",
  ...inOrganization,
  requireOwner,
  controller.getWebsiteBuilder,
);
companySetupRoutes.put(
  "/organizations/:orgSlug/website",
  ...inOrganization,
  requireOwner,
  validate({ body: websiteSettingsInputSchema }),
  controller.saveWebsiteSettings,
);
companySetupRoutes.get(
  "/organizations/:orgSlug/website/media",
  ...inOrganization,
  requireOwner,
  controller.listWebsiteMedia,
);
companySetupRoutes.post(
  "/organizations/:orgSlug/website/media",
  ...inOrganization,
  requireOwner,
  websiteMediaFiles,
  controller.uploadWebsiteMedia,
);
companySetupRoutes.delete(
  "/organizations/:orgSlug/website/media/:mediaId",
  authenticate,
  validate({ params: websiteMediaParams }),
  requireOrganization,
  requireOwner,
  controller.deleteWebsiteMedia,
);
companySetupRoutes.post(
  "/organizations/:orgSlug/website/pages",
  ...inOrganization,
  requireOwner,
  validate({ body: websitePageCreateSchema }),
  controller.createWebsitePage,
);
companySetupRoutes.put(
  "/organizations/:orgSlug/website/pages/order",
  ...inOrganization,
  requireOwner,
  validate({ body: websitePageOrderSchema }),
  controller.reorderWebsitePages,
);
companySetupRoutes.post(
  "/organizations/:orgSlug/website/starter-pages",
  ...inOrganization,
  requireOwner,
  controller.addWebsiteStarterPages,
);
companySetupRoutes.post(
  "/organizations/:orgSlug/website/complete-starter-pages",
  ...inOrganization,
  requireOwner,
  controller.completeWebsiteStarterPages,
);
companySetupRoutes.post(
  "/organizations/:orgSlug/website/visual-highlights",
  ...inOrganization,
  requireOwner,
  controller.addWebsiteVisualHighlights,
);
companySetupRoutes.patch(
  "/organizations/:orgSlug/website/pages/:pageId",
  authenticate,
  validate({ params: websitePageParams, body: websitePageUpdateSchema }),
  requireOrganization,
  requireOwner,
  controller.updateWebsitePage,
);
companySetupRoutes.put(
  "/organizations/:orgSlug/website/pages/:pageId/sections",
  authenticate,
  validate({ params: websitePageParams, body: websiteSectionsInputSchema }),
  requireOrganization,
  requireOwner,
  controller.replaceWebsiteSections,
);
companySetupRoutes.post(
  "/organizations/:orgSlug/website/pages/:pageId/publish",
  authenticate,
  validate({ params: websitePageParams }),
  requireOrganization,
  requireOwner,
  controller.publishWebsitePage,
);
companySetupRoutes.delete(
  "/organizations/:orgSlug/website/pages/:pageId",
  authenticate,
  validate({ params: websitePageParams }),
  requireOrganization,
  requireOwner,
  controller.archiveWebsitePage,
);
companySetupRoutes.post(
  "/organizations/:orgSlug/website/publication",
  ...inOrganization,
  requireOwner,
  validate({ body: websitePublicationInputSchema }),
  controller.setWebsitePublication,
);

// ------------------------------------------------------------- locations ----

companySetupRoutes.get(
  "/organizations/:orgSlug/provinces",
  ...inOrganization,
  requirePermission("sites.read"),
  controller.listProvinces,
);

companySetupRoutes.post(
  "/organizations/:orgSlug/provinces",
  ...inOrganization,
  requireOwner,
  requirePermission("sites.create"),
  validate({ body: createProvinceSchema }),
  controller.createProvince,
);

companySetupRoutes.patch(
  "/organizations/:orgSlug/provinces/:provinceId",
  authenticate,
  validate({ params: provinceParams }),
  requireOrganization,
  requireOwner,
  requirePermission("sites.update"),
  validate({ body: updateProvinceSchema }),
  controller.updateProvince,
);

companySetupRoutes.delete(
  "/organizations/:orgSlug/provinces/:provinceId",
  authenticate,
  validate({ params: provinceParams }),
  requireOrganization,
  requireOwner,
  requirePermission("sites.delete"),
  controller.deleteProvince,
);

companySetupRoutes.get(
  "/organizations/:orgSlug/sites",
  ...inOrganization,
  requirePermission("sites.read"),
  controller.listSites,
);

companySetupRoutes.post(
  "/organizations/:orgSlug/sites",
  ...inOrganization,
  requireOwner,
  requirePermission("sites.create"),
  validate({ body: createSiteSchema }),
  controller.createSite,
);

companySetupRoutes.patch(
  "/organizations/:orgSlug/sites/:siteId",
  authenticate,
  validate({ params: siteParams }),
  requireOrganization,
  requireOwner,
  requirePermission("sites.update"),
  validate({ body: updateSiteSchema }),
  controller.updateSite,
);

companySetupRoutes.delete(
  "/organizations/:orgSlug/sites/:siteId",
  authenticate,
  validate({ params: siteParams }),
  requireOrganization,
  requireOwner,
  requirePermission("sites.delete"),
  controller.deleteSite,
);

companySetupRoutes.get(
  "/organizations/:orgSlug/departments",
  ...inOrganization,
  requirePermission("departments.read"),
  controller.listDepartments,
);

companySetupRoutes.post(
  "/organizations/:orgSlug/departments",
  ...inOrganization,
  requirePermission("departments.create"),
  validate({ body: createDepartmentSchema }),
  controller.createDepartment,
);

companySetupRoutes.patch(
  "/organizations/:orgSlug/departments/:departmentId",
  authenticate,
  validate({ params: departmentParams }),
  requireOrganization,
  requirePermission("departments.update"),
  validate({ body: updateDepartmentSchema }),
  controller.updateDepartment,
);

companySetupRoutes.delete(
  "/organizations/:orgSlug/departments/:departmentId",
  authenticate,
  validate({ params: departmentParams }),
  requireOrganization,
  requirePermission("departments.delete"),
  controller.deleteDepartment,
);

// ----------------------------------------------------------------- roles ----

companySetupRoutes.get(
  "/organizations/:orgSlug/roles",
  ...inOrganization,
  requirePermission("roles.read"),
  controller.listRoles,
);

companySetupRoutes.get(
  "/organizations/:orgSlug/permissions",
  ...inOrganization,
  requirePermission("roles.read"),
  controller.listPermissions,
);

companySetupRoutes.post(
  "/organizations/:orgSlug/roles",
  ...inOrganization,
  requireOwner,
  requirePermission("roles.create"),
  validate({ body: createRoleSchema }),
  controller.createRole,
);

companySetupRoutes.patch(
  "/organizations/:orgSlug/roles/:roleId",
  authenticate,
  validate({ params: roleParams }),
  requireOrganization,
  requireOwner,
  requirePermission("roles.update"),
  validate({ body: updateRoleSchema }),
  controller.updateRole,
);

companySetupRoutes.delete(
  "/organizations/:orgSlug/roles/:roleId",
  authenticate,
  validate({ params: roleParams }),
  requireOrganization,
  requireOwner,
  requirePermission("roles.delete"),
  controller.deleteRole,
);

// ---------------------------------------------------------- team members ----

companySetupRoutes.get(
  "/organizations/:orgSlug/members",
  ...inOrganization,
  requirePermission("members.read"),
  controller.listMembers,
);

companySetupRoutes.put(
  "/organizations/:orgSlug/members/:memberId/roles",
  authenticate,
  validate({ params: memberParams }),
  requireOrganization,
  requireOwner,
  requirePermission("members.update"),
  validate({ body: replaceMemberRolesSchema }),
  controller.replaceMemberRoles,
);

companySetupRoutes.put(
  "/organizations/:orgSlug/members/:memberId/provinces",
  authenticate,
  validate({ params: memberParams }),
  requireOrganization,
  requireOwner,
  requirePermission("members.update"),
  validate({ body: replaceMemberProvincesSchema }),
  controller.replaceMemberProvinces,
);

// ------------------------------------------------------------- invitations ----

companySetupRoutes.get(
  "/organizations/:orgSlug/invitations",
  ...inOrganization,
  requirePermission("invitations.read"),
  controller.listInvitations,
);

companySetupRoutes.post(
  "/organizations/:orgSlug/invitations",
  ...inOrganization,
  requireOwner,
  requirePermission("invitations.create"),
  validate({ body: createInvitationSchema }),
  controller.createInvitation,
);

companySetupRoutes.delete(
  "/organizations/:orgSlug/invitations/:invitationId",
  authenticate,
  validate({ params: invitationParams }),
  requireOrganization,
  requireOwner,
  requirePermission("invitations.update"),
  controller.revokeInvitation,
);
