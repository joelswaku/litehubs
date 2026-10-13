/**
 * Executive dashboard « insights »: one read-only snapshot of the whole
 * business for the home page — alerts, money trends, stock, farm production,
 * the most urgent items and a few overview tiles.
 *
 * Security model (mirrors the module read routes it summarises):
 *   - every block is gated by the same permission code as the module's own
 *     read route; the owner sees everything;
 *   - non-owners are limited to their data scope FOR THAT BLOCK'S PERMISSIONS
 *     (only the roles granting that module's permissions count — an unrelated
 *     organisation-wide role never widens another block): organization-wide
 *     roles see everything, province roles only rows in their
 *     member_provinces, and any narrower scope (project/self) gets the block
 *     omitted;
 *   - project-linked owner-management rows (expenses, tasks, approvals,
 *     purchase requests, assets) stay visible only to the project's assigned
 *     manager, exactly like owner-management's assertVisible.
 *
 * All queries run in one RLS transaction. Each block runs under its own
 * savepoint so a failing block returns null without breaking the rest.
 */
import type { PoolClient } from "pg";
import { logger } from "../../config/logger";
import { shiftDays, today as todayIn } from "../../utils/dates";
import { permissionScope } from "../../utils/permission-scope";
import { withTenantContext } from "../../utils/tenant-query";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type InsightsContext = {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
  permissions: string[];
};

export type Tone = "critical" | "warning" | "info" | "good";
export type Point = { date: string; amount: number };
export type InsightAlert = { key: string; tone: Tone; count: number; label: string; href: string };
export type CriticalItem = {
  key: string;
  kind: "stock" | "flock" | "pen" | "vaccine" | "vehicle" | "task" | "invoice" | "approval";
  title: string;
  detail: string;
  place: string | null;
  badge: string;
  tone: Tone;
  href: string;
};
export type OverviewTile = { key: string; label: string; value: number; sub: string | null; href: string };
export type Insights = {
  generatedAt: string;
  currency: string | null;
  alerts: InsightAlert[];
  spend: { days: number; total: number; currency: string; categories: { label: string; amount: number }[] } | null;
  sales: { currency: string; total7d: number; previous7d: number; daily: Point[] } | null;
  expensesTrend: { currency: string; total7d: number; previous7d: number; daily: Point[] } | null;
  stock: { itemCount: number; value: number | null; currency: string | null; lowCount: number } | null;
  production: {
    poultry: {
      flocks: number;
      birds: number;
      eggsToday: number;
      eggs7d: number;
      previousEggs7d: number;
      deaths7d: number;
      eggsDaily: Point[];
    } | null;
    pigs: { pens: number; heads: number; deaths7d: number; farrowings30d: number } | null;
    crops: { activePlantings: number; harvest30d: number; harvestUnit: string | null } | null;
  };
  critical: CriticalItem[];
  overview: OverviewTile[];
  finance: { currency: string; receivables: number; overdueInvoices: number; overdueAmount: number } | null;
  people: { active: number; presentToday: number; onLeaveToday: number; pendingLeave: number } | null;
};

/** Business days are decided in Kinshasa, where Congo Omega operates. */
const BUSINESS_TIMEZONE = "Africa/Kinshasa";
const CRITICAL_LIMIT = 12;
const TONE_RANK: Record<Tone, number> = { critical: 0, warning: 1, info: 2, good: 3 };

type Scope = "organization" | "province" | "limited";

const n = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const money = (value: number) => Math.round(value * 100) / 100;
const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;
const frDate = (day: string | null | undefined) => {
  if (!day) return "";
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
};
const daysLate = (day: string, today: string) => Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000);
const fmtNumber = (value: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value);

/* ------------------------------------------------------------------ */
/* Per-request query environment                                       */
/* ------------------------------------------------------------------ */

type Collector = { alerts: InsightAlert[]; critical: (CriticalItem & { rank: number })[]; tiles: (OverviewTile & { order: number })[] };

class Env {
  constructor(
    readonly client: PoolClient,
    readonly context: InsightsContext,
    readonly today: string,
  ) {}

  private readonly scopes = new Map<string, Promise<Scope>>();

  /** Scope from the member's roles that grant `families` only (cached per request). */
  scopeFor(families: string[]): Promise<Scope> {
    const key = families.join("|");
    let found = this.scopes.get(key);
    if (!found) {
      found = permissionScope(this.client, this.context, families).then((scope) =>
        scope === "organization" || scope === "province" ? scope : "limited",
      );
      // A failed lookup (e.g. inside a rolled-back savepoint) must not poison other blocks.
      found.catch(() => this.scopes.delete(key));
      this.scopes.set(key, found);
    }
    return found;
  }

  can(...codes: string[]) {
    return this.context.isOwner || codes.every((code) => this.context.permissions.includes(code));
  }

  /**
   * Every query gets $1 organization, $2 member, $3 today (Kinshasa). A leading
   * CTE references all three so Postgres can type them even when a query does
   * not use them; extra parameters start at $4.
   */
  query(sql: string, extra: unknown[] = []) {
    const trimmed = sql.trimStart();
    const body = /^with\s/i.test(trimmed) ? `, ${trimmed.slice(5)}` : ` ${trimmed}`;
    return this.client.query<Row>(`WITH _ctx AS (SELECT $1::uuid AS org, $2::uuid AS member, $3::date AS today)${body}`, [
      this.context.organizationId,
      this.context.memberId,
      this.today,
      ...extra,
    ]);
  }

  private inMemberProvinces(column: string) {
    return `${column} IN (SELECT mp.province_id FROM member_provinces mp WHERE mp.organization_id = $1 AND mp.member_id = $2::uuid)`;
  }

  /** Farm / HR / appointment modules: province roles see their provinces only. */
  async area(families: string[], provinceColumn: string): Promise<string | null> {
    const scope = await this.scopeFor(families);
    if (scope === "organization") return "TRUE";
    if (scope === "province") return `(${provinceColumn} IS NOT NULL AND ${this.inMemberProvinces(provinceColumn)})`;
    return null;
  }

  /** Sales rule (sales.service maySeeProvince): no province → visible, else must be in the member's provinces. */
  async salesArea(families: string[], provinceColumn: string): Promise<string> {
    if ((await this.scopeFor(families)) === "organization") return "TRUE";
    return `(${provinceColumn} IS NULL OR ${this.inMemberProvinces(provinceColumn)})`;
  }

