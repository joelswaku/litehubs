"use client";

import {
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
  Check,
  ClipboardList,
  Leaf,
  MapPinned,
  Plus,
  Sprout,
  Trash2,
  Wheat,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/ui/states";
import { ApiError, get, orgUrl } from "@/lib/api";
import {
  AGRICULTURE_RESOURCES,
  agricultureApi,
  type AgricultureResource,
} from "@/lib/agriculture-api";
import { can } from "@/lib/permissions";
import { formatBusinessDay, formatQuantity } from "@/lib/utils";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type Area = "setup" | "planning" | "fieldwork" | "monitoring";
type Place = { id: string; name?: string | null; code?: string | null };
type Item = Record<string, unknown> & {
  id: string;
  name?: string | null;
  code?: string | null;
  site?: Place | null;
  farm?: Place | null;
  field?: Place | null;
  plot?: Place | null;
  crop?: Place | null;
  season?: Place | null;
  planting?: Place | null;
};
type Site = {
  id: string;
  name: string;
  code?: string | null;
  province?: Place | null;
};
type Editor = { resource: AgricultureResource; item?: Item };

const permissionResource: Record<AgricultureResource, string> = {
  farms: "farms",
  fields: "fields",
  plots: "plots",
  crops: "crops",
  seasons: "seasons",
  plantings: "plantings",
  operations: "operations",
  irrigation: "irrigation",
  fertilizer: "fertilizer",
  pesticides: "pesticides",
  scouting: "scouting",
  weather: "weather",
  harvest: "harvest",
  "production-targets": "production_targets",
  losses: "losses",
};

const areaResources: Record<Area, AgricultureResource[]> = {
  setup: ["farms", "fields", "plots", "crops", "seasons"],
  planning: ["plantings", "production-targets"],
  fieldwork: [
    "operations",
    "irrigation",
    "fertilizer",
    "pesticides",
    "harvest",
    "losses",
  ],
  monitoring: ["scouting", "weather"],
};

const resourceNames: Record<AgricultureResource, { fr: string; en: string }> = {
  farms: { fr: "Fermes", en: "Farms" },
  fields: { fr: "Champs", en: "Fields" },
  plots: { fr: "Parcelles", en: "Plots" },
  crops: { fr: "Cultures", en: "Crops" },
  seasons: { fr: "Saisons", en: "Seasons" },
  plantings: { fr: "Plantations", en: "Plantings" },
  operations: { fr: "Opérations", en: "Operations" },
  irrigation: { fr: "Irrigation", en: "Irrigation" },
  fertilizer: { fr: "Fertilisation", en: "Fertilizer" },
  pesticides: { fr: "Traitements phytosanitaires", en: "Pesticides" },
  scouting: { fr: "Observations terrain", en: "Scouting" },
  weather: { fr: "Météo", en: "Weather" },
  harvest: { fr: "Récoltes", en: "Harvest" },
  "production-targets": {
    fr: "Objectifs de production",
    en: "Production targets",
  },
  losses: { fr: "Pertes", en: "Losses" },
};

const areaCopy: Record<Area, { fr: [string, string]; en: [string, string] }> = {
  setup: {
    fr: ["Configuration", "Fermes, champs, parcelles, cultures et saisons"],
    en: ["Setup", "Farms, fields, plots, crops and seasons"],
  },
  planning: {
    fr: ["Planification", "Plantations et objectifs de rendement"],
    en: ["Planning", "Plantings and yield targets"],
  },
  fieldwork: {
    fr: ["Travaux de terrain", "Opérations, eau, intrants, récoltes et pertes"],
    en: ["Field work", "Operations, water, inputs, harvests and losses"],
  },
  monitoring: {
    fr: ["Suivi", "Observations sanitaires et météo"],
    en: ["Monitoring", "Crop observations and weather"],
  },
};

const labels: Record<string, string> = {
  Site: "Site",
  "Choose a site": "Sélectionner un site",
  Code: "Code",
  "Farm name": "Nom de la ferme",
  "Farm type": "Type de ferme",
  "Total area (ha)": "Superficie totale (ha)",
  "Farm manager": "Responsable de la ferme",
  Farm: "Ferme",
  "Choose a farm": "Sélectionner une ferme",
  "Field name": "Nom du champ",
  "Field area (ha)": "Superficie du champ (ha)",
  "Soil type": "Type de sol",
  "Irrigation source": "Source d’irrigation",
  Latitude: "Latitude",
  Longitude: "Longitude",
  Field: "Champ",
  "Choose a field": "Sélectionner un champ",
  "Plot name": "Nom de la parcelle",
  "Plot area (ha)": "Superficie de la parcelle (ha)",
  "Plot status": "Statut de la parcelle",
  "Crop name": "Nom de la culture",
  "Scientific name": "Nom scientifique",
  "Crop type": "Type de culture",
  Variety: "Variété",
  "Default growing days": "Durée de croissance par défaut (jours)",
  "Default yield unit": "Unité de rendement par défaut",
  "Season name": "Nom de la saison",
  "Season type": "Type de saison",
  "Start date": "Date de début",
  "End date": "Date de fin",
  "Planting name": "Nom de la plantation",
  Plot: "Parcelle",
  "Choose a plot": "Sélectionner une parcelle",
  Crop: "Culture",
  "Choose a crop": "Sélectionner une culture",
  "Season (optional)": "Saison (facultatif)",
  "No season": "Aucune saison",
  "Planting date": "Date de plantation",
  "Expected harvest date": "Date de récolte prévue",
  "Planted area (ha)": "Superficie plantée (ha)",
  "Seed quantity": "Quantité de semences",
  "Seed unit": "Unité de semences",
  "Planting method": "Méthode de plantation",
  "Plant density": "Densité de plantation",
  "Planting status": "Statut de la plantation",
  Planting: "Plantation",
  "Choose a planting": "Sélectionner une plantation",
  "Operation date": "Date de l’opération",
  "Operation type": "Type d’opération",
  Status: "Statut",
  Quantity: "Quantité",
  Unit: "Unité",
  "Labour hours": "Heures de travail",
  "Equipment used": "Équipement utilisé",
  "Irrigation date": "Date d’irrigation",
  "Irrigation method": "Méthode d’irrigation",
  "Water volume (L)": "Volume d’eau (L)",
  "Duration (minutes)": "Durée (minutes)",
  "Water source": "Source d’eau",
  "Application date": "Date d’application",
  "Product name": "Nom du produit",
  "Nutrient formula": "Formule nutritive",
  "Quantity (kg)": "Quantité (kg)",
  "Application method": "Méthode d’application",
  "Batch number": "Numéro de lot",
  "Active ingredient": "Matière active",
  "Target pest": "Ravageur ciblé",
  Dosage: "Dosage",
  "Pre-harvest interval (days)": "Délai avant récolte (jours)",
  "Scouting date": "Date d’observation",
  "Observation type": "Type d’observation",
  Severity: "Gravité",
  "Affected area (ha)": "Surface affectée (ha)",
  "Observed issue": "Problème observé",
  "Pest or disease": "Ravageur ou maladie",
  Recommendation: "Recommandation",
  "Observation status": "Statut de l’observation",
  "Weather date": "Date de relevé météo",
  "Rainfall (mm)": "Pluviométrie (mm)",
  "Minimum temperature (°C)": "Température minimale (°C)",
  "Maximum temperature (°C)": "Température maximale (°C)",
  "Humidity (%)": "Humidité (%)",
  "Wind speed (km/h)": "Vitesse du vent (km/h)",
  Conditions: "Conditions",
  "Harvest date": "Date de récolte",
  "Harvest quantity": "Quantité récoltée",
  "Quality grade": "Qualité",
  "Rejected quantity": "Quantité rejetée",
  "Moisture (%)": "Humidité (%)",
  "Storage location": "Lieu de stockage",
  "Target yield": "Rendement cible",
  "Target harvest date": "Date de récolte cible",
  "Quality target": "Objectif qualité",
  "Loss date": "Date de perte",
  "Loss type": "Type de perte",
  "Estimated value": "Valeur estimée",
  "Cause description": "Description de la cause",
  "Action taken": "Action menée",
  Notes: "Notes",
  "Field (required)": "Champ (obligatoire)",
  "Plot (optional)": "Parcelle (facultatif)",
  "Planting (optional)": "Plantation (facultatif)",
  "No plot": "Aucune parcelle",
  "No planting": "Aucune plantation",
};

const optionLabels: Record<string, string> = {
  crop: "Culture",
  livestock: "Élevage",
  mixed: "Mixte",
  nursery: "Pépinière",
  research: "Recherche",
  other: "Autre",
  cereal: "Céréale",
  legume: "Légumineuse",
  root_tuber: "Racine ou tubercule",
  vegetable: "Légume",
  fruit: "Fruit",
  oilseed: "Oléagineux",
  forage: "Fourrage",
  cash_crop: "Culture commerciale",
  tree: "Arbre",
  rainy: "Saison des pluies",
  dry: "Saison sèche",
  irrigated: "Irriguée",
  perennial: "Pérenne",
  available: "Disponible",
  planted: "Plantée",
  fallow: "En jachère",
  resting: "Au repos",
  quarantined: "En quarantaine",
  closed: "Clôturée",
  planned: "Planifiée",
  growing: "En croissance",
  harvested: "Récoltée",
  failed: "Échouée",
  abandoned: "Abandonnée",
  in_progress: "En cours",
  completed: "Terminée",
  cancelled: "Annulée",
  land_preparation: "Préparation du sol",
  planting: "Plantation",
  weeding: "Désherbage",
  pruning: "Taille",
  staking: "Tuteurage",
  mulching: "Paillage",
  harvesting: "Récolte",
  inspection: "Inspection",
  maintenance: "Maintenance",
  drip: "Goutte-à-goutte",
  sprinkler: "Aspersion",
  furrow: "Sillon",
  flood: "Inondation",
  manual: "Manuel",
  rainfed: "Pluvial",
  pest: "Ravageur",
  disease: "Maladie",
  weed: "Mauvaise herbe",
  nutrient_deficiency: "Carence nutritive",
  water_stress: "Stress hydrique",
  growth: "Croissance",
  soil: "Sol",
  weather_damage: "Dégât climatique",
  low: "Faible",
  medium: "Moyenne",
  high: "Élevée",
  critical: "Critique",
  open: "Ouverte",
  monitoring: "Sous surveillance",
  resolved: "Résolue",
  crop_damage: "Dégât aux cultures",
  drought: "Sécheresse",
  flood_loss: "Inondation",
  fire: "Incendie",
  theft: "Vol",
  input_spoilage: "Intrant avarié",
  equipment: "Équipement",
};

const text = (value: string, fr: boolean) =>
  fr ? (labels[value] ?? value) : value;
const optionText = (value: string, fr: boolean) =>
  fr ? (optionLabels[value] ?? title(value)) : title(value);
const resourceName = (resource: AgricultureResource, fr: boolean) =>
  resourceNames[resource][fr ? "fr" : "en"];
const areaName = (area: Area, fr: boolean) =>
  areaCopy[area][fr ? "fr" : "en"][0];
const areaDescription = (area: Area, fr: boolean) =>
  areaCopy[area][fr ? "fr" : "en"][1];
const title = (value?: unknown) =>
  String(value ?? "—")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const number = (value: unknown, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const dateValue = (value: unknown) =>
  typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : "";
const clearValue = (value: unknown) => (value == null ? "" : String(value));
function today() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}
function optional(form: FormData, name: string) {
  const value = String(form.get(name) ?? "").trim();
  return value || null;
}
function optionalNumber(form: FormData, name: string) {
  const value = String(form.get(name) ?? "").trim();
  return value === "" ? null : number(value);
}
function requiredNumber(form: FormData, name: string) {
  return number(form.get(name));
}
function normalizedCode(value: unknown, prefix: string) {
  const normalized = String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return undefined;
  const withPrefix = /^[a-z]/.test(normalized)
    ? normalized
    : `${prefix}_${normalized}`;
  return (withPrefix.replace(/_+/g, "_").slice(0, 63).replace(/_+$/g, "") || undefined);
}

export function AgricultureArea({ orgSlug }: { orgSlug: string }) {
  const user = useSessionUser();
  const { locale } = useLanguage();
  const client = useQueryClient();
  const fr = locale === "fr";
  const [area, setArea] = useState<Area>("setup");
  const [resource, setResource] = useState<AgricultureResource>("farms");
  const [siteId, setSiteId] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selected, setSelected] = useState<{
    resource: AgricultureResource;
    id: string;
  } | null>(null);
  const canDo = (
    item: AgricultureResource,
    action: "create" | "read" | "update" | "delete",
  ) => can(user, `agriculture.${permissionResource[item]}.${action}`);
  const sites = useQuery({
    queryKey: ["agriculture-sites", orgSlug],
    queryFn: () => get<{ sites: Site[] }>(orgUrl(orgSlug, "sites")),
    enabled: can(user, "sites.read"),
    select: (data) => data.sites,
  });
  const overview = useQuery({
    queryKey: ["agriculture-overview", orgSlug, siteId],
    queryFn: () =>
      agricultureApi.overview<{ overview: Record<string, unknown> }>(orgSlug, {
        siteId: siteId || undefined,
      }),
    enabled: canDo("farms", "read") || canDo("fields", "read"),
    select: (data) => data.overview,
  });
  const recordQueries = useQueries({
    queries: AGRICULTURE_RESOURCES.map((item) => ({
      queryKey: ["agriculture", orgSlug, item, siteId],
      queryFn: () =>
        agricultureApi.list<{ records: Item[] }>(orgSlug, item, {
          siteId: item === "crops" ? undefined : siteId || undefined,
          limit: 200,
        }),
      enabled: canDo(item, "read"),
      select: (data: { records: Item[] }) => data.records,
    })),
  });
  const records = (item: AgricultureResource) =>
    (recordQueries[AGRICULTURE_RESOURCES.indexOf(item)]?.data as
      Item[] | undefined) ?? [];
  const farms = records("farms");
  const fields = records("fields");
  const plots = records("plots");
  const crops = records("crops");
  const seasons = records("seasons");
  const plantings = records("plantings");
  const selectedRecord = useQuery({
    queryKey: ["agriculture-record", orgSlug, selected?.resource, selected?.id],
    queryFn: () =>
      agricultureApi.get<{ record: Item }>(
        orgSlug,
        selected!.resource,
        selected!.id,
      ),
    enabled: Boolean(selected) && canDo(selected!.resource, "read"),
    select: (data) => data.record,
  });
  useEffect(() => {
    if (!areaResources[area].includes(resource))
      setResource(areaResources[area][0] ?? "farms");
  }, [area, resource]);
  useEffect(() => {
    if (selected && selected.resource !== resource) setSelected(null);
  }, [resource, selected]);
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["agriculture", orgSlug] });
    client.invalidateQueries({ queryKey: ["agriculture-overview", orgSlug] });
  };
  const save = useMutation({
    mutationFn: ({
      current,
      item,
      body,
    }: {
      current: AgricultureResource;
      item?: Item;
      body: Record<string, unknown>;
    }) =>
      item
        ? agricultureApi.update(orgSlug, current, item.id, body)
        : agricultureApi.create(orgSlug, current, body),
    onSuccess: () => {
      setEditor(null);
      setSelected(null);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: ({
      current,
      id,
    }: {
      current: AgricultureResource;
      id: string;
    }) => agricultureApi.remove(orgSlug, current, id),
    onSuccess: () => {
      setSelected(null);
      refresh();
    },
  });
  const error = [
    overview.error,
    ...recordQueries.map((query) => query.error),
    selectedRecord.error,
    save.error,
    remove.error,
  ].find(Boolean);
  const message =
    error instanceof ApiError
      ? error.message
      : error
        ? fr
          ? "Une action n’a pas pu être enregistrée."
          : "An action could not be saved."
        : null;
  const visible = areaResources[area].filter((item) => canDo(item, "read"));
  const items = records(resource);

  if (!AGRICULTURE_RESOURCES.some((item) => canDo(item, "read")))
    return (
      <main className="grid min-h-[60dvh] place-items-center p-6">
        <EmptyState
          title={fr ? "Aucun accès à l’agriculture" : "No Agriculture access"}
          description={
            fr
              ? "Votre rôle ne possède aucune permission de lecture Agriculture."
              : "Your role has no Agriculture read permission."
          }
        />
      </main>
    );

  return (
    <main className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-6 lg:p-8">
      <section className="relative overflow-hidden rounded-3xl bg-[radial-gradient(circle_at_87%_12%,rgba(253,224,71,.28),transparent_23%),radial-gradient(circle_at_72%_94%,rgba(74,222,128,.18),transparent_34%),linear-gradient(123deg,#124436_0%,#16704d_52%,#355f22_100%)] px-5 py-7 text-white sm:px-7 sm:py-8">
        <Sprout
          className="absolute -right-4 -top-4 size-40 rotate-12 text-white/[.07]"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-lime-100">
              <span className="size-2 rounded-full bg-lime-300 shadow-[0_0_16px_rgba(190,242,100,.95)]" />
              {fr ? "Pilotage agricole" : "Crop operations"}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              {fr ? "Agriculture" : "Agriculture"}
            </h1>
            <p className="mt-3 text-sm leading-6 text-lime-50/90">
              {fr
                ? "Fermes, champs, cultures, intrants, observations et récoltes dans un espace unique et contrôlé."
                : "Farms, fields, crops, inputs, observations and harvests in one controlled workspace."}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {sites.data?.length ? (
              <label className="grid gap-1 text-xs font-medium text-lime-100">
                <span>{fr ? "Site / ferme" : "Site / farm"}</span>
                <select
                  value={siteId}
                  onChange={(event) => setSiteId(event.target.value)}
                  className="h-9 min-w-48 rounded-md border border-white/20 bg-white/10 px-3 text-sm text-white outline-none"
                >
                  <option value="" className="bg-surface-1 text-ink">
                    {fr ? "Tous les sites" : "All sites"}
                  </option>
                  {sites.data.map((site) => (
                    <option key={site.id} value={site.id} className="bg-surface-1 text-ink">
                      {site.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Button
              size="sm"
              className="border-white/20 bg-white text-emerald-900 hover:bg-lime-50"
              disabled={!canDo("farms", "create")}
              onClick={() => setEditor({ resource: "farms" })}
            >
              <Plus />
              {fr ? "Ajouter une ferme" : "Add farm"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              disabled={!canDo("plantings", "create")}
              onClick={() => setEditor({ resource: "plantings" })}
            >
              <Plus />
              {fr ? "Nouvelle plantation" : "New planting"}
            </Button>
          </div>
        </div>
        <div className="relative mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label={fr ? "Fermes" : "Farms"}
            value={number(overview.data?.farms)}
            icon={MapPinned}
          />
          <Metric
            label={fr ? "Champs" : "Fields"}
            value={number(overview.data?.fields)}
            icon={Leaf}
          />
          <Metric
            label={fr ? "Plantations actives" : "Active plantings"}
            value={number(overview.data?.activePlantings)}
            icon={Sprout}
          />
          <Metric
            label={fr ? "Récoltes · 30 jours" : "Harvest · 30 days"}
            value={formatQuantity(
              number(overview.data?.harvestQuantityLast30Days),
              "kg",
            )}
            icon={Wheat}
          />
        </div>
      </section>
      {message ? (
        <p
          role="alert"
          className="rounded-lg border border-critical/35 bg-critical/10 px-3 py-2 text-sm text-critical"
        >
          {message}
        </p>
      ) : null}
      <section className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)_340px]">
        <aside className="relative overflow-hidden rounded-3xl border border-border-strong/80 bg-surface-1 p-3 ring-1 ring-black/[.015] shadow-[0_18px_40px_-31px_rgba(9,35,67,.50)]">
          <div className="rounded-2xl border border-brand/15 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--brand)_9%,var(--surface-1)),var(--surface-1)_68%)] px-3.5 py-3.5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
                  {fr ? "Espaces de travail" : "Work areas"}
                </p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {areaName(area, fr)}
                </p>
                <p className="mt-0.5 text-xs text-ink-secondary">
                  {areaDescription(area, fr)}
                </p>
              </div>
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-subtle text-brand">
                <Sprout className="size-4" />
              </span>
            </div>
          </div>
          <nav
            className="mt-3 grid grid-cols-2 gap-1.5 rounded-2xl border border-border-strong/70 bg-surface-2/75 p-1.5"
            aria-label={fr ? "Espaces agricoles" : "Agriculture areas"}
          >
            {(["setup", "planning", "fieldwork", "monitoring"] as Area[]).map(
              (item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={area === item}
                  onClick={() => setArea(item)}
                  className={`flex min-h-11 items-center gap-2 rounded-xl border px-2.5 text-left text-xs font-semibold transition ${area === item ? "border-brand/20 bg-surface-1 text-brand shadow-sm" : "border-transparent text-ink-secondary hover:border-border hover:bg-surface-1 hover:text-ink"}`}
                >
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${area === item ? "bg-brand" : "bg-ink-muted/45"}`}
                  />
                  <span className="truncate">{areaName(item, fr)}</span>
                </button>
              ),
            )}
          </nav>
          <div className="mt-4 border-t border-border-strong/75 pt-4">
            <div className="flex items-center justify-between gap-2 px-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.12em] text-ink-muted">
                  {fr ? "Registres" : "Records"}
                </p>
                <p className="mt-0.5 text-xs text-ink-secondary">
                  {areaDescription(area, fr)}
                </p>
              </div>
              <Badge variant="neutral">
                {visible.reduce(
                  (total, item) => total + records(item).length,
                  0,
                )}
              </Badge>
            </div>
            <div className="mt-2 space-y-1">
              {visible.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-current={resource === item ? "page" : undefined}
                  onClick={() => setResource(item)}
                  className={`group flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2.5 text-left text-sm shadow-[0_8px_20px_-20px_rgba(9,35,67,.45)] transition ${resource === item ? "border-brand/30 bg-brand-subtle text-brand shadow-sm" : "border-transparent text-ink-secondary hover:border-border hover:bg-surface-2 hover:text-ink"}`}
                >
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-lg ${resource === item ? "bg-brand/15 text-brand" : "bg-surface-2 text-ink-muted group-hover:bg-surface-1"}`}
                  >
                    <ClipboardList className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {resourceName(item, fr)}
                  </span>
                  <Badge
                    variant="neutral"
                    className={
                      resource === item
                        ? "border-brand/20 bg-brand/10 text-brand"
                        : "shrink-0"
                    }
                  >
                    {records(item).length}
                  </Badge>
                </button>
              ))}
            </div>
          </div>
        </aside>
        <section className="overflow-hidden rounded-3xl border border-border-strong/80 bg-surface-1 ring-1 ring-black/[.015] shadow-[0_18px_40px_-31px_rgba(9,35,67,.50)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-strong/75 bg-[linear-gradient(100deg,color-mix(in_srgb,var(--brand)_5%,var(--surface-1)),var(--surface-1)_56%)] px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
                {areaName(area, fr)}
              </p>
              <h2 className="mt-1 text-lg font-semibold text-ink">
                {resourceName(resource, fr)}
              </h2>
            </div>
            {canDo(resource, "create") ? (
              <Button size="sm" onClick={() => setEditor({ resource })}>
                <Plus />
                {fr ? "Ajouter" : "Add"} {resourceName(resource, fr)}
              </Button>
            ) : null}
          </div>
          {recordQueries[AGRICULTURE_RESOURCES.indexOf(resource)]?.isPending ? (
            <SkeletonCard rows={5} />
          ) : recordQueries[AGRICULTURE_RESOURCES.indexOf(resource)]
              ?.isError ? (
            <ErrorState
              title={
                fr
                  ? "Impossible de charger les données"
                  : "Could not load records"
              }
              onRetry={() =>
                recordQueries[
                  AGRICULTURE_RESOURCES.indexOf(resource)
                ]?.refetch()
              }
            />
          ) : items.length ? (
            <RecordList
              resource={resource}
              fr={fr}
              items={items}
              canUpdate={canDo(resource, "update")}
              canDelete={canDo(resource, "delete")}
              onView={(id) => setSelected({ resource, id })}
              onEdit={(item) => setEditor({ resource, item })}
              onDelete={(id) => {
                if (
                  window.confirm(
                    fr
                      ? "Supprimer définitivement cet enregistrement ?"
                      : "Delete this record permanently?",
                  )
                )
                  remove.mutate({ current: resource, id });
              }}
            />
          ) : (
            <EmptyState
              title={fr ? "Aucun enregistrement" : "No records yet"}
              description={
                fr
                  ? "Ajoutez le premier enregistrement pour cette zone."
                  : "Add the first record for this area."
              }
              action={
                canDo(resource, "create")
                  ? {
                      label: fr ? "Ajouter" : "Add record",
                      onClick: () => setEditor({ resource }),
                    }
                  : undefined
              }
            />
          )}
        </section>
        <aside className="overflow-hidden rounded-3xl border border-border-strong/80 bg-surface-1 ring-1 ring-black/[.015] shadow-[0_18px_40px_-31px_rgba(9,35,67,.50)]">
          <div className="border-b border-border-strong/75 bg-[linear-gradient(100deg,color-mix(in_srgb,var(--brand)_5%,var(--surface-1)),var(--surface-1)_56%)] px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
              {fr ? "Détails contrôlés" : "Verified details"}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-ink">
              {selected
                ? resourceName(selected.resource, fr)
                : fr
                  ? "Sélectionnez un élément"
                  : "Select a record"}
            </h2>
          </div>
          {selected ? (
            selectedRecord.isPending ? (
              <SkeletonCard rows={6} />
            ) : selectedRecord.isError ? (
              <ErrorState
                title={fr ? "Détails indisponibles" : "Could not load details"}
                onRetry={() => selectedRecord.refetch()}
              />
            ) : selectedRecord.data ? (
              <RecordDetail item={selectedRecord.data} fr={fr} />
            ) : null
          ) : (
            <EmptyState
              title={fr ? "Aucun élément sélectionné" : "Nothing selected"}
              description={
                fr
                  ? "Ouvrez un enregistrement pour consulter les informations complètes."
                  : "Open a record to inspect the full information."
              }
            />
          )}
        </aside>
      </section>
      {editor ? (
        <RecordEditor
          editor={editor}
          fr={fr}
          sites={sites.data ?? []}
          farms={farms}
          fields={fields}
          plots={plots}
          crops={crops}
          seasons={seasons}
          plantings={plantings}
          busy={save.isPending}
          onClose={() => setEditor(null)}
          onSave={(body) =>
            save.mutate({ current: editor.resource, item: editor.item, body })
          }
        />
      ) : null}
    </main>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof Sprout;
}) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/[.1] p-4 shadow-lg shadow-black/10">
      <Icon className="size-4 text-lime-200" />
      <p className="mt-4 text-2xl font-semibold tracking-[-.03em]">{value}</p>
      <p className="mt-1 text-xs font-medium text-lime-100">{label}</p>
    </div>
  );
}

function firstDate(item: Item) {
  for (const key of [
    "plantingDate",
    "operationDate",
    "irrigationDate",
    "applicationDate",
    "scoutingDate",
    "observationDate",
    "harvestDate",
    "targetHarvestDate",
    "lossDate",
    "startDate",
    "createdAt",
  ])
    if (typeof item[key] === "string") return String(item[key]);
  return null;
}
function primary(item: Item, resource: AgricultureResource, fr: boolean) {
  const keys: Partial<Record<AgricultureResource, string[]>> = {
    farms: ["name", "code"],
    fields: ["name", "code"],
    plots: ["name", "code"],
    crops: ["name", "code"],
    seasons: ["name", "code"],
    plantings: ["name", "code"],
    operations: ["operationType"],
    irrigation: ["method"],
    fertilizer: ["productName"],
    pesticides: ["productName"],
    scouting: ["observationType", "observedIssue"],
    weather: ["conditions"],
    harvest: ["quantity"],
    "production-targets": ["targetYield"],
    losses: ["lossType"],
  };
  for (const key of keys[resource] ?? []) {
    const value = item[key];
    if (value !== null && value !== undefined && value !== "")
      return typeof value === "number"
        ? String(value)
        : key.endsWith("Type") || key === "method" || key === "lossType"
          ? optionText(String(value), fr)
          : String(value);
  }
  return resourceName(resource, fr);
}
function secondary(item: Item, resource: AgricultureResource, fr: boolean) {
  if (item.planting?.name) return String(item.planting.name);
  if (item.field?.name) return String(item.field.name);
  if (item.farm?.name) return String(item.farm.name);
  if (item.site?.name) return String(item.site.name);
  if (item.status) return optionText(String(item.status), fr);
  if (resource === "harvest") return `${String(item.unit ?? "kg")}`;
  return item.notes ? String(item.notes) : "—";
}
function RecordList({
  resource,
  fr,
  items,
  canUpdate,
  canDelete,
  onView,
  onEdit,
  onDelete,
}: {
  resource: AgricultureResource;
  fr: boolean;
  items: Item[];
  canUpdate: boolean;
  canDelete: boolean;
  onView: (id: string) => void;
  onEdit: (item: Item) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="divide-y divide-border">
      {items.map((item) => {
        const date = firstDate(item);
        return (
          <div
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">
                {primary(item, resource, fr)}
              </p>
              <p className="mt-1 truncate text-xs text-ink-secondary">
                {secondary(item, resource, fr)}
                {date ? ` · ${formatBusinessDay(date)}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" onClick={() => onView(item.id)}>
                {fr ? "Voir" : "View"}
              </Button>
              {canUpdate ? (
                <Button size="sm" variant="ghost" onClick={() => onEdit(item)}>
                  {fr ? "Modifier" : "Edit"}
                </Button>
              ) : null}
              {canDelete ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={
                    fr ? "Supprimer l’enregistrement" : "Delete record"
                  }
                  onClick={() => onDelete(item.id)}
                >
                  <Trash2 className="size-4 text-critical" />
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function detailLabel(key: string, fr: boolean) {
  const values: Record<string, string> = {
    siteId: "Site",
    farmId: "Farm",
    fieldId: "Field",
    plotId: "Plot",
    cropId: "Crop",
    seasonId: "Season (optional)",
    plantingId: "Planting",
    totalAreaHa: "Total area (ha)",
    areaHa: "Field area (ha)",
    farmType: "Farm type",
    fieldName: "Field name",
    plotName: "Plot name",
    cropName: "Crop name",
    plantingName: "Planting name",
    defaultGrowingDays: "Default growing days",
    defaultYieldUnit: "Default yield unit",
    plantingDate: "Planting date",
    expectedHarvestDate: "Expected harvest date",
    actualHarvestDate: "Harvest date",
    plantedAreaHa: "Planted area (ha)",
    seedQuantity: "Seed quantity",
    seedUnit: "Seed unit",
    plantingMethod: "Planting method",
    plantDensity: "Plant density",
    operationDate: "Operation date",
    operationType: "Operation type",
    labourHours: "Labour hours",
    equipmentName: "Equipment used",
    irrigationDate: "Irrigation date",
    volumeLiters: "Water volume (L)",
    durationMinutes: "Duration (minutes)",
    applicationDate: "Application date",
    productName: "Product name",
    nutrientFormula: "Nutrient formula",
    quantityKg: "Quantity (kg)",
    activeIngredient: "Active ingredient",
    targetPest: "Target pest",
    preHarvestIntervalDays: "Pre-harvest interval (days)",
    scoutingDate: "Scouting date",
    observationType: "Observation type",
    affectedAreaHa: "Affected area (ha)",
    observedIssue: "Observed issue",
    pestOrDisease: "Pest or disease",
    recommendation: "Recommendation",
    observationDate: "Weather date",
    rainfallMm: "Rainfall (mm)",
    minTemperatureC: "Minimum temperature (°C)",
    maxTemperatureC: "Maximum temperature (°C)",
    humidityPercent: "Humidity (%)",
    windSpeedKph: "Wind speed (km/h)",
    harvestDate: "Harvest date",
    rejectedQuantity: "Rejected quantity",
    moisturePercent: "Moisture (%)",
    storageLocation: "Storage location",
    targetYield: "Target yield",
    targetHarvestDate: "Target harvest date",
    qualityTarget: "Quality target",
    lossDate: "Loss date",
    lossType: "Loss type",
    estimatedValue: "Estimated value",
    causeDescription: "Cause description",
    actionTaken: "Action taken",
    createdAt: fr ? "Créé le" : "Created at",
    updatedAt: fr ? "Mis à jour le" : "Updated at",
  };
  const raw = values[key] ?? key.replace(/([A-Z])/g, " $1").trim();
  return fr ? (labels[raw] ?? raw) : raw;
}
function detailValue(key: string, value: unknown, fr: boolean) {
  const options = new Set([
    "farmType",
    "cropType",
    "seasonType",
    "status",
    "operationType",
    "method",
    "observationType",
    "severity",
    "lossType",
  ]);
  return options.has(key)
    ? optionText(String(value), fr)
    : typeof value === "boolean"
      ? value
        ? fr
          ? "Oui"
          : "Yes"
        : fr
          ? "Non"
          : "No"
      : String(value);
}
function RecordDetail({ item, fr }: { item: Item; fr: boolean }) {
  const entries = Object.entries(item).filter(
    ([key, value]) =>
      !["id", "organizationId", "recordedByUserId", "notes"].includes(key) &&
      value != null &&
      typeof value !== "object",
  );
  return (
    <div className="space-y-3 p-5">
      <dl className="grid gap-3">
        {entries.map(([key, value]) => (
          <div
            key={key}
            className="flex justify-between gap-4 border-b border-border pb-2 text-sm"
          >
            <dt className="text-ink-secondary">{detailLabel(key, fr)}</dt>
            <dd className="max-w-[55%] text-right font-medium text-ink">
              {detailValue(key, value, fr)}
            </dd>
          </div>
        ))}
      </dl>
      {item.notes ? (
        <div className="rounded-lg bg-surface-2 p-3">
          <p className="text-xs font-semibold uppercase tracking-[.1em] text-ink-muted">
            {fr ? "Notes" : "Notes"}
          </p>
          <p className="mt-1 text-sm leading-6 text-ink-secondary">
            {String(item.notes)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function RecordEditor({
  editor,
  fr,
  sites,
  farms,
  fields,
  plots,
  crops,
  seasons,
  plantings,
  busy,
  onClose,
  onSave,
}: {
  editor: Editor;
  fr: boolean;
  sites: Site[];
  farms: Item[];
  fields: Item[];
  plots: Item[];
  crops: Item[];
  seasons: Item[];
  plantings: Item[];
  busy: boolean;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const { resource, item } = editor;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(buildBody(resource, new FormData(event.currentTarget)));
  };
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/45 p-4 backdrop-blur-sm">
      <div className="mx-auto my-5 w-full max-w-5xl rounded-2xl border border-border bg-surface-1 p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
              {item
                ? fr
                  ? "Modification"
                  : "Edit"
                : fr
                  ? "Nouvel enregistrement"
                  : "New record"}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-ink">
              {item ? (fr ? "Modifier" : "Edit") : fr ? "Ajouter" : "Add"}{" "}
              {resourceName(resource, fr)}
            </h2>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X />
            {fr ? "Fermer" : "Close"}
          </Button>
        </div>
        <form className="mt-6" onSubmit={submit}>
          <AgricultureFields
            resource={resource}
            item={item}
            fr={fr}
            sites={sites}
            farms={farms}
            fields={fields}
            plots={plots}
            crops={crops}
            seasons={seasons}
            plantings={plantings}
          />
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {fr ? "Annuler" : "Cancel"}
            </Button>
            <Button type="submit" loading={busy}>
              <Check />
              {fr ? "Enregistrer" : "Save record"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AgricultureFields({
  resource,
  item,
  fr,
  sites,
  farms,
  fields,
  plots,
  crops,
  seasons,
  plantings,
}: {
  resource: AgricultureResource;
  item?: Item;
  fr: boolean;
  sites: Site[];
  farms: Item[];
  fields: Item[];
  plots: Item[];
  crops: Item[];
  seasons: Item[];
  plantings: Item[];
}) {
  const basics =
    resource === "farms" ? (
      <>
        <SiteSelect sites={sites} fr={fr} value={item?.siteId} />
        <Code value={item?.code} fr={fr} optional />
        <TextField
          name="name"
          label="Farm name"
          value={item?.name}
          fr={fr}
          required
        />
        <Choice
          name="farmType"
          label="Farm type"
          value={item?.farmType}
          values={[
            "crop",
            "livestock",
            "mixed",
            "nursery",
            "research",
            "other",
          ]}
          fr={fr}
        />
        <NumberField
          name="totalAreaHa"
          label="Total area (ha)"
          value={item?.totalAreaHa}
          fr={fr}
        />
        <TextField
          name="managerName"
          label="Farm manager"
          value={item?.managerName}
          fr={fr}
        />
      </>
    ) : resource === "fields" ? (
      <>
        <FarmSelect farms={farms} fr={fr} value={item?.farmId} required />
        <Code value={item?.code} fr={fr} />
        <TextField
          name="name"
          label="Field name"
          value={item?.name}
          fr={fr}
          required
        />
        <NumberField
          name="areaHa"
          label="Field area (ha)"
          value={item?.areaHa}
          fr={fr}
          required
        />
        <TextField
          name="soilType"
          label="Soil type"
          value={item?.soilType}
          fr={fr}
        />
        <TextField
          name="irrigationSource"
          label="Irrigation source"
          value={item?.irrigationSource}
          fr={fr}
        />
        <NumberField
          name="latitude"
          label="Latitude"
          value={item?.latitude}
          fr={fr}
          signed
        />
        <NumberField
          name="longitude"
          label="Longitude"
          value={item?.longitude}
          fr={fr}
          signed
        />
      </>
    ) : resource === "plots" ? (
      <>
        <FieldSelect fields={fields} fr={fr} value={item?.fieldId} required />
        <Code value={item?.code} fr={fr} />
        <TextField
          name="name"
          label="Plot name"
          value={item?.name}
          fr={fr}
          required
        />
        <NumberField
          name="areaHa"
          label="Plot area (ha)"
          value={item?.areaHa}
          fr={fr}
          required
        />
        <TextField
          name="soilType"
          label="Soil type"
          value={item?.soilType}
          fr={fr}
        />
        <Choice
          name="status"
          label="Plot status"
          value={item?.status}
          values={[
            "available",
            "planted",
            "fallow",
            "resting",
            "quarantined",
            "closed",
          ]}
          fr={fr}
        />
      </>
    ) : resource === "crops" ? (
      <>
        <Code value={item?.code} fr={fr} />
        <TextField
          name="name"
          label="Crop name"
          value={item?.name}
          fr={fr}
          required
        />
        <TextField
          name="scientificName"
          label="Scientific name"
          value={item?.scientificName}
          fr={fr}
        />
        <Choice
          name="cropType"
          label="Crop type"
          value={item?.cropType}
          values={[
            "cereal",
            "legume",
            "root_tuber",
            "vegetable",
            "fruit",
            "oilseed",
            "forage",
            "cash_crop",
            "tree",
            "other",
          ]}
          fr={fr}
        />
        <TextField
          name="variety"
          label="Variety"
          value={item?.variety}
          fr={fr}
        />
        <NumberField
          name="defaultGrowingDays"
          label="Default growing days"
          value={item?.defaultGrowingDays}
          fr={fr}
          integer
        />
        <TextField
          name="defaultYieldUnit"
          label="Default yield unit"
          value={item?.defaultYieldUnit ?? "kg"}
          fr={fr}
          required
        />
      </>
    ) : resource === "seasons" ? (
      <>
        <FarmSelect farms={farms} fr={fr} value={item?.farmId} required />
        <Code value={item?.code} fr={fr} />
        <TextField
          name="name"
          label="Season name"
          value={item?.name}
          fr={fr}
          required
        />
        <Choice
          name="seasonType"
          label="Season type"
          value={item?.seasonType}
          values={["rainy", "dry", "irrigated", "perennial", "other"]}
          fr={fr}
        />
        <DateField
          name="startDate"
          label="Start date"
          value={item?.startDate}
          fr={fr}
        />
        <DateField
          name="endDate"
          label="End date"
          value={item?.endDate}
          fr={fr}
        />
      </>
    ) : resource === "plantings" ? (
      <>
        <PlotSelect plots={plots} fr={fr} value={item?.plotId} required />
        <CropSelect crops={crops} fr={fr} value={item?.cropId} />
        <SeasonSelect seasons={seasons} fr={fr} value={item?.seasonId} />
        <Code value={item?.code} fr={fr} />
        <TextField
          name="name"
          label="Planting name"
          value={item?.name}
          fr={fr}
          required
        />
        <TextField
          name="variety"
          label="Variety"
          value={item?.variety}
          fr={fr}
        />
        <DateField
          name="plantingDate"
          label="Planting date"
          value={item?.plantingDate}
          fr={fr}
        />
        <DateField
          name="expectedHarvestDate"
          label="Expected harvest date"
          value={item?.expectedHarvestDate}
          fr={fr}
          optional
        />
        <NumberField
          name="plantedAreaHa"
          label="Planted area (ha)"
          value={item?.plantedAreaHa}
          fr={fr}
          required
        />
        <NumberField
          name="seedQuantity"
          label="Seed quantity"
          value={item?.seedQuantity}
          fr={fr}
        />
        <TextField
          name="seedUnit"
          label="Seed unit"
          value={item?.seedUnit}
          fr={fr}
        />
        <TextField
          name="plantingMethod"
          label="Planting method"
          value={item?.plantingMethod}
          fr={fr}
        />
        <NumberField
          name="plantDensity"
          label="Plant density"
          value={item?.plantDensity}
          fr={fr}
        />
        <Choice
          name="status"
          label="Planting status"
          value={item?.status}
          values={[
            "planned",
            "planted",
            "growing",
            "harvested",
            "failed",
            "abandoned",
            "closed",
          ]}
          fr={fr}
        />
      </>
    ) : null;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {basics}
        {!basics ? (
          <EventFields
            resource={resource}
            item={item}
            fr={fr}
            farms={farms}
            fields={fields}
            plots={plots}
            plantings={plantings}
          />
        ) : null}
      </div>
      <Field label={text("Notes", fr)} htmlFor="agriculture-notes">
        <Textarea
          id="agriculture-notes"
          name="notes"
          defaultValue={clearValue(item?.notes)}
        />
      </Field>
    </div>
  );
}

function EventReferences({
  resource,
  item,
  fr,
  farms,
  fields,
  plots,
  plantings,
}: {
  resource: AgricultureResource;
  item?: Item;
  fr: boolean;
  farms: Item[];
  fields: Item[];
  plots: Item[];
  plantings: Item[];
}) {
  if (resource === "weather")
    return <FarmSelect farms={farms} fr={fr} value={item?.farmId} required />;
  if (resource === "harvest" || resource === "production-targets")
    return (
      <PlantingSelect
        plantings={plantings}
        fr={fr}
        value={item?.plantingId}
        required
      />
    );
  return (
    <>
      <FieldSelect fields={fields} fr={fr} value={item?.fieldId} required />
      <PlotSelect plots={plots} fr={fr} value={item?.plotId} optional />
      <PlantingSelect
        plantings={plantings}
        fr={fr}
        value={item?.plantingId}
        optional
      />
    </>
  );
}
function EventFields({
  resource,
  item,
  fr,
  farms,
  fields,
  plots,
  plantings,
}: {
  resource: AgricultureResource;
  item?: Item;
  fr: boolean;
  farms: Item[];
  fields: Item[];
  plots: Item[];
  plantings: Item[];
}) {
  if (resource === "operations")
    return (
      <>
        <EventReferences
          resource={resource}
          item={item}
          fr={fr}
          farms={farms}
          fields={fields}
          plots={plots}
          plantings={plantings}
        />
        <DateField
          name="operationDate"
          label="Operation date"
          value={item?.operationDate}
          fr={fr}
        />
        <Choice
          name="operationType"
          label="Operation type"
          value={item?.operationType}
          values={[
            "land_preparation",
            "planting",
            "weeding",
            "pruning",
            "staking",
            "mulching",
            "harvesting",
            "inspection",
            "maintenance",
            "other",
          ]}
          fr={fr}
        />
        <Choice
          name="status"
          label="Status"
          value={item?.status}
          values={["planned", "in_progress", "completed", "cancelled"]}
          fr={fr}
        />
        <NumberField
          name="quantity"
          label="Quantity"
          value={item?.quantity}
          fr={fr}
        />
        <TextField name="unit" label="Unit" value={item?.unit} fr={fr} />
        <NumberField
          name="labourHours"
          label="Labour hours"
          value={item?.labourHours}
          fr={fr}
        />
        <TextField
          name="equipmentName"
          label="Equipment used"
          value={item?.equipmentName}
          fr={fr}
        />
      </>
    );
  if (resource === "irrigation")
    return (
      <>
        <EventReferences
          resource={resource}
          item={item}
          fr={fr}
          farms={farms}
          fields={fields}
          plots={plots}
          plantings={plantings}
        />
        <DateField
          name="irrigationDate"
          label="Irrigation date"
          value={item?.irrigationDate}
          fr={fr}
        />
        <Choice
          name="method"
          label="Irrigation method"
          value={item?.method}
          values={[
            "drip",
            "sprinkler",
            "furrow",
            "flood",
            "manual",
            "rainfed",
            "other",
          ]}
          fr={fr}
        />
        <NumberField
          name="volumeLiters"
          label="Water volume (L)"
          value={item?.volumeLiters}
          fr={fr}
        />
        <NumberField
          name="durationMinutes"
          label="Duration (minutes)"
          value={item?.durationMinutes}
          fr={fr}
          integer
        />
        <TextField
          name="waterSource"
          label="Water source"
          value={item?.waterSource}
          fr={fr}
        />
      </>
    );
  if (resource === "fertilizer")
    return (
      <>
        <EventReferences
          resource={resource}
          item={item}
          fr={fr}
          farms={farms}
          fields={fields}
          plots={plots}
          plantings={plantings}
        />
        <DateField
          name="applicationDate"
          label="Application date"
          value={item?.applicationDate}
          fr={fr}
        />
        <TextField
          name="productName"
          label="Product name"
          value={item?.productName}
          fr={fr}
          required
        />
        <TextField
          name="nutrientFormula"
          label="Nutrient formula"
          value={item?.nutrientFormula}
          fr={fr}
        />
        <NumberField
          name="quantityKg"
          label="Quantity (kg)"
          value={item?.quantityKg}
          fr={fr}
          required
        />
        <TextField
          name="applicationMethod"
          label="Application method"
          value={item?.applicationMethod}
          fr={fr}
        />
        <TextField
          name="batchNumber"
          label="Batch number"
          value={item?.batchNumber}
          fr={fr}
        />
      </>
    );
  if (resource === "pesticides")
    return (
      <>
        <EventReferences
          resource={resource}
          item={item}
          fr={fr}
          farms={farms}
          fields={fields}
          plots={plots}
          plantings={plantings}
        />
        <DateField
          name="applicationDate"
          label="Application date"
          value={item?.applicationDate}
          fr={fr}
        />
        <TextField
          name="productName"
          label="Product name"
          value={item?.productName}
          fr={fr}
          required
        />
        <TextField
          name="activeIngredient"
          label="Active ingredient"
          value={item?.activeIngredient}
          fr={fr}
        />
        <TextField
          name="targetPest"
          label="Target pest"
          value={item?.targetPest}
          fr={fr}
        />
        <TextField name="dosage" label="Dosage" value={item?.dosage} fr={fr} />
        <TextField
          name="applicationMethod"
          label="Application method"
          value={item?.applicationMethod}
          fr={fr}
        />
        <NumberField
          name="preHarvestIntervalDays"
          label="Pre-harvest interval (days)"
          value={item?.preHarvestIntervalDays}
          fr={fr}
          integer
        />
        <TextField
          name="batchNumber"
          label="Batch number"
          value={item?.batchNumber}
          fr={fr}
        />
      </>
    );
  if (resource === "scouting")
    return (
      <>
        <EventReferences
          resource={resource}
          item={item}
          fr={fr}
          farms={farms}
          fields={fields}
          plots={plots}
          plantings={plantings}
        />
        <DateField
          name="scoutingDate"
          label="Scouting date"
          value={item?.scoutingDate}
          fr={fr}
        />
        <Choice
          name="observationType"
          label="Observation type"
          value={item?.observationType}
          values={[
            "pest",
            "disease",
            "weed",
            "nutrient_deficiency",
            "water_stress",
            "growth",
            "soil",
            "weather_damage",
            "other",
          ]}
          fr={fr}
        />
        <Choice
          name="severity"
          label="Severity"
          value={item?.severity}
          values={["low", "medium", "high", "critical"]}
          fr={fr}
        />
        <NumberField
          name="affectedAreaHa"
          label="Affected area (ha)"
          value={item?.affectedAreaHa}
          fr={fr}
        />
        <TextField
          name="pestOrDisease"
          label="Pest or disease"
          value={item?.pestOrDisease}
          fr={fr}
        />
        <TextField
          name="observedIssue"
          label="Observed issue"
          value={item?.observedIssue}
          fr={fr}
        />
        <TextField
          name="recommendation"
          label="Recommendation"
          value={item?.recommendation}
          fr={fr}
        />
        <Choice
          name="status"
          label="Observation status"
          value={item?.status}
          values={["open", "monitoring", "resolved"]}
          fr={fr}
        />
      </>
    );
  if (resource === "weather")
    return (
      <>
        <EventReferences
          resource={resource}
          item={item}
          fr={fr}
          farms={farms}
          fields={fields}
          plots={plots}
          plantings={plantings}
        />
        <DateField
          name="observationDate"
          label="Weather date"
          value={item?.observationDate}
          fr={fr}
        />
        <NumberField
          name="rainfallMm"
          label="Rainfall (mm)"
          value={item?.rainfallMm}
          fr={fr}
        />
        <NumberField
          name="minTemperatureC"
          label="Minimum temperature (°C)"
          value={item?.minTemperatureC}
          fr={fr}
          signed
        />
        <NumberField
          name="maxTemperatureC"
          label="Maximum temperature (°C)"
          value={item?.maxTemperatureC}
          fr={fr}
          signed
        />
        <NumberField
          name="humidityPercent"
          label="Humidity (%)"
          value={item?.humidityPercent}
          fr={fr}
        />
        <NumberField
          name="windSpeedKph"
          label="Wind speed (km/h)"
          value={item?.windSpeedKph}
          fr={fr}
        />
        <TextField
          name="conditions"
          label="Conditions"
          value={item?.conditions}
          fr={fr}
        />
      </>
    );
  if (resource === "harvest")
    return (
      <>
        <EventReferences
          resource={resource}
          item={item}
          fr={fr}
          farms={farms}
          fields={fields}
          plots={plots}
          plantings={plantings}
        />
        <DateField
          name="harvestDate"
          label="Harvest date"
          value={item?.harvestDate}
          fr={fr}
        />
        <NumberField
          name="quantity"
          label="Harvest quantity"
          value={item?.quantity}
          fr={fr}
          required
        />
        <TextField
          name="unit"
          label="Unit"
          value={item?.unit ?? "kg"}
          fr={fr}
          required
        />
        <TextField
          name="qualityGrade"
          label="Quality grade"
          value={item?.qualityGrade}
          fr={fr}
        />
        <NumberField
          name="rejectedQuantity"
          label="Rejected quantity"
          value={item?.rejectedQuantity ?? 0}
          fr={fr}
        />
        <NumberField
          name="moisturePercent"
          label="Moisture (%)"
          value={item?.moisturePercent}
          fr={fr}
        />
        <TextField
          name="storageLocation"
          label="Storage location"
          value={item?.storageLocation}
          fr={fr}
        />
      </>
    );
  if (resource === "production-targets")
    return (
      <>
        <EventReferences
          resource={resource}
          item={item}
          fr={fr}
          farms={farms}
          fields={fields}
          plots={plots}
          plantings={plantings}
        />
        <NumberField
          name="targetYield"
          label="Target yield"
          value={item?.targetYield}
          fr={fr}
          required
        />
        <TextField
          name="unit"
          label="Unit"
          value={item?.unit ?? "kg"}
          fr={fr}
          required
        />
        <DateField
          name="targetHarvestDate"
          label="Target harvest date"
          value={item?.targetHarvestDate}
          fr={fr}
          optional
        />
        <TextField
          name="qualityTarget"
          label="Quality target"
          value={item?.qualityTarget}
          fr={fr}
        />
      </>
    );
  return (
    <>
      <EventReferences
        resource={resource}
        item={item}
        fr={fr}
        farms={farms}
        fields={fields}
        plots={plots}
        plantings={plantings}
      />
      <DateField
        name="lossDate"
        label="Loss date"
        value={item?.lossDate}
        fr={fr}
      />
      <Choice
        name="lossType"
        label="Loss type"
        value={item?.lossType}
        values={[
          "crop_damage",
          "pest",
          "disease",
          "drought",
          "flood",
          "fire",
          "theft",
          "input_spoilage",
          "equipment",
          "other",
        ]}
        fr={fr}
      />
      <NumberField
        name="quantity"
        label="Quantity"
        value={item?.quantity}
        fr={fr}
      />
      <TextField name="unit" label="Unit" value={item?.unit} fr={fr} />
      <NumberField
        name="estimatedValue"
        label="Estimated value"
        value={item?.estimatedValue}
        fr={fr}
      />
      <TextField
        name="causeDescription"
        label="Cause description"
        value={item?.causeDescription}
        fr={fr}
      />
      <TextField
        name="actionTaken"
        label="Action taken"
        value={item?.actionTaken}
        fr={fr}
      />
    </>
  );
}

function buildBody(
  resource: AgricultureResource,
  form: FormData,
): Record<string, unknown> {
  const notes = optional(form, "notes");
  if (resource === "farms")
    return {
      siteId: String(form.get("siteId")),
      code: normalizedCode(form.get("code"), "farm"),
      name: String(form.get("name")).trim(),
      farmType: String(form.get("farmType")),
      totalAreaHa: optionalNumber(form, "totalAreaHa"),
      managerName: optional(form, "managerName"),
      notes,
    };
  if (resource === "fields")
    return {
      farmId: String(form.get("farmId")),
      code: String(form.get("code")),
      name: String(form.get("name")),
      areaHa: requiredNumber(form, "areaHa"),
      soilType: optional(form, "soilType"),
      irrigationSource: optional(form, "irrigationSource"),
      latitude: optionalNumber(form, "latitude"),
      longitude: optionalNumber(form, "longitude"),
      notes,
    };
  if (resource === "plots")
    return {
      fieldId: String(form.get("fieldId")),
      code: String(form.get("code")),
      name: String(form.get("name")),
      areaHa: requiredNumber(form, "areaHa"),
      soilType: optional(form, "soilType"),
      status: String(form.get("status")),
      notes,
    };
  if (resource === "crops")
    return {
      code: String(form.get("code")),
      name: String(form.get("name")),
      scientificName: optional(form, "scientificName"),
      cropType: String(form.get("cropType")),
      variety: optional(form, "variety"),
      defaultGrowingDays: optionalNumber(form, "defaultGrowingDays"),
      defaultYieldUnit: String(form.get("defaultYieldUnit")),
      notes,
    };
  if (resource === "seasons")
    return {
      farmId: String(form.get("farmId")),
      code: String(form.get("code")),
      name: String(form.get("name")),
      seasonType: String(form.get("seasonType")),
      startDate: String(form.get("startDate")),
      endDate: String(form.get("endDate")),
      notes,
    };
  if (resource === "plantings")
    return {
      plotId: String(form.get("plotId")),
      cropId: String(form.get("cropId")),
      seasonId: optional(form, "seasonId"),
      code: String(form.get("code")),
      name: String(form.get("name")),
      variety: optional(form, "variety"),
      plantingDate: String(form.get("plantingDate")),
      expectedHarvestDate: optional(form, "expectedHarvestDate"),
      plantedAreaHa: requiredNumber(form, "plantedAreaHa"),
      seedQuantity: optionalNumber(form, "seedQuantity"),
      seedUnit: optional(form, "seedUnit"),
      plantingMethod: optional(form, "plantingMethod"),
      plantDensity: optionalNumber(form, "plantDensity"),
      status: String(form.get("status")),
      notes,
    };
  const reference = {
    fieldId: optional(form, "fieldId"),
    plotId: optional(form, "plotId"),
    plantingId: optional(form, "plantingId"),
  };
  if (resource === "operations")
    return {
      ...reference,
      fieldId: String(form.get("fieldId")),
      operationDate: String(form.get("operationDate")),
      operationType: String(form.get("operationType")),
      status: String(form.get("status")),
      quantity: optionalNumber(form, "quantity"),
      unit: optional(form, "unit"),
      labourHours: optionalNumber(form, "labourHours"),
      equipmentName: optional(form, "equipmentName"),
      notes,
    };
  if (resource === "irrigation")
    return {
      ...reference,
      fieldId: String(form.get("fieldId")),
      irrigationDate: String(form.get("irrigationDate")),
      method: String(form.get("method")),
      volumeLiters: optionalNumber(form, "volumeLiters"),
      durationMinutes: optionalNumber(form, "durationMinutes"),
      waterSource: optional(form, "waterSource"),
      notes,
    };
  if (resource === "fertilizer")
    return {
      ...reference,
      fieldId: String(form.get("fieldId")),
      applicationDate: String(form.get("applicationDate")),
      productName: String(form.get("productName")),
      nutrientFormula: optional(form, "nutrientFormula"),
      quantityKg: requiredNumber(form, "quantityKg"),
      applicationMethod: optional(form, "applicationMethod"),
      batchNumber: optional(form, "batchNumber"),
      notes,
    };
  if (resource === "pesticides")
    return {
      ...reference,
      fieldId: String(form.get("fieldId")),
      applicationDate: String(form.get("applicationDate")),
      productName: String(form.get("productName")),
      activeIngredient: optional(form, "activeIngredient"),
      targetPest: optional(form, "targetPest"),
      dosage: optional(form, "dosage"),
      applicationMethod: optional(form, "applicationMethod"),
      preHarvestIntervalDays: optionalNumber(form, "preHarvestIntervalDays"),
      batchNumber: optional(form, "batchNumber"),
      notes,
    };
  if (resource === "scouting")
    return {
      ...reference,
      fieldId: String(form.get("fieldId")),
      scoutingDate: String(form.get("scoutingDate")),
      observationType: String(form.get("observationType")),
      severity: String(form.get("severity")),
      affectedAreaHa: optionalNumber(form, "affectedAreaHa"),
      observedIssue: optional(form, "observedIssue"),
      pestOrDisease: optional(form, "pestOrDisease"),
      recommendation: optional(form, "recommendation"),
      status: String(form.get("status")),
      notes,
    };
  if (resource === "weather")
    return {
      farmId: String(form.get("farmId")),
      observationDate: String(form.get("observationDate")),
      rainfallMm: optionalNumber(form, "rainfallMm"),
      minTemperatureC: optionalNumber(form, "minTemperatureC"),
      maxTemperatureC: optionalNumber(form, "maxTemperatureC"),
      humidityPercent: optionalNumber(form, "humidityPercent"),
      windSpeedKph: optionalNumber(form, "windSpeedKph"),
      conditions: optional(form, "conditions"),
      notes,
    };
  if (resource === "harvest")
    return {
      plantingId: String(form.get("plantingId")),
      harvestDate: String(form.get("harvestDate")),
      quantity: requiredNumber(form, "quantity"),
      unit: String(form.get("unit")),
      qualityGrade: optional(form, "qualityGrade"),
      rejectedQuantity: optionalNumber(form, "rejectedQuantity") ?? 0,
      moisturePercent: optionalNumber(form, "moisturePercent"),
      storageLocation: optional(form, "storageLocation"),
      notes,
    };
  if (resource === "production-targets")
    return {
      plantingId: String(form.get("plantingId")),
      targetYield: requiredNumber(form, "targetYield"),
      unit: String(form.get("unit")),
      targetHarvestDate: optional(form, "targetHarvestDate"),
      qualityTarget: optional(form, "qualityTarget"),
      notes,
    };
  return {
    ...reference,
    fieldId: String(form.get("fieldId")),
    lossDate: String(form.get("lossDate")),
    lossType: String(form.get("lossType")),
    quantity: optionalNumber(form, "quantity"),
    unit: optional(form, "unit"),
    estimatedValue: optionalNumber(form, "estimatedValue"),
    causeDescription: optional(form, "causeDescription"),
    actionTaken: optional(form, "actionTaken"),
    notes,
  };
}

function TextField({
  name,
  label,
  value,
  fr,
  required,
  type = "text",
}: {
  name: string;
  label: string;
  value?: unknown;
  fr: boolean;
  required?: boolean;
  type?: string;
}) {
  return (
    <Field label={text(label, fr)} htmlFor={name} required={required}>
      <Input
        id={name}
        name={name}
        type={type}
        defaultValue={value == null ? "" : String(value)}
        required={required}
      />
    </Field>
  );
}
function NumberField({
  name,
  label,
  value,
  fr,
  required,
  integer,
  signed,
}: {
  name: string;
  label: string;
  value?: unknown;
  fr: boolean;
  required?: boolean;
  integer?: boolean;
  signed?: boolean;
}) {
  return (
    <Field label={text(label, fr)} htmlFor={name} required={required}>
      <Input
        id={name}
        name={name}
        type="number"
        min={signed ? undefined : "0"}
        step={integer ? "1" : "0.01"}
        defaultValue={value == null ? "" : String(value)}
        required={required}
      />
    </Field>
  );
}
function DateField({
  name,
  label,
  value,
  fr,
  optional: isOptional,
}: {
  name: string;
  label: string;
  value?: unknown;
  fr: boolean;
  optional?: boolean;
}) {
  return (
    <TextField
      name={name}
      label={label}
      type="date"
      value={dateValue(value) || (isOptional ? "" : today())}
      fr={fr}
      required={!isOptional}
    />
  );
}
function Choice({
  name,
  label,
  value,
  values,
  fr,
}: {
  name: string;
  label: string;
  value?: unknown;
  values: string[];
  fr: boolean;
}) {
  return (
    <SelectField
      name={name}
      label={label}
      value={clearValue(value ?? values[0])}
      fr={fr}
    >
      {values.map((option) => (
        <option key={option} value={option}>
          {optionText(option, fr)}
        </option>
      ))}
    </SelectField>
  );
}
function SelectField({
  name,
  label,
  value,
  children,
  fr,
  required,
}: {
  name: string;
  label: string;
  value?: string;
  children: ReactNode;
  fr: boolean;
  required?: boolean;
}) {
  return (
    <Field label={text(label, fr)} htmlFor={name} required={required}>
      <select
        id={name}
        name={name}
        defaultValue={value ?? ""}
        required={required}
        className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
      >
        {children}
      </select>
    </Field>
  );
}
function Code({
  value,
  fr,
  optional = false,
}: {
  value?: unknown;
  fr: boolean;
  optional?: boolean;
}) {
  return (
    <Field
      label={text("Code", fr)}
      htmlFor="code"
      required={!optional}
      hint={
        optional
          ? fr
            ? "Généré automatiquement et de façon unique depuis le nom si vide. Les majuscules, espaces et accents sont normalisés."
            : "Generated safely and uniquely from the name when left blank. Capitals, spaces and accents are normalized."
          : fr
            ? "Utilisez des minuscules, chiffres et tirets bas."
            : "Use lowercase letters, numbers and underscores."
      }
    >
      <Input
        id="code"
        name="code"
        defaultValue={value == null ? "" : String(value)}
        required={!optional}
        placeholder={
          optional
            ? fr
              ? "Généré depuis le nom"
              : "Generated from the name"
            : undefined
        }
      />
    </Field>
  );
}
function SiteSelect({
  sites,
  value,
  fr,
}: {
  sites: Site[];
  value?: unknown;
  fr: boolean;
}) {
  return (
    <SelectField
      name="siteId"
      label="Site"
      value={clearValue(value)}
      fr={fr}
      required
    >
      <option value="">{text("Choose a site", fr)}</option>
      {sites.map((site) => (
        <option key={site.id} value={site.id}>
          {site.name}
        </option>
      ))}
    </SelectField>
  );
}
function FarmSelect({
  farms,
  value,
  fr,
  required = false,
}: {
  farms: Item[];
  value?: unknown;
  fr: boolean;
  required?: boolean;
}) {
  return (
    <SelectField
      name="farmId"
      label="Farm"
      value={clearValue(value)}
      fr={fr}
      required={required}
    >
      <option value="">
        {fr ? "Sélectionner une ferme" : "Choose a farm"}
      </option>
      {farms.map((farm) => (
        <option key={farm.id} value={farm.id}>
          {String(farm.name ?? farm.code)}
        </option>
      ))}
    </SelectField>
  );
}
function FieldSelect({
  fields,
  value,
  fr,
  required = false,
}: {
  fields: Item[];
  value?: unknown;
  fr: boolean;
  required?: boolean;
}) {
  return (
    <SelectField
      name="fieldId"
      label={required ? "Field (required)" : "Field"}
      value={clearValue(value)}
      fr={fr}
      required={required}
    >
      <option value="">
        {fr ? "Sélectionner un champ" : "Choose a field"}
      </option>
      {fields.map((field) => (
        <option key={field.id} value={field.id}>
          {String(field.name ?? field.code)}
          {field.farm?.name ? ` · ${field.farm.name}` : ""}
        </option>
      ))}
    </SelectField>
  );
}
function PlotSelect({
  plots,
  value,
  fr,
  required = false,
  optional = false,
}: {
  plots: Item[];
  value?: unknown;
  fr: boolean;
  required?: boolean;
  optional?: boolean;
}) {
  return (
    <SelectField
      name="plotId"
      label={optional ? "Plot (optional)" : "Plot"}
      value={clearValue(value)}
      fr={fr}
      required={required}
    >
      <option value="">
        {optional ? text("No plot", fr) : text("Choose a plot", fr)}
      </option>
      {plots.map((plot) => (
        <option key={plot.id} value={plot.id}>
          {String(plot.name ?? plot.code)}
          {plot.field?.name ? ` · ${plot.field.name}` : ""}
        </option>
      ))}
    </SelectField>
  );
}
function CropSelect({
  crops,
  value,
  fr,
}: {
  crops: Item[];
  value?: unknown;
  fr: boolean;
}) {
  return (
    <SelectField
      name="cropId"
      label="Crop"
      value={clearValue(value)}
      fr={fr}
      required
    >
      <option value="">{text("Choose a crop", fr)}</option>
      {crops.map((crop) => (
        <option key={crop.id} value={crop.id}>
          {String(crop.name ?? crop.code)}
        </option>
      ))}
    </SelectField>
  );
}
function SeasonSelect({
  seasons,
  value,
  fr,
}: {
  seasons: Item[];
  value?: unknown;
  fr: boolean;
}) {
  return (
    <SelectField
      name="seasonId"
      label="Season (optional)"
      value={clearValue(value)}
      fr={fr}
    >
      <option value="">{text("No season", fr)}</option>
      {seasons.map((season) => (
        <option key={season.id} value={season.id}>
          {String(season.name ?? season.code)}
        </option>
      ))}
    </SelectField>
  );
}
function PlantingSelect({
  plantings,
  value,
  fr,
  required = false,
  optional = false,
}: {
  plantings: Item[];
  value?: unknown;
  fr: boolean;
  required?: boolean;
  optional?: boolean;
}) {
  return (
    <SelectField
      name="plantingId"
      label={optional ? "Planting (optional)" : "Planting"}
      value={clearValue(value)}
      fr={fr}
      required={required}
    >
      <option value="">
        {optional ? text("No planting", fr) : text("Choose a planting", fr)}
      </option>
      {plantings.map((planting) => (
        <option key={planting.id} value={planting.id}>
          {String(planting.name ?? planting.code)}
          {planting.crop?.name ? ` · ${planting.crop.name}` : ""}
        </option>
      ))}
    </SelectField>
  );
}
