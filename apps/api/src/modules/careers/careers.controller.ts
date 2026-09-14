import type { Request, RequestHandler } from "express";
import * as service from "./careers.service";
import type {
  ApplicationQuery,
  ApplicationUpdateInput,
  CareerSiteSettingsInput,
  JobPostInput,
  JobQuery,
  PublicApplicationInput,
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

export const publicJobs: RequestHandler = async (req, res) =>
  res.json(await service.publicJobs(param(req, "orgSlug")));
export const publicJob: RequestHandler = async (req, res) =>
  res.json(
    await service.publicJobDetail(param(req, "orgSlug"), param(req, "jobCode")),
  );
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