  /** Owner-management rule (owner-management.service assertVisible). */
  async managed(families: string[], projectColumn: string, provinceColumn: string): Promise<string | null> {
    if (this.context.isOwner) return "TRUE";
    const scope = await this.scopeFor(families);
    const manager = `EXISTS (SELECT 1 FROM management_project_members pm WHERE pm.organization_id = $1 AND pm.project_id = ${projectColumn} AND pm.member_id = $2::uuid AND pm.is_manager AND pm.assignment_start_date <= $3::date AND (pm.assignment_end_date IS NULL OR pm.assignment_end_date >= $3::date))`;
    if (scope === "organization") return `(${projectColumn} IS NULL OR ${manager})`;
    if (scope === "province")
      return `((${projectColumn} IS NULL AND ${provinceColumn} IS NOT NULL AND ${this.inMemberProvinces(provinceColumn)}) OR (${projectColumn} IS NOT NULL AND ${manager}))`;
    return null;
  }

  days(from: number, to = 0): string[] {
    const result: string[] = [];
    for (let offset = from; offset <= to; offset++) result.push(shiftDays(this.today, offset));
    return result;
  }
}

async function section<T>(env: Env, sink: Collector, name: string, run: (out: Collector) => Promise<T>): Promise<T | null> {
  const out: Collector = { alerts: [], critical: [], tiles: [] };
  const savepoint = `insights_${name.replace(/\W/g, "_")}`;
  await env.client.query(`SAVEPOINT ${savepoint}`);
  try {
    const value = await run(out);
    await env.client.query(`RELEASE SAVEPOINT ${savepoint}`);
    sink.alerts.push(...out.alerts);
    sink.critical.push(...out.critical);
    sink.tiles.push(...out.tiles);
    return value;
  } catch (error) {
    await env.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => {});
    logger.error({ err: error, section: name, organizationId: env.context.organizationId }, "dashboard insights section failed");
    return null;
  }
}

/** Chooses the currency with the largest absolute total. */
function mainCurrency(totals: Map<string, number>, fallback: string): string {
  let best: string | null = null;
  let bestValue = -1;
  for (const [currency, total] of totals) {
    if (Math.abs(total) > bestValue) {
      best = currency;
      bestValue = Math.abs(total);
    }
  }
  return best ?? fallback;
}

function series(env: Env, byDay: Map<string, number>, from = -29): Point[] {
  return env.days(from).map((date) => ({ date, amount: money(byDay.get(date) ?? 0) }));
}
function sumDays(env: Env, byDay: Map<string, number>, from: number, to: number) {
  return money(env.days(from, to).reduce((sum, day) => sum + (byDay.get(day) ?? 0), 0));
}

/* ------------------------------------------------------------------ */
/* Farm production                                                     */
/* ------------------------------------------------------------------ */

async function poultry(env: Env, out: Collector) {
  const area = await env.area(["poultry."], "s.province_id");
  if (!area || !env.can("poultry.flocks.read", "poultry.mortality.read")) return null;
  const flocks = await env.query(
    `SELECT f.id, f.code, f.name, f.status, f.initial_bird_count, f.mortality_review_threshold,
            h.name AS house_name, s.name AS site_name,
            COALESCE((SELECT sum(death_count) FROM poultry_mortality_records m WHERE m.organization_id = f.organization_id AND m.flock_id = f.id), 0) AS deaths_total,
            COALESCE((SELECT sum(death_count) FROM poultry_mortality_records m WHERE m.organization_id = f.organization_id AND m.flock_id = f.id AND m.mortality_date = $3::date), 0) AS deaths_today
       FROM poultry_flocks f
       JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id
       JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
      WHERE f.organization_id = $1 AND f.status IN ('active', 'quarantined') AND ${area}`,
  );
  const daily = await env.query(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS day, sum(d.eggs) AS eggs, sum(d.deaths) AS deaths FROM (
       SELECT r.record_date AS day, r.total_eggs AS eggs, 0 AS deaths
         FROM poultry_egg_records r
         JOIN poultry_flocks f ON f.organization_id = r.organization_id AND f.id = r.flock_id
         JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id
         JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
        WHERE r.organization_id = $1 AND r.record_date BETWEEN $3::date - 29 AND $3::date AND ${area}
       UNION ALL
       SELECT m.mortality_date, 0, m.death_count
         FROM poultry_mortality_records m
         JOIN poultry_flocks f ON f.organization_id = m.organization_id AND f.id = m.flock_id
         JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id
         JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
        WHERE m.organization_id = $1 AND m.mortality_date BETWEEN $3::date - 29 AND $3::date AND ${area}
     ) d GROUP BY d.day`,
  );
  const eggs = new Map<string, number>();
  const deaths = new Map<string, number>();
  for (const row of daily.rows) {
    eggs.set(String(row.day), n(row.eggs));
    deaths.set(String(row.day), n(row.deaths));
  }

  // Same status rule as displays.service poultryBoard: quarantine first, then
  // today's deaths reaching the flock's review threshold.
  let mortality = 0;
  let quarantine = 0;
  for (const row of flocks.rows) {
    const deathsToday = n(row.deaths_today);
    const status =
      row.status === "quarantined" ? "quarantine" : deathsToday >= n(row.mortality_review_threshold) && deathsToday > 0 ? "mortality" : "ok";
    if (status === "ok") continue;
    if (status === "mortality") mortality++;
    else quarantine++;
    out.critical.push({
      key: `flock:${row.id}`,
      kind: "flock",
      title: `Lot ${row.code}${row.name && row.name !== row.code ? ` — ${row.name}` : ""}`,
      detail:
        status === "mortality"
          ? `${plural(deathsToday, "mort", "morts")} aujourd'hui (seuil ${n(row.mortality_review_threshold)})`
          : "Lot en quarantaine",
      place: [row.site_name, row.house_name].filter(Boolean).join(" · ") || null,
      badge: status === "mortality" ? "Mortalité" : "Quarantaine",
      tone: status === "mortality" ? "critical" : "warning",
      href: "/poultry",
      rank: status === "mortality" ? 1000 + deathsToday : 500,
    });
  }
  if (mortality)
    out.alerts.push({ key: "poultry-mortality", tone: "critical", count: mortality, label: `${plural(mortality, "lot", "lots")} avec mortalité élevée`, href: "/poultry" });
  if (quarantine)
    out.alerts.push({ key: "poultry-quarantine", tone: "warning", count: quarantine, label: `${plural(quarantine, "lot", "lots")} en quarantaine`, href: "/poultry" });

  return {
    flocks: flocks.rows.length,
    birds: flocks.rows.reduce((sum, row) => sum + Math.max(0, n(row.initial_bird_count) - n(row.deaths_total)), 0),
    eggsToday: eggs.get(env.today) ?? 0,
    eggs7d: sumDays(env, eggs, -6, 0),
    previousEggs7d: sumDays(env, eggs, -13, -7),
    deaths7d: sumDays(env, deaths, -6, 0),
    eggsDaily: series(env, eggs),
  };
}

