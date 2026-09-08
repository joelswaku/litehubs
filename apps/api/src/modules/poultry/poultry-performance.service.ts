import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { env } from "../../config/env";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type { PoultryContext } from "./poultry.service";
import type {
  ClimateProfileCreate,
  ClimateProfileUpdate,
  DailyWorkCreate,
  DailyWorkGenerateBody,
  DailyWorkListQuery,
  DailyWorkUpdate,
  DailyWorkReview,
  PerformanceDateQuery,
  PerformanceModelCreate,
  PerformanceModelUpdate,
  VaccineScheduleCreate,
  VaccineScheduleUpdate,
  WeeklyTargetCreate,
  WeeklyTargetUpdate,
} from "./poultry-performance.validation";

type Row = Record<string, unknown>;
type Input = Record<string, unknown>;
type Scope = "organization" | "province" | "self";

const number = (value: unknown) => (value == null ? null : Number(value));
const date = (value: unknown) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : (value ?? null);

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
  provinceId: unknown,
) {
  const scope = await scopeOf(client, context);
  if (scope === "organization") return;
  if (scope === "self") throw new NotFoundError("Poultry flock not found");
  const result = await client.query(
    "SELECT 1 FROM member_provinces WHERE organization_id = $1 AND member_id = $2 AND province_id = $3",
    [context.organizationId, context.memberId, provinceId],
  );
  if ((result.rowCount ?? 0) === 0)
    throw new NotFoundError("Poultry flock not found");
}

function provinceScope(
  scope: Scope,
  context: PoultryContext,
  values: unknown[],
) {
  if (scope === "organization") return "TRUE";
  if (scope === "self") return "FALSE";
  values.push(context.memberId);
  return `EXISTS (SELECT 1 FROM member_provinces mp WHERE mp.organization_id = $1 AND mp.member_id = $${values.length} AND mp.province_id = s.province_id)`;
}

const climateSelect =
  "cp.*, p.id AS province_id, p.code AS province_code, p.name AS province_name";
const modelSelect = `pm.*, cp.id AS climate_id, cp.code AS climate_code, cp.name AS climate_name,
  cp.province_id AS climate_province_id, cp.country_code AS climate_country_code,
  cp.climate_class, cp.season, cp.temperature_c, cp.humidity_percent,
  cp.water_adjustment_percent, cp.feed_adjustment_percent, cp.operational_note`;

