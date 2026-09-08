import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PoolClient } from "pg";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type {
  PoultryListQuery,
  PoultryOverviewQuery,
  PoultryResource,
} from "./poultry.validation";

export interface PoultryContext {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
}

type Scope = "organization" | "province" | "self";
type Input = Record<string, unknown>;
type Row = Record<string, unknown>;
type RecordResource = Exclude<PoultryResource, "houses" | "flocks">;

interface RecordConfig {
  table: string;
  relation: "flock" | "house";
  dateColumn: string;
  statusColumn?: string;
  tracksRecorder?: boolean;
  fields: Record<string, string>;
}

const records: Record<RecordResource, RecordConfig> = {
  "daily-records": {
    table: "poultry_daily_records",
    relation: "flock",
    dateColumn: "record_date",
    fields: {
      recordDate: "record_date",
      liveBirdCount: "live_bird_count",
      arrivalsCount: "arrivals_count",
      transfersOutCount: "transfers_out_count",
      cullsCount: "culls_count",
      temperatureC: "temperature_c",
      humidityPercent: "humidity_percent",
      notes: "notes",
    },
  },
  mortality: {
    table: "poultry_mortality_records",
    relation: "flock",
    dateColumn: "mortality_date",
    fields: {
      mortalityDate: "mortality_date",
      deathCount: "death_count",
      causeCategory: "cause_category",
      suspectedCause: "suspected_cause",
      confirmedDiagnosis: "confirmed_diagnosis",
      clinicalSigns: "clinical_signs",
      postmortemStatus: "postmortem_status",
      disposalMethod: "disposal_method",
      veterinarianName: "veterinarian_name",
      requiresFollowUp: "requires_follow_up",
      followUpStatus: "follow_up_status",
      followUpNotes: "follow_up_notes",
      notes: "notes",
    },
  },
  feed: {
    table: "poultry_feed_records",
    relation: "flock",
    dateColumn: "feed_date",
    fields: {
      feedDate: "feed_date",
      feedName: "feed_name",
      feedStage: "feed_stage",
      quantityKg: "quantity_kg",
      bagCount: "bag_count",
      batchNumber: "batch_number",
      inventoryItemId: "inventory_item_id",
      notes: "notes",
    },
  },
  water: {
    table: "poultry_water_records",
    relation: "flock",
    dateColumn: "water_date",
    fields: {
      waterDate: "water_date",
      volumeLiters: "volume_liters",
      sourceName: "source_name",
      notes: "notes",
    },
  },
  weights: {
    table: "poultry_weight_records",
    relation: "flock",
    dateColumn: "record_date",
    fields: {
      recordDate: "record_date",
      sampleSize: "sample_size",
      averageWeightG: "average_weight_g",
      minimumWeightG: "minimum_weight_g",
      maximumWeightG: "maximum_weight_g",
      uniformityPercent: "uniformity_percent",
      notes: "notes",
    },
  },
  eggs: {
    table: "poultry_egg_records",
    relation: "flock",
    dateColumn: "record_date",
    fields: {
      recordDate: "record_date",
      totalEggs: "total_eggs",
      crackedEggs: "cracked_eggs",
      dirtyEggs: "dirty_eggs",
      hatchingEggs: "hatching_eggs",
      rejectedEggs: "rejected_eggs",
      notes: "notes",
    },
  },
  health: {
    table: "poultry_health_records",
    relation: "flock",
    dateColumn: "record_date",
    statusColumn: "status",
    fields: {
      recordDate: "record_date",
      eventType: "event_type",
      severity: "severity",
      birdsAffected: "birds_affected",
      symptoms: "symptoms",
      diagnosis: "diagnosis",
      actionTaken: "action_taken",
      veterinarianName: "veterinarian_name",
      status: "status",
      notes: "notes",
    },
  },
  vaccinations: {
    table: "poultry_vaccination_records",
    relation: "flock",
    dateColumn: "vaccination_date",
    fields: {
      vaccinationDate: "vaccination_date",
      vaccineName: "vaccine_name",
      manufacturer: "manufacturer",
      batchNumber: "batch_number",
      dose: "dose",
      administrationRoute: "administration_route",
      nextDueDate: "next_due_date",
      administeredBy: "administered_by",
      inventoryItemId: "inventory_item_id",
      notes: "notes",
    },
  },
  treatments: {
    table: "poultry_treatment_records",
    relation: "flock",
    dateColumn: "treatment_date",
    fields: {
      treatmentDate: "treatment_date",
      productName: "product_name",
      reason: "reason",
      dosage: "dosage",
      administrationRoute: "administration_route",
      endDate: "end_date",
      withdrawalEndDate: "withdrawal_end_date",
      prescribedBy: "prescribed_by",
      inventoryItemId: "inventory_item_id",
      notes: "notes",
    },
  },
  sanitation: {
    table: "poultry_sanitation_records",
    relation: "house",
    dateColumn: "sanitation_date",
    statusColumn: "status",
    fields: {
      sanitationDate: "sanitation_date",
      activityType: "activity_type",
      productName: "product_name",
      status: "status",
      performedBy: "performed_by",
      inventoryItemId: "inventory_item_id",
      notes: "notes",
    },
  },
  biosecurity: {
    table: "poultry_biosecurity_records",
    relation: "house",
    dateColumn: "record_date",
    fields: {
      recordDate: "record_date",
      checkType: "check_type",
      complianceStatus: "compliance_status",
      riskLevel: "risk_level",
      actionTaken: "action_taken",
      notes: "notes",
    },
  },
  "production-targets": {
    table: "poultry_production_targets",
    relation: "flock",
    dateColumn: "effective_from",
    tracksRecorder: false,
    fields: {
      metric: "metric",
      targetValue: "target_value",
      effectiveFrom: "effective_from",
      effectiveTo: "effective_to",
      notes: "notes",
    },
  },
  losses: {
    table: "poultry_loss_records",
    relation: "flock",
    dateColumn: "loss_date",
    fields: {
      lossDate: "loss_date",
      lossType: "loss_type",
      quantity: "quantity",
      unit: "unit",
      description: "description",
      notes: "notes",
    },
  },
};

const snakeToCamel = (name: string) =>
  name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