async function pigs(env: Env, out: Collector) {
  const area = await env.area(["pigs."], "s.province_id");
  if (!area || !env.can("pigs.pens.read", "pigs.animals.read", "pigs.farrowing.read")) return null;
  // Same pen figures and status rule as displays.service pigBoard.
  const pens = await env.query(
    `SELECT p.id, p.code, p.name, s.name AS site_name,
            COALESCE((SELECT sum(initial_count) FROM pig_groups g WHERE g.organization_id = p.organization_id AND g.pen_id = p.id AND g.status = 'active'), 0)
              + (SELECT count(*) FROM pig_animals a WHERE a.organization_id = p.organization_id AND a.pen_id = p.id AND a.group_id IS NULL AND a.status IN ('active','pregnant','lactating','quarantined')) AS head_count,
            (SELECT count(*) FROM pig_pregnancies x WHERE x.organization_id = p.organization_id AND x.pen_id = p.id AND x.status IN ('suspected','confirmed')) AS pregnancies,
            (SELECT count(*) FROM pig_quarantine_records q WHERE q.organization_id = p.organization_id AND q.pen_id = p.id AND q.status = 'active') AS quarantines,
            COALESCE((SELECT sum(death_count) FROM pig_mortality_records m WHERE m.organization_id = p.organization_id AND m.pen_id = p.id AND m.mortality_date BETWEEN $3::date - 6 AND $3::date), 0) AS deaths_7d
       FROM pig_pens p
       JOIN sites s ON s.organization_id = p.organization_id AND s.id = p.site_id
      WHERE p.organization_id = $1 AND p.is_active AND ${area}`,
  );
  const farrowings = await env.query(
    `SELECT count(*) AS count
       FROM pig_farrowing_records r
       JOIN pig_pens p ON p.organization_id = r.organization_id AND p.id = r.pen_id
       JOIN sites s ON s.organization_id = p.organization_id AND s.id = p.site_id
      WHERE r.organization_id = $1 AND r.farrowing_date BETWEEN $3::date - 29 AND $3::date AND ${area}`,
  );
  const visible = pens.rows
    .map((row) => ({
      id: String(row.id),
      code: String(row.code),
      name: (row.name as string | null) ?? null,
      site_name: (row.site_name as string | null) ?? null,
      pregnancies: n(row.pregnancies),
      heads: n(row.head_count),
      deaths7d: n(row.deaths_7d),
      status: n(row.quarantines) > 0 ? "quarantine" : n(row.deaths_7d) > 0 ? "mortality" : "ok",
    }))
    .filter((pen) => pen.heads > 0 || n(pen.pregnancies) > 0 || pen.status !== "ok");
  let quarantine = 0;
  let mortality = 0;
  for (const pen of visible) {
    if (pen.status === "ok") continue;
    if (pen.status === "quarantine") quarantine++;
    else mortality++;
    out.critical.push({
      key: `pen:${pen.id}`,
      kind: "pen",
      title: `Enclos ${pen.code}${pen.name && pen.name !== pen.code ? ` — ${pen.name}` : ""}`,
      detail: pen.status === "quarantine" ? "Quarantaine active" : `${plural(pen.deaths7d, "mort", "morts")} sur 7 jours`,
      place: (pen.site_name as string | null) ?? null,
      badge: pen.status === "quarantine" ? "Quarantaine" : "Mortalité",
      tone: "warning",
      href: "/pigs",
      rank: pen.status === "mortality" ? 400 + pen.deaths7d : 450,
    });
  }
  if (mortality)
    out.alerts.push({ key: "pig-mortality", tone: "warning", count: mortality, label: `${plural(mortality, "enclos", "enclos")} avec mortalité (7 jours)`, href: "/pigs" });
  if (quarantine)
    out.alerts.push({ key: "pig-quarantine", tone: "warning", count: quarantine, label: `${plural(quarantine, "enclos", "enclos")} en quarantaine`, href: "/pigs" });
  return {
    pens: visible.length,
    heads: visible.reduce((sum, pen) => sum + pen.heads, 0),
    deaths7d: visible.reduce((sum, pen) => sum + pen.deaths7d, 0),
    farrowings30d: n(farrowings.rows[0]?.count),
  };
}

