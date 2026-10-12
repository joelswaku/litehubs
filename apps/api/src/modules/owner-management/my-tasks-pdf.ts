/**
 * « Rapport d'activité » PDF for the caller's own assigned tasks (My tasks).
 * Like GET /my-tasks it is permissionless at the route layer and hard-limited
 * to req.membership.memberId through listMyAssignedTasks.
 */
import type { Request, RequestHandler } from "express";
import { z } from "zod";
import { createPdf, pdfDate, sendPdf } from "../../utils/pdf-builder";
import { withTenantContext } from "../../utils/tenant-query";
import { listMyAssignedTasks, type OwnerManagementContext } from "./owner-management.service";

const date = z.string().date("Use YYYY-MM-DD");
export const myTasksReportQuery = z
  .object({ from: date.optional(), to: date.optional() })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    path: ["to"],
    message: "End date must be on or after start date",
  });

const STATUS: Record<string, string> = {
  not_started: "Non commencée",
  planned: "Planifiée",
  todo: "À faire",
  in_progress: "En cours",
  blocked: "Bloquée",
  waiting_approval: "En attente de validation",
  completed: "Terminée",
  cancelled: "Annulée",
};
const PRIORITY: Record<string, string> = {
  low: "Basse",
  medium: "Moyenne",
  normal: "Normale",
  high: "Haute",
  urgent: "Urgente",
  critical: "Critique",
};
const pick = (map: Record<string, string>, value: unknown) =>
  value ? (map[String(value)] ?? String(value).replace(/_/g, " ")) : null;
const text = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value));

function currentWeek() {
  const now = new Date(Date.now() + 60 * 60 * 1000);
  const day = (now.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

function contextOf(req: Request): OwnerManagementContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
  };
}

export const exportMyTasksReportPdf: RequestHandler = async (req, res) => {
  const context = contextOf(req);
  const query = req.query as z.infer<typeof myTasksReportQuery>;
  const week = currentWeek();
  const from = query.from ?? (query.to && query.to < week.from ? query.to : week.from);
  const to = query.to ?? (query.from && query.from > week.to ? query.from : week.to);

  const all = await listMyAssignedTasks(context);
  // A task belongs to the period when its planned window overlaps it; an
  // undated task is listed while it is still open.
  const tasks = all.filter((task) => {
    const start = text(task.startDate)?.slice(0, 10) ?? text(task.dueDate)?.slice(0, 10) ?? null;
    const end = text(task.dueDate)?.slice(0, 10) ?? start;
    if (!start || !end) return !["completed", "cancelled"].includes(String(task.status));
    return start <= to && end >= from;
  });

  const buffer = await withTenantContext(context, async (client) => {
    const person = await client.query<{ full_name: string | null; employee_number: string | null }>(
      `SELECT COALESCE(e.full_name,u.full_name) AS full_name,e.employee_number
         FROM organization_members m
         JOIN users u ON u.id=m.user_id
         LEFT JOIN employees e ON e.organization_id=m.organization_id AND e.member_id=m.id
        WHERE m.organization_id=$1 AND m.id=$2
        LIMIT 1`,
      [context.organizationId, context.memberId],
    );
    const name = person.rows[0]?.full_name ?? "—";
    const pdf = await createPdf(client, context.organizationId, {
      title: "Rapport d'activité",
      subtitle: `${name} · du ${pdfDate(from)} au ${pdfDate(to)}`,
      reference: person.rows[0]?.employee_number ?? undefined,
    });
    const count = (status: string) => tasks.filter((task) => task.status === status).length;
    const average = tasks.length
      ? Math.round(tasks.reduce((sum, task) => sum + Number(task.progressPercent ?? 0), 0) / tasks.length)
      : 0;

    pdf.section("Employé").fields([
      ["Nom complet", name],
      ["Période", `du ${pdfDate(from)} au ${pdfDate(to)}`],
    ]);
    pdf.stats([
      ["Tâches", tasks.length],
      ["Terminées", count("completed")],
      ["En cours", count("in_progress")],
      ["Bloquées", count("blocked")],
      ["Avancement moyen", `${average} %`],
    ]);

    pdf.section("Tâches affectées");
    pdf.table(
      [
        { label: "Tâche", width: 3.2 },
        { label: "Projet / lieu", width: 2 },
        { label: "Début", width: 0.9 },
        { label: "Échéance", width: 0.9 },
        { label: "Priorité", width: 0.8 },
        { label: "Avanc.", width: 0.7, align: "right" },
        { label: "Statut", width: 1.1 },
      ],
      tasks.map((task) => [
        [
          [text(task.code), text(task.title)].filter(Boolean).join(" · "),
          text(task.blockedReason) ? `Blocage : ${String(task.blockedReason)}` : null,
          text(task.notes) ? `Notes : ${String(task.notes)}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        [text(task.projectName), text(task.phaseName), text(task.siteName) ?? text(task.provinceName)].filter(Boolean).join(" · ") || null,
        task.startDate ? pdfDate(task.startDate) : null,
        task.dueDate ? pdfDate(task.dueDate) : null,
        pick(PRIORITY, task.priority),
        `${Math.round(Number(task.progressPercent ?? 0))} %`,
        pick(STATUS, task.status),
      ]),
      { empty: "Aucune tâche affectée sur cette période." },
    );
    pdf.note("Sont listées les tâches dont la période prévue chevauche la période du rapport, ainsi que les tâches sans date encore ouvertes.");
    pdf.signatures(["Employé", "Responsable"]);
    return pdf.finish();
  });
  sendPdf(res, buffer, `rapport-activite-taches-${from}-${to}.pdf`);
};
