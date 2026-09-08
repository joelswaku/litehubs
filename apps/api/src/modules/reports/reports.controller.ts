import type { Request, RequestHandler } from "express";
import * as service from "./reports.service";
import type { ReportQuery } from "./reports.validation";

function context(req: Request): service.ReportsContext {
  return { organizationId: req.organization!.id, userId: req.user!.id, memberId: req.membership!.memberId, isOwner: req.membership!.isOwner, permissions: req.membership!.permissions };
}
const french = (req: Request) => String(req.query.lang ?? "fr").toLowerCase() !== "en";
export const overview: RequestHandler = async (req, res) => res.json({ report: await service.overview(context(req), req.query as ReportQuery) });
export const downloadPdf: RequestHandler = async (req, res) => { const pdf = await service.exportPdf(context(req), req.query as ReportQuery, french(req)); res.status(200).type("application/pdf").setHeader("Content-Disposition", "attachment; filename=\"operations-report.pdf\"").send(pdf); };
export const downloadExcel: RequestHandler = async (req, res) => { const workbook = await service.exportExcel(context(req), req.query as ReportQuery, french(req)); res.status(200).type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").setHeader("Content-Disposition", "attachment; filename=\"operations-report.xlsx\"").send(workbook); };