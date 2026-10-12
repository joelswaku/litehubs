/**
 * Printable poultry veterinary documents: treatment report (Rapport de
 * traitement) and vaccination calendar (Calendrier de vaccination). Data comes
 * from the regular, scope-checked poultry service; related sections are only
 * printed when the member also holds that record type's read permission.
 */
import type { Request, RequestHandler } from "express";
import { z } from "zod";
import { createPdf, pdfDate, pdfText, sendPdf } from "../../utils/pdf-builder";
import { withTenantContext } from "../../utils/tenant-query";
import * as service from "./poultry.service";
import { organizationParams } from "./poultry.validation";

type Row = Record<string, unknown>;

const id = z.string().uuid("Enter a valid identifier");
const date = z.string().date("Use YYYY-MM-DD");

export const poultryTreatmentReportParams = organizationParams.extend({ recordId: id });
export const poultryVaccinationCalendarQuery = z.object({
  siteId: id.optional(),
  from: date.optional(),
  to: date.optional(),
  inline: z.string().optional(),
});

const labels: Record<string, string> = {
  observation: "Observation",
  suspected_disease: "Maladie suspectée",
  confirmed_disease: "Maladie confirmée",
  outbreak: "Foyer épidémique",
  injury: "Blessure",
  other: "Autre",
  low: "Faible",
  medium: "Moyenne",
  high: "Élevée",
  critical: "Critique",
  open: "Ouvert",
  monitoring: "Sous surveillance",
  resolved: "Résolu",
  unknown: "Inconnue",
  disease: "Maladie",
  active: "Actif",
  quarantined: "En quarantaine",
  broiler: "Chair",
  layer: "Pondeuse",
  breeder: "Reproducteur",
};

function label(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  const key = String(value);
  return labels[key] ?? key.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function quantity(value: unknown, unit = "") {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return pdfText(value);
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(number).replace(/[  ]/g, " ")}${unit ? ` ${unit}` : ""}`;
}

const DAY = 86_400_000;
function isoDay(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
}
function shift(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

function contextOf(req: Request): service.PoultryContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
  };
}

function parameter(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function can(req: Request, code: string) {
  return req.membership!.permissions.includes(code);
}

function named(value: unknown) {
  const item = value as Row | undefined;
  return item ? [item.name, item.code].filter(Boolean).join(" · ") || "—" : "—";
}

/* ------------------------------------------------------------------ */
/* Rapport de traitement                                               */
/* ------------------------------------------------------------------ */

export const downloadPoultryTreatmentReportPdf: RequestHandler = async (req, res) => {
  const context = contextOf(req);
  const recordId = parameter(req, "recordId");
  const treatment = (await service.getPoultryRecord(context, "treatments", recordId)) as Row;
  const flockId = String(treatment.flockId ?? "");
  const start = String(treatment.treatmentDate ?? isoDay());
  const windowFrom = shift(start, -30);
  const windowTo = shift(String(treatment.endDate ?? start), 30);
  const flock = can(req, "poultry.flocks.read") && flockId ? ((await service.getPoultryRecord(context, "flocks", flockId)) as Row) : null;
  const health = can(req, "poultry.health.read")
    ? ((await service.listPoultryRecords(context, "health", { flockId, from: windowFrom, to: windowTo })) as Row[])
    : null;
  const mortality = can(req, "poultry.mortality.read")
    ? ((await service.listPoultryRecords(context, "mortality", { flockId, from: start, to: windowTo })) as Row[])
    : null;

  const buffer = await withTenantContext(context, async (client) => {
    const pdf = await createPdf(client, context.organizationId, {
      title: "Rapport de traitement",
      subtitle: `Volaille · ${pdfText(treatment.productName)} · ${pdfDate(treatment.treatmentDate)}`,
      reference: `TRT-${recordId.slice(0, 8).toUpperCase()}`,
    });
    pdf.section("Lot traité");
    pdf.fields([
      ["Espèce", "Volaille"],
      ["Lot", named(treatment.flock)],
      ["Bâtiment", named(treatment.house)],
      ["Site", named(treatment.site)],
      ["Province", (treatment.province as Row | undefined)?.name],
      ...(flock
        ? ([
            ["Type de production", label(flock.productionType ?? flock.birdType)],
            ["Race / souche", flock.breed],
            ["Oiseaux au départ", quantity(flock.initialBirdCount)],
            ["Oiseaux vivants calculés", quantity(flock.expectedLiveBirdCount)],
          ] as [string, unknown][])
        : []),
    ]);
    pdf.section("Traitement");
    pdf.fields([
      ["Produit", treatment.productName],
      ["Motif", treatment.reason],
      ["Dosage", treatment.dosage],
      ["Voie d'administration", treatment.administrationRoute],
      ["Début", pdfDate(treatment.treatmentDate)],
      ["Fin", pdfDate(treatment.endDate)],
      ["Fin du délai d'attente", pdfDate(treatment.withdrawalEndDate)],
      ["Prescrit par", treatment.prescribedBy],
    ]);
    const withdrawal = treatment.withdrawalEndDate ? String(treatment.withdrawalEndDate) : null;
    if (withdrawal)
      pdf.note(
        withdrawal >= isoDay()
          ? `Délai d'attente en cours jusqu'au ${pdfDate(withdrawal)} : ni les oiseaux ni les oeufs du lot ne doivent être livrés à la consommation avant cette date.`
          : `Délai d'attente terminé le ${pdfDate(withdrawal)}.`,
      );
    if (treatment.notes) {
      pdf.section("Observations");
      pdf.paragraph(String(treatment.notes));
    }
    if (health) {
      pdf.section("Suivi sanitaire (30 jours avant / après)");
      pdf.table(
        [{ label: "Date", width: 1 }, { label: "Type", width: 1.3 }, { label: "Gravité", width: 0.9 }, { label: "Oiseaux atteints", align: "right", width: 1 }, { label: "Symptômes / diagnostic", width: 2.5 }, { label: "Statut", width: 1 }],
        health.map((row) => [pdfDate(row.recordDate), label(row.eventType), label(row.severity), quantity(row.birdsAffected), [row.symptoms, row.diagnosis].filter(Boolean).join(" — "), label(row.status)]),
        { empty: "Aucun événement sanitaire lié." },
      );
    }
    if (mortality) {
      const deaths = mortality.reduce((sum, row) => sum + Number(row.deathCount ?? 0), 0);
      pdf.section("Mortalité depuis le début du traitement");
      pdf.table(
        [{ label: "Date", width: 1 }, { label: "Morts", align: "right", width: 0.7 }, { label: "Cause", width: 1.2 }, { label: "Diagnostic / suspicion", width: 2.6 }, { label: "Vétérinaire", width: 1.2 }],
        mortality.map((row) => [pdfDate(row.mortalityDate), quantity(row.deathCount), label(row.causeCategory), row.confirmedDiagnosis ?? row.suspectedCause, row.veterinarianName]),
        { empty: "Aucune mortalité enregistrée depuis le début du traitement.", totals: mortality.length ? ["Total", quantity(deaths), "", "", ""] : undefined },
      );
    }
    pdf.signatures(["Responsable de site", "Vétérinaire"]);
    return pdf.finish();
  });
  sendPdf(res, buffer, `rapport-traitement-volaille-${recordId.slice(0, 8)}.pdf`, req.query.inline === "1");
};

