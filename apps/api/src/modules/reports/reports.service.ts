import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { PoolClient } from "pg";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type { ReportQuery } from "./reports.validation";

export interface ReportsContext {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
  permissions: string[];
}

type Scope = "organization" | "province" | "self";
type Row = Record<string, unknown>;
type ScopeFilter = { from: string; to: string; provinceIds: string[] | null; siteId: string | null; provinceId: string | null };

const value = (row: Row | undefined, key: string) => Number(row?.[key] ?? 0);
const text = (value: unknown) => value === null || value === undefined || value === "" ? "—" : String(value);
const title = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const has = (context: ReportsContext, permission: string) => context.isOwner || context.permissions.includes(permission);
const today = () => new Date().toISOString().slice(0, 10);
const defaultStart = () => { const day = new Date(); day.setUTCDate(day.getUTCDate() - 29); return day.toISOString().slice(0, 10); };

async function scopeOf(client: PoolClient, context: ReportsContext): Promise<Scope> {
  if (context.isOwner) return "organization";
  const result = await client.query<{ organization_scope: boolean; province_scope: boolean }>(
    `SELECT
      EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id=mr.organization_id AND r.id=mr.role_id WHERE mr.organization_id=$1 AND mr.member_id=$2 AND r.data_scope='organization') AS organization_scope,
      EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id=mr.organization_id AND r.id=mr.role_id WHERE mr.organization_id=$1 AND mr.member_id=$2 AND r.data_scope='province') AS province_scope`,
    [context.organizationId, context.memberId],
  );
  return result.rows[0]?.organization_scope ? "organization" : result.rows[0]?.province_scope ? "province" : "self";
}

async function resolveScope(client: PoolClient, context: ReportsContext, query: ReportQuery): Promise<ScopeFilter> {
  const from = query.from ?? defaultStart();
  const to = query.to ?? today();
  const scope = await scopeOf(client, context);
  let provinceIds: string[] | null = null;
  if (scope !== "organization") {
    const result = await client.query<{ province_id: string }>(
      "SELECT province_id FROM member_provinces WHERE organization_id=$1 AND member_id=$2",
      [context.organizationId, context.memberId],
    );
    provinceIds = scope === "self" ? [] : result.rows.map((row) => row.province_id);
  }
  let siteId = query.siteId ?? null;
  let requestedProvince = query.provinceId ?? null;
  if (siteId) {
    const site = await client.query<{ province_id: string }>(
      "SELECT province_id FROM sites WHERE organization_id=$1 AND id=$2 AND is_active",
      [context.organizationId, siteId],
    );
    if (!site.rowCount) throw new NotFoundError("Site not found");
    const siteProvince = site.rows[0]!.province_id;
    if (requestedProvince && requestedProvince !== siteProvince)
      throw new BadRequestError("The selected site does not belong to this province", { field: "siteId" });
    requestedProvince = siteProvince;
  }
  if (requestedProvince && provinceIds !== null && !provinceIds.includes(requestedProvince))
    throw new NotFoundError("Province not found");
  if (requestedProvince) provinceIds = [requestedProvince];
  return { from, to, provinceIds, siteId, provinceId: requestedProvince };
}

function place(values: unknown[], filter: ScopeFilter, provinceColumn: string, siteColumn?: string) {
  let sql = "";
  if (filter.provinceIds !== null) {
    values.push(filter.provinceIds);
    sql += ` AND ${provinceColumn} = ANY($${values.length}::uuid[])`;
  }
  if (filter.siteId && siteColumn) {
    values.push(filter.siteId);
    sql += ` AND ${siteColumn} = $${values.length}`;
  }
  return sql;
}

function period(values: unknown[], filter: ScopeFilter, column: string) {
  values.push(filter.from, filter.to);
  return ` AND ${column} >= $${values.length - 1}::date AND ${column} <= $${values.length}::date`;
}

async function metric(client: PoolClient, sql: string, values: unknown[]) {
  return ((await client.query<Row>(sql, values)).rows[0] ?? {}) as Row;
}