function climateView(row: Row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    countryCode: row.country_code,
    climateClass: row.climate_class,
    season: row.season,
    temperatureC: number(row.temperature_c),
    humidityPercent: number(row.humidity_percent),
    waterAdjustmentPercent: number(row.water_adjustment_percent),
    feedAdjustmentPercent: number(row.feed_adjustment_percent),
    operationalNote: row.operational_note,
    isActive: row.is_active,
    province: row.province_id
      ? {
          id: row.province_id,
          code: row.province_code,
          name: row.province_name,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function climateForModel(row: Row) {
  if (!row.climate_id) return null;
  return {
    id: row.climate_id,
    code: row.climate_code,
    name: row.climate_name,
    provinceId: row.climate_province_id,
    countryCode: row.climate_country_code,
    climateClass: row.climate_class,
    season: row.season,
    temperatureC: number(row.temperature_c),
    humidityPercent: number(row.humidity_percent),
    waterAdjustmentPercent: number(row.water_adjustment_percent),
    feedAdjustmentPercent: number(row.feed_adjustment_percent),
    operationalNote: row.operational_note,
  };
}

function modelView(row: Row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    productionType: row.production_type,
    strain: row.strain,
    countryCode: row.country_code,
    version: number(row.version),
    isActive: row.is_active,
    notes: row.notes,
    climateProfile: climateForModel(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function weeklyTargetView(row: Row) {
  return {
    id: row.id,
    weekNumber: number(row.week_number),
    targetWeightG: number(row.target_weight_g),
    feedGPerBirdPerDay: number(row.feed_g_per_bird_per_day),
    cumulativeFeedGPerBird: number(row.cumulative_feed_g_per_bird),
    waterLitersPerBirdPerDay: number(row.water_liters_per_bird_per_day),
    targetFcr: number(row.target_fcr),
    targetDailyGainG: number(row.target_daily_gain_g),
    expectedCumulativeMortalityPercent: number(
      row.expected_cumulative_mortality_percent,
    ),
    expectedLiveBirdPercent: number(row.expected_live_bird_percent),
    targetEggLayPercent: number(row.target_egg_lay_percent),
    targetEggCount: number(row.target_egg_count),
    targetEggWeightG: number(row.target_egg_weight_g),
    maxRejectedEggPercent: number(row.max_rejected_egg_percent),
    minTemperatureC: number(row.min_temperature_c),
    maxTemperatureC: number(row.max_temperature_c),
    minHumidityPercent: number(row.min_humidity_percent),
    maxHumidityPercent: number(row.max_humidity_percent),
    tolerancePercent: number(row.tolerance_percent),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function vaccineScheduleView(row: Row) {
  return {
    id: row.id,
    dayAge: number(row.day_age),
    vaccineName: row.vaccine_name,
    dose: row.dose,
    administrationRoute: row.administration_route,
    notes: row.notes,
    isRequired: row.is_required,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function profile(
  client: PoolClient,
  context: PoultryContext,
  id: string,
): Promise<Row> {
  const result = await client.query<Row>(
    `SELECT ${climateSelect} FROM poultry_climate_profiles cp LEFT JOIN provinces p ON p.organization_id = cp.organization_id AND p.id = cp.province_id WHERE cp.organization_id = $1 AND cp.id = $2`,
    [context.organizationId, id],
  );
  if (!result.rows[0]) throw new NotFoundError("Climate profile not found");
  return result.rows[0];
}

async function model(
  client: PoolClient,
  context: PoultryContext,
  id: string,
): Promise<Row> {
  const result = await client.query<Row>(
    `SELECT ${modelSelect} FROM poultry_performance_models pm LEFT JOIN poultry_climate_profiles cp ON cp.organization_id = pm.organization_id AND cp.id = pm.climate_profile_id WHERE pm.organization_id = $1 AND pm.id = $2`,
    [context.organizationId, id],
  );
  if (!result.rows[0]) throw new NotFoundError("Performance model not found");
  return result.rows[0];
}

async function updateStatic(
  client: PoolClient,
  context: PoultryContext,
  table: string,
  id: string,
  fields: Record<string, string>,
  input: Input,
) {
  const values: unknown[] = [context.organizationId, id];
  const assignments: string[] = [];
  for (const [name, column] of Object.entries(fields)) {
    if (input[name] === undefined) continue;
    values.push(input[name]);
    assignments.push(`${column} = $${values.length}`);
  }
  if (assignments.length === 0)
    throw new BadRequestError("Provide at least one value to change");
  await client.query(
    `UPDATE ${table} SET ${assignments.join(", ")} WHERE organization_id = $1 AND id = $2`,
    values,
  );
}

async function checkWorkAssignee(
  client: PoolClient,
  organizationId: string,
  flockId: string,
  memberId: unknown,
) {
  if (memberId == null) return;
  const result = await client.query(
    `SELECT 1
       FROM organization_members target
       JOIN poultry_flocks f ON f.organization_id = target.organization_id AND f.id = $2
       JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id
       JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
      WHERE target.organization_id = $1 AND target.id = $3 AND target.status = 'active'
        AND (
          EXISTS (
            SELECT 1
              FROM member_roles mr
              JOIN roles r ON r.organization_id = mr.organization_id AND r.id = mr.role_id
             WHERE mr.organization_id = target.organization_id AND mr.member_id = target.id
               AND r.data_scope = 'organization'
          )
          OR EXISTS (
            SELECT 1 FROM member_provinces mp
             WHERE mp.organization_id = target.organization_id
               AND mp.member_id = target.id AND mp.province_id = s.province_id
          )
        )`,
    [organizationId, flockId, memberId],
  );
  if ((result.rowCount ?? 0) === 0)
    throw new BadRequestError(
      "Choose an active member assigned to this flock province for the work",
    );
}

export async function listClimateProfiles(context: PoultryContext) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      `SELECT ${climateSelect} FROM poultry_climate_profiles cp
        LEFT JOIN provinces p ON p.organization_id = cp.organization_id AND p.id = cp.province_id
       WHERE cp.organization_id = $1 ORDER BY cp.name`,
      [context.organizationId],
    );
    return result.rows.map(climateView);
  });
}

export async function getClimateProfile(
  context: PoultryContext,
  climateProfileId: string,
) {
  return withTenantContext(context, async (client) =>
    climateView(await profile(client, context, climateProfileId)),
  );
}

export async function createClimateProfile(
  context: PoultryContext,
  input: ClimateProfileCreate,
) {
  return withTenantContext(context, async (client) => {
    if (input.provinceId) {
      const province = await client.query(
        "SELECT 1 FROM provinces WHERE organization_id = $1 AND id = $2",
        [context.organizationId, input.provinceId],
      );
      if ((province.rowCount ?? 0) === 0)
        throw new BadRequestError("Choose a province in this company");
    }
    const result = await client.query<{ id: string }>(
      `INSERT INTO poultry_climate_profiles (organization_id, province_id, code, name, country_code, climate_class, season, temperature_c, humidity_percent, water_adjustment_percent, feed_adjustment_percent, operational_note, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [
        context.organizationId,
        input.provinceId ?? null,
        input.code,
        input.name,
        input.countryCode,
        input.climateClass,
        input.season ?? null,
        input.temperatureC ?? null,
        input.humidityPercent ?? null,
        input.waterAdjustmentPercent,
        input.feedAdjustmentPercent,
        input.operationalNote ?? null,
        input.isActive,
      ],
    );
    return climateView(await profile(client, context, result.rows[0]!.id));
  });
}

export async function updateClimateProfile(
  context: PoultryContext,
  climateProfileId: string,
  input: ClimateProfileUpdate,
) {
  return withTenantContext(context, async (client) => {
    await profile(client, context, climateProfileId);
    if (input.provinceId) {
      const province = await client.query(
        "SELECT 1 FROM provinces WHERE organization_id = $1 AND id = $2",
        [context.organizationId, input.provinceId],
      );
      if ((province.rowCount ?? 0) === 0)
        throw new BadRequestError("Choose a province in this company");
    }
    await updateStatic(
      client,
      context,
      "poultry_climate_profiles",
      climateProfileId,
      {
        code: "code",
        name: "name",
        provinceId: "province_id",
        countryCode: "country_code",
        climateClass: "climate_class",
        season: "season",
        temperatureC: "temperature_c",
        humidityPercent: "humidity_percent",
        waterAdjustmentPercent: "water_adjustment_percent",
        feedAdjustmentPercent: "feed_adjustment_percent",
        operationalNote: "operational_note",
        isActive: "is_active",
      },
      input,
    );
    return climateView(await profile(client, context, climateProfileId));
  });
}

export async function deleteClimateProfile(
  context: PoultryContext,
  climateProfileId: string,
) {
  return withTenantContext(context, async (client) => {
    await profile(client, context, climateProfileId);
    const use = await client.query(
      "SELECT 1 FROM poultry_performance_models WHERE organization_id = $1 AND climate_profile_id = $2 LIMIT 1",
      [context.organizationId, climateProfileId],
    );
    if ((use.rowCount ?? 0) > 0)
      throw new ConflictError(
        "This climate profile is still used by a performance model. Edit the model first.",
      );
    await client.query(
      "DELETE FROM poultry_climate_profiles WHERE organization_id = $1 AND id = $2",
      [context.organizationId, climateProfileId],
    );
  });
}

export async function listPerformanceModels(context: PoultryContext) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      `SELECT ${modelSelect} FROM poultry_performance_models pm
       LEFT JOIN poultry_climate_profiles cp ON cp.organization_id = pm.organization_id AND cp.id = pm.climate_profile_id
       WHERE pm.organization_id = $1 ORDER BY pm.production_type, pm.name`,
      [context.organizationId],
    );
    return result.rows.map(modelView);
  });
}

export async function getPerformanceModel(
  context: PoultryContext,
  modelId: string,
) {
  return withTenantContext(context, async (client) =>
    modelView(await model(client, context, modelId)),
  );
}

export async function createPerformanceModel(
  context: PoultryContext,
  input: PerformanceModelCreate,
) {
  return withTenantContext(context, async (client) => {
    if (input.climateProfileId)
      await profile(client, context, input.climateProfileId);
    const result = await client.query<{ id: string }>(
      `INSERT INTO poultry_performance_models (organization_id, climate_profile_id, code, name, production_type, strain, country_code, version, is_active, notes, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING id`,
      [
        context.organizationId,
        input.climateProfileId ?? null,
        input.code,
        input.name,
        input.productionType,
        input.strain ?? null,
        input.countryCode,
        input.version,
        input.isActive,
        input.notes ?? null,
        context.userId,
      ],
    );
    return modelView(await model(client, context, result.rows[0]!.id));
  });
}

export async function updatePerformanceModel(
  context: PoultryContext,
  modelId: string,
  input: PerformanceModelUpdate,
) {
  return withTenantContext(context, async (client) => {
    const current = await model(client, context, modelId);
    if (input.climateProfileId)
      await profile(client, context, input.climateProfileId);
    if (
      input.productionType !== undefined &&
      input.productionType !== current.production_type
    ) {
      const assigned = await client.query(
        "SELECT 1 FROM poultry_flocks WHERE organization_id = $1 AND performance_model_id = $2 LIMIT 1",
        [context.organizationId, modelId],
      );
      if ((assigned.rowCount ?? 0) > 0)
        throw new ConflictError(
          "This model is assigned to a flock. Reassign those flocks before changing its poultry type.",
        );
    }
    await updateStatic(
      client,
      context,
      "poultry_performance_models",
      modelId,
      {
        code: "code",
        name: "name",
        productionType: "production_type",
        strain: "strain",
        countryCode: "country_code",
        climateProfileId: "climate_profile_id",
        version: "version",
        isActive: "is_active",
        notes: "notes",
      },
      input,
    );
    await client.query(
      "UPDATE poultry_performance_models SET updated_by_user_id = $3 WHERE organization_id = $1 AND id = $2",
      [context.organizationId, modelId, context.userId],
    );
    return modelView(await model(client, context, modelId));
  });
}
export async function deletePerformanceModel(
  context: PoultryContext,
  modelId: string,
) {
  return withTenantContext(context, async (client) => {
    await model(client, context, modelId);
    const use = await client.query(
      "SELECT 1 FROM poultry_flocks WHERE organization_id = $1 AND performance_model_id = $2 LIMIT 1",
      [context.organizationId, modelId],
    );
    if ((use.rowCount ?? 0) > 0)
      throw new ConflictError(
        "This model is assigned to a flock. Deactivate or reassign it instead of deleting it.",
      );
    await client.query(
      "DELETE FROM poultry_performance_models WHERE organization_id = $1 AND id = $2",
      [context.organizationId, modelId],
    );
  });
}

async function weeklyTarget(
  client: PoolClient,
  context: PoultryContext,
  modelId: string,
  targetId: string,
): Promise<Row> {
  const result = await client.query<Row>(
    "SELECT * FROM poultry_model_week_targets WHERE organization_id = $1 AND performance_model_id = $2 AND id = $3",
    [context.organizationId, modelId, targetId],
  );
  if (!result.rows[0]) throw new NotFoundError("Weekly target not found");
  return result.rows[0];
}

export async function listWeeklyTargets(
  context: PoultryContext,
  modelId: string,
) {
  return withTenantContext(context, async (client) => {
    await model(client, context, modelId);
    const result = await client.query<Row>(
      "SELECT * FROM poultry_model_week_targets WHERE organization_id = $1 AND performance_model_id = $2 ORDER BY week_number",
      [context.organizationId, modelId],
    );
    return result.rows.map(weeklyTargetView);
  });
}

export async function createWeeklyTarget(
  context: PoultryContext,
  modelId: string,
  input: WeeklyTargetCreate,
) {
  return withTenantContext(context, async (client) => {
    await model(client, context, modelId);
    const result = await client.query<{ id: string }>(
      `INSERT INTO poultry_model_week_targets (
         organization_id, performance_model_id, week_number, target_weight_g,
         feed_g_per_bird_per_day, cumulative_feed_g_per_bird,
         water_liters_per_bird_per_day, target_fcr, target_daily_gain_g,
         expected_cumulative_mortality_percent, expected_live_bird_percent,
         target_egg_lay_percent, target_egg_count, target_egg_weight_g,
         max_rejected_egg_percent, min_temperature_c, max_temperature_c,
         min_humidity_percent, max_humidity_percent, tolerance_percent, notes
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
       ) RETURNING id`,
      [
        context.organizationId,
        modelId,
        input.weekNumber,
        input.targetWeightG ?? null,
        input.feedGPerBirdPerDay ?? null,
        input.cumulativeFeedGPerBird ?? null,
        input.waterLitersPerBirdPerDay ?? null,
        input.targetFcr ?? null,
        input.targetDailyGainG ?? null,
        input.expectedCumulativeMortalityPercent ?? null,
        input.expectedLiveBirdPercent ?? null,
        input.targetEggLayPercent ?? null,
        input.targetEggCount ?? null,
        input.targetEggWeightG ?? null,
        input.maxRejectedEggPercent ?? null,
        input.minTemperatureC ?? null,
        input.maxTemperatureC ?? null,
        input.minHumidityPercent ?? null,
        input.maxHumidityPercent ?? null,
        input.tolerancePercent,
        input.notes ?? null,
      ],
    );
    return weeklyTargetView(
      await weeklyTarget(client, context, modelId, result.rows[0]!.id),
    );
  });
}

export async function updateWeeklyTarget(
  context: PoultryContext,
  modelId: string,
  targetId: string,
  input: WeeklyTargetUpdate,
) {
  return withTenantContext(context, async (client) => {
    await model(client, context, modelId);
    await weeklyTarget(client, context, modelId, targetId);
    await updateStatic(
      client,
      context,
      "poultry_model_week_targets",
      targetId,
      {
        targetWeightG: "target_weight_g",
        feedGPerBirdPerDay: "feed_g_per_bird_per_day",
        cumulativeFeedGPerBird: "cumulative_feed_g_per_bird",
        waterLitersPerBirdPerDay: "water_liters_per_bird_per_day",
        targetFcr: "target_fcr",
        targetDailyGainG: "target_daily_gain_g",
        expectedCumulativeMortalityPercent:
          "expected_cumulative_mortality_percent",
        expectedLiveBirdPercent: "expected_live_bird_percent",
        targetEggLayPercent: "target_egg_lay_percent",
        targetEggCount: "target_egg_count",
        targetEggWeightG: "target_egg_weight_g",
        maxRejectedEggPercent: "max_rejected_egg_percent",
        minTemperatureC: "min_temperature_c",
        maxTemperatureC: "max_temperature_c",
        minHumidityPercent: "min_humidity_percent",
        maxHumidityPercent: "max_humidity_percent",
        tolerancePercent: "tolerance_percent",
        notes: "notes",
      },
      input,
    );
    return weeklyTargetView(
      await weeklyTarget(client, context, modelId, targetId),
    );
  });
}

export async function deleteWeeklyTarget(
  context: PoultryContext,
  modelId: string,
  targetId: string,
) {
  return withTenantContext(context, async (client) => {
    await weeklyTarget(client, context, modelId, targetId);
    await client.query(
      "DELETE FROM poultry_model_week_targets WHERE organization_id = $1 AND id = $2",
      [context.organizationId, targetId],
    );
  });
}

async function vaccineSchedule(
  client: PoolClient,
  context: PoultryContext,
  modelId: string,
  scheduleId: string,
): Promise<Row> {
  const result = await client.query<Row>(
    "SELECT * FROM poultry_model_vaccine_schedules WHERE organization_id = $1 AND performance_model_id = $2 AND id = $3",
    [context.organizationId, modelId, scheduleId],
  );
  if (!result.rows[0]) throw new NotFoundError("Vaccine schedule not found");
  return result.rows[0];
}

export async function listVaccineSchedules(
  context: PoultryContext,
  modelId: string,
) {
  return withTenantContext(context, async (client) => {
    await model(client, context, modelId);
    const result = await client.query<Row>(
      "SELECT * FROM poultry_model_vaccine_schedules WHERE organization_id = $1 AND performance_model_id = $2 ORDER BY day_age, vaccine_name",
      [context.organizationId, modelId],
    );
    return result.rows.map(vaccineScheduleView);
  });
}

export async function createVaccineSchedule(
  context: PoultryContext,
  modelId: string,
  input: VaccineScheduleCreate,
) {
  return withTenantContext(context, async (client) => {
    await model(client, context, modelId);
    const result = await client.query<{ id: string }>(
      `INSERT INTO poultry_model_vaccine_schedules (organization_id, performance_model_id, day_age, vaccine_name, dose, administration_route, notes, is_required)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        context.organizationId,
        modelId,
        input.dayAge,
        input.vaccineName,
        input.dose ?? null,
        input.administrationRoute ?? null,
        input.notes ?? null,
        input.isRequired,
      ],
    );
    return vaccineScheduleView(
      await vaccineSchedule(client, context, modelId, result.rows[0]!.id),
    );
  });
}

export async function updateVaccineSchedule(
  context: PoultryContext,
  modelId: string,
  scheduleId: string,
  input: VaccineScheduleUpdate,
) {
  return withTenantContext(context, async (client) => {
    await model(client, context, modelId);
    await vaccineSchedule(client, context, modelId, scheduleId);
    await updateStatic(
      client,
      context,
      "poultry_model_vaccine_schedules",
      scheduleId,
      {
        dayAge: "day_age",
        vaccineName: "vaccine_name",
        dose: "dose",
        administrationRoute: "administration_route",
        notes: "notes",
        isRequired: "is_required",
      },
      input,
    );
    return vaccineScheduleView(
      await vaccineSchedule(client, context, modelId, scheduleId),
    );
  });
}

export async function deleteVaccineSchedule(
  context: PoultryContext,
  modelId: string,
  scheduleId: string,
) {
  return withTenantContext(context, async (client) => {
    await vaccineSchedule(client, context, modelId, scheduleId);
    await client.query(
      "DELETE FROM poultry_model_vaccine_schedules WHERE organization_id = $1 AND id = $2",
      [context.organizationId, scheduleId],
    );
  });
}

async function scopedFlock(
  client: PoolClient,
  context: PoultryContext,
  flockId: string,
): Promise<Row> {
  const result = await client.query<Row>(
    `SELECT f.id AS flock_id, f.code AS flock_code, f.name AS flock_name, f.bird_type, f.production_type,
            f.hatch_date, f.arrival_date, f.starting_age_days, f.initial_bird_count, f.status AS flock_status,
            f.performance_model_id, h.id AS house_id, h.code AS house_code, h.name AS house_name,
            s.id AS site_id, s.code AS site_code, s.name AS site_name,
            p.id AS province_id, p.code AS province_code, p.name AS province_name,
            pm.id AS model_id, pm.code AS model_code, pm.name AS model_name, pm.production_type AS model_production_type,
            pm.strain AS model_strain, pm.country_code AS model_country_code, pm.version AS model_version,
            cp.id AS climate_id, cp.code AS climate_code, cp.name AS climate_name, cp.province_id AS climate_province_id,
            cp.country_code AS climate_country_code, cp.climate_class, cp.season, cp.temperature_c, cp.humidity_percent,
            cp.water_adjustment_percent, cp.feed_adjustment_percent, cp.operational_note
       FROM poultry_flocks f
       JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id
       JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
       JOIN provinces p ON p.organization_id = s.organization_id AND p.id = s.province_id
       LEFT JOIN poultry_performance_models pm ON pm.organization_id = f.organization_id AND pm.id = f.performance_model_id
       LEFT JOIN poultry_climate_profiles cp ON cp.organization_id = pm.organization_id AND cp.id = pm.climate_profile_id
      WHERE f.organization_id = $1 AND f.id = $2`,
    [context.organizationId, flockId],
  );
  if (!result.rows[0]) throw new NotFoundError("Poultry flock not found");
  await assertProvince(client, context, result.rows[0].province_id);
  return result.rows[0];
}

function round(value: number, places = 3) {
  return Number(value.toFixed(places));
}

function compareTarget(
  actual: number | null,
  target: number | null,
  tolerancePercent: number,
) {
  if (target == null)
    return {
      actual,
      target: null,
      variancePercent: null,
      status: "not_configured",
    };
  if (actual == null)
    return {
      actual: null,
      target,
      variancePercent: null,
      status: "missing_data",
    };
  if (target === 0)
    return {
      actual,
      target,
      variancePercent: actual === 0 ? 0 : null,
      status: actual === 0 ? "on_target" : "above_target",
    };
  const variancePercent = round(((actual - target) / target) * 100);
  return {
    actual,
    target,
    variancePercent,
    status:
      Math.abs(variancePercent) <= tolerancePercent
        ? "on_target"
        : variancePercent < 0
          ? "below_target"
          : "above_target",
  };
}

function compareMaximum(
  actual: number | null,
  maximum: number | null,
  tolerancePercent: number,
) {
  if (maximum == null)
    return {
      actual,
      target: null,
      variancePercent: null,
      status: "not_configured",
    };
  if (actual == null)
    return {
      actual: null,
      target: maximum,
      variancePercent: null,
      status: "missing_data",
    };
  if (maximum === 0)
    return {
      actual,
      target: maximum,
      variancePercent: actual === 0 ? 0 : null,
      status: actual === 0 ? "on_target" : "above_target",
    };
  const variancePercent = round(((actual - maximum) / maximum) * 100);
  return {
    actual,
    target: maximum,
    variancePercent,
    status:
      actual <= maximum * (1 + tolerancePercent / 100)
        ? "on_target"
        : "above_target",
  };
}

function compareRange(
  actual: number | null,
  minimum: number | null,
  maximum: number | null,
) {
  if (minimum == null && maximum == null)
    return {
      actual,
      target: null,
      variancePercent: null,
      status: "not_configured",
    };
  if (actual == null)
    return {
      actual: null,
      target: minimum ?? maximum,
      variancePercent: null,
      status: "missing_data",
    };
  if (minimum != null && actual < minimum)
    return {
      actual,
      target: minimum,
      variancePercent: round(
        ((actual - minimum) / Math.abs(minimum || 1)) * 100,
      ),
      status: "below_target",
    };
  if (maximum != null && actual > maximum)
    return {
      actual,
      target: maximum,
      variancePercent: round(
        ((actual - maximum) / Math.abs(maximum || 1)) * 100,
      ),
      status: "above_target",
    };
  return {
    actual,
    target: minimum ?? maximum,
    variancePercent: 0,
    status: "on_target",
  };
}
function selectedDate(value: string | undefined) {
  return value ?? new Date().toISOString().slice(0, 10);
}

type AiPlanPriority = {
  title: string;
  reason: string;
  priority: "critical" | "high" | "normal";
};
type PoultryAiPlan = {
  status: "ready" | "disabled" | "unavailable" | "limited";
  summary?: string;
  priorities: AiPlanPriority[];
  model?: string;
  generatedAt?: unknown;
};

function aiText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function aiPlanView(row: Row): PoultryAiPlan {
  const rawPriorities = Array.isArray(row.priorities) ? row.priorities : [];
  const priorities = rawPriorities
    .filter((item): item is Row => Boolean(item) && typeof item === "object")
    .map((item) => {
      const priority = aiText(item.priority, 20).toLowerCase();
      return {
        title: aiText(item.title, 160),
        reason: aiText(item.reason, 500),
        priority:
          priority === "critical" || priority === "high" ? priority : "normal",
      } as AiPlanPriority;
    })
    .filter((item) => item.title && item.reason)
    .slice(0, 3);
  return {
    status: "ready",
    summary: aiText(row.summary, 1_000),
    priorities,
    model: aiText(row.model, 160),
    generatedAt: row.updated_at,
  };
}

async function storedAiPlan(
  client: PoolClient,
  context: PoultryContext,
  flockId: string,
  workDate: string,
) {
  const result = await client.query<Row>(
    `SELECT summary, priorities, model, updated_at
       FROM poultry_ai_daily_plans
      WHERE organization_id = $1 AND flock_id = $2 AND work_date = $3::date`,
    [context.organizationId, flockId, workDate],
  );
  return result.rows[0] ? aiPlanView(result.rows[0]) : null;
}

function outputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as Record<string, unknown>;
  if (typeof response.output_text === "string") return response.output_text;
  if (!Array.isArray(response.output)) return "";
  return response.output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) return [];
      return content.flatMap((part) =>
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
          ? [(part as { text: string }).text]
          : [],
      );
    })
    .join("\n")
    .trim();
}