async function crops(env: Env) {
  const area = await env.area(["agriculture.", "agronomy."], "s.province_id");
  if (!area || !env.can("agriculture.plantings.read", "agriculture.harvest.read")) return null;
  const from = `agriculture_plantings pl
       JOIN agriculture_plots pt ON pt.organization_id = pl.organization_id AND pt.id = pl.plot_id
       JOIN agriculture_fields fi ON fi.organization_id = pt.organization_id AND fi.id = pt.field_id
       JOIN agriculture_farms fa ON fa.organization_id = fi.organization_id AND fa.id = fi.farm_id
       JOIN sites s ON s.organization_id = fa.organization_id AND s.id = fa.site_id`;
  const active = await env.query(`SELECT count(*) AS count FROM ${from} WHERE pl.organization_id = $1 AND pl.status IN ('planted','growing') AND ${area}`);
  const harvest = await env.query(
    `SELECT COALESCE(NULLIF(trim(h.unit), ''), 'unité') AS unit, sum(h.quantity) AS quantity
       FROM agriculture_harvest_records h JOIN ${from} ON pl.organization_id = h.organization_id AND pl.id = h.planting_id
      WHERE h.organization_id = $1 AND h.harvest_date BETWEEN $3::date - 29 AND $3::date AND ${area}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
  );
  const top = harvest.rows[0];
  return {
    activePlantings: n(active.rows[0]?.count),
    harvest30d: top ? money(n(top.quantity)) : 0,
    harvestUnit: top ? String(top.unit) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Veterinary                                                          */
/* ------------------------------------------------------------------ */

async function vaccinations(env: Env, out: Collector) {
  const rows: Row[] = [];
  const poultryArea = await env.area(["poultry."], "s.province_id");
  if (poultryArea && env.can("poultry.vaccinations.read")) {
    // The latest record of a vaccine for a flock carries the next due date.
    const result = await env.query(
      `SELECT r.id, 'poultry' AS species, r.vaccine_name, to_char(r.next_due_date, 'YYYY-MM-DD') AS due,
              'Lot ' || f.code AS subject, s.name AS site_name
         FROM poultry_vaccination_records r
         JOIN poultry_flocks f ON f.organization_id = r.organization_id AND f.id = r.flock_id
         JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id
         JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
        WHERE r.organization_id = $1 AND f.status IN ('active','quarantined','ready_for_sale')
          AND r.next_due_date IS NOT NULL AND r.next_due_date <= $3::date + 3 AND ${poultryArea}
          AND NOT EXISTS (SELECT 1 FROM poultry_vaccination_records x
                           WHERE x.organization_id = r.organization_id AND x.flock_id = r.flock_id
                             AND lower(x.vaccine_name) = lower(r.vaccine_name)
                             AND (x.vaccination_date > r.vaccination_date OR (x.vaccination_date = r.vaccination_date AND x.created_at > r.created_at)))
        ORDER BY r.next_due_date LIMIT 300`,
    );
    rows.push(...result.rows);
  }
  const pigArea = await env.area(["pigs."], "s.province_id");
  if (pigArea && env.can("pigs.vaccinations.read")) {
    const result = await env.query(
      `SELECT r.id, 'pig' AS species, r.vaccine_name, to_char(r.next_due_date, 'YYYY-MM-DD') AS due,
              'Enclos ' || p.code AS subject, s.name AS site_name
         FROM pig_vaccination_records r
         JOIN pig_pens p ON p.organization_id = r.organization_id AND p.id = r.pen_id
         JOIN sites s ON s.organization_id = p.organization_id AND s.id = p.site_id
        WHERE r.organization_id = $1 AND p.is_active
          AND r.next_due_date IS NOT NULL AND r.next_due_date <= $3::date + 3 AND ${pigArea}
          AND NOT EXISTS (SELECT 1 FROM pig_vaccination_records x
                           WHERE x.organization_id = r.organization_id AND x.pen_id = r.pen_id
                             AND x.group_id IS NOT DISTINCT FROM r.group_id AND x.animal_id IS NOT DISTINCT FROM r.animal_id
                             AND lower(x.vaccine_name) = lower(r.vaccine_name)
                             AND (x.vaccination_date > r.vaccination_date OR (x.vaccination_date = r.vaccination_date AND x.created_at > r.created_at)))
        ORDER BY r.next_due_date LIMIT 300`,
    );
    rows.push(...result.rows);
  }
  let overdue = 0;
  for (const row of rows) {
    const due = String(row.due);
    const late = daysLate(due, env.today);
    if (late > 0) overdue++;
    out.critical.push({
      key: `vaccine:${row.species}:${row.id}`,
      kind: "vaccine",
      title: `${row.vaccine_name} — ${row.subject}`,
      detail: late > 0 ? `Rappel prévu le ${frDate(due)} (${plural(late, "jour", "jours")} de retard)` : late === 0 ? "Rappel prévu aujourd'hui" : `Rappel prévu le ${frDate(due)}`,
      place: (row.site_name as string | null) ?? null,
      badge: late > 0 ? "En retard" : "À faire",
      tone: late > 0 ? "critical" : "warning",
      href: "/veterinary",
      rank: late > 0 ? 900 + late : 300 + late,
    });
  }
  if (overdue)
    out.alerts.push({ key: "vaccinations-overdue", tone: "critical", count: overdue, label: `${plural(overdue, "vaccination en retard", "vaccinations en retard")}`, href: "/veterinary" });
  return true;
}

/* ------------------------------------------------------------------ */
/* Stock                                                               */
/* ------------------------------------------------------------------ */

async function stock(env: Env, out: Collector, currency: string | null) {
  // Reorder levels are company-wide thresholds on the item catalogue, so
  // comparing one province's stock to them would raise false shortages:
  // the block is for organization-wide roles only.
  if ((await env.scopeFor(["inventory."])) !== "organization" || !env.can("inventory.items.read", "inventory.stock.read")) return null;
  const area = "TRUE";
  const items = await env.query(
    `SELECT i.id, i.name, i.unit, i.reorder_level, i.standard_unit_cost,
            COALESCE((SELECT sum(st.quantity_on_hand)
                        FROM management_inventory_stock st
                        JOIN management_warehouses w ON w.organization_id = st.organization_id AND w.id = st.warehouse_id
                        JOIN sites s ON s.organization_id = w.organization_id AND s.id = w.site_id
                       WHERE st.organization_id = i.organization_id AND st.item_id = i.id AND ${area}), 0) AS quantity
       FROM management_inventory_items i
      WHERE i.organization_id = $1 AND i.is_active`,
  );
  let value = 0;
  let valued = false;
  let low = 0;
  let empty = 0;
  for (const item of items.rows) {
    const quantity = n(item.quantity);
    if (item.standard_unit_cost !== null && item.standard_unit_cost !== undefined) {
      valued = true;
      value += quantity * n(item.standard_unit_cost);
    }
    const minimum = n(item.reorder_level);
    if (minimum > 0 && quantity <= minimum) {
      low++;
      if (quantity <= 0) empty++;
      out.critical.push({
        key: `stock:${item.id}`,
        kind: "stock",
        title: String(item.name),
        detail: `Stock : ${fmtNumber(quantity)} ${item.unit ?? ""} (minimum ${fmtNumber(minimum)})`.replace(/\s+\(/, " ("),
        place: null,
        badge: quantity <= 0 ? "Rupture" : "Stock bas",
        tone: quantity <= 0 ? "critical" : "warning",
        href: "/inventory",
        rank: quantity <= 0 ? 800 : 350 + Math.round((1 - quantity / minimum) * 100),
      });
    }
  }
  if (low)
    out.alerts.push({
      key: "stock-low",
      tone: empty ? "critical" : "warning",
      count: low,
      label: `${plural(low, "article", "articles")} sous le stock minimum`,
      href: "/inventory",
    });
  return { itemCount: items.rows.length, value: valued ? money(value) : null, currency: valued ? currency : null, lowCount: low };
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

async function expenses(env: Env, days: number, fallbackCurrency: string) {
  const visible = await env.managed(["finance."], "e.project_id", "e.province_id");
  if (!visible || !env.can("finance.expenses.read")) return { spend: null, trend: null };
  const window = Math.max(days, 30);
  // Paid spend as owner-management counts it: approved/paid, reimbursements subtract.
  const result = await env.query(
    `SELECT to_char(e.expense_date, 'YYYY-MM-DD') AS day, trim(e.currency_code) AS currency,
            COALESCE(NULLIF(trim(e.category), ''), 'Autres') AS category,
            sum(CASE WHEN e.expense_type = 'reimbursement' THEN -e.amount ELSE e.amount END) AS amount
       FROM management_expenses e
      WHERE e.organization_id = $1 AND e.status IN ('approved','paid')
        AND e.expense_date BETWEEN $3::date - ($4::int - 1) AND $3::date AND ${visible}
      GROUP BY 1, 2, 3`,
    [window],
  );
  const spendFrom = shiftDays(env.today, -(days - 1));
  const trendFrom = shiftDays(env.today, -29);
  const spendTotals = new Map<string, number>();
  const trendTotals = new Map<string, number>();
  for (const row of result.rows) {
    const day = String(row.day);
    if (day >= spendFrom) spendTotals.set(row.currency, (spendTotals.get(row.currency) ?? 0) + n(row.amount));
    if (day >= trendFrom) trendTotals.set(row.currency, (trendTotals.get(row.currency) ?? 0) + n(row.amount));
  }
  const spendCurrency = mainCurrency(spendTotals, fallbackCurrency);
  const byCategory = new Map<string, number>();
  for (const row of result.rows)
    if (String(row.day) >= spendFrom && row.currency === spendCurrency)
      byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + n(row.amount));
  const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const categories = sorted.slice(0, 6).map(([label, amount]) => ({ label, amount: money(amount) }));
  const rest = sorted.slice(6).reduce((sum, [, amount]) => sum + amount, 0);
  if (sorted.length > 6) {
    const existing = categories.find((item) => item.label === "Autres");
    if (existing) existing.amount = money(existing.amount + rest);
    else categories.push({ label: "Autres", amount: money(rest) });
  }

  const trendCurrency = mainCurrency(trendTotals, fallbackCurrency);
  const byDay = new Map<string, number>();
  for (const row of result.rows)
    if (String(row.day) >= trendFrom && row.currency === trendCurrency) byDay.set(String(row.day), (byDay.get(String(row.day)) ?? 0) + n(row.amount));

  return {
    spend: { days, total: money(spendTotals.get(spendCurrency) ?? 0), currency: spendCurrency, categories },
    trend: { currency: trendCurrency, total7d: sumDays(env, byDay, -6, 0), previous7d: sumDays(env, byDay, -13, -7), daily: series(env, byDay) },
  };
}

async function sales(env: Env, fallbackCurrency: string) {
  if (!env.can("sales.read")) return null;
  const result = await env.query(
    `SELECT to_char(o.order_date, 'YYYY-MM-DD') AS day, trim(o.currency) AS currency, sum(o.total) AS amount
       FROM sales_orders o
      WHERE o.organization_id = $1 AND o.status IN ('confirmed','partially_delivered','delivered','invoiced')
        AND o.order_date BETWEEN $3::date - 29 AND $3::date AND ${await env.salesArea(["sales."], "o.province_id")}
      GROUP BY 1, 2`,
  );
  const totals = new Map<string, number>();
  for (const row of result.rows) totals.set(row.currency, (totals.get(row.currency) ?? 0) + n(row.amount));
  const currency = mainCurrency(totals, fallbackCurrency);
  const byDay = new Map<string, number>();
  for (const row of result.rows) if (row.currency === currency) byDay.set(String(row.day), n(row.amount));
  return { currency, total7d: sumDays(env, byDay, -6, 0), previous7d: sumDays(env, byDay, -13, -7), daily: series(env, byDay) };
}

async function finance(env: Env, fallbackCurrency: string) {
  if (!env.can("finance.transactions.read")) return null;
  const result = await env.query(
    `SELECT trim(i.currency) AS currency, sum(i.total - i.paid_total) AS outstanding,
            count(*) FILTER (WHERE i.due_date < $3::date) AS overdue_count,
            COALESCE(sum(i.total - i.paid_total) FILTER (WHERE i.due_date < $3::date), 0) AS overdue_amount
       FROM sales_invoices i
      WHERE i.organization_id = $1 AND i.status IN ('issued','partially_paid','overdue') AND i.total > i.paid_total
        AND ${await env.salesArea(["finance."], "i.province_id")}
      GROUP BY 1`,
  );
  const totals = new Map<string, number>(result.rows.map((row) => [String(row.currency), n(row.outstanding)]));
  const currency = mainCurrency(totals, fallbackCurrency);
  const row = result.rows.find((item) => item.currency === currency);
  return {
    currency,
    receivables: money(n(row?.outstanding)),
    overdueInvoices: n(row?.overdue_count),
    overdueAmount: money(n(row?.overdue_amount)),
  };
}

async function overdueInvoices(env: Env, out: Collector) {
  if (!env.can("sales.read")) return true;
  const result = await env.query(
    `SELECT i.id, i.invoice_number, to_char(i.due_date, 'YYYY-MM-DD') AS due, trim(i.currency) AS currency,
            i.total - i.paid_total AS balance, c.name AS customer_name, p.name AS province_name,
            count(*) OVER () AS total_count
       FROM sales_invoices i
       LEFT JOIN customers c ON c.organization_id = i.organization_id AND c.id = i.customer_id
       LEFT JOIN provinces p ON p.organization_id = i.organization_id AND p.id = i.province_id
      WHERE i.organization_id = $1 AND i.status IN ('issued','partially_paid','overdue') AND i.total > i.paid_total
        AND i.due_date < $3::date AND ${await env.salesArea(["sales."], "i.province_id")}
      ORDER BY i.due_date LIMIT ${CRITICAL_LIMIT}`,
  );
  const count = n(result.rows[0]?.total_count);
  if (count)
    out.alerts.push({ key: "invoices-overdue", tone: "warning", count, label: `${plural(count, "facture impayée", "factures impayées")} en retard`, href: "/invoices" });
  for (const row of result.rows) {
    const late = daysLate(String(row.due), env.today);
    out.critical.push({
      key: `invoice:${row.id}`,
      kind: "invoice",
      title: `Facture ${row.invoice_number}${row.customer_name ? ` — ${row.customer_name}` : ""}`,
      detail: `${fmtNumber(n(row.balance))} ${row.currency} dus depuis le ${frDate(String(row.due))}`,
      place: (row.province_name as string | null) ?? null,
      badge: `${late} j de retard`,
      tone: late > 30 ? "critical" : "warning",
      href: "/invoices",
      rank: late > 30 ? 700 + late : 200 + late,
    });
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Equipment, fleet, maintenance                                       */
/* ------------------------------------------------------------------ */

async function maintenance(env: Env, out: Collector) {
  const planVisible = await env.managed(["maintenance."], "a.project_id", "a.province_id");
  if (planVisible && env.can("maintenance.read")) {
    const plans = await env.query(
      `SELECT mp.id, mp.name AS plan_name, a.name AS asset_name, a.asset_number, s.name AS site_name,
              to_char(mp.next_due_date, 'YYYY-MM-DD') AS due,
              (mp.next_due_meter IS NOT NULL AND a.current_meter_reading IS NOT NULL AND a.current_meter_reading >= mp.next_due_meter) AS meter_due
         FROM management_maintenance_plans mp
         JOIN management_assets a ON a.organization_id = mp.organization_id AND a.id = mp.asset_id
         LEFT JOIN sites s ON s.organization_id = a.organization_id AND s.id = a.site_id
        WHERE mp.organization_id = $1 AND mp.is_active AND a.status NOT IN ('retired','sold','lost')
          AND ((mp.next_due_date IS NOT NULL AND mp.next_due_date <= $3::date + COALESCE(mp.warning_window_days, 7))
               OR (mp.next_due_meter IS NOT NULL AND a.current_meter_reading >= mp.next_due_meter))
          AND ${planVisible}
        ORDER BY mp.next_due_date NULLS LAST LIMIT 300`,
    );
    let overdue = 0;
    let soon = 0;
    for (const row of plans.rows) {
      const late = row.due ? daysLate(String(row.due), env.today) : 0;
      const isOverdue = Boolean(row.meter_due) || late > 0;
      if (isOverdue) overdue++;
      else soon++;
      out.critical.push({
        key: `maintenance:${row.id}`,
        kind: "vehicle",
        title: `${row.asset_name}${row.asset_number ? ` (${row.asset_number})` : ""}`,
        detail: `${row.plan_name} — ${
          row.meter_due ? "compteur atteint" : late > 0 ? `prévu le ${frDate(String(row.due))} (${plural(late, "jour", "jours")} de retard)` : `prévu le ${frDate(String(row.due))}`
        }`,
        place: (row.site_name as string | null) ?? null,
        badge: isOverdue ? "Entretien en retard" : "Entretien à prévoir",
        tone: isOverdue ? "critical" : "warning",
        href: "/maintenance",
        rank: isOverdue ? 750 + late : 250 + late,
      });
    }
    if (overdue)
      out.alerts.push({ key: "maintenance-overdue", tone: "critical", count: overdue, label: `${plural(overdue, "entretien en retard", "entretiens en retard")}`, href: "/maintenance" });
    if (soon)
      out.alerts.push({ key: "maintenance-due", tone: "warning", count: soon, label: `${plural(soon, "entretien à prévoir", "entretiens à prévoir")}`, href: "/maintenance" });
  }

  const orderVisible = await env.managed(["work_orders."], "COALESCE(w.project_id, a.project_id)", "COALESCE(p.province_id, a.province_id)");
  if (orderVisible && env.can("work_orders.read")) {
    const orders = await env.query(
      `SELECT count(*) AS count
         FROM management_maintenance_work_orders w
         JOIN management_assets a ON a.organization_id = w.organization_id AND a.id = w.asset_id
         LEFT JOIN management_projects p ON p.organization_id = w.organization_id AND p.id = COALESCE(w.project_id, a.project_id)
        WHERE w.organization_id = $1 AND w.status NOT IN ('completed','cancelled') AND w.due_date < $3::date AND ${orderVisible}`,
    );
    const count = n(orders.rows[0]?.count);
    if (count)
      out.alerts.push({ key: "work-orders-overdue", tone: "warning", count, label: `${plural(count, "bon de travail en retard", "bons de travail en retard")}`, href: "/maintenance" });
  }

  const vehicleVisible = await env.managed(["vehicles."], "a.project_id", "a.province_id");
  if (vehicleVisible && env.can("vehicles.read")) {
    const vehicles = await env.query(
      `SELECT v.id, COALESCE(v.plate_number, v.registration_number, v.vehicle_number, a.asset_number) AS plate, a.name AS asset_name, s.name AS site_name,
              to_char(v.insurance_expires_on, 'YYYY-MM-DD') AS insurance,
              to_char(v.registration_expires_on, 'YYYY-MM-DD') AS registration,
              to_char(v.inspection_expires_on, 'YYYY-MM-DD') AS inspection
         FROM management_vehicle_profiles v
         JOIN management_assets a ON a.organization_id = v.organization_id AND a.id = v.asset_id
         LEFT JOIN sites s ON s.organization_id = a.organization_id AND s.id = a.site_id
        WHERE v.organization_id = $1 AND a.status NOT IN ('retired','sold','lost')
          AND LEAST(v.insurance_expires_on, v.registration_expires_on, v.inspection_expires_on) <= $3::date + 14
          AND ${vehicleVisible}
        LIMIT 300`,
    );
    let expired = 0;
    for (const row of vehicles.rows) {
      const documents = [
        { label: "assurance", day: row.insurance as string | null },
        { label: "immatriculation", day: row.registration as string | null },
        { label: "contrôle technique", day: row.inspection as string | null },
      ].filter((doc): doc is { label: string; day: string } => Boolean(doc.day) && daysLate(doc.day!, env.today) >= -14);
      if (!documents.length) continue;
      documents.sort((a, b) => a.day.localeCompare(b.day));
      const first = documents[0]!;
      const late = daysLate(first.day, env.today);
      const isExpired = late > 0;
      if (isExpired) expired++;
      out.critical.push({
        key: `vehicle:${row.id}`,
        kind: "vehicle",
        title: `${row.asset_name}${row.plate ? ` (${row.plate})` : ""}`,
        detail: documents.map((doc) => `${doc.label} ${daysLate(doc.day, env.today) > 0 ? "expirée le" : "expire le"} ${frDate(doc.day)}`).join(" · "),
        place: (row.site_name as string | null) ?? null,
        badge: isExpired ? "Documents expirés" : "Documents à renouveler",
        tone: isExpired ? "critical" : "warning",
        href: "/fleet-control",
        rank: isExpired ? 720 + late : 220 + late,
      });
    }
    if (expired)
      out.alerts.push({ key: "vehicle-documents", tone: "critical", count: expired, label: `${plural(expired, "véhicule", "véhicules")} avec documents expirés`, href: "/fleet-control" });
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Work: tasks, approvals, procurement, social                         */
/* ------------------------------------------------------------------ */

const PRIORITY_LABEL: Record<string, string> = { critical: "Critique", high: "Haute", medium: "Moyenne", low: "Basse" };
const REQUEST_LABEL: Record<string, string> = {
  purchase_request: "Demande d'achat",
  expense: "Dépense",
  material_adjustment: "Ajustement de matériel",
  asset_purchase: "Achat d'équipement",
  asset_disposal: "Cession d'équipement",
  maintenance_expense: "Dépense d'entretien",
  budget_increase: "Hausse de budget",
  phase_completion: "Fin de phase",
  other: "Demande",
};

async function tasks(env: Env, out: Collector) {
  const visible = await env.managed(["tasks."], "t.project_id", "COALESCE(p.province_id, t.province_id)");
  if (!visible || !env.can("tasks.read")) return true;
  const result = await env.query(
    `SELECT t.id, t.title, t.priority, to_char(t.due_date, 'YYYY-MM-DD') AS due, p.name AS project_name, s.name AS site_name,
            count(*) OVER () AS total_count
       FROM management_project_tasks t
       LEFT JOIN management_projects p ON p.organization_id = t.organization_id AND p.id = t.project_id
       LEFT JOIN sites s ON s.organization_id = t.organization_id AND s.id = t.site_id
      WHERE t.organization_id = $1 AND t.status NOT IN ('completed','cancelled') AND t.due_date < $3::date AND ${visible}
      ORDER BY CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, t.due_date
      LIMIT ${CRITICAL_LIMIT}`,
  );
  const count = n(result.rows[0]?.total_count);
  if (count) out.alerts.push({ key: "tasks-overdue", tone: "warning", count, label: `${plural(count, "tâche en retard", "tâches en retard")}`, href: "/tasks" });
  for (const row of result.rows) {
    const late = daysLate(String(row.due), env.today);
    const urgent = row.priority === "critical" || row.priority === "high";
    out.critical.push({
      key: `task:${row.id}`,
      kind: "task",
      title: String(row.title),
      detail: `Échéance ${frDate(String(row.due))} (${plural(late, "jour", "jours")} de retard)${row.priority ? ` · priorité ${(PRIORITY_LABEL[row.priority] ?? row.priority).toLowerCase()}` : ""}`,
      place: (row.project_name as string | null) ?? (row.site_name as string | null) ?? null,
      badge: `${late} j de retard`,
      tone: urgent ? "critical" : "warning",
      href: "/tasks",
      rank: urgent ? 650 + late : 150 + late,
    });
  }
  return true;
}

async function approvals(env: Env, out: Collector) {
  const visible = await env.managed(["approvals."], "r.project_id", "p.province_id");
  if (!visible || !env.can("approvals.read")) return true;
  const result = await env.query(
    `SELECT r.id, r.approval_number, r.request_type, r.requested_amount, trim(r.currency_code) AS currency,
            to_char((r.requested_at AT TIME ZONE '${BUSINESS_TIMEZONE}')::date, 'YYYY-MM-DD') AS requested_on, p.name AS project_name,
            count(*) OVER () AS total_count
       FROM management_approval_requests r
       LEFT JOIN management_projects p ON p.organization_id = r.organization_id AND p.id = r.project_id
      WHERE r.organization_id = $1 AND r.status = 'pending' AND ${visible}
      ORDER BY r.requested_at
      LIMIT ${CRITICAL_LIMIT}`,
  );
  const count = n(result.rows[0]?.total_count);
  if (count) out.alerts.push({ key: "approvals-pending", tone: "info", count, label: `${plural(count, "approbation en attente", "approbations en attente")}`, href: "/approvals" });
  for (const row of result.rows) {
    const waiting = row.requested_on ? daysLate(String(row.requested_on), env.today) : 0;
    const amount = row.requested_amount === null || row.requested_amount === undefined ? null : n(row.requested_amount);
    out.critical.push({
      key: `approval:${row.id}`,
      kind: "approval",
      title: `${REQUEST_LABEL[row.request_type] ?? "Demande"} ${row.approval_number}`,
      detail: [amount !== null ? `${fmtNumber(amount)} ${row.currency ?? ""}`.trim() : null, row.requested_on ? `demandée le ${frDate(String(row.requested_on))}` : null]
        .filter(Boolean)
        .join(" · "),
      place: (row.project_name as string | null) ?? null,
      badge: "En attente",
      tone: waiting > 3 ? "warning" : "info",
      href: "/approvals",
      rank: waiting > 3 ? 100 + waiting : waiting,
    });
  }
  return true;
}

async function socialDrafts(env: Env, out: Collector) {
  if (!env.can("social.manage")) return true;
  const result = await env.query(`SELECT count(*) AS count FROM social_posts WHERE organization_id = $1 AND status = 'draft' AND archived_at IS NULL`);
  const count = n(result.rows[0]?.count);
  if (count) out.alerts.push({ key: "social-drafts", tone: "info", count, label: `${plural(count, "publication à valider", "publications à valider")}`, href: "/social" });
  return true;
}

async function leaveAlert(env: Env, out: Collector) {
  const area = await env.area(["leave."], "r.province_id");
  if (!area || !env.can("leave.read")) return true;
  const result = await env.query(`SELECT count(*) AS count FROM leave_requests r WHERE r.organization_id = $1 AND r.status = 'pending' AND ${area}`);
  const count = n(result.rows[0]?.count);
  if (count) out.alerts.push({ key: "leave-pending", tone: "info", count, label: `${plural(count, "demande de congé", "demandes de congé")} en attente`, href: "/leave" });
  return true;
}

/* ------------------------------------------------------------------ */
/* Overview tiles                                                      */
/* ------------------------------------------------------------------ */

async function tiles(env: Env, out: Collector) {
  const sitesArea = await env.area(["sites."], "s.province_id");
  if (sitesArea && env.can("sites.read")) {
    const result = await env.query(
      `SELECT count(*) AS sites, count(DISTINCT s.province_id) AS provinces FROM sites s WHERE s.organization_id = $1 AND s.is_active AND ${sitesArea}`,
    );
    const provinces = n(result.rows[0]?.provinces);
    out.tiles.push({ key: "sites", label: "Sites", value: n(result.rows[0]?.sites), sub: provinces ? plural(provinces, "province", "provinces") : null, href: "/settings/sites", order: 0 });
  }

  const assetsVisible = await env.managed(["equipment."], "a.project_id", "a.province_id");
  if (assetsVisible && env.can("equipment.read")) {
    const result = await env.query(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE a.status IN ('under_maintenance','out_of_service','damaged')) AS unavailable,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM management_vehicle_profiles v WHERE v.organization_id = a.organization_id AND v.asset_id = a.id)) AS vehicles
         FROM management_assets a
        WHERE a.organization_id = $1 AND a.status NOT IN ('retired','sold','lost') AND ${assetsVisible}`,
    );
    const row = result.rows[0];
    const parts = [n(row?.vehicles) ? plural(n(row?.vehicles), "véhicule", "véhicules") : null, n(row?.unavailable) ? `${n(row?.unavailable)} indisponible${n(row?.unavailable) > 1 ? "s" : ""}` : null].filter(Boolean);
    out.tiles.push({ key: "equipment", label: "Véhicules / engins", value: n(row?.total), sub: parts.length ? parts.join(" · ") : null, href: "/equipment", order: 1 });
  }

  const projectsVisible = await env.managed(["projects."], "p.id", "p.province_id");
  if (projectsVisible && env.can("projects.read")) {
    const result = await env.query(
      `SELECT count(*) AS active,
              count(*) FILTER (WHERE COALESCE(p.revised_completion_date, p.target_completion_date) < $3::date) AS late
         FROM management_projects p
        WHERE p.organization_id = $1 AND p.status IN ('planning','approved','in_progress','on_hold') AND ${projectsVisible}`,
    );
    const late = n(result.rows[0]?.late);
    out.tiles.push({ key: "projects", label: "Projets actifs", value: n(result.rows[0]?.active), sub: late ? `${late} en retard` : null, href: "/projects", order: 2 });
  }

  // Purchase requests resolve their scope through an inner project join in
  // owner-management, so a non-owner never sees one that has no project.
  const managedPurchases = await env.managed(["procurement."], "r.project_id", "p.province_id");
  const purchasesVisible = managedPurchases && (env.context.isOwner ? managedPurchases : `(r.project_id IS NOT NULL AND ${managedPurchases})`);
  if (purchasesVisible && env.can("procurement.read")) {
    const result = await env.query(
      `SELECT count(*) AS pending, count(*) FILTER (WHERE r.priority IN ('high','critical')) AS urgent
         FROM management_purchase_requests r
         LEFT JOIN management_projects p ON p.organization_id = r.organization_id AND p.id = r.project_id
        WHERE r.organization_id = $1 AND r.status IN ('submitted','under_review') AND ${purchasesVisible}`,
    );
    const urgent = n(result.rows[0]?.urgent);
    out.tiles.push({
      key: "purchase-requests",
      label: "Demandes d'achat en attente",
      value: n(result.rows[0]?.pending),
      sub: urgent ? `${urgent} urgente${urgent > 1 ? "s" : ""}` : null,
      href: "/procurement",
      order: 3,
    });
  }

  const appointmentsArea = await env.area(["appointments."], "a.province_id");
  if (appointmentsArea && env.can("appointments.read")) {
    const result = await env.query(
      `SELECT count(*) AS total, count(*) FILTER (WHERE a.status IN ('checked_in','waiting','called')) AS waiting
         FROM appointments a
        WHERE a.organization_id = $1 AND a.status NOT IN ('cancelled')
          AND (a.queue_date = $3::date OR (a.queue_date IS NULL AND (a.scheduled_at AT TIME ZONE '${BUSINESS_TIMEZONE}')::date = $3::date))
          AND ${appointmentsArea}`,
    );
    const waiting = n(result.rows[0]?.waiting);
    out.tiles.push({ key: "appointments", label: "Rendez-vous aujourd'hui", value: n(result.rows[0]?.total), sub: waiting ? `${waiting} en attente` : null, href: "/appointments", order: 4 });
  }

  const attendanceArea = await env.area(["attendance."], "r.province_id");
  if (attendanceArea && env.can("attendance.read")) {
    const result = await env.query(
      `SELECT count(DISTINCT r.employee_id) FILTER (WHERE r.status IN ('present','late')) AS present,
              count(DISTINCT r.employee_id) FILTER (WHERE r.status = 'late') AS late
         FROM attendance_records r
        WHERE r.organization_id = $1 AND r.work_date = $3::date AND ${attendanceArea}`,
    );
    const late = n(result.rows[0]?.late);
    out.tiles.push({ key: "attendance", label: "Employés présents aujourd'hui", value: n(result.rows[0]?.present), sub: late ? `${late} en retard` : null, href: "/attendance", order: 5 });
  }
  return true;
}