function access(context: ReportsContext) {
  return {
    poultry: has(context, "poultry.flocks.read"),
    pigs: has(context, "pigs.animals.read"),
    agriculture: has(context, "agriculture.farms.read"),
    work: has(context, "tasks.read") || has(context, "daily_operations.read"),
    alerts: has(context, "alerts.read"),
    projects: has(context, "projects.read"),
    inventory: has(context, "inventory.stock.read"),
    procurement: has(context, "procurement.read"),
    finance: has(context, "finance.transactions.read") || has(context, "finance.expenses.read") || has(context, "finance.budgets.read"),
    people: has(context, "employees.read"),
  };
}

export async function overview(context: ReportsContext, query: ReportQuery) {
  return withTenantContext(context, async (client) => {
    const filter = await resolveScope(client, context, query);
    const allowed = access(context);
    const organization = await metric(client, "SELECT display_name, currency FROM organizations WHERE id=$1", [context.organizationId]);
    const scopes = { from: filter.from, to: filter.to, provinceId: filter.provinceId, siteId: filter.siteId };

    const poultry = allowed.poultry ? await poultryMetrics(client, context, filter) : null;
    const pigs = allowed.pigs ? await pigMetrics(client, context, filter) : null;
    const agriculture = allowed.agriculture ? await agricultureMetrics(client, context, filter) : null;
    const work = allowed.work ? await workMetrics(client, context, filter) : null;
    const governance = await governanceMetrics(client, context, filter, allowed);
    const inventory = allowed.inventory ? await inventoryMetrics(client, context, filter) : null;
    const procurement = allowed.procurement ? await procurementMetrics(client, context, filter) : null;
    const finance = allowed.finance ? await financeMetrics(client, context, filter) : null;
    const people = allowed.people ? await peopleMetrics(client, context, filter) : null;

    return {
      organization: { name: text(organization.display_name), currency: text(organization.currency) },
      range: scopes,
      access: allowed,
      poultry,
      pigs,
      agriculture,
      work,
      governance,
      inventory,
      procurement,
      finance,
      people,
      generatedAt: new Date().toISOString(),
    };
  });
}

async function poultryMetrics(client: PoolClient, context: ReportsContext, filter: ScopeFilter) {
  const values: unknown[] = [context.organizationId];
  const clause = place(values, filter, "s.province_id", "s.id");
  const active = await metric(client, `
    SELECT COUNT(*)::text AS active_flocks,
      COALESCE(SUM(GREATEST(0, f.initial_bird_count
        + COALESCE((SELECT SUM(d.arrivals_count-d.transfers_out_count-d.culls_count) FROM poultry_daily_records d WHERE d.organization_id=f.organization_id AND d.flock_id=f.id),0)
        - COALESCE((SELECT SUM(m.death_count) FROM poultry_mortality_records m WHERE m.organization_id=f.organization_id AND m.flock_id=f.id),0)
      )) FILTER (WHERE f.status IN ('active','quarantined','ready_for_sale')),0)::text AS live_birds
    FROM poultry_flocks f JOIN poultry_houses h ON h.organization_id=f.organization_id AND h.id=f.house_id
      JOIN sites s ON s.organization_id=h.organization_id AND s.id=h.site_id
    WHERE f.organization_id=$1 ${clause}`, values);
  const eventValues: unknown[] = [context.organizationId];
  const eventClause = place(eventValues, filter, "s.province_id", "s.id");
  const dates = period(eventValues, filter, "m.mortality_date");
  const mortality = await metric(client, `SELECT COALESCE(SUM(m.death_count),0)::text AS mortality
    FROM poultry_mortality_records m JOIN poultry_flocks f ON f.organization_id=m.organization_id AND f.id=m.flock_id
    JOIN poultry_houses h ON h.organization_id=f.organization_id AND h.id=f.house_id JOIN sites s ON s.organization_id=h.organization_id AND s.id=h.site_id
    WHERE m.organization_id=$1 ${eventClause} ${dates}`, eventValues);
  const feedValues: unknown[] = [context.organizationId];
  const feedClause = place(feedValues, filter, "s.province_id", "s.id");
  const feedDates = period(feedValues, filter, "r.feed_date");
  const feed = await metric(client, `SELECT COALESCE(SUM(r.quantity_kg),0)::text AS feed_kg FROM poultry_feed_records r
    JOIN poultry_flocks f ON f.organization_id=r.organization_id AND f.id=r.flock_id JOIN poultry_houses h ON h.organization_id=f.organization_id AND h.id=f.house_id JOIN sites s ON s.organization_id=h.organization_id AND s.id=h.site_id
    WHERE r.organization_id=$1 ${feedClause} ${feedDates}`, feedValues);
  const eggsValues: unknown[] = [context.organizationId];
  const eggsClause = place(eggsValues, filter, "s.province_id", "s.id");
  const eggDates = period(eggsValues, filter, "r.record_date");
  const eggs = await metric(client, `SELECT COALESCE(SUM(r.total_eggs),0)::text AS eggs FROM poultry_egg_records r
    JOIN poultry_flocks f ON f.organization_id=r.organization_id AND f.id=r.flock_id JOIN poultry_houses h ON h.organization_id=f.organization_id AND h.id=f.house_id JOIN sites s ON s.organization_id=h.organization_id AND s.id=h.site_id
    WHERE r.organization_id=$1 ${eggsClause} ${eggDates}`, eggsValues);
  return { activeFlocks: value(active, "active_flocks"), liveBirds: value(active, "live_birds"), mortality: value(mortality, "mortality"), feedKg: value(feed, "feed_kg"), eggs: value(eggs, "eggs") };
}