function aiPlanOutput(output: string): Omit<PoultryAiPlan, "status" | "model" | "generatedAt"> | null {
  const json = output.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? output;
  try {
    const parsed = JSON.parse(json) as Row;
    const summary = aiText(parsed.summary, 1_000);
    const priorities = Array.isArray(parsed.priorities)
      ? parsed.priorities
          .filter((item): item is Row => Boolean(item) && typeof item === "object")
          .map((item) => {
            const level = aiText(item.priority, 20).toLowerCase();
            return {
              title: aiText(item.title, 160),
              reason: aiText(item.reason, 500),
              priority:
                level === "critical" || level === "high" ? level : "normal",
            } as AiPlanPriority;
          })
          .filter((item) => item.title && item.reason)
          .slice(0, 3)
      : [];
    return summary ? { summary, priorities } : null;
  } catch {
    return null;
  }
}
function ageFor(flock: Row, day: string) {
  const origin = String(date(flock.hatch_date) ?? date(flock.arrival_date));
  const days =
    Number(flock.starting_age_days ?? 0) +
    Math.max(
      0,
      Math.floor(
        (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${origin}T00:00:00Z`)) /
          86_400_000,
      ),
    );
  return {
    originDate: origin,
    ageDays: days,
    ageWeek: Math.floor(days / 7) + 1,
  };
}

async function buildPerformance(
  client: PoolClient,
  context: PoultryContext,
  flockId: string,
  requestedDate?: string,
) {
  const flock = await scopedFlock(client, context, flockId);
  const day = selectedDate(requestedDate);
  const age = ageFor(flock, day);
  const actual = await client.query<Row>(
    `SELECT
       (SELECT d.live_bird_count FROM poultry_daily_records d WHERE d.organization_id = $1 AND d.flock_id = $2 AND d.record_date <= $3::date AND d.live_bird_count IS NOT NULL ORDER BY d.record_date DESC, d.created_at DESC LIMIT 1) AS physical_live_bird_count,
       (SELECT d.record_date FROM poultry_daily_records d WHERE d.organization_id = $1 AND d.flock_id = $2 AND d.record_date <= $3::date AND d.live_bird_count IS NOT NULL ORDER BY d.record_date DESC, d.created_at DESC LIMIT 1) AS physical_live_bird_record_date,
       COALESCE((SELECT SUM(COALESCE(d.arrivals_count, 0) - COALESCE(d.transfers_out_count, 0) - COALESCE(d.culls_count, 0)) FROM poultry_daily_records d WHERE d.organization_id = $1 AND d.flock_id = $2 AND d.record_date <= $3::date), 0) AS net_movements,
       COALESCE((SELECT SUM(m.death_count) FROM poultry_mortality_records m WHERE m.organization_id = $1 AND m.flock_id = $2 AND m.mortality_date <= $3::date), 0) AS cumulative_mortality,
       COALESCE((SELECT SUM(m.death_count) FROM poultry_mortality_records m WHERE m.organization_id = $1 AND m.flock_id = $2 AND m.mortality_date = $3::date), 0) AS daily_mortality,
       (SELECT SUM(r.quantity_kg) FROM poultry_feed_records r WHERE r.organization_id = $1 AND r.flock_id = $2 AND r.feed_date = $3::date) AS feed_kg,
       COALESCE((SELECT SUM(r.quantity_kg) FROM poultry_feed_records r WHERE r.organization_id = $1 AND r.flock_id = $2 AND r.feed_date <= $3::date), 0) AS cumulative_feed_kg,
       (SELECT SUM(r.volume_liters) FROM poultry_water_records r WHERE r.organization_id = $1 AND r.flock_id = $2 AND r.water_date = $3::date) AS water_liters,
       (SELECT r.average_weight_g FROM poultry_weight_records r WHERE r.organization_id = $1 AND r.flock_id = $2 AND r.record_date <= $3::date ORDER BY r.record_date DESC, r.created_at DESC LIMIT 1) AS average_weight_g,
       (SELECT r.record_date FROM poultry_weight_records r WHERE r.organization_id = $1 AND r.flock_id = $2 AND r.record_date <= $3::date ORDER BY r.record_date DESC, r.created_at DESC LIMIT 1) AS weight_record_date,
       (SELECT r.average_weight_g FROM poultry_weight_records r WHERE r.organization_id = $1 AND r.flock_id = $2 AND r.record_date < $3::date ORDER BY r.record_date DESC, r.created_at DESC LIMIT 1) AS previous_weight_g,
       (SELECT r.record_date FROM poultry_weight_records r WHERE r.organization_id = $1 AND r.flock_id = $2 AND r.record_date < $3::date ORDER BY r.record_date DESC, r.created_at DESC LIMIT 1) AS previous_weight_date,
       (SELECT d.temperature_c FROM poultry_daily_records d WHERE d.organization_id = $1 AND d.flock_id = $2 AND d.record_date <= $3::date AND d.temperature_c IS NOT NULL ORDER BY d.record_date DESC, d.created_at DESC LIMIT 1) AS temperature_c,
       (SELECT d.record_date FROM poultry_daily_records d WHERE d.organization_id = $1 AND d.flock_id = $2 AND d.record_date <= $3::date AND d.temperature_c IS NOT NULL ORDER BY d.record_date DESC, d.created_at DESC LIMIT 1) AS temperature_record_date,
       (SELECT d.humidity_percent FROM poultry_daily_records d WHERE d.organization_id = $1 AND d.flock_id = $2 AND d.record_date <= $3::date AND d.humidity_percent IS NOT NULL ORDER BY d.record_date DESC, d.created_at DESC LIMIT 1) AS humidity_percent,
       (SELECT d.record_date FROM poultry_daily_records d WHERE d.organization_id = $1 AND d.flock_id = $2 AND d.record_date <= $3::date AND d.humidity_percent IS NOT NULL ORDER BY d.record_date DESC, d.created_at DESC LIMIT 1) AS humidity_record_date,
       (SELECT SUM(r.total_eggs) FROM poultry_egg_records r WHERE r.organization_id = $1 AND r.flock_id = $2 AND r.record_date = $3::date) AS total_eggs,
       (SELECT SUM(r.cracked_eggs) FROM poultry_egg_records r WHERE r.organization_id = $1 AND r.flock_id = $2 AND r.record_date = $3::date) AS cracked_eggs,
       (SELECT SUM(r.dirty_eggs) FROM poultry_egg_records r WHERE r.organization_id = $1 AND r.flock_id = $2 AND r.record_date = $3::date) AS dirty_eggs,
       (SELECT SUM(r.rejected_eggs) FROM poultry_egg_records r WHERE r.organization_id = $1 AND r.flock_id = $2 AND r.record_date = $3::date) AS rejected_eggs,
       (SELECT SUM(r.hatching_eggs) FROM poultry_egg_records r WHERE r.organization_id = $1 AND r.flock_id = $2 AND r.record_date = $3::date) AS hatching_eggs,
       (SELECT COUNT(*) FROM poultry_health_records r WHERE r.organization_id = $1 AND r.flock_id = $2 AND r.record_date <= $3::date AND COALESCE(r.status, 'open') NOT IN ('resolved', 'closed')) AS open_health_events,
       (SELECT COUNT(*) FROM poultry_health_records r WHERE r.organization_id = $1 AND r.flock_id = $2 AND r.record_date <= $3::date AND COALESCE(r.status, 'open') NOT IN ('resolved', 'closed') AND r.severity IN ('high', 'critical')) AS urgent_health_events,
       (SELECT COUNT(*) FROM poultry_treatment_records r WHERE r.organization_id = $1 AND r.flock_id = $2 AND r.treatment_date <= $3::date AND (r.end_date IS NULL OR r.end_date >= $3::date)) AS active_treatment_count,
       (SELECT r.record_date FROM poultry_biosecurity_records r WHERE r.organization_id = $1 AND r.house_id = $4 AND r.record_date <= $3::date ORDER BY r.record_date DESC, r.created_at DESC LIMIT 1) AS biosecurity_record_date,
       (SELECT r.compliance_status FROM poultry_biosecurity_records r WHERE r.organization_id = $1 AND r.house_id = $4 AND r.record_date <= $3::date ORDER BY r.record_date DESC, r.created_at DESC LIMIT 1) AS biosecurity_compliance_status`,
    [context.organizationId, flockId, day, flock.house_id],
  );
  const data = actual.rows[0] ?? {};
  const cumulativeMortality = Number(data.cumulative_mortality ?? 0);
  const initialBirdCount = Number(flock.initial_bird_count);
  const expectedLiveBirdCount = Math.max(
    0,
    initialBirdCount + Number(data.net_movements ?? 0) - cumulativeMortality,
  );
  const physicalLiveBirdCount = number(data.physical_live_bird_count);
  const liveBirdCount = expectedLiveBirdCount;
  const liveBirdDiscrepancy =
    physicalLiveBirdCount == null
      ? null
      : physicalLiveBirdCount - expectedLiveBirdCount;
  const mortalityRate =
    initialBirdCount === 0
      ? 0
      : round((cumulativeMortality / initialBirdCount) * 100);
  const weightRecordDate = date(data.weight_record_date);
  const weightAgeInDays =
    weightRecordDate == null
      ? null
      : Math.max(
          0,
          Math.round(
            (Date.parse(`${day}T00:00:00Z`) -
              Date.parse(`${String(weightRecordDate)}T00:00:00Z`)) /
              86_400_000,
          ),
        );
  const recordStatus = {
    liveBirds: date(data.physical_live_bird_record_date) === day,
    feed: number(data.feed_kg) != null,
    water: number(data.water_liters) != null,
    weight: weightAgeInDays != null && weightAgeInDays < 7,
    temperature: date(data.temperature_record_date) === day,
    humidity: date(data.humidity_record_date) === day,
    eggs: number(data.total_eggs) != null,
  };
  const requiredRecordKeys = [
    "liveBirds",
    "feed",
    "water",
    "weight",
    "temperature",
    "humidity",
  ] as const;
  const missingRecords = requiredRecordKeys.filter(
    (key) => !recordStatus[key],
  );
  const openHealthEvents = Number(data.open_health_events ?? 0);
  const urgentHealthEvents = Number(data.urgent_health_events ?? 0);
  const activeTreatmentCount = Number(data.active_treatment_count ?? 0);
  const biosecurityRecordDate = date(data.biosecurity_record_date);
  const biosecurityAgeInDays =
    biosecurityRecordDate == null
      ? null
      : Math.max(
          0,
          Math.round(
            (Date.parse(`${day}T00:00:00Z`) -
              Date.parse(`${String(biosecurityRecordDate)}T00:00:00Z`)) /
              86_400_000,
          ),
        );
  const biosecurityNeedsCheck =
    biosecurityAgeInDays == null || biosecurityAgeInDays >= 7;
  const fieldRiskRecommendations: Array<{
    severity: string;
    category: string;
    message: string;
    action: string;
  }> = [];
  if (openHealthEvents > 0)
    fieldRiskRecommendations.push({
      severity: urgentHealthEvents > 0 ? "critical" : "warning",
      category: "health_follow_up",
      message: `${openHealthEvents} open health event${openHealthEvents === 1 ? "" : "s"} require follow-up for this flock.`,
      action:
        urgentHealthEvents > 0
          ? "Review the affected birds and contact the veterinarian according to the farm protocol."
          : "Review symptoms, actions taken and the event status before closing the day.",
    });
  if (activeTreatmentCount > 0)
    fieldRiskRecommendations.push({
      severity: "info",
      category: "treatment_follow_up",
      message: `${activeTreatmentCount} treatment plan${activeTreatmentCount === 1 ? " is" : "s are"} active today.`,
      action:
        "Confirm administration, dosage, withdrawal requirements and the treatment record.",
    });
  if (biosecurityNeedsCheck)
    fieldRiskRecommendations.push({
      severity: "warning",
      category: "biosecurity",
      message: "No recent biosecurity check is available for this house.",
      action:
        "Complete a biosecurity check before the end of the operating day.",
    });  const baseDailyWork = [
    !recordStatus.liveBirds
      ? {
          workType: "live_bird_check",
          title: "Count live birds and record the physical count",
          details:
            "Record today's physical count so the system can reconcile it with the expected live population.",
        }
      : null,
    !recordStatus.feed
      ? {
          workType: "feed_record",
          title: "Issue feed and record the quantity",
          details:
            "Record feed issued today with the feed name, stage, batch and quantity.",
        }
      : null,
    !recordStatus.water
      ? {
          workType: "water_record",
          title: "Check water and record consumption",
          details:
            "Inspect water availability and record the volume consumed today.",
        }
      : null,
    !recordStatus.weight
      ? {
          workType: "weight_check",
          title: "Weigh a representative flock sample",
          details:
            "Record an average sample weight. Weekly weighing is required when no recent sample exists.",
        }
      : null,
    !recordStatus.temperature || !recordStatus.humidity
      ? {
          workType: "climate_check",
          title: "Inspect house climate and record conditions",
          details:
            "Record temperature and humidity after checking ventilation, heat and water availability.",
        }
      : null,
    {
      workType: "mortality_review",
      title: "Review mortality and flock condition",
      details:
        "Confirm deaths, culls, symptoms and follow-up actions are recorded for today.",
    },
    openHealthEvents > 0
      ? {
          workType: "health_follow_up",
          title: "Follow up open flock health events",
          details:
            `${openHealthEvents} health event${openHealthEvents === 1 ? "" : "s"} remain open${urgentHealthEvents > 0 ? "; at least one is high or critical" : ""}.`,
        }
      : null,
    activeTreatmentCount > 0
      ? {
          workType: "treatment_follow_up",
          title: "Confirm active treatment plan",
          details:
            `${activeTreatmentCount} active treatment plan${activeTreatmentCount === 1 ? "" : "s"} require administration and withdrawal review.`,
        }
      : null,
    biosecurityNeedsCheck
      ? {
          workType: "biosecurity_check",
          title: "Complete biosecurity inspection",
          details:
            "No biosecurity check was recorded during the last seven days for this house.",
        }
      : null,
    ["layer", "breeder"].includes(String(flock.production_type)) &&
    !recordStatus.eggs
      ? {
          workType: "egg_collection",
          title: "Collect and grade eggs",
          details:
            "Record total, broken, dirty and rejected eggs for today.",
        }
      : null,
  ].filter(
    (item): item is { workType: string; title: string; details: string } =>
      item !== null,
  );
  const operationalBrief = {
    modelAssigned: Boolean(flock.model_id),
    dataCoverage: {
      available: requiredRecordKeys.length - missingRecords.length,
      required: requiredRecordKeys.length,
      percent: Math.round(
        ((requiredRecordKeys.length - missingRecords.length) /
          requiredRecordKeys.length) *
          100,
      ),
      missing: missingRecords,
    },
    recordStatus,
    physicalCountDiscrepancy: liveBirdDiscrepancy,
    recentWeightRecordDate: weightRecordDate,
  };
  const aiPlan = await storedAiPlan(client, context, flockId, day);
  const modelId = flock.model_id as string | null;
  if (!modelId) {
    return {
      date: day,
      age,
      flock: {
        id: flock.flock_id,
        code: flock.flock_code,
        name: flock.flock_name,
        productionType: flock.production_type,
        liveBirdCount,
        expectedLiveBirdCount,
        physicalLiveBirdCount,
        liveBirdDiscrepancy,
      },
      model: null,
      weeklyTarget: null,
      actual: {
        feedKg: number(data.feed_kg),
        waterLiters: number(data.water_liters),
        averageWeightG: number(data.average_weight_g),
        weightRecordDate,
        dailyMortality: Number(data.daily_mortality ?? 0),
        cumulativeMortality,
        mortalityRatePercent: mortalityRate,
      },
      comparisons: {},
      vaccines: [],
      operationalBrief: {
        ...operationalBrief,
        weeklyTargetConfigured: false,
        readiness: "needs_setup",
      },
      aiPlan,
      recommendedDailyWork: [
        ...baseDailyWork,
        {
          workType: "performance_model_setup",
          title: "Assign a performance model to this flock",
          details:
            "Choose a compatible Broiler, Layer or Breeder model so feed, water, weight, mortality and vaccination targets can be calculated.",
        },
      ],
      recommendations: [
        {
          severity: "warning",
          category: "model",
          message:
            "Assign a Broiler, Layer or Breeder performance model to calculate feed, water, growth, mortality and vaccine requirements.",
          action: "Update this flock and select a company performance model.",
        },
        ...fieldRiskRecommendations,
      ],
    };
  }
  const targetResult = await client.query<Row>(
    "SELECT * FROM poultry_model_week_targets WHERE organization_id = $1 AND performance_model_id = $2 AND week_number = $3",
    [context.organizationId, modelId, age.ageWeek],
  );
  const targetRow = targetResult.rows[0] ?? null;
  const target = targetRow ? weeklyTargetView(targetRow) : null;
  const tolerance = target?.tolerancePercent ?? 0;
  const climate = climateForModel(flock);
  const feedTarget =
    target?.feedGPerBirdPerDay == null
      ? null
      : round(
          (liveBirdCount *
            target.feedGPerBirdPerDay *
            (1 + (climate?.feedAdjustmentPercent ?? 0) / 100)) /
            1000,
        );
  const waterTarget =
    target?.waterLitersPerBirdPerDay == null
      ? null
      : round(
          liveBirdCount *
            target.waterLitersPerBirdPerDay *
            (1 + (climate?.waterAdjustmentPercent ?? 0) / 100),
        );
  const eggTotal = number(data.total_eggs);
  const brokenEggs = number(data.cracked_eggs) ?? 0;
  const dirtyEggs = number(data.dirty_eggs) ?? 0;
  const rejectedEggs =
    brokenEggs + dirtyEggs + (number(data.rejected_eggs) ?? 0);
  const hatchingEggs = number(data.hatching_eggs) ?? 0;
  const eggLayRate =
    eggTotal == null || liveBirdCount === 0
      ? null
      : round((eggTotal / liveBirdCount) * 100);
  const rejectedEggRate =
    eggTotal == null || eggTotal === 0
      ? null
      : round((rejectedEggs / eggTotal) * 100);
  const cumulativeFeedPerBird =
    liveBirdCount === 0
      ? null
      : round((Number(data.cumulative_feed_kg ?? 0) * 1000) / liveBirdCount);
  const biomassG =
    number(data.average_weight_g) == null
      ? null
      : liveBirdCount * Number(data.average_weight_g);
  const feedConversionRatio =
    biomassG == null || biomassG === 0
      ? null
      : round((Number(data.cumulative_feed_kg ?? 0) * 1000) / biomassG);
  const previousWeight = number(data.previous_weight_g);
  const previousWeightDate = date(data.previous_weight_date);
  const currentWeight = number(data.average_weight_g);
  const weightDays =
    previousWeightDate == null
      ? null
      : Math.max(
          1,
          Math.round(
            (Date.parse(`${day}T00:00:00Z`) -
              Date.parse(`${previousWeightDate}T00:00:00Z`)) /
              86_400_000,
          ),
        );
  const dailyGain =
    currentWeight == null || previousWeight == null || weightDays == null
      ? null
      : round((currentWeight - previousWeight) / weightDays);
  const expectedLiveBirdPercent =
    initialBirdCount === 0
      ? null
      : round((liveBirdCount / initialBirdCount) * 100);
  const comparisons = {
    feed: compareTarget(number(data.feed_kg), feedTarget, tolerance),
    cumulativeFeed: compareTarget(
      cumulativeFeedPerBird,
      target?.cumulativeFeedGPerBird ?? null,
      tolerance,
    ),
    water: compareTarget(number(data.water_liters), waterTarget, tolerance),
    weight: compareTarget(
      currentWeight,
      target?.targetWeightG ?? null,
      tolerance,
    ),
    dailyGain: compareTarget(
      dailyGain,
      target?.targetDailyGainG ?? null,
      tolerance,
    ),
    feedConversionRatio: compareMaximum(
      feedConversionRatio,
      target?.targetFcr ?? null,
      tolerance,
    ),
    cumulativeMortality: compareMaximum(
      mortalityRate,
      target?.expectedCumulativeMortalityPercent ?? null,
      tolerance,
    ),
    expectedLiveBirds: compareTarget(
      expectedLiveBirdPercent,
      target?.expectedLiveBirdPercent ?? null,
      tolerance,
    ),
    eggLayRate: compareTarget(
      eggLayRate,
      target?.targetEggLayPercent ?? null,
      tolerance,
    ),
    eggCount: compareTarget(
      eggTotal,
      target?.targetEggCount ?? null,
      tolerance,
    ),
    rejectedEggRate: compareMaximum(
      rejectedEggRate,
      target?.maxRejectedEggPercent ?? null,
      tolerance,
    ),
    temperature: compareRange(
      number(data.temperature_c),
      target?.minTemperatureC ?? null,
      target?.maxTemperatureC ?? null,
    ),
    humidity: compareRange(
      number(data.humidity_percent),
      target?.minHumidityPercent ?? null,
      target?.maxHumidityPercent ?? null,
    ),
  };
  const schedules = await client.query<Row>(
    `SELECT vs.*, v.id AS vaccination_id, v.vaccination_date
       FROM poultry_model_vaccine_schedules vs
       LEFT JOIN LATERAL (
         SELECT id, vaccination_date FROM poultry_vaccination_records v
          WHERE v.organization_id = vs.organization_id AND v.flock_id = $2
            AND lower(v.vaccine_name) = lower(vs.vaccine_name)
            AND v.vaccination_date >= $4::date + vs.day_age AND v.vaccination_date <= $3::date
          ORDER BY v.vaccination_date LIMIT 1
       ) v ON TRUE
      WHERE vs.organization_id = $1 AND vs.performance_model_id = $5 AND vs.day_age <= $6
      ORDER BY vs.day_age, vs.vaccine_name`,
    [
      context.organizationId,
      flockId,
      day,
      age.originDate,
      modelId,
      age.ageDays,
    ],
  );
  const vaccines = schedules.rows.map((row) => ({
    ...vaccineScheduleView(row),
    status: row.vaccination_id ? "completed" : "due",
    recordedDate: date(row.vaccination_date),
  }));
  const recommendations: Array<{
    severity: string;
    category: string;
    message: string;
    action: string;
  }> = [...fieldRiskRecommendations];
  if (!target)
    recommendations.push({
      severity: "warning",
      category: "weekly_target",
      message: `No target is configured for week ${age.ageWeek} of ${flock.model_name}.`,
      action: "Add this week to the selected performance model.",
    });
  for (const [name, comparison] of Object.entries(comparisons)) {
    if (comparison.status === "missing_data")
      recommendations.push({
        severity: "warning",
        category: name,
        message: `No ${name} record is available for ${day}.`,
        action:
          "Record today's operational value before reviewing performance.",
      });
    if (comparison.status === "below_target")
      recommendations.push({
        severity: "warning",
        category: name,
        message: `${name} is below the model target by ${Math.abs(comparison.variancePercent ?? 0)}%.`,
        action: "Check the flock, inputs and recorded quantity.",
      });
    if (comparison.status === "above_target")
      recommendations.push({
        severity:
          name === "cumulativeMortality" || name === "rejectedEggRate"
            ? "critical"
            : "warning",
        category: name,
        message: `${name} is above the model limit or target.`,
        action:
          name === "cumulativeMortality"
            ? "Review mortality causes and involve the veterinarian."
            : "Review handling and farm conditions.",
      });
  }
  const dueVaccines = vaccines.filter(
    (item) => item.isRequired && item.status === "due",
  );
  if (dueVaccines.length)
    recommendations.push({
      severity: "critical",
      category: "vaccination",
      message: `${dueVaccines.map((item) => item.vaccineName).join(", ")} is due for this flock age.`,
      action:
        "Assign and complete the vaccination work, then record administration.",
    });
  if (climate?.operationalNote)
    recommendations.push({
      severity: "info",
      category: "climate",
      message: `Climate profile applied: ${climate.operationalNote}`,
      action: "Use the adjusted feed and water targets in today's work.",
    });
  const recommendedDailyWork = [
    ...baseDailyWork.filter((work) => {
      const modelCanReplace =
        (work.workType === "feed_record" &&
          target?.feedGPerBirdPerDay != null) ||
        (work.workType === "water_record" &&
          target?.waterLitersPerBirdPerDay != null) ||
        (work.workType === "weight_check" && target?.targetWeightG != null) ||
        (work.workType === "climate_check" && climate != null) ||
        work.workType === "mortality_review" ||
        (work.workType === "egg_collection" &&
          target?.targetEggLayPercent != null);
      return !modelCanReplace;
    }),
    target?.feedGPerBirdPerDay != null
      ? {
          workType: "feed_record",
          title: "Feed and record consumption",
          details: `Model requirement: ${feedTarget} kg for ${liveBirdCount} live birds.`,
        }
      : null,
    target?.waterLitersPerBirdPerDay != null
      ? {
          workType: "water_record",
          title: "Check water and record consumption",
          details: `Climate-adjusted model requirement: ${waterTarget} L for ${liveBirdCount} live birds.`,
        }
      : null,
    target?.targetWeightG != null
      ? {
          workType: "weight_check",
          title: "Weigh flock sample",
          details: `Week ${age.ageWeek} target average weight: ${target.targetWeightG} g.`,
        }
      : null,
    ["layer", "breeder"].includes(String(flock.production_type)) &&
    target?.targetEggLayPercent != null
      ? {
          workType: "egg_collection",
          title: "Collect and grade eggs",
          details: `Record total, broken, dirty and rejected eggs against the week ${age.ageWeek} model target.`,
        }
      : null,
    {
      workType: "mortality_review",
      title: "Review mortality",
      details: "Confirm all bird deaths are recorded with cause and follow-up.",
    },
    climate
      ? {
          workType: "climate_check",
          title: "Check climate conditions",
          details:
            "Review temperature, humidity and water availability against the assigned climate profile.",
        }
      : null,
    dueVaccines.length
      ? {
          workType: "vaccination",
          title: "Complete scheduled vaccination",
          details: dueVaccines
            .map((item) => `${item.vaccineName} (day ${item.dayAge})`)
            .join(", "),
        }
      : null,
  ].filter(
    (item): item is { workType: string; title: string; details: string } =>
      item !== null,
  );
  return {
    date: day,
    age,
    flock: {
      id: flock.flock_id,
      code: flock.flock_code,
      name: flock.flock_name,
      birdType: flock.bird_type,
      productionType: flock.production_type,
      liveBirdCount,
      expectedLiveBirdCount,
      physicalLiveBirdCount,
      liveBirdDiscrepancy,
      initialBirdCount,
      house: {
        id: flock.house_id,
        code: flock.house_code,
        name: flock.house_name,
      },
      site: { id: flock.site_id, code: flock.site_code, name: flock.site_name },
      province: {
        id: flock.province_id,
        code: flock.province_code,
        name: flock.province_name,
      },
    },
    model: {
      id: flock.model_id,
      code: flock.model_code,
      name: flock.model_name,
      productionType: flock.model_production_type,
      strain: flock.model_strain,
      version: number(flock.model_version),
      climateProfile: climate,
    },
    weeklyTarget: target,
    actual: {
      feedKg: number(data.feed_kg),
      waterLiters: number(data.water_liters),
      averageWeightG: number(data.average_weight_g),
      weightRecordDate: date(data.weight_record_date),
      dailyMortality: Number(data.daily_mortality ?? 0),
      cumulativeMortality,
      mortalityRatePercent: mortalityRate,
      eggs:
        eggTotal == null
          ? null
          : {
              totalEggs: eggTotal,
              brokenEggs,
              dirtyEggs,
              rejectedEggs,
              hatchingEggs,
              saleableEggs: eggTotal - rejectedEggs - hatchingEggs,
              eggLayRatePercent: eggLayRate,
              rejectedEggRatePercent: rejectedEggRate,
            },
    },
    comparisons,
    vaccines,
    operationalBrief: {
      ...operationalBrief,
      weeklyTargetConfigured: Boolean(target),
      readiness: !target
        ? "needs_setup"
        : missingRecords.length
          ? "needs_records"
          : recommendations.some((item) => item.severity === "critical")
            ? "attention"
            : "ready",
    },
    aiPlan,
    recommendedDailyWork,
    recommendations,
  };
}

export async function flockPerformance(
  context: PoultryContext,
  flockId: string,
  input: PerformanceDateQuery,
) {
  return withTenantContext(context, async (client) =>
    buildPerformance(client, context, flockId, input.date),
  );
}

const dailyWorkSelect = `SELECT w.*, f.code AS flock_code, f.name AS flock_name,
  p.id AS province_id, p.code AS province_code, p.name AS province_name,
  assigned_user.full_name AS assigned_member_name,
  completed_user.full_name AS completed_by_member_name,
  reviewed_user.full_name AS reviewed_by_member_name
 FROM poultry_daily_work_items w
 JOIN poultry_flocks f ON f.organization_id = w.organization_id AND f.id = w.flock_id
 JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id
 JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
 JOIN provinces p ON p.organization_id = s.organization_id AND p.id = s.province_id
 LEFT JOIN organization_members assigned_member ON assigned_member.organization_id = w.organization_id AND assigned_member.id = w.assigned_member_id
 LEFT JOIN users assigned_user ON assigned_user.id = assigned_member.user_id
 LEFT JOIN organization_members completed_member ON completed_member.organization_id = w.organization_id AND completed_member.id = w.completed_by_member_id
 LEFT JOIN users completed_user ON completed_user.id = completed_member.user_id
 LEFT JOIN organization_members reviewed_member ON reviewed_member.organization_id = w.organization_id AND reviewed_member.id = w.reviewed_by_member_id
 LEFT JOIN users reviewed_user ON reviewed_user.id = reviewed_member.user_id`;

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function operationalWorkStatus(row: Row) {
  const raw = String(row.status);
  if (
    (raw === "planned" || raw === "in_progress") &&
    String(date(row.work_date)) < todayDate()
  )
    return "overdue";
  return raw;
}

function dailyWorkView(row: Row) {
  return {
    id: row.id,
    workDate: date(row.work_date),
    workType: row.work_type,
    title: row.title,
    details: row.details,
    dueAt: row.due_at,
    status: operationalWorkStatus(row),
    workflowStatus: row.status,
    source: row.source,
    requiresSupervisorApproval: Boolean(row.requires_supervisor_approval),
    approvalStatus: row.approval_status,
    completionNote: row.completion_note,
    flock: { id: row.flock_id, code: row.flock_code, name: row.flock_name },
    assignedMember: row.assigned_member_id
      ? { id: row.assigned_member_id, fullName: row.assigned_member_name }
      : null,
    completedByMember: row.completed_by_member_id
      ? {
          id: row.completed_by_member_id,
          fullName: row.completed_by_member_name,
        }
      : null,
    completedAt: row.completed_at,
    review: row.reviewed_by_member_id
      ? {
          memberId: row.reviewed_by_member_id,
          fullName: row.reviewed_by_member_name,
          reviewedAt: row.reviewed_at,
          notes: row.review_notes,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertDailyWorkVisibility(
  client: PoolClient,
  context: PoultryContext,
  row: Row,
) {
  const scope = await scopeOf(client, context);
  if (scope === "self") {
    if (String(row.assigned_member_id ?? "") !== context.memberId)
      throw new NotFoundError("Poultry daily work item not found");
    return;
  }
  await assertProvince(client, context, row.province_id);
}

async function dailyWorkItem(
  client: PoolClient,
  context: PoultryContext,
  workItemId: string,
): Promise<Row> {
  const result = await client.query<Row>(
    `${dailyWorkSelect}
      WHERE w.organization_id = $1 AND w.id = $2`,
    [context.organizationId, workItemId],
  );
  if (!result.rows[0])
    throw new NotFoundError("Poultry daily work item not found");
  await assertDailyWorkVisibility(client, context, result.rows[0]);
  return result.rows[0];
}

export async function listDailyWork(
  context: PoultryContext,
  flockId: string,
  input: DailyWorkListQuery,
) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context);
    if (scope !== "self") await scopedFlock(client, context, flockId);
    const values: unknown[] = [
      context.organizationId,
      flockId,
      input.date ?? null,
    ];
    const ownOnly =
      scope === "self"
        ? (() => {
            values.push(context.memberId);
            return ` AND w.assigned_member_id = $${values.length}`;
          })()
        : "";
    const result = await client.query<Row>(
      `${dailyWorkSelect}
        WHERE w.organization_id = $1 AND w.flock_id = $2
          AND ($3::date IS NULL OR w.work_date = $3::date)${ownOnly}
        ORDER BY w.work_date, w.due_at NULLS LAST, w.created_at`,
      values,
    );
    return result.rows.map(dailyWorkView);
  });
}

export async function listMyDailyWork(
  context: PoultryContext,
  input: DailyWorkListQuery,
) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      `${dailyWorkSelect}
        WHERE w.organization_id = $1 AND w.assigned_member_id = $2
          AND ($3::date IS NULL OR w.work_date = $3::date)
        ORDER BY w.work_date DESC, w.due_at NULLS LAST, w.created_at`,
      [context.organizationId, context.memberId, input.date ?? null],
    );
    return result.rows.map(dailyWorkView);
  });
}

export async function createDailyWork(
  context: PoultryContext,
  flockId: string,
  input: DailyWorkCreate,
) {
  return withTenantContext(context, async (client) => {
    if ((await scopeOf(client, context)) === "self")
      throw new NotFoundError("Poultry flock not found");
    await scopedFlock(client, context, flockId);
    await checkWorkAssignee(
      client,
      context.organizationId,
      flockId,
      input.assignedMemberId,
    );
    const requiresReview = input.requiresSupervisorApproval ?? true;
    const result = await client.query<{ id: string }>(
      `INSERT INTO poultry_daily_work_items (organization_id, flock_id, work_date, work_type, title, details, due_at, assigned_member_id, requires_supervisor_approval, approval_status, source, created_by_user_id)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7::time, $8, $9, $10, 'manual', $11) RETURNING id`,
      [
        context.organizationId,
        flockId,
        input.workDate,
        input.workType,
        input.title,
        input.details ?? null,
        input.dueAt ?? null,
        input.assignedMemberId ?? null,
        requiresReview,
        requiresReview ? "pending" : "not_required",
        context.userId,
      ],
    );
    return dailyWorkView(
      await dailyWorkItem(client, context, result.rows[0]!.id),
    );
  });
}

export async function updateDailyWork(
  context: PoultryContext,
  workItemId: string,
  input: DailyWorkUpdate,
) {
  return withTenantContext(context, async (client) => {
    const current = await dailyWorkItem(client, context, workItemId);
    const scope = await scopeOf(client, context);
    if (scope === "self") {
      const unsupported = Object.keys(input).filter(
        (field) => field !== "status" && field !== "completionNote",
      );
      if (unsupported.length || !input.status)
        throw new BadRequestError(
          "An employee may only start or complete their assigned work",
        );
      if (!["in_progress", "completed"].includes(input.status))
        throw new BadRequestError(
          "Assigned work can only be started or completed by the employee",
        );
      await client.query(
        `UPDATE poultry_daily_work_items
            SET status = $3,
                completion_note = $4,
                completed_by_member_id = CASE WHEN $3 = 'completed' THEN $5 ELSE completed_by_member_id END,
                completed_at = CASE WHEN $3 = 'completed' THEN now() ELSE completed_at END,
                approval_status = CASE
                  WHEN $3 = 'completed' AND requires_supervisor_approval THEN 'pending'
                  WHEN $3 = 'completed' THEN 'not_required'
                  ELSE approval_status
                END
          WHERE organization_id = $1 AND id = $2`,
        [
          context.organizationId,
          workItemId,
          input.status,
          input.completionNote ?? current.completion_note ?? null,
          context.memberId,
        ],
      );
      return dailyWorkView(await dailyWorkItem(client, context, workItemId));
    }

    if (input.assignedMemberId !== undefined)
      await checkWorkAssignee(
        client,
        context.organizationId,
        String(current.flock_id),
        input.assignedMemberId,
      );
    await updateStatic(
      client,
      context,
      "poultry_daily_work_items",
      workItemId,
      {
        workDate: "work_date",
        workType: "work_type",
        title: "title",
        details: "details",
        dueAt: "due_at",
        assignedMemberId: "assigned_member_id",
        status: "status",
        completionNote: "completion_note",
        requiresSupervisorApproval: "requires_supervisor_approval",
      },
      input,
    );
    if (input.status === "completed") {
      await client.query(
        `UPDATE poultry_daily_work_items
            SET completed_by_member_id = $3, completed_at = now(),
                approval_status = CASE WHEN requires_supervisor_approval THEN 'pending' ELSE 'not_required' END
          WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, workItemId, context.memberId],
      );
    }
    return dailyWorkView(await dailyWorkItem(client, context, workItemId));
  });
}

