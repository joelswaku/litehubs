import type { PoolClient } from "pg";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type {
  AgricultureListQuery,
  AgricultureOverviewQuery,
  AgricultureResource,
} from "./agriculture.validation";

export interface AgricultureContext {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
}

type Scope = "organization" | "province" | "self";
type Row = Record<string, unknown>;
type Input = Record<string, unknown>;

interface ResourceConfig {
  table: string;
  from: string;
  location: string;
  provinceColumn?: string;
  dateColumn?: string;
  statusColumn?: string;
  filters: Partial<
    Record<
      | "siteId"
      | "farmId"
      | "fieldId"
      | "plotId"
      | "cropId"
      | "seasonId"
      | "plantingId",
      string
    >
  >;
  recorded?: boolean;
}

const snake = (name: string) =>
  name.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase());
const camel = (name: string) =>
  name.replace(/_([a-z0-9])/g, (_, character: string) =>
    character.toUpperCase(),
  );

const siteLocation =
  "s.id AS site_id, s.code AS site_code, s.name AS site_name, " +
  "pr.id AS province_id, pr.code AS province_code, pr.name AS province_name";
const farmLocation =
  "f.id AS farm_id, f.code AS farm_code, f.name AS farm_name, " +
  "f.farm_type AS farm_type, " +
  siteLocation;
const fieldLocation =
  "fi.id AS field_id, fi.code AS field_code, fi.name AS field_name, " +
  "fi.area_ha AS field_area_ha, " +
  farmLocation;
const plotLocation =
  "pl.id AS plot_id, pl.code AS plot_code, pl.name AS plot_name, " +
  "pl.area_ha AS plot_area_ha, " +
  fieldLocation;
const plantingLocation =
  "ap.id AS planting_id, ap.code AS planting_code, ap.name AS planting_name, " +
  "ap.status AS planting_status, " +
  "c.id AS crop_id, c.code AS crop_code, c.name AS crop_name, " +
  "se.id AS season_id, se.code AS season_code, se.name AS season_name, " +
  plotLocation;

const fieldEventFrom = (table: string) =>
  table +
  " r JOIN agriculture_fields fi ON fi.organization_id = r.organization_id AND fi.id = r.field_id " +
  "JOIN agriculture_farms f ON f.organization_id = fi.organization_id AND f.id = fi.farm_id " +
  "JOIN sites s ON s.organization_id = f.organization_id AND s.id = f.site_id " +
  "JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id " +
  "LEFT JOIN agriculture_plots pl ON pl.organization_id = r.organization_id AND pl.id = r.plot_id " +
  "LEFT JOIN agriculture_plantings ap ON ap.organization_id = r.organization_id AND ap.id = r.planting_id " +
  "LEFT JOIN agriculture_crops c ON c.organization_id = ap.organization_id AND c.id = ap.crop_id " +
  "LEFT JOIN agriculture_seasons se ON se.organization_id = ap.organization_id AND se.id = ap.season_id";

const plantingEventFrom = (table: string) =>
  table +
  " r JOIN agriculture_plantings ap ON ap.organization_id = r.organization_id AND ap.id = r.planting_id " +
  "JOIN agriculture_plots pl ON pl.organization_id = ap.organization_id AND pl.id = ap.plot_id " +
  "JOIN agriculture_fields fi ON fi.organization_id = pl.organization_id AND fi.id = pl.field_id " +
  "JOIN agriculture_farms f ON f.organization_id = fi.organization_id AND f.id = fi.farm_id " +
  "JOIN sites s ON s.organization_id = f.organization_id AND s.id = f.site_id " +
  "JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id " +
  "JOIN agriculture_crops c ON c.organization_id = ap.organization_id AND c.id = ap.crop_id " +
  "LEFT JOIN agriculture_seasons se ON se.organization_id = ap.organization_id AND se.id = ap.season_id";

const fieldFilters = {
  siteId: "f.site_id",
  farmId: "fi.farm_id",
  fieldId: "r.field_id",
  plotId: "r.plot_id",
  plantingId: "r.planting_id",
};
const plantingFilters = {
  siteId: "f.site_id",
  farmId: "fi.farm_id",
  fieldId: "pl.field_id",
  plotId: "ap.plot_id",
  cropId: "ap.crop_id",
  seasonId: "ap.season_id",
  plantingId: "r.planting_id",
};

