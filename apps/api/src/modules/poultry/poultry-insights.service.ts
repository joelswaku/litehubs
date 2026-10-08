import type { PoolClient } from "pg";
import { NotFoundError } from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import { poultryEarlyWarnings } from "./poultry-early-warnings";
import {
  addScope,
  addSelfSiteScope,
  ownEmployeePoultryLocation,
  scopeOf,
  type PoultryContext,
} from "./poultry.service";

/**
 * Management cockpit for poultry: one place to answer "is each flock making
 * money and is anything going wrong?". Everything is calculated from the
 * records the team already enters; nothing is stored twice.
 *
 *  - indicators: viability, feed conversion (IC/FCR), IEP/EPEF, uniformity,
 *    hen-day laying rate, compared between flocks and houses;
 *  - real-time cost price: chicks, feed, other costs, per bird / kg / egg,
 *    revenue from delivered sales and margin;
 *  - egg stock, withdrawal periods (délais d'attente), forecasts;
 *  - house sanitary downtime (vide sanitaire) and early warnings.
 */

type Row = Record<string, unknown>;

export interface InsightsQuery {
  siteId?: string;
  provinceId?: string;
  productionType?: "broiler" | "layer" | "breeder";
  /** Closed flocks of the last N days are kept for comparison (default 365). */
  closedWithinDays?: number;
  /** Sale weight used for broiler forecasts when the model has none (grams). */
  targetWeightG?: number;
}

export const FLOCK_COST_CATEGORIES = [
  "feed",
  "health",
  "labour",
  "energy",
  "litter",
  "water",
  "transport",
  "slaughter",
  "equipment",
  "other",
] as const;

const operationalStatuses = ["active", "quarantined", "ready_for_sale"];
const closedStatuses = ["closed", "sold", "depleted"];

const num = (value: unknown) => (value == null ? 0 : Number(value));
const maybe = (value: unknown) =>
  value == null || value === "" ? null : Number(value);
const round = (value: number | null, places = 2) =>
  value == null || !Number.isFinite(value)
    ? null
    : Number(value.toFixed(places));

