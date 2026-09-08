"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  Bird,
  Check,
  ChevronRight,
  ClipboardCheck,
  Download,
  Droplets,
  Egg,
  MapPin,
  Feather,
  HeartPulse,
  Pencil,
  Plus,
  Scale,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  ThermometerSun,
  Wheat,
  X,
} from "lucide-react";
import { Badge, severityVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError, get, orgApiUrl, orgUrl } from "@/lib/api";
import { poultryApi } from "@/lib/poultry-api";
import { can } from "@/lib/permissions";
import { formatBusinessDay, formatPercent, formatQuantity } from "@/lib/utils";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";
import { PoultrySetupView } from "./poultry-setup-view";
import { PoultryRecordCentre } from "./poultry-record-centre";
import { PoultryWorkPlanner } from "./poultry-work-planner";

const RESOURCES = [
  "houses",
  "flocks",
  "daily-records",
  "mortality",
  "feed",
  "water",
  "weights",
  "eggs",
  "health",
  "vaccinations",
  "treatments",
  "sanitation",
  "biosecurity",
  "production-targets",
  "losses",
] as const;
type Resource = (typeof RESOURCES)[number];
type Tab =
  "overview" | "production" | "health" | "records" | "performance" | "setup";
type Place = { id: string; name?: string | null; code?: string | null };
type Province = { id: string; code: string; name: string; isActive?: boolean };
type Employee = {
  id: string;
  employeeNumber: string;
  fullName: string;
  province?: Place | null;
  employment: { status: string };
  member?: { memberId: string; fullName?: string | null } | null;
};
type ProductionType = "" | "broiler" | "layer" | "breeder";
type Row = {
  id: string;
  recordDate?: string | null;
  mortalityDate?: string | null;
  feedDate?: string | null;
  waterDate?: string | null;
  vaccinationDate?: string | null;
  treatmentDate?: string | null;
  sanitationDate?: string | null;
  lossDate?: string | null;
  flock?: Place | null;
  house?: Place | null;
  [key: string]: unknown;
};
type Flock = Row & {
  code: string;
  name: string;
  status: string;
  productionType?: string | null;
  birdType?: string | null;
  initialBirdCount?: number | null;
  currentBirdCount?: number | null;
  expectedLiveBirdCount?: number | null;
  physicalLiveBirdCount?: number | null;
  liveBirdDiscrepancy?: number | null;
  totalMortality?: number | null;
  breed?: string | null;
  sourceName?: string | null;
  chickSource?: string | null;
  sex?: string | null;
  hatchDate?: string | null;
  arrivalDate?: string | null;
  startingAgeDays?: number | null;
  expectedProductionEndDate?: string | null;
  performanceModelId?: string | null;
  mortalityReviewThreshold?: number | null;
  notes?: string | null;
  house?: Place | null;
  site?: Place | null;
  province?: Place | null;
};
type House = Row & {
  code: string;
  name: string;
  houseType?: string | null;
  capacity?: number | null;
  site?: Place | null;
};
type Model = {
  id: string;
  code: string;
  name: string;
  productionType: string;
  strain?: string | null;
  version: number;
  isActive: boolean;
  climateProfile?: { name: string } | null;
};
type Target = {
  id: string;
  weekNumber: number;
  targetWeightG?: number | null;
  feedGPerBirdPerDay?: number | null;
  targetEggLayPercent?: number | null;
  expectedCumulativeMortalityPercent?: number | null;
  tolerancePercent: number;
};
type Compare = {
  actual: number | null;
  target: number | null;
  variancePercent: number | null;
  status:
    | "on_target"
    | "below_target"
    | "above_target"
    | "missing_data"
    | "not_configured";
};
type Performance = {
  age: { ageDays: number; ageWeek: number };
  flock: {
    id: string;
    code: string;
    name: string;
    productionType?: string | null;
    liveBirdCount: number;
    expectedLiveBirdCount?: number;
    physicalLiveBirdCount?: number | null;
    liveBirdDiscrepancy?: number | null;
    house?: Place;
    site?: Place;
  };
  model: { name: string; climateProfile?: { name: string } | null } | null;
  weeklyTarget: { weekNumber: number } | null;
  operationalBrief?: {
    modelAssigned: boolean;
    weeklyTargetConfigured: boolean;
    readiness: "ready" | "needs_setup" | "needs_records" | "attention";
    dataCoverage: {
      available: number;
      required: number;
      percent: number;
      missing: string[];
    };
    recordStatus: Record<string, boolean>;
    physicalCountDiscrepancy?: number | null;
    recentWeightRecordDate?: string | null;
  };
  comparisons: Record<string, Compare>;
  vaccines: Array<{
    id: string;
    vaccineName: string;
    dayAge: number;
    dose?: string | null;
    status: "due" | "completed";
  }>;
  recommendations: Array<{
    severity: "info" | "warning" | "critical";
    category: string;
    message: string;
    action: string;
  }>;
};
type Work = {
  id: string;
  title: string;
  details?: string | null;
  workType?: string;
  source?: string;
  status:
    "planned" | "in_progress" | "completed" | "skipped" | "missed" | "overdue";
  workflowStatus?: string;
  assignedMember?: { id: string; fullName?: string | null } | null;
  completedByMember?: { id: string; fullName?: string | null } | null;
  completedAt?: string | null;
  completionNote?: string | null;
  requiresSupervisorApproval?: boolean;
  approvalStatus?: "pending" | "approved" | "returned" | "not_required";
  review?: {
    memberId: string;
    fullName?: string | null;
    reviewedAt?: string | null;
    notes?: string | null;
  } | null;
};

const permission: Record<Resource, string> = {
  houses: "houses",
  flocks: "flocks",
  "daily-records": "daily_records",
  mortality: "mortality",
  feed: "feed",
  water: "water",
  weights: "weights",
  eggs: "eggs",
  health: "health",
  vaccinations: "vaccinations",
  treatments: "treatments",
  sanitation: "sanitation",
  biosecurity: "biosecurity",
  "production-targets": "production_targets",
  losses: "losses",
};
function day() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}
function older(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}
function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function label(value: string | null | undefined) {
  return value
    ? value
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "—";
}
function words(value: string) {
  return label(value);
}
function itemDate(item: Row) {
  return (
    item.recordDate ??
    item.mortalityDate ??
    item.feedDate ??
    item.waterDate ??
    item.vaccinationDate ??
    item.treatmentDate ??
    item.sanitationDate ??
    item.lossDate ??
    null
  );
}