const resources: Record<AgricultureResource, ResourceConfig> = {
  farms: {
    table: "agriculture_farms",
    from:
      "agriculture_farms r JOIN sites s ON s.organization_id = r.organization_id AND s.id = r.site_id " +
      "JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id",
    location: siteLocation,
    provinceColumn: "pr.id",
    statusColumn: "r.is_active",
    filters: { siteId: "r.site_id", farmId: "r.id" },
  },
  fields: {
    table: "agriculture_fields",
    from:
      "agriculture_fields r JOIN agriculture_farms f ON f.organization_id = r.organization_id AND f.id = r.farm_id " +
      "JOIN sites s ON s.organization_id = f.organization_id AND s.id = f.site_id " +
      "JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id",
    location: farmLocation,
    provinceColumn: "pr.id",
    statusColumn: "r.is_active",
    filters: { siteId: "f.site_id", farmId: "r.farm_id", fieldId: "r.id" },
  },
  plots: {
    table: "agriculture_plots",
    from:
      "agriculture_plots r JOIN agriculture_fields fi ON fi.organization_id = r.organization_id AND fi.id = r.field_id " +
      "JOIN agriculture_farms f ON f.organization_id = fi.organization_id AND f.id = fi.farm_id " +
      "JOIN sites s ON s.organization_id = f.organization_id AND s.id = f.site_id " +
      "JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id",
    location: fieldLocation,
    provinceColumn: "pr.id",
    statusColumn: "r.status",
    filters: {
      siteId: "f.site_id",
      farmId: "fi.farm_id",
      fieldId: "r.field_id",
      plotId: "r.id",
    },
  },
  crops: {
    table: "agriculture_crops",
    from: "agriculture_crops r",
    location: "",
    statusColumn: "r.is_active",
    filters: { cropId: "r.id" },
  },
  seasons: {
    table: "agriculture_seasons",
    from:
      "agriculture_seasons r JOIN agriculture_farms f ON f.organization_id = r.organization_id AND f.id = r.farm_id " +
      "JOIN sites s ON s.organization_id = f.organization_id AND s.id = f.site_id " +
      "JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id",
    location: farmLocation,
    provinceColumn: "pr.id",
    statusColumn: "r.is_active",
    filters: { siteId: "f.site_id", farmId: "r.farm_id", seasonId: "r.id" },
  },
  plantings: {
    table: "agriculture_plantings",
    from:
      "agriculture_plantings r JOIN agriculture_plots pl ON pl.organization_id = r.organization_id AND pl.id = r.plot_id " +
      "JOIN agriculture_fields fi ON fi.organization_id = pl.organization_id AND fi.id = pl.field_id " +
      "JOIN agriculture_farms f ON f.organization_id = fi.organization_id AND f.id = fi.farm_id " +
      "JOIN sites s ON s.organization_id = f.organization_id AND s.id = f.site_id " +
      "JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id " +
      "JOIN agriculture_crops c ON c.organization_id = r.organization_id AND c.id = r.crop_id " +
      "LEFT JOIN agriculture_seasons se ON se.organization_id = r.organization_id AND se.id = r.season_id",
    location:
      "c.id AS crop_id, c.code AS crop_code, c.name AS crop_name, " +
      "se.id AS season_id, se.code AS season_code, se.name AS season_name, " +
      plotLocation,
    provinceColumn: "pr.id",
    dateColumn: "r.planting_date",
    statusColumn: "r.status",
    filters: {
      siteId: "f.site_id",
      farmId: "fi.farm_id",
      fieldId: "pl.field_id",
      plotId: "r.plot_id",
      cropId: "r.crop_id",
      seasonId: "r.season_id",
      plantingId: "r.id",
    },
  },
  operations: {
    table: "agriculture_operations",
    from: fieldEventFrom("agriculture_operations"),
    location: plantingLocation,
    provinceColumn: "pr.id",
    dateColumn: "r.operation_date",
    statusColumn: "r.status",
    filters: fieldFilters,
    recorded: true,
  },
  irrigation: {
    table: "agriculture_irrigation_records",
    from: fieldEventFrom("agriculture_irrigation_records"),
    location: plantingLocation,
    provinceColumn: "pr.id",
    dateColumn: "r.irrigation_date",
    filters: fieldFilters,
    recorded: true,
  },
  fertilizer: {
    table: "agriculture_fertilizer_records",
    from: fieldEventFrom("agriculture_fertilizer_records"),
    location: plantingLocation,
    provinceColumn: "pr.id",
    dateColumn: "r.application_date",
    filters: fieldFilters,
    recorded: true,
  },
  pesticides: {
    table: "agriculture_pesticide_records",
    from: fieldEventFrom("agriculture_pesticide_records"),
    location: plantingLocation,
    provinceColumn: "pr.id",
    dateColumn: "r.application_date",
    filters: fieldFilters,
    recorded: true,
  },
  scouting: {
    table: "agriculture_scouting_records",
    from: fieldEventFrom("agriculture_scouting_records"),
    location: plantingLocation,
    provinceColumn: "pr.id",
    dateColumn: "r.scouting_date",
    statusColumn: "r.status",
    filters: fieldFilters,
    recorded: true,
  },
  weather: {
    table: "agriculture_weather_records",
    from:
      "agriculture_weather_records r JOIN agriculture_farms f ON f.organization_id = r.organization_id AND f.id = r.farm_id " +
      "JOIN sites s ON s.organization_id = f.organization_id AND s.id = f.site_id " +
      "JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id",
    location: farmLocation,
    provinceColumn: "pr.id",
    dateColumn: "r.observation_date",
    filters: { siteId: "f.site_id", farmId: "r.farm_id" },
    recorded: true,
  },
  harvest: {
    table: "agriculture_harvest_records",
    from: plantingEventFrom("agriculture_harvest_records"),
    location: plantingLocation,
    provinceColumn: "pr.id",
    dateColumn: "r.harvest_date",
    filters: plantingFilters,
    recorded: true,
  },
  "production-targets": {
    table: "agriculture_production_targets",
    from: plantingEventFrom("agriculture_production_targets"),
    location: plantingLocation,
    provinceColumn: "pr.id",
    dateColumn: "r.target_harvest_date",
    filters: plantingFilters,
  },
  losses: {
    table: "agriculture_loss_records",
    from: fieldEventFrom("agriculture_loss_records"),
    location: plantingLocation,
    provinceColumn: "pr.id",
    dateColumn: "r.loss_date",
    filters: fieldFilters,
    recorded: true,
  },
};