/* ------------------------------------------------------------------ */
/* Calendrier de vaccination                                           */
/* ------------------------------------------------------------------ */

export const downloadPoultryVaccinationCalendarPdf: RequestHandler = async (req, res) => {
  const context = contextOf(req);
  const query = req.query as z.infer<typeof poultryVaccinationCalendarQuery>;
  const from = query.from ?? isoDay(-30);
  const to = query.to ?? isoDay(90);
  const today = isoDay();
  /* Older records are needed to know whether a planned dose was already given. */
  const records = (await service.listPoultryRecords(context, "vaccinations", { siteId: query.siteId, from: shift(from, -730), to })) as Row[];
  /* Programme doses from performance models need flock read access (same as the flock performance view). */
  const flocks = can(req, "poultry.flocks.read")
    ? ((await service.listPoultryRecords(context, "flocks", { siteId: query.siteId })) as Row[]).filter((flock) =>
        ["active", "quarantined"].includes(String(flock.status)) && flock.performanceModelId,
      )
    : [];

  type Entry = { date: string; flock: unknown; house: unknown; site: unknown; vaccine: unknown; detail: string; batch: unknown; nature: string; status: string };
  const entries: Entry[] = [];
  const givenFor = (flockId: unknown, vaccine: unknown, after: string) =>
    records.find((row) => row.flockId === flockId && String(row.vaccineName ?? "").toLowerCase() === String(vaccine ?? "").toLowerCase() && String(row.vaccinationDate) >= after);

  for (const row of records) {
    const given = String(row.vaccinationDate ?? "");
    if (given >= from && given <= to)
      entries.push({ date: given, flock: row.flock, house: row.house, site: row.site, vaccine: row.vaccineName, detail: [row.dose, row.administrationRoute].filter(Boolean).join(" · "), batch: row.batchNumber, nature: "Administrée", status: "Réalisée" });
    const due = row.nextDueDate ? String(row.nextDueDate) : null;
    if (due && due >= from && due <= to) {
      const followUp = records.find((other) => other !== row && other.flockId === row.flockId && String(other.vaccineName ?? "").toLowerCase() === String(row.vaccineName ?? "").toLowerCase() && String(other.vaccinationDate) > given);
      entries.push({ date: due, flock: row.flock, house: row.house, site: row.site, vaccine: row.vaccineName, detail: [row.dose, row.administrationRoute].filter(Boolean).join(" · "), batch: "", nature: "Rappel", status: followUp ? `Faite le ${pdfDate(followUp.vaccinationDate)}` : due < today ? "En retard" : "Prévue" });
    }
  }

  const buffer = await withTenantContext(context, async (client) => {
    if (flocks.length) {
      const schedules = await client.query<{ performance_model_id: string; day_age: number; vaccine_name: string; dose: string | null; administration_route: string | null; is_required: boolean }>(
        `SELECT performance_model_id, day_age, vaccine_name, dose, administration_route, is_required
           FROM poultry_model_vaccine_schedules
          WHERE organization_id = $1 AND performance_model_id = ANY($2::uuid[])
          ORDER BY day_age, vaccine_name`,
        [context.organizationId, [...new Set(flocks.map((flock) => String(flock.performanceModelId)))]],
      );
      for (const flock of flocks) {
        const origin = String(flock.hatchDate ?? flock.arrivalDate ?? "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(origin)) continue;
        for (const schedule of schedules.rows.filter((item) => item.performance_model_id === flock.performanceModelId)) {
          const due = shift(origin, Number(schedule.day_age) - Number(flock.startingAgeDays ?? 0));
          if (due < from || due > to) continue;
          const given = givenFor(flock.id, schedule.vaccine_name, origin);
          entries.push({
            date: due,
            flock: { name: flock.name, code: flock.code },
            house: flock.house,
            site: flock.site,
            vaccine: schedule.vaccine_name,
            detail: [`J${schedule.day_age}`, schedule.dose, schedule.administration_route].filter(Boolean).join(" · "),
            batch: "",
            nature: schedule.is_required ? "Programme" : "Programme (option)",
            status: given ? `Faite le ${pdfDate(given.vaccinationDate)}` : due < today ? "En retard" : "Prévue",
          });
        }
      }
    }
    entries.sort((a, b) => a.date.localeCompare(b.date) || named(a.flock).localeCompare(named(b.flock)));
    const site = query.siteId ? [...records, ...flocks].find((row) => row.siteId === query.siteId)?.site : undefined;
    const pdf = await createPdf(client, context.organizationId, {
      title: "Calendrier de vaccination",
      subtitle: `Volaille · du ${pdfDate(from)} au ${pdfDate(to)}${site ? ` · ${pdfText((site as Row).name)}` : ""}`,
      landscape: true,
    });
    const planned = entries.filter((entry) => entry.nature !== "Administrée");
    pdf.stats([
      ["Vaccinations réalisées", quantity(entries.length - planned.length)],
      ["Doses prévues", quantity(planned.filter((entry) => entry.status === "Prévue").length)],
      ["Doses en retard", quantity(planned.filter((entry) => entry.status === "En retard").length)],
      ["Doses faites", quantity(planned.filter((entry) => entry.status.startsWith("Faite")).length)],
    ]);
    pdf.section("Calendrier");
    pdf.table(
      [{ label: "Date", width: 0.9 }, { label: "Nature", width: 1 }, { label: "Vaccin", width: 1.6 }, { label: "Site", width: 1.2 }, { label: "Bâtiment", width: 1.2 }, { label: "Lot", width: 1.4 }, { label: "Âge / dose / voie", width: 1.4 }, { label: "N° lot vaccin", width: 0.9 }, { label: "Statut", width: 1.1 }],
      entries.map((entry) => [pdfDate(entry.date), entry.nature, entry.vaccine, named(entry.site), named(entry.house), named(entry.flock), entry.detail || "—", entry.batch, entry.status]),
      { empty: "Aucune vaccination réalisée ni prévue sur la période." },
    );
    pdf.note(
      "« Programme » : dose du programme vaccinal du modèle de performance attribué au lot (date = origine du lot + âge prévu). « Rappel » : date de rappel saisie sur une vaccination. Une dose est marquée « Faite » dès qu'une vaccination du même vaccin est enregistrée pour le lot." +
        (can(req, "poultry.flocks.read") ? "" : " Le programme des modèles n'est pas affiché faute d'accès en lecture aux lots."),
    );
    pdf.signatures(["Responsable de site", "Vétérinaire"]);
    return pdf.finish();
  });
  sendPdf(res, buffer, `calendrier-vaccination-volaille-${from}-${to}.pdf`, req.query.inline === "1");
};