async function pigMetrics(client: PoolClient, context: ReportsContext, filter: ScopeFilter) {
  const values: unknown[] = [context.organizationId];
  const clause = place(values, filter, "s.province_id", "s.id");
  const current = await metric(client, `SELECT COUNT(DISTINCT p.id)::text AS pens, COUNT(a.id) FILTER (WHERE a.status IN ('active','pregnant','lactating','quarantined'))::text AS active_animals
    FROM pig_pens p JOIN sites s ON s.organization_id=p.organization_id AND s.id=p.site_id LEFT JOIN pig_animals a ON a.organization_id=p.organization_id AND a.pen_id=p.id
    WHERE p.organization_id=$1 ${clause}`, values);
  const feedValues: unknown[] = [context.organizationId]; const feedClause = place(feedValues, filter, "s.province_id", "s.id"); const feedDates = period(feedValues, filter, "r.feed_date");
  const feed = await metric(client, `SELECT COALESCE(SUM(r.quantity_kg),0)::text AS feed_kg FROM pig_feed_records r JOIN pig_pens p ON p.organization_id=r.organization_id AND p.id=r.pen_id JOIN sites s ON s.organization_id=p.organization_id AND s.id=p.site_id WHERE r.organization_id=$1 ${feedClause} ${feedDates}`, feedValues);
  const mortalityValues: unknown[] = [context.organizationId]; const mortalityClause = place(mortalityValues, filter, "s.province_id", "s.id"); const mortalityDates = period(mortalityValues, filter, "r.mortality_date");
  const mortality = await metric(client, `SELECT COALESCE(SUM(r.death_count),0)::text AS mortality FROM pig_mortality_records r JOIN pig_pens p ON p.organization_id=r.organization_id AND p.id=r.pen_id JOIN sites s ON s.organization_id=p.organization_id AND s.id=p.site_id WHERE r.organization_id=$1 ${mortalityClause} ${mortalityDates}`, mortalityValues);
  return { pens: value(current, "pens"), activeAnimals: value(current, "active_animals"), feedKg: value(feed, "feed_kg"), mortality: value(mortality, "mortality") };
}