function mapRow(row: Row): Row {
  const mapped: Row = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [camel(key), value]),
  );
  const numeric = [
    "totalAreaHa",
    "areaHa",
    "fieldAreaHa",
    "plotAreaHa",
    "defaultGrowingDays",
    "plantedAreaHa",
    "seedQuantity",
    "plantDensity",
    "quantity",
    "labourHours",
    "volumeLiters",
    "durationMinutes",
    "quantityKg",
    "preHarvestIntervalDays",
    "affectedAreaHa",
    "rainfallMm",
    "minTemperatureC",
    "maxTemperatureC",
    "humidityPercent",
    "windSpeedKph",
    "targetYield",
    "rejectedQuantity",
    "moisturePercent",
    "estimatedValue",
    "farms",
    "fields",
    "activePlantings",
    "harvestQuantityLast30Days",
    "lossQuantityLast30Days",
  ];
  for (const field of numeric)
    if (mapped[field] != null) mapped[field] = Number(mapped[field]);
  const dates = [
    "startDate",
    "endDate",
    "plantingDate",
    "expectedHarvestDate",
    "actualHarvestDate",
    "operationDate",
    "irrigationDate",
    "applicationDate",
    "scoutingDate",
    "observationDate",
    "harvestDate",
    "targetHarvestDate",
    "lossDate",
  ];
  for (const field of dates)
    if (mapped[field] instanceof Date)
      mapped[field] = (mapped[field] as Date).toISOString().slice(0, 10);
  if (mapped.provinceId)
    mapped.province = {
      id: mapped.provinceId,
      code: mapped.provinceCode,
      name: mapped.provinceName,
    };
  if (mapped.siteId)
    mapped.site = {
      id: mapped.siteId,
      code: mapped.siteCode,
      name: mapped.siteName,
    };
  if (mapped.farmId)
    mapped.farm = {
      id: mapped.farmId,
      code: mapped.farmCode,
      name: mapped.farmName,
      type: mapped.farmType,
    };
  if (mapped.fieldId)
    mapped.field = {
      id: mapped.fieldId,
      code: mapped.fieldCode,
      name: mapped.fieldName,
      areaHa: mapped.fieldAreaHa,
    };
  if (mapped.plotId)
    mapped.plot = {
      id: mapped.plotId,
      code: mapped.plotCode,
      name: mapped.plotName,
      areaHa: mapped.plotAreaHa,
    };
  if (mapped.cropId)
    mapped.crop = {
      id: mapped.cropId,
      code: mapped.cropCode,
      name: mapped.cropName,
    };
  if (mapped.seasonId)
    mapped.season = {
      id: mapped.seasonId,
      code: mapped.seasonCode,
      name: mapped.seasonName,
    };
  if (mapped.plantingId)
    mapped.planting = {
      id: mapped.plantingId,
      code: mapped.plantingCode,
      name: mapped.plantingName,
      status: mapped.plantingStatus,
    };
  return mapped;
}

