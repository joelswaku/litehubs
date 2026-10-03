import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import { requirePermission } from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import { BadRequestError } from "../../utils/errors";
import { storage } from "../../config/storage";
import * as controller from "./careers.controller";
import { applicationParams, applicationQuery, applicationUpdateInput, careerSiteSettingsInput, jobParams, jobPostInput, jobQuery, organizationParams, publicJobParams, publicApplicationInput, publicOnboardingInput, publicOnboardingParams } from "./careers.validation";

export const careersRoutes = Router();
const inside = [authenticate, validate({ params: organizationParams }), requireOrganization] as const;
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "CAREER_APPLICATION_RATE_LIMITED", message: "Too many applications. Please try again later." } },
});
const allowedResumeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const uploadResume = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: storage.maxUploadBytes },
  fileFilter: (_req, file, done) => done(null, allowedResumeTypes.has(file.mimetype)),
});
const resumeUpload: RequestHandler = (req, res, next) => {
  uploadResume.single("resume")(req, res, (error: unknown) => {
    if (error) return next(new BadRequestError("Upload a PDF, DOC, or DOCX résumé within the allowed size"));
    if (!req.file) return next(new BadRequestError("Attach your résumé as a PDF, DOC, or DOCX file", { field: "resume" }));
    return next();
  });
};
const portraitMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const identityMimeTypes = new Set(["application/pdf", ...portraitMimeTypes]);
const uploadOnboarding = multer({
  storage: multer.memoryStorage(),
  limits: { files: 2, fileSize: storage.maxUploadBytes },
  fileFilter: (_req, file, done) => {
    const allowed =
      (file.fieldname === "portrait" && portraitMimeTypes.has(file.mimetype)) ||
      (file.fieldname === "identityDocument" && identityMimeTypes.has(file.mimetype));
    done(null, allowed);
  },
});
const onboardingUpload: RequestHandler = (req, res, next) => {
  uploadOnboarding.fields([
    { name: "portrait", maxCount: 1 },
    { name: "identityDocument", maxCount: 1 },
  ])(req, res, (error: unknown) => {
    if (error) return next(new BadRequestError("Upload one portrait (JPEG, PNG or WebP) and one identity document (PDF, JPEG, PNG or WebP) within the allowed size"));
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    if (!files?.portrait?.[0] || !files.identityDocument?.[0])
      return next(new BadRequestError("Add both the portrait and identity document", { field: !files?.portrait?.[0] ? "portrait" : "identityDocument" }));
    return next();
  });
};

careersRoutes.get("/public/organizations/:orgSlug/careers/jobs", validate({ params: organizationParams }), controller.publicJobs);
careersRoutes.get("/public/organizations/:orgSlug/careers/jobs/:jobCode", validate({ params: publicJobParams }), controller.publicJob);
careersRoutes.post("/public/organizations/:orgSlug/careers/jobs/:jobCode/applications", publicLimiter, resumeUpload, validate({ params: publicJobParams, body: publicApplicationInput }), controller.publicApply);
careersRoutes.get("/public/organizations/:orgSlug/careers/onboarding/:token", publicLimiter, validate({ params: publicOnboardingParams }), controller.publicOnboarding);
careersRoutes.post("/public/organizations/:orgSlug/careers/onboarding/:token", publicLimiter, onboardingUpload, validate({ params: publicOnboardingParams, body: publicOnboardingInput }), controller.completePublicOnboarding);

careersRoutes.get("/organizations/:orgSlug/careers/summary", ...inside, requirePermission("careers.read"), controller.summary);
careersRoutes.get("/organizations/:orgSlug/careers/settings", ...inside, requirePermission("careers.read"), controller.settings);
careersRoutes.put("/organizations/:orgSlug/careers/settings", ...inside, requirePermission("careers.create"), validate({ body: careerSiteSettingsInput }), controller.saveSettings);
careersRoutes.get("/organizations/:orgSlug/careers/jobs", ...inside, requirePermission("careers.read"), validate({ query: jobQuery }), controller.jobs);
careersRoutes.post("/organizations/:orgSlug/careers/jobs", ...inside, requirePermission("careers.create"), validate({ body: jobPostInput }), controller.createJob);
careersRoutes.patch("/organizations/:orgSlug/careers/jobs/:jobId", authenticate, validate({ params: jobParams, body: jobPostInput }), requireOrganization, requirePermission("careers.update"), controller.updateJob);
careersRoutes.get("/organizations/:orgSlug/careers/applications", ...inside, requirePermission("careers.read"), validate({ query: applicationQuery }), controller.applications);
careersRoutes.patch("/organizations/:orgSlug/careers/applications/:applicationId", authenticate, validate({ params: applicationParams, body: applicationUpdateInput }), requireOrganization, requirePermission("careers.update"), controller.updateApplication);
careersRoutes.get("/organizations/:orgSlug/careers/applications/:applicationId/resume", authenticate, validate({ params: applicationParams }), requireOrganization, requirePermission("careers.read"), controller.downloadResume);