export function PoultryArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const user = useSessionUser();
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [reportDate, setReportDate] = useState(day);
  const [provinceId, setProvinceId] = useState("");
  const [productionType, setProductionType] = useState<ProductionType>("");
  const [flockId, setFlockId] = useState<string | null>(null);
  const [flockDetailOpen, setFlockDetailOpen] = useState(false);
  const [entry, setEntry] = useState<
    "daily-records" | "feed" | "water" | "weights" | "eggs" | "mortality"
  >("feed");
  const [entryOpen, setEntryOpen] = useState(false);
  const [assignedMemberId, setAssignedMemberId] = useState("");
  const fr = locale === "fr";
  const copy: any = fr
    ? {
        kicker: "Pilotage de production",
        title: "Opérations avicoles",
        desc: "Une console complète pour les lots, bâtiments, équipes et décisions quotidiennes.",
        date: "Date de travail",
        record: "Enregistrer une donnée",
        generate: "Générer les tâches",
        active: "Lots actifs",
        birds: "Oiseaux vivants",
        mortality: "Mortalité",
        eggs: "Œufs produits",
        feed: "Aliment distribué",
        water: "Eau enregistrée",
        overview: "Vue d’ensemble",
        production: "Production",
        health: "Santé & biosécurité",
        performance: "Performance",
        setup: "Configuration",
        flocks: "Lots en production",
        flockSubtitle: "Sélectionnez un lot pour consulter son modèle, ses alertes et le travail à effectuer.",
        house: "Bâtiment",
        site: "Site",
        survival: "Survie",
        openFlock: "Ouvrir la fiche du lot",
        recent: "Enregistrements récents",
        urgent: "À examiner aujourd’hui",
        noRecords: "Aucun enregistrement pour cette période.",
        noUrgent: "Aucun seuil de mortalité n’est dépassé aujourd’hui.",
        signals: "Indicateurs du jour",
        save: "Enregistrer",
        cancel: "Annuler",
        recommendations: "Recommandations",
        work: "Travail du jour",
        complete: "Terminer",
        models: "Modèles de performance",
        targets: "Objectifs hebdomadaires",
        houses: "Bâtiments",
        fr: true,
      }
    : {
        kicker: "Production control",
        title: "Poultry operations",
        desc: "A complete console for flocks, houses, teams and daily operating decisions.",
        date: "Working date",
        record: "Record an entry",
        generate: "Generate work",
        active: "Active flocks",
        birds: "Live birds",
        mortality: "Mortality",
        eggs: "Eggs produced",
        feed: "Feed issued",
        water: "Water recorded",
        overview: "Overview",
        production: "Production",
        health: "Health & biosecurity",
        performance: "Performance",
        setup: "Setup",
        flocks: "Flocks in production",
        flockSubtitle: "Select a flock to review its model, alerts and planned work.",
        house: "House",
        site: "Site",
        survival: "Survival",
        openFlock: "Open flock record",
        recent: "Recent records",
        urgent: "Review today",
        noRecords: "No records for this period.",
        noUrgent: "No mortality threshold has been exceeded today.",
        signals: "Today’s signals",
        save: "Save",
        cancel: "Cancel",
        recommendations: "Recommendations",
        work: "Today’s work",
        complete: "Complete",
        models: "Performance models",
        targets: "Weekly targets",
        houses: "Houses",
        fr: false,
      };
  const read = (resource: Resource) =>
    can(user, "poultry." + permission[resource] + ".read");
  const create = (resource: Resource) =>
    can(user, "poultry." + permission[resource] + ".create");
  const queryString = (resource: Resource) =>
    ["houses", "flocks", "production-targets"].includes(resource)
      ? ""
      : [
            "health",
            "vaccinations",
            "treatments",
            "sanitation",
            "biosecurity",
            "losses",
          ].includes(resource)
        ? "from=" + older(60)
        : "date=" + reportDate;
  const filteredQuery = (resource: Resource) => {
    const params = new URLSearchParams(queryString(resource));
    if (provinceId) params.set("provinceId", provinceId);
    if (productionType) params.set("productionType", productionType);
    return params.toString();
  };
  const queries = useQueries({
    queries: RESOURCES.map((resource) => ({
      queryKey: [
        "poultry",
        orgSlug,
        resource,
        filteredQuery(resource),
        provinceId,
        productionType,
      ],
      queryFn: () =>
        poultryApi.list<{ records: Row[] }>(
          orgSlug,
          resource,
          Object.fromEntries(new URLSearchParams(filteredQuery(resource))),
        ),
      enabled: read(resource),
      select: (data: { records: Row[] }) => data.records,
    })),
  });
  const list = (resource: Resource) =>
    (queries[RESOURCES.indexOf(resource)]?.data as Row[] | undefined) ?? [];
  const notRecorded = fr ? "Non enregistré" : "Not recorded";
  const totalIfRecorded = (
    resource: Resource,
    field: string,
    unit: string | null,
    decimals = 0,
  ) => {
    const items = list(resource);
    return items.length
      ? formatQuantity(
          items.reduce((sum, item) => sum + num(item[field]), 0),
          unit,
          decimals,
        )
      : notRecorded;
  };
  const flocks = list("flocks") as Flock[];
  const overview = useQuery({
    queryKey: [
      "poultry-overview",
      orgSlug,
      reportDate,
      provinceId,
      productionType,
    ],
    queryFn: () =>
      poultryApi.overview<{
        overview: {
          totals: {
            activeFlocks: number;
            mortalityRatePercent: number;
            totalEggs: number;
            feedKg: number;
            waterLiters: number;
          };
          mortalityReview: Array<{
            flock: Place;
            house: Place;
            site: Place;
            dailyMortalityCount: number;
            mortalityReviewThreshold: number;
          }>;
        };
      }>(orgSlug, {
        from: reportDate,
        to: reportDate,
        provinceId,
        productionType,
      }),
    enabled: read("flocks") && read("mortality"),
    select: (data) => data.overview,
  });
  const models = useQuery({
    queryKey: ["poultry-models", orgSlug],
    queryFn: () =>
      poultryApi.performanceModels.list<{ performanceModels: Model[] }>(
        orgSlug,
      ),
    enabled: can(user, "poultry.performance_models.read"),
    select: (data) => data.performanceModels,
  });
  const provinces = useQuery({
    queryKey: ["poultry-provinces", orgSlug],
    queryFn: () => get<{ provinces: Province[] }>(orgUrl(orgSlug, "provinces")),
    enabled: can(user, "sites.read"),
    select: (data) => data.provinces,
  });
  const employees = useQuery({
    queryKey: ["poultry-work-employees", orgSlug],
    queryFn: () => get<{ employees: Employee[] }>(orgUrl(orgSlug, "employees")),
    enabled: can(user, "employees.read"),
    select: (data) => data.employees,
  });
  useEffect(() => {
    if (!flocks.some((flock) => flock.id === flockId))
      setFlockId(flocks[0]?.id ?? null);
  }, [flockId, flocks]);
  const performance = useQuery({
    queryKey: ["poultry-performance", orgSlug, flockId, reportDate],
    queryFn: () =>
      poultryApi.flockPerformance<{ performance: Performance }>(
        orgSlug,
        flockId!,
        { date: reportDate },
      ),
    enabled:
      Boolean(flockId) &&
      flocks.some((flock) => flock.id === flockId) &&
      read("flocks"),
    select: (data) => data.performance,
  });
  const work = useQuery({
    queryKey: ["poultry-work", orgSlug, flockId, reportDate],
    queryFn: () =>
      poultryApi.dailyWork.list<{ dailyWork: Work[] }>(orgSlug, flockId!, {
        date: reportDate,
      }),
    enabled:
      Boolean(flockId) &&
      flocks.some((flock) => flock.id === flockId) &&
      read("daily-records"),
    select: (data) => data.dailyWork,
  });
  const myWork = useQuery({
    queryKey: ["poultry-my-work", orgSlug, reportDate],
    queryFn: () =>
      poultryApi.dailyWork.mine<{ dailyWork: Work[] }>(orgSlug, {
        date: reportDate,
      }),
    enabled: can(user, "poultry.daily_records.read"),
    select: (data) => data.dailyWork,
  });
  const modelsForProduction = useMemo(
    () =>
      (models.data ?? []).filter(
        (model) => !productionType || model.productionType === productionType,
      ),
    [models.data, productionType],
  );
  const selectedModelId = modelsForProduction[0]?.id ?? null;
  const targets = useQuery({
    queryKey: ["poultry-targets", orgSlug, selectedModelId],
    queryFn: () =>
      poultryApi.performanceModels.targets.list<{ weeklyTargets: Target[] }>(
        orgSlug,
        selectedModelId!,
      ),
    enabled:
      Boolean(selectedModelId) && can(user, "poultry.performance_models.read"),
    select: (data) => data.weeklyTargets,
  });
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["poultry"] });
    client.invalidateQueries({ queryKey: ["poultry-overview", orgSlug] });
    client.invalidateQueries({ queryKey: ["poultry-performance", orgSlug] });
    client.invalidateQueries({ queryKey: ["poultry-work", orgSlug] });
    client.invalidateQueries({ queryKey: ["poultry-my-work", orgSlug] });
  };
  const save = useMutation({
    mutationFn: ({
      resource,
      body,
    }: {
      resource: Resource;
      body: Record<string, unknown>;
    }) => poultryApi.create(orgSlug, resource, body),
    onSuccess: () => {
      setEntryOpen(false);
      refresh();
    },
  });
  const generate = useMutation({
    mutationFn: () =>
      poultryApi.dailyWork.generate(orgSlug, flockId!, {
        workDate: reportDate,
        assignedMemberId: assignedMemberId || null,
        requiresSupervisorApproval: true,
      }),
    onSuccess: refresh,
  });
  const beginWork = useMutation({
    mutationFn: (id: string) =>
      poultryApi.dailyWork.update(orgSlug, id, { status: "in_progress" }),
    onSuccess: refresh,
  });
  const finish = useMutation({
    mutationFn: ({
      id,
      completionNote,
    }: {
      id: string;
      completionNote?: string | null;
    }) =>
      poultryApi.dailyWork.update(orgSlug, id, {
        status: "completed",
        completionNote: completionNote?.trim() || null,
      }),
    onSuccess: refresh,
  });
  const approveWork = useMutation({
    mutationFn: (id: string) =>
      poultryApi.dailyWork.review(orgSlug, id, { decision: "approved" }),
    onSuccess: refresh,
  });
  const chosen = flocks.find((flock) => flock.id === flockId) ?? null;
  const eligibleAssignees = (employees.data ?? []).filter(
    (employee) =>
      employee.member?.memberId &&
      employee.employment.status === "active" &&
      (!chosen?.province?.id || employee.province?.id === chosen.province.id),
  );
  const recent = useMemo(
    () =>
      [
        "daily-records",
        "feed",
        "water",
        "weights",
        "eggs",
        "mortality",
      ].flatMap((kind) =>
        list(kind as Resource).map((item) => ({ kind, item })),
      ),
    [reportDate, queries],
  );
  const totalBirds = flocks.reduce(
    (sum, flock) => sum + num(flock.currentBirdCount),
    0,
  );
  const errorItem = [
    save.error,
    generate.error,
    beginWork.error,
    finish.error,
    approveWork.error,
  ].find(Boolean);
  const error =
    errorItem instanceof ApiError
      ? errorItem.message
      : errorItem
        ? "Could not save this change."
        : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const flock = String(form.get("flockId") ?? "");
    const date = String(form.get("date") ?? reportDate);
    const n = (field: string, fallback = 0) => num(form.get(field), fallback);
    const notes = String(form.get("notes") ?? "").trim() || null;
    let body: Record<string, unknown>;
    if (entry === "daily-records")
      body = {
        flockId: flock,
        recordDate: date,
        liveBirdCount: n("liveBirdCount"),
        arrivalsCount: n("arrivalsCount"),
        transfersOutCount: n("transfersOutCount"),
        cullsCount: n("cullsCount"),
        temperatureC:
          String(form.get("temperatureC") ?? "") === ""
            ? null
            : n("temperatureC"),
        humidityPercent:
          String(form.get("humidityPercent") ?? "") === ""
            ? null
            : n("humidityPercent"),
        notes,
      };
    else if (entry === "feed")
      body = {
        flockId: flock,
        feedDate: date,
        feedName: String(form.get("feedName") ?? ""),
        feedStage: String(form.get("feedStage") ?? "other"),
        quantityKg: n("quantityKg"),
        bagCount: n("bagCount"),
        batchNumber: String(form.get("batchNumber") ?? "").trim() || null,
        notes,
      };
    else if (entry === "water")
      body = {
        flockId: flock,
        waterDate: date,
        volumeLiters: n("volumeLiters"),
        sourceName: String(form.get("sourceName") ?? "").trim() || null,
        notes,
      };
    else if (entry === "weights")
      body = {
        flockId: flock,
        recordDate: date,
        sampleSize: n("sampleSize"),
        averageWeightG: n("averageWeightG"),
        uniformityPercent: n("uniformityPercent") || null,
        notes,
      };
    else if (entry === "eggs")
      body = {
        flockId: flock,
        recordDate: date,
        totalEggs: n("totalEggs"),
        crackedEggs: n("crackedEggs"),
        dirtyEggs: n("dirtyEggs"),
        hatchingEggs: n("hatchingEggs"),
        rejectedEggs: n("rejectedEggs"),
        notes,
      };
    else
      body = {
        flockId: flock,
        mortalityDate: date,
        deathCount: n("deathCount"),
        causeCategory: String(form.get("causeCategory") ?? "unknown"),
        suspectedCause: String(form.get("suspectedCause") ?? "").trim() || null,
        postmortemStatus: String(form.get("postmortemStatus") ?? "not_done"),
        disposalMethod: String(form.get("disposalMethod") ?? "other"),
        veterinarianName:
          String(form.get("veterinarianName") ?? "").trim() || null,
        requiresFollowUp: form.get("requiresFollowUp") === "on",
        notes,
      };
    save.mutate({ resource: entry, body });
  }

  if (!read("flocks") && can(user, "poultry.daily_records.read"))
    return (
      <PoultryMyWork
        date={reportDate}
        setDate={setReportDate}
        work={myWork.data ?? []}
        loading={myWork.isPending}
        failed={myWork.isError}
        start={(id) => beginWork.mutate(id)}
        complete={(id, completionNote) => finish.mutate({ id, completionNote })}
        busy={beginWork.isPending || finish.isPending}
        fr={fr}
        error={error}
      />
    );

  return (
    <main className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-6 lg:p-8">
      <section className="relative overflow-hidden rounded-3xl bg-[radial-gradient(circle_at_88%_16%,rgba(134,239,172,.23),transparent_24%),radial-gradient(circle_at_72%_95%,rgba(56,189,248,.23),transparent_33%),linear-gradient(118deg,#082f2c_0%,#0b4c4b_48%,#075985_100%)] px-5 py-7 text-white sm:px-7 sm:py-8">
        <Feather
          className="absolute -right-4 -top-4 size-40 rotate-12 text-white/[.05]"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-emerald-100">
              <span className="size-2 rounded-full bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,.95)]" />
              {copy.kicker}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              {copy.title}
            </h1>
            <p className="mt-3 text-sm leading-6 text-cyan-50/90">
              {copy.desc}
            </p>
          </div>
          <div className="flex w-full max-w-4xl flex-wrap items-end gap-2 rounded-2xl border border-white/15 bg-slate-950/10 p-3 shadow-inner shadow-slate-950/10 backdrop-blur-sm">
            <label className="grid gap-1 text-xs font-medium text-cyan-100">
              <span>{copy.date}</span>
              <Input
                type="date"
                value={reportDate}
                onChange={(event) => setReportDate(event.target.value)}
                className="border-white/20 bg-white/10 text-white [color-scheme:dark]"
              />
            </label>
            {provinces.data?.length ? (
              <label className="grid gap-1 text-xs font-medium text-cyan-100">
                <span>Province</span>
                <select
                  value={provinceId}
                  onChange={(event) => {
                    setProvinceId(event.target.value);
                    setFlockId(null);
                  }}
                  className="h-9 min-w-40 rounded-md border border-white/20 bg-white/10 px-3 text-sm text-white outline-none"
                >
                  <option value="" className="bg-surface-1 text-ink">
                    {fr ? "Toutes les provinces" : "All provinces"}
                  </option>
                  {provinces.data.map((province) => (
                    <option
                      key={province.id}
                      value={province.id}
                      className="bg-surface-1 text-ink"
                    >
                      {province.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {
              <label className="grid gap-1 text-xs font-medium text-cyan-100">
                <span>Production</span>
                <select
                  value={productionType}
                  onChange={(event) => {
                    setProductionType(event.target.value as ProductionType);
                    setFlockId(null);
                  }}
                  className="h-9 min-w-32 rounded-md border border-white/20 bg-white/10 px-3 text-sm text-white outline-none"
                >
                  <option value="" className="bg-surface-1 text-ink">
                    {fr ? "Toutes productions" : "All production"}
                  </option>
                  <option value="broiler" className="bg-surface-1 text-ink">
                    {fr ? "Poulets de chair" : "Broiler"}
                  </option>
                  <option value="layer" className="bg-surface-1 text-ink">
                    {fr ? "Poules pondeuses" : "Layer"}
                  </option>
                  <option value="breeder" className="bg-surface-1 text-ink">
                    {fr ? "Reproducteurs" : "Breeder"}
                  </option>
                </select>
              </label>
            }
            {flockId && eligibleAssignees.length ? (
              <label className="grid gap-1 text-xs font-medium text-cyan-100">
                <span>{fr ? "Employé pour les tâches" : "Task employee"}</span>
                <select
                  value={assignedMemberId}
                  onChange={(event) => setAssignedMemberId(event.target.value)}
                  className="h-9 min-w-44 rounded-md border border-white/20 bg-white/10 px-3 text-sm text-white outline-none"
                >
                  <option value="" className="bg-surface-1 text-ink">
                    {fr ? "Non assigné" : "Unassigned"}
                  </option>
                  {eligibleAssignees.map((employee) => (
                    <option
                      key={employee.member!.memberId}
                      value={employee.member!.memberId}
                      className="bg-surface-1 text-ink"
                    >
                      {employee.employeeNumber} · {employee.fullName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {flockId && create("daily-records") ? (
              <Button
                className="border border-white/15 bg-white text-emerald-900 hover:bg-emerald-50"
                onClick={() => generate.mutate()}
                loading={generate.isPending}
              >
                <Sparkles aria-hidden />
                {copy.generate}
              </Button>
            ) : null}
            {create("feed") ? (
              <Button
                variant="secondary"
                className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                onClick={() => {
                  setEntryOpen(true);
                  setTab("production");
                }}
              >
                <Plus aria-hidden />
                {copy.record}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="relative mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Metric
            label={copy.active}
            value={overview.data?.totals.activeFlocks}
            icon={Bird}
            loading={overview.isPending}
          />
          <Metric
            label={copy.birds}
            value={totalBirds}
            icon={Feather}
            loading={queries[1]?.isPending}
          />
          <Metric
            label={copy.mortality}
            value={
              overview.data
                ? list("mortality").length
                  ? formatPercent(overview.data.totals.mortalityRatePercent, 2)
                  : notRecorded
                : "—"
            }
            icon={HeartPulse}
            critical={num(overview.data?.totals.mortalityRatePercent) > 2}
            loading={overview.isPending}
          />
          {productionType !== "broiler" ? (
            <Metric
              label={copy.eggs}
              value={
                list("eggs").length
                  ? formatQuantity(overview.data?.totals.totalEggs, null, 0)
                  : notRecorded
              }
              icon={Egg}
              loading={overview.isPending}
            />
          ) : null}
          <Metric
            label={copy.feed}
            value={
              list("feed").length
                ? formatQuantity(overview.data?.totals.feedKg, "kg", 0)
                : notRecorded
            }
            icon={Wheat}
            loading={overview.isPending}
          />
          <Metric
            label={copy.water}
            value={
              list("water").length
                ? formatQuantity(overview.data?.totals.waterLiters, "L", 0)
                : notRecorded
            }
            icon={Droplets}
            loading={overview.isPending}
          />
        </div>
      </section>
      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface-1 p-1.5">
        {(
          [
            ["overview", copy.overview],
            ["production", copy.production],
            ["health", copy.health],
            ["records", fr ? "Registre" : "Records"],
            ["performance", copy.performance],
            ["setup", copy.setup],
          ] as Array<[Tab, string]>
        ).map(([value, name]) => (
          <button
            type="button"
            key={value}
            onClick={() => setTab(value)}
            className={
              "h-9 shrink-0 rounded-lg px-3 text-sm font-medium transition-colors " +
              (tab === value
                ? "bg-brand text-white shadow-sm"
                : "text-ink-secondary hover:bg-surface-2 hover:text-ink")
            }
          >
            {name}
          </button>
        ))}
      </nav>
      {error ? (
        <p
          className="rounded-xl border border-critical/35 bg-critical/10 px-4 py-3 text-sm text-critical"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {tab === "overview" ? (
        <Overview
          copy={copy}
          flocks={flocks}
          pending={queries[1]?.isPending}
          active={flockId}
          choose={setFlockId}
          open={(id) => {
            setFlockId(id);
            setFlockDetailOpen(true);
          }}
          review={overview.data?.mortalityReview ?? []}
          recent={recent}
        />
      ) : null}
      {tab === "production" ? (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,.8fr)]">
          <div className="space-y-5">
            <Panel
              title={copy.signals}
              subtitle={formatBusinessDay(reportDate)}
            >
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Signal
                  icon={Wheat}
                  label={copy.feed}
                  value={totalIfRecorded("feed", "quantityKg", "kg")}
                  detail={
                    list("feed").length
                      ? list("feed").length + " records"
                      : notRecorded
                  }
                />
                <Signal
                  icon={Droplets}
                  label={copy.water}
                  value={totalIfRecorded("water", "volumeLiters", "L")}
                  detail={
                    list("water").length
                      ? list("water").length + " records"
                      : notRecorded
                  }
                />
                <Signal
                  icon={Scale}
                  label="Average weight"
                  value={
                    list("weights")[0]
                      ? formatQuantity(
                          num(list("weights")[0]?.averageWeightG),
                          "g",
                          0,
                        )
                      : notRecorded
                  }
                  detail={list("weights")[0]?.flock?.name ?? notRecorded}
                />
                {productionType !== "broiler" ? (
                  <Signal
                    icon={Egg}
                    label={copy.eggs}
                    value={totalIfRecorded("eggs", "totalEggs", null, 0)}
                    detail={
                      list("eggs").length
                        ? formatQuantity(
                            list("eggs").reduce(
                              (sum, item) => sum + num(item.saleableEggs),
                              0,
                            ),
                            null,
                            0,
                          ) + " saleable"
                        : notRecorded
                    }
                  />
                ) : null}
                <Signal
                  icon={HeartPulse}
                  label={copy.mortality}
                  value={totalIfRecorded("mortality", "deathCount", null, 0)}
                  detail={
                    list("mortality").length
                      ? list("mortality").some(
                          (item) => item.requiresDailyReview,
                        )
                        ? "Needs review"
                        : "Within threshold"
                      : notRecorded
                  }
                  serious={list("mortality").some(
                    (item) => item.requiresDailyReview,
                  )}
                />
                <Signal
                  icon={ClipboardCheck}
                  label={fr ? "Comptage du jour" : "Bird count today"}
                  value={totalIfRecorded(
                    "daily-records",
                    "liveBirdCount",
                    null,
                    0,
                  )}
                  detail={
                    list("daily-records").length
                      ? list("daily-records").length + " counts"
                      : notRecorded
                  }
                />
              </div>
            </Panel>
            <Recent title={copy.recent} data={recent} empty={copy.noRecords} />
          </div>
          <aside className="h-fit rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
                  {copy.record}
                </p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-ink">
                  {entryOpen
                    ? fr
                      ? "Saisie des donnees terrain"
                      : "Field data entry"
                    : fr
                      ? "Gardez une journee fiable"
                      : "Keep the day accurate"}
                </h2>
                <p className="mt-1 text-sm leading-6 text-ink-secondary">
                  {entryOpen
                    ? fr
                      ? "Enregistrez le resultat reel pour le lot correct."
                      : "Record the actual result against the correct flock."
                    : fr
                      ? "Le moteur de performance compare uniquement les donnees saisies par l equipe."
                      : "The performance engine can compare only what the team records."}
                </p>
              </div>
              <Activity className="size-5 text-brand" aria-hidden />
            </div>
            {entryOpen ? (
              <EntryForm
                entry={entry}
                change={setEntry}
                date={reportDate}
                flocks={flocks}
                submit={submit}
                cancel={() => setEntryOpen(false)}
                loading={save.isPending}
                copy={copy}
              />
            ) : (
              <Button
                className="mt-5 w-full"
                onClick={() => setEntryOpen(true)}
                disabled={!create("feed")}
              >
                <Plus aria-hidden />
                {copy.record}
              </Button>
            )}
          </aside>
        </section>
      ) : null}
      {tab === "health" ? <HealthView copy={copy} list={list} /> : null}
      {tab === "records" ? (
        <PoultryRecordCentre
          orgSlug={orgSlug}
          flocks={flocks}
          houses={list("houses") as House[]}
        />
      ) : null}
      {tab === "performance" ? (
        <>
          <PerformanceView
            copy={copy}
            flock={chosen}
            data={performance.data}
            loading={performance.isPending}
            failed={performance.isError}
            retry={() => performance.refetch()}
            work={work.data ?? []}
            workLoading={work.isPending}
            canGenerate={create("daily-records")}
            canApprove={
              can(user, "poultry.daily_records.update") &&
              !user?.roles.includes("employee")
            }
            busy={
              generate.isPending || finish.isPending || approveWork.isPending
            }
            generate={() => generate.mutate()}
            complete={(id) => finish.mutate({ id })}
            approve={(id) => approveWork.mutate(id)}
          />
          <PoultryWorkPlanner
            orgSlug={orgSlug}
            flockId={flockId}
            date={reportDate}
            members={eligibleAssignees.map((employee) => ({
              id: employee.member!.memberId,
              label: `${employee.employeeNumber} · ${employee.fullName}`,
            }))}
            allowed={create("daily-records")}
          />
        </>
      ) : null}
      {tab === "setup" ? <PoultrySetupView orgSlug={orgSlug} /> : null}
      {flockDetailOpen && chosen ? (
        <FlockDetailsModal
          copy={copy}
          flock={chosen}
          data={performance.data}
          loading={performance.isPending}
          failed={performance.isError}
          retry={() => performance.refetch()}
          work={work.data ?? []}
workLoading={work.isPending}
          orgSlug={orgSlug}
          houses={list("houses") as House[]}
          models={models.data ?? []}
          canEdit={can(user, "poultry.flocks.update")}
          onUpdated={refresh}
          onClose={() => setFlockDetailOpen(false)}        />
      ) : null}
    </main>
  );
}

function PoultryMyWork({
  date,
  setDate,
  work,
  loading,
  failed,
  start,
  complete,
  busy,
  fr,
  error,
}: {
  date: string;
  setDate: (date: string) => void;
  work: Work[];
  loading: boolean;
  failed: boolean;
  start: (id: string) => void;
  complete: (id: string, completionNote?: string | null) => void;
  busy: boolean;
  fr: boolean;
  error: string | null;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const copy = fr
    ? {
        kicker: "Mon travail avicole",
        title: "Tâches qui me sont attribuées",
        desc: "Démarrez le travail, consignez ce qui a été fait, puis envoyez-le au superviseur pour validation.",
        date: "Date de travail",
        start: "Démarrer",
        complete: "Soumettre comme terminé",
        note: "Note de fin (facultatif)",
        empty: "Aucune tâche avicole ne vous est attribuée pour cette date.",
        pending: "En attente du superviseur",
        approved: "Validé par le superviseur",
        returned: "Renvoyé pour correction",
        loadFailed: "Vos tâches n’ont pas pu être chargées.",
      }
    : {
        kicker: "My poultry work",
        title: "Tasks assigned to me",
        desc: "Start the work, record what was done, then send it to a supervisor for approval.",
        date: "Working date",
        start: "Start",
        complete: "Submit as complete",
        note: "Completion note (optional)",
        empty: "No poultry work is assigned to you for this date.",
        pending: "Waiting for supervisor approval",
        approved: "Approved by supervisor",
        returned: "Returned for correction",
        loadFailed: "Your tasks could not be loaded.",
      };
  if (failed)
    return (
      <main className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
        <ErrorState
          description={copy.loadFailed}
          onRetry={() => window.location.reload()}
        />
      </main>
    );
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8">
      <section className="relative overflow-hidden rounded-3xl bg-[radial-gradient(circle_at_82%_5%,rgba(251,191,36,.24),transparent_28%),linear-gradient(118deg,#082f2c_0%,#0b4c4b_55%,#075985_100%)] px-5 py-7 text-white sm:px-7">
        <ClipboardCheck
          className="absolute -right-3 -top-3 size-32 rotate-12 text-white/[.07]"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-100">
              {copy.kicker}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em]">
              {copy.title}
            </h1>
            <p className="mt-3 text-sm leading-6 text-cyan-50/90">
              {copy.desc}
            </p>
          </div>
          <label className="grid gap-1 text-xs font-medium text-cyan-100">
            <span>{copy.date}</span>
            <Input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="border-white/20 bg-white/10 text-white [color-scheme:dark]"
            />
          </label>
        </div>
      </section>
      {error ? (
        <p
          className="rounded-xl border border-critical/35 bg-critical/10 px-4 py-3 text-sm text-critical"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : work.length ? (
        <section className="space-y-3">
          {work.map((item) => (
            <article
              className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm"
              key={item.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-ink">
                    {item.title}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-ink-secondary">
                    {item.details ?? "—"}
                  </p>
                </div>
                <Badge
                  variant={
                    item.status === "completed"
                      ? "good"
                      : item.status === "overdue"
                        ? "critical"
                        : item.status === "in_progress"
                          ? "info"
                          : "neutral"
                  }
                >
                  {label(item.status)}
                </Badge>
              </div>
              {item.review?.notes ? (
                <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-3">
                  <p className="text-sm font-medium text-ink">
                    {copy.returned}
                  </p>
                  <p className="mt-1 text-sm text-ink-secondary">
                    {item.review.notes}
                  </p>
                </div>
              ) : null}
              {item.status === "completed" ? (
                <div className="mt-4 rounded-xl border border-border bg-surface-2 p-3">
                  <p className="text-sm font-medium text-ink">
                    {item.approvalStatus === "approved"
                      ? copy.approved
                      : copy.pending}
                  </p>
                  {item.completionNote ? (
                    <p className="mt-2 text-xs text-ink-muted">
                      {item.completionNote}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4 grid gap-3">
                  <Field label={copy.note} htmlFor={`note-${item.id}`}>
                    <Textarea
                      id={`note-${item.id}`}
                      value={notes[item.id] ?? ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                      maxLength={1200}
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    {item.status === "planned" ||
                    item.status === "overdue" ||
                    item.status === "missed" ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => start(item.id)}
                        loading={busy}
                      >
                        {copy.start}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      onClick={() => complete(item.id, notes[item.id])}
                      loading={busy}
                    >
                      <Check aria-hidden />
                      {copy.complete}
                    </Button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </section>
      ) : (
        <EmptyState
          className="rounded-2xl border border-dashed border-border-strong bg-surface-1 py-16"
          title={copy.empty}
          icon={ClipboardCheck}
        />
      )}
    </main>
  );
}
function Metric({
  label,
  value,
  icon: Icon,
  critical,
  loading,
}: {
  label: string;
  value: string | number | undefined;
  icon: LucideIcon;
  critical?: boolean;
  loading?: boolean;
}) {
  const missing =
    value === "—" || value === "Non enregistré" || value === "Not recorded";
  return (
    <div
      className={
        "relative overflow-hidden rounded-2xl border p-4 shadow-[0_18px_36px_-26px_rgba(2,44,34,.82)] backdrop-blur " +
        (critical
          ? "border-critical/45 bg-critical/20"
          : "border-white/15 bg-white/[.095]")
      }
    >
      <span className="pointer-events-none absolute -right-3 -top-3 size-16 rounded-full bg-white/[.06]" />
      <div className="relative flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-cyan-50/90">{label}</p>
        <span className="grid size-8 place-items-center rounded-xl border border-white/10 bg-white/10">
          <Icon className="size-4 text-emerald-100" aria-hidden />
        </span>
      </div>
      {loading ? (
        <Skeleton className="relative mt-4 h-7 w-16 bg-white/20" />
      ) : (
        <p
          className={
            "relative mt-3 font-semibold tracking-tight tabular-nums text-white " +
            (missing ? "text-sm leading-7 text-cyan-50/85" : "text-2xl")
          }
        >
          {value ?? "—"}
        </p>
      )}
    </div>
  );
}
function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-surface-1 via-surface-1 to-brand-subtle/25 shadow-[0_18px_44px_-30px_rgba(15,23,42,.42)] dark:shadow-[0_18px_44px_-30px_rgba(0,0,0,.9)]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-gradient-to-r from-brand-subtle/35 via-surface-1 to-surface-1 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {subtitle ? (
            <p className="mt-1 text-sm text-ink-secondary">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}
function Signal({
  icon: Icon,
  label,
  value,
  detail,
  serious,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  serious?: boolean;
}) {
  return (
    <div
      className={
        "relative overflow-hidden rounded-2xl border p-4 shadow-[0_14px_30px_-26px_rgba(15,23,42,.38)] transition duration-200 hover:-translate-y-0.5 hover:shadow-md " +
        (serious
          ? "border-critical/30 bg-critical/10"
          : "border-border bg-gradient-to-br from-surface-1 via-surface-1 to-brand-subtle/30")
      }
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink-secondary">{label}</p>
        <Icon
          className={"size-4 " + (serious ? "text-critical" : "text-brand")}
          aria-hidden
        />
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight text-ink">
        {value}
      </p>
      <p className="mt-1 truncate text-xs text-ink-muted">{detail}</p>
    </div>
  );
}
function FlockMetric({
  label,
  value,
  serious,
}: {
  label: string;
  value: string;
  serious?: boolean;
}) {
  return (
    <div className="min-w-0 px-3 py-3 first:pl-3 last:pr-3">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[.08em] text-ink-muted">
        {label}
      </p>
      <p
        className={
          "mt-1 truncate text-base font-semibold tabular-nums " +
          (serious ? "text-critical" : "text-ink")
        }
      >
        {value}
      </p>
    </div>
  );
}
function Small({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] font-medium text-ink-muted">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function Overview({
  copy,
  flocks,
  pending,
  active,
  choose,
  open,
  review,
  recent,
}: {
  copy: any;
  flocks: Flock[];
  pending?: boolean;
  active: string | null;
  choose: (id: string) => void;
  open: (id: string) => void;
  review: Array<{
    flock: Place;
    house: Place;
    site: Place;
    dailyMortalityCount: number;
    mortalityReviewThreshold: number;
  }>;
  recent: Array<{ kind: string; item: Row }>;
}) {
  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,.8fr)]">
      <div className="space-y-5">
        <Panel
          title={copy.flocks}
          subtitle={copy.flockSubtitle}
          action={<Badge variant="info">{flocks.length} total</Badge>}
        >
          {pending ? (
            <div className="space-y-3">
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </div>
          ) : flocks.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {flocks.map((flock) => {
                const mortality = num(flock.totalMortality);
                const initialBirds = num(flock.initialBirdCount);
                const currentBirds = num(flock.currentBirdCount);
                const survival = initialBirds > 0
                  ? Math.max(0, Math.min(100, (currentBirds / initialBirds) * 100))
                  : null;
                const needsReview = mortality > 0;
                return (
                  <button
                    type="button"
                    key={flock.id}
                    onClick={() => {
                      choose(flock.id);
                      open(flock.id);
                    }}
                    aria-label={`${copy.openFlock}: ${flock.name}`}
                    className={
                      "group relative overflow-hidden rounded-2xl border text-left shadow-[0_16px_36px_-30px_rgba(15,23,42,.65)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none " +
                      (active === flock.id
                        ? "border-brand bg-brand-subtle/35 ring-1 ring-brand/35"
                        : "border-border bg-surface-1 hover:border-brand/50")
                    }
                  >
                    <span
                      aria-hidden
                      className={
                        "absolute inset-x-0 top-0 h-1 " +
                        (needsReview
                          ? "bg-gradient-to-r from-critical via-serious to-warning"
                          : "bg-gradient-to-r from-brand via-cyan-400 to-emerald-400")
                      }
                    />
                    <div className="p-4 pt-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-brand/15 bg-brand-subtle text-brand">
                            <Bird className="size-5" aria-hidden />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-base font-semibold tracking-tight text-ink">
                              {flock.name}
                            </p>
                            <p className="mt-1 truncate text-xs font-medium text-ink-muted">
                              {flock.code} · {label(flock.productionType ?? flock.birdType)}
                            </p>
                          </div>
                        </div>
                        <Badge
                          variant={
                            flock.status === "active"
                              ? "good"
                              : flock.status === "quarantined"
                                ? "serious"
                                : "neutral"
                          }
                        >
                          {label(flock.status)}
                        </Badge>
                      </div>

                      <div className="mt-4 flex items-start gap-2 rounded-xl border border-border bg-surface-2/70 px-3 py-2.5">
                        <MapPin className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
                        <p className="min-w-0 text-xs leading-5 text-ink-secondary">
                          <span className="font-semibold text-ink">{copy.house}: </span>
                          {flock.house?.name ?? "—"}
                          <span className="px-1.5 text-ink-muted">·</span>
                          <span className="font-semibold text-ink">{copy.site}: </span>
                          {flock.site?.name ?? flock.province?.name ?? "—"}
                        </p>
                      </div>

                      <div className="mt-4 grid grid-cols-3 divide-x divide-border overflow-hidden rounded-xl border border-border bg-surface-2/45">
                        <FlockMetric
                          label={copy.birds}
                          value={formatQuantity(flock.currentBirdCount, null, 0)}
                        />
                        <FlockMetric
                          label={copy.mortality}
                          value={formatQuantity(flock.totalMortality, null, 0)}
                          serious={needsReview}
                        />
                        <FlockMetric
                          label={copy.survival}
                          value={survival == null ? "—" : formatPercent(survival)}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between border-t border-border bg-surface-2/55 px-4 py-3 text-xs font-semibold text-brand transition-colors group-hover:bg-brand-subtle/45">
                      <span>{copy.openFlock}</span>
                      <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState title={copy.noRecords} icon={Bird} />
          )}
        </Panel>        <Recent title={copy.recent} data={recent} empty={copy.noRecords} />
      </div>
      <aside className="space-y-5">
        <Panel
          title={copy.urgent}
          subtitle="Mortality thresholds are evaluated for each flock."
        >
          {review.length ? (
            <div className="space-y-3">
              {review.map((item) => (
                <div
                  className="rounded-xl border border-critical/30 bg-critical/10 p-4"
                  key={item.flock.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">
                        {item.flock.name}
                      </p>
                      <p className="mt-1 text-xs text-ink-secondary">
                        {item.house.name} · {item.site.name}
                      </p>
                    </div>
                    <Badge variant="critical">
                      {item.dailyMortalityCount} deaths
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs text-critical">
                    Review threshold: {item.mortalityReviewThreshold} birds
                  </p>
                </div>
              ))}

            </div>
          ) : (
            <div className="rounded-xl bg-good/10 p-5 text-center">
              <ShieldCheck
                className="mx-auto size-7 text-good-ink"
                aria-hidden
              />
              <p className="mt-2 text-sm font-medium text-ink">
                {copy.noUrgent}
              </p>
            </div>
          )}
        </Panel>
        <Panel title="Daily operating rhythm">
          <ol className="space-y-3">
            {[
              "Count live birds for every flock.",
              "Record feed, water, eggs and mortality on the same day.",
              "Use model recommendations before changing a field routine.",
              "Escalate health and biosecurity issues quickly.",
            ].map((item, index) => (
              <li
                className="flex gap-3 text-sm leading-6 text-ink-secondary"
                key={item}
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-subtle text-xs font-semibold text-brand">
                  {index + 1}
                </span>
                {item}
              </li>
            ))}
          </ol>
        </Panel>
      </aside>
    </section>
  );
}
function FlockDetailsModal({
  copy,
  flock,
  data,
  loading,
  failed,
  retry,
  work,
workLoading,
  orgSlug,
  houses,
  models,
  canEdit,
  onUpdated,
  onClose,
}: {
  copy: any;
  flock: Flock;
  data?: Performance;
  loading: boolean;
  failed: boolean;
  retry: () => void;
work: Work[];
  workLoading: boolean;
  orgSlug: string;
  houses: House[];
  models: Model[];
  canEdit: boolean;
  onUpdated: () => void;
  onClose: () => void;
}) {
  const fr = Boolean(copy.fr);
  const [editing, setEditing] = useState(false);
  const liveBirds = data?.flock.liveBirdCount ?? flock.currentBirdCount;
  const expectedBirds =
    data?.flock.expectedLiveBirdCount ?? flock.expectedLiveBirdCount;
  const physicalBirds =
    data?.flock.physicalLiveBirdCount ?? flock.physicalLiveBirdCount;
  const discrepancy =
    data?.flock.liveBirdDiscrepancy ?? flock.liveBirdDiscrepancy;
  const facts: Array<[string, string]> = [
    [fr ? "Code du lot" : "Flock code", flock.code],
    [fr ? "Type" : "Type", label(flock.productionType ?? flock.birdType)],
    [fr ? "Statut" : "Status", label(flock.status)],
    [fr ? "Bâtiment" : "House", flock.house?.name ?? "—"],
    [fr ? "Ferme / site" : "Farm / site", flock.site?.name ?? "—"],
    [fr ? "Province" : "Province", flock.province?.name ?? "—"],
    [fr ? "Race / souche" : "Breed / strain", flock.breed ?? "—"],
    [
      fr ? "Fournisseur / couvoir" : "Supplier / hatchery",
      flock.sourceName ?? flock.chickSource ?? "—",
    ],
    [
      fr ? "Date d arrivée" : "Arrival date",
      formatBusinessDay(flock.arrivalDate ?? null),
    ],
    [
      fr ? "Date d éclosion" : "Hatch date",
      formatBusinessDay(flock.hatchDate ?? null),
    ],
    [
      fr ? "Fin prévue" : "Expected end",
      formatBusinessDay(flock.expectedProductionEndDate ?? null),
    ],
  ];
  const comparisons: Array<[string, Compare | undefined, string]> = [
    [fr ? "Aliment" : "Feed", data?.comparisons.feed, "kg"],
    [fr ? "Eau" : "Water", data?.comparisons.water, "L"],
    [fr ? "Poids moyen" : "Average weight", data?.comparisons.weight, "g"],
    [
      fr ? "Mortalité cumulée" : "Cumulative mortality",
      data?.comparisons.cumulativeMortality,
      "%",
    ],
  ];
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-ink/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={fr ? "Détails du lot" : "Flock details"}
    >
      <div className="mx-auto my-4 w-full max-w-5xl rounded-2xl border border-border bg-surface-1 shadow-2xl">
{editing ? (
          <FlockQuickEditModal
            orgSlug={orgSlug}
            flock={flock}
            houses={houses}
            models={models}
            currentModelName={data?.model?.name ?? null}
            fr={fr}
            onCancel={() => setEditing(false)}
            onSaved={() => { setEditing(false); onUpdated(); }}
          />
        ) : null}        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-[linear-gradient(110deg,#effdf7,#f0f9ff)] px-5 py-5 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">
              {fr ? "Fiche du lot" : "Flock profile"}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold tracking-tight text-ink">
                {flock.name}
              </h2>
              <Badge
                variant={
                  flock.status === "active"
                    ? "good"
                    : flock.status === "quarantined"
                      ? "serious"
                      : "neutral"
                }
              >
                {label(flock.status)}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-ink-secondary">
              {flock.code} · {label(flock.productionType ?? flock.birdType)} ·{" "}
              {flock.house?.name ?? "—"}
            </p>
          </div>
<div className="flex flex-wrap items-center gap-2">
            <a
              href={orgApiUrl(orgSlug, `poultry/flocks/${flock.id}/profile.pdf`)}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border-strong bg-surface-1 px-3 text-sm font-medium text-ink transition hover:bg-surface-2"
            >
              <Download className="size-4" aria-hidden />
              PDF
            </a>
            {canEdit ? (
              <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                <Pencil aria-hidden />
                {fr ? "Modifier" : "Edit"}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={onClose}>
              <X aria-hidden />
              {fr ? "Fermer" : "Close"}
            </Button>
          </div>
        </header>
        <div className="space-y-5 p-5 sm:p-6">
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <DetailMetric
              label={fr ? "Oiseaux au départ" : "Starting birds"}
              value={formatQuantity(flock.initialBirdCount, null, 0)}
            />
            <DetailMetric
              label={fr ? "Oiseaux vivants" : "Live birds"}
              value={formatQuantity(liveBirds, null, 0)}
            />
            <DetailMetric
              label={fr ? "Mortalité totale" : "Total mortality"}
              value={formatQuantity(flock.totalMortality, null, 0)}
              serious={num(flock.totalMortality) > 0}
            />
            <DetailMetric
              label={fr ? "Comptage physique" : "Physical count"}
              value={
                physicalBirds == null
                  ? fr
                    ? "Non enregistré"
                    : "Not recorded"
                  : formatQuantity(physicalBirds, null, 0)
              }
              serious={discrepancy != null && num(discrepancy) !== 0}
            />
          </section>
          {discrepancy != null && num(discrepancy) !== 0 ? (
            <p className="rounded-xl border border-warning/35 bg-warning/10 px-4 py-3 text-sm text-warning-ink">
              {fr
                ? "Écart entre le comptage calculé et le comptage physique : "
                : "Difference between calculated and physical bird count: "}
              {formatQuantity(Math.abs(num(discrepancy)), null, 0)}{" "}
              {fr
                ? "oiseaux. Une revue du superviseur est requise."
                : "birds. Supervisor review is required."}
            </p>
          ) : null}
          <section className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]">
            <Panel
              title={fr ? "Informations du lot" : "Flock information"}
              subtitle={
                fr
                  ? "La configuration et la traçabilité de ce lot."
                  : "Configuration and traceability for this flock."
              }
            >
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {facts.map(([name, value]) => (
                  <div className="border-b border-border pb-2" key={name}>
                    <dt className="text-xs font-medium text-ink-muted">
                      {name}
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-ink">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>
            <Panel
              title={fr ? "Modèle et performance" : "Model and performance"}
              subtitle={
                data?.model
                  ? fr
                    ? "Les résultats sont comparés aux objectifs actuels."
                    : "Results are compared with current targets."
                  : fr
                    ? "Aucun modèle n est attribué à ce lot."
                    : "No performance model is assigned to this flock."
              }
            >
              {loading ? (
                <Skeleton className="h-44" />
              ) : failed ? (
                <ErrorState
                  title={
                    fr ? "Performance indisponible" : "Performance unavailable"
                  }
                  description={
                    fr
                      ? "Les données de performance ne peuvent pas être chargées pour le moment."
                      : "Performance data could not be loaded right now."
                  }
                  onRetry={retry}
                />
              ) : data ? (
                <div className="space-y-4">
                  <div className="rounded-xl bg-surface-2 p-3">
                    <p className="text-sm font-semibold text-ink">
                      {data.model?.name ??
                        (fr ? "Aucun modèle attribué" : "No model assigned")}
                    </p>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {fr ? "Âge : " : "Age: "}
                      {data.age.ageDays}{" "}
                      {fr ? "jours · semaine " : "days · week "}
                      {data.age.ageWeek}
                      {data.model?.climateProfile?.name
                        ? ` · ${data.model.climateProfile.name}`
                        : ""}
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {comparisons.map(([name, comparison, unit]) => (
                      <div
                        className="rounded-lg border border-border p-3"
                        key={name}
                      >
                        <p className="text-xs font-medium text-ink-muted">
                          {name}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-ink">
                          {comparison?.actual == null
                            ? "—"
                            : formatQuantity(
                                comparison.actual,
                                unit,
                                unit === "%" ? 2 : 1,
                              )}
                        </p>
                        <p className="mt-1 text-xs text-ink-secondary">
                          {fr ? "Objectif : " : "Target: "}
                          {comparison?.target == null
                            ? "—"
                            : formatQuantity(
                                comparison.target,
                                unit,
                                unit === "%" ? 2 : 1,
                              )}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </Panel>
          </section>
          {data?.recommendations.length ? (
            <Panel
              title={
                fr ? "Alertes et recommandations" : "Alerts and recommendations"
              }
              subtitle={
                fr
                  ? "Actions suggérées à partir des données du lot."
                  : "Suggested actions based on this flock data."
              }
            >
              <div className="space-y-3">
                {data.recommendations.map((item, index) => (
                  <article
                    className={
                      "relative overflow-hidden rounded-2xl border p-4 shadow-[0_14px_30px_-26px_rgba(15,23,42,.38)] transition duration-200 hover:-translate-y-0.5 hover:shadow-md " +
                      (item.severity === "critical"
                        ? "border-critical/35 bg-critical/10"
                        : item.severity === "warning"
                          ? "border-warning/35 bg-warning/10"
                          : "border-brand/25 bg-brand-subtle")
                    }
                    key={item.category + index}
                  >
                    <p className="text-sm font-semibold text-ink">
                      {item.message}
                    </p>
                    <p className="mt-1 text-sm text-ink-secondary">
                      {item.action}
                    </p>
                  </article>
                ))}
              </div>
            </Panel>
          ) : null}
          <section className="grid gap-5 lg:grid-cols-2">
            <Panel
              title={fr ? "Travail du jour" : "Today’s work"}
              subtitle={
                fr
                  ? "Tâches liées à ce lot pour la date sélectionnée."
                  : "Tasks for this flock on the selected date."
              }
            >
              {workLoading ? (
                <Skeleton className="h-36" />
              ) : work.length ? (
                <div className="space-y-2">
                  {work.slice(0, 8).map((item) => (
                    <div
                      className="rounded-lg border border-border p-3"
                      key={item.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-ink">
                            {item.title}
                          </p>
                          {item.details ? (
                            <p className="mt-1 text-xs text-ink-secondary">
                              {item.details}
                            </p>
                          ) : null}
                        </div>
                        <Badge
                          variant={
                            item.status === "completed"
                              ? "good"
                              : item.status === "overdue"
                                ? "critical"
                                : "info"
                          }
                        >
                          {label(item.status)}
                        </Badge>
                      </div>
                      {item.assignedMember?.fullName ? (
                        <p className="mt-2 text-xs text-ink-muted">
                          {fr ? "Attribué à : " : "Assigned to: "}
                          {item.assignedMember.fullName}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title={
                    fr
                      ? "Aucune tâche pour cette date."
                      : "No work for this date."
                  }
                  icon={ClipboardCheck}
                />
              )}
            </Panel>
            <Panel
              title={fr ? "Vaccinations prévues" : "Scheduled vaccinations"}
              subtitle={
                fr
                  ? "Les échéances suivent l âge et le modèle du lot."
                  : "Due dates follow the flock age and model."
              }
            >
              {loading ? (
                <Skeleton className="h-36" />
              ) : data?.vaccines.length ? (
                <div className="space-y-2">
                  {data.vaccines.map((item) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                      key={item.id}
                    >
                      <div>
                        <p className="text-sm font-medium text-ink">
                          {item.vaccineName}
                        </p>
                        <p className="mt-1 text-xs text-ink-secondary">
                          {fr ? "Jour " : "Day "}
                          {item.dayAge}
                          {item.dose ? ` · ${item.dose}` : ""}
                        </p>
                      </div>
                      <Badge
                        variant={item.status === "due" ? "critical" : "good"}
                      >
                        {label(item.status)}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title={
                    fr
                      ? "Aucune vaccination prévue."
                      : "No vaccination scheduled."
                  }
                  icon={ShieldCheck}
                />
              )}
            </Panel>
          </section>
        </div>
      </div>
    </div>
  );
}
function FlockQuickEditModal({
  orgSlug,
  flock,
  houses,
  models,
  currentModelName,
  fr,
  onCancel,
  onSaved,
}: {
  orgSlug: string;
  flock: Flock;
  houses: House[];
  models: Model[];
  currentModelName: string | null;
  fr: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [poultryType, setPoultryType] = useState(
    flock.productionType ?? flock.birdType ?? "broiler",
  );
  const [formError, setFormError] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      poultryApi.update(orgSlug, "flocks", flock.id, body),
    onSuccess: onSaved,
  });
  const serverError =
    update.error instanceof ApiError
      ? update.error.message
      : update.error
        ? fr
          ? "La modification du lot a échoué."
          : "The flock could not be updated."
        : null;
  const matchingModels = models.filter(
    (model) => model.productionType === poultryType && (model.isActive || model.id === flock.performanceModelId),
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "").trim();
    const name = value("name");
    const code = value("code").toLowerCase();
    const houseId = value("houseId");
    const arrivalDate = value("arrivalDate");
    const threshold = Number(value("mortalityReviewThreshold"));
    if (!name || !code || !houseId || !arrivalDate) {
      setFormError(fr ? "Complétez les champs obligatoires indiqués." : "Complete the required fields.");
      return;
    }
    if (!Number.isInteger(threshold) || threshold < 1) {
      setFormError(fr ? "Le seuil de mortalité doit être au moins 1." : "The mortality threshold must be at least 1.");
      return;
    }
    setFormError(null);
    update.mutate({
      name,
      code,
      houseId,
      birdType: poultryType,
      productionType: poultryType,
      breed: value("breed") || null,
      sourceName: value("sourceName") || null,
      chickSource: value("chickSource") || null,
      sex: value("sex") || "mixed",
      arrivalDate,
      hatchDate: value("hatchDate") || null,
      expectedProductionEndDate: value("expectedProductionEndDate") || null,
      startingAgeDays: Number(value("startingAgeDays") || 0),
      performanceModelId: value("performanceModelId") || null,
      mortalityReviewThreshold: threshold,
      notes: value("notes") || null,
    });
  }

  const selectClass = "h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/35";
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-ink/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={fr ? "Modifier le lot" : "Edit flock"}>
      <form onSubmit={submit} noValidate className="mx-auto my-5 w-full max-w-3xl rounded-2xl border border-border bg-surface-1 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border bg-surface-2 px-5 py-4 sm:px-6"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">{fr ? "Configuration du lot" : "Flock configuration"}</p><h3 className="mt-1 text-xl font-semibold text-ink">{fr ? "Modifier le lot" : "Edit flock"}</h3><p className="mt-1 text-xs leading-5 text-ink-secondary">{fr ? "Les comptages, mortalités et historiques restent inchangés." : "Counts, mortality and operational history remain unchanged."}</p></div><Button type="button" variant="ghost" onClick={onCancel}><X aria-hidden />{fr ? "Fermer" : "Close"}</Button></header>
        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
          <Field label={fr ? "Nom du lot" : "Flock name"} required><Input name="name" defaultValue={flock.name} required /></Field>
          <Field label={fr ? "Code du lot" : "Flock code"} required hint={fr ? "Minuscules, chiffres et tirets bas." : "Lowercase letters, numbers and underscores."}><Input name="code" defaultValue={flock.code} required /></Field>
          <Field label={fr ? "Type de volaille" : "Poultry type"} required><select name="productionType" value={poultryType} onChange={(event) => setPoultryType(event.target.value)} className={selectClass}>{["broiler", "layer", "breeder"].map((type) => <option value={type} key={type}>{label(type)}</option>)}</select></Field>
          <Field label={fr ? "Bâtiment" : "House"} required><select name="houseId" defaultValue={flock.house?.id ?? ""} className={selectClass} required>{houses.map((house) => <option key={house.id} value={house.id}>{house.name} · {house.capacity ?? "—"} {fr ? "places" : "capacity"}</option>)}</select></Field>
          <Field label={fr ? "Modèle de performance" : "Performance model"}><select name="performanceModelId" defaultValue={flock.performanceModelId ?? ""} className={selectClass}><option value="">{fr ? "Aucun modèle attribué" : "No model assigned"}</option>{flock.performanceModelId && !matchingModels.some((model) => model.id === flock.performanceModelId) ? <option value={flock.performanceModelId}>{currentModelName ?? (fr ? "Modèle actuellement attribué" : "Current assigned model")}</option> : null}{matchingModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></Field>
          <Field label={fr ? "Race / souche" : "Breed / strain"}><Input name="breed" defaultValue={flock.breed ?? ""} /></Field>
          <Field label={fr ? "Fournisseur / couvoir" : "Supplier / hatchery"}><Input name="sourceName" defaultValue={flock.sourceName ?? ""} /></Field>
          <Field label={fr ? "Source des poussins" : "Chick source"}><Input name="chickSource" defaultValue={flock.chickSource ?? ""} /></Field>
          <Field label={fr ? "Sexe" : "Sex"}><select name="sex" defaultValue={flock.sex ?? "mixed"} className={selectClass}><option value="mixed">{fr ? "Mixte" : "Mixed"}</option><option value="female">{fr ? "Femelle" : "Female"}</option><option value="male">{fr ? "Mâle" : "Male"}</option></select></Field>
          <Field label={fr ? "Date d’arrivée" : "Arrival date"} required><Input name="arrivalDate" type="date" defaultValue={flock.arrivalDate ?? ""} required /></Field>
          <Field label={fr ? "Date d’éclosion" : "Hatch date"}><Input name="hatchDate" type="date" defaultValue={flock.hatchDate ?? ""} /></Field>
          <Field label={fr ? "Fin prévue" : "Expected end"}><Input name="expectedProductionEndDate" type="date" defaultValue={flock.expectedProductionEndDate ?? ""} /></Field>
          <Field label={fr ? "Âge au départ (jours)" : "Starting age (days)"}><Input name="startingAgeDays" type="number" min="0" max="1000" defaultValue={flock.startingAgeDays ?? 0} /></Field>
          <Field label={fr ? "Seuil de revue de mortalité" : "Mortality review threshold"} required><Input name="mortalityReviewThreshold" type="number" min="1" step="1" defaultValue={flock.mortalityReviewThreshold ?? 1} required /></Field>
          <Field label={fr ? "Notes" : "Notes"} className="sm:col-span-2"><Textarea name="notes" defaultValue={flock.notes ?? ""} rows={3} /></Field>
        </div>
        {formError || serverError ? <p className="mx-5 mb-4 rounded-xl border border-critical/25 bg-critical/10 px-3 py-2 text-sm text-critical sm:mx-6" role="alert">{formError ?? serverError}</p> : null}
        <footer className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-4 sm:px-6"><Button type="button" variant="ghost" onClick={onCancel}>{fr ? "Annuler" : "Cancel"}</Button><Button type="submit" loading={update.isPending}>{fr ? "Enregistrer les modifications" : "Save changes"}</Button></footer>
      </form>
    </div>
  );
}
function DetailMetric({
  label,
  value,
  serious,
}: {
  label: string;
  value: string;
  serious?: boolean;
}) {
  return (
    <div
      className={
        "relative overflow-hidden rounded-2xl border p-4 shadow-[0_14px_30px_-26px_rgba(15,23,42,.38)] transition duration-200 hover:-translate-y-0.5 hover:shadow-md " +
        (serious
          ? "border-critical/30 bg-critical/10"
          : "border-border bg-gradient-to-br from-surface-1 via-surface-1 to-brand-subtle/30")
      }
    >
      <p className="text-xs font-medium text-ink-secondary">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-ink">
        {value}
      </p>
    </div>
  );
}
function Recent({
  title,
  data,
  empty,
}: {
  title: string;
  data: Array<{ kind: string; item: Row }>;
  empty: string;
}) {
  const sorted = [...data]
    .sort((a, b) =>
      String(itemDate(b.item) ?? "").localeCompare(
        String(itemDate(a.item) ?? ""),
      ),
    )
    .slice(0, 12);
  return (
    <Panel title={title}>
      {sorted.length ? (
        <div className="divide-y divide-border">
          {sorted.map(({ kind, item }) => (
            <div
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              key={item.id}
            >
              <RecordIcon kind={kind} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {recordTitle(kind, item)}
                </p>
                <p className="mt-0.5 truncate text-xs text-ink-muted">
                  {item.flock?.name ?? "—"} ·{" "}
                  {formatBusinessDay(itemDate(item))}
                </p>
              </div>
              <Badge
                variant={
                  kind === "mortality" && num(item.deathCount) > 0
                    ? "serious"
                    : "neutral"
                }
              >
                {label(kind)}
              </Badge>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title={empty} />
      )}
    </Panel>
  );
}
function RecordIcon({ kind }: { kind: string }) {
  const Icon =
    kind === "feed"
      ? Wheat
      : kind === "water"
        ? Droplets
        : kind === "weights"
          ? Scale
          : kind === "eggs"
            ? Egg
            : kind === "mortality"
              ? HeartPulse
              : ClipboardCheck;
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-subtle text-brand">
      <Icon className="size-4" aria-hidden />
    </span>
  );
}
function recordTitle(kind: string, item: Row) {
  if (kind === "feed")
    return (
      formatQuantity(num(item.quantityKg), "kg") +
      " · " +
      String(item.feedName ?? "Feed")
    );
  if (kind === "water")
    return formatQuantity(num(item.volumeLiters), "L") + " water";
  if (kind === "weights")
    return formatQuantity(num(item.averageWeightG), "g", 0) + " average weight";
  if (kind === "eggs")
    return formatQuantity(num(item.totalEggs), null, 0) + " eggs";
  if (kind === "mortality")
    return formatQuantity(num(item.deathCount), null, 0) + " bird deaths";
  return formatQuantity(num(item.liveBirdCount), null, 0) + " live birds";
}

function EntryForm({
  entry,
  change,
  date,
  flocks,
  submit,
  cancel,
  loading,
  copy,
}: {
  entry: "daily-records" | "feed" | "water" | "weights" | "eggs" | "mortality";
  change: (
    value:
      "daily-records" | "feed" | "water" | "weights" | "eggs" | "mortality",
  ) => void;
  date: string;
  flocks: Flock[];
  submit: (event: FormEvent<HTMLFormElement>) => void;
  cancel: () => void;
  loading: boolean;
  copy: any;
}) {
  const [selectedFlockId, setSelectedFlockId] = useState("");
  const fr = Boolean(copy.fr);
  const tr = (english: string, french: string) => (fr ? french : english);
  const selectedFlock = flocks.find(
    (flock) => flock.id === (selectedFlockId || flocks[0]?.id),
  );
  const eggEligible = ["layer", "breeder"].includes(
    String(selectedFlock?.productionType ?? selectedFlock?.birdType ?? ""),
  );
  const options: Array<[typeof entry, string]> = [
    ["daily-records", tr("Live birds", "Oiseaux vivants")],
    ["feed", tr("Feed issued", "Aliment distribue")],
    ["water", tr("Water", "Eau")],
    ["weights", tr("Weight sample", "Echantillon poids")],
    ["eggs", tr("Egg collection", "Collecte oeufs")],
    ["mortality", tr("Mortality", "Mortalite")],
  ];
  return (
    <form className="mt-5 space-y-4" onSubmit={submit}>
      <Field
        label={tr("Record type", "Type enregistrement")}
        htmlFor="entry-type"
      >
        <select
          value={entry}
          onChange={(event) => change(event.target.value as typeof entry)}
          className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
        >
          {options
            .filter(([value]) => value !== "eggs" || eggEligible)
            .map(([value, name]) => (
              <option value={value} key={value}>
                {name}
              </option>
            ))}
        </select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("Flock", "Lot")} htmlFor="entry-flock" required>
          <select
            name="flockId"
            value={selectedFlockId || flocks[0]?.id || ""}
            onChange={(event) => {
              const next = event.target.value;
              setSelectedFlockId(next);
              const flock = flocks.find((item) => item.id === next);
              if (
                entry === "eggs" &&
                !["layer", "breeder"].includes(
                  String(flock?.productionType ?? flock?.birdType ?? ""),
                )
              )
                change("feed");
            }}
            required
            className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
          >
            {flocks.map((flock) => (
              <option value={flock.id} key={flock.id}>
                {flock.name} · {flock.code}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr("Date", "Date")} htmlFor="entry-date" required>
          <Input name="date" type="date" defaultValue={date} required />
        </Field>
      </div>
      {entry === "daily-records" ? (
        <Grid>
          <NumberField
            name="liveBirdCount"
            label={tr(
              "Physical live bird count",
              "Comptage physique oiseaux vivants",
            )}
            required
          />
          <NumberField
            name="arrivalsCount"
            label={tr("Arrivals", "Arrivees")}
            initial="0"
          />
          <NumberField
            name="transfersOutCount"
            label={tr("Transfers out", "Transferts sortants")}
            initial="0"
          />
          <NumberField
            name="cullsCount"
            label={tr("Culls", "Reformes")}
            initial="0"
          />
          <NumberField
            name="temperatureC"
            label={tr("Temperature (°C)", "Temperature (C)")}
            decimal
          />
          <NumberField
            name="humidityPercent"
            label={tr("Humidity (%)", "Humidite (%)")}
            decimal
          />
        </Grid>
      ) : null}
      {entry === "feed" ? (
        <Grid>
          <TextField
            name="feedName"
            label={tr("Feed name", "Nom aliment")}
            required
          />
          <SelectField
            name="feedStage"
            label={tr("Feed stage", "Phase aliment")}
            fr={fr}
            values={[
              "starter",
              "grower",
              "finisher",
              "layer",
              "breeder",
              "medicated",
              "other",
            ]}
          />
          <NumberField
            name="quantityKg"
            label={tr("Quantity (kg)", "Quantite (kg)")}
            required
            decimal
          />
          <NumberField
            name="bagCount"
            label={tr("Bag count", "Nombre de sacs")}
            initial="0"
            decimal
          />
          <TextField
            name="batchNumber"
            label={tr("Batch number", "Numero de lot")}
          />
        </Grid>
      ) : null}
      {entry === "water" ? (
        <Grid>
          <NumberField
            name="volumeLiters"
            label={tr("Volume (L)", "Volume (L)")}
            required
            decimal
          />
          <TextField
            name="sourceName"
            label={tr("Water source", "Source eau")}
          />
        </Grid>
      ) : null}
      {entry === "weights" ? (
        <Grid>
          <NumberField
            name="sampleSize"
            label={tr("Sample size", "Taille echantillon")}
            required
          />
          <NumberField
            name="averageWeightG"
            label={tr("Average weight (g)", "Poids moyen (g)")}
            required
            decimal
          />
          <NumberField
            name="uniformityPercent"
            label={tr("Uniformity (%)", "Uniformite (%)")}
            decimal
          />
        </Grid>
      ) : null}
      {entry === "eggs" ? (
        <Grid>
          <NumberField
            name="totalEggs"
            label={tr("Total eggs", "Total oeufs")}
            required
          />
          <NumberField
            name="crackedEggs"
            label={tr("Cracked eggs", "Oeufs casses")}
            initial="0"
          />
          <NumberField
            name="dirtyEggs"
            label={tr("Dirty eggs", "Oeufs sales")}
            initial="0"
          />
          <NumberField
            name="hatchingEggs"
            label={tr("Hatching eggs", "Oeufs a couver")}
            initial="0"
          />
          <NumberField
            name="rejectedEggs"
            label={tr("Other rejected eggs", "Autres oeufs rejetes")}
            initial="0"
          />
        </Grid>
      ) : null}
      {entry === "mortality" ? (
        <Grid>
          <NumberField
            name="deathCount"
            label={tr("Bird deaths", "Deces oiseaux")}
            required
          />
          <SelectField
            name="causeCategory"
            label={tr("Cause category", "Categorie cause")}
            fr={fr}
            values={[
              "unknown",
              "disease",
              "heat_stress",
              "cold_stress",
              "injury",
              "predation",
              "deformity",
              "management",
              "other",
            ]}
          />
          <TextField
            name="suspectedCause"
            label={tr("Suspected cause", "Cause suspectee")}
          />
          <SelectField
            name="postmortemStatus"
            label={tr("Post-mortem", "Post mortem")}
            fr={fr}
            values={["not_done", "pending", "done"]}
          />
          <SelectField
            name="disposalMethod"
            label={tr("Disposal method", "Methode elimination")}
            fr={fr}
            values={[
              "burial",
              "incineration",
              "composting",
              "rendering",
              "other",
            ]}
          />
          <TextField
            name="veterinarianName"
            label={tr("Veterinarian", "Veterinaire")}
          />
          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            <input name="requiresFollowUp" type="checkbox" />
            {tr("Requires follow-up", "Suivi necessaire")}
          </label>
        </Grid>
      ) : null}
      <Field label={tr("Notes", "Notes")} htmlFor="notes">
        <Textarea name="notes" />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" loading={loading}>
          <Check aria-hidden />
          {copy.save}
        </Button>
        <Button type="button" variant="ghost" onClick={cancel}>
          {copy.cancel}
        </Button>
      </div>
    </form>
  );
}
function fieldChoice(value: string, fr: boolean) {
  const labels: Record<string, string> = {
    starter: "Demarrage",
    grower: "Croissance",
    finisher: "Finition",
    layer: "Pondeuse",
    breeder: "Reproducteur",
    medicated: "Medicamente",
    other: "Autre",
    unknown: "Inconnue",
    disease: "Maladie",
    heat_stress: "Stress chaleur",
    cold_stress: "Stress froid",
    injury: "Blessure",
    predation: "Predation",
    deformity: "Malformation",
    management: "Gestion",
    not_done: "Non realise",
    pending: "En attente",
    done: "Termine",
    burial: "Enterrement",
    incineration: "Incinération",
    composting: "Compostage",
    rendering: "Equarrissage",
  };
  return fr ? (labels[value] ?? words(value)) : words(value);
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}
function NumberField({
  name,
  label,
  required,
  initial,
  decimal,
}: {
  name: string;
  label: string;
  required?: boolean;
  initial?: string;
  decimal?: boolean;
}) {
  return (
    <Field label={label} htmlFor={name} required={required}>
      <Input
        name={name}
        type="number"
        min="0"
        step={decimal ? "0.01" : "1"}
        defaultValue={initial}
        required={required}
      />
    </Field>
  );
}
function TextField({
  name,
  label,
  required,
  initial,
}: {
  name: string;
  label: string;
  required?: boolean;
  initial?: string;
}) {
  return (
    <Field label={label} htmlFor={name} required={required}>
      <Input name={name} defaultValue={initial} required={required} />
    </Field>
  );
}
function SelectField({
  name,
  label,
  values,
  fr = false,
}: {
  name: string;
  label: string;
  values: string[];
  fr?: boolean;
}) {
  return (
    <Field label={label} htmlFor={name}>
      <select
        name={name}
        defaultValue={values[0]}
        className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
      >
        {values.map((value) => (
          <option value={value} key={value}>
            {fieldChoice(value, fr)}
          </option>
        ))}
      </select>
    </Field>
  );
}

function HealthView({
  copy,
  list,
}: {
  copy: any;
  list: (resource: Resource) => Row[];
}) {
  const groups: Array<[string, Resource, LucideIcon]> = [
    ["Health events", "health", HeartPulse],
    ["Vaccinations", "vaccinations", ShieldCheck],
    ["Treatments", "treatments", Stethoscope],
    ["Biosecurity checks", "biosecurity", ShieldCheck],
    ["Sanitation", "sanitation", ThermometerSun],
    ["Reported losses", "losses", AlertTriangle],
  ];
  return (
    <section className="grid gap-5 xl:grid-cols-2">
      {groups.map(([title, resource, Icon]) => (
        <Panel
          key={resource}
          title={title}
          subtitle="Records from the last 60 days."
        >
          {list(resource).length ? (
            <div className="divide-y divide-border">
              {list(resource)
                .slice(0, 8)
                .map((item) => (
                  <HealthRow
                    key={item.id}
                    item={item}
                    resource={resource}
                    Icon={Icon}
                  />
                ))}

            </div>
          ) : (
            <EmptyState title={copy.noRecords} icon={Icon} />
          )}
        </Panel>
      ))}
    </section>
  );
}
function HealthRow({
  item,
  resource,
  Icon,
}: {
  item: Row;
  resource: Resource;
  Icon: LucideIcon;
}) {
  const level = String(item.severity ?? item.riskLevel ?? "low");
  const title =
    resource === "health"
      ? label(String(item.eventType ?? "health event"))
      : resource === "vaccinations"
        ? String(item.vaccineName ?? "Vaccination")
        : resource === "treatments"
          ? String(item.productName ?? "Treatment")
          : resource === "biosecurity"
            ? label(String(item.checkType ?? "check"))
            : resource === "sanitation"
              ? label(String(item.activityType ?? "sanitation"))
              : label(String(item.lossType ?? "loss"));
  const detail =
    resource === "health"
      ? String(item.symptoms ?? item.diagnosis ?? "No description")
      : resource === "vaccinations"
        ? String(item.administeredBy ?? item.manufacturer ?? "Recorded")
        : resource === "treatments"
          ? String(item.reason ?? "Recorded")
          : String(item.actionTaken ?? item.description ?? "Recorded");
  return (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-brand">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-ink">{title}</p>
          {resource === "health" || resource === "biosecurity" ? (
            <Badge variant={severityVariant(level)}>{label(level)}</Badge>
          ) : null}
        </div>
        <p className="mt-1 line-clamp-1 text-xs text-ink-secondary">{detail}</p>
        <p className="mt-1 text-xs text-ink-muted">
          {item.flock?.name ?? item.house?.name ?? "—"} ·{" "}
          {formatBusinessDay(itemDate(item))}
        </p>
      </div>
    </div>
  );
}

function operationalWorkText(item: Work, fr: boolean) {
  if (!fr) return { title: item.title, details: item.details };
  const content: Record<string, { title: string; details: string }> = {
    live_bird_check: {
      title: "Compter les oiseaux vivants",
      details:
        "Enregistrez le comptage physique afin de le comparer au nombre d’oiseaux attendu.",
    },
    feed_record: {
      title: "Distribuer et enregistrer l’aliment",
      details:
        "Saisissez le nom de l’aliment, la phase, le lot et la quantité distribuée aujourd’hui.",
    },
    water_record: {
      title: "Contrôler et enregistrer l’eau",
      details:
        "Vérifiez la disponibilité de l’eau puis enregistrez le volume consommé aujourd’hui.",
    },
    weight_check: {
      title: "Peser un échantillon du lot",
      details:
        "Saisissez un poids moyen représentatif pour suivre la croissance du lot.",
    },
    climate_check: {
      title: "Contrôler le climat du bâtiment",
      details:
        "Vérifiez ventilation, chaleur et eau, puis enregistrez température et humidité.",
    },
    mortality_review: {
      title: "Vérifier la mortalité et l’état du lot",
      details:
        "Confirmez les décès, réformes, symptômes et actions de suivi du jour.",
    },
    egg_collection: {
      title: "Collecter et trier les œufs",
      details:
        "Enregistrez les œufs totaux, cassés, sales et rejetés du jour.",
    },
    vaccination: {
      title: "Effectuer la vaccination prévue",
      details:
        "Administrez le vaccin prévu puis enregistrez l’administration dans le registre sanitaire.",
    },
    health_follow_up: {
      title: "Suivre les événements de santé ouverts",
      details:
        "Vérifiez les symptômes, les oiseaux touchés et les actions demandées avant de clôturer la journée.",
    },
    treatment_follow_up: {
      title: "Confirmer le traitement en cours",
      details:
        "Contrôlez l’administration, le dosage et les exigences de retrait du traitement actif.",
    },
    biosecurity_check: {
      title: "Effectuer l’inspection de biosécurité",
      details:
        "Réalisez et enregistrez la vérification de biosécurité du bâtiment.",
    },
    performance_model_setup: {
      title: "Attribuer un modèle de performance",
      details:
        "Sélectionnez un modèle compatible afin de calculer les objectifs d’aliment, eau, poids, mortalité et vaccination.",
    },
  };
  return content[item.workType ?? ""] ?? {
    title: item.title,
    details: item.details,
  };
}
function OperationalAnalysis({
  brief,
  fr,
}: {
  brief: Performance["operationalBrief"];
  fr: boolean;
}) {
  if (!brief) return null;
  const metrics: Array<{
    key: string;
    label: string;
    icon: LucideIcon;
  }> = [
    { key: "liveBirds", label: fr ? "Comptage" : "Bird count", icon: Bird },
    { key: "feed", label: fr ? "Aliment" : "Feed", icon: Wheat },
    { key: "water", label: fr ? "Eau" : "Water", icon: Droplets },
    { key: "weight", label: fr ? "Poids" : "Weight", icon: Scale },
    {
      key: "temperature",
      label: fr ? "Température" : "Temperature",
      icon: ThermometerSun,
    },
    { key: "humidity", label: fr ? "Humidité" : "Humidity", icon: Activity },
  ];
  const missing = metrics.filter((metric) => !brief.recordStatus[metric.key]);
  const state =
    brief.readiness === "ready"
      ? {
          text: fr ? "Données prêtes" : "Data ready",
          variant: "good" as const,
          description: fr
            ? "Les relevés nécessaires sont disponibles pour la lecture opérationnelle du jour."
            : "The required records are available for today’s operational review.",
        }
      : brief.readiness === "attention"
        ? {
            text: fr ? "Attention requise" : "Attention needed",
            variant: "serious" as const,
            description: fr
              ? "Une valeur critique ou une alerte du modèle demande une vérification prioritaire."
              : "A critical value or model alert needs priority review.",
          }
        : brief.readiness === "needs_setup"
          ? {
              text: fr ? "Configuration requise" : "Setup required",
              variant: "warning" as const,
              description: fr
                ? "Aucun objectif n’est inventé : attribuez un modèle et configurez les objectifs de la semaine."
                : "No target is guessed: assign a model and configure this week’s targets.",
            }
          : {
              text: fr ? "Relevés à compléter" : "Records to complete",
              variant: "warning" as const,
              description: fr
                ? "Complétez les relevés manquants pour obtenir une comparaison fiable."
                : "Complete the missing records for a reliable comparison.",
            };
  return (
    <section className="relative overflow-hidden rounded-2xl border border-brand/20 bg-gradient-to-br from-brand-subtle via-surface-1 to-sky-500/10 p-5 shadow-[0_18px_44px_-34px_rgba(15,23,42,.55)] dark:from-brand/15 dark:via-surface-1 dark:to-sky-950/35">
      <div className="pointer-events-none absolute -right-10 -top-10 grid size-40 place-items-center rounded-full bg-brand/10 dark:bg-brand/15">
        <Bird className="size-20 text-brand/35" aria-hidden />
      </div>
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-xl bg-brand text-white shadow-sm">
              <Sparkles className="size-4" aria-hidden />
            </span>
            <p className="text-sm font-semibold text-ink">
              {fr ? "Analyse opérationnelle du jour" : "Today’s operational analysis"}
            </p>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-secondary">
            {state.description}
          </p>
        </div>
        <Badge variant={state.variant}>{state.text}</Badge>
      </div>
      <div className="relative mt-5 grid gap-3 sm:grid-cols-3">
        <Small
          label={fr ? "Données terrain" : "Field data"}
          value={`${brief.dataCoverage.available}/${brief.dataCoverage.required} · ${brief.dataCoverage.percent}%`}
        />
        <Small
          label={fr ? "Modèle" : "Model"}
          value={
            brief.modelAssigned
              ? brief.weeklyTargetConfigured
                ? fr
                  ? "Modèle + objectif"
                  : "Model + target"
                : fr
                  ? "Objectif hebdo absent"
                  : "Weekly target missing"
              : fr
                ? "À attribuer"
                : "Assign model"
          }
        />
        <Small
          label={fr ? "Comptage physique" : "Physical count"}
          value={
            brief.physicalCountDiscrepancy == null
              ? fr
                ? "À enregistrer"
                : "Record needed"
              : brief.physicalCountDiscrepancy === 0
                ? fr
                  ? "Concordant"
                  : "Matches expected"
                : `${brief.physicalCountDiscrepancy > 0 ? "+" : ""}${formatQuantity(brief.physicalCountDiscrepancy, null, 0)} ${fr ? "écart" : "difference"}`
          }
        />
      </div>
      {missing.length ? (
        <div className="relative mt-5 rounded-xl border border-warning/30 bg-warning/10 p-3">
          <p className="text-xs font-semibold uppercase tracking-[.1em] text-warning-ink">
            {fr ? "À compléter aujourd’hui" : "Complete today"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {missing.map((metric) => {
              const Icon = metric.icon;
              return (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-warning/25 bg-surface-1 px-2.5 py-1 text-xs font-medium text-ink"
                  key={metric.key}
                >
                  <Icon className="size-3.5 text-warning-ink" aria-hidden />
                  {metric.label}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
function PerformanceView({
  copy,
  flock,
  data,
  loading,
  failed,
  retry,
  work,
  workLoading,
  canGenerate,
  canApprove,
  busy,
  generate,
  complete,
  approve,
}: {
  copy: any;
  flock: Flock | null;
  data?: Performance;
  loading: boolean;
  failed: boolean;
  retry: () => void;
  work: Work[];
  workLoading: boolean;
  canGenerate: boolean;
  canApprove: boolean;
  busy: boolean;
  generate: () => void;
  complete: (id: string) => void;
  approve: (id: string) => void;
}) {
  const fr = Boolean(copy.fr);
  if (!flock)
    return (
      <EmptyState
        className="rounded-2xl border border-dashed border-border-strong bg-surface-1"
        title={fr ? "Selectionnez un lot" : "Select a flock"}
        description={
          fr
            ? "Choisissez un lot dans la vue generale."
            : "Choose a flock in Overview first."
        }
        icon={Bird}
      />
    );
  if (loading)
    return (
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,.8fr)]">
        <Skeleton className="h-[450px]" />
        <Skeleton className="h-[450px]" />
      </div>
    );
  if (failed || !data)
    return (
      <ErrorState
        description={
          fr
            ? "Le calcul de performance est indisponible."
            : "The performance calculation could not be loaded."
        }
        onRetry={retry}
      />
    );
  const layerFlock = ["layer", "breeder"].includes(
    String(
      data.flock.productionType ?? flock.productionType ?? flock.birdType ?? "",
    ),
  );
  const comparisons: Array<[string, Compare | undefined, string]> = [
    [fr ? "Aliment" : "Feed", data.comparisons.feed, "kg"],
    [
      fr ? "Aliment cumule" : "Cumulative feed",
      data.comparisons.cumulativeFeed,
      "g/oiseau",
    ],
    [fr ? "Eau" : "Water", data.comparisons.water, "L"],
    [fr ? "Poids moyen" : "Average weight", data.comparisons.weight, "g"],
    [fr ? "Gain quotidien" : "Daily gain", data.comparisons.dailyGain, "g"],
    ["FCR", data.comparisons.feedConversionRatio, ""],
    [
      fr ? "Mortalite cumulee" : "Cumulative mortality",
      data.comparisons.cumulativeMortality,
      "%",
    ],
    [
      fr ? "Oiseaux vivants prevus" : "Expected live birds",
      data.comparisons.expectedLiveBirds,
      "%",
    ],
    [fr ? "Temperature" : "Temperature", data.comparisons.temperature, "°C"],
    [fr ? "Humidite" : "Humidity", data.comparisons.humidity, "%"],
    ...(layerFlock
      ? ([
          [
            fr ? "Taux de ponte" : "Egg lay rate",
            data.comparisons.eggLayRate,
            "%",
          ],
          [
            fr ? "Nombre oeufs" : "Egg count",
            data.comparisons.eggCount,
            "oeufs",
          ],
          [
            fr ? "Taux oeufs rejetes" : "Rejected egg rate",
            data.comparisons.rejectedEggRate,
            "%",
          ],
        ] as Array<[string, Compare | undefined, string]>)
      : []),
  ];
  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,.8fr)]">
      <div className="space-y-5">
        <section className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-surface-1 via-surface-1 to-brand-subtle/25 shadow-[0_18px_44px_-30px_rgba(15,23,42,.42)] dark:shadow-[0_18px_44px_-30px_rgba(0,0,0,.9)]">
          <div className="bg-[linear-gradient(110deg,#effdf7_0%,#f0f9ff_100%)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
                  {data.flock.code}
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
                  {data.flock.name}
                </h2>
                <p className="mt-1 text-sm text-ink-secondary">
                  {data.flock.house?.name ?? flock.house?.name ?? "—"} ·{" "}
                  {data.flock.site?.name ?? flock.site?.name ?? "—"}
                </p>
              </div>
              <Badge variant={data.model ? "good" : "warning"}>
                {data.model?.name ??
                  (fr ? "Aucun modele de performance" : "No performance model")}
              </Badge>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              <Small
                label={fr ? "Age" : "Age"}
                value={data.age.ageDays + (fr ? " jours" : " days")}
              />
              <Small
                label={fr ? "Semaine" : "Week"}
                value={String(data.age.ageWeek)}
              />
              <Small
                label={fr ? "Oiseaux vivants" : "Live birds"}
                value={formatQuantity(data.flock.liveBirdCount, null, 0)}
              />
              <Small
                label={fr ? "Climat" : "Climate"}
                value={
                  data.model?.climateProfile?.name ??
                  (fr ? "Non assigne" : "Not assigned")
                }
              />
            </div>
          </div>
          <div className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">
                  {fr ? "Comparaison au modele" : "Model comparison"}
                </h3>
                <p className="mt-1 text-xs text-ink-secondary">
                  {fr
                    ? "Resultats compares aux objectifs de la semaine " +
                      data.age.ageWeek +
                      " et aux ajustements climatiques."
                    : "Actual results are compared with week " +
                      data.age.ageWeek +
                      " targets and climate adjustments."}
                </p>
              </div>
              <Badge variant={data.weeklyTarget ? "info" : "warning"}>
                {data.weeklyTarget
                  ? (fr ? "Semaine " : "Week ") + data.weeklyTarget.weekNumber
                  : fr
                    ? "Objectif absent"
                    : "Target missing"}
              </Badge>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {comparisons.map(([title, compare, unit]) => (
                <CompareCard
                  key={title}
                  title={title}
                  compare={compare}
                  unit={unit}
                  fr={fr}
                />
              ))}
            </div>
          </div>
        </section>
        <OperationalAnalysis brief={data.operationalBrief} fr={fr} />        <Panel
          title={copy.recommendations}
          subtitle={
            fr
              ? "Calcule selon age du lot, saisies terrain, modele, climat et calendrier vaccinal."
              : "Calculated from flock age, field records, model, climate and vaccine schedule."
          }
        >
          {data.recommendations.length ? (
            <div className="space-y-3">
              {data.recommendations.map((item, index) => (
                <div
                  className={
                    "relative overflow-hidden rounded-2xl border p-4 shadow-[0_14px_30px_-26px_rgba(15,23,42,.38)] transition duration-200 hover:-translate-y-0.5 hover:shadow-md " +
                    (item.severity === "critical"
                      ? "border-critical/35 bg-critical/10"
                      : item.severity === "warning"
                        ? "border-warning/40 bg-warning/10"
                        : "border-brand/25 bg-brand-subtle")
                  }
                  key={item.category + index}
                >
                  <div className="flex gap-3">
                    <AlertTriangle
                      className={
                        "mt-0.5 size-4 shrink-0 " +
                        (item.severity === "critical"
                          ? "text-critical"
                          : item.severity === "warning"
                            ? "text-warning-ink"
                            : "text-brand")
                      }
                      aria-hidden
                    />
                    <div>
                      <p className="text-sm font-semibold text-ink">
                        {item.message}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-ink-secondary">
                        {item.action}
                      </p>
                    </div>
                  </div>
                </div>
              ))}

            </div>
          ) : (
            <EmptyState
              title={
                fr
                  ? "Aucune recommandation ce jour."
                  : "No recommendation today."
              }
              icon={Sparkles}
            />
          )}
        </Panel>
      </div>
      <aside className="space-y-5">
        <Panel
          title={copy.work}
          subtitle={
            fr
              ? "Générée à partir de l’âge, des relevés réels, du modèle, du climat et des vaccins du lot."
              : "Generated from flock age, actual records, model, climate and vaccinations."
          }
          action={
            canGenerate ? (
              <Button size="sm" onClick={generate} loading={busy}>
                <Sparkles aria-hidden />
                {fr ? "Générer" : "Generate"}
              </Button>
            ) : undefined
          }
        >
          {workLoading ? (
            <Skeleton className="h-44" />
          ) : work.length ? (
            <div className="space-y-3">
              {work.map((item) => {
                const text = operationalWorkText(item, fr);
                return (
                <div
                  className="rounded-xl border border-border p-3"
                  key={item.id}
                >
                  <div className="flex gap-3">
                    <span
                      className={
                        "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full " +
                        (item.status === "completed"
                          ? "bg-good/15 text-good-ink"
                          : "bg-brand-subtle text-brand")
                      }
                    >
                      <Check className="size-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">
                        {text.title}
                      </p>
                      {text.details ? (
                        <p className="mt-1 text-xs leading-5 text-ink-secondary">
                          {text.details}
                        </p>
                      ) : null}
                      {item.assignedMember ? (
                        <p className="mt-2 text-xs font-medium text-ink-secondary">
                          {item.assignedMember.fullName ??
                            "Assigned team member"}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-warning-ink">
                          {fr ? "Non assigne" : "Unassigned"}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              item.status === "completed"
                                ? "good"
                                : item.status === "overdue"
                                  ? "critical"
                                  : "info"
                            }
                          >
                            {label(item.status)}
                          </Badge>
                          {item.requiresSupervisorApproval ? (
                            <Badge
                              variant={
                                item.approvalStatus === "approved"
                                  ? "good"
                                  : item.approvalStatus === "returned"
                                    ? "warning"
                                    : "neutral"
                              }
                            >
                              {label(item.approvalStatus ?? "pending")}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {item.status !== "completed" && canGenerate ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => complete(item.id)}
                              loading={busy}
                            >
                              {copy.complete}
                            </Button>
                          ) : null}
                          {item.status === "completed" &&
                          item.requiresSupervisorApproval &&
                          item.approvalStatus === "pending" &&
                          canApprove ? (
                            <Button
                              size="sm"
                              onClick={() => approve(item.id)}
                              loading={busy}
                            >
                              {fr ? "Approuver" : "Approve"}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
              })}
            </div>
          ) : (
            <EmptyState
              title={fr ? "Aucune tâche générée" : "No work generated yet"}
              description={
                fr
                  ? "Générez la liste de contrôle : même sans modèle, LiteHubs crée les relevés et inspections nécessaires pour aujourd’hui."
                  : "Generate the checklist: even without a model, LiteHubs creates today’s required records and inspections."
              }
              icon={ClipboardCheck}
            />
          )}
        </Panel>
        <Panel
          title={fr ? "Calendrier vaccinal" : "Vaccination schedule"}
          subtitle={
            fr
              ? "Les echeances suivent age du lot et son modele assigne."
              : "Due schedules follow flock age and its assigned model."
          }
        >
          {data.vaccines.length ? (
            <div className="space-y-3">
              {data.vaccines.map((item) => (
                <div className="flex items-start gap-3" key={item.id}>
                  <span
                    className={
                      "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg " +
                      (item.status === "due"
                        ? "bg-critical/10 text-critical"
                        : "bg-good/10 text-good-ink")
                    }
                  >
                    <ShieldCheck className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-ink">
                        {item.vaccineName}
                      </p>
                      <Badge
                        variant={item.status === "due" ? "critical" : "good"}
                      >
                        {label(item.status)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {fr ? "Jour" : "Day"} {item.dayAge}
                      {item.dose ? " · " + item.dose : ""}
                    </p>
                  </div>
                </div>
              ))}

            </div>
          ) : (
            <EmptyState
              title={
                fr
                  ? "Aucun vaccin prevu a cet age."
                  : "No vaccine is due at this age."
              }
              icon={ShieldCheck}
            />
          )}
        </Panel>
      </aside>
    </section>
  );
}
function CompareCard({
  title,
  compare,
  unit,
  fr,
}: {
  title: string;
  compare?: Compare;
  unit: string;
  fr: boolean;
}) {
  const status = compare?.status ?? "not_configured";
  const variant =
    status === "on_target"
      ? "good"
      : status === "above_target"
        ? "serious"
        : status === "below_target"
          ? "warning"
          : "neutral";
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <Badge variant={variant}>{label(status)}</Badge>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Small
          label={fr ? "Reel" : "Actual"}
          value={
            compare?.actual == null
              ? "—"
              : formatQuantity(compare.actual, unit, unit === "%" ? 2 : 1)
          }
        />
        <Small
          label={fr ? "Objectif" : "Target"}
          value={
            compare?.target == null
              ? "—"
              : formatQuantity(compare.target, unit, unit === "%" ? 2 : 1)
          }
        />
      </div>
      {compare?.variancePercent != null ? (
        <p className="mt-3 text-xs text-ink-secondary">
          {fr ? "Ecart :" : "Variance:"}{" "}
          <span className="font-semibold text-ink">
            {formatPercent(compare.variancePercent, 1)}
          </span>
        </p>
      ) : null}
    </div>
  );
}
function SetupView({
  copy,
  houses,
  flocks,
  models,
  targets,
}: {
  copy: any;
  houses: House[];
  flocks: Flock[];
  models: Model[];
  targets: Target[];
}) {
  return (
    <section className="space-y-5">
      <Panel
        title="Production foundation"
        subtitle="Houses and flocks hold the real data. Performance models contain editable standards, never hard-coded rules."
      >
        <p className="text-sm leading-6 text-ink-secondary">
          To calculate properly, create a house, start a flock with its real
          hatch or arrival date, then assign the appropriate broiler or layer
          model. The model can vary by strain, region and climate.
        </p>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title={copy.houses} subtitle={houses.length + " configured"}>
          {houses.length ? (
            <div className="space-y-3">
              {houses.map((house) => (
                <div
                  className="rounded-xl border border-border p-3"
                  key={house.id}
                >
                  <p className="text-sm font-semibold text-ink">{house.name}</p>
                  <p className="mt-1 text-xs text-ink-secondary">
                    {house.code} · {label(house.houseType)} ·{" "}
                    {formatQuantity(house.capacity, null, 0)} capacity
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {house.site?.name ?? "—"}
                  </p>
                </div>
              ))}

            </div>
          ) : (
            <EmptyState title="No houses configured." icon={Bird} />
          )}
        </Panel>
        <Panel
          title={copy.models}
          subtitle="Broiler, layer, climate and strain standards."
        >
          {models.length ? (
            <div className="space-y-2">
              {models.map((model) => (
                <div
                  className="rounded-xl border border-border p-3"
                  key={model.id}
                >
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {model.name}
                      </p>
                      <p className="mt-1 truncate text-xs text-ink-secondary">
                        {model.code} · {label(model.productionType)}
                        {model.strain ? " · " + model.strain : ""}
                      </p>
                    </div>
                    <Badge variant={model.isActive ? "good" : "neutral"}>
                      {model.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs text-ink-muted">
                    {model.climateProfile?.name ?? "No climate profile"} · v
                    {model.version}
                  </p>
                </div>
              ))}

            </div>
          ) : (
            <EmptyState
              title="No performance model configured."
              icon={Sparkles}
            />
          )}
        </Panel>
        <Panel
          title={copy.targets}
          subtitle="Weekly standards used by the calculation model."
        >
          {targets.length ? (
            <div className="space-y-2">
              {targets.map((target) => (
                <div
                  className="rounded-xl border border-border p-3"
                  key={target.id}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">
                      Week {target.weekNumber}
                    </p>
                    <Badge variant="info">±{target.tolerancePercent}%</Badge>
                  </div>
                  <p className="mt-2 text-xs text-ink-secondary">
                    {target.targetWeightG != null
                      ? formatQuantity(target.targetWeightG, "g", 0) + " weight"
                      : "—"}{" "}
                    ·{" "}
                    {target.feedGPerBirdPerDay != null
                      ? formatQuantity(target.feedGPerBirdPerDay, "g/bird", 0) +
                        " feed"
                      : "—"}
                  </p>
                </div>
              ))}

            </div>
          ) : (
            <EmptyState title="No weekly targets yet." icon={Scale} />
          )}
        </Panel>
      </div>
      <Panel
        title="Active flock foundation"
        subtitle="The API applies each member’s province/site scope before it returns these records."
      >
        {flocks.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {flocks.map((flock) => (
              <div
                className="rounded-xl border border-border p-4"
                key={flock.id}
              >
                <p className="text-sm font-semibold text-ink">{flock.name}</p>
                <p className="mt-1 text-xs text-ink-secondary">
                  {flock.house?.name ?? "—"} ·{" "}
                  {label(flock.productionType ?? flock.birdType)}
                </p>
                <p className="mt-3 text-xs text-ink-muted">
                  {formatQuantity(flock.currentBirdCount, null, 0)} birds ·{" "}
                  {formatQuantity(flock.totalMortality, null, 0)} total
                  mortality
                </p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={copy.noRecords} icon={Bird} />
        )}
      </Panel>
    </section>
  );
}
