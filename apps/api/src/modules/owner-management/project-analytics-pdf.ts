/**
 * Rapport global des projets: the project analytics page as a printable
 * report. Data comes from projectAnalytics (same filters, same visible
 * projects); progress and open risks are only read for those visible projects.
 */
import type { Request, RequestHandler } from "express";
import { createPdf, pdfDate, pdfMoney, sendPdf } from "../../utils/pdf-builder";
import { withTenantContext } from "../../utils/tenant-query";
import * as service from "./owner-management.service";
import type { ProjectAnalyticsQuery } from "./owner-management.validation";

type Row = Record<string, unknown>;

const STATUS: Record<string, string> = {
  draft: "Brouillon",
  planning: "Planification",
  planned: "Planifié",
  approved: "Approuvé",
  active: "En cours",
  in_progress: "En cours",
  on_hold: "En pause",
  completed: "Terminé",
  closed: "Clôturé",
  cancelled: "Annulé",
};

const number = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function contextOf(req: Request): service.OwnerManagementContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
  };
}

/** Days past the (revised) target date for a project that is not finished. */
function daysLate(project: Row, today: string) {
  const status = String(project.status ?? "");
  if (["completed", "closed", "cancelled"].includes(status)) return 0;
  const due = String(project.revisedCompletionDate ?? project.targetCompletionDate ?? "").slice(0, 10);
  if (!due || due >= today) return 0;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
}

export const exportProjectAnalyticsPdf: RequestHandler = async (req, res) => {
  const context = contextOf(req);
  const filters = req.query as unknown as ProjectAnalyticsQuery;
  const analytics = await service.projectAnalytics(context, filters);
  const projects = (Array.isArray(analytics.projects) ? analytics.projects : []) as Row[];
  const totals = (Array.isArray(analytics.totalsByCurrency) ? analytics.totalsByCurrency : []) as Row[];
  // Same scoped project list the analytics use; only read for progress %.
  const visible = await service.listOwnerManagementRecords(context, "projects", { limit: 200, offset: 0 });
  const progressById = new Map(visible.map((project) => [String(project.id), number(project.calculatedProgressPercent ?? project.progressPercent)]));
  const ids = projects.map((project) => String(project.id));
  const today = new Date().toISOString().slice(0, 10);

  const buffer = await withTenantContext(context, async (client) => {
    const risks = ids.length
      ? await client.query<{ project_id: string; open_risks: number }>(
          `SELECT project_id, COUNT(*)::int AS open_risks
             FROM management_project_risks
            WHERE organization_id=$1 AND project_id = ANY($2::uuid[])
              AND resolved_at IS NULL
              AND COALESCE(status,'') NOT IN ('closed','resolved','cancelled')
            GROUP BY project_id`,
          [context.organizationId, ids],
        )
      : { rows: [] };
    const riskById = new Map(risks.rows.map((row) => [String(row.project_id), number(row.open_risks)]));

    const period = [filters.fromDate ? `du ${pdfDate(filters.fromDate)}` : "", filters.toDate ? `au ${pdfDate(filters.toDate)}` : ""].filter(Boolean).join(" ");
    const pdf = await createPdf(client, context.organizationId, {
      title: "Rapport global des projets",
      subtitle: `${projects.length} projet(s)${period ? ` · ${period}` : ""}`,
      landscape: true,
    });

    const late = projects.filter((project) => daysLate(project, today) > 0).length;
    const overdueTasks = projects.reduce((sum, project) => sum + number(project.overdueTasks), 0);
    const openRisks = [...riskById.values()].reduce((sum, value) => sum + value, 0);
    pdf.stats([
      ["Projets", projects.length],
      ["Projets en retard", late],
      ["Tâches en retard", overdueTasks],
      ["Risques ouverts", openRisks],
      ["Hors budget", projects.filter((project) => number(project.available) < -0.004).length],
    ]);

    pdf.section("Totaux par devise");
    pdf.table(
      [
        { label: "Devise", width: 0.8 },
        { label: "Projets", width: 0.7, align: "right" },
        { label: "Budget prévu", width: 1.4, align: "right" },
        { label: "Engagé", width: 1.3, align: "right" },
        { label: "Dépensé", width: 1.3, align: "right" },
        { label: "Disponible", width: 1.3, align: "right" },
        { label: "Revenus", width: 1.3, align: "right" },
        { label: "Résultat", width: 1.3, align: "right" },
      ],
      totals.map((total) => {
        const currency = String(total.currencyCode ?? "");
        return [
          currency,
          number(total.projectCount),
          pdfMoney(total.planned, currency),
          pdfMoney(total.committed, currency),
          pdfMoney(total.spent, currency),
          pdfMoney(total.available, currency),
          pdfMoney(total.revenue, currency),
          pdfMoney(total.operationalResult, currency),
        ];
      }),
      { empty: "Aucun projet visible." },
    );

    pdf.section("Détail par projet");
    pdf.table(
      [
        { label: "Code", width: 0.9 },
        { label: "Projet", width: 2.2 },
        { label: "Statut", width: 1 },
        { label: "Avanc.", width: 0.7, align: "right" },
        { label: "Budget", width: 1.4, align: "right" },
        { label: "Dépensé", width: 1.4, align: "right" },
        { label: "Utilisé", width: 0.7, align: "right" },
        { label: "Fin prévue", width: 1 },
        { label: "Retard (j)", width: 0.8, align: "right" },
        { label: "Tâches en retard", width: 0.9, align: "right" },
        { label: "Risques", width: 0.7, align: "right" },
      ],
      projects.map((project) => {
        const currency = String(project.currencyCode ?? "");
        const delay = daysLate(project, today);
        return [
          project.code,
          [project.name, project.siteName ?? project.provinceName].filter(Boolean).join(" · "),
          STATUS[String(project.status)] ?? String(project.status ?? "—").replace(/_/g, " "),
          `${(progressById.get(String(project.id)) ?? 0).toFixed(0)} %`,
          pdfMoney(project.planned, currency),
          pdfMoney(project.spent, currency),
          `${number(project.utilizationPercent).toFixed(0)} %`,
          pdfDate(project.revisedCompletionDate ?? project.targetCompletionDate),
          delay ? delay : "—",
          number(project.overdueTasks) || "—",
          riskById.get(String(project.id)) || "—",
        ];
      }),
      { empty: "Aucun projet visible avec ces filtres." },
    );
    pdf.note("Montants dans la devise de chaque projet. Retard : jours écoulés depuis la date de fin (révisée) pour un projet non terminé. Risques : risques non résolus.");
    pdf.signatures(["Établi par", "Direction"]);
    return pdf.finish();
  });
  sendPdf(res, buffer, `rapport-global-projets-${today}.pdf`, req.query.inline === "1");
};