async function people(env: Env) {
  const employeesArea = await env.area(["employees."], "e.province_id");
  const attendanceArea = await env.area(["attendance."], "r.province_id");
  const leaveArea = await env.area(["leave."], "r.province_id");
  if (!employeesArea || !attendanceArea || !leaveArea || !env.can("employees.read", "attendance.read", "leave.read")) return null;
  const result = await env.query(
    `SELECT
       (SELECT count(*) FROM employees e WHERE e.organization_id = $1 AND e.employment_status IN ('active','probation','on_leave') AND ${employeesArea}) AS active,
       (SELECT count(DISTINCT r.employee_id) FROM attendance_records r WHERE r.organization_id = $1 AND r.work_date = $3::date AND r.status IN ('present','late') AND ${attendanceArea}) AS present,
       (SELECT count(DISTINCT r.employee_id) FROM leave_requests r WHERE r.organization_id = $1 AND r.status IN ('approved','taken') AND r.starts_on <= $3::date AND r.ends_on >= $3::date AND ${leaveArea}) AS on_leave,
       (SELECT count(*) FROM leave_requests r WHERE r.organization_id = $1 AND r.status = 'pending' AND ${leaveArea}) AS pending`,
  );
  const row = result.rows[0];
  return { active: n(row?.active), presentToday: n(row?.present), onLeaveToday: n(row?.on_leave), pendingLeave: n(row?.pending) };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function getInsights(context: InsightsContext, days: 7 | 30 | 90 = 30): Promise<Insights> {
  const today = todayIn(BUSINESS_TIMEZONE);
  return withTenantContext(context, async (client) => {
    const organization = await client.query<{ currency: string | null }>(`SELECT trim(currency) AS currency FROM organizations WHERE id = $1`, [context.organizationId]);
    const orgCurrency = organization.rows[0]?.currency || null;
    const fallbackCurrency = orgCurrency ?? "USD";
    const env = new Env(client, context, today);
    const sink: Collector = { alerts: [], critical: [], tiles: [] };

    const poultryPart = await section(env, sink, "poultry", (out) => poultry(env, out));
    const pigsPart = await section(env, sink, "pigs", (out) => pigs(env, out));
    const cropsPart = await section(env, sink, "crops", () => crops(env));
    await section(env, sink, "vaccinations", (out) => vaccinations(env, out));
    const stockPart = await section(env, sink, "stock", (out) => stock(env, out, orgCurrency));
    const moneyPart = await section(env, sink, "expenses", () => expenses(env, days, fallbackCurrency));
    const salesPart = await section(env, sink, "sales", () => sales(env, fallbackCurrency));
    const financePart = await section(env, sink, "finance", () => finance(env, fallbackCurrency));
    await section(env, sink, "invoices", (out) => overdueInvoices(env, out));
    await section(env, sink, "maintenance", (out) => maintenance(env, out));
    await section(env, sink, "tasks", (out) => tasks(env, out));
    await section(env, sink, "approvals", (out) => approvals(env, out));
    await section(env, sink, "social", (out) => socialDrafts(env, out));
    await section(env, sink, "leave", (out) => leaveAlert(env, out));
    await section(env, sink, "overview", (out) => tiles(env, out));
    const peoplePart = await section(env, sink, "people", () => people(env));

    const alerts = [...sink.alerts].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.count - a.count);
    const critical = [...sink.critical]
      .sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.rank - a.rank)
      .slice(0, CRITICAL_LIMIT)
      .map(({ rank: _rank, ...item }) => item);
    const overview = [...sink.tiles].sort((a, b) => a.order - b.order).map(({ order: _order, ...tile }) => tile);

    return {
      generatedAt: new Date().toISOString(),
      currency: orgCurrency,
      alerts,
      spend: moneyPart?.spend ?? null,
      sales: salesPart,
      expensesTrend: moneyPart?.trend ?? null,
      stock: stockPart,
      production: { poultry: poultryPart, pigs: pigsPart, crops: cropsPart },
      critical,
      overview,
      finance: financePart,
      people: peoplePart,
    };
  });
}
