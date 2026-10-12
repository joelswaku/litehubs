/**
 * Printable pig documents: pen sheet (Fiche de loge), treatment report
 * (Rapport de traitement) and vaccination calendar (Calendrier de vaccination).
 * Every section is loaded through the regular, scope-checked pig service and is
 * only printed when the member also holds that record type's read permission.
 */
import type { Request, RequestHandler } from "express";
import { z } from "zod";
import { createPdf, pdfDate, pdfText, sendPdf } from "../../utils/pdf-builder";
import { withTenantContext } from "../../utils/tenant-query";
import { organizationParams } from "./pig.validation";
import type { PigResource } from "./pig.validation";
import * as service from "./pig.service";

type Row = Record<string, unknown>;

const id = z.string().uuid("Enter a valid identifier");
const date = z.string().date("Use YYYY-MM-DD");

export const pigPenSheetParams = organizationParams.extend({ penId: id });
export const pigTreatmentReportParams = organizationParams.extend({ recordId: id });
export const pigVaccinationCalendarQuery = z.object({
  siteId: id.optional(),
  from: date.optional(),
  to: date.optional(),
  inline: z.string().optional(),
});

const permissionResource: Partial<Record<PigResource, string>> = {
  groups: "groups",
  animals: "animals",
  "daily-records": "daily_records",
  feed: "feed",
  mortality: "mortality",
  pregnancies: "pregnancies",
  farrowing: "farrowing",
  health: "health",
  vaccinations: "vaccinations",
  treatments: "treatments",
};

