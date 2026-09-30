import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type { OwnerManagementContext } from "./owner-management.service";
import { writeStockLedger } from "./owner-management.service";
import { createNotificationInTransaction } from "../notifications/notifications.service";
import { env } from "../../config/env";
import { sendMail, sendSms } from "../../services/notification.service";

type Row = Record<string, unknown>;
type Profile = {
  id: string; code: string; species: "poultry" | "pigs"; stage: string;
  min_age_days: number | null; max_age_days: number | null; daily_ration_kg: string;
  ration_mode: "rationed" | "ad_libitum"; benchmark_fcr: string | null;
};
type Need = {
  species: "poultry" | "pigs"; sourceId: string | null; sourceName: string; siteName: string;
  ageDays?: number; birdType?: string; pigStage?: string; profileCode: string | null;
  profileName: string; headCount: number; dailyKg: number; sevenDaysKg: number;
  thirtyDaysKg: number; rationMode: "rationed" | "ad_libitum" | null;
};

const FEED_INGREDIENT_CATEGORIES = new Set(["provenderie · matière première", "provenderie · additif / minéral", "feed_raw_material", "feed_additive", "matière première alimentaire", "matiere premiere alimentaire", "feed raw material", "feed additive", "additif alimentaire", "additif & minéral"]);
const FINISHED_FEED_CATEGORIES = new Set(["provenderie · aliment fabriqué", "feed_finished", "aliment fabriqué", "aliment fabrique", "finished feed"]);
const isFeedIngredientCategory = (category: unknown) => FEED_INGREDIENT_CATEGORIES.has(String(category ?? "").trim().toLowerCase());

const DEFAULT_PROFILES = [
  ["poultry_broiler_starter", "poultry", "Broiler starter", 0, 21, 0.045, "rationed", 1.55, "W1–W3"],
  ["poultry_broiler_grower", "poultry", "Broiler grower", 22, 35, 0.105, "rationed", 1.7, "W4–W5"],
  ["poultry_broiler_finisher", "poultry", "Broiler finisher", 36, null, 0.165, "rationed", 1.85, "W6+"],
  ["poultry_layer_chick_starter", "poultry", "Layer chick starter", 0, 42, 0.035, "rationed", 1.9, "W1–W6"],
  ["poultry_layer_pullet_grower", "poultry", "Layer pullet grower", 43, 112, 0.06, "rationed", 2.2, "W7–W16"],
  ["poultry_layer_pre_layer", "poultry", "Pre-layer", 113, 126, 0.08, "rationed", 2.3, "W17–W18"],
  ["poultry_layer_phase_1", "poultry", "Layer phase 1", 127, 315, 0.11, "rationed", 2.15, "W19–W45"],
  ["poultry_layer_phase_2", "poultry", "Layer phase 2", 316, null, 0.115, "rationed", 2.25, "W46+"],
  ["pig_piglet_prestarter", "pigs", "Piglet / pre-starter", null, null, 0.35, "rationed", 1.6, "0.2–0.5 kg/head/day"],
  ["pig_post_weaning_starter", "pigs", "Post-weaning / starter", null, null, 1, "rationed", 1.85, "0.8–1.2 kg/head/day"],
  ["pig_grower", "pigs", "Grower", null, null, 1.85, "rationed", 2.3, "1.5–2.2 kg/head/day"],
  ["pig_finisher", "pigs", "Finisher", null, null, 3, "rationed", 2.8, "2.5–3.5 kg/head/day"],
  ["pig_gestating_sow", "pigs", "Gestating sow", null, null, 2.2, "rationed", 3, "Rationed"],
  ["pig_lactating_sow", "pigs", "Lactating sow", null, null, 6, "ad_libitum", 3.2, "5.0–7.0 kg/head/day"],
] as const;

