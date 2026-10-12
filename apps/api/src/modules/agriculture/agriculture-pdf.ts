/**
 * Printable agriculture documents: plot sheet (Fiche de parcelle) and crop
 * cycle sheet (Fiche de culture). Records are loaded through the regular,
 * scope-checked agriculture service; each section is only printed when the
 * member also holds that record type's read permission.
 */
import type { Request, RequestHandler } from "express";
import { z } from "zod";
import { createPdf, pdfDate, pdfText, sendPdf, type PdfBuilder } from "../../utils/pdf-builder";
import { withTenantContext } from "../../utils/tenant-query";
import * as service from "./agriculture.service";
import { organizationParams, type AgricultureListQuery, type AgricultureResource } from "./agriculture.validation";

type Row = Record<string, unknown>;

const id = z.string().uuid("Enter a valid identifier");
export const agriculturePlotSheetParams = organizationParams.extend({ plotId: id });
export const agriculturePlantingSheetParams = organizationParams.extend({ plantingId: id });

const permissionResource: Partial<Record<AgricultureResource, string>> = {
  plantings: "plantings",
  operations: "operations",
  irrigation: "irrigation",
  fertilizer: "fertilizer",
  pesticides: "pesticides",
  scouting: "scouting",
  harvest: "harvest",
  "production-targets": "production_targets",
  losses: "losses",
};

const labels: Record<string, string> = {
  available: "Disponible",
  planted: "Semée / plantée",
  fallow: "Jachère",
  resting: "Repos",
  quarantined: "Quarantaine",
  closed: "Clôturée",
  planned: "Planifiée",
  growing: "En croissance",
  harvested: "Récoltée",
  failed: "Échec",
  abandoned: "Abandonnée",
  in_progress: "En cours",
  completed: "Terminée",
  cancelled: "Annulée",
  land_preparation: "Préparation du sol",
  planting: "Semis / plantation",
  weeding: "Désherbage",
  pruning: "Taille",
  staking: "Tuteurage",
  mulching: "Paillage",
  harvesting: "Récolte",
  inspection: "Inspection",
  maintenance: "Entretien",
  drip: "Goutte-à-goutte",
  sprinkler: "Aspersion",
  furrow: "Sillons",
  flood: "Submersion",
  manual: "Manuelle",
  rainfed: "Pluviale",
  pest: "Ravageur",
  disease: "Maladie",
  weed: "Adventices",
  nutrient_deficiency: "Carence",
  water_stress: "Stress hydrique",
  growth: "Croissance",
  soil: "Sol",
  weather_damage: "Dégât climatique",
  crop_damage: "Dégât de culture",
  drought: "Sécheresse",
  fire: "Incendie",
  theft: "Vol",
  input_spoilage: "Intrant avarié",
  equipment: "Équipement",
  low: "Faible",
  medium: "Moyenne",
  high: "Élevée",
  critical: "Critique",
  open: "Ouvert",
  monitoring: "Sous surveillance",
  resolved: "Résolu",
  other: "Autre",
};

function label(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  const key = String(value);
  return labels[key] ?? key.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function quantity(value: unknown, unit: unknown = "") {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return pdfText(value);
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(number).replace(/[  ]/g, " ")}${unit ? ` ${String(unit)}` : ""}`;
}

function named(value: unknown) {
  const item = value as Row | undefined;
  return item ? [item.name, item.code].filter(Boolean).join(" · ") || "—" : "—";
}

function contextOf(req: Request): service.AgricultureContext {
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

type Loader = (resource: AgricultureResource, filter: Partial<AgricultureListQuery>) => Promise<Row[] | null>;

function loaderFor(req: Request): Loader {
  const context = contextOf(req);
  return async (resource, filter) => {
    const code = permissionResource[resource];
    if (!code || !req.membership!.permissions.includes(`agriculture.${code}.read`)) return null;
    return service.listAgricultureRecords(context, resource, { limit: 200, ...filter } as AgricultureListQuery);
  };
}

type Sections = {
  plantings?: Row[] | null;
  operations: Row[] | null;
  irrigation: Row[] | null;
  fertilizer: Row[] | null;
  pesticides: Row[] | null;
  scouting: Row[] | null;
  harvest: Row[] | null;
  targets: Row[] | null;
  losses: Row[] | null;
};

const cycle = (row: Row) => (row.planting ? named(row.planting) : "—");

/** Shared body of both sheets: inputs, treatments, operations, harvests and yields. */
function writeSections(pdf: PdfBuilder, data: Sections, areaHa: number | null, withCycle: boolean) {
  const cycleColumn = withCycle ? [{ label: "Culture", width: 1.3 }] : [];
  const cycleCell = (row: Row) => (withCycle ? [cycle(row)] : []);

  if (data.fertilizer) {
    pdf.section("Intrants (engrais et amendements)");
    const total = data.fertilizer.reduce((sum, row) => sum + Number(row.quantityKg ?? 0), 0);
    pdf.table(
      [{ label: "Date", width: 1 }, ...cycleColumn, { label: "Produit", width: 1.6 }, { label: "Formule", width: 1 }, { label: "Quantité", align: "right", width: 1 }, { label: "Méthode", width: 1.2 }, { label: "Lot", width: 0.9 }],
      data.fertilizer.map((row) => [pdfDate(row.applicationDate), ...cycleCell(row), row.productName, row.nutrientFormula, quantity(row.quantityKg, "kg"), row.applicationMethod, row.batchNumber]),
      { empty: "Aucun intrant enregistré.", totals: data.fertilizer.length ? ["Total", ...cycleCell({}).map(() => ""), "", "", quantity(total, "kg"), "", ""] : undefined },
    );
  }
  if (data.pesticides) {
    pdf.section("Traitements phytosanitaires");
    pdf.table(
      [{ label: "Date", width: 1 }, ...cycleColumn, { label: "Produit", width: 1.5 }, { label: "Matière active", width: 1.3 }, { label: "Cible", width: 1.2 }, { label: "Dose", width: 0.9 }, { label: "DAR (j)", align: "right", width: 0.7 }, { label: "Lot", width: 0.9 }],
      data.pesticides.map((row) => [pdfDate(row.applicationDate), ...cycleCell(row), row.productName, row.activeIngredient, row.targetPest, row.dosage, quantity(row.preHarvestIntervalDays), row.batchNumber]),
      { empty: "Aucun traitement phytosanitaire enregistré." },
    );
  }
  if (data.operations) {
    pdf.section("Opérations culturales");
    pdf.table(
      [{ label: "Date", width: 1 }, ...cycleColumn, { label: "Opération", width: 1.4 }, { label: "Statut", width: 1 }, { label: "Quantité", align: "right", width: 1 }, { label: "Main-d'oeuvre (h)", align: "right", width: 1 }, { label: "Équipement", width: 1.3 }],
      data.operations.map((row) => [pdfDate(row.operationDate), ...cycleCell(row), label(row.operationType), label(row.status), quantity(row.quantity, row.unit), quantity(row.labourHours), row.equipmentName]),
      { empty: "Aucune opération enregistrée." },
    );
  }
  if (data.irrigation) {
    pdf.section("Irrigation");
    pdf.table(
      [{ label: "Date", width: 1 }, ...cycleColumn, { label: "Méthode", width: 1.2 }, { label: "Volume", align: "right", width: 1 }, { label: "Durée (min)", align: "right", width: 1 }, { label: "Source", width: 1.4 }],
      data.irrigation.map((row) => [pdfDate(row.irrigationDate), ...cycleCell(row), label(row.method), quantity(row.volumeLiters, "L"), quantity(row.durationMinutes), row.waterSource]),
      { empty: "Aucune irrigation enregistrée." },
    );
  }
  if (data.scouting) {
    pdf.section("Observations au champ");
    pdf.table(
      [{ label: "Date", width: 1 }, ...cycleColumn, { label: "Type", width: 1.2 }, { label: "Gravité", width: 0.9 }, { label: "Ravageur / maladie", width: 1.3 }, { label: "Recommandation", width: 2 }, { label: "Statut", width: 1 }],
      data.scouting.map((row) => [pdfDate(row.scoutingDate), ...cycleCell(row), label(row.observationType), label(row.severity), row.pestOrDisease ?? row.observedIssue, row.recommendation, label(row.status)]),
      { empty: "Aucune observation enregistrée." },
    );
  }
  if (data.harvest) {
    pdf.section("Récoltes");
    pdf.table(
      [{ label: "Date", width: 1 }, ...cycleColumn, { label: "Quantité", align: "right", width: 1.1 }, { label: "Rebuts", align: "right", width: 1 }, { label: "Qualité", width: 1 }, { label: "Humidité", align: "right", width: 0.8 }, { label: "Stockage", width: 1.3 }],
      data.harvest.map((row) => [pdfDate(row.harvestDate), ...cycleCell(row), quantity(row.quantity, row.unit), quantity(row.rejectedQuantity, row.unit), row.qualityGrade, row.moisturePercent == null ? "—" : `${quantity(row.moisturePercent)} %`, row.storageLocation]),
      { empty: "Aucune récolte enregistrée." },
    );
    /* Yield per unit, grouped by harvest unit (kg, sacs, tonnes…). */
    const byUnit = new Map<string, { quantity: number; rejected: number }>();
    for (const row of data.harvest) {
      const unit = String(row.unit ?? "kg");
      const current = byUnit.get(unit) ?? { quantity: 0, rejected: 0 };
      current.quantity += Number(row.quantity ?? 0);
      current.rejected += Number(row.rejectedQuantity ?? 0);
      byUnit.set(unit, current);
    }
    if (byUnit.size) {
      pdf.section("Rendements");
      const targets = data.targets ?? [];
      pdf.table(
        [{ label: "Unité", width: 0.8 }, { label: "Récolté", align: "right" }, { label: "Rebuts", align: "right" }, { label: "Net", align: "right" }, { label: "Surface", align: "right" }, { label: "Rendement net / ha", align: "right", width: 1.3 }, { label: "Objectif", align: "right" }, { label: "Atteinte", align: "right", width: 0.8 }],
        [...byUnit.entries()].map(([unit, total]) => {
          const net = total.quantity - total.rejected;
          const target = targets.filter((row) => String(row.unit ?? "kg") === unit).reduce((sum, row) => sum + Number(row.targetYield ?? 0), 0);
          return [
            unit,
            quantity(total.quantity),
            quantity(total.rejected),
            quantity(net),
            areaHa ? quantity(areaHa, "ha") : "—",
            areaHa ? quantity(net / areaHa, `${unit}/ha`) : "—",
            target ? quantity(target) : "—",
            target ? `${quantity((net / target) * 100)} %` : "—",
          ];
        }),
      );
    }
  }
  if (data.losses) {
    pdf.section("Pertes");
    pdf.table(
      [{ label: "Date", width: 1 }, ...cycleColumn, { label: "Type", width: 1.2 }, { label: "Quantité", align: "right", width: 1 }, { label: "Valeur estimée", align: "right", width: 1 }, { label: "Cause / action", width: 2.2 }],
      data.losses.map((row) => [pdfDate(row.lossDate), ...cycleCell(row), label(row.lossType), quantity(row.quantity, row.unit), quantity(row.estimatedValue), [row.causeDescription, row.actionTaken].filter(Boolean).join(" — ")]),
      { empty: "Aucune perte enregistrée." },
    );
  }
}

/* ------------------------------------------------------------------ */
/* Fiche de culture (cycle cultural)                                   */
/* ------------------------------------------------------------------ */

export const downloadPlantingSheetPdf: RequestHandler = async (req, res) => {
  const context = contextOf(req);
  const plantingId = parameter(req, "plantingId");
  const planting = await service.getAgricultureRecord(context, "plantings", plantingId);
  const load = loaderFor(req);
  const filter = { plantingId };
  const [operations, irrigation, fertilizer, pesticides, scouting, harvest, targets, losses] = await Promise.all([
    load("operations", filter),
    load("irrigation", filter),
    load("fertilizer", filter),
    load("pesticides", filter),
    load("scouting", filter),
    load("harvest", filter),
    load("production-targets", filter),
    load("losses", filter),
  ]);
  const buffer = await withTenantContext(context, async (client) => {
    const pdf = await createPdf(client, context.organizationId, {
      title: "Fiche de culture",
      subtitle: `${named(planting.crop)} · ${named(planting.plot)}`,
      reference: String(planting.code ?? ""),
    });
    const area = planting.plantedAreaHa == null ? null : Number(planting.plantedAreaHa);
    pdf.section("Identification");
    pdf.fields([
      ["Cycle cultural", named(planting)],
      ["Statut", label(planting.status)],
      ["Culture", named(planting.crop)],
      ["Variété", planting.variety],
      ["Saison", named(planting.season)],
      ["Parcelle", named(planting.plot)],
      ["Champ", named(planting.field)],
      ["Exploitation", named(planting.farm)],
      ["Site", named(planting.site)],
      ["Province", (planting.province as Row | undefined)?.name],
      ["Surface de la parcelle", quantity((planting.plot as Row | undefined)?.areaHa, "ha")],
      ["Surface semée / plantée", quantity(area, "ha")],
    ]);
    pdf.section("Semis / plantation");
    pdf.fields([
      ["Date de semis", pdfDate(planting.plantingDate)],
      ["Récolte prévue", pdfDate(planting.expectedHarvestDate)],
      ["Récolte effective", pdfDate(planting.actualHarvestDate)],
      ["Méthode", planting.plantingMethod],
      ["Semences", quantity(planting.seedQuantity, planting.seedUnit)],
      ["Densité", quantity(planting.plantDensity)],
    ]);
    if (planting.notes) pdf.paragraph(String(planting.notes));
    const harvested = (harvest ?? []).reduce((sum, row) => sum + Number(row.quantity ?? 0) - Number(row.rejectedQuantity ?? 0), 0);
    pdf.stats([
      ["Surface", quantity(area, "ha")],
      ["Intrants", fertilizer ? quantity(fertilizer.reduce((sum, row) => sum + Number(row.quantityKg ?? 0), 0), "kg") : "—"],
      ["Traitements", pesticides ? quantity(pesticides.length) : "—"],
      ["Opérations", operations ? quantity(operations.length) : "—"],
      ["Récolte nette", harvest ? quantity(harvested) : "—"],
    ]);
    writeSections(pdf, { operations, irrigation, fertilizer, pesticides, scouting, harvest, targets, losses }, area, false);
    pdf.note("Les rubriques absentes de cette fiche ne sont pas incluses faute d'autorisation de lecture correspondante. Au plus 200 enregistrements par rubrique (les plus récents).");
    pdf.signatures(["Responsable de site", "Chef de culture"]);
    return pdf.finish();
  });
  sendPdf(res, buffer, `fiche-culture-${String(planting.code ?? plantingId)}.pdf`, req.query.inline === "1");
};

/* ------------------------------------------------------------------ */
/* Fiche de parcelle                                                   */
/* ------------------------------------------------------------------ */

export const downloadPlotSheetPdf: RequestHandler = async (req, res) => {
  const context = contextOf(req);
  const plotId = parameter(req, "plotId");
  const plot = await service.getAgricultureRecord(context, "plots", plotId);
  const load = loaderFor(req);
  const plantings = await load("plantings", { plotId });
  const plantingIds = new Set((plantings ?? []).map((row) => String(row.id)));
  /* Field events may reference the plot directly or only one of its crop cycles. */
  const onPlot = (rows: Row[] | null) => rows && rows.filter((row) => row.plotId === plotId || plantingIds.has(String(row.plantingId ?? "")));
  const fieldFilter = { fieldId: String(plot.fieldId ?? "") };
  const [operations, irrigation, fertilizer, pesticides, scouting, losses, harvest, targets] = await Promise.all([
    load("operations", fieldFilter).then(onPlot),
    load("irrigation", fieldFilter).then(onPlot),
    load("fertilizer", fieldFilter).then(onPlot),
    load("pesticides", fieldFilter).then(onPlot),
    load("scouting", fieldFilter).then(onPlot),
    load("losses", fieldFilter).then(onPlot),
    load("harvest", { plotId }),
    load("production-targets", { plotId }),
  ]);
  const buffer = await withTenantContext(context, async (client) => {
    const pdf = await createPdf(client, context.organizationId, {
      title: "Fiche de parcelle",
      subtitle: `${named(plot)} · ${named(plot.farm)}`,
      reference: String(plot.code ?? ""),
    });
    const area = plot.areaHa == null ? null : Number(plot.areaHa);
    pdf.section("Identification");
    pdf.fields([
      ["Parcelle", named(plot)],
      ["Statut", label(plot.status)],
      ["Surface", quantity(area, "ha")],
      ["Type de sol", plot.soilType],
      ["Champ", named(plot.field)],
      ["Exploitation", named(plot.farm)],
      ["Site", named(plot.site)],
      ["Province", (plot.province as Row | undefined)?.name],
    ]);
    if (plot.notes) pdf.paragraph(String(plot.notes));
    if (plantings) {
      pdf.section("Cultures (cycles culturaux)");
      pdf.table(
        [{ label: "Cycle", width: 1.5 }, { label: "Culture", width: 1.3 }, { label: "Variété", width: 1 }, { label: "Saison", width: 1.1 }, { label: "Semis", width: 0.9 }, { label: "Récolte prévue", width: 1 }, { label: "Surface", align: "right", width: 0.8 }, { label: "Statut", width: 1 }],
        plantings.map((row) => [named(row), named(row.crop), row.variety, named(row.season), pdfDate(row.plantingDate), pdfDate(row.actualHarvestDate ?? row.expectedHarvestDate), quantity(row.plantedAreaHa, "ha"), label(row.status)]),
        { empty: "Aucune culture enregistrée sur cette parcelle." },
      );
    }
    writeSections(pdf, { operations, irrigation, fertilizer, pesticides, scouting, harvest, targets, losses }, area, true);
    pdf.note("Les rubriques absentes de cette fiche ne sont pas incluses faute d'autorisation de lecture correspondante. Au plus 200 enregistrements par rubrique (les plus récents). Le rendement est calculé sur la surface de la parcelle.");
    pdf.signatures(["Responsable de site", "Chef de culture"]);
    return pdf.finish();
  });
  sendPdf(res, buffer, `fiche-parcelle-${String(plot.code ?? plotId)}.pdf`, req.query.inline === "1");
};