function mapRow(row: Row) {
  const mapped = Object.fromEntries(
    Object.entries(row).map(([key, item]) => [snakeToCamel(key), item]),
  );

  const numberFields = [
    "capacity",
    "initialBirdCount",
    "startingAgeDays",
    "currentBirdCount",
    "expectedLiveBirdCount",
    "physicalLiveBirdCount",
    "liveBirdDiscrepancy",
    "totalMortality",
    "purchaseCostTotal",
    "costPerBird",
    "birdsSold",
    "birdsTransferred",
    "finalLiveBirdCount",
    "finalMortality",
    "lengthM",
    "widthM",
    "floorAreaM2",
    "liveBirdCount",
    "arrivalsCount",
    "transfersOutCount",
    "cullsCount",
    "temperatureC",
    "humidityPercent",
    "mortalityCount",
    "deathCount",
    "dailyMortalityCount",
    "flockInitialBirdCount",
    "flockMortalityReviewThreshold",
    "quantityKg",
    "bagCount",
    "volumeLiters",
    "sampleSize",
    "averageWeightG",
    "minimumWeightG",
    "maximumWeightG",
    "uniformityPercent",
    "totalEggs",
    "crackedEggs",
    "dirtyEggs",
    "hatchingEggs",
    "rejectedEggs",
    "birdsAffected",
    "targetValue",
    "quantity",
  ];
  for (const field of numberFields) {
    if (mapped[field] != null) mapped[field] = Number(mapped[field]);
  }

  const dateFields = [
    "hatchDate",
    "arrivalDate",
    "expectedProductionEndDate",
    "closedAt",
    "recordDate",
    "mortalityDate",
    "feedDate",
    "waterDate",
    "vaccinationDate",
    "treatmentDate",
    "endDate",
    "withdrawalEndDate",
    "sanitationDate",
    "effectiveFrom",
    "effectiveTo",
    "lossDate",
    "nextDueDate",
  ];
  for (const field of dateFields) {
    if (mapped[field] instanceof Date) {
      mapped[field] = mapped[field].toISOString().slice(0, 10);
    }
  }
  if (mapped.siteId)
    mapped.site = {
      id: mapped.siteId,
      code: mapped.siteCode,
      name: mapped.siteName,
    };
  if (mapped.provinceId)
    mapped.province = {
      id: mapped.provinceId,
      code: mapped.provinceCode,
      name: mapped.provinceName,
    };
  if (mapped.houseId)
    mapped.house = {
      id: mapped.houseId,
      code: mapped.houseCode,
      name: mapped.houseName,
    };
  if (mapped.flockId)
    mapped.flock = {
      id: mapped.flockId,
      code: mapped.flockCode,
      name: mapped.flockName,
      birdType: mapped.flockBirdType,
    };
  if (mapped.totalEggs !== undefined)
    mapped.saleableEggs =
      Number(mapped.totalEggs) -
      Number(mapped.crackedEggs) -
      Number(mapped.dirtyEggs) -
      Number(mapped.hatchingEggs) -
      Number(mapped.rejectedEggs);
  if (mapped.dailyMortalityCount !== undefined) {
    const initial = Number(mapped.flockInitialBirdCount);
    mapped.dailyMortalityRatePercent =
      initial === 0
        ? 0
        : Number(
            ((Number(mapped.dailyMortalityCount) / initial) * 100).toFixed(3),
          );
    mapped.requiresDailyReview =
      Number(mapped.dailyMortalityCount) >=
      Number(mapped.flockMortalityReviewThreshold);
  }
  return mapped;
}

async function scopeOf(
  client: PoolClient,
  context: PoultryContext,
): Promise<Scope> {
  if (context.isOwner) return "organization";
  const result = await client.query<{
    organization_scope: boolean;
    province_scope: boolean;
  }>(
    `SELECT
       EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id = mr.organization_id AND r.id = mr.role_id WHERE mr.organization_id = $1 AND mr.member_id = $2 AND r.data_scope = 'organization') AS organization_scope,
       EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id = mr.organization_id AND r.id = mr.role_id WHERE mr.organization_id = $1 AND mr.member_id = $2 AND r.data_scope = 'province') AS province_scope`,
    [context.organizationId, context.memberId],
  );
  if (result.rows[0]?.organization_scope) return "organization";
  return result.rows[0]?.province_scope ? "province" : "self";
}

async function assertProvince(
  client: PoolClient,
  context: PoultryContext,
  provinceId: string,
) {
  if ((await scopeOf(client, context)) === "organization") return;
  const result = await client.query(
    "SELECT 1 FROM member_provinces WHERE organization_id = $1 AND member_id = $2 AND province_id = $3",
    [context.organizationId, context.memberId, provinceId],
  );
  if ((result.rowCount ?? 0) === 0)
    throw new NotFoundError("Poultry record not found");
}

function addScope(
  scope: Scope,
  context: PoultryContext,
  provinceSql: string,
  values: unknown[],
) {
  if (scope === "organization") return "TRUE";
  if (scope === "self") return "FALSE";
  values.push(context.memberId);
  return `EXISTS (SELECT 1 FROM member_provinces mp WHERE mp.organization_id = $1 AND mp.member_id = $${values.length} AND mp.province_id = ${provinceSql})`;
}

const locationFields =
  "s.id AS site_id, s.code AS site_code, s.name AS site_name, p.id AS province_id, p.code AS province_code, p.name AS province_name";
const houseFields = "h.*, " + locationFields;

const operationalFlockStatuses = ["active", "quarantined", "ready_for_sale"];
const closableFlockStatuses = ["closed", "sold", "depleted", "cancelled"];
const compatibleGeneralHouseTypes = ["mixed", "other", "quarantine"];

const mortalityForFlock =
  "COALESCE((SELECT SUM(m.death_count) FROM poultry_mortality_records m WHERE m.organization_id = f.organization_id AND m.flock_id = f.id), 0)";
const movementsForFlock =
  "COALESCE((SELECT SUM(COALESCE(d.arrivals_count, 0) - COALESCE(d.transfers_out_count, 0) - COALESCE(d.culls_count, 0)) FROM poultry_daily_records d WHERE d.organization_id = f.organization_id AND d.flock_id = f.id), 0)";
const expectedLiveBirdsForFlock = `GREATEST(0, f.initial_bird_count + ${movementsForFlock} - ${mortalityForFlock})`;
const latestPhysicalLiveBirdsForFlock =
  "(SELECT d.live_bird_count FROM poultry_daily_records d WHERE d.organization_id = f.organization_id AND d.flock_id = f.id AND d.live_bird_count IS NOT NULL ORDER BY d.record_date DESC, d.created_at DESC LIMIT 1)";
const flockFields =
  "f.*, h.id AS house_id, h.code AS house_code, h.name AS house_name, " +
  locationFields +
  `, ${expectedLiveBirdsForFlock} AS current_bird_count,
      ${expectedLiveBirdsForFlock} AS expected_live_bird_count,
      ${latestPhysicalLiveBirdsForFlock} AS physical_live_bird_count,
      CASE WHEN ${latestPhysicalLiveBirdsForFlock} IS NULL THEN NULL ELSE ${latestPhysicalLiveBirdsForFlock} - ${expectedLiveBirdsForFlock} END AS live_bird_discrepancy,
      CASE WHEN ${latestPhysicalLiveBirdsForFlock} IS NOT NULL AND ${latestPhysicalLiveBirdsForFlock} <> ${expectedLiveBirdsForFlock} THEN true ELSE false END AS requires_reconciliation_review,
      ${mortalityForFlock} AS total_mortality`;