const number = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const unitKg = (unit: unknown): number | null => {
  const value = String(unit ?? "").trim().toLowerCase();
  if (["kg", "kilogram", "kilograms", "kilogramme", "kilogrammes"].includes(value)) return 1;
  if (["g", "gram", "grams", "gramme", "grammes"].includes(value)) return 0.001;
  if (["bag_50", "sac_50", "50kg", "50 kg", "sac 50 kg"].includes(value)) return 50;
  return null;
};
const codeStem = (value: string, fallback: string) => {
  const result = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 42);
  return (result || fallback).slice(0, 54);
};
export function scaledRecipeIngredientKg(
  quantityPerBase: number,
  ingredientUnit: string,
  baseQuantityKg: number,
  targetQuantityKg: number,
): number {
  const factor = unitKg(ingredientUnit);
  if (!factor || baseQuantityKg <= 0 || targetQuantityKg <= 0) return 0;
  return quantityPerBase * factor * (targetQuantityKg / baseQuantityKg);
}
function poultryProfile(birdType: string, age: number): string {
  if (birdType === "broiler") return age <= 21 ? "poultry_broiler_starter" : age <= 35 ? "poultry_broiler_grower" : "poultry_broiler_finisher";
  return age <= 42 ? "poultry_layer_chick_starter" : age <= 112 ? "poultry_layer_pullet_grower" : age <= 126 ? "poultry_layer_pre_layer" : age <= 315 ? "poultry_layer_phase_1" : "poultry_layer_phase_2";
}
function pigProfile(stage: string): string {
  const value = stage.toLowerCase();
  if (["suckling", "piglet"].includes(value)) return "pig_piglet_prestarter";
  if (["weaner", "starter", "post_weaning"].includes(value)) return "pig_post_weaning_starter";
  if (value === "grower") return "pig_grower";
  if (value === "finisher") return "pig_finisher";
  if (["breeding", "sow", "gilt", "pregnant"].includes(value)) return "pig_gestating_sow";
  return "pig_grower";
}
async function profiles(client: PoolClient, organizationId: string) {
  for (const item of DEFAULT_PROFILES) {
    await client.query(
      `INSERT INTO nutrition_feed_profiles (organization_id,code,species,stage,min_age_days,max_age_days,daily_ration_kg,ration_mode,benchmark_fcr,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (organization_id,code) DO NOTHING`,
      [organizationId, ...item],
    );
  }
  const result = await client.query<Profile>(
    `SELECT id,code,species,stage,min_age_days,max_age_days,daily_ration_kg,ration_mode,benchmark_fcr
       FROM nutrition_feed_profiles WHERE organization_id=$1 AND is_active=true`, [organizationId],
  );
  return new Map(result.rows.map((item) => [item.code, item]));
}
function ration(profile: Profile | undefined, headCount: number) {
  const dailyKg = profile ? headCount * number(profile.daily_ration_kg) : 0;
  return { profileCode: profile?.code ?? null, profileName: profile?.stage ?? "Profil à configurer", headCount,
    dailyKg, sevenDaysKg: dailyKg * 7, thirtyDaysKg: dailyKg * 30, rationMode: profile?.ration_mode ?? null };
}
async function feedRequirements(client: PoolClient, organizationId: string) {
  const byCode = await profiles(client, organizationId);
  const [flocks, groups, singlePigs] = await Promise.all([
    client.query<{ id: string; name: string; bird_type: string; age_days: string; live_birds: string; site_name: string }>(
      `SELECT f.id,f.name,f.bird_type,GREATEST(0,CURRENT_DATE-COALESCE(f.hatch_date,f.arrival_date,CURRENT_DATE)) AS age_days,
              GREATEST(0,COALESCE((SELECT d.live_bird_count FROM poultry_daily_records d WHERE d.organization_id=f.organization_id AND d.flock_id=f.id ORDER BY d.record_date DESC,d.created_at DESC LIMIT 1),f.initial_bird_count-COALESCE((SELECT SUM(m.death_count) FROM poultry_mortality_records m WHERE m.organization_id=f.organization_id AND m.flock_id=f.id),0))) AS live_birds,s.name AS site_name
         FROM poultry_flocks f JOIN poultry_houses h ON h.organization_id=f.organization_id AND h.id=f.house_id JOIN sites s ON s.organization_id=h.organization_id AND s.id=h.site_id
        WHERE f.organization_id=$1 AND f.status IN ('active','quarantined')`, [organizationId]),
    client.query<{ id: string; name: string; production_stage: string; live_heads: string; site_name: string }>(
      `SELECT g.id,g.name,g.production_stage,GREATEST(0,COALESCE((SELECT d.closing_count FROM pig_daily_records d WHERE d.organization_id=g.organization_id AND d.group_id=g.id AND d.closing_count IS NOT NULL ORDER BY d.record_date DESC,d.created_at DESC LIMIT 1),g.initial_count-COALESCE((SELECT SUM(d.mortality_count+d.culls_count+d.transfers_out_count-d.births_count-d.purchases_count-d.transfers_in_count) FROM pig_daily_records d WHERE d.organization_id=g.organization_id AND d.group_id=g.id),0))) AS live_heads,s.name AS site_name
         FROM pig_groups g JOIN pig_pens pen ON pen.organization_id=g.organization_id AND pen.id=g.pen_id JOIN sites s ON s.organization_id=pen.organization_id AND s.id=pen.site_id
        WHERE g.organization_id=$1 AND g.status='active'`, [organizationId]),
    client.query<{ animal_type: string; status: string; head_count: string; site_name: string }>(
      `SELECT animal.animal_type,animal.status,COUNT(*)::text AS head_count,s.name AS site_name
         FROM pig_animals animal JOIN pig_pens pen ON pen.organization_id=animal.organization_id AND pen.id=animal.pen_id JOIN sites s ON s.organization_id=pen.organization_id AND s.id=pen.site_id
        WHERE animal.organization_id=$1 AND animal.group_id IS NULL AND animal.status IN ('active','pregnant','lactating')
        GROUP BY animal.animal_type,animal.status,s.name`, [organizationId]),
  ]);
  const records: Need[] = [];
  for (const flock of flocks.rows) {
    const ageDays = number(flock.age_days);
    records.push({ species: "poultry", sourceId: flock.id, sourceName: flock.name, siteName: flock.site_name, ageDays, birdType: flock.bird_type, ...ration(byCode.get(poultryProfile(flock.bird_type, ageDays)), number(flock.live_birds)) });
  }
  for (const group of groups.rows) records.push({ species: "pigs", sourceId: group.id, sourceName: group.name, siteName: group.site_name, pigStage: group.production_stage, ...ration(byCode.get(pigProfile(group.production_stage)), number(group.live_heads)) });
  for (const animal of singlePigs.rows) {
    const profileCode = animal.status === "lactating" ? "pig_lactating_sow" : animal.status === "pregnant" ? "pig_gestating_sow" : pigProfile(animal.animal_type);
    records.push({ species: "pigs", sourceId: null, sourceName: animal.animal_type, siteName: animal.site_name, pigStage: animal.animal_type, ...ration(byCode.get(profileCode), number(animal.head_count)) });
  }
  const totals = records.reduce((sum, item) => ({ dailyKg: sum.dailyKg + item.dailyKg, sevenDaysKg: sum.sevenDaysKg + item.sevenDaysKg, thirtyDaysKg: sum.thirtyDaysKg + item.thirtyDaysKg, heads: sum.heads + item.headCount }), { dailyKg: 0, sevenDaysKg: 0, thirtyDaysKg: 0, heads: 0 });
  return { records, totals, profiles: [...byCode.values()] };
}
async function fcr(client: PoolClient, organizationId: string) {
  const [poultry, pigs] = await Promise.all([
    client.query<{ kind: string; feed_kg: string; gain_kg: string; egg_mass_kg: string }>(
      `WITH flock_metrics AS (
         SELECT CASE WHEN f.bird_type='layer' THEN 'layers' ELSE 'broilers' END AS kind,
                COALESCE((SELECT SUM(feed.quantity_kg) FROM poultry_feed_records feed WHERE feed.organization_id=f.organization_id AND feed.flock_id=f.id),0) AS feed_kg,
                GREATEST(0,(COALESCE(last_weight.average_weight_g,0)-COALESCE(first_weight.average_weight_g,0))/1000.0)*COALESCE((SELECT d.live_bird_count FROM poultry_daily_records d WHERE d.organization_id=f.organization_id AND d.flock_id=f.id ORDER BY d.record_date DESC,d.created_at DESC LIMIT 1),f.initial_bird_count) AS gain_kg,
                COALESCE((SELECT SUM(eggs.total_eggs-eggs.cracked_eggs-eggs.dirty_eggs-eggs.hatching_eggs) FROM poultry_egg_records eggs WHERE eggs.organization_id=f.organization_id AND eggs.flock_id=f.id),0)*0.060 AS egg_mass_kg
           FROM poultry_flocks f
           LEFT JOIN LATERAL (SELECT average_weight_g FROM poultry_weight_records weight WHERE weight.organization_id=f.organization_id AND weight.flock_id=f.id ORDER BY weight.record_date ASC,weight.created_at ASC LIMIT 1) first_weight ON true
           LEFT JOIN LATERAL (SELECT average_weight_g FROM poultry_weight_records weight WHERE weight.organization_id=f.organization_id AND weight.flock_id=f.id ORDER BY weight.record_date DESC,weight.created_at DESC LIMIT 1) last_weight ON true
          WHERE f.organization_id=$1 AND f.status IN ('active','quarantined')
       ) SELECT kind,COALESCE(SUM(feed_kg),0) AS feed_kg,COALESCE(SUM(gain_kg),0) AS gain_kg,COALESCE(SUM(egg_mass_kg),0) AS egg_mass_kg FROM flock_metrics GROUP BY kind`, [organizationId]),
    client.query<{ feed_kg: string; gain_kg: string }>(
      `WITH pen_metrics AS (
         SELECT COALESCE((SELECT SUM(feed.quantity_kg) FROM pig_feed_records feed WHERE feed.organization_id=pen.organization_id AND feed.pen_id=pen.id),0) AS feed_kg,
                GREATEST(0,COALESCE(last_weight.average_weight_kg,0)-COALESCE(first_weight.average_weight_kg,0))*COALESCE(last_weight.sample_size,0) AS gain_kg
           FROM pig_pens pen
           LEFT JOIN LATERAL (SELECT average_weight_kg,sample_size FROM pig_weight_records weight WHERE weight.organization_id=pen.organization_id AND weight.pen_id=pen.id ORDER BY weight.record_date ASC,weight.created_at ASC LIMIT 1) first_weight ON true
           LEFT JOIN LATERAL (SELECT average_weight_kg,sample_size FROM pig_weight_records weight WHERE weight.organization_id=pen.organization_id AND weight.pen_id=pen.id ORDER BY weight.record_date DESC,weight.created_at DESC LIMIT 1) last_weight ON true
          WHERE pen.organization_id=$1
       ) SELECT COALESCE(SUM(feed_kg),0) AS feed_kg,COALESCE(SUM(gain_kg),0) AS gain_kg FROM pen_metrics`, [organizationId]),
  ]);
  const metrics = poultry.rows.map((row) => {
    const outputKg = row.kind === "layers" ? number(row.egg_mass_kg) : number(row.gain_kg); const feedKg = number(row.feed_kg); const benchmark = row.kind === "layers" ? 2.2 : 1.85;
    return { kind: row.kind, feedKg, outputKg, fcr: outputKg > 0 ? feedKg / outputKg : null, benchmark, warning: outputKg > 0 && feedKg / outputKg > benchmark * 1.1 };
  });
  const pig = pigs.rows[0];
  if (pig) { const outputKg = number(pig.gain_kg); const feedKg = number(pig.feed_kg); metrics.push({ kind: "pigs", feedKg, outputKg, fcr: outputKg > 0 ? feedKg / outputKg : null, benchmark: 2.8, warning: outputKg > 0 && feedKg / outputKg > 3.08 }); }
  return metrics;
}
async function finishedStock(client: PoolClient, organizationId: string) {
  const result = await client.query<{ quantity_kg: string; inventory_value: string }>(
    `SELECT COALESCE(SUM(stock.quantity_on_hand),0) AS quantity_kg,COALESCE(SUM(stock.quantity_on_hand*COALESCE(item.standard_unit_cost,0)),0) AS inventory_value
       FROM management_inventory_stock stock JOIN management_inventory_items item ON item.organization_id=stock.organization_id AND item.id=stock.item_id
      WHERE stock.organization_id=$1 AND item.is_active=true AND lower(item.category) = ANY(ARRAY['provenderie · aliment fabriqué','feed_finished','aliment fabriqué','aliment fabrique','finished feed']) AND lower(item.unit)='kg'`, [organizationId]);
  return { quantityKg: number(result.rows[0]?.quantity_kg), inventoryValue: number(result.rows[0]?.inventory_value) };
}
export async function feedNutritionOverview(context: OwnerManagementContext) {
  return withTenantContext(context, async (client) => {
    const [requirement, metrics, stock, recipeCount, orderCount] = await Promise.all([
      feedRequirements(client, context.organizationId), fcr(client, context.organizationId), finishedStock(client, context.organizationId),
      client.query<{ count: string }>("SELECT count(*)::text AS count FROM nutrition_feed_recipes WHERE organization_id=$1 AND is_active=true", [context.organizationId]),
      client.query<{ count: string }>("SELECT count(*)::text AS count FROM nutrition_feed_orders WHERE organization_id=$1 AND status IN ('draft','in_progress')", [context.organizationId]),
    ]);
    const autonomyDays = requirement.totals.dailyKg > 0 ? stock.quantityKg / requirement.totals.dailyKg : null;
    const alerts = [
      ...(autonomyDays !== null && autonomyDays < 3 ? [{ kind: "low_stock", priority: autonomyDays < 1 ? "urgent" : "high", message: `L’aliment fabriqué couvre seulement ${autonomyDays.toFixed(1)} jour(s).` }] : []),
      ...metrics.filter((item) => item.warning).map((item) => ({ kind: "fcr", priority: "high", message: `IC ${item.kind} : ${item.fcr?.toFixed(2)} au-dessus de la référence ${item.benchmark.toFixed(2)}.` })),
    ];
    return { requirements: requirement.records, totals: requirement.totals, profiles: requirement.profiles, fcr: metrics, finishedFeedStock: { ...stock, autonomyDays }, activeRecipes: number(recipeCount.rows[0]?.count), openProductionOrders: number(orderCount.rows[0]?.count), alerts, assistant: alerts.length ? "Vérifiez les alertes avant le prochain tour d’alimentation." : "Les besoins, le stock fabriqué et la conversion enregistrée sont dans la plage surveillée." };
  });
}
async function lockedOrder(client: PoolClient, context: OwnerManagementContext, orderId: string) {
  const result = await client.query<Row>(`SELECT order_row.*,recipe.name AS recipe_name,recipe.code AS recipe_code,recipe.target_species,recipe.output_item_id AS recipe_output_item_id,recipe.overhead_per_kg FROM nutrition_feed_orders order_row JOIN nutrition_feed_recipes recipe ON recipe.organization_id=order_row.organization_id AND recipe.id=order_row.recipe_id WHERE order_row.organization_id=$1 AND order_row.id=$2 FOR UPDATE`, [context.organizationId, orderId]);
  if (!result.rows[0]) throw new NotFoundError("Ordre de fabrication introuvable");
  return result.rows[0];
}
async function assertLocations(client: PoolClient, context: OwnerManagementContext, order: Row) {
  const locations = await client.query<{ id: string; site_id: string; is_active: boolean }>("SELECT id,site_id,is_active FROM management_warehouses WHERE organization_id=$1 AND id=ANY($2::uuid[])", [context.organizationId, [order.input_warehouse_id, order.output_warehouse_id]]);
  if (locations.rows.length !== 2 || locations.rows.some((item) => !item.is_active || item.site_id !== order.site_id)) throw new BadRequestError("Les deux entrepôts de l’OF doivent être actifs et appartenir au site de production.");
  if (order.project_id) {
    const project = await client.query<{ site_id: string | null }>("SELECT site_id FROM management_projects WHERE organization_id=$1 AND id=$2", [context.organizationId, order.project_id]);
    if (!project.rows[0] || (project.rows[0].site_id && project.rows[0].site_id !== order.site_id)) throw new BadRequestError("Le site de l’ordre de fabrication doit correspondre au site du projet.");
  }
}
async function outputItem(client: PoolClient, context: OwnerManagementContext, order: Row) {
  const id = String(order.output_item_id ?? order.recipe_output_item_id ?? "");
  if (id) {
    const selected = (await client.query<{ id: string; unit: string; category: string | null; is_active: boolean }>("SELECT id,unit,category,is_active FROM management_inventory_items WHERE organization_id=$1 AND id=$2", [context.organizationId, id])).rows[0];
    if (!selected?.is_active || unitKg(selected.unit) !== 1 || !FINISHED_FEED_CATEGORIES.has(String(selected.category ?? "").trim().toLowerCase())) throw new BadRequestError("L’aliment fini doit être actif, stocké en kilogrammes et classé « Provenderie · aliment fabriqué ».");
    return id;
  }
  const species = String(order.target_species); const name = `${String(order.recipe_name)} · ${species === "pigs" ? "Porcs" : species === "poultry" ? "Volaille" : "Mixte"}`;
  const found = await client.query<{ id: string }>("SELECT id FROM management_inventory_items WHERE organization_id=$1 AND lower(name)=lower($2) AND lower(unit)='kg' AND lower(category) = ANY(ARRAY['provenderie · aliment fabriqué','feed_finished','aliment fabriqué','aliment fabrique','finished feed']) AND is_active=true LIMIT 1", [context.organizationId, name]);
  const created = found.rows[0]?.id ?? (await client.query<{ id: string }>("INSERT INTO management_inventory_items (organization_id,code,name,category,unit,is_active,notes) VALUES ($1,$2,$3,'Provenderie · aliment fabriqué','kg',true,'Créé automatiquement par un ordre de fabrication') RETURNING id", [context.organizationId, `alm_${codeStem(String(order.recipe_code), "recette")}_${randomUUID().replace(/-/g, "").slice(0, 5)}`.slice(0, 63), name])).rows[0]?.id;
  if (!created) throw new BadRequestError("Impossible de créer l’article d’aliment fini.");
  await client.query("UPDATE nutrition_feed_orders SET output_item_id=$3 WHERE organization_id=$1 AND id=$2", [context.organizationId, order.id, created]);
  return created;
}
export async function confirmFeedOrder(context: OwnerManagementContext, orderId: string) {
  return withTenantContext(context, async (client) => {
    const order = await lockedOrder(client, context, orderId);
    if (String(order.status) === "confirmed") return { id: order.id, status: "confirmed", alreadyConfirmed: true };
    if (String(order.status) === "cancelled") throw new ForbiddenError("Un ordre de fabrication annulé ne peut pas être confirmé.");
    await assertLocations(client, context, order);
    const lines = await client.query<Row>(`SELECT line.*,item.name AS inventory_name,item.unit AS inventory_unit,item.category AS inventory_category,item.standard_unit_cost FROM nutrition_feed_recipe_lines line LEFT JOIN management_inventory_items item ON item.organization_id=line.organization_id AND item.id=line.inventory_item_id WHERE line.organization_id=$1 AND line.recipe_id=$2 ORDER BY line.sort_order,line.created_at`, [context.organizationId, order.recipe_id]);
    if (!lines.rowCount) throw new BadRequestError("Ajoutez au moins un ingrédient à la recette avant de confirmer l’OF.");
    const base = await client.query<{ base_quantity_kg: string }>("SELECT base_quantity_kg FROM nutrition_feed_recipes WHERE organization_id=$1 AND id=$2", [context.organizationId, order.recipe_id]);
    const outputQuantity = number(order.actual_quantity_kg ?? order.planned_quantity_kg);
    let totalCost = number(order.overhead_total) || outputQuantity * number(order.overhead_per_kg);
    const inputs: Array<{ id: string; itemId: string; name: string; nativeQuantity: number; unitCost: number }> = [];
    for (const line of lines.rows) {
      if (!line.inventory_item_id || !line.inventory_unit) throw new BadRequestError(`L’ingrédient « ${String(line.ingredient_name)} » doit être relié à un article de stock actif.`, { field: "inventoryItemId" });
      if (!isFeedIngredientCategory(line.inventory_category)) throw new BadRequestError(`L’ingrédient « ${String(line.inventory_name ?? line.ingredient_name)} » doit être classé « Provenderie · matière première » ou « Provenderie · additif / minéral ».`, { field: "inventoryItemId" });
      const recipeFactor = unitKg(line.unit); const stockFactor = unitKg(line.inventory_unit);
      if (!recipeFactor || !stockFactor) throw new BadRequestError(`Utilisez kg, g ou sac de 50 kg pour « ${String(line.ingredient_name)} ».`, { field: "unit" });
      const ingredientKg = scaledRecipeIngredientKg(number(line.quantity_per_base), String(line.unit), number(base.rows[0]?.base_quantity_kg ?? 100), outputQuantity); const nativeQuantity = ingredientKg / stockFactor;
      const stock = await client.query<{ quantity_on_hand: string }>("SELECT quantity_on_hand FROM management_inventory_stock WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3 FOR UPDATE", [context.organizationId, order.input_warehouse_id, line.inventory_item_id]);
      if (number(stock.rows[0]?.quantity_on_hand) + 0.0001 < nativeQuantity) throw new BadRequestError(`Stock insuffisant : ${String(line.inventory_name ?? line.ingredient_name)}.`);
      const unitCost = line.unit_cost_override == null ? number(line.standard_unit_cost) : number(line.unit_cost_override); const id = randomUUID();
      await client.query(`INSERT INTO nutrition_feed_order_inputs (id,organization_id,order_id,recipe_line_id,inventory_item_id,warehouse_id,ingredient_name,planned_quantity_kg,actual_quantity_kg,unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, context.organizationId, order.id, line.id, line.inventory_item_id, order.input_warehouse_id, line.ingredient_name, ingredientKg, ingredientKg, unitCost]);
      totalCost += nativeQuantity * unitCost; inputs.push({ id, itemId: String(line.inventory_item_id), name: String(line.ingredient_name), nativeQuantity, unitCost });
    }
    const outputItemId = await outputItem(client, context, order);
    for (const input of inputs) await writeStockLedger(client, context, { warehouseId: String(order.input_warehouse_id), itemId: input.itemId, projectId: order.project_id ? String(order.project_id) : null, movementType: "issue", quantityDelta: -input.nativeQuantity, unitCost: input.unitCost, referenceType: "nutrition_feed_order_input", referenceId: input.id, notes: `Ingrédient pour ${String(order.order_number)} · ${input.name}` });
    const outputUnitCost = outputQuantity > 0 ? totalCost / outputQuantity : 0;
    await writeStockLedger(client, context, { warehouseId: String(order.output_warehouse_id), itemId: outputItemId, projectId: order.project_id ? String(order.project_id) : null, movementType: "receipt", quantityDelta: outputQuantity, unitCost: outputUnitCost, referenceType: "nutrition_feed_order_output", referenceId: String(order.id), notes: `${String(order.order_number)} · ${String(order.recipe_name)}` });
    await client.query("UPDATE nutrition_feed_orders SET output_item_id=$3,actual_quantity_kg=$4,status='confirmed',produced_by_member_id=COALESCE(produced_by_member_id,$5),stock_applied_at=now() WHERE organization_id=$1 AND id=$2", [context.organizationId, order.id, outputItemId, outputQuantity, context.memberId]);
    await client.query("UPDATE management_inventory_items SET standard_unit_cost=$3,updated_at=now() WHERE organization_id=$1 AND id=$2", [context.organizationId, outputItemId, outputUnitCost]);
    return { id: order.id, status: "confirmed", outputItemId, outputQuantityKg: outputQuantity, outputUnitCost, bagCount: Math.ceil(outputQuantity / number(order.bag_weight_kg)) };
  });
}
export async function cancelFeedOrder(context: OwnerManagementContext, orderId: string) {
  return withTenantContext(context, async (client) => {
    const order = await lockedOrder(client, context, orderId);
    if (String(order.status) === "cancelled") return { id: order.id, status: "cancelled", alreadyCancelled: true };
    if (String(order.status) !== "confirmed" || !order.stock_applied_at) throw new BadRequestError("Seul un ordre de fabrication confirmé peut être annulé.");
    const outputQuantity = number(order.actual_quantity_kg);
    const stock = await client.query<{ quantity_on_hand: string }>("SELECT quantity_on_hand FROM management_inventory_stock WHERE organization_id=$1 AND warehouse_id=$2 AND item_id=$3 FOR UPDATE", [context.organizationId, order.output_warehouse_id, order.output_item_id]);
    if (number(stock.rows[0]?.quantity_on_hand) + 0.0001 < outputQuantity) throw new BadRequestError("L’aliment fini a déjà été utilisé ou vendu. Enregistrez une correction de stock au lieu d’annuler l’OF.");
    const inputs = await client.query<Row>("SELECT * FROM nutrition_feed_order_inputs WHERE organization_id=$1 AND order_id=$2 ORDER BY created_at", [context.organizationId, order.id]);
    await writeStockLedger(client, context, { warehouseId: String(order.output_warehouse_id), itemId: String(order.output_item_id), projectId: order.project_id ? String(order.project_id) : null, movementType: "adjustment_out", quantityDelta: -outputQuantity, referenceType: "nutrition_feed_order_cancellation", referenceId: String(order.id), notes: `Annulation de ${String(order.order_number)}` });
    for (const input of inputs.rows) {
      const item = await client.query<{ unit: string }>("SELECT unit FROM management_inventory_items WHERE organization_id=$1 AND id=$2", [context.organizationId, input.inventory_item_id]); const factor = unitKg(item.rows[0]?.unit);
      if (!factor) throw new BadRequestError("Une unité d’ingrédient ne peut plus être convertie pour cette annulation.");
      await writeStockLedger(client, context, { warehouseId: String(input.warehouse_id), itemId: String(input.inventory_item_id), projectId: order.project_id ? String(order.project_id) : null, movementType: "return", quantityDelta: number(input.actual_quantity_kg) / factor, unitCost: number(input.unit_cost), referenceType: "nutrition_feed_order_cancellation_input", referenceId: String(input.id), notes: `Retour après annulation de ${String(order.order_number)}` });
    }
    await client.query("UPDATE nutrition_feed_orders SET status='cancelled',cancelled_at=now() WHERE organization_id=$1 AND id=$2", [context.organizationId, order.id]);
    return { id: order.id, status: "cancelled" };
  });
}

type NutritionRecipient = {
  member_id: string;
  phone: string | null;
  email: string | null;
  sms_enabled: boolean;
};
type NutritionSignal = {
  type: string;
  category: "inventory" | "poultry" | "pigs" | "veterinary" | "report";
  priority: "normal" | "high" | "urgent";
  title: string;
  message: string;
  actionUrl: string;
  entityType: string;
  deduplicationKey: string;
  provinceId?: string | null;
  siteId?: string | null;
};

async function nutritionAudience(
  client: PoolClient,
  organizationId: string,
  signal: Pick<NutritionSignal, "provinceId" | "siteId">,
): Promise<NutritionRecipient[]> {
  const result = await client.query<NutritionRecipient>(
    `SELECT DISTINCT member.id AS member_id,employee.phone,user_account.email::text AS email,
            COALESCE(preferences.sms_enabled,false) AS sms_enabled
       FROM organization_members member
       JOIN users user_account ON user_account.id=member.user_id
       LEFT JOIN member_roles assignment ON assignment.organization_id=member.organization_id AND assignment.member_id=member.id
       LEFT JOIN roles role ON role.organization_id=assignment.organization_id AND role.id=assignment.role_id
       LEFT JOIN employees employee ON employee.organization_id=member.organization_id AND employee.member_id=member.id
       LEFT JOIN notification_profile_preferences preferences ON preferences.organization_id=member.organization_id AND preferences.member_id=member.id
      WHERE member.organization_id=$1 AND member.status='active'
        AND (
          member.is_owner
          OR (
            role.code IN ('general_manager','provincial_manager','site_manager','farm_operations_manager','poultry_supervisor','pig_supervisor','veterinarian')
            AND (
              role.data_scope = 'organization'
              OR (
                role.data_scope = 'province' AND $2::uuid IS NOT NULL
                AND EXISTS (
                  SELECT 1 FROM member_provinces scoped
                   WHERE scoped.organization_id=member.organization_id
                     AND scoped.member_id=member.id
                     AND scoped.province_id=$2::uuid
                )
              )
              OR (
                role.code='site_manager' AND $3::uuid IS NOT NULL
                AND employee.site_id=$3::uuid
              )
            )
          )
        )`,
    [organizationId, signal.provinceId ?? null, signal.siteId ?? null],
  );
  return result.rows;
}

async function notifyNutritionAudience(
  client: PoolClient,
  organizationId: string,
  signal: NutritionSignal,
): Promise<NutritionRecipient[]> {
  const recipients = await nutritionAudience(client, organizationId, signal);
  for (const recipient of recipients) {
    await createNotificationInTransaction(client, {
      organizationId,
      recipientMemberId: recipient.member_id,
      type: signal.type,
      category: signal.category,
      priority: signal.priority,
      title: signal.title,
      message: signal.message,
      actionUrl: signal.actionUrl,
      entityType: signal.entityType,
      entityId: null,
      deduplicationKey: `${signal.deduplicationKey}:${recipient.member_id}`,
      metadata: { feedNutrition: true },
      actorUserId: null,
      // Vaccination reminders choose their own SMS-first, email-fallback
      // delivery. Do not queue a second generic notification e-mail.
      skipEmailDelivery: signal.type === "prophylaxis_due",
    });
  }
  return recipients;
}

async function sendNutritionSms(recipients: NutritionRecipient[], content: string) {
  await Promise.all(
    recipients
      .filter((recipient) => recipient.sms_enabled && Boolean(recipient.phone))
      .map((recipient) => sendSms({ to: String(recipient.phone), content })),
  );
}

function escapeNutritionEmail(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

/** Vaccination reminders use SMS first. An email is sent only if SMS was not
 * accepted, unavailable, or disabled for that recipient. */
async function deliverVaccinationReminder(
  recipient: NutritionRecipient,
  content: string,
  actionUrl: string,
): Promise<void> {
  const smsResult =
    recipient.sms_enabled && recipient.phone
      ? await sendSms({ to: recipient.phone, content })
      : { sent: false };
  if (smsResult.sent || !recipient.email) return;

  const safeContent = escapeNutritionEmail(content);
  await sendMail({
    to: recipient.email,
    subject: "Rappel vaccinal · LiteHubs",
    text: `${content}\n\nOuvrez LiteHubs pour consulter et enregistrer l’intervention : ${actionUrl}`,
    html: `<div style="max-width:600px;margin:0 auto;padding:28px;font-family:Arial,sans-serif;color:#101828;"><p style="margin:0 0 20px;color:#0f5132;font-size:20px;font-weight:700;">LiteHubs</p><h1 style="margin:0 0 16px;font-size:24px;">Rappel vaccinal</h1><p>${safeContent}</p><p style="margin-top:24px;"><a href="${escapeNutritionEmail(actionUrl)}" style="display:inline-block;padding:12px 18px;background:#146c43;border-radius:8px;color:#fff;font-weight:700;text-decoration:none;">Ouvrir la santé animale</a></p></div>`,
  });
}

/** Runs at 06:00 Africa/Kinshasa. Notifications are deduplicated per recipient and day. */
export async function runNutritionMonitoringForOrganization(organizationId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const plan = await withTenantContext({ organizationId, userId: null }, async (client) => {
    const organization = await client.query<{ slug: string }>(
      "SELECT slug FROM organizations WHERE id=$1",
      [organizationId],
    );
    const organizationSlug = organization.rows[0]?.slug;
    const [need, metrics, stock, mortality, trailingMortality, dueHealth, scheduledPoultryVaccines] = await Promise.all([
      feedRequirements(client, organizationId),
      fcr(client, organizationId),
      finishedStock(client, organizationId),
      client.query<{ poultry: string; pigs: string }>(
        `SELECT COALESCE((SELECT SUM(death_count) FROM poultry_mortality_records WHERE organization_id=$1 AND mortality_date=CURRENT_DATE),0)::text AS poultry,
                COALESCE((SELECT SUM(death_count) FROM pig_mortality_records WHERE organization_id=$1 AND mortality_date=CURRENT_DATE),0)::text AS pigs`,
        [organizationId],
      ),
      client.query<{ day: string; deaths: string }>(
        `WITH days AS (SELECT generate_series(CURRENT_DATE-2,CURRENT_DATE,interval '1 day')::date AS day),
              losses AS (
                SELECT mortality_date AS day,SUM(death_count) AS deaths FROM poultry_mortality_records WHERE organization_id=$1 AND mortality_date>=CURRENT_DATE-2 GROUP BY mortality_date
                UNION ALL
                SELECT mortality_date AS day,SUM(death_count) AS deaths FROM pig_mortality_records WHERE organization_id=$1 AND mortality_date>=CURRENT_DATE-2 GROUP BY mortality_date
              )
         SELECT days.day::text,COALESCE(SUM(losses.deaths),0)::text AS deaths FROM days LEFT JOIN losses ON losses.day=days.day GROUP BY days.day ORDER BY days.day`,
        [organizationId],
      ),
      client.query<{ source_id: string; subject_id: string; species: string; reminder_kind: "vaccination" | "veterinary_follow_up" | "farrowing"; name: string; subject_name: string; due_date: string; site_name: string; province_id: string | null; site_id: string | null; project_name: string | null }>(
        `SELECT v.id AS source_id,flock.id AS subject_id,'poultry' AS species,'vaccination'::text AS reminder_kind,v.vaccine_name AS name,flock.name AS subject_name,v.next_due_date::text AS due_date,s.name AS site_name,p.id AS province_id,s.id AS site_id,NULL::text AS project_name
           FROM poultry_vaccination_records v
           JOIN poultry_flocks flock ON flock.organization_id=v.organization_id AND flock.id=v.flock_id
           JOIN poultry_houses house ON house.organization_id=flock.organization_id AND house.id=flock.house_id
           JOIN sites s ON s.organization_id=house.organization_id AND s.id=house.site_id
           JOIN provinces p ON p.organization_id=s.organization_id AND p.id=s.province_id
          WHERE v.organization_id=$1 AND v.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE+1
         UNION ALL
         SELECT v.id AS source_id,pen.id AS subject_id,'pigs' AS species,'vaccination'::text AS reminder_kind,v.vaccine_name AS name,pen.name AS subject_name,v.next_due_date::text AS due_date,s.name AS site_name,p.id AS province_id,s.id AS site_id,project.name AS project_name
           FROM pig_vaccination_records v
           JOIN pig_pens pen ON pen.organization_id=v.organization_id AND pen.id=v.pen_id
           JOIN sites s ON s.organization_id=pen.organization_id AND s.id=pen.site_id
           JOIN provinces p ON p.organization_id=s.organization_id AND p.id=s.province_id
           LEFT JOIN LATERAL (
             SELECT linked_project.name
               FROM management_project_operational_links link
               JOIN management_projects linked_project
                 ON linked_project.organization_id=link.organization_id
                AND linked_project.id=link.project_id
              WHERE link.organization_id=pen.organization_id
                AND link.module_code='pigs'
                AND link.resource_code='pens'
                AND link.record_id=pen.id
              ORDER BY link.created_at DESC LIMIT 1
           ) project ON TRUE
          WHERE v.organization_id=$1 AND v.next_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE+1
         UNION ALL
         SELECT v.id AS source_id,pen.id AS subject_id,'pigs' AS species,'veterinary_follow_up'::text AS reminder_kind,
                COALESCE(NULLIF(v.diagnosis,''),'Contrôle vétérinaire') AS name,pen.name AS subject_name,v.follow_up_date::text AS due_date,
                s.name AS site_name,p.id AS province_id,s.id AS site_id,project.name AS project_name
           FROM pig_veterinary_records v
           JOIN pig_pens pen ON pen.organization_id=v.organization_id AND pen.id=v.pen_id
           JOIN sites s ON s.organization_id=pen.organization_id AND s.id=pen.site_id
           JOIN provinces p ON p.organization_id=s.organization_id AND p.id=s.province_id
           LEFT JOIN LATERAL (
             SELECT linked_project.name
               FROM management_project_operational_links link
               JOIN management_projects linked_project
                 ON linked_project.organization_id=link.organization_id
                AND linked_project.id=link.project_id
              WHERE link.organization_id=pen.organization_id
                AND link.module_code='pigs'
                AND link.resource_code='pens'
                AND link.record_id=pen.id
              ORDER BY link.created_at DESC LIMIT 1
           ) project ON TRUE
          WHERE v.organization_id=$1
            AND v.status IN ('open','monitoring')
            AND v.follow_up_date BETWEEN CURRENT_DATE AND CURRENT_DATE+1
         UNION ALL
         SELECT pregnancy.id AS source_id,pen.id AS subject_id,'pigs' AS species,'farrowing'::text AS reminder_kind,
                'Mise bas prévue' AS name,COALESCE(NULLIF(sow.name,''),sow.animal_number) AS subject_name,
                pregnancy.expected_farrowing_date::text AS due_date,s.name AS site_name,p.id AS province_id,s.id AS site_id,project.name AS project_name
           FROM pig_pregnancies pregnancy
           JOIN pig_pens pen ON pen.organization_id=pregnancy.organization_id AND pen.id=pregnancy.pen_id
           JOIN pig_animals sow ON sow.organization_id=pregnancy.organization_id AND sow.id=pregnancy.sow_animal_id
           JOIN sites s ON s.organization_id=pen.organization_id AND s.id=pen.site_id
           JOIN provinces p ON p.organization_id=s.organization_id AND p.id=s.province_id
           LEFT JOIN LATERAL (
             SELECT linked_project.name
               FROM management_project_operational_links link
               JOIN management_projects linked_project
                 ON linked_project.organization_id=link.organization_id
                AND linked_project.id=link.project_id
              WHERE link.organization_id=pen.organization_id
                AND link.module_code='pigs'
                AND link.resource_code='pens'
                AND link.record_id=pen.id
              ORDER BY link.created_at DESC LIMIT 1
           ) project ON TRUE
          WHERE pregnancy.organization_id=$1
            AND pregnancy.status IN ('suspected','confirmed')
            AND pregnancy.expected_farrowing_date BETWEEN CURRENT_DATE AND CURRENT_DATE+1
         ORDER BY due_date,name`,
        [organizationId],
      ),
      client.query<{ source_id: string; subject_id: string; species: string; reminder_kind: "vaccination"; name: string; subject_name: string; due_date: string; site_name: string; province_id: string | null; site_id: string | null; project_name: string | null }>(
        `WITH scheduled AS (
           SELECT schedule.id AS source_id,flock.id AS subject_id,'poultry'::text AS species,'vaccination'::text AS reminder_kind,
                  schedule.vaccine_name AS name,flock.name AS subject_name,
                  (COALESCE(flock.hatch_date,flock.arrival_date) + schedule.day_age)::date AS due_date,
                  site.name AS site_name,province.id AS province_id,site.id AS site_id,
                  project.name AS project_name
             FROM poultry_flocks flock
             JOIN poultry_houses house ON house.organization_id=flock.organization_id AND house.id=flock.house_id
             JOIN sites site ON site.organization_id=house.organization_id AND site.id=house.site_id
             JOIN provinces province ON province.organization_id=site.organization_id AND province.id=site.province_id
             JOIN poultry_model_vaccine_schedules schedule
               ON schedule.organization_id=flock.organization_id
              AND schedule.performance_model_id=flock.performance_model_id
             LEFT JOIN LATERAL (
               SELECT linked_project.name
                 FROM management_project_operational_links link
                 JOIN management_projects linked_project
                   ON linked_project.organization_id=link.organization_id
                  AND linked_project.id=link.project_id
                WHERE link.organization_id=flock.organization_id
                  AND link.module_code='poultry' AND link.resource_code='flocks'
                  AND link.record_id=flock.id
                ORDER BY link.created_at DESC LIMIT 1
             ) project ON TRUE
            WHERE flock.organization_id=$1
              AND flock.status IN ('active','quarantined')
         )
         SELECT scheduled.*
           FROM scheduled
          WHERE scheduled.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE+1
            AND NOT EXISTS (
              SELECT 1 FROM poultry_vaccination_records completed
               WHERE completed.organization_id=$1
                 AND completed.flock_id=scheduled.subject_id
                 AND lower(completed.vaccine_name)=lower(scheduled.name)
                 AND completed.vaccination_date BETWEEN scheduled.due_date-2 AND scheduled.due_date+2
            )
          ORDER BY scheduled.due_date,scheduled.name`,
        [organizationId],
      ),
    ]);
    const signals: NutritionSignal[] = [];
    const autonomy = need.totals.dailyKg > 0 ? stock.quantityKg / need.totals.dailyKg : null;
    if (autonomy !== null && autonomy < 3) signals.push({
      type: "feed_stock_low", category: "inventory", priority: autonomy < 1 ? "urgent" : "high",
      title: "Autonomie d’aliment faible", message: `L’aliment fabriqué couvre environ ${autonomy.toFixed(1)} jour(s) pour ${need.totals.heads} animaux.`,
      actionUrl: "/feed-mill/planning", entityType: "feed_nutrition", deduplicationKey: `feed-stock:${today}`,
    });
    for (const metric of metrics.filter((item) => item.warning)) signals.push({
      type: "feed_conversion_warning", category: metric.kind === "pigs" ? "pigs" : "poultry", priority: "high",
      title: "Indice de conversion à vérifier", message: `${metric.kind === "pigs" ? "Porcs" : metric.kind === "layers" ? "Pondeuses" : "Poulets de chair"} : IC ${metric.fcr?.toFixed(2)} pour une référence de ${metric.benchmark.toFixed(2)}.`,
      actionUrl: "/feed-mill/planning", entityType: "feed_nutrition", deduplicationKey: `feed-fcr:${metric.kind}:${today}`,
    });
    const deathsToday = number(mortality.rows[0]?.poultry) + number(mortality.rows[0]?.pigs);
    const mortalityRate = need.totals.heads > 0 ? deathsToday / need.totals.heads : 0;
    const recentDeaths = trailingMortality.rows.map((row) => number(row.deaths));
    const [firstDay = 0, secondDay = 0, thirdDay = 0] = recentDeaths;
    const risingThreeDays = recentDeaths.length === 3 && firstDay > 0 && firstDay < secondDay && secondDay < thirdDay;
    if (mortalityRate > 0.01 || risingThreeDays) signals.push({
      type: "mortality_alert", category: "veterinary", priority: "urgent", title: "Alerte mortalité",
      message: mortalityRate > 0.01 ? `La mortalité du jour est de ${(mortalityRate * 100).toFixed(1)} % (${deathsToday} décès).` : `La mortalité augmente depuis trois jours (${recentDeaths.join(" → ")}).`,
      actionUrl: "/daily-work", entityType: "animal_mortality", deduplicationKey: `mortality:${today}`,
    });
    for (const item of [...dueHealth.rows, ...scheduledPoultryVaccines.rows]) {
      const todayDue = item.due_date === today;
      const projectContext = item.project_name ? ` · Projet : ${item.project_name}` : "";
      const reminder = item.reminder_kind === "farrowing"
        ? { today: "Mise bas à surveiller aujourd’hui", tomorrow: "Mise bas à préparer demain" }
        : item.reminder_kind === "veterinary_follow_up"
          ? { today: "Contrôle vétérinaire à effectuer aujourd’hui", tomorrow: "Contrôle vétérinaire à préparer demain" }
          : { today: "Vaccination à administrer aujourd’hui", tomorrow: "Vaccination à préparer demain" };
      signals.push({
        type: "prophylaxis_due",
        category: "veterinary",
        priority: todayDue ? "high" : "normal",
        title: todayDue ? reminder.today : reminder.tomorrow,
        message: `${item.name} · ${item.subject_name} · ${item.site_name} · ${item.due_date}${projectContext}`,
        actionUrl: item.species === "pigs" ? "/pigs/health" : "/poultry/health",
        entityType: item.species === "pigs" ? "pig_pen" : "poultry_flock",
        deduplicationKey: `prophylaxis:${item.species}:${item.subject_id}:${item.source_id}:${item.due_date}:${today}`,
        provinceId: item.province_id,
        siteId: item.site_id,
      });
    }
    const sms: Array<{ recipients: NutritionRecipient[]; content: string }> = [];
    const vaccinationReminders: Array<{
      recipients: NutritionRecipient[];
      content: string;
      actionUrl: string;
    }> = [];
    for (const signal of signals) {
      const recipients = await notifyNutritionAudience(client, organizationId, signal);
      const content = `LiteHubs · ${signal.title} : ${signal.message}`;
      if (signal.type === "prophylaxis_due") {
        vaccinationReminders.push({
          recipients,
          content,
          actionUrl: signal.actionUrl,
        });
      } else if (signal.priority === "urgent" || signal.priority === "high") {
        sms.push({ recipients, content });
      }
    }
    return {
      alertCount: signals.length,
      sms,
      vaccinationReminders,
      organizationSlug,
    };
  });
  for (const item of plan.sms) await sendNutritionSms(item.recipients, item.content);
  await Promise.allSettled(
    plan.vaccinationReminders.flatMap((item) =>
      item.recipients.map((recipient) =>
        deliverVaccinationReminder(
          recipient,
          item.content,
          plan.organizationSlug
            ? `${env.frontendUrl}/${plan.organizationSlug}${item.actionUrl}`
            : `${env.frontendUrl}${item.actionUrl}`,
        ),
      ),
    ),
  );
  return { alerts: plan.alertCount };
}

/** Runs at 18:30 Africa/Kinshasa. Email is queued through notification preferences; SMS is used only when enabled. */
export async function sendNutritionExecutiveSummaryForOrganization(organizationId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const plan = await withTenantContext({ organizationId, userId: null }, async (client) => {
    const [need, stock, poultry, pigs, eggs, sales] = await Promise.all([
      feedRequirements(client, organizationId), finishedStock(client, organizationId),
      client.query<{ feed: string; mortality: string }>(`SELECT COALESCE((SELECT SUM(quantity_kg) FROM poultry_feed_records WHERE organization_id=$1 AND feed_date=CURRENT_DATE),0)::text AS feed,COALESCE((SELECT SUM(death_count) FROM poultry_mortality_records WHERE organization_id=$1 AND mortality_date=CURRENT_DATE),0)::text AS mortality`, [organizationId]),
      client.query<{ feed: string; mortality: string }>(`SELECT COALESCE((SELECT SUM(quantity_kg) FROM pig_feed_records WHERE organization_id=$1 AND feed_date=CURRENT_DATE),0)::text AS feed,COALESCE((SELECT SUM(death_count) FROM pig_mortality_records WHERE organization_id=$1 AND mortality_date=CURRENT_DATE),0)::text AS mortality`, [organizationId]),
      client.query<{ eggs: string }>(`SELECT COALESCE(SUM(total_eggs-cracked_eggs-dirty_eggs-hatching_eggs),0)::text AS eggs FROM poultry_egg_records WHERE organization_id=$1 AND record_date=CURRENT_DATE`, [organizationId]),
      client.query<{ currency: string; revenue: string }>(`SELECT sale.currency,COALESCE(SUM(line.quantity*order_line.unit_price*(1-order_line.discount_percent/100)*(1+order_line.tax_percent/100)),0)::text AS revenue FROM sales_deliveries delivery JOIN sales_orders sale ON sale.organization_id=delivery.organization_id AND sale.id=delivery.order_id JOIN sales_delivery_lines line ON line.organization_id=delivery.organization_id AND line.delivery_id=delivery.id JOIN sales_order_lines order_line ON order_line.organization_id=line.organization_id AND order_line.id=line.order_line_id WHERE delivery.organization_id=$1 AND delivery.status='delivered' AND delivery.delivered_on=CURRENT_DATE GROUP BY sale.currency`, [organizationId]),
    ]);
    const revenue = sales.rows.map((row) => `${number(row.revenue).toLocaleString("fr-FR")} ${row.currency}`).join(" · ") || "0";
    const consumed = number(poultry.rows[0]?.feed) + number(pigs.rows[0]?.feed);
    const deaths = number(poultry.rows[0]?.mortality) + number(pigs.rows[0]?.mortality);
    const autonomy = need.totals.dailyKg > 0 ? stock.quantityKg / need.totals.dailyKg : null;
    const message = `Œufs : ${number(eggs.rows[0]?.eggs).toLocaleString("fr-FR")} · Mortalité : ${deaths} · Aliment distribué : ${consumed.toLocaleString("fr-FR")} kg · Stock aliment : ${stock.quantityKg.toLocaleString("fr-FR")} kg${autonomy === null ? "" : ` (${autonomy.toFixed(1)} j)`} · Ventes livrées : ${revenue}.`;
    const recipients = await notifyNutritionAudience(client, organizationId, { type: "farm_daily_summary", category: "report", priority: "normal", title: "Résumé opérationnel quotidien", message, actionUrl: "/feed-mill/planning", entityType: "farm_daily_summary", deduplicationKey: `farm-summary:${today}` });
    return { recipients, message };
  });
  await sendNutritionSms(plan.recipients, `LiteHubs · Résumé du jour : ${plan.message}`);
  return { recipients: plan.recipients.length };
}
