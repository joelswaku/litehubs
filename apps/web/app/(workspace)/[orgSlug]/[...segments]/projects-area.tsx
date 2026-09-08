"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ArrowUpRight,
  BadgeDollarSign,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Download,
  FileImage,
  FileText,
  FolderOpen,
  FolderKanban,
  Hammer,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Lock,
  MapPin,
  PackageCheck,
  Pencil,
  Plus,
  ReceiptText,
  ShieldCheck,
  Settings2,
  ShoppingCart,
  Target,
  Trash2,
  Users,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError, api, del, get, orgApiUrl, orgUrl } from "@/lib/api";
import {
  ownerManagementApi,
  type ManagementBody,
  type OwnerManagementResource,
} from "@/lib/owner-management-api";
import { can, isOwner } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type Row = Record<string, unknown> & { id: string };
type Tab =
  | "overview"
  | "planning"
  | "tasks"
  | "finance"
  | "procurement"
  | "resources"
  | "documents"
  | "activity";
type Project = Row & {
  code: string;
  name: string;
  provinceId: string;
  siteId?: string | null;
  projectType: string;
  status: string;
  priority: string;
  currencyCode?: string | null;
  progressPercent?: number | string | null;
  responsibleMemberId?: string | null;
};
/**
 * The project summary as the API nests it.
 *
 * `GET .../projects/:id/summary` responds `{ project: { ...fields, budget,
 * materials, nextActions } }` — budget is *inside* project, not beside it. The
 * type used to declare `project` and `budget` as siblings, which made
 * `summary.budget` type-check while being undefined at runtime. The query below
 * unwraps the envelope with `select`, so `Summary` describes the inner object.
 */
type Summary = Project & {
  budget?: {
    planned: number | string;
    spent: number | string;
    committed: number | string;
    available: number | string;
    utilizationPercent?: number | string;
  };
  materials?: Row[];
  phaseCosts?: Row[];
  operationalLinks?: Row[];
  nextActions?: Row[];
  calculatedProgressPercent?: number | string;
  openTasks?: number | string;
  overdueTasks?: number | string;
};
type Place = {
  id: string;
  name: string;
  code?: string | null;
  province?: { id: string; code?: string | null; name?: string | null } | null;
};
type SelectOption = { value: string; text: string };
const tabIcon: Record<Tab, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  planning: Target,
  tasks: ListChecks,
  finance: Wallet,
  procurement: ShoppingCart,
  resources: Boxes,
  documents: FileText,
  activity: Activity,
};
type ConfirmationRequest = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
};
type DocumentCategory = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  visibility?: "company" | "owner_only";
};

/**
 * One defensive normalizer for every relational dropdown in Project Control.
 * APIs intentionally return only tenant-visible rows; this layer removes legacy
 * rows with an empty name/code instead of rendering a selectable blank option.
 */
const relationalOptions = (
  rows: ReadonlyArray<{ id: unknown }>,
  labelFields: ReadonlyArray<string>,
): SelectOption[] => {
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const record = row as Record<string, unknown>;
    const value = String(record.id ?? "").trim();
    const text = labelFields
      .map((field) => String(record[field] ?? "").trim())
      .find(Boolean);
    if (!value || !text || seen.has(value)) return [];
    seen.add(value);
    return [{ value, text }];
  });
};

type Employee = {
  id: string;
  fullName: string;
  employeeNumber?: string | null;
  member?: { memberId?: string | null; fullName?: string | null } | null;
};
type RoleOption = { id: string; code?: string | null; name?: string | null };
type MemberOption = {
  memberId: string;
  fullName?: string | null;
  email?: string | null;
  isOwner?: boolean;
};
type EditorKind =
  | "project"
  | "phase"
  | "phase-dependency"
  | "task"
  | "task-dependency"
  | "member"
  | "budget"
  | "material"
  | "movement"
  | "request"
  | "request-line"
  | "order"
  | "order-line"
  | "receipt"
  | "receipt-line"
  | "expense"
  | "asset"
  | "asset-assignment"
  | "asset-movement"
  | "asset-usage"
  | "vehicle-profile"
  | "vehicle-trip"
  | "maintenance-plan"
  | "work-order"
  | "maintenance-part"
  | "operational-link";
type Editor = { kind: EditorKind; record?: Row } | null;
const EditorFormErrorsContext = createContext<Record<string, string>>({});

const OPERATIONAL_TARGETS = {
  "poultry:flocks": {
    path: "poultry/flocks",
    permission: "poultry.flocks.read",
    english: "Poultry flock",
    french: "Lot de volaille",
  },
  "pigs:animals": {
    path: "pigs/animals",
    permission: "pigs.animals.read",
    english: "Pig animal",
    french: "Animal porcin",
  },
  "pigs:groups": {
    path: "pigs/groups",
    permission: "pigs.groups.read",
    english: "Pig group",
    french: "Groupe porcin",
  },
  "pigs:pens": {
    path: "pigs/pens",
    permission: "pigs.pens.read",
    english: "Pig pen",
    french: "Enclos porcin",
  },
  "agriculture:farms": {
    path: "agriculture/farms",
    permission: "agriculture.farms.read",
    english: "Agriculture farm",
    french: "Ferme agricole",
  },
  "agriculture:fields": {
    path: "agriculture/fields",
    permission: "agriculture.fields.read",
    english: "Agriculture field",
    french: "Champ agricole",
  },
  "agriculture:plots": {
    path: "agriculture/plots",
    permission: "agriculture.plots.read",
    english: "Agriculture plot",
    french: "Parcelle agricole",
  },
} as const;

type OperationalTargetKind = keyof typeof OPERATIONAL_TARGETS;

function isOperationalTargetKind(
  value: string,
): value is OperationalTargetKind {
  return value in OPERATIONAL_TARGETS;
}

function operationalRecordLabel(
  kind: OperationalTargetKind,
  record: Row,
  fr: boolean,
): string {
  const text = (...values: unknown[]) =>
    values.map((value) => String(value ?? "").trim()).find(Boolean);
  const quantity = (value: unknown, unit: string) => {
    if (value === null || value === undefined || value === "") return undefined;
    const amount = Number(value);
    return `${Number.isFinite(amount) ? amount.toLocaleString(fr ? "fr-FR" : "en-US") : String(value)} ${unit}`;
  };
  const site = text(record.siteName);
  let primary = text(record.name, record.animalNumber, record.code);
  let code = text(record.code, record.animalNumber, record.earTag);
  let detail: string | undefined;

  if (kind === "poultry:flocks") {
    detail = quantity(
      record.currentBirdCount ?? record.initialBirdCount,
      fr ? "oiseaux" : "birds",
    );
  } else if (kind === "pigs:groups") {
    detail = quantity(record.initialCount, fr ? "porcs" : "pigs");
  } else if (kind === "pigs:pens") {
    detail = quantity(record.capacity, fr ? "places" : "capacity");
  } else if (kind === "agriculture:farms") {
    detail = text(record.farmType);
  } else if (kind === "agriculture:fields" || kind === "agriculture:plots") {
    detail = quantity(record.areaHa, "ha");
  } else if (kind === "pigs:animals") {
    detail = text(record.penName, record.groupName, record.breed);
  }

  return [...new Set([primary, code, detail, site].filter(Boolean))].join(
    " · ",
  );
}

const RELATED: Array<{
  resource: OwnerManagementResource;
  permission: string;
  projectFilter?: boolean;
}> = [
  { resource: "phases", permission: "projects.read", projectFilter: true },
  { resource: "phase-dependencies", permission: "projects.read" },
  {
    resource: "project-members",
    permission: "projects.read",
    projectFilter: true,
  },
  {
    resource: "operational-links",
    permission: "projects.read",
    projectFilter: true,
  },
  { resource: "tasks", permission: "tasks.read", projectFilter: true },
  { resource: "task-dependencies", permission: "tasks.read" },
  {
    resource: "budget-lines",
    permission: "projects.read",
    projectFilter: true,
  },
  { resource: "materials", permission: "projects.read", projectFilter: true },
  { resource: "material-movements", permission: "projects.read" },
  {
    resource: "purchase-requests",
    permission: "procurement.read",
    projectFilter: true,
  },
  { resource: "purchase-request-lines", permission: "procurement.read" },
  {
    resource: "purchase-orders",
    permission: "procurement.read",
    projectFilter: true,
  },
  { resource: "purchase-order-lines", permission: "procurement.read" },
  { resource: "receipts", permission: "procurement.read", projectFilter: true },
  { resource: "receipt-lines", permission: "procurement.read" },
  { resource: "assets", permission: "equipment.read", projectFilter: true },
  { resource: "asset-assignments", permission: "equipment.read" },
  { resource: "asset-movements", permission: "equipment.read" },
  {
    resource: "asset-usage",
    permission: "equipment.read",
    projectFilter: true,
  },
  { resource: "vehicle-profiles", permission: "vehicles.read" },
  {
    resource: "vehicle-trips",
    permission: "vehicles.read",
    projectFilter: true,
  },
  { resource: "maintenance-plans", permission: "maintenance.read" },
  {
    resource: "maintenance-work-orders",
    permission: "work_orders.read",
    projectFilter: true,
  },
  { resource: "maintenance-parts", permission: "maintenance.read" },
  {
    resource: "expenses",
    permission: "finance.expenses.read",
    projectFilter: true,
  },
  { resource: "approvals", permission: "approvals.read", projectFilter: true },
  { resource: "documents", permission: "documents.read", projectFilter: true },
];

const label = (fr: boolean, english: string, french: string) =>
  fr ? french : english;
const tabLabel = (fr: boolean, value: Tab) =>
  ({
    overview: label(fr, "Overview", "Vue d’ensemble"),
    planning: label(fr, "Planning", "Planification"),
    tasks: label(fr, "Tasks", "Tâches"),
    finance: label(fr, "Finance", "Finance"),
    procurement: label(fr, "Procurement", "Achats"),
    resources: label(fr, "Resources", "Ressources"),
    documents: label(fr, "Documents", "Documents"),
    activity: label(fr, "Activity", "Activité"),
  })[value];
const number = (value: unknown) => Number(value ?? 0) || 0;
const titleCase = (value: unknown) =>
  String(value ?? "—")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const documentUsage = (document: Row, fr: boolean) => {
  const entity = String(document.entityType ?? "");
  const direct = entity
    ? entity === "owner-management:projects"
      ? label(fr, "Project", "Projet")
      : entity.includes("purchase") || entity.includes("receipt")
        ? label(fr, "Procurement", "Achats")
        : entity.includes("task")
          ? label(fr, "Task", "Tâche")
          : entity.includes("asset") || entity.includes("operational")
            ? label(fr, "Resource", "Ressource")
            : titleCase(entity.replace(/^owner-management:/, ""))
    : null;
  const task = String(document.taskUsageSummary ?? "").trim();
  return [direct, task ? `${label(fr, "Task", "Tâche")} : ${task}` : null]
    .filter(Boolean)
    .join(" · ");
};
const documentVisibilityLabel = (document: Row, fr: boolean) => {
  if (document.isLocked) return label(fr, "Locked", "Verrouillé");
  const values: Record<string, string> = {
    company: label(fr, "Company", "Entreprise"),
    project_team: label(fr, "Project team", "Équipe du projet"),
    owner_only: label(fr, "Owner only", "Propriétaire uniquement"),
    owner_partner: label(fr, "Owner + Partner", "Propriétaire + partenaire"),
    selected_roles: label(fr, "Selected roles", "Rôles sélectionnés"),
    selected_people: label(fr, "Selected people", "Personnes sélectionnées"),
  };
  return values[String(document.visibility ?? "company")] ?? values.company;
};
const date = (value: unknown, locale: string) =>
  value
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
        new Date(String(value)),
      )
    : "—";
const money = (value: unknown, currency: unknown, locale: string) => {
  const raw = String(currency ?? "CDF")
    .trim()
    .toUpperCase();
  const code =
    raw === "$"
      ? "USD"
      : raw === "FC" || raw === "CDF"
        ? "CDF"
        : /^[A-Z]{3}$/.test(raw)
          ? raw
          : "CDF";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0,
  }).format(number(value));
};
const statusVariant = (status: unknown) =>
  ["completed", "approved", "active", "paid", "received"].includes(
    String(status),
  )
    ? ("good" as const)
    : ["cancelled", "rejected", "blocked", "overdue"].includes(String(status))
      ? ("serious" as const)
      : ["in_progress", "sent", "partially_approved"].includes(String(status))
        ? ("info" as const)
        : ("warning" as const);
const dateValue = (value: unknown) => (value ? String(value).slice(0, 10) : "");
const optional = (form: FormData, key: string) =>
  String(form.get(key) ?? "").trim() || undefined;
const optionalNumber = (form: FormData, key: string) => {
  const value = optional(form, key);
  return value === undefined ? undefined : Number(value);
};

/** Task APIs use explicit nulls for blank optional controls. */
const nullableValue = (form: FormData, key: string) => {
  const value = String(form.get(key) ?? "").trim();
  return value || null;
};
const nullableNumber = (form: FormData, key: string) => {
  const value = nullableValue(form, key);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};
const isUuid = (value: unknown) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value ?? ""),
  );
const isIsoDate = (value: unknown) => {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [yearText, monthText, dayText] = text.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};
const taskEnum = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
const generated = (prefix: string) =>
  [
    prefix.toLowerCase(),
    new Date().toISOString().slice(0, 10).replaceAll("-", ""),
    Math.random().toString(36).slice(2, 6),
  ].join("_");
const projectCode = (value: string | undefined) => {
  const normalized = String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 63);
  return normalized.length >= 2 ? normalized : generated("PRJ");
};
const normalizeCurrency = (value: string) => {
  const normalized = value.trim().toUpperCase();
  const aliases: Record<string, string> = {
    $: "USD",
    US$: "USD",
    USD$: "USD",
    FC: "CDF",
    CDF: "CDF",
  };
  return (
    aliases[normalized] ?? (/^[A-Z]{3}$/.test(normalized) ? normalized : "CDF")
  );
};