export async function reviewDailyWork(
  context: PoultryContext,
  workItemId: string,
  input: DailyWorkReview,
) {
  return withTenantContext(context, async (client) => {
    const current = await dailyWorkItem(client, context, workItemId);
    if ((await scopeOf(client, context)) === "self")
      throw new NotFoundError("Poultry daily work item not found");
    if (String(current.status) !== "completed")
      throw new BadRequestError("Only completed work can be reviewed");
    if (!Boolean(current.requires_supervisor_approval))
      throw new BadRequestError(
        "This work does not require supervisor approval",
      );
    if (
      input.decision === "approved" &&
      String(current.completed_by_member_id ?? "") === context.memberId
    )
      throw new BadRequestError(
        "The person who completed the work cannot approve it",
      );
    await client.query(
      `INSERT INTO poultry_daily_work_reviews (organization_id, work_item_id, decision, review_notes, reviewed_by_member_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        context.organizationId,
        workItemId,
        input.decision,
        input.reviewNotes ?? null,
        context.memberId,
      ],
    );
    await client.query(
      `UPDATE poultry_daily_work_items
          SET approval_status = $3,
              status = CASE WHEN $3 = 'returned' THEN 'in_progress' ELSE status END,
              reviewed_by_member_id = $4,
              reviewed_at = now(),
              review_notes = $5
        WHERE organization_id = $1 AND id = $2`,
      [
        context.organizationId,
        workItemId,
        input.decision,
        context.memberId,
        input.reviewNotes ?? null,
      ],
    );
    return dailyWorkView(await dailyWorkItem(client, context, workItemId));
  });
}

export async function generateDailyWork(
  context: PoultryContext,
  flockId: string,
  input: DailyWorkGenerateBody,
) {
  return withTenantContext(context, async (client) => {
    if ((await scopeOf(client, context)) === "self")
      throw new NotFoundError("Poultry flock not found");
    await checkWorkAssignee(
      client,
      context.organizationId,
      flockId,
      input.assignedMemberId,
    );
    const performance = await buildPerformance(
      client,
      context,
      flockId,
      input.workDate,
    );
    const requiresReview = input.requiresSupervisorApproval ?? true;
    for (const work of performance.recommendedDailyWork) {
      await client.query(
        `INSERT INTO poultry_daily_work_items (organization_id, flock_id, work_date, work_type, title, details, assigned_member_id, requires_supervisor_approval, approval_status, source, created_by_user_id)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, 'model', $10)
         ON CONFLICT (organization_id, flock_id, work_date, work_type, source) DO UPDATE
           SET assigned_member_id = EXCLUDED.assigned_member_id,
               requires_supervisor_approval = EXCLUDED.requires_supervisor_approval,
               approval_status = CASE WHEN EXCLUDED.requires_supervisor_approval THEN 'pending' ELSE 'not_required' END
         WHERE poultry_daily_work_items.status IN ('planned', 'in_progress')`,
        [
          context.organizationId,
          flockId,
          performance.date,
          work.workType,
          work.title,
          work.details,
          input.assignedMemberId ?? null,
          requiresReview,
          requiresReview ? "pending" : "not_required",
          context.userId,
        ],
      );
    }
    const result = await client.query<Row>(
      `${dailyWorkSelect}
        WHERE w.organization_id = $1 AND w.flock_id = $2 AND w.work_date = $3::date
        ORDER BY w.due_at NULLS LAST, w.created_at`,
      [context.organizationId, flockId, performance.date],
    );
    return result.rows.map(dailyWorkView);
  });
}