async function agricultureMetrics(client: PoolClient, context: ReportsContext, filter: ScopeFilter) {
  const values: unknown[] = [context.organizationId]; const clause = place(values, filter, "s.province_id", "s.id");
  const current = await metric(client, `SELECT COUNT(DISTINCT f.id) FILTER (WHERE f.is_active)::text AS farms, COUNT(DISTINCT fi.id) FILTER (WHERE fi.is_active)::text AS fields, COUNT(DISTINCT pl.id) FILTER (WHERE pl.status IN ('planted','growing'))::text AS active_plantings
    FROM agriculture_farms f JOIN sites s ON s.organization_id=f.organization_id AND s.id=f.site_id LEFT JOIN agriculture_fields fi ON fi.organization_id=f.organization_id AND fi.farm_id=f.id LEFT JOIN agriculture_plots plot ON plot.organization_id=fi.organization_id AND plot.field_id=fi.id LEFT JOIN agriculture_plantings pl ON pl.organization_id=plot.organization_id AND pl.plot_id=plot.id
    WHERE f.organization_id=$1 ${clause}`, values);
  const operationsValues: unknown[] = [context.organizationId]; const operationsClause = place(operationsValues, filter, "s.province_id", "s.id"); const operationDates = period(operationsValues, filter, "op.operation_date");
  const operations = await metric(client, `SELECT COUNT(*)::text AS operations, COALESCE(SUM(op.labour_hours),0)::text AS labour_hours FROM agriculture_operations op JOIN agriculture_fields fi ON fi.organization_id=op.organization_id AND fi.id=op.field_id JOIN agriculture_farms f ON f.organization_id=fi.organization_id AND f.id=fi.farm_id JOIN sites s ON s.organization_id=f.organization_id AND s.id=f.site_id WHERE op.organization_id=$1 ${operationsClause} ${operationDates}`, operationsValues);
  const harvestValues: unknown[] = [context.organizationId]; const harvestClause = place(harvestValues, filter, "s.province_id", "s.id"); const harvestDates = period(harvestValues, filter, "h.harvest_date");
  const harvest = await metric(client, `SELECT COUNT(*)::text AS harvests, COALESCE(SUM(h.quantity) FILTER (WHERE lower(h.unit)='kg'),0)::text AS harvest_kg FROM agriculture_harvest_records h JOIN agriculture_plantings pl ON pl.organization_id=h.organization_id AND pl.id=h.planting_id JOIN agriculture_plots plot ON plot.organization_id=pl.organization_id AND plot.id=pl.plot_id JOIN agriculture_fields fi ON fi.organization_id=plot.organization_id AND fi.id=plot.field_id JOIN agriculture_farms f ON f.organization_id=fi.organization_id AND f.id=fi.farm_id JOIN sites s ON s.organization_id=f.organization_id AND s.id=f.site_id WHERE h.organization_id=$1 ${harvestClause} ${harvestDates}`, harvestValues);
  return { farms: value(current, "farms"), fields: value(current, "fields"), activePlantings: value(current, "active_plantings"), operations: value(operations, "operations"), labourHours: value(operations, "labour_hours"), harvests: value(harvest, "harvests"), harvestKg: value(harvest, "harvest_kg") };
}

async function workMetrics(client: PoolClient, context: ReportsContext, filter: ScopeFilter) {
  const values: unknown[] = [context.organizationId]; const clause = place(values, filter, "COALESCE(t.province_id,p.province_id)", "COALESCE(t.site_id,p.site_id)");
  const tasks = await metric(client, `SELECT COUNT(*) FILTER (WHERE t.status NOT IN ('completed','cancelled'))::text AS open_tasks, COUNT(*) FILTER (WHERE t.status='completed')::text AS completed_tasks, COUNT(*) FILTER (WHERE t.status NOT IN ('completed','cancelled') AND t.due_date < CURRENT_DATE)::text AS overdue_tasks
    FROM management_project_tasks t LEFT JOIN management_projects p ON p.organization_id=t.organization_id AND p.id=t.project_id WHERE t.organization_id=$1 ${clause}`, values);
  const reportValues: unknown[] = [context.organizationId]; const reportClause = place(reportValues, filter, "r.province_id", "r.site_id"); const reportDates = period(reportValues, filter, "r.work_date");
  const reports = await metric(client, `SELECT COUNT(*)::text AS reports, COUNT(*) FILTER (WHERE r.status='submitted')::text AS awaiting_review FROM daily_reports r WHERE r.organization_id=$1 ${reportClause} ${reportDates}`, reportValues);
  return { openTasks: value(tasks, "open_tasks"), completedTasks: value(tasks, "completed_tasks"), overdueTasks: value(tasks, "overdue_tasks"), dailyReports: value(reports, "reports"), awaitingReview: value(reports, "awaiting_review") };
}