async function scopeOf(
  client: PoolClient,
  context: AgricultureContext,
): Promise<Scope> {
  if (context.isOwner) return "organization";
  const result = await client.query<{
    organization_scope: boolean;
    province_scope: boolean;
  }>(
    "SELECT EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id = mr.organization_id AND r.id = mr.role_id WHERE mr.organization_id = $1 AND mr.member_id = $2 AND r.data_scope = 'organization') AS organization_scope, EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id = mr.organization_id AND r.id = mr.role_id WHERE mr.organization_id = $1 AND mr.member_id = $2 AND r.data_scope = 'province') AS province_scope",
    [context.organizationId, context.memberId],
  );
  return result.rows[0]?.organization_scope
    ? "organization"
    : result.rows[0]?.province_scope
      ? "province"
      : "self";
}

function scopeSql(
  scope: Scope,
  context: AgricultureContext,
  provinceColumn: string | undefined,
  values: unknown[],
): string {
  if (scope === "self") return "FALSE";
  if (scope === "organization" || !provinceColumn) return "TRUE";
  values.push(context.memberId);
  return (
    "EXISTS (SELECT 1 FROM member_provinces mp WHERE mp.organization_id = $1 AND mp.member_id = $" +
    values.length +
    " AND mp.province_id = " +
    provinceColumn +
    ")"
  );
}

async function assertProvince(
  client: PoolClient,
  context: AgricultureContext,
  provinceId: string,
): Promise<void> {
  if ((await scopeOf(client, context)) === "organization") return;
  const allowed = await client.query(
    "SELECT 1 FROM member_provinces WHERE organization_id = $1 AND member_id = $2 AND province_id = $3",
    [context.organizationId, context.memberId, provinceId],
  );
  if (!allowed.rowCount)
    throw new NotFoundError("Agriculture record not found");
}

function configFor(resource: AgricultureResource): ResourceConfig {
  return resources[resource];
}

async function rawRecord(
  client: PoolClient,
  context: AgricultureContext,
  resource: AgricultureResource,
  recordId: string,
): Promise<Row> {
  const config = configFor(resource);
  const location = config.location ? ", " + config.location : "";
  const result = await client.query<Row>(
    "SELECT r.*" +
      location +
      " FROM " +
      config.from +
      " WHERE r.organization_id = $1 AND r.id = $2",
    [context.organizationId, recordId],
  );
  const row = result.rows[0];
  if (!row || (await scopeOf(client, context)) === "self")
    throw new NotFoundError("Agriculture record not found");
  if (config.provinceColumn)
    await assertProvince(client, context, String(row.province_id));
  return row;
}

function value(input: Input, key: string): string | null | undefined {
  const item = input[key];
  return typeof item === "string" || item === null ? item : undefined;
}

