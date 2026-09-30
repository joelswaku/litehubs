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
  CalendarDays,
  Calculator,
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
  Send,
  ShoppingCart,
  Target,
  Trash2,
  Unlock,
  Users,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import { ProjectAnalyticsArea } from "./project-analytics-area";
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
type BenefitTargets = {
  targetProductionQuantity?: number | string | null;
  targetProductionUnit?: string | null;
  targetProductionPeriod?: string | null;
  targetSalesAmount?: number | string | null;
  targetMarginPercent?: number | string | null;
  targetMortalityPercent?: number | string | null;
  targetUnitCost?: number | string | null;
};
type Tab =
  | "overview"
  | "planning"
  | "timeline"
  | "tasks"
  | "risks"
  | "quality"
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
  benefitOwnerMemberId?: string | null;
  benefitOwnerName?: string | null;
  operationalStartDate?: string | null;
  benefitReviewDate?: string | null;
  lifecycleStage?: string | null;
  benefitTargets?: BenefitTargets | null;
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
    allocated?: number | string;
    unallocated?: number | string;
    overallocated?: number | string;
    unassignedCommitted?: number | string;
    unassignedSpent?: number | string;
    spent: number | string;
    committed: number | string;
    taskEstimateReserve?: number | string;
    available: number | string;
    utilizationPercent?: number | string;
  };
  taskBudgets?: Array<{
    id: string;
    phaseId?: string | null;
    phaseName?: string | null;
    title: string;
    currencyCode?: string | null;
    planned: number | string;
    committed: number | string;
    spent: number | string;
    available: number | string;
    utilizationPercent: number | string;
    status: string;
  }>;
  materials?: Row[];
  phaseCosts?: Row[];
  operationalLinks?: Row[];
  productionProfitability?: {
    currencyCode: string;
    linkedFlockCount: number | string;
    costBreakdown?: Record<string, number | string>;
    operationalCost: number | string;
    declaredFlockPurchaseCost: number | string;
    revenue: number | string;
    cashReceived: number | string;
    outstandingRevenue: number | string;
    profit: number | string;
    marginPercent: number | string;
    eggsProduced: number | string;
    eggsSold: number | string;
    birdsSold: number | string;
    costPerEggProduced: number | string;
    costPerBirdSold?: number | string;
    revenuePerEggSold: number | string;
    flocks?: Array<
      Row & {
        costBreakdown?: Record<string, number | string>;
        operationalCost?: number | string;
        revenue?: number | string;
        cashReceived?: number | string;
        outstandingRevenue?: number | string;
        profit?: number | string;
        marginPercent?: number | string;
        eggsProduced?: number | string;
        eggsSold?: number | string;
        birdsSold?: number | string;
        costPerEggProduced?: number | string;
        costPerBirdSold?: number | string;
      }
    >;
  } | null;
  nextActions?: Row[];
  calculatedProgressPercent?: number | string;
  openTasks?: number | string;
  overdueTasks?: number | string;
};
type ProjectDecisionSimulation = {
  currencyCode: string;
  isProjection: boolean;
  assumptions: {
    eggPriceChangePercent: number;
    feedCostChangePercent: number;
    mortalityPercent: number;
    saleDelayDays: number;
    budgetChangePercent: number;
  };
  baseline: {
    revenue: number;
    operationalCost: number;
    operatingResult: number;
    plannedBudget: number;
    roiPercent: number | null;
  };
  impacts: {
    eggPriceRevenueChange: number;
    feedCostChange: number;
    mortalityRevenueLoss: number;
    budgetChange: number;
    saleDelayDays: number;
  };
  scenario: {
    revenue: number;
    operationalCost: number;
    operatingResult: number;
    investment: number;
    roiPercent: number | null;
    paybackDays: number | null;
    breakEvenRevenue: number;
    breakEvenPricePerEgg: number | null;
    unpaidRevenue: number;
    cashArrivalDelayDays: number;
  };
  method: { observedDays: number; eggRevenue: number; message: string };
};
type Place = {
  id: string;
  name: string;
  code?: string | null;
  province?: { id: string; code?: string | null; name?: string | null } | null;
};
type SelectOption = { value: string; text: string };
type ProcurementUnitOption = {
  value: string;
  french: string;
  english: string;
};
const PROCUREMENT_UNIT_OPTIONS: ProcurementUnitOption[] = [
  { value: "unité", french: "unité", english: "unit" },
  { value: "pièce", french: "pièce", english: "piece" },
  { value: "sac", french: "sac", english: "bag" },
  { value: "paquet", french: "paquet", english: "pack" },
  { value: "boîte", french: "boîte", english: "box" },
  { value: "kg", french: "kg", english: "kg" },
  { value: "g", french: "g", english: "g" },
  { value: "tonne", french: "tonne", english: "tonne" },
  { value: "litre", french: "litre", english: "litre" },
  { value: "mL", french: "mL", english: "mL" },
  { value: "m", french: "m", english: "m" },
  { value: "m²", french: "m²", english: "m²" },
  { value: "m³", french: "m³", english: "m³" },
  { value: "heure", french: "heure", english: "hour" },
  { value: "jour", french: "jour", english: "day" },
  { value: "mois", french: "mois", english: "month" },
  { value: "forfait", french: "forfait", english: "flat rate" },
  { value: "service", french: "service", english: "service" },
];
const tabIcon: Record<Tab, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  planning: Target,
  timeline: CalendarDays,
  tasks: ListChecks,
  risks: AlertTriangle,
  quality: ClipboardCheck,
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
  | "risk"
  | "quality-check"
  | "closeout"
  | "member"
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
type Editor = {
  kind: EditorKind;
  record?: Row;
  requestId?: string;
  orderId?: string;
  receiptId?: string;
} | null;
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
    english: "Individual pig (breeding / sold individually)",
    french: "Porc individuel (reproduction / vente individuelle)",
  },
  "pigs:groups": {
    path: "pigs/groups",
    permission: "pigs.groups.read",
    english: "Pig batch (fattening / sold by kg)",
    french: "Lot de porcs (engraissement / vente au kg)",
  },
  "pigs:pens": {
    path: "pigs/pens",
    permission: "pigs.pens.read",
    english: "Pig pen (building)",
    french: "Enclos porcin (bâtiment)",
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
  "agriculture:plantings": {
    path: "agriculture/plantings",
    permission: "agriculture.plantings.read",
    english: "Crop / planting (harvest sold or transformed)",
    french: "Culture / plantation (récolte vendue ou transformée)",
  },
} as const;

