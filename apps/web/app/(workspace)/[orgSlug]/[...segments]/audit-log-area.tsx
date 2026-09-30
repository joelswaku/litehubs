"use client";

import { useMemo, useState, type SelectHTMLAttributes } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Download,
  Filter,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  ErrorState,
  NoAccessState,
  SkeletonCard,
} from "@/components/ui/states";
import { get, orgApiUrl, orgUrl } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type AuditArea =
  | "access"
  | "people"
  | "projects"
  | "operations"
  | "poultry"
  | "pigs"
  | "agriculture"
  | "nutrition"
  | "sales"
  | "finance"
  | "documents"
  | "security"
  | "training"
  | "appointments"
  | "recruitment"
  | "daily_work"
  | "other";

type Entry = {
  id: string;
  occurredAt: string;
  actor: { name: string | null; email: string | null };
  action: string;
  entity: { table: string; id: string | null; label: string | null };
  changes: Record<string, unknown> | null;
  route: string | null;
  severity: "info" | "notice" | "warning" | "critical";
};

type Metrics = {
  metrics: { total: number; warnings: number; critical: number; today: number };
};

const areas: AuditArea[] = [
  "access",
  "people",
  "projects",
  "operations",
  "poultry",
  "pigs",
  "agriculture",
  "nutrition",
  "sales",
  "finance",
  "documents",
  "security",
  "training",
  "appointments",
  "recruitment",
  "daily_work",
  "other",
];

const tableNames: Record<string, [string, string]> = {
  employees: ["Employé", "Employee"],
  users: ["Compte LiteHubs", "LiteHubs account"],
  organizations: ["Entreprise", "Organization"],
  attendance_records: ["Présence", "Attendance"],
  shifts: ["Horaire", "Shift"],
  shift_assignments: ["Affectation d’horaire", "Shift assignment"],
  leave_requests: ["Demande de congé", "Leave request"],
  management_projects: ["Projet", "Project"],
  management_project_phases: ["Phase du projet", "Project phase"],
  management_project_tasks: ["Tâche de projet", "Project task"],
  management_project_budget_lines: [
    "Ancienne ligne budgétaire",
    "Legacy budget line",
  ],
  management_project_materials: ["Matériau du projet", "Project material"],
  management_purchase_requests: ["Demande d’achat", "Purchase request"],
  management_purchase_request_lines: ["Article demandé", "Requested item"],
  management_purchase_orders: ["Bon de commande", "Purchase order"],
  management_purchase_order_lines: ["Article commandé", "Ordered item"],
  management_receipts: ["Réception", "Receipt"],
  management_receipt_lines: ["Article reçu", "Received item"],
  management_expenses: ["Dépense", "Expense"],
  management_approval_requests: ["Approbation", "Approval"],
  management_inventory_stock_movements: [
    "Mouvement de stock",
    "Stock movement",
  ],
  poultry_houses: ["Bâtiment avicole", "Poultry house"],
  poultry_flocks: ["Lot de volaille", "Poultry flock"],
  poultry_egg_records: ["Collecte d’œufs", "Egg collection"],
  poultry_mortality_records: ["Mortalité avicole", "Poultry mortality"],
  pig_animals: ["Animal porcin", "Pig animal"],
  pig_groups: ["Groupe porcin", "Pig group"],
  agriculture_harvest_records: ["Récolte", "Harvest"],
  customers: ["Client", "Customer"],
  sales_orders: ["Commande de vente", "Sales order"],
  sales_deliveries: ["Livraison", "Delivery"],
  sales_invoices: ["Facture client", "Sales invoice"],
  customer_payments: ["Encaissement client", "Customer payment"],
  documents: ["Document", "Document"],
  contracts: ["Contrat", "Contract"],
  finance_cash_movements: ["Mouvement de trésorerie", "Cash movement"],
  finance_supplier_payments: ["Paiement fournisseur", "Supplier payment"],
  training_courses: ["Formation", "Training course"],
  appointments: ["Rendez-vous", "Appointment"],
  appointment_desks: ["Guichet", "Reception desk"],
  roles: ["Rôle", "Role"],
  member_roles: ["Rôle attribué", "Assigned role"],
  role_permissions: ["Permission de rôle", "Role permission"],
  organization_members: ["Accès membre", "Member access"],
};