function generatedFarmCode(name: unknown): string {
  const normalized = String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const started = normalized && /^[a-z]/.test(normalized)
    ? normalized
    : `farm_${normalized || "record"}`;
  return (started.replace(/_+/g, "_").slice(0, 63).replace(/_+$/g, "") || "farm_record");
}

async function nextFarmCode(
  client: PoolClient,
  organizationId: string,
  name: unknown,
): Promise<string> {
  const base = generatedFarmCode(name);
  for (let attempt = 1; attempt <= 999; attempt += 1) {
    const suffix = attempt === 1 ? "" : `_${attempt}`;
    const candidate = `${base.slice(0, 63 - suffix.length)}${suffix}`;
    const existing = await client.query(
      "SELECT 1 FROM agriculture_farms WHERE organization_id = $1 AND code = $2 LIMIT 1",
      [organizationId, candidate],
    );
    if (!existing.rowCount) return candidate;
  }
  throw new ConflictError("Could not generate a unique farm code");
}

async function siteProvince(
  client: PoolClient,
  context: AgricultureContext,
  siteId: string,
): Promise<void> {
  const result = await client.query<{ province_id: string }>(
    "SELECT province_id FROM sites WHERE organization_id = $1 AND id = $2",
    [context.organizationId, siteId],
  );
  const provinceId = result.rows[0]?.province_id;
  if (!provinceId) throw new BadRequestError("Choose a site in this company");
  await assertProvince(client, context, provinceId);
}

async function assertRelations(
  client: PoolClient,
  context: AgricultureContext,
  resource: AgricultureResource,
  input: Input,
): Promise<void> {
  if (resource === "crops") {
    if ((await scopeOf(client, context)) === "self")
      throw new NotFoundError("Agriculture record not found");
    return;
  }
  if (resource === "farms") {
    const siteId = value(input, "siteId");
    if (!siteId) throw new BadRequestError("Choose a site");
    await siteProvince(client, context, siteId);
    return;
  }
  if (
    resource === "fields" ||
    resource === "seasons" ||
    resource === "weather"
  ) {
    const farmId = value(input, "farmId");
    if (!farmId) throw new BadRequestError("Choose a farm");
    await rawRecord(client, context, "farms", farmId);
    return;
  }
  if (resource === "plots") {
    const fieldId = value(input, "fieldId");
    if (!fieldId) throw new BadRequestError("Choose a field");
    await rawRecord(client, context, "fields", fieldId);
    return;
  }
  if (resource === "plantings") {
    const plotId = value(input, "plotId");
    const cropId = value(input, "cropId");
    if (!plotId || !cropId)
      throw new BadRequestError("Choose both a plot and crop");
    const plot = await rawRecord(client, context, "plots", plotId);
    await rawRecord(client, context, "crops", cropId);
    const seasonId = value(input, "seasonId");
    if (seasonId) {
      const season = await rawRecord(client, context, "seasons", seasonId);
      if (String(season.farm_id) !== String(plot.farm_id))
        throw new BadRequestError("The season must belong to the plot's farm");
    }
    return;
  }
  if (resource === "harvest" || resource === "production-targets") {
    const plantingId = value(input, "plantingId");
    if (!plantingId) throw new BadRequestError("Choose a planting");
    await rawRecord(client, context, "plantings", plantingId);
    return;
  }
  const fieldId = value(input, "fieldId");
  if (!fieldId) throw new BadRequestError("Choose a field");
  await rawRecord(client, context, "fields", fieldId);
  const plotId = value(input, "plotId");
  if (plotId) {
    const plot = await rawRecord(client, context, "plots", plotId);
    if (String(plot.field_id) !== fieldId)
      throw new BadRequestError("The plot must belong to the selected field");
  }
  const plantingId = value(input, "plantingId");
  if (plantingId) {
    const planting = await rawRecord(client, context, "plantings", plantingId);
    if (String(planting.field_id) !== fieldId)
      throw new BadRequestError(
        "The planting must belong to the selected field",
      );
    if (plotId && String(planting.plot_id) !== plotId)
      throw new BadRequestError(
        "The planting must belong to the selected plot",
      );
  }
}

