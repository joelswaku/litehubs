import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { withTenantContext } from "../../utils/tenant-query";

/** Context deliberately matches a workspace membership without depending on a module. */
export interface AlertEvaluationContext {
  organizationId: string;
  userId: string;
}

export type AlertDomain =
  "poultry" | "pigs" | "agriculture" | "maintenance" | "projects";
type Severity = "low" | "medium" | "high" | "critical";
type Row = Record<string, unknown>;

interface Signal {
  domain: AlertDomain;
  severity: Severity;
  title: string;
  detail: string;
  provinceId?: string | null;
  siteId?: string | null;
  subjectTable: string;
  subjectId: string;
  dedupeKey: string;
  observedValue?: number | null;
  thresholdValue?: number | null;
}

const allDomains: AlertDomain[] = [
  "poultry",
  "pigs",
  "agriculture",
  "maintenance",
  "projects",
];
const text = (row: Row, key: string) => String(row[key] ?? "");
/** Preserve an absent optional UUID as null; PostgreSQL never accepts an empty UUID string. */
const optionalId = (row: Row, key: string): string | null => {
  const value = row[key];
  if (value === null || value === undefined) return null;
  const id = String(value).trim();
  return id || null;
};
const number = (row: Row, key: string) => Number(row[key] ?? 0);
const date = (row: Row, key: string) => {
  const value = row[key];
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value ?? "");
};

