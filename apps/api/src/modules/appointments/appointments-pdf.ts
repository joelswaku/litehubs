/**
 * Printable appointment documents: the daily schedule of one site (or every
 * site the member can see) and a single visitor ticket. Both reuse the scoped
 * appointment queries, so a PDF never shows more than the staff list does.
 */
import type { Request, RequestHandler } from "express";
import { createPdf, pdfDate, pdfText, sendPdf } from "../../utils/pdf-builder";
import { withTenantContext } from "../../utils/tenant-query";
import * as service from "./appointments.service";
import type { AppointmentSchedulePdfInput } from "./appointments.validation";

type Appointment = Awaited<ReturnType<typeof service.getAppointment>>;

const STATUS: Record<string, string> = {
  scheduled: "Prévu",
  checked_in: "Arrivé",
  waiting: "En attente",
  called: "Appelé",
  serving: "En service",
  completed: "Terminé",
  cancelled: "Annulé",
  no_show: "Absent",
};

function context(req: Request): service.AppointmentContext {
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

/** Today in Kinshasa, as YYYY-MM-DD. */
function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kinshasa", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function time(value: unknown) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kinshasa" });
}

function plannedAt(row: Appointment) {
  return row.scheduledAt ?? row.checkedInAt ?? row.createdAt;
}

async function scheduleRows(ctx: service.AppointmentContext, input: AppointmentSchedulePdfInput, date: string) {
  const rows: Appointment[] = [];
  for (let offset = 0; offset < 2_000; offset += 100) {
    const page = await service.listAppointments(ctx, { siteId: input.siteId, date, limit: 100, offset });
    rows.push(...(page.appointments as Appointment[]));
    if (!page.page.hasMore) break;
  }
  const at = (row: Appointment) => new Date(String(plannedAt(row) ?? 0)).getTime() || 0;
  return rows.sort(
    (a, b) =>
      String(a.site.name ?? "").localeCompare(String(b.site.name ?? "")) ||
      at(a) - at(b) ||
      (a.queue?.number ?? 99_999) - (b.queue?.number ?? 99_999),
  );
}

export const appointmentSchedulePdf: RequestHandler = async (req, res) => {
  const ctx = context(req);
  const input = req.query as unknown as AppointmentSchedulePdfInput;
  const date = input.date ?? today();
  // listAppointments checks site access and the member's data scope.
  const rows = await scheduleRows(ctx, input, date);
  const buffer = await withTenantContext(ctx, async (client) => {
    let siteName = "Tous les sites";
    if (input.siteId) {
      const site = await client.query<{ name: string }>("SELECT name FROM sites WHERE organization_id=$1 AND id=$2", [ctx.organizationId, input.siteId]);
      siteName = site.rows[0]?.name ?? rows[0]?.site.name ?? "Site";
    }
    const pdf = await createPdf(client, ctx.organizationId, {
      title: "Planning des rendez-vous",
      subtitle: `${siteName} · ${pdfDate(date)}`,
      landscape: !input.siteId,
    });
    const count = (statuses: string[]) => rows.filter((row) => statuses.includes(String(row.status))).length;
    pdf.stats([
      ["Rendez-vous", rows.length],
      ["Prévus", count(["scheduled"])],
      ["En file", count(["checked_in", "waiting", "called", "serving"])],
      ["Terminés", count(["completed"])],
      ["Annulés / absents", count(["cancelled", "no_show"])],
    ]);
    pdf.section("Rendez-vous du jour");
    const columns = [
      { label: "Heure", width: 0.8 },
      { label: "Ticket", width: 0.8, align: "center" as const },
      { label: "Référence", width: 1.4 },
      { label: "Visiteur", width: 1.8 },
      ...(input.siteId ? [] : [{ label: "Site", width: 1.5 }]),
      { label: "Service", width: 1.8 },
      { label: "Guichet", width: 1.2 },
      { label: "Statut", width: 1.1 },
    ];
    pdf.table(
      columns,
      rows.map((row) => [
        time(plannedAt(row)),
        row.queue ? `#${row.queue.number}` : "—",
        row.reference,
        // Same privacy-preserving name as the public queue: first name + initial.
        service.queueDisplayName(row.visitor?.name),
        ...(input.siteId ? [] : [row.site.name]),
        row.service?.name ?? "—",
        row.desk?.name ?? "—",
        STATUS[String(row.status)] ?? row.status,
      ]),
      { empty: "Aucun rendez-vous pour cette journée." },
    );
    pdf.note("Les coordonnées des visiteurs ne sont pas imprimées. Les noms sont abrégés pour protéger leur vie privée.");
    pdf.signatures(["Établi par", "Responsable du site"]);
    return pdf.finish();
  });
  sendPdf(res, buffer, `planning-rendez-vous-${date}.pdf`, input.inline === "1");
};

export const appointmentTicketPdf: RequestHandler = async (req, res) => {
  const ctx = context(req);
  const appointment = await service.getAppointment(ctx, param(req, "appointmentId"));
  const buffer = await withTenantContext(ctx, async (client) => {
    const pdf = await createPdf(client, ctx.organizationId, {
      title: "Ticket de rendez-vous",
      reference: appointment.reference ?? undefined,
    });
    const doc = pdf.doc;
    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const boxWidth = Math.min(300, width);
    const x = left + (width - boxWidth) / 2;
    const y = doc.y + 6;
    const height = 230;
    doc.roundedRect(x, y, boxWidth, height, 8).dash(4, { space: 3 }).strokeColor("#61708B").lineWidth(1).stroke().undash();
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#61708B").text("NUMÉRO DE FILE", x, y + 16, { width: boxWidth, align: "center", characterSpacing: 0.6 });
    doc.font("Helvetica-Bold").fontSize(46).fillColor("#1E3A6E").text(appointment.queue ? `#${appointment.queue.number}` : "—", x, y + 30, { width: boxWidth, align: "center" });
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#172033").text(pdfText(appointment.reference), x, y + 88, { width: boxWidth, align: "center" });
    const line = (label: string, value: unknown, offset: number) => {
      doc.font("Helvetica").fontSize(8).fillColor("#61708B").text(label.toUpperCase(), x + 20, y + offset, { width: 90 });
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#172033").text(pdfText(value), x + 110, y + offset - 1, { width: boxWidth - 130, lineBreak: false, ellipsis: true });
    };
    const when = appointment.scheduledAt ?? appointment.checkedInAt ?? appointment.queue?.date ?? appointment.createdAt;
    line("Date et heure", pdfDate(when, Boolean(appointment.scheduledAt || appointment.checkedInAt)), 116);
    line("Site", appointment.site.name, 136);
    line("Service", appointment.service?.name ?? "—", 156);
    line("Guichet", appointment.desk?.name ?? "—", 176);
    line("Statut", STATUS[String(appointment.status)] ?? appointment.status, 196);
    doc.y = y + height + 18;
    doc.x = left;
    pdf.note("Présentez ce ticket à l'accueil. Votre numéro sera appelé à l'écran ; merci de rester à proximité du guichet indiqué.");
    return pdf.finish();
  });
  sendPdf(res, buffer, `ticket-${appointment.reference ?? appointment.id}.pdf`, req.query.inline === "1");
};