function inputColumns(input: Input): { columns: string[]; values: unknown[] } {
  const entries = Object.entries(input).filter(
    ([, item]) => item !== undefined,
  );
  return {
    columns: entries.map(([key]) => snake(key)),
    values: entries.map(([, item]) => item),
  };
}

function filterSql(
  config: ResourceConfig,
  query: AgricultureListQuery,
  values: unknown[],
): string[] {
  const conditions: string[] = [];
  const keys = [
    "siteId",
    "farmId",
    "fieldId",
    "plotId",
    "cropId",
    "seasonId",
    "plantingId",
  ] as const;
  for (const key of keys) {
    const filter = query[key];
    if (!filter) continue;
    const column = config.filters[key];
    if (!column)
      throw new BadRequestError(
        "This record type cannot be filtered by " + key,
      );
    values.push(filter);
    conditions.push(column + " = $" + values.length);
  }
  if (query.status) {
    if (!config.statusColumn)
      throw new BadRequestError("This record type does not have a status");
    values.push(query.status);
    conditions.push(config.statusColumn + "::text = $" + values.length);
  }
  if (query.fromDate) {
    if (!config.dateColumn)
      throw new BadRequestError("This record type does not have a date");
    values.push(query.fromDate);
    conditions.push(config.dateColumn + " >= $" + values.length);
  }
  if (query.toDate) {
    if (!config.dateColumn)
      throw new BadRequestError("This record type does not have a date");
    values.push(query.toDate);
    conditions.push(config.dateColumn + " <= $" + values.length);
  }
  return conditions;
}

export async function listAgricultureRecords(
  context: AgricultureContext,
  resource: AgricultureResource,
  query: AgricultureListQuery,
): Promise<Row[]> {
  const config = configFor(resource);
  return withTenantContext(context, async (client) => {
    const values: unknown[] = [context.organizationId];
    const scope = scopeSql(
      await scopeOf(client, context),
      context,
      config.provinceColumn,
      values,
    );
    const conditions = [
      "r.organization_id = $1",
      scope,
      ...filterSql(config, query, values),
    ];
    values.push(query.limit);
    const location = config.location ? ", " + config.location : "";
    const result = await client.query<Row>(
      "SELECT r.*" +
        location +
        " FROM " +
        config.from +
        " WHERE " +
        conditions.join(" AND ") +
        " ORDER BY " +
        (config.dateColumn ?? "r.created_at") +
        " DESC, r.created_at DESC LIMIT $" +
        values.length,
      values,
    );
    return result.rows.map(mapRow);
  });
}

export async function getAgricultureRecord(
  context: AgricultureContext,
  resource: AgricultureResource,
  recordId: string,
): Promise<Row> {
  return withTenantContext(context, async (client) =>
    mapRow(await rawRecord(client, context, resource, recordId)),
  );
}

async function applyEffects(
  client: PoolClient,
  context: AgricultureContext,
  resource: AgricultureResource,
  input: Input,
): Promise<void> {
  if (resource === "plantings") {
    const plotId = value(input, "plotId");
    if (plotId && (input.status === "planted" || input.status === "growing"))
      await client.query(
        "UPDATE agriculture_plots SET status = 'planted' WHERE organization_id = $1 AND id = $2",
        [context.organizationId, plotId],
      );
  }
  if (resource === "harvest") {
    const plantingId = value(input, "plantingId");
    const harvestDate = value(input, "harvestDate");
    if (plantingId && harvestDate)
      await client.query(
        "UPDATE agriculture_plantings SET status = 'harvested', actual_harvest_date = COALESCE(actual_harvest_date, $3) WHERE organization_id = $1 AND id = $2",
        [context.organizationId, plantingId, harvestDate],
      );
  }
}