async function governanceMetrics(client: PoolClient, context: ReportsContext, filter: ScopeFilter, allowed: ReturnType<typeof access>) {
  let activeProjects = 0;
  if (allowed.projects) { const values: unknown[] = [context.organizationId]; const clause = place(values, filter, "p.province_id", "p.site_id"); const result = await metric(client, `SELECT COUNT(*) FILTER (WHERE p.status IN ('planning','approved','in_progress','on_hold'))::text AS active_projects FROM management_projects p WHERE p.organization_id=$1 ${clause}`, values); activeProjects = value(result, "active_projects"); }
  let openAlerts = 0, criticalAlerts = 0;
  if (allowed.alerts) { const values: unknown[] = [context.organizationId]; const clause = place(values, filter, "a.province_id", "a.site_id"); const result = await metric(client, `SELECT COUNT(*) FILTER (WHERE a.status IN ('open','acknowledged','in_progress'))::text AS open_alerts, COUNT(*) FILTER (WHERE a.status IN ('open','acknowledged','in_progress') AND a.severity='critical')::text AS critical_alerts FROM alerts a WHERE a.organization_id=$1 ${clause}`, values); openAlerts = value(result, "open_alerts"); criticalAlerts = value(result, "critical_alerts"); }
  const values: unknown[] = [context.organizationId]; const clause = place(values, filter, "p.province_id", "p.site_id");
  const approvals = await metric(client, `SELECT COUNT(*) FILTER (WHERE a.status='pending')::text AS pending_approvals FROM management_approval_requests a LEFT JOIN management_projects p ON p.organization_id=a.organization_id AND p.id=a.project_id WHERE a.organization_id=$1 ${clause}`, values);
  return { activeProjects, openAlerts, criticalAlerts, pendingApprovals: value(approvals, "pending_approvals") };
}

async function inventoryMetrics(client: PoolClient, context: ReportsContext, filter: ScopeFilter) {
  const values: unknown[] = [context.organizationId]; const clause = place(values, filter, "s.province_id", "s.id");
  const stock = await metric(client, `SELECT COUNT(DISTINCT i.id)::text AS items, COUNT(*) FILTER (WHERE i.reorder_level IS NOT NULL AND (st.quantity_on_hand-st.quantity_reserved) <= i.reorder_level)::text AS low_stock, COUNT(DISTINCT w.id)::text AS warehouses FROM management_inventory_stock st JOIN management_warehouses w ON w.organization_id=st.organization_id AND w.id=st.warehouse_id JOIN sites s ON s.organization_id=w.organization_id AND s.id=w.site_id JOIN management_inventory_items i ON i.organization_id=st.organization_id AND i.id=st.item_id WHERE st.organization_id=$1 ${clause}`, values);
  return { items: value(stock, "items"), lowStock: value(stock, "low_stock"), warehouses: value(stock, "warehouses") };
}

async function procurementMetrics(client: PoolClient, context: ReportsContext, filter: ScopeFilter) {
  const values: unknown[] = [context.organizationId]; const clause = place(values, filter, "p.province_id", "p.site_id");
  const requests = await metric(client, `SELECT COUNT(*) FILTER (WHERE r.status IN ('submitted','under_review'))::text AS awaiting_requests, COUNT(*) FILTER (WHERE r.status='approved')::text AS approved_requests FROM management_purchase_requests r JOIN management_projects p ON p.organization_id=r.organization_id AND p.id=r.project_id WHERE r.organization_id=$1 ${clause}`, values);
  const orderValues: unknown[] = [context.organizationId]; const orderClause = place(orderValues, filter, "p.province_id", "p.site_id");
  const orders = await metric(client, `SELECT COUNT(*) FILTER (WHERE o.status IN ('sent','partially_received'))::text AS open_orders, COUNT(*) FILTER (WHERE o.status='received')::text AS received_orders FROM management_purchase_orders o JOIN management_projects p ON p.organization_id=o.organization_id AND p.id=o.project_id WHERE o.organization_id=$1 ${orderClause}`, orderValues);
  return { awaitingRequests: value(requests, "awaiting_requests"), approvedRequests: value(requests, "approved_requests"), openOrders: value(orders, "open_orders"), receivedOrders: value(orders, "received_orders") };
}