function automaticReference(): string {
  return `AUTO-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

/**
 * Upsert by a live dedupe key. A job may evaluate the same condition many
 * times, but the owner sees one current alert whose measured value is updated.
 */
async function raise(
  client: PoolClient,
  organizationId: string,
  signal: Signal,
): Promise<void> {
  await client.query(
    `INSERT INTO alerts (
       organization_id, province_id, site_id, reference, title, detail, domain,
       severity, status, source, observed_value, threshold_value, subject_table,
       subject_id, due_at, dedupe_key
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, 'open', 'job', $9, $10, $11, $12,
       now() + interval '24 hours', $13
     )
     ON CONFLICT (organization_id, dedupe_key)
       WHERE dedupe_key IS NOT NULL
         AND status IN ('open', 'acknowledged', 'in_progress')
     DO UPDATE SET
       title = EXCLUDED.title,
       detail = EXCLUDED.detail,
       severity = EXCLUDED.severity,
       observed_value = EXCLUDED.observed_value,
       threshold_value = EXCLUDED.threshold_value,
       due_at = LEAST(alerts.due_at, EXCLUDED.due_at),
       updated_at = now()`,
    [
      organizationId,
      signal.provinceId ?? null,
      signal.siteId ?? null,
      automaticReference(),
      signal.title,
      signal.detail,
      signal.domain,
      signal.severity,
      signal.observedValue ?? null,
      signal.thresholdValue ?? null,
      signal.subjectTable,
      signal.subjectId,
      signal.dedupeKey,
    ],
  );
}

async function poultrySignals(
  client: PoolClient,
  organizationId: string,
): Promise<Signal[]> {
  const signals: Signal[] = [];
  const mortality = await client.query<Row>(
    `SELECT m.flock_id, m.mortality_date, SUM(m.death_count) AS deaths,
            f.name AS flock_name, f.mortality_review_threshold AS threshold,
            s.id AS site_id, s.name AS site_name, p.id AS province_id
       FROM poultry_mortality_records m
       JOIN poultry_flocks f ON f.organization_id = m.organization_id AND f.id = m.flock_id
       JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id
       JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
       JOIN provinces p ON p.organization_id = s.organization_id AND p.id = s.province_id
      WHERE m.organization_id = $1 AND m.mortality_date >= current_date - 30
      GROUP BY m.flock_id, m.mortality_date, f.name, f.mortality_review_threshold, s.id, s.name, p.id
     HAVING SUM(m.death_count) >= f.mortality_review_threshold`,
    [organizationId],
  );
  for (const row of mortality.rows) {
    const deaths = number(row, "deaths");
    const threshold = number(row, "threshold");
    signals.push({
      domain: "poultry",
      severity: deaths >= threshold * 3 ? "critical" : "high",
      title: `Mortality review: ${text(row, "flock_name")}`,
      detail: `${deaths} birds were recorded dead on ${date(row, "mortality_date")}; the review threshold is ${threshold}.`,
      provinceId: optionalId(row, "province_id"),
      siteId: optionalId(row, "site_id"),
      subjectTable: "poultry_flocks",
      subjectId: text(row, "flock_id"),
      dedupeKey: `poultry:mortality:${text(row, "flock_id")}:${date(row, "mortality_date")}`,
      observedValue: deaths,
      thresholdValue: threshold,
    });
  }

  const health = await client.query<Row>(
    `SELECT r.id, r.event_type, r.severity, r.birds_affected, r.symptoms,
            f.name AS flock_name, s.id AS site_id, p.id AS province_id
       FROM poultry_health_records r
       JOIN poultry_flocks f ON f.organization_id = r.organization_id AND f.id = r.flock_id
       JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id
       JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
       JOIN provinces p ON p.organization_id = s.organization_id AND p.id = s.province_id
      WHERE r.organization_id = $1 AND r.status <> 'resolved'
        AND (r.severity IN ('high', 'critical') OR r.event_type = 'outbreak')`,
    [organizationId],
  );
  for (const row of health.rows) {
    const severity =
      text(row, "severity") === "critical" ||
      text(row, "event_type") === "outbreak"
        ? "critical"
        : "high";
    signals.push({
      domain: "poultry",
      severity,
      title: `Poultry health: ${text(row, "flock_name")}`,
      detail: `${text(row, "event_type").replace(/_/g, " ")} reported${number(row, "birds_affected") ? `; ${number(row, "birds_affected")} birds affected` : ""}${text(row, "symptoms") ? `: ${text(row, "symptoms")}` : "."}`,
      provinceId: optionalId(row, "province_id"),
      siteId: optionalId(row, "site_id"),
      subjectTable: "poultry_health_records",
      subjectId: text(row, "id"),
      dedupeKey: `poultry:health:${text(row, "id")}`,
    });
  }

  // Target weight comes from the flock's selected, editable performance model.
  const weights = await client.query<Row>(
    `SELECT w.id, w.record_date, w.average_weight_g, t.target_weight_g,
            t.tolerance_percent, f.name AS flock_name, s.id AS site_id, p.id AS province_id
       FROM poultry_weight_records w
       JOIN poultry_flocks f ON f.organization_id = w.organization_id AND f.id = w.flock_id
       JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id
       JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
       JOIN provinces p ON p.organization_id = s.organization_id AND p.id = s.province_id
       JOIN poultry_model_week_targets t ON t.organization_id = f.organization_id
        AND t.performance_model_id = f.performance_model_id
        AND t.week_number = GREATEST(1, CEIL(((w.record_date - COALESCE(f.hatch_date, f.arrival_date)) + 1) / 7.0)::integer)
      WHERE w.organization_id = $1 AND w.record_date >= current_date - 30
        AND t.target_weight_g IS NOT NULL
        AND w.average_weight_g < t.target_weight_g * (1 - t.tolerance_percent / 100.0)`,
    [organizationId],
  );
  for (const row of weights.rows) {
    const actual = number(row, "average_weight_g");
    const target = number(row, "target_weight_g");
    const variance = ((target - actual) / target) * 100;
    signals.push({
      domain: "poultry",
      severity: variance >= 15 ? "critical" : "high",
      title: `Weight below target: ${text(row, "flock_name")}`,
      detail: `Average weight is ${actual.toFixed(0)} g on ${date(row, "record_date")}; model target is ${target.toFixed(0)} g (${variance.toFixed(1)}% below target).`,
      provinceId: optionalId(row, "province_id"),
      siteId: optionalId(row, "site_id"),
      subjectTable: "poultry_weight_records",
      subjectId: text(row, "id"),
      dedupeKey: `poultry:weight:${text(row, "id")}`,
      observedValue: actual,
      thresholdValue: target,
    });
  }

  const vaccines = await client.query<Row>(
    `SELECT f.id AS flock_id, f.name AS flock_name, sch.id AS schedule_id,
            sch.vaccine_name, sch.day_age,
            (current_date - COALESCE(f.hatch_date, f.arrival_date)) AS bird_age,
            s.id AS site_id, p.id AS province_id
       FROM poultry_flocks f
       JOIN poultry_houses h ON h.organization_id = f.organization_id AND h.id = f.house_id
       JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id
       JOIN provinces p ON p.organization_id = s.organization_id AND p.id = s.province_id
       JOIN poultry_model_vaccine_schedules sch ON sch.organization_id = f.organization_id AND sch.performance_model_id = f.performance_model_id
      WHERE f.organization_id = $1 AND f.status IN ('active', 'quarantined')
        AND current_date - COALESCE(f.hatch_date, f.arrival_date) > sch.day_age
        AND NOT EXISTS (
          SELECT 1 FROM poultry_vaccination_records v
           WHERE v.organization_id = f.organization_id AND v.flock_id = f.id
             AND lower(v.vaccine_name) = lower(sch.vaccine_name)
        )`,
    [organizationId],
  );
  for (const row of vaccines.rows) {
    const overdue = number(row, "bird_age") - number(row, "day_age");
    signals.push({
      domain: "poultry",
      severity: overdue > 7 ? "high" : "medium",
      title: `Vaccine overdue: ${text(row, "flock_name")}`,
      detail: `${text(row, "vaccine_name")} was scheduled for day ${number(row, "day_age")} and is now ${overdue} day(s) overdue.`,
      provinceId: optionalId(row, "province_id"),
      siteId: optionalId(row, "site_id"),
      subjectTable: "poultry_flocks",
      subjectId: text(row, "flock_id"),
      dedupeKey: `poultry:vaccine:${text(row, "flock_id")}:${text(row, "schedule_id")}`,
      observedValue: overdue,
      thresholdValue: 0,
    });
  }
  return signals;
}

async function pigSignals(
  client: PoolClient,
  organizationId: string,
): Promise<Signal[]> {
  const signals: Signal[] = [];
  const mortality = await client.query<Row>(
    `SELECT r.id, r.mortality_date, r.death_count, r.cause_category, p.name AS pen_name,
            s.id AS site_id, pr.id AS province_id
       FROM pig_mortality_records r
       JOIN pig_pens p ON p.organization_id = r.organization_id AND p.id = r.pen_id
       JOIN sites s ON s.organization_id = p.organization_id AND s.id = p.site_id
       JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id
      WHERE r.organization_id = $1 AND r.mortality_date >= current_date - 30 AND r.death_count > 0`,
    [organizationId],
  );
  for (const row of mortality.rows) {
    const deaths = number(row, "death_count");
    const critical =
      deaths >= 3 ||
      ["disease", "respiratory", "digestive"].includes(
        text(row, "cause_category"),
      );
    signals.push({
      domain: "pigs",
      severity: critical ? "critical" : "high",
      title: `Pig mortality: ${text(row, "pen_name")}`,
      detail: `${deaths} pig(s) were recorded dead on ${date(row, "mortality_date")} (${text(row, "cause_category").replace(/_/g, " ")}).`,
      provinceId: optionalId(row, "province_id"),
      siteId: optionalId(row, "site_id"),
      subjectTable: "pig_mortality_records",
      subjectId: text(row, "id"),
      dedupeKey: `pigs:mortality:${text(row, "id")}`,
      observedValue: deaths,
    });
  }
  const health = await client.query<Row>(
    `SELECT r.id, r.event_type, r.severity, r.animals_affected, r.symptoms, p.name AS pen_name,
            s.id AS site_id, pr.id AS province_id
       FROM pig_health_records r
       JOIN pig_pens p ON p.organization_id = r.organization_id AND p.id = r.pen_id
       JOIN sites s ON s.organization_id = p.organization_id AND s.id = p.site_id
       JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id
      WHERE r.organization_id = $1 AND r.status <> 'resolved'
        AND (r.severity IN ('high', 'critical') OR r.event_type = 'outbreak')`,
    [organizationId],
  );
  for (const row of health.rows) {
    const severity =
      text(row, "severity") === "critical" ||
      text(row, "event_type") === "outbreak"
        ? "critical"
        : "high";
    signals.push({
      domain: "pigs",
      severity,
      title: `Pig health: ${text(row, "pen_name")}`,
      detail: `${text(row, "event_type").replace(/_/g, " ")} reported${number(row, "animals_affected") ? `; ${number(row, "animals_affected")} animals affected` : ""}${text(row, "symptoms") ? `: ${text(row, "symptoms")}` : "."}`,
      provinceId: optionalId(row, "province_id"),
      siteId: optionalId(row, "site_id"),
      subjectTable: "pig_health_records",
      subjectId: text(row, "id"),
      dedupeKey: `pigs:health:${text(row, "id")}`,
    });
  }
  return signals;
}

async function agricultureSignals(
  client: PoolClient,
  organizationId: string,
): Promise<Signal[]> {
  const signals: Signal[] = [];
  const scouting = await client.query<Row>(
    `SELECT r.id, r.observation_type, r.severity, r.observed_issue, r.pest_or_disease,
            fi.name AS field_name, s.id AS site_id, pr.id AS province_id
       FROM agriculture_scouting_records r
       JOIN agriculture_fields fi ON fi.organization_id = r.organization_id AND fi.id = r.field_id
       JOIN agriculture_farms f ON f.organization_id = fi.organization_id AND f.id = fi.farm_id
       JOIN sites s ON s.organization_id = f.organization_id AND s.id = f.site_id
       JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id
      WHERE r.organization_id = $1 AND r.status <> 'resolved' AND r.severity IN ('high', 'critical')`,
    [organizationId],
  );
  for (const row of scouting.rows)
    signals.push({
      domain: "agriculture",
      severity: text(row, "severity") as Severity,
      title: `Field ${text(row, "observation_type").replace(/_/g, " ")}: ${text(row, "field_name")}`,
      detail:
        text(row, "observed_issue") ||
        text(row, "pest_or_disease") ||
        "A high-severity field observation needs review.",
      provinceId: optionalId(row, "province_id"),
      siteId: optionalId(row, "site_id"),
      subjectTable: "agriculture_scouting_records",
      subjectId: text(row, "id"),
      dedupeKey: `agriculture:scouting:${text(row, "id")}`,
    });
  const losses = await client.query<Row>(
    `SELECT r.id, r.loss_date, r.loss_type, r.quantity, r.unit, r.estimated_value,
            fi.name AS field_name, s.id AS site_id, pr.id AS province_id
       FROM agriculture_loss_records r
       JOIN agriculture_fields fi ON fi.organization_id = r.organization_id AND fi.id = r.field_id
       JOIN agriculture_farms f ON f.organization_id = fi.organization_id AND f.id = fi.farm_id
       JOIN sites s ON s.organization_id = f.organization_id AND s.id = f.site_id
       JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id
      WHERE r.organization_id = $1 AND r.loss_date >= current_date - 30
        AND (r.estimated_value IS NOT NULL OR r.loss_type IN ('disease', 'fire', 'flood', 'theft'))`,
    [organizationId],
  );
  for (const row of losses.rows)
    signals.push({
      domain: "agriculture",
      severity: ["fire", "flood", "disease"].includes(text(row, "loss_type"))
        ? "high"
        : "medium",
      title: `Agriculture loss: ${text(row, "field_name")}`,
      detail: `${text(row, "loss_type").replace(/_/g, " ")} recorded on ${date(row, "loss_date")}${row.quantity ? `: ${number(row, "quantity")} ${text(row, "unit")}` : ""}.`,
      provinceId: optionalId(row, "province_id"),
      siteId: optionalId(row, "site_id"),
      subjectTable: "agriculture_loss_records",
      subjectId: text(row, "id"),
      dedupeKey: `agriculture:loss:${text(row, "id")}`,
      observedValue: number(row, "estimated_value") || null,
    });
  return signals;
}

async function managementSignals(
  client: PoolClient,
  organizationId: string,
): Promise<Signal[]> {
  const signals: Signal[] = [];
  const maintenance = await client.query<Row>(
    `SELECT mp.id, mp.name, mp.next_due_date, a.name AS asset_name, a.site_id, a.province_id
       FROM management_maintenance_plans mp
       JOIN management_assets a ON a.organization_id = mp.organization_id AND a.id = mp.asset_id
      WHERE mp.organization_id = $1 AND mp.is_active AND mp.next_due_date < current_date`,
    [organizationId],
  );
  for (const row of maintenance.rows)
    signals.push({
      domain: "maintenance",
      severity: "high",
      title: `Maintenance overdue: ${text(row, "asset_name")}`,
      detail: `${text(row, "name")} was due on ${date(row, "next_due_date")}.`,
      provinceId: optionalId(row, "province_id"),
      siteId: optionalId(row, "site_id"),
      subjectTable: "management_maintenance_plans",
      subjectId: text(row, "id"),
      dedupeKey: `maintenance:plan:${text(row, "id")}`,
    });
  const tasks = await client.query<Row>(
    `SELECT t.id, t.title, t.due_date, t.priority, p.name AS project_name, p.site_id, p.province_id
       FROM management_project_tasks t
       JOIN management_projects p ON p.organization_id = t.organization_id AND p.id = t.project_id
      WHERE t.organization_id = $1 AND COALESCE(t.task_type, 'work') = 'work' AND t.due_date < current_date
        AND t.status NOT IN ('completed', 'cancelled')`,
    [organizationId],
  );
  for (const row of tasks.rows)
    signals.push({
      domain: "projects",
      severity: text(row, "priority") === "critical" ? "critical" : "high",
      title: `Project task overdue: ${text(row, "title")}`,
      detail: `${text(row, "project_name")} task was due on ${date(row, "due_date")}.`,
      provinceId: optionalId(row, "province_id"),
      siteId: optionalId(row, "site_id"),
      subjectTable: "management_project_tasks",
      subjectId: text(row, "id"),
      dedupeKey: `projects:task:${text(row, "id")}`,
    });
  return signals;
}

/** Runs the company checks. Safe to run repeatedly because every signal is deduplicated. */
export async function evaluateAutomaticAlerts(
  context: AlertEvaluationContext,
  domains: AlertDomain[] = allDomains,
) {
  return withTenantContext(context, async (client) => {
    const selected = new Set(domains);
    const signals = [
      ...(selected.has("poultry")
        ? await poultrySignals(client, context.organizationId)
        : []),
      ...(selected.has("pigs")
        ? await pigSignals(client, context.organizationId)
        : []),
      ...(selected.has("agriculture")
        ? await agricultureSignals(client, context.organizationId)
        : []),
      ...(selected.has("maintenance") || selected.has("projects")
        ? await managementSignals(client, context.organizationId)
        : []),
    ].filter((signal) => selected.has(signal.domain));
    for (const signal of signals)
      await raise(client, context.organizationId, signal);
    return { evaluatedDomains: [...selected], activeSignals: signals.length };
  });
}