export function ProjectsArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const user = useSessionUser();
  const client = useQueryClient();
  const fr = locale === "fr";
  const ownerOnly = isOwner(user);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [editor, setEditor] = useState<Editor>(null);
  const [accessDocument, setAccessDocument] = useState<Row | null>(null);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [taskDetail, setTaskDetail] = useState<Row | null>(null);
  const [previewDocument, setPreviewDocument] = useState<Row | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(
    null,
  );
  const [exportError, setExportError] = useState<unknown>(null);
  const canRead = (permission: string) => can(user, permission);
  const canWrite = (permission: string) => can(user, permission);
  const canControl = (permission: string) => ownerOnly && can(user, permission);
  const projects = useQuery({
    queryKey: ["project-control", orgSlug],
    queryFn: () =>
      ownerManagementApi.list<{ records: Project[] }>(orgSlug, "projects", {
        limit: 200,
      }),
    enabled: canRead("projects.read"),
    select: (data) => data.records,
  });
  const activeId = projectId ?? projects.data?.[0]?.id ?? null;
  const selected =
    (projects.data ?? []).find((project) => project.id === activeId) ?? null;
  const summary = useQuery({
    queryKey: ["project-summary", orgSlug, activeId],
    queryFn: () =>
      ownerManagementApi.projectSummary<{ project: Summary }>(
        orgSlug,
        String(activeId),
      ),
    enabled: Boolean(activeId) && canRead("projects.read"),
    select: (data) => data.project,
  });
  const related = useQueries({
    queries: RELATED.map((source) => ({
      queryKey: ["project-record", orgSlug, activeId, source.resource],
      queryFn: () =>
        ownerManagementApi.list<{ records: Row[] }>(
          orgSlug,
          source.resource,
          source.projectFilter
            ? { projectId: String(activeId), limit: 200 }
            : { limit: 200 },
        ),
      enabled: Boolean(activeId) && canRead(source.permission),
    })),
  });
  const connectedError = RELATED.map((source, index) => ({
    source,
    error: related[index]?.error,
  })).find((item) => item.error);
  const rawRecords = (resource: OwnerManagementResource) => {
    const index = RELATED.findIndex((source) => source.resource === resource);
    return index >= 0 ? (related[index]?.data?.records ?? []) : [];
  };
  const records = (resource: OwnerManagementResource) => {
    const rows = rawRecords(resource);
    const phaseIds = new Set(rawRecords("phases").map((record) => record.id));
    const taskIds = new Set(rawRecords("tasks").map((record) => record.id));
    const materialIds = new Set(
      rawRecords("materials").map((record) => record.id),
    );
    const requestIds = new Set(
      rawRecords("purchase-requests").map((record) => record.id),
    );
    const orderIds = new Set(
      rawRecords("purchase-orders").map((record) => record.id),
    );
    const receiptIds = new Set(
      rawRecords("receipts").map((record) => record.id),
    );
    const assetIds = new Set(rawRecords("assets").map((record) => record.id));
    const vehicleIds = new Set(
      rawRecords("vehicle-profiles")
        .filter((record) => assetIds.has(String(record.assetId)))
        .map((record) => record.id),
    );
    const workOrderIds = new Set(
      rawRecords("maintenance-work-orders")
        .filter(
          (record) =>
            String(record.projectId) === String(activeId) ||
            assetIds.has(String(record.assetId)),
        )
        .map((record) => record.id),
    );
    if (resource === "phase-dependencies")
      return rows.filter(
        (record) =>
          phaseIds.has(String(record.phaseId)) &&
          phaseIds.has(String(record.dependsOnPhaseId)),
      );
    if (resource === "task-dependencies")
      return rows.filter(
        (record) =>
          taskIds.has(String(record.taskId)) &&
          taskIds.has(String(record.dependsOnTaskId)),
      );
    if (resource === "material-movements")
      return rows.filter((record) =>
        materialIds.has(String(record.projectMaterialId)),
      );
    if (resource === "purchase-request-lines")
      return rows.filter((record) =>
        requestIds.has(String(record.purchaseRequestId)),
      );
    if (resource === "purchase-order-lines")
      return rows.filter((record) =>
        orderIds.has(String(record.purchaseOrderId)),
      );
    if (resource === "receipt-lines")
      return rows.filter((record) => receiptIds.has(String(record.receiptId)));
    if (
      resource === "asset-assignments" ||
      resource === "asset-movements" ||
      resource === "asset-usage" ||
      resource === "maintenance-plans"
    )
      return rows.filter((record) => assetIds.has(String(record.assetId)));
    if (resource === "vehicle-profiles")
      return rows.filter((record) => assetIds.has(String(record.assetId)));
    if (resource === "vehicle-trips")
      return rows.filter(
        (record) =>
          String(record.projectId) === String(activeId) ||
          vehicleIds.has(String(record.vehicleId)),
      );
    if (resource === "maintenance-parts")
      return rows.filter((record) =>
        workOrderIds.has(String(record.workOrderId)),
      );
    return rows;
  };
  const provinces = useQuery({
    queryKey: ["project-provinces", orgSlug],
    queryFn: () => get<{ provinces: Place[] }>(orgUrl(orgSlug, "provinces")),
    enabled: canRead("sites.read"),
    select: (data) => data.provinces,
  });
  const sites = useQuery({
    queryKey: ["project-sites", orgSlug],
    queryFn: () => get<{ sites: Place[] }>(orgUrl(orgSlug, "sites")),
    enabled: canRead("sites.read"),
    select: (data) => data.sites,
  });
  const employees = useQuery({
    queryKey: ["project-employees", orgSlug],
    queryFn: () => get<{ employees: Employee[] }>(orgUrl(orgSlug, "employees")),
    enabled: canRead("employees.read"),
    select: (data) => data.employees,
  });
  const accessRoles = useQuery({
    queryKey: ["project-document-roles", orgSlug],
    queryFn: () => get<{ roles: RoleOption[] }>(orgUrl(orgSlug, "roles")),
    enabled: ownerOnly && canRead("roles.read"),
    select: (data) => data.roles,
  });
  const accessMembers = useQuery({
    queryKey: ["project-document-members", orgSlug],
    queryFn: () => get<{ members: MemberOption[] }>(orgUrl(orgSlug, "members")),
    enabled: ownerOnly && canRead("members.read"),
    select: (data) => data.members,
  });
  const documentCategories = useQuery({
    queryKey: ["project-document-categories", orgSlug],
    queryFn: () =>
      ownerManagementApi.documentCategories<{
        categories: DocumentCategory[];
      }>(orgSlug, ownerOnly),
    enabled: canRead("documents.read"),
    select: (data) => data.categories,
  });
  const images = useQuery({
    queryKey: ["project-images", orgSlug, activeId],
    queryFn: () =>
      get<{ images: Row[] }>(
        orgUrl(orgSlug, "images/owner-management/projects/" + String(activeId)),
      ),
    enabled: Boolean(activeId) && canRead("projects.read"),
    select: (data) => data.images,
  });
  const activity = useQuery({
    queryKey: ["project-activity", orgSlug, activeId],
    queryFn: () =>
      get<{ activity: Row[] }>(
        orgUrl(
          orgSlug,
          "owner-management/projects/" + String(activeId) + "/activity",
        ),
      ),
    enabled: Boolean(activeId) && canRead("projects.read"),
    select: (data) => data.activity,
  });
  const suppliers = useQuery({
    queryKey: ["project-suppliers", orgSlug],
    queryFn: () =>
      ownerManagementApi.list<{ records: Row[] }>(orgSlug, "suppliers", {
        limit: 200,
      }),
    enabled: canRead("suppliers.read"),
    select: (data) => data.records,
  });
  // Warehouses are still filtered by the API's organization and role scope. When
  // a project has a site, this extra filter prevents choosing storage elsewhere.
  const warehouseSiteId = selected?.siteId
    ? String(selected.siteId)
    : undefined;
  const warehouses = useQuery({
    queryKey: ["project-warehouses", orgSlug, warehouseSiteId ?? ""],
    queryFn: () =>
      ownerManagementApi.list<{ records: Row[] }>(orgSlug, "warehouses", {
        limit: 200,
        ...(warehouseSiteId ? { siteId: warehouseSiteId } : {}),
      }),
    enabled: canRead("inventory.warehouses.read"),
    select: (data) => data.records,
  });
  const inventoryItems = useQuery({
    queryKey: ["project-inventory-items", orgSlug],
    queryFn: () =>
      ownerManagementApi.list<{ records: Row[] }>(orgSlug, "inventory-items", {
        limit: 200,
      }),
    enabled: canRead("inventory.items.read"),
    select: (data) => data.records,
  });
  const memberOptions = useMemo(
    () =>
      (employees.data ?? []).flatMap((employee) => {
        const id = String(employee.member?.memberId ?? "").trim();
        const name = [
          employee.fullName,
          employee.member?.fullName,
          employee.employeeNumber,
        ]
          .map((value) => String(value ?? "").trim())
          .find(Boolean);
        // An employee with no real human label is not useful or safe to select.
        return id && name ? [{ id, name }] : [];
      }),
    [employees.data],
  );
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["project-control", orgSlug] });
    void client.invalidateQueries({ queryKey: ["project-summary", orgSlug] });
    void client.invalidateQueries({ queryKey: ["project-record", orgSlug] });
    void client.invalidateQueries({ queryKey: ["project-activity", orgSlug] });
    void client.invalidateQueries({
      queryKey: ["project-record", orgSlug, activeId, "documents"],
    });
    void client.invalidateQueries({
      queryKey: ["project-document-categories", orgSlug],
    });
  };
  const exportWorkbook = async (project: Project) => {
    try {
      setExportError(null);
      const response = await api.get(
        orgUrl(
          orgSlug,
          "owner-management/projects/" + String(project.id) + "/export.xlsx",
        ),
        { responseType: "blob" },
      );
      const blob = new Blob([response.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${String(project.code || project.name || "project").replace(/[^a-z0-9_-]+/gi, "-")}-project-report.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error);
    }
  };
  const exportPdf = async (project: Project) => {
    try {
      setExportError(null);
      const response = await api.get(
        orgUrl(
          orgSlug,
          "owner-management/projects/" + String(project.id) + "/export.pdf",
        ),
        { responseType: "blob" },
      );
      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${String(project.code || project.name || "project").replace(/[^a-z0-9_-]+/gi, "-")}-project-report.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error);
    }
  };
  const save = useMutation({
    mutationFn: async ({
      resource,
      record,
      body,
      taskDocuments,
    }: {
      resource: OwnerManagementResource;
      record?: Row;
      body: ManagementBody;
      taskDocuments?: { documentIds: string[] };
    }) => {
      const result = record
        ? await ownerManagementApi.update<{ record: Row }>(
            orgSlug,
            resource,
            record.id,
            body,
          )
        : await ownerManagementApi.create<{ record: Row }>(
            orgSlug,
            resource,
            body,
          );
      if (resource === "tasks" && taskDocuments) {
        const taskId = String(record?.id ?? result.record?.id ?? "");
        if (!taskId) throw new Error("The saved task has no identifier");
        await ownerManagementApi.replaceTaskDocuments(
          orgSlug,
          taskId,
          taskDocuments.documentIds,
        );
      }
      return result;
    },
    onSuccess: (result, input) => {
      refresh();
      setEditor(null);
      if (input.resource === "projects" && !input.record)
        setProjectId(
          (result as { record?: { id?: string } }).record?.id ?? null,
        );
    },
  });
  const upload = useMutation({
    mutationFn: async (input: {
      file: File;
      title: string;
      imageType: string;
      categoryId?: string;
    }) => {
      const form = new FormData();
      form.set("file", input.file);
      if (input.title) form.set("title", input.title);
      if (input.imageType) form.set("imageType", input.imageType);
      if (input.categoryId) form.set("categoryId", input.categoryId);
      return (
        await api.post(
          orgUrl(
            orgSlug,
            "images/owner-management/projects/" + String(activeId),
          ),
          form,
          { headers: { "Content-Type": "multipart/form-data" } },
        )
      ).data;
    },
    onSuccess: (data) => {
      const image = (data as { image?: Row }).image;
      // A newly uploaded project attachment is also a project document. Put it
      // in the document cache immediately so a task form opened straight after
      // upload can select it without a full page refresh. The query is still
      // re-fetched afterwards to receive the server's enriched metadata.
      if (image?.id) {
        client.setQueryData<{ records: Row[] }>(
          ["project-record", orgSlug, activeId, "documents"],
          (previous) =>
            previous
              ? {
                  ...previous,
                  records: [
                    image,
                    ...previous.records.filter(
                      (document) => String(document.id) !== String(image.id),
                    ),
                  ],
                }
              : { records: [image] },
        );
      }
      void client.invalidateQueries({
        queryKey: ["project-images", orgSlug, activeId],
      });
      void client.invalidateQueries({
        queryKey: ["project-record", orgSlug, activeId, "documents"],
      });
    },
  });
  // Deleting an attachment is behind the same project permission as uploading
  // one; the API re-checks it and also removes the stored object, so this must
  // not be a soft hide in the client.
  const removeImage = useMutation({
    mutationFn: (imageId: string) => del(orgUrl(orgSlug, `images/${imageId}`)),
    onSuccess: (_, imageId) => {
      client.setQueryData<{ records: Row[] }>(
        ["project-record", orgSlug, activeId, "documents"],
        (previous) =>
          previous
            ? {
                ...previous,
                records: previous.records.filter(
                  (document) => String(document.id) !== String(imageId),
                ),
              }
            : previous,
      );
      void client.invalidateQueries({
        queryKey: ["project-images", orgSlug, activeId],
      });
      void client.invalidateQueries({
        queryKey: ["project-record", orgSlug, activeId, "documents"],
      });
    },
  });
  const classifyDocument = useMutation({
    mutationFn: ({
      documentId,
      categoryId,
    }: {
      documentId: string;
      categoryId: string;
    }) =>
      ownerManagementApi.assignDocumentCategory<{ document: Row }>(
        orgSlug,
        documentId,
        categoryId,
      ),
    onSuccess: (_data, input) => {
      const category = (documentCategories.data ?? []).find(
        (item) => item.id === input.categoryId,
      );
      const patchCategory = (document: Row): Row =>
        String(document.id) === input.documentId
          ? {
              ...document,
              documentCategoryId: input.categoryId,
              documentCategoryName: category?.name ?? null,
              documentCategoryCode: category?.code ?? null,
              documentCategoryVisibility: category?.visibility ?? "company",
            }
          : document;
      client.setQueryData<{ images: Row[] }>(
        ["project-images", orgSlug, activeId],
        (previous) =>
          previous
            ? { ...previous, images: previous.images.map(patchCategory) }
            : previous,
      );
      client.setQueryData<{ records: Row[] }>(
        ["project-record", orgSlug, activeId, "documents"],
        (previous) =>
          previous
            ? { ...previous, records: previous.records.map(patchCategory) }
            : previous,
      );
      void client.invalidateQueries({
        queryKey: ["project-images", orgSlug, activeId],
      });
      void client.invalidateQueries({
        queryKey: ["project-record", orgSlug, activeId, "documents"],
      });
    },
  });
  const error =
    save.error ?? upload.error ?? classifyDocument.error ?? exportError;
  const message =
    error instanceof ApiError
      ? error.message
      : error
        ? label(
            fr,
            "This change could not be saved.",
            "Cette modification n’a pas pu être enregistrée.",
          )
        : null;

  if (!canRead("projects.read"))
    return (
      <main className="grid min-h-[60dvh] place-items-center p-6">
        <EmptyState
          title={label(fr, "No project access", "Aucun accès aux projets")}
          description={label(
            fr,
            "Your role does not allow access to the company project register.",
            "Votre rôle ne permet pas d’accéder au registre des projets de l’entreprise.",
          )}
          icon={FolderKanban}
        />
      </main>
    );
  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8">
      <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_85%_0%,rgba(78,212,172,.24),transparent_28%),radial-gradient(circle_at_7%_110%,rgba(47,130,247,.24),transparent_35%),linear-gradient(130deg,#0b1f3a_0%,#103d5c_53%,#17645c_100%)] px-5 py-6 text-white shadow-[0_28px_60px_-34px_rgba(8,27,54,.85)] sm:px-7 sm:py-7">
        <div className="pointer-events-none absolute -right-20 top-1/2 size-72 -translate-y-1/2 rounded-full border border-white/10" />
        <div className="pointer-events-none absolute right-10 top-7 size-20 rounded-3xl border border-white/10 bg-white/[.03] rotate-12" />
        <div className="relative grid gap-7 xl:grid-cols-[minmax(0,1.1fr)_minmax(440px,.9fr)] xl:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[.14em] text-emerald-50">
                <BarChart3 className="size-3.5" />
                {ownerOnly
                  ? label(fr, "Pilotage d’investissement", "Investment control")
                  : label(fr, "Exécution du projet", "Project delivery")}
              </span>
              <span className="text-xs text-emerald-50/75">
                {label(
                  fr,
                  "Portefeuille opérationnel en temps réel",
                  "Live operational portfolio",
                )}
              </span>
            </div>
            <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-[-.045em] sm:text-4xl">
              {ownerOnly
                ? label(
                    fr,
                    "Vos investissements, du plan à l’exploitation.",
                    "Your investments, from plan to operation.",
                  )
                : label(
                    fr,
                    "Travaillez clairement sur les projets qui vous sont confiés.",
                    "Work clearly on the projects assigned to you.",
                  )}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-sky-50/85">
              {ownerOnly
                ? label(
                    fr,
                    "Réunissez budget, terrain, construction, achats, ressources et travail d’équipe dans une vue de contrôle claire.",
                    "Bring budget, land, construction, purchasing, resources and team work into one clear control view.",
                  )
                : label(
                    fr,
                    "Suivez vos tâches, réceptions et dépenses, tout en respectant votre périmètre de travail.",
                    "Track your work, receiving and expenses while staying within your approved scope.",
                  )}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              {canControl("projects.create") ? (
                <Button
                  className="bg-white text-[#103d5c] shadow-lg shadow-black/10 hover:bg-emerald-50"
                  onClick={() => setEditor({ kind: "project" })}
                >
                  <Plus />
                  {label(fr, "Créer un projet", "Create project")}
                </Button>
              ) : null}
              <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-xs text-emerald-50/90">
                <ShieldCheck className="size-4" />
                {ownerOnly
                  ? label(fr, "Contrôle propriétaire", "Owner controls")
                  : label(fr, "Accès selon votre rôle", "Role-scoped access")}
              </span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <HeroMetric
              label={label(fr, "Projets suivis", "Tracked projects")}
              value={projects.data?.length ?? 0}
              icon={FolderKanban}
            />
            <HeroMetric
              label={label(fr, "En cours", "Active")}
              value={
                (projects.data ?? []).filter((project) =>
                  ["planning", "approved", "in_progress"].includes(
                    project.status,
                  ),
                ).length
              }
              icon={Activity}
            />
            <HeroMetric
              label={label(fr, "Travail à traiter", "Open work")}
              value={number(summary.data?.openTasks)}
              icon={ListChecks}
            />
            <HeroMetric
              label={label(fr, "Attention requise", "Needs attention")}
              value={number(summary.data?.overdueTasks)}
              icon={Clock3}
              critical={number(summary.data?.overdueTasks) > 0}
            />
          </div>
        </div>
      </section>
      {message ? (
        <p
          className="rounded-xl border border-critical/35 bg-critical/10 px-4 py-3 text-sm text-critical"
          role="alert"
        >
          {message}
        </p>
      ) : null}
      <section className="grid gap-5 xl:grid-cols-[285px_minmax(0,1fr)]">
        <ProjectList
          fr={fr}
          projects={projects.data ?? []}
          loading={projects.isPending}
          failed={projects.isError}
          selectedId={activeId}
          onRetry={() => projects.refetch()}
          onSelect={(id) => {
            setProjectId(id);
            setTab("overview");
          }}
          onCreate={
            canControl("projects.create")
              ? () => setEditor({ kind: "project" })
              : undefined
          }
        />
        <div className="min-w-0">
          {selected ? (
            <>
              <ProjectHeader
                project={selected}
                summary={summary.data}
                locale={locale}
                fr={fr}
                onExport={
                  canControl("projects.read")
                    ? () => void exportWorkbook(selected)
                    : undefined
                }
                onExportPdf={
                  canControl("projects.read")
                    ? () => void exportPdf(selected)
                    : undefined
                }
                onEdit={
                  canControl("projects.update")
                    ? () => setEditor({ kind: "project", record: selected })
                    : undefined
                }
              />
              <nav className="mt-5 flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface-1 p-1.5 shadow-[0_12px_26px_-22px_rgba(15,38,63,.55)]">
                {(
                  [
                    "overview",
                    "planning",
                    "tasks",
                    "finance",
                    "procurement",
                    "resources",
                    "documents",
                    "activity",
                  ] as Tab[]
                ).map((value) => {
                  const Icon = tabIcon[value];
                  return (
                    <button
                      type="button"
                      key={value}
                      onClick={() => setTab(value)}
                      className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-semibold transition-all ${value === tab ? "bg-brand text-white shadow-sm" : "text-ink-secondary hover:bg-surface-2 hover:text-ink"}`}
                    >
                      <Icon className="size-3.5" />
                      {tabLabel(fr, value)}
                    </button>
                  );
                })}
              </nav>
              {related.some((query) => query.isError) ||
              (tab === "activity" && activity.isError) ? (
                <ErrorState
                  className="mt-5"
                  title={label(
                    fr,
                    "A connected area could not load",
                    "Une zone connectée n’a pas pu être chargée",
                  )}
                  description={
                    connectedError
                      ? `${connectedError.source.resource}: ${connectedError.error instanceof ApiError ? connectedError.error.message : label(fr, "Request failed", "La requête a échoué")}`
                      : label(
                          fr,
                          "Retry after checking the connection.",
                          "Réessayez après avoir vérifié la connexion.",
                        )
                  }
                  onRetry={refresh}
                />
              ) : (
                <>
                  <ProjectContent
                    tab={tab}
                    orgSlug={orgSlug}
                    project={selected}
                    summary={summary.data}
                    loading={summary.isPending}
                    records={records}
                    images={images.data ?? []}
                    documentCategories={documentCategories.data ?? []}
                    activity={activity.data ?? []}
                    fr={fr}
                    locale={locale}
                    canWrite={canWrite}
                    canControl={canControl}
                    setEditor={setEditor}
                    onConfigureDocument={setAccessDocument}
                    onManageDocumentCategories={() =>
                      setCategoryManagerOpen(true)
                    }
                    onOpenTask={setTaskDetail}
                    onPreviewDocument={setPreviewDocument}
                    upload={(file, title, imageType, categoryId) =>
                      upload
                        .mutateAsync({ file, title, imageType, categoryId })
                        .then(() => undefined)
                    }
                    uploading={upload.isPending}
                    removeImage={(imageId) => removeImage.mutate(imageId)}
                    onClassifyImage={(imageId, categoryId) =>
                      classifyDocument.mutate({
                        documentId: imageId,
                        categoryId,
                      })
                    }
                    classifyingImage={classifyDocument.isPending}
                    removingImage={removeImage.isPending}
                    onConfirmAction={setConfirmation}
                  />
                  {accessDocument ? (
                    <DocumentAccessDialog
                      orgSlug={orgSlug}
                      document={accessDocument}
                      roles={accessRoles.data ?? []}
                      members={accessMembers.data ?? []}
                      fr={fr}
                      onClose={() => setAccessDocument(null)}
                      onSaved={() => {
                        setAccessDocument(null);
                        refresh();
                      }}
                    />
                  ) : null}
                  {categoryManagerOpen ? (
                    <DocumentCategoryDialog
                      orgSlug={orgSlug}
                      categories={documentCategories.data ?? []}
                      fr={fr}
                      onClose={() => setCategoryManagerOpen(false)}
                      onChanged={() => {
                        void client.invalidateQueries({
                          queryKey: ["project-document-categories", orgSlug],
                        });
                        refresh();
                      }}
                      onConfirmAction={setConfirmation}
                    />
                  ) : null}
                </>
              )}
            </>
          ) : (
            <EmptyState
              className="rounded-2xl border border-dashed border-border-strong bg-surface-1"
              title={label(
                fr,
                "Choose or create a project",
                "Choisissez ou créez un projet",
              )}
              description={label(
                fr,
                "A project brings land, construction, livestock, equipment and startup costs into one responsible business plan.",
                "Un projet rassemble le terrain, la construction, le bétail, les équipements et les coûts de démarrage dans un seul plan d’affaires responsable.",
              )}
              icon={FolderKanban}
              action={
                canControl("projects.create")
                  ? {
                      label: label(fr, "New project", "Nouveau projet"),
                      onClick: () => setEditor({ kind: "project" }),
                    }
                  : undefined
              }
            />
          )}
        </div>
      </section>
      {taskDetail ? (
        <TaskDetailDialog
          orgSlug={orgSlug}
          task={taskDetail}
          fr={fr}
          locale={locale}
          onClose={() => setTaskDetail(null)}
          onEdit={
            canWrite("tasks.update")
              ? () => {
                  const task = taskDetail;
                  setTaskDetail(null);
                  setEditor({ kind: "task", record: task });
                }
              : undefined
          }
          onPreview={setPreviewDocument}
        />
      ) : null}
      {previewDocument ? (
        <ProjectDocumentPreviewDialog
          orgSlug={orgSlug}
          document={previewDocument}
          fr={fr}
          onClose={() => setPreviewDocument(null)}
          onEdit={
            canControl("documents.update")
              ? () => {
                  const document = previewDocument;
                  setPreviewDocument(null);
                  setAccessDocument(document);
                }
              : undefined
          }
        />
      ) : null}{" "}
      {confirmation ? (
        <ConfirmDialog
          request={confirmation}
          fr={fr}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            confirmation.onConfirm();
            setConfirmation(null);
          }}
        />
      ) : null}
      {editor ? (
        <EditorDialog
          editor={editor}
          orgSlug={orgSlug}
          project={selected}
          phases={records("phases")}
          tasks={records("tasks")}
          documents={records("documents")}
          materials={records("materials")}
          assets={records("assets")}
          requests={records("purchase-requests")}
          requestLines={records("purchase-request-lines")}
          orders={records("purchase-orders")}
          orderLines={records("purchase-order-lines")}
          receipts={records("receipts")}
          workOrders={records("maintenance-work-orders")}
          vehicleProfiles={records("vehicle-profiles")}
          maintenancePlans={records("maintenance-plans")}
          suppliers={suppliers.data ?? []}
          warehouses={warehouses.data ?? []}
          inventoryItems={inventoryItems.data ?? []}
          sites={sites.data ?? []}
          provinces={provinces.data ?? []}
          members={memberOptions}
          fr={fr}
          isOwner={ownerOnly}
          working={save.isPending}
          onClose={() => setEditor(null)}
          onSave={(resource, body, taskDocuments) =>
            save
              .mutateAsync({
                resource,
                record: editor.record,
                body,
                taskDocuments,
              })
              .then(() => undefined)
          }
        />
      ) : null}
    </main>
  );
}

function ProjectList({
  fr,
  projects,
  loading,
  failed,
  selectedId,
  onRetry,
  onSelect,
  onCreate,
}: {
  fr: boolean;
  projects: Project[];
  loading: boolean;
  failed: boolean;
  selectedId: string | null;
  onRetry: () => void;
  onSelect: (id: string) => void;
  onCreate?: () => void;
}) {
  const activeCount = projects.filter((project) =>
    ["planning", "approved", "in_progress"].includes(project.status),
  ).length;
  return (
    <aside className="h-fit overflow-hidden rounded-[24px] border border-border bg-surface-1 shadow-[0_18px_38px_-30px_rgba(15,38,63,.5)] xl:sticky xl:top-5">
      <div className="border-b border-white/10 bg-[linear-gradient(135deg,#0f2b4d,#155a64)] px-5 py-5 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[.15em] text-emerald-100">
              {label(fr, "Portefeuille", "Portfolio")}
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">
              {label(fr, "Vos projets", "Your projects")}
            </h2>
          </div>
          {onCreate ? (
            <button
              type="button"
              onClick={onCreate}
              className="grid size-9 place-items-center rounded-xl bg-white/15 text-white transition hover:bg-white/25"
              aria-label={label(fr, "Créer un projet", "Create project")}
            >
              <Plus className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-white/10 bg-white/[.08] px-3 py-2">
            <p className="text-[11px] text-emerald-50/80">
              {label(fr, "Total", "Total")}
            </p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">
              {projects.length}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[.08] px-3 py-2">
            <p className="text-[11px] text-emerald-50/80">
              {label(fr, "Actifs", "Active")}
            </p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">
              {activeCount}
            </p>
          </div>
        </div>
      </div>
      {loading ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : failed ? (
        <ErrorState onRetry={onRetry} />
      ) : projects.length ? (
        <div className="max-h-[63dvh] space-y-2 overflow-y-auto p-2.5">
          {projects.map((project) => {
            const selected = project.id === selectedId;
            const progress = Math.min(
              100,
              Math.max(0, number(project.progressPercent)),
            );
            return (
              <button
                type="button"
                key={project.id}
                onClick={() => onSelect(project.id)}
                aria-pressed={selected}
                className={`group w-full rounded-2xl border p-3.5 text-left transition-all ${selected ? "border-brand bg-brand-subtle shadow-[0_10px_22px_-18px_rgba(19,123,107,.8)]" : "border-transparent hover:border-border hover:bg-surface-2"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">
                      {project.name}
                    </p>
                    <p className="mt-1 truncate text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                      {project.code} · {titleCase(project.projectType)}
                    </p>
                  </div>
                  <Badge variant={statusVariant(project.status)}>
                    {titleCase(project.status)}
                  </Badge>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
                    <div
                      className={`h-full rounded-full transition-[width] ${selected ? "bg-brand" : "bg-ink/55 group-hover:bg-brand"}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="w-9 text-right text-xs font-semibold tabular-nums text-ink">
                    {progress}%
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title={label(fr, "Aucun projet", "No project yet")}
          description={label(
            fr,
            "Créez votre premier investissement : terrain, construction, élevage ou équipement.",
            "Start with land, construction, livestock or equipment.",
          )}
          icon={FolderKanban}
          action={
            onCreate
              ? {
                  label: label(fr, "Créer un projet", "Create project"),
                  onClick: onCreate,
                }
              : undefined
          }
        />
      )}
    </aside>
  );
}

function ProjectHeader({
  project,
  summary,
  fr,
  locale,
  onEdit,
  onExport,
  onExportPdf,
}: {
  project: Project;
  summary?: Summary;
  fr: boolean;
  locale: string;
  onEdit?: () => void;
  onExport?: () => void;
  onExportPdf?: () => void;
}) {
  return (
    <section className="relative overflow-hidden rounded-[26px] border border-[#173754] bg-[radial-gradient(circle_at_92%_8%,rgba(70,197,166,.25),transparent_23%),linear-gradient(135deg,#0b213d_0%,#104360_62%,#135950_100%)] p-5 text-white shadow-[0_24px_52px_-30px_rgba(8,31,58,.85)] sm:p-6">
      <div className="pointer-events-none absolute -right-8 bottom-0 size-40 rounded-full border border-white/10" />
      <div className="relative flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-white/15 bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[.14em] text-emerald-50">
              {project.code}
            </span>
            <Badge variant={statusVariant(project.status)}>
              {titleCase(project.status)}
            </Badge>
            <Badge
              variant={
                project.priority === "critical"
                  ? "serious"
                  : project.priority === "high"
                    ? "warning"
                    : "neutral"
              }
            >
              {titleCase(project.priority)}
            </Badge>
          </div>
          <h2 className="mt-3 max-w-3xl text-2xl font-semibold tracking-[-.035em] sm:text-3xl">
            {project.name}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-sky-50/80">
            {String(
              project.description ??
                label(
                  fr,
                  "Ajoutez le but, le périmètre et le résultat attendu de cet investissement.",
                  "Add this investment’s goal, scope and expected outcome.",
                ),
            )}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-emerald-50/85">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/10 px-2.5 py-1.5">
              <FolderKanban className="size-3.5" />
              {titleCase(project.projectType)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/10 px-2.5 py-1.5">
              <Clock3 className="size-3.5" />
              {label(fr, "Échéance", "Target")} ·{" "}
              {date(project.targetCompletionDate, locale)}
            </span>
            {project.siteId ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/10 px-2.5 py-1.5">
                <MapPin className="size-3.5" />
                {label(fr, "Site défini", "Site assigned")}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {onExport ? (
            <Button
              className="border-white/15 bg-white/10 text-white hover:bg-white/20"
              variant="secondary"
              size="sm"
              onClick={onExport}
            >
              <FileText />
              {label(fr, "Excel", "Excel")}
            </Button>
          ) : null}
          {onExportPdf ? (
            <Button
              className="border-white/15 bg-white/10 text-white hover:bg-white/20"
              variant="secondary"
              size="sm"
              onClick={onExportPdf}
            >
              <Download />
              PDF
            </Button>
          ) : null}
          {onEdit ? (
            <Button
              className="bg-white text-[#103d5c] hover:bg-emerald-50"
              size="sm"
              onClick={onEdit}
            >
              <Pencil />
              {label(fr, "Modifier", "Edit")}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="relative mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label={label(fr, "Budget prévu", "Planned budget")}
          value={money(summary?.budget?.planned, project.currencyCode, locale)}
          icon={Wallet}
          inverse
        />
        <Metric
          label={label(fr, "Dépensé", "Spent")}
          value={money(summary?.budget?.spent, project.currencyCode, locale)}
          icon={BadgeDollarSign}
          inverse
        />
        <Metric
          label={label(fr, "Engagé", "Committed")}
          value={money(
            summary?.budget?.committed,
            project.currencyCode,
            locale,
          )}
          icon={ReceiptText}
          inverse
        />
        <Metric
          label={label(fr, "Disponible", "Available")}
          value={money(
            summary?.budget?.available,
            project.currencyCode,
            locale,
          )}
          icon={Landmark}
          inverse
        />
      </div>
    </section>
  );
}

function ProjectContent({
  tab,
  orgSlug,
  project,
  summary,
  loading,
  records,
  images,
  documentCategories,
  activity,
  fr,
  locale,
  canWrite,
  canControl,
  setEditor,
  onConfigureDocument,
  onManageDocumentCategories,
  onOpenTask,
  onPreviewDocument,
  upload,
  uploading,
  removeImage,
  onClassifyImage,
  classifyingImage,
  onConfirmAction,
  removingImage,
}: {
  tab: Tab;
  orgSlug: string;
  project: Project;
  summary?: Summary;
  loading: boolean;
  records: (resource: OwnerManagementResource) => Row[];
  images: Row[];
  documentCategories: DocumentCategory[];
  activity: Row[];
  fr: boolean;
  locale: string;
  canWrite: (permission: string) => boolean;
  canControl: (permission: string) => boolean;
  setEditor: (editor: Editor) => void;
  onConfigureDocument: (document: Row) => void;
  onManageDocumentCategories: () => void;
  onOpenTask: (task: Row) => void;
  onPreviewDocument: (document: Row) => void;
  upload: (
    file: File,
    title: string,
    imageType: string,
    categoryId?: string,
  ) => void;
  uploading: boolean;
  removeImage: (imageId: string) => void;
  onClassifyImage: (imageId: string, categoryId: string) => void;
  classifyingImage: boolean;
  onConfirmAction: (request: ConfirmationRequest) => void;
  removingImage: boolean;
}) {
  const phases = records("phases"),
    phaseDependencies = records("phase-dependencies"),
    tasks = records("tasks"),
    taskDependencies = records("task-dependencies"),
    members = records("project-members"),
    budgets = records("budget-lines"),
    materials = records("materials"),
    movements = records("material-movements"),
    requests = records("purchase-requests"),
    requestLines = records("purchase-request-lines"),
    orders = records("purchase-orders"),
    orderLines = records("purchase-order-lines"),
    receipts = records("receipts"),
    receiptLines = records("receipt-lines"),
    assets = records("assets"),
    assetAssignments = records("asset-assignments"),
    assetMovements = records("asset-movements"),
    assetUsage = records("asset-usage"),
    vehicleProfiles = records("vehicle-profiles"),
    vehicleTrips = records("vehicle-trips"),
    plans = records("maintenance-plans"),
    workOrders = records("maintenance-work-orders"),
    maintenanceParts = records("maintenance-parts"),
    expenses = records("expenses"),
    approvals = records("approvals"),
    documents = records("documents"),
    operationalLinks =
      summary?.operationalLinks ?? records("operational-links");
  const phaseCosts = new Map(
    (summary?.phaseCosts ?? []).map((cost) => [String(cost.phaseId), cost]),
  );
  const phasesWithCosts = phases.map((phase) => ({
    ...phase,
    actualSpent: phaseCosts.get(String(phase.id))?.actualSpent ?? 0,
    committedAmount: phaseCosts.get(String(phase.id))?.committedAmount ?? 0,
  }));
  const today = new Date().toISOString().slice(0, 10);
  const [taskView, setTaskView] = useState<
    "all" | "open" | "in_progress" | "completed" | "overdue"
  >("all");
  const workTasks = tasks.filter((task) => task.taskType !== "milestone");
  const visibleTasks = workTasks.filter((task) =>
    taskView === "all"
      ? true
      : taskView === "open"
        ? !["completed", "cancelled"].includes(String(task.status))
        : taskView === "overdue"
          ? Boolean(task.dueDate) &&
            String(task.dueDate).slice(0, 10) < today &&
            !["completed", "cancelled"].includes(String(task.status))
          : String(task.status) === taskView,
  );
  if (loading)
    return (
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    );
  if (tab === "overview")
    return (
      <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(310px,.8fr)]">
        <div className="space-y-5">
          <Panel
            title={label(
              fr,
              "Investment blueprint",
              "Plan directeur de l’investissement",
            )}
            subtitle={label(
              fr,
              "The business reason, scope and execution path.",
              "La raison commerciale, le périmètre et le parcours d’exécution.",
            )}
          >
            <p className="whitespace-pre-wrap text-sm leading-7 text-ink-secondary">
              {String(
                project.blueprint ??
                  label(
                    fr,
                    "No blueprint yet. Add the phases needed to buy land, build, equip, receive livestock and start operations.",
                    "Aucun plan directeur. Ajoutez les phases pour acheter le terrain, construire, équiper, réceptionner le bétail et démarrer l’exploitation.",
                  ),
              )}
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Info
                label={label(fr, "Start", "Début")}
                value={date(project.startDate, locale)}
              />
              <Info
                label={label(fr, "Original target", "Fin initiale")}
                value={date(project.targetCompletionDate, locale)}
              />
              <Info
                label={label(fr, "Revised target", "Fin révisée")}
                value={date(project.revisedCompletionDate, locale)}
              />
              <Info
                label={label(fr, "Actual finish", "Fin réelle")}
                value={date(project.completedDate, locale)}
              />
              <Info
                label={label(fr, "Calculated progress", "Avancement calculé")}
                value={`${number(summary?.calculatedProgressPercent).toFixed(0)}%`}
              />
            </div>
            {project.expectedOutcome || project.fundingSource ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {project.expectedOutcome ? (
                  <Info
                    label={label(fr, "Expected outcome", "Résultat attendu")}
                    value={String(project.expectedOutcome)}
                  />
                ) : null}
                {project.fundingSource ? (
                  <Info
                    label={label(fr, "Funding source", "Source de financement")}
                    value={String(project.fundingSource)}
                  />
                ) : null}
              </div>
            ) : null}
          </Panel>
          <Panel
            title={label(fr, "Next actions", "Prochaines actions")}
            subtitle={label(
              fr,
              "Blocked and overdue work rises to the top automatically.",
              "Les tâches bloquées et en retard remontent automatiquement en tête.",
            )}
            action={
              canWrite("tasks.create") ? (
                <Button size="sm" onClick={() => setEditor({ kind: "task" })}>
                  <Plus />
                  {label(fr, "Add task", "Ajouter une tâche")}
                </Button>
              ) : undefined
            }
          >
            {summary?.nextActions?.length ? (
              <div className="divide-y divide-border">
                {(summary.nextActions ?? []).map((task) => (
                  <div
                    key={task.id}
                    className="flex items-start justify-between gap-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-ink">
                        {String(task.title ?? task.name ?? "—")}
                      </p>
                      <p className="mt-1 text-xs text-ink-secondary">
                        {titleCase(task.status)} · {date(task.dueDate, locale)}
                      </p>
                      {task.blockedReason ? (
                        <p className="mt-1 text-xs text-serious">
                          {String(task.blockedReason)}
                        </p>
                      ) : null}
                    </div>
                    <Badge variant={statusVariant(task.status)}>
                      {titleCase(task.priority)}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title={label(fr, "No open task", "Aucune tâche ouverte")}
                description={label(
                  fr,
                  "Break the project into practical next actions.",
                  "Découpez le projet en prochaines actions concrètes.",
                )}
                icon={ClipboardList}
              />
            )}
          </Panel>
          <Panel
            title={label(
              fr,
              "Operational handover",
              "Passage à l’exploitation",
            )}
            subtitle={label(
              fr,
              "The project tracks the investment. Specialist modules operate what is received.",
              "Le projet suit l’investissement. Les modules spécialisés exploitent ce qui est réceptionné.",
            )}
          >
            <div className="grid gap-3 md:grid-cols-3">
              <Handover
                href={`/${orgSlug}/poultry`}
                title={label(fr, "Poultry", "Volaille")}
                text={label(
                  fr,
                  "Received chicks become a flock and daily production records.",
                  "Les poussins réceptionnés deviennent un lot et des relevés de production.",
                )}
              />
              <Handover
                href={`/${orgSlug}/pigs`}
                title={label(fr, "Pigs", "Porcs")}
                text={label(
                  fr,
                  "Received animals become pens, groups or individual animal records.",
                  "Les animaux réceptionnés deviennent enclos, groupes ou fiches individuelles.",
                )}
              />
              <Handover
                href={`/${orgSlug}/agriculture`}
                title={label(fr, "Agriculture", "Agriculture")}
                text={label(
                  fr,
                  "Acquired land becomes farms, fields, plots and crop plans.",
                  "Le terrain acquis devient fermes, champs, parcelles et plans de culture.",
                )}
              />
            </div>
          </Panel>
        </div>
        <aside className="space-y-5">
          <Panel
            title={label(fr, "Budget health", "Santé budgétaire")}
            subtitle={label(
              fr,
              "Calculated from planned lines, approved expenses and outstanding orders.",
              "Calculée à partir des lignes prévues, dépenses approuvées et commandes restantes.",
            )}
          >
            <div className="rounded-xl bg-surface-2 p-4">
              <p className="text-xs text-ink-muted">
                {label(fr, "Budget utilisation", "Utilisation du budget")}
              </p>
              <p className="mt-1 text-3xl font-semibold text-ink">
                {number(summary?.budget?.utilizationPercent).toFixed(1)}%
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{
                    width: `${Math.min(100, number(summary?.budget?.utilizationPercent))}%`,
                  }}
                />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Info
                label={label(fr, "Calculated progress", "Avancement calculé")}
                value={`${number(summary?.calculatedProgressPercent).toFixed(0)}%`}
              />
              <Info
                label={label(fr, "Open tasks", "Tâches ouvertes")}
                value={String(number(summary?.openTasks))}
              />
            </div>
          </Panel>
          <Panel
            title={label(fr, "Project signals", "Signaux du projet")}
            subtitle={label(
              fr,
              "Follow work, materials and pending decisions.",
              "Suivez le travail, les matériaux et les décisions en attente.",
            )}
          >
            <Signal
              label={label(fr, "Overdue tasks", "Tâches en retard")}
              value={number(summary?.overdueTasks)}
              critical
            />
            <Signal
              label={label(
                fr,
                "Materials still needed",
                "Matériaux encore nécessaires",
              )}
              value={
                (summary?.materials ?? []).filter(
                  (item) => number(item.stillNeeded) > 0,
                ).length
              }
            />
            <Signal
              label={label(fr, "Pending approvals", "Approbations en attente")}
              value={
                approvals.filter((item) => item.status === "pending").length
              }
            />
          </Panel>
        </aside>
      </section>
    );
  if (tab === "planning")
    return (
      <section className="mt-5 grid gap-5 xl:grid-cols-2">
        <RecordsPanel
          title={label(fr, "Project phases", "Phases du projet")}
          subtitle={label(
            fr,
            "Land, preparation, construction, utilities, equipment, livestock and launch.",
            "Terrain, préparation, construction, utilités, équipement, bétail et lancement.",
          )}
          rows={phasesWithCosts}
          fields={[
            "name",
            "status",
            "actualStartDate",
            "targetEndDate",
            "completedDate",
            "plannedBudget",
            "actualSpent",
            "committedAmount",
            "progressPercent",
          ]}
          fr={fr}
          icon={FolderKanban}
          onAdd={
            canControl("projects.create")
              ? () => setEditor({ kind: "phase" })
              : undefined
          }
          onEdit={
            canControl("projects.update")
              ? (record) => setEditor({ kind: "phase", record })
              : undefined
          }
        />
        <DependencyPanel
          title={label(fr, "Phase dependencies", "Dépendances entre phases")}
          subtitle={label(
            fr,
            "A phase must wait until its required prior phase is complete.",
            "Une phase doit attendre que sa phase préalable soit terminée.",
          )}
          rows={phaseDependencies}
          sources={phases}
          sourceField="phaseId"
          dependencyField="dependsOnPhaseId"
          fr={fr}
          onAdd={
            canControl("projects.create") && phases.length > 1
              ? () => setEditor({ kind: "phase-dependency" })
              : undefined
          }
        />
        <RecordsPanel
          title={label(fr, "Work and milestones", "Travail et jalons")}
          subtitle={label(
            fr,
            "Assignments, deadlines, blockers, costs and completion status.",
            "Affectations, échéances, blocages, coûts et avancement.",
          )}
          rows={tasks}
          fields={[
            "title",
            "taskType",
            "status",
            "priority",
            "dueDate",
            "blockedReason",
          ]}
          fr={fr}
          icon={ClipboardList}
          onAdd={
            canWrite("tasks.create")
              ? () => setEditor({ kind: "task" })
              : undefined
          }
          onEdit={
            canWrite("tasks.update")
              ? (record) => setEditor({ kind: "task", record })
              : undefined
          }
          onOpen={onOpenTask}
        />
        <RecordsPanel
          title={label(fr, "People", "Équipe")}
          subtitle={label(
            fr,
            "Project manager, provincial manager, supervisors, workers and contractors.",
            "Manager projet, manager provincial, superviseurs, ouvriers et prestataires.",
          )}
          rows={members}
          fields={[
            "assignmentRole",
            "isManager",
            "assignmentStartDate",
            "assignmentEndDate",
            "notes",
          ]}
          fr={fr}
          icon={Users}
          onAdd={
            canControl("projects.create")
              ? () => setEditor({ kind: "member" })
              : undefined
          }
          onEdit={
            canControl("projects.update")
              ? (record) => setEditor({ kind: "member", record })
              : undefined
          }
        />
        <Panel
          title={label(fr, "Planning rule", "Règle de planification")}
          subtitle={label(
            fr,
            "Projects calculate progress from their tasks when tasks exist.",
            "Les projets calculent l’avancement à partir des tâches lorsqu’elles existent.",
          )}
        >
          <p className="text-sm leading-6 text-ink-secondary">
            {label(
              fr,
              "Use a blocker whenever a task cannot start until another is complete. Assigned managers see only their project scope; provincial managers remain restricted to their approved provinces.",
              "Utilisez un blocage lorsqu’une tâche ne peut pas commencer avant une autre. Les managers affectés ne voient que leurs projets ; les managers provinciaux restent limités à leurs provinces autorisées.",
            )}
          </p>
        </Panel>
      </section>
    );

  if (tab === "tasks")
    return (
      <section className="mt-5 space-y-5">
        <Panel
          title={label(fr, "Project work", "Travail du projet")}
          subtitle={label(
            fr,
            "These are normal LiteHubs tasks. Assigned people work from the project workspace, Tasks or Daily Work.",
            "Ce sont des tâches LiteHubs normales. Les personnes affectées travaillent depuis l’espace Projet, Tâches ou Travail quotidien.",
          )}
        >
          <div className="flex flex-wrap gap-2">
            {(
              ["all", "open", "in_progress", "completed", "overdue"] as const
            ).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTaskView(value)}
                className={`rounded-lg px-3 py-2 text-xs font-semibold ${taskView === value ? "bg-brand text-brand-ink" : "bg-surface-2 text-ink-secondary hover:bg-surface-3"}`}
              >
                {titleCase(value)}
              </button>
            ))}
          </div>
        </Panel>
        <DependencyPanel
          title={label(fr, "Task dependencies", "Dépendances entre tâches")}
          subtitle={label(
            fr,
            "Linked tasks remain normal LiteHubs tasks; only their execution order is protected here.",
            "Les tâches liées restent des tâches LiteHubs normales ; seul leur ordre d’exécution est protégé ici.",
          )}
          rows={taskDependencies}
          sources={tasks}
          sourceField="taskId"
          dependencyField="dependsOnTaskId"
          fr={fr}
          onAdd={
            canWrite("tasks.create") && tasks.length > 1
              ? () => setEditor({ kind: "task-dependency" })
              : undefined
          }
        />
        <RecordsPanel
          title={label(fr, "Project work", "Travaux du projet")}
          subtitle={label(
            fr,
            "Only actionable work appears here. Milestones stay in Planning as project checkpoints.",
            "Seuls les travaux opérationnels apparaissent ici. Les jalons restent dans Planification comme points de contrôle du projet.",
          )}
          rows={visibleTasks}
          fields={[
            "title",
            "status",
            "priority",
            "startDate",
            "dueDate",
            "progressPercent",
            "estimatedCost",
            "actualCost",
            "blockedReason",
          ]}
          fr={fr}
          icon={ClipboardList}
          onAdd={
            canWrite("tasks.create")
              ? () => setEditor({ kind: "task" })
              : undefined
          }
          onEdit={
            canWrite("tasks.update")
              ? (record) => setEditor({ kind: "task", record })
              : undefined
          }
          onOpen={onOpenTask}
        />
      </section>
    );
  if (tab === "procurement")
    return (
      <section className="mt-5 space-y-5">
        <div className="grid gap-5 xl:grid-cols-3">
          <RecordsPanel
            title={label(fr, "Purchase requests", "Demandes d’achat")}
            subtitle={label(
              fr,
              "Need identified → request → approval.",
              "Besoin identifié → demande → approbation.",
            )}
            rows={requests}
            fields={[
              "requestNumber",
              "status",
              "approvalStatus",
              "requiredDate",
              "reason",
            ]}
            fr={fr}
            icon={ClipboardCheck}
            onAdd={
              canWrite("procurement.create")
                ? () => setEditor({ kind: "request" })
                : undefined
            }
            footer={
              canWrite("procurement.create") && requests.length ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditor({ kind: "request-line" })}
                >
                  <Plus />
                  {label(fr, "Add requested item", "Ajouter un article")}
                </Button>
              ) : undefined
            }
          />
          <RecordsPanel
            title={label(fr, "Purchase orders", "Bons de commande")}
            subtitle={label(
              fr,
              "Approved request → order → supplier.",
              "Demande approuvée → commande → fournisseur.",
            )}
            rows={orders}
            fields={[
              "orderNumber",
              "status",
              "expectedDeliveryDate",
              "supplierReference",
            ]}
            fr={fr}
            icon={ShoppingCart}
            onAdd={
              canWrite("procurement.create")
                ? () => setEditor({ kind: "order" })
                : undefined
            }
            footer={
              canWrite("procurement.create") && orders.length ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditor({ kind: "order-line" })}
                >
                  <Plus />
                  {label(fr, "Add ordered item", "Ajouter un article")}
                </Button>
              ) : undefined
            }
          />
          <RecordsPanel
            title={label(fr, "Receiving", "Réceptions")}
            subtitle={label(
              fr,
              "Ordered and delivered quantities remain separate.",
              "Les quantités commandées et livrées restent séparées.",
            )}
            rows={receipts}
            fields={[
              "receiptNumber",
              "status",
              "receivedDate",
              "deliveryNoteNumber",
            ]}
            fr={fr}
            icon={ReceiptText}
            onAdd={
              canWrite("procurement.create")
                ? () => setEditor({ kind: "receipt" })
                : undefined
            }
            footer={
              canWrite("procurement.create") && receipts.length ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditor({ kind: "receipt-line" })}
                >
                  <Plus />
                  {label(
                    fr,
                    "Record received item",
                    "Enregistrer l’article reçu",
                  )}
                </Button>
              ) : undefined
            }
          />
        </div>
        <div className="grid gap-5 xl:grid-cols-3">
          <RecordsPanel
            title={label(fr, "Requested items", "Articles demandés")}
            subtitle={label(
              fr,
              "Quantities requested for this project.",
              "Quantités demandées pour ce projet.",
            )}
            rows={requestLines}
            fields={[
              "description",
              "requestedQuantity",
              "approvedQuantity",
              "unit",
            ]}
            fr={fr}
            icon={ClipboardCheck}
          />
          <RecordsPanel
            title={label(fr, "Ordered items", "Articles commandés")}
            subtitle={label(
              fr,
              "Supplier commitment and cost.",
              "Engagement fournisseur et coût.",
            )}
            rows={orderLines}
            fields={["description", "orderedQuantity", "unitCost", "unit"]}
            fr={fr}
            icon={ShoppingCart}
          />
          <RecordsPanel
            title={label(fr, "Delivered items", "Articles réceptionnés")}
            subtitle={label(
              fr,
              "Accepted, damaged and rejected quantities.",
              "Quantités acceptées, endommagées et rejetées.",
            )}
            rows={receiptLines}
            fields={[
              "receivedQuantity",
              "damagedQuantity",
              "rejectedQuantity",
              "actualUnitCost",
            ]}
            fr={fr}
            icon={ReceiptText}
          />
        </div>
      </section>
    );
  if (tab === "documents")
    return (
      <section className="mt-5 space-y-5">
        <DocumentFolders
          orgSlug={orgSlug}
          documents={documents}
          categories={documentCategories}
          fr={fr}
          locale={locale}
          onConfigure={
            canControl("documents.update") ? onConfigureDocument : undefined
          }
          onManage={
            canControl("documents.update")
              ? onManageDocumentCategories
              : undefined
          }
          onPreview={onPreviewDocument}
        />
        <Panel
          title={label(
            fr,
            "Project photo evidence",
            "Photos justificatives du projet",
          )}
          subtitle={label(
            fr,
            "Add photos to the appropriate document folder so the project record stays organised.",
            "Ajoutez les photos dans le bon dossier afin que le dossier du projet reste organisé.",
          )}
        >
          <ImagePanel
            orgSlug={orgSlug}
            images={images}
            categories={documentCategories}
            fr={fr}
            uploading={uploading}
            onUpload={upload}
            removeImage={removeImage}
            onClassify={onClassifyImage}
            classifying={classifyingImage}
            onPreview={onPreviewDocument}
            onConfirmAction={onConfirmAction}
            removingImage={removingImage}
            canDelete={canControl("projects.update")}
          />
        </Panel>
      </section>
    );
  if (tab === "activity")
    return (
      <section className="mt-5">
        <RecordsPanel
          title={label(fr, "Project activity", "Activité du projet")}
          subtitle={label(
            fr,
            "Creation, milestones, tasks, purchasing, receiving, expenses, assets, documents and approvals are shown from their live records.",
            "Création, jalons, tâches, achats, réceptions, dépenses, actifs, documents et approbations sont affichés depuis leurs enregistrements réels.",
          )}
          rows={activity}
          fields={[
            "occurredAt",
            "eventType",
            "entityType",
            "status",
            "amount",
            "currencyCode",
            "actorName",
          ]}
          fr={fr}
          icon={ClipboardList}
        />
      </section>
    );
  if (tab === "finance")
    return (
      <section className="mt-5 grid gap-5 xl:grid-cols-2">
        <RecordsPanel
          title={label(fr, "Budget lines", "Lignes budgétaires")}
          subtitle={label(
            fr,
            "Land, construction, livestock, feed, equipment, staffing, transport and all other planned costs.",
            "Terrain, construction, bétail, aliment, équipement, personnel, transport et tous les autres coûts prévus.",
          )}
          rows={budgets}
          fields={["category", "description", "plannedAmount", "currencyCode"]}
          fr={fr}
          icon={Landmark}
          onAdd={
            canControl("projects.create")
              ? () => setEditor({ kind: "budget" })
              : undefined
          }
          onEdit={
            canControl("projects.update")
              ? (record) => setEditor({ kind: "budget", record })
              : undefined
          }
        />
        <RecordsPanel
          title={label(fr, "Expenses", "Dépenses")}
          subtitle={label(
            fr,
            "Submitted expenses need approval before they count as spent.",
            "Les dépenses soumises nécessitent une approbation avant de compter comme dépensées.",
          )}
          rows={expenses}
          fields={[
            "expenseNumber",
            "category",
            "amount",
            "status",
            "expenseDate",
          ]}
          fr={fr}
          icon={Wallet}
          onAdd={
            canWrite("finance.expenses.create")
              ? () => setEditor({ kind: "expense" })
              : undefined
          }
          onEdit={
            canWrite("finance.expenses.update")
              ? (record) => setEditor({ kind: "expense", record })
              : undefined
          }
        />
        <RecordsPanel
          title={label(fr, "Approvals", "Approbations")}
          subtitle={label(
            fr,
            "Budget changes, purchases, expenses and completed phases require an authorised decision.",
            "Les changements budgétaires, achats, dépenses et phases terminées demandent une décision autorisée.",
          )}
          rows={approvals}
          fields={[
            "approvalNumber",
            "requestType",
            "requestedAmount",
            "status",
            "requestedAt",
          ]}
          fr={fr}
          icon={ShieldCheck}
          footer={
            <Link
              href={`/${orgSlug}/approvals`}
              className="text-xs font-semibold text-brand hover:underline"
            >
              {label(fr, "Open approval queue", "Ouvrir la file d’approbation")}
            </Link>
          }
        />
        <Panel
          title={label(fr, "Automatic calculation", "Calcul automatique")}
          subtitle={label(
            fr,
            "No spreadsheet calculation is needed.",
            "Aucun calcul de tableur n’est nécessaire.",
          )}
        >
          <div className="space-y-3 text-sm leading-6 text-ink-secondary">
            <p>
              <strong className="text-ink">
                {label(fr, "Planned", "Prévu")}
              </strong>{" "}
              ={" "}
              {label(
                fr,
                "budget lines, otherwise project estimate.",
                "lignes budgétaires, sinon estimation du projet.",
              )}
            </p>
            <p>
              <strong className="text-ink">
                {label(fr, "Spent", "Dépensé")}
              </strong>{" "}
              ={" "}
              {label(
                fr,
                "approved or paid project expenses.",
                "dépenses projet approuvées ou payées.",
              )}
            </p>
            <p>
              <strong className="text-ink">
                {label(fr, "Committed", "Engagé")}
              </strong>{" "}
              ={" "}
              {label(
                fr,
                "outstanding sent purchase orders.",
                "bons de commande envoyés restant à couvrir.",
              )}
            </p>
            <p>
              <strong className="text-ink">
                {label(fr, "Available", "Disponible")}
              </strong>{" "}
              ={" "}
              {label(
                fr,
                "planned − spent − committed. A negative result is shown as an over-budget warning.",
                "prévu − dépensé − engagé. Un résultat négatif est signalé comme dépassement de budget.",
              )}
            </p>
          </div>
        </Panel>
      </section>
    );
  return (
    <section className="mt-5 space-y-5">
      <Panel
        title={label(fr, "Operational resources", "Ressources opérationnelles")}
        subtitle={label(
          fr,
          "Link the actual flock, pigs, farm, field or plot created by this investment. Their daily management remains in the specialist module.",
          "Reliez le lot, les porcs, la ferme, le champ ou la parcelle réellement créés par cet investissement. Leur gestion quotidienne reste dans le module spécialisé.",
        )}
        action={
          canControl("projects.create") ? (
            <Button
              size="sm"
              onClick={() => setEditor({ kind: "operational-link" })}
            >
              <Plus />
              {label(fr, "Link operation", "Lier une opération")}
            </Button>
          ) : undefined
        }
      >
        {operationalLinks.length ? (
          <div className="divide-y divide-border">
            {operationalLinks.map((link) => (
              <div
                key={link.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {String(link.targetName ?? link.recordId)}
                  </p>
                  <p className="mt-1 text-xs text-ink-secondary">
                    {titleCase(link.moduleCode)} ·{" "}
                    {titleCase(link.resourceCode)} · {titleCase(link.linkType)}
                  </p>
                </div>
                {link.targetStatus ? (
                  <Badge variant={statusVariant(link.targetStatus)}>
                    {titleCase(link.targetStatus)}
                  </Badge>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title={label(fr, "No operation linked", "Aucune opération liée")}
            description={label(
              fr,
              "Once a purchased asset becomes a flock, pig record, farm, field or plot, link it here without duplicating it.",
              "Lorsqu un achat devient un lot, une fiche porcine, une ferme, un champ ou une parcelle, liez-le ici sans le dupliquer.",
            )}
            icon={Boxes}
            action={
              canControl("projects.create")
                ? {
                    label: label(fr, "Link operation", "Lier une opération"),
                    onClick: () => setEditor({ kind: "operational-link" }),
                  }
                : undefined
            }
          />
        )}
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title={label(fr, "Project materials", "Matériaux du projet")}
          subtitle={label(
            fr,
            "Consumables: cement, roofing, feed, seed, fertilizer, medicine, fuel and spare parts.",
            "Consommables : ciment, toiture, aliment, semences, engrais, médicaments, carburant et pièces.",
          )}
          action={
            canControl("projects.create") ? (
              <Button size="sm" onClick={() => setEditor({ kind: "material" })}>
                <Plus />
                {label(fr, "Add material", "Ajouter un matériau")}
              </Button>
            ) : undefined
          }
        >
          {summary?.materials?.length ? (
            <div className="divide-y divide-border">
              {(summary.materials ?? []).map((item, index) => (
                <div
                  key={String(
                    item.id ?? `${String(item.name ?? "material")}-${index}`,
                  )}
                  className="grid gap-2 py-3 sm:grid-cols-[1fr_auto_auto]"
                >
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {String(item.name)}
                    </p>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {String(
                        item.category ?? label(fr, "Material", "Matériau"),
                      )}{" "}
                      · {String(item.unit ?? "—")}
                    </p>
                  </div>
                  <p className="text-xs text-ink-secondary">
                    {label(fr, "Available", "Disponible")}:{" "}
                    <strong className="text-ink">
                      {number(item.available)}
                    </strong>
                  </p>
                  <p className="text-xs text-ink-secondary">
                    {label(fr, "Still needed", "À acheter")}:{" "}
                    <strong
                      className={
                        number(item.stillNeeded) > 0
                          ? "text-serious"
                          : "text-good"
                      }
                    >
                      {number(item.stillNeeded)}
                    </strong>
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title={label(fr, "No material plan", "Aucun plan de matériaux")}
              description={label(
                fr,
                "Plan what must be purchased, received and used.",
                "Planifiez ce qui doit être acheté, réceptionné et utilisé.",
              )}
              icon={Boxes}
            />
          )}
        </Panel>
        <RecordsPanel
          title={label(fr, "Material use", "Utilisation des matériaux")}
          subtitle={label(
            fr,
            "Issue, return, report damage or adjust stock against the correct project material.",
            "Sortez, retournez, signalez les dommages ou ajustez le stock sur le bon matériau.",
          )}
          rows={movements}
          fields={["movementDate", "movementType", "quantity", "notes"]}
          fr={fr}
          icon={PackageCheck}
          onAdd={
            canControl("projects.create") && materials.length
              ? () => setEditor({ kind: "movement" })
              : undefined
          }
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <RecordsPanel
          title={label(fr, "Purchase requests", "Demandes d’achat")}
          subtitle={label(
            fr,
            "Need identified → request → approval.",
            "Besoin identifié → demande → approbation.",
          )}
          rows={requests}
          fields={[
            "requestNumber",
            "status",
            "approvalStatus",
            "requiredDate",
            "reason",
          ]}
          fr={fr}
          icon={ClipboardCheck}
          onAdd={
            canWrite("procurement.create")
              ? () => setEditor({ kind: "request" })
              : undefined
          }
          footer={
            canWrite("procurement.create") && requests.length ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditor({ kind: "request-line" })}
              >
                <Plus />
                {label(fr, "Add requested item", "Ajouter un article")}
              </Button>
            ) : undefined
          }
        />
        <RecordsPanel
          title={label(fr, "Purchase orders", "Bons de commande")}
          subtitle={label(
            fr,
            "Approved request → order → supplier.",
            "Demande approuvée → commande → fournisseur.",
          )}
          rows={orders}
          fields={[
            "orderNumber",
            "status",
            "expectedDeliveryDate",
            "supplierReference",
          ]}
          fr={fr}
          icon={ShoppingCart}
          onAdd={
            canWrite("procurement.create")
              ? () => setEditor({ kind: "order" })
              : undefined
          }
          footer={
            canWrite("procurement.create") && orders.length ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditor({ kind: "order-line" })}
              >
                <Plus />
                {label(fr, "Add ordered item", "Ajouter un article")}
              </Button>
            ) : undefined
          }
        />
        <RecordsPanel
          title={label(fr, "Receiving", "Réceptions")}
          subtitle={label(
            fr,
            "Ordered and delivered quantities stay separate.",
            "Les quantités commandées et livrées restent séparées.",
          )}
          rows={receipts}
          fields={[
            "receiptNumber",
            "status",
            "receivedDate",
            "deliveryNoteNumber",
          ]}
          fr={fr}
          icon={ReceiptText}
          onAdd={
            canWrite("procurement.create")
              ? () => setEditor({ kind: "receipt" })
              : undefined
          }
          footer={
            canWrite("procurement.create") && receipts.length ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditor({ kind: "receipt-line" })}
              >
                <Plus />
                {label(
                  fr,
                  "Record received item",
                  "Enregistrer l’article reçu",
                )}
              </Button>
            ) : undefined
          }
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <RecordsPanel
          title={label(fr, "Requested items", "Articles demandés")}
          subtitle={label(
            fr,
            "Quantities and estimated cost requested for this project.",
            "Quantités et coût estimé demandés pour ce projet.",
          )}
          rows={requestLines}
          fields={[
            "description",
            "requestedQuantity",
            "approvedQuantity",
            "unit",
          ]}
          fr={fr}
          icon={ClipboardCheck}
        />
        <RecordsPanel
          title={label(fr, "Ordered items", "Articles commandés")}
          subtitle={label(
            fr,
            "The financial commitment sent to suppliers.",
            "L’engagement financier envoyé aux fournisseurs.",
          )}
          rows={orderLines}
          fields={["description", "orderedQuantity", "unitCost", "unit"]}
          fr={fr}
          icon={ShoppingCart}
        />
        <RecordsPanel
          title={label(fr, "Delivered items", "Articles réceptionnés")}
          subtitle={label(
            fr,
            "Delivered, damaged and rejected quantities stay visible.",
            "Quantités livrées, endommagées et rejetées restent visibles.",
          )}
          rows={receiptLines}
          fields={[
            "receivedQuantity",
            "damagedQuantity",
            "rejectedQuantity",
            "actualUnitCost",
          ]}
          fr={fr}
          icon={ReceiptText}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <RecordsPanel
          title={label(fr, "Assets & equipment", "Actifs et équipements")}
          subtitle={label(
            fr,
            "Tractors, pumps, generators, vehicles, scales and buildings remain company assets after the project is complete.",
            "Tracteurs, pompes, groupes, véhicules, balances et bâtiments restent des actifs de l’entreprise après le projet.",
          )}
          rows={assets}
          fields={[
            "assetNumber",
            "name",
            "category",
            "status",
            "purchasePrice",
          ]}
          fr={fr}
          icon={Hammer}
          onAdd={
            canWrite("equipment.create")
              ? () => setEditor({ kind: "asset" })
              : undefined
          }
        />
        <RecordsPanel
          title={label(fr, "Maintenance", "Maintenance")}
          subtitle={label(
            fr,
            "Preventive work, repairs, cost, downtime and next service all remain connected to the asset and project.",
            "Préventif, réparations, coût, arrêt et prochaine intervention restent reliés à l’actif et au projet.",
          )}
          rows={workOrders}
          fields={["workOrderNumber", "title", "status", "dueDate", "priority"]}
          fr={fr}
          icon={Wrench}
          onAdd={
            canWrite("work_orders.create") && assets.length
              ? () => setEditor({ kind: "work-order" })
              : undefined
          }
          footer={
            canWrite("maintenance.create") && assets.length ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditor({ kind: "maintenance-plan" })}
              >
                <Plus />
                {label(fr, "Maintenance plan", "Plan de maintenance")}
              </Button>
            ) : undefined
          }
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <RecordsPanel
          title={label(fr, "Asset assignments", "Affectations d’actifs")}
          subtitle={label(
            fr,
            "Keep the responsible person and operating site visible for every project asset.",
            "Conservez la personne responsable et le site d’exploitation de chaque actif du projet.",
          )}
          rows={assetAssignments}
          fields={[
            "assignedMemberId",
            "assignedSiteId",
            "assignedAt",
            "conditionOut",
          ]}
          fr={fr}
          icon={Users}
          onAdd={
            canWrite("equipment.create") && assets.length
              ? () => setEditor({ kind: "asset-assignment" })
              : undefined
          }
          onEdit={
            canWrite("equipment.update")
              ? (record) => setEditor({ kind: "asset-assignment", record })
              : undefined
          }
        />
        <RecordsPanel
          title={label(fr, "Asset movements", "Mouvements d’actifs")}
          subtitle={label(
            fr,
            "Track transfers between sites or locations with a clear reason.",
            "Suivez les transferts entre sites ou emplacements avec un motif clair.",
          )}
          rows={assetMovements}
          fields={["movedAt", "fromLocation", "toLocation", "reason"]}
          fr={fr}
          icon={PackageCheck}
          onAdd={
            canWrite("equipment.create") && assets.length
              ? () => setEditor({ kind: "asset-movement" })
              : undefined
          }
          onEdit={
            canWrite("equipment.update")
              ? (record) => setEditor({ kind: "asset-movement", record })
              : undefined
          }
        />
        <RecordsPanel
          title={label(fr, "Machine usage", "Utilisation des machines")}
          subtitle={label(
            fr,
            "Record meter readings, fuel, work completed, output and downtime.",
            "Enregistrez les compteurs, carburant, travail réalisé, production et arrêts.",
          )}
          rows={assetUsage}
          fields={[
            "usageDate",
            "meterStart",
            "meterEnd",
            "fuelConsumed",
            "downtimeMinutes",
          ]}
          fr={fr}
          icon={Hammer}
          onAdd={
            canWrite("equipment.create") && assets.length
              ? () => setEditor({ kind: "asset-usage" })
              : undefined
          }
          onEdit={
            canWrite("equipment.update")
              ? (record) => setEditor({ kind: "asset-usage", record })
              : undefined
          }
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <RecordsPanel
          title={label(fr, "Vehicles and trips", "Véhicules et trajets")}
          subtitle={label(
            fr,
            "A vehicle remains an asset, with registration, insurance, mileage, fuel and project trips tracked separately.",
            "Un véhicule reste un actif ; immatriculation, assurance, kilométrage, carburant et trajets projet sont suivis séparément.",
          )}
          rows={vehicleProfiles}
          fields={[
            "vehicleNumber",
            "plateNumber",
            "make",
            "model",
            "insuranceExpiresOn",
          ]}
          fr={fr}
          icon={Hammer}
          onAdd={
            canWrite("vehicles.create") && assets.length
              ? () => setEditor({ kind: "vehicle-profile" })
              : undefined
          }
          onEdit={
            canWrite("vehicles.update")
              ? (record) => setEditor({ kind: "vehicle-profile", record })
              : undefined
          }
          footer={
            vehicleProfiles.length && canWrite("vehicles.create") ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditor({ kind: "vehicle-trip" })}
                >
                  <Plus />
                  {label(fr, "Record trip", "Enregistrer un trajet")}
                </Button>
                {vehicleTrips.length ? (
                  <div className="mt-3 divide-y divide-border">
                    {vehicleTrips.map((trip) => (
                      <div
                        key={trip.id}
                        className="py-2 text-xs text-ink-secondary"
                      >
                        {String(trip.tripDate ?? "—")} ·{" "}
                        {String(trip.destination ?? "—")} ·{" "}
                        {String(trip.purpose ?? "—")}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : undefined
          }
        />
        <RecordsPanel
          title={label(
            fr,
            "Maintenance plans and parts",
            "Plans et pièces de maintenance",
          )}
          subtitle={label(
            fr,
            "Plans schedule the next service; issued parts remain linked to the maintenance intervention and cost.",
            "Les plans programment la prochaine intervention ; les pièces sorties restent liées à l’intervention et au coût.",
          )}
          rows={plans}
          fields={["name", "maintenanceType", "nextDueDate", "nextDueMeter"]}
          fr={fr}
          icon={Wrench}
          onAdd={
            canWrite("maintenance.create") && assets.length
              ? () => setEditor({ kind: "maintenance-plan" })
              : undefined
          }
          onEdit={
            canWrite("maintenance.update")
              ? (record) => setEditor({ kind: "maintenance-plan", record })
              : undefined
          }
          footer={
            workOrders.length && canWrite("maintenance.create") ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditor({ kind: "maintenance-part" })}
                >
                  <Plus />
                  {label(fr, "Issue maintenance part", "Sortir une pièce")}
                </Button>
                {maintenanceParts.length ? (
                  <div className="mt-3 divide-y divide-border">
                    {maintenanceParts.map((part) => (
                      <div
                        key={part.id}
                        className="py-2 text-xs text-ink-secondary"
                      >
                        {String(part.partName ?? "—")} ·{" "}
                        {String(part.quantity ?? 0)} {String(part.unit ?? "")}
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : undefined
          }
        />
      </div>
      <Panel
        title={label(fr, "Uncategorised evidence", "Justificatifs non classés")}
        subtitle={label(
          fr,
          "Attach photos of land, construction, deliveries, receipts and equipment.",
          "Ajoutez des photos du terrain, construction, livraisons, reçus et équipements.",
        )}
      >
        <ImagePanel
          orgSlug={orgSlug}
          images={images}
          categories={documentCategories}
          fr={fr}
          uploading={uploading}
          onUpload={upload}
          removeImage={removeImage}
          onClassify={onClassifyImage}
          classifying={classifyingImage}
          onPreview={onPreviewDocument}
          onConfirmAction={onConfirmAction}
          removingImage={removingImage}
          canDelete={canControl("projects.update")}
        />
      </Panel>
    </section>
  );
}

function EditorDialog({
  editor,
  orgSlug,
  project,
  phases,
  tasks,
  documents,
  materials,
  assets,
  requests,
  requestLines,
  orders,
  orderLines,
  receipts,
  workOrders,
  vehicleProfiles,
  maintenancePlans,
  suppliers,
  warehouses,
  inventoryItems,
  sites,
  provinces,
  members,
  fr,
  isOwner,
  working,
  onClose,
  onSave,
}: {
  editor: Exclude<Editor, null>;
  orgSlug: string;
  project: Project | null;
  phases: Row[];
  tasks: Row[];
  documents: Row[];
  materials: Row[];
  assets: Row[];
  requests: Row[];
  requestLines: Row[];
  orders: Row[];
  orderLines: Row[];
  receipts: Row[];
  workOrders: Row[];
  vehicleProfiles: Row[];
  maintenancePlans: Row[];
  suppliers: Row[];
  warehouses: Row[];
  inventoryItems: Row[];
  sites: Place[];
  provinces: Place[];
  members: Array<{ id: string; name: string }>;
  fr: boolean;
  isOwner: boolean;
  working: boolean;
  onClose: () => void;
  onSave: (
    resource: OwnerManagementResource,
    body: ManagementBody,
    taskDocuments?: { documentIds: string[] },
  ) => Promise<void>;
}) {
  const editing = editor.record;
  const getValue = (key: string) =>
    editing?.[key] == null ? "" : String(editing[key]);
  const projectId = project?.id ?? "";
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const phaseId = optional(form, "phaseId");
    const siteId = optional(form, "siteId");
    const memberId = optional(form, "memberId");
    let resource: OwnerManagementResource;
    let body: ManagementBody;
    if (editor.kind === "project") {
      resource = "projects";
      body = {
        code: projectCode(optional(form, "code")),
        name: String(form.get("name") ?? "").trim(),
        description: optional(form, "description"),
        projectType: String(form.get("projectType") ?? "other"),
        provinceId: String(form.get("provinceId") ?? ""),
        siteId,
        responsibleMemberId: optional(form, "responsibleMemberId"),
        startDate: optional(form, "startDate"),
        targetCompletionDate: optional(form, "targetCompletionDate"),
        revisedCompletionDate: optional(form, "revisedCompletionDate"),
        fundingSource: optional(form, "fundingSource"),
        expectedOutcome: optional(form, "expectedOutcome"),
        approvalRequired: form.get("approvalRequired") === "on",
        status: String(form.get("status") ?? "planning"),
        priority: String(form.get("priority") ?? "medium"),
        estimatedTotalBudget: optionalNumber(form, "estimatedTotalBudget"),
        currencyCode: normalizeCurrency(
          String(form.get("currencyCode") ?? "CDF"),
        ),
        progressPercent: optionalNumber(form, "progressPercent") ?? 0,
        blueprint: optional(form, "blueprint"),
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "phase") {
      resource = "phases";
      body = {
        projectId,
        code: optional(form, "code") ?? generated("PHS"),
        name: String(form.get("name") ?? "").trim(),
        description: optional(form, "description"),
        phaseOrder: Number(optional(form, "phaseOrder") ?? 0),
        responsibleMemberId: optional(form, "responsibleMemberId"),
        startDate: optional(form, "startDate"),
        actualStartDate: optional(form, "actualStartDate"),
        targetEndDate: optional(form, "targetEndDate"),
        completedDate: optional(form, "completedDate"),
        status: String(form.get("status") ?? "not_started"),
        priority: String(form.get("priority") ?? "medium"),
        plannedBudget: optionalNumber(form, "plannedBudget"),
        progressPercent: optionalNumber(form, "progressPercent") ?? 0,
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "phase-dependency") {
      resource = "phase-dependencies";
      body = {
        phaseId: String(form.get("phaseId") ?? ""),
        dependsOnPhaseId: String(form.get("dependsOnPhaseId") ?? ""),
        dependencyType: String(form.get("dependencyType") ?? "finish_to_start"),
      };
    } else if (editor.kind === "task-dependency") {
      resource = "task-dependencies";
      body = {
        taskId: String(form.get("taskId") ?? ""),
        dependsOnTaskId: String(form.get("dependsOnTaskId") ?? ""),
        dependencyType: String(form.get("dependencyType") ?? "finish_to_start"),
      };
    } else if (editor.kind === "task") {
      resource = "tasks";
      body = {
        // Never submit browser empty strings for UUID/date/decimal columns.
        projectId: String(projectId).trim() || null,
        phaseId: nullableValue(form, "phaseId"),
        taskType: taskEnum(form.get("taskType") ?? "work"),
        code: nullableValue(form, "code"),
        title: String(form.get("title") ?? "").trim(),
        description: nullableValue(form, "description"),
        assignedMemberId: nullableValue(form, "assignedMemberId"),
        startDate: nullableValue(form, "startDate"),
        dueDate: nullableValue(form, "dueDate"),
        priority: taskEnum(form.get("priority") ?? "medium"),
        status: taskEnum(form.get("status") ?? "not_started"),
        // A real zero must stay zero; only a blank number becomes null.
        progressPercent: nullableNumber(form, "progressPercent") ?? 0,
        estimatedCost: nullableNumber(form, "estimatedCost"),
        blockedReason: nullableValue(form, "blockedReason"),
        notes: nullableValue(form, "notes"),
      };
    } else if (editor.kind === "member") {
      resource = "project-members";
      body = {
        projectId,
        memberId: String(form.get("memberId") ?? ""),
        assignmentRole: String(form.get("assignmentRole") ?? "other"),
        isManager: form.get("isManager") === "on",
        assignmentStartDate: String(form.get("assignmentStartDate") ?? ""),
        assignmentEndDate: optional(form, "assignmentEndDate") ?? null,
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "operational-link") {
      const [moduleCode, resourceCode] = String(
        form.get("targetKind") ?? "poultry:flocks",
      ).split(":");
      resource = "operational-links";
      body = {
        projectId,
        moduleCode,
        resourceCode,
        recordId: String(form.get("recordId") ?? "").trim(),
        linkType: String(form.get("linkType") ?? "created_by_project"),
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "budget") {
      resource = "budget-lines";
      body = {
        projectId,
        phaseId,
        category: String(form.get("category") ?? "").trim(),
        description: optional(form, "description"),
        plannedAmount: Number(form.get("plannedAmount") ?? 0),
        currencyCode: String(
          form.get("currencyCode") ?? project?.currencyCode ?? "CDF",
        ),
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "material") {
      resource = "materials";
      body = {
        projectId,
        phaseId,
        inventoryItemId: optional(form, "inventoryItemId"),
        defaultWarehouseId: optional(form, "defaultWarehouseId"),
        preferredSupplierId: optional(form, "preferredSupplierId"),
        code: optional(form, "code"),
        name: String(form.get("name") ?? "").trim(),
        category: optional(form, "category"),
        unit: String(form.get("unit") ?? "unit").trim(),
        plannedQuantity: Number(form.get("plannedQuantity") ?? 0),
        estimatedUnitCost: optionalNumber(form, "estimatedUnitCost"),
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "movement") {
      resource = "material-movements";
      body = {
        projectMaterialId: String(form.get("projectMaterialId") ?? ""),
        movementDate: String(form.get("movementDate") ?? ""),
        movementType: String(form.get("movementType") ?? "used"),
        quantity: Number(form.get("quantity") ?? 0),
        warehouseId: optional(form, "warehouseId"),
        projectTaskId: optional(form, "projectTaskId"),
        issuedByMemberId: optional(form, "issuedByMemberId"),
        usedByMemberId: optional(form, "usedByMemberId"),
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "request") {
      resource = "purchase-requests";
      body = {
        requestNumber: optional(form, "requestNumber") ?? generated("PR"),
        projectId,
        phaseId,
        projectTaskId: optional(form, "projectTaskId"),
        requestedByMemberId: optional(form, "requestedByMemberId"),
        supplierId: optional(form, "supplierId"),
        requestDate: String(form.get("requestDate") ?? ""),
        requiredDate: optional(form, "requiredDate"),
        priority: String(form.get("priority") ?? "medium"),
        status: String(form.get("status") ?? "draft"),
        approvalStatus: String(form.get("approvalStatus") ?? "not_requested"),
        reason: String(form.get("reason") ?? "").trim(),
        currencyCode: String(
          form.get("currencyCode") ?? project?.currencyCode ?? "CDF",
        ),
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "request-line") {
      resource = "purchase-request-lines";
      body = {
        purchaseRequestId: String(form.get("purchaseRequestId") ?? ""),
        projectMaterialId: optional(form, "projectMaterialId"),
        inventoryItemId: optional(form, "inventoryItemId"),
        description: String(form.get("description") ?? "").trim(),
        itemKind: String(form.get("itemKind") ?? "material"),
        unit: String(form.get("unit") ?? "").trim(),
        requestedQuantity: Number(form.get("requestedQuantity") ?? 0),
        approvedQuantity: optionalNumber(form, "approvedQuantity") ?? 0,
        estimatedUnitCost: optionalNumber(form, "estimatedUnitCost"),
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "order") {
      resource = "purchase-orders";
      body = {
        orderNumber: optional(form, "orderNumber") ?? generated("PO"),
        projectId,
        phaseId,
        projectTaskId: optional(form, "projectTaskId"),
        purchaseRequestId: optional(form, "purchaseRequestId"),
        supplierId: String(form.get("supplierId") ?? ""),
        warehouseId: optional(form, "warehouseId"),
        orderDate: String(form.get("orderDate") ?? ""),
        expectedDeliveryDate: optional(form, "expectedDeliveryDate"),
        status: String(form.get("status") ?? "draft"),
        currencyCode: String(
          form.get("currencyCode") ?? project?.currencyCode ?? "CDF",
        ),
        supplierReference: optional(form, "supplierReference"),
        deliveryAddress: optional(form, "deliveryAddress"),
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "order-line") {
      resource = "purchase-order-lines";
      body = {
        purchaseOrderId: String(form.get("purchaseOrderId") ?? ""),
        projectMaterialId: optional(form, "projectMaterialId"),
        inventoryItemId: optional(form, "inventoryItemId"),
        description: String(form.get("description") ?? "").trim(),
        itemKind: String(form.get("itemKind") ?? "material"),
        unit: String(form.get("unit") ?? "").trim(),
        orderedQuantity: Number(form.get("orderedQuantity") ?? 0),
        unitCost: Number(form.get("unitCost") ?? 0),
        taxAmount: optionalNumber(form, "taxAmount") ?? 0,
        assetName: optional(form, "assetName"),
        assetCategory: optional(form, "assetCategory"),
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "receipt") {
      resource = "receipts";
      body = {
        receiptNumber: optional(form, "receiptNumber") ?? generated("RCV"),
        projectId,
        purchaseOrderId: String(form.get("purchaseOrderId") ?? ""),
        warehouseId: optional(form, "warehouseId"),
        receivedDate: String(form.get("receivedDate") ?? ""),
        deliveryNoteNumber: optional(form, "deliveryNoteNumber"),
        status: String(form.get("status") ?? "received"),
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "receipt-line") {
      resource = "receipt-lines";
      body = {
        receiptId: String(form.get("receiptId") ?? ""),
        purchaseOrderLineId: String(form.get("purchaseOrderLineId") ?? ""),
        projectMaterialId: optional(form, "projectMaterialId"),
        inventoryItemId: optional(form, "inventoryItemId"),
        receivedQuantity: Number(form.get("receivedQuantity") ?? 0),
        damagedQuantity: optionalNumber(form, "damagedQuantity") ?? 0,
        rejectedQuantity: optionalNumber(form, "rejectedQuantity") ?? 0,
        actualUnitCost: optionalNumber(form, "actualUnitCost"),
        assetRequired: form.get("assetRequired") === "on",
        assetName: optional(form, "assetName"),
        assetCategory: optional(form, "assetCategory"),
        receiverNotes: optional(form, "receiverNotes"),
      };
    } else if (editor.kind === "expense") {
      resource = "expenses";
      body = {
        expenseNumber: optional(form, "expenseNumber") ?? generated("EXP"),
        projectId,
        phaseId,
        projectTaskId: optional(form, "projectTaskId"),
        provinceId: project?.provinceId,
        siteId: siteId ?? project?.siteId,
        category: String(form.get("category") ?? "").trim(),
        description: optional(form, "description"),
        amount: Number(form.get("amount") ?? 0),
        currencyCode: String(
          form.get("currencyCode") ?? project?.currencyCode ?? "CDF",
        ),
        expenseDate: String(form.get("expenseDate") ?? ""),
        paymentMethod: optional(form, "paymentMethod"),
        status: String(form.get("status") ?? "draft"),
        receiptReference: optional(form, "receiptReference"),
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "asset") {
      resource = "assets";
      body = {
        assetNumber: optional(form, "assetNumber") ?? generated("AST"),
        projectId,
        phaseId,
        projectTaskId: optional(form, "projectTaskId"),
        provinceId: project?.provinceId,
        siteId: siteId ?? project?.siteId,
        name: String(form.get("name") ?? "").trim(),
        category: String(form.get("category") ?? "").trim(),
        brand: optional(form, "brand"),
        model: optional(form, "model"),
        serialNumber: optional(form, "serialNumber"),
        purchasePrice: optionalNumber(form, "purchasePrice"),
        purchaseDate: optional(form, "purchaseDate"),
        currencyCode: String(
          form.get("currencyCode") ?? project?.currencyCode ?? "CDF",
        ),
        condition: String(form.get("condition") ?? "good"),
        status: String(form.get("status") ?? "available"),
        currentLocation: optional(form, "currentLocation"),
        meterType: optional(form, "meterType"),
        currentMeterReading: optionalNumber(form, "currentMeterReading"),
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "asset-assignment") {
      resource = "asset-assignments";
      body = {
        assetId: String(form.get("assetId") ?? ""),
        assignedMemberId: optional(form, "assignedMemberId"),
        assignedProjectId: projectId,
        assignedSiteId: optional(form, "assignedSiteId"),
        assignedAt: optional(form, "assignedAt"),
        conditionOut: optional(form, "conditionOut"),
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "asset-movement") {
      resource = "asset-movements";
      body = {
        assetId: String(form.get("assetId") ?? ""),
        fromSiteId: optional(form, "fromSiteId"),
        toSiteId: optional(form, "toSiteId"),
        fromLocation: optional(form, "fromLocation"),
        toLocation: optional(form, "toLocation"),
        movedAt: optional(form, "movedAt"),
        reason: String(form.get("reason") ?? "").trim(),
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "asset-usage") {
      resource = "asset-usage";
      body = {
        assetId: String(form.get("assetId") ?? ""),
        projectId,
        siteId: optional(form, "siteId") ?? project?.siteId,
        usageDate: String(form.get("usageDate") ?? ""),
        meterStart: optionalNumber(form, "meterStart"),
        meterEnd: optionalNumber(form, "meterEnd"),
        fuelConsumed: optionalNumber(form, "fuelConsumed"),
        fuelUnit: optional(form, "fuelUnit"),
        workPerformed: String(form.get("workPerformed") ?? "").trim(),
        areaCovered: optionalNumber(form, "areaCovered"),
        inputQuantity: optionalNumber(form, "inputQuantity"),
        outputQuantity: optionalNumber(form, "outputQuantity"),
        quantityUnit: optional(form, "quantityUnit"),
        downtimeMinutes: optionalNumber(form, "downtimeMinutes") ?? 0,
        problemReported: optional(form, "problemReported"),
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "vehicle-profile") {
      resource = "vehicle-profiles";
      body = {
        assetId: String(form.get("assetId") ?? ""),
        vehicleNumber: String(form.get("vehicleNumber") ?? "").trim(),
        registrationNumber: optional(form, "registrationNumber"),
        plateNumber: optional(form, "plateNumber"),
        vehicleYear: optionalNumber(form, "vehicleYear"),
        vin: optional(form, "vin"),
        make: optional(form, "make"),
        model: optional(form, "model"),
        insuranceExpiresOn: optional(form, "insuranceExpiresOn"),
        inspectionExpiresOn: optional(form, "inspectionExpiresOn"),
      };
    } else if (editor.kind === "vehicle-trip") {
      resource = "vehicle-trips";
      body = {
        vehicleId: String(form.get("vehicleId") ?? ""),
        projectId,
        driverMemberId: optional(form, "driverMemberId"),
        tripDate: String(form.get("tripDate") ?? ""),
        destination: String(form.get("destination") ?? "").trim(),
        purpose: String(form.get("purpose") ?? "").trim(),
        startMileage: optionalNumber(form, "startMileage"),
        endMileage: optionalNumber(form, "endMileage"),
        fuelUsed: optionalNumber(form, "fuelUsed"),
        fuelCost: optionalNumber(form, "fuelCost"),
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "maintenance-plan") {
      resource = "maintenance-plans";
      body = {
        assetId: String(form.get("assetId") ?? ""),
        name: String(form.get("name") ?? "").trim(),
        maintenanceType: String(form.get("maintenanceType") ?? "preventive"),
        description: optional(form, "description"),
        intervalDays: optionalNumber(form, "intervalDays"),
        intervalMeter: optionalNumber(form, "intervalMeter"),
        nextDueDate: optional(form, "nextDueDate"),
        nextDueMeter: optionalNumber(form, "nextDueMeter"),
        estimatedCost: optionalNumber(form, "estimatedCost"),
        isActive: form.get("isActive") === "on",
      };
    } else if (editor.kind === "maintenance-part") {
      resource = "maintenance-parts";
      body = {
        workOrderId: String(form.get("workOrderId") ?? ""),
        inventoryItemId: optional(form, "inventoryItemId"),
        warehouseId: optional(form, "warehouseId"),
        partName: String(form.get("partName") ?? "").trim(),
        quantity: Number(form.get("quantity") ?? 0),
        unit: String(form.get("unit") ?? "").trim(),
        unitCost: optionalNumber(form, "unitCost"),
        issuedAt: optional(form, "issuedAt"),
        notes: optional(form, "notes"),
      };
    } else {
      resource = "maintenance-work-orders";
      body = {
        workOrderNumber: optional(form, "workOrderNumber") ?? generated("MWO"),
        assetId: String(form.get("assetId") ?? ""),
        projectId,
        planId: optional(form, "planId"),
        maintenanceType: String(form.get("maintenanceType") ?? "corrective"),
        status: String(form.get("status") ?? "reported"),
        priority: String(form.get("priority") ?? "normal"),
        title: String(form.get("title") ?? "").trim(),
        problemDescription: optional(form, "problemDescription"),
        dueDate: optional(form, "dueDate"),
        laborCost: optionalNumber(form, "laborCost") ?? 0,
        partsCost: optionalNumber(form, "partsCost") ?? 0,
        otherCost: optionalNumber(form, "otherCost") ?? 0,
        notes: optional(form, "notes"),
      };
    }
    if (editor.kind === "project") {
      const validation: Record<string, string> = {};
      if (!String(body.name ?? "").trim())
        validation.name = fr
          ? "Le nom du projet est obligatoire."
          : "Project name is required.";
      if (!String(body.projectType ?? "").trim())
        validation.projectType = fr
          ? "Sélectionnez le type de projet."
          : "Choose a project type.";
      if (!String(body.provinceId ?? "").trim())
        validation.provinceId = fr
          ? "Sélectionnez la province du projet."
          : "Choose the project province.";
      if (!String(body.status ?? "").trim())
        validation.status = fr
          ? "Sélectionnez le statut du projet."
          : "Choose the project status.";
      if (!String(body.priority ?? "").trim())
        validation.priority = fr
          ? "Sélectionnez la priorité du projet."
          : "Choose the project priority.";
      if (Number(body.estimatedTotalBudget ?? 0) < 0)
        validation.estimatedTotalBudget = fr
          ? "Le budget doit être égal ou supérieur à zéro."
          : "Budget must be zero or higher.";
      if (
        body.startDate &&
        body.targetCompletionDate &&
        String(body.targetCompletionDate) < String(body.startDate)
      )
        validation.targetCompletionDate = fr
          ? "La fin prévue ne peut pas être antérieure à la date de début."
          : "Target completion cannot be before the start date.";
      if (Object.keys(validation).length) {
        setFormErrors(validation);
        const [firstFieldName] = Object.keys(validation);
        const firstField = firstFieldName
          ? event.currentTarget.elements.namedItem(firstFieldName)
          : null;
        if (firstField instanceof HTMLElement) firstField.focus();
        return;
      }
    }
    if (editor.kind === "phase") {
      const validation: Record<string, string> = {};
      const phaseOrder = Number(form.get("phaseOrder") ?? 0);
      const plannedBudget = optionalNumber(form, "plannedBudget");
      const progressPercent = optionalNumber(form, "progressPercent") ?? 0;
      const startDate = optional(form, "startDate");
      const targetEndDate = optional(form, "targetEndDate");
      if (!String(form.get("name") ?? "").trim())
        validation.name = fr
          ? "Le nom de la phase est obligatoire."
          : "Phase name is required.";
      if (!Number.isInteger(phaseOrder) || phaseOrder < 1)
        validation.phaseOrder = fr
          ? "L’ordre de phase doit être un nombre entier supérieur ou égal à 1."
          : "Phase order must be a whole number of 1 or higher.";
      if (!String(form.get("status") ?? "").trim())
        validation.status = fr
          ? "Sélectionnez le statut de la phase."
          : "Choose the phase status.";
      if (!String(form.get("priority") ?? "").trim())
        validation.priority = fr
          ? "Sélectionnez la priorité de la phase."
          : "Choose the phase priority.";
      if (plannedBudget !== undefined && plannedBudget < 0)
        validation.plannedBudget = fr
          ? "Le budget prévu doit être égal ou supérieur à zéro."
          : "Planned budget must be zero or higher.";
      if (progressPercent < 0 || progressPercent > 100)
        validation.progressPercent = fr
          ? "L’avancement doit être compris entre 0 et 100 %."
          : "Progress must be between 0 and 100%.";
      if (startDate && targetEndDate && targetEndDate < startDate)
        validation.targetEndDate = fr
          ? "La fin prévue ne peut pas être antérieure à la date de début."
          : "Target completion cannot be before the start date.";
      if (Object.keys(validation).length) {
        setFormErrors(validation);
        const [firstFieldName] = Object.keys(validation);
        const firstField = firstFieldName
          ? event.currentTarget.elements.namedItem(firstFieldName)
          : null;
        if (firstField instanceof HTMLElement) firstField.focus();
        return;
      }
    }
    if (editor.kind === "task") {
      const validation: Record<string, string> = {};
      const taskProjectId = body.projectId;
      const taskPhaseId = body.phaseId;
      const assignedMemberId = body.assignedMemberId;
      const startDate = body.startDate;
      const dueDate = body.dueDate;
      const progress = Number(body.progressPercent);
      const estimatedCost = body.estimatedCost;
      const taskType = String(body.taskType);
      const status = String(body.status);
      const priority = String(body.priority);

      if (!isUuid(taskProjectId))
        validation._form = fr
          ? "Choisissez d’abord un projet valide avant de créer une tâche."
          : "Choose a valid project before creating a task.";
      if (!String(body.title ?? "").trim())
        validation.title = fr
          ? "Le titre de la tâche est obligatoire."
          : "Task title is required.";
      if (!["work", "milestone"].includes(taskType))
        validation.taskType = fr
          ? "Choisissez Travail ou Jalon."
          : "Choose Work or Milestone.";
      if (taskPhaseId !== null && !isUuid(taskPhaseId))
        validation.phaseId = fr
          ? "La phase sélectionnée n’est pas valide."
          : "The selected project phase is invalid.";
      if (assignedMemberId !== null && !isUuid(assignedMemberId))
        validation.assignedMemberId = fr
          ? "L’employé sélectionné n’est pas valide."
          : "The selected employee is invalid.";
      if (startDate !== null && !isIsoDate(startDate))
        validation.startDate = fr
          ? "La date de début doit être au format AAAA-MM-JJ."
          : "Start date must use YYYY-MM-DD.";
      if (dueDate !== null && !isIsoDate(dueDate))
        validation.dueDate = fr
          ? "L’échéance doit être au format AAAA-MM-JJ."
          : "Due date must use YYYY-MM-DD.";
      if (
        startDate !== null &&
        dueDate !== null &&
        isIsoDate(startDate) &&
        isIsoDate(dueDate) &&
        String(dueDate) < String(startDate)
      )
        validation.dueDate = fr
          ? "L’échéance ne peut pas être antérieure à la date de début."
          : "Due date cannot be before the start date.";
      if (
        ![
          "not_started",
          "in_progress",
          "blocked",
          "waiting_approval",
          "completed",
          "cancelled",
        ].includes(status)
      )
        validation.status = fr
          ? "Choisissez un statut valide."
          : "Choose a valid task status.";
      if (!["low", "medium", "high", "critical"].includes(priority))
        validation.priority = fr
          ? "Choisissez une priorité valide."
          : "Choose a valid priority.";
      if (!Number.isFinite(progress) || progress < 0 || progress > 100)
        validation.progressPercent = fr
          ? "L’avancement doit être un nombre entre 0 et 100 %."
          : "Progress must be a number between 0 and 100%.";
      if (
        estimatedCost !== null &&
        (!Number.isFinite(Number(estimatedCost)) || Number(estimatedCost) < 0)
      )
        validation.estimatedCost = fr
          ? "Le coût estimé doit être un nombre positif ou zéro."
          : "Estimated cost must be a positive number or zero.";
      if (taskType === "milestone" && estimatedCost !== null)
        validation.estimatedCost = fr
          ? "Un jalon ne peut pas avoir de coût estimé."
          : "A milestone cannot have an estimated cost.";
      if (Object.keys(validation).length) {
        setFormErrors(validation);
        const firstFieldName = Object.keys(validation).find(
          (field) => field !== "_form",
        );
        const firstField = firstFieldName
          ? event.currentTarget.elements.namedItem(firstFieldName)
          : null;
        if (firstField instanceof HTMLElement) firstField.focus();
        return;
      }
    }
    if (editor.kind === "operational-link") {
      const validation: Record<string, string> = {};
      if (!String(form.get("recordId") ?? "").trim())
        validation.recordId = fr
          ? "Sélectionnez un enregistrement opérationnel."
          : "Select an operational record.";
      if (!String(form.get("linkType") ?? "").trim())
        validation.linkType = fr
          ? "Sélectionnez la relation avec le projet."
          : "Select the project relationship.";
      if (Object.keys(validation).length) {
        setFormErrors(validation);
        const [firstFieldName] = Object.keys(validation);
        const firstField = firstFieldName
          ? event.currentTarget.elements.namedItem(firstFieldName)
          : null;
        if (firstField instanceof HTMLElement) firstField.focus();
        return;
      }
    }
    setFormErrors({});
    const managesTaskDocuments =
      editor.kind === "task" && form.get("manageTaskDocuments") === "true";
    const taskDocuments = managesTaskDocuments
      ? {
          documentIds: form
            .getAll("documentIds")
            .map((value) => String(value).trim())
            .filter(Boolean),
        }
      : undefined;
    void onSave(resource, body, taskDocuments).catch((error: unknown) => {
      if (process.env.NODE_ENV !== "production")
        console.warn("Project task save rejected", {
          resource,
          error,
          details: error instanceof ApiError ? error.details : undefined,
        });
      const apiErrors = error instanceof ApiError ? error.fieldErrors : {};
      const nextErrors = Object.fromEntries(
        Object.entries(apiErrors).map(([field, messages]) => [
          field,
          messages[0] ?? "",
        ]),
      );
      if (!Object.keys(nextErrors).length)
        nextErrors._form =
          error instanceof ApiError
            ? error.message
            : fr
              ? "Cette modification n’a pas pu être enregistrée."
              : "This change could not be saved.";
      setFormErrors(nextErrors);
      const firstFieldName = Object.keys(nextErrors).find(
        (field) => field !== "_form",
      );
      const firstField = firstFieldName
        ? event.currentTarget.elements.namedItem(firstFieldName)
        : null;
      if (firstField instanceof HTMLElement) firstField.focus();
    });
  }
  const heading: Record<EditorKind, string> = {
    project: label(fr, "Project", "Projet"),
    phase: label(fr, "Project phase", "Phase du projet"),
    "phase-dependency": label(fr, "Phase dependency", "Dépendance de phase"),
    task: label(fr, "Project task", "Tâche du projet"),
    "task-dependency": label(fr, "Task dependency", "Dépendance de tâche"),
    member: label(fr, "Project person", "Personne du projet"),
    "operational-link": label(
      fr,
      "Operational resource link",
      "Lien operationnel",
    ),
    budget: label(fr, "Budget line", "Ligne budgétaire"),
    material: label(fr, "Project material", "Matériau du projet"),
    movement: label(fr, "Material movement", "Mouvement de matériau"),
    request: label(fr, "Purchase request", "Demande d’achat"),
    "request-line": label(fr, "Purchase request item", "Article de la demande"),
    order: label(fr, "Purchase order", "Bon de commande"),
    "order-line": label(fr, "Purchase order item", "Article de la commande"),
    receipt: label(fr, "Receiving", "Réception"),
    "receipt-line": label(fr, "Received item", "Article réceptionné"),
    expense: label(fr, "Expense", "Dépense"),
    asset: label(fr, "Asset", "Actif"),
    "asset-assignment": label(fr, "Asset assignment", "Affectation d’actif"),
    "asset-movement": label(fr, "Asset movement", "Mouvement d’actif"),
    "asset-usage": label(fr, "Machine use", "Utilisation de machine"),
    "vehicle-profile": label(fr, "Vehicle profile", "Fiche véhicule"),
    "vehicle-trip": label(fr, "Vehicle trip", "Trajet véhicule"),
    "maintenance-plan": label(fr, "Maintenance plan", "Plan de maintenance"),
    "work-order": label(
      fr,
      "Maintenance work order",
      "Intervention de maintenance",
    ),
    "maintenance-part": label(fr, "Maintenance part", "Pièce de maintenance"),
  };
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/45 p-4 backdrop-blur-sm">
      <div className="mx-auto my-8 max-w-3xl rounded-2xl border border-border bg-surface-1 shadow-2xl">
        <div className="flex items-start justify-between border-b border-border p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">
              {editing
                ? label(fr, "Edit", "Modifier")
                : label(fr, "Create", "Créer")}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-ink">
              {heading[editor.kind]}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label={label(fr, "Close", "Fermer")}
          >
            <X />
          </Button>
        </div>
        <form
          className="grid gap-4 p-5 md:grid-cols-2"
          onSubmit={submit}
          noValidate={editor.kind === "project" || editor.kind === "task"}
        >
          {formErrors._form ? (
            <p
              className="md:col-span-2 rounded-lg border border-critical/35 bg-critical/10 px-3 py-2 text-sm text-critical"
              role="alert"
            >
              {formErrors._form}
            </p>
          ) : null}
          <EditorFormErrorsContext.Provider value={formErrors}>
            <EditorFields
              kind={editor.kind}
              orgSlug={orgSlug}
              getValue={getValue}
              fr={fr}
              project={project}
              phases={phases}
              tasks={tasks}
              documents={documents}
              materials={materials}
              assets={assets}
              requests={requests}
              requestLines={requestLines}
              orders={orders}
              orderLines={orderLines}
              receipts={receipts}
              workOrders={workOrders}
              vehicleProfiles={vehicleProfiles}
              maintenancePlans={maintenancePlans}
              suppliers={suppliers}
              warehouses={warehouses}
              inventoryItems={inventoryItems}
              sites={sites}
              provinces={provinces}
              members={members}
              isOwner={isOwner}
            />
          </EditorFormErrorsContext.Provider>
          <div className="flex justify-end gap-2 border-t border-border pt-4 md:col-span-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {label(fr, "Cancel", "Annuler")}
            </Button>
            <Button type="submit" loading={working}>
              {editing
                ? label(fr, "Save changes", "Enregistrer les modifications")
                : label(fr, "Create", "Créer")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditorFields({
  kind,
  orgSlug,
  getValue,
  fr,
  project,
  phases,
  tasks,
  documents,
  materials,
  assets,
  requests,
  requestLines,
  orders,
  orderLines,
  receipts,
  workOrders,
  vehicleProfiles,
  maintenancePlans,
  suppliers,
  warehouses,
  inventoryItems,
  sites,
  provinces,
  members,
  isOwner,
}: {
  kind: EditorKind;
  orgSlug: string;
  getValue: (key: string) => string;
  fr: boolean;
  project: Project | null;
  phases: Row[];
  tasks: Row[];
  documents: Row[];
  materials: Row[];
  assets: Row[];
  requests: Row[];
  requestLines: Row[];
  orders: Row[];
  orderLines: Row[];
  receipts: Row[];
  workOrders: Row[];
  vehicleProfiles: Row[];
  maintenancePlans: Row[];
  suppliers: Row[];
  warehouses: Row[];
  inventoryItems: Row[];
  sites: Place[];
  provinces: Place[];
  members: Array<{ id: string; name: string }>;
  isOwner: boolean;
}) {
  const fieldErrors = useContext(EditorFormErrorsContext);
  const fieldError = (name: string) => fieldErrors[name];
  const [taskStatus, setTaskStatus] = useState(
    getValue("status") || "not_started",
  );
  const [taskType, setTaskType] = useState(getValue("taskType") || "work");
  const [taskProgress, setTaskProgress] = useState(
    getValue("progressPercent") || "0",
  );
  const currentUser = useSessionUser();
  const existingOperationalTarget = `${getValue("moduleCode")}:${getValue("resourceCode")}`;
  const [operationalTargetKind, setOperationalTargetKind] =
    useState<OperationalTargetKind>(() =>
      isOperationalTargetKind(existingOperationalTarget)
        ? existingOperationalTarget
        : "poultry:flocks",
    );
  const [operationalSearch, setOperationalSearch] = useState("");
  const operationalTarget = OPERATIONAL_TARGETS[operationalTargetKind];
  const canReadOperationalTarget = can(
    currentUser,
    operationalTarget.permission,
  );
  const operationalRecords = useQuery({
    queryKey: [
      "project-operational-records",
      orgSlug,
      operationalTargetKind,
      project?.siteId ?? "",
      project?.provinceId ?? "",
    ],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (project?.siteId) params.siteId = String(project.siteId);
      if (operationalTargetKind === "poultry:flocks" && project?.provinceId)
        params.provinceId = String(project.provinceId);
      return get<{ records: Row[] }>(orgUrl(orgSlug, operationalTarget.path), {
        params,
      });
    },
    enabled:
      kind === "operational-link" &&
      Boolean(project?.id) &&
      canReadOperationalTarget,
  });
  const scopedOperationalRecords = (
    operationalRecords.data?.records ?? []
  ).filter((record) => {
    if (project?.siteId)
      return String(record.siteId) === String(project.siteId);
    return (
      !project?.provinceId ||
      String(record.provinceId) === String(project.provinceId)
    );
  });
  // Operational APIs can contain legacy records. Do not turn an ID into a label:
  // an unlabeled record must never become a blank selectable option.
  const operationalOptions = scopedOperationalRecords.flatMap((record) => {
    const value = String(record.id ?? "").trim();
    const text = operationalRecordLabel(
      operationalTargetKind,
      record,
      fr,
    ).trim();
    return value && text ? [{ value, text }] : [];
  });
  const matchingOperationalOptions = operationalOptions.filter((option) =>
    option.text
      .toLocaleLowerCase()
      .includes(operationalSearch.trim().toLocaleLowerCase()),
  );
  const taskId = getValue("id");
  const [taskDocumentSearch, setTaskDocumentSearch] = useState("");
  const [taskDocumentFolder, setTaskDocumentFolder] = useState("__all__");
  const [selectedTaskDocumentIds, setSelectedTaskDocumentIds] = useState<
    string[]
  >([]);
  const [selectionTaskKey, setSelectionTaskKey] = useState<string | null>(null);
  const canReadTaskDocuments = can(currentUser, "documents.read");
  const taskDocuments = useQuery({
    queryKey: ["task-documents", orgSlug, taskId],
    queryFn: () =>
      ownerManagementApi.taskDocuments<{ documents: Row[] }>(orgSlug, taskId),
    enabled:
      kind === "task" && Boolean(taskId) && can(currentUser, "tasks.read"),
    select: (data) => data.documents,
  });
  const linkedTaskDocumentIds = new Set(
    (taskDocuments.data ?? []).map((document) => String(document.id)),
  );
  const projectDocuments = Array.from(
    new Map(
      [...documents, ...(taskDocuments.data ?? [])].map((document) => [
        String(document.id),
        document,
      ]),
    ).values(),
  ).filter(
    (document) =>
      !project?.id || String(document.projectId) === String(project.id),
  );
  const documentFolder = (document: Row) => {
    const categoryId = String(document.documentCategoryId ?? "").trim();
    const categoryCode = String(
      document.documentCategoryCode ?? document.documentType ?? "other",
    )
      .trim()
      .toLowerCase();
    const categoryName = String(document.documentCategoryName ?? "").trim();
    if (categoryId)
      return {
        value: categoryId,
        text: categoryName || titleCase(categoryCode || "other"),
      };
    return {
      value: `legacy:${categoryCode || "uncategorised"}`,
      text:
        categoryName ||
        (categoryCode
          ? titleCase(categoryCode)
          : label(fr, "Uncategorised", "Non classé")),
    };
  };
  const taskDocumentFolders = Array.from(
    new Map(
      projectDocuments.map((document) => {
        const folder = documentFolder(document);
        return [folder.value, folder] as const;
      }),
    ).values(),
  ).sort((left, right) =>
    left.text.localeCompare(right.text, fr ? "fr" : "en"),
  );
  const matchingTaskDocuments = projectDocuments.filter((document) => {
    const folder = documentFolder(document);
    const matchesFolder =
      taskDocumentFolder === "__all__" || folder.value === taskDocumentFolder;
    const matchesSearch = [
      document.title,
      document.documentType,
      document.mimeType,
      folder.text,
    ]
      .map((value) => String(value ?? "").toLocaleLowerCase())
      .join(" ")
      .includes(taskDocumentSearch.trim().toLocaleLowerCase());
    return matchesFolder && matchesSearch;
  });
  useEffect(() => {
    if (kind !== "task") return;
    const currentKey = taskId || "new-task";
    if (selectionTaskKey === currentKey) return;
    if (taskId && taskDocuments.data === undefined) return;
    setSelectedTaskDocumentIds(
      taskId
        ? (taskDocuments.data ?? []).map((document) => String(document.id))
        : [],
    );
    setSelectionTaskKey(currentKey);
  }, [kind, selectionTaskKey, taskDocuments.data, taskId]);
  const suggestedPhaseOrder =
    getValue("phaseOrder") ||
    String(Math.max(0, ...phases.map((phase) => number(phase.phaseOrder))) + 1);
  const input = (
    name: string,
    title: string,
    required = false,
    type = "text",
  ) => (
    <Field
      label={title}
      htmlFor={name}
      required={required}
      error={fieldError(name)}
    >
      <Input
        id={name}
        name={name}
        required={required}
        invalid={Boolean(fieldError(name))}
        type={type}
        defaultValue={
          type === "date"
            ? dateValue(getValue(name)) ||
              (name === "assignmentStartDate"
                ? new Date().toISOString().slice(0, 10)
                : "")
            : getValue(name)
        }
      />
    </Field>
  );
  const defaultSelect = (name: string) => {
    const status =
      kind === "project"
        ? "planning"
        : kind === "phase" || kind === "task"
          ? "not_started"
          : kind === "request" ||
              kind === "order" ||
              kind === "receipt" ||
              kind === "expense"
            ? "draft"
            : kind === "asset"
              ? "available"
              : kind === "work-order"
                ? "reported"
                : "";
    const defaults: Record<string, string> = {
      projectType: "other",
      priority: "medium",
      taskType: "work",
      currencyCode: project?.currencyCode ?? "CDF",
      approvalStatus: "not_requested",
      itemKind: "material",
      movementType: "used",
      condition: "good",
      maintenanceType: "preventive",
      status,
    };
    return getValue(name) || defaults[name] || "";
  };
  const select = (
    name: string,
    title: string,
    options: SelectOption[],
    required = false,
    noRecordsLabel?: string,
  ) => {
    // Protect all forms, including future ones, even if a caller forgets to
    // normalize its API rows before passing them to this shared control.
    const visibleOptions = options.filter(
      (option) =>
        String(option.value ?? "").trim() && String(option.text ?? "").trim(),
    );
    const emptyLabel =
      noRecordsLabel ??
      label(
        fr,
        `No ${title.toLocaleLowerCase()} available`,
        `Aucun ${title.toLocaleLowerCase()} disponible`,
      );
    return (
      <Field
        label={title}
        htmlFor={name}
        required={required}
        error={fieldError(name)}
      >
        <select
          id={name}
          name={name}
          required={required}
          aria-invalid={Boolean(fieldError(name))}
          defaultValue={defaultSelect(name)}
          className={`h-9 w-full rounded-md border bg-surface-1 px-3 text-sm text-ink ${fieldError(name) ? "border-critical" : "border-border-strong"}`}
        >
          <option value="" disabled={visibleOptions.length === 0}>
            {visibleOptions.length
              ? required
                ? label(fr, "Select", "Sélectionner")
                : "—"
              : emptyLabel}
          </option>
          {visibleOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.text}
            </option>
          ))}
        </select>
        {!visibleOptions.length ? (
          <p className="mt-1 text-xs text-ink-muted">
            {label(
              fr,
              "Create the record in its workspace area, then reopen this selector.",
              "Créez l’enregistrement dans son espace, puis rouvrez cette liste.",
            )}
          </p>
        ) : null}
      </Field>
    );
  };
  const currency = () =>
    select(
      "currencyCode",
      label(fr, "Currency", "Devise"),
      [
        {
          value: "CDF",
          text: fr ? "CDF — Franc congolais" : "CDF — Congolese franc",
        },
        {
          value: "USD",
          text: fr ? "USD — Dollar américain" : "USD — US dollar",
        },
        { value: "EUR", text: "EUR — Euro" },
      ],
      true,
    );
  const phaseOptions = relationalOptions(phases, ["name", "code"]);
  const taskOptions = relationalOptions(
    tasks.filter((row) => row.taskType !== "milestone"),
    ["title", "taskCode", "code"],
  );
  const dependencyTaskOptions = relationalOptions(tasks, [
    "title",
    "taskCode",
    "code",
  ]);
  const phaseSelect = () => (
    <Field
      label={label(fr, "Project phase", "Phase du projet")}
      htmlFor="phaseId"
      hint={
        phaseOptions.length
          ? label(
              fr,
              "Optional: allocate this record to one project phase.",
              "Facultatif : rattachez cet enregistrement à une phase du projet.",
            )
          : label(
              fr,
              "No phase has been created yet. You can save this at project level, or add a phase from Planning.",
              "Aucune phase n’a encore été créée. Vous pouvez enregistrer au niveau du projet ou ajouter une phase dans Planification.",
            )
      }
      error={fieldError("phaseId")}
    >
      <select
        id="phaseId"
        name="phaseId"
        defaultValue={defaultSelect("phaseId")}
        aria-invalid={Boolean(fieldError("phaseId"))}
        className={`h-9 w-full rounded-md border bg-surface-1 px-3 text-sm text-ink ${fieldError("phaseId") ? "border-critical" : "border-border-strong"}`}
      >
        <option value="" disabled={phaseOptions.length === 0}>
          {phaseOptions.length
            ? "—"
            : label(fr, "No project phase yet", "Aucune phase du projet")}
        </option>
        {phaseOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.text}
          </option>
        ))}
      </select>
    </Field>
  );
  const memberOptions = relationalOptions(members, ["name"]);
  const assetOptions = relationalOptions(assets, [
    "name",
    "assetNumber",
    "code",
  ]);
  const supplierOptions = relationalOptions(suppliers, [
    "name",
    "companyName",
    "code",
  ]);
  const warehouseOptions = relationalOptions(
    warehouses.filter((warehouse) => {
      if (project?.siteId)
        return String(warehouse.siteId) === String(project.siteId);
      if (!project?.provinceId) return true;
      const warehouseSite = sites.find(
        (site) => String(site.id) === String(warehouse.siteId),
      );
      return (
        String(warehouseSite?.province?.id ?? "") === String(project.provinceId)
      );
    }),
    ["name", "code"],
  );
  const inventoryOptions = relationalOptions(inventoryItems, [
    "name",
    "sku",
    "code",
  ]);
  const requestOptions = relationalOptions(requests, ["requestNumber"]);
  const requestLineOptions = relationalOptions(requestLines, ["description"]);
  const orderOptions = relationalOptions(orders, ["orderNumber"]);
  const orderLineOptions = relationalOptions(orderLines, ["description"]);
  const receiptOptions = relationalOptions(receipts, ["receiptNumber"]);
  const workOrderOptions = relationalOptions(workOrders, [
    "workOrderNumber",
    "title",
  ]);
  const vehicleOptions = relationalOptions(vehicleProfiles, [
    "vehicleNumber",
    "plateNumber",
  ]);
  const maintenancePlanOptions = relationalOptions(maintenancePlans, ["name"]);
  const siteOptions = relationalOptions(sites, ["name", "code"]);
  const provinceOptions = relationalOptions(provinces, ["name", "code"]);
  const materialOptions = relationalOptions(materials, ["name", "code"]);
  const common = (
    <>
      {phaseSelect()}
      {select("siteId", label(fr, "Site / farm", "Site / ferme"), siteOptions)}
      <Field
        label={label(fr, "Notes", "Notes")}
        htmlFor="notes"
        className="md:col-span-2"
      >
        <Textarea
          id="notes"
          name="notes"
          defaultValue={getValue("notes")}
          maxLength={8000}
        />
      </Field>
    </>
  );
  if (kind === "project")
    return (
      <>
        <Field
          label={label(fr, "Project name", "Nom du projet")}
          htmlFor="name"
          required
          error={fieldError("name")}
          className="md:col-span-2"
        >
          <Input
            id="name"
            name="name"
            required
            invalid={Boolean(fieldError("name"))}
            defaultValue={getValue("name")}
          />
        </Field>
        <Field label={label(fr, "Project code", "Code projet")} htmlFor="code">
          <Input
            id="code"
            name="code"
            defaultValue={getValue("code")}
            placeholder={label(
              fr,
              "Optional — e.g. kongo_farm_2026",
              "Facultatif — ex. ferme_kongo_2026",
            )}
          />
          <p className="mt-1 text-xs text-ink-muted">
            {label(
              fr,
              "Spaces, capitals and dashes are converted automatically.",
              "Les espaces, majuscules et tirets sont convertis automatiquement.",
            )}
          </p>
        </Field>
        {select(
          "projectType",
          label(fr, "Project type", "Type de projet"),
          [
            "land",
            "construction",
            "expansion",
            "infrastructure",
            "equipment",
            "livestock",
            "housing",
            "technology",
            "maintenance",
            "mixed_investment",
            "other",
          ].map((value) => ({ value, text: titleCase(value) })),
          true,
        )}
        {select(
          "provinceId",
          label(fr, "Province", "Province"),
          provinceOptions,
          true,
        )}
        {select(
          "siteId",
          label(fr, "Site / farm", "Site / ferme"),
          siteOptions,
        )}
        {select(
          "responsibleMemberId",
          label(fr, "Responsible manager", "Manager responsable"),
          memberOptions,
        )}
        {input(
          "startDate",
          label(fr, "Start date", "Date de début"),
          false,
          "date",
        )}
        {input(
          "targetCompletionDate",
          label(fr, "Original target completion", "Fin prévue initiale"),
          false,
          "date",
        )}
        {input(
          "revisedCompletionDate",
          label(fr, "Revised completion", "Fin prévue révisée"),
          false,
          "date",
        )}
        {select(
          "status",
          label(fr, "Status", "Statut"),
          [
            "draft",
            "planning",
            "pending_approval",
            "approved",
            "in_progress",
            "on_hold",
            "completed",
            "cancelled",
          ].map((value) => ({ value, text: titleCase(value) })),
          true,
        )}
        {select(
          "priority",
          label(fr, "Priority", "Priorité"),
          ["low", "medium", "high", "critical"].map((value) => ({
            value,
            text: titleCase(value),
          })),
          true,
        )}
        {input(
          "estimatedTotalBudget",
          label(fr, "Estimated total budget", "Budget total estimé"),
          false,
          "number",
        )}
        {currency()}
        {input(
          "fundingSource",
          label(fr, "Funding source", "Source de financement"),
        )}
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
          <input
            type="checkbox"
            name="approvalRequired"
            defaultChecked={getValue("approvalRequired") === "true"}
          />
          {label(
            fr,
            "Approval required before execution",
            "Approbation requise avant exécution",
          )}
        </label>
        <Field
          label={label(fr, "Expected outcome", "Résultat attendu")}
          htmlFor="expectedOutcome"
          className="md:col-span-2"
        >
          <Textarea
            id="expectedOutcome"
            name="expectedOutcome"
            defaultValue={getValue("expectedOutcome")}
          />
        </Field>
        <Field
          label={label(fr, "Description", "Description")}
          htmlFor="description"
          className="md:col-span-2"
          error={fieldError("description")}
        >
          <Textarea
            id="description"
            name="description"
            aria-invalid={Boolean(fieldError("description"))}
            defaultValue={getValue("description")}
          />
        </Field>
        <Field
          label={label(fr, "Blueprint", "Plan directeur")}
          htmlFor="blueprint"
          className="md:col-span-2"
        >
          <Textarea
            id="blueprint"
            name="blueprint"
            defaultValue={getValue("blueprint")}
            rows={7}
          />
        </Field>
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "phase")
    return (
      <>
        {input("name", label(fr, "Phase name", "Nom de la phase"), true)}
        {input("code", label(fr, "Phase code", "Code phase"))}
        {
          <Field
            label={label(fr, "Phase order", "Ordre de phase")}
            htmlFor="phaseOrder"
            required
            error={fieldError("phaseOrder")}
          >
            <Input
              id="phaseOrder"
              name="phaseOrder"
              type="number"
              min={1}
              step={1}
              required
              invalid={Boolean(fieldError("phaseOrder"))}
              defaultValue={suggestedPhaseOrder}
            />
          </Field>
        }
        {select(
          "responsibleMemberId",
          label(fr, "Responsible", "Responsable"),
          memberOptions,
        )}
        {input(
          "startDate",
          label(fr, "Planned start", "Début prévu"),
          false,
          "date",
        )}
        {input(
          "actualStartDate",
          label(fr, "Actual start", "Début réel"),
          false,
          "date",
        )}
        {input(
          "targetEndDate",
          label(fr, "Planned finish", "Fin prévue"),
          false,
          "date",
        )}
        {input(
          "completedDate",
          label(fr, "Actual finish", "Fin réelle"),
          false,
          "date",
        )}
        {select(
          "status",
          label(fr, "Status", "Statut"),
          [
            "not_started",
            "in_progress",
            "blocked",
            "waiting_approval",
            "completed",
            "cancelled",
          ].map((value) => ({ value, text: titleCase(value) })),
          true,
        )}
        {select(
          "priority",
          label(fr, "Priority", "Priorité"),
          ["low", "medium", "high", "critical"].map((value) => ({
            value,
            text: titleCase(value),
          })),
          true,
        )}
        {input(
          "plannedBudget",
          label(fr, "Planned budget", "Budget prévu"),
          false,
          "number",
        )}
        {input(
          "progressPercent",
          label(fr, "Progress (%)", "Avancement (%)"),
          false,
          "number",
        )}
        <Field
          label={label(fr, "Description", "Description")}
          htmlFor="description"
          className="md:col-span-2"
          error={fieldError("description")}
        >
          <Textarea
            id="description"
            name="description"
            aria-invalid={Boolean(fieldError("description"))}
            defaultValue={getValue("description")}
          />
        </Field>
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "phase-dependency")
    return (
      <>
        {select(
          "phaseId",
          label(fr, "Phase that waits", "Phase qui attend"),
          phaseOptions,
          true,
        )}
        {select(
          "dependsOnPhaseId",
          label(fr, "Required prior phase", "Phase préalable requise"),
          phaseOptions,
          true,
        )}
        {select(
          "dependencyType",
          label(fr, "Dependency type", "Type de dépendance"),
          [
            {
              value: "finish_to_start",
              text: label(fr, "Finish before start", "Fin avant début"),
            },
            {
              value: "finish_to_finish",
              text: label(fr, "Finish before finish", "Fin avant fin"),
            },
          ],
          true,
        )}
        <p className="md:col-span-2 text-xs leading-5 text-ink-secondary">
          {label(
            fr,
            "The waiting phase cannot begin or finish until its prerequisite is completed.",
            "La phase en attente ne peut pas commencer ni se terminer avant la fin de sa phase préalable.",
          )}
        </p>
      </>
    );
  if (kind === "task-dependency")
    return (
      <>
        {select(
          "taskId",
          label(
            fr,
            "Work or milestone that waits",
            "Travail ou jalon en attente",
          ),
          dependencyTaskOptions,
          true,
        )}
        {select(
          "dependsOnTaskId",
          label(
            fr,
            "Required prior work or milestone",
            "Travail ou jalon préalable requis",
          ),
          dependencyTaskOptions,
          true,
        )}
        {select(
          "dependencyType",
          label(fr, "Dependency type", "Type de dépendance"),
          [
            {
              value: "finish_to_start",
              text: label(fr, "Finish before start", "Fin avant début"),
            },
            {
              value: "finish_to_finish",
              text: label(fr, "Finish before finish", "Fin avant fin"),
            },
          ],
          true,
        )}
        <p className="md:col-span-2 text-xs leading-5 text-ink-secondary">
          {label(
            fr,
            "The waiting task cannot begin or finish until its prerequisite is completed.",
            "La tâche en attente ne peut pas commencer ni se terminer avant la fin de sa tâche préalable.",
          )}
        </p>
      </>
    );
  if (kind === "task")
    return (
      <>
        <Field
          label={label(fr, "Type", "Type")}
          htmlFor="taskType"
          required
          error={fieldError("taskType")}
        >
          <select
            id="taskType"
            name="taskType"
            required
            value={taskType}
            aria-invalid={Boolean(fieldError("taskType"))}
            onChange={(event) => setTaskType(event.target.value)}
            className={`h-9 w-full rounded-md border bg-surface-1 px-3 text-sm text-ink ${fieldError("taskType") ? "border-critical" : "border-border-strong"}`}
          >
            <option value="work">{label(fr, "Work", "Travail")}</option>
            <option value="milestone">{label(fr, "Milestone", "Jalon")}</option>
          </select>
        </Field>
        <Field
          label={
            taskType === "milestone"
              ? label(fr, "Milestone", "Jalon")
              : label(fr, "Work", "Travail")
          }
          htmlFor="title"
          required
          className="md:col-span-2"
          error={fieldError("title")}
        >
          <Input
            id="title"
            name="title"
            required
            invalid={Boolean(fieldError("title"))}
            defaultValue={getValue("title")}
          />
        </Field>
        {input("code", label(fr, "Task code", "Code tâche"))}
        {phaseSelect()}
        {select(
          "assignedMemberId",
          taskType === "milestone"
            ? label(fr, "Responsible person", "Responsable")
            : label(fr, "Assigned employee", "Employé affecté"),
          memberOptions,
        )}
        {input(
          "startDate",
          label(fr, "Start date", "Date de début"),
          false,
          "date",
        )}
        {input("dueDate", label(fr, "Due date", "Échéance"), false, "date")}
        <Field
          label={label(fr, "Status", "Statut")}
          htmlFor="status"
          required
          error={fieldError("status")}
        >
          <select
            id="status"
            name="status"
            required
            value={taskStatus}
            aria-invalid={Boolean(fieldError("status"))}
            onChange={(event) => setTaskStatus(event.target.value)}
            className={`h-9 w-full rounded-md border bg-surface-1 px-3 text-sm text-ink ${fieldError("status") ? "border-critical" : "border-border-strong"}`}
          >
            {[
              "not_started",
              "in_progress",
              "blocked",
              "waiting_approval",
              "completed",
              "cancelled",
            ].map((value) => (
              <option key={value} value={value}>
                {titleCase(value)}
              </option>
            ))}
          </select>
        </Field>
        {select(
          "priority",
          label(fr, "Priority", "Priorité"),
          ["low", "medium", "high", "critical"].map((value) => ({
            value,
            text: titleCase(value),
          })),
          true,
        )}
        <Field
          label={label(fr, "Progress (%)", "Avancement (%)")}
          htmlFor="progressPercent"
          error={fieldError("progressPercent")}
          hint={
            taskStatus === "not_started"
              ? label(
                  fr,
                  "Automatically set to 0% while the task has not started.",
                  "Automatiquement fixé à 0 % tant que la tâche n’a pas commencé.",
                )
              : taskStatus === "completed"
                ? label(
                    fr,
                    "Automatically set to 100% when the task is completed.",
                    "Automatiquement fixé à 100 % lorsque la tâche est terminée.",
                  )
                : label(
                    fr,
                    "Enter progress while the task is in progress.",
                    "Saisissez l’avancement lorsque la tâche est en cours.",
                  )
          }
        >
          <Input
            id="progressPercent"
            name="progressPercent"
            type="number"
            min={0}
            max={100}
            step="0.01"
            invalid={Boolean(fieldError("progressPercent"))}
            readOnly={
              taskStatus === "not_started" || taskStatus === "completed"
            }
            value={
              taskStatus === "not_started"
                ? "0"
                : taskStatus === "completed"
                  ? "100"
                  : taskProgress
            }
            onChange={(event) => setTaskProgress(event.target.value)}
          />
        </Field>
        {taskType === "work" ? (
          <>
            {input(
              "estimatedCost",
              label(fr, "Estimated cost", "Coût estimé"),
              false,
              "number",
            )}
            <p className="self-end pb-2 text-xs leading-5 text-ink-secondary">
              {label(
                fr,
                "Actual cost is calculated automatically from approved or paid work expenses and received purchases. It cannot be typed here.",
                "Le coût réel est calculé automatiquement depuis les dépenses de travail approuvées/payées et les achats réceptionnés. Il ne se saisit pas ici.",
              )}
            </p>
          </>
        ) : (
          <p className="self-end pb-2 text-xs leading-5 text-ink-secondary">
            {label(
              fr,
              "A milestone is a checkpoint. It is not assigned as Daily Work and cannot receive purchase or expense costs.",
              "Un jalon est un point de contrôle. Il n’est pas affecté comme travail quotidien et ne reçoit pas de coûts d’achat ou de dépense.",
            )}
          </p>
        )}
        <Field
          label={label(fr, "Blocked by / reason", "Blocage / raison")}
          htmlFor="blockedReason"
          className="md:col-span-2"
          error={fieldError("blockedReason")}
        >
          <Textarea
            id="blockedReason"
            name="blockedReason"
            aria-invalid={Boolean(fieldError("blockedReason"))}
            defaultValue={getValue("blockedReason")}
          />
        </Field>
        <Field
          label={label(fr, "Description", "Description")}
          htmlFor="description"
          className="md:col-span-2"
          error={fieldError("description")}
        >
          <Textarea
            id="description"
            name="description"
            aria-invalid={Boolean(fieldError("description"))}
            defaultValue={getValue("description")}
          />
        </Field>
        {canReadTaskDocuments ? (
          <section className="space-y-3 rounded-xl border border-border bg-surface-2 p-4 md:col-span-2">
            <input type="hidden" name="manageTaskDocuments" value="true" />
            <div>
              <h3 className="text-sm font-semibold text-ink">
                {label(
                  fr,
                  "Documents / attachments",
                  "Documents / pièces jointes",
                )}
              </h3>
              <p className="mt-1 text-xs leading-5 text-ink-secondary">
                {label(
                  fr,
                  "Select existing project documents. Unchecking a document removes only this task link; the original project file remains available.",
                  "Sélectionnez les documents déjà présents dans le projet. Décochez un document pour retirer uniquement son lien avec cette tâche : le fichier original reste dans le projet.",
                )}
              </p>
            </div>
            {selectedTaskDocumentIds.map((documentId) => (
              <input
                key={documentId}
                type="hidden"
                name="documentIds"
                value={documentId}
              />
            ))}
            {fieldError("documentIds") ? (
              <p
                role="alert"
                className="rounded-lg border border-critical/40 bg-critical/10 px-3 py-2 text-xs font-medium text-critical"
              >
                {fieldError("documentIds")}
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                id="taskDocumentSearch"
                name="taskDocumentSearch"
                value={taskDocumentSearch}
                onChange={(event) => setTaskDocumentSearch(event.target.value)}
                placeholder={label(
                  fr,
                  "Search by title or category…",
                  "Rechercher par titre ou catégorie…",
                )}
              />
              <select
                id="taskDocumentFolder"
                value={taskDocumentFolder}
                onChange={(event) => setTaskDocumentFolder(event.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
                aria-label={label(fr, "Document folder", "Dossier de document")}
              >
                <option value="__all__">
                  {label(fr, "All folders", "Tous les dossiers")}
                </option>
                {taskDocumentFolders.map((folder) => (
                  <option key={folder.value} value={folder.value}>
                    {folder.text}
                  </option>
                ))}
              </select>
            </div>
            {taskDocuments.isPending && taskId ? (
              <p className="text-xs text-ink-secondary">
                {label(
                  fr,
                  "Loading linked documents…",
                  "Chargement des documents liés…",
                )}
              </p>
            ) : matchingTaskDocuments.length ? (
              <div
                key={`${taskId}:${[...linkedTaskDocumentIds].join(",")}`}
                className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-border bg-surface-1 p-2"
              >
                {matchingTaskDocuments.map((document) => (
                  <label
                    key={String(document.id)}
                    className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-surface-2"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTaskDocumentIds.includes(
                        String(document.id),
                      )}
                      onChange={(event) => {
                        const documentId = String(document.id);
                        setSelectedTaskDocumentIds((current) =>
                          event.target.checked
                            ? [...new Set([...current, documentId])]
                            : current.filter((id) => id !== documentId),
                        );
                      }}
                      className="mt-0.5 size-4 accent-brand"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">
                        {String(document.title ?? "—")}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-secondary">
                        {[
                          document.documentType,
                          document.mimeType,
                          document.uploadedByName,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-3 text-xs text-ink-secondary">
                {label(
                  fr,
                  "No project document matches this search yet.",
                  "Aucun document du projet ne correspond encore à cette recherche.",
                )}
              </p>
            )}
            {taskId && taskDocuments.data?.length ? (
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-xs font-semibold uppercase tracking-[.1em] text-ink-muted">
                  {label(fr, "Linked documents", "Documents liés")}
                </p>
                {taskDocuments.data.map((document) => (
                  <div
                    key={String(document.id)}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-1 p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {String(document.title ?? "—")}
                      </p>
                      <p className="mt-1 text-xs text-ink-secondary">
                        {[
                          document.documentType,
                          document.mimeType,
                          document.uploadedByName,
                          date(document.createdAt, fr ? "fr-FR" : "en-US"),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2 text-xs font-medium text-brand">
                      <a
                        href={orgApiUrl(
                          orgSlug,
                          `files/${String(document.id)}/preview`,
                        )}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-border px-2 py-1 hover:bg-surface-2"
                      >
                        {label(fr, "Preview", "Aperçu")}
                      </a>
                      <a
                        href={orgApiUrl(
                          orgSlug,
                          `files/${String(document.id)}/download`,
                        )}
                        className="rounded-md border border-border px-2 py-1 hover:bg-surface-2"
                      >
                        {label(fr, "Download", "Télécharger")}
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "member")
    return (
      <>
        {select(
          "memberId",
          label(fr, "Employee / member", "Employé / membre"),
          memberOptions,
          true,
        )}
        {select(
          "assignmentRole",
          label(fr, "Project role", "Rôle dans le projet"),
          [
            {
              value: "project_manager",
              text: label(fr, "Project manager", "Manager du projet"),
            },
            {
              value: "provincial_manager",
              text: label(fr, "Provincial manager", "Manager provincial"),
            },
            {
              value: "supervisor",
              text: label(fr, "Supervisor", "Superviseur"),
            },
            { value: "finance", text: label(fr, "Finance", "Finance") },
            { value: "procurement", text: label(fr, "Procurement", "Achats") },
            { value: "legal", text: label(fr, "Legal", "Juridique") },
            {
              value: "administration",
              text: label(fr, "Administration", "Administration"),
            },
            { value: "worker", text: label(fr, "Worker", "Ouvrier") },
            {
              value: "contractor",
              text: label(fr, "Contractor", "Prestataire"),
            },
            { value: "other", text: label(fr, "Other", "Autre") },
          ],
          true,
        )}
        {input(
          "assignmentStartDate",
          label(fr, "Assignment start date", "Date d’affectation"),
          true,
          "date",
        )}
        {input(
          "assignmentEndDate",
          label(fr, "Assignment end date", "Date de fin d’affectation"),
          false,
          "date",
        )}
        <div className="md:col-span-2">
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox"
              name="isManager"
              defaultChecked={getValue("isManager") === "true"}
              aria-invalid={Boolean(fieldError("isManager"))}
            />
            {label(
              fr,
              "Primary project manager",
              "Manager du projet principal",
            )}
          </label>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            {label(
              fr,
              "Grants the Project Manager role and access to this project only during the assignment period. Only one primary manager can cover the same dates.",
              "Attribue le rôle Manager du projet et l’accès à ce seul projet pendant la période d’affectation. Un seul manager principal peut couvrir les mêmes dates.",
            )}
          </p>
          {fieldError("isManager") ? (
            <p className="mt-1 text-xs font-medium text-critical">
              {fieldError("isManager")}
            </p>
          ) : null}
        </div>
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "operational-link")
    return (
      <>
        <Field
          label={label(
            fr,
            "Operational record type",
            "Type d’enregistrement opérationnel",
          )}
          htmlFor="targetKind"
          required
        >
          <select
            id="targetKind"
            name="targetKind"
            value={operationalTargetKind}
            onChange={(event) => {
              setOperationalTargetKind(
                event.target.value as OperationalTargetKind,
              );
              setOperationalSearch("");
            }}
            className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
          >
            {Object.entries(OPERATIONAL_TARGETS).map(([value, target]) => (
              <option key={value} value={value}>
                {fr ? target.french : target.english}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={label(fr, "Search", "Rechercher")}
          htmlFor="operationalSearch"
        >
          <Input
            id="operationalSearch"
            name="operationalSearch"
            value={operationalSearch}
            onChange={(event) => setOperationalSearch(event.target.value)}
            placeholder={label(
              fr,
              "Name, code or animal number…",
              "Nom, code ou numéro d’animal…",
            )}
            disabled={
              !canReadOperationalTarget ||
              operationalRecords.isPending ||
              !matchingOperationalOptions.length
            }
          />
        </Field>
        <Field
          label={label(fr, "Operational record", "Enregistrement opérationnel")}
          htmlFor="recordId"
          required
          error={fieldError("recordId")}
          className="md:col-span-2"
          hint={
            project?.siteId
              ? label(
                  fr,
                  "Only records at this project site are shown.",
                  "Seuls les enregistrements du site de ce projet sont proposés.",
                )
              : label(
                  fr,
                  "Only records in this project's province are shown.",
                  "Seuls les enregistrements de la province de ce projet sont proposés.",
                )
          }
        >
          <select
            key={operationalTargetKind}
            id="recordId"
            name="recordId"
            required
            disabled={
              !canReadOperationalTarget ||
              operationalRecords.isPending ||
              !matchingOperationalOptions.length
            }
            defaultValue={getValue("recordId")}
            aria-invalid={Boolean(fieldError("recordId"))}
            className={`h-9 w-full rounded-md border bg-surface-1 px-3 text-sm text-ink ${fieldError("recordId") ? "border-critical" : "border-border-strong"}`}
          >
            <option value="">
              {!canReadOperationalTarget
                ? label(
                    fr,
                    "Permission required to list these records",
                    "Permission requise pour afficher ces enregistrements",
                  )
                : operationalRecords.isPending
                  ? label(
                      fr,
                      "Loading records…",
                      "Chargement des enregistrements…",
                    )
                  : operationalRecords.isError
                    ? label(
                        fr,
                        "Records could not load",
                        "Les enregistrements n’ont pas pu être chargés",
                      )
                    : matchingOperationalOptions.length
                      ? label(
                          fr,
                          "Select a record",
                          "Sélectionner un enregistrement",
                        )
                      : label(
                          fr,
                          "No matching record at this location",
                          "Aucun enregistrement correspondant à cet emplacement",
                        )}
            </option>
            {matchingOperationalOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.text}
              </option>
            ))}
          </select>
        </Field>
        {select(
          "linkType",
          label(fr, "Project relationship", "Relation au projet"),
          [
            "created_by_project",
            "acquired_for_project",
            "built_for_project",
            "assigned_to_project",
            "land_acquisition",
          ].map((value) => ({ value, text: titleCase(value) })),
          true,
        )}
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "budget")
    return (
      <>
        {input(
          "category",
          label(fr, "Budget category", "Catégorie budgétaire"),
          true,
        )}
        {input(
          "plannedAmount",
          label(fr, "Planned amount", "Montant prévu"),
          true,
          "number",
        )}
        {currency()}
        {phaseSelect()}
        <Field
          label={label(fr, "Description", "Description")}
          htmlFor="description"
          className="md:col-span-2"
        >
          <Textarea
            id="description"
            name="description"
            required
            defaultValue={getValue("description")}
          />
        </Field>
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "material")
    return (
      <>
        {input("name", label(fr, "Material name", "Nom du matériau"), true)}
        {input("code", label(fr, "Material code", "Code matériau"))}
        {input("category", label(fr, "Category", "Catégorie"))}
        {input("unit", label(fr, "Unit", "Unité"), true)}
        {input(
          "plannedQuantity",
          label(fr, "Planned quantity", "Quantité prévue"),
          true,
          "number",
        )}
        {input(
          "estimatedUnitCost",
          label(fr, "Estimated unit cost", "Coût unitaire estimé"),
          false,
          "number",
        )}
        {select(
          "inventoryItemId",
          label(fr, "Inventory item", "Article en stock"),
          inventoryOptions,
        )}
        {select(
          "defaultWarehouseId",
          label(fr, "Default storage", "Magasin par défaut"),
          warehouseOptions,
        )}
        {select(
          "preferredSupplierId",
          label(fr, "Preferred supplier", "Fournisseur privilégié"),
          supplierOptions,
        )}
        {common}
      </>
    );
  if (kind === "movement")
    return (
      <>
        {select(
          "projectMaterialId",
          label(fr, "Project material", "Matériau du projet"),
          materialOptions,
          true,
        )}
        {input(
          "movementDate",
          label(fr, "Movement date", "Date du mouvement"),
          true,
          "date",
        )}
        {select(
          "movementType",
          label(fr, "Movement type", "Type de mouvement"),
          [
            "used",
            "returned",
            "damaged",
            "adjustment_in",
            "adjustment_out",
          ].map((value) => ({ value, text: titleCase(value) })),
          true,
        )}
        {input("quantity", label(fr, "Quantity", "Quantité"), true, "number")}
        {select(
          "projectTaskId",
          label(fr, "Related task", "Tâche liée"),
          taskOptions,
        )}
        {select(
          "warehouseId",
          label(fr, "Warehouse / location", "Magasin / emplacement"),
          warehouseOptions,
        )}
        {select(
          "issuedByMemberId",
          label(fr, "Issued by", "Sorti par"),
          memberOptions,
        )}
        {select(
          "usedByMemberId",
          label(fr, "Used by / responsible", "Utilisé par / responsable"),
          memberOptions,
        )}
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "request-line")
    return (
      <>
        {select(
          "purchaseRequestId",
          label(fr, "Purchase request", "Demande d’achat"),
          requestOptions,
          true,
        )}
        {select(
          "projectMaterialId",
          label(fr, "Project material", "Matériau du projet"),
          materialOptions,
        )}
        {select(
          "inventoryItemId",
          label(fr, "Inventory item", "Article en stock"),
          inventoryOptions,
        )}
        <Field
          label={label(fr, "Description", "Description")}
          htmlFor="description"
          required
        >
          <Input
            id="description"
            name="description"
            required
            defaultValue={getValue("description")}
          />
        </Field>
        {select(
          "itemKind",
          label(fr, "Item type", "Type d’article"),
          ["material", "inventory", "asset", "service", "other"].map(
            (value) => ({ value, text: titleCase(value) }),
          ),
          true,
        )}
        {input("unit", label(fr, "Unit", "Unité"), true)}
        {input(
          "requestedQuantity",
          label(fr, "Requested quantity", "Quantité demandée"),
          true,
          "number",
        )}
        {input(
          "approvedQuantity",
          label(fr, "Approved quantity", "Quantité approuvée"),
          false,
          "number",
        )}
        {input(
          "estimatedUnitCost",
          label(fr, "Estimated unit cost", "Coût unitaire estimé"),
          false,
          "number",
        )}
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "request")
    return (
      <>
        {input(
          "requestNumber",
          label(fr, "Request number", "Numéro de demande"),
        )}
        {phaseSelect()}
        {select(
          "projectTaskId",
          label(fr, "Linked task", "Tâche liée"),
          taskOptions,
        )}
        {select(
          "supplierId",
          label(fr, "Supplier if known", "Fournisseur si connu"),
          supplierOptions,
        )}
        {select(
          "requestedByMemberId",
          label(fr, "Requested by", "Demandé par"),
          memberOptions,
        )}
        {input(
          "requestDate",
          label(fr, "Request date", "Date de demande"),
          true,
          "date",
        )}
        {input(
          "requiredDate",
          label(fr, "Required date", "Date requise"),
          false,
          "date",
        )}
        {select(
          "priority",
          label(fr, "Priority", "Priorité"),
          ["low", "medium", "high", "critical"].map((value) => ({
            value,
            text: titleCase(value),
          })),
          true,
        )}
        {select(
          "status",
          label(fr, "Status", "Statut"),
          (isOwner
            ? ["draft", "submitted", "approved", "rejected", "cancelled"]
            : ["draft", "submitted"]
          ).map((value) => ({ value, text: titleCase(value) })),
          true,
        )}
        {select(
          "approvalStatus",
          label(fr, "Approval", "Approbation"),
          (isOwner
            ? [
                "not_requested",
                "pending",
                "approved",
                "rejected",
                "partially_approved",
              ]
            : ["not_requested", "pending"]
          ).map((value) => ({ value, text: titleCase(value) })),
          true,
        )}
        {currency()}
        <Field
          label={label(fr, "Reason", "Motif")}
          htmlFor="reason"
          required
          className="md:col-span-2"
        >
          <Textarea
            id="reason"
            name="reason"
            required
            defaultValue={getValue("reason")}
          />
        </Field>
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "order-line")
    return (
      <>
        {select(
          "purchaseOrderId",
          label(fr, "Purchase order", "Bon de commande"),
          orderOptions,
          true,
        )}
        {select(
          "projectMaterialId",
          label(fr, "Project material", "Matériau du projet"),
          materialOptions,
        )}
        {select(
          "inventoryItemId",
          label(fr, "Inventory item", "Article en stock"),
          inventoryOptions,
        )}
        <Field
          label={label(fr, "Description", "Description")}
          htmlFor="description"
          required
        >
          <Input
            id="description"
            name="description"
            required
            defaultValue={getValue("description")}
          />
        </Field>
        {select(
          "itemKind",
          label(fr, "Item type", "Type d’article"),
          ["material", "inventory", "asset", "service", "other"].map(
            (value) => ({ value, text: titleCase(value) }),
          ),
          true,
        )}
        {input("unit", label(fr, "Unit", "Unité"), true)}
        {input(
          "orderedQuantity",
          label(fr, "Ordered quantity", "Quantité commandée"),
          true,
          "number",
        )}
        {input(
          "unitCost",
          label(fr, "Unit cost", "Coût unitaire"),
          true,
          "number",
        )}
        {input("taxAmount", label(fr, "Tax amount", "Taxes"), false, "number")}
        {input(
          "assetName",
          label(fr, "Asset name if durable", "Nom de l’actif si durable"),
        )}
        {input(
          "assetCategory",
          label(fr, "Asset category", "Catégorie d’actif"),
        )}
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "order")
    return (
      <>
        {input("orderNumber", label(fr, "Order number", "Numéro de commande"))}
        {select(
          "purchaseRequestId",
          label(fr, "Purchase request", "Demande d’achat"),
          requestOptions,
          true,
        )}
        {phaseSelect()}
        {select(
          "projectTaskId",
          label(fr, "Linked task", "Tâche liée"),
          taskOptions,
        )}
        {select(
          "supplierId",
          label(fr, "Supplier", "Fournisseur"),
          supplierOptions,
          true,
        )}
        {select(
          "warehouseId",
          label(fr, "Receiving warehouse", "Entrepôt de réception"),
          warehouseOptions,
        )}
        {input(
          "orderDate",
          label(fr, "Order date", "Date de commande"),
          true,
          "date",
        )}
        {input(
          "expectedDeliveryDate",
          label(fr, "Expected delivery", "Livraison prévue"),
          false,
          "date",
        )}
        {select(
          "status",
          label(fr, "Status", "Statut"),
          ["draft", "sent", "partially_received", "received", "cancelled"].map(
            (value) => ({ value, text: titleCase(value) }),
          ),
          true,
        )}
        {currency()}
        {input(
          "supplierReference",
          label(fr, "Supplier reference", "Référence fournisseur"),
        )}
        <Field
          label={label(fr, "Delivery address", "Adresse de livraison")}
          htmlFor="deliveryAddress"
          className="md:col-span-2"
        >
          <Textarea
            id="deliveryAddress"
            name="deliveryAddress"
            defaultValue={getValue("deliveryAddress")}
          />
        </Field>
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "receipt-line")
    return (
      <>
        {select(
          "receiptId",
          label(fr, "Receipt", "Réception"),
          receiptOptions,
          true,
        )}
        {select(
          "purchaseOrderLineId",
          label(fr, "Ordered item", "Article commandé"),
          orderLineOptions,
          true,
        )}
        {select(
          "projectMaterialId",
          label(fr, "Project material", "Matériau du projet"),
          materialOptions,
        )}
        {select(
          "inventoryItemId",
          label(fr, "Inventory item", "Article en stock"),
          inventoryOptions,
        )}
        {input(
          "receivedQuantity",
          label(fr, "Received quantity", "Quantité reçue"),
          true,
          "number",
        )}
        {input(
          "damagedQuantity",
          label(fr, "Damaged quantity", "Quantité endommagée"),
          false,
          "number",
        )}
        {input(
          "rejectedQuantity",
          label(fr, "Rejected quantity", "Quantité rejetée"),
          false,
          "number",
        )}
        {input(
          "actualUnitCost",
          label(fr, "Actual unit cost", "Coût unitaire réel"),
          false,
          "number",
        )}
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
          <input
            type="checkbox"
            name="assetRequired"
            defaultChecked={getValue("assetRequired") === "true"}
          />
          {label(fr, "Create durable asset", "Créer un actif durable")}
        </label>
        {input("assetName", label(fr, "Asset name", "Nom de l’actif"))}
        {input(
          "assetCategory",
          label(fr, "Asset category", "Catégorie d’actif"),
        )}
        <Field
          label={label(fr, "Receiver notes", "Notes du réceptionnaire")}
          htmlFor="receiverNotes"
          className="md:col-span-2"
        >
          <Textarea
            id="receiverNotes"
            name="receiverNotes"
            defaultValue={getValue("receiverNotes")}
          />
        </Field>
      </>
    );
  if (kind === "receipt")
    return (
      <>
        {input(
          "receiptNumber",
          label(fr, "Receipt number", "Numéro de réception"),
        )}
        {select(
          "purchaseOrderId",
          label(fr, "Purchase order", "Bon de commande"),
          orderOptions,
          true,
        )}
        {select(
          "warehouseId",
          label(fr, "Receiving warehouse", "Entrepôt de réception"),
          warehouseOptions,
        )}
        {input(
          "receivedDate",
          label(fr, "Received date", "Date de réception"),
          true,
          "date",
        )}
        {input(
          "deliveryNoteNumber",
          label(fr, "Delivery note", "Bon de livraison"),
        )}
        {select(
          "status",
          label(fr, "Status", "Statut"),
          ["draft", "received", "verified", "rejected"].map((value) => ({
            value,
            text: titleCase(value),
          })),
          true,
        )}
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "expense")
    return (
      <>
        {input(
          "expenseNumber",
          label(fr, "Expense number", "Numéro de dépense"),
        )}
        {phaseSelect()}
        {select(
          "projectTaskId",
          label(fr, "Linked task", "Tâche liée"),
          taskOptions,
        )}
        {input("category", label(fr, "Category", "Catégorie"), true)}
        {input("amount", label(fr, "Amount", "Montant"), true, "number")}
        {currency()}
        {input(
          "expenseDate",
          label(fr, "Expense date", "Date de dépense"),
          true,
          "date",
        )}
        {input(
          "paymentMethod",
          label(fr, "Payment method", "Mode de paiement"),
        )}
        {select(
          "status",
          label(fr, "Status", "Statut"),
          (isOwner
            ? [
                "draft",
                "submitted",
                "approved",
                "paid",
                "rejected",
                "cancelled",
              ]
            : ["draft", "submitted"]
          ).map((value) => ({ value, text: titleCase(value) })),
          true,
        )}
        {input(
          "receiptReference",
          label(fr, "Receipt / invoice", "Reçu / facture"),
        )}
        <Field
          label={label(fr, "Description", "Description")}
          htmlFor="description"
          className="md:col-span-2"
        >
          <Textarea
            id="description"
            name="description"
            required
            defaultValue={getValue("description")}
          />
        </Field>
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "asset")
    return (
      <>
        {input("assetNumber", label(fr, "Asset number", "Numéro d’actif"))}
        {input("name", label(fr, "Asset name", "Nom de l’actif"), true)}
        {input("category", label(fr, "Category", "Catégorie"), true)}
        {input("brand", label(fr, "Brand", "Marque"))}
        {input("model", label(fr, "Model", "Modèle"))}
        {input("serialNumber", label(fr, "Serial number", "Numéro de série"))}
        {input(
          "purchasePrice",
          label(fr, "Purchase price", "Prix d’achat"),
          false,
          "number",
        )}
        {input(
          "purchaseDate",
          label(fr, "Purchase date", "Date d’achat"),
          false,
          "date",
        )}
        {select(
          "status",
          label(fr, "Status", "Statut"),
          [
            "available",
            "assigned",
            "in_use",
            "under_maintenance",
            "out_of_service",
            "damaged",
            "retired",
            "sold",
            "lost",
          ].map((value) => ({ value, text: titleCase(value) })),
          true,
        )}
        {input("condition", label(fr, "Condition", "État"))}
        {input(
          "currentLocation",
          label(fr, "Current location", "Emplacement actuel"),
        )}
        {input("meterType", label(fr, "Meter type", "Type de compteur"))}
        {input(
          "currentMeterReading",
          label(fr, "Current meter", "Compteur actuel"),
          false,
          "number",
        )}
        {currency()}
        {common}
      </>
    );
  if (kind === "asset-assignment")
    return (
      <>
        {select("assetId", label(fr, "Asset", "Actif"), assetOptions, true)}
        {select(
          "assignedMemberId",
          label(fr, "Assigned employee", "Employé affecté"),
          memberOptions,
        )}
        {select(
          "assignedSiteId",
          label(fr, "Assigned site", "Site affecté"),
          siteOptions,
        )}
        {input(
          "assignedAt",
          label(fr, "Assignment date", "Date d’affectation"),
          false,
          "date",
        )}
        {input(
          "conditionOut",
          label(fr, "Condition on assignment", "État à l’affectation"),
        )}
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "asset-movement")
    return (
      <>
        {select("assetId", label(fr, "Asset", "Actif"), assetOptions, true)}
        {select(
          "fromSiteId",
          label(fr, "From site", "Depuis le site"),
          siteOptions,
        )}
        {select("toSiteId", label(fr, "To site", "Vers le site"), siteOptions)}
        {input(
          "movedAt",
          label(fr, "Movement date", "Date de mouvement"),
          false,
          "date",
        )}
        <Field label={label(fr, "Reason", "Motif")} htmlFor="reason" required>
          <Input
            id="reason"
            name="reason"
            required
            defaultValue={getValue("reason")}
          />
        </Field>
        {input(
          "fromLocation",
          label(fr, "From location", "Emplacement de départ"),
        )}
        {input("toLocation", label(fr, "To location", "Emplacement d’arrivée"))}
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "asset-usage")
    return (
      <>
        {select(
          "assetId",
          label(fr, "Machine / asset", "Machine / actif"),
          assetOptions,
          true,
        )}
        {select(
          "siteId",
          label(fr, "Site / farm", "Site / ferme"),
          siteOptions,
        )}
        {input(
          "usageDate",
          label(fr, "Usage date", "Date d’utilisation"),
          true,
          "date",
        )}
        {input(
          "meterStart",
          label(fr, "Start meter", "Compteur début"),
          false,
          "number",
        )}
        {input(
          "meterEnd",
          label(fr, "End meter", "Compteur fin"),
          false,
          "number",
        )}
        {input(
          "fuelConsumed",
          label(fr, "Fuel used", "Carburant utilisé"),
          false,
          "number",
        )}
        {input("fuelUnit", label(fr, "Fuel unit", "Unité carburant"))}
        <Field
          label={label(fr, "Work performed", "Travail réalisé")}
          htmlFor="workPerformed"
          required
          className="md:col-span-2"
        >
          <Textarea
            id="workPerformed"
            name="workPerformed"
            required
            defaultValue={getValue("workPerformed")}
          />
        </Field>
        {input(
          "areaCovered",
          label(fr, "Area covered", "Surface couverte"),
          false,
          "number",
        )}
        {input(
          "inputQuantity",
          label(fr, "Input quantity", "Quantité entrée"),
          false,
          "number",
        )}
        {input(
          "outputQuantity",
          label(fr, "Output quantity", "Quantité sortie"),
          false,
          "number",
        )}
        {input("quantityUnit", label(fr, "Quantity unit", "Unité de quantité"))}
        {input(
          "downtimeMinutes",
          label(fr, "Downtime minutes", "Minutes d’arrêt"),
          false,
          "number",
        )}
        <Field
          label={label(fr, "Problem reported", "Problème signalé")}
          htmlFor="problemReported"
          className="md:col-span-2"
        >
          <Textarea
            id="problemReported"
            name="problemReported"
            defaultValue={getValue("problemReported")}
          />
        </Field>
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "vehicle-profile")
    return (
      <>
        {select(
          "assetId",
          label(fr, "Vehicle asset", "Actif véhicule"),
          assetOptions,
          true,
        )}
        {input(
          "vehicleNumber",
          label(fr, "Vehicle number", "Numéro de véhicule"),
          true,
        )}
        {input(
          "registrationNumber",
          label(fr, "Registration", "Immatriculation"),
        )}
        {input("plateNumber", label(fr, "Plate number", "Plaque"))}
        {input("vehicleYear", label(fr, "Year", "Année"), false, "number")}
        {input("vin", label(fr, "VIN", "VIN"))}
        {input("make", label(fr, "Make", "Marque"))}
        {input("model", label(fr, "Model", "Modèle"))}
        {input(
          "insuranceExpiresOn",
          label(fr, "Insurance expires", "Expiration assurance"),
          false,
          "date",
        )}
        {input(
          "inspectionExpiresOn",
          label(fr, "Inspection expires", "Expiration contrôle"),
          false,
          "date",
        )}
      </>
    );
  if (kind === "vehicle-trip")
    return (
      <>
        {select(
          "vehicleId",
          label(fr, "Vehicle", "Véhicule"),
          vehicleOptions,
          true,
        )}
        {select(
          "driverMemberId",
          label(fr, "Driver", "Chauffeur"),
          memberOptions,
        )}
        {input(
          "tripDate",
          label(fr, "Trip date", "Date du trajet"),
          true,
          "date",
        )}
        <Field
          label={label(fr, "Destination", "Destination")}
          htmlFor="destination"
          required
        >
          <Input
            id="destination"
            name="destination"
            required
            defaultValue={getValue("destination")}
          />
        </Field>
        <Field label={label(fr, "Purpose", "Objet")} htmlFor="purpose" required>
          <Input
            id="purpose"
            name="purpose"
            required
            defaultValue={getValue("purpose")}
          />
        </Field>
        {input(
          "startMileage",
          label(fr, "Start mileage", "Kilométrage départ"),
          false,
          "number",
        )}
        {input(
          "endMileage",
          label(fr, "End mileage", "Kilométrage arrivée"),
          false,
          "number",
        )}
        {input(
          "fuelUsed",
          label(fr, "Fuel used", "Carburant utilisé"),
          false,
          "number",
        )}
        {input(
          "fuelCost",
          label(fr, "Fuel cost", "Coût carburant"),
          false,
          "number",
        )}
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "maintenance-plan")
    return (
      <>
        {select("assetId", label(fr, "Asset", "Actif"), assetOptions, true)}
        {input("name", label(fr, "Plan name", "Nom du plan"), true)}
        {select(
          "maintenanceType",
          label(fr, "Maintenance type", "Type de maintenance"),
          [
            "preventive",
            "corrective",
            "emergency",
            "inspection",
            "routine_service",
          ].map((value) => ({ value, text: titleCase(value) })),
          true,
        )}
        {input(
          "intervalDays",
          label(fr, "Interval days", "Intervalle jours"),
          false,
          "number",
        )}
        {input(
          "intervalMeter",
          label(fr, "Meter interval", "Intervalle compteur"),
          false,
          "number",
        )}
        {input(
          "nextDueDate",
          label(fr, "Next due date", "Prochaine échéance"),
          false,
          "date",
        )}
        {input(
          "nextDueMeter",
          label(fr, "Next due meter", "Prochain compteur"),
          false,
          "number",
        )}
        {input(
          "estimatedCost",
          label(fr, "Estimated cost", "Coût estimé"),
          false,
          "number",
        )}
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={getValue("isActive") !== "false"}
          />
          {label(fr, "Active plan", "Plan actif")}
        </label>
        <Field
          label={label(fr, "Description", "Description")}
          htmlFor="description"
          className="md:col-span-2"
          error={fieldError("description")}
        >
          <Textarea
            id="description"
            name="description"
            aria-invalid={Boolean(fieldError("description"))}
            defaultValue={getValue("description")}
          />
        </Field>
      </>
    );
  if (kind === "maintenance-part")
    return (
      <>
        {select(
          "workOrderId",
          label(fr, "Maintenance work order", "Intervention de maintenance"),
          workOrderOptions,
          true,
        )}
        {select(
          "inventoryItemId",
          label(fr, "Inventory item", "Article en stock"),
          inventoryOptions,
        )}
        {select(
          "warehouseId",
          label(fr, "Warehouse", "Entrepôt"),
          warehouseOptions,
        )}
        {input("partName", label(fr, "Part name", "Nom de la pièce"), true)}
        {input("quantity", label(fr, "Quantity", "Quantité"), true, "number")}
        {input("unit", label(fr, "Unit", "Unité"), true)}
        {input(
          "unitCost",
          label(fr, "Unit cost", "Coût unitaire"),
          false,
          "number",
        )}
        {input(
          "issuedAt",
          label(fr, "Issued date", "Date de sortie"),
          false,
          "date",
        )}
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  return (
    <>
      {input(
        "workOrderNumber",
        label(fr, "Work order number", "Numéro d’intervention"),
      )}
      {select("assetId", label(fr, "Asset", "Actif"), assetOptions, true)}
      {input("title", label(fr, "Work title", "Titre de l’intervention"), true)}
      {select(
        "planId",
        label(fr, "Maintenance plan", "Plan de maintenance"),
        maintenancePlanOptions,
      )}
      {select(
        "maintenanceType",
        label(fr, "Maintenance type", "Type de maintenance"),
        [
          "preventive",
          "corrective",
          "emergency",
          "inspection",
          "routine_service",
        ].map((value) => ({ value, text: titleCase(value) })),
        true,
      )}
      {select(
        "status",
        label(fr, "Status", "Statut"),
        [
          "reported",
          "waiting_approval",
          "approved",
          "in_progress",
          "completed",
          "cancelled",
        ].map((value) => ({ value, text: titleCase(value) })),
        true,
      )}
      {select(
        "priority",
        label(fr, "Priority", "Priorité"),
        ["low", "normal", "high", "critical"].map((value) => ({
          value,
          text: titleCase(value),
        })),
        true,
      )}
      {input("dueDate", label(fr, "Due date", "Échéance"), false, "date")}
      {input(
        "laborCost",
        label(fr, "Labor cost", "Coût main-d’œuvre"),
        false,
        "number",
      )}
      {input(
        "partsCost",
        label(fr, "Parts cost", "Coût pièces"),
        false,
        "number",
      )}
      {input(
        "otherCost",
        label(fr, "Other cost", "Autre coût"),
        false,
        "number",
      )}
      <Field
        label={label(fr, "Problem description", "Description du problème")}
        htmlFor="problemDescription"
        className="md:col-span-2"
      >
        <Textarea
          id="problemDescription"
          name="problemDescription"
          defaultValue={getValue("problemDescription")}
        />
      </Field>
      <Field
        label={label(fr, "Notes", "Notes")}
        htmlFor="notes"
        className="md:col-span-2"
      >
        <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
      </Field>
    </>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-secondary">
            {subtitle}
          </p>
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}
function DocumentAccessDialog({
  orgSlug,
  document,
  roles,
  members,
  fr,
  onClose,
  onSaved,
}: {
  orgSlug: string;
  document: Row;
  roles: RoleOption[];
  members: MemberOption[];
  fr: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const access = useQuery({
    queryKey: ["project-document-access", orgSlug, document.id],
    queryFn: () =>
      ownerManagementApi.documentAccess<{
        access: Row & { allowedRoles?: Row[]; allowedMembers?: Row[] };
      }>(orgSlug, document.id),
    select: (data) => data.access,
  });
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (body: {
      visibility:
        | "company"
        | "project_team"
        | "owner_only"
        | "owner_partner"
        | "selected_roles"
        | "selected_people";
      allowedRoleIds: string[];
      allowedMemberIds: string[];
      isLocked: boolean;
      canDownload: boolean;
      canEdit: boolean;
    }) => ownerManagementApi.updateDocumentAccess(orgSlug, document.id, body),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["project-document-access", orgSlug, document.id],
      });
      onSaved();
    },
  });
  const selectedRoleIds = new Set(
    ((access.data?.allowedRoles ?? []) as Row[]).map((role) =>
      String(role.roleId ?? ""),
    ),
  );
  const selectedMemberIds = new Set(
    ((access.data?.allowedMembers ?? []) as Row[]).map((member) =>
      String(member.memberId ?? ""),
    ),
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void save.mutate({
      visibility: String(form.get("visibility")) as
        | "company"
        | "project_team"
        | "owner_only"
        | "owner_partner"
        | "selected_roles"
        | "selected_people",
      allowedRoleIds: form.getAll("allowedRoleIds").map(String).filter(Boolean),
      allowedMemberIds: form
        .getAll("allowedMemberIds")
        .map(String)
        .filter(Boolean),
      isLocked: form.get("isLocked") === "on",
      canDownload: form.get("canDownload") === "on",
      canEdit: form.get("canEdit") === "on",
    });
  };
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-ink/45 p-4 backdrop-blur-sm">
      <div className="mx-auto my-8 max-w-2xl rounded-2xl border border-border bg-surface-1 shadow-2xl">
        <div className="flex items-start justify-between border-b border-border p-5">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[.14em] text-brand">
              <Lock className="size-3.5" />
              {label(fr, "Document privacy", "Confidentialité du document")}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-ink">
              {String(
                document.title ??
                  label(fr, "Project document", "Document du projet"),
              )}
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label={label(fr, "Close", "Fermer")}
          >
            <X />
          </Button>
        </div>
        {access.isPending ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-10" />
            <Skeleton className="h-28" />
          </div>
        ) : access.isError ? (
          <div className="p-5">
            <ErrorState onRetry={() => void access.refetch()} />
          </div>
        ) : (
          <form className="grid gap-4 p-5 md:grid-cols-2" onSubmit={submit}>
            {save.error ? (
              <p
                className="md:col-span-2 rounded-lg border border-critical/35 bg-critical/10 px-3 py-2 text-sm text-critical"
                role="alert"
              >
                {save.error instanceof ApiError
                  ? save.error.message
                  : label(
                      fr,
                      "Could not update document access.",
                      "Impossible de mettre à jour l’accès au document.",
                    )}
              </p>
            ) : null}
            <Field
              label={label(fr, "Visibility", "Visibilité")}
              htmlFor="document-visibility"
              required
            >
              <select
                id="document-visibility"
                name="visibility"
                defaultValue={String(access.data?.visibility ?? "company")}
                className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
              >
                <option value="company">
                  {label(fr, "Company", "Toute l’entreprise")}
                </option>
                <option value="project_team">
                  {label(fr, "Project team", "Équipe du projet")}
                </option>
                <option value="owner_only">
                  {label(fr, "Owner only", "Propriétaire uniquement")}
                </option>
                <option value="owner_partner">
                  {label(fr, "Owner + Partner", "Propriétaire + partenaire")}
                </option>
                <option value="selected_roles">
                  {label(fr, "Selected roles", "Rôles sélectionnés")}
                </option>
                <option value="selected_people">
                  {label(fr, "Selected people", "Personnes sélectionnées")}
                </option>
              </select>
            </Field>
            <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs leading-5 text-ink-secondary">
              {label(
                fr,
                "Private documents are checked by the API before preview or download.",
                "Les documents privés sont vérifiés par l’API avant tout aperçu ou téléchargement.",
              )}
            </div>
            <Field
              label={label(fr, "Allowed roles", "Rôles autorisés")}
              htmlFor="document-roles"
              hint={label(
                fr,
                "Used only for Selected roles.",
                "Utilisé uniquement pour Rôles sélectionnés.",
              )}
            >
              <select
                id="document-roles"
                name="allowedRoleIds"
                multiple
                defaultValue={[...selectedRoleIds]}
                className="min-h-28 w-full rounded-md border border-border-strong bg-surface-1 px-3 py-2 text-sm text-ink"
              >
                {roles
                  .filter((role) => role.id && (role.name || role.code))
                  .map((role) => (
                    <option key={role.id} value={role.id}>
                      {String(role.name ?? role.code)}
                    </option>
                  ))}
              </select>
            </Field>
            <Field
              label={label(fr, "Allowed people", "Personnes autorisées")}
              htmlFor="document-members"
              hint={label(
                fr,
                "Used only for Selected people.",
                "Utilisé uniquement pour Personnes sélectionnées.",
              )}
            >
              <select
                id="document-members"
                name="allowedMemberIds"
                multiple
                defaultValue={[...selectedMemberIds]}
                className="min-h-28 w-full rounded-md border border-border-strong bg-surface-1 px-3 py-2 text-sm text-ink"
              >
                {members
                  .filter(
                    (member) =>
                      member.memberId && (member.fullName || member.email),
                  )
                  .map((member) => (
                    <option key={member.memberId} value={member.memberId}>
                      {String(member.fullName ?? member.email)}
                      {member.email && member.fullName
                        ? ` · ${member.email}`
                        : ""}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="md:col-span-2 grid gap-3 rounded-xl border border-border bg-surface-2 p-4 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  name="isLocked"
                  defaultChecked={Boolean(access.data?.isLocked)}
                />
                {label(fr, "Lock editing", "Verrouiller les modifications")}
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  name="canDownload"
                  defaultChecked={access.data?.canDownload !== false}
                />
                {label(fr, "Allow download", "Autoriser le téléchargement")}
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  name="canEdit"
                  defaultChecked={access.data?.canEdit !== false}
                />
                {label(fr, "Allow edits", "Autoriser les modifications")}
              </label>
            </div>
            {Boolean(access.data?.isLocked) ? (
              <p className="md:col-span-2 text-xs text-ink-muted">
                {label(fr, "Locked", "Verrouillé")} ·{" "}
                {date(access.data?.lockedAt, fr ? "fr-FR" : "en-US")}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 border-t border-border pt-4 md:col-span-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                {label(fr, "Cancel", "Annuler")}
              </Button>
              <Button type="submit" loading={save.isPending}>
                {label(fr, "Save access", "Enregistrer l’accès")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
function RecordsPanel({
  title,
  subtitle,
  rows,
  fields,
  fr,
  icon: Icon,
  onAdd,
  onEdit,
  onOpen,
  editLabel,
  footer,
}: {
  title: string;
  subtitle: string;
  rows: Row[];
  fields: string[];
  fr: boolean;
  icon: typeof FolderKanban;
  onAdd?: () => void;
  onEdit?: (row: Row) => void;
  onOpen?: (row: Row) => void;
  editLabel?: string;
  footer?: ReactNode;
}) {
  const auditDate = (value: unknown) => {
    if (!value) return null;
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return null;
    return new Intl.DateTimeFormat(fr ? "fr-FR" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(parsed);
  };
  const auditAction = (value: unknown) => {
    const action = String(value ?? "");
    const labels: Record<string, string> = fr
      ? {
          create: "Créé",
          update: "Mis à jour",
          delete: "Supprimé",
          approve: "Approuvé",
          reject: "Refusé",
        }
      : {
          create: "Created",
          update: "Updated",
          delete: "Deleted",
          approve: "Approved",
          reject: "Rejected",
        };
    return (
      labels[action] ??
      (action ? titleCase(action) : label(fr, "Created", "Créé"))
    );
  };
  const displayField = (field: string, value: unknown) => {
    if (field === "taskType")
      return String(value) === "milestone"
        ? label(fr, "Milestone", "Jalon")
        : label(fr, "Work", "Travail");
    if (field === "assignmentRole") {
      const roles: Record<string, string> = {
        project_manager: label(fr, "Project manager", "Manager du projet"),
        provincial_manager: label(
          fr,
          "Provincial manager",
          "Manager provincial",
        ),
        supervisor: label(fr, "Supervisor", "Superviseur"),
        finance: label(fr, "Finance", "Finance"),
        procurement: label(fr, "Procurement", "Achats"),
        legal: label(fr, "Legal", "Juridique"),
        administration: label(fr, "Administration", "Administration"),
        worker: label(fr, "Worker", "Ouvrier"),
        contractor: label(fr, "Contractor", "Prestataire"),
        other: label(fr, "Other", "Autre"),
      };
      return roles[String(value)] ?? titleCase(value);
    }
    if (field === "isManager")
      return value === true || String(value) === "true"
        ? label(fr, "Primary manager", "Manager principal")
        : "";
    return field === "status" || field === "priority"
      ? titleCase(value)
      : String(value);
  };
  return (
    <Panel
      title={title}
      subtitle={subtitle}
      action={
        onAdd ? (
          <Button size="sm" onClick={onAdd}>
            <Plus />
            {label(fr, "Add", "Ajouter")}
          </Button>
        ) : undefined
      }
    >
      {rows.length ? (
        <div className="divide-y divide-border">
          {rows.map((row, index) => {
            const actorName =
              typeof row.lastActionByName === "string" &&
              row.lastActionByName.trim()
                ? row.lastActionByName
                : null;
            const actorRole =
              typeof row.lastActionByRole === "string" &&
              row.lastActionByRole.trim()
                ? row.lastActionByRole
                : null;
            const timestamp = auditDate(row.lastActionAt ?? row.createdAt);
            return (
              <div
                key={String(
                  row.id ||
                    `${title}-${row.code ?? row.name ?? row.title ?? index}-${index}`,
                )}
                className={`flex items-start justify-between gap-3 py-3 ${onOpen ? "cursor-pointer rounded-lg px-2 transition hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" : ""}`}
                onClick={() => onOpen?.(row)}
                onKeyDown={(event) => {
                  if (onOpen && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    onOpen(row);
                  }
                }}
                role={onOpen ? "button" : undefined}
                tabIndex={onOpen ? 0 : undefined}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
                    {String(row.visibility ?? "company") !== "company" ||
                    row.isLocked ? (
                      <Lock
                        className="size-3.5 shrink-0 text-amber-600"
                        aria-label={label(fr, "Restricted", "Restreint")}
                      />
                    ) : null}
                    {String(
                      row.name ??
                        row.title ??
                        row.code ??
                        row.requestNumber ??
                        row.orderNumber ??
                        row.expenseNumber ??
                        row.assetNumber ??
                        row.workOrderNumber ??
                        "—",
                    )}
                  </p>
                  <p className="mt-1 truncate text-xs text-ink-secondary">
                    {fields
                      .map((field) =>
                        row[field] == null || row[field] === ""
                          ? null
                          : displayField(field, row[field]),
                      )
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                  {actorName || timestamp ? (
                    <p className="mt-1.5 flex flex-wrap gap-x-1 text-[11px] leading-4 text-ink-muted">
                      <span className="font-medium text-ink-secondary">
                        {auditAction(row.lastAction)}
                      </span>
                      {actorName ? (
                        <>
                          <span>·</span>
                          <span>
                            {fr ? "par" : "by"} {actorName}
                          </span>
                        </>
                      ) : null}
                      {actorRole ? (
                        <>
                          <span>·</span>
                          <span>{actorRole}</span>
                        </>
                      ) : null}
                      {timestamp ? (
                        <>
                          <span>·</span>
                          <time
                            dateTime={String(row.lastActionAt ?? row.createdAt)}
                          >
                            {timestamp}
                          </time>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {row.status ? (
                    <Badge variant={statusVariant(row.status)}>
                      {titleCase(row.status)}
                    </Badge>
                  ) : null}
                  {onEdit ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={(event) => {
                        event.stopPropagation();
                        onEdit(row);
                      }}
                      aria-label={editLabel ?? label(fr, "Edit", "Modifier")}
                    >
                      <Pencil />
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title={label(fr, "No record yet", "Aucun enregistrement")}
          description={label(
            fr,
            "Add the first record for this project area.",
            "Ajoutez le premier enregistrement de cette zone du projet.",
          )}
          icon={Icon}
          action={
            onAdd
              ? { label: label(fr, "Add", "Ajouter"), onClick: onAdd }
              : undefined
          }
        />
      )}
      {footer ? (
        <div className="mt-4 border-t border-border pt-3">{footer}</div>
      ) : null}
    </Panel>
  );
}
function DependencyPanel({
  title,
  subtitle,
  rows,
  sources,
  sourceField,
  dependencyField,
  fr,
  onAdd,
}: {
  title: string;
  subtitle: string;
  rows: Row[];
  sources: Row[];
  sourceField: string;
  dependencyField: string;
  fr: boolean;
  onAdd?: () => void;
}) {
  const sourceNames = new Map(
    sources.map((row) => [
      row.id,
      String(row.name ?? row.title ?? row.code ?? row.id),
    ]),
  );

  return (
    <Panel
      title={title}
      subtitle={subtitle}
      action={
        onAdd ? (
          <Button size="sm" onClick={onAdd}>
            <Plus />
            {label(fr, "Add dependency", "Ajouter une dépendance")}
          </Button>
        ) : undefined
      }
    >
      {rows.length ? (
        <div className="divide-y divide-border">
          {rows.map((row) => {
            const waiting = sourceNames.get(String(row[sourceField])) ?? "—";
            const required =
              sourceNames.get(String(row[dependencyField])) ?? "—";
            return (
              <div
                key={row.id}
                className="flex items-start justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {waiting}
                  </p>
                  <p className="mt-1 text-xs text-ink-secondary">
                    {label(fr, "Waits for", "Attend")} · {required}
                  </p>
                </div>
                <Badge variant="warning">{titleCase(row.dependencyType)}</Badge>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title={label(fr, "No dependency", "Aucune dépendance")}
          description={label(
            fr,
            "Add a prerequisite when work must happen in a controlled order.",
            "Ajoutez un prérequis lorsque le travail doit respecter un ordre contrôlé.",
          )}
          icon={ClipboardCheck}
          action={
            onAdd
              ? {
                  label: label(fr, "Add dependency", "Ajouter une dépendance"),
                  onClick: onAdd,
                }
              : undefined
          }
        />
      )}
    </Panel>
  );
}
function HeroMetric({
  label: text,
  value,
  icon: Icon,
  critical = false,
}: {
  label: string;
  value: number;
  icon: typeof FolderKanban;
  critical?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3.5 ${critical ? "border-critical/35 bg-critical/15" : "border-white/15 bg-white/[.09]"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-emerald-50/80">{text}</p>
        <Icon
          className={`size-4 ${critical ? "text-critical" : "text-emerald-100"}`}
        />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-white">
        {value}
      </p>
    </div>
  );
}
function Metric({
  label: text,
  value,
  icon: Icon,
  inverse = false,
}: {
  label: string;
  value: string;
  icon: typeof Wallet;
  inverse?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${inverse ? "border-white/10 bg-white/[.08]" : "border-border bg-surface-2"}`}
    >
      <Icon
        className={`size-4 ${inverse ? "text-emerald-100" : "text-brand"}`}
      />
      <p
        className={`mt-4 text-xs ${inverse ? "text-sky-50/75" : "text-ink-muted"}`}
      >
        {text}
      </p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${inverse ? "text-white" : "text-ink"}`}
      >
        {value}
      </p>
    </div>
  );
}
function Info({ label: text, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <p className="text-xs text-ink-muted">{text}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}
function Signal({
  label: text,
  value,
  critical = false,
}: {
  label: string;
  value: number;
  critical?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border py-3 last:border-0">
      <p className="text-sm text-ink-secondary">{text}</p>
      <p
        className={`text-lg font-semibold tabular-nums ${critical && value > 0 ? "text-serious" : "text-ink"}`}
      >
        {critical && value > 0 ? (
          <AlertTriangle className="mr-1 inline size-4" />
        ) : null}
        {value}
      </p>
    </div>
  );
}
function Handover({
  href,
  title,
  text,
}: {
  href: string;
  title: string;
  text: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-border bg-surface-2 p-4 transition hover:border-brand hover:bg-brand-subtle"
    >
      <p className="text-sm font-semibold text-ink">
        {title}
        <ArrowUpRight className="ml-1 inline size-4 text-brand" />
      </p>
      <p className="mt-2 text-xs leading-5 text-ink-secondary">{text}</p>
    </Link>
  );
}
function fileSize(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocumentFolders({
  orgSlug,
  documents,
  categories,
  fr,
  locale,
  onConfigure,
  onManage,
  onPreview,
}: {
  orgSlug: string;
  documents: Row[];
  categories: DocumentCategory[];
  fr: boolean;
  locale: string;
  onConfigure?: (document: Row) => void;
  onManage?: () => void;
  onPreview: (document: Row) => void;
}) {
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const configured = new Map(
    categories.map((category) => [category.id, category]),
  );
  type DocumentFolder = {
    key: string;
    name: string;
    code: string;
    documents: Row[];
    configured: boolean;
    visibility: "company" | "owner_only";
  };
  const folders = new Map<string, DocumentFolder>();

  for (const category of categories) {
    folders.set(category.id, {
      key: category.id,
      name: category.name,
      code: category.code,
      documents: [],
      configured: true,
      visibility: category.visibility ?? "company",
    });
  }
  for (const document of documents) {
    const categoryId = String(document.documentCategoryId ?? "").trim();
    const category = configured.get(categoryId);
    const code =
      String(
        document.documentCategoryCode ??
          category?.code ??
          document.documentType ??
          "other",
      )
        .trim()
        .toLowerCase() || "other";
    const key = categoryId || `legacy:${code}`;
    const existing: DocumentFolder = folders.get(key) ?? {
      key,
      name:
        String(document.documentCategoryName ?? category?.name ?? "").trim() ||
        (code === "other"
          ? label(fr, "Other documents", "Autres documents")
          : titleCase(code)),
      code,
      documents: [],
      configured: Boolean(category),
      visibility:
        category?.visibility ??
        (document.documentCategoryVisibility === "owner_only"
          ? "owner_only"
          : "company"),
    };
    existing.documents.push(document);
    folders.set(key, existing);
  }
  const sorted = [...folders.values()].sort((left, right) =>
    left.name.localeCompare(right.name, locale),
  );
  return (
    <Panel
      title={label(fr, "Project document folders", "Dossiers de documents")}
      subtitle={label(
        fr,
        "Files stay in one secure project library. Open a folder to browse its files; renaming never moves or duplicates a file.",
        "Les fichiers restent dans une seule bibliothèque sécurisée. Ouvrez un dossier pour voir ses fichiers ; le renommage ne déplace ni ne duplique un fichier.",
      )}
      action={
        onManage ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onManage}
          >
            <Settings2 />
            {label(fr, "Manage categories", "Gérer les catégories")}
          </Button>
        ) : undefined
      }
    >
      {sorted.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {sorted.map((folder) => {
            const isOpen = openFolder === folder.key;
            return (
              <article
                key={folder.key}
                className="overflow-hidden rounded-xl border border-border bg-surface-2"
              >
                <button
                  type="button"
                  onClick={() =>
                    setOpenFolder((current) =>
                      current === folder.key ? null : folder.key,
                    )
                  }
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-3 bg-surface-1 px-4 py-3 text-left transition hover:bg-surface-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <FolderOpen className="size-4 shrink-0 text-brand" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-ink">
                          {folder.name}
                        </span>
                        {folder.visibility === "owner_only" ? (
                          <Lock
                            className="size-3.5 shrink-0 text-amber-700"
                            aria-label={label(
                              fr,
                              "Owner only",
                              "Propriétaire uniquement",
                            )}
                          />
                        ) : null}
                      </span>
                      <span className="block text-xs text-ink-muted">
                        {folder.documents.length}{" "}
                        {label(fr, "document(s)", "document(s)")}
                        {folder.visibility === "owner_only"
                          ? ` · ${label(fr, "Owner only", "Propriétaire uniquement")}`
                          : ""}
                        {!folder.configured
                          ? ` · ${label(fr, "legacy category", "catégorie existante")}`
                          : ""}
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge variant="neutral">{titleCase(folder.code)}</Badge>
                    <span className="text-xs font-semibold text-brand">
                      {isOpen
                        ? label(fr, "Close", "Fermer")
                        : label(fr, "Open", "Ouvrir")}
                    </span>
                  </span>
                </button>
                {isOpen ? (
                  folder.documents.length ? (
                    <ul className="divide-y divide-border border-t border-border">
                      {folder.documents.map((document) => (
                        <li
                          key={document.id}
                          className="flex items-center justify-between gap-3 px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">
                              {String(
                                document.title ??
                                  label(
                                    fr,
                                    "Untitled document",
                                    "Document sans titre",
                                  ),
                              )}
                            </p>
                            <p className="mt-1 truncate text-xs text-ink-secondary">
                              {String(document.mimeType ?? "—")} ·{" "}
                              {fileSize(document.fileSizeBytes)} ·{" "}
                              {date(document.createdAt, locale)}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onPreview(document)}
                              className="rounded-md px-2 py-1.5 text-xs font-semibold text-brand hover:bg-brand-subtle"
                            >
                              {label(fr, "Preview", "Aperçu")}
                            </button>
                            <a
                              href={orgApiUrl(
                                orgSlug,
                                `files/${String(document.id)}/download`,
                              )}
                              className="grid size-8 place-items-center rounded-md text-ink-secondary hover:bg-surface-3 hover:text-ink"
                              aria-label={label(fr, "Download", "Télécharger")}
                            >
                              <Download className="size-4" />
                            </a>
                            {onConfigure ? (
                              <button
                                type="button"
                                onClick={() => onConfigure(document)}
                                className="grid size-8 place-items-center rounded-md text-ink-secondary hover:bg-surface-3 hover:text-ink"
                                aria-label={label(
                                  fr,
                                  "Manage document privacy",
                                  "Gérer la confidentialité",
                                )}
                              >
                                <Lock className="size-3.5" />
                              </button>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="border-t border-border px-4 py-5 text-sm text-ink-secondary">
                      {label(
                        fr,
                        "No files in this folder yet.",
                        "Aucun fichier dans ce dossier pour le moment.",
                      )}
                    </div>
                  )
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title={label(fr, "No project documents", "Aucun document du projet")}
          description={label(
            fr,
            "Upload the first photo or document, then choose the folder where it belongs.",
            "Ajoutez la première photo ou le premier document, puis choisissez le dossier où il doit être classé.",
          )}
          icon={FolderOpen}
        />
      )}
    </Panel>
  );
}

function DocumentCategoryDialog({
  orgSlug,
  categories,
  fr,
  onClose,
  onChanged,
  onConfirmAction,
}: {
  orgSlug: string;
  categories: DocumentCategory[];
  fr: boolean;
  onClose: () => void;
  onChanged: () => void;
  onConfirmAction: (request: ConfirmationRequest) => void;
}) {
  const [editing, setEditing] = useState<DocumentCategory | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"company" | "owner_only">(
    "company",
  );
  const reset = () => {
    setEditing(null);
    setName("");
    setDescription("");
    setVisibility("company");
  };
  const save = useMutation({
    mutationFn: () =>
      editing
        ? ownerManagementApi.updateDocumentCategory(orgSlug, editing.id, {
            name: name.trim(),
            description: description.trim() || null,
            visibility,
          })
        : ownerManagementApi.createDocumentCategory(orgSlug, {
            name: name.trim(),
            description: description.trim() || null,
            visibility,
          }),
    onSuccess: () => {
      reset();
      onChanged();
    },
  });
  const archive = useMutation({
    mutationFn: (categoryId: string) =>
      ownerManagementApi.archiveDocumentCategory(orgSlug, categoryId),
    onSuccess: onChanged,
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim()) void save.mutate();
  };
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-ink/45 p-4 backdrop-blur-sm">
      <div className="mx-auto my-8 max-w-4xl rounded-2xl border border-border bg-surface-1 shadow-2xl">
        <header className="flex items-start justify-between border-b border-border p-5">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[.14em] text-brand">
              <FolderOpen className="size-3.5" />
              {label(
                fr,
                "Company document folders",
                "Dossiers de documents de l’entreprise",
              )}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-ink">
              {label(
                fr,
                "Manage document categories",
                "Gérer les catégories de documents",
              )}
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">
              {label(
                fr,
                "Category privacy protects every file in that folder, including preview and download links.",
                "La confidentialité du dossier protège chaque fichier, y compris les liens d’aperçu et de téléchargement.",
              )}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label={label(fr, "Close", "Fermer")}
          >
            <X />
          </Button>
        </header>
        <div className="grid gap-5 p-5 md:grid-cols-[1.15fr_.85fr]">
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="border-b border-border bg-surface-2 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {label(fr, "Available folders", "Dossiers disponibles")}
            </div>
            <ul className="divide-y divide-border">
              {categories.map((category) => (
                <li
                  key={category.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
                      {category.visibility === "owner_only" ? (
                        <Lock className="size-3.5 shrink-0 text-amber-700" />
                      ) : null}
                      {category.name}
                    </p>
                    <p className="truncate text-xs text-ink-muted">
                      {category.code}
                      {category.description ? ` · ${category.description}` : ""}
                      {category.visibility === "owner_only"
                        ? ` · ${label(fr, "Owner only", "Propriétaire uniquement")}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(category);
                        setName(category.name);
                        setDescription(category.description ?? "");
                        setVisibility(category.visibility ?? "company");
                      }}
                      className="rounded-md px-2 py-1 text-xs font-semibold text-brand hover:bg-brand-subtle"
                    >
                      {label(fr, "Edit", "Modifier")}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onConfirmAction({
                          title: label(
                            fr,
                            "Deactivate folder",
                            "Désactiver le dossier",
                          ),
                          description: label(
                            fr,
                            "Existing files are kept, but this folder will no longer be available when classifying new files.",
                            "Les fichiers existants sont conservés, mais ce dossier ne sera plus disponible pour classer de nouveaux fichiers.",
                          ),
                          confirmLabel: label(fr, "Deactivate", "Désactiver"),
                          tone: "danger",
                          onConfirm: () => void archive.mutate(category.id),
                        })
                      }
                      disabled={archive.isPending}
                      className="rounded-md px-2 py-1 text-xs font-semibold text-ink-secondary hover:bg-surface-3 hover:text-critical disabled:opacity-50"
                    >
                      {label(fr, "Deactivate", "Désactiver")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <form
            className="rounded-xl border border-border bg-surface-2 p-4"
            onSubmit={submit}
          >
            <h3 className="text-base font-semibold text-ink">
              {editing
                ? label(fr, "Edit category", "Modifier la catégorie")
                : label(fr, "Add category", "Ajouter une catégorie")}
            </h3>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              {label(
                fr,
                "The technical folder code is generated safely from the name and stays stable after a rename.",
                "Le code technique est généré de façon sécurisée à partir du nom et reste stable après un renommage.",
              )}
            </p>
            {save.error ? (
              <p
                className="mt-3 rounded-lg border border-critical/35 bg-critical/10 px-3 py-2 text-sm text-critical"
                role="alert"
              >
                {save.error instanceof ApiError
                  ? save.error.message
                  : label(
                      fr,
                      "This category could not be saved.",
                      "Cette catégorie n’a pas pu être enregistrée.",
                    )}
              </p>
            ) : null}
            <div className="mt-4 space-y-3">
              <Field
                label={label(fr, "Category name", "Nom de la catégorie")}
                htmlFor="document-category-name"
                required
              >
                <Input
                  id="document-category-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={label(
                    fr,
                    "Example: Land documents",
                    "Exemple : Documents fonciers",
                  )}
                />
              </Field>
              <Field
                label={label(fr, "Short description", "Courte description")}
                htmlFor="document-category-description"
              >
                <Textarea
                  id="document-category-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                />
              </Field>
              <Field
                label={label(fr, "Folder access", "Accès au dossier")}
                htmlFor="document-category-visibility"
              >
                <select
                  id="document-category-visibility"
                  value={visibility}
                  onChange={(event) =>
                    setVisibility(
                      event.target.value as "company" | "owner_only",
                    )
                  }
                  className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
                >
                  <option value="company">
                    {label(
                      fr,
                      "Company users with document access",
                      "Utilisateurs de l’entreprise ayant accès aux documents",
                    )}
                  </option>
                  <option value="owner_only">
                    {label(
                      fr,
                      "Owner only (locked)",
                      "Propriétaire uniquement (verrouillé)",
                    )}
                  </option>
                </select>
              </Field>
              <p className="text-xs leading-5 text-ink-muted">
                {visibility === "owner_only"
                  ? label(
                      fr,
                      "Only the company owner can list, preview, download or add files in this folder.",
                      "Seul le propriétaire de l’entreprise peut voir, prévisualiser, télécharger ou ajouter des fichiers dans ce dossier.",
                    )
                  : label(
                      fr,
                      "Normal document permissions still apply to each file.",
                      "Les autorisations habituelles de document continuent de s’appliquer à chaque fichier.",
                    )}
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              {editing ? (
                <Button type="button" variant="ghost" onClick={reset}>
                  {label(fr, "Cancel", "Annuler")}
                </Button>
              ) : null}
              <Button
                type="submit"
                loading={save.isPending}
                disabled={!name.trim()}
              >
                {editing
                  ? label(fr, "Save changes", "Enregistrer les modifications")
                  : label(fr, "Create folder", "Créer le dossier")}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function ImagePanel({
  orgSlug,
  images,
  categories,
  fr,
  uploading,
  onUpload,
  removeImage,
  onClassify,
  classifying,
  onPreview,
  onConfirmAction,
  removingImage,
  canDelete,
}: {
  orgSlug: string;
  images: Row[];
  categories: DocumentCategory[];
  fr: boolean;
  uploading: boolean;
  removeImage: (imageId: string) => void;
  onClassify: (imageId: string, categoryId: string) => void;
  classifying: boolean;
  onPreview: (document: Row) => void;
  onConfirmAction: (request: ConfirmationRequest) => void;
  removingImage: boolean;
  canDelete: boolean;
  onUpload: (
    file: File,
    title: string,
    imageType: string,
    categoryId?: string,
  ) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [destinationByImage, setDestinationByImage] = useState<
    Record<string, string>
  >({});
  const activeCategories = categories.filter(
    (category) => category.isActive !== false,
  );
  const uncategorisedImages = images.filter(
    (image) => !String(image.documentCategoryId ?? "").trim(),
  );
  const selectedCategory = activeCategories.find(
    (category) => category.id === categoryId,
  );
  return (
    <>
      {uncategorisedImages.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {uncategorisedImages.map((image) => {
            const imageId = String(image.id);
            const destinationId = destinationByImage[imageId] ?? "";
            return (
              <figure
                key={imageId}
                className="group overflow-hidden rounded-xl border border-border bg-surface-2 p-2 hover:border-brand"
              >
                <button
                  type="button"
                  onClick={() => onPreview(image)}
                  className="block w-full text-left"
                >
                  <div className="aspect-video overflow-hidden rounded-lg bg-surface-3">
                    <img
                      src={orgApiUrl(orgSlug, `files/${imageId}/preview`)}
                      alt={String(image.title ?? "Project image")}
                      className="size-full object-cover"
                    />
                  </div>
                  <p className="mt-2 truncate text-xs font-medium text-ink">
                    {String(image.title ?? label(fr, "Image", "Image"))}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                    {label(fr, "Not categorised", "Non classée")}
                  </p>
                </button>
                {canDelete ? (
                  <div className="mt-2 flex items-center gap-1.5">
                    <select
                      aria-label={label(
                        fr,
                        "Move to folder",
                        "Classer dans un dossier",
                      )}
                      value={destinationId}
                      onChange={(event) =>
                        setDestinationByImage((current) => ({
                          ...current,
                          [imageId]: event.target.value,
                        }))
                      }
                      className="h-8 min-w-0 flex-1 rounded-md border border-border-strong bg-surface-1 px-2 text-xs text-ink"
                    >
                      <option value="">
                        {label(fr, "Choose folder", "Choisir un dossier")}
                      </option>
                      {activeCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={!destinationId || classifying}
                      loading={classifying}
                      onClick={() => onClassify(imageId, destinationId)}
                    >
                      {label(fr, "File", "Classer")}
                    </Button>
                    <button
                      type="button"
                      onClick={() =>
                        onConfirmAction({
                          title: label(fr, "Delete image", "Supprimer l’image"),
                          description: label(
                            fr,
                            "This image will be permanently deleted from the project library and cannot be recovered.",
                            "Cette image sera définitivement supprimée de la bibliothèque du projet et ne pourra pas être récupérée.",
                          ),
                          confirmLabel: label(
                            fr,
                            "Delete permanently",
                            "Supprimer définitivement",
                          ),
                          tone: "danger",
                          onConfirm: () => removeImage(imageId),
                        })
                      }
                      disabled={removingImage}
                      aria-label={label(
                        fr,
                        "Delete image",
                        "Supprimer l’image",
                      )}
                      className="grid size-8 shrink-0 place-items-center rounded-md text-ink-secondary hover:bg-surface-3 hover:text-critical disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </div>
                ) : null}
              </figure>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title={label(
            fr,
            "No uncategorised photos",
            "Aucune photo non classée",
          )}
          description={label(
            fr,
            "Photos placed in a document folder are shown only inside that folder.",
            "Les photos classées dans un dossier apparaissent uniquement dans ce dossier.",
          )}
          icon={FileImage}
        />
      )}
      <form
        className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!file || uploading) return;
          await onUpload(
            file,
            title,
            selectedCategory?.code ?? "photo",
            selectedCategory?.id,
          );
          setFile(null);
          setTitle("");
          setCategoryId("");
          setFileInputKey((current) => current + 1);
        }}
      >
        <Field label={label(fr, "Image", "Image")} htmlFor="project-image">
          <Input
            id="project-image"
            type="file"
            accept="image/*"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Field>
        <Field
          label={label(fr, "Title", "Titre")}
          htmlFor="project-image-title"
        >
          <Input
            id="project-image-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field
          label={label(fr, "Document folder", "Dossier du document")}
          htmlFor="project-image-category"
        >
          <select
            id="project-image-category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
          >
            <option value="">
              {label(
                fr,
                "Uncategorised — file later",
                "Non classée — classer plus tard",
              )}
            </option>
            {activeCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit" disabled={!file || uploading} loading={uploading}>
          {label(fr, "Attach image", "Joindre l’image")}
        </Button>
      </form>
    </>
  );
}
function ConfirmDialog({
  request,
  fr,
  onCancel,
  onConfirm,
}: {
  request: ConfirmationRequest;
  fr: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const danger = request.tone === "danger";
  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-ink/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-confirmation-title"
    >
      <section className="w-full max-w-md rounded-2xl border border-border bg-surface-1 p-5 shadow-2xl">
        <div
          className={`grid size-11 place-items-center rounded-xl ${danger ? "bg-critical/15 text-critical" : "bg-brand-subtle text-brand"}`}
        >
          <AlertTriangle className="size-5" />
        </div>
        <h2
          id="project-confirmation-title"
          className="mt-4 text-lg font-semibold text-ink"
        >
          {request.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">
          {request.description}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {label(fr, "Cancel", "Annuler")}
          </Button>
          <Button
            type="button"
            variant={danger ? "destructive" : "primary"}
            onClick={onConfirm}
          >
            {request.confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}
function TaskDetailDialog({
  orgSlug,
  task,
  fr,
  locale,
  onClose,
  onEdit,
  onPreview,
}: {
  orgSlug: string;
  task: Row;
  fr: boolean;
  locale: string;
  onClose: () => void;
  onEdit?: () => void;
  onPreview: (document: Row) => void;
}) {
  const documents = useQuery({
    queryKey: ["task-documents", orgSlug, String(task.id)],
    queryFn: () =>
      ownerManagementApi.taskDocuments<{ documents: Row[] }>(
        orgSlug,
        String(task.id),
      ),
    select: (data) => data.documents,
  });
  const detail = (keys: string[]) =>
    keys
      .map((key) => task[key])
      .find((value) => value != null && String(value).trim()) ?? null;
  const status = detail(["status"]);
  const priority = detail(["priority"]);
  return (
    <div
      className="fixed inset-0 z-[80] overflow-y-auto bg-ink/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-task-detail-title"
    >
      <section className="mx-auto my-6 w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-2xl">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-surface-2 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[.13em] text-brand">
              {label(fr, "Project task", "Tâche du projet")}
            </p>
            <h2
              id="project-task-detail-title"
              className="mt-1 truncate text-xl font-semibold text-ink"
            >
              {String(task.title ?? task.name ?? "—")}
            </h2>
            <p className="mt-1 text-xs text-ink-secondary">
              {String(task.taskCode ?? task.code ?? "—")} ·{" "}
              {titleCase(task.taskType ?? "work")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onEdit ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onEdit}
              >
                <Pencil />
                {label(fr, "Edit", "Modifier")}
              </Button>
            ) : null}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={onClose}
              aria-label={label(fr, "Close", "Fermer")}
            >
              <X />
            </Button>
          </div>
        </header>
        <div className="max-h-[78vh] overflow-y-auto p-5">
          <div className="flex flex-wrap gap-2">
            {status ? (
              <Badge variant={statusVariant(status)}>{titleCase(status)}</Badge>
            ) : null}
            {priority ? (
              <Badge variant={statusVariant(priority)}>
                {titleCase(priority)}
              </Badge>
            ) : null}
            <Badge variant="neutral">
              {number(task.progressPercent).toFixed(0)}%
            </Badge>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <TaskDetailValue
              label={label(fr, "Project phase", "Phase du projet")}
              value={detail(["phaseName", "projectPhaseName"])}
            />
            <TaskDetailValue
              label={label(fr, "Assigned employee", "Employé affecté")}
              value={detail([
                "assignedEmployeeName",
                "assignedMemberName",
                "assigneeName",
              ])}
            />
            <TaskDetailValue
              label={label(fr, "Start date", "Date de début")}
              value={date(detail(["startDate"]), locale)}
            />
            <TaskDetailValue
              label={label(fr, "Due date", "Échéance")}
              value={date(detail(["dueDate"]), locale)}
            />
            <TaskDetailValue
              label={label(fr, "Estimated cost", "Coût estimé")}
              value={
                detail(["estimatedCost"]) == null
                  ? "—"
                  : `${number(detail(["estimatedCost"])).toLocaleString(locale)} ${String(task.currencyCode ?? "")}`.trim()
              }
            />
            <TaskDetailValue
              label={label(fr, "Actual cost", "Coût réel")}
              value={
                detail(["actualCost"]) == null
                  ? "—"
                  : `${number(detail(["actualCost"])).toLocaleString(locale)} ${String(task.currencyCode ?? "")}`.trim()
              }
            />
          </div>
          {detail(["blockedReason"]) ? (
            <section className="mt-5 rounded-xl border border-warning/35 bg-warning/10 p-4">
              <h3 className="text-sm font-semibold text-ink">
                {label(fr, "Blocked by / reason", "Blocage / raison")}
              </h3>
              <p className="mt-1 text-sm text-ink-secondary">
                {String(detail(["blockedReason"]))}
              </p>
            </section>
          ) : null}
          {detail(["description", "notes"]) ? (
            <section className="mt-5 rounded-xl border border-border bg-surface-2 p-4">
              <h3 className="text-sm font-semibold text-ink">
                {label(fr, "Description and notes", "Description et notes")}
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">
                {String(detail(["description", "notes"]))}
              </p>
            </section>
          ) : null}
          <section className="mt-5 rounded-xl border border-border bg-surface-2 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">
                  {label(fr, "Attached documents", "Documents joints")}
                </h3>
                <p className="mt-1 text-xs text-ink-secondary">
                  {label(
                    fr,
                    "Open a file to preview it without leaving this task.",
                    "Ouvrez un fichier pour le prévisualiser sans quitter cette tâche.",
                  )}
                </p>
              </div>
              <FileText className="size-5 text-brand" />
            </div>
            {documents.isPending ? (
              <Skeleton className="mt-4 h-16" />
            ) : documents.data?.length ? (
              <div className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface-1">
                {documents.data.map((document) => (
                  <button
                    key={String(document.id)}
                    type="button"
                    onClick={() => onPreview(document)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-surface-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">
                        {String(document.title ?? "—")}
                      </span>
                      <span className="mt-1 block truncate text-xs text-ink-secondary">
                        {String(
                          document.documentCategoryName ??
                            document.documentType ??
                            "—",
                        )}{" "}
                        · {String(document.mimeType ?? "—")}
                      </span>
                    </span>
                    <ArrowUpRight className="size-4 shrink-0 text-brand" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-lg border border-dashed border-border p-3 text-sm text-ink-secondary">
                {label(
                  fr,
                  "No document is linked to this task.",
                  "Aucun document n’est lié à cette tâche.",
                )}
              </p>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function TaskDetailValue({
  label: text,
  value,
}: {
  label: string;
  value: unknown;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <p className="text-xs font-medium text-ink-muted">{text}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ink">
        {value == null || value === "" ? "—" : String(value)}
      </p>
    </div>
  );
}

function ProjectDocumentPreviewDialog({
  orgSlug,
  document,
  fr,
  onClose,
  onEdit,
}: {
  orgSlug: string;
  document: Row;
  fr: boolean;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const previewUrl = orgApiUrl(orgSlug, `files/${String(document.id)}/preview`);
  const downloadUrl = orgApiUrl(
    orgSlug,
    `files/${String(document.id)}/download`,
  );
  const isImage = String(document.mimeType ?? "").startsWith("image/");
  const isPdf = String(document.mimeType ?? "") === "application/pdf";
  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-ink/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-document-preview-title"
    >
      <section className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-2xl">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface-2 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[.13em] text-brand">
              {label(fr, "Document preview", "Aperçu du document")}
            </p>
            <h2
              id="project-document-preview-title"
              className="mt-1 truncate text-lg font-semibold text-ink"
            >
              {String(
                document.title ??
                  label(fr, "Project document", "Document du projet"),
              )}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {onEdit ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onEdit}
              >
                <Pencil />
                {label(fr, "Edit access", "Modifier l’accès")}
              </Button>
            ) : null}
            <a
              href={downloadUrl}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface-1 px-3 text-xs font-semibold text-brand hover:bg-surface-3"
            >
              <Download className="size-3.5" />
              {label(fr, "Download", "Télécharger")}
            </a>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={onClose}
              aria-label={label(fr, "Close", "Fermer")}
            >
              <X />
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto bg-surface-3 p-4">
          {isImage ? (
            <img
              src={previewUrl}
              alt={String(document.title ?? "Project document")}
              className="mx-auto max-h-[72vh] max-w-full rounded-lg bg-surface-1 object-contain shadow-lg"
            />
          ) : isPdf ? (
            <iframe
              title={String(document.title ?? "Project document")}
              src={previewUrl}
              className="h-[72vh] w-full rounded-lg border border-border bg-surface-1"
            />
          ) : (
            <div className="grid min-h-72 place-items-center rounded-xl border border-dashed border-border-strong bg-surface-1 p-6 text-center">
              <div>
                <FileText className="mx-auto size-10 text-brand" />
                <p className="mt-3 text-sm font-semibold text-ink">
                  {String(document.mimeType ?? "Document")}
                </p>
                <p className="mt-1 text-sm text-ink-secondary">
                  {label(
                    fr,
                    "This file type cannot be previewed here. Download it to open it.",
                    "Ce type de fichier ne peut pas être prévisualisé ici. Téléchargez-le pour l’ouvrir.",
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