async function financeMetrics(client: PoolClient, context: ReportsContext, filter: ScopeFilter) {
  const values: unknown[] = [context.organizationId]; const clause = place(values, filter, "e.province_id", "e.site_id"); const dates = period(values, filter, "e.expense_date");
  const expenses = await client.query<Row>(`SELECT e.currency_code AS currency, COALESCE(SUM(e.amount) FILTER (WHERE e.status IN ('approved','paid')),0)::text AS approved, COALESCE(SUM(e.amount) FILTER (WHERE e.status='paid'),0)::text AS paid, COUNT(*) FILTER (WHERE e.status='submitted')::text AS pending FROM management_expenses e WHERE e.organization_id=$1 ${clause} ${dates} GROUP BY e.currency_code ORDER BY e.currency_code`, values);
  const budgetValues: unknown[] = [context.organizationId]; const budgetClause = place(budgetValues, filter, "p.province_id", "p.site_id");
  const budgets = await client.query<Row>(`SELECT b.currency_code AS currency, COALESCE(SUM(b.planned_amount),0)::text AS planned FROM management_project_budget_lines b JOIN management_projects p ON p.organization_id=b.organization_id AND p.id=b.project_id WHERE b.organization_id=$1 ${budgetClause} GROUP BY b.currency_code ORDER BY b.currency_code`, budgetValues);
  const byCurrency = new Map<string, { currency: string; planned: number; approvedExpenses: number; paidExpenses: number; pendingExpenses: number }>();
  for (const row of budgets.rows) byCurrency.set(text(row.currency), { currency: text(row.currency), planned: value(row, "planned"), approvedExpenses: 0, paidExpenses: 0, pendingExpenses: 0 });
  for (const row of expenses.rows) { const currency = text(row.currency); const prior = byCurrency.get(currency) ?? { currency, planned: 0, approvedExpenses: 0, paidExpenses: 0, pendingExpenses: 0 }; prior.approvedExpenses = value(row, "approved"); prior.paidExpenses = value(row, "paid"); prior.pendingExpenses = value(row, "pending"); byCurrency.set(currency, prior); }
  return { currencies: [...byCurrency.values()].map((row) => ({ ...row, available: row.planned - row.approvedExpenses })) };
}

async function peopleMetrics(client: PoolClient, context: ReportsContext, filter: ScopeFilter) {
  const values: unknown[] = [context.organizationId]; const clause = place(values, filter, "e.province_id", "e.site_id");
  const people = await metric(client, `SELECT COUNT(*) FILTER (WHERE e.employment_status IN ('active','probation','on_leave'))::text AS active_employees, COUNT(*) FILTER (WHERE e.employment_status='on_leave')::text AS on_leave FROM employees e WHERE e.organization_id=$1 ${clause}`, values);
  return { activeEmployees: value(people, "active_employees"), onLeave: value(people, "on_leave") };
}

type Report = Awaited<ReturnType<typeof overview>>;

function reportRows(report: Report, french: boolean) {
  const rows: Array<[string, string]> = [
    [french ? "Période" : "Period", `${report.range.from} — ${report.range.to}`],
    [french ? "Lots avicoles actifs" : "Active poultry flocks", String(report.poultry?.activeFlocks ?? "—")],
    [french ? "Oiseaux vivants" : "Live birds", String(report.poultry?.liveBirds ?? "—")],
    [french ? "Animaux porcins actifs" : "Active pigs", String(report.pigs?.activeAnimals ?? "—")],
    [french ? "Plantations actives" : "Active plantings", String(report.agriculture?.activePlantings ?? "—")],
    [french ? "Tâches ouvertes" : "Open tasks", String(report.work?.openTasks ?? "—")],
    [french ? "Tâches en retard" : "Overdue tasks", String(report.work?.overdueTasks ?? "—")],
    [french ? "Alertes ouvertes" : "Open alerts", String(report.governance.openAlerts)],
    [french ? "Stock faible" : "Low stock", String(report.inventory?.lowStock ?? "—")],
  ];
  for (const currency of report.finance?.currencies ?? []) rows.push([`${french ? "Finances" : "Finance"} · ${currency.currency}`, `${french ? "Prévu" : "Planned"}: ${currency.planned} · ${french ? "Dépenses approuvées" : "Approved expenses"}: ${currency.approvedExpenses} · ${french ? "Disponible" : "Available"}: ${currency.available}`]);
  return rows;
}

