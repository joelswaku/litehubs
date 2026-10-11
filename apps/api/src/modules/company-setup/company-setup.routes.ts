import multer from "multer";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { storage, isAllowedUploadMimeType } from "../../config/storage";
import { BadRequestError } from "../../utils/errors";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import {
  requireOwner,
  requireOwnerOr,
  requirePermission,
} from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import * as controller from "./company-setup.controller";
import * as rulesAck from "./company-rules-ack.service";
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
  websiteDesignInputSchema,
  websiteDesignRestoreSchema,
  websiteSectionsInputSchema,
  websiteSettingsInputSchema,
  websiteMediaParams,
  customerActivityCreateSchema,
  customerActivityParams,
  customerActivityShareSchema,
  customerActivityUpdateSchema,
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
// Acknowledgements: each employee confirms receiving and understanding the
// current rules, in LiteHubs or on paper (scan recorded by HR).
const rulesContext = (req: Request) => ({
  organizationId: req.organization!.id,
  userId: req.user!.id,
  memberId: req.membership!.memberId,
  isOwner: req.membership!.isOwner,
  permissions: req.membership!.permissions,
});
const rulesParam = (req: Request, name: string) => {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
};
const sendFile = (res: Response, file: { buffer: Buffer; mimeType?: string; fileName: string }, download: boolean) =>
  res
    .status(200)
    .type(file.mimeType ?? "application/pdf")
    .setHeader("Cache-Control", "no-store")
    .setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${file.fileName.replace(/[^\w.-]/g, "_")}"`)
    .send(file.buffer);
const scanUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: Math.min(storage.maxUploadBytes, 15_000_000) },
  fileFilter: (_req, file, callback) =>
    ["application/pdf", "image/jpeg", "image/png"].includes(file.mimetype)
      ? callback(null, true)
      : callback(new BadRequestError("Importez le scan en PDF, JPEG ou PNG")),
});
const oneScan: RequestHandler = (req, res, next) =>
  scanUpload.single("file")(req, res, (error: unknown) => next(error instanceof BadRequestError ? error : error ? new BadRequestError("Fichier trop lourd ou invalide") : undefined));
const uuid = z.string().uuid();