export async function createAgricultureRecord(
  context: AgricultureContext,
  resource: AgricultureResource,
  input: Input,
): Promise<Row> {
  const config = configFor(resource);
  return withTenantContext(context, async (client) => {
    const preparedInput: Input =
      resource === "farms" && !value(input, "code")
        ? {
            ...input,
            code: await nextFarmCode(client, context.organizationId, input.name),
          }
        : input;
    await assertRelations(client, context, resource, preparedInput);
    const prepared = inputColumns(preparedInput);
    const columns = ["organization_id", ...prepared.columns];
    const values: unknown[] = [context.organizationId, ...prepared.values];
    if (config.recorded) {
      columns.push("recorded_by_user_id");
      values.push(context.userId);
    }
    let created;
    try {
      created = await client.query<{ id: string }>(
        "INSERT INTO " +
          config.table +
          " (" +
          columns.join(", ") +
          ") VALUES (" +
          values.map((_, index) => "$" + (index + 1)).join(", ") +
          ") RETURNING id",
        values,
      );
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "23505")
        throw new ConflictError(
          "An Agriculture record with that value already exists",
        );
      throw error;
    }
    const recordId = created.rows[0]?.id;
    if (!recordId)
      throw new BadRequestError("Could not create Agriculture record");
    await applyEffects(client, context, resource, preparedInput);
    return mapRow(await rawRecord(client, context, resource, recordId));
  });
}

export async function updateAgricultureRecord(
  context: AgricultureContext,
  resource: AgricultureResource,
  recordId: string,
  input: Input,
): Promise<Row> {
  const config = configFor(resource);
  return withTenantContext(context, async (client) => {
    const current = await rawRecord(client, context, resource, recordId);
    const merged: Input = {
      ...Object.fromEntries(
        Object.entries(current).map(([key, item]) => [camel(key), item]),
      ),
      ...input,
    };
    await assertRelations(client, context, resource, merged);
    const prepared = inputColumns(input);
    const values: unknown[] = [
      context.organizationId,
      recordId,
      ...prepared.values,
    ];
    const changes = prepared.columns.map(
      (column, index) => column + " = $" + (index + 3),
    );
    const result = await client.query(
      "UPDATE " +
        config.table +
        " SET " +
        changes.join(", ") +
        " WHERE organization_id = $1 AND id = $2",
      values,
    );
    if (!result.rowCount)
      throw new NotFoundError("Agriculture record not found");
    await applyEffects(client, context, resource, merged);
    return mapRow(await rawRecord(client, context, resource, recordId));
  });
}

export async function deleteAgricultureRecord(
  context: AgricultureContext,
  resource: AgricultureResource,
  recordId: string,
): Promise<void> {
  const config = configFor(resource);
  await withTenantContext(context, async (client) => {
    await rawRecord(client, context, resource, recordId);
    const result = await client.query(
      "DELETE FROM " + config.table + " WHERE organization_id = $1 AND id = $2",
      [context.organizationId, recordId],
    );
    if (!result.rowCount)
      throw new NotFoundError("Agriculture record not found");
  });
}

export async function agricultureOverview(
  context: AgricultureContext,
  query: AgricultureOverviewQuery,
): Promise<Row> {
  const [farms, fields, plantings, harvests, losses] = await Promise.all([
    listAgricultureRecords(context, "farms", {
      siteId: query.siteId,
      limit: 200,
    }),
    listAgricultureRecords(context, "fields", {
      siteId: query.siteId,
      limit: 200,
    }),
    listAgricultureRecords(context, "plantings", {
      siteId: query.siteId,
      limit: 200,
    }),
    listAgricultureRecords(context, "harvest", {
      siteId: query.siteId,
      limit: 200,
    }),
    listAgricultureRecords(context, "losses", {
      siteId: query.siteId,
      limit: 200,
    }),
  ]);
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceText = since.toISOString().slice(0, 10);
  const quantitySince = (records: Row[], dateKey: string) =>
    records
      .filter((record) => String(record[dateKey] ?? "") >= sinceText)
      .reduce((total, record) => total + Number(record.quantity ?? 0), 0);
  return {
    farms: farms.length,
    fields: fields.length,
    activePlantings: plantings.filter((item) =>
      ["planned", "planted", "growing"].includes(String(item.status)),
    ).length,
    harvestQuantityLast30Days: quantitySince(harvests, "harvestDate"),
    lossQuantityLast30Days: quantitySince(losses, "lossDate"),
  };
}