function daysBetween(from: string, to: string) {
  return Math.floor(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}
function addDays(day: string, days: number) {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function byFlock(rows: Row[]) {
  return new Map(rows.map((row) => [String(row.flock_id), row]));
}

/** IEP / EPEF = viability % × weight kg ÷ (age days × FCR) × 100. */
export function productionIndex(
  viabilityPercent: number | null,
  weightKg: number | null,
  ageDays: number | null,
  fcr: number | null,
) {
  if (!viabilityPercent || !weightKg || !ageDays || !fcr) return null;
  return Math.round(((viabilityPercent * weightKg) / (ageDays * fcr)) * 100);
}

async function flocksInScope(
  client: PoolClient,
  context: PoultryContext,
  input: InsightsQuery,
) {
  const scope = await scopeOf(client, context);
  const values: unknown[] = [context.organizationId];
  const conditions = ["f.organization_id = $1"];
  if (scope === "self" || scope === "site") {
    const location = await ownEmployeePoultryLocation(client, context);
    if (!location) return { scope, rows: [] as Row[], houses: [] as Row[] };
    conditions.push(addSelfSiteScope(location.siteId, "h.site_id", values));
  } else conditions.push(addScope(scope, context, "s.province_id", values));
  if (input.siteId) {
    values.push(input.siteId);
    conditions.push(`h.site_id = $${values.length}`);
  }
  if (input.provinceId) {
    values.push(input.provinceId);
    conditions.push(`s.province_id = $${values.length}`);
  }
  const houseConditions = conditions.slice(1).join(" AND ");
  const houseValues = [...values];
  if (input.productionType) {
    values.push(input.productionType);
    conditions.push(
      `COALESCE(f.production_type, f.bird_type) = $${values.length}`,
    );
  }
  values.push(operationalStatuses, closedStatuses, input.closedWithinDays ?? 365);
  const n = values.length;
  const flocks = await client.query<Row>(
    `SELECT f.id, f.code, f.name, f.status, f.bird_type,
            COALESCE(f.production_type, f.bird_type) AS production_type,
            f.breed, f.source_name, f.initial_bird_count, f.purchase_cost_total, f.cost_per_bird,
            f.hatch_date::text AS hatch_date, f.arrival_date::text AS arrival_date,
            COALESCE(f.starting_age_days, 0) AS starting_age_days, f.closed_at::text AS closed_at,
            f.final_live_bird_count, f.performance_model_id,
            h.id AS house_id, h.code AS house_code, h.name AS house_name,
            s.id AS site_id, s.name AS site_name
       FROM poultry_flocks f
       JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id
       JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
      WHERE ${conditions.join(" AND ")}
        AND (f.status = ANY($${n - 2}::text[])
             OR (f.status = ANY($${n - 1}::text[])
                 AND COALESCE(f.closed_at, f.updated_at::date) >= CURRENT_DATE - $${n}::int))
      ORDER BY f.arrival_date DESC, f.name`,
    values,
  );
  const houses = await client.query<Row>(
    `SELECT h.id, h.code, h.name, h.house_type, h.capacity, h.operational_status,
            COALESCE(h.min_downtime_days, 14) AS min_downtime_days,
            s.id AS site_id, s.name AS site_name
       FROM poultry_houses h
       JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
      WHERE h.organization_id = $1${houseConditions ? ` AND ${houseConditions}` : ""}
      ORDER BY s.name, h.name`,
    houseValues,
  );
  return { scope, rows: flocks.rows, houses: houses.rows };
}

export async function poultryInsights(
  context: PoultryContext,
  input: InsightsQuery,
  options: { includeFinance: boolean },
) {
  return withTenantContext(context, async (client) => {
    const today = new Date().toISOString().slice(0, 10);
    const { rows: flocks, houses } = await flocksInScope(client, context, input);
    const ids = flocks.map((row) => String(row.id));
    const org = await client.query<{ currency: string }>(
      "SELECT currency FROM organizations WHERE id = $1",
      [context.organizationId],
    );
    const currency = org.rows[0]?.currency ?? "USD";

    const empty = { rows: [] as Row[] };
    const q = (sql: string, extra: unknown[] = []) =>
      ids.length
        ? client.query<Row>(sql, [context.organizationId, ids, ...extra])
        : Promise.resolve(empty);

    const [
      mortality,
      movements,
      feed,
      water,
      weights,
      previousWeights,
      eggs,
      eggsWeek,
      recentFeed,
      costs,
      sales,
      withdrawals,
      climate,
      targets,
    ] = await Promise.all([
      q(`SELECT flock_id, SUM(death_count) AS deaths FROM poultry_mortality_records
          WHERE organization_id = $1 AND flock_id = ANY($2::uuid[]) GROUP BY flock_id`),
      q(`SELECT flock_id, SUM(arrivals_count) AS arrivals, SUM(transfers_out_count) AS transfers_out,
                SUM(culls_count) AS culls FROM poultry_daily_records
          WHERE organization_id = $1 AND flock_id = ANY($2::uuid[]) GROUP BY flock_id`),
      // Feed cost: stock issue cost first, then the price typed on the record.
      q(`SELECT r.flock_id, SUM(r.quantity_kg) AS feed_kg,
                SUM(r.quantity_kg * COALESCE(m.unit_cost, CASE WHEN m.id IS NOT NULL THEN i.standard_unit_cost END, r.unit_price)) AS feed_cost,
                SUM(CASE WHEN COALESCE(m.unit_cost, CASE WHEN m.id IS NOT NULL THEN i.standard_unit_cost END, r.unit_price) IS NULL THEN r.quantity_kg ELSE 0 END) AS unpriced_kg
           FROM poultry_feed_records r
           LEFT JOIN LATERAL (
             SELECT sm.id, sm.unit_cost, sm.item_id FROM management_inventory_stock_movements sm
              WHERE sm.organization_id = r.organization_id AND sm.reference_type = 'poultry_feed'
                AND sm.reference_id = r.id AND sm.movement_type = 'issue'
              ORDER BY sm.created_at DESC LIMIT 1
           ) m ON TRUE
           LEFT JOIN management_inventory_items i ON i.organization_id = r.organization_id AND i.id = m.item_id
          WHERE r.organization_id = $1 AND r.flock_id = ANY($2::uuid[]) GROUP BY r.flock_id`),
      q(`SELECT flock_id, SUM(volume_liters) AS water_liters FROM poultry_water_records
          WHERE organization_id = $1 AND flock_id = ANY($2::uuid[]) GROUP BY flock_id`),
      q(`SELECT DISTINCT ON (flock_id) flock_id, record_date::text AS record_date, average_weight_g, uniformity_percent
           FROM poultry_weight_records WHERE organization_id = $1 AND flock_id = ANY($2::uuid[])
          ORDER BY flock_id, record_date DESC, created_at DESC`),
      q(`SELECT flock_id, record_date::text AS record_date, average_weight_g FROM (
           SELECT flock_id, record_date, average_weight_g,
                  ROW_NUMBER() OVER (PARTITION BY flock_id ORDER BY record_date DESC, created_at DESC) AS position
             FROM poultry_weight_records WHERE organization_id = $1 AND flock_id = ANY($2::uuid[])
         ) ranked WHERE position = 2`),
      q(`SELECT flock_id, SUM(total_eggs) AS total_eggs,
                SUM(total_eggs - cracked_eggs - dirty_eggs - hatching_eggs - COALESCE(rejected_eggs, 0)) AS saleable_eggs,
                SUM(cracked_eggs + dirty_eggs + COALESCE(rejected_eggs, 0)) AS downgraded_eggs
           FROM poultry_egg_records WHERE organization_id = $1 AND flock_id = ANY($2::uuid[]) GROUP BY flock_id`),
      q(
        `SELECT flock_id, SUM(total_eggs) AS eggs, COUNT(DISTINCT record_date) AS days
           FROM poultry_egg_records WHERE organization_id = $1 AND flock_id = ANY($2::uuid[])
            AND record_date > $3::date - 7 GROUP BY flock_id`,
        [today],
      ),
      q(
        `SELECT flock_id, SUM(quantity_kg) AS feed_kg, COUNT(DISTINCT feed_date) AS days
           FROM poultry_feed_records WHERE organization_id = $1 AND flock_id = ANY($2::uuid[])
            AND feed_date > $3::date - 3 GROUP BY flock_id`,
        [today],
      ),
      q(`SELECT flock_id, category, SUM(amount) AS amount FROM poultry_flock_costs
          WHERE organization_id = $1 AND flock_id = ANY($2::uuid[]) GROUP BY flock_id, category`),
      q(
        `SELECT offer.source_id AS flock_id,
                SUM(CASE WHEN offer.source_type = 'egg_flock' THEN line.delivered_quantity ELSE 0 END) AS eggs_sold,
                SUM(CASE WHEN offer.source_type = 'poultry_flock' THEN line.delivered_quantity ELSE 0 END) AS birds_sold,
                SUM(line.delivered_quantity * line.unit_price * (1 - line.discount_percent / 100)) AS revenue
           FROM sales_order_lines line
           JOIN sales_orders sale ON sale.organization_id = line.organization_id AND sale.id = line.order_id
           JOIN sales_operational_offers offer ON offer.organization_id = line.organization_id AND offer.id = line.operational_offer_id
          WHERE line.organization_id = $1 AND offer.source_id = ANY($2::uuid[])
            AND offer.source_type IN ('egg_flock', 'poultry_flock') AND sale.currency = $3
            AND sale.status IN ('partially_delivered', 'delivered', 'invoiced')
          GROUP BY offer.source_id`,
        [currency],
      ),
      q(
        `SELECT flock_id, product_name, withdrawal_end_date::text AS until
           FROM poultry_treatment_records
          WHERE organization_id = $1 AND flock_id = ANY($2::uuid[])
            AND withdrawal_end_date IS NOT NULL AND withdrawal_end_date >= $3::date
          ORDER BY withdrawal_end_date DESC`,
        [today],
      ),
      q(`SELECT DISTINCT ON (flock_id) flock_id, record_date::text AS record_date, temperature_c,
                humidity_percent, ammonia_ppm, light_hours
           FROM poultry_daily_records WHERE organization_id = $1 AND flock_id = ANY($2::uuid[])
            AND (temperature_c IS NOT NULL OR humidity_percent IS NOT NULL OR ammonia_ppm IS NOT NULL OR light_hours IS NOT NULL)
          ORDER BY flock_id, record_date DESC, created_at DESC`),
      q(`SELECT f.id AS flock_id, t.week_number, t.target_weight_g, t.target_fcr, t.target_egg_lay_percent
           FROM poultry_flocks f
           JOIN poultry_model_week_targets t ON t.organization_id = f.organization_id
            AND t.performance_model_id = f.performance_model_id
          WHERE f.organization_id = $1 AND f.id = ANY($2::uuid[])`),
    ]);

    const mortalityMap = byFlock(mortality.rows);
    const movementMap = byFlock(movements.rows);
    const feedMap = byFlock(feed.rows);
    const waterMap = byFlock(water.rows);
    const weightMap = byFlock(weights.rows);
    const previousWeightMap = byFlock(previousWeights.rows);
    const eggMap = byFlock(eggs.rows);
    const eggWeekMap = byFlock(eggsWeek.rows);
    const recentFeedMap = byFlock(recentFeed.rows);
    const salesMap = byFlock(sales.rows);
    const climateMap = byFlock(climate.rows);
    const costMap = new Map<string, Record<string, number>>();
    for (const row of costs.rows) {
      const key = String(row.flock_id);
      if (!costMap.has(key)) costMap.set(key, {});
      costMap.get(key)![String(row.category)] = num(row.amount);
    }
    const withdrawalMap = new Map<string, { product: string; until: string }[]>();
    for (const row of withdrawals.rows) {
      const key = String(row.flock_id);
      if (!withdrawalMap.has(key)) withdrawalMap.set(key, []);
      withdrawalMap.get(key)!.push({
        product: String(row.product_name),
        until: String(row.until),
      });
    }
    const targetMap = new Map<string, Row[]>();
    for (const row of targets.rows) {
      const key = String(row.flock_id);
      if (!targetMap.has(key)) targetMap.set(key, []);
      targetMap.get(key)!.push(row);
    }

    // Feed in stock at each site, to know how many days it will last.
    const siteIds = [...new Set(flocks.map((row) => String(row.site_id)))];
    const stock = siteIds.length
      ? await client.query<Row>(
          `SELECT w.site_id, SUM(st.quantity_on_hand - st.quantity_reserved) AS feed_kg
             FROM management_inventory_stock st
             JOIN management_warehouses w ON w.organization_id = st.organization_id AND w.id = st.warehouse_id
             JOIN management_inventory_items i ON i.organization_id = st.organization_id AND i.id = st.item_id
            WHERE st.organization_id = $1 AND w.site_id = ANY($2::uuid[]) AND w.is_active AND i.is_active
              AND lower(i.unit) IN ('kg', 'kilogram', 'kilogramme', 'kilogrammes')
              AND (lower(COALESCE(i.category, '')) LIKE '%feed%' OR lower(COALESCE(i.category, '')) LIKE '%aliment%')
            GROUP BY w.site_id`,
          [context.organizationId, siteIds],
        )
      : empty;
    const siteFeedStock = new Map(
      stock.rows.map((row) => [String(row.site_id), num(row.feed_kg)]),
    );
    const siteDailyFeed = new Map<string, number>();

    const flockViews = flocks.map((row) => {
      const id = String(row.id);
      const isActive = operationalStatuses.includes(String(row.status));
      const productionType = String(row.production_type);
      const isLayer = ["layer", "breeder"].includes(productionType);
      const initial = num(row.initial_bird_count);
      const deaths = num(mortalityMap.get(id)?.deaths);
      const move = movementMap.get(id);
      const culls = num(move?.culls);
      const liveBirds = Math.max(
        0,
        initial + num(move?.arrivals) - num(move?.transfers_out) - culls - deaths,
      );
      const birdsKept = Math.max(0, initial - deaths - culls);
      const viability = initial ? (birdsKept / initial) * 100 : null;
      const endDay = isActive ? today : String(row.closed_at ?? today);
      const origin = String(row.hatch_date ?? row.arrival_date);
      const ageDays =
        num(row.starting_age_days) + Math.max(0, daysBetween(origin, endDay));
      const ageWeek = Math.floor(ageDays / 7) + 1;
      const weight = weightMap.get(id);
      const weightG = maybe(weight?.average_weight_g);
      const weightKg = weightG == null ? null : weightG / 1000;
      const feedKg = num(feedMap.get(id)?.feed_kg);
      const liveKg = weightKg == null ? null : birdsKept * weightKg;
      const fcr =
        !isLayer && liveKg && liveKg > 0 && feedKg > 0 ? feedKg / liveKg : null;
      const iep = isLayer
        ? null
        : productionIndex(viability, weightKg, ageDays, fcr);

      const eggRow = eggMap.get(id);
      const totalEggs = num(eggRow?.total_eggs);
      const saleableEggs = num(eggRow?.saleable_eggs);
      const eggWeek = eggWeekMap.get(id);
      const layingRate =
        isLayer && eggWeek && num(eggWeek.days) > 0 && liveBirds > 0
          ? (num(eggWeek.eggs) / (liveBirds * num(eggWeek.days))) * 100
          : null;
      const feedPerEgg =
        isLayer && totalEggs > 0 && feedKg > 0 ? (feedKg * 1000) / totalEggs : null;

      const weekTargets = targetMap.get(id) ?? [];
      const weekTarget = weekTargets.find(
        (target) => num(target.week_number) === ageWeek,
      );
      const finalTargetWeight = weekTargets
        .map((target) => maybe(target.target_weight_g))
        .filter((value): value is number => value != null)
        .reduce((max, value) => Math.max(max, value), 0);

      // Cost price.
      const chicks =
        maybe(row.purchase_cost_total) ??
        (row.cost_per_bird == null ? null : num(row.cost_per_bird) * initial);
      const feedCost = num(feedMap.get(id)?.feed_cost);
      const unpricedFeedKg = num(feedMap.get(id)?.unpriced_kg);
      const otherCosts = costMap.get(id) ?? {};
      const otherTotal = Object.values(otherCosts).reduce((a, b) => a + b, 0);
      const totalCost = (chicks ?? 0) + feedCost + otherTotal;
      const sale = salesMap.get(id);
      const revenue = num(sale?.revenue);
      const eggsSold = num(sale?.eggs_sold);
      const birdsSold = num(sale?.birds_sold);

      // Forecasts for running flocks.
      const recent = recentFeedMap.get(id);
      const dailyFeed =
        isActive && recent && num(recent.days) > 0
          ? num(recent.feed_kg) / num(recent.days)
          : null;
      if (dailyFeed)
        siteDailyFeed.set(
          String(row.site_id),
          (siteDailyFeed.get(String(row.site_id)) ?? 0) + dailyFeed,
        );
      const previous = previousWeightMap.get(id);
      let dailyGainG: number | null = null;
      if (weight && previous) {
        const gap = daysBetween(String(previous.record_date), String(weight.record_date));
        if (gap > 0)
          dailyGainG = (num(weight.average_weight_g) - num(previous.average_weight_g)) / gap;
      }
      const saleWeightG =
        finalTargetWeight > 0 ? finalTargetWeight : (input.targetWeightG ?? 2200);
      let daysToSaleWeight: number | null = null;
      if (isActive && !isLayer && weightG != null) {
        if (weightG >= saleWeightG) daysToSaleWeight = 0;
        else if (dailyGainG && dailyGainG > 0)
          daysToSaleWeight = Math.ceil((saleWeightG - weightG) / dailyGainG);
      }
      const climateRow = climateMap.get(id);

      return {
        id,
        code: row.code,
        name: row.name,
        status: row.status,
        isActive,
        productionType,
        breed: row.breed ?? null,
        source: row.source_name ?? null,
        house: { id: row.house_id, code: row.house_code, name: row.house_name },
        site: { id: row.site_id, name: row.site_name },
        arrivalDate: row.arrival_date,
        closedAt: row.closed_at ?? null,
        ageDays,
        ageWeek,
        birds: { initial, live: liveBirds, deaths, culls },
        indicators: {
          viabilityPercent: round(viability, 2),
          mortalityPercent: initial ? round((deaths / initial) * 100, 2) : null,
          averageWeightG: weightG,
          weightDate: weight?.record_date ?? null,
          uniformityPercent: maybe(weight?.uniformity_percent),
          dailyGainG: round(dailyGainG, 1),
          feedKg: round(feedKg, 1),
          waterLiters: round(num(waterMap.get(id)?.water_liters), 1),
          liveWeightKg: round(liveKg, 1),
          fcr: round(fcr, 2),
          targetFcr: maybe(weekTarget?.target_fcr),
          iep,
          totalEggs,
          saleableEggs,
          eggsPerHenHoused: isLayer && initial ? round(totalEggs / initial, 1) : null,
          layingRatePercent: round(layingRate, 1),
          targetLayingRatePercent: maybe(weekTarget?.target_egg_lay_percent),
          feedPerEggG: round(feedPerEgg, 0),
        },
        ambiance: climateRow
          ? {
              date: climateRow.record_date,
              temperatureC: maybe(climateRow.temperature_c),
              humidityPercent: maybe(climateRow.humidity_percent),
              ammoniaPpm: maybe(climateRow.ammonia_ppm),
              lightHours: maybe(climateRow.light_hours),
            }
          : null,
        finance: options.includeFinance
          ? {
              currency,
              chicks: round(chicks, 2),
              feed: round(feedCost, 2),
              unpricedFeedKg: round(unpricedFeedKg, 1),
              other: otherCosts,
              total: round(totalCost, 2),
              perLiveBird: totalCost > 0 && liveBirds > 0 ? round(totalCost / liveBirds, 2) : null,
              perKg: totalCost > 0 && !isLayer && liveKg && liveKg > 0 ? round(totalCost / liveKg, 2) : null,
              perEgg: totalCost > 0 && isLayer && totalEggs > 0 ? round(totalCost / totalEggs, 3) : null,
              revenue: round(revenue, 2),
              margin: round(revenue - totalCost, 2),
            }
          : null,
        eggStock: isLayer
          ? {
              saleable: saleableEggs,
              sold: eggsSold,
              inStock: Math.max(0, saleableEggs - eggsSold),
              downgraded: num(eggRow?.downgraded_eggs),
            }
          : null,
        birdsSold,
        withdrawal: withdrawalMap.get(id) ?? [],
        forecast: isActive
          ? {
              dailyFeedKg: round(dailyFeed, 1),
              feedNext7DaysKg:
                dailyFeed == null
                  ? null
                  : round(dailyFeed * 7 * (isLayer ? 1 : 1.05), 0),
              saleWeightG,
              daysToSaleWeight,
              saleDate:
                daysToSaleWeight == null ? null : addDays(today, daysToSaleWeight),
              eggsNext7Days:
                isLayer && eggWeek && num(eggWeek.days) > 0
                  ? Math.round((num(eggWeek.eggs) / num(eggWeek.days)) * 7)
                  : null,
            }
          : null,
      };
    });

    // Vide sanitaire per house.
    const houseIds = houses.map((row) => String(row.id));
    const [lastClosed, sanitation, occupants] = houseIds.length
      ? await Promise.all([
          client.query<Row>(
            `SELECT house_id, MAX(COALESCE(closed_at, updated_at::date))::text AS closed_on
               FROM poultry_flocks WHERE organization_id = $1 AND house_id = ANY($2::uuid[])
                AND status = ANY($3::text[]) GROUP BY house_id`,
            [context.organizationId, houseIds, closedStatuses],
          ),
          client.query<Row>(
            `SELECT house_id, activity_type, MAX(sanitation_date)::text AS last_date
               FROM poultry_sanitation_records WHERE organization_id = $1 AND house_id = ANY($2::uuid[])
                AND COALESCE(status, 'completed') = 'completed'
              GROUP BY house_id, activity_type`,
            [context.organizationId, houseIds],
          ),
          client.query<Row>(
            `SELECT house_id, id, name FROM poultry_flocks
              WHERE organization_id = $1 AND house_id = ANY($2::uuid[]) AND status = ANY($3::text[])`,
            [context.organizationId, houseIds, operationalStatuses],
          ),
        ])
      : [empty, empty, empty];
    const closedMap = new Map(lastClosed.rows.map((row) => [String(row.house_id), String(row.closed_on)]));
    const occupantMap = new Map(occupants.rows.map((row) => [String(row.house_id), row]));
    const sanitationMap = new Map<string, Record<string, string>>();
    for (const row of sanitation.rows) {
      const key = String(row.house_id);
      if (!sanitationMap.has(key)) sanitationMap.set(key, {});
      sanitationMap.get(key)![String(row.activity_type)] = String(row.last_date);
    }
    const houseViews = houses.map((row) => {
      const id = String(row.id);
      const minDays = num(row.min_downtime_days);
      const occupant = occupantMap.get(id);
      const closedOn = closedMap.get(id) ?? null;
      const done = sanitationMap.get(id) ?? {};
      const since = (type: string) =>
        closedOn != null && done[type] != null && done[type] >= closedOn
          ? done[type]
          : null;
      const cleaning = since("cleaning");
      const disinfection = since("disinfection");
      const daysEmpty = closedOn == null ? null : Math.max(0, daysBetween(closedOn, today));
      let status: "occupied" | "resting" | "needs_cleaning" | "ready" | "unused";
      if (occupant) status = "occupied";
      else if (closedOn == null) status = "unused";
      else if (!cleaning || !disinfection) status = "needs_cleaning";
      else if (daysEmpty != null && daysEmpty < minDays) status = "resting";
      else status = "ready";
      return {
        id,
        code: row.code,
        name: row.name,
        houseType: row.house_type,
        capacity: num(row.capacity),
        operationalStatus: row.operational_status,
        site: { id: row.site_id, name: row.site_name },
        minDowntimeDays: minDays,
        status,
        currentFlock: occupant ? { id: occupant.id, name: occupant.name } : null,
        lastFlockClosedOn: closedOn,
        daysEmpty,
        daysRemaining:
          daysEmpty == null ? null : Math.max(0, minDays - daysEmpty),
        readyOn: closedOn == null ? null : addDays(closedOn, minDays),
        cleaningDate: cleaning,
        disinfectionDate: disinfection,
      };
    });

    const feedCover = siteIds.map((siteId) => {
      const daily = siteDailyFeed.get(siteId) ?? 0;
      const stockKg = siteFeedStock.get(siteId) ?? null;
      const site = flocks.find((row) => String(row.site_id) === siteId);
      return {
        site: { id: siteId, name: site?.site_name ?? null },
        stockKg: round(stockKg, 0),
        dailyNeedKg: round(daily, 1),
        daysOfCover:
          stockKg != null && daily > 0 ? Math.floor(stockKg / daily) : null,
      };
    });

    const activeIds = flockViews.filter((flock) => flock.isActive).map((flock) => flock.id);
    const warnings = activeIds.length
      ? await poultryEarlyWarnings(client, context.organizationId, activeIds, today)
      : [];

    return {
      date: today,
      currency,
      financeVisible: options.includeFinance,
      flocks: flockViews,
      houses: houseViews,
      warnings,
      feedCover,
    };
  });
}

/* ---------- Other flock costs ---------- */

export interface FlockCostInput {
  costDate: string;
  category: (typeof FLOCK_COST_CATEGORIES)[number];
  description?: string | null;
  amount: number;
}

async function assertFlockInScope(
  client: PoolClient,
  context: PoultryContext,
  flockId: string,
) {
  const scope = await scopeOf(client, context);
  const values: unknown[] = [context.organizationId, flockId];
  let condition = "TRUE";
  if (scope === "self" || scope === "site") {
    const location = await ownEmployeePoultryLocation(client, context);
    if (!location) throw new NotFoundError("Poultry flock not found");
    condition = addSelfSiteScope(location.siteId, "h.site_id", values);
  } else condition = addScope(scope, context, "s.province_id", values);
  const found = await client.query(
    `SELECT 1 FROM poultry_flocks f
       JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id
       JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
      WHERE f.organization_id = $1 AND f.id = $2 AND ${condition}`,
    values,
  );
  if (!found.rowCount) throw new NotFoundError("Poultry flock not found");
}

const costView = (row: Row) => ({
  id: row.id,
  flockId: row.flock_id,
  costDate: row.cost_date,
  category: row.category,
  description: row.description ?? null,
  amount: num(row.amount),
  createdAt: row.created_at,
});

export async function listFlockCosts(context: PoultryContext, flockId: string) {
  return withTenantContext(context, async (client) => {
    await assertFlockInScope(client, context, flockId);
    const result = await client.query<Row>(
      `SELECT id, flock_id, cost_date::text AS cost_date, category, description, amount, created_at
         FROM poultry_flock_costs WHERE organization_id = $1 AND flock_id = $2
        ORDER BY cost_date DESC, created_at DESC`,
      [context.organizationId, flockId],
    );
    return result.rows.map(costView);
  });
}

export async function createFlockCost(
  context: PoultryContext,
  flockId: string,
  input: FlockCostInput,
) {
  return withTenantContext(context, async (client) => {
    await assertFlockInScope(client, context, flockId);
    const result = await client.query<Row>(
      `INSERT INTO poultry_flock_costs (organization_id, flock_id, cost_date, category, description, amount, recorded_by_user_id)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7)
       RETURNING id, flock_id, cost_date::text AS cost_date, category, description, amount, created_at`,
      [
        context.organizationId,
        flockId,
        input.costDate,
        input.category,
        input.description?.trim() || null,
        input.amount,
        context.userId,
      ],
    );
    return costView(result.rows[0]!);
  });
}

export async function deleteFlockCost(
  context: PoultryContext,
  flockId: string,
  costId: string,
) {
  return withTenantContext(context, async (client) => {
    await assertFlockInScope(client, context, flockId);
    const result = await client.query(
      "DELETE FROM poultry_flock_costs WHERE organization_id = $1 AND flock_id = $2 AND id = $3",
      [context.organizationId, flockId, costId],
    );
    if (!result.rowCount) throw new NotFoundError("Cost not found");
    return { deleted: true };
  });
}