const areaOf = (table: string): AuditArea => {
  if (
    table.startsWith("management_project") ||
    table.startsWith("management_purchase") ||
    table.startsWith("management_receipt") ||
    table.startsWith("management_expense") ||
    table.startsWith("management_approval")
  )
    return "projects";
  if (
    table.startsWith("management_asset") ||
    table.startsWith("management_vehicle") ||
    table.startsWith("management_maintenance") ||
    table.startsWith("management_inventory") ||
    table.startsWith("management_warehouse") ||
    table.startsWith("management_material")
  )
    return "operations";
  if (table.startsWith("poultry_")) return "poultry";
  if (table.startsWith("pig_")) return "pigs";
  if (table.startsWith("agriculture_")) return "agriculture";
  if (table.startsWith("nutrition_")) return "nutrition";
  if (
    table.startsWith("sales_") ||
    [
      "customers",
      "customer_payments",
      "payment_allocations",
      "credit_notes",
    ].includes(table)
  )
    return "sales";
  if (table.startsWith("finance_")) return "finance";
  if (
    table === "employees" ||
    table.startsWith("payroll_") ||
    table.startsWith("payslip") ||
    table.startsWith("employee_") ||
    [
      "shifts",
      "shift_assignments",
      "shift_assignment_exceptions",
      "attendance_records",
      "leave_types",
      "leave_requests",
      "disciplinary_actions",
      "performance_reviews",
      "performance_review_goals",
    ].includes(table)
  )
    return "people";
  if (table.startsWith("training_")) return "training";
  if (
    [
      "documents",
      "contracts",
      "contract_templates",
      "contract_document_versions",
      "contract_signature_fields",
      "contract_signature_events",
    ].includes(table)
  )
    return "documents";
  if (
    table.startsWith("security_") ||
    [
      "incidents",
      "critical_controls",
      "alerts",
      "corrective_actions",
      "escalations",
    ].includes(table)
  )
    return "security";
  if (
    table.startsWith("appointment_") ||
    ["appointments", "appointment_events", "appointment_messages"].includes(
      table,
    )
  )
    return "appointments";
  if (table.startsWith("career_")) return "recruitment";
  if (
    [
      "organizations",
      "users",
      "roles",
      "role_permissions",
      "member_roles",
      "member_provinces",
      "organization_members",
      "organization_invitations",
      "organization_invitation_provinces",
      "organization_settings",
      "provinces",
      "sites",
      "departments",
      "notification_preferences",
      "notification_profile_preferences",
    ].includes(table)
  )
    return "access";
  if (
    table.startsWith("checklist_") ||
    [
      "daily_reports",
      "shift_handovers",
      "report_definitions",
      "report_runs",
    ].includes(table)
  )
    return "daily_work";
  return "other";
};

const localized = (pair: [string, string], fr: boolean) =>
  fr ? pair[0] : pair[1];
const areaLabels: Record<AuditArea, [string, string]> = {
  access: ["Accès & configuration", "Access & setup"],
  people: ["Équipe & RH", "People & HR"],
  projects: ["Projets & achats", "Projects & procurement"],
  operations: ["Stock & équipements", "Stock & assets"],
  poultry: ["Aviculture", "Poultry"],
  pigs: ["Porcs", "Pigs"],
  agriculture: ["Agriculture", "Agriculture"],
  nutrition: ["Provenderie & nutrition", "Feed mill & nutrition"],
  sales: ["Ventes & clients", "Sales & customers"],
  finance: ["Finance", "Finance"],
  documents: ["Documents & contrats", "Documents & contracts"],
  security: ["Sécurité", "Security"],
  training: ["Formations", "Training"],
  appointments: ["Accueil & rendez-vous", "Reception & appointments"],
  recruitment: ["Recrutement", "Recruitment"],
  daily_work: ["Travail quotidien", "Daily work"],
  other: ["Autre activité", "Other activity"],
};

const areaLabel = (area: AuditArea, fr: boolean) =>
  localized(areaLabels[area], fr);

const actionLabel = (action: string, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    create: ["Création", "Created"],
    update: ["Modification", "Updated"],
    delete: ["Suppression", "Deleted"],
    approve: ["Approbation", "Approved"],
    reject: ["Refus", "Rejected"],
    cancel: ["Annulation", "Cancelled"],
    reverse: ["Contrepassation", "Reversed"],
    login: ["Connexion", "Signed in"],
    login_failed: ["Connexion refusée", "Sign-in failed"],
    logout: ["Déconnexion", "Signed out"],
    export: ["Export", "Exported"],
    import: ["Import", "Imported"],
    invite: ["Invitation", "Invitation"],
    permission_change: ["Permission modifiée", "Permission changed"],
    role_change: ["Rôle modifié", "Role changed"],
    password_change: ["Mot de passe modifié", "Password changed"],
    switch_organization: ["Espace changé", "Workspace changed"],
    post: ["Publication", "Posted"],
    read: ["Consultation", "Viewed"],
  };
  return localized(
    labels[action] ?? [
      action.replaceAll("_", " "),
      action.replaceAll("_", " "),
    ],
    fr,
  );
};

