import type { Request, RequestHandler } from "express";
import { BadRequestError } from "../../utils/errors";
import * as service from "./careers.service";
import * as portal from "./candidate-portal.service";
import type {
  ApplicationQuery,
  ApplicationUpdateInput,
  CareerSiteSettingsInput,
  JobPostInput,
  JobQuery,
  PublicApplicationInput,
  PublicOnboardingInput,
  DocumentRequestInput,
  DocumentReviewInput,
} from "./careers.validation";

function context(req: Request): service.CareersContext {
  return {
    organizationId: req.organization!.id,
    organizationSlug: req.organization!.slug,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
    permissions: req.membership!.permissions,
  };
}

function param(req: Request, key: string): string {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export const summary: RequestHandler = async (req, res) =>
  res.json({ summary: await service.summary(context(req)) });
export const settings: RequestHandler = async (req, res) =>
  res.json({ settings: await service.listSiteSettings(context(req)) });
export const saveSettings: RequestHandler = async (req, res) =>
  res.json({
    setting: await service.saveSiteSettings(
      context(req),
      req.body as CareerSiteSettingsInput,
    ),
  });
export const jobs: RequestHandler = async (req, res) =>
  res.json({
    jobs: await service.listJobs(
      context(req),
      req.query as unknown as JobQuery,
    ),
  });
export const createJob: RequestHandler = async (req, res) =>
  res.status(201).json({
    job: await service.saveJob(context(req), req.body as JobPostInput),
  });
export const updateJob: RequestHandler = async (req, res) =>
  res.json({
    job: await service.saveJob(
      context(req),
      req.body as JobPostInput,
      param(req, "jobId"),
    ),
  });
export const applications: RequestHandler = async (req, res) =>
  res.json({
    applications: await service.listApplications(
      context(req),
      req.query as unknown as ApplicationQuery,
    ),
  });
export const updateApplication: RequestHandler = async (req, res) =>
  res.json({
    application: await service.updateApplication(
      context(req),
      param(req, "applicationId"),
      req.body as ApplicationUpdateInput,
    ),
  });
export const downloadResume: RequestHandler = async (req, res) => {
  const inline = req.query.view === "inline";
  const file = await service.resumeFor(
    context(req),
    param(req, "applicationId"),
    inline ? "resume_viewed" : "resume_downloaded",
  );
  const safeName = file.fileName.replace(/[\\/:*?"<>|]/g, "_");
  const canPreviewInline = inline && file.mimeType === "application/pdf";
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader(
    "Content-Disposition",
    `${canPreviewInline ? "inline" : "attachment"}; filename="${safeName}"`,
  );
  res.send(file.buffer);
};

export const publicJobs: RequestHandler = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json(await service.publicJobs(param(req, "orgSlug")));
};
export const publicJob: RequestHandler = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json(
    await service.publicJobDetail(param(req, "orgSlug"), param(req, "jobCode")),
  );
};
export const publicApply: RequestHandler = async (req, res) => {
  if (!req.file) throw new Error("A résumé file is required");
  res
    .status(201)
    .json(
      await service.publicApply(
        param(req, "orgSlug"),
        param(req, "jobCode"),
        req.body as PublicApplicationInput,
        req.file,
      ),
    );
};

export const publicOnboarding: RequestHandler = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json(
    await service.publicOnboarding(
      param(req, "orgSlug"),
      param(req, "token"),
    ),
  );
};

export const completePublicOnboarding: RequestHandler = async (req, res) => {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const portrait = files?.portrait?.[0];
  const identityDocument = files?.identityDocument?.[0];
  if (!portrait || !identityDocument)
    throw new BadRequestError("Add both the portrait and identity document");
  res.status(201).json(
    await service.completePublicOnboarding(
      param(req, "orgSlug"),
      param(req, "token"),
      req.body as PublicOnboardingInput,
      { portrait, identityDocument },
    ),
  );
};

/* Espace candidat ---------------------------------------------------- */

export const publicTracking: RequestHandler = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.json(await portal.publicTracking(param(req, "orgSlug"), param(req, "token")));
};

export const publicSubmitDocument: RequestHandler = async (req, res) => {
  if (!req.file) throw new BadRequestError("Ajoutez le fichier à envoyer", { field: "file" });
  res.status(201).json(
    await portal.publicSubmitDocument(
      param(req, "orgSlug"),
      param(req, "token"),
      param(req, "requestId"),
      req.file,
    ),
  );
};

export const publicRecoverTracking: RequestHandler = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json(
    await portal.publicRecoverTracking(param(req, "orgSlug"), String((req.body as { email: string }).email)),
  );
};

export const documentRequests: RequestHandler = async (req, res) =>
  res.json(await portal.listDocumentRequests(context(req), param(req, "applicationId")));

export const createDocumentRequest: RequestHandler = async (req, res) =>
  res.status(201).json(
    await portal.createDocumentRequest(
      context(req),
      param(req, "applicationId"),
      req.body as DocumentRequestInput,
    ),
  );

export const reviewDocumentRequest: RequestHandler = async (req, res) =>
  res.json(
    await portal.reviewDocumentRequest(
      context(req),
      param(req, "applicationId"),
      param(req, "requestId"),
      req.body as DocumentReviewInput,
    ),
  );

export const downloadDocumentRequestFile: RequestHandler = async (req, res) => {
  const inline = req.query.view === "inline";
  const file = await portal.documentRequestFile(
    context(req),
    param(req, "applicationId"),
    param(req, "requestId"),
  );
  const safeName = file.fileName.replace(/[\\/:*?"<>|\r\n]/g, "_");
  // Header values must be ASCII; keep the real name in filename*.
  const asciiName = safeName.normalize("NFD").replace(/[^\x20-\x7e]/g, "") || "document";
  const canPreviewInline =
    inline && (file.mimeType === "application/pdf" || file.mimeType.startsWith("image/"));
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Disposition",
    `${canPreviewInline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
  );
  res.send(file.buffer);
};

export const sendTrackingLink: RequestHandler = async (req, res) =>
  res.json(await portal.sendTrackingLink(context(req), param(req, "applicationId")));
