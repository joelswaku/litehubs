"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Bird,
  Building2,
  CheckCircle2,
  Link2,
  MapPin,
  Pencil,
  Plus,
  Settings2,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError, get, orgUrl } from "@/lib/api";
import { poultryApi } from "@/lib/poultry-api";
import { can } from "@/lib/permissions";
import { formatBusinessDay, formatQuantity } from "@/lib/utils";
import { useSessionUser } from "@/stores/session-store";
import { useLanguage } from "@/providers/language-provider";
import { PoultryConfigurationTools } from "./poultry-configuration-tools";

type Place = { id: string; name?: string | null; code?: string | null };
type Site = Place;
type House = {
  id: string;
  code: string;
  name: string;
  houseType: string;
  capacity: number;
  operationalStatus: string;
  description?: string | null;
  notes?: string | null;
  lengthM?: number | null;
  widthM?: number | null;
  floorAreaM2?: number | null;
  ventilationType?: string | null;
  waterSystem?: string | null;
  feedingSystem?: string | null;
  heatingSystem?: string | null;
  site?: Place | null;
};
type Model = {
  id: string;
  code: string;
  name: string;
  productionType: "broiler" | "layer" | "breeder";
  strain?: string | null;
  countryCode?: string;
  version?: number;
  isActive: boolean;
  notes?: string | null;
  climateProfile?: { id: string; name: string } | null;
};
type Flock = {
  id: string;
  code: string;
  name: string;
  status: string;
  house?: Place | null;
  birdType: string;
  productionType?: string | null;
  breed?: string | null;
  sourceName?: string | null;
  chickSource?: string | null;
  sex?: string | null;
  hatchDate?: string | null;
  arrivalDate?: string | null;
  startingAgeDays?: number | null;
  initialBirdCount: number;
  currentBirdCount?: number | null;
  expectedLiveBirdCount?: number | null;
  physicalLiveBirdCount?: number | null;
  liveBirdDiscrepancy?: number | null;
  requiresReconciliationReview?: boolean;
  totalMortality?: number | null;
  purchaseCostTotal?: number | null;
  costPerBird?: number | null;
  expectedProductionEndDate?: string | null;
  performanceModelId?: string | null;
  parentFlockId?: string | null;
  mortalityReviewThreshold?: number | null;
  capacityOverrideReason?: string | null;
  notes?: string | null;
};
type WeeklyTarget = {
  id: string;
  weekNumber: number;
  targetWeightG?: number | null;
  feedGPerBirdPerDay?: number | null;
  cumulativeFeedGPerBird?: number | null;
  waterLitersPerBirdPerDay?: number | null;
  targetFcr?: number | null;
  targetDailyGainG?: number | null;
  expectedCumulativeMortalityPercent?: number | null;
  expectedLiveBirdPercent?: number | null;
  targetEggLayPercent?: number | null;
  targetEggCount?: number | null;
  targetEggWeightG?: number | null;
  maxRejectedEggPercent?: number | null;
  minTemperatureC?: number | null;
  maxTemperatureC?: number | null;
  minHumidityPercent?: number | null;
  maxHumidityPercent?: number | null;
  tolerancePercent: number;
  notes?: string | null;
};
type Mode =
  | { kind: "house"; item?: House }
  | { kind: "flock"; item?: Flock }
  | { kind: "close"; item: Flock }
  | { kind: "model"; item?: Model }
  | { kind: "target"; model: Model; item?: WeeklyTarget };