const tableLabel = (table: string, fr: boolean) =>
  localized(
    tableNames[table] ?? [
      table.replaceAll("_", " "),
      table.replaceAll("_", " "),
    ],
    fr,
  );
const fieldLabel = (field: string, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    status: ["Statut", "Status"],
    budget: ["Budget", "Budget"],
    estimated_total_budget: ["Budget prévu", "Planned budget"],
    amount: ["Montant", "Amount"],
    approved_amount: ["Montant approuvé", "Approved amount"],
    assigned_member_id: ["Personne affectée", "Assigned person"],
    project_task_id: ["Tâche liée", "Linked task"],
    project_id: ["Projet", "Project"],
    site_id: ["Site", "Site"],
    province_id: ["Province", "Province"],
    quantity: ["Quantité", "Quantity"],
    quantity_delta: ["Variation de quantité", "Quantity change"],
    is_active: ["Activé", "Enabled"],
    is_owner: ["Propriétaire", "Owner"],
    roles: ["Rôles", "Roles"],
    permissions: ["Permissions", "Permissions"],
  };
  return localized(
    labels[field] ?? [field.replaceAll("_", " "), field.replaceAll("_", " ")],
    fr,
  );
};

const date = (value: string, fr: boolean) =>
  new Intl.DateTimeFormat(fr ? "fr-FR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
const tone = (severity: Entry["severity"]) =>
  severity === "critical"
    ? "serious"
    : severity === "warning"
      ? "warning"
      : severity === "notice"
        ? "info"
        : ("neutral" as const);
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const asFields = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
const valueText = (value: unknown, fr: boolean) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean")
    return value ? (fr ? "Oui" : "Yes") : fr ? "Non" : "No";
  if (Array.isArray(value)) return value.join(", ") || "—";
  return String(value);
};

