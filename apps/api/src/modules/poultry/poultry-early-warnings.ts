import type { PoolClient } from "pg";

/**
 * Early warnings for active flocks. A drop in water or feed intake, a jump in
 * mortality or a bad house climate usually shows one to three days before a
 * disease or a stress problem becomes visible. These rules compare each flock
 * with its own recent days, so they work without any configuration.
 *
 * Shared by the management cockpit (poultry insights) and the alert engine.
 */
export type EarlyWarningCode =
  | "water_drop"
  | "feed_drop"
  | "mortality_spike"
  | "temperature_out_of_range"
  | "humidity_out_of_range"
  | "ammonia_high"
  | "records_missing";

export interface EarlyWarning {
  flockId: string;
  flockCode: string;
  flockName: string;
  siteId: string | null;
  provinceId: string | null;
  code: EarlyWarningCode;
  severity: "medium" | "high" | "critical";
  date: string;
  observed: number | null;
  reference: number | null;
  /** English sentence for the alert centre; the web app renders its own text from the numbers. */
  message: string;
}

type Row = Record<string, unknown>;
type Series = Map<string, Map<string, number>>;

/** Fraction under the usual level that is reported as a drop. */
export const INTAKE_DROP_RATIO = 0.15;
/** Ammonia limit commonly used for poultry houses (ppm). */
export const AMMONIA_LIMIT_PPM = 25;

const operational = ["active", "quarantined", "ready_for_sale"];