companySetupRoutes.get("/organizations/:orgSlug/company-rules/my-acknowledgement", ...inOrganization, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await rulesAck.myRulesAcknowledgement(rulesContext(req)));
});
companySetupRoutes.post(
  "/organizations/:orgSlug/company-rules/my-acknowledgement",
  ...inOrganization,
  validate({ body: z.object({ versionId: uuid, signedName: z.string().trim().min(3).max(160), accepted: z.literal(true) }) }),
  async (req, res) => {
    const body = req.body as { versionId: string; signedName: string; accepted: boolean };
    res.json(await rulesAck.signMyRules(rulesContext(req), body, { ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null }));
  },
);
companySetupRoutes.get("/organizations/:orgSlug/company-rules/acknowledgements", ...inOrganization, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await rulesAck.listAcknowledgements(rulesContext(req)));
});
companySetupRoutes.post(
  "/organizations/:orgSlug/company-rules/acknowledgements/remind",
  ...inOrganization,
  validate({ body: z.object({ employeeIds: z.union([z.literal("pending"), z.array(uuid).min(1).max(500)]) }) }),
  async (req, res) => {
    res.json(await rulesAck.remindEmployees(rulesContext(req), (req.body as { employeeIds: string[] | "pending" }).employeeIds));
  },
);
companySetupRoutes.get("/organizations/:orgSlug/company-rules/acknowledgements/print/:employeeId", ...inOrganization, async (req, res) => {
  const file = await rulesAck.printForEmployee(rulesContext(req), uuid.parse(rulesParam(req, "employeeId")));
  sendFile(res, { ...file, mimeType: "application/pdf" }, req.query.download === "1");
});
companySetupRoutes.post(
  "/organizations/:orgSlug/company-rules/acknowledgements/paper/:employeeId",
  authenticate,
  oneScan,
  validate({ params: organizationParams.extend({ employeeId: uuid }), body: z.object({ signedOn: z.string().date(), note: z.string().trim().max(500).optional() }) }),
  requireOrganization,
  async (req, res) => {
    if (!req.file) throw new BadRequestError("Ajoutez le scan ou la photo de la page signée.");
    res.json(await rulesAck.recordPaperAcknowledgement(rulesContext(req), rulesParam(req, "employeeId"), req.body as { signedOn: string; note?: string }, req.file));
  },
);
companySetupRoutes.get("/organizations/:orgSlug/company-rules/acknowledgements/:acknowledgementId/document", ...inOrganization, async (req, res) => {
  const file = await rulesAck.acknowledgementDocument(rulesContext(req), uuid.parse(rulesParam(req, "acknowledgementId")));
  sendFile(res, file, req.query.download === "1");
});

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
  requireOwnerOr("website.read"),
  controller.getWebsiteBuilder,
);
companySetupRoutes.put(
  "/organizations/:orgSlug/website",
  ...inOrganization,
  requireOwnerOr("website.edit"),
  validate({ body: websiteSettingsInputSchema }),
  controller.saveWebsiteSettings,
);
companySetupRoutes.get(
  "/organizations/:orgSlug/website/media",
  ...inOrganization,
  requireOwnerOr("website.read"),
  controller.listWebsiteMedia,
);
companySetupRoutes.post(
  "/organizations/:orgSlug/website/media",
  ...inOrganization,
  requireOwnerOr("website.edit"),
  websiteMediaFiles,
  controller.uploadWebsiteMedia,
);
companySetupRoutes.delete(
  "/organizations/:orgSlug/website/media/:mediaId",
  authenticate,
  validate({ params: websiteMediaParams }),
  requireOrganization,
  requireOwnerOr("website.edit"),
  controller.deleteWebsiteMedia,
);
// Owner-managed marketing cards for the separate public customer area.  These
// routes never expose applications, employee data or the internal workspace.
companySetupRoutes.get(
  "/organizations/:orgSlug/website/customer-activities",
  ...inOrganization,
  requireOwnerOr("website.read"),
  controller.listCustomerActivities,
);
companySetupRoutes.post(
  "/organizations/:orgSlug/website/customer-activities",
  ...inOrganization,
  requireOwnerOr("website.edit"),
  validate({ body: customerActivityCreateSchema }),
  controller.createCustomerActivity,
);
companySetupRoutes.patch(
  "/organizations/:orgSlug/website/customer-activities/:activityId",
  authenticate,
  validate({ params: customerActivityParams, body: customerActivityUpdateSchema }),
  requireOrganization,
  requireOwnerOr("website.edit"),
  controller.updateCustomerActivity,
);
companySetupRoutes.post(
  "/organizations/:orgSlug/website/customer-activities/:activityId/share",
  authenticate,
  validate({ params: customerActivityParams, body: customerActivityShareSchema }),
  requireOrganization,
  requireOwnerOr("website.edit"),
  controller.shareCustomerActivity,
);
companySetupRoutes.delete(
  "/organizations/:orgSlug/website/customer-activities/:activityId",
  authenticate,
  validate({ params: customerActivityParams }),
  requireOrganization,
  requireOwnerOr("website.edit"),
  controller.archiveCustomerActivity,
);
companySetupRoutes.post(
  "/organizations/:orgSlug/website/pages",
  ...inOrganization,
  requireOwnerOr("website.edit"),
  validate({ body: websitePageCreateSchema }),
  controller.createWebsitePage,
);
companySetupRoutes.put(
  "/organizations/:orgSlug/website/pages/order",
  ...inOrganization,
  requireOwnerOr("website.edit"),
  validate({ body: websitePageOrderSchema }),
  controller.reorderWebsitePages,
);
companySetupRoutes.post(
  "/organizations/:orgSlug/website/starter-pages",
  ...inOrganization,
  requireOwnerOr("website.edit"),
  controller.addWebsiteStarterPages,
);
companySetupRoutes.post(
  "/organizations/:orgSlug/website/complete-starter-pages",
  ...inOrganization,
  requireOwnerOr("website.edit"),
  controller.completeWebsiteStarterPages,
);
companySetupRoutes.post(
  "/organizations/:orgSlug/website/visual-highlights",
  ...inOrganization,
  requireOwnerOr("website.edit"),
  controller.addWebsiteVisualHighlights,
);
companySetupRoutes.patch(
  "/organizations/:orgSlug/website/pages/:pageId",
  authenticate,
  validate({ params: websitePageParams, body: websitePageUpdateSchema }),
  requireOrganization,
  requireOwnerOr("website.edit"),
  controller.updateWebsitePage,
);
companySetupRoutes.put(
  "/organizations/:orgSlug/website/pages/:pageId/sections",
  authenticate,
  validate({ params: websitePageParams, body: websiteSectionsInputSchema }),
  requireOrganization,
  requireOwnerOr("website.edit"),
  controller.replaceWebsiteSections,
);
companySetupRoutes.post(
  "/organizations/:orgSlug/website/pages/:pageId/publish",
  authenticate,
  validate({ params: websitePageParams }),
  requireOrganization,
  requireOwnerOr("website.publish"),
  controller.publishWebsitePage,
);
companySetupRoutes.delete(
  "/organizations/:orgSlug/website/pages/:pageId",
  authenticate,
  validate({ params: websitePageParams }),
  requireOrganization,
  requireOwnerOr("website.publish"),
  controller.archiveWebsitePage,
);
companySetupRoutes.put(
  "/organizations/:orgSlug/website/design",
  ...inOrganization,
  requireOwnerOr("website.edit"),
  validate({ body: websiteDesignInputSchema }),
  controller.saveWebsiteDesign,
);
companySetupRoutes.post(
  "/organizations/:orgSlug/website/design/publish",
  ...inOrganization,
  requireOwnerOr("website.publish"),
  controller.publishWebsiteDesign,
);
companySetupRoutes.post(
  "/organizations/:orgSlug/website/design/restore",
  ...inOrganization,
  requireOwnerOr("website.edit"),
  validate({ body: websiteDesignRestoreSchema }),
  controller.restoreWebsiteDesign,
);
companySetupRoutes.post(
  "/organizations/:orgSlug/website/publication",
  ...inOrganization,
  requireOwnerOr("website.publish"),
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