export function AuditArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const allowed = can(user, "audit.read");
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("all");
  const [action, setAction] = useState("all");
  const [area, setArea] = useState<"all" | AuditArea>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filter = useMemo(() => {
    const params = new URLSearchParams({ limit: "250" });
    if (search.trim()) params.set("search", search.trim());
    if (severity !== "all") params.set("severity", severity);
    if (action !== "all") params.set("action", action);
    if (area !== "all") params.set("area", area);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params.toString();
  }, [action, area, from, search, severity, to]);

  const entries = useQuery({
    queryKey: ["audit", orgSlug, filter],
    queryFn: () =>
      get<{ entries: Entry[] }>(orgUrl(orgSlug, `audit-log?${filter}`)),
    enabled: allowed,
  });
  const summary = useQuery({
    queryKey: ["audit-summary", orgSlug],
    queryFn: () => get<Metrics>(orgUrl(orgSlug, "audit-summary")),
    enabled: allowed,
  });
  const visibleEntries = useMemo(
    () =>
      (entries.data?.entries ?? []).filter(
        (entry) => area === "all" || areaOf(entry.entity.table) === area,
      ),
    [area, entries.data?.entries],
  );
  const downloadUrl = orgApiUrl(
    orgSlug,
    `audit-log.pdf?${filter}&lang=${fr ? "fr" : "en"}`,
  );

  if (!allowed)
    return (
      <NoAccessState what={fr ? "le journal d’audit" : "audit-log access"} />
    );
  if (entries.isLoading || summary.isLoading)
    return (
      <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
        <SkeletonCard />
        <SkeletonCard />
      </main>
    );
  if (entries.error)
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6">
        <ErrorState
          title={
            fr
              ? "Impossible de charger le journal d’audit"
              : "Could not load audit log"
          }
          description={(entries.error as Error).message}
          onRetry={() => void entries.refetch()}
        />
      </main>
    );

  const metrics = summary.data?.metrics;
  const reset = () => {
    setSearch("");
    setSeverity("all");
    setAction("all");
    setArea("all");
    setFrom("");
    setTo("");
  };
  const hasFilter = Boolean(
    search ||
    from ||
    to ||
    severity !== "all" ||
    action !== "all" ||
    area !== "all",
  );

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="rounded-3xl border border-border bg-gradient-to-br from-amber-500/15 via-surface-1 to-surface-1 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <ShieldCheck className="size-5" />
              <span className="text-sm font-semibold">
                {fr ? "Sécurité & traçabilité" : "Security & traceability"}
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-ink">
              {fr ? "Journal d’audit" : "Audit log"}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-secondary">
              {fr
                ? "Preuve immuable des décisions, opérations, accès et données sensibles. Les détails affichés restent volontairement protégés."
                : "Immutable evidence of decisions, operations, access and sensitive data. Displayed details remain intentionally protected."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={downloadUrl}
              download
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border-strong bg-surface-1 px-3 text-sm font-semibold text-ink shadow-sm transition hover:border-brand/35 hover:bg-brand-subtle hover:text-brand dark:border-border"
            >
              <Download className="size-4" />
              {fr ? "Télécharger PDF" : "Download PDF"}
            </a>
            <Button
              variant="secondary"
              onClick={() => {
                void entries.refetch();
                void summary.refetch();
              }}
            >
              <RefreshCw />
              {fr ? "Actualiser" : "Refresh"}
            </Button>
          </div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label={fr ? "Événements" : "Events"}
            value={String(metrics?.total ?? 0)}
            icon={Activity}
          />
          <Metric
            label={fr ? "Aujourd’hui" : "Today"}
            value={String(metrics?.today ?? 0)}
            icon={CalendarDays}
          />
          <Metric
            label={fr ? "À examiner" : "Needs review"}
            value={String(metrics?.warnings ?? 0)}
            icon={AlertTriangle}
          />
          <Metric
            label={fr ? "Critiques" : "Critical"}
            value={String(metrics?.critical ?? 0)}
            icon={ShieldCheck}
          />
        </div>
      </header>

      <section className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-ink">
              {fr ? "Activité enregistrée" : "Recorded activity"}
            </h2>
            <p className="mt-1 text-xs text-ink-secondary">
              {fr
                ? "Filtrez par domaine, action, personne ou période. Ouvrez une ligne pour comparer les valeurs importantes."
                : "Filter by area, action, person or period. Open an entry to compare important values."}
            </p>
          </div>
          {hasFilter ? (
            <Button variant="ghost" size="sm" onClick={reset}>
              {fr ? "Effacer les filtres" : "Clear filters"}
            </Button>
          ) : null}
        </div>
        <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-6">
          <div className="relative xl:col-span-2">
            <Search className="absolute left-3 top-2.5 size-4 text-ink-muted" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
              placeholder={
                fr
                  ? "Personne, référence ou donnée…"
                  : "Person, reference or record…"
              }
            />
          </div>
          <Select
            value={area}
            onChange={(event) =>
              setArea(event.target.value as "all" | AuditArea)
            }
            aria-label={fr ? "Domaine" : "Area"}
          >
            <option value="all">
              {fr ? "Tous les domaines" : "All areas"}
            </option>
            {areas.map((item) => (
              <option key={item} value={item}>
                {areaLabel(item, fr)}
              </option>
            ))}
          </Select>
          <Select
            value={action}
            onChange={(event) => setAction(event.target.value)}
            aria-label={fr ? "Action" : "Action"}
          >
            <option value="all">
              {fr ? "Toutes les actions" : "All actions"}
            </option>
            {[
              "create",
              "update",
              "approve",
              "reject",
              "cancel",
              "reverse",
              "delete",
              "login",
              "export",
            ].map((item) => (
              <option key={item} value={item}>
                {actionLabel(item, fr)}
              </option>
            ))}
          </Select>
          <Select
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
            aria-label={fr ? "Sévérité" : "Severity"}
          >
            <option value="all">
              {fr ? "Toutes les sévérités" : "All severities"}
            </option>
            <option value="info">Info</option>
            <option value="notice">{fr ? "À noter" : "Notice"}</option>
            <option value="warning">{fr ? "Avertissement" : "Warning"}</option>
            <option value="critical">{fr ? "Critique" : "Critical"}</option>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              aria-label={fr ? "Depuis" : "From"}
            />
            <Input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              aria-label={fr ? "Jusqu’à" : "To"}
            />
          </div>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted">
          <Filter className="size-3.5" />
          {visibleEntries.length}{" "}
          {fr
            ? "événement(s) affiché(s), sur les 250 plus récents au maximum."
            : "event(s) shown, from the 250 most recent at most."}
        </p>

        <div className="mt-5 divide-y divide-border">
          {visibleEntries.length ? (
            visibleEntries.map((entry) => (
              <AuditEntry key={entry.id} entry={entry} fr={fr} />
            ))
          ) : (
            <EmptyState
              icon={ClipboardList}
              title={
                fr ? "Aucune activité ne correspond" : "No matching activity"
              }
              description={
                fr
                  ? "Ajustez les filtres ou revenez plus tard : les nouvelles opérations importantes apparaîtront ici automatiquement."
                  : "Adjust the filters or come back later: new important operations appear here automatically."
              }
            />
          )}
        </div>
      </section>
    </main>
  );
}