function addDays(day: string, days: number) {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function series(rows: Row[], key: string): Series {
  const result: Series = new Map();
  for (const row of rows) {
    const flockId = String(row.flock_id);
    const day = String(row.day);
    const value = Number(row[key] ?? 0);
    if (!result.has(flockId)) result.set(flockId, new Map());
    result.get(flockId)!.set(day, value);
  }
  return result;
}

/**
 * Latest day (today or yesterday) compared with the average of the up to three
 * previous recorded days. At least two previous days are needed.
 */
function intakeDrop(days: Map<string, number> | undefined, today: string) {
  if (!days) return null;
  const latest = [today, addDays(today, -1)].find((day) => days.has(day));
  if (!latest) return null;
  const previous: number[] = [];
  for (let offset = 1; offset <= 6 && previous.length < 3; offset += 1) {
    const value = days.get(addDays(latest, -offset));
    if (value != null && value > 0) previous.push(value);
  }
  if (previous.length < 2) return null;
  const usual = previous.reduce((sum, value) => sum + value, 0) / previous.length;
  const observed = days.get(latest) ?? 0;
  if (usual <= 0 || observed >= usual * (1 - INTAKE_DROP_RATIO)) return null;
  return { day: latest, observed, usual, drop: (usual - observed) / usual };
}

const round = (value: number, places = 1) =>
  Number(value.toFixed(places));

export async function poultryEarlyWarnings(
  client: PoolClient,
  organizationId: string,
  flockIds?: string[],
  today = new Date().toISOString().slice(0, 10),
): Promise<EarlyWarning[]> {
  const flocks = await client.query<Row>(
    `SELECT f.id, f.code, f.name, f.mortality_review_threshold, f.hatch_date::text AS hatch_date,
            f.arrival_date::text AS arrival_date, COALESCE(f.starting_age_days, 0) AS starting_age_days,
            f.performance_model_id, s.id AS site_id, s.province_id
       FROM poultry_flocks f
       JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id
       JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
      WHERE f.organization_id = $1 AND f.status = ANY($2::text[])
        AND ($3::uuid[] IS NULL OR f.id = ANY($3::uuid[]))`,
    [organizationId, operational, flockIds ?? null],
  );
  if (!flocks.rowCount) return [];
  const ids = flocks.rows.map((row) => String(row.id));
  const since = addDays(today, -8);
  const [water, feed, deaths, climate, activity] = await Promise.all([
    client.query<Row>(
      `SELECT flock_id, water_date::text AS day, SUM(volume_liters) AS value
         FROM poultry_water_records
        WHERE organization_id = $1 AND flock_id = ANY($2::uuid[]) AND water_date BETWEEN $3::date AND $4::date
        GROUP BY flock_id, water_date`,
      [organizationId, ids, since, today],
    ),
    client.query<Row>(
      `SELECT flock_id, feed_date::text AS day, SUM(quantity_kg) AS value
         FROM poultry_feed_records
        WHERE organization_id = $1 AND flock_id = ANY($2::uuid[]) AND feed_date BETWEEN $3::date AND $4::date
        GROUP BY flock_id, feed_date`,
      [organizationId, ids, since, today],
    ),
    client.query<Row>(
      `SELECT flock_id, mortality_date::text AS day, SUM(death_count) AS value
         FROM poultry_mortality_records
        WHERE organization_id = $1 AND flock_id = ANY($2::uuid[]) AND mortality_date BETWEEN $3::date AND $4::date
        GROUP BY flock_id, mortality_date`,
      [organizationId, ids, since, today],
    ),
    client.query<Row>(
      `SELECT DISTINCT ON (d.flock_id) d.flock_id, d.record_date::text AS day,
              d.temperature_c, d.humidity_percent, d.ammonia_ppm
         FROM poultry_daily_records d
        WHERE d.organization_id = $1 AND d.flock_id = ANY($2::uuid[])
          AND d.record_date BETWEEN $3::date AND $4::date
          AND (d.temperature_c IS NOT NULL OR d.humidity_percent IS NOT NULL OR d.ammonia_ppm IS NOT NULL)
        ORDER BY d.flock_id, d.record_date DESC, d.created_at DESC`,
      [organizationId, ids, addDays(today, -1), today],
    ),
    client.query<Row>(
      `SELECT flock_id, MAX(day)::text AS last_day FROM (
         SELECT flock_id, record_date AS day FROM poultry_daily_records WHERE organization_id = $1 AND flock_id = ANY($2::uuid[])
         UNION ALL SELECT flock_id, feed_date FROM poultry_feed_records WHERE organization_id = $1 AND flock_id = ANY($2::uuid[])
         UNION ALL SELECT flock_id, water_date FROM poultry_water_records WHERE organization_id = $1 AND flock_id = ANY($2::uuid[])
         UNION ALL SELECT flock_id, mortality_date FROM poultry_mortality_records WHERE organization_id = $1 AND flock_id = ANY($2::uuid[])
         UNION ALL SELECT flock_id, record_date FROM poultry_egg_records WHERE organization_id = $1 AND flock_id = ANY($2::uuid[])
       ) activity GROUP BY flock_id`,
      [organizationId, ids],
    ),
  ]);
  const waterByFlock = series(water.rows, "value");
  const feedByFlock = series(feed.rows, "value");
  const deathsByFlock = series(deaths.rows, "value");
  const climateByFlock = new Map(climate.rows.map((row) => [String(row.flock_id), row]));
  const lastActivity = new Map(activity.rows.map((row) => [String(row.flock_id), String(row.last_day ?? "")]));

  // Climate limits of the current week of the flock's performance model.
  const modelIds = [...new Set(flocks.rows.map((row) => row.performance_model_id).filter(Boolean))] as string[];
  const targets = modelIds.length
    ? await client.query<Row>(
        `SELECT performance_model_id, week_number, min_temperature_c, max_temperature_c,
                min_humidity_percent, max_humidity_percent
           FROM poultry_model_week_targets
          WHERE organization_id = $1 AND performance_model_id = ANY($2::uuid[])`,
        [organizationId, modelIds],
      )
    : { rows: [] as Row[] };

  const warnings: EarlyWarning[] = [];
  for (const flock of flocks.rows) {
    const flockId = String(flock.id);
    const base = {
      flockId,
      flockCode: String(flock.code),
      flockName: String(flock.name),
      siteId: (flock.site_id as string | null) ?? null,
      provinceId: (flock.province_id as string | null) ?? null,
    };
    const name = String(flock.name);

    const waterDrop = intakeDrop(waterByFlock.get(flockId), today);
    if (waterDrop)
      warnings.push({
        ...base,
        code: "water_drop",
        severity: waterDrop.drop >= 0.25 ? "critical" : "high",
        date: waterDrop.day,
        observed: round(waterDrop.observed),
        reference: round(waterDrop.usual),
        message: `${name}: water intake fell ${Math.round(waterDrop.drop * 100)}% (${round(waterDrop.observed)} L vs ${round(waterDrop.usual)} L usual). Check drinkers, heat and bird health.`,
      });

    const feedDrop = intakeDrop(feedByFlock.get(flockId), today);
    if (feedDrop)
      warnings.push({
        ...base,
        code: "feed_drop",
        severity: feedDrop.drop >= 0.25 ? "critical" : "high",
        date: feedDrop.day,
        observed: round(feedDrop.observed),
        reference: round(feedDrop.usual),
        message: `${name}: feed intake fell ${Math.round(feedDrop.drop * 100)}% (${round(feedDrop.observed)} kg vs ${round(feedDrop.usual)} kg usual). Check feeders and bird health.`,
      });

    const deathDays = deathsByFlock.get(flockId);
    if (deathDays) {
      const latest = [today, addDays(today, -1)].find((day) => deathDays.has(day));
      if (latest) {
        let total = 0;
        for (let offset = 1; offset <= 7; offset += 1)
          total += deathDays.get(addDays(latest, -offset)) ?? 0;
        const usual = total / 7;
        const observed = deathDays.get(latest) ?? 0;
        const threshold = Math.max(3, Number(flock.mortality_review_threshold ?? 1));
        if (observed >= threshold && observed > usual * 2)
          warnings.push({
            ...base,
            code: "mortality_spike",
            severity: usual > 0 && observed >= usual * 4 ? "critical" : "high",
            date: latest,
            observed,
            reference: round(usual),
            message: `${name}: ${observed} deaths on ${latest}, against ${round(usual)} per day over the previous week. Inspect the birds and call the veterinarian if it continues.`,
          });
      }
    }

    const climateRow = climateByFlock.get(flockId);
    if (climateRow) {
      const day = String(climateRow.day);
      const origin = String(flock.hatch_date ?? flock.arrival_date);
      const ageDays =
        Number(flock.starting_age_days ?? 0) +
        Math.max(0, Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${origin}T00:00:00Z`)) / 86_400_000));
      const week = Math.floor(ageDays / 7) + 1;
      const target = targets.rows.find(
        (row) => row.performance_model_id === flock.performance_model_id && Number(row.week_number) === week,
      );
      const temperature = climateRow.temperature_c == null ? null : Number(climateRow.temperature_c);
      if (target && temperature != null) {
        const min = target.min_temperature_c == null ? null : Number(target.min_temperature_c);
        const max = target.max_temperature_c == null ? null : Number(target.max_temperature_c);
        const outside = (min != null && temperature < min) || (max != null && temperature > max);
        if (outside) {
          const limit = min != null && temperature < min ? min : max!;
          warnings.push({
            ...base,
            code: "temperature_out_of_range",
            severity: Math.abs(temperature - limit) >= 4 ? "high" : "medium",
            date: day,
            observed: temperature,
            reference: limit,
            message: `${name}: house temperature ${temperature} °C is outside the week ${week} range (${min ?? "–"} to ${max ?? "–"} °C).`,
          });
        }
      }
      const humidity = climateRow.humidity_percent == null ? null : Number(climateRow.humidity_percent);
      if (target && humidity != null) {
        const min = target.min_humidity_percent == null ? null : Number(target.min_humidity_percent);
        const max = target.max_humidity_percent == null ? null : Number(target.max_humidity_percent);
        if ((min != null && humidity < min) || (max != null && humidity > max))
          warnings.push({
            ...base,
            code: "humidity_out_of_range",
            severity: "medium",
            date: day,
            observed: humidity,
            reference: min != null && humidity < min ? min : max,
            message: `${name}: humidity ${humidity}% is outside the week ${week} range (${min ?? "–"} to ${max ?? "–"}%).`,
          });
      }
      const ammonia = climateRow.ammonia_ppm == null ? null : Number(climateRow.ammonia_ppm);
      if (ammonia != null && ammonia >= AMMONIA_LIMIT_PPM)
        warnings.push({
          ...base,
          code: "ammonia_high",
          severity: ammonia >= AMMONIA_LIMIT_PPM * 2 ? "critical" : "high",
          date: day,
          observed: ammonia,
          reference: AMMONIA_LIMIT_PPM,
          message: `${name}: ammonia ${ammonia} ppm (limit ${AMMONIA_LIMIT_PPM} ppm). Improve ventilation and change wet litter.`,
        });
    }

    const last = lastActivity.get(flockId);
    const missingSince = last ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000) : null;
    if (missingSince == null || missingSince >= 2)
      warnings.push({
        ...base,
        code: "records_missing",
        severity: missingSince == null || missingSince >= 4 ? "high" : "medium",
        date: today,
        observed: missingSince,
        reference: 1,
        message: last
          ? `${name}: nothing has been recorded for ${missingSince} days. Problems cannot be detected without daily data.`
          : `${name}: no daily data has been recorded yet.`,
      });
  }
  const order = { critical: 0, high: 1, medium: 2 } as const;
  return warnings.sort((a, b) => order[a.severity] - order[b.severity]);
}