async function house(
  client: PoolClient,
  context: PoultryContext,
  id: string,
): Promise<Row> {
  const result = await client.query<Row>(
    `SELECT ${houseFields} FROM poultry_houses h JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id JOIN provinces p ON p.organization_id = s.organization_id AND p.id = s.province_id WHERE h.organization_id = $1 AND h.id = $2`,
    [context.organizationId, id],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Poultry house not found");
  const scope = await scopeOf(client, context);
  if (scope === "self") throw new NotFoundError("Poultry house not found");
  if (scope === "province")
    await assertProvince(client, context, String(row.province_id));
  return row;
}

async function flock(
  client: PoolClient,
  context: PoultryContext,
  id: string,
): Promise<Row> {
  const result = await client.query<Row>(
    `SELECT ${flockFields} FROM poultry_flocks f JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id JOIN provinces p ON p.organization_id = s.organization_id AND p.id = s.province_id WHERE f.organization_id = $1 AND f.id = $2`,
    [context.organizationId, id],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Poultry flock not found");
  const scope = await scopeOf(client, context);
  if (scope === "self") throw new NotFoundError("Poultry flock not found");
  if (scope === "province")
    await assertProvince(client, context, String(row.province_id));
  return row;
}

function recordJoin(config: RecordConfig) {
  return config.relation === "flock"
    ? "JOIN poultry_flocks f ON f.organization_id = r.organization_id AND f.id = r.flock_id JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id"
    : "JOIN poultry_houses h ON h.organization_id = r.organization_id AND h.id = r.house_id LEFT JOIN poultry_flocks f ON false";
}

function recordExtras(resource: RecordResource) {
  if (resource === "mortality") {
    return ", COALESCE((SELECT SUM(m2.death_count) FROM poultry_mortality_records m2 WHERE m2.organization_id = r.organization_id AND m2.flock_id = r.flock_id AND m2.mortality_date = r.mortality_date), 0) AS daily_mortality_count, f.initial_bird_count AS flock_initial_bird_count, f.mortality_review_threshold AS flock_mortality_review_threshold";
  }
  if (resource === "daily-records") {
    const expected =
      "GREATEST(0, f.initial_bird_count + COALESCE((SELECT SUM(COALESCE(d2.arrivals_count, 0) - COALESCE(d2.transfers_out_count, 0) - COALESCE(d2.culls_count, 0)) FROM poultry_daily_records d2 WHERE d2.organization_id = r.organization_id AND d2.flock_id = r.flock_id AND d2.record_date <= r.record_date), 0) - COALESCE((SELECT SUM(m3.death_count) FROM poultry_mortality_records m3 WHERE m3.organization_id = r.organization_id AND m3.flock_id = r.flock_id AND m3.mortality_date <= r.record_date), 0))";
    return `, COALESCE((SELECT SUM(m2.death_count) FROM poultry_mortality_records m2 WHERE m2.organization_id = r.organization_id AND m2.flock_id = r.flock_id AND m2.mortality_date = r.record_date), 0) AS mortality_count, ${expected} AS expected_live_bird_count, r.live_bird_count AS physical_live_bird_count, r.live_bird_count - ${expected} AS live_bird_discrepancy, CASE WHEN r.live_bird_count <> ${expected} THEN true ELSE false END AS requires_reconciliation_review`;
  }
  return "";
}

async function record(
  client: PoolClient,
  context: PoultryContext,
  resource: RecordResource,
  id: string,
): Promise<Row> {
  const config = records[resource];
  const result = await client.query<Row>(
    `SELECT r.*, f.code AS flock_code, f.name AS flock_name, f.bird_type AS flock_bird_type, f.production_type AS flock_production_type,
            h.id AS house_id, h.code AS house_code, h.name AS house_name,
            ${locationFields}${recordExtras(resource)}
       FROM ${config.table} r ${recordJoin(config)}
       JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
       JOIN provinces p ON p.organization_id = s.organization_id AND p.id = s.province_id
      WHERE r.organization_id = $1 AND r.id = $2`,
    [context.organizationId, id],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Poultry record not found");
  const scope = await scopeOf(client, context);
  if (scope === "self") throw new NotFoundError("Poultry record not found");
  if (scope === "province")
    await assertProvince(client, context, String(row.province_id));
  return row;
}

export async function listPoultryRecords(
  context: PoultryContext,
  resource: PoultryResource,
  query: PoultryListQuery,
) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context);
    const values: unknown[] = [context.organizationId];
    if (resource === "houses") {
      const conditions = [
        "h.organization_id = $1",
        addScope(scope, context, "s.province_id", values),
      ];
      if (query.siteId) {
        values.push(query.siteId);
        conditions.push(`h.site_id = $${values.length}`);
      }
      if (query.provinceId) {
        values.push(query.provinceId);
        conditions.push(`s.province_id = $${values.length}`);
      }
      if (query.productionType) {
        values.push(query.productionType);
        conditions.push(`h.house_type = $${values.length}`);
      }
      if (query.status) {
        values.push(query.status === "active");
        conditions.push(`h.is_active = $${values.length}`);
      }
      const result = await client.query<Row>(
        `SELECT ${houseFields} FROM poultry_houses h
          JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
          JOIN provinces p ON p.organization_id = s.organization_id AND p.id = s.province_id
         WHERE ${conditions.join(" AND ")} ORDER BY h.name`,
        values,
      );
      return result.rows.map(mapRow);
    }
    if (resource === "flocks") {
      const conditions = [
        "f.organization_id = $1",
        addScope(scope, context, "s.province_id", values),
      ];
      if (query.houseId) {
        values.push(query.houseId);
        conditions.push(`f.house_id = $${values.length}`);
      }
      if (query.siteId) {
        values.push(query.siteId);
        conditions.push(`h.site_id = $${values.length}`);
      }
      if (query.provinceId) {
        values.push(query.provinceId);
        conditions.push(`s.province_id = $${values.length}`);
      }
      if (query.productionType) {
        values.push(query.productionType);
        conditions.push(
          `COALESCE(f.production_type, f.bird_type) = $${values.length}`,
        );
      }
      if (query.status) {
        values.push(query.status);
        conditions.push(`f.status = $${values.length}`);
      }
      const result = await client.query<Row>(
        `SELECT ${flockFields} FROM poultry_flocks f
          JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id
          JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
          JOIN provinces p ON p.organization_id = s.organization_id AND p.id = s.province_id
         WHERE ${conditions.join(" AND ")} ORDER BY f.arrival_date DESC, f.name`,
        values,
      );
      return result.rows.map(mapRow);
    }

    const config = records[resource];
    const conditions = [
      "r.organization_id = $1",
      addScope(scope, context, "s.province_id", values),
    ];
    if (query.flockId) {
      if (config.relation !== "flock")
        throw new BadRequestError(
          "This record belongs to a house, not a flock",
        );
      values.push(query.flockId);
      conditions.push(`r.flock_id = $${values.length}`);
    }
    if (query.houseId) {
      values.push(query.houseId);
      conditions.push(`h.id = $${values.length}`);
    }
    if (query.siteId) {
      values.push(query.siteId);
      conditions.push(`h.site_id = $${values.length}`);
    }
    if (query.provinceId) {
      values.push(query.provinceId);
      conditions.push(`s.province_id = $${values.length}`);
    }
    if (query.productionType) {
      values.push(query.productionType);
      conditions.push(
        config.relation === "flock"
          ? `COALESCE(f.production_type, f.bird_type) = $${values.length}`
          : `h.house_type = $${values.length}`,
      );
    }
    if (query.date) {
      values.push(query.date);
      conditions.push(`r.${config.dateColumn} = $${values.length}::date`);
    }
    if (query.from) {
      values.push(query.from);
      conditions.push(`r.${config.dateColumn} >= $${values.length}::date`);
    }
    if (query.to) {
      values.push(query.to);
      conditions.push(`r.${config.dateColumn} <= $${values.length}::date`);
    }
    if (query.status) {
      if (!config.statusColumn)
        throw new BadRequestError("This record does not have a status filter");
      values.push(query.status);
      conditions.push(`r.${config.statusColumn} = $${values.length}`);
    }
    const result = await client.query<Row>(
      `SELECT r.*, f.code AS flock_code, f.name AS flock_name, f.bird_type AS flock_bird_type, f.production_type AS flock_production_type,
              h.id AS house_id, h.code AS house_code, h.name AS house_name,
              ${locationFields}${recordExtras(resource)}
         FROM ${config.table} r ${recordJoin(config)}
         JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
         JOIN provinces p ON p.organization_id = s.organization_id AND p.id = s.province_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY r.${config.dateColumn} DESC, r.created_at DESC`,
      values,
    );
    return result.rows.map(mapRow);
  });
}