function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="h-10 min-w-0 rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
    />
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Activity;
}) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/50 p-4 dark:bg-black/10">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-secondary">{label}</p>
        <Icon className="size-4 text-amber-600/80 dark:text-amber-300/80" />
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}

function AuditEntry({ entry, fr }: { entry: Entry; fr: boolean }) {
  const record = asRecord(entry.changes);
  const fields = asFields(record.fields);
  const before = asRecord(record.before);
  const after = asRecord(record.after);
  const area = areaOf(entry.entity.table);
  return (
    <details className="group py-3">
      <summary className="cursor-pointer list-none rounded-xl p-2 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-ink">
                {actionLabel(entry.action, fr)} ·{" "}
                {tableLabel(entry.entity.table, fr)}
              </h3>
              <Badge variant={tone(entry.severity)}>
                {entry.severity === "notice"
                  ? fr
                    ? "À noter"
                    : "Notice"
                  : entry.severity === "warning"
                    ? fr
                      ? "Avertissement"
                      : "Warning"
                    : entry.severity === "critical"
                      ? fr
                        ? "Critique"
                        : "Critical"
                      : "Info"}
              </Badge>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-secondary">
                {areaLabel(area, fr)}
              </span>
            </div>
            <p className="mt-1 truncate text-sm text-ink-secondary">
              {entry.entity.label ?? entry.entity.id ?? "—"}
            </p>
            <p className="mt-2 text-xs text-ink-muted">
              {entry.actor.name ??
                entry.actor.email ??
                (fr ? "Système" : "System")}{" "}
              · {date(entry.occurredAt, fr)}
            </p>
          </div>
          <ChevronDown className="mt-1 size-4 shrink-0 text-ink-muted transition group-open:rotate-180" />
        </div>
      </summary>
      <div className="ml-2 mt-2 rounded-xl border border-border bg-surface-2/60 p-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-ink-secondary">
          <span>
            <strong className="font-medium text-ink">
              {fr ? "Domaine" : "Area"}
            </strong>{" "}
            · {areaLabel(area, fr)}
          </span>
          <span>
            <strong className="font-medium text-ink">
              {fr ? "Action" : "Action"}
            </strong>{" "}
            · {actionLabel(entry.action, fr)}
          </span>
          {entry.route ? (
            <span>
              <strong className="font-medium text-ink">
                {fr ? "Origine" : "Source"}
              </strong>{" "}
              · {entry.route}
            </span>
          ) : null}
        </div>
        {fields.length ? (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {fr ? "Champs concernés" : "Fields affected"}
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {fields.map((field) => (
                <div
                  key={field}
                  className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-ink"
                >
                  {fieldLabel(field, fr)}
                  {Object.hasOwn(before, field) ||
                  Object.hasOwn(after, field) ? (
                    <div className="mt-1 text-xs">
                      <span className="text-ink-muted">
                        {fr ? "Avant" : "Before"}
                      </span>
                      <span className="mx-1 text-ink-muted">→</span>
                      <span className="font-medium text-ink-secondary">
                        {valueText(before[field], fr)}
                      </span>
                      <span className="mx-1 text-ink-muted">→</span>
                      <span className="font-medium text-ink">
                        {valueText(after[field], fr)}
                      </span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-secondary">
            {fr
              ? "Cette action est conservée comme preuve ; aucun champ lisible supplémentaire n’a été exposé."
              : "This action is retained as evidence; no additional readable field was exposed."}
          </p>
        )}
        <BudgetChange changes={record.budgetChange} fr={fr} />
      </div>
    </details>
  );
}

function BudgetChange({ changes, fr }: { changes: unknown; fr: boolean }) {
  const value = asRecord(changes);
  if (!Object.keys(value).length) return null;
  const before = value.before;
  const after = value.after;
  return (
    <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-ink">
      <strong>{fr ? "Ajustement budgétaire" : "Budget adjustment"}</strong>
      <span className="ml-2 text-ink-secondary">
        {valueText(before, fr)} → {valueText(after, fr)}
      </span>
    </div>
  );
}