const labels: Record<string, string> = {
  gestation: "Gestation",
  farrowing: "Maternité",
  nursery: "Post-sevrage",
  weaner: "Sevrage",
  grower: "Croissance",
  finisher: "Finition",
  boar: "Verrat",
  gilt: "Cochette",
  quarantine: "Quarantaine",
  hospital: "Infirmerie",
  holding: "Attente",
  other: "Autre",
  suckling: "Sous la mère",
  breeding: "Reproduction",
  replacement: "Renouvellement",
  creep: "Pré-démarrage",
  starter: "Démarrage",
  lactation: "Lactation",
  medicated: "Médicamenteux",
  active: "Actif",
  closed: "Clôturé",
  sold: "Vendu",
  transferred: "Transféré",
  depleted: "Épuisé",
  pregnant: "Gestante",
  lactating: "Allaitante",
  quarantined: "En quarantaine",
  deceased: "Mort",
  culled: "Réformé",
  sow: "Truie",
  barrow: "Castrat",
  piglet: "Porcelet",
  female: "Femelle",
  male: "Mâle",
  mixed: "Mixte",
  unknown: "Inconnu",
  suspected: "Suspectée",
  confirmed: "Confirmée",
  aborted: "Avortée",
  farrowed: "Mise bas faite",
  lost: "Perdue",
  observation: "Observation",
  ultrasound: "Échographie",
  blood_test: "Analyse sanguine",
  disease: "Maladie",
  injury: "Blessure",
  crushing: "Écrasement",
  starvation: "Inanition",
  heat_stress: "Stress thermique",
  respiratory: "Respiratoire",
  digestive: "Digestive",
  reproductive: "Reproduction",
  management: "Conduite d'élevage",
  low: "Faible",
  medium: "Moyenne",
  high: "Élevée",
  critical: "Critique",
  open: "Ouvert",
  monitoring: "Sous surveillance",
  resolved: "Résolu",
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

function isoDay(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function contextOf(req: Request): service.PigContext {
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

function canRead(req: Request, resource: PigResource) {
  const code = permissionResource[resource];
  return Boolean(code && req.membership!.permissions.includes(`pigs.${code}.read`));
}

function place(record: Row) {
  const pen = record.pen as Row | undefined;
  return pen ? [pen.name, pen.code].filter(Boolean).join(" · ") : "—";
}

/** Animal / group display names for the ids referenced by records the member can already read. */
async function subjectNames(client: import("pg").PoolClient, organizationId: string, rows: Row[]) {
  const animalIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const row of rows) {
    for (const key of ["animalId", "sowAnimalId"]) if (typeof row[key] === "string") animalIds.add(String(row[key]));
    if (typeof row.groupId === "string") groupIds.add(String(row.groupId));
  }
  const names = new Map<string, string>();
  if (animalIds.size) {
    const result = await client.query<{ id: string; animal_number: string; name: string | null }>(
      "SELECT id, animal_number, name FROM pig_animals WHERE organization_id = $1 AND id = ANY($2::uuid[])",
      [organizationId, [...animalIds]],
    );
    for (const row of result.rows) names.set(row.id, [row.animal_number, row.name].filter(Boolean).join(" · "));
  }
  if (groupIds.size) {
    const result = await client.query<{ id: string; code: string; name: string }>(
      "SELECT id, code, name FROM pig_groups WHERE organization_id = $1 AND id = ANY($2::uuid[])",
      [organizationId, [...groupIds]],
    );
    for (const row of result.rows) names.set(row.id, `Bande ${row.name || row.code}`);
  }
  return names;
}

function subject(names: Map<string, string>, row: Row) {
  const animal = typeof row.animalId === "string" ? names.get(row.animalId) : null;
  const group = typeof row.groupId === "string" ? names.get(row.groupId) : null;
  return animal ?? group ?? "Loge entière";
}

/* ------------------------------------------------------------------ */
/* Fiche de loge                                                       */
/* ------------------------------------------------------------------ */

const sheetEvents = [
  ["feed", "feedDate"],
  ["mortality", "mortalityDate"],
  ["pregnancies", "confirmedDate"],
  ["farrowing", "farrowingDate"],
  ["treatments", "treatmentDate"],
  ["vaccinations", "vaccinationDate"],
  ["health", "recordDate"],
] as const satisfies ReadonlyArray<readonly [PigResource, string]>;

export const downloadPenSheetPdf: RequestHandler = async (req, res) => {
  const context = contextOf(req);
  const penId = parameter(req, "penId");
  const pen = await service.getPigRecord(context, "pens", penId);
  const load = async (resource: PigResource) =>
    canRead(req, resource) ? service.listPigRecords(context, resource, { penId }) : null;

  const [groups, animals, daily] = await Promise.all([load("groups"), load("animals"), load("daily-records")]);
  const events = new Map<PigResource, Row[] | null>();
  for (const [resource] of sheetEvents) events.set(resource, await load(resource));

  /* Full history when it is short; otherwise the last 90 days. */
  const total = [...events.values()].reduce((sum, rows) => sum + (rows?.length ?? 0), 0);
  const fullHistory = total <= 80;
  const since = isoDay(-90);
  for (const [resource, dateKey] of sheetEvents) {
    const rows = events.get(resource);
    if (rows && !fullHistory) events.set(resource, rows.filter((row) => String(row[dateKey] ?? "") >= since));
  }
  const rowsOf = (resource: PigResource) => events.get(resource) ?? null;

  const buffer = await withTenantContext(context, async (client) => {
    const names = await subjectNames(client, context.organizationId, [
      ...(animals ?? []),
      ...[...events.values()].flatMap((rows) => rows ?? []),
    ]);
    const site = pen.site as Row | undefined;
    const province = pen.province as Row | undefined;
    const pdf = await createPdf(client, context.organizationId, {
      title: "Fiche de loge",
      subtitle: `${pdfText(pen.name)} · ${pdfText(site?.name)}`,
      reference: String(pen.code ?? ""),
    });
    const presentAnimals = (animals ?? []).filter((row) => ["active", "pregnant", "lactating", "quarantined"].includes(String(row.status)));
    const activeGroups = (groups ?? []).filter((row) => row.status === "active");
    const latestDaily = (daily ?? []).find((row) => row.closingCount !== null && row.closingCount !== undefined);
    const deaths = (rowsOf("mortality") ?? []).reduce((sum, row) => sum + Number(row.deathCount ?? 0), 0);
    const feedKg = (rowsOf("feed") ?? []).reduce((sum, row) => sum + Number(row.quantityKg ?? 0), 0);

    pdf.section("Identification");
    pdf.fields([
      ["Loge", pen.name],
      ["Code", pen.code],
      ["Type de loge", label(pen.penType)],
      ["Statut", pen.isActive === false ? "Inactive" : "Active"],
      ["Site", site ? [site.name, site.code].filter(Boolean).join(" · ") : "—"],
      ["Province", province?.name],
      ["Capacité", quantity(pen.capacity, "têtes")],
      ["Période couverte", fullHistory ? "Historique complet" : `90 derniers jours (depuis le ${pdfDate(since)})`],
    ]);
    pdf.stats([
      ["Capacité", quantity(pen.capacity)],
      ["Effectif relevé", latestDaily ? quantity(latestDaily.closingCount) : "—"],
      ["Animaux présents", animals ? quantity(presentAnimals.length) : "—"],
      ["Bandes actives", groups ? quantity(activeGroups.length) : "—"],
      ["Morts (période)", rowsOf("mortality") ? quantity(deaths) : "—"],
      ["Aliment (période)", rowsOf("feed") ? quantity(feedKg, "kg") : "—"],
    ]);
    if (latestDaily)
      pdf.note(`Effectif relevé : dernier relevé journalier du ${pdfDate(latestDaily.recordDate)} (${quantity(latestDaily.closingCount)} têtes en fin de journée).`);
    if (pen.notes) pdf.paragraph(String(pen.notes));

    if (groups) {
      pdf.section("Bandes");
      pdf.table(
        [{ label: "Bande", width: 2 }, { label: "Stade", width: 1.4 }, { label: "Race", width: 1.4 }, { label: "Sexe" }, { label: "Arrivée", width: 1.1 }, { label: "Effectif initial", align: "right", width: 1.1 }, { label: "Statut" }],
        groups.map((row) => [[row.name, row.code].filter(Boolean).join(" · "), label(row.productionStage), row.breed, label(row.sex), pdfDate(row.arrivalDate), quantity(row.initialCount), label(row.status)]),
        { empty: "Aucune bande dans cette loge." },
      );
    }
    if (animals) {
      pdf.section("Animaux présents");
      pdf.table(
        [{ label: "Numéro", width: 1.3 }, { label: "Nom", width: 1.3 }, { label: "Boucle" }, { label: "Sexe", width: 0.9 }, { label: "Type" }, { label: "Race", width: 1.2 }, { label: "Naissance", width: 1.1 }, { label: "Statut", width: 1.1 }],
        presentAnimals.map((row) => [row.animalNumber, row.name, row.earTag, label(row.sex), label(row.animalType), row.breed, pdfDate(row.birthDate), label(row.status)]),
        { empty: "Aucun animal identifié individuellement dans cette loge." },
      );
    }
    const pregnancies = rowsOf("pregnancies");
    if (pregnancies) {
      pdf.section("Gestations");
      pdf.table(
        [{ label: "Truie", width: 1.6 }, { label: "Confirmée le", width: 1.1 }, { label: "Méthode", width: 1.2 }, { label: "Mise bas prévue", width: 1.2 }, { label: "Statut" }],
        pregnancies.map((row) => [names.get(String(row.sowAnimalId)) ?? "—", pdfDate(row.confirmedDate), label(row.confirmationMethod), pdfDate(row.expectedFarrowingDate), label(row.status)]),
        { empty: "Aucune gestation enregistrée sur la période." },
      );
    }
    const farrowings = rowsOf("farrowing");
    if (farrowings) {
      pdf.section("Mises bas");
      const sum = (key: string) => farrowings.reduce((total, row) => total + Number(row[key] ?? 0), 0);
      pdf.table(
        [{ label: "Truie", width: 1.6 }, { label: "Date", width: 1.1 }, { label: "Nés totaux", align: "right" }, { label: "Nés vivants", align: "right" }, { label: "Mort-nés", align: "right" }, { label: "Momifiés", align: "right" }, { label: "Assistance" }],
        farrowings.map((row) => [names.get(String(row.sowAnimalId)) ?? "—", pdfDate(row.farrowingDate), quantity(row.totalBornCount), quantity(row.liveBornCount), quantity(row.stillbornCount), quantity(row.mummifiedCount), row.assistanceRequired ? "Oui" : "Non"]),
        {
          empty: "Aucune mise bas enregistrée sur la période.",
          totals: farrowings.length ? ["Total", "", quantity(sum("totalBornCount")), quantity(sum("liveBornCount")), quantity(sum("stillbornCount")), quantity(sum("mummifiedCount")), ""] : undefined,
        },
      );
    }
    const mortality = rowsOf("mortality");
    if (mortality) {
      pdf.section("Mortalité");
      pdf.table(
        [{ label: "Date", width: 1 }, { label: "Sujet", width: 1.5 }, { label: "Morts", align: "right", width: 0.7 }, { label: "Cause", width: 1.2 }, { label: "Diagnostic / suspicion", width: 2 }, { label: "Vétérinaire", width: 1.2 }],
        mortality.map((row) => [pdfDate(row.mortalityDate), subject(names, row), quantity(row.deathCount), label(row.causeCategory), row.confirmedDiagnosis ?? row.suspectedCause, row.veterinarianName]),
        { empty: "Aucune mortalité enregistrée sur la période.", totals: mortality.length ? ["Total", "", quantity(deaths), "", "", ""] : undefined },
      );
    }
    const feed = rowsOf("feed");
    if (feed) {
      pdf.section("Alimentation");
      pdf.table(
        [{ label: "Date", width: 1 }, { label: "Aliment", width: 1.8 }, { label: "Stade", width: 1.1 }, { label: "Sujet", width: 1.3 }, { label: "Quantité", align: "right" }, { label: "Sacs", align: "right", width: 0.7 }, { label: "Lot" }],
        feed.map((row) => [pdfDate(row.feedDate), row.feedName, label(row.feedStage), subject(names, row), quantity(row.quantityKg, "kg"), quantity(row.bagCount), row.batchNumber]),
        { empty: "Aucune distribution d'aliment sur la période.", totals: feed.length ? ["Total", "", "", "", quantity(feedKg, "kg"), "", ""] : undefined },
      );
    }
    const treatments = rowsOf("treatments");
    if (treatments) {
      pdf.section("Traitements");
      pdf.table(
        [{ label: "Date", width: 1 }, { label: "Produit", width: 1.5 }, { label: "Motif", width: 1.8 }, { label: "Sujet", width: 1.2 }, { label: "Dosage / voie", width: 1.3 }, { label: "Fin", width: 0.9 }, { label: "Délai d'attente", width: 1 }],
        treatments.map((row) => [pdfDate(row.treatmentDate), row.productName, row.reason, subject(names, row), [row.dosage, row.administrationRoute].filter(Boolean).join(" · ") || "—", pdfDate(row.endDate), pdfDate(row.withdrawalEndDate)]),
        { empty: "Aucun traitement enregistré sur la période." },
      );
    }
    const vaccinations = rowsOf("vaccinations");
    if (vaccinations) {
      pdf.section("Vaccinations");
      pdf.table(
        [{ label: "Date", width: 1 }, { label: "Vaccin", width: 1.6 }, { label: "Sujet", width: 1.3 }, { label: "Dose / voie", width: 1.3 }, { label: "Lot" }, { label: "Rappel", width: 1 }, { label: "Administré par", width: 1.2 }],
        vaccinations.map((row) => [pdfDate(row.vaccinationDate), row.vaccineName, subject(names, row), [row.dose, row.administrationRoute].filter(Boolean).join(" · ") || "—", row.batchNumber, pdfDate(row.nextDueDate), row.administeredBy]),
        { empty: "Aucune vaccination enregistrée sur la période." },
      );
    }
    const health = rowsOf("health");
    if (health) {
      pdf.section("Événements sanitaires");
      pdf.table(
        [{ label: "Date", width: 1 }, { label: "Type", width: 1.2 }, { label: "Gravité", width: 0.9 }, { label: "Sujet", width: 1.3 }, { label: "Diagnostic / action", width: 2.4 }, { label: "Statut", width: 1 }],
        health.map((row) => [pdfDate(row.recordDate), label(row.eventType), label(row.severity), subject(names, row), [row.diagnosis, row.actionTaken].filter(Boolean).join(" — ") || row.symptoms, label(row.status)]),
        { empty: "Aucun événement sanitaire sur la période." },
      );
    }
    pdf.note("Les rubriques absentes de cette fiche ne sont pas incluses faute d'autorisation de lecture correspondante.");
    pdf.signatures(["Responsable de site", "Vétérinaire"]);
    return pdf.finish();
  });
  sendPdf(res, buffer, `fiche-loge-${String(pen.code ?? penId)}.pdf`, req.query.inline === "1");
};

/* ------------------------------------------------------------------ */
/* Rapport de traitement                                               */
/* ------------------------------------------------------------------ */

export const downloadTreatmentReportPdf: RequestHandler = async (req, res) => {
  const context = contextOf(req);
  const recordId = parameter(req, "recordId");
  const treatment = await service.getPigRecord(context, "treatments", recordId);
  const penId = String(treatment.penId ?? "");
  const start = String(treatment.treatmentDate ?? isoDay());
  const windowFrom = new Date(Date.parse(`${start}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
  const windowTo = new Date(Date.parse(`${String(treatment.endDate ?? start)}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
  const sameSubject = (row: Row) =>
    (!treatment.animalId || row.animalId === treatment.animalId || !row.animalId) &&
    (!treatment.groupId || row.groupId === treatment.groupId || !row.groupId);
  const health = canRead(req, "health")
    ? (await service.listPigRecords(context, "health", { penId, from: windowFrom, to: windowTo })).filter(sameSubject)
    : null;
  const mortality = canRead(req, "mortality")
    ? (await service.listPigRecords(context, "mortality", { penId, from: start, to: windowTo })).filter(sameSubject)
    : null;

  const buffer = await withTenantContext(context, async (client) => {
    const names = await subjectNames(client, context.organizationId, [treatment, ...(health ?? []), ...(mortality ?? [])]);
    const site = treatment.site as Row | undefined;
    const province = treatment.province as Row | undefined;
    const pdf = await createPdf(client, context.organizationId, {
      title: "Rapport de traitement",
      subtitle: `Porcs · ${pdfText(treatment.productName)} · ${pdfDate(treatment.treatmentDate)}`,
      reference: `TRT-${recordId.slice(0, 8).toUpperCase()}`,
    });
    const withdrawal = treatment.withdrawalEndDate ? String(treatment.withdrawalEndDate) : null;
    pdf.section("Animaux traités");
    pdf.fields([
      ["Espèce", "Porcs"],
      ["Loge", place(treatment)],
      ["Sujet", subject(names, treatment)],
      ["Site", site ? [site.name, site.code].filter(Boolean).join(" · ") : "—"],
      ["Province", province?.name],
    ]);
    pdf.section("Traitement");
    pdf.fields([
      ["Produit", treatment.productName],
      ["Motif", treatment.reason],
      ["Dosage", treatment.dosage],
      ["Voie d'administration", treatment.administrationRoute],
      ["Début", pdfDate(treatment.treatmentDate)],
      ["Fin", pdfDate(treatment.endDate)],
      ["Fin du délai d'attente", pdfDate(withdrawal)],
      ["Prescrit par", treatment.prescribedBy],
    ]);
    if (withdrawal)
      pdf.note(
        withdrawal >= isoDay()
          ? `Délai d'attente en cours jusqu'au ${pdfDate(withdrawal)} : aucun animal traité ne doit être abattu ni vendu pour la consommation avant cette date.`
          : `Délai d'attente terminé le ${pdfDate(withdrawal)}.`,
      );
    if (treatment.notes) {
      pdf.section("Observations");
      pdf.paragraph(String(treatment.notes));
    }
    if (health) {
      pdf.section("Suivi sanitaire (30 jours avant / après)");
      pdf.table(
        [{ label: "Date", width: 1 }, { label: "Type", width: 1.2 }, { label: "Gravité", width: 0.9 }, { label: "Atteints", align: "right", width: 0.8 }, { label: "Symptômes / diagnostic", width: 2.6 }, { label: "Statut", width: 1 }],
        health.map((row) => [pdfDate(row.recordDate), label(row.eventType), label(row.severity), quantity(row.animalsAffected), [row.symptoms, row.diagnosis].filter(Boolean).join(" — "), label(row.status)]),
        { empty: "Aucun événement sanitaire lié." },
      );
    }
    if (mortality) {
      pdf.section("Mortalité depuis le début du traitement");
      pdf.table(
        [{ label: "Date", width: 1 }, { label: "Sujet", width: 1.4 }, { label: "Morts", align: "right", width: 0.7 }, { label: "Cause", width: 1.2 }, { label: "Diagnostic", width: 2.2 }],
        mortality.map((row) => [pdfDate(row.mortalityDate), subject(names, row), quantity(row.deathCount), label(row.causeCategory), row.confirmedDiagnosis ?? row.suspectedCause]),
        { empty: "Aucune mortalité enregistrée depuis le début du traitement." },
      );
    }
    pdf.signatures(["Responsable de site", "Vétérinaire"]);
    return pdf.finish();
  });
  sendPdf(res, buffer, `rapport-traitement-porcs-${recordId.slice(0, 8)}.pdf`, req.query.inline === "1");
};

/* ------------------------------------------------------------------ */
/* Calendrier de vaccination                                           */
/* ------------------------------------------------------------------ */

export const downloadVaccinationCalendarPdf: RequestHandler = async (req, res) => {
  const context = contextOf(req);
  const query = req.query as z.infer<typeof pigVaccinationCalendarQuery>;
  const from = query.from ?? isoDay(-30);
  const to = query.to ?? isoDay(90);
  const today = isoDay();
  /* Records given up to a year before the period can carry a booster due inside it. */
  const lookBack = new Date(Date.parse(`${from}T00:00:00Z`) - 366 * 86_400_000).toISOString().slice(0, 10);
  const records = await service.listPigRecords(context, "vaccinations", { siteId: query.siteId, from: lookBack, to });

  const key = (row: Row) => [row.penId, row.groupId ?? "", row.animalId ?? "", String(row.vaccineName ?? "").toLowerCase()].join("|");
  type Entry = { date: string; row: Row; kind: "done" | "planned"; status: string };
  const entries: Entry[] = [];
  for (const row of records) {
    const given = String(row.vaccinationDate ?? "");
    if (given >= from && given <= to) entries.push({ date: given, row, kind: "done", status: "Réalisée" });
    const due = row.nextDueDate ? String(row.nextDueDate) : null;
    if (due && due >= from && due <= to) {
      const followUp = records.find((other) => other !== row && key(other) === key(row) && String(other.vaccinationDate) > given);
      entries.push({
        date: due,
        row,
        kind: "planned",
        status: followUp ? `Faite le ${pdfDate(followUp.vaccinationDate)}` : due < today ? "En retard" : "Prévue",
      });
    }
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || place(a.row).localeCompare(place(b.row)));

  const buffer = await withTenantContext(context, async (client) => {
    const names = await subjectNames(client, context.organizationId, entries.map((entry) => entry.row));
    const site = query.siteId ? (records.find((row) => row.siteId === query.siteId)?.site as Row | undefined) : undefined;
    const pdf = await createPdf(client, context.organizationId, {
      title: "Calendrier de vaccination",
      subtitle: `Porcs · du ${pdfDate(from)} au ${pdfDate(to)}${site ? ` · ${pdfText(site.name)}` : ""}`,
      landscape: true,
    });
    const planned = entries.filter((entry) => entry.kind === "planned");
    pdf.stats([
      ["Vaccinations réalisées", quantity(entries.length - planned.length)],
      ["Rappels prévus", quantity(planned.filter((entry) => entry.status === "Prévue").length)],
      ["Rappels en retard", quantity(planned.filter((entry) => entry.status === "En retard").length)],
      ["Rappels faits", quantity(planned.filter((entry) => entry.status.startsWith("Faite")).length)],
    ]);
    pdf.section("Calendrier");
    pdf.table(
      [{ label: "Date", width: 0.9 }, { label: "Nature", width: 0.9 }, { label: "Vaccin", width: 1.6 }, { label: "Site", width: 1.2 }, { label: "Loge", width: 1.3 }, { label: "Sujet", width: 1.4 }, { label: "Dose / voie", width: 1.2 }, { label: "Lot", width: 0.9 }, { label: "Statut", width: 1.1 }],
      entries.map((entry) => [
        pdfDate(entry.date),
        entry.kind === "done" ? "Administrée" : "Rappel",
        entry.row.vaccineName,
        (entry.row.site as Row | undefined)?.name,
        place(entry.row),
        subject(names, entry.row),
        [entry.row.dose, entry.row.administrationRoute].filter(Boolean).join(" · ") || "—",
        entry.kind === "done" ? entry.row.batchNumber : "",
        entry.status,
      ]),
      { empty: "Aucune vaccination réalisée ni prévue sur la période." },
    );
    pdf.note("Les rappels sont calculés à partir de la date de rappel saisie sur chaque vaccination. Un rappel est marqué « Faite » dès qu'une vaccination plus récente du même vaccin est enregistrée pour le même sujet.");
    pdf.signatures(["Responsable de site", "Vétérinaire"]);
    return pdf.finish();
  });
  sendPdf(res, buffer, `calendrier-vaccination-porcs-${from}-${to}.pdf`, req.query.inline === "1");
};