const OPERATIONAL_LINK_TYPES = [
  {
    value: "created_by_project",
    english: "Created by this project",
    french: "Créé grâce à ce projet",
  },
  {
    value: "acquired_for_project",
    english: "Acquired for this project",
    french: "Acquis pour ce projet",
  },
  {
    value: "built_for_project",
    english: "Built for this project",
    french: "Construit pour ce projet",
  },
  {
    value: "assigned_to_project",
    english: "Assigned to this project",
    french: "Affecté à ce projet",
  },
  {
    value: "land_acquisition",
    english: "Land acquired by this project",
    french: "Terrain acquis par ce projet",
  },
] as const;

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
  { resource: "risks", permission: "projects.read", projectFilter: true },
  {
    resource: "quality-checks",
    permission: "procurement.read",
    projectFilter: true,
  },
  {
    resource: "project-closeouts",
    permission: "projects.read",
    projectFilter: true,
  },
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
    timeline: label(fr, "Visual plan", "Planning visuel"),
    tasks: label(fr, "Tasks", "Tâches"),
    risks: label(fr, "Risks & decisions", "Risques & décisions"),
    quality: label(fr, "Quality & close-out", "Qualité & clôture"),
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
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [projectGovernanceOpen, setProjectGovernanceOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(
    null,
  );
  const [exportError, setExportError] = useState<unknown>(null);
  const [operationNotice, setOperationNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
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
  // The portfolio opens before any individual project so the owner can first read the company-wide picture.
  const activeId = projectId;
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
  const taskAssignees = useQuery({
    queryKey: ["project-task-assignees", orgSlug, activeId],
    queryFn: () =>
      ownerManagementApi.projectTaskAssignees<{ employees: Row[] }>(
        orgSlug,
        String(activeId),
      ),
    enabled:
      Boolean(activeId) &&
      canRead("projects.read") &&
      (canWrite("tasks.create") || canWrite("tasks.update")),
    select: (data) => data.employees,
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
  // The visual plan reads the same scoped records as the project workspace.
  // We fetch the wider visible portfolio only for the owner: this is what lets
  // a livestock milestone wait for a building phase in another project without
  // exposing another manager's project plan.
  const planningBoardEnabled =
    Boolean(activeId) &&
    ownerOnly &&
    (tab === "timeline" ||
      editor?.kind === "phase-dependency" ||
      editor?.kind === "task-dependency");
  const portfolioPhases = useQuery({
    queryKey: ["project-planning-phases", orgSlug],
    queryFn: () =>
      ownerManagementApi.list<{ records: Row[] }>(orgSlug, "phases", {
        limit: 200,
      }),
    enabled: planningBoardEnabled && canRead("projects.read"),
    select: (data) => data.records,
  });
  const portfolioTasks = useQuery({
    queryKey: ["project-planning-tasks", orgSlug],
    queryFn: () =>
      ownerManagementApi.list<{ records: Row[] }>(orgSlug, "tasks", {
        limit: 200,
      }),
    enabled: planningBoardEnabled && canRead("tasks.read"),
    select: (data) => data.records,
  });
  const portfolioPhaseDependencies = useQuery({
    queryKey: ["project-planning-phase-dependencies", orgSlug],
    queryFn: () =>
      ownerManagementApi.list<{ records: Row[] }>(
        orgSlug,
        "phase-dependencies",
        { limit: 200 },
      ),
    enabled: planningBoardEnabled && canRead("projects.read"),
    select: (data) => data.records,
  });
  const portfolioTaskDependencies = useQuery({
    queryKey: ["project-planning-task-dependencies", orgSlug],
    queryFn: () =>
      ownerManagementApi.list<{ records: Row[] }>(
        orgSlug,
        "task-dependencies",
        { limit: 200 },
      ),
    enabled: planningBoardEnabled && canRead("tasks.read"),
    select: (data) => data.records,
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
          phaseIds.has(String(record.phaseId)) ||
          phaseIds.has(String(record.dependsOnPhaseId)),
      );
    if (resource === "task-dependencies")
      return rows.filter(
        (record) =>
          taskIds.has(String(record.taskId)) ||
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
    // Project Managers assign operational work through the project-scoped
    // task-assignee endpoint above.  The unrestricted HR directory is needed
    // here only for owner-only project-governance controls.
    enabled: ownerOnly && canRead("employees.read"),
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
      }>(orgSlug),
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
  const budgetHistory = useQuery({
    queryKey: ["project-budget-history", orgSlug, activeId],
    queryFn: () =>
      ownerManagementApi.projectBudgetHistory<{ history: Row[] }>(
        orgSlug,
        String(activeId),
      ),
    enabled: Boolean(activeId) && canRead("projects.read"),
    select: (data) => data.history,
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
    // A warehouse can be created from the Inventory screen immediately before
    // opening this receipt form. Always refresh on entry so a previously empty
    // cached list cannot leave the receiver without a valid destination.
    staleTime: 0,
    refetchOnMount: "always",
    select: (data) => data.records,
  });
  // The receipt dialog may open after a warehouse was created elsewhere while
  // this project page stayed open. Re-fetch at that point instead of showing a
  // stale empty selector.
  useEffect(() => {
    if (editor?.kind === "receipt") void warehouses.refetch();
  }, [editor?.kind, warehouses.refetch]);
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
      queryKey: ["project-budget-history", orgSlug],
    });
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
      taskEvidence,
      expenseEvidence,
      assetPhoto,
      qualityBeforePhoto,
      qualityAfterPhoto,
    }: {
      resource: OwnerManagementResource;
      record?: Row;
      body: ManagementBody;
      taskDocuments?: { documentIds: string[] };
      taskEvidence?: File;
      expenseEvidence?: File;
      assetPhoto?: File;
      qualityBeforePhoto?: File;
      qualityAfterPhoto?: File;
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
      if (resource === "tasks" && taskEvidence) {
        const taskId = String(record?.id ?? result.record?.id ?? "");
        if (!taskId) throw new Error("The saved task has no identifier");
        const evidenceForm = new FormData();
        evidenceForm.set("file", taskEvidence);
        const taskTitle =
          String(result.record?.title ?? body.title ?? "Task").trim() || "Task";
        evidenceForm.set("title", `${taskTitle.slice(0, 170)} · evidence`);
        await api.post(
          orgApiUrl(orgSlug, `task-evidence/${taskId}`),
          evidenceForm,
          {
            headers: { "Content-Type": "multipart/form-data" },
          },
        );
        await client.invalidateQueries({
          queryKey: ["task-documents", orgSlug, taskId],
        });
      }
      if (resource === "expenses" && expenseEvidence) {
        const expenseId = String(record?.id ?? result.record?.id ?? "");
        if (!expenseId) throw new Error("The saved expense has no identifier");
        const uploadForm = new FormData();
        uploadForm.set("file", expenseEvidence);
        await api.post(
          orgApiUrl(orgSlug, `expense-evidence/${expenseId}`),
          uploadForm,
          {
            headers: { "Content-Type": "multipart/form-data" },
          },
        );
      }
      if (resource === "assets" && assetPhoto) {
        const assetId = String(record?.id ?? result.record?.id ?? "");
        if (!assetId) throw new Error("The saved equipment has no identifier");
        const current = await get<{ images: Row[] }>(
          orgUrl(orgSlug, `images/owner-management/assets/${assetId}`),
        );
        const photoForm = new FormData();
        photoForm.set("file", assetPhoto);
        photoForm.set(
          "title",
          `${String(result.record?.name ?? body.name ?? body.assetNumber ?? "Equipment")} · photo`,
        );
        photoForm.set(
          "altText",
          String(
            result.record?.name ?? body.name ?? body.assetNumber ?? "Equipment",
          ),
        );
        photoForm.set("imageType", "equipment_photo");
        await api.post(
          orgUrl(orgSlug, `images/owner-management/assets/${assetId}`),
          photoForm,
          { headers: { "Content-Type": "multipart/form-data" } },
        );
        await Promise.all(
          current.images
            .filter(
              (image) =>
                String(image.documentType ?? "") === "equipment_photo" ||
                String(image.title ?? "").endsWith(" · photo"),
            )
            .map((image) => api.delete(orgUrl(orgSlug, `images/${image.id}`))),
        );
      }
      if (
        resource === "quality-checks" &&
        (qualityBeforePhoto || qualityAfterPhoto)
      ) {
        const qualityId = String(record?.id ?? result.record?.id ?? "");
        if (!qualityId)
          throw new Error("The saved quality check has no identifier");
        const uploadQualityPhoto = async (
          file: File,
          stage: "before" | "after",
        ) => {
          const form = new FormData();
          form.set("file", file);
          form.set(
            "title",
            `${String(result.record?.checkNumber ?? body.checkNumber ?? "QC")} · ${stage === "before" ? "before inspection" : "after inspection"}`,
          );
          form.set(
            "altText",
            stage === "before"
              ? "Quality check before inspection"
              : "Quality check after inspection",
          );
          form.set("imageType", `quality_${stage}`);
          const uploaded = await api.post<{ image: Row }>(
            orgUrl(
              orgSlug,
              `images/owner-management/projects/${String(activeId)}`,
            ),
            form,
            { headers: { "Content-Type": "multipart/form-data" } },
          );
          return uploaded.data.image;
        };
        const [before, after] = await Promise.all([
          qualityBeforePhoto
            ? uploadQualityPhoto(qualityBeforePhoto, "before")
            : Promise.resolve(undefined),
          qualityAfterPhoto
            ? uploadQualityPhoto(qualityAfterPhoto, "after")
            : Promise.resolve(undefined),
        ]);
        const links: ManagementBody = {
          ...(before?.id ? { beforePhotoDocumentId: String(before.id) } : {}),
          ...(after?.id ? { afterPhotoDocumentId: String(after.id) } : {}),
        };
        if (Object.keys(links).length) {
          const patched = await ownerManagementApi.update<{ record: Row }>(
            orgSlug,
            "quality-checks",
            qualityId,
            links,
          );
          result.record = patched.record;
        }
      }
      return result;
    },
    onSuccess: (result, input) => {
      const savedRecord = (result as { record?: Row }).record;
      // Reflect a workflow decision immediately. The background refresh still
      // refetches the authoritative record and budget totals from the API.
      if (input.record && savedRecord?.id) {
        client.setQueryData<{ records: Row[] }>(
          ["project-record", orgSlug, activeId, input.resource],
          (previous) =>
            previous
              ? {
                  ...previous,
                  records: previous.records.map((item) =>
                    String(item.id) === String(savedRecord.id)
                      ? { ...item, ...savedRecord }
                      : item,
                  ),
                }
              : previous,
        );
      }
      refresh();
      setEditor(null);
      if (input.resource === "purchase-orders" && input.body.status === "sent")
        setOperationNotice({
          tone: "success",
          text: label(
            fr,
            "Purchase order marked as sent. Its total is now committed to the project budget; download its PDF to share it with the supplier.",
            "Bon de commande marqué comme envoyé. Son total est maintenant engagé dans le budget du projet ; téléchargez son PDF pour le transmettre au fournisseur.",
          ),
        });
      if (input.resource === "projects" && !input.record)
        setProjectId(
          (result as { record?: { id?: string } }).record?.id ?? null,
        );
    },
    onError: (error, input) => {
      if (input.resource !== "purchase-orders" || input.body.status !== "sent")
        return;
      setOperationNotice({
        tone: "error",
        text:
          error instanceof ApiError
            ? error.message
            : label(
                fr,
                "The purchase order could not be sent. Check its lines and budget, then try again.",
                "Le bon de commande n’a pas pu être envoyé. Vérifiez ses articles et son budget, puis réessayez.",
              ),
      });
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
  const folderLock = useMutation({
    mutationFn: ({
      categoryId,
      visibility,
    }: {
      categoryId: string;
      visibility: "company" | "owner_only";
    }) =>
      ownerManagementApi.updateDocumentCategory(orgSlug, categoryId, {
        visibility,
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["project-document-categories", orgSlug],
      });
      refresh();
    },
  });
  const returnPurchaseRequest = useMutation({
    mutationFn: async (request: Row) =>
      (
        await api.post(
          orgUrl(
            orgSlug,
            `owner-management/purchase-requests/${String(request.id)}/return-to-draft`,
          ),
          {},
        )
      ).data as { record: Row },
    onSuccess: () => refresh(),
  });
  const error =
    save.error ??
    upload.error ??
    classifyDocument.error ??
    folderLock.error ??
    exportError;
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
              <Button
                variant="ghost"
                className="border border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                onClick={() => setProjectGovernanceOpen(true)}
              >
                <ClipboardList className="size-4" />
                {label(fr, "Règlement des projets", "Project rules")}
              </Button>
              <Link
                href={`/${orgSlug}/project-analytics`}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/25 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <BarChart3 className="size-4" />
                {label(fr, "Analyse globale", "Global analytics")}
              </Link>
              {activeId ? (
                <Button
                  variant="ghost"
                  className="border border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                  onClick={() => setProjectId(null)}
                >
                  <BarChart3 className="size-4" />
                  {label(fr, "Vue portefeuille", "Portfolio view")}
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
      {operationNotice ? (
        <p
          className={`rounded-xl border px-4 py-3 text-sm ${operationNotice.tone === "success" ? "border-brand/35 bg-brand-subtle text-brand" : "border-critical/35 bg-critical/10 text-critical"}`}
          role={operationNotice.tone === "error" ? "alert" : "status"}
        >
          {operationNotice.text}
        </p>
      ) : message ? (
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
                budgetChanges={budgetHistory.data ?? []}
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
                    "timeline",
                    "tasks",
                    "risks",
                    "quality",
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
                    budgetChanges={budgetHistory.data ?? []}
                    portfolioProjects={projects.data ?? []}
                    portfolioPhases={portfolioPhases.data ?? records("phases")}
                    portfolioTasks={portfolioTasks.data ?? records("tasks")}
                    portfolioPhaseDependencies={
                      portfolioPhaseDependencies.data ??
                      records("phase-dependencies")
                    }
                    portfolioTaskDependencies={
                      portfolioTaskDependencies.data ??
                      records("task-dependencies")
                    }
                    fr={fr}
                    locale={locale}
                    canWrite={canWrite}
                    canControl={canControl}
                    onSubmitPurchaseRequest={(request) =>
                      save.mutate({
                        resource: "purchase-requests",
                        record: request,
                        body: { status: "submitted" },
                      })
                    }
                    onSendPurchaseOrder={(order) =>
                      save.mutate({
                        resource: "purchase-orders",
                        record: order,
                        body: { status: "sent" },
                      })
                    }
                    onReturnPurchaseRequest={(request) =>
                      returnPurchaseRequest.mutate(request)
                    }
                    onCancelPurchaseOrder={(order) =>
                      save.mutate({
                        resource: "purchase-orders",
                        record: order,
                        body: { status: "cancelled" },
                      })
                    }
                    onConfirmReceipt={(receipt) =>
                      save.mutate({
                        resource: "receipts",
                        record: receipt,
                        body: { status: "received" },
                      })
                    }
                    onRejectReceipt={(receipt) =>
                      save.mutate({
                        resource: "receipts",
                        record: receipt,
                        body: { status: "rejected" },
                      })
                    }
                    onVerifyReceipt={(receipt) =>
                      save.mutate({
                        resource: "receipts",
                        record: receipt,
                        body: { status: "verified" },
                      })
                    }
                    onCancelReceipt={(receipt) =>
                      save.mutate({
                        resource: "receipts",
                        record: receipt,
                        body: { status: "cancelled" },
                      })
                    }
                    onReopenReceipt={(receipt) =>
                      save.mutate({
                        resource: "receipts",
                        record: receipt,
                        body: { status: "draft" },
                      })
                    }
                    onOpenSimulation={() => setSimulationOpen(true)}
                    setEditor={setEditor}
                    onConfigureDocument={setAccessDocument}
                    onManageDocumentCategories={() =>
                      setCategoryManagerOpen(true)
                    }
                    onToggleDocumentFolderLock={(categoryId, visibility) => {
                      const locking = visibility === "owner_only";
                      setConfirmation({
                        title: locking
                          ? label(fr, "Lock folder", "Verrouiller le dossier")
                          : label(
                              fr,
                              "Unlock folder",
                              "Déverrouiller le dossier",
                            ),
                        description: locking
                          ? label(
                              fr,
                              "Only the company owner will be able to see, add, preview or download files in this folder.",
                              "Seul le propriétaire pourra voir, ajouter, prévisualiser ou télécharger les fichiers de ce dossier.",
                            )
                          : label(
                              fr,
                              "Users with document permission will regain access to this folder and its files.",
                              "Les utilisateurs autorisés à voir les documents retrouveront l’accès à ce dossier et à ses fichiers.",
                            ),
                        confirmLabel: locking
                          ? label(fr, "Lock folder", "Verrouiller")
                          : label(fr, "Unlock folder", "Déverrouiller"),
                        tone: locking ? "danger" : "primary",
                        onConfirm: () =>
                          void folderLock.mutate({ categoryId, visibility }),
                      });
                    }}
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
            <ProjectAnalyticsArea
              orgSlug={orgSlug}
              embedded
              onSelectProject={(id) => {
                setProjectId(id);
                setTab("overview");
              }}
            />
          )}
        </div>
      </section>
      {taskDetail ? (
        <TaskDetailDialog
          orgSlug={orgSlug}
          task={taskDetail}
          budgetChanges={budgetHistory.data ?? []}
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
      {simulationOpen && selected ? (
        <ProjectDecisionSimulationDialog
          orgSlug={orgSlug}
          project={selected}
          fr={fr}
          locale={locale}
          onClose={() => setSimulationOpen(false)}
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
      {projectGovernanceOpen ? (
        <ProjectGovernanceDialog
          fr={fr}
          onClose={() => setProjectGovernanceOpen(false)}
        />
      ) : null}
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
          portfolioProjects={projects.data ?? []}
          portfolioPhases={portfolioPhases.data ?? records("phases")}
          portfolioTasks={portfolioTasks.data ?? records("tasks")}
          budgets={records("budget-lines")}
          documents={records("documents")}
          materials={records("materials")}
          assets={records("assets")}
          requests={records("purchase-requests")}
          requestLines={records("purchase-request-lines")}
          orders={records("purchase-orders")}
          orderLines={records("purchase-order-lines")}
          receipts={records("receipts")}
          receiptLines={records("receipt-lines")}
          expenses={records("expenses")}
          workOrders={records("maintenance-work-orders")}
          vehicleProfiles={records("vehicle-profiles")}
          maintenancePlans={records("maintenance-plans")}
          suppliers={suppliers.data ?? []}
          warehouses={warehouses.data ?? []}
          inventoryItems={inventoryItems.data ?? []}
          sites={sites.data ?? []}
          provinces={provinces.data ?? []}
          members={memberOptions}
          taskAssignees={taskAssignees.data ?? []}
          fr={fr}
          isOwner={ownerOnly}
          working={save.isPending}
          onClose={() => setEditor(null)}
          onSave={(
            resource,
            body,
            taskDocuments,
            expenseEvidence,
            assetPhoto,
            taskEvidence,
            qualityBeforePhoto,
            qualityAfterPhoto,
          ) =>
            save
              .mutateAsync({
                resource,
                record: editor.record,
                body,
                taskDocuments,
                expenseEvidence,
                assetPhoto,
                taskEvidence,
                qualityBeforePhoto,
                qualityAfterPhoto,
              })
              .then(() => undefined)
          }
        />
      ) : null}
    </main>
  );
}

function ProjectGovernanceDialog({
  fr,
  onClose,
}: {
  fr: boolean;
  onClose: () => void;
}) {
  const rules = [
    {
      title: label(fr, "Gouvernance", "Governance"),
      text: label(
        fr,
        "Seul le propriétaire crée, valide le budget principal, clôture ou annule un projet.",
        "Only the owner creates a project, approves its main budget, closes or cancels it.",
      ),
    },
    {
      title: label(fr, "Fiche obligatoire", "Required project record"),
      text: label(
        fr,
        "Chaque projet doit avoir un objectif mesurable, un site, une province, un responsable, un budget principal et une étape de cycle claire.",
        "Every project needs a measurable objective, site, province, responsible manager, main budget and clear lifecycle stage.",
      ),
    },
    {
      title: label(fr, "Accès par rôle", "Role-based access"),
      text: label(
        fr,
        "Le Project Manager ne gère que les projets qui lui sont attribués. Il ne valide ni le budget principal ni ses propres demandes.",
        "A Project Manager manages only assigned projects and cannot approve the main budget or their own requests.",
      ),
    },
    {
      title: label(fr, "Budget et dépenses", "Budget and costs"),
      text: label(
        fr,
        "Le budget du projet est unique. Toute dépense est liée à une tâche lorsque possible ; les dépenses sans tâche restent visibles comme non affectées.",
        "Each project has one budget. Costs are linked to a task where possible; costs without a task remain visible as unassigned.",
      ),
    },
    {
      title: label(fr, "Achats et réceptions", "Procurement and receiving"),
      text: label(
        fr,
        "La chaîne contrôlée est : demande → approbation → bon de commande → réception → stock ou ressource. Un paiement fournisseur ne compte jamais une seconde fois.",
        "The controlled chain is: request → approval → purchase order → receipt → stock or resource. A supplier payment is never counted twice.",
      ),
    },
    {
      title: label(fr, "Qualité et preuves", "Quality and evidence"),
      text: label(
        fr,
        "Chaque réception indique les quantités acceptées, endommagées, refusées ou retournées et peut contenir photos, factures et bons de livraison.",
        "Every receipt records accepted, damaged, rejected or returned quantities and may contain photos, invoices and delivery notes.",
      ),
    },
    {
      title: label(fr, "Passage à l’exploitation", "Transition to operations"),
      text: label(
        fr,
        "Les actifs, animaux, matériaux et aliments restent uniques dans l’entreprise. Après mise en service, le projet suit production, ventes, encaissements et bénéfice/perte.",
        "Assets, animals, materials and feed remain unique in the company. After commissioning, the project follows production, sales, collections and profit/loss.",
      ),
    },
    {
      title: label(fr, "Clôture et traçabilité", "Close-out and traceability"),
      text: label(
        fr,
        "La clôture exige les tâches importantes terminées, les réceptions contrôlées, les preuves classées et l’évaluation du résultat attendu. Les décisions et changements sont audités.",
        "Close-out requires key tasks completed, receipts controlled, evidence filed and the expected result assessed. Decisions and changes are audited.",
      ),
    },
  ];
  return (
    <div
      className="fixed inset-0 z-[80] overflow-y-auto bg-ink/50 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={label(fr, "Project management rules", "Règlement de gestion des projets")}
    >
      <section className="mx-auto my-3 w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-2xl sm:my-8">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-surface-1/95 px-5 py-4 backdrop-blur sm:px-6">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-brand">
              <ShieldCheck className="size-4" />
              Congo Omega · LiteHubs
            </p>
            <h2 className="mt-1 text-xl font-semibold text-ink">
              {label(fr, "Règlement de gestion des projets", "Project management rules")}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-secondary">
              {label(
                fr,
                "Le cadre interne à respecter avant, pendant et après chaque investissement.",
                "The internal framework to follow before, during and after every investment.",
              )}
            </p>
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={onClose}
            aria-label={label(fr, "Fermer", "Close")}
          >
            <X />
          </Button>
        </header>
        <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
          {rules.map((rule, index) => (
            <article
              key={rule.title}
              className="rounded-xl border border-border bg-surface-2 p-4"
            >
              <div className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand/10 text-xs font-bold text-brand">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-ink">{rule.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-ink-secondary">
                    {rule.text}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
        <footer className="flex justify-end border-t border-border bg-surface-2 px-5 py-4 sm:px-6">
          <Button type="button" onClick={onClose}>
            {label(fr, "J’ai compris", "I understand")}
          </Button>
        </footer>
      </section>
    </div>
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
                    {projectStatusLabel(project.status, fr)}
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

const projectTypeLabel = (value: unknown, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    land: ["Land", "Terrain"],
    construction: ["Construction", "Construction"],
    expansion: ["Expansion", "Extension"],
    infrastructure: ["Infrastructure", "Infrastructure"],
    equipment: ["Equipment", "Équipement"],
    livestock: ["Livestock", "Bétail"],
    housing: ["Housing", "Habitat"],
    technology: ["Technology", "Technologie"],
    maintenance: ["Maintenance", "Maintenance"],
    mixed_investment: ["Mixed investment", "Investissement mixte"],
    other: ["Other", "Autre"],
  };
  const item = labels[String(value)];
  return item ? (fr ? item[1] : item[0]) : titleCase(value);
};
const projectStatusLabel = (value: unknown, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    draft: ["Draft", "Brouillon"],
    planning: ["Planning", "Planification"],
    pending_approval: ["Pending approval", "En attente d’approbation"],
    approved: ["Approved", "Approuvé"],
    in_progress: ["In progress", "En cours"],
    on_hold: ["On hold", "En pause"],
    completed: ["Completed", "Terminé"],
    cancelled: ["Cancelled", "Annulé"],
  };
  const item = labels[String(value)];
  return item ? (fr ? item[1] : item[0]) : titleCase(value);
};
const investmentLifecycleLabel = (value: unknown, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    investment: ["Investment", "Investissement"],
    commissioning: ["Commissioning", "Mise en service"],
    operating: ["Operating", "Exploitation"],
    closed: ["Closed", "Clôturé"],
  };
  const item = labels[String(value ?? "investment")];
  return item ? (fr ? item[1] : item[0]) : titleCase(value ?? "investment");
};
const investmentLifecycleVariant = (value: unknown) => {
  const stage = String(value ?? "investment");
  return stage === "operating"
    ? ("good" as const)
    : stage === "commissioning"
      ? ("info" as const)
      : stage === "closed"
        ? ("neutral" as const)
        : ("warning" as const);
};
const projectPriorityLabel = (value: unknown, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    low: ["Low", "Faible"],
    medium: ["Medium", "Moyenne"],
    high: ["High", "Élevée"],
    critical: ["Critical", "Critique"],
  };
  const item = labels[String(value)];
  return item ? (fr ? item[1] : item[0]) : titleCase(value);
};

function ProjectHeader({
  project,
  summary,
  budgetChanges,
  fr,
  locale,
  onEdit,
  onExport,
  onExportPdf,
}: {
  project: Project;
  summary?: Summary;
  budgetChanges: Row[];
  fr: boolean;
  locale: string;
  onEdit?: () => void;
  onExport?: () => void;
  onExportPdf?: () => void;
}) {
  const latestBudgetAdjustment = budgetChanges.flatMap((event) => {
    if (String(event.entityType) !== "budget_change") return [];
    try {
      const change = JSON.parse(String(event.status ?? "")) as Record<
        string,
        unknown
      >;
      const before = Number(change.before ?? 0);
      const after = Number(change.after ?? 0);
      return String(change.scope) === "project" &&
        Number.isFinite(before) &&
        Number.isFinite(after)
        ? [{ before, after }]
        : [];
    } catch {
      return [];
    }
  })[0];
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
              {projectStatusLabel(project.status, fr)}
            </Badge>
            <Badge
              variant={investmentLifecycleVariant(
                summary?.lifecycleStage ?? project.lifecycleStage,
              )}
            >
              {investmentLifecycleLabel(
                summary?.lifecycleStage ?? project.lifecycleStage,
                fr,
              )}
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
              {projectPriorityLabel(project.priority, fr)}
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
                  "Add this investment’s goal, scope and expected outcome.",
                  "Ajoutez le but, le périmètre et le résultat attendu de cet investissement.",
                ),
            )}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-emerald-50/85">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/10 px-2.5 py-1.5">
              <FolderKanban className="size-3.5" />
              {projectTypeLabel(project.projectType, fr)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/10 px-2.5 py-1.5">
              <Clock3 className="size-3.5" />
              {label(fr, "Target", "Échéance")} ·{" "}
              {date(project.targetCompletionDate, locale)}
            </span>
            {project.siteId ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/10 px-2.5 py-1.5">
                <MapPin className="size-3.5" />
                {label(fr, "Site assigned", "Site défini")}
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
              {label(fr, "Edit", "Modifier")}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="relative mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label={label(fr, "Planned budget", "Budget prévu")}
          value={money(summary?.budget?.planned, project.currencyCode, locale)}
          hint={
            latestBudgetAdjustment ? (
              <>
                {label(fr, "Last adjustment", "Dernier ajustement")} ·{" "}
                {money(
                  latestBudgetAdjustment.before,
                  project.currencyCode,
                  locale,
                )}{" "}
                →{" "}
                {money(
                  latestBudgetAdjustment.after,
                  project.currencyCode,
                  locale,
                )}
              </>
            ) : undefined
          }
          icon={Wallet}
          inverse
        />
        <Metric
          label={label(fr, "Spent", "Dépensé")}
          value={money(summary?.budget?.spent, project.currencyCode, locale)}
          icon={BadgeDollarSign}
          inverse
        />
        <Metric
          label={label(fr, "Committed", "Engagé")}
          value={money(
            summary?.budget?.committed,
            project.currencyCode,
            locale,
          )}
          icon={ReceiptText}
          inverse
        />
        <Metric
          label={label(fr, "Available", "Disponible")}
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

function InvestmentProfilePanel({
  project,
  summary,
  fr,
  locale,
  onEdit,
}: {
  project: Project;
  summary?: Summary;
  fr: boolean;
  locale: string;
  onEdit?: () => void;
}) {
  const profile = summary ?? project;
  const targets = profile.benefitTargets ?? {};
  const productionQuantity = targets.targetProductionQuantity;
  const hasProduction =
    productionQuantity != null && Number.isFinite(Number(productionQuantity));
  const kpis = [
    hasProduction
      ? {
          label: label(fr, "Production target", "Production cible"),
          value: `${number(productionQuantity).toLocaleString(locale)} ${String(targets.targetProductionUnit ?? "").trim()} / ${
            (
              {
                daily: label(fr, "day", "jour"),
                weekly: label(fr, "week", "semaine"),
                monthly: label(fr, "month", "mois"),
                cycle: label(fr, "cycle", "cycle"),
              } as Record<string, string>
            )[String(targets.targetProductionPeriod)] ?? "—"
          }`,
        }
      : null,
    targets.targetSalesAmount != null &&
    Number.isFinite(Number(targets.targetSalesAmount))
      ? {
          label: label(fr, "Sales target", "Ventes cibles"),
          value: money(targets.targetSalesAmount, profile.currencyCode, locale),
        }
      : null,
    targets.targetMarginPercent != null &&
    Number.isFinite(Number(targets.targetMarginPercent))
      ? {
          label: label(fr, "Target margin", "Marge cible"),
          value: `${number(targets.targetMarginPercent).toLocaleString(locale)}%`,
        }
      : null,
    targets.targetMortalityPercent != null &&
    Number.isFinite(Number(targets.targetMortalityPercent))
      ? {
          label: label(fr, "Maximum mortality", "Mortalité maximale"),
          value: `${number(targets.targetMortalityPercent).toLocaleString(locale)}%`,
        }
      : null,
    targets.targetUnitCost != null &&
    Number.isFinite(Number(targets.targetUnitCost))
      ? {
          label: label(fr, "Target unit cost", "Coût unitaire cible"),
          value: money(targets.targetUnitCost, profile.currencyCode, locale),
        }
      : null,
  ].filter((item): item is { label: string; value: string } => item !== null);

  return (
    <Panel
      title={label(fr, "Investment profile", "Fiche d’investissement")}
      subtitle={label(
        fr,
        "Keep the intended result and its owner visible from investment through operations.",
        "Gardez le résultat attendu et sa responsabilité visibles de l’investissement à l’exploitation.",
      )}
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant={investmentLifecycleVariant(profile.lifecycleStage)}>
            {investmentLifecycleLabel(profile.lifecycleStage, fr)}
          </Badge>
          {onEdit ? (
            <Button size="sm" variant="secondary" onClick={onEdit}>
              <Pencil className="size-3.5" />
              {label(fr, "Edit profile", "Modifier la fiche")}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="rounded-xl border border-brand/20 bg-brand-subtle/35 p-4">
        <p className="text-xs font-semibold uppercase tracking-[.1em] text-brand">
          {label(fr, "Expected outcome", "Objectif attendu")}
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink">
          {String(
            profile.expectedOutcome ??
              label(
                fr,
                "Add a measurable outcome, for example 10,000 eggs each month or a 500-bird house.",
                "Ajoutez un résultat mesurable, par exemple 10 000 œufs par mois ou un bâtiment de 500 poules.",
              ),
          )}
        </p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Info
          label={label(fr, "Lifecycle stage", "Étape du cycle")}
          value={investmentLifecycleLabel(profile.lifecycleStage, fr)}
        />
        <Info
          label={label(fr, "Operational start", "Démarrage opérationnel")}
          value={date(profile.operationalStartDate, locale)}
        />
        <Info
          label={label(fr, "Benefit owner", "Responsable des bénéfices")}
          value={String(profile.benefitOwnerName ?? "—")}
        />
        <Info
          label={label(fr, "Benefit review", "Revue des bénéfices")}
          value={date(profile.benefitReviewDate, locale)}
        />
      </div>
      {profile.fundingSource ? (
        <div className="mt-3">
          <Info
            label={label(fr, "Funding source", "Source de financement")}
            value={String(profile.fundingSource)}
          />
        </div>
      ) : null}
      <div className="mt-5 border-t border-border pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-ink">
            {label(fr, "Target indicators", "Indicateurs cibles")}
          </p>
          <p className="text-xs text-ink-muted">
            {label(
              fr,
              "Compared with actual operations and sales after commissioning.",
              "Comparés aux opérations et ventes réelles après la mise en service.",
            )}
          </p>
        </div>
        {kpis.length ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {kpis.map((kpi) => (
              <div
                key={kpi.label}
                className="rounded-xl border border-border bg-surface-2/70 px-3 py-3"
              >
                <p className="text-xs text-ink-muted">{kpi.label}</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
                  {kpi.value}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-secondary">
            {label(
              fr,
              "No target indicators yet. Add them from Edit to compare the investment with real production, sales and margin.",
              "Aucun indicateur cible pour le moment. Ajoutez-les avec Modifier afin de comparer l’investissement à la production, aux ventes et à la marge réelles.",
            )}
          </p>
        )}
      </div>
    </Panel>
  );
}

function ProjectRiskRegister({
  rows,
  fr,
  locale,
  canCreate,
  canEdit,
  onAdd,
  onEdit,
}: {
  rows: Row[];
  fr: boolean;
  locale: string;
  canCreate: boolean;
  canEdit: boolean;
  onAdd: () => void;
  onEdit: (record: Row) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const open = rows.filter((row) => String(row.status) !== "closed");
  const triggered = rows.filter((row) => String(row.status) === "triggered");
  const overdue = open.filter(
    (row) => String(row.reviewDate ?? "").slice(0, 10) < today,
  );
  const decided = rows.filter((row) => String(row.decision) !== "pending");
  const categoryLabel = (value: unknown) => {
    const labels: Record<string, [string, string]> = {
      disease: ["Disease", "Maladie"],
      supplier_delay: ["Supplier delay", "Retard fournisseur"],
      commodity_price: ["Commodity price", "Hausse du maïs / prix"],
      water: ["Water", "Manque d’eau"],
      theft: ["Theft", "Vol"],
      permit: ["Permit", "Permis"],
      weather: ["Weather", "Météo"],
      other: ["Other", "Autre"],
    };
    const choice = labels[String(value)] ?? [
      titleCase(value),
      titleCase(value),
    ];
    return fr ? choice[1] : choice[0];
  };
  const statusLabel = (value: unknown) => {
    const labels: Record<string, [string, string]> = {
      open: ["Open", "Ouvert"],
      monitoring: ["Monitoring", "Surveillance"],
      triggered: ["Triggered", "Déclenché"],
      mitigating: ["Mitigating", "En traitement"],
      accepted: ["Accepted", "Accepté"],
      closed: ["Closed", "Clôturé"],
    };
    const choice = labels[String(value)] ?? [
      titleCase(value),
      titleCase(value),
    ];
    return fr ? choice[1] : choice[0];
  };
  const decisionLabel = (value: unknown) => {
    const labels: Record<string, [string, string]> = {
      pending: ["No decision yet", "Aucune décision"],
      monitor: ["Monitor", "Surveiller"],
      mitigate: ["Mitigate", "Réduire le risque"],
      avoid: ["Avoid", "Éviter"],
      transfer: ["Transfer", "Transférer"],
      accept: ["Accept", "Accepter"],
      escalate: ["Escalate", "Escalader"],
    };
    const choice = labels[String(value)] ?? [
      titleCase(value),
      titleCase(value),
    ];
    return fr ? choice[1] : choice[0];
  };
  const severity = (row: Row) => {
    const probability =
      { low: 1, medium: 2, high: 3 }[String(row.probability)] ?? 2;
    const impact =
      { low: 1, medium: 2, high: 3, critical: 4 }[String(row.impact)] ?? 2;
    const score = probability * impact;
    if (score >= 9)
      return { label: label(fr, "High", "Élevé"), variant: "serious" as const };
    if (score >= 4)
      return {
        label: label(fr, "Attention", "Attention"),
        variant: "warning" as const,
      };
    return {
      label: label(fr, "Controlled", "Maîtrisé"),
      variant: "info" as const,
    };
  };
  const statusVariantFor = (row: Row) =>
    String(row.status) === "triggered"
      ? ("critical" as const)
      : String(row.status) === "closed"
        ? ("good" as const)
        : String(row.status) === "mitigating"
          ? ("info" as const)
          : ("warning" as const);

  return (
    <section className="mt-5 space-y-5">
      <Panel
        title={label(fr, "Risks & decisions", "Risques & décisions")}
        subtitle={label(
          fr,
          "Give every risk or issue a responsible person, a measurable trigger, an action and a dated decision.",
          "Donnez à chaque risque ou problème un responsable, un déclencheur mesurable, une action et une décision datée.",
        )}
        icon={AlertTriangle}
        action={
          canCreate ? (
            <Button size="sm" onClick={onAdd}>
              <Plus />
              {label(fr, "Add risk", "Ajouter un risque")}
            </Button>
          ) : undefined
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [
              label(fr, "Open register", "Registre ouvert"),
              open.length,
              "bg-brand/10 text-brand",
            ],
            [
              label(fr, "Triggered", "Déclenchés"),
              triggered.length,
              "bg-critical/10 text-critical",
            ],
            [
              label(fr, "Review overdue", "Revue en retard"),
              overdue.length,
              "bg-warning/15 text-ink",
            ],
            [
              label(fr, "Decisions recorded", "Décisions tracées"),
              decided.length,
              "bg-good/10 text-good-ink dark:text-good",
            ],
          ].map(([title, value, tone]) => (
            <div key={String(title)} className={`rounded-xl px-4 py-3 ${tone}`}>
              <p className="text-xs font-medium">{title}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {String(value)}
              </p>
            </div>
          ))}
        </div>
      </Panel>

      {rows.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {rows.map((risk) => {
            const due =
              String(risk.status) !== "closed" &&
              String(risk.reviewDate ?? "").slice(0, 10) < today;
            const level = severity(risk);
            return (
              <article
                key={risk.id}
                className={`rounded-2xl border bg-surface-1 shadow-[0_15px_32px_-28px_rgba(15,38,63,.7)] ${String(risk.status) === "triggered" ? "border-critical/45" : due ? "border-warning/55" : "border-border"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 bg-surface-2/45 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold tracking-[.08em] text-ink-muted">
                        {String(risk.code ?? "RSK")}
                      </p>
                      <Badge variant="outline">
                        {categoryLabel(risk.category)}
                      </Badge>
                      <Badge variant={level.variant}>{level.label}</Badge>
                    </div>
                    <h3 className="mt-2 text-base font-semibold text-ink">
                      {String(risk.title ?? "—")}
                    </h3>
                    {risk.description ? (
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-ink-secondary">
                        {String(risk.description)}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariantFor(risk)}>
                      {statusLabel(risk.status)}
                    </Badge>
                    {canEdit ? (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => onEdit(risk)}
                        aria-label={label(
                          fr,
                          "Edit risk",
                          "Modifier le risque",
                        )}
                      >
                        <Pencil />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="grid gap-3 p-5 sm:grid-cols-2">
                  <div className="rounded-xl bg-surface-2 p-3">
                    <p className="text-xs font-medium text-ink-muted">
                      {label(fr, "Responsible", "Responsable")}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
                      <Users className="size-3.5 text-brand" />
                      {String(risk.ownerName ?? "—")}
                    </p>
                    <p className="mt-2 text-xs text-ink-secondary">
                      {label(fr, "Probability", "Probabilité")} ·{" "}
                      {titleCase(risk.probability)} &nbsp;{" "}
                      {label(fr, "Impact", "Impact")} · {titleCase(risk.impact)}
                    </p>
                  </div>
                  <div
                    className={`rounded-xl p-3 ${due ? "bg-warning/15" : "bg-surface-2"}`}
                  >
                    <p className="text-xs font-medium text-ink-muted">
                      {label(fr, "Review deadline", "Échéance de revue")}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
                      <Clock3 className="size-3.5 text-brand" />
                      {date(risk.reviewDate, locale)}
                    </p>
                    {due ? (
                      <p className="mt-2 text-xs font-semibold text-ink">
                        {label(
                          fr,
                          "Review required now",
                          "Revue requise maintenant",
                        )}
                      </p>
                    ) : null}
                  </div>
                  <div className="rounded-xl border border-border bg-surface-1 p-3 sm:col-span-2">
                    <p className="text-xs font-medium text-ink-muted">
                      {label(
                        fr,
                        "Trigger and alert threshold",
                        "Déclencheur et seuil d’alerte",
                      )}
                    </p>
                    <p className="mt-1 text-sm font-medium text-ink">
                      {String(risk.triggerCondition ?? "—")}
                    </p>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {String(risk.alertThreshold ?? "—")}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-surface-1 p-3 sm:col-span-2">
                    <p className="text-xs font-medium text-ink-muted">
                      {label(fr, "Preventive action", "Action de prévention")}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">
                      {String(risk.preventionAction ?? "—")}
                    </p>
                    {risk.contingencyAction ? (
                      <p className="mt-2 text-xs leading-5 text-ink-secondary">
                        <span className="font-semibold text-ink">
                          {label(fr, "If triggered: ", "Si déclenché : ")}
                        </span>
                        {String(risk.contingencyAction)}
                      </p>
                    ) : null}
                  </div>
                  <div className="rounded-xl border border-brand/20 bg-brand-subtle/30 p-3 sm:col-span-2">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                      <ShieldCheck className="size-3.5 text-brand" />
                      {label(fr, "Decision", "Décision")}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {decisionLabel(risk.decision)}
                    </p>
                    {risk.decisionTaken ? (
                      <p className="mt-1 text-sm text-ink">
                        {String(risk.decisionTaken)}
                      </p>
                    ) : null}
                    {risk.decisionJustification ? (
                      <p className="mt-1 text-xs leading-5 text-ink-secondary">
                        {String(risk.decisionJustification)}
                        {risk.decidedByName
                          ? ` · ${String(risk.decidedByName)}`
                          : ""}
                        {risk.decidedAt
                          ? ` · ${date(risk.decidedAt, locale)}`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Panel
          title={label(fr, "No risk recorded", "Aucun risque enregistré")}
          subtitle={label(
            fr,
            "Start with the risks that could delay, cost or stop this project.",
            "Commencez par les risques pouvant retarder, coûter ou arrêter ce projet.",
          )}
          icon={ShieldCheck}
          action={
            canCreate ? (
              <Button size="sm" onClick={onAdd}>
                <Plus />
                {label(fr, "Add risk", "Ajouter un risque")}
              </Button>
            ) : undefined
          }
        >
          <p className="text-sm leading-6 text-ink-secondary">
            {label(
              fr,
              "For example: disease, a supplier delay, water shortage, permit or weather risk. Each entry must name the person responsible and the preventive action.",
              "Par exemple : maladie, retard fournisseur, manque d’eau, permis ou météo. Chaque entrée doit nommer le responsable et l’action de prévention.",
            )}
          </p>
        </Panel>
      )}
    </section>
  );
}

function ProjectQualityCloseout({
  project,
  checks,
  closeout,
  receipts,
  receiptLines,
  assets,
  documents,
  fr,
  locale,
  canCreateCheck,
  canEditCheck,
  canClose,
  onAddCheck,
  onEditCheck,
  onPrepareCloseout,
}: {
  project: Project;
  checks: Row[];
  closeout: Row | null;
  receipts: Row[];
  receiptLines: Row[];
  assets: Row[];
  documents: Row[];
  fr: boolean;
  locale: string;
  canCreateCheck: boolean;
  canEditCheck: boolean;
  canClose: boolean;
  onAddCheck: () => void;
  onEditCheck: (record: Row) => void;
  onPrepareCloseout: () => void;
}) {
  const documentNames = new Map(
    documents.map((document) => [
      String(document.id),
      String(document.title ?? "—"),
    ]),
  );
  const checksByReceipt = new Map(
    checks
      .filter((check) => check.receiptId)
      .map((check) => [String(check.receiptId), check]),
  );
  const checksByAsset = new Map(
    checks
      .filter((check) => check.assetId)
      .map((check) => [String(check.assetId), check]),
  );
  const receptionRows = receipts.filter((receipt) =>
    ["received", "verified"].includes(String(receipt.status)),
  );
  const pendingChecks = receptionRows.filter((receipt) => {
    const status = String(
      checksByReceipt.get(String(receipt.id))?.qualityStatus ?? "pending",
    );
    return !["accepted", "accepted_with_observations"].includes(status);
  });
  const commissioningPending = checks.filter(
    (check) =>
      String(check.commissioningStatus) === "pending" ||
      (check.assetId && String(check.commissioningStatus) !== "validated"),
  );
  const qualityStatusLabel = (value: unknown) => {
    const labels: Record<string, [string, string]> = {
      pending: ["Pending", "À contrôler"],
      accepted: ["Accepted", "Acceptée"],
      accepted_with_observations: [
        "Accepted with observations",
        "Acceptée avec réserves",
      ],
      rejected: ["Rejected", "Refusée"],
      returned: ["Returned", "Retournée"],
    };
    const item = labels[String(value ?? "pending")] ?? [
      titleCase(value),
      titleCase(value),
    ];
    return fr ? item[1] : item[0];
  };
  const commissioningLabel = (value: unknown) => {
    const labels: Record<string, [string, string]> = {
      not_required: ["Not required", "Non requise"],
      pending: ["Pending", "En attente"],
      validated: ["Validated", "Validée"],
      failed: ["Failed", "Échouée"],
    };
    const item = labels[String(value ?? "not_required")] ?? [
      titleCase(value),
      titleCase(value),
    ];
    return fr ? item[1] : item[0];
  };
  const closeoutComplete = String(closeout?.status ?? "") === "completed";
  const receiptTotals = (receiptId: string) =>
    receiptLines
      .filter((line) => String(line.receiptId) === receiptId)
      .reduce(
        (total, line) => ({
          received: total.received + number(line.receivedQuantity),
          damaged: total.damaged + number(line.damagedQuantity),
          rejected: total.rejected + number(line.rejectedQuantity),
        }),
        { received: 0, damaged: 0, rejected: 0 },
      );

  return (
    <section className="mt-5 space-y-5">
      <Panel
        title={label(
          fr,
          "Quality, handover & close-out",
          "Qualité, réception & clôture",
        )}
        subtitle={label(
          fr,
          "A receipt remains the quantity and budget record. This controlled layer proves its quality, warranty, commissioning and project handover.",
          "La réception reste la source des quantités et du budget. Cette couche contrôlée prouve sa qualité, sa garantie, sa mise en service et la remise du projet.",
        )}
        icon={ClipboardCheck}
        action={
          canCreateCheck ? (
            <Button size="sm" onClick={onAddCheck}>
              <Plus />
              {label(fr, "Quality check", "Contrôle qualité")}
            </Button>
          ) : undefined
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [
              label(fr, "Receipts to inspect", "Réceptions à contrôler"),
              pendingChecks.length,
              "bg-warning/15 text-ink",
            ],
            [
              label(fr, "Checks accepted", "Contrôles acceptés"),
              checks.filter((check) =>
                ["accepted", "accepted_with_observations"].includes(
                  String(check.qualityStatus),
                ),
              ).length,
              "bg-good/10 text-good-ink dark:text-good",
            ],
            [
              label(
                fr,
                "Commissioning to validate",
                "Mises en service à valider",
              ),
              commissioningPending.length,
              "bg-brand/10 text-brand",
            ],
            [
              label(fr, "Project close-out", "Clôture du projet"),
              closeoutComplete
                ? label(fr, "Completed", "Terminée")
                : label(fr, "To prepare", "À préparer"),
              closeoutComplete
                ? "bg-good/10 text-good-ink dark:text-good"
                : "bg-surface-2 text-ink",
            ],
          ].map(([title, value, tone]) => (
            <div key={String(title)} className={`rounded-xl px-4 py-3 ${tone}`}>
              <p className="text-xs font-medium">{String(title)}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {String(value)}
              </p>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
        <Panel
          title={label(
            fr,
            "Reception quality checks",
            "Contrôles de réception",
          )}
          subtitle={label(
            fr,
            "Check quantity, condition, documents, photos and supplier warranty before the final verification.",
            "Contrôlez quantité, état, documents, photos et garantie fournisseur avant la vérification finale.",
          )}
          icon={PackageCheck}
        >
          {receptionRows.length ? (
            <div className="max-h-[34rem] space-y-3 overflow-y-auto pr-1">
              {receptionRows.map((receipt) => {
                const check = checksByReceipt.get(String(receipt.id));
                const totals = receiptTotals(String(receipt.id));
                const accepted = Math.max(
                  0,
                  totals.received - totals.damaged - totals.rejected,
                );
                const qualityStatus = String(check?.qualityStatus ?? "pending");
                return (
                  <article
                    key={receipt.id}
                    className="rounded-2xl border border-border bg-surface-1 p-4 shadow-[0_14px_30px_-28px_rgba(15,38,63,.7)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-ink">
                            {String(receipt.receiptNumber ?? "BR")}
                          </p>
                          <Badge variant={statusVariant(qualityStatus)}>
                            {qualityStatusLabel(qualityStatus)}
                          </Badge>
                          <Badge variant={statusVariant(receipt.status)}>
                            {titleCase(receipt.status)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-ink-secondary">
                          {label(fr, "Received", "Réception")} ·{" "}
                          {date(receipt.receivedDate, locale)}
                        </p>
                      </div>
                      {canEditCheck && check ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onEditCheck(check)}
                        >
                          <Pencil />
                          {label(fr, "Review", "Contrôler")}
                        </Button>
                      ) : canCreateCheck && !check ? (
                        <Button size="sm" variant="ghost" onClick={onAddCheck}>
                          <ClipboardCheck />
                          {label(fr, "Inspect", "Contrôler")}
                        </Button>
                      ) : null}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-4">
                      {[
                        [
                          label(fr, "Received", "Reçu"),
                          totals.received,
                          "bg-brand/10 text-brand",
                        ],
                        [
                          label(fr, "Accepted", "Accepté"),
                          accepted,
                          "bg-good/10 text-good-ink dark:text-good",
                        ],
                        [
                          label(fr, "Damaged", "Endommagé"),
                          totals.damaged,
                          "bg-warning/15 text-ink",
                        ],
                        [
                          label(fr, "Rejected", "Refusé"),
                          totals.rejected,
                          "bg-critical/10 text-critical",
                        ],
                      ].map(([name, value, tone]) => (
                        <div
                          key={String(name)}
                          className={`rounded-lg px-3 py-2 ${tone}`}
                        >
                          <p className="text-[11px] font-medium">
                            {String(name)}
                          </p>
                          <p className="mt-1 text-sm font-semibold tabular-nums">
                            {number(value)}
                          </p>
                        </div>
                      ))}
                    </div>
                    {check ? (
                      <div className="mt-3 grid gap-2 text-xs text-ink-secondary sm:grid-cols-2">
                        <p>
                          {label(fr, "Checklist", "Checklist")} ·{" "}
                          {
                            [
                              check.quantityMatches,
                              check.conditionAccepted,
                              check.documentsComplete,
                            ].filter(Boolean).length
                          }
                          /3
                        </p>
                        <p>
                          {label(fr, "Commissioning", "Mise en service")} ·{" "}
                          <span className="font-semibold text-ink">
                            {commissioningLabel(check.commissioningStatus)}
                          </span>
                        </p>
                        {check.returnedQuantity ? (
                          <p>
                            {label(fr, "Declared return", "Retour déclaré")} ·{" "}
                            {number(check.returnedQuantity)}
                          </p>
                        ) : null}
                        {check.warrantyExpiresOn ? (
                          <p>
                            {label(
                              fr,
                              "Supplier warranty until",
                              "Garantie fournisseur jusqu’au",
                            )}{" "}
                            · {date(check.warrantyExpiresOn, locale)}
                          </p>
                        ) : null}
                        {check.beforePhotoDocumentId ||
                        check.afterPhotoDocumentId ? (
                          <p className="sm:col-span-2">
                            {label(fr, "Evidence", "Preuves")} ·{" "}
                            {[
                              check.beforePhotoDocumentId
                                ? `${label(fr, "Before", "Avant")} : ${documentNames.get(String(check.beforePhotoDocumentId)) ?? "—"}`
                                : null,
                              check.afterPhotoDocumentId
                                ? `${label(fr, "After", "Après")} : ${documentNames.get(String(check.afterPhotoDocumentId)) ?? "—"}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-ink">
                        {label(
                          fr,
                          "Quality control is still required before final verification.",
                          "Le contrôle qualité reste requis avant la vérification finale.",
                        )}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title={label(
                fr,
                "No confirmed receipt",
                "Aucune réception confirmée",
              )}
              description={label(
                fr,
                "Confirm a supplier delivery first; its quality check will then be available here.",
                "Confirmez d’abord une livraison fournisseur ; son contrôle qualité sera ensuite disponible ici.",
              )}
              icon={PackageCheck}
            />
          )}
        </Panel>

        <div className="space-y-5">
          <Panel
            title={label(
              fr,
              "Equipment commissioning",
              "Mise en service des équipements",
            )}
            subtitle={label(
              fr,
              "A durable asset is only handed over after its functional and safety checks are recorded.",
              "Un actif durable est remis seulement après l’enregistrement de ses contrôles fonctionnel et sécurité.",
            )}
            icon={Settings2}
          >
            {assets.length ? (
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {assets.map((asset) => {
                  const check = checksByAsset.get(String(asset.id));
                  return (
                    <div
                      key={asset.id}
                      className="rounded-xl border border-border bg-surface-2/55 px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-semibold text-ink">
                          {String(asset.name ?? asset.assetNumber ?? "—")}
                        </p>
                        <Badge
                          variant={
                            check?.commissioningStatus === "validated"
                              ? "good"
                              : "warning"
                          }
                        >
                          {commissioningLabel(
                            check?.commissioningStatus ?? "pending",
                          )}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-ink-secondary">
                        {asset.warrantyExpiresOn
                          ? `${label(fr, "Warranty", "Garantie")} · ${date(asset.warrantyExpiresOn, locale)}`
                          : label(
                              fr,
                              "No supplier warranty recorded",
                              "Aucune garantie fournisseur enregistrée",
                            )}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm leading-6 text-ink-secondary">
                {label(
                  fr,
                  "No durable equipment is linked to this project yet.",
                  "Aucun équipement durable n’est encore lié à ce projet.",
                )}
              </p>
            )}
          </Panel>

          <Panel
            title={label(
              fr,
              "Project close-out report",
              "Procès-verbal de clôture",
            )}
            subtitle={label(
              fr,
              "The owner records the achieved result, commissioning decision, handover and lessons learned. Completing it closes the investment lifecycle.",
              "Le propriétaire enregistre le résultat atteint, la décision de mise en service, la remise et les leçons apprises. Sa finalisation clôture le cycle de l’investissement.",
            )}
            icon={ShieldCheck}
            action={
              canClose && !closeoutComplete ? (
                <Button size="sm" onClick={onPrepareCloseout}>
                  <ClipboardCheck />
                  {closeout
                    ? label(fr, "Complete report", "Finaliser le PV")
                    : label(fr, "Prepare report", "Préparer le PV")}
                </Button>
              ) : undefined
            }
          >
            {closeoutComplete && closeout ? (
              <div className="space-y-3 rounded-xl border border-good/30 bg-good/10 p-4">
                <Badge variant="good">
                  {label(
                    fr,
                    "Project formally closed",
                    "Projet formellement clôturé",
                  )}
                </Badge>
                <p className="text-sm font-semibold text-ink">
                  {closeout.expectedOutcomeAchieved
                    ? label(
                        fr,
                        "Expected outcome achieved",
                        "Résultat attendu atteint",
                      )
                    : label(
                        fr,
                        "Expected outcome not fully achieved",
                        "Résultat attendu non entièrement atteint",
                      )}
                </p>
                <p className="text-sm leading-6 text-ink-secondary">
                  {String(closeout.achievementSummary ?? "—")}
                </p>
                <div className="border-t border-good/25 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    {label(fr, "Lessons learned", "Leçons apprises")}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">
                    {String(closeout.lessonsLearned ?? "—")}
                  </p>
                </div>
                <p className="text-xs text-ink-secondary">
                  {label(fr, "Closed", "Clôturé")} ·{" "}
                  {date(closeout.completedAt, locale)}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm leading-6 text-ink-secondary">
                  {label(
                    fr,
                    "Do not close work only because it is marked complete. Use this report to confirm the expected result and preserve what the team learned.",
                    "Ne clôturez pas le travail uniquement parce qu’il est marqué terminé. Utilisez ce PV pour confirmer le résultat attendu et conserver ce que l’équipe a appris.",
                  )}
                </p>
                {closeout ? (
                  <Badge variant="warning">
                    {label(fr, "Draft report", "PV en brouillon")}
                  </Badge>
                ) : null}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </section>
  );
}

type ScheduleKind = "phase" | "task" | "milestone";
type ScheduleNode = {
  id: string;
  kind: ScheduleKind;
  title: string;
  projectId: string;
  projectName: string;
  start: string | null;
  end: string | null;
  status: string;
  assignedMemberId: string | null;
  assignedMemberName: string | null;
  external: boolean;
};
type ScheduleEdge = {
  from: string;
  to: string;
  crossProject: boolean;
  dependencyType: string;
};

const scheduleDate = (...values: unknown[]) =>
  values
    .map((value) => String(value ?? "").slice(0, 10))
    .find((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)) ?? null;
const scheduleDay = (value: string | null) => {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 0));
  return date.toISOString().slice(0, 10) === value ? date.getTime() : null;
};
const scheduleDays = (start: number, end: number) =>
  Math.max(1, Math.round((end - start) / 86_400_000) + 1);
const scheduleFinished = (status: unknown) =>
  ["completed", "cancelled"].includes(String(status));

/**
 * Longest-path slack over the existing acyclic dependency graph. A zero-slack
 * row is critical: a delay there pushes the calculated finish of the plan.
 */
function criticalScheduleNodes(nodes: ScheduleNode[], edges: ScheduleEdge[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }
  const queue = nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  // The API rejects cycles. This defensive fallback keeps a legacy bad record
  // from crashing the planning screen.
  for (const node of nodes) if (!order.includes(node.id)) order.push(node.id);

  const duration = (node: ScheduleNode) => {
    const start = scheduleDay(node.start);
    const end = scheduleDay(node.end);
    return start !== null && end !== null ? scheduleDays(start, end) : 1;
  };
  const early = new Map(nodes.map((node) => [node.id, 0]));
  for (const id of order) {
    for (const next of outgoing.get(id) ?? []) {
      const edge = edges.find((item) => item.from === id && item.to === next);
      const sourceDuration = duration(byId.get(id)!);
      const targetDuration = duration(byId.get(next)!);
      const sourceStart = early.get(id) ?? 0;
      const candidate =
        edge?.dependencyType === "start_to_start"
          ? sourceStart
          : edge?.dependencyType === "finish_to_finish"
            ? sourceStart + sourceDuration - targetDuration
            : edge?.dependencyType === "start_to_finish"
              ? sourceStart - targetDuration
              : sourceStart + sourceDuration;
      early.set(next, Math.max(early.get(next) ?? 0, candidate));
    }
  }
  const finish = Math.max(
    0,
    ...nodes.map((node) => (early.get(node.id) ?? 0) + duration(node)),
  );
  const latest = new Map(
    nodes.map((node) => [node.id, finish - duration(node)]),
  );
  for (const id of [...order].reverse()) {
    const successors = outgoing.get(id) ?? [];
    if (!successors.length) continue;
    latest.set(
      id,
      Math.min(
        ...successors.map((next) => {
          const edge = edges.find(
            (item) => item.from === id && item.to === next,
          );
          const targetDuration = duration(byId.get(next)!);
          const sourceDuration = duration(byId.get(id)!);
          const targetStart = latest.get(next) ?? finish;
          if (edge?.dependencyType === "start_to_start") return targetStart;
          if (edge?.dependencyType === "finish_to_finish")
            return targetStart + targetDuration - sourceDuration;
          if (edge?.dependencyType === "start_to_finish")
            return targetStart + targetDuration;
          return targetStart - sourceDuration;
        }),
      ),
    );
  }
  return new Set(
    nodes
      .filter(
        (node) =>
          Math.abs((early.get(node.id) ?? 0) - (latest.get(node.id) ?? 0)) <
          0.001,
      )
      .map((node) => node.id),
  );
}

function ProjectVisualPlanning({
  project,
  phases,
  tasks,
  portfolioProjects,
  portfolioPhases,
  portfolioTasks,
  phaseDependencies,
  taskDependencies,
  fr,
  locale,
  onOpenTask,
}: {
  project: Project;
  phases: Row[];
  tasks: Row[];
  portfolioProjects: Project[];
  portfolioPhases: Row[];
  portfolioTasks: Row[];
  phaseDependencies: Row[];
  taskDependencies: Row[];
  fr: boolean;
  locale: string;
  onOpenTask: (task: Row) => void;
}) {
  const [windowSize, setWindowSize] = useState<
    "project" | "90" | "180" | "365"
  >("project");
  const today = new Date().toISOString().slice(0, 10);
  const projectNames = useMemo(
    () =>
      new Map(portfolioProjects.map((item) => [String(item.id), item.name])),
    [portfolioProjects],
  );
  const phaseById = useMemo(
    () => new Map(portfolioPhases.map((item) => [String(item.id), item])),
    [portfolioPhases],
  );
  const taskById = useMemo(
    () => new Map(portfolioTasks.map((item) => [String(item.id), item])),
    [portfolioTasks],
  );
  const ownPhaseIds = useMemo(
    () => new Set(phases.map((item) => String(item.id))),
    [phases],
  );
  const ownTaskIds = useMemo(
    () => new Set(tasks.map((item) => String(item.id))),
    [tasks],
  );
  const relevantPhaseDependencies = useMemo(
    () =>
      phaseDependencies.filter(
        (edge) =>
          ownPhaseIds.has(String(edge.phaseId)) ||
          ownPhaseIds.has(String(edge.dependsOnPhaseId)),
      ),
    [ownPhaseIds, phaseDependencies],
  );
  const relevantTaskDependencies = useMemo(
    () =>
      taskDependencies.filter(
        (edge) =>
          ownTaskIds.has(String(edge.taskId)) ||
          ownTaskIds.has(String(edge.dependsOnTaskId)),
      ),
    [ownTaskIds, taskDependencies],
  );
  const externalPhaseIds = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of relevantPhaseDependencies) {
      const waiting = String(edge.phaseId);
      const prerequisite = String(edge.dependsOnPhaseId);
      if (!ownPhaseIds.has(waiting)) ids.add(waiting);
      if (!ownPhaseIds.has(prerequisite)) ids.add(prerequisite);
    }
    return ids;
  }, [ownPhaseIds, relevantPhaseDependencies]);
  const externalTaskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of relevantTaskDependencies) {
      const waiting = String(edge.taskId);
      const prerequisite = String(edge.dependsOnTaskId);
      if (!ownTaskIds.has(waiting)) ids.add(waiting);
      if (!ownTaskIds.has(prerequisite)) ids.add(prerequisite);
    }
    return ids;
  }, [ownTaskIds, relevantTaskDependencies]);

  const nodes = useMemo(() => {
    const result: ScheduleNode[] = [];
    const add = (row: Row, kind: ScheduleKind, external: boolean) => {
      const projectId = String(row.projectId ?? project.id);
      const isMilestone = kind === "milestone";
      result.push({
        id: `${kind}:${String(row.id)}`,
        kind,
        title: String(row.name ?? row.title ?? row.code ?? "—"),
        projectId,
        projectName: projectNames.get(projectId) ?? project.name,
        start: scheduleDate(row.actualStartDate, row.startDate, row.createdAt),
        end: scheduleDate(
          row.completedDate,
          isMilestone
            ? (row.dueDate ?? row.startDate)
            : (row.targetEndDate ?? row.dueDate),
          row.startDate,
        ),
        status: String(row.status ?? "not_started"),
        assignedMemberId:
          (row.responsibleMemberId ?? row.assignedMemberId)
            ? String(row.responsibleMemberId ?? row.assignedMemberId)
            : null,
        assignedMemberName:
          (row.responsibleMemberName ?? row.assignedMemberName)
            ? String(row.responsibleMemberName ?? row.assignedMemberName)
            : null,
        external,
      });
    };
    phases.forEach((row) => add(row, "phase", false));
    tasks.forEach((row) =>
      add(row, row.taskType === "milestone" ? "milestone" : "task", false),
    );
    for (const id of externalPhaseIds) {
      const row = phaseById.get(id);
      if (row) add(row, "phase", true);
    }
    for (const id of externalTaskIds) {
      const row = taskById.get(id);
      if (row)
        add(row, row.taskType === "milestone" ? "milestone" : "task", true);
    }
    return result;
  }, [
    externalPhaseIds,
    externalTaskIds,
    phaseById,
    phases,
    project.id,
    project.name,
    projectNames,
    taskById,
    tasks,
  ]);
  const nodeIdFor = (kind: "phase" | "task", rawId: unknown) => {
    const row =
      kind === "phase"
        ? phaseById.get(String(rawId))
        : taskById.get(String(rawId));
    if (kind === "phase") return `phase:${String(rawId)}`;
    return `${row?.taskType === "milestone" ? "milestone" : "task"}:${String(rawId)}`;
  };
  const edges = useMemo<ScheduleEdge[]>(
    () => [
      ...relevantPhaseDependencies.map((edge) => {
        const prerequisite = phaseById.get(String(edge.dependsOnPhaseId));
        const waiting = phaseById.get(String(edge.phaseId));
        return {
          from: nodeIdFor("phase", edge.dependsOnPhaseId),
          to: nodeIdFor("phase", edge.phaseId),
          crossProject:
            String(prerequisite?.projectId ?? "") !==
            String(waiting?.projectId ?? ""),
          dependencyType: String(edge.dependencyType ?? "finish_to_start"),
        };
      }),
      ...relevantTaskDependencies.map((edge) => {
        const prerequisite = taskById.get(String(edge.dependsOnTaskId));
        const waiting = taskById.get(String(edge.taskId));
        return {
          from: nodeIdFor("task", edge.dependsOnTaskId),
          to: nodeIdFor("task", edge.taskId),
          crossProject:
            String(prerequisite?.projectId ?? "") !==
            String(waiting?.projectId ?? ""),
          dependencyType: String(edge.dependencyType ?? "finish_to_start"),
        };
      }),
    ],
    [phaseById, relevantPhaseDependencies, relevantTaskDependencies, taskById],
  );
  const criticalIds = useMemo(
    () => criticalScheduleNodes(nodes, edges),
    [edges, nodes],
  );
  const datedNodes = nodes.filter(
    (node) =>
      scheduleDay(node.start) !== null && scheduleDay(node.end) !== null,
  );
  const unplanned = nodes.filter(
    (node) =>
      scheduleDay(node.start) === null || scheduleDay(node.end) === null,
  );
  const todayMs = scheduleDay(today)!;
  const projectStart = scheduleDay(scheduleDate(project.startDate));
  const projectEnd = scheduleDay(
    scheduleDate(project.revisedCompletionDate, project.targetCompletionDate),
  );
  const datedStart = Math.min(
    ...[
      ...datedNodes.map((node) => scheduleDay(node.start)!),
      projectStart ?? todayMs,
    ],
  );
  const datedEnd = Math.max(
    ...[
      ...datedNodes.map((node) => scheduleDay(node.end)!),
      projectEnd ?? todayMs + 89 * 86_400_000,
    ],
  );
  const horizon = useMemo(() => {
    if (windowSize === "project")
      return {
        start: datedStart,
        end: Math.max(datedEnd, datedStart + 30 * 86_400_000),
      };
    const days = Number(windowSize);
    return {
      start: todayMs - 7 * 86_400_000,
      end: todayMs + (days - 1) * 86_400_000,
    };
  }, [datedEnd, datedStart, todayMs, windowSize]);
  const monthTicks = useMemo(() => {
    const cursor = new Date(horizon.start);
    cursor.setUTCDate(1);
    if (cursor.getTime() < horizon.start)
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    const ticks: Array<{ label: string; left: number }> = [];
    while (cursor.getTime() <= horizon.end) {
      ticks.push({
        label: new Intl.DateTimeFormat(locale, {
          month: "short",
          year: "numeric",
        }).format(cursor),
        left:
          ((cursor.getTime() - horizon.start) /
            (horizon.end - horizon.start || 1)) *
          100,
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return ticks;
  }, [horizon.end, horizon.start, locale]);
  const visibleNodes = datedNodes.filter((node) => {
    const start = scheduleDay(node.start)!;
    const end = scheduleDay(node.end)!;
    return end >= horizon.start && start <= horizon.end;
  });
  const overdue = nodes.filter(
    (node) =>
      !scheduleFinished(node.status) &&
      (scheduleDay(node.end) ?? Infinity) < todayMs,
  );
  const crossProjectEdges = edges.filter((edge) => edge.crossProject);
  const ownAssignees = new Set(
    tasks.map((task) => String(task.assignedMemberId ?? "")).filter(Boolean),
  );
  const workload = useMemo(() => {
    const byMember = new Map<string, ScheduleNode[]>();
    for (const task of portfolioTasks) {
      const memberId = String(task.assignedMemberId ?? "");
      if (
        !memberId ||
        !ownAssignees.has(memberId) ||
        scheduleFinished(task.status)
      )
        continue;
      const node: ScheduleNode = {
        id: `task:${task.id}`,
        kind: task.taskType === "milestone" ? "milestone" : "task",
        title: String(task.title ?? task.code ?? "—"),
        projectId: String(task.projectId ?? ""),
        projectName: String(
          task.projectName ??
            projectNames.get(String(task.projectId ?? "")) ??
            "—",
        ),
        start: scheduleDate(task.startDate),
        end: scheduleDate(task.dueDate, task.startDate),
        status: String(task.status ?? "not_started"),
        assignedMemberId: memberId,
        assignedMemberName: task.assignedMemberName
          ? String(task.assignedMemberName)
          : null,
        external: String(task.projectId ?? "") !== String(project.id),
      };
      byMember.set(memberId, [...(byMember.get(memberId) ?? []), node]);
    }
    return [...byMember.entries()]
      .map(([memberId, assigned]) => {
        const scheduled = assigned.filter(
          (node) =>
            scheduleDay(node.start) !== null && scheduleDay(node.end) !== null,
        );
        let conflicts = 0;
        for (let left = 0; left < scheduled.length; left += 1)
          for (let right = left + 1; right < scheduled.length; right += 1)
            if (
              scheduleDay(scheduled[left]!.start)! <=
                scheduleDay(scheduled[right]!.end)! &&
              scheduleDay(scheduled[right]!.start)! <=
                scheduleDay(scheduled[left]!.end)!
            )
              conflicts += 1;
        return {
          memberId,
          name:
            assigned.find((node) => node.assignedMemberName)
              ?.assignedMemberName ??
            label(fr, "Assigned employee", "Employé affecté"),
          taskCount: assigned.length,
          scheduledCount: scheduled.length,
          unplannedCount: assigned.length - scheduled.length,
          conflicts,
          externalCount: assigned.filter((node) => node.external).length,
        };
      })
      .sort(
        (left, right) =>
          right.conflicts - left.conflicts || right.taskCount - left.taskCount,
      );
  }, [fr, ownAssignees, portfolioTasks, project.id, projectNames]);
  const conflictCount = workload.reduce(
    (total, item) => total + item.conflicts,
    0,
  );
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const kindLabel = (kind: ScheduleKind) =>
    kind === "phase"
      ? label(fr, "Phase", "Phase")
      : kind === "milestone"
        ? label(fr, "Milestone", "Jalon")
        : label(fr, "Task", "Tâche");
  const dateRange = (node: ScheduleNode) =>
    node.start && node.end
      ? `${date(node.start, locale)} — ${date(node.end, locale)}`
      : label(fr, "Date to plan", "Date à planifier");

  return (
    <section className="mt-5 space-y-5">
      <Panel
        title={label(
          fr,
          "Visual plan and team capacity",
          "Planning visuel et capacité d’équipe",
        )}
        subtitle={label(
          fr,
          "One timeline for phases, work, milestones and the dependencies that can change the project finish date.",
          "Une seule ligne de temps pour les phases, travaux, jalons et dépendances qui peuvent déplacer la fin du projet.",
        )}
        icon={CalendarDays}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            [
              label(fr, "Critical path", "Chemin critique"),
              criticalIds.size,
              "serious",
            ],
            [
              label(fr, "Overdue", "En retard"),
              overdue.length,
              overdue.length ? "serious" : "good",
            ],
            [
              label(fr, "Team conflicts", "Conflits d’équipe"),
              conflictCount,
              conflictCount ? "warning" : "good",
            ],
            [
              label(fr, "Cross-project links", "Liens entre projets"),
              crossProjectEdges.length,
              crossProjectEdges.length ? "info" : "neutral",
            ],
            [
              label(fr, "Needs dates", "À planifier"),
              unplanned.length,
              unplanned.length ? "warning" : "good",
            ],
          ].map(([name, value, tone]) => (
            <div
              key={String(name)}
              className="rounded-xl border border-border bg-surface-2/70 p-3"
            >
              <p className="text-xs font-medium text-ink-secondary">{name}</p>
              <Badge
                className="mt-2"
                variant={
                  tone as "serious" | "warning" | "info" | "neutral" | "good"
                }
              >
                {String(value)}
              </Badge>
            </div>
          ))}
        </div>
      </Panel>

      <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div>
            <h3 className="text-sm font-semibold text-ink">
              {label(fr, "Project calendar", "Calendrier du projet")}
            </h3>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              {label(
                fr,
                "Red marks critical work. A dashed bar belongs to a connected project.",
                "Le rouge marque le travail critique. Une barre en pointillé appartient à un projet relié.",
              )}
            </p>
          </div>
          <div className="flex rounded-xl bg-surface-2 p-1">
            {(["project", "90", "180", "365"] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => setWindowSize(choice)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${windowSize === choice ? "bg-brand text-brand-ink shadow-sm" : "text-ink-secondary hover:text-ink"}`}
              >
                {choice === "project"
                  ? label(fr, "Project", "Projet")
                  : `${choice} ${label(fr, "days", "jours")}`}
              </button>
            ))}
          </div>
        </div>
        {visibleNodes.length ? (
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              <div className="grid grid-cols-[19rem_minmax(0,1fr)] border-b border-border bg-surface-2/70 text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">
                <div className="px-4 py-3">
                  {label(fr, "Work item", "Élément de travail")}
                </div>
                <div className="relative h-10 overflow-hidden border-l border-border">
                  {monthTicks.map((tick) => (
                    <span
                      key={`${tick.label}-${tick.left}`}
                      style={{
                        left: `${Math.max(0, Math.min(95, tick.left))}%`,
                      }}
                      className="absolute top-3 whitespace-nowrap"
                    >
                      {tick.label}
                    </span>
                  ))}
                </div>
              </div>
              {visibleNodes.map((node) => {
                const start = scheduleDay(node.start)!;
                const end = scheduleDay(node.end)!;
                const left =
                  ((Math.max(start, horizon.start) - horizon.start) /
                    (horizon.end - horizon.start || 1)) *
                  100;
                const width = Math.max(
                  1.2,
                  ((Math.min(end, horizon.end) -
                    Math.max(start, horizon.start) +
                    86_400_000) /
                    (horizon.end - horizon.start + 86_400_000)) *
                    100,
                );
                const critical = criticalIds.has(node.id);
                const isOverdue =
                  !scheduleFinished(node.status) && end < todayMs;
                const color = critical
                  ? "bg-rose-600"
                  : isOverdue
                    ? "bg-amber-500"
                    : node.kind === "phase"
                      ? "bg-brand"
                      : node.kind === "milestone"
                        ? "bg-violet-600"
                        : "bg-sky-600";
                return (
                  <div
                    key={node.id}
                    className="grid grid-cols-[19rem_minmax(0,1fr)] border-b border-border last:border-b-0"
                  >
                    <div className="min-w-0 px-4 py-3">
                      <div className="flex items-start gap-2">
                        <span
                          className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white ${node.kind === "phase" ? "bg-brand" : node.kind === "milestone" ? "bg-violet-600" : "bg-sky-600"}`}
                        >
                          {node.kind === "phase"
                            ? "P"
                            : node.kind === "milestone"
                              ? "J"
                              : "T"}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">
                            {node.title}
                          </p>
                          <p className="mt-1 truncate text-xs text-ink-secondary">
                            {kindLabel(node.kind)} ·{" "}
                            {node.external ? node.projectName : dateRange(node)}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="relative h-14 border-l border-border bg-[linear-gradient(90deg,transparent_calc(100%_-_1px),var(--border)_calc(100%_-_1px))] bg-[size:8.333%_100%]">
                      <span
                        title={`${node.title} · ${dateRange(node)}`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        className={`absolute top-4 h-6 min-w-2 rounded-md ${color} ${node.external ? "border border-dashed border-white/90 opacity-80" : ""} ${critical ? "shadow-[0_0_0_2px_rgba(225,29,72,.2)]" : ""}`}
                      />
                      {todayMs >= horizon.start && todayMs <= horizon.end ? (
                        <span
                          style={{
                            left: `${((todayMs - horizon.start) / (horizon.end - horizon.start || 1)) * 100}%`,
                          }}
                          className="absolute inset-y-0 w-px bg-rose-500/75"
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="p-5">
            <EmptyState
              title={label(
                fr,
                "No dated item yet",
                "Aucun élément daté pour le moment",
              )}
              description={label(
                fr,
                "Add start and finish dates to phases or tasks to build the calendar.",
                "Ajoutez une date de début et de fin aux phases ou tâches pour construire le calendrier.",
              )}
              icon={CalendarDays}
            />
          </div>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title={label(fr, "Team capacity", "Capacité de l’équipe")}
          subtitle={label(
            fr,
            "Conflicts are calculated when the same person has overlapping dated tasks, including work in connected projects you can see.",
            "Les conflits sont calculés lorsqu’une même personne a des tâches datées qui se chevauchent, y compris dans les projets reliés que vous pouvez voir.",
          )}
          icon={Users}
        >
          {workload.length ? (
            <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
              {workload.map((member) => (
                <div
                  key={member.memberId}
                  className={`rounded-xl border p-3 ${member.conflicts ? "border-warning/40 bg-warning/8" : "border-border bg-surface-2/60"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">
                        {member.name}
                      </p>
                      <p className="mt-1 text-xs text-ink-secondary">
                        {member.taskCount}{" "}
                        {label(fr, "open task(s)", "tâche(s) ouverte(s)")} ·{" "}
                        {member.scheduledCount}{" "}
                        {label(fr, "scheduled", "planifiée(s)")}
                        {member.externalCount
                          ? ` · ${member.externalCount} ${label(fr, "in another project", "dans un autre projet")}`
                          : ""}
                      </p>
                    </div>
                    <Badge variant={member.conflicts ? "warning" : "good"}>
                      {member.conflicts
                        ? `${member.conflicts} ${label(fr, "overlap(s)", "chevauchement(s)")}`
                        : label(fr, "Available", "Disponible")}
                    </Badge>
                  </div>
                  {member.unplannedCount ? (
                    <p className="mt-2 text-xs text-warning">
                      {member.unplannedCount}{" "}
                      {label(
                        fr,
                        "task(s) still need dates.",
                        "tâche(s) doivent encore être datées.",
                      )}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title={label(fr, "No assigned work", "Aucun travail affecté")}
              description={label(
                fr,
                "Assign people to project tasks to see their capacity and scheduling conflicts.",
                "Affectez des personnes aux tâches du projet pour voir leur capacité et les conflits de planning.",
              )}
              icon={Users}
            />
          )}
        </Panel>
        <Panel
          title={label(fr, "Dependencies to watch", "Dépendances à surveiller")}
          subtitle={label(
            fr,
            "A prerequisite blocks the next item until it is completed. Cross-project links remain visible here.",
            "Un préalable bloque l’élément suivant jusqu’à sa fin. Les liens entre projets restent visibles ici.",
          )}
          icon={Target}
        >
          {edges.length ? (
            <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
              {edges.map((edge) => {
                const prerequisite = nodeById.get(edge.from);
                const waiting = nodeById.get(edge.to);
                const blocked =
                  prerequisite && !scheduleFinished(prerequisite.status);
                return (
                  <div
                    key={`${edge.from}-${edge.to}`}
                    className={`rounded-xl border p-3 ${blocked ? "border-warning/40 bg-warning/8" : "border-border bg-surface-2/60"}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">
                        {waiting?.title ?? "—"}
                      </p>
                      <Badge variant={blocked ? "warning" : "good"}>
                        {blocked
                          ? label(fr, "Waiting", "En attente")
                          : label(fr, "Released", "Libérée")}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-ink-secondary">
                      {label(fr, "Waits for", "Attend")} ·{" "}
                      <span className="font-medium text-ink">
                        {prerequisite?.title ?? "—"}
                      </span>
                      {edge.crossProject && prerequisite
                        ? ` · ${prerequisite.projectName}`
                        : ""}
                    </p>
                    {edge.crossProject ? (
                      <p className="mt-2 text-xs font-medium text-brand">
                        {label(
                          fr,
                          "Dependency between projects",
                          "Dépendance entre projets",
                        )}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title={label(fr, "No dependency", "Aucune dépendance")}
              description={label(
                fr,
                "Link phases or tasks when work must follow a controlled order.",
                "Liez les phases ou tâches lorsque le travail doit respecter un ordre contrôlé.",
              )}
              icon={Target}
            />
          )}
        </Panel>
      </div>

      {unplanned.length ? (
        <Panel
          title={label(fr, "Items awaiting dates", "Éléments à dater")}
          subtitle={label(
            fr,
            "These items are real work, but are not drawn on the calendar until their dates are defined.",
            "Ces éléments sont réels, mais n’apparaissent pas sur le calendrier tant que leurs dates ne sont pas définies.",
          )}
          icon={Clock3}
        >
          <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto">
            {unplanned.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => {
                  const task = taskById.get(
                    node.id.replace(/^(task|milestone):/, ""),
                  );
                  if (task) onOpenTask(task);
                }}
                className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-left text-xs font-medium text-ink transition hover:border-brand hover:bg-brand-subtle"
              >
                <span>{node.title}</span>
                <span className="ml-2 text-ink-muted">
                  {kindLabel(node.kind)}
                </span>
              </button>
            ))}
          </div>
        </Panel>
      ) : null}
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
  budgetChanges,
  portfolioProjects,
  portfolioPhases,
  portfolioTasks,
  portfolioPhaseDependencies,
  portfolioTaskDependencies,
  fr,
  locale,
  canWrite,
  canControl,
  onSubmitPurchaseRequest,
  onSendPurchaseOrder,
  onReturnPurchaseRequest,
  onCancelPurchaseOrder,
  onConfirmReceipt,
  onRejectReceipt,
  onVerifyReceipt,
  onCancelReceipt,
  onReopenReceipt,
  onOpenSimulation,
  setEditor,
  onConfigureDocument,
  onManageDocumentCategories,
  onToggleDocumentFolderLock,
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
  budgetChanges: Row[];
  portfolioProjects: Project[];
  portfolioPhases: Row[];
  portfolioTasks: Row[];
  portfolioPhaseDependencies: Row[];
  portfolioTaskDependencies: Row[];
  fr: boolean;
  locale: string;
  canWrite: (permission: string) => boolean;
  canControl: (permission: string) => boolean;
  onSubmitPurchaseRequest: (request: Row) => void;
  onSendPurchaseOrder: (order: Row) => void;
  onReturnPurchaseRequest: (request: Row) => void;
  onCancelPurchaseOrder: (order: Row) => void;
  onConfirmReceipt: (receipt: Row) => void;
  onRejectReceipt: (receipt: Row) => void;
  onVerifyReceipt: (receipt: Row) => void;
  onCancelReceipt: (receipt: Row) => void;
  onReopenReceipt: (receipt: Row) => void;
  onOpenSimulation: () => void;
  setEditor: (editor: Editor) => void;
  onConfigureDocument: (document: Row) => void;
  onManageDocumentCategories: () => void;
  onToggleDocumentFolderLock: (
    categoryId: string,
    visibility: "company" | "owner_only",
  ) => void;
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
    risks = records("risks"),
    qualityChecks = records("quality-checks"),
    closeouts = records("project-closeouts"),
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
  const planningProjectNames = new Map(
    portfolioProjects.map((portfolioProject) => [
      String(portfolioProject.id),
      portfolioProject.name,
    ]),
  );
  const phaseDependencySources = portfolioPhases.map((phase) => ({
    ...phase,
    projectName:
      planningProjectNames.get(String(phase.projectId ?? "")) ?? null,
  }));
  const taskDependencySources = portfolioTasks.map((task) => ({
    ...task,
    projectName:
      task.projectName ??
      planningProjectNames.get(String(task.projectId ?? "")) ??
      null,
  }));
  const today = new Date().toISOString().slice(0, 10);
  const [taskView, setTaskView] = useState<
    "all" | "open" | "in_progress" | "completed" | "overdue"
  >("all");
  const workTasks = tasks.filter((task) => task.taskType !== "milestone");
  const projectManagers = members.filter(
    (member) =>
      String(member.assignmentRole ?? "") === "project_manager" ||
      member.isManager === true ||
      String(member.isManager) === "true",
  );
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
          <InvestmentProfilePanel
            project={project}
            summary={summary}
            fr={fr}
            locale={locale}
            onEdit={
              canControl("projects.update")
                ? () => setEditor({ kind: "project", record: project })
                : undefined
            }
          />
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
              <div className="max-h-[30rem] space-y-3 overflow-y-auto pr-1">
                {(summary.nextActions ?? []).map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onOpenTask(task)}
                    className="flex w-full items-start justify-between gap-4 rounded-xl px-3 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                    aria-label={label(
                      fr,
                      `Ouvrir la tâche ${String(task.title ?? task.name ?? "")}`,
                      `Open task ${String(task.title ?? task.name ?? "")}`,
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">
                        {String(task.title ?? task.name ?? "—")}
                      </p>
                      <p className="mt-1 text-xs text-ink-secondary">
                        {titleCase(task.status)} · {date(task.dueDate, locale)}
                      </p>
                      {task.assignedMemberName ? (
                        <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-brand">
                          <Users className="size-3.5" />
                          {label(fr, "Assigned to", "Affectée à")}{" "}
                          {String(task.assignedMemberName)}
                        </p>
                      ) : null}
                      {task.blockedReason ? (
                        <p className="mt-1 text-xs text-serious">
                          {String(task.blockedReason)}
                        </p>
                      ) : null}
                    </div>
                    <Badge variant={statusVariant(task.status)}>
                      {titleCase(task.priority)}
                    </Badge>
                  </button>
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
              "Calculated from planned lines, task estimates, approved expenses and purchase commitments.",
              "Calculée à partir des lignes prévues, estimations des tâches, dépenses approuvées et engagements d’achat.",
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
                label={label(
                  fr,
                  "Task estimates reserved",
                  "Estimations de tâches réservées",
                )}
                value={money(
                  summary?.budget?.taskEstimateReserve,
                  project.currencyCode,
                  locale,
                )}
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
          sources={phaseDependencySources}
          sourceField="phaseId"
          dependencyField="dependsOnPhaseId"
          fr={fr}
          onAdd={
            canControl("projects.create") && phases.length > 0
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
          title={label(fr, "Project manager", "Manager du projet")}
          subtitle={label(
            fr,
            "The project manager follows this project as a whole. Assign workers directly in each task.",
            "Le manager suit le projet dans son ensemble. Affectez les ouvriers directement dans chaque tâche.",
          )}
          rows={projectManagers}
          fields={["assignmentStartDate", "assignmentEndDate", "notes"]}
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
              "Use a blocker whenever a task cannot start until another is complete. The designated project manager sees only this project. Workers act through the tasks assigned to them.",
              "Utilisez un blocage lorsqu’une tâche ne peut pas commencer avant une autre. Le manager désigné ne voit que ce projet. Les ouvriers travaillent uniquement depuis les tâches qui leur sont affectées.",
            )}
          </p>
        </Panel>
      </section>
    );

  if (tab === "timeline")
    return (
      <ProjectVisualPlanning
        project={project}
        phases={phases}
        tasks={tasks}
        portfolioProjects={portfolioProjects}
        portfolioPhases={portfolioPhases}
        portfolioTasks={portfolioTasks}
        phaseDependencies={portfolioPhaseDependencies}
        taskDependencies={portfolioTaskDependencies}
        fr={fr}
        locale={locale}
        onOpenTask={onOpenTask}
      />
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
          sources={taskDependencySources}
          sourceField="taskId"
          dependencyField="dependsOnTaskId"
          fr={fr}
          onAdd={
            canWrite("tasks.create") &&
            (tasks.length > 1 ||
              (canControl("projects.read") && tasks.length > 0))
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
  if (tab === "risks")
    return (
      <ProjectRiskRegister
        rows={risks}
        fr={fr}
        locale={locale}
        canCreate={canWrite("projects.create")}
        canEdit={canWrite("projects.update")}
        onAdd={() => setEditor({ kind: "risk" })}
        onEdit={(record) => setEditor({ kind: "risk", record })}
      />
    );
  if (tab === "quality")
    return (
      <ProjectQualityCloseout
        project={project}
        checks={qualityChecks}
        closeout={closeouts[0] ?? null}
        receipts={receipts}
        receiptLines={receiptLines}
        assets={assets}
        documents={documents}
        fr={fr}
        locale={locale}
        canCreateCheck={canWrite("procurement.create")}
        canEditCheck={canWrite("procurement.update")}
        canClose={canControl("projects.update")}
        onAddCheck={() => setEditor({ kind: "quality-check" })}
        onEditCheck={(record) => setEditor({ kind: "quality-check", record })}
        onPrepareCloseout={() =>
          setEditor({ kind: "closeout", record: closeouts[0] })
        }
      />
    );
  if (tab === "procurement")
    return (
      <section className="mt-5 space-y-5">
        <div className="grid gap-5 xl:grid-cols-3">
          <ProcurementRecordsPanel
            title={label(fr, "Purchase requests", "Demandes d’achat")}
            orgSlug={orgSlug}
            pdfResource="purchase-requests"
            canDownloadPdf={canControl("projects.create")}
            subtitle={label(
              fr,
              "Need identified → request → approval.",
              "Besoin identifié → demande → approbation.",
            )}
            rows={requests}
            relatedRows={requestLines}
            relatedKey="purchaseRequestId"
            relatedLabel={label(fr, "Requested items", "Articles demandés")}
            onEditRelatedRow={
              canWrite("procurement.update")
                ? (record) => setEditor({ kind: "request-line", record })
                : undefined
            }
            fields={["status", "requiredDate", "reason"]}
            fr={fr}
            icon={ClipboardCheck}
            onAdd={
              canWrite("procurement.create")
                ? () => setEditor({ kind: "request" })
                : undefined
            }
            onEdit={
              canWrite("procurement.update")
                ? (record) => setEditor({ kind: "request", record })
                : undefined
            }
            canEditRow={(record) => String(record.status) === "draft"}
            onReturnToDraft={
              canControl("procurement.update")
                ? (request) =>
                    onConfirmAction({
                      title: label(
                        fr,
                        "Return request to draft",
                        "Retourner la demande en brouillon",
                      ),
                      description: label(
                        fr,
                        "This closes the current approval and lets the requester correct the request and its items. It is only possible before a purchase order exists. Continue?",
                        "Cette action ferme l’approbation actuelle et permet au demandeur de corriger la demande et ses articles. Elle est possible uniquement avant la création d’un bon de commande. Continuer ?",
                      ),
                      confirmLabel: label(
                        fr,
                        "Return to draft",
                        "Retourner en brouillon",
                      ),
                      tone: "danger",
                      onConfirm: () => onReturnPurchaseRequest(request),
                    })
                : undefined
            }
            canReturnRow={(request) =>
              [
                "submitted",
                "approved",
                "partially_approved",
                "rejected",
              ].includes(String(request.status)) &&
              !orders.some(
                (order) =>
                  String(order.purchaseRequestId ?? "") === String(request.id),
              )
            }
            onSubmit={
              canWrite("procurement.update")
                ? (record) =>
                    onConfirmAction({
                      title: label(
                        fr,
                        "Submit purchase request",
                        "Soumettre la demande",
                      ),
                      description: label(
                        fr,
                        "Once submitted, this request and its items can no longer be changed. Continue?",
                        "Une fois soumise, cette demande et ses articles ne peuvent plus être modifiés. Continuer ?",
                      ),
                      confirmLabel: label(fr, "Submit", "Soumettre"),
                      tone: "primary",
                      onConfirm: () => onSubmitPurchaseRequest(record),
                    })
                : undefined
            }
            submitLabel={label(fr, "Submit", "Soumettre")}
            editLabel={label(fr, "Edit or submit", "Modifier ou soumettre")}
            onAddItem={
              canWrite("procurement.create")
                ? (request) =>
                    setEditor({
                      kind: "request-line",
                      requestId: String(request.id),
                    })
                : undefined
            }
          />
          <ProcurementRecordsPanel
            title={label(fr, "Purchase orders", "Bons de commande")}
            orgSlug={orgSlug}
            pdfResource="purchase-orders"
            canDownloadPdf={canControl("projects.create")}
            subtitle={label(
              fr,
              "Approved request → order → supplier.",
              "Demande approuvée → commande → fournisseur.",
            )}
            rows={orders}
            relatedRows={orderLines}
            relatedKey="purchaseOrderId"
            relatedLabel={label(fr, "Ordered items", "Articles commandés")}
            onEditRelatedRow={
              canWrite("procurement.update")
                ? (record) => setEditor({ kind: "order-line", record })
                : undefined
            }
            onAddItem={
              canWrite("procurement.create")
                ? (order) =>
                    setEditor({ kind: "order-line", orderId: String(order.id) })
                : undefined
            }
            fields={["status", "expectedDeliveryDate", "supplierReference"]}
            fr={fr}
            icon={ShoppingCart}
            onAdd={
              canWrite("procurement.create")
                ? () => setEditor({ kind: "order" })
                : undefined
            }
            onSubmit={
              canWrite("procurement.update")
                ? (order) =>
                    onConfirmAction({
                      title: label(
                        fr,
                        "Send purchase order",
                        "Envoyer le bon de commande",
                      ),
                      description: label(
                        fr,
                        "This marks the order as sent and commits its total to the project budget. Download its PDF to share it with the supplier. Continue?",
                        "Le bon sera marqué comme envoyé et son total sera engagé dans le budget du projet. Téléchargez ensuite son PDF pour le transmettre au fournisseur. Continuer ?",
                      ),
                      confirmLabel: label(
                        fr,
                        "Send to supplier",
                        "Envoyer au fournisseur",
                      ),
                      tone: "primary",
                      onConfirm: () => onSendPurchaseOrder(order),
                    })
                : undefined
            }
            canSubmitRow={(order) =>
              String(order.status) === "draft" &&
              orderLines.some(
                (line) => String(line.purchaseOrderId) === String(order.id),
              )
            }
            onCancel={
              canControl("procurement.update")
                ? (order) =>
                    onConfirmAction({
                      title: label(
                        fr,
                        "Cancel purchase order",
                        "Annuler le bon de commande",
                      ),
                      description: label(
                        fr,
                        "This cancels the supplier order and releases its committed budget. The original PDF remains in the audit history. A corrected order can then be created from the approved request. Continue?",
                        "Cette action annule le bon envoyé au fournisseur et libère son montant engagé. Le PDF original reste dans l’historique. Vous pourrez ensuite créer un bon corrigé depuis la demande approuvée. Continuer ?",
                      ),
                      confirmLabel: label(fr, "Cancel order", "Annuler le bon"),
                      tone: "danger",
                      onConfirm: () => onCancelPurchaseOrder(order),
                    })
                : undefined
            }
            canCancelRow={(order) =>
              ["draft", "sent"].includes(String(order.status)) &&
              !receipts.some(
                (receipt) =>
                  String(receipt.purchaseOrderId ?? "") === String(order.id),
              )
            }
            submitLabel={label(
              fr,
              "Send to supplier",
              "Envoyer au fournisseur",
            )}
          />
          <ProcurementRecordsPanel
            title={label(fr, "Receiving", "Réceptions")}
            orgSlug={orgSlug}
            pdfResource="receipts"
            canDownloadPdf={canControl("projects.create")}
            subtitle={label(
              fr,
              "Ordered and delivered quantities remain separate.",
              "Les quantités commandées et livrées restent séparées.",
            )}
            rows={receipts}
            fields={["status", "receivedDate", "deliveryNoteNumber"]}
            fr={fr}
            icon={ReceiptText}
            onAdd={
              canWrite("procurement.create")
                ? () => setEditor({ kind: "receipt" })
                : undefined
            }
            onEdit={
              canWrite("procurement.update")
                ? (receipt) => setEditor({ kind: "receipt", record: receipt })
                : undefined
            }
            canEditRow={(receipt) => String(receipt.status) === "draft"}
            editLabel={label(fr, "Edit receipt", "Modifier la réception")}

            onSubmit={
              canWrite("procurement.update")
                ? (receipt) =>
                    onConfirmAction({
                      title: label(
                        fr,
                        "Confirm receipt",
                        "Confirmer la réception",
                      ),
                      description: label(
                        fr,
                        "Confirm that the received items have been checked. This updates the project budget immediately.",
                        "Confirmez que les articles reçus ont été vérifiés. Le budget du projet sera mis à jour immédiatement.",
                      ),
                      confirmLabel: label(
                        fr,
                        "Confirm receipt",
                        "Confirmer la réception",
                      ),
                      tone: "primary",
                      onConfirm: () => onConfirmReceipt(receipt),
                    })
                : undefined
            }
            canSubmitRow={(receipt) =>
              ["draft", "cancelled"].includes(String(receipt.status)) &&
              receiptLines.some(
                (line) => String(line.receiptId ?? "") === String(receipt.id),
              )
            }
            onAddItem={
              canWrite("procurement.create")
                ? (receipt) =>
                    setEditor({
                      kind: "receipt-line",
                      receiptId: String(receipt.id),
                    })
                : undefined
            }
            canAddItemRow={(receipt) =>
              !receiptLines.some(
                (line) => String(line.receiptId ?? "") === String(receipt.id),
              )
            }
            addItemLabel={label(
              fr,
              "Add a missing item",
              "Ajouter un article manquant",
            )}
            onEditRelatedRow={
              canWrite("procurement.update")
                ? (record) => setEditor({ kind: "receipt-line", record })
                : undefined
            }
            onReturnToDraft={
              canControl("projects.create")
                ? (receipt) =>
                    onConfirmAction({
                      title: label(
                        fr,
                        "Reopen receipt as draft",
                        "Réouvrir la réception en brouillon",
                      ),
                      description: label(
                        fr,
                        "Use this only to add or correct received items before confirming this same receipt again. Its budget and stock impact remain reversed until confirmation.",
                        "Utilisez cette action seulement pour ajouter ou corriger les articles reçus avant de confirmer à nouveau cette même réception. Son impact sur le budget et le stock reste annulé jusqu’à la confirmation.",
                      ),
                      confirmLabel: label(
                        fr,
                        "Reopen as draft",
                        "Réouvrir en brouillon",
                      ),
                      tone: "primary",
                      onConfirm: () => onReopenReceipt(receipt),
                    })
                : undefined
            }
            canReturnRow={(receipt) => String(receipt.status) === "cancelled"}
            relatedRows={receiptLines}
            relatedKey="receiptId"
            relatedLabel={label(fr, "Received items", "Articles reçus")}
            onReject={
              canWrite("procurement.update")
                ? (receipt) =>
                    onConfirmAction({
                      title: label(
                        fr,
                        "Reject delivery",
                        "Refuser la livraison",
                      ),
                      description: label(
                        fr,
                        "Use this when the supplier delivery is not accepted. The receipt is closed and no project budget is spent.",
                        "Utilisez cette action lorsque la livraison du fournisseur n’est pas acceptée. La réception est clôturée et aucun montant n’est dépensé sur le budget du projet.",
                      ),
                      confirmLabel: label(
                        fr,
                        "Reject delivery",
                        "Refuser la livraison",
                      ),
                      tone: "danger",
                      onConfirm: () => onRejectReceipt(receipt),
                    })
                : undefined
            }
            canRejectRow={(receipt) => String(receipt.status) === "draft"}
            onVerify={
              canWrite("procurement.update")
                ? (receipt) =>
                    onConfirmAction({
                      title: label(
                        fr,
                        "Verify receipt",
                        "Vérifier la réception",
                      ),
                      description: label(
                        fr,
                        "Confirm the final physical and document check. This does not create a second budget impact.",
                        "Confirmez le contrôle physique et documentaire final. Cette vérification ne crée pas un second impact budgétaire.",
                      ),
                      confirmLabel: label(
                        fr,
                        "Verify receipt",
                        "Vérifier la réception",
                      ),
                      tone: "primary",
                      onConfirm: () => onVerifyReceipt(receipt),
                    })
                : undefined
            }
            canVerifyRow={(receipt) => String(receipt.status) === "received"}
            onCancel={
              canControl("projects.create")
                ? (receipt) =>
                    onConfirmAction({
                      title: label(
                        fr,
                        "Cancel receipt / supplier return",
                        "Annuler la réception / retour fournisseur",
                      ),
                      description: label(
                        fr,
                        "Use this only when the full confirmed delivery has been returned. It reverses this receipt from stock and the project budget, then reopens the purchase order. It is blocked after supplier payment, stock consumption, or durable-asset registration.",
                        "Utilisez cette action seulement lorsque toute la livraison confirmée a été retournée. Elle retire cette réception du stock et du budget du projet, puis rouvre le bon de commande. Elle est bloquée après un paiement fournisseur, une consommation du stock ou l’enregistrement d’une immobilisation.",
                      ),
                      confirmLabel: label(
                        fr,
                        "Cancel and return",
                        "Annuler et retourner",
                      ),
                      tone: "danger",
                      onConfirm: () => onCancelReceipt(receipt),
                    })
                : undefined
            }
            canCancelRow={(receipt) =>
              ["received", "verified"].includes(String(receipt.status))
            }
            rejectLabel={label(fr, "Reject delivery", "Refuser la livraison")}
            verifyLabel={label(fr, "Verify receipt", "Vérifier la réception")}
            cancelLabel={label(fr, "Cancel / return", "Annuler / retourner")}
            submitLabel={label(fr, "Confirm receipt", "Confirmer la réception")}
          />
        </div>
        <div className="grid gap-5 xl:grid-cols-3">
          <ProcurementRecordsPanel
            title={label(fr, "Requested items", "Articles demandés")}
            subtitle={label(
              fr,
              "Quantities requested for this project.",
              "Quantités demandées pour ce projet.",
            )}
            rows={requestLines}
            fields={["description", "requestedQuantity", "unit"]}
            fr={fr}
            icon={ClipboardCheck}
          />
          <ProcurementRecordsPanel
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
          <ProcurementRecordsPanel
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
          onToggleLock={
            canControl("documents.update")
              ? onToggleDocumentFolderLock
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
          rows={activity.filter(
            (event) => String(event.entityType) !== "budget_change",
          )}
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
  if (tab === "finance") {
    const taskBudgets = summary?.taskBudgets ?? [];
    const budgetHistoryRows = budgetChanges;
    const latestProjectBudgetChange = budgetHistoryRows.flatMap((event) => {
      try {
        const parsed = JSON.parse(String(event.status ?? "")) as Record<
          string,
          unknown
        >;
        const before = Number(parsed.before ?? 0);
        const after = Number(parsed.after ?? 0);
        return String(parsed.scope) === "project" &&
          Number.isFinite(before) &&
          Number.isFinite(after)
          ? [{ before, after, actorName: String(event.actorName ?? "").trim() }]
          : [];
      } catch {
        return [];
      }
    })[0];
    const budgetStatus = (status: string) => {
      const copy: Record<
        string,
        [string, string, "good" | "warning" | "critical" | "neutral"]
      > = {
        not_budgeted: ["Not budgeted", "Non budgétée", "neutral"],
        within_budget: ["Within budget", "Dans le budget", "good"],
        attention: ["Attention", "Attention", "warning"],
        nearly_exhausted: ["Nearly exhausted", "Presque épuisé", "warning"],
        over_budget: ["Over budget", "Dépassé", "critical"],
      };
      const item = copy[status] ?? ["Not budgeted", "Non budgétée", "neutral"];
      return <Badge variant={item[2]}>{label(fr, item[0], item[1])}</Badge>;
    };
    return (
      <section className="mt-5 space-y-5">
        <Panel
          icon={Landmark}
          title={label(
            fr,
            "Project budget control",
            "Contrôle du budget du projet",
          )}
          subtitle={label(
            fr,
            "The project budget is the only budget. Task budgets only assign part of it to real work.",
            "Le budget du projet est le seul budget. Les budgets des tâches n’en affectent qu’une partie à des travaux réels.",
          )}
          action={
            canControl("projects.update") ? (
              <Button size="sm" onClick={onOpenSimulation}>
                <Calculator />
                {label(fr, "Simulate", "Simuler")}
              </Button>
            ) : undefined
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {(
              [
                [
                  label(fr, "Budget planned", "Budget prévu"),
                  summary?.budget?.planned,
                  "text-ink",
                  latestProjectBudgetChange,
                ],
                [
                  label(fr, "Assigned to tasks", "Budget affecté aux tâches"),
                  summary?.budget?.allocated,
                  "text-brand",
                  null,
                ],
                [
                  label(fr, "Not assigned", "Budget non affecté"),
                  summary?.budget?.unallocated,
                  "text-ink-secondary",
                  null,
                ],
                [
                  label(fr, "Committed", "Engagé"),
                  summary?.budget?.committed,
                  "text-amber-700",
                  null,
                ],
                [
                  label(fr, "Spent", "Dépensé"),
                  summary?.budget?.spent,
                  "text-rose-700",
                  null,
                ],
                [
                  label(fr, "Available", "Disponible"),
                  summary?.budget?.available,
                  number(summary?.budget?.available) < 0
                    ? "text-rose-700"
                    : "text-emerald-700",
                  null,
                ],
              ] as Array<
                [
                  string,
                  unknown,
                  string,
                  { before: number; after: number; actorName: string } | null,
                ]
              >
            ).map(([title, value, tone, adjustment]) => (
              <div
                key={String(title)}
                className="rounded-xl border border-border bg-surface-2/55 px-4 py-3"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[.11em] text-ink-muted">
                  {title}
                </p>
                <p className={`mt-1 text-xl font-semibold ${tone}`}>
                  {money(value, project.currencyCode, locale)}
                </p>
                {adjustment &&
                typeof adjustment === "object" &&
                "before" in adjustment ? (
                  <p className="mt-2 border-t border-border/70 pt-2 text-[11px] leading-4 text-ink-secondary">
                    {label(fr, "Last adjustment", "Dernier ajustement")} ·{" "}
                    {money(adjustment.before, project.currencyCode, locale)} →{" "}
                    {money(adjustment.after, project.currencyCode, locale)}
                    {adjustment.actorName
                      ? ` · ${label(fr, "by", "par")} ${adjustment.actorName}`
                      : ""}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
          {number(summary?.budget?.utilizationPercent) >= 100 ? (
            <p className="mt-4 rounded-xl border border-critical/35 bg-critical/10 px-3 py-2 text-sm font-medium text-critical">
              {label(
                fr,
                "Budget limit reached. New financial operations require an owner justification.",
                "Limite budgétaire atteinte. Les nouvelles opérations financières exigent une justification du propriétaire.",
              )}
            </p>
          ) : number(summary?.budget?.utilizationPercent) >= 90 ? (
            <p className="mt-4 rounded-xl border border-warning/35 bg-warning/10 px-3 py-2 text-sm font-medium text-warning-foreground">
              {label(
                fr,
                "Over 90% of the project budget is used.",
                "Plus de 90 % du budget du projet est utilisé.",
              )}
            </p>
          ) : number(summary?.budget?.utilizationPercent) >= 80 ? (
            <p className="mt-4 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-ink-secondary">
              {label(
                fr,
                "Over 80% of the project budget is used. Monitor upcoming operations.",
                "Plus de 80 % du budget du projet est utilisé. Surveillez les prochaines opérations.",
              )}
            </p>
          ) : null}
        </Panel>
        {summary?.productionProfitability ? (
          <ProductionProfitabilityPanel
            data={summary.productionProfitability}
            fr={fr}
            locale={locale}
          />
        ) : null}
        <BudgetChangeHistory
          rows={budgetHistoryRows}
          fr={fr}
          locale={locale}
          defaultCurrency={project.currencyCode}
        />
        <Panel
          title={label(fr, "Budget by task", "Budget par tâche")}
          subtitle={label(
            fr,
            "Edit a project task to set its optional budget. No separate budget line is created.",
            "Modifiez une tâche du projet pour définir son budget facultatif. Aucune ligne budgétaire séparée n’est créée.",
          )}
        >
          {taskBudgets.length ? (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="min-w-[860px] w-full text-left text-sm">
                <thead className="bg-surface-2 text-xs uppercase tracking-[.08em] text-ink-muted">
                  <tr>
                    {[
                      label(fr, "Phase", "Phase"),
                      label(fr, "Task", "Tâche"),
                      label(fr, "Planned", "Prévu"),
                      label(fr, "Committed", "Engagé"),
                      label(fr, "Spent", "Dépensé"),
                      label(fr, "Available", "Disponible"),
                      label(fr, "Usage", "Utilisation"),
                      label(fr, "Status", "Statut"),
                    ].map((heading) => (
                      <th key={heading} className="px-4 py-3 font-semibold">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-surface-1">
                  {taskBudgets.map((task) => (
                    <tr
                      key={task.id}
                      className="align-top hover:bg-surface-2/60"
                    >
                      <td className="px-4 py-3 text-ink-secondary">
                        {task.phaseName || "—"}
                      </td>
                      <td className="px-4 py-3 font-medium text-ink">
                        {task.title}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {money(
                          task.planned,
                          task.currencyCode ?? project.currencyCode,
                          locale,
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-amber-700">
                        {money(
                          task.committed,
                          task.currencyCode ?? project.currencyCode,
                          locale,
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-rose-700">
                        {money(
                          task.spent,
                          task.currencyCode ?? project.currencyCode,
                          locale,
                        )}
                      </td>
                      <td
                        className={`px-4 py-3 tabular-nums ${number(task.available) < 0 ? "text-critical" : "text-emerald-700"}`}
                      >
                        {money(
                          task.available,
                          task.currencyCode ?? project.currencyCode,
                          locale,
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {number(task.utilizationPercent).toFixed(0)}%
                      </td>
                      <td className="px-4 py-3">{budgetStatus(task.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Landmark}
              title={label(fr, "No task budget yet", "Aucun budget de tâche")}
              description={label(
                fr,
                "Create or edit a work task, then enter its optional budget.",
                "Créez ou modifiez une tâche de travail, puis saisissez son budget facultatif.",
              )}
            />
          )}
        </Panel>
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel
            title={label(fr, "Unassigned spending", "Dépenses non affectées")}
            subtitle={label(
              fr,
              "Operations without a task still reduce the main project budget and remain visible here.",
              "Les opérations sans tâche réduisent quand même le budget principal et restent visibles ici.",
            )}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface-2/55 p-4">
                <p className="text-xs font-semibold uppercase tracking-[.1em] text-ink-muted">
                  {label(fr, "Committed", "Engagé")}
                </p>
                <p className="mt-1 text-lg font-semibold text-amber-700">
                  {money(
                    summary?.budget?.unassignedCommitted,
                    project.currencyCode,
                    locale,
                  )}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-surface-2/55 p-4">
                <p className="text-xs font-semibold uppercase tracking-[.1em] text-ink-muted">
                  {label(fr, "Spent", "Dépensé")}
                </p>
                <p className="mt-1 text-lg font-semibold text-rose-700">
                  {money(
                    summary?.budget?.unassignedSpent,
                    project.currencyCode,
                    locale,
                  )}
                </p>
              </div>
            </div>
          </Panel>
          <Panel
            title={label(fr, "Accounting rule", "Règle comptable")}
            subtitle={label(
              fr,
              "The same amount is counted once only.",
              "Un même montant n’est compté qu’une seule fois.",
            )}
          >
            <ul className="space-y-2 text-sm leading-6 text-ink-secondary">
              <li>
                {label(
                  fr,
                  "Drafts and purchase requests have no budget impact.",
                  "Les brouillons et demandes d’achat n’ont aucun impact budgétaire.",
                )}
              </li>
              <li>
                {label(
                  fr,
                  "An approved purchase order is committed; an accepted receipt moves that amount to spent.",
                  "Un bon de commande approuvé est engagé ; une réception acceptée transfère ce montant en dépensé.",
                )}
              </li>
              <li>
                {label(
                  fr,
                  "A payment linked to an accepted receipt is recorded without a second budget impact.",
                  "Un paiement lié à une réception acceptée est enregistré sans second impact budgétaire.",
                )}
              </li>
            </ul>
          </Panel>
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <RecordsPanel
            title={label(
              fr,
              "Direct expenses & supplier payments",
              "Dépenses directes et paiements fournisseurs",
            )}
            subtitle={label(
              fr,
              "Direct costs need approval. Supplier payments linked to a confirmed receipt remain neutral in the budget.",
              "Les coûts directs nécessitent une approbation. Les paiements fournisseur liés à une réception confirmée restent neutres dans le budget.",
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
              "Financial decisions remain traceable in the approval queue.",
              "Les décisions financières restent traçables dans la file d’approbation.",
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
                {label(
                  fr,
                  "Open approval queue",
                  "Ouvrir la file d’approbation",
                )}
              </Link>
            }
          />
        </div>
      </section>
    );
  }
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
          <div className="max-h-[30rem] space-y-3 overflow-y-auto pr-1">
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
          <p className="rounded-xl border border-brand/20 bg-brand-subtle/40 px-3 py-2 text-xs leading-5 text-ink-secondary">
            {label(
              fr,
              "A material becomes physical inventory only after its receipt is confirmed. Drafts and purchase orders remain project planning, not stock.",
              "Un matériau devient du stock physique uniquement après confirmation de sa réception. Les brouillons et bons de commande restent une planification du projet, pas du stock.",
            )}
          </p>
          {summary?.materials?.length ? (
            <div className="mt-3 max-h-[30rem] space-y-3 overflow-y-auto pr-1">
              {(summary?.materials ?? []).map((item, index) => (
                <article
                  key={String(
                    item.id ?? `${String(item.name ?? "material")}-${index}`,
                  )}
                  className="rounded-xl border border-border bg-surface-2/45 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
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
                    <div className="flex flex-wrap justify-end gap-2">
                      <span className="rounded-lg border border-border bg-surface-1 px-2.5 py-1 text-xs font-medium text-ink-secondary">
                        {label(fr, "Planned", "Prévu")} ·{" "}
                        {number(item.plannedQuantity)} {String(item.unit ?? "")}
                      </span>
                      <span className="rounded-lg border border-border bg-surface-1 px-2.5 py-1 text-xs font-medium text-ink-secondary">
                        {Number(item.receivedQuantity ?? 0) > 0
                          ? item.inventoryItemId
                            ? label(fr, "Stock linked", "Stock relié")
                            : label(
                                fr,
                                "Stock link pending",
                                "Liaison stock en attente",
                              )
                          : label(fr, "Not received yet", "Pas encore reçu")}
                      </span>
                    </div>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    {[
                      [
                        label(fr, "Ordered", "Commandé"),
                        item.purchasedQuantity,
                      ],
                      [label(fr, "Received", "Reçu"), item.receivedQuantity],
                      [label(fr, "Used", "Utilisé"), item.usedQuantity],
                      [
                        label(fr, "Available", "Disponible"),
                        item.availableQuantity ?? item.available,
                      ],
                      [
                        label(fr, "Still needed", "À commander"),
                        item.stillNeeded,
                      ],
                    ].map(([metricLabel, value]) => (
                      <div
                        key={String(metricLabel)}
                        className="rounded-lg border border-border/80 bg-surface-1 px-2.5 py-2"
                      >
                        <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                          {String(metricLabel)}
                        </dt>
                        <dd className="mt-1 text-sm font-semibold text-ink">
                          {number(value)} {String(item.unit ?? "")}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </article>
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
        <ProcurementRecordsPanel
          title={label(fr, "Purchase requests", "Demandes d’achat")}
          orgSlug={orgSlug}
          pdfResource="purchase-requests"
          canDownloadPdf={canControl("projects.create")}
          subtitle={label(
            fr,
            "Need identified → request → approval.",
            "Besoin identifié → demande → approbation.",
          )}
          rows={requests}
          relatedRows={requestLines}
          relatedKey="purchaseRequestId"
          relatedLabel={label(fr, "Requested items", "Articles demandés")}
          onEditRelatedRow={
            canWrite("procurement.update")
              ? (record) => setEditor({ kind: "request-line", record })
              : undefined
          }
          fields={["requestNumber", "status", "requiredDate", "reason"]}
          fr={fr}
          icon={ClipboardCheck}
          onAdd={
            canWrite("procurement.create")
              ? () => setEditor({ kind: "request" })
              : undefined
          }
          onEdit={
            canWrite("procurement.update")
              ? (record) => setEditor({ kind: "request", record })
              : undefined
          }
          canEditRow={(record) => String(record.status) === "draft"}
          onSubmit={
            canWrite("procurement.update")
              ? (record) =>
                  onConfirmAction({
                    title: label(
                      fr,
                      "Submit purchase request",
                      "Soumettre la demande",
                    ),
                    description: label(
                      fr,
                      "Once submitted, this request and its items can no longer be changed. Continue?",
                      "Une fois soumise, cette demande et ses articles ne peuvent plus être modifiés. Continuer ?",
                    ),
                    confirmLabel: label(fr, "Submit", "Soumettre"),
                    tone: "primary",
                    onConfirm: () => onSubmitPurchaseRequest(record),
                  })
              : undefined
          }
          submitLabel={label(fr, "Submit", "Soumettre")}
          editLabel={label(fr, "Edit or submit", "Modifier ou soumettre")}
          onAddItem={
            canWrite("procurement.create")
              ? (request) =>
                  setEditor({
                    kind: "request-line",
                    requestId: String(request.id),
                  })
              : undefined
          }
        />
        <ProcurementRecordsPanel
          title={label(fr, "Purchase orders", "Bons de commande")}
          orgSlug={orgSlug}
          pdfResource="purchase-orders"
          canDownloadPdf={canControl("projects.create")}
          subtitle={label(
            fr,
            "Approved request → order → supplier.",
            "Demande approuvée → commande → fournisseur.",
          )}
          rows={orders}
          relatedRows={orderLines}
          relatedKey="purchaseOrderId"
          relatedLabel={label(fr, "Ordered items", "Articles commandés")}
          onEditRelatedRow={
            canWrite("procurement.update")
              ? (record) => setEditor({ kind: "order-line", record })
              : undefined
          }
          onAddItem={
            canWrite("procurement.create")
              ? (order) =>
                  setEditor({ kind: "order-line", orderId: String(order.id) })
              : undefined
          }
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
          onSubmit={
            canWrite("procurement.update")
              ? (order) =>
                  onConfirmAction({
                    title: label(
                      fr,
                      "Send purchase order",
                      "Envoyer le bon de commande",
                    ),
                    description: label(
                      fr,
                      "This marks the order as sent and commits its total to the project budget. Download its PDF to share it with the supplier. Continue?",
                      "Le bon sera marqué comme envoyé et son total sera engagé dans le budget du projet. Téléchargez ensuite son PDF pour le transmettre au fournisseur. Continuer ?",
                    ),
                    confirmLabel: label(
                      fr,
                      "Send to supplier",
                      "Envoyer au fournisseur",
                    ),
                    tone: "primary",
                    onConfirm: () => onSendPurchaseOrder(order),
                  })
              : undefined
          }
          canSubmitRow={(order) =>
            String(order.status) === "draft" &&
            orderLines.some(
              (line) => String(line.purchaseOrderId) === String(order.id),
            )
          }
          onCancel={
            canControl("procurement.update")
              ? (order) =>
                  onConfirmAction({
                    title: label(
                      fr,
                      "Cancel purchase order",
                      "Annuler le bon de commande",
                    ),
                    description: label(
                      fr,
                      "This cancels the supplier order and releases its committed budget. The original PDF remains in the audit history. A corrected order can then be created from the approved request. Continue?",
                      "Cette action annule le bon envoyé au fournisseur et libère son montant engagé. Le PDF original reste dans l’historique. Vous pourrez ensuite créer un bon corrigé depuis la demande approuvée. Continuer ?",
                    ),
                    confirmLabel: label(fr, "Cancel order", "Annuler le bon"),
                    tone: "danger",
                    onConfirm: () => onCancelPurchaseOrder(order),
                  })
              : undefined
          }
          canCancelRow={(order) =>
            ["draft", "sent"].includes(String(order.status)) &&
            !receipts.some(
              (receipt) =>
                String(receipt.purchaseOrderId ?? "") === String(order.id),
            )
          }
          submitLabel={label(fr, "Send to supplier", "Envoyer au fournisseur")}
        />
        <ProcurementRecordsPanel
          title={label(fr, "Receiving", "Réceptions")}
          orgSlug={orgSlug}
          pdfResource="receipts"
          canDownloadPdf={canControl("projects.create")}
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
          onEdit={
            canWrite("procurement.update")
              ? (receipt) => setEditor({ kind: "receipt", record: receipt })
              : undefined
          }
          canEditRow={(receipt) => String(receipt.status) === "draft"}
          editLabel={label(fr, "Edit receipt", "Modifier la réception")}

          onSubmit={
            canWrite("procurement.update")
              ? (receipt) =>
                  onConfirmAction({
                    title: label(
                      fr,
                      "Confirm receipt",
                      "Confirmer la réception",
                    ),
                    description: label(
                      fr,
                      "Confirm that the received items have been checked. This updates the project budget immediately.",
                      "Confirmez que les articles reçus ont été vérifiés. Le budget du projet sera mis à jour immédiatement.",
                    ),
                    confirmLabel: label(
                      fr,
                      "Confirm receipt",
                      "Confirmer la réception",
                    ),
                    tone: "primary",
                    onConfirm: () => onConfirmReceipt(receipt),
                  })
              : undefined
          }
          canSubmitRow={(receipt) =>
            ["draft", "cancelled"].includes(String(receipt.status)) &&
            receiptLines.some(
              (line) => String(line.receiptId ?? "") === String(receipt.id),
            )
          }
          onAddItem={
            canWrite("procurement.create")
              ? (receipt) =>
                  setEditor({
                    kind: "receipt-line",
                    receiptId: String(receipt.id),
                  })
              : undefined
          }
          canAddItemRow={(receipt) =>
            !receiptLines.some(
              (line) => String(line.receiptId ?? "") === String(receipt.id),
            )
          }
          addItemLabel={label(
            fr,
            "Add a missing item",
            "Ajouter un article manquant",
          )}
          onEditRelatedRow={
            canWrite("procurement.update")
              ? (record) => setEditor({ kind: "receipt-line", record })
              : undefined
          }
          onReturnToDraft={
            canControl("projects.create")
              ? (receipt) =>
                  onConfirmAction({
                    title: label(
                      fr,
                      "Reopen receipt as draft",
                      "Réouvrir la réception en brouillon",
                    ),
                    description: label(
                      fr,
                      "Use this only to add or correct received items before confirming this same receipt again. Its budget and stock impact remain reversed until confirmation.",
                      "Utilisez cette action seulement pour ajouter ou corriger les articles reçus avant de confirmer à nouveau cette même réception. Son impact sur le budget et le stock reste annulé jusqu’à la confirmation.",
                    ),
                    confirmLabel: label(
                      fr,
                      "Reopen as draft",
                      "Réouvrir en brouillon",
                    ),
                    tone: "primary",
                    onConfirm: () => onReopenReceipt(receipt),
                  })
              : undefined
          }
          canReturnRow={(receipt) => String(receipt.status) === "cancelled"}
          relatedRows={receiptLines}
          relatedKey="receiptId"
          relatedLabel={label(fr, "Received items", "Articles reçus")}
          onReject={
            canWrite("procurement.update")
              ? (receipt) =>
                  onConfirmAction({
                    title: label(fr, "Reject delivery", "Refuser la livraison"),
                    description: label(
                      fr,
                      "Use this when the supplier delivery is not accepted. The receipt is closed and no project budget is spent.",
                      "Utilisez cette action lorsque la livraison du fournisseur n’est pas acceptée. La réception est clôturée et aucun montant n’est dépensé sur le budget du projet.",
                    ),
                    confirmLabel: label(
                      fr,
                      "Reject delivery",
                      "Refuser la livraison",
                    ),
                    tone: "danger",
                    onConfirm: () => onRejectReceipt(receipt),
                  })
              : undefined
          }
          canRejectRow={(receipt) => String(receipt.status) === "draft"}
          onVerify={
            canWrite("procurement.update")
              ? (receipt) =>
                  onConfirmAction({
                    title: label(fr, "Verify receipt", "Vérifier la réception"),
                    description: label(
                      fr,
                      "Confirm the final physical and document check. This does not create a second budget impact.",
                      "Confirmez le contrôle physique et documentaire final. Cette vérification ne crée pas un second impact budgétaire.",
                    ),
                    confirmLabel: label(
                      fr,
                      "Verify receipt",
                      "Vérifier la réception",
                    ),
                    tone: "primary",
                    onConfirm: () => onVerifyReceipt(receipt),
                  })
              : undefined
          }
          canVerifyRow={(receipt) => String(receipt.status) === "received"}
          onCancel={
            canControl("projects.create")
              ? (receipt) =>
                  onConfirmAction({
                    title: label(
                      fr,
                      "Cancel receipt / supplier return",
                      "Annuler la réception / retour fournisseur",
                    ),
                    description: label(
                      fr,
                      "Use this only when the full confirmed delivery has been returned. It reverses this receipt from stock and the project budget, then reopens the purchase order. It is blocked after supplier payment, stock consumption, or durable-asset registration.",
                      "Utilisez cette action seulement lorsque toute la livraison confirmée a été retournée. Elle retire cette réception du stock et du budget du projet, puis rouvre le bon de commande. Elle est bloquée après un paiement fournisseur, une consommation du stock ou l’enregistrement d’une immobilisation.",
                    ),
                    confirmLabel: label(
                      fr,
                      "Cancel and return",
                      "Annuler et retourner",
                    ),
                    tone: "danger",
                    onConfirm: () => onCancelReceipt(receipt),
                  })
              : undefined
          }
          canCancelRow={(receipt) =>
            ["received", "verified"].includes(String(receipt.status))
          }
          rejectLabel={label(fr, "Reject delivery", "Refuser la livraison")}
          verifyLabel={label(fr, "Verify receipt", "Vérifier la réception")}
          cancelLabel={label(fr, "Cancel / return", "Annuler / retourner")}
          submitLabel={label(fr, "Confirm receipt", "Confirmer la réception")}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <ProcurementRecordsPanel
          title={label(fr, "Requested items", "Articles demandés")}
          subtitle={label(
            fr,
            "Quantities and estimated cost requested for this project.",
            "Quantités et coût estimé demandés pour ce projet.",
          )}
          rows={requestLines}
          fields={["description", "requestedQuantity", "unit"]}
          fr={fr}
          icon={ClipboardCheck}
        />
        <ProcurementRecordsPanel
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
        <ProcurementRecordsPanel
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
          leading={(asset) => (
            <ProjectAssetPhoto orgSlug={orgSlug} asset={asset} fr={fr} />
          )}
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
  portfolioProjects,
  portfolioPhases,
  portfolioTasks,
  budgets,
  documents,
  materials,
  assets,
  requests,
  requestLines,
  orders,
  orderLines,
  receipts,
  receiptLines,
  expenses,
  workOrders,
  vehicleProfiles,
  maintenancePlans,
  suppliers,
  warehouses,
  inventoryItems,
  sites,
  provinces,
  members,
  taskAssignees,
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
  portfolioProjects: Project[];
  portfolioPhases: Row[];
  portfolioTasks: Row[];
  budgets: Row[];
  documents: Row[];
  materials: Row[];
  assets: Row[];
  requests: Row[];
  requestLines: Row[];
  orders: Row[];
  orderLines: Row[];
  receipts: Row[];
  receiptLines: Row[];
  expenses: Row[];
  workOrders: Row[];
  vehicleProfiles: Row[];
  maintenancePlans: Row[];
  suppliers: Row[];
  warehouses: Row[];
  inventoryItems: Row[];
  sites: Place[];
  provinces: Place[];
  members: Array<{ id: string; name: string }>;
  taskAssignees: Row[];
  fr: boolean;
  isOwner: boolean;
  working: boolean;
  onClose: () => void;
  onSave: (
    resource: OwnerManagementResource,
    body: ManagementBody,
    taskDocuments?: { documentIds: string[] },
    expenseEvidence?: File,
    assetPhoto?: File,
    taskEvidence?: File,
    qualityBeforePhoto?: File,
    qualityAfterPhoto?: File,
  ) => Promise<void>;
}) {
  const editing = editor.record;
  const getValue = (key: string) => {
    if (key === "receiptId" && editor.receiptId) return editor.receiptId;
    return editing?.[key] == null ? "" : String(editing[key]);
  };
  const getBenefitTarget = (key: keyof BenefitTargets) => {
    const targets = editing?.benefitTargets;
    if (!targets || typeof targets !== "object" || Array.isArray(targets))
      return "";
    const value = (targets as BenefitTargets)[key];
    return value == null ? "" : String(value);
  };
  const projectId = project?.id ?? "";
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
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
        operationalStartDate: optional(form, "operationalStartDate"),
        benefitReviewDate: optional(form, "benefitReviewDate"),
        benefitOwnerMemberId: optional(form, "benefitOwnerMemberId"),
        lifecycleStage: String(form.get("lifecycleStage") ?? "investment"),
        benefitTargets: {
          targetProductionQuantity: optionalNumber(
            form,
            "targetProductionQuantity",
          ),
          targetProductionUnit: optional(form, "targetProductionUnit"),
          targetProductionPeriod: optional(form, "targetProductionPeriod"),
          targetSalesAmount: optionalNumber(form, "targetSalesAmount"),
          targetMarginPercent: optionalNumber(form, "targetMarginPercent"),
          targetMortalityPercent: optionalNumber(
            form,
            "targetMortalityPercent",
          ),
          targetUnitCost: optionalNumber(form, "targetUnitCost"),
        },
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
        budgetCurrencyCode: nullableValue(form, "budgetCurrencyCode"),
        budgetOverrideReason: nullableValue(form, "budgetOverrideReason"),
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
    } else if (editor.kind === "risk") {
      resource = "risks";
      body = {
        projectId,
        recordType: String(form.get("recordType") ?? "risk"),
        category: String(form.get("category") ?? "other"),
        title: String(form.get("title") ?? "").trim(),
        description: nullableValue(form, "description"),
        probability: String(form.get("probability") ?? "medium"),
        impact: String(form.get("impact") ?? "medium"),
        ownerMemberId: String(form.get("ownerMemberId") ?? "").trim(),
        triggerCondition: String(form.get("triggerCondition") ?? "").trim(),
        alertThreshold: String(form.get("alertThreshold") ?? "").trim(),
        preventionAction: String(form.get("preventionAction") ?? "").trim(),
        contingencyAction: nullableValue(form, "contingencyAction"),
        reviewDate: String(form.get("reviewDate") ?? "").trim(),
        status: String(form.get("status") ?? "open"),
        decision: String(form.get("decision") ?? "pending"),
        decisionTaken: nullableValue(form, "decisionTaken"),
        decisionJustification: nullableValue(form, "decisionJustification"),
        notes: nullableValue(form, "notes"),
      };
    } else if (editor.kind === "quality-check") {
      resource = "quality-checks";
      body = {
        projectId,
        receiptId: nullableValue(form, "receiptId"),
        assetId: nullableValue(form, "assetId"),
        qualityStatus: String(form.get("qualityStatus") ?? "pending"),
        quantityMatches: form.get("quantityMatches") === "on",
        conditionAccepted: form.get("conditionAccepted") === "on",
        documentsComplete: form.get("documentsComplete") === "on",
        functionalTestPassed: form.get("functionalTestPassed") === "on",
        safetyCheckPassed: form.get("safetyCheckPassed") === "on",
        returnedQuantity: optionalNumber(form, "returnedQuantity") ?? 0,
        returnReason: nullableValue(form, "returnReason"),
        warrantyProvider: nullableValue(form, "warrantyProvider"),
        warrantyReference: nullableValue(form, "warrantyReference"),
        warrantyExpiresOn: nullableValue(form, "warrantyExpiresOn"),
        beforePhotoDocumentId: nullableValue(form, "beforePhotoDocumentId"),
        afterPhotoDocumentId: nullableValue(form, "afterPhotoDocumentId"),
        commissioningStatus: String(
          form.get("commissioningStatus") ?? "not_required",
        ),
        commissioningNotes: nullableValue(form, "commissioningNotes"),
        notes: nullableValue(form, "notes"),
      };
    } else if (editor.kind === "closeout") {
      resource = "project-closeouts";
      const achieved = String(form.get("expectedOutcomeAchieved") ?? "");
      body = {
        projectId,
        status: String(form.get("status") ?? "draft"),
        expectedOutcomeAchieved:
          achieved === "yes" ? true : achieved === "no" ? false : null,
        achievementSummary: nullableValue(form, "achievementSummary"),
        actualOutcome: nullableValue(form, "actualOutcome"),
        lessonsLearned: nullableValue(form, "lessonsLearned"),
        handoverMemberId: nullableValue(form, "handoverMemberId"),
        commissioningValidated: form.get("commissioningValidated") === "on",
        commissioningSummary: nullableValue(form, "commissioningSummary"),
        closeoutDocumentId: nullableValue(form, "closeoutDocumentId"),
        notes: nullableValue(form, "notes"),
      };
    } else if (editor.kind === "member") {
      resource = "project-members";
      body = {
        projectId,
        memberId: String(form.get("memberId") ?? ""),
        assignmentRole: "project_manager",
        isManager: true,
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
        supplierId: optional(form, "supplierId"), // The server owns the request date and approval state. The requester
        // may only save a draft or submit it; an owner decides in Approvals.
        requiredDate: optional(form, "requiredDate"),
        priority: String(form.get("priority") ?? "medium"),
        status: String(form.get("status") ?? "draft"),
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
        estimatedUnitCost: optionalNumber(form, "estimatedUnitCost"),
        notes: optional(form, "notes"),
      };
    } else if (editor.kind === "order") {
      resource = "purchase-orders";
      body = {
        // The API/database owns the BC counter. Omitting this field also keeps
        // an edit from ever changing an already-issued purchase-order number.
        projectId,
        // The approved request is the sole source for its phase and linked
        // task. The API derives both so records from another project cannot
        // appear in this purchase order.
        purchaseRequestId: optional(form, "purchaseRequestId"),
        supplierId: String(form.get("supplierId") ?? ""),
        warehouseId: optional(form, "warehouseId"),
        orderDate: String(form.get("orderDate") ?? ""),
        expectedDeliveryDate: optional(form, "expectedDeliveryDate"),
        ...(editor.record
          ? {}
          : { status: String(form.get("status") ?? "draft") }),
        currencyCode: String(
          form.get("currencyCode") ?? project?.currencyCode ?? "CDF",
        ),
        supplierReference: optional(form, "supplierReference"),
        deliveryAddress: optional(form, "deliveryAddress"),
        notes: optional(form, "notes"),
        budgetOverrideReason: optional(form, "budgetOverrideReason"),
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
        projectId,
        purchaseOrderId: String(form.get("purchaseOrderId") ?? ""),
        warehouseId: optional(form, "warehouseId"),
        receivedDate: String(form.get("receivedDate") ?? ""),
        deliveryNoteNumber: optional(form, "deliveryNoteNumber"),
        ...(editor.record ? {} : { status: "draft" }),
        notes: optional(form, "notes"),
        budgetOverrideReason: optional(form, "budgetOverrideReason"),
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
      const expenseType = String(form.get("expenseType") ?? "direct_expense");
      body = {
        expenseType,
        projectId,
        phaseId,
        projectTaskId: optional(form, "projectTaskId"),
        receiptId:
          expenseType === "receipt_payment"
            ? optional(form, "receiptId")
            : null,
        provinceId: project?.provinceId,
        siteId: siteId ?? project?.siteId,
        title: optional(form, "title"),
        beneficiaryName: optional(form, "beneficiaryName"),
        category: optional(form, "category"),
        description: optional(form, "description"),
        amount: Number(form.get("amount") ?? 0),
        currencyCode: String(
          form.get("currencyCode") ?? project?.currencyCode ?? "CDF",
        ),
        expenseDate: String(form.get("expenseDate") ?? ""),
        paymentMethod: optional(form, "paymentMethod"),
        paymentReference: optional(form, "paymentReference"),
        paymentIdempotencyKey: optional(form, "paymentIdempotencyKey"),
        status: String(form.get("status") ?? "draft"),
        receiptReference: optional(form, "receiptReference"),
        notes: optional(form, "notes"),
        budgetOverrideReason: optional(form, "budgetOverrideReason"),
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
          ? formElement.elements.namedItem(firstFieldName)
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
          ? formElement.elements.namedItem(firstFieldName)
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
          ? formElement.elements.namedItem(firstFieldName)
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
          ? formElement.elements.namedItem(firstFieldName)
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
    const taskEvidenceValue =
      editor.kind === "task" ? form.get("taskEvidence") : null;
    const taskEvidence =
      taskEvidenceValue instanceof File && taskEvidenceValue.size > 0
        ? taskEvidenceValue
        : undefined;
    const expenseEvidenceValue =
      editor.kind === "expense" ? form.get("expenseEvidence") : null;
    const expenseEvidence =
      expenseEvidenceValue instanceof File && expenseEvidenceValue.size > 0
        ? expenseEvidenceValue
        : undefined;
    const assetPhotoValue =
      editor.kind === "asset" ? form.get("assetPhoto") : null;
    const assetPhoto =
      assetPhotoValue instanceof File && assetPhotoValue.size > 0
        ? assetPhotoValue
        : undefined;
    const qualityBeforePhotoValue =
      editor.kind === "quality-check" ? form.get("qualityBeforePhoto") : null;
    const qualityBeforePhoto =
      qualityBeforePhotoValue instanceof File &&
      qualityBeforePhotoValue.size > 0
        ? qualityBeforePhotoValue
        : undefined;
    const qualityAfterPhotoValue =
      editor.kind === "quality-check" ? form.get("qualityAfterPhoto") : null;
    const qualityAfterPhoto =
      qualityAfterPhotoValue instanceof File && qualityAfterPhotoValue.size > 0
        ? qualityAfterPhotoValue
        : undefined;
    void onSave(
      resource,
      body,
      taskDocuments,
      expenseEvidence,
      assetPhoto,
      taskEvidence,
      qualityBeforePhoto,
      qualityAfterPhoto,
    ).catch((error: unknown) => {
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
      if (
        resource === "tasks" &&
        error instanceof ApiError &&
        error.message ===
          "Assign this project task only to an active employee at the project site or province"
      ) {
        nextErrors.assignedMemberId = fr
          ? "Choisissez un employé actif rattaché au site ou à la province de ce projet."
          : "Choose an active employee assigned to this project's site or province.";
      }
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
        ? formElement.elements.namedItem(firstFieldName)
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
    risk: label(fr, "Risk or issue", "Risque ou problème"),
    "quality-check": label(fr, "Quality check", "Contrôle qualité"),
    closeout: label(fr, "Project close-out report", "Procès-verbal de clôture"),
    member: label(fr, "Project manager", "Manager du projet"),
    "operational-link": label(
      fr,
      "Operational resource link",
      "Lien operationnel",
    ),
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
              getBenefitTarget={getBenefitTarget}
              isEditing={Boolean(editing)}
              fr={fr}
              project={project}
              phases={phases}
              tasks={tasks}
              portfolioProjects={portfolioProjects}
              portfolioPhases={portfolioPhases}
              portfolioTasks={portfolioTasks}
              budgets={budgets}
              documents={documents}
              materials={materials}
              assets={assets}
              requests={requests}
              requestLines={requestLines}
              orders={orders}
              orderLines={orderLines}
              receipts={receipts}
              receiptLines={receiptLines}
              expenses={expenses}
              workOrders={workOrders}
              vehicleProfiles={vehicleProfiles}
              maintenancePlans={maintenancePlans}
              suppliers={suppliers}
              warehouses={warehouses}
              inventoryItems={inventoryItems}
              sites={sites}
              provinces={provinces}
              members={members}
              taskAssignees={taskAssignees}
              preselectedRequestId={editor.requestId}
              preselectedOrderId={editor.orderId}
              preselectedReceiptId={editor.receiptId}
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
                : editor.kind === "receipt"
                  ? label(
                      fr,
                      "Create receipt and copy items",
                      "Créer la réception et reprendre les articles",
                    )
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
  getBenefitTarget,
  isEditing,
  fr,
  project,
  phases,
  tasks,
  portfolioProjects,
  portfolioPhases,
  portfolioTasks,
  budgets,
  documents,
  materials,
  assets,
  requests,
  requestLines,
  orders,
  orderLines,
  receipts,
  receiptLines,
  expenses,
  workOrders,
  vehicleProfiles,
  maintenancePlans,
  suppliers,
  warehouses,
  inventoryItems,
  sites,
  provinces,
  members,
  taskAssignees,
  preselectedRequestId,
  preselectedOrderId,
  preselectedReceiptId,
  isOwner,
}: {
  kind: EditorKind;
  orgSlug: string;
  getValue: (key: string) => string;
  getBenefitTarget: (key: keyof BenefitTargets) => string;
  isEditing: boolean;
  fr: boolean;
  project: Project | null;
  phases: Row[];
  tasks: Row[];
  portfolioProjects: Project[];
  portfolioPhases: Row[];
  portfolioTasks: Row[];
  budgets: Row[];
  documents: Row[];
  materials: Row[];
  assets: Row[];
  requests: Row[];
  requestLines: Row[];
  orders: Row[];
  orderLines: Row[];
  receipts: Row[];
  receiptLines: Row[];
  expenses: Row[];
  workOrders: Row[];
  vehicleProfiles: Row[];
  maintenancePlans: Row[];
  suppliers: Row[];
  warehouses: Row[];
  inventoryItems: Row[];
  sites: Place[];
  provinces: Place[];
  members: Array<{ id: string; name: string }>;
  taskAssignees: Row[];
  preselectedRequestId?: string;
  preselectedOrderId?: string;
  preselectedReceiptId?: string;
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
  const [riskDecision, setRiskDecision] = useState(
    getValue("decision") || "pending",
  );
  const [selectedOrderId, setSelectedOrderId] = useState(
    () => getValue("purchaseOrderId") || preselectedOrderId || "",
  );
  const [selectedRequestLineId, setSelectedRequestLineId] = useState("");
  const [selectedReceiptLineReceiptId, setSelectedReceiptLineReceiptId] =
    useState(() => getValue("receiptId") || preselectedReceiptId || "");
  const [selectedReceiptOrderLineId, setSelectedReceiptOrderLineId] = useState(
    () => getValue("purchaseOrderLineId") || "",
  );
  const [selectedOrderRequestId, setSelectedOrderRequestId] = useState(
    () => getValue("purchaseRequestId") || preselectedRequestId || "",
  );
  const [selectedOrderSupplierId, setSelectedOrderSupplierId] = useState(
    () => getValue("supplierId") || "",
  );
  const [selectedOrderCurrencyCode, setSelectedOrderCurrencyCode] = useState(
    () => getValue("currencyCode") || project?.currencyCode || "CDF",
  );
  const [expenseTypeValue, setExpenseTypeValue] = useState(() => {
    const stored = getValue("expenseType");
    return (
      stored || (getValue("receiptId") ? "receipt_payment" : "direct_expense")
    );
  });
  const [selectedPaymentReceiptId, setSelectedPaymentReceiptId] = useState(() =>
    getValue("receiptId"),
  );
  const [receiptPaymentMode, setReceiptPaymentMode] = useState<
    "full" | "partial"
  >("full");
  const [receiptPaymentTitle, setReceiptPaymentTitle] = useState(() =>
    getValue("title"),
  );
  const [receiptPaymentAmount, setReceiptPaymentAmount] = useState(() =>
    getValue("amount"),
  );
  const [receiptPaymentCurrency, setReceiptPaymentCurrency] = useState(
    () => getValue("currencyCode") || project?.currencyCode || "CDF",
  );
  const [receiptPaymentDate, setReceiptPaymentDate] = useState(
    () =>
      dateValue(getValue("expenseDate")) ||
      new Date().toISOString().slice(0, 10),
  );
  const [paymentIdempotencyKey] = useState(
    () =>
      globalThis.crypto?.randomUUID?.() ??
      `payment-${Date.now()}-${Math.random()}`,
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
  const editingOrderLine = kind === "order-line" && Boolean(getValue("id"));
  const activeOrderId = selectedOrderId || getValue("purchaseOrderId");
  const selectedOrder = orders.find(
    (order) => String(order.id) === String(activeOrderId),
  );
  const requestLinesForSelectedOrder = selectedOrder?.purchaseRequestId
    ? requestLines.filter(
        (line) =>
          String(line.purchaseRequestId) ===
          String(selectedOrder.purchaseRequestId),
      )
    : [];
  const selectedRequestLine = editingOrderLine
    ? null
    : (requestLinesForSelectedOrder.find(
        (line) => String(line.id) === String(selectedRequestLineId),
      ) ??
      (requestLinesForSelectedOrder.length === 1
        ? requestLinesForSelectedOrder[0]
        : null));
  const orderLinePrefillKey = `${activeOrderId || "new"}-${selectedRequestLine?.id || "manual"}`;
  const prefilledOrderLineValue = (field: string, fallback = "") =>
    String(selectedRequestLine?.[field] ?? fallback ?? "");
  useEffect(() => {
    if (kind !== "order-line") return;
    setSelectedOrderId(getValue("purchaseOrderId") || preselectedOrderId || "");
    setSelectedRequestLineId("");
  }, [kind, getValue("id"), preselectedOrderId]);
  useEffect(() => {
    if (kind !== "receipt-line") return;
    setSelectedReceiptLineReceiptId(
      getValue("receiptId") || preselectedReceiptId || "",
    );
    setSelectedReceiptOrderLineId(getValue("purchaseOrderLineId") || "");
  }, [kind, getValue("id"), preselectedReceiptId]);
  useEffect(() => {
    if (kind !== "order") return;
    setSelectedOrderRequestId(
      getValue("purchaseRequestId") || preselectedRequestId || "",
    );
    setSelectedOrderSupplierId(getValue("supplierId") || "");
    setSelectedOrderCurrencyCode(
      getValue("currencyCode") || project?.currencyCode || "CDF",
    );
  }, [kind, getValue("id"), preselectedRequestId, project?.currencyCode]);
  const input = (
    name: string,
    title: string,
    required = false,
    type = "text",
  ) => {
    const supportsCustomUnit =
      name === "unit" && (kind === "request-line" || kind === "order-line");
    const unitListId = `${kind}-${name}-suggestions`;
    return (
      <Field
        label={title}
        htmlFor={name}
        required={required}
        error={fieldError(name)}
        hint={
          supportsCustomUnit
            ? label(
                fr,
                "Choose a common unit or type another one.",
                "Choisissez une unité courante ou saisissez-en une autre.",
              )
            : undefined
        }
      >
        <Input
          id={name}
          name={name}
          required={required}
          invalid={Boolean(fieldError(name))}
          type={type}
          list={supportsCustomUnit ? unitListId : undefined}
          placeholder={
            supportsCustomUnit
              ? label(
                  fr,
                  "Choose or enter a unit",
                  "Choisissez ou saisissez une unité",
                )
              : undefined
          }
          defaultValue={
            type === "date"
              ? dateValue(getValue(name)) ||
                (name === "assignmentStartDate"
                  ? new Date().toISOString().slice(0, 10)
                  : "")
              : getValue(name)
          }
        />
        {supportsCustomUnit ? (
          <datalist id={unitListId}>
            {PROCUREMENT_UNIT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {fr ? option.french : option.english}
              </option>
            ))}
          </datalist>
        ) : null}
      </Field>
    );
  };
  const defaultSelect = (name: string) => {
    const status =
      kind === "project"
        ? "planning"
        : kind === "phase" || kind === "task"
          ? "not_started"
          : kind === "risk"
            ? "open"
            : kind === "closeout"
              ? "draft"
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
      recordType: "risk",
      category: "other",
      probability: "medium",
      impact: "medium",
      decision: "pending",
      currencyCode: project?.currencyCode ?? "CDF",
      approvalStatus: "not_requested",
      itemKind: "material",
      movementType: "used",
      condition: "good",
      maintenanceType: "preventive",
      status,
      qualityStatus: "pending",
      commissioningStatus: "not_required",
    };
    if (
      kind === "request-line" &&
      name === "purchaseRequestId" &&
      preselectedRequestId
    )
      return preselectedRequestId;
    return getValue(name) || defaults[name] || "";
  };
  const select = (
    name: string,
    title: string,
    options: SelectOption[],
    required = false,
    noRecordsLabel?: string,
    emptyHint?: string,
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
            {emptyHint ??
              label(
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
  const projectNames = new Map(
    portfolioProjects.map((portfolioProject) => [
      String(portfolioProject.id),
      portfolioProject.name,
    ]),
  );
  const dependencyOptions = (rows: Row[], fields: string[]): SelectOption[] => {
    const seen = new Set<string>();
    return rows.flatMap((row) => {
      const value = String(row.id ?? "").trim();
      const name = fields
        .map((field) => String(row[field] ?? "").trim())
        .find(Boolean);
      if (!value || !name || seen.has(value)) return [];
      seen.add(value);
      const projectName = projectNames.get(String(row.projectId ?? ""));
      return [
        {
          value,
          text:
            projectName && String(row.projectId) !== String(project?.id)
              ? `${name} · ${projectName}`
              : name,
        },
      ];
    });
  };
  const prerequisitePhaseOptions = dependencyOptions(
    isOwner ? portfolioPhases : phases,
    ["name", "code"],
  );
  const taskOptions = relationalOptions(
    tasks.filter((row) => row.taskType !== "milestone"),
    ["title", "taskCode", "code"],
  );
  const dependencyTaskOptions = relationalOptions(tasks, [
    "title",
    "taskCode",
    "code",
  ]);
  const prerequisiteTaskOptions = dependencyOptions(
    isOwner ? portfolioTasks : tasks,
    ["title", "taskCode", "code"],
  );
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
              isOwner
                ? "No phase has been created yet. You can save this at project level, or add a phase from Planning."
                : "No phase has been created yet. You can save this task at project level; only the owner can add project phases.",
              isOwner
                ? "Aucune phase n’a encore été créée. Vous pouvez enregistrer au niveau du projet ou ajouter une phase dans Planification."
                : "Aucune phase n’a encore été créée. Vous pouvez enregistrer cette tâche au niveau du projet ; seul le propriétaire peut ajouter des phases.",
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
  const taskAssigneeOptions = relationalOptions(taskAssignees, [
    "name",
    "employeeNumber",
    "jobTitle",
  ]);
  const assetOptions = relationalOptions(assets, [
    "name",
    "assetNumber",
    "code",
  ]);
  const qualityReceiptOptions = relationalOptions(
    receipts.filter((receipt) =>
      ["received", "verified"].includes(String(receipt.status)),
    ),
    ["receiptNumber"],
  );
  const projectDocumentOptions = relationalOptions(projectDocuments, [
    "title",
    "fileName",
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
  const draftRequestOptions = relationalOptions(
    requests.filter((request) => String(request.status) === "draft"),
    ["requestNumber"],
  );
  // A request represents one supplier commitment. Once a live BC exists for
  // it, the request must not be offered again: doing so would copy its items
  // a second time and make the procurement trail ambiguous. A cancelled BC is
  // deliberately excluded here so the owner can issue a replacement order.
  const activeOrderRequestIds = new Set(
    orders
      .filter((order) => String(order.status) !== "cancelled")
      .map((order) => String(order.purchaseRequestId ?? ""))
      .filter(Boolean),
  );
  const editingOrderRequestId =
    kind === "order" && isEditing
      ? String(getValue("purchaseRequestId") || "")
      : "";
  const availableApprovedRequests = requests.filter(
    (request) =>
      ["approved", "partially_approved"].includes(
        String(request.approvalStatus),
      ) &&
      (String(request.id) === editingOrderRequestId ||
        !activeOrderRequestIds.has(String(request.id))),
  );
  const approvedRequestOptions = relationalOptions(availableApprovedRequests, [
    "requestNumber",
  ]);
  const selectedOrderRequest = availableApprovedRequests.find(
    (request) => String(request.id) === String(selectedOrderRequestId),
  );
  useEffect(() => {
    if (kind !== "order" || isEditing || !selectedOrderRequest) return;
    setSelectedOrderSupplierId(String(selectedOrderRequest.supplierId ?? ""));
    setSelectedOrderCurrencyCode(
      String(
        selectedOrderRequest.currencyCode ?? project?.currencyCode ?? "CDF",
      ),
    );
  }, [kind, isEditing, project?.currencyCode, selectedOrderRequest]);
  const requestLineOptions = relationalOptions(requestLines, ["description"]);
  const orderOptions = relationalOptions(orders, ["orderNumber"]);
  const receiptOrderId = String(
    getValue("purchaseOrderId") || preselectedOrderId || "",
  );
  const receiptById = new Map(
    receipts.map((receipt) => [String(receipt.id), receipt]),
  );
  const draftReceiptOrderIds = new Set(
    receipts
      .filter((receipt) => String(receipt.status) === "draft")
      .map((receipt) => String(receipt.purchaseOrderId ?? ""))
      .filter(Boolean),
  );
  const orderedQuantityByOrder = new Map<string, number>();
  const acceptedQuantityByOrder = new Map<string, number>();
  for (const orderLine of orderLines) {
    const orderId = String(orderLine.purchaseOrderId ?? "");
    if (!orderId) continue;
    orderedQuantityByOrder.set(
      orderId,
      (orderedQuantityByOrder.get(orderId) ?? 0) +
        number(orderLine.orderedQuantity),
    );
  }
  for (const receiptLine of receiptLines) {
    const receipt = receiptById.get(String(receiptLine.receiptId ?? ""));
    if (!receipt || !["received", "verified"].includes(String(receipt.status)))
      continue;
    const orderId = String(receipt.purchaseOrderId ?? "");
    if (!orderId) continue;
    const accepted = Math.max(
      0,
      number(receiptLine.receivedQuantity) -
        number(receiptLine.damagedQuantity) -
        number(receiptLine.rejectedQuantity),
    );
    acceptedQuantityByOrder.set(
      orderId,
      (acceptedQuantityByOrder.get(orderId) ?? 0) + accepted,
    );
  }
  const receivableOrderOptions = relationalOptions(
    orders.filter((order) => {
      const orderId = String(order.id ?? "");
      const belongsToProject =
        !project?.id || String(order.projectId ?? "") === String(project.id);
      if (!belongsToProject) return false;
      // Keep the currently edited BR intelligible even if it is a legacy
      // record whose order later became fully received or was cancelled.
      if (isEditing && orderId === receiptOrderId) return true;
      if (draftReceiptOrderIds.has(orderId)) return false;
      if (!["sent", "partially_received"].includes(String(order.status)))
        return false;
      const ordered = orderedQuantityByOrder.get(orderId) ?? 0;
      const accepted = acceptedQuantityByOrder.get(orderId) ?? 0;
      return ordered > 0 && accepted < ordered;
    }),
    ["orderNumber"],
  );
  const orderLineOptions = relationalOptions(orderLines, ["description"]);
  const receiptOptions = relationalOptions(
    receipts.filter((receipt) =>
      ["received", "verified"].includes(String(receipt.status)),
    ),
    ["receiptNumber"],
  );
  const receiptLineOptions = relationalOptions(
    receipts.filter((receipt) => String(receipt.status) === "draft"),
    ["receiptNumber"],
  );
  const activeReceiptLineReceiptId =
    selectedReceiptLineReceiptId ||
    getValue("receiptId") ||
    preselectedReceiptId ||
    "";
  const activeReceiptLineReceipt = receipts.find(
    (receipt) => String(receipt.id) === String(activeReceiptLineReceiptId),
  );
  const receiptOrderLineOptions = orderLines
    .filter(
      (line) =>
        String(line.purchaseOrderId ?? "") ===
        String(activeReceiptLineReceipt?.purchaseOrderId ?? ""),
    )
    .flatMap((line) => {
      const value = String(line.id ?? "").trim();
      const description = String(line.description ?? "").trim();
      if (!value || !description) return [];
      const quantity = number(line.orderedQuantity).toLocaleString(
        fr ? "fr-FR" : "en-US",
      );
      return [
        {
          value,
          text: `${description} · ${quantity} ${String(line.unit ?? "")}`.trim(),
        },
      ];
    });
  const activeReceiptOrderLineId =
    selectedReceiptOrderLineId ||
    getValue("purchaseOrderLineId") ||
    (receiptOrderLineOptions.length === 1
      ? (receiptOrderLineOptions[0]?.value ?? "")
      : "");
  const activeReceiptOrderLine = orderLines.find(
    (line) => String(line.id) === String(activeReceiptOrderLineId),
  );
  const linkedReceiptMaterial = materials.find(
    (material) =>
      String(material.id) ===
      String(activeReceiptOrderLine?.projectMaterialId ?? ""),
  );
  const linkedReceiptInventoryItem = inventoryItems.find(
    (item) =>
      String(item.id) === String(activeReceiptOrderLine?.inventoryItemId ?? ""),
  );
  const confirmedQuantityForReceiptOrderLine = receiptLines
    .filter((line) => {
      const receipt = receiptById.get(String(line.receiptId ?? ""));
      return (
        String(line.purchaseOrderLineId ?? "") ===
          String(activeReceiptOrderLine?.id ?? "") &&
        Boolean(receipt) &&
        ["received", "verified"].includes(String(receipt?.status))
      );
    })
    .reduce(
      (total, line) =>
        total +
        Math.max(
          0,
          number(line.receivedQuantity) -
            number(line.damagedQuantity) -
            number(line.rejectedQuantity),
        ),
      0,
    );
  const remainingQuantityForReceiptOrderLine = Math.max(
    number(activeReceiptOrderLine?.orderedQuantity) -
      confirmedQuantityForReceiptOrderLine,
    0,
  );
  const receiptPaymentDetails = (receiptId: string) => {
    const receipt = receipts.find((row) => String(row.id) === receiptId);
    const order = orders.find(
      (row) => String(row.id) === String(receipt?.purchaseOrderId ?? ""),
    );
    const orderLinesById = new Map(
      orderLines.map((line) => [String(line.id), line]),
    );
    const total = receipt
      ? receiptLines
          .filter((line) => String(line.receiptId) === String(receipt.id))
          .reduce((sum, line) => {
            const orderedLine = orderLinesById.get(
              String(line.purchaseOrderLineId ?? ""),
            );
            const accepted = Math.max(
              0,
              number(line.receivedQuantity) -
                number(line.damagedQuantity) -
                number(line.rejectedQuantity),
            );
            const unitCost =
              line.actualUnitCost === null || line.actualUnitCost === undefined
                ? number(orderedLine?.unitCost)
                : number(line.actualUnitCost);
            return sum + accepted * unitCost;
          }, 0)
      : 0;
    const paid = expenses
      .filter(
        (expense) =>
          String(expense.receiptId ?? "") === String(receiptId) &&
          String(expense.id ?? "") !== getValue("id") &&
          ["approved", "paid"].includes(String(expense.status ?? "")),
      )
      .reduce((sum, expense) => sum + number(expense.amount), 0);
    const outstanding = Math.max(total - paid, 0);
    const supplier = suppliers.find(
      (row) => String(row.id) === String(order?.supplierId ?? ""),
    );
    const currency = String(
      order?.currencyCode ?? project?.currencyCode ?? "CDF",
    );
    const receiptNumber = String(receipt?.receiptNumber ?? "");
    const orderNumber = String(order?.orderNumber ?? "");
    const title = [
      label(fr, "Supplier payment", "Paiement fournisseur"),
      receiptNumber,
      orderNumber,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      receipt,
      order,
      supplier,
      total,
      paid,
      outstanding,
      currency,
      title,
    };
  };
  const selectedReceiptPayment = receiptPaymentDetails(
    selectedPaymentReceiptId,
  );
  const applyReceiptPaymentDefaults = (receiptId: string) => {
    setSelectedPaymentReceiptId(receiptId);
    setReceiptPaymentMode("full");
    const details = receiptPaymentDetails(receiptId);
    if (!getValue("id")) {
      setReceiptPaymentTitle(details.title);
      setReceiptPaymentAmount(
        details.outstanding > 0 ? String(details.outstanding) : "",
      );
      setReceiptPaymentCurrency(details.currency);
      setReceiptPaymentDate(
        dateValue(String(details.receipt?.receivedDate ?? "")) ||
          new Date().toISOString().slice(0, 10),
      );
    }
  };
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
          label(
            fr,
            "Responsible manager (project access)",
            "Manager responsable (accès projet)",
          ),
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
        <div className="md:col-span-2 rounded-2xl border border-brand/20 bg-brand-subtle/30 p-4">
          <div>
            <p className="text-sm font-semibold text-ink">
              {label(fr, "Investment profile", "Fiche d’investissement")}
            </p>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              {label(
                fr,
                "Keep the investment accountable through commissioning and real operations. These targets do not change the main project budget.",
                "Gardez l’investissement responsable jusqu’à la mise en service et l’exploitation réelle. Ces cibles ne modifient pas le budget principal du projet.",
              )}
            </p>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field
              label={label(fr, "Lifecycle stage", "Étape du cycle")}
              htmlFor="lifecycleStage"
            >
              <select
                id="lifecycleStage"
                name="lifecycleStage"
                defaultValue={getValue("lifecycleStage") || "investment"}
                className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
              >
                {[
                  ["investment", label(fr, "Investment", "Investissement")],
                  [
                    "commissioning",
                    label(fr, "Commissioning", "Mise en service"),
                  ],
                  ["operating", label(fr, "Operating", "Exploitation")],
                  [
                    "closed",
                    label(
                      fr,
                      "Closed — complete the close-out report",
                      "Clôturé — finalisez le PV de clôture",
                    ),
                  ],
                ].map(([value, text]) => (
                  <option
                    key={value}
                    value={value}
                    disabled={value === "closed"}
                  >
                    {text}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs leading-5 text-ink-muted">
                {label(
                  fr,
                  "Closing is controlled from Quality & close-out after the formal report is completed.",
                  "La clôture est contrôlée depuis Qualité & clôture une fois le procès-verbal finalisé.",
                )}
              </p>
            </Field>
            {select(
              "benefitOwnerMemberId",
              label(fr, "Benefit owner", "Responsable des bénéfices"),
              memberOptions,
            )}
            <Field
              label={label(fr, "Operational start", "Démarrage opérationnel")}
              htmlFor="operationalStartDate"
            >
              <Input
                id="operationalStartDate"
                name="operationalStartDate"
                type="date"
                defaultValue={dateValue(getValue("operationalStartDate"))}
              />
            </Field>
            <Field
              label={label(fr, "Benefit review", "Revue des bénéfices")}
              htmlFor="benefitReviewDate"
            >
              <Input
                id="benefitReviewDate"
                name="benefitReviewDate"
                type="date"
                defaultValue={dateValue(getValue("benefitReviewDate"))}
              />
            </Field>
            <Field
              label={label(fr, "Expected outcome", "Objectif attendu")}
              htmlFor="expectedOutcome"
              className="md:col-span-2"
            >
              <Textarea
                id="expectedOutcome"
                name="expectedOutcome"
                defaultValue={getValue("expectedOutcome")}
                placeholder={label(
                  fr,
                  "Example: produce 10,000 eggs each month after commissioning.",
                  "Exemple : produire 10 000 œufs par mois après la mise en service.",
                )}
              />
            </Field>
          </div>
          <div className="mt-4 border-t border-brand/15 pt-4">
            <p className="text-sm font-semibold text-ink">
              {label(fr, "Target indicators", "Indicateurs cibles")}
            </p>
            <p className="mt-1 text-xs text-ink-secondary">
              {label(
                fr,
                "Used as the operational baseline after the investment is commissioned.",
                "Utilisés comme référence opérationnelle après la mise en service de l’investissement.",
              )}
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Field
                label={label(fr, "Production target", "Production cible")}
                htmlFor="targetProductionQuantity"
              >
                <Input
                  id="targetProductionQuantity"
                  name="targetProductionQuantity"
                  type="number"
                  min="0"
                  step="0.001"
                  defaultValue={getBenefitTarget("targetProductionQuantity")}
                />
              </Field>
              <Field
                label={label(fr, "Production unit", "Unité de production")}
                htmlFor="targetProductionUnit"
              >
                <Input
                  id="targetProductionUnit"
                  name="targetProductionUnit"
                  defaultValue={getBenefitTarget("targetProductionUnit")}
                  placeholder={label(
                    fr,
                    "eggs, kg, birds…",
                    "œufs, kg, poules…",
                  )}
                />
              </Field>
              <Field
                label={label(fr, "Target period", "Période cible")}
                htmlFor="targetProductionPeriod"
              >
                <select
                  id="targetProductionPeriod"
                  name="targetProductionPeriod"
                  defaultValue={getBenefitTarget("targetProductionPeriod")}
                  className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
                >
                  <option value="">{label(fr, "Choose", "Choisir")}</option>
                  <option value="daily">
                    {label(fr, "Daily", "Quotidienne")}
                  </option>
                  <option value="weekly">
                    {label(fr, "Weekly", "Hebdomadaire")}
                  </option>
                  <option value="monthly">
                    {label(fr, "Monthly", "Mensuelle")}
                  </option>
                  <option value="cycle">
                    {label(fr, "Per cycle", "Par cycle")}
                  </option>
                </select>
              </Field>
              <Field
                label={label(fr, "Sales target", "Ventes cibles")}
                htmlFor="targetSalesAmount"
              >
                <Input
                  id="targetSalesAmount"
                  name="targetSalesAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={getBenefitTarget("targetSalesAmount")}
                />
              </Field>
              <Field
                label={label(fr, "Target margin (%)", "Marge cible (%)")}
                htmlFor="targetMarginPercent"
              >
                <Input
                  id="targetMarginPercent"
                  name="targetMarginPercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue={getBenefitTarget("targetMarginPercent")}
                />
              </Field>
              <Field
                label={label(
                  fr,
                  "Maximum mortality (%)",
                  "Mortalité maximale (%)",
                )}
                htmlFor="targetMortalityPercent"
              >
                <Input
                  id="targetMortalityPercent"
                  name="targetMortalityPercent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue={getBenefitTarget("targetMortalityPercent")}
                />
              </Field>
              <Field
                label={label(fr, "Target unit cost", "Coût unitaire cible")}
                htmlFor="targetUnitCost"
              >
                <Input
                  id="targetUnitCost"
                  name="targetUnitCost"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={getBenefitTarget("targetUnitCost")}
                />
              </Field>
            </div>
          </div>
        </div>
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
          prerequisitePhaseOptions,
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
            isOwner
              ? "Choose a phase in this project that waits. Its prerequisite may come from another project you control."
              : "The waiting phase cannot begin or finish until its prerequisite is completed.",
            isOwner
              ? "Choisissez la phase de ce projet qui attend. Sa phase préalable peut venir d’un autre projet que vous contrôlez."
              : "La phase en attente ne peut pas commencer ni se terminer avant la fin de sa phase préalable.",
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
          prerequisiteTaskOptions,
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
            isOwner
              ? "Choose work in this project that waits. A prerequisite from another project is allowed only for the workspace owner."
              : "The waiting task cannot begin or finish until its prerequisite is completed.",
            isOwner
              ? "Choisissez le travail de ce projet qui attend. Un préalable d’un autre projet est autorisé uniquement pour le propriétaire de l’espace."
              : "La tâche en attente ne peut pas commencer ni se terminer avant la fin de sa tâche préalable.",
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
          taskAssigneeOptions,
          false,
          label(
            fr,
            "No active employee is available at this project's site or province",
            "Aucun employé actif n’est disponible sur le site ou dans la province de ce projet",
          ),
          label(
            fr,
            "Only active employees assigned to this project's site or province can receive this task. Ask the owner to review the project location or the employee assignment if someone is missing.",
            "Seuls les employés actifs rattachés au site ou à la province de ce projet peuvent recevoir cette tâche. Demandez au propriétaire de vérifier le lieu du projet ou l’affectation de l’employé si une personne manque.",
          ),
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
              label(fr, "Task budget", "Budget estimé de la tâche"),
              false,
              "number",
            )}
            <Field
              label={label(fr, "Budget currency", "Devise du budget")}
              htmlFor="budgetCurrencyCode"
              hint={label(
                fr,
                "The task budget uses the project currency.",
                "Le budget de la tâche utilise la devise du projet.",
              )}
            >
              <select
                id="budgetCurrencyCode"
                name="budgetCurrencyCode"
                defaultValue={
                  getValue("budgetCurrencyCode") ||
                  project?.currencyCode ||
                  "CDF"
                }
                className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
              >
                {["CDF", "USD", "EUR"].map((currencyCode) => (
                  <option key={currencyCode} value={currencyCode}>
                    {currencyCode}
                  </option>
                ))}
              </select>
            </Field>
            <p className="self-end pb-2 text-xs leading-5 text-ink-secondary">
              {label(
                fr,
                "This amount allocates part of the one project budget. Orders, accepted receipts and direct expenses update its committed and spent amounts automatically.",
                "Ce montant affecte une partie du budget unique du projet. Les commandes, réceptions acceptées et dépenses directes mettent automatiquement à jour ses montants engagés et dépensés.",
              )}
            </p>
            {isOwner ? (
              <Field
                label={label(
                  fr,
                  "Owner budget override justification",
                  "Justification propriétaire de dépassement",
                )}
                htmlFor="budgetOverrideReason"
                className="md:col-span-2"
                hint={label(
                  fr,
                  "Required only if total task budgets exceed the main project budget. The justification is retained in the audit trail.",
                  "Requise seulement si les budgets des tâches dépassent le budget principal. La justification est conservée dans la piste d’audit.",
                )}
              >
                <Textarea
                  id="budgetOverrideReason"
                  name="budgetOverrideReason"
                  defaultValue={getValue("budgetOverrideReason")}
                />
              </Field>
            ) : null}
          </>
        ) : (
          <p className="self-end pb-2 text-xs leading-5 text-ink-secondary">
            {label(
              fr,
              "A milestone is a checkpoint. It is not assigned as Daily Work and cannot receive purchase or expense costs.",
              "Un jalon est un point de contrôle. Il n’est pas affecté comme travail quotidien et ne reçoit pas de coûts d’achat ou de dépense.",
            )}
          </p>
        )}{" "}
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
            <Field
              label={label(
                fr,
                "Add a document directly",
                "Ajouter un document directement",
              )}
              htmlFor="taskEvidence"
              hint={label(
                fr,
                "PDF or image. It is saved once in the project documents and linked automatically to this task when you save.",
                "PDF ou image. Il est enregistré une seule fois dans les Documents du projet et lié automatiquement à cette tâche lorsque vous enregistrez.",
              )}
            >
              <Input
                id="taskEvidence"
                name="taskEvidence"
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
              />
            </Field>
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
  if (kind === "risk")
    return (
      <>
        <div className="md:col-span-2 rounded-xl border border-brand/20 bg-brand-subtle/30 p-4 text-sm leading-6 text-ink-secondary">
          {label(
            fr,
            "A risk is anticipated; an issue has already happened. In both cases, name the accountable person, measurable trigger and preventive action before it becomes a project delay or loss.",
            "Un risque est anticipé ; un problème est déjà arrivé. Dans les deux cas, nommez le responsable, le déclencheur mesurable et l’action de prévention avant qu’il ne cause un retard ou une perte.",
          )}
        </div>
        {select(
          "recordType",
          label(fr, "Record type", "Type d’enregistrement"),
          [
            {
              value: "risk",
              text: label(fr, "Risk — not occurred", "Risque — non réalisé"),
            },
            {
              value: "issue",
              text: label(
                fr,
                "Issue — already occurred",
                "Problème — déjà réalisé",
              ),
            },
          ],
          true,
        )}
        {select(
          "category",
          label(fr, "Risk category", "Catégorie de risque"),
          (
            [
              ["disease", "Disease", "Maladie"],
              ["supplier_delay", "Supplier delay", "Retard fournisseur"],
              [
                "commodity_price",
                "Commodity price increase",
                "Hausse du maïs / prix",
              ],
              ["water", "Water shortage", "Manque d’eau"],
              ["theft", "Theft", "Vol"],
              ["permit", "Permit", "Permis"],
              ["weather", "Weather", "Météo"],
              ["other", "Other", "Autre"],
            ] as Array<[string, string, string]>
          ).map(([value, english, french]) => ({
            value,
            text: fr ? french : english,
          })),
          true,
        )}
        <Field
          label={label(fr, "Risk or issue", "Risque ou problème")}
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
            placeholder={label(
              fr,
              "Example: delay in delivery of feed ingredients",
              "Exemple : retard de livraison des ingrédients d’aliment",
            )}
          />
        </Field>
        {select(
          "probability",
          label(fr, "Probability", "Probabilité"),
          ["low", "medium", "high"].map((value) => ({
            value,
            text: titleCase(value),
          })),
          true,
        )}
        {select(
          "impact",
          label(fr, "Impact", "Impact"),
          ["low", "medium", "high", "critical"].map((value) => ({
            value,
            text: titleCase(value),
          })),
          true,
        )}
        {select(
          "ownerMemberId",
          label(fr, "Responsible person", "Responsable"),
          memberOptions,
          true,
          label(
            fr,
            "No active company member is available",
            "Aucun membre actif de l’entreprise n’est disponible",
          ),
        )}
        {input(
          "reviewDate",
          label(fr, "Review due date", "Échéance de revue"),
          true,
          "date",
        )}
        <Field
          label={label(fr, "Trigger condition", "Déclencheur")}
          htmlFor="triggerCondition"
          required
          error={fieldError("triggerCondition")}
        >
          <Textarea
            id="triggerCondition"
            name="triggerCondition"
            required
            invalid={Boolean(fieldError("triggerCondition"))}
            defaultValue={getValue("triggerCondition")}
            placeholder={label(
              fr,
              "What will show that this risk is happening?",
              "Qu’est-ce qui montrera que ce risque se réalise ?",
            )}
          />
        </Field>
        <Field
          label={label(fr, "Alert threshold", "Seuil d’alerte")}
          htmlFor="alertThreshold"
          required
          error={fieldError("alertThreshold")}
        >
          <Textarea
            id="alertThreshold"
            name="alertThreshold"
            required
            invalid={Boolean(fieldError("alertThreshold"))}
            defaultValue={getValue("alertThreshold")}
            placeholder={label(
              fr,
              "Example: price rises more than 10% or delivery is 3 days late",
              "Exemple : prix en hausse de plus de 10 % ou livraison en retard de 3 jours",
            )}
          />
        </Field>
        <Field
          label={label(fr, "Preventive action", "Action de prévention")}
          htmlFor="preventionAction"
          required
          className="md:col-span-2"
          error={fieldError("preventionAction")}
        >
          <Textarea
            id="preventionAction"
            name="preventionAction"
            required
            invalid={Boolean(fieldError("preventionAction"))}
            defaultValue={getValue("preventionAction")}
            placeholder={label(
              fr,
              "The action taken before the threshold is reached",
              "L’action menée avant que le seuil ne soit atteint",
            )}
          />
        </Field>
        <Field
          label={label(
            fr,
            "Contingency action",
            "Action si le risque se réalise",
          )}
          htmlFor="contingencyAction"
          className="md:col-span-2"
        >
          <Textarea
            id="contingencyAction"
            name="contingencyAction"
            defaultValue={getValue("contingencyAction")}
            placeholder={label(
              fr,
              "Optional: what to do if the risk is triggered",
              "Facultatif : que faire si le risque se réalise",
            )}
          />
        </Field>
        {select(
          "status",
          label(fr, "Register status", "Statut du registre"),
          (
            [
              ["open", "Open", "Ouvert"],
              ["monitoring", "Monitoring", "Surveillance"],
              ["triggered", "Triggered", "Déclenché"],
              ["mitigating", "Mitigating", "En traitement"],
              ["accepted", "Accepted", "Accepté"],
              ["closed", "Closed", "Clôturé"],
            ] as Array<[string, string, string]>
          ).map(([value, english, french]) => ({
            value,
            text: fr ? french : english,
          })),
          true,
        )}
        <Field
          label={label(fr, "Decision", "Décision")}
          htmlFor="decision"
          required
          error={fieldError("decision")}
        >
          <select
            id="decision"
            name="decision"
            required
            value={riskDecision}
            onChange={(event) => setRiskDecision(event.target.value)}
            className={`h-9 w-full rounded-md border bg-surface-1 px-3 text-sm text-ink ${fieldError("decision") ? "border-critical" : "border-border-strong"}`}
          >
            {[
              ["pending", "No decision yet", "Aucune décision"],
              ["monitor", "Monitor", "Surveiller"],
              ["mitigate", "Mitigate", "Réduire le risque"],
              ["avoid", "Avoid", "Éviter"],
              ["transfer", "Transfer", "Transférer"],
              ["accept", "Accept", "Accepter"],
              ["escalate", "Escalate", "Escalader"],
            ].map(([value, english, french]) => (
              <option key={value} value={value}>
                {fr ? french : english}
              </option>
            ))}
          </select>
        </Field>
        {riskDecision !== "pending" ? (
          <>
            <Field
              label={label(fr, "Decision taken", "Décision prise")}
              htmlFor="decisionTaken"
              required
              error={fieldError("decisionTaken")}
            >
              <Input
                id="decisionTaken"
                name="decisionTaken"
                required
                invalid={Boolean(fieldError("decisionTaken"))}
                defaultValue={getValue("decisionTaken")}
              />
            </Field>
            <Field
              label={label(
                fr,
                "Decision justification",
                "Justification de la décision",
              )}
              htmlFor="decisionJustification"
              required
              className="md:col-span-2"
              error={fieldError("decisionJustification")}
            >
              <Textarea
                id="decisionJustification"
                name="decisionJustification"
                required
                invalid={Boolean(fieldError("decisionJustification"))}
                defaultValue={getValue("decisionJustification")}
              />
              <p className="mt-1 text-xs text-ink-muted">
                {label(
                  fr,
                  "The decision maker and time are recorded automatically.",
                  "La personne ayant décidé et l’heure sont enregistrées automatiquement.",
                )}
              </p>
            </Field>
          </>
        ) : null}
        <Field
          label={label(fr, "Description / notes", "Description / notes")}
          htmlFor="description"
          className="md:col-span-2"
        >
          <Textarea
            id="description"
            name="description"
            defaultValue={getValue("description")}
          />
        </Field>
        <Field
          label={label(fr, "Internal notes", "Notes internes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "quality-check")
    return (
      <>
        <div className="md:col-span-2 rounded-xl border border-brand/20 bg-brand-subtle/30 p-4 text-sm leading-6 text-ink-secondary">
          {label(
            fr,
            "This check adds quality evidence to a confirmed receipt or an equipment asset. It never enters a second quantity or budget movement.",
            "Ce contrôle ajoute une preuve qualité à une réception confirmée ou à un équipement. Il ne crée jamais une deuxième quantité ni un deuxième mouvement budgétaire.",
          )}
        </div>
        {select(
          "receiptId",
          label(fr, "Confirmed receipt", "Réception confirmée"),
          qualityReceiptOptions,
          false,
          label(
            fr,
            "No confirmed receipt available",
            "Aucune réception confirmée disponible",
          ),
          label(
            fr,
            "Confirm a BR first, then complete its quality check here.",
            "Confirmez d’abord un BR, puis effectuez ici son contrôle qualité.",
          ),
        )}
        {select(
          "assetId",
          label(fr, "Equipment asset", "Équipement"),
          assetOptions,
          false,
          label(
            fr,
            "No project equipment available",
            "Aucun équipement du projet disponible",
          ),
          label(
            fr,
            "A durable asset can be inspected after it has been received into the project.",
            "Un équipement durable peut être contrôlé après sa réception dans le projet.",
          ),
        )}
        <p className="md:col-span-2 text-xs leading-5 text-ink-secondary">
          {label(
            fr,
            "Choose the receipt, the equipment, or both when the delivery created a durable asset.",
            "Choisissez la réception, l’équipement, ou les deux lorsque la livraison a créé un actif durable.",
          )}
        </p>
        {select(
          "qualityStatus",
          label(fr, "Quality decision", "Décision qualité"),
          (
            [
              ["pending", "Pending inspection", "En attente de contrôle"],
              ["accepted", "Accepted", "Acceptée"],
              [
                "accepted_with_observations",
                "Accepted with observations",
                "Acceptée avec réserves",
              ],
              ["rejected", "Rejected", "Refusée"],
              ["returned", "Returned", "Retournée"],
            ] as Array<[string, string, string]>
          ).map(([value, english, french]) => ({
            value,
            text: fr ? french : english,
          })),
          true,
        )}
        {select(
          "commissioningStatus",
          label(fr, "Commissioning", "Mise en service"),
          (
            [
              ["not_required", "Not required", "Non requise"],
              ["pending", "Pending", "En attente"],
              ["validated", "Validated", "Validée"],
              ["failed", "Failed", "Échouée"],
            ] as Array<[string, string, string]>
          ).map(([value, english, french]) => ({
            value,
            text: fr ? french : english,
          })),
          true,
        )}
        <section className="grid gap-3 rounded-xl border border-border bg-surface-2 p-4 md:col-span-2 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <h3 className="text-sm font-semibold text-ink">
              {label(fr, "Reception checklist", "Checklist de réception")}
            </h3>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              {label(
                fr,
                "An accepted reception requires the first three checks. Commissioning validation also requires functional and safety checks.",
                "Une réception acceptée exige les trois premiers contrôles. La mise en service validée exige aussi les contrôles fonctionnel et sécurité.",
              )}
            </p>
          </div>
          {(
            [
              [
                "quantityMatches",
                "Quantity matches the delivery note and order",
                "La quantité correspond au bon de livraison et à la commande",
              ],
              [
                "conditionAccepted",
                "Condition, packaging and specification are acceptable",
                "L’état, l’emballage et la spécification sont acceptables",
              ],
              [
                "documentsComplete",
                "Supplier documents, invoice or delivery note are complete",
                "Les documents fournisseur, facture ou bon de livraison sont complets",
              ],
              [
                "functionalTestPassed",
                "Functional test passed",
                "Le test de fonctionnement est réussi",
              ],
              [
                "safetyCheckPassed",
                "Safety check passed",
                "Le contrôle de sécurité est réussi",
              ],
            ] as Array<[string, string, string]>
          ).map(([name, english, french]) => (
            <label
              key={name}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface-1 p-3 text-sm text-ink hover:bg-surface-2"
            >
              <input
                type="checkbox"
                name={name}
                defaultChecked={getValue(name) === "true"}
                className="mt-0.5 size-4 accent-brand"
              />
              <span>{fr ? french : english}</span>
            </label>
          ))}
        </section>
        {input(
          "returnedQuantity",
          label(
            fr,
            "Quantity returned to supplier",
            "Quantité retournée au fournisseur",
          ),
          false,
          "number",
        )}
        <Field
          label={label(
            fr,
            "Reason for return / observation",
            "Motif du retour / réserve",
          )}
          htmlFor="returnReason"
        >
          <Textarea
            id="returnReason"
            name="returnReason"
            defaultValue={getValue("returnReason")}
          />
        </Field>
        <Field
          label={label(fr, "Supplier warranty", "Garantie fournisseur")}
          htmlFor="warrantyProvider"
        >
          <Input
            id="warrantyProvider"
            name="warrantyProvider"
            defaultValue={getValue("warrantyProvider")}
            placeholder={label(
              fr,
              "Supplier or warranty company",
              "Fournisseur ou société de garantie",
            )}
          />
        </Field>
        {input(
          "warrantyReference",
          label(fr, "Warranty reference", "Référence de garantie"),
        )}
        {input(
          "warrantyExpiresOn",
          label(fr, "Warranty expiry", "Fin de garantie"),
          false,
          "date",
        )}
        <Field
          label={label(fr, "Before photo", "Photo avant")}
          htmlFor="qualityBeforePhoto"
          hint={label(
            fr,
            "Optional image saved privately in this project's Documents and linked to this check.",
            "Image facultative enregistrée en privé dans les Documents du projet et liée à ce contrôle.",
          )}
        >
          <Input
            id="qualityBeforePhoto"
            name="qualityBeforePhoto"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
          />
        </Field>
        <Field
          label={label(fr, "After photo", "Photo après")}
          htmlFor="qualityAfterPhoto"
          hint={label(
            fr,
            "Optional image saved privately in this project's Documents and linked to this check.",
            "Image facultative enregistrée en privé dans les Documents du projet et liée à ce contrôle.",
          )}
        >
          <Input
            id="qualityAfterPhoto"
            name="qualityAfterPhoto"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
          />
        </Field>
        {select(
          "beforePhotoDocumentId",
          label(fr, "Existing before evidence", "Preuve avant existante"),
          projectDocumentOptions,
        )}
        {select(
          "afterPhotoDocumentId",
          label(fr, "Existing after evidence", "Preuve après existante"),
          projectDocumentOptions,
        )}
        <Field
          label={label(fr, "Commissioning notes", "Notes de mise en service")}
          htmlFor="commissioningNotes"
          className="md:col-span-2"
        >
          <Textarea
            id="commissioningNotes"
            name="commissioningNotes"
            defaultValue={getValue("commissioningNotes")}
            placeholder={label(
              fr,
              "Functional result, safety finding, handover condition…",
              "Résultat fonctionnel, constat de sécurité, condition de remise…",
            )}
          />
        </Field>
        <Field
          label={label(fr, "Quality notes", "Notes qualité")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea id="notes" name="notes" defaultValue={getValue("notes")} />
        </Field>
      </>
    );
  if (kind === "closeout")
    return (
      <>
        <div className="md:col-span-2 rounded-xl border border-brand/20 bg-brand-subtle/30 p-4 text-sm leading-6 text-ink-secondary">
          {label(
            fr,
            "This is the formal project close-out report. Completing it closes the investment lifecycle and preserves the decision for audit and future projects.",
            "Il s’agit du procès-verbal formel de clôture. Sa finalisation clôture le cycle de l’investissement et conserve la décision pour l’audit et les futurs projets.",
          )}
        </div>
        {select(
          "status",
          label(fr, "Report status", "Statut du procès-verbal"),
          [
            {
              value: "draft",
              text: label(
                fr,
                "Draft — keep working",
                "Brouillon — continuer le travail",
              ),
            },
            {
              value: "completed",
              text: label(
                fr,
                "Complete and close project",
                "Finaliser et clôturer le projet",
              ),
            },
          ],
          true,
        )}
        {select(
          "expectedOutcomeAchieved",
          label(
            fr,
            "Was the expected result achieved?",
            "Le résultat attendu est-il atteint ?",
          ),
          [
            { value: "yes", text: label(fr, "Yes, achieved", "Oui, atteint") },
            {
              value: "no",
              text: label(
                fr,
                "No, not fully achieved",
                "Non, pas entièrement atteint",
              ),
            },
          ],
          false,
        )}
        <Field
          label={label(fr, "Achieved result", "Résultat atteint")}
          htmlFor="achievementSummary"
          className="md:col-span-2"
          error={fieldError("achievementSummary")}
        >
          <Textarea
            id="achievementSummary"
            name="achievementSummary"
            defaultValue={getValue("achievementSummary")}
            placeholder={String(
              project?.expectedOutcome ??
                label(
                  fr,
                  "Describe the measured result and evidence.",
                  "Décrivez le résultat mesuré et les preuves.",
                ),
            )}
          />
        </Field>
        <Field
          label={label(
            fr,
            "Actual operational outcome",
            "Résultat opérationnel réel",
          )}
          htmlFor="actualOutcome"
          className="md:col-span-2"
        >
          <Textarea
            id="actualOutcome"
            name="actualOutcome"
            defaultValue={getValue("actualOutcome")}
            placeholder={label(
              fr,
              "Production, sales, quality or delivery outcome after handover.",
              "Résultat de production, vente, qualité ou livraison après remise.",
            )}
          />
        </Field>
        <Field
          label={label(fr, "What did we learn?", "Qu’avons-nous appris ?")}
          htmlFor="lessonsLearned"
          className="md:col-span-2"
          error={fieldError("lessonsLearned")}
        >
          <Textarea
            id="lessonsLearned"
            name="lessonsLearned"
            defaultValue={getValue("lessonsLearned")}
            placeholder={label(
              fr,
              "What should be repeated, changed or avoided next time?",
              "Que faut-il répéter, changer ou éviter la prochaine fois ?",
            )}
          />
        </Field>
        {select(
          "handoverMemberId",
          label(
            fr,
            "Person responsible after handover",
            "Responsable après remise",
          ),
          memberOptions,
        )}
        <label className="flex items-center gap-3 self-end rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-ink">
          <input
            type="checkbox"
            name="commissioningValidated"
            defaultChecked={getValue("commissioningValidated") === "true"}
            className="size-4 accent-brand"
          />
          {label(
            fr,
            "Operational commissioning is validated",
            "La mise en service opérationnelle est validée",
          )}
        </label>
        {select(
          "closeoutDocumentId",
          label(fr, "Signed report or evidence", "PV signé ou justificatif"),
          projectDocumentOptions,
        )}
        <Field
          label={label(
            fr,
            "Commissioning summary",
            "Synthèse de mise en service",
          )}
          htmlFor="commissioningSummary"
          className="md:col-span-2"
        >
          <Textarea
            id="commissioningSummary"
            name="commissioningSummary"
            defaultValue={getValue("commissioningSummary")}
          />
        </Field>
        <Field
          label={label(fr, "Close-out notes", "Notes de clôture")}
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
        <div className="md:col-span-2 rounded-xl border border-brand/20 bg-brand/5 p-4 text-sm leading-6 text-ink-secondary">
          {label(
            fr,
            "The designated manager can follow this project as a whole. Workers are assigned directly from the project tasks and do not need to be added here.",
            "Le manager désigné suit ce projet dans son ensemble. Les ouvriers sont affectés directement depuis les tâches du projet et ne doivent pas être ajoutés ici.",
          )}
        </div>
        {select(
          "memberId",
          label(fr, "Project manager", "Manager du projet"),
          memberOptions,
          true,
        )}
        <input type="hidden" name="assignmentRole" value="project_manager" />
        <input type="hidden" name="isManager" value="on" />
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
        <div className="md:col-span-2 rounded-lg border border-border bg-surface-2 p-3 text-xs leading-5 text-ink-secondary">
          {label(
            fr,
            "Only one current project manager is active at a time. Choosing another manager transfers responsibility for the overlapping dates without erasing the project history.",
            "Un seul manager actuel est actif à la fois. Choisir un autre manager transfère la responsabilité pour les dates qui se chevauchent, sans effacer l’historique du projet.",
          )}
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
        </Field>{" "}
        {operationalTargetKind === "pigs:groups" ? (
          <div className="md:col-span-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.08] px-3 py-3 text-sm leading-5 text-ink-secondary">
            <span className="font-semibold text-ink">
              {label(fr, "Lot de porcs", "Pig batch")}
            </span>
            {" · "}
            {label(
              fr,
              "À choisir pour l’engraissement et la vente au kilo (poids vivant).",
              "Choose for fattening and sales by kilogram (live weight).",
            )}
          </div>
        ) : operationalTargetKind === "pigs:animals" ? (
          <div className="md:col-span-2 rounded-xl border border-sky-500/25 bg-sky-500/[0.08] px-3 py-3 text-sm leading-5 text-ink-secondary">
            <span className="font-semibold text-ink">
              {label(fr, "Porc individuel", "Individual pig")}
            </span>
            {" · "}
            {label(
              fr,
              "À choisir pour une truie, un verrat ou un porc vendu à l’unité.",
              "Choose for a sow, boar, or a pig sold individually.",
            )}
          </div>
        ) : operationalTargetKind === "pigs:pens" ? (
          <div className="md:col-span-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-3 py-3 text-sm leading-5 text-ink-secondary">
            <span className="font-semibold text-ink">
              {label(fr, "Enclos porcin", "Pig pen")}
            </span>
            {" · "}
            {label(
              fr,
              "À choisir uniquement si le projet a construit, rénové ou équipé l’enclos.",
              "Choose only when the project built, renovated, or equipped the pen.",
            )}
          </div>
        ) : null}
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
                  "First create the real record in Poultry, Pigs or Agriculture. Only records at this project's site can be linked here.",
                  "Créez d’abord l’enregistrement réel dans Aviculture, Porcs ou Agriculture. Seuls les enregistrements du site de ce projet peuvent être liés ici.",
                )
              : label(
                  fr,
                  "First create the real record in Poultry, Pigs or Agriculture. Only records in this project's province can be linked here.",
                  "Créez d’abord l’enregistrement réel dans Aviculture, Porcs ou Agriculture. Seuls les enregistrements de la province de ce projet peuvent être liés ici.",
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
          {canReadOperationalTarget &&
          !operationalRecords.isPending &&
          !operationalRecords.isError &&
          operationalOptions.length === 0 ? (
            <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-xs leading-5 text-ink-secondary">
              {label(
                fr,
                "There is no matching record yet. Create it first in the appropriate operational module at the same project site, then return here to link it.",
                "Aucun enregistrement ne correspond encore. Créez-le d’abord dans le module opérationnel approprié, au même site que le projet, puis revenez ici pour le lier.",
              )}
            </p>
          ) : null}
        </Field>
        {select(
          "linkType",
          label(
            fr,
            "How this record relates to the project",
            "Lien avec le projet",
          ),
          OPERATIONAL_LINK_TYPES.map((link) => ({
            value: link.value,
            text: fr ? link.french : link.english,
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
          draftRequestOptions,
          true,
        )}
        <div className="rounded-xl border border-border bg-surface-2/55 px-3 py-2.5 text-sm">
          <input
            type="hidden"
            name="projectMaterialId"
            value={String(activeReceiptOrderLine?.projectMaterialId ?? "")}
          />
          <p className="font-medium text-ink">
            {label(fr, "Project material", "Matériau du projet")}
          </p>
          <p className="mt-1 text-ink-secondary">
            {linkedReceiptMaterial
              ? String(
                  linkedReceiptMaterial.name ??
                    linkedReceiptMaterial.code ??
                    "—",
                )
              : label(
                  fr,
                  "No project material is linked to this ordered item.",
                  "Aucun matériau du projet n’est lié à cet article commandé.",
                )}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface-2/55 px-3 py-2.5 text-sm">
          <input
            type="hidden"
            name="inventoryItemId"
            value={String(activeReceiptOrderLine?.inventoryItemId ?? "")}
          />
          <p className="font-medium text-ink">
            {label(fr, "Inventory item", "Article en stock")}
          </p>
          <p className="mt-1 text-ink-secondary">
            {linkedReceiptInventoryItem
              ? String(
                  linkedReceiptInventoryItem.name ??
                    linkedReceiptInventoryItem.sku ??
                    "—",
                )
              : label(
                  fr,
                  "No inventory item is linked to this ordered item.",
                  "Aucun article en stock n’est lié à cet article commandé.",
                )}
          </p>
        </div>
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
        <div className="rounded-xl border border-brand/20 bg-brand/5 px-3 py-3 text-sm md:col-span-2">
          <p className="font-semibold text-ink">
            {label(fr, "Automatic reference", "Référence automatique")}
          </p>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            {label(
              fr,
              "LiteHubs assigns the next DA reference when this purchase request is saved.",
              "LiteHubs attribue la prochaine référence DA lorsque cette demande d’achat est enregistrée.",
            )}
          </p>
        </div>
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
        <div className="rounded-xl border border-brand/20 bg-brand/5 px-3 py-3 text-sm md:col-span-2">
          <p className="font-semibold text-ink">
            {label(fr, "Requestor", "Demandeur")}
          </p>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            {label(
              fr,
              "Your name is recorded automatically when you submit this purchase request.",
              "Votre nom est enregistré automatiquement lorsque vous soumettez cette demande d’achat.",
            )}
          </p>
        </div>
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
        <div className="rounded-xl border border-border bg-surface-2/60 px-3 py-2.5 text-sm md:col-span-2">
          <p className="font-semibold text-ink">
            {label(
              fr,
              "Draft purchase request",
              "Demande d’achat en brouillon",
            )}
          </p>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            {label(
              fr,
              "Add the requested items, then use Submit on the request card to create its approval request. Only the owner can approve or reject it.",
              "Ajoutez les articles demandés, puis utilisez Soumettre dans la carte de la demande pour créer son approbation. Seul le propriétaire peut l’approuver ou la refuser.",
            )}
          </p>
        </div>
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
  if (kind === "order-line") {
    const visibleOrderOptions = orderOptions.filter(
      (option) => option.value.trim() && option.text.trim(),
    );
    const sourceLineOptions = requestLinesForSelectedOrder.map((line) => ({
      value: String(line.id),
      text: `${String(line.description ?? "—")} · ${number(line.requestedQuantity).toLocaleString(fr ? "fr-FR" : "en-US")} ${String(line.unit ?? "")}`.trim(),
    }));
    const inputKey = (field: string) =>
      `order-line-${field}-${orderLinePrefillKey}`;
    const sourceValue = (field: string, fallback = "") =>
      editingOrderLine
        ? getValue(field)
        : prefilledOrderLineValue(field, getValue(field) || fallback);
    const orderLineSelect = (
      name: string,
      title: string,
      options: SelectOption[],
      value: string,
      required = false,
    ) => (
      <Field
        label={title}
        htmlFor={name}
        required={required}
        error={fieldError(name)}
      >
        <select
          key={inputKey(name)}
          id={name}
          name={name}
          required={required}
          defaultValue={value}
          aria-invalid={Boolean(fieldError(name))}
          className={`h-9 w-full rounded-md border bg-surface-1 px-3 text-sm text-ink ${fieldError(name) ? "border-critical" : "border-border-strong"}`}
        >
          <option value="">
            {required ? label(fr, "Select", "Sélectionner") : "—"}
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.text}
            </option>
          ))}
        </select>
      </Field>
    );
    const orderLineInput = (
      name: string,
      title: string,
      value: string,
      required = false,
      type = "text",
    ) => {
      const supportsCustomUnit = name === "unit";
      const unitListId = `order-line-${name}-suggestions`;
      return (
        <Field
          label={title}
          htmlFor={name}
          required={required}
          error={fieldError(name)}
          hint={
            supportsCustomUnit
              ? label(
                  fr,
                  "Choose a common unit or type another one.",
                  "Choisissez une unité courante ou saisissez-en une autre.",
                )
              : undefined
          }
        >
          <Input
            key={inputKey(name)}
            id={name}
            name={name}
            type={type}
            required={required}
            invalid={Boolean(fieldError(name))}
            list={supportsCustomUnit ? unitListId : undefined}
            placeholder={
              supportsCustomUnit
                ? label(
                    fr,
                    "Choose or enter a unit",
                    "Choisissez ou saisissez une unité",
                  )
                : undefined
            }
            defaultValue={value}
          />
          {supportsCustomUnit ? (
            <datalist id={unitListId}>
              {PROCUREMENT_UNIT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {fr ? option.french : option.english}
                </option>
              ))}
            </datalist>
          ) : null}
        </Field>
      );
    };
    return (
      <>
        <Field
          label={label(fr, "Purchase order", "Bon de commande")}
          htmlFor="purchaseOrderId"
          required
          error={fieldError("purchaseOrderId")}
        >
          <select
            id="purchaseOrderId"
            name="purchaseOrderId"
            required
            value={activeOrderId}
            onChange={(event) => {
              setSelectedOrderId(event.target.value);
              setSelectedRequestLineId("");
            }}
            aria-invalid={Boolean(fieldError("purchaseOrderId"))}
            className={`h-9 w-full rounded-md border bg-surface-1 px-3 text-sm text-ink ${fieldError("purchaseOrderId") ? "border-critical" : "border-border-strong"}`}
          >
            <option value="" disabled={visibleOrderOptions.length === 0}>
              {visibleOrderOptions.length
                ? label(fr, "Select", "Sélectionner")
                : label(
                    fr,
                    "No purchase orders available",
                    "Aucun bon de commande disponible",
                  )}
            </option>
            {visibleOrderOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.text}
              </option>
            ))}
          </select>
        </Field>
        {requestLinesForSelectedOrder.length > 1 && !editingOrderLine ? (
          <Field
            label={label(
              fr,
              "Requested item to copy",
              "Article demandé à reprendre",
            )}
            htmlFor="sourceRequestLineId"
            required
            hint={label(
              fr,
              "Select an approved request item. Its details remain editable below.",
              "Sélectionnez l’article de la demande approuvée. Ses détails restent modifiables ci-dessous.",
            )}
          >
            <select
              id="sourceRequestLineId"
              name="sourceRequestLineId"
              required
              value={selectedRequestLineId}
              onChange={(event) => setSelectedRequestLineId(event.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
            >
              <option value="">{label(fr, "Select", "Sélectionner")}</option>
              {sourceLineOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.text}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {selectedRequestLine ? (
          <div className="rounded-xl border border-brand/25 bg-brand/[0.045] px-3 py-2.5 text-sm text-ink-secondary md:col-span-2">
            <span className="font-semibold text-brand">
              {label(
                fr,
                "Copied from approved request",
                "Repris depuis la demande approuvée",
              )}
            </span>
            <span className="ml-2">
              {label(
                fr,
                "You can adjust the quantity, price, or any item detail before saving.",
                "Vous pouvez modifier la quantité, le prix ou toute information avant l’enregistrement.",
              )}
            </span>
          </div>
        ) : null}
        {orderLineSelect(
          "projectMaterialId",
          label(fr, "Project material", "Matériau du projet"),
          materialOptions,
          sourceValue("projectMaterialId"),
        )}
        {orderLineSelect(
          "inventoryItemId",
          label(fr, "Inventory item", "Article en stock"),
          inventoryOptions,
          sourceValue("inventoryItemId"),
        )}
        {orderLineInput(
          "description",
          label(fr, "Description", "Description"),
          sourceValue("description"),
          true,
        )}
        {orderLineSelect(
          "itemKind",
          label(fr, "Item type", "Type d’article"),
          ["material", "inventory", "asset", "service", "other"].map(
            (value) => ({ value, text: titleCase(value) }),
          ),
          sourceValue("itemKind", "material"),
          true,
        )}
        {orderLineInput(
          "unit",
          label(fr, "Unit", "Unité"),
          sourceValue("unit"),
          true,
        )}
        {orderLineInput(
          "orderedQuantity",
          label(fr, "Ordered quantity", "Quantité commandée"),
          sourceValue("requestedQuantity"),
          true,
          "number",
        )}
        {orderLineInput(
          "unitCost",
          label(fr, "Unit cost", "Coût unitaire"),
          sourceValue("estimatedUnitCost"),
          true,
          "number",
        )}
        {orderLineInput(
          "taxAmount",
          label(fr, "Tax amount", "Taxes"),
          sourceValue("taxAmount", "0"),
          false,
          "number",
        )}
        {orderLineInput(
          "assetName",
          label(fr, "Asset name if durable", "Nom de l’actif si durable"),
          sourceValue("assetName"),
        )}
        {orderLineInput(
          "assetCategory",
          label(fr, "Asset category", "Catégorie d’actif"),
          sourceValue("assetCategory"),
        )}
        <Field
          label={label(fr, "Notes", "Notes")}
          htmlFor="notes"
          className="md:col-span-2"
        >
          <Textarea
            key={inputKey("notes")}
            id="notes"
            name="notes"
            defaultValue={sourceValue("notes")}
          />
        </Field>
      </>
    );
  }
  if (kind === "order")
    return (
      <>
        <div className="rounded-xl border border-brand/20 bg-brand/5 px-3 py-3 text-sm md:col-span-2">
          <p className="font-semibold text-ink">
            {label(fr, "Automatic reference", "Référence automatique")}
          </p>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            {label(
              fr,
              "LiteHubs assigns the next BC reference when this purchase order is saved.",
              "LiteHubs attribue la prochaine référence BC lorsque ce bon de commande est enregistré.",
            )}
          </p>
        </div>
        <Field
          label={label(fr, "Purchase request", "Demande d’achat")}
          htmlFor="purchaseRequestId"
          required
          error={fieldError("purchaseRequestId")}
        >
          <select
            id="purchaseRequestId"
            name="purchaseRequestId"
            required
            value={selectedOrderRequestId}
            onChange={(event) => {
              const requestId = event.target.value;
              setSelectedOrderRequestId(requestId);
              const request = requests.find(
                (item) => String(item.id) === String(requestId),
              );
              if (!isEditing) {
                setSelectedOrderSupplierId(String(request?.supplierId ?? ""));
                setSelectedOrderCurrencyCode(
                  String(
                    request?.currencyCode ?? project?.currencyCode ?? "CDF",
                  ),
                );
              }
            }}
            aria-invalid={Boolean(fieldError("purchaseRequestId"))}
            className={`h-9 w-full rounded-md border bg-surface-1 px-3 text-sm text-ink ${fieldError("purchaseRequestId") ? "border-critical" : "border-border-strong"}`}
          >
            <option value="" disabled={approvedRequestOptions.length === 0}>
              {approvedRequestOptions.length
                ? label(fr, "Select", "Sélectionner")
                : label(
                    fr,
                    "No approved purchase request available",
                    "Aucune demande approuvée disponible",
                  )}
            </option>
            {approvedRequestOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.text}
              </option>
            ))}
          </select>
        </Field>
        <div className="rounded-xl border border-brand/20 bg-brand/[0.04] px-3 py-2.5 text-sm md:col-span-2">
          <p className="font-semibold text-ink">
            {label(fr, "Request context", "Contexte repris de la demande")}
          </p>
          {selectedOrderRequest ? (
            <div className="mt-1.5 grid gap-1.5 text-xs leading-5 text-ink-secondary sm:grid-cols-2">
              <p>
                {label(fr, "Need", "Besoin")} ·{" "}
                {String(selectedOrderRequest.reason ?? "—")}
              </p>
              <p>
                {label(fr, "Required by", "Nécessaire le")} ·{" "}
                {date(
                  selectedOrderRequest.requiredDate,
                  fr ? "fr-FR" : "en-US",
                )}
              </p>
              <p>
                {label(fr, "Supplier", "Fournisseur")} ·{" "}
                {String(
                  suppliers.find(
                    (supplier) =>
                      String(supplier.id) ===
                      String(selectedOrderRequest.supplierId ?? ""),
                  )?.name ?? label(fr, "To choose", "À choisir"),
                )}
              </p>
              <p>
                {label(fr, "Currency", "Devise")} ·{" "}
                {String(
                  selectedOrderRequest.currencyCode ??
                    project?.currencyCode ??
                    "CDF",
                )}
              </p>
              <p className="sm:col-span-2">
                {label(
                  fr,
                  "Its approved items will be copied automatically into this draft purchase order. You can correct the draft before sending it.",
                  "Ses articles approuvés seront copiés automatiquement dans ce bon en brouillon. Vous pourrez corriger le brouillon avant l’envoi.",
                )}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              {label(
                fr,
                "Select an approved request to recover its context and items.",
                "Sélectionnez une demande approuvée pour reprendre son contexte et ses articles.",
              )}
            </p>
          )}
        </div>
        <Field
          label={label(fr, "Supplier", "Fournisseur")}
          htmlFor="supplierId"
          required
          error={fieldError("supplierId")}
        >
          <select
            id="supplierId"
            name="supplierId"
            required
            value={selectedOrderSupplierId}
            onChange={(event) => setSelectedOrderSupplierId(event.target.value)}
            aria-invalid={Boolean(fieldError("supplierId"))}
            className={`h-9 w-full rounded-md border bg-surface-1 px-3 text-sm text-ink ${fieldError("supplierId") ? "border-critical" : "border-border-strong"}`}
          >
            <option value="" disabled={supplierOptions.length === 0}>
              {supplierOptions.length
                ? label(fr, "Select", "Sélectionner")
                : label(
                    fr,
                    "No supplier available",
                    "Aucun fournisseur disponible",
                  )}
            </option>
            {supplierOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.text}
              </option>
            ))}
          </select>
        </Field>
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
        {getValue("id") ? (
          <div className="rounded-xl border border-border bg-surface-2/60 px-3 py-2.5 md:col-span-2">
            <p className="text-xs font-semibold text-ink">
              {label(fr, "Order status", "Statut du bon de commande")}
            </p>
            <p className="mt-0.5 text-sm font-medium text-ink">
              {titleCase(getValue("status") || "draft")}
            </p>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              {label(
                fr,
                "This status is updated from accepted receipt items. It cannot be set manually.",
                "Ce statut évolue automatiquement à partir des articles réceptionnés et acceptés. Il ne se modifie pas manuellement.",
              )}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-2/60 px-3 py-2.5 text-sm md:col-span-2">
            <p className="font-semibold text-ink">
              {label(
                fr,
                "Draft purchase order",
                "Bon de commande en brouillon",
              )}
            </p>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              {label(
                fr,
                "Add the ordered items, then use Send to supplier on the order card. Sending commits the order amount to the project budget.",
                "Ajoutez les articles commandés, puis utilisez Envoyer au fournisseur dans la carte du bon. L’envoi engage le montant dans le budget du projet.",
              )}
            </p>
          </div>
        )}
        <Field
          label={label(fr, "Currency", "Devise")}
          htmlFor="currencyCode"
          required
          error={fieldError("currencyCode")}
        >
          <select
            id="currencyCode"
            name="currencyCode"
            required
            value={selectedOrderCurrencyCode}
            onChange={(event) =>
              setSelectedOrderCurrencyCode(event.target.value)
            }
            aria-invalid={Boolean(fieldError("currencyCode"))}
            className={`h-9 w-full rounded-md border bg-surface-1 px-3 text-sm text-ink ${fieldError("currencyCode") ? "border-critical" : "border-border-strong"}`}
          >
            <option value="CDF">
              CDF — {fr ? "Franc congolais" : "Congolese franc"}
            </option>
            <option value="USD">
              USD — {fr ? "Dollar américain" : "US dollar"}
            </option>
            <option value="EUR">EUR — Euro</option>
          </select>
        </Field>
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
        {isOwner ? (
          <Field
            label={label(
              fr,
              "Owner budget override justification",
              "Justification propriétaire de dépassement",
            )}
            htmlFor="budgetOverrideReason"
            className="md:col-span-2"
            hint={label(
              fr,
              "Required only for an operation that exceeds the remaining project or task budget.",
              "Requise seulement pour une opération qui dépasse le budget disponible du projet ou de la tâche.",
            )}
          >
            <Textarea
              id="budgetOverrideReason"
              name="budgetOverrideReason"
              defaultValue={getValue("budgetOverrideReason")}
            />
          </Field>
        ) : null}{" "}
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
        {preselectedReceiptId || isEditing ? (
          <>
            <input
              type="hidden"
              name="receiptId"
              value={preselectedReceiptId}
            />
            <div className="md:col-span-2 rounded-xl border border-brand/20 bg-brand/[0.04] px-3 py-2.5 text-sm text-ink-secondary">
              <span className="font-semibold text-brand">
                {label(fr, "Receiving on", "Réception concernée")}
              </span>
              <span className="ml-2 font-medium text-ink">
                {String(activeReceiptLineReceipt?.receiptNumber ?? "—")}
              </span>
              <span className="ml-2">
                {label(
                  fr,
                  "Only items from this receipt's purchase order are available below.",
                  "Seuls les articles du bon de commande de cette réception sont proposés ci-dessous.",
                )}
              </span>
            </div>
          </>
        ) : (
          <Field
            label={label(fr, "Receipt", "Réception")}
            htmlFor="receiptId"
            required
            error={fieldError("receiptId")}
          >
            <select
              id="receiptId"
              name="receiptId"
              required
              value={activeReceiptLineReceiptId}
              onChange={(event) => {
                setSelectedReceiptLineReceiptId(event.target.value);
                setSelectedReceiptOrderLineId("");
              }}
              aria-invalid={Boolean(fieldError("receiptId"))}
              className={`h-9 w-full rounded-md border bg-surface-1 px-3 text-sm text-ink ${fieldError("receiptId") ? "border-critical" : "border-border-strong"}`}
            >
              <option value="" disabled={receiptLineOptions.length === 0}>
                {receiptLineOptions.length
                  ? label(fr, "Select", "Sélectionner")
                  : label(
                      fr,
                      "No draft receipts available",
                      "Aucune réception en brouillon disponible",
                    )}
              </option>
              {receiptLineOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.text}
                </option>
              ))}
            </select>
          </Field>
        )}
        {isEditing ? (
          <input
            type="hidden"
            name="purchaseOrderLineId"
            value={activeReceiptOrderLineId}
          />
        ) : null}
        <Field
          label={label(fr, "Ordered item", "Article commandé")}
          htmlFor="purchaseOrderLineId"
          required
          error={fieldError("purchaseOrderLineId")}
          hint={
            activeReceiptLineReceipt
              ? label(
                  fr,
                  "Only items from the selected purchase order are shown.",
                  "Seuls les articles du bon de commande sélectionné sont affichés.",
                )
              : label(
                  fr,
                  "Select the receipt first.",
                  "Sélectionnez d’abord la réception.",
                )
          }
        >
          <select
            key={`receipt-line-order-${activeReceiptLineReceiptId}`}
            id="purchaseOrderLineId"
            name="purchaseOrderLineId"
            required
            value={activeReceiptOrderLineId}
            onChange={(event) =>
              setSelectedReceiptOrderLineId(event.target.value)
            }
            disabled={
              isEditing ||
              !activeReceiptLineReceipt ||
              receiptOrderLineOptions.length === 0
            }
            aria-invalid={Boolean(fieldError("purchaseOrderLineId"))}
            className={`h-9 w-full rounded-md border bg-surface-1 px-3 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-60 ${fieldError("purchaseOrderLineId") ? "border-critical" : "border-border-strong"}`}
          >
            <option value="" disabled={receiptOrderLineOptions.length === 0}>
              {receiptOrderLineOptions.length
                ? label(fr, "Select", "Sélectionner")
                : label(
                    fr,
                    "No ordered items for this receipt",
                    "Aucun article commandé pour cette réception",
                  )}
            </option>
            {receiptOrderLineOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.text}
              </option>
            ))}
          </select>
        </Field>
        {activeReceiptOrderLine ? (
          <div className="md:col-span-2 rounded-xl border border-brand/20 bg-brand/[0.04] px-4 py-3 text-sm">
            <p className="font-semibold text-ink">
              {String(activeReceiptOrderLine.description ?? "—")}
            </p>
            <div className="mt-2 grid gap-2 text-ink-secondary sm:grid-cols-3">
              <p>
                {label(fr, "Ordered", "Commandé")} ·{" "}
                {number(activeReceiptOrderLine.orderedQuantity).toLocaleString(
                  fr ? "fr-FR" : "en-US",
                )}{" "}
                {String(activeReceiptOrderLine.unit ?? "")}
              </p>
              <p>
                {label(fr, "Already received", "Déjà reçu")} ·{" "}
                {confirmedQuantityForReceiptOrderLine.toLocaleString(
                  fr ? "fr-FR" : "en-US",
                )}{" "}
                {String(activeReceiptOrderLine.unit ?? "")}
              </p>
              <p className="font-medium text-ink">
                {label(fr, "Still expected", "Reste à recevoir")} ·{" "}
                {remainingQuantityForReceiptOrderLine.toLocaleString(
                  fr ? "fr-FR" : "en-US",
                )}{" "}
                {String(activeReceiptOrderLine.unit ?? "")}
              </p>
            </div>
          </div>
        ) : null}
        <div className="rounded-xl border border-border bg-surface-2/55 px-3 py-2.5 text-sm">
          <input
            type="hidden"
            name="projectMaterialId"
            value={String(activeReceiptOrderLine?.projectMaterialId ?? "")}
          />
          <p className="font-medium text-ink">
            {label(fr, "Project material", "Matériau du projet")}
          </p>
          <p className="mt-1 text-ink-secondary">
            {linkedReceiptMaterial
              ? String(
                  linkedReceiptMaterial.name ??
                    linkedReceiptMaterial.code ??
                    "—",
                )
              : label(
                  fr,
                  "No project material is linked to this ordered item.",
                  "Aucun matériau du projet n’est lié à cet article commandé.",
                )}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface-2/55 px-3 py-2.5 text-sm">
          <input
            type="hidden"
            name="inventoryItemId"
            value={String(activeReceiptOrderLine?.inventoryItemId ?? "")}
          />
          <p className="font-medium text-ink">
            {label(fr, "Inventory item", "Article en stock")}
          </p>
          <p className="mt-1 text-ink-secondary">
            {linkedReceiptInventoryItem
              ? String(
                  linkedReceiptInventoryItem.name ??
                    linkedReceiptInventoryItem.sku ??
                    "—",
                )
              : label(
                  fr,
                  "No inventory item is linked to this ordered item.",
                  "Aucun article en stock n’est lié à cet article commandé.",
                )}
          </p>
        </div>
        {input(
          "receivedQuantity",
          label(fr, "Quantity received now", "Quantité reçue maintenant"),
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
        <div className="md:col-span-2 rounded-xl border border-brand/20 bg-brand/[0.04] px-3 py-2.5 text-sm text-ink-secondary">
          <span className="font-semibold text-brand">
            {label(fr, "Automatic reference", "Référence automatique")}
          </span>
          <span className="ml-2">
            {label(
              fr,
              "The next BR number is assigned when this receipt is saved.",
              "Le prochain numéro BR est attribué lors de l’enregistrement de cette réception.",
            )}
          </span>
        </div>
        {isEditing ? (
          <>
            <input
              type="hidden"
              name="purchaseOrderId"
              value={getValue("purchaseOrderId")}
            />
            <div className="md:col-span-2 rounded-xl border border-brand/20 bg-brand/[0.04] px-3 py-2.5 text-sm text-ink-secondary">
              <span className="font-semibold text-brand">
                {label(fr, "Purchase order", "Bon de commande")}
              </span>
              <span className="ml-2 font-medium text-ink">
                {String(
                  orders.find(
                    (order) => String(order.id) === getValue("purchaseOrderId"),
                  )?.orderNumber ?? "—",
                )}
              </span>
              <span className="ml-2">
                {label(
                  fr,
                  "This link is protected once a receipt draft exists.",
                  "Ce lien est protégé dès qu’un BR brouillon existe.",
                )}
              </span>
            </div>
          </>
        ) : (
          select(
            "purchaseOrderId",
            label(fr, "Purchase order", "Bon de commande"),
            receivableOrderOptions,
            true,
          )
        )}
        {!isEditing && receivableOrderOptions.length === 0 ? (
          <p className="md:col-span-2 -mt-2 text-sm text-ink-secondary">
            {label(
              fr,
              "Only sent purchase orders with quantities still to receive appear here.",
              "Seuls les bons envoyés, sans BR en brouillon et ayant encore des quantités à recevoir apparaissent ici.",
            )}
          </p>
        ) : null}
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
        {!isEditing ? (
          <div className="md:col-span-2 rounded-xl border border-border bg-surface-2/55 px-3 py-2.5 text-sm leading-6 text-ink-secondary">
            <span className="font-semibold text-ink">
              {label(fr, "Draft BR", "BR en brouillon")}
            </span>
            <span className="ml-2">
              {label(
                fr,
                "The remaining ordered items are copied automatically from the selected purchase order. Correct only a quantity, damage, rejection, or actual cost that differs, then confirm the receipt from its card.",
                "Les articles restant à recevoir du bon sélectionné sont repris automatiquement. Corrigez seulement une quantité, un dommage, un refus ou le coût réel qui diffère, puis confirmez la réception depuis sa carte.",
              )}
            </span>
          </div>
        ) : null}
        {isOwner ? (
          <Field
            label={label(
              fr,
              "Owner budget override justification",
              "Justification propriétaire de dépassement",
            )}
            htmlFor="budgetOverrideReason"
            className="md:col-span-2"
            hint={label(
              fr,
              "Required only for an operation that exceeds the remaining project or task budget.",
              "Requise seulement pour une opération qui dépasse le budget disponible du projet ou de la tâche.",
            )}
          >
            <Textarea
              id="budgetOverrideReason"
              name="budgetOverrideReason"
              defaultValue={getValue("budgetOverrideReason")}
            />
          </Field>
        ) : null}{" "}
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
        <div className="md:col-span-2 rounded-2xl border border-brand/20 bg-brand/[0.05] p-4">
          <p className="text-sm font-semibold text-ink">
            {label(fr, "Financial operation", "Opération financière")}
          </p>
          <p className="mt-1 text-sm leading-6 text-ink-secondary">
            {expenseTypeValue === "receipt_payment"
              ? label(
                  fr,
                  "A supplier payment settles an accepted receipt. It updates the payable balance only and never reduces this project budget a second time.",
                  "Un paiement fournisseur règle une réception acceptée. Il met à jour le solde à payer sans réduire une deuxième fois le budget du projet.",
                )
              : label(
                  fr,
                  "A direct expense is for a cost outside the purchase-order flow. It affects the project budget only after approval.",
                  "Une dépense directe couvre un coût hors du circuit d’achat. Elle affecte le budget du projet seulement après approbation.",
                )}
          </p>
        </div>
        <Field
          label={label(
            fr,
            "What do you want to record?",
            "Que voulez-vous enregistrer ?",
          )}
          htmlFor="expenseType"
          className="md:col-span-2"
          error={fieldError("expenseType")}
        >
          <select
            id="expenseType"
            name="expenseType"
            value={expenseTypeValue}
            onChange={(event) => setExpenseTypeValue(event.target.value)}
            className="h-10 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink"
          >
            <option value="direct_expense">
              {label(
                fr,
                "New expense without a BR",
                "Nouvelle dépense sans BR",
              )}
            </option>
            <option value="receipt_payment">
              {label(
                fr,
                "Pay an accepted delivery (BR)",
                "Régler une livraison reçue (BR)",
              )}
            </option>
          </select>
          <p className="mt-1.5 text-xs leading-5 text-ink-secondary">
            {expenseTypeValue === "direct_expense"
              ? label(
                  fr,
                  "Use this only for a new cost with no purchase request, order, or receipt: transport, fuel, tax, repair, or cash purchase.",
                  "Utilisez ceci uniquement pour un nouveau coût sans DA, BC ni BR : transport, carburant, taxe, réparation ou achat comptant.",
                )
              : label(
                  fr,
                  "Use this only to pay a delivery already confirmed with a BR. LiteHubs reuses the purchase information and does not count the budget twice.",
                  "Utilisez ceci uniquement pour payer une livraison déjà confirmée par un BR. LiteHubs reprend les informations d’achat et ne compte pas le budget deux fois.",
                )}
          </p>
        </Field>
        {expenseTypeValue === "direct_expense" ? (
          <>
            {phaseSelect()}
            {select(
              "projectTaskId",
              label(fr, "Linked task", "Tâche liée"),
              taskOptions,
            )}
            {select(
              "supplierId",
              label(fr, "Beneficiary / supplier", "Bénéficiaire / fournisseur"),
              supplierOptions,
              false,
            )}
            {input(
              "beneficiaryName",
              label(
                fr,
                "Beneficiary if not listed",
                "Bénéficiaire si absent de la liste",
              ),
            )}
            <Field
              label={label(fr, "Expense category", "Catégorie de dépense")}
              htmlFor="category"
              error={fieldError("category")}
            >
              <select
                id="category"
                name="category"
                defaultValue={getValue("category")}
                required
                className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
              >
                <option value="" disabled>
                  {label(fr, "Choose a category", "Choisissez une catégorie")}
                </option>
                {[
                  ["animals", "Animal purchase"],
                  ["feed", "Feed / nutrition"],
                  ["health", "Vaccines, treatments & health"],
                  ["labour", "Labour"],
                  ["transport", "Transport"],
                  ["fuel", "Fuel / energy"],
                  ["utilities", "Water, electricity & utilities"],
                  ["equipment_depreciation", "Equipment depreciation"],
                  ["administrative", "Administrative"],
                  ["maintenance", "Maintenance"],
                  ["taxes", "Taxes / permits"],
                  ["cash_purchase", "Cash purchase"],
                  ["emergency", "Emergency"],
                  ["other", "Other"],
                ].map(([value, english]) => (
                  <option key={value} value={value}>
                    {fr
                      ? (
                          {
                            animals: "Achat des animaux",
                            feed: "Aliment / nutrition",
                            health: "Vaccins, traitements et santé",
                            labour: "Main-d’œuvre",
                            transport: "Transport",
                            fuel: "Carburant / énergie",
                            utilities: "Eau, électricité et services",
                            equipment_depreciation:
                              "Amortissement des équipements",
                            administrative: "Administratif",
                            maintenance: "Maintenance",
                            taxes: "Taxes / permis",
                            cash_purchase: "Achat comptant",
                            emergency: "Urgence",
                            other: "Autre",
                          } as Record<string, string>
                        )[value ?? ""]
                      : english}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : (
          <>
            <Field
              label={label(
                fr,
                "Accepted receipt to pay (BR)",
                "Réception acceptée à payer (BR)",
              )}
              htmlFor="receiptId"
              required
              error={fieldError("receiptId")}
              hint={label(
                fr,
                "LiteHubs automatically brings back the supplier, purchase order, project task, and currency from this receipt.",
                "LiteHubs récupère automatiquement le fournisseur, le bon de commande, la tâche du projet et la devise depuis cette réception.",
              )}
            >
              <select
                id="receiptId"
                name="receiptId"
                required
                value={selectedPaymentReceiptId}
                onChange={(event) =>
                  applyReceiptPaymentDefaults(event.target.value)
                }
                aria-invalid={Boolean(fieldError("receiptId"))}
                className={`h-10 w-full rounded-lg border bg-surface-1 px-3 text-sm text-ink ${fieldError("receiptId") ? "border-critical" : "border-border-strong"}`}
              >
                <option value="" disabled={receiptOptions.length === 0}>
                  {receiptOptions.length
                    ? label(fr, "Select", "Sélectionner")
                    : label(
                        fr,
                        "No accepted receipt available",
                        "Aucune réception acceptée disponible",
                      )}
                </option>
                {receiptOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.text}
                  </option>
                ))}
              </select>
            </Field>
            {selectedReceiptPayment.receipt ? (
              <div className="md:col-span-2 rounded-2xl border border-brand/20 bg-brand/[0.045] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
                      {label(
                        fr,
                        "Payment information recovered",
                        "Informations récupérées",
                      )}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {String(
                        selectedReceiptPayment.receipt.receiptNumber ?? "—",
                      )}{" "}
                      ·{" "}
                      {String(selectedReceiptPayment.order?.orderNumber ?? "—")}
                    </p>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {String(selectedReceiptPayment.supplier?.name ?? "") ||
                        label(
                          fr,
                          "Supplier unavailable",
                          "Fournisseur indisponible",
                        )}
                    </p>
                  </div>
                  <Badge variant="info">
                    {selectedReceiptPayment.currency}
                  </Badge>
                </div>
                <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-border bg-surface-1 px-3 py-2.5">
                    <dt className="text-[11px] font-semibold uppercase tracking-[.1em] text-ink-muted">
                      {label(fr, "Received", "Reçu")}
                    </dt>
                    <dd className="mt-1 text-sm font-semibold text-ink">
                      {money(
                        selectedReceiptPayment.total,
                        selectedReceiptPayment.currency,
                        fr ? "fr" : "en",
                      )}
                    </dd>
                  </div>
                  <div className="rounded-xl border border-border bg-surface-1 px-3 py-2.5">
                    <dt className="text-[11px] font-semibold uppercase tracking-[.1em] text-ink-muted">
                      {label(fr, "Already paid", "Déjà payé")}
                    </dt>
                    <dd className="mt-1 text-sm font-semibold text-ink">
                      {money(
                        selectedReceiptPayment.paid,
                        selectedReceiptPayment.currency,
                        fr ? "fr" : "en",
                      )}
                    </dd>
                  </div>
                  <div className="rounded-xl border border-brand/20 bg-brand/[0.045] px-3 py-2.5">
                    <dt className="text-[11px] font-semibold uppercase tracking-[.1em] text-brand">
                      {label(fr, "Balance to pay", "Solde à payer")}
                    </dt>
                    <dd className="mt-1 text-sm font-semibold text-ink">
                      {money(
                        selectedReceiptPayment.outstanding,
                        selectedReceiptPayment.currency,
                        fr ? "fr" : "en",
                      )}
                    </dd>
                  </div>
                </dl>
                {selectedReceiptPayment.total <= 0 ? (
                  <p className="mt-3 text-xs leading-5 text-warning">
                    {label(
                      fr,
                      "No received item has been confirmed on this BR yet. Add the actual received items before recording its payment.",
                      "Aucun article reçu n’est encore confirmé sur ce BR. Enregistrez d’abord les articles réellement reçus avant son paiement.",
                    )}
                  </p>
                ) : null}
              </div>
            ) : null}
            <input
              type="hidden"
              name="paymentIdempotencyKey"
              value={getValue("paymentIdempotencyKey") || paymentIdempotencyKey}
            />
            <input
              type="hidden"
              name="currencyCode"
              value={receiptPaymentCurrency}
            />
            <div className="md:col-span-2 rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-xs leading-5 text-ink-secondary">
              {label(
                fr,
                "The amount, project, task, supplier and currency are recovered from the BR. You only confirm the amount paid now, payment proof and payment method.",
                "Le montant, le projet, la tâche, le fournisseur et la devise sont récupérés depuis le BR. Vous confirmez seulement le montant payé maintenant, la preuve et le mode de paiement.",
              )}
            </div>
          </>
        )}
        {expenseTypeValue === "receipt_payment" ? (
          <>
            <input type="hidden" name="title" value={receiptPaymentTitle} />
            <input
              type="hidden"
              name="status"
              value={isOwner ? "paid" : "submitted"}
            />
            <div className="md:col-span-2 flex flex-wrap gap-2 rounded-xl border border-border bg-surface-2/60 p-3">
              <button
                type="button"
                onClick={() => {
                  setReceiptPaymentMode("full");
                  setReceiptPaymentAmount(
                    selectedReceiptPayment.outstanding > 0
                      ? String(selectedReceiptPayment.outstanding)
                      : "",
                  );
                }}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${receiptPaymentMode === "full" ? "bg-brand text-white" : "border border-border bg-surface-1 text-ink hover:bg-surface-2"}`}
              >
                {label(fr, "Pay full balance", "Régler le solde total")}
              </button>
              <button
                type="button"
                onClick={() => setReceiptPaymentMode("partial")}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${receiptPaymentMode === "partial" ? "bg-brand text-white" : "border border-border bg-surface-1 text-ink hover:bg-surface-2"}`}
              >
                {label(
                  fr,
                  "Record a partial payment",
                  "Enregistrer un paiement partiel",
                )}
              </button>
            </div>
            {receiptPaymentMode === "partial" ? (
              <>
                <Field
                  label={label(
                    fr,
                    "Amount paid now",
                    "Montant payé maintenant",
                  )}
                  htmlFor="amount"
                  required
                  error={fieldError("amount")}
                >
                  <Input
                    id="amount"
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={receiptPaymentAmount}
                    onChange={(event) =>
                      setReceiptPaymentAmount(event.target.value)
                    }
                    invalid={Boolean(fieldError("amount"))}
                  />
                </Field>
                <Field
                  label={label(fr, "Payment date", "Date du paiement")}
                  htmlFor="expenseDate"
                  required
                  error={fieldError("expenseDate")}
                >
                  <Input
                    id="expenseDate"
                    name="expenseDate"
                    type="date"
                    required
                    value={receiptPaymentDate}
                    onChange={(event) =>
                      setReceiptPaymentDate(event.target.value)
                    }
                    invalid={Boolean(fieldError("expenseDate"))}
                  />
                </Field>
                {input(
                  "paymentMethod",
                  label(fr, "Payment method", "Mode de paiement"),
                )}
                {input(
                  "paymentReference",
                  label(fr, "Payment reference", "Référence de paiement"),
                )}
                <p className="md:col-span-2 text-xs leading-5 text-ink-secondary">
                  {label(
                    fr,
                    "The receipt, order, supplier, task and currency remain linked automatically. You only enter this new partial amount.",
                    "Le BR, le BC, le fournisseur, la tâche et la devise restent liés automatiquement. Vous saisissez seulement ce nouveau montant partiel.",
                  )}
                </p>
              </>
            ) : (
              <>
                <input
                  type="hidden"
                  name="amount"
                  value={receiptPaymentAmount}
                />
                <input
                  type="hidden"
                  name="expenseDate"
                  value={receiptPaymentDate}
                />
                <div className="md:col-span-2 rounded-xl border border-good/25 bg-good/8 px-4 py-3 text-sm leading-6 text-ink-secondary">
                  {selectedReceiptPayment.outstanding > 0
                    ? label(
                        fr,
                        "Creating this record marks the entire remaining balance as paid. The BR and BC information is reused automatically.",
                        "Enregistrer cette opération marque automatiquement tout le solde restant comme payé. Les informations du BR et du BC sont reprises sans ressaisie.",
                      )
                    : label(
                        fr,
                        "This BR has no confirmed amount left to pay. Confirm the received items first, or it may already be fully paid.",
                        "Ce BR n’a aucun montant confirmé à payer. Confirmez d’abord les articles reçus, ou vérifiez s’il est déjà entièrement payé.",
                      )}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {input(
              "title",
              label(fr, "Title / subject", "Titre / objet"),
              true,
            )}
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
            {input(
              "paymentReference",
              label(fr, "Payment reference", "Référence de paiement"),
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
                    "refunded",
                  ]
                : ["draft", "submitted"]
              ).map((value) => ({
                value,
                text:
                  value === "draft"
                    ? label(fr, "Draft", "Brouillon")
                    : value === "submitted"
                      ? label(
                          fr,
                          "Submit for approval",
                          "Soumettre pour approbation",
                        )
                      : titleCase(value),
              })),
              true,
            )}
            <Field
              label={label(
                fr,
                "Invoice, receipt or proof",
                "Facture, reçu ou justificatif",
              )}
              htmlFor="expenseEvidence"
              className="md:col-span-2"
              hint={label(
                fr,
                "Optional PDF or image. It is stored privately in this project’s Documents area.",
                "PDF ou image facultatif. Le fichier est conservé de façon privée dans les Documents du projet.",
              )}
            >
              <Input
                id="expenseEvidence"
                name="expenseEvidence"
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
              />
            </Field>
            <Field
              label={label(fr, "Description", "Description")}
              htmlFor="description"
              className="md:col-span-2"
              hint={label(
                fr,
                "Optional operational details. The title remains the accounting subject.",
                "Détails opérationnels facultatifs. Le titre reste l’objet comptable.",
              )}
            >
              <Textarea
                id="description"
                name="description"
                defaultValue={getValue("description")}
                placeholder={label(
                  fr,
                  "Describe the cost, payment, or correction.",
                  "Décrivez le coût, le paiement ou la correction.",
                )}
              />
            </Field>
            {isOwner ? (
              <Field
                label={label(
                  fr,
                  "Owner budget override justification",
                  "Justification propriétaire de dépassement",
                )}
                htmlFor="budgetOverrideReason"
                className="md:col-span-2"
                hint={label(
                  fr,
                  "Required only for an operation that exceeds the remaining project or task budget.",
                  "Requise seulement pour une opération qui dépasse le budget disponible du projet ou de la tâche.",
                )}
              >
                <Textarea
                  id="budgetOverrideReason"
                  name="budgetOverrideReason"
                  defaultValue={getValue("budgetOverrideReason")}
                />
              </Field>
            ) : null}
            <Field
              label={label(fr, "Accounting notes", "Notes comptables")}
              htmlFor="notes"
              className="md:col-span-2"
            >
              <Textarea
                id="notes"
                name="notes"
                defaultValue={getValue("notes")}
              />
            </Field>
          </>
        )}
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
        <Field
          label={label(fr, "Equipment photo", "Photo de l’équipement")}
          htmlFor="assetPhoto"
          className="md:col-span-2"
          hint={label(
            fr,
            "Optional. It appears as a private thumbnail in Equipment and Project Resources.",
            "Facultative. Elle apparaît en miniature privée dans Équipements et Ressources du projet.",
          )}
        >
          <Input
            id="assetPhoto"
            name="assetPhoto"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
          />
        </Field>
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
  icon: Icon,
  children,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
  icon?: typeof FolderKanban;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-brand/25 bg-surface-1 ring-1 ring-brand/[0.045] shadow-[0_16px_38px_-30px_rgb(15_118_110_/_0.55)]">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 bg-surface-2/45 px-5 py-5">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
              <Icon className="size-5" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-ink">{title}</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-secondary">
              {subtitle}
            </p>
          </div>
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
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
function ProcurementRecordsPanel({
  title,
  subtitle,
  rows,
  fields,
  fr,
  icon: Icon,
  onAdd,
  onEdit,
  canEditRow,
  onSubmit,
  canSubmitRow,
  onReject,
  canRejectRow,
  onVerify,
  canVerifyRow,
  onAddItem,
  canAddItemRow,
  addItemLabel,
  onReturnToDraft,
  canReturnRow,
  onCancel,
  canCancelRow,
  relatedRows,
  relatedKey,
  relatedLabel,
  onEditRelatedRow,
  submitLabel,
  rejectLabel,
  verifyLabel,
  cancelLabel,
  editLabel,
  footer,
  orgSlug,
  pdfResource,
  canDownloadPdf,
  leading,
}: {
  title: string;
  subtitle: string;
  rows: Row[];
  fields: string[];
  fr: boolean;
  icon: typeof FolderKanban;
  onAdd?: () => void;
  onEdit?: (row: Row) => void;
  canEditRow?: (row: Row) => boolean;
  onSubmit?: (row: Row) => void;
  canSubmitRow?: (row: Row) => boolean;
  onReject?: (row: Row) => void;
  canRejectRow?: (row: Row) => boolean;
  onVerify?: (row: Row) => void;
  canVerifyRow?: (row: Row) => boolean;
  onAddItem?: (row: Row) => void;
  canAddItemRow?: (row: Row) => boolean;
  addItemLabel?: string;
  onReturnToDraft?: (row: Row) => void;
  canReturnRow?: (row: Row) => boolean;
  onCancel?: (row: Row) => void;
  canCancelRow?: (row: Row) => boolean;
  relatedRows?: Row[];
  relatedKey?: string;
  relatedLabel?: string;
  onEditRelatedRow?: (row: Row) => void;
  submitLabel?: string;
  rejectLabel?: string;
  verifyLabel?: string;
  cancelLabel?: string;
  editLabel?: string;
  footer?: ReactNode;
  orgSlug?: string;
  pdfResource?: "purchase-requests" | "purchase-orders" | "receipts";
  canDownloadPdf?: boolean;
  leading?: (row: Row) => ReactNode;
}) {
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const pageSize = 2;
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const firstItem = rows.length ? currentPage * pageSize + 1 : 0;
  const lastItem = Math.min((currentPage + 1) * pageSize, rows.length);
  const visibleRows = rows.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  const formatDate = (value: unknown) => {
    if (!value) return null;
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime())
      ? String(value)
      : new Intl.DateTimeFormat(fr ? "fr-FR" : "en-US", {
          dateStyle: "medium",
        }).format(parsed);
  };
  const formatAuditDate = (value: unknown) => {
    if (!value) return null;
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime())
      ? null
      : new Intl.DateTimeFormat(fr ? "fr-FR" : "en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(parsed);
  };
  const formatValue = (field: string, value: unknown) => {
    const quantity = new Intl.NumberFormat(fr ? "fr-FR" : "en-US", {
      maximumFractionDigits: 2,
    });
    const quantityLabel: Record<string, string> = fr
      ? {
          requestedQuantity: "Demandé",
          orderedQuantity: "Commandé",
          receivedQuantity: "Reçu",
          damagedQuantity: "Endommagé",
          rejectedQuantity: "Refusé",
        }
      : {
          requestedQuantity: "Requested",
          orderedQuantity: "Ordered",
          receivedQuantity: "Received",
          damagedQuantity: "Damaged",
          rejectedQuantity: "Rejected",
        };
    if (quantityLabel[field]) {
      const parsed = Number(value);
      return `${quantityLabel[field]} : ${Number.isFinite(parsed) ? quantity.format(parsed) : String(value)}`;
    }
    if (field === "unit")
      return `${label(fr, "Unit", "Unité")} : ${String(value)}`;
    if (field === "status") {
      const statusLabels: Record<string, string> = fr
        ? {
            draft: "Brouillon",
            submitted: "En attente d’approbation",
            approved: "Approuvée",
            partially_approved: "Partiellement approuvée",
            sent: "Envoyé",
            partially_received: "Partiellement réceptionné",
            received: "Réceptionnée",
            verified: "Vérifiée",
            rejected: "Refusée",
            cancelled: "Annulée",
          }
        : {
            draft: "Draft",
            submitted: "Awaiting approval",
            approved: "Approved",
            partially_approved: "Partially approved",
            sent: "Sent",
            partially_received: "Partially received",
            received: "Received",
            verified: "Verified",
            rejected: "Rejected",
            cancelled: "Cancelled",
          };
      return statusLabels[String(value)] ?? titleCase(value);
    }
    if (
      field === "requiredDate" ||
      field === "expectedDeliveryDate" ||
      field === "receivedDate"
    ) {
      return formatDate(value) ?? "—";
    }
    return String(value);
  };
  const auditAction = (value: unknown) => {
    const action = String(value ?? "");
    const labels: Record<string, string> = fr
      ? {
          create: "Créé",
          update: "Mis à jour",
          approve: "Approuvé",
          reject: "Refusé",
        }
      : {
          create: "Created",
          update: "Updated",
          approve: "Approved",
          reject: "Rejected",
        };
    return (
      labels[action] ??
      (action ? titleCase(action) : label(fr, "Created", "Créé"))
    );
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-brand/25 bg-surface-1 ring-1 ring-brand/[0.045] shadow-[0_16px_38px_-30px_rgb(15_118_110_/_0.55)]">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 bg-surface-2/45 px-5 py-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-ink">{title}</h3>
            <p className="mt-1 max-w-xl text-xs leading-5 text-ink-secondary">
              {subtitle}
            </p>
          </div>
        </div>
        {onAdd ? (
          <Button size="sm" onClick={onAdd}>
            <Plus />
            {label(fr, "Add", "Ajouter")}
          </Button>
        ) : null}
      </header>
      <div className="space-y-4 p-5">
        {rows.length ? (
          <>
            {visibleRows.map((row, index) => {
              const rowCanEdit = !canEditRow || canEditRow(row);
              const recordName = String(
                row.requestNumber ??
                  row.orderNumber ??
                  row.receiptNumber ??
                  row.description ??
                  row.name ??
                  row.title ??
                  row.code ??
                  "—",
              );
              const details = fields
                .filter((field) => row[field] != null && row[field] !== "")
                .map((field) => formatValue(field, row[field]));
              const relatedItems =
                relatedRows && relatedKey
                  ? relatedRows.filter(
                      (item) =>
                        String(item[relatedKey] ?? "") === String(row.id),
                    )
                  : [];
              const recordIsDraft = String(row.status) === "draft";
              const recordCanSubmit =
                Boolean(onSubmit) && (canSubmitRow?.(row) ?? recordIsDraft);
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
              const timestamp = formatAuditDate(
                row.lastActionAt ?? row.createdAt,
              );
              return (
                <article
                  key={String(row.id || `${title}-${recordName}-${index}`)}
                  className="overflow-hidden rounded-2xl border border-brand/20 bg-surface-1 ring-1 ring-brand/[0.025] transition-shadow hover:shadow-[0_14px_30px_-26px_rgb(15_118_110_/_0.5)]"
                >
                  <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 bg-surface-2/45 px-4 py-3.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-ink-muted">
                          {title}
                        </p>
                        <h4 className="mt-0.5 truncate text-sm font-semibold text-ink">
                          {recordName}
                        </h4>
                      </div>
                    </div>
                    {row.status ? (
                      <Badge variant={statusVariant(row.status)}>
                        {formatValue("status", row.status)}
                      </Badge>
                    ) : null}
                  </header>
                  <div className="space-y-3 px-4 py-4">
                    {details.length ? (
                      <div className="flex flex-wrap gap-2">
                        {details.map((detail, detailIndex) => (
                          <span
                            key={`${recordName}-${detailIndex}`}
                            className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs leading-4 text-ink-secondary"
                          >
                            {detail}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-ink-muted">—</p>
                    )}
                    {relatedItems.length ? (
                      <div className="rounded-xl border border-border bg-surface-2/55 px-3 py-3">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedRowId((current) =>
                              current === String(row.id)
                                ? null
                                : String(row.id),
                            )
                          }
                          aria-expanded={expandedRowId === String(row.id)}
                          className="flex w-full items-center justify-between gap-3 text-left"
                        >
                          <span className="text-[11px] font-semibold uppercase tracking-[0.11em] text-ink-muted">
                            {relatedLabel ??
                              label(fr, "Requested items", "Articles demandés")}
                          </span>
                          <span className="rounded-md bg-brand/8 px-2 py-1 text-xs font-semibold text-brand">
                            {relatedItems.length}{" "}
                            {label(fr, "item(s)", "article(s)")} ·{" "}
                            {expandedRowId === String(row.id)
                              ? label(fr, "Close", "Réduire")
                              : label(fr, "View", "Voir")}
                          </span>
                        </button>
                        <div className="mt-2 space-y-1.5">
                          {(expandedRowId === String(row.id)
                            ? relatedItems
                            : relatedItems.slice(0, 2)
                          ).map((item, itemIndex) => (
                            <div
                              key={String(
                                item.id || `${row.id}-item-${itemIndex}`,
                              )}
                              className="flex items-center justify-between gap-3 rounded-lg px-1 py-1 text-xs"
                            >
                              <span className="min-w-0 truncate text-ink-secondary">
                                {String(item.description ?? item.name ?? "—")}
                              </span>
                              <span className="flex shrink-0 items-center gap-2 font-medium text-ink">
                                <span>
                                  {String(
                                    item.requestedQuantity ??
                                      item.orderedQuantity ??
                                      item.receivedQuantity ??
                                      "—",
                                  )}{" "}
                                  {String(item.unit ?? "")}
                                </span>
                                {recordIsDraft && onEditRelatedRow ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => onEditRelatedRow(item)}
                                  >
                                    <Pencil className="size-3.5" />
                                    {label(fr, "Edit", "Modifier")}
                                  </Button>
                                ) : null}
                              </span>
                            </div>
                          ))}
                          {relatedItems.length > 2 &&
                          expandedRowId !== String(row.id) ? (
                            <button
                              type="button"
                              onClick={() => setExpandedRowId(String(row.id))}
                              className="pt-1 text-xs font-medium text-brand hover:underline"
                            >
                              +{relatedItems.length - 2}{" "}
                              {label(fr, "more item(s)", "autre(s) article(s)")}{" "}
                              · {label(fr, "Open all", "Ouvrir tout")}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {actorName || timestamp ? (
                      <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 border-t border-border/70 pt-3 text-[11px] leading-4 text-ink-muted">
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
                              dateTime={String(
                                row.lastActionAt ?? row.createdAt,
                              )}
                            >
                              {timestamp}
                            </time>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                  {recordCanSubmit ||
                  (onReject &&
                    String(row.status) === "draft" &&
                    (!canRejectRow || canRejectRow(row))) ||
                  (onVerify && (!canVerifyRow || canVerifyRow(row))) ||
                  (onAddItem &&
                    String(row.status) === "draft" &&
                    (!canAddItemRow || canAddItemRow(row))) ||
                  (onReturnToDraft &&
                    String(row.status) !== "draft" &&
                    (!canReturnRow || canReturnRow(row))) ||
                  (onCancel && (!canCancelRow || canCancelRow(row))) ||
                  (onEdit && rowCanEdit) ||
                  (canDownloadPdf && orgSlug && pdfResource && row.id) ? (
                    <footer className="flex flex-wrap justify-end gap-2 border-t border-border/70 bg-surface-2/30 px-4 py-3">
                      {canDownloadPdf && orgSlug && pdfResource && row.id ? (
                        <a
                          href={orgApiUrl(
                            orgSlug,
                            `owner-management/procurement/${pdfResource}/${String(row.id)}/export.pdf`,
                          )}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-brand/25 bg-brand/5 px-2.5 text-xs font-semibold text-brand transition-colors hover:bg-brand/10 focus:outline-none focus:ring-2 focus:ring-brand/30"
                        >
                          <Download className="size-3.5" />
                          {label(fr, "Download PDF", "Télécharger le PDF")}
                        </a>
                      ) : null}
                      {recordCanSubmit ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => onSubmit?.(row)}
                        >
                          <Send className="size-3.5" />
                          {submitLabel ?? label(fr, "Submit", "Soumettre")}
                        </Button>
                      ) : null}
                      {onReject &&
                      String(row.status) === "draft" &&
                      (!canRejectRow || canRejectRow(row)) ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => onReject(row)}
                        >
                          {rejectLabel ??
                            label(
                              fr,
                              "Reject delivery",
                              "Refuser la livraison",
                            )}
                        </Button>
                      ) : null}
                      {onVerify && (!canVerifyRow || canVerifyRow(row)) ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => onVerify(row)}
                        >
                          {verifyLabel ??
                            label(
                              fr,
                              "Verify receipt",
                              "Vérifier la réception",
                            )}
                        </Button>
                      ) : null}
                      {onAddItem &&
                      String(row.status) === "draft" &&
                      (!canAddItemRow || canAddItemRow(row)) ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onAddItem(row)}
                        >
                          <Plus className="size-3.5" />
                          {addItemLabel ??
                            (row.orderNumber
                              ? label(
                                  fr,
                                  "Add additional item",
                                  "Ajouter un article supplémentaire",
                                )
                              : label(fr, "Add item", "Ajouter un article"))}
                        </Button>
                      ) : null}
                      {onReturnToDraft &&
                      String(row.status) !== "draft" &&
                      (!canReturnRow || canReturnRow(row)) ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onReturnToDraft(row)}
                        >
                          <Pencil className="size-3.5" />
                          {label(
                            fr,
                            "Return to draft",
                            "Retourner en brouillon",
                          )}
                        </Button>
                      ) : null}
                      {onCancel && (!canCancelRow || canCancelRow(row)) ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => onCancel(row)}
                        >
                          {cancelLabel ??
                            label(fr, "Cancel order", "Annuler le bon")}
                        </Button>
                      ) : null}
                      {onEdit && rowCanEdit ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onEdit(row)}
                        >
                          <Pencil className="size-3.5" />
                          {editLabel ?? label(fr, "Edit", "Modifier")}
                        </Button>
                      ) : null}
                    </footer>
                  ) : null}
                </article>
              );
            })}
            {rows.length > pageSize ? (
              <nav
                className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4"
                aria-label={label(
                  fr,
                  "Record pagination",
                  "Pagination des enregistrements",
                )}
              >
                <p className="text-xs text-ink-secondary">
                  {label(fr, "Showing", "Affichage")} {firstItem}–{lastItem}{" "}
                  {label(fr, "of", "sur")} {rows.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={currentPage === 0}
                    onClick={() => setPage((value) => Math.max(0, value - 1))}
                  >
                    {label(fr, "Previous", "Précédent")}
                  </Button>
                  <span className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-ink-secondary">
                    {currentPage + 1}/{totalPages}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={currentPage >= totalPages - 1}
                    onClick={() =>
                      setPage((value) => Math.min(totalPages - 1, value + 1))
                    }
                  >
                    {label(fr, "Next", "Suivant")}
                  </Button>
                </div>
              </nav>
            ) : null}
          </>
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
          <div className="border-t border-border/70 pt-4">{footer}</div>
        ) : null}
      </div>
    </section>
  );
}
function ProjectAssetPhoto({
  orgSlug,
  asset,
  fr,
}: {
  orgSlug: string;
  asset: Row;
  fr: boolean;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const images = useQuery({
    queryKey: ["project-resource-asset-images", orgSlug, asset.id],
    queryFn: () =>
      get<{ images: Row[] }>(
        orgUrl(orgSlug, `images/owner-management/assets/${asset.id}`),
      ),
    enabled: Boolean(asset.id),
    select: (data) => data.images,
  });
  const photo = (images.data ?? []).find(
    (image) =>
      String(image.documentType ?? "") === "equipment_photo" ||
      String(image.title ?? "").endsWith(" · photo"),
  );
  const previewUrl = photo
    ? orgApiUrl(orgSlug, `files/${String(photo.id)}/preview`)
    : null;
  const title = String(asset.name ?? asset.assetNumber ?? "—");

  return (
    <>
      {photo && previewUrl ? (
        <button
          type="button"
          className="relative block size-16 overflow-hidden rounded-xl border border-border bg-surface-3 shadow-sm transition hover:border-brand/45 focus:outline-none focus:ring-2 focus:ring-brand/40 sm:size-20"
          onClick={(event) => {
            event.stopPropagation();
            setPreviewOpen(true);
          }}
          aria-label={label(
            fr,
            `Open photo of ${title}`,
            `Ouvrir la photo de ${title}`,
          )}
        >
          <img
            src={previewUrl}
            alt={String(photo.altText ?? title)}
            className="size-full object-cover"
            loading="lazy"
          />
          <span className="absolute inset-x-0 bottom-0 bg-ink/65 px-1 py-0.5 text-[9px] font-semibold text-white">
            {label(fr, "View", "Voir")}
          </span>
        </button>
      ) : (
        <span
          className="grid size-16 place-items-center rounded-xl border border-dashed border-border bg-surface-2 text-ink-muted sm:size-20"
          aria-label={label(
            fr,
            "No equipment photo",
            "Aucune photo d’équipement",
          )}
        >
          <FileImage className="size-5" />
        </span>
      )}
      {previewOpen && photo && previewUrl ? (
        <div
          className="fixed inset-0 z-[90] grid place-items-center bg-ink/65 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`project-asset-photo-${asset.id}`}
          onMouseDown={() => setPreviewOpen(false)}
        >
          <section
            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3 border-b border-border bg-surface-2 px-5 py-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[.13em] text-brand">
                  {label(fr, "Equipment photo", "Photo de l’équipement")}
                </p>
                <h2
                  id={`project-asset-photo-${asset.id}`}
                  className="mt-1 truncate text-lg font-semibold text-ink"
                >
                  {title}
                </h2>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => setPreviewOpen(false)}
                aria-label={label(fr, "Close", "Fermer")}
              >
                <X />
              </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto bg-surface-3 p-4 sm:p-6">
              <img
                src={previewUrl}
                alt={String(photo.altText ?? title)}
                className="mx-auto max-h-[72vh] max-w-full rounded-xl bg-surface-1 object-contain shadow-lg"
              />
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
function BudgetChangeHistory({
  rows,
  fr,
  locale,
  defaultCurrency,
}: {
  rows: Row[];
  fr: boolean;
  locale: string;
  defaultCurrency?: string | null;
}) {
  const changes = rows.flatMap((row) => {
    try {
      const parsed = JSON.parse(String(row.status ?? "")) as Record<
        string,
        unknown
      >;
      const before = Number(parsed.before ?? 0);
      const after = Number(parsed.after ?? 0);
      if (!Number.isFinite(before) || !Number.isFinite(after)) return [];
      return [
        {
          id: `${String(row.id)}-${String(row.occurredAt ?? "")}`,
          title: String(row.title ?? ""),
          actorName: String(row.actorName ?? "").trim(),
          occurredAt: row.occurredAt,
          scope: String(parsed.scope ?? "project"),
          before,
          after,
          difference: Number(parsed.difference ?? after - before),
          currencyCode: String(parsed.currencyCode ?? defaultCurrency ?? "CDF"),
          justification: String(parsed.justification ?? "").trim(),
        },
      ];
    } catch {
      return [];
    }
  });
  const formattedDate = (value: unknown) => {
    const parsed = new Date(String(value ?? ""));
    return Number.isNaN(parsed.getTime())
      ? "—"
      : new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(parsed);
  };
  return (
    <Panel
      title={label(fr, "Budget change history", "Historique des budgets")}
      subtitle={label(
        fr,
        "Every budget increase or reduction is retained with the previous amount, new amount, person and date.",
        "Chaque augmentation ou réduction est conservée avec l’ancien montant, le nouveau montant, la personne et la date.",
      )}
      icon={ClipboardList}
    >
      {changes.length ? (
        <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
          {changes.map((change) => {
            const increased = change.difference > 0.0001;
            const decreased = change.difference < -0.0001;
            const scope =
              change.scope === "task"
                ? label(fr, "Task budget", "Budget de la tâche")
                : label(fr, "Project budget", "Budget du projet");
            return (
              <article
                key={change.id}
                className="rounded-2xl border border-brand/20 bg-surface-2/45 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {scope}
                      {change.scope === "task" && change.title
                        ? ` · ${change.title}`
                        : ""}
                    </p>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {increased
                        ? label(fr, "Budget increased", "Budget augmenté")
                        : decreased
                          ? label(fr, "Budget reduced", "Budget réduit")
                          : label(fr, "Budget adjusted", "Budget ajusté")}
                    </p>
                  </div>
                  <Badge
                    variant={
                      increased ? "good" : decreased ? "warning" : "neutral"
                    }
                  >
                    {increased ? "+" : ""}
                    {money(change.difference, change.currencyCode, locale)}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {[
                    [label(fr, "Previous", "Ancien"), change.before],
                    [label(fr, "New", "Nouveau"), change.after],
                    [label(fr, "Difference", "Écart"), change.difference],
                  ].map(([title, amount]) => (
                    <div
                      key={String(title)}
                      className="rounded-xl border border-border bg-surface-1 px-3 py-2.5"
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ink-muted">
                        {title}
                      </p>
                      <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
                        {money(amount, change.currencyCode, locale)}
                      </p>
                    </div>
                  ))}
                </div>
                {change.justification ? (
                  <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-xs leading-5 text-ink-secondary">
                    <span className="font-semibold text-ink">
                      {label(
                        fr,
                        "Owner justification",
                        "Justification propriétaire",
                      )}{" "}
                      ·{" "}
                    </span>
                    {change.justification}
                  </p>
                ) : null}
                <p className="mt-3 border-t border-border pt-2.5 text-[11px] text-ink-muted">
                  {change.actorName
                    ? `${label(fr, "Changed by", "Modifié par")} ${change.actorName} · `
                    : ""}
                  {formattedDate(change.occurredAt)}
                </p>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title={label(
            fr,
            "No budget change yet",
            "Aucun changement de budget",
          )}
          description={label(
            fr,
            "The initial budget is recorded when the project or task is created. Every later adjustment will appear here.",
            "Le budget initial est enregistré lors de la création du projet ou de la tâche. Chaque ajustement ultérieur apparaîtra ici.",
          )}
        />
      )}
    </Panel>
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
  canEditRow,
  onSubmit,
  submitLabel,
  onOpen,
  editLabel,
  footer,
  orgSlug,
  pdfResource,
  canDownloadPdf,
  leading,
}: {
  title: string;
  subtitle: string;
  rows: Row[];
  fields: string[];
  fr: boolean;
  icon: typeof FolderKanban;
  onAdd?: () => void;
  onEdit?: (row: Row) => void;
  canEditRow?: (row: Row) => boolean;
  onSubmit?: (row: Row) => void;
  onOpen?: (row: Row) => void;
  submitLabel?: string;
  editLabel?: string;
  footer?: ReactNode;
  orgSlug?: string;
  pdfResource?: "purchase-requests" | "purchase-orders" | "receipts";
  canDownloadPdf?: boolean;
  leading?: (row: Row) => ReactNode;
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
    const quantity = (raw: unknown) => {
      const parsed = Number(raw);
      return Number.isFinite(parsed)
        ? new Intl.NumberFormat(fr ? "fr-FR" : "en-US", {
            maximumFractionDigits: 2,
          }).format(parsed)
        : String(raw);
    };
    const quantityLabels: Record<string, string> = fr
      ? {
          requestedQuantity: "Demandé",
          orderedQuantity: "Commandé",
          receivedQuantity: "Reçu",
          damagedQuantity: "Endommagé",
          rejectedQuantity: "Refusé",
        }
      : {
          requestedQuantity: "Requested",
          orderedQuantity: "Ordered",
          receivedQuantity: "Received",
          damagedQuantity: "Damaged",
          rejectedQuantity: "Rejected",
        };
    if (quantityLabels[field])
      return `${quantityLabels[field]} : ${quantity(value)}`;
    if (field === "unit")
      return `${label(fr, "Unit", "Unité")} : ${String(value)}`;
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
    if (field === "status") {
      const states: Record<string, string> = fr
        ? {
            draft: "Brouillon",
            submitted: "En attente d’approbation",
            approved: "Approuvée",
            partially_approved: "Partiellement approuvée",
            sent: "Envoyé",
            partially_received: "Partiellement réceptionné",
            received: "Réceptionnée",
            verified: "Vérifiée",
            rejected: "Refusée",
            cancelled: "Annulée",
          }
        : {
            draft: "Draft",
            submitted: "Awaiting approval",
            approved: "Approved",
            partially_approved: "Partially approved",
            sent: "Sent",
            partially_received: "Partially received",
            received: "Received",
            verified: "Verified",
            rejected: "Rejected",
            cancelled: "Cancelled",
          };
      return states[String(value)] ?? titleCase(value);
    }
    return field === "priority" ? titleCase(value) : String(value);
  };
  const pageSize = 2;
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const firstItem = rows.length ? currentPage * pageSize + 1 : 0;
  const lastItem = Math.min((currentPage + 1) * pageSize, rows.length);
  const visibleRows = rows.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );

  return (
    <Panel
      title={title}
      subtitle={subtitle}
      icon={Icon}
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
        <div className="space-y-4">
          {visibleRows.map((row, index) => {
            const rowCanEdit = !canEditRow || canEditRow(row);
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
                className={`group flex items-start justify-between gap-4 overflow-hidden rounded-2xl border border-brand/20 bg-surface-1 p-4 ring-1 ring-brand/[0.025] shadow-[0_14px_30px_-26px_rgba(15,38,63,.58)] transition-all ${onOpen ? "cursor-pointer hover:-translate-y-px hover:border-brand/45 hover:bg-surface-2 hover:shadow-[0_18px_34px_-26px_rgba(15,38,63,.7)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" : ""}`}
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
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  {leading ? (
                    <div className="shrink-0">{leading(row)}</div>
                  ) : null}
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
                    <div className="mt-3 flex flex-wrap gap-2">
                      {fields
                        .map((field) =>
                          row[field] == null || row[field] === ""
                            ? null
                            : displayField(field, row[field]),
                        )
                        .filter(Boolean)
                        .map((detail, detailIndex) => (
                          <span
                            key={`${String(row.id)}-${detailIndex}`}
                            className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs leading-4 text-ink-secondary"
                          >
                            {detail}
                          </span>
                        ))}
                    </div>
                    {actorName || timestamp ? (
                      <p className="mt-3 flex flex-wrap gap-x-1.5 gap-y-0.5 border-t border-border pt-2.5 text-[11px] leading-4 text-ink-muted">
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
                              dateTime={String(
                                row.lastActionAt ?? row.createdAt,
                              )}
                            >
                              {timestamp}
                            </time>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {row.status ? (
                    <Badge variant={statusVariant(row.status)}>
                      {displayField("status", row.status)}
                    </Badge>
                  ) : null}
                  {onSubmit && String(row.status) === "draft" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSubmit(row);
                      }}
                    >
                      <Send className="size-3.5" />
                      {submitLabel ?? label(fr, "Submit", "Soumettre")}
                    </Button>
                  ) : null}
                  {onEdit && rowCanEdit ? (
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
          {rows.length > pageSize ? (
            <nav
              className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4"
              aria-label={label(
                fr,
                "Record pagination",
                "Pagination des enregistrements",
              )}
            >
              <p className="text-xs text-ink-secondary">
                {label(fr, "Showing", "Affichage")} {firstItem}–{lastItem}{" "}
                {label(fr, "of", "sur")} {rows.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={currentPage === 0}
                  onClick={() => setPage((value) => Math.max(0, value - 1))}
                >
                  {label(fr, "Previous", "Précédent")}
                </Button>
                <span className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-ink-secondary">
                  {currentPage + 1}/{totalPages}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={currentPage >= totalPages - 1}
                  onClick={() =>
                    setPage((value) => Math.min(totalPages - 1, value + 1))
                  }
                >
                  {label(fr, "Next", "Suivant")}
                </Button>
              </div>
            </nav>
          ) : null}
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
      [
        String(row.name ?? row.title ?? row.code ?? row.id),
        row.projectName ? String(row.projectName) : null,
      ]
        .filter(Boolean)
        .join(" · "),
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
        <div className="max-h-[30rem] space-y-3 overflow-y-auto pr-1">
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
function ProductionProfitabilityPanel({
  data,
  fr,
  locale,
}: {
  data: NonNullable<Summary["productionProfitability"]>;
  fr: boolean;
  locale: string;
}) {
  const currency = data.currencyCode || "CDF";
  const profit = number(data.profit);
  const margin = number(data.marginPercent);
  const noRecordedCost = number(data.operationalCost) === 0;
  const eggsRemaining = Math.max(
    number(data.eggsProduced) - number(data.eggsSold),
    0,
  );
  const costs = data.costBreakdown ?? {};
  const costItems = [
    ["animals", label(fr, "Animal acquisition", "Achat des animaux")],
    ["feed", label(fr, "Feed distributed", "Aliment distribué")],
    ["health", label(fr, "Vaccines & treatments", "Vaccins et traitements")],
    ["labour", label(fr, "Labour", "Main-d’œuvre")],
    ["transport", label(fr, "Transport", "Transport")],
    ["utilities", label(fr, "Water & electricity", "Eau et électricité")],
    [
      "equipment_depreciation",
      label(fr, "Equipment depreciation", "Amortissement équipement"),
    ],
    [
      "other",
      label(fr, "Other production costs", "Autres coûts de production"),
    ],
  ] as const;
  const flocks = data.flocks ?? [];

  return (
    <Panel
      icon={BarChart3}
      title={label(
        fr,
        "Poultry production profitability",
        "Rentabilité de production avicole",
      )}
      subtitle={label(
        fr,
        "Each linked flock keeps its own costs, delivered sales and customer cash position. A delivery creates revenue; payment changes cash only.",
        "Chaque lot lié conserve ses coûts, ses ventes livrées et son encaissement client. Une livraison crée une recette ; le paiement change seulement la trésorerie.",
      )}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ProfitabilityMetric
          label={label(fr, "Delivery revenue", "Recettes livrées")}
          value={money(data.revenue, currency, locale)}
          tone="text-emerald-700"
        />
        <ProfitabilityMetric
          label={label(
            fr,
            "Real production costs",
            "Coûts réels de production",
          )}
          value={money(data.operationalCost, currency, locale)}
          tone="text-rose-700"
        />
        <ProfitabilityMetric
          label={label(fr, "Operating result", "Résultat opérationnel")}
          value={money(profit, currency, locale)}
          tone={profit < 0 ? "text-critical" : "text-brand"}
        />
        <ProfitabilityMetric
          label={label(fr, "Cash received", "Encaissements reçus")}
          value={money(data.cashReceived, currency, locale)}
          tone="text-ink"
        />
      </div>
      <div className="mt-4 rounded-xl border border-sky-500/25 bg-sky-500/[.06] px-4 py-3 text-sm leading-5 text-ink-secondary">
        <span className="font-semibold text-ink">
          {label(
            fr,
            "Revenue is not cash.",
            "La recette n’est pas l’encaissement.",
          )}
        </span>{" "}
        {label(
          fr,
          "A confirmed delivery increases revenue and customer balance. Only a customer payment increases cash received.",
          "Une livraison confirmée augmente la recette et le solde client. Seul un paiement client augmente l’encaissement.",
        )}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <EggVolumeCard
          label={label(fr, "Total œufs produits", "Total eggs produced")}
          value={number(data.eggsProduced).toLocaleString(locale)}
          tone="sky"
        />
        <EggVolumeCard
          label={label(fr, "Œufs vendus", "Eggs sold")}
          value={number(data.eggsSold).toLocaleString(locale)}
          tone="emerald"
        />
        <EggVolumeCard
          label={label(fr, "Œufs restants", "Eggs remaining")}
          value={eggsRemaining.toLocaleString(locale)}
          tone="amber"
        />
      </div>
      <div className="mt-3 grid gap-3 rounded-xl border border-border bg-surface-2/45 p-4 sm:grid-cols-3">
        <Info
          label={label(fr, "Linked flocks", "Lots liés")}
          value={String(data.linkedFlockCount)}
        />
        <Info
          label={label(fr, "Birds sold", "Birds sold")}
          value={number(data.birdsSold).toLocaleString(locale)}
        />
        <Info
          label={label(fr, "Margin", "Marge")}
          value={`${margin.toFixed(1)}%`}
        />
      </div>
      <div className="mt-4 grid gap-3 text-sm text-ink-secondary sm:grid-cols-4">
        <p>
          {label(fr, "Customer balance", "Solde client")} ·{" "}
          <span className="font-semibold text-ink">
            {money(data.outstandingRevenue, currency, locale)}
          </span>
        </p>
        <p>
          {label(fr, "Cost per egg produced", "Coût par œuf produit")} ·{" "}
          <span className="font-semibold text-ink">
            {number(data.eggsProduced) > 0
              ? money(data.costPerEggProduced, currency, locale)
              : "—"}
          </span>
        </p>
        <p>
          {label(fr, "Cost per bird sold", "Coût par poulet vendu")} ·{" "}
          <span className="font-semibold text-ink">
            {number(data.birdsSold) > 0
              ? money(data.costPerBirdSold ?? 0, currency, locale)
              : "—"}
          </span>
        </p>
        <p>
          {label(fr, "Declared flock purchase", "Achat déclaré des lots")} ·{" "}
          <span className="font-semibold text-ink">
            {money(data.declaredFlockPurchaseCost, currency, locale)}
          </span>
        </p>
      </div>
      <section className="mt-5 rounded-xl border border-border bg-surface-2/35 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">
              {label(fr, "Actual costs by type", "Coûts réels par type")}
            </h3>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              {label(
                fr,
                "Feed is costed on issue to the flock. Direct production expenses and eligible service receipts are allocated by the starting number of birds.",
                "L’aliment est valorisé lors de sa distribution au lot. Les dépenses directes et services admissibles sont répartis selon l’effectif de départ.",
              )}
            </p>
          </div>
          <span className="text-sm font-semibold tabular-nums text-ink">
            {money(data.operationalCost, currency, locale)}
          </span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {costItems.map(([key, itemLabel]) => (
            <ProductionCostItem
              key={key}
              label={itemLabel}
              value={money(costs[key] ?? 0, currency, locale)}
            />
          ))}
        </div>
      </section>
      {flocks.length ? (
        <section className="mt-5 rounded-xl border border-border bg-surface-2/35 p-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">
              {label(fr, "Result by flock", "Résultat par lot")}
            </h3>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              {label(
                fr,
                "See the true cost, delivery revenue and cash position of each flock linked to this project.",
                "Consultez le coût réel, les recettes livrées et la trésorerie de chaque lot lié à ce projet.",
              )}
            </p>
          </div>
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            {flocks.map((flock) => {
              const flockProfit = number(flock.profit);
              const flockCosts = flock.costBreakdown ?? {};
              return (
                <article
                  key={String(flock.id)}
                  className="rounded-xl border border-border bg-surface p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="font-semibold text-ink">
                        {String(
                          flock.name || flock.code || label(fr, "Flock", "Lot"),
                        )}
                      </h4>
                      {flock.code && flock.name ? (
                        <p className="mt-0.5 text-xs text-ink-muted">
                          {String(flock.code)}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${flockProfit < 0 ? "bg-critical/10 text-critical" : "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"}`}
                    >
                      {money(flockProfit, currency, locale)}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Info
                      label={label(fr, "Real cost", "Coût réel")}
                      value={money(
                        flock.operationalCost ?? 0,
                        currency,
                        locale,
                      )}
                    />
                    <Info
                      label={label(fr, "Delivery revenue", "Recettes livrées")}
                      value={money(flock.revenue ?? 0, currency, locale)}
                    />
                    <Info
                      label={label(fr, "Cash received", "Encaissements")}
                      value={money(flock.cashReceived ?? 0, currency, locale)}
                    />
                    <Info
                      label={label(fr, "Customer balance", "Solde client")}
                      value={money(
                        flock.outstandingRevenue ?? 0,
                        currency,
                        locale,
                      )}
                    />
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-ink-secondary sm:grid-cols-3">
                    <span>
                      {label(fr, "Eggs", "Œufs")} ·{" "}
                      <strong className="text-ink">
                        {number(flock.eggsProduced).toLocaleString(locale)} /{" "}
                        {number(flock.eggsSold).toLocaleString(locale)}
                      </strong>
                    </span>
                    <span>
                      {label(fr, "Cost / egg", "Coût / œuf")} ·{" "}
                      <strong className="text-ink">
                        {number(flock.eggsProduced) > 0
                          ? money(
                              flock.costPerEggProduced ?? 0,
                              currency,
                              locale,
                            )
                          : "—"}
                      </strong>
                    </span>
                    <span>
                      {label(fr, "Cost / bird", "Coût / poulet")} ·{" "}
                      <strong className="text-ink">
                        {number(flock.birdsSold) > 0
                          ? money(flock.costPerBirdSold ?? 0, currency, locale)
                          : "—"}
                      </strong>
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted">
                    {costItems
                      .filter(([key]) => number(flockCosts[key]) > 0)
                      .map(([key, itemLabel]) => (
                        <span key={key}>
                          {itemLabel} ·{" "}
                          {money(flockCosts[key] ?? 0, currency, locale)}
                        </span>
                      ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
      {noRecordedCost ? (
        <p className="mt-4 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-sm leading-5 text-ink-secondary">
          {label(
            fr,
            "No real production cost is recorded yet. Add the animal purchase to the flock, issue feed from stock, or approve a direct expense for health, labour, transport, water or electricity.",
            "Aucun coût réel de production n’est encore enregistré. Ajoutez l’achat des animaux au lot, distribuez l’aliment depuis le stock ou approuvez une dépense directe de santé, main-d’œuvre, transport, eau ou électricité.",
          )}
        </p>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-ink-muted">
        {label(
          fr,
          "A supplier payment settles a debt only. It never adds a second cost after the received item or direct expense has already been counted.",
          "Un paiement fournisseur règle seulement une dette. Il n’ajoute jamais un deuxième coût après la réception ou la dépense directe déjà comptée.",
        )}
      </p>
    </Panel>
  );
}

function ProductionCostItem({
  label: text,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[11px] font-medium text-ink-muted">{text}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}

function ProjectDecisionSimulationDialog({
  orgSlug,
  project,
  fr,
  locale,
  onClose,
}: {
  orgSlug: string;
  project: Project;
  fr: boolean;
  locale: string;
  onClose: () => void;
}) {
  const emptyScenario = {
    eggPriceChangePercent: 0,
    feedCostChangePercent: 0,
    mortalityPercent: 0,
    saleDelayDays: 0,
    budgetChangePercent: 0,
  };
  const [scenario, setScenario] = useState(emptyScenario);
  const simulate = useMutation({
    mutationFn: () =>
      ownerManagementApi.projectDecisionSimulation<{
        simulation: ProjectDecisionSimulation;
      }>(orgSlug, project.id, scenario),
  });
  const result = simulate.data?.simulation;
  const currency = result?.currencyCode ?? project.currencyCode ?? "CDF";
  const updateScenario = (key: keyof typeof emptyScenario, raw: string) => {
    const parsed = Number(raw);
    setScenario((current) => ({
      ...current,
      [key]: Number.isFinite(parsed) ? parsed : 0,
    }));
  };
  const signedMoney = (value: unknown) => {
    const amountValue = number(value);
    const sign = amountValue > 0 ? "+" : amountValue < 0 ? "−" : "";
    return `${sign}${money(Math.abs(amountValue), currency, locale)}`;
  };
  const percentValue = (value: number | null | undefined) =>
    value == null ? "—" : `${value.toFixed(1)}%`;

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-ink/55 p-4 backdrop-blur-sm">
      <div className="mx-auto my-6 max-w-5xl rounded-2xl border border-border bg-surface-1 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border p-5 sm:p-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-brand">
              <Calculator className="size-5" />
              <p className="text-xs font-semibold uppercase tracking-[.13em]">
                {label(
                  fr,
                  "Owner decision tool",
                  "Outil de décision propriétaire",
                )}
              </p>
            </div>
            <h2 className="mt-2 text-xl font-semibold text-ink sm:text-2xl">
              {label(fr, "Before you commit", "Simulation avant décision")}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
              {label(
                fr,
                "Test a price, feed, mortality, timing or budget change before it becomes a real purchase or expense.",
                "Testez un changement de prix, d’aliment, de mortalité, de délai ou de budget avant qu’il ne devienne un achat ou une dépense réelle.",
              )}
            </p>
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
          className="grid gap-5 p-5 sm:p-6 xl:grid-cols-[minmax(0,.78fr)_minmax(0,1.22fr)]"
          onSubmit={(event) => {
            event.preventDefault();
            simulate.mutate();
          }}
        >
          <section className="space-y-4">
            <div className="rounded-2xl border border-brand/25 bg-brand-subtle/35 p-4">
              <h3 className="text-sm font-semibold text-ink">
                {label(fr, "Scenario assumptions", "Hypothèses du scénario")}
              </h3>
              <p className="mt-1 text-xs leading-5 text-ink-secondary">
                {label(
                  fr,
                  "Leave a field at 0 when it should stay unchanged. The assumptions are never saved to the project.",
                  "Laissez un champ à 0 lorsqu’il ne doit pas changer. Les hypothèses ne sont jamais enregistrées dans le projet.",
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  [
                    "eggPriceChangePercent",
                    -20,
                    "Egg price −20%",
                    "Prix de l’œuf −20 %",
                  ],
                  ["feedCostChangePercent", 15, "Feed +15%", "Aliment +15 %"],
                  ["mortalityPercent", 5, "Mortality 5%", "Mortalité 5 %"],
                  [
                    "saleDelayDays",
                    30,
                    "Sale delayed 30 days",
                    "Vente retardée de 30 j",
                  ],
                  ["budgetChangePercent", 10, "Budget +10%", "Budget +10 %"],
                ].map(([key, value, english, french]) => (
                  <button
                    key={String(key)}
                    type="button"
                    onClick={() =>
                      setScenario((current) => ({
                        ...current,
                        [key as keyof typeof emptyScenario]: Number(value),
                      }))
                    }
                    className="rounded-full border border-brand/25 bg-surface-1 px-3 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand hover:text-white"
                  >
                    {label(fr, String(english), String(french))}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={label(
                  fr,
                  "Egg price change (%)",
                  "Variation du prix de l’œuf (%)",
                )}
                htmlFor="simulationEggPrice"
              >
                <Input
                  id="simulationEggPrice"
                  type="number"
                  step="0.1"
                  value={scenario.eggPriceChangePercent}
                  onChange={(event) =>
                    updateScenario("eggPriceChangePercent", event.target.value)
                  }
                />
              </Field>
              <Field
                label={label(
                  fr,
                  "Feed cost change (%)",
                  "Variation du coût d’aliment (%)",
                )}
                htmlFor="simulationFeedCost"
              >
                <Input
                  id="simulationFeedCost"
                  type="number"
                  step="0.1"
                  value={scenario.feedCostChangePercent}
                  onChange={(event) =>
                    updateScenario("feedCostChangePercent", event.target.value)
                  }
                />
              </Field>
              <Field
                label={label(
                  fr,
                  "Mortality in scenario (%)",
                  "Mortalité dans le scénario (%)",
                )}
                htmlFor="simulationMortality"
              >
                <Input
                  id="simulationMortality"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={scenario.mortalityPercent}
                  onChange={(event) =>
                    updateScenario("mortalityPercent", event.target.value)
                  }
                />
              </Field>
              <Field
                label={label(
                  fr,
                  "Sales delay (days)",
                  "Retard de vente (jours)",
                )}
                htmlFor="simulationDelay"
              >
                <Input
                  id="simulationDelay"
                  type="number"
                  min="0"
                  step="1"
                  value={scenario.saleDelayDays}
                  onChange={(event) =>
                    updateScenario("saleDelayDays", event.target.value)
                  }
                />
              </Field>
              <Field
                label={label(
                  fr,
                  "Budget change (%)",
                  "Variation du budget (%)",
                )}
                htmlFor="simulationBudget"
                className="sm:col-span-2"
              >
                <Input
                  id="simulationBudget"
                  type="number"
                  step="0.1"
                  value={scenario.budgetChangePercent}
                  onChange={(event) =>
                    updateScenario("budgetChangePercent", event.target.value)
                  }
                />
              </Field>
            </div>
            {simulate.error ? (
              <p className="rounded-xl border border-critical/35 bg-critical/10 px-3 py-2 text-sm text-critical">
                {simulate.error instanceof ApiError
                  ? simulate.error.message
                  : label(
                      fr,
                      "The simulation could not be calculated.",
                      "La simulation n’a pas pu être calculée.",
                    )}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={simulate.isPending}>
                <Calculator />
                {simulate.isPending
                  ? label(fr, "Calculating…", "Calcul…")
                  : label(fr, "Run simulation", "Simuler")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setScenario(emptyScenario)}
              >
                {label(fr, "Reset", "Réinitialiser")}
              </Button>
            </div>
          </section>

          <section className="min-w-0 rounded-2xl border border-border bg-surface-2/45 p-4 sm:p-5">
            {result ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-ink">
                      {label(
                        fr,
                        "Projected decision impact",
                        "Impact projeté de la décision",
                      )}
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-ink-secondary">
                      {label(
                        fr,
                        "Compared with the recorded project position.",
                        "Comparé à la position réelle actuellement enregistrée.",
                      )}
                    </p>
                  </div>
                  <Badge
                    variant={
                      number(result.scenario.operatingResult) < 0
                        ? "critical"
                        : "good"
                    }
                  >
                    {number(result.scenario.operatingResult) < 0
                      ? label(fr, "Loss scenario", "Scénario déficitaire")
                      : label(fr, "Viable scenario", "Scénario viable")}
                  </Badge>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <SimulationMetric
                    label={label(fr, "ROI", "ROI")}
                    value={percentValue(result.scenario.roiPercent)}
                    tone={
                      number(result.scenario.roiPercent) < 0
                        ? "critical"
                        : "good"
                    }
                  />
                  <SimulationMetric
                    label={label(fr, "Payback", "Retour sur investissement")}
                    value={
                      result.scenario.paybackDays == null
                        ? "—"
                        : `${result.scenario.paybackDays.toLocaleString(locale)} ${label(fr, "days", "jours")}`
                    }
                    tone="brand"
                  />
                  <SimulationMetric
                    label={label(
                      fr,
                      "Break-even revenue",
                      "Seuil de rentabilité",
                    )}
                    value={money(
                      result.scenario.breakEvenRevenue,
                      currency,
                      locale,
                    )}
                    tone="ink"
                  />
                  <SimulationMetric
                    label={label(fr, "Projected revenue", "Recettes projetées")}
                    value={money(result.scenario.revenue, currency, locale)}
                    tone="good"
                  />
                  <SimulationMetric
                    label={label(fr, "Projected costs", "Coûts projetés")}
                    value={money(
                      result.scenario.operationalCost,
                      currency,
                      locale,
                    )}
                    tone="critical"
                  />
                  <SimulationMetric
                    label={label(
                      fr,
                      "Operating result",
                      "Résultat opérationnel",
                    )}
                    value={money(
                      result.scenario.operatingResult,
                      currency,
                      locale,
                    )}
                    tone={
                      number(result.scenario.operatingResult) < 0
                        ? "critical"
                        : "brand"
                    }
                  />
                </div>
                <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  <SimulationImpact
                    label={label(
                      fr,
                      "Egg-price impact",
                      "Impact du prix de l’œuf",
                    )}
                    value={signedMoney(result.impacts.eggPriceRevenueChange)}
                  />
                  <SimulationImpact
                    label={label(
                      fr,
                      "Feed-cost impact",
                      "Impact du coût d’aliment",
                    )}
                    value={signedMoney(result.impacts.feedCostChange)}
                  />
                  <SimulationImpact
                    label={label(
                      fr,
                      "Mortality revenue loss",
                      "Perte de recette liée à la mortalité",
                    )}
                    value={`−${money(result.impacts.mortalityRevenueLoss, currency, locale)}`}
                  />
                  <SimulationImpact
                    label={label(
                      fr,
                      "Investment after budget change",
                      "Investissement après variation du budget",
                    )}
                    value={money(result.scenario.investment, currency, locale)}
                  />
                  <SimulationImpact
                    label={label(fr, "Cash delayed", "Encaissement retardé")}
                    value={
                      result.scenario.cashArrivalDelayDays
                        ? `${result.scenario.cashArrivalDelayDays} ${label(fr, "days", "jours")}`
                        : label(fr, "No delay", "Aucun retard")
                    }
                  />
                  <SimulationImpact
                    label={label(
                      fr,
                      "Break-even price / egg",
                      "Prix d’équilibre / œuf",
                    )}
                    value={
                      result.scenario.breakEvenPricePerEgg == null
                        ? "—"
                        : money(
                            result.scenario.breakEvenPricePerEgg,
                            currency,
                            locale,
                          )
                    }
                  />
                </div>
                <p className="mt-4 rounded-xl border border-brand/20 bg-brand-subtle/35 px-3 py-2 text-xs leading-5 text-ink-secondary">
                  {fr
                    ? "Méthode : les recettes d’œufs enregistrées subissent le changement de prix ; la mortalité réduit la production vendable projetée ; seul le coût d’aliment varie avec son hypothèse. Le délai de vente prolonge le retour sur investissement, sans modifier la marge elle-même."
                    : "Method: recorded egg revenue receives the price change; mortality reduces projected saleable production; only recorded feed cost receives the feed assumption. A sales delay extends payback without changing the operating margin itself."}
                </p>
                <p className="mt-2 text-xs leading-5 text-ink-muted">
                  {label(
                    fr,
                    "Observed period used for the return estimate",
                    "Période observée utilisée pour l’estimation du retour",
                  )}{" "}
                  · {result.method.observedDays} {label(fr, "days", "jours")}.{" "}
                  {label(
                    fr,
                    "Nothing has been saved or changed.",
                    "Aucune donnée n’a été enregistrée ni modifiée.",
                  )}
                </p>
              </>
            ) : (
              <div className="flex min-h-80 flex-col items-center justify-center px-6 text-center">
                <Calculator className="size-9 text-brand" />
                <h3 className="mt-4 text-base font-semibold text-ink">
                  {label(
                    fr,
                    "Ready for a safe projection",
                    "Prêt pour une projection sans risque",
                  )}
                </h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-ink-secondary">
                  {label(
                    fr,
                    "Set one or more assumptions, then run the simulation. Current project records remain unchanged.",
                    "Définissez une ou plusieurs hypothèses, puis lancez la simulation. Les données actuelles du projet restent inchangées.",
                  )}
                </p>
              </div>
            )}
          </section>
        </form>
      </div>
    </div>
  );
}

function SimulationMetric({
  label: text,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "critical" | "brand" | "ink";
}) {
  const tones = {
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
    critical: "border-critical/30 bg-critical/10 text-critical",
    brand: "border-brand/25 bg-brand-subtle text-brand",
    ink: "border-border bg-surface-1 text-ink",
  }[tone];
  return (
    <div className={`rounded-xl border p-3 ${tones}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[.1em] opacity-80">
        {text}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function SimulationImpact({
  label: text,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-1 px-3 py-2">
      <p className="text-[11px] text-ink-muted">{text}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}

function EggVolumeCard({
  label: text,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "sky" | "emerald" | "amber";
}) {
  const styles = {
    sky: "border-sky-500/30 bg-sky-500/10 text-sky-950 dark:text-sky-50",
    emerald:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-50",
    amber:
      "border-amber-500/35 bg-amber-500/10 text-amber-950 dark:text-amber-50",
  }[tone];
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${styles}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[.1em] opacity-80">
        {text}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function ProfitabilityMetric({
  label: text,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/55 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[.1em] text-ink-muted">
        {text}
      </p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>
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
  hint,
}: {
  label: string;
  value: string;
  icon: typeof Wallet;
  inverse?: boolean;
  hint?: ReactNode;
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
      {hint ? (
        <p
          className={`mt-2 border-t pt-2 text-[10px] leading-4 ${inverse ? "border-white/10 text-sky-50/80" : "border-border text-ink-secondary"}`}
        >
          {hint}
        </p>
      ) : null}
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
  onToggleLock,
  onPreview,
}: {
  orgSlug: string;
  documents: Row[];
  categories: DocumentCategory[];
  fr: boolean;
  locale: string;
  onConfigure?: (document: Row) => void;
  onManage?: () => void;
  onToggleLock?: (
    categoryId: string,
    visibility: "company" | "owner_only",
  ) => void;
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
  const folderPageSize = 4;
  const [folderPage, setFolderPage] = useState(0);
  const folderTotalPages = Math.max(
    1,
    Math.ceil(sorted.length / folderPageSize),
  );
  const currentFolderPage = Math.min(folderPage, folderTotalPages - 1);
  const firstFolder = sorted.length
    ? currentFolderPage * folderPageSize + 1
    : 0;
  const lastFolder = Math.min(
    (currentFolderPage + 1) * folderPageSize,
    sorted.length,
  );
  const visibleFolders = sorted.slice(
    currentFolderPage * folderPageSize,
    (currentFolderPage + 1) * folderPageSize,
  );
  const recentDocuments = [...documents]
    .sort(
      (left, right) =>
        new Date(String(right.createdAt ?? 0)).getTime() -
        new Date(String(left.createdAt ?? 0)).getTime(),
    )
    .slice(0, 6);
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
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={onManage}>
              <Plus />
              {label(fr, "Add folder", "Ajouter un dossier")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onManage}
            >
              <Settings2 />
              {label(fr, "Manage folders", "Gérer les dossiers")}
            </Button>
          </div>
        ) : undefined
      }
    >
      {recentDocuments.length ? (
        <section className="mb-5 overflow-hidden rounded-xl border border-brand/25 bg-brand-subtle/35">
          <header className="flex items-center justify-between gap-3 border-b border-brand/15 bg-surface-1/75 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                {label(fr, "Recent documents", "Documents récents")}
              </p>
              <p className="mt-0.5 text-xs text-ink-secondary">
                {label(
                  fr,
                  "Your latest files remain available here, even when their folder is on another page.",
                  "Vos derniers fichiers restent visibles ici, même si leur dossier est sur une autre page.",
                )}
              </p>
            </div>
            <Badge variant="neutral">{recentDocuments.length}</Badge>
          </header>
          <ul className="divide-y divide-brand/15">
            {recentDocuments.map((document) => (
              <li
                key={document.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {String(
                      document.title ??
                        label(fr, "Untitled document", "Document sans titre"),
                    )}
                  </p>
                  <p className="mt-1 truncate text-xs text-ink-secondary">
                    {String(
                      document.documentCategoryName ??
                        document.documentType ??
                        label(fr, "Other", "Autre"),
                    )}
                    {" · "}
                    {String(document.mimeType ?? "—")}
                    {" · "}
                    {label(fr, "Added", "Ajouté le")}{" "}
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
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {sorted.length ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {visibleFolders.map((folder) => {
              const isOpen = openFolder === folder.key;
              return (
                <article
                  key={folder.key}
                  className="overflow-hidden rounded-xl border border-border bg-surface-2"
                >
                  <div className="flex items-stretch bg-surface-1">
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
                        <Badge variant="neutral">
                          {titleCase(folder.code)}
                        </Badge>
                        <span className="text-xs font-semibold text-brand">
                          {isOpen
                            ? label(fr, "Close", "Fermer")
                            : label(fr, "Open", "Ouvrir")}
                        </span>
                      </span>
                    </button>
                    {onToggleLock && folder.configured ? (
                      <button
                        type="button"
                        onClick={() =>
                          onToggleLock(
                            folder.key,
                            folder.visibility === "owner_only"
                              ? "company"
                              : "owner_only",
                          )
                        }
                        className={`m-2 grid size-9 shrink-0 place-items-center rounded-lg border transition ${
                          folder.visibility === "owner_only"
                            ? "border-amber-400/60 bg-amber-50 text-amber-800 hover:bg-amber-100"
                            : "border-border bg-surface-2 text-ink-secondary hover:border-amber-400 hover:text-amber-800"
                        }`}
                        title={
                          folder.visibility === "owner_only"
                            ? label(
                                fr,
                                "Unlock folder",
                                "Déverrouiller le dossier",
                              )
                            : label(fr, "Lock folder", "Verrouiller le dossier")
                        }
                        aria-label={
                          folder.visibility === "owner_only"
                            ? label(
                                fr,
                                "Unlock folder",
                                "Déverrouiller le dossier",
                              )
                            : label(fr, "Lock folder", "Verrouiller le dossier")
                        }
                      >
                        {folder.visibility === "owner_only" ? (
                          <Unlock className="size-4" />
                        ) : (
                          <Lock className="size-4" />
                        )}
                      </button>
                    ) : null}
                  </div>
                  {isOpen ? (
                    folder.documents.length ? (
                      <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto border-t border-border">
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
                              <p className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs leading-5 text-ink-secondary">
                                {String(document.mimeType ?? "—")} ·{" "}
                                {fileSize(document.fileSizeBytes)} ·{" "}
                                {label(fr, "Added", "Ajouté le")}{" "}
                                {date(document.createdAt, locale)}
                              </p>
                              {document.taskUsageSummary ? (
                                <p className="mt-1 truncate text-xs font-medium text-ink-secondary">
                                  {label(fr, "Task", "Tâche")} :{" "}
                                  {String(document.taskUsageSummary)}
                                </p>
                              ) : null}
                              {document.taskAssigneeSummary ||
                              document.uploadedByName ? (
                                <p className="mt-1 truncate text-xs font-medium text-ink-secondary">
                                  {document.taskAssigneeSummary
                                    ? `${label(fr, "Assigned to", "Affectée à")} ${String(document.taskAssigneeSummary)}`
                                    : ""}
                                  {document.taskAssigneeSummary &&
                                  document.uploadedByName
                                    ? " · "
                                    : ""}
                                  {document.uploadedByName
                                    ? `${label(fr, "Added by", "Ajoutée par")} ${String(document.uploadedByName)}`
                                    : ""}
                                </p>
                              ) : null}
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
                                aria-label={label(
                                  fr,
                                  "Download",
                                  "Télécharger",
                                )}
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
          {sorted.length > folderPageSize ? (
            <nav
              className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4"
              aria-label={label(
                fr,
                "Folder pagination",
                "Pagination des dossiers",
              )}
            >
              <p className="text-xs text-ink-secondary">
                {label(fr, "Showing", "Affichage")} {firstFolder}–{lastFolder}{" "}
                {label(fr, "of", "sur")} {sorted.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={currentFolderPage === 0}
                  onClick={() =>
                    setFolderPage((value) => Math.max(0, value - 1))
                  }
                >
                  {label(fr, "Previous", "Précédent")}
                </Button>
                <span className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-ink-secondary">
                  {currentFolderPage + 1}/{folderTotalPages}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={currentFolderPage >= folderTotalPages - 1}
                  onClick={() =>
                    setFolderPage((value) =>
                      Math.min(folderTotalPages - 1, value + 1),
                    )
                  }
                >
                  {label(fr, "Next", "Suivant")}
                </Button>
              </div>
            </nav>
          ) : null}
        </>
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
        <div className="grid max-h-[36rem] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-4">
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
  budgetChanges,
  fr,
  locale,
  onClose,
  onEdit,
  onPreview,
}: {
  orgSlug: string;
  task: Row;
  budgetChanges: Row[];
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
  const taskBudgetHistory = budgetChanges.flatMap((event) => {
    if (String(event.entityId ?? "") !== String(task.id ?? "")) return [];
    try {
      const parsed = JSON.parse(String(event.status ?? "")) as Record<
        string,
        unknown
      >;
      const before = Number(parsed.before ?? 0);
      const after = Number(parsed.after ?? 0);
      if (
        String(parsed.scope) !== "task" ||
        !Number.isFinite(before) ||
        !Number.isFinite(after)
      )
        return [];
      return [
        {
          id: String(event.id ?? `${event.entityId}-${event.occurredAt}`),
          before,
          after,
          difference: Number(parsed.difference ?? after - before),
          currencyCode: String(
            parsed.currencyCode ??
              task.budgetCurrencyCode ??
              task.currencyCode ??
              "CDF",
          ),
          actorName: String(event.actorName ?? "").trim(),
          occurredAt: event.occurredAt,
          justification: String(parsed.justification ?? "").trim(),
        },
      ];
    } catch {
      return [];
    }
  });
  const existingBudget = Number(detail(["estimatedCost"]) ?? 0);
  const hasLegacyBudget =
    taskBudgetHistory.length === 0 &&
    Number.isFinite(existingBudget) &&
    existingBudget > 0;
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
          {hasLegacyBudget ? (
            <section className="mt-5 rounded-xl border border-border bg-surface-2 p-4">
              <h3 className="text-sm font-semibold text-ink">
                {label(fr, "Budget record", "Repère budgétaire")}
              </h3>
              <p className="mt-2 text-lg font-semibold text-ink">
                {money(
                  existingBudget,
                  String(task.budgetCurrencyCode ?? task.currencyCode ?? "CDF"),
                  locale,
                )}
              </p>
              <p className="mt-1 text-sm leading-6 text-ink-secondary">
                {label(
                  fr,
                  "This budget existed before detailed history was enabled. Future changes are recorded here with their date and author.",
                  "Ce budget existait avant l’activation de l’historique détaillé. Les prochaines modifications seront enregistrées ici avec leur date et leur auteur.",
                )}
              </p>
            </section>
          ) : null}
          {taskBudgetHistory.length ? (
            <section className="mt-5 overflow-hidden rounded-xl border border-brand/25 bg-brand-subtle/25">
              <header className="flex items-center justify-between gap-3 border-b border-brand/15 bg-surface-1/75 px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold text-ink">
                    {label(fr, "Budget history", "Historique du budget")}
                  </h3>
                  <p className="mt-0.5 text-xs text-ink-secondary">
                    {label(
                      fr,
                      "Every initial amount and later change is retained.",
                      "Le montant initial et chaque modification sont conservés.",
                    )}
                  </p>
                </div>
                <Badge variant="neutral">{taskBudgetHistory.length}</Badge>
              </header>
              <ol className="divide-y divide-brand/15 bg-surface-1">
                {taskBudgetHistory.map((change) => (
                  <li
                    key={change.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-ink">
                        {money(change.before, change.currencyCode, locale)} →{" "}
                        {money(change.after, change.currencyCode, locale)}
                      </p>
                      <p className="mt-1 text-xs text-ink-secondary">
                        {date(change.occurredAt, locale)}
                        {change.actorName
                          ? ` · ${label(fr, "by", "par")} ${change.actorName}`
                          : ""}
                        {change.justification
                          ? ` · ${change.justification}`
                          : ""}
                      </p>
                    </div>
                    <Badge
                      variant={
                        change.difference > 0
                          ? "warning"
                          : change.difference < 0
                            ? "good"
                            : "neutral"
                      }
                    >
                      {change.difference > 0 ? "+" : ""}
                      {money(change.difference, change.currencyCode, locale)}
                    </Badge>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
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