export async function getPoultryRecord(
  context: PoultryContext,
  resource: PoultryResource,
  recordId: string,
) {
  return withTenantContext(context, async (client) => {
    if (resource === "houses")
      return mapRow(await house(client, context, recordId));
    if (resource === "flocks")
      return mapRow(await flock(client, context, recordId));
    return mapRow(await record(client, context, resource, recordId));
  });
}


/** Generates a private, tenant-scoped snapshot; no public flock document is stored. */
export async function flockProfilePdf(context: PoultryContext, flockId: string): Promise<Buffer> {
  return withTenantContext(context, async (client) => {
    const item = await flock(client, context, flockId);
    const company = await client.query<{ display_name: string }>("SELECT display_name FROM organizations WHERE id = $1", [context.organizationId]);
    const model = item.performance_model_id ? await client.query<{ name: string; code: string }>("SELECT name, code FROM poultry_performance_models WHERE organization_id = $1 AND id = $2", [context.organizationId, item.performance_model_id]) : null;
    const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page = pdf.addPage([595.28, 841.89]); let y = 790;
    const next = () => { page = pdf.addPage([595.28, 841.89]); y = 790; };
    const write = (text: string, size = 10, strong = false) => {
      const words = text.replace(/\s+/g, " ").trim().split(" "); let line = "";
      for (const word of words) { const candidate = line ? `${line} ${word}` : word; if (candidate.length > (size >= 16 ? 54 : 88) && line) { if (y < 58) next(); page.drawText(line.slice(0, 180), { x: 52, y, size, font: strong ? bold : font, color: rgb(.10, .14, .20) }); y -= size + 6; line = word; } else line = candidate; }
      if (line) { if (y < 58) next(); page.drawText(line.slice(0, 180), { x: 52, y, size, font: strong ? bold : font, color: rgb(.10, .14, .20) }); y -= size + 6; }
    };
    const raw = (key: string) => item[key];
    const value = (key: string) => raw(key) == null || raw(key) === "" ? "—" : String(raw(key));
    const integer = (key: string) => new Intl.NumberFormat("fr-FR").format(Number(raw(key) ?? 0));
    const label = (key: string) => value(key).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    const companyName = company.rows[0]?.display_name?.trim() || "Entreprise";
    page.drawText(companyName.toLocaleUpperCase("fr-FR").slice(0, 70), { x: 52, y, size: 9, font: bold, color: rgb(.04, .42, .36) }); y -= 27;
    write("Fiche opérationnelle du lot", 20, true); write(companyName, 10); y -= 8;
    write(`${value("name")} · ${value("code")}`, 14, true); write(`Généré le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date())}`, 8); y -= 12;
    write("Situation du lot", 13, true);
    for (const [name, current] of [["Statut", label("status")], ["Type", label("production_type")], ["Oiseaux au départ", integer("initial_bird_count")], ["Oiseaux vivants calculés", integer("expected_live_bird_count")], ["Mortalité totale", integer("total_mortality")], ["Comptage physique", raw("physical_live_bird_count") == null ? "Non enregistré" : integer("physical_live_bird_count")]] as Array<[string, string]>) write(`${name} : ${current}`);
    y -= 8; write("Configuration et traçabilité", 13, true);
    for (const [name, current] of [["Bâtiment", value("house_name")], ["Ferme / site", value("site_name")], ["Province", value("province_name")], ["Race / souche", value("breed")], ["Fournisseur / couvoir", value("source_name")], ["Date d’arrivée", value("arrival_date")], ["Date d’éclosion", value("hatch_date")], ["Fin prévue", value("expected_production_end_date")], ["Modèle de performance", model?.rows[0] ? `${model.rows[0].name} · ${model.rows[0].code}` : "Aucun modèle attribué"]] as Array<[string, string]>) write(`${name} : ${current}`);
    if (raw("notes")) { y -= 8; write("Notes", 13, true); write(String(raw("notes"))); }
    for (const current of pdf.getPages()) current.drawText(`Document contrôlé · ${companyName} · Lot ${value("code")}`.slice(0, 110), { x: 52, y: 25, size: 7, font, color: rgb(.40, .45, .50) });
    return Buffer.from(await pdf.save());
  });
}function stringInput(input: Input, name: string): string {
  const item = input[name];
  if (typeof item !== "string") throw new BadRequestError(`Invalid ${name}`);
  return item;
}

function numberInput(input: Input, name: string): number {
  const item = input[name];
  if (typeof item !== "number") throw new BadRequestError(`Invalid ${name}`);
  return item;
}

function optionalInput(input: Input, name: string): string | null {
  const item = input[name];
  if (item === null || typeof item === "string") return item;
  throw new BadRequestError(`Invalid ${name}`);
}