export async function exportPdf(context: ReportsContext, query: ReportQuery, french: boolean) {
  const report = await overview(context, query);
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: french ? "Rapport d’exploitation" : "Operations report", Author: report.organization.name } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    doc.rect(0, 0, doc.page.width, 88).fill("#10243f");
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(18).text(report.organization.name, 48, 31);
    doc.fillColor("#cbdff7").font("Helvetica").fontSize(9).text(french ? "Rapport d’exploitation confidentiel" : "Confidential operations report", 48, 57);
    doc.fillColor("#10243f").font("Helvetica-Bold").fontSize(16).text(french ? "Rapport de pilotage" : "Control report", 48, 112);
    doc.fillColor("#64748b").font("Helvetica").fontSize(9).text(`${report.range.from} — ${report.range.to}`, 48, 139); doc.y = 172;
    for (const [label, content] of reportRows(report, french)) { if (doc.y > 735) { doc.addPage(); doc.y = 52; } const top = doc.y; doc.roundedRect(48, top, doc.page.width - 96, 37, 6).fillAndStroke("#f7f8fa", "#d8e1ea"); doc.fillColor("#64748b").font("Helvetica-Bold").fontSize(8).text(label, 60, top + 8); doc.fillColor("#10243f").font("Helvetica").fontSize(9).text(content, 60, top + 20, { width: doc.page.width - 120 }); doc.y = top + 47; }
    doc.fillColor("#64748b").fontSize(7).text(`${report.organization.name} · ${french ? "Document protégé" : "Protected document"}`, 48, doc.page.height - 34, { width: doc.page.width - 96, align: "center" }); doc.end();
  });
}

export async function exportExcel(context: ReportsContext, query: ReportQuery, french: boolean) {
  const report = await overview(context, query); const workbook = new ExcelJS.Workbook(); workbook.creator = report.organization.name; workbook.created = new Date();
  const sheet = workbook.addWorksheet(french ? "Synthèse" : "Summary"); sheet.columns = [{ width: 34 }, { width: 68 }]; sheet.addRow([french ? "Rapport de pilotage" : "Control report", report.organization.name]); sheet.addRow([french ? "Période" : "Period", `${report.range.from} — ${report.range.to}`]); sheet.addRow([]); for (const row of reportRows(report, french).slice(1)) sheet.addRow(row); sheet.getRow(1).font = { bold: true, size: 14 }; sheet.getColumn(1).font = { bold: true };
  const operations = workbook.addWorksheet(french ? "Opérations" : "Operations"); operations.columns = [{ width: 26 }, { width: 18 }]; operations.addRow([french ? "Indicateur" : "Metric", french ? "Valeur" : "Value"]); for (const [label, content] of reportRows(report, french).slice(1, 10)) operations.addRow([label, content]); operations.getRow(1).font = { bold: true };
  const finance = workbook.addWorksheet(french ? "Finances" : "Finance"); finance.columns = [{ width: 14 }, { width: 18 }, { width: 22 }, { width: 18 }, { width: 18 }, { width: 16 }]; finance.addRow([french ? "Devise" : "Currency", french ? "Prévu" : "Planned", french ? "Dépenses approuvées" : "Approved expenses", french ? "Payé" : "Paid", french ? "Disponible" : "Available", french ? "En attente" : "Pending"]); for (const row of report.finance?.currencies ?? []) finance.addRow([row.currency, row.planned, row.approvedExpenses, row.paidExpenses, row.available, row.pendingExpenses]); finance.getRow(1).font = { bold: true };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}