const houseTypes = [
  "broiler",
  "layer",
  "breeder",
  "mixed",
  "pullet",
  "chick",
  "quarantine",
  "other",
];
const flockTypes = ["broiler", "layer", "breeder"];
const houseStatuses = ["active", "inactive", "under_cleaning", "maintenance"];
const liveStatuses = ["active", "quarantined", "ready_for_sale"];
const readable = (value: string | null | undefined) =>
  value
    ? value
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "—";
const codeFor = (value: string, prefix: string) => {
  const part = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (part ? `${prefix}_${part}` : `${prefix}_new`).slice(0, 63);
};
const stringValue = (form: FormData, name: string) => {
  const value = String(form.get(name) ?? "").trim();
  return value || null;
};
const numberValue = (
  form: FormData,
  name: string,
  fallback: number | null = null,
) => {
  const raw = String(form.get(name) ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};
const message = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : "The request could not be completed.";
const tx = (fr: boolean, english: string, french: string) =>
  fr ? french : english;
const houseLabel = (value: string, fr: boolean) => {
  const labels: Record<string, string> = {
    broiler: "Poulet de chair",
    layer: "Pondeuse",
    breeder: "Reproducteur",
    mixed: "Mixte",
    pullet: "Poulette",
    chick: "Poussin",
    quarantine: "Quarantaine",
    other: "Autre",
    active: "Actif",
    inactive: "Inactif",
    under_cleaning: "En nettoyage",
    maintenance: "Maintenance",
  };
  return fr ? (labels[value] ?? readable(value)) : readable(value);
};
const compatible = (house: House, poultryType: string) =>
  house.operationalStatus === "active" &&
  (house.houseType === poultryType ||
    ["mixed", "other", "quarantine"].includes(house.houseType));

export function PoultrySetupView({ orgSlug }: { orgSlug: string }) {
  const user = useSessionUser();
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const tr = (english: string, french: string) => (fr ? french : english);
  const client = useQueryClient();
  const [mode, setMode] = useState<Mode | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const allow = (permission: string) => can(user, permission);
  const houses = useQuery({
    queryKey: ["poultry-setup-houses", orgSlug],
    queryFn: () => poultryApi.list<{ records: House[] }>(orgSlug, "houses"),
    enabled: allow("poultry.houses.read"),
    select: (data) => data.records,
  });
  const flocks = useQuery({
    queryKey: ["poultry-setup-flocks", orgSlug],
    queryFn: () => poultryApi.list<{ records: Flock[] }>(orgSlug, "flocks"),
    enabled: allow("poultry.flocks.read"),
    select: (data) => data.records,
  });
  const sites = useQuery({
    queryKey: ["poultry-setup-sites", orgSlug],
    queryFn: () => get<{ sites: Site[] }>(orgUrl(orgSlug, "sites")),
    enabled: allow("sites.read"),
    select: (data) => data.sites,
  });
  const models = useQuery({
    queryKey: ["poultry-setup-models", orgSlug],
    queryFn: () =>
      poultryApi.performanceModels.list<{ performanceModels: Model[] }>(
        orgSlug,
      ),
    enabled: allow("poultry.performance_models.read"),
    select: (data) => data.performanceModels,
  });
  const currentModel =
    models.data?.find((model) => model.id === selectedModelId) ??
    models.data?.[0] ??
    null;
  const climateProfiles = useQuery({
    queryKey: ["poultry-setup-climates", orgSlug],
    queryFn: () =>
      poultryApi.climateProfiles.list<{ climateProfiles: Place[] }>(orgSlug),
    enabled: allow("poultry.climate_profiles.read"),
    select: (data) => data.climateProfiles,
  });
  const targets = useQuery({
    queryKey: ["poultry-setup-targets", orgSlug, currentModel?.id],
    queryFn: () =>
      poultryApi.performanceModels.targets.list<{
        weeklyTargets: WeeklyTarget[];
      }>(orgSlug, currentModel!.id),
    enabled: Boolean(currentModel) && allow("poultry.performance_models.read"),
    select: (data) => data.weeklyTargets,
  });
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["poultry"] });
    client.invalidateQueries({ queryKey: ["poultry-setup"] });
    client.invalidateQueries({ queryKey: ["poultry-overview", orgSlug] });
    client.invalidateQueries({ queryKey: ["poultry-performance", orgSlug] });
  };
  const houseSave = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id?: string;
      body: Record<string, unknown>;
    }) =>
      id
        ? poultryApi.update(orgSlug, "houses", id, body)
        : poultryApi.create(orgSlug, "houses", body),
    onSuccess: () => {
      setMode(null);
      refresh();
    },
  });
  const flockSave = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id?: string;
      body: Record<string, unknown>;
    }) =>
      id
        ? poultryApi.update(orgSlug, "flocks", id, body)
        : poultryApi.create(orgSlug, "flocks", body),
    onSuccess: () => {
      setMode(null);
      refresh();
    },
  });
  const modelSave = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id?: string;
      body: Record<string, unknown>;
    }) =>
      id
        ? poultryApi.performanceModels.update(orgSlug, id, body)
        : poultryApi.performanceModels.create(orgSlug, body),
    onSuccess: () => {
      setMode(null);
      refresh();
    },
  });
  const targetSave = useMutation({
    mutationFn: ({
      modelId,
      id,
      body,
    }: {
      modelId: string;
      id?: string;
      body: Record<string, unknown>;
    }) =>
      id
        ? poultryApi.performanceModels.targets.update(
            orgSlug,
            modelId,
            id,
            body,
          )
        : poultryApi.performanceModels.targets.create(orgSlug, modelId, body),
    onSuccess: () => {
      setMode(null);
      refresh();
    },
  });
  const targetDelete = useMutation({
    mutationFn: ({ modelId, id }: { modelId: string; id: string }) =>
      poultryApi.performanceModels.targets.remove(orgSlug, modelId, id),
    onSuccess: refresh,
  });
  const modelDelete = useMutation({
    mutationFn: (id: string) =>
      poultryApi.performanceModels.remove(orgSlug, id),
    onSuccess: () => {
      setSelectedModelId(null);
      refresh();
    },
  });
  const mutationError = [
    houseSave.error,
    flockSave.error,
    modelSave.error,
    targetSave.error,
    targetDelete.error,
    modelDelete.error,
  ].find(Boolean);
  const addHouse = allow("poultry.houses.create");
  const editHouse = allow("poultry.houses.update");
  const addFlock = allow("poultry.flocks.create");
  const editFlock = allow("poultry.flocks.update");
  const addModel = allow("poultry.performance_models.create");
  const editModel = allow("poultry.performance_models.update");
  const removeModel = allow("poultry.performance_models.delete");

  return (
    <section className="space-y-5">
      <section className="overflow-hidden rounded-[1.5rem] border border-border bg-[radial-gradient(circle_at_88%_10%,color-mix(in_srgb,var(--brand)_24%,transparent),transparent_28%),linear-gradient(120deg,var(--surface-1),var(--brand-subtle))] p-5 shadow-[0_20px_48px_-32px_rgba(15,23,42,.55)] dark:shadow-[0_20px_48px_-32px_rgba(0,0,0,.9)] sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">
              {tr("Production foundation", "Fondation de production")}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
              {tr("Poultry setup", "Configuration avicole")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">
              {tr(
                "Configure houses, start real flocks, and maintain company-owned standards. Employee daily records stay separate.",
                "Configurez les bâtiments, démarrez les lots réels et gérez les standards de la société. Les saisies quotidiennes des employés restent séparées.",
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {addHouse ? (
              <Button size="sm" onClick={() => setMode({ kind: "house" })}>
                <Building2 />
                {tr("Add house", "Ajouter un bâtiment")}
              </Button>
            ) : null}
            {addFlock ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setMode({ kind: "flock" })}
              >
                <Plus />
                {tr("Start new flock", "Démarrer un nouveau lot")}
              </Button>
            ) : null}
            {addModel ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMode({ kind: "model" })}
              >
                <Settings2 />
                {tr("Create model", "Créer un modèle")}
              </Button>
            ) : null}
          </div>
        </div>
        {mutationError ? (
          <p
            className="mt-4 rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical"
            role="alert"
          >
            {message(mutationError)}
          </p>
        ) : null}
      </section>

      <Panel
        title={tr("Houses", "Bâtiments")}
        subtitle={tr(
          "Capacity, production compatibility and operating condition.",
          "Capacité, compatibilité de production et état de fonctionnement.",
        )}
        action={
          addHouse ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setMode({ kind: "house" })}
            >
              <Plus />
              {tr("Add house", "Ajouter un bâtiment")}
            </Button>
          ) : undefined
        }
      >
        {houses.isPending ? (
          <Loading />
        ) : houses.isError ? (
          <ErrorState
            title="Could not load houses"
            description={message(houses.error)}
            onRetry={() => houses.refetch()}
          />
        ) : houses.data?.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {houses.data.map((house) => (
              <article
                key={house.id}
                className="group relative overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-[0_16px_36px_-30px_rgba(15,23,42,.62)] transition duration-200 hover:-translate-y-0.5 hover:border-brand/45 hover:shadow-lg dark:shadow-[0_16px_36px_-30px_rgba(0,0,0,.9)]"
              >
                <span
                  aria-hidden
                  className={
                    "absolute inset-x-0 top-0 h-1 " +
                    (house.operationalStatus === "active"
                      ? "bg-gradient-to-r from-brand via-cyan-400 to-emerald-400"
                      : house.operationalStatus === "maintenance"
                        ? "bg-gradient-to-r from-warning via-serious to-warning"
                        : "bg-border-strong")
                  }
                />
                <div className="p-4 pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-brand/15 bg-brand-subtle text-brand">
                        <Building2 className="size-5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold tracking-tight text-ink">
                          {house.name}
                        </h3>
                        <p className="mt-1 truncate text-xs font-medium text-ink-muted">
                          {house.code} · {readable(house.houseType)}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={
                        house.operationalStatus === "active"
                          ? "good"
                          : house.operationalStatus === "maintenance"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {readable(house.operationalStatus)}
                    </Badge>
                  </div>
                  <div className="mt-4 flex items-start gap-2 rounded-xl border border-border bg-surface-2/65 px-3 py-2.5">
                    <MapPin className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
                    <p className="min-w-0 truncate text-xs leading-5 text-ink-secondary">
                      {house.site?.name ?? "—"}
                    </p>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2.5 text-xs">
                    <Metric
                      label={tr("Capacity", "Capacité")}
                      value={`${formatQuantity(house.capacity, null, 0)} ${tr("birds", "oiseaux")}`}
                    />
                    <Metric
                      label={tr("Poultry type", "Type de volaille")}
                      value={readable(house.houseType)}
                    />
                  </div>
                  {house.description ? (
                    <p className="mt-3 line-clamp-2 text-xs leading-5 text-ink-secondary">
                      {house.description}
                    </p>
                  ) : null}
                </div>
                {editHouse ? (
                  <footer className="flex justify-end border-t border-border bg-surface-2/50 px-3 py-2.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setMode({ kind: "house", item: house })}
                    >
                      <Pencil />
                      {tr("Edit house", "Modifier le bâtiment")}
                    </Button>
                  </footer>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title={tr("No houses configured.", "Aucun bâtiment configuré.")}
            description={tr(
              "Add a house before starting a flock.",
              "Ajoutez un bâtiment avant de démarrer un lot.",
            )}
            icon={Building2}
            action={
              addHouse
                ? {
                    label: tr("Add house", "Ajouter un batiment"),
                    onClick: () => setMode({ kind: "house" }),
                  }
                : undefined
            }
          />
        )}
      </Panel>
      <Panel
        title={tr("Flocks", "Lots")}
        subtitle={tr(
          "Starting birds are entered once. Current birds are calculated from movements and mortality.",
          "Les oiseaux de depart sont saisis une seule fois. Les oiseaux actuels sont calcules a partir des mouvements et de la mortalite.",
        )}
        action={
          addFlock ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setMode({ kind: "flock" })}
            >
              <Plus />
              {tr("Start new flock", "Démarrer un nouveau lot")}
            </Button>
          ) : undefined
        }
      >
        {flocks.isPending ? (
          <Loading />
        ) : flocks.isError ? (
          <ErrorState
            title="Could not load flocks"
            description={message(flocks.error)}
            onRetry={() => flocks.refetch()}
          />
        ) : flocks.data?.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {flocks.data.map((flock) => {
              const assigned = models.data?.find(
                (model) => model.id === flock.performanceModelId,
              );
              const active = liveStatuses.includes(flock.status);
              return (
                <article
                  key={flock.id}
                  className="group relative overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-[0_16px_36px_-30px_rgba(15,23,42,.62)] transition duration-200 hover:-translate-y-0.5 hover:border-brand/45 hover:shadow-lg dark:shadow-[0_16px_36px_-30px_rgba(0,0,0,.9)]"
                >
                  <span
                    aria-hidden
                    className={
                      "absolute inset-x-0 top-0 h-1 " +
                      (active
                        ? "bg-gradient-to-r from-brand via-cyan-400 to-emerald-400"
                        : flock.status === "closed"
                          ? "bg-border-strong"
                          : "bg-gradient-to-r from-warning to-serious")
                    }
                  />
                  <div className="p-4 pt-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-brand/15 bg-brand-subtle text-brand">
                          <Bird className="size-5" aria-hidden />
                        </span>
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-semibold tracking-tight text-ink">
                            {flock.name}
                          </h3>
                          <p className="mt-1 truncate text-xs font-medium text-ink-muted">
                            {flock.code} · {readable(flock.productionType ?? flock.birdType)}
                          </p>
                        </div>
                      </div>
                      <Badge variant={active ? "good" : flock.status === "closed" ? "neutral" : "warning"}>
                        {readable(flock.status)}
                      </Badge>
                    </div>
                    <div className="mt-4 flex items-start gap-2 rounded-xl border border-border bg-surface-2/65 px-3 py-2.5">
                      <MapPin className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
                      <p className="min-w-0 text-xs leading-5 text-ink-secondary">
                        <span className="font-semibold text-ink">{flock.house?.name ?? tr("No house", "Aucun bâtiment")}</span>
                        <span className="px-1.5 text-ink-muted">·</span>
                        {tr("Arrival", "Arrivée")} {formatBusinessDay(flock.arrivalDate)}
                      </p>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2.5 text-xs">
                      <Metric
                        label={tr("Starting birds", "Oiseaux au départ")}
                        value={formatQuantity(flock.initialBirdCount, null, 0)}
                      />
                      <Metric
                        label={tr("Expected live", "Vivants prévus")}
                        value={formatQuantity(flock.expectedLiveBirdCount ?? flock.currentBirdCount, null, 0)}
                      />
                      <Metric
                        label={tr("Physical count", "Comptage physique")}
                        value={
                          flock.physicalLiveBirdCount == null
                            ? tr("Not recorded", "Non enregistré")
                            : formatQuantity(flock.physicalLiveBirdCount, null, 0)
                        }
                      />
                      <Metric
                        label={tr("Performance model", "Modèle de performance")}
                        value={assigned?.name ?? tr("Not assigned", "Non assigné")}
                      />
                    </div>
                    {flock.requiresReconciliationReview ? (
                      <p className="mt-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-ink-secondary">
                        {tr(
                          `Physical count differs by ${formatQuantity(Math.abs(Number(flock.liveBirdDiscrepancy ?? 0)), null, 0)} birds. Supervisor review is needed.`,
                          `Le comptage physique présente un écart de ${formatQuantity(Math.abs(Number(flock.liveBirdDiscrepancy ?? 0)), null, 0)} oiseaux. Une revue du superviseur est requise.`,
                        )}
                      </p>
                    ) : null}
                  </div>
                  {editFlock ? (
                    <footer className="flex flex-wrap justify-end gap-1 border-t border-border bg-surface-2/50 px-3 py-2.5">
                      <Button size="sm" variant="ghost" onClick={() => setMode({ kind: "flock", item: flock })}>
                        <Pencil />
                        {tr("Edit", "Modifier")}
                      </Button>
                      {active ? (
                        <Button size="sm" variant="ghost" onClick={() => setMode({ kind: "close", item: flock })}>
                          <Archive />
                          {tr("Close", "Clôturer")}
                        </Button>
                      ) : null}
                      {!assigned ? (
                        <Button size="sm" variant="secondary" onClick={() => setMode({ kind: "flock", item: flock })}>
                          <Link2 />
                          {tr("Assign model", "Assigner un modèle")}
                        </Button>
                      ) : null}
                    </footer>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={tr("No flocks yet.", "Aucun lot pour le moment.")}
            description={tr(
              "Start a flock after its house is ready.",
              "Démarrez un lot lorsque son bâtiment est prêt.",
            )}
            icon={Bird}
            action={
              addFlock
                ? {
                    label: tr("Start new flock", "Demarrer un nouveau lot"),
                    onClick: () => setMode({ kind: "flock" }),
                  }
                : undefined
            }
          />
        )}
      </Panel>

      <Panel
        title={tr("Performance models", "Modèles de performance")}
        subtitle={tr(
          "Editable standards by poultry type, strain and climate. Targets are never hard-coded.",
          "Standards modifiables par type de volaille, souche et climat. Les objectifs ne sont jamais codés en dur.",
        )}
        action={
          addModel ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setMode({ kind: "model" })}
            >
              <Plus />
              {tr("Create performance model", "Créer un modèle de performance")}
            </Button>
          ) : undefined
        }
      >
        {models.isPending ? (
          <Loading />
        ) : models.isError ? (
          <ErrorState
            title="Could not load performance models"
            description={message(models.error)}
            onRetry={() => models.refetch()}
          />
        ) : models.data?.length ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,.85fr)]">
            <div className="space-y-3">
              {models.data.map((model) => (
                <article
                  key={model.id}
                  onClick={() => setSelectedModelId(model.id)}
                  className={`cursor-pointer rounded-xl border p-4 transition-colors ${currentModel?.id === model.id ? "border-brand bg-brand-subtle" : "border-border bg-surface-1 hover:bg-surface-2"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-ink">
                        {model.name}
                      </h3>
                      <p className="mt-1 text-xs text-ink-secondary">
                        {model.code} · {readable(model.productionType)}
                        {model.strain ? ` · ${model.strain}` : ""}
                      </p>
                    </div>
                    <Badge variant={model.isActive ? "good" : "neutral"}>
                      {model.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs text-ink-muted">
                    {model.climateProfile?.name ?? "No climate adjustment"} ·
                    Version {model.version ?? 1}
                  </p>
                  {editModel || removeModel ? (
                    <div className="mt-3 flex justify-end gap-1">
                      {editModel ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(event) => {
                            event.stopPropagation();
                            setMode({ kind: "model", item: model });
                          }}
                        >
                          <Pencil />
                          {tr("Edit", "Modifier")}
                        </Button>
                      ) : null}
                      {removeModel ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={modelDelete.isPending}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (
                              window.confirm(
                                `Delete ${model.name}? Assigned models cannot be deleted.`,
                              )
                            )
                              modelDelete.mutate(model.id);
                          }}
                        >
                          <Trash2 />
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
            <TargetManager
              model={currentModel}
              targets={targets.data}
              loading={targets.isPending}
              error={targets.isError ? targets.error : null}
              retry={() => targets.refetch()}
              canEdit={editModel}
              onAdd={() =>
                currentModel && setMode({ kind: "target", model: currentModel })
              }
              onEdit={(target) =>
                currentModel &&
                setMode({ kind: "target", model: currentModel, item: target })
              }
              onDelete={(target) => {
                if (
                  currentModel &&
                  window.confirm("Delete this weekly target?")
                )
                  targetDelete.mutate({
                    modelId: currentModel.id,
                    id: target.id,
                  });
              }}
              deleting={targetDelete.isPending}
            />
          </div>
        ) : (
          <EmptyState
            title={tr(
              "No performance model configured.",
              "Aucun modèle de performance configuré.",
            )}
            description={tr(
              "Create a company-owned Broiler, Layer or Breeder standard, then add targets.",
              "Créez un standard Broiler, Pondeuse ou Reproducteur, puis ajoutez des objectifs.",
            )}
            icon={Settings2}
            action={
              addModel
                ? {
                    label: "Create performance model",
                    onClick: () => setMode({ kind: "model" }),
                  }
                : undefined
            }
          />
        )}
      </Panel>

      <PoultryConfigurationTools orgSlug={orgSlug} models={models.data ?? []} />
      {mode ? (
        <Modal
          title={
            mode.kind === "house"
              ? mode.item
                ? tr("Edit house", "Modifier le batiment")
                : tr("Add house", "Ajouter un batiment")
              : mode.kind === "flock"
                ? mode.item
                  ? tr("Edit flock", "Modifier le lot")
                  : tr("Start new flock", "Demarrer un nouveau lot")
                : mode.kind === "close"
                  ? tr("Close", "Cloturer") + " " + mode.item.name
                  : mode.kind === "model"
                    ? mode.item
                      ? tr(
                          "Edit performance model",
                          "Modifier le modele de performance",
                        )
                      : tr(
                          "Create performance model",
                          "Creer le modele de performance",
                        )
                    : mode.item
                      ? tr(
                          "Edit weekly targets",
                          "Modifier les objectifs hebdomadaires",
                        )
                      : tr(
                          "Add weekly targets",
                          "Ajouter les objectifs hebdomadaires",
                        )
          }
          onClose={() => setMode(null)}
        >
          {mode.kind === "house" ? (
            <HouseForm
              item={mode.item}
              sites={sites.data ?? []}
              busy={houseSave.isPending}
              error={houseSave.error}
              onSubmit={(body) => houseSave.mutate({ id: mode.item?.id, body })}
            />
          ) : null}
          {mode.kind === "flock" ? (
            <FlockForm
              item={mode.item}
              houses={houses.data ?? []}
              models={models.data ?? []}
              batches={flocks.data ?? []}
              busy={flockSave.isPending}
              error={flockSave.error}
              onSubmit={(body) => flockSave.mutate({ id: mode.item?.id, body })}
            />
          ) : null}
          {mode.kind === "close" ? (
            <CloseFlockForm
              item={mode.item}
              busy={flockSave.isPending}
              onSubmit={(body) => flockSave.mutate({ id: mode.item.id, body })}
            />
          ) : null}
          {mode.kind === "model" ? (
            <ModelForm
              item={mode.item}
              climates={climateProfiles.data ?? []}
              busy={modelSave.isPending}
              onSubmit={(body) => modelSave.mutate({ id: mode.item?.id, body })}
            />
          ) : null}
          {mode.kind === "target" ? (
            <TargetForm
              item={mode.item}
              model={mode.model}
              busy={targetSave.isPending}
              onSubmit={(body) =>
                targetSave.mutate({
                  modelId: mode.model.id,
                  id: mode.item?.id,
                  body,
                })
              }
            />
          ) : null}
        </Modal>
      ) : null}
    </section>
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
    <section className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-surface-1 via-surface-1 to-brand-subtle/20 shadow-[0_18px_42px_-30px_rgba(15,23,42,.42)] dark:shadow-[0_18px_42px_-30px_rgba(0,0,0,.9)]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-gradient-to-r from-brand-subtle/35 via-surface-1 to-surface-1 px-4 py-4 sm:px-5">
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-secondary">
            {subtitle}
          </p>
        </div>
        {action}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface-2/65 px-3 py-2.5">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[.08em] text-ink-muted">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}function Loading() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {[1, 2, 3].map((value) => (
        <Skeleton className="h-36" key={value} />
      ))}
    </div>
  );
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-ink/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="mx-auto my-6 w-full max-w-3xl rounded-2xl border border-border bg-surface-1 p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={onClose}
            aria-label="Close"
          >
            <X />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Select({
  name,
  value,
  children,
  required,
  invalid,
}: {
  name: string;
  value?: string | null;
  children: ReactNode;
  required?: boolean;
  invalid?: boolean;
}) {
  return (
    <select
      name={name}
      defaultValue={value ?? ""}
      required={required}
      aria-invalid={invalid || undefined}
      className={
        "h-9 w-full rounded-md border bg-surface-1 px-3 text-sm text-ink " +
        (invalid ? "border-critical" : "border-border-strong")
      }
    >
      {children}
    </select>
  );
}
function OptionalNumber({
  name,
  label,
  value,
  step = "0.01",
  hint,
  error,
}: {
  name: string;
  label: string;
  value?: number | null;
  step?: string;
  hint?: string;
  error?: string;
}) {
  return (
    <Field label={label} htmlFor={name} hint={hint} error={error}>
      <Input
        name={name}
        type="number"
        min="0"
        step={step}
        defaultValue={value ?? ""}
        invalid={Boolean(error)}
      />
    </Field>
  );
}
function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <div className="mt-6 flex justify-end">
      <Button type="submit" loading={busy}>
        <CheckCircle2 />
        {children}
      </Button>
    </div>
  );
}
function HouseForm({
  item,
  sites,
  busy,
  error,
  onSubmit,
}: {
  item?: House;
  sites: Site[];
  busy: boolean;
  error?: unknown;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const fr = useLanguage().locale === "fr";
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const serverErrors = error instanceof ApiError ? error.fieldErrors : {};
  const fieldError = (field: string) =>
    clientErrors[field] ??
    serverErrors[field]
      ?.map((value) => translateHouseError(value, fr))
      .join(" ");
  const generalError =
    error instanceof ApiError && Object.keys(serverErrors).length === 0
      ? translateHouseError(error.message, fr)
      : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const siteId = String(form.get("siteId") ?? "");
    const capacity = numberValue(form, "capacity", 0) ?? 0;
    const code = stringValue(form, "code");
    const nextErrors: Record<string, string> = {};

    if (!name)
      nextErrors.name = tx(
        fr,
        "Enter a house name.",
        "Saisissez le nom du bâtiment.",
      );
    if (!siteId)
      nextErrors.siteId = tx(
        fr,
        "Select the farm or site.",
        "Sélectionnez la ferme ou le site.",
      );
    if (!capacity || capacity <= 0)
      nextErrors.capacity = tx(
        fr,
        "Capacity must be greater than zero.",
        "La capacité doit être supérieure à zéro.",
      );
    if (code && !/^[a-z][a-z0-9_]{1,62}$/.test(code))
      nextErrors.code = tx(
        fr,
        "Use lowercase letters, numbers and underscores.",
        "Utilisez des minuscules, des chiffres et des tirets bas.",
      );

    if (Object.keys(nextErrors).length) {
      setClientErrors(nextErrors);
      return;
    }
    setClientErrors({});
    onSubmit({
      siteId,
      name,
      code: code ?? codeFor(name, "house"),
      houseType: String(form.get("houseType")),
      capacity,
      operationalStatus: String(form.get("operationalStatus")),
      description: stringValue(form, "description"),
      notes: stringValue(form, "notes"),
      lengthM: numberValue(form, "lengthM"),
      widthM: numberValue(form, "widthM"),
      floorAreaM2: numberValue(form, "floorAreaM2"),
      ventilationType: stringValue(form, "ventilationType"),
      waterSystem: stringValue(form, "waterSystem"),
      feedingSystem: stringValue(form, "feedingSystem"),
      heatingSystem: stringValue(form, "heatingSystem"),
    });
  }

  return (
    <form className="mt-5" onSubmit={submit} noValidate>
      {generalError ? (
        <p
          className="mb-4 rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical"
          role="alert"
        >
          {generalError}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={tx(fr, "House name", "Nom du bâtiment")}
          htmlFor="house-name"
          required
          error={fieldError("name")}
        >
          <Input
            name="name"
            defaultValue={item?.name}
            invalid={Boolean(fieldError("name"))}
          />
        </Field>
        <Field
          label={tx(fr, "House code", "Code du bâtiment")}
          htmlFor="house-code"
          hint={tx(
            fr,
            "Generated when left blank.",
            "Généré automatiquement si vide.",
          )}
          error={fieldError("code")}
        >
          <Input
            name="code"
            defaultValue={item?.code}
            invalid={Boolean(fieldError("code"))}
          />
        </Field>
        <Field
          label={tx(fr, "Farm / site", "Ferme / site")}
          htmlFor="house-site"
          required
          error={fieldError("siteId")}
        >
          <Select
            name="siteId"
            value={item?.site?.id}
            required
            invalid={Boolean(fieldError("siteId"))}
          >
            <option value="">
              {tx(fr, "Select site", "Sélectionner un site")}
            </option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={tx(fr, "Poultry type allowed", "Type de volaille autorisé")}
          htmlFor="house-type"
          required
          error={fieldError("houseType")}
        >
          <Select
            name="houseType"
            value={item?.houseType ?? "broiler"}
            required
            invalid={Boolean(fieldError("houseType"))}
          >
            {houseTypes.map((value) => (
              <option value={value} key={value}>
                {houseLabel(value, fr)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={tx(fr, "Capacity", "Capacité")}
          htmlFor="house-capacity"
          required
          error={fieldError("capacity")}
        >
          <Input
            name="capacity"
            type="number"
            min="1"
            step="1"
            defaultValue={item?.capacity}
            invalid={Boolean(fieldError("capacity"))}
          />
        </Field>
        <Field
          label={tx(fr, "Operating status", "État de fonctionnement")}
          htmlFor="house-status"
          required
          error={fieldError("operationalStatus")}
        >
          <Select
            name="operationalStatus"
            value={item?.operationalStatus ?? "active"}
            required
            invalid={Boolean(fieldError("operationalStatus"))}
          >
            {houseStatuses.map((value) => (
              <option value={value} key={value}>
                {houseLabel(value, fr)}
              </option>
            ))}
          </Select>
        </Field>
        <OptionalNumber
          name="lengthM"
          label={tx(fr, "Length (m)", "Longueur (m)")}
          value={item?.lengthM}
        />
        <OptionalNumber
          name="widthM"
          label={tx(fr, "Width (m)", "Largeur (m)")}
          value={item?.widthM}
        />
        <OptionalNumber
          name="floorAreaM2"
          label={tx(fr, "Floor area (m²)", "Surface au sol (m²)")}
          value={item?.floorAreaM2}
        />
        <Field
          label={tx(fr, "Ventilation", "Ventilation")}
          htmlFor="house-ventilation"
        >
          <Input
            name="ventilationType"
            defaultValue={item?.ventilationType ?? ""}
          />
        </Field>
        <Field
          label={tx(fr, "Water system", "Système d eau")}
          htmlFor="house-water"
        >
          <Input name="waterSystem" defaultValue={item?.waterSystem ?? ""} />
        </Field>
        <Field
          label={tx(fr, "Feeding system", "Système d alimentation")}
          htmlFor="house-feeding"
        >
          <Input
            name="feedingSystem"
            defaultValue={item?.feedingSystem ?? ""}
          />
        </Field>
        <Field
          label={tx(fr, "Heating system", "Système de chauffage")}
          htmlFor="house-heating"
        >
          <Input
            name="heatingSystem"
            defaultValue={item?.heatingSystem ?? ""}
          />
        </Field>
      </div>
      <Field
        label={tx(fr, "Description", "Description")}
        htmlFor="house-description"
        className="mt-4"
      >
        <Textarea name="description" defaultValue={item?.description ?? ""} />
      </Field>
      <Field
        label={tx(fr, "Notes", "Notes")}
        htmlFor="house-notes"
        className="mt-4"
      >
        <Textarea name="notes" defaultValue={item?.notes ?? ""} />
      </Field>
      <Submit busy={busy}>
        {item
          ? tx(fr, "Save house", "Enregistrer le bâtiment")
          : tx(fr, "Create house", "Créer le bâtiment")}
      </Submit>
    </form>
  );
}

function translateHouseError(message: string, fr: boolean) {
  if (!fr) return message;
  const translations: Record<string, string> = {
    "Enter a valid identifier": "Sélectionnez un site valide.",
    "Use lowercase letters, numbers and underscores":
      "Utilisez des minuscules, des chiffres et des tirets bas.",
    "Validation failed": "Vérifiez les champs indiqués.",
  };
  if (
    message.includes("expected string") ||
    message.includes("expected number")
  )
    return "Ce champ est obligatoire.";
  if (message.includes("Too small") || message.includes("greater than 0"))
    return "La valeur doit être supérieure à zéro.";
  return translations[message] ?? message;
}
function FlockForm({
  item,
  houses,
  models,
  batches,
  busy,
  error,
  onSubmit,
}: {
  item?: Flock;
  houses: House[];
  models: Model[];
  batches: Flock[];
  busy: boolean;
  error?: unknown;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const fr = useLanguage().locale === "fr";
  const [poultryType, setPoultryType] = useState(
    item?.productionType ?? item?.birdType ?? "broiler",
  );
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const availableHouses = houses.filter(
    (house) => compatible(house, poultryType) || house.id === item?.house?.id,
  );
  const availableModels = models.filter(
    (model) =>
      model.productionType === poultryType &&
      (model.isActive || model.id === item?.performanceModelId),
  );
  const serverErrors = error instanceof ApiError ? error.fieldErrors : {};
  const fieldError = (field: string) =>
    clientErrors[field] ??
    serverErrors[field]
      ?.map((value) => translateHouseError(value, fr))
      .join(" ");
  const typeError = fieldError("productionType") ?? fieldError("birdType");
  const generalError =
    error instanceof ApiError && Object.keys(serverErrors).length === 0
      ? translateHouseError(error.message, fr)
      : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const houseId = String(form.get("houseId") ?? "");
    const arrivalDate = String(form.get("arrivalDate") ?? "");
    const initialBirdCount = numberValue(form, "initialBirdCount", 0) ?? 0;
    const startingAgeDays = numberValue(form, "startingAgeDays", 0) ?? 0;
    const mortalityReviewThreshold =
      numberValue(form, "mortalityReviewThreshold", 1) ?? 1;
    const purchaseCostTotal = numberValue(form, "purchaseCostTotal");
    const costPerBird = numberValue(form, "costPerBird");
    const code = stringValue(form, "code");
    const nextErrors: Record<string, string> = {};

    if (!name)
      nextErrors.name = tx(
        fr,
        "Enter a flock name.",
        "Saisissez le nom du lot.",
      );
    if (!houseId)
      nextErrors.houseId = tx(
        fr,
        "Select a compatible active house.",
        "Sélectionnez un bâtiment actif compatible.",
      );
    if (!arrivalDate)
      nextErrors.arrivalDate = tx(
        fr,
        "Enter the arrival date.",
        "Saisissez la date d arrivée.",
      );
    if (!Number.isInteger(initialBirdCount) || initialBirdCount <= 0)
      nextErrors.initialBirdCount = tx(
        fr,
        "Starting birds must be a whole number greater than zero.",
        "Le nombre initial doit être un entier supérieur à zéro.",
      );
    if (
      !Number.isInteger(startingAgeDays) ||
      startingAgeDays < 0 ||
      startingAgeDays > 1000
    )
      nextErrors.startingAgeDays = tx(
        fr,
        "Starting age must be between 0 and 1,000 days.",
        "L âge de départ doit être entre 0 et 1 000 jours.",
      );
    if (
      !Number.isInteger(mortalityReviewThreshold) ||
      mortalityReviewThreshold <= 0
    )
      nextErrors.mortalityReviewThreshold = tx(
        fr,
        "The mortality review threshold must be at least 1.",
        "Le seuil de revue de mortalité doit être au moins 1.",
      );
    if (purchaseCostTotal != null && purchaseCostTotal < 0)
      nextErrors.purchaseCostTotal = tx(
        fr,
        "Purchase cost cannot be negative.",
        "Le coût d achat ne peut pas être négatif.",
      );
    if (costPerBird != null && costPerBird < 0)
      nextErrors.costPerBird = tx(
        fr,
        "Cost per bird cannot be negative.",
        "Le coût par oiseau ne peut pas être négatif.",
      );
    if (code && !/^[a-z][a-z0-9_]{1,62}$/.test(code))
      nextErrors.code = tx(
        fr,
        "Use lowercase letters, numbers and underscores.",
        "Utilisez des minuscules, des chiffres et des tirets bas.",
      );

    if (Object.keys(nextErrors).length) {
      setClientErrors(nextErrors);
      return;
    }
    setClientErrors({});
    const modelId = String(form.get("performanceModelId") ?? "");
    onSubmit({
      houseId,
      name,
      code: code ?? codeFor(name, "flock"),
      birdType: poultryType,
      productionType: poultryType,
      breed: stringValue(form, "breed"),
      sourceName: stringValue(form, "sourceName"),
      chickSource: stringValue(form, "chickSource"),
      sex: String(form.get("sex")),
      hatchDate: stringValue(form, "hatchDate"),
      arrivalDate,
      startingAgeDays,
      initialBirdCount,
      purchaseCostTotal,
      costPerBird,
      expectedProductionEndDate: stringValue(form, "expectedProductionEndDate"),
      parentFlockId: String(form.get("parentFlockId") ?? "") || null,
      performanceModelId: modelId || null,
      mortalityReviewThreshold,
      capacityOverrideReason: stringValue(form, "capacityOverrideReason"),
      notes: stringValue(form, "notes"),
    });
  }

  return (
    <form className="mt-5" onSubmit={submit} noValidate>
      {generalError ? (
        <p
          className="mb-4 rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical"
          role="alert"
        >
          {generalError}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={tx(fr, "Flock name", "Nom du lot")}
          htmlFor="flock-name"
          required
          error={fieldError("name")}
        >
          <Input
            name="name"
            defaultValue={item?.name}
            invalid={Boolean(fieldError("name"))}
          />
        </Field>
        <Field
          label={tx(fr, "Flock / batch code", "Code du lot")}
          htmlFor="flock-code"
          hint={tx(
            fr,
            "Generated when left blank.",
            "Généré automatiquement si vide.",
          )}
          error={fieldError("code")}
        >
          <Input
            name="code"
            defaultValue={item?.code}
            invalid={Boolean(fieldError("code"))}
          />
        </Field>
        <Field
          label={tx(fr, "Poultry type", "Type de volaille")}
          htmlFor="flock-type"
          required
          error={typeError}
        >
          <select
            name="productionType"
            value={poultryType}
            onChange={(event) => setPoultryType(event.target.value)}
            aria-invalid={Boolean(typeError) || undefined}
            className={
              "h-9 w-full rounded-md border bg-surface-1 px-3 text-sm text-ink " +
              (typeError ? "border-critical" : "border-border-strong")
            }
          >
            {flockTypes.map((value) => (
              <option value={value} key={value}>
                {houseLabel(value, fr)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={tx(fr, "House", "Bâtiment")}
          htmlFor="flock-house"
          required
          error={fieldError("houseId")}
        >
          <Select
            name="houseId"
            value={item?.house?.id}
            required
            invalid={Boolean(fieldError("houseId"))}
          >
            <option value="">
              {tx(
                fr,
                "Select compatible active house",
                "Sélectionner un bâtiment actif compatible",
              )}
            </option>
            {availableHouses.map((house) => (
              <option value={house.id} key={house.id}>
                {house.name} · {house.capacity} {tx(fr, "capacity", "places")}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={tx(fr, "Breed / strain", "Race / souche")}
          htmlFor="flock-breed"
          error={fieldError("breed")}
        >
          <Input
            name="breed"
            defaultValue={item?.breed ?? ""}
            placeholder="Cobb 500"
            invalid={Boolean(fieldError("breed"))}
          />
        </Field>
        <Field
          label={tx(fr, "Performance model", "Modèle de performance")}
          htmlFor="flock-model"
          error={fieldError("performanceModelId")}
        >
          <Select
            name="performanceModelId"
            value={item?.performanceModelId}
            invalid={Boolean(fieldError("performanceModelId"))}
          >
            <option value="">
              {tx(
                fr,
                "No performance model assigned",
                "Aucun modèle de performance attribué",
              )}
            </option>
            {availableModels.map((model) => (
              <option value={model.id} key={model.id}>
                {model.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={tx(fr, "Starting birds", "Oiseaux au départ")}
          htmlFor="flock-starting"
          required
          error={fieldError("initialBirdCount")}
        >
          <Input
            name="initialBirdCount"
            type="number"
            min="1"
            step="1"
            defaultValue={item?.initialBirdCount}
            invalid={Boolean(fieldError("initialBirdCount"))}
          />
        </Field>
        <Field
          label={tx(fr, "Arrival date", "Date d arrivée")}
          htmlFor="flock-arrival"
          required
          error={fieldError("arrivalDate")}
        >
          <Input
            name="arrivalDate"
            type="date"
            defaultValue={item?.arrivalDate ?? ""}
            invalid={Boolean(fieldError("arrivalDate"))}
          />
        </Field>
        <Field
          label={tx(fr, "Hatch date", "Date d éclosion")}
          htmlFor="flock-hatch"
          error={fieldError("hatchDate")}
        >
          <Input
            name="hatchDate"
            type="date"
            defaultValue={item?.hatchDate ?? ""}
            invalid={Boolean(fieldError("hatchDate"))}
          />
        </Field>
        <OptionalNumber
          name="startingAgeDays"
          label={tx(fr, "Starting age (days)", "Âge au départ (jours)")}
          value={item?.startingAgeDays ?? 0}
          step="1"
          error={fieldError("startingAgeDays")}
        />
        <Field
          label={tx(fr, "Supplier / hatchery", "Fournisseur / couvoir")}
          htmlFor="flock-source"
          error={fieldError("sourceName")}
        >
          <Input
            name="sourceName"
            defaultValue={item?.sourceName ?? ""}
            invalid={Boolean(fieldError("sourceName"))}
          />
        </Field>
        <Field
          label={tx(fr, "Chick source", "Source des poussins")}
          htmlFor="flock-chick-source"
          error={fieldError("chickSource")}
        >
          <Input
            name="chickSource"
            defaultValue={item?.chickSource ?? ""}
            invalid={Boolean(fieldError("chickSource"))}
          />
        </Field>
        <Field
          label={tx(fr, "Parent batch", "Lot parent")}
          htmlFor="flock-parent"
          error={fieldError("parentFlockId")}
        >
          <Select
            name="parentFlockId"
            value={item?.parentFlockId}
            invalid={Boolean(fieldError("parentFlockId"))}
          >
            <option value="">
              {tx(fr, "No parent batch", "Aucun lot parent")}
            </option>
            {batches
              .filter((batch) => batch.id !== item?.id)
              .map((batch) => (
                <option value={batch.id} key={batch.id}>
                  {batch.name} · {batch.code}
                </option>
              ))}
          </Select>
        </Field>
        <Field
          label={tx(fr, "Sex", "Sexe")}
          htmlFor="flock-sex"
          error={fieldError("sex")}
        >
          <Select
            name="sex"
            value={item?.sex ?? "mixed"}
            invalid={Boolean(fieldError("sex"))}
          >
            {["mixed", "male", "female"].map((value) => (
              <option value={value} key={value}>
                {fr
                  ? ({ mixed: "Mixte", male: "Mâle", female: "Femelle" }[
                      value
                    ] ?? readable(value))
                  : readable(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={tx(fr, "Expected production end", "Fin de production prévue")}
          htmlFor="flock-end"
          error={fieldError("expectedProductionEndDate")}
        >
          <Input
            name="expectedProductionEndDate"
            type="date"
            defaultValue={item?.expectedProductionEndDate ?? ""}
            invalid={Boolean(fieldError("expectedProductionEndDate"))}
          />
        </Field>
        <OptionalNumber
          name="purchaseCostTotal"
          label={tx(fr, "Purchase cost total", "Coût d achat total")}
          value={item?.purchaseCostTotal}
          step="0.0001"
          error={fieldError("purchaseCostTotal")}
        />
        <OptionalNumber
          name="costPerBird"
          label={tx(fr, "Cost per bird", "Coût par oiseau")}
          value={item?.costPerBird}
          step="0.0001"
          error={fieldError("costPerBird")}
        />
        <Field
          label={tx(
            fr,
            "Mortality review threshold",
            "Seuil de revue de mortalité",
          )}
          htmlFor="flock-threshold"
          error={fieldError("mortalityReviewThreshold")}
        >
          <Input
            name="mortalityReviewThreshold"
            type="number"
            min="1"
            step="1"
            defaultValue={item?.mortalityReviewThreshold ?? 1}
            invalid={Boolean(fieldError("mortalityReviewThreshold"))}
          />
        </Field>
        <Field
          label={tx(
            fr,
            "Capacity override reason",
            "Motif de dépassement de capacité",
          )}
          htmlFor="flock-override"
          hint={tx(
            fr,
            "Only required above capacity. Owner approval is enforced by the API.",
            "Requis uniquement au-dessus de la capacité. L API applique l approbation du propriétaire.",
          )}
          error={fieldError("capacityOverrideReason")}
        >
          <Input
            name="capacityOverrideReason"
            defaultValue={item?.capacityOverrideReason ?? ""}
            invalid={Boolean(fieldError("capacityOverrideReason"))}
          />
        </Field>
      </div>
      <Field
        label={tx(fr, "Notes", "Notes")}
        htmlFor="flock-notes"
        className="mt-4"
        error={fieldError("notes")}
      >
        <Textarea
          name="notes"
          defaultValue={item?.notes ?? ""}
          invalid={Boolean(fieldError("notes"))}
        />
      </Field>
      <Submit busy={busy}>
        {item
          ? tx(fr, "Save flock", "Enregistrer le lot")
          : tx(fr, "Start flock", "Démarrer le lot")}
      </Submit>
    </form>
  );
}
function CloseFlockForm({
  item,
  busy,
  onSubmit,
}: {
  item: Flock;
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const fr = useLanguage().locale === "fr";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSubmit({
      status: "closed",
      closedAt: String(form.get("closedAt")),
      closingReason: stringValue(form, "closingReason"),
      closingNotes: stringValue(form, "closingNotes"),
      birdsSold: numberValue(form, "birdsSold", 0),
      birdsTransferred: numberValue(form, "birdsTransferred", 0),
      finalLiveBirdCount: numberValue(
        form,
        "finalLiveBirdCount",
        item.expectedLiveBirdCount ?? item.currentBirdCount ?? 0,
      ),
      finalMortality: numberValue(
        form,
        "finalMortality",
        item.totalMortality ?? 0,
      ),
    });
  }
  return (
    <form className="mt-5" onSubmit={submit}>
      <p className="rounded-lg bg-surface-2 p-3 text-sm text-ink-secondary">
        Closing preserves the flock’s production and health history. It does not
        delete it.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field
          label={tx(fr, "Close date", "Date cloture")}
          htmlFor="close-date"
          required
        >
          <Input
            name="closedAt"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            required
          />
        </Field>
        <Field
          label={tx(fr, "Closing reason", "Motif cloture")}
          htmlFor="close-reason"
        >
          <Input
            name="closingReason"
            placeholder="Sold, transferred, depleted…"
          />
        </Field>
        <OptionalNumber
          name="birdsSold"
          label={tx(fr, "Birds sold", "Oiseaux vendus")}
          value={0}
          step="1"
        />
        <OptionalNumber
          name="birdsTransferred"
          label={tx(fr, "Birds transferred", "Oiseaux transferes")}
          value={0}
          step="1"
        />
        <OptionalNumber
          name="finalLiveBirdCount"
          label={tx(fr, "Final live birds", "Oiseaux vivants finaux")}
          value={item.expectedLiveBirdCount ?? item.currentBirdCount}
          step="1"
        />
        <OptionalNumber
          name="finalMortality"
          label={tx(fr, "Final mortality", "Mortalite finale")}
          value={item.totalMortality}
          step="1"
        />
      </div>
      <Field
        label={tx(fr, "Sale / transfer notes", "Notes vente / transfert")}
        htmlFor="close-notes"
        className="mt-4"
      >
        <Textarea name="closingNotes" />
      </Field>
      <Submit busy={busy}>{tx(fr, "Close flock", "Cloturer le lot")}</Submit>
    </form>
  );
}
function ModelForm({
  item,
  climates,
  busy,
  onSubmit,
}: {
  item?: Model;
  climates: Place[];
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const fr = useLanguage().locale === "fr";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    onSubmit({
      name,
      code: stringValue(form, "code") ?? codeFor(name, "model"),
      productionType: String(form.get("productionType")),
      strain: stringValue(form, "strain"),
      countryCode: String(form.get("countryCode") ?? "CD").toUpperCase(),
      version: numberValue(form, "version", 1),
      climateProfileId: String(form.get("climateProfileId") ?? "") || null,
      isActive: form.get("isActive") === "on",
      notes: stringValue(form, "notes"),
    });
  }
  return (
    <form className="mt-5" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={tx(fr, "Model name", "Nom du modele")}
          htmlFor="model-name"
          required
        >
          <Input
            name="name"
            defaultValue={item?.name}
            required
            placeholder="Cobb 500 Standard"
          />
        </Field>
        <Field
          label={tx(fr, "Model code", "Code du modele")}
          htmlFor="model-code"
          hint={tx(
            fr,
            "Generated when left blank.",
            "Généré automatiquement si vide.",
          )}
        >
          <Input name="code" defaultValue={item?.code} />
        </Field>
        <Field
          label={tx(fr, "Poultry type", "Type de volaille")}
          htmlFor="model-type"
          required
        >
          <Select
            name="productionType"
            value={item?.productionType ?? "broiler"}
            required
          >
            {flockTypes.map((value) => (
              <option value={value} key={value}>
                {readable(value)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={tx(fr, "Breed / strain", "Race / souche")}
          htmlFor="model-strain"
        >
          <Input name="strain" defaultValue={item?.strain ?? ""} />
        </Field>
        <Field label={tx(fr, "Country", "Pays")} htmlFor="model-country">
          <Input
            name="countryCode"
            maxLength={2}
            defaultValue={item?.countryCode ?? "CD"}
          />
        </Field>
        <Field label={tx(fr, "Version", "Version")} htmlFor="model-version">
          <Input
            name="version"
            type="number"
            min="1"
            step="1"
            defaultValue={item?.version ?? 1}
          />
        </Field>
        <Field
          label={tx(fr, "Climate / region profile", "Profil climat / region")}
          htmlFor="model-climate"
        >
          <Select name="climateProfileId" value={item?.climateProfile?.id}>
            <option value="">No climate profile</option>
            {climates.map((climate) => (
              <option value={climate.id} key={climate.id}>
                {climate.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-ink-secondary">
        <input
          name="isActive"
          type="checkbox"
          defaultChecked={item?.isActive ?? true}
        />
        {tx(fr, "Active model", "Modele actif")}
      </label>
      <Field
        label={tx(
          fr,
          "Description / operating notes",
          "Description / notes exploitation",
        )}
        htmlFor="model-notes"
        className="mt-4"
      >
        <Textarea name="notes" defaultValue={item?.notes ?? ""} />
      </Field>
      <Submit busy={busy}>
        {item
          ? tx(fr, "Save model", "Enregistrer le modele")
          : tx(fr, "Create model", "Creer le modele")}
      </Submit>
    </form>
  );
}

function TargetManager({
  model,
  targets,
  loading,
  error,
  retry,
  canEdit,
  onAdd,
  onEdit,
  onDelete,
  deleting,
}: {
  model: Model | null;
  targets?: WeeklyTarget[];
  loading: boolean;
  error: unknown;
  retry: () => void;
  canEdit: boolean;
  onAdd: () => void;
  onEdit: (target: WeeklyTarget) => void;
  onDelete: (target: WeeklyTarget) => void;
  deleting: boolean;
}) {
  const fr = useLanguage().locale === "fr";
  if (!model)
    return (
      <EmptyState
        title="Select a performance model"
        description="Choose a model to view and manage its weekly targets."
        icon={Target}
      />
    );
  if (loading) return <Skeleton className="h-64" />;
  if (error)
    return (
      <ErrorState
        title="Could not load weekly targets"
        description={message(error)}
        onRetry={retry}
      />
    );
  return (
    <aside className="rounded-2xl border border-border bg-gradient-to-br from-surface-1 via-surface-1 to-brand-subtle/20 p-4 shadow-[0_14px_30px_-26px_rgba(15,23,42,.36)] dark:shadow-[0_14px_30px_-26px_rgba(0,0,0,.8)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">{model.name}</p>
          <p className="mt-1 text-xs text-ink-secondary">
            Weekly standards · {readable(model.productionType)}
          </p>
        </div>
        {canEdit ? (
          <Button size="sm" onClick={onAdd}>
            <Plus />
            Add targets
          </Button>
        ) : null}
      </div>
      {targets?.length ? (
        <div className="mt-4 space-y-2">
          {targets.map((target) => (
            <div
              className="rounded-lg border border-border p-3"
              key={target.id}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink">
                  Week {target.weekNumber}
                </p>
                <Badge variant="info">±{target.tolerancePercent}%</Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-ink-secondary">
                {target.targetWeightG != null
                  ? `${target.targetWeightG} g target weight`
                  : "No weight target"}{" "}
                ·{" "}
                {target.feedGPerBirdPerDay != null
                  ? `${target.feedGPerBirdPerDay} g feed/bird/day`
                  : "No feed target"}
              </p>
              {canEdit ? (
                <div className="mt-2 flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onEdit(target)}
                  >
                    <Pencil />
                    {fr ? "Modifier" : "Edit"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={deleting}
                    onClick={() => onDelete(target)}
                  >
                    <Trash2 />
                    Delete
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No performance targets configured."
          description="Add weekly targets to calculate feed, water, growth and mortality expectations."
          icon={Target}
          action={
            canEdit ? { label: "Add targets", onClick: onAdd } : undefined
          }
        />
      )}
    </aside>
  );
}

function TargetForm({
  item,
  model,
  busy,
  onSubmit,
}: {
  item?: WeeklyTarget;
  model: Model;
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const fr = useLanguage().locale === "fr";
  const layer =
    model.productionType === "layer" || model.productionType === "breeder";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const keys = [
      "targetWeightG",
      "feedGPerBirdPerDay",
      "cumulativeFeedGPerBird",
      "waterLitersPerBirdPerDay",
      "targetFcr",
      "targetDailyGainG",
      "expectedCumulativeMortalityPercent",
      "expectedLiveBirdPercent",
      "targetEggLayPercent",
      "targetEggCount",
      "targetEggWeightG",
      "maxRejectedEggPercent",
      "minTemperatureC",
      "maxTemperatureC",
      "minHumidityPercent",
      "maxHumidityPercent",
    ];
    const body: Record<string, unknown> = {
      tolerancePercent: numberValue(form, "tolerancePercent", 5),
      notes: stringValue(form, "notes"),
    };
    if (!item) body.weekNumber = numberValue(form, "weekNumber", 1);
    for (const key of keys) body[key] = numberValue(form, key);
    onSubmit(body);
  }
  return (
    <form className="mt-5" onSubmit={submit}>
      {item ? (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-secondary">
          Editing week {item.weekNumber}
        </p>
      ) : (
        <Field
          label={tx(fr, "Week number", "Numero semaine")}
          htmlFor="target-week"
          required
        >
          <Input
            name="weekNumber"
            type="number"
            min="1"
            max="150"
            step="1"
            required
          />
        </Field>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <OptionalNumber
          name="targetWeightG"
          label={tx(fr, "Target body weight (g)", "Poids cible (g)")}
          value={item?.targetWeightG}
        />
        <OptionalNumber
          name="feedGPerBirdPerDay"
          label={tx(fr, "Feed / bird / day (g)", "Aliment / oiseau / jour (g)")}
          value={item?.feedGPerBirdPerDay}
        />
        <OptionalNumber
          name="cumulativeFeedGPerBird"
          label={tx(
            fr,
            "Cumulative feed / bird (g)",
            "Aliment cumule / oiseau (g)",
          )}
          value={item?.cumulativeFeedGPerBird}
        />
        <OptionalNumber
          name="waterLitersPerBirdPerDay"
          label={tx(fr, "Water / bird / day (L)", "Eau / oiseau / jour (L)")}
          value={item?.waterLitersPerBirdPerDay}
        />
        <OptionalNumber
          name="targetFcr"
          label={tx(fr, "Target FCR", "FCR cible")}
          value={item?.targetFcr}
        />
        <OptionalNumber
          name="targetDailyGainG"
          label={tx(
            fr,
            "Expected daily gain (g)",
            "Gain quotidien attendu (g)",
          )}
          value={item?.targetDailyGainG}
        />
        <OptionalNumber
          name="expectedCumulativeMortalityPercent"
          label={tx(
            fr,
            "Maximum cumulative mortality (%)",
            "Mortalite cumulee maximum (%)",
          )}
          value={item?.expectedCumulativeMortalityPercent}
        />
        <OptionalNumber
          name="expectedLiveBirdPercent"
          label={tx(
            fr,
            "Expected live birds (%)",
            "Oiseaux vivants attendus (%)",
          )}
          value={item?.expectedLiveBirdPercent}
        />
        {layer ? (
          <>
            <OptionalNumber
              name="targetEggLayPercent"
              label={tx(fr, "Egg production (%)", "Production oeufs (%)")}
              value={item?.targetEggLayPercent}
            />
            <OptionalNumber
              name="targetEggCount"
              label={tx(fr, "Egg count target", "Objectif nombre oeufs")}
              value={item?.targetEggCount}
              step="1"
            />
            <OptionalNumber
              name="targetEggWeightG"
              label={tx(fr, "Egg weight (g)", "Poids oeuf (g)")}
              value={item?.targetEggWeightG}
            />
            <OptionalNumber
              name="maxRejectedEggPercent"
              label={tx(
                fr,
                "Maximum rejected eggs (%)",
                "Oeufs rejetes maximum (%)",
              )}
              value={item?.maxRejectedEggPercent}
            />
          </>
        ) : null}
        <OptionalNumber
          name="minTemperatureC"
          label={tx(fr, "Minimum temperature (°C)", "Temperature minimum (C)")}
          value={item?.minTemperatureC}
        />
        <OptionalNumber
          name="maxTemperatureC"
          label={tx(fr, "Maximum temperature (°C)", "Temperature maximum (C)")}
          value={item?.maxTemperatureC}
        />
        <OptionalNumber
          name="minHumidityPercent"
          label={tx(fr, "Minimum humidity (%)", "Humidite minimum (%)")}
          value={item?.minHumidityPercent}
        />
        <OptionalNumber
          name="maxHumidityPercent"
          label={tx(fr, "Maximum humidity (%)", "Humidite maximum (%)")}
          value={item?.maxHumidityPercent}
        />
        <OptionalNumber
          name="tolerancePercent"
          label={tx(fr, "Tolerance (%)", "Tolerance (%)")}
          value={item?.tolerancePercent ?? 5}
        />
      </div>
      <Field
        label={tx(fr, "Notes", "Notes")}
        htmlFor="target-notes"
        className="mt-4"
      >
        <Textarea name="notes" defaultValue={item?.notes ?? ""} />
      </Field>
      <Submit busy={busy}>
        {item
          ? tx(fr, "Save targets", "Enregistrer objectifs")
          : tx(fr, "Add targets", "Ajouter objectifs")}
      </Submit>
    </form>
  );
}