async function activeSiteProvince(
  client: PoolClient,
  context: PoultryContext,
  siteId: string,
) {
  const result = await client.query<{ province_id: string }>(
    "SELECT province_id FROM sites WHERE organization_id = $1 AND id = $2 AND is_active",
    [context.organizationId, siteId],
  );
  const provinceId = result.rows[0]?.province_id;
  if (!provinceId) throw new NotFoundError("Active farm site not found");
  return provinceId;
}

async function assertInventoryItem(
  client: PoolClient,
  context: PoultryContext,
  inventoryItemId: unknown,
) {
  if (inventoryItemId === undefined || inventoryItemId === null) return;
  if (typeof inventoryItemId !== "string")
    throw new BadRequestError("Invalid inventory item");
  const result = await client.query(
    "SELECT 1 FROM management_inventory_items WHERE organization_id = $1 AND id = $2",
    [context.organizationId, inventoryItemId],
  );
  if ((result.rowCount ?? 0) === 0)
    throw new BadRequestError("Choose an inventory item in this company");
}

async function expectedLiveBirdCount(
  client: PoolClient,
  context: PoultryContext,
  flockId: string,
): Promise<number> {
  const result = await client.query<{
    expected_live_bird_count: string | number;
  }>(
    `SELECT ${expectedLiveBirdsForFlock} AS expected_live_bird_count
       FROM poultry_flocks f
      WHERE f.organization_id = $1 AND f.id = $2`,
    [context.organizationId, flockId],
  );
  return Number(result.rows[0]?.expected_live_bird_count ?? 0);
}

async function assertActiveCompatibleHouse(
  client: PoolClient,
  context: PoultryContext,
  houseRow: Row,
  birdType: string,
  birdCount: number,
  capacityOverrideReason: unknown,
  excludeFlockId?: string,
) {
  if (
    !Boolean(houseRow.is_active) ||
    String(houseRow.operational_status) !== "active"
  )
    throw new BadRequestError(
      "An active house is required before a flock can be started or transferred",
    );
  const houseType = String(houseRow.house_type);
  if (
    houseType !== birdType &&
    !compatibleGeneralHouseTypes.includes(houseType)
  )
    throw new BadRequestError(
      "The flock type is not compatible with this house",
    );

  const activeFlock = await client.query(
    `SELECT id FROM poultry_flocks
      WHERE organization_id = $1 AND house_id = $2
        AND status = ANY($3::text[])
        AND ($4::uuid IS NULL OR id <> $4::uuid)
      LIMIT 1`,
    [
      context.organizationId,
      houseRow.id,
      operationalFlockStatuses,
      excludeFlockId ?? null,
    ],
  );
  if ((activeFlock.rowCount ?? 0) > 0)
    throw new ConflictError(
      "This house already has an active flock. Close or transfer that flock first.",
    );

  if (birdCount > Number(houseRow.capacity)) {
    if (
      typeof capacityOverrideReason !== "string" ||
      capacityOverrideReason.trim().length < 3
    )
      throw new ConflictError(
        "The starting bird count exceeds this house capacity. Provide an authorized override reason.",
      );
    if (!context.isOwner)
      throw new ForbiddenError(
        "Only the company owner can authorize a house-capacity override",
      );
  }
}

async function performanceModel(
  client: PoolClient,
  context: PoultryContext,
  modelId: string,
  requireActive: boolean,
) {
  const result = await client.query<{
    id: string;
    production_type: string;
    is_active: boolean;
  }>(
    `SELECT id, production_type, is_active
       FROM poultry_performance_models
      WHERE organization_id = $1 AND id = $2${requireActive ? " AND is_active = true" : ""}`,
    [context.organizationId, modelId],
  );
  const row = result.rows[0];
  if (!row)
    throw new BadRequestError(
      requireActive
        ? "Choose an active performance model in this company"
        : "Choose a performance model in this company",
    );
  return row;
}
function translateDatabaseError(error: unknown): never {
  const pg = error as { code?: string };
  if (pg.code === "23505")
    throw new ConflictError(
      "A Poultry record with that code or date already exists",
    );
  if (pg.code === "23503")
    throw new ConflictError(
      "This record is still used by another Poultry record and cannot be deleted",
    );
  if (pg.code === "23514")
    throw new BadRequestError("The Poultry values are not valid together");
  throw error;
}

function mortalityInput(input: Input, current?: Row): Input {
  const required =
    input.requiresFollowUp === undefined
      ? current
        ? Boolean(current.requires_follow_up)
        : false
      : Boolean(input.requiresFollowUp);
  const status =
    input.followUpStatus === undefined
      ? current
        ? String(current.follow_up_status)
        : undefined
      : String(input.followUpStatus);
  const followUpStatus = required ? (status ?? "pending") : "not_required";
  if (required && followUpStatus === "not_required") {
    throw new BadRequestError(
      "A mortality record needing follow-up must use pending, in_progress or resolved",
    );
  }
  return { ...input, requiresFollowUp: required, followUpStatus };
}

export async function createPoultryRecord(
  context: PoultryContext,
  resource: PoultryResource,
  input: Input,
) {
  return withTenantContext(context, async (client) => {
    try {
      if (resource === "houses") {
        const siteId = stringInput(input, "siteId");
        await assertProvince(
          client,
          context,
          await activeSiteProvince(client, context, siteId),
        );
        const operationalStatus =
          typeof input.operationalStatus === "string"
            ? input.operationalStatus
            : input.isActive === false
              ? "inactive"
              : "active";
        const result = await client.query<{ id: string }>(
          `INSERT INTO poultry_houses (
             organization_id, site_id, code, name, house_type, capacity,
             is_active, operational_status, description, length_m, width_m,
             floor_area_m2, ventilation_type, water_system, feeding_system,
             heating_system, notes, created_by_user_id, updated_by_user_id
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             $13, $14, $15, $16, $17, $18, $18
           ) RETURNING id`,
          [
            context.organizationId,
            siteId,
            stringInput(input, "code"),
            stringInput(input, "name"),
            stringInput(input, "houseType"),
            numberInput(input, "capacity"),
            operationalStatus === "active",
            operationalStatus,
            input.description ?? null,
            input.lengthM ?? null,
            input.widthM ?? null,
            input.floorAreaM2 ?? null,
            input.ventilationType ?? null,
            input.waterSystem ?? null,
            input.feedingSystem ?? null,
            input.heatingSystem ?? null,
            input.notes ?? null,
            context.userId,
          ],
        );
        return mapRow(await house(client, context, result.rows[0]!.id));
      }

      if (resource === "flocks") {
        const houseRow = await house(
          client,
          context,
          stringInput(input, "houseId"),
        );
        const birdType = stringInput(input, "birdType");
        let productionType =
          typeof input.productionType === "string"
            ? input.productionType
            : ["broiler", "layer", "breeder"].includes(birdType)
              ? birdType
              : null;
        const initialBirdCount = numberInput(input, "initialBirdCount");
        const capacityOverrideReason = input.capacityOverrideReason ?? null;
        await assertActiveCompatibleHouse(
          client,
          context,
          houseRow,
          birdType,
          initialBirdCount,
          capacityOverrideReason,
        );

        const performanceModelId = input.performanceModelId ?? null;
        if (performanceModelId) {
          if (typeof performanceModelId !== "string")
            throw new BadRequestError("Invalid performance model");
          const model = await performanceModel(
            client,
            context,
            performanceModelId,
            true,
          );
          if (productionType === null) productionType = model.production_type;
          if (productionType !== model.production_type)
            throw new BadRequestError(
              "The flock production type must match its performance model",
            );
        }
        if (!productionType)
          throw new BadRequestError("Choose a poultry production type");
        if (input.parentFlockId) {
          if (typeof input.parentFlockId !== "string")
            throw new BadRequestError("Invalid parent flock");
          await flock(client, context, input.parentFlockId);
        }

        const result = await client.query<{ id: string }>(
          `INSERT INTO poultry_flocks (
             organization_id, house_id, code, name, bird_type, breed,
             source_name, chick_source, sex, hatch_date, arrival_date,
             starting_age_days, initial_bird_count, purchase_cost_total,
             cost_per_bird, expected_production_end_date, parent_flock_id,
             production_type, performance_model_id, status,
             mortality_review_threshold, capacity_override_reason,
             capacity_override_authorized_by_user_id, notes, created_by_user_id,
             updated_by_user_id
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11::date,
             $12, $13, $14, $15, $16::date, $17, $18, $19, 'active',
             $20, $21, $22, $23, $24, $24
           ) RETURNING id`,
          [
            context.organizationId,
            houseRow.id,
            stringInput(input, "code"),
            stringInput(input, "name"),
            birdType,
            input.breed ?? null,
            input.sourceName ?? null,
            input.chickSource ?? null,
            input.sex ?? null,
            input.hatchDate ?? null,
            stringInput(input, "arrivalDate"),
            input.startingAgeDays ?? 0,
            initialBirdCount,
            input.purchaseCostTotal ?? null,
            input.costPerBird ?? null,
            input.expectedProductionEndDate ?? null,
            input.parentFlockId ?? null,
            productionType,
            performanceModelId,
            input.mortalityReviewThreshold ?? 5,
            capacityOverrideReason,
            capacityOverrideReason ? context.userId : null,
            input.notes ?? null,
            context.userId,
          ],
        );
        return mapRow(await flock(client, context, result.rows[0]!.id));
      }

      const config = records[resource];
      const parentId = stringInput(
        input,
        config.relation === "flock" ? "flockId" : "houseId",
      );
      const parent =
        config.relation === "flock"
          ? await flock(client, context, parentId)
          : await house(client, context, parentId);
      if (
        config.relation === "flock" &&
        !operationalFlockStatuses.includes(String(parent.status))
      )
        throw new BadRequestError(
          "Daily records can only be added to an active flock",
        );
      if (
        resource === "eggs" &&
        !["layer", "breeder"].includes(
          String(parent.production_type ?? parent.bird_type),
        )
      )
        throw new BadRequestError(
          "Egg collection is available only for layer or breeder flocks",
        );
      await assertInventoryItem(client, context, input.inventoryItemId);

      const prepared = resource === "mortality" ? mortalityInput(input) : input;
      const columns: string[] = [
        "organization_id",
        `${config.relation}_id`,
        ...Object.values(config.fields),
      ];
      const values: unknown[] = [context.organizationId, parentId];
      for (const name of Object.keys(config.fields))
        values.push(prepared[name] ?? null);
      if (config.tracksRecorder !== false) {
        columns.push("recorded_by_user_id");
        values.push(context.userId);
      }
      const result = await client.query<{ id: string }>(
        `INSERT INTO ${config.table} (${columns.join(", ")}) VALUES (${values.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING id`,
        values,
      );
      return mapRow(
        await record(client, context, resource, result.rows[0]!.id),
      );
    } catch (error) {
      translateDatabaseError(error);
    }
  });
}
async function updateColumns(
  client: PoolClient,
  table: string,
  context: PoultryContext,
  recordId: string,
  fields: Record<string, string>,
  input: Input,
  auditColumn?: string,
) {
  const values: unknown[] = [context.organizationId, recordId];
  const assignments: string[] = [];
  let hasChanges = false;
  for (const [name, column] of Object.entries(fields)) {
    if (input[name] === undefined) continue;
    hasChanges = true;
    values.push(input[name]);
    assignments.push(`${column} = $${values.length}`);
  }
  if (!hasChanges)
    throw new BadRequestError("Provide at least one value to change");
  if (auditColumn) {
    values.push(context.userId);
    assignments.push(`${auditColumn} = $${values.length}`);
  }
  await client.query(
    `UPDATE ${table} SET ${assignments.join(", ")} WHERE organization_id = $1 AND id = $2`,
    values,
  );
}
export async function updatePoultryRecord(
  context: PoultryContext,
  resource: PoultryResource,
  recordId: string,
  input: Input,
) {
  return withTenantContext(context, async (client) => {
    try {
      if (resource === "houses") {
        const current = await house(client, context, recordId);
        if (
          input.siteId !== undefined &&
          stringInput(input, "siteId") !== String(current.site_id)
        ) {
          const dependent = await client.query(
            "SELECT 1 FROM poultry_flocks WHERE organization_id = $1 AND house_id = $2 LIMIT 1",
            [context.organizationId, recordId],
          );
          if ((dependent.rowCount ?? 0) > 0)
            throw new BadRequestError(
              "A house with flock history cannot move to another farm",
            );
          await assertProvince(
            client,
            context,
            await activeSiteProvince(
              client,
              context,
              stringInput(input, "siteId"),
            ),
          );
        }

        const prepared: Input = { ...input };
        if (
          prepared.operationalStatus === undefined &&
          prepared.isActive !== undefined
        )
          prepared.operationalStatus =
            prepared.isActive === true ? "active" : "inactive";
        if (prepared.operationalStatus !== undefined)
          prepared.isActive = prepared.operationalStatus === "active";
        const targetStatus =
          prepared.operationalStatus === undefined
            ? String(current.operational_status)
            : stringInput(prepared, "operationalStatus");
        if (targetStatus !== "active") {
          const activeFlock = await client.query(
            "SELECT 1 FROM poultry_flocks WHERE organization_id = $1 AND house_id = $2 AND status = ANY($3::text[]) LIMIT 1",
            [context.organizationId, recordId, operationalFlockStatuses],
          );
          if ((activeFlock.rowCount ?? 0) > 0)
            throw new ConflictError(
              "Transfer or close the active flock before taking this house out of service",
            );
        }
        const targetHouseType =
          prepared.houseType === undefined
            ? String(current.house_type)
            : stringInput(prepared, "houseType");
        const activeFlock = await client.query<{
          id: string;
          bird_type: string;
        }>(
          "SELECT id, bird_type FROM poultry_flocks WHERE organization_id = $1 AND house_id = $2 AND status = ANY($3::text[]) LIMIT 1",
          [context.organizationId, recordId, operationalFlockStatuses],
        );
        if (
          activeFlock.rows[0] &&
          targetHouseType !== activeFlock.rows[0].bird_type &&
          !compatibleGeneralHouseTypes.includes(targetHouseType)
        )
          throw new ConflictError(
            "The new house type is incompatible with its active flock",
          );
        if (prepared.capacity !== undefined && activeFlock.rows[0]) {
          const currentLiveBirds = await expectedLiveBirdCount(
            client,
            context,
            activeFlock.rows[0].id,
          );
          if (numberInput(prepared, "capacity") < currentLiveBirds)
            throw new ConflictError(
              "House capacity cannot be lower than its active flock's calculated live bird count",
            );
        }
        await updateColumns(
          client,
          "poultry_houses",
          context,
          recordId,
          {
            siteId: "site_id",
            code: "code",
            name: "name",
            houseType: "house_type",
            capacity: "capacity",
            isActive: "is_active",
            operationalStatus: "operational_status",
            description: "description",
            lengthM: "length_m",
            widthM: "width_m",
            floorAreaM2: "floor_area_m2",
            ventilationType: "ventilation_type",
            waterSystem: "water_system",
            feedingSystem: "feeding_system",
            heatingSystem: "heating_system",
            notes: "notes",
          },
          prepared,
          "updated_by_user_id",
        );
        return mapRow(await house(client, context, recordId));
      }

      if (resource === "flocks") {
        const current = await flock(client, context, recordId);
        const prepared: Input = { ...input };
        const status =
          prepared.status === undefined
            ? String(current.status)
            : stringInput(prepared, "status");
        if (
          closableFlockStatuses.includes(String(current.status)) &&
          operationalFlockStatuses.includes(status)
        )
          throw new BadRequestError(
            "A closed or cancelled flock cannot be reopened. Start a new flock instead.",
          );
        const closedAt =
          prepared.closedAt === undefined
            ? current.closed_at
            : optionalInput(prepared, "closedAt");
        if (closableFlockStatuses.includes(status) && !closedAt)
          throw new BadRequestError(
            "A closed, sold, depleted or cancelled flock needs a closing date",
          );
        if (closableFlockStatuses.includes(status)) {
          prepared.closedAt = closedAt;
          prepared.closedByUserId = context.userId;
          prepared.finalLiveBirdCount ??= Number(current.current_bird_count);
          prepared.finalMortality ??= Number(current.total_mortality);
        }

        const birdType =
          prepared.birdType === undefined
            ? String(current.bird_type)
            : stringInput(prepared, "birdType");
        let productionType =
          prepared.productionType === undefined
            ? current.production_type
            : prepared.productionType;
        if (
          !productionType &&
          ["broiler", "layer", "breeder"].includes(birdType)
        )
          productionType = birdType;
        const performanceModelId =
          prepared.performanceModelId === undefined
            ? current.performance_model_id
            : prepared.performanceModelId;
        if (performanceModelId) {
          if (typeof performanceModelId !== "string")
            throw new BadRequestError("Invalid performance model");
          const model = await performanceModel(
            client,
            context,
            performanceModelId,
            prepared.performanceModelId !== undefined,
          );
          if (!productionType) productionType = model.production_type;
          if (String(productionType) !== model.production_type)
            throw new BadRequestError(
              "The flock production type must match its performance model",
            );
        }
        if (!productionType)
          throw new BadRequestError("Choose a poultry production type");
        prepared.productionType = productionType;

        const targetHouse =
          prepared.houseId === undefined
            ? current
            : await house(client, context, stringInput(prepared, "houseId"));
        if (operationalFlockStatuses.includes(status)) {
          const intendedBirdCount =
            prepared.initialBirdCount === undefined
              ? await expectedLiveBirdCount(client, context, recordId)
              : numberInput(prepared, "initialBirdCount");
          const overrideReason =
            prepared.capacityOverrideReason === undefined
              ? current.capacity_override_reason
              : prepared.capacityOverrideReason;
          await assertActiveCompatibleHouse(
            client,
            context,
            targetHouse,
            birdType,
            intendedBirdCount,
            overrideReason,
            recordId,
          );
          if (prepared.capacityOverrideReason !== undefined)
            prepared.capacityOverrideByUserId = prepared.capacityOverrideReason
              ? context.userId
              : null;
        }
        if (prepared.parentFlockId) {
          if (typeof prepared.parentFlockId !== "string")
            throw new BadRequestError("Invalid parent flock");
          if (prepared.parentFlockId === recordId)
            throw new BadRequestError("A flock cannot be its own parent batch");
          await flock(client, context, prepared.parentFlockId);
        }
        await updateColumns(
          client,
          "poultry_flocks",
          context,
          recordId,
          {
            houseId: "house_id",
            code: "code",
            name: "name",
            birdType: "bird_type",
            breed: "breed",
            sourceName: "source_name",
            chickSource: "chick_source",
            sex: "sex",
            hatchDate: "hatch_date",
            arrivalDate: "arrival_date",
            startingAgeDays: "starting_age_days",
            initialBirdCount: "initial_bird_count",
            purchaseCostTotal: "purchase_cost_total",
            costPerBird: "cost_per_bird",
            expectedProductionEndDate: "expected_production_end_date",
            parentFlockId: "parent_flock_id",
            status: "status",
            closedAt: "closed_at",
            closedByUserId: "closed_by_user_id",
            closingReason: "closing_reason",
            closingNotes: "closing_notes",
            birdsSold: "birds_sold",
            birdsTransferred: "birds_transferred",
            finalLiveBirdCount: "final_live_bird_count",
            finalMortality: "final_mortality",
            mortalityReviewThreshold: "mortality_review_threshold",
            productionType: "production_type",
            performanceModelId: "performance_model_id",
            capacityOverrideReason: "capacity_override_reason",
            capacityOverrideByUserId: "capacity_override_authorized_by_user_id",
            notes: "notes",
          },
          prepared,
          "updated_by_user_id",
        );
        return mapRow(await flock(client, context, recordId));
      }

      const current = await record(client, context, resource, recordId);
      if (
        resource === "eggs" &&
        !["layer", "breeder"].includes(
          String(current.flock_production_type ?? current.flock_bird_type),
        )
      )
        throw new BadRequestError(
          "Egg collection is available only for layer or breeder flocks",
        );
      await assertInventoryItem(client, context, input.inventoryItemId);
      await updateColumns(
        client,
        records[resource].table,
        context,
        recordId,
        records[resource].fields,
        resource === "mortality" ? mortalityInput(input, current) : input,
      );
      return mapRow(await record(client, context, resource, recordId));
    } catch (error) {
      translateDatabaseError(error);
    }
  });
}
export async function deletePoultryRecord(
  context: PoultryContext,
  resource: PoultryResource,
  recordId: string,
) {
  return withTenantContext(context, async (client) => {
    try {
      if (resource === "houses") {
        await house(client, context, recordId);
        await client.query(
          "DELETE FROM poultry_houses WHERE organization_id = $1 AND id = $2",
          [context.organizationId, recordId],
        );
        return;
      }
      if (resource === "flocks") {
        await flock(client, context, recordId);
        throw new BadRequestError(
          "Flock history cannot be deleted. Close or cancel the flock instead.",
        );
      }
      await record(client, context, resource, recordId);
      await client.query(
        `DELETE FROM ${records[resource].table} WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, recordId],
      );
    } catch (error) {
      translateDatabaseError(error);
    }
  });
}

export async function poultryOverview(
  context: PoultryContext,
  input: PoultryOverviewQuery,
) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context);
    const values: unknown[] = [context.organizationId];
    const conditions = [
      "f.organization_id = $1",
      addScope(scope, context, "s.province_id", values),
    ];
    if (input.siteId) {
      values.push(input.siteId);
      conditions.push(`h.site_id = $${values.length}`);
    }
    if (input.provinceId) {
      values.push(input.provinceId);
      conditions.push(`s.province_id = $${values.length}`);
    }
    if (input.productionType) {
      values.push(input.productionType);
      conditions.push(
        `COALESCE(f.production_type, f.bird_type) = $${values.length}`,
      );
    }
    const reviewValues = [...values];
    values.push(input.from ?? null, input.to ?? null);
    const from = values.length - 1;
    const to = values.length;
    const result = await client.query<Row>(
      `WITH eligible AS (
         SELECT f.id, f.status, f.initial_bird_count FROM poultry_flocks f
         JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id
         JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
         WHERE ${conditions.join(" AND ")}
       ), mortality AS (
         SELECT m.flock_id, SUM(m.death_count) AS mortality_count FROM poultry_mortality_records m
         JOIN eligible e ON e.id = m.flock_id
         WHERE ($${from}::date IS NULL OR m.mortality_date >= $${from}::date)
           AND ($${to}::date IS NULL OR m.mortality_date <= $${to}::date) GROUP BY m.flock_id
       ), eggs AS (
         SELECT r.flock_id, SUM(r.total_eggs) AS total_eggs FROM poultry_egg_records r
         JOIN eligible e ON e.id = r.flock_id
         WHERE ($${from}::date IS NULL OR r.record_date >= $${from}::date)
           AND ($${to}::date IS NULL OR r.record_date <= $${to}::date) GROUP BY r.flock_id
       ), feed AS (
         SELECT r.flock_id, SUM(r.quantity_kg) AS feed_kg FROM poultry_feed_records r
         JOIN eligible e ON e.id = r.flock_id
         WHERE ($${from}::date IS NULL OR r.feed_date >= $${from}::date)
           AND ($${to}::date IS NULL OR r.feed_date <= $${to}::date) GROUP BY r.flock_id
       ), water AS (
         SELECT r.flock_id, SUM(r.volume_liters) AS water_liters FROM poultry_water_records r
         JOIN eligible e ON e.id = r.flock_id
         WHERE ($${from}::date IS NULL OR r.water_date >= $${from}::date)
           AND ($${to}::date IS NULL OR r.water_date <= $${to}::date) GROUP BY r.flock_id
       )
       SELECT COUNT(*) AS all_flocks,
              COUNT(*) FILTER (WHERE e.status IN ('active', 'quarantined', 'ready_for_sale')) AS active_flocks,
              COALESCE(SUM(e.initial_bird_count), 0) AS initial_birds,
              COALESCE(SUM(m.mortality_count), 0) AS mortality_count,
              COALESCE(SUM(eggs.total_eggs), 0) AS total_eggs,
              COALESCE(SUM(feed.feed_kg), 0) AS feed_kg,
              COALESCE(SUM(water.water_liters), 0) AS water_liters
         FROM eligible e
         LEFT JOIN mortality m ON m.flock_id = e.id
         LEFT JOIN eggs ON eggs.flock_id = e.id
         LEFT JOIN feed ON feed.flock_id = e.id
         LEFT JOIN water ON water.flock_id = e.id`,
      values,
    );
    const summary = result.rows[0]!;
    const review = await client.query<Row>(
      `SELECT f.id, f.code, f.name, f.initial_bird_count, f.mortality_review_threshold,
              h.id AS house_id, h.code AS house_code, h.name AS house_name, ${locationFields},
              COALESCE(SUM(m.death_count), 0) AS daily_mortality_count
         FROM poultry_flocks f
         JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id
         JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
         JOIN provinces p ON p.organization_id = s.organization_id AND p.id = s.province_id
         LEFT JOIN poultry_mortality_records m ON m.organization_id = f.organization_id AND m.flock_id = f.id AND m.mortality_date = CURRENT_DATE
        WHERE ${conditions.join(" AND ")}
        GROUP BY f.id, f.code, f.name, f.initial_bird_count, f.mortality_review_threshold, h.id, h.code, h.name, s.id, s.code, s.name, p.id, p.code, p.name
       HAVING COALESCE(SUM(m.death_count), 0) >= f.mortality_review_threshold
        ORDER BY daily_mortality_count DESC, f.name`,
      reviewValues,
    );
    const initialBirds = Number(summary.initial_birds);
    const mortalityCount = Number(summary.mortality_count);
    return {
      period: { from: input.from ?? null, to: input.to ?? null },
      totals: {
        allFlocks: Number(summary.all_flocks),
        activeFlocks: Number(summary.active_flocks),
        initialBirds,
        mortalityCount,
        mortalityRatePercent:
          initialBirds === 0
            ? 0
            : Number(((mortalityCount / initialBirds) * 100).toFixed(3)),
        totalEggs: Number(summary.total_eggs),
        feedKg: Number(summary.feed_kg),
        waterLiters: Number(summary.water_liters),
      },
      mortalityReview: review.rows.map((row) => ({
        flock: { id: row.id, code: row.code, name: row.name },
        house: { id: row.house_id, code: row.house_code, name: row.house_name },
        province: {
          id: row.province_id,
          code: row.province_code,
          name: row.province_name,
        },
        site: { id: row.site_id, code: row.site_code, name: row.site_name },
        dailyMortalityCount: Number(row.daily_mortality_count),
        mortalityReviewThreshold: Number(row.mortality_review_threshold),
      })),
    };
  });
}
