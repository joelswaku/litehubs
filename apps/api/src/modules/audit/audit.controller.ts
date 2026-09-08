import type { Request, RequestHandler } from "express";
import * as service from "./audit.service";
import * as reports from "./audit-report.service";
import type { AuditQuery } from "./audit.validation";
function context(req: Request): service.AuditContext { return { organizationId:req.organization!.id, userId:req.user!.id, memberId:req.membership!.memberId, isOwner:req.membership!.isOwner }; }
export const list: RequestHandler = async (req,res) => res.json({ entries: await service.list(context(req), req.query as AuditQuery) });
export const summary: RequestHandler = async (req,res) => res.json(await service.summary(context(req)));

export const downloadPdf: RequestHandler = async (req, res) => {
  const french = String(req.query.lang ?? "fr").toLowerCase() !== "en";
  const pdf = await reports.exportAuditPdf(context(req), req.query as AuditQuery, french);
  res
    .status(200)
    .type("application/pdf")
    .setHeader("Content-Disposition", "attachment; filename=\"audit-log.pdf\"")
    .send(pdf);
};