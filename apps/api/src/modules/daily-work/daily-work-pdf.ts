/** « Rapport d'activité » PDF: one employee's daily reports and checklists over a period. */
import { createPdf, pdfDate } from "../../utils/pdf-builder";
import { withTenantContext } from "../../utils/tenant-query";
import { employeeActivity, type DailyWorkContext } from "./daily-work.service";
import type { ActivityReportQuery } from "./daily-work.validation";

const REPORT_STATUS: Record<string, string> = {
  draft: "Brouillon",
  submitted: "Soumis",
  reviewed: "Validé",
  flagged: "Signalé",
};
const RUN_STATUS: Record<string, string> = {
  in_progress: "En cours",
  completed: "Terminée",
  verified: "Vérifiée",
  cancelled: "Annulée",
};
const LEVEL: Record<string, string> = {
  employee: "Employé",
  supervisor: "Superviseur",
  manager: "Manager",
  owner_digest: "Synthèse direction",
};

const pick = (map: Record<string, string>, value: unknown) =>
  value ? (map[String(value)] ?? String(value).replace(/_/g, " ")) : null;
const time = (value: unknown) =>
  value
    ? new Date(String(value)).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Africa/Kinshasa",
      })
    : null;

/** Monday–Sunday of the current week (Kinshasa time). */
export function currentWeek() {
  const now = new Date(Date.now() + 60 * 60 * 1000);
  const day = (now.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

export async function activityReportPdf(context: DailyWorkContext, query: ActivityReportQuery) {
  const week = currentWeek();
  const from = query.from ?? (query.to && query.to < week.from ? query.to : week.from);
  const to = query.to ?? (query.from && query.from > week.to ? query.from : week.to);
  const data = await employeeActivity(context, { employeeId: query.employeeId, from, to });

  const buffer = await withTenantContext(context, async (client) => {
    const pdf = await createPdf(client, context.organizationId, {
      title: "Rapport d'activité",
      subtitle: `${data.employee.fullName} · du ${pdfDate(from)} au ${pdfDate(to)}`,
    });
    const reviewed = data.reports.filter((row) => row.status === "reviewed").length;
    const flagged = data.reports.filter((row) => row.status === "flagged").length;
    const runsDone = data.runs.filter((row) => row.status === "completed" || row.status === "verified").length;

    pdf.section("Employé").fields([
      ["Nom complet", data.employee.fullName],
      ["Période", `du ${pdfDate(from)} au ${pdfDate(to)}`],
    ]);
    pdf.stats([
      ["Rapports quotidiens", data.reports.length],
      ["Validés", reviewed],
      ["Signalés", flagged],
      ["Check-lists terminées", `${runsDone} / ${data.runs.length}`],
    ]);

    pdf.section("Rapports quotidiens");
    pdf.table(
      [
        { label: "Date", width: 1 },
        { label: "Heure", width: 0.7 },
        { label: "Niveau", width: 1 },
        { label: "Site", width: 1.2 },
        { label: "Travail réalisé", width: 4 },
        { label: "Statut", width: 1 },
      ],
      data.reports.map((row) => [
        pdfDate(row.workDate),
        time(row.submittedAt),
        pick(LEVEL, row.reportLevel),
        row.siteName,
        [
          row.summary,
          row.workDone ? `Réalisé : ${String(row.workDone)}` : null,
          row.problems ? `Difficultés : ${String(row.problems)}` : null,
          row.helpNeeded ? `Besoin d'aide : ${String(row.helpNeeded)}` : null,
          row.reviewNote ? `Note de ${String(row.reviewerName ?? "l'évaluateur")} : ${String(row.reviewNote)}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        pick(REPORT_STATUS, row.status),
      ]),
      { empty: "Aucun rapport quotidien sur cette période." },
    );

    pdf.section("Check-lists et travaux de routine");
    pdf.table(
      [
        { label: "Date", width: 1 },
        { label: "Check-list", width: 2.7 },
        { label: "Site", width: 1.4 },
        { label: "Points", width: 1.3, align: "right" },
        { label: "Début", width: 0.8 },
        { label: "Fin", width: 0.8 },
        { label: "Statut", width: 1 },
      ],
      data.runs.map((row) => [
        pdfDate(row.workDate),
        row.templateName,
        row.siteName,
        `${Number(row.itemsCompleted ?? 0)} / ${Number(row.itemsTotal ?? 0)}${Number(row.itemsFailed ?? 0) ? ` (${Number(row.itemsFailed)} NC)` : ""}`,
        time(row.createdAt),
        time(row.completedAt),
        pick(RUN_STATUS, row.status),
      ]),
      { empty: "Aucune check-list sur cette période." },
    );

    pdf.note("Heures en heure de Kinshasa. NC = point non conforme.");
    pdf.signatures(["Employé", "Responsable"]);
    return pdf.finish();
  });
  const name = data.employee.fullName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return { buffer, fileName: `rapport-activite-${name}-${from}-${to}.pdf` };
}
