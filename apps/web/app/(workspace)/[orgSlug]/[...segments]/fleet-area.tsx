"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CarFront,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Gauge,
  KeyRound,
  Pencil,
  Plus,
  Settings2,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { get, orgApiUrl, orgUrl } from "@/lib/api";
import {
  ownerManagementApi,
  type ManagementBody,
} from "@/lib/owner-management-api";
import { can, isOwner } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type Row = Record<string, unknown> & { id: string };
type ChecklistItem = {
  itemCode: string;
  itemLabel: string;
  guidance?: string | null;
  isRequired: boolean;
};
type FleetOverview = { profiles: Row[]; runs: Row[]; alerts: Row[] };
type FleetProfileUpdateBody = Parameters<
  typeof ownerManagementApi.updateFleetProfile
>[2];
type Employee = {
  id: string;
  fullName: string;
  employeeNumber?: string | null;
  member?: { memberId?: string | null } | null;
};

const value = (input: unknown) => String(input ?? "");
const number = (input: FormDataEntryValue | null) => {
  const raw = value(input).trim();
  // `Number("")` is 0.  Optional numeric inputs must remain empty rather
  // than becoming an invalid zero for the API's positive-number validation.
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};
const copy = (fr: boolean, en: string, french: string) => (fr ? french : en);
const dateLabel = (input: unknown, fr: boolean) => {
  const raw = value(input);
  if (!raw) return "—";
  const date = new Date(raw.includes("T") ? raw : `${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat(fr ? "fr-FR" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
};
const kindLabel = (kind: unknown, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    vehicle: ["Vehicle", "Véhicule"],
    motorcycle: ["Motorcycle", "Moto"],
    tractor: ["Tractor", "Tracteur"],
    generator: ["Generator", "Groupe électrogène"],
    pump: ["Pump", "Pompe motorisée"],
    motorized_equipment: ["Motorized equipment", "Engin motorisé"],
  };
  const label = labels[value(kind)] ?? [value(kind), value(kind)];
  return label[fr ? 1 : 0];
};
const stateLabel = (state: unknown, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    open: ["Out", "En sortie"],
    returned: ["Returned", "Retournée"],
    cancelled: ["Cancelled", "Annulée"],
    pass: ["Pass", "Conforme"],
    fail: ["Failed", "Anomalie"],
    warning: ["Warning", "Avertissement"],
    critical: ["Critical", "Critique"],
  };
  const label = labels[value(state)] ?? [value(state), value(state)];
  return label[fr ? 1 : 0];
};
const tone = (state: unknown) => {
  if (["returned", "pass"].includes(value(state))) return "good" as const;
  if (["critical", "fail", "cancelled"].includes(value(state)))
    return "critical" as const;
  return "warning" as const;
};

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-3"
      role="dialog"
      aria-modal="true"
    >
      <section className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface-1 p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
          >
            <X />
          </Button>
        </div>
        {children}
      </section>
    </div>
  );
}

function Metric({
  label,
  count,
  critical = false,
}: {
  label: string;
  count: string | number;
  critical?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${critical ? "border-critical/30 bg-critical/5" : "border-border bg-surface-1"}`}
    >
      <p className="text-xs font-medium text-ink-secondary">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${critical ? "text-critical" : "text-ink"}`}
      >
        {count}
      </p>
    </div>
  );
}

function Checklist({
  stage,
  items,
  fr,
}: {
  stage: "preTrip" | "postTrip";
  items: ChecklistItem[];
  fr: boolean;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-3">
      <p className="text-xs font-semibold text-ink">
        {stage === "preTrip"
          ? copy(fr, "Pre-trip control", "Contrôle avant départ")
          : copy(fr, "Post-trip control", "Contrôle après retour")}
      </p>
      {items.map((item) => (
        <div
          className="rounded-lg border border-border bg-surface-1 p-2.5"
          key={item.itemCode}
        >
          <input
            type="hidden"
            name={`${stage}-code-${item.itemCode}`}
            value={item.itemCode}
          />
          <input
            type="hidden"
            name={`${stage}-label-${item.itemCode}`}
            value={item.itemLabel}
          />
          <div className="flex gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-ink">
                {item.itemLabel}
                {item.isRequired ? (
                  <span className="ml-1 text-critical">*</span>
                ) : null}
              </p>
              {item.guidance ? (
                <p className="mt-0.5 text-[11px] leading-4 text-ink-secondary">
                  {item.guidance}
                </p>
              ) : null}
            </div>
            <select
              name={`${stage}-result-${item.itemCode}`}
              defaultValue="pass"
              className="h-8 rounded-md border border-border bg-surface-1 px-2 text-xs text-ink"
            >
              <option value="pass">{copy(fr, "Pass", "Conforme")}</option>
              <option value="fail">{copy(fr, "Fail", "Anomalie")}</option>
              <option value="not_applicable">N/A</option>
            </select>
          </div>
          <Input
            className="mt-2 h-8 text-xs"
            name={`${stage}-notes-${item.itemCode}`}
            placeholder={copy(
              fr,
              "Note if there is an issue",
              "Note si anomalie",
            )}
          />
        </div>
      ))}
    </div>
  );
}

function responsesFrom(
  form: FormData,
  stage: "preTrip" | "postTrip",
  items: ChecklistItem[],
) {
  return items.map((item) => ({
    itemCode: value(form.get(`${stage}-code-${item.itemCode}`)),
    itemLabel: value(form.get(`${stage}-label-${item.itemCode}`)),
    result: value(form.get(`${stage}-result-${item.itemCode}`)),
    notes: value(form.get(`${stage}-notes-${item.itemCode}`)) || null,
  }));
}

export function FleetArea({
  orgSlug,
  personal = false,
}: {
  orgSlug: string;
  personal?: boolean;
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const canManageFleet =
    isOwner(user) || can(user, "vehicles.fleet_control.update");
  const client = useQueryClient();
  const fleet = useQuery({
    queryKey: ["fleet", orgSlug, personal ? "personal" : "control"],
    queryFn: () =>
      personal
        ? ownerManagementApi.myFleetOverview<{ fleet: FleetOverview }>(orgSlug)
        : ownerManagementApi.fleetOverview<{ fleet: FleetOverview }>(orgSlug),
  });
  const assets = useQuery({
    queryKey: ["fleet-assets", orgSlug],
    queryFn: () =>
      ownerManagementApi.list<{ records: Row[] }>(orgSlug, "assets"),
    enabled: !personal && canManageFleet,
  });
  const employees = useQuery({
    queryKey: ["fleet-employees", orgSlug],
    queryFn: () => get<{ employees: Employee[] }>(orgUrl(orgSlug, "employees")),
    enabled: !personal && canManageFleet,
  });
  const [profileDialog, setProfileDialog] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Row | null>(null);
  const [responsibilityFor, setResponsibilityFor] = useState<Row | null>(null);
  const [startFor, setStartFor] = useState<Row | null>(null);
  const [returning, setReturning] = useState<Row | null>(null);
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["fleet", orgSlug] });
  const createProfile = useMutation({
    mutationFn: (
      body: Parameters<typeof ownerManagementApi.createFleetProfile>[1],
    ) => ownerManagementApi.createFleetProfile(orgSlug, body),
    onSuccess: () => {
      setProfileDialog(false);
      refresh();
    },
  });
  const updateProfile = useMutation({
    mutationFn: ({
      profileId,
      body,
    }: {
      profileId: string;
      body: FleetProfileUpdateBody;
    }) => ownerManagementApi.updateFleetProfile(orgSlug, profileId, body),
    onSuccess: () => {
      setEditingProfile(null);
      refresh();
    },
  });
  const addResponsibility = useMutation({
    mutationFn: ({
      profileId,
      body,
    }: {
      profileId: string;
      body: Parameters<typeof ownerManagementApi.addFleetAuthorization>[2];
    }) => ownerManagementApi.addFleetAuthorization(orgSlug, profileId, body),
    onSuccess: () => {
      setResponsibilityFor(null);
      refresh();
    },
  });
  const start = useMutation({
    mutationFn: (body: ManagementBody) =>
      ownerManagementApi.startFleetRun(orgSlug, body),
    onSuccess: () => {
      setStartFor(null);
      refresh();
    },
  });
  const finish = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ManagementBody }) =>
      ownerManagementApi.returnFleetRun(orgSlug, id, body),
    onSuccess: () => {
      setReturning(null);
      refresh();
    },
  });
  const overview = fleet.data?.fleet;
  const profiles = overview?.profiles ?? [];
  const runs = overview?.runs ?? [];
  const alerts = overview?.alerts ?? [];
  const activeProfiles = profiles.filter(
    (profile) => value(profile.assetStatus) !== "retired",
  ).length;
  const driversFor = (profile: Row) =>
    ((profile.authorizations as Row[] | undefined) ?? []).filter(
      (authorization) =>
        ["driver", "operator"].includes(value(authorization.responsibility)),
    );
  const canFillForAnotherOperator = (profile: Row) =>
    canManageFleet ||
    (
      (profile.currentMemberResponsibilities as string[] | undefined) ?? []
    ).some(
      (responsibility) =>
        responsibility === "fleet_controller" ||
        responsibility === "maintenance_controller",
    );
  const profilesReadyForSheet = profiles.filter(
    (profile) => !profile.openRunId && driversFor(profile).length > 0,
  );
  const managesFleet =
    personal && profiles.some((profile) => canFillForAnotherOperator(profile));

  if (fleet.isLoading)
    return (
      <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
        <Skeleton className="h-32" />
        <Skeleton className="h-80" />
      </main>
    );
  if (fleet.isError)
    return (
      <main className="p-6">
        <ErrorState
          title={copy(
            fr,
            "Could not load fleet control",
            "Impossible de charger le contrôle de flotte",
          )}
          description={
            fleet.error instanceof Error ? fleet.error.message : undefined
          }
          onRetry={() => {
            void fleet.refetch();
          }}
        />
      </main>
    );

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="rounded-2xl border border-border bg-[linear-gradient(120deg,rgba(11,94,85,.12),rgba(37,99,235,.08))] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-brand">
              <CarFront className="size-4" />
              {personal
                ? copy(fr, "Assigned equipment", "Équipement affecté")
                : copy(
                    fr,
                    "Strict operating control",
                    "Contrôle d’exploitation strict",
                  )}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
              {personal
                ? copy(fr, "My vehicle / engine", "Mon véhicule / engin")
                : copy(
                    fr,
                    "Fleet & motorized equipment",
                    "Flotte & engins motorisés",
                  )}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-secondary">
              {personal
                ? copy(
                    fr,
                    "Start with a signed pre-trip check, record the meter and fuel, then close the same sheet when you return.",
                    "Commencez par le contrôle signé avant départ, relevez le compteur et le carburant, puis clôturez la même fiche au retour.",
                  )
                : copy(
                    fr,
                    "One controlled record links the driver, daily meter, fuel, maintenance, project and return inspection. It replaces loose paper logs.",
                    "Une fiche contrôlée relie conducteur, compteur journalier, carburant, maintenance, projet et contrôle de retour. Elle remplace les carnets dispersés.",
                  )}
            </p>
          </div>
          {canManageFleet && !personal ? (
            <Button onClick={() => setProfileDialog(true)}>
              <Plus />
              {copy(fr, "Configure equipment", "Configurer un engin")}
            </Button>
          ) : null}
        </div>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label={copy(fr, "Controlled equipment", "Engins contrôlés")}
          count={activeProfiles}
        />
        <Metric
          label={copy(fr, "Currently out", "En sortie")}
          count={runs.filter((run) => value(run.status) === "open").length}
        />
        <Metric
          label={copy(fr, "Open controls", "Contrôles ouverts")}
          count={alerts.length}
          critical={alerts.some(
            (alert) => value(alert.severity) === "critical",
          )}
        />
        <Metric
          label={copy(fr, "Returned today", "Retours aujourd’hui")}
          count={
            runs.filter(
              (run) =>
                value(run.status) === "returned" &&
                value(run.runDate) === new Date().toISOString().slice(0, 10),
            ).length
          }
        />
      </div>
      <div className="hidden" aria-hidden="true">
        {!personal && canManageFleet && profiles.length ? (
          <section className="rounded-2xl border border-border bg-surface-1 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-ink">
                  {copy(fr, "Equipment settings", "Réglages des engins")}
                </h2>
                <p className="mt-1 text-xs text-ink-secondary">
                  {copy(
                    fr,
                    "Correct the safety, fuel and maintenance rules without changing past daily sheets.",
                    "Corrigez les règles de sécurité, carburant et maintenance sans modifier les fiches quotidiennes passées.",
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {profiles.map((profile) => (
                  <Button
                    key={profile.id}
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditingProfile(profile)}
                  >
                    <Pencil />
                    {copy(fr, "Edit", "Modifier")} · {value(profile.assetName)}
                  </Button>
                ))}
              </div>
            </div>
          </section>
        ) : null}
        {!personal && canManageFleet && profilesReadyForSheet.length ? (
          <section className="rounded-2xl border border-brand/20 bg-brand-subtle/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
                  {copy(fr, "Step 2", "Étape 2")}
                </p>
                <h2 className="mt-1 font-semibold text-ink">
                  {copy(
                    fr,
                    "Complete a daily sheet for a driver",
                    "Remplir une fiche quotidienne pour un conducteur",
                  )}
                </h2>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-ink-secondary">
                  {copy(
                    fr,
                    "Use this when the assigned driver did not complete their sheet. The driver remains the real operator; your name is stored as the person who completed the pre-trip check.",
                    "Utilisez ceci si le conducteur affecté n’a pas rempli sa fiche. Le conducteur reste l’opérateur réel ; votre nom est enregistré comme personne ayant rempli le contrôle avant départ.",
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {profilesReadyForSheet.map((profile) => (
                  <Button
                    key={profile.id}
                    size="sm"
                    onClick={() => setStartFor(profile)}
                  >
                    <ClipboardCheck />
                    {copy(fr, "Daily sheet", "Fiche quotidienne")} ·{" "}
                    {value(profile.assetName)}
                  </Button>
                ))}
              </div>
            </div>
          </section>
        ) : null}
      </div>
      {!personal && alerts.length ? (
        <section className="rounded-2xl border border-warning/30 bg-warning/5 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-warning" />
            <h2 className="font-semibold text-ink">
              {copy(fr, "Controls requiring review", "Contrôles à examiner")}
            </h2>
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {alerts.slice(0, 6).map((alert) => (
              <div
                className="rounded-xl border border-border bg-surface-1 px-3 py-2.5"
                key={alert.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-ink">
                    {value(alert.title)}
                  </p>
                  <Badge variant={tone(alert.severity)}>
                    {stateLabel(alert.severity, fr)}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-ink-secondary">
                  {value(alert.assetName)} · {value(alert.runCode) || "—"}
                </p>
                {alert.details ? (
                  <p className="mt-1 text-xs text-ink-secondary">
                    {value(alert.details)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <div className="hidden" aria-hidden="true">
        <section className="rounded-2xl border border-border bg-surface-1">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
            <div>
              {!personal ? (
                <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
                  {copy(fr, "Step 1", "Étape 1")}
                </p>
              ) : null}
              <h2 className="mt-1 font-semibold text-ink">
                {personal
                  ? managesFleet
                    ? copy(
                        fr,
                        "Equipment under my responsibility",
                        "Engins sous ma responsabilité",
                      )
                    : copy(
                        fr,
                        "My authorized equipment",
                        "Mes engins autorisés",
                      )
                  : copy(
                      fr,
                      "Assign equipment and responsibilities",
                      "Affecter l’engin et les responsabilités",
                    )}
              </h2>
              <p className="mt-1 text-xs text-ink-secondary">
                {personal
                  ? managesFleet
                    ? copy(
                        fr,
                        "You may complete a sheet or close a return for the assigned driver. The record always keeps the real driver and the signer separately.",
                        "Vous pouvez remplir une fiche ou clôturer un retour pour le conducteur affecté. La fiche conserve toujours séparément le conducteur réel et le signataire.",
                      )
                    : copy(
                        fr,
                        "Only equipment assigned to you appears here.",
                        "Seuls les engins qui vous sont affectés apparaissent ici.",
                      )
                  : copy(
                      fr,
                      "Choose the driver, operator, fleet controller or maintenance controller before creating a daily sheet.",
                      "Choisissez le conducteur, l’opérateur, le contrôleur flotte ou le responsable maintenance avant de créer une fiche quotidienne.",
                    )}
              </p>
            </div>
          </div>
          {profiles.length ? (
            <div className="divide-y divide-border">
              {profiles.map((profile) => (
                <article
                  className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto]"
                  key={profile.id}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-ink">
                        {value(profile.assetName)}
                      </h3>
                      <Badge variant="info">
                        {kindLabel(profile.operationKind, fr)}
                      </Badge>
                      {profile.openRunId ? (
                        <Badge variant="warning">
                          {copy(fr, "Out", "En sortie")}
                        </Badge>
                      ) : (
                        <Badge variant="good">
                          {copy(fr, "Available", "Disponible")}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {value(profile.assetNumber)} ·{" "}
                      {value(profile.siteName) ||
                        copy(fr, "No site", "Sans site")}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-subtle px-2.5 py-1 text-brand">
                        <Gauge className="size-3" />
                        {value(profile.currentMeterReading) || "—"}{" "}
                        {value(profile.meterType) === "mileage_km"
                          ? "km"
                          : value(profile.meterType) === "engine_hours"
                            ? "h"
                            : ""}
                      </span>
                      {profile.requiresOperatorLicence ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-ink-secondary">
                          <KeyRound className="size-3" />
                          {copy(fr, "Licence required", "Permis requis")}
                        </span>
                      ) : null}
                      {profile.expectedConsumption ? (
                        <span className="rounded-full bg-surface-2 px-2.5 py-1 text-ink-secondary">
                          {copy(fr, "Target", "Norme")} ·{" "}
                          {value(profile.expectedConsumption)}{" "}
                          {value(profile.expectedConsumptionUnit) ===
                          "litres_per_100km"
                            ? "L/100 km"
                            : "L/h"}
                        </span>
                      ) : null}
                    </div>
                    {!personal ? (
                      <p className="mt-3 text-xs text-ink-secondary">
                        <b className="text-ink">
                          {copy(fr, "Fleet controller", "Contrôleur flotte")}:
                        </b>{" "}
                        {value(profile.fleetControllerName) || "—"} ·{" "}
                        <b className="text-ink">
                          {copy(fr, "Maintenance", "Maintenance")}:
                        </b>{" "}
                        {value(profile.maintenanceControllerName) || "—"}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end lg:self-start">
                    {personal && !profile.openRunId ? (
                      <Button size="sm" onClick={() => setStartFor(profile)}>
                        <ClipboardCheck />
                        {copy(fr, "Start daily sheet", "Démarrer la fiche")}
                      </Button>
                    ) : null}
                    {!personal && canManageFleet ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setResponsibilityFor(profile)}
                      >
                        <UserRound />
                        {copy(fr, "Assign", "Affecter")}
                      </Button>
                    ) : null}
                    {profile.openRunId ? (
                      <a
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 text-xs font-semibold text-ink transition hover:bg-surface-2"
                        href={orgApiUrl(
                          orgSlug,
                          `my-fleet/runs/${value(profile.openRunId)}/export.pdf`,
                        )}
                      >
                        <Download className="size-3.5" />
                        PDF
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={CarFront}
              title={
                personal
                  ? copy(fr, "No equipment assigned", "Aucun engin affecté")
                  : copy(fr, "No controlled equipment", "Aucun engin contrôlé")
              }
              description={
                personal
                  ? copy(
                      fr,
                      "Ask the owner or fleet controller to assign your vehicle or engine.",
                      "Demandez au propriétaire ou au contrôleur flotte de vous affecter votre véhicule ou engin.",
                    )
                  : copy(
                      fr,
                      "Register an asset first, then configure strict fleet control for vehicles, motorcycles and motorized equipment.",
                      "Enregistrez d’abord l’actif, puis configurez le contrôle strict des véhicules, motos et engins motorisés.",
                    )
              }
            />
          )}
        </section>
        {!personal && !runs.length && !profilesReadyForSheet.length ? (
          <section className="rounded-2xl border border-brand/20 bg-brand-subtle/40 p-4">
            <h2 className="font-semibold text-ink">
              {copy(
                fr,
                "How the first daily sheet appears",
                "Comment créer la première fiche quotidienne",
              )}
            </h2>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-sm leading-6 text-ink-secondary">
              <li>
                {copy(
                  fr,
                  "Use Assign on the equipment and choose the driver or operator.",
                  "Utilisez Affecter sur l’engin et choisissez le conducteur ou l’opérateur.",
                )}
              </li>
              <li>
                {copy(
                  fr,
                  "If a licence is required, add and verify it in that employee's dossier.",
                  "Si un permis est requis, ajoutez-le et validez-le dans le dossier de cet employé.",
                )}
              </li>
              <li>
                {copy(
                  fr,
                  "The assigned person opens My vehicle / engine and signs Start daily sheet. The owner, fleet controller or maintenance controller may complete it for the real driver when necessary.",
                  "La personne affectée ouvre Mon véhicule / engin et signe Démarrer la fiche. Le propriétaire, contrôleur flotte ou responsable maintenance peut la remplir pour le conducteur réel si nécessaire.",
                )}
              </li>
            </ol>
          </section>
        ) : null}
      </div>
      <FleetEquipmentCards
        profiles={profiles}
        runs={runs}
        orgSlug={orgSlug}
        fr={fr}
        personal={personal}
        canManage={canManageFleet}
        onEdit={setEditingProfile}
        onAssign={setResponsibilityFor}
        onStart={setStartFor}
        onReturn={setReturning}
      />
      {profileDialog ? (
        <ProfileDialog
          assets={assets.data?.records ?? []}
          fr={fr}
          pending={createProfile.isPending}
          error={createProfile.error}
          onClose={() => setProfileDialog(false)}
          onSave={(body) => createProfile.mutate(body)}
        />
      ) : null}
      {editingProfile ? (
        <EditFleetProfileDialog
          profile={editingProfile}
          fr={fr}
          pending={updateProfile.isPending}
          error={updateProfile.error}
          onClose={() => setEditingProfile(null)}
          onSave={(body) =>
            updateProfile.mutate({ profileId: editingProfile.id, body })
          }
        />
      ) : null}
      {responsibilityFor ? (
        <ResponsibilityDialog
          profile={responsibilityFor}
          employees={employees.data?.employees ?? []}
          fr={fr}
          pending={addResponsibility.isPending}
          error={addResponsibility.error}
          onClose={() => setResponsibilityFor(null)}
          onSave={(body) =>
            addResponsibility.mutate({ profileId: responsibilityFor.id, body })
          }
        />
      ) : null}
      {startFor ? (
        <ManagedStartDialog
          profile={startFor}
          fr={fr}
          pending={start.isPending}
          error={start.error}
          canFillForAnotherOperator={canFillForAnotherOperator(startFor)}
          onClose={() => setStartFor(null)}
          onSave={(body) => start.mutate(body)}
        />
      ) : null}
      {returning ? (
        <ReturnDialog
          run={returning}
          profile={
            profiles.find(
              (profile) =>
                value(profile.id) === value(returning.fleetProfileId),
            ) ?? null
          }
          fr={fr}
          pending={finish.isPending}
          error={finish.error}
          onClose={() => setReturning(null)}
          onSave={(body) => finish.mutate({ id: returning.id, body })}
        />
      ) : null}
    </main>
  );
}

function FleetEquipmentCards({
  profiles,
  runs,
  orgSlug,
  fr,
  personal,
  canManage,
  onEdit,
  onAssign,
  onStart,
  onReturn,
}: {
  profiles: Row[];
  runs: Row[];
  orgSlug: string;
  fr: boolean;
  personal: boolean;
  canManage: boolean;
  onEdit: (profile: Row) => void;
  onAssign: (profile: Row) => void;
  onStart: (profile: Row) => void;
  onReturn: (run: Row) => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface-1">
      <div className="border-b border-border px-4 py-4">
        <h2 className="font-semibold text-ink">
          {personal
            ? copy(fr, "My equipment", "Mes engins")
            : copy(
                fr,
                "Equipment and daily sheets",
                "Engins et fiches quotidiennes",
              )}
        </h2>
        <p className="mt-1 text-xs text-ink-secondary">
          {copy(
            fr,
            "Every card contains the responsibilities, controls and daily records for one exact vehicle or engine.",
            "Chaque carte regroupe les responsabilités, contrôles et fiches quotidiennes d’un seul véhicule ou engin.",
          )}
        </p>
      </div>
      {profiles.length ? (
        <div className="max-h-[calc(100dvh-15rem)] divide-y divide-border overflow-y-auto">
          {profiles.map((profile) => {
            const authorizations =
              (profile.authorizations as Row[] | undefined) ?? [];
            const drivers = authorizations.filter((authorization) =>
              ["driver", "operator"].includes(
                value(authorization.responsibility),
              ),
            );
            const profileRuns = runs.filter(
              (run) => value(run.fleetProfileId) === value(profile.id),
            );
            const canStart =
              !profile.openRunId &&
              (personal ? drivers.length > 0 : canManage && drivers.length > 0);
            return (
              <article className="p-4 sm:p-5" key={profile.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-ink">
                        {value(profile.assetName)}
                      </h3>
                      <Badge variant="info">
                        {kindLabel(profile.operationKind, fr)}
                      </Badge>
                      {profile.openRunId ? (
                        <Badge variant="warning">
                          {copy(fr, "Out", "En sortie")}
                        </Badge>
                      ) : (
                        <Badge variant="good">
                          {copy(fr, "Available", "Disponible")}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {value(profile.assetNumber)} ·{" "}
                      {value(profile.siteName) ||
                        copy(fr, "No site", "Sans site")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onEdit(profile)}
                      >
                        <Pencil />
                        {copy(fr, "Settings", "Réglages")}
                      </Button>
                    ) : null}
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onAssign(profile)}
                      >
                        <UserRound />
                        {copy(fr, "Assign", "Affecter")}
                      </Button>
                    ) : null}
                    {canStart ? (
                      <Button size="sm" onClick={() => onStart(profile)}>
                        <ClipboardCheck />
                        {canManage
                          ? copy(fr, "Complete sheet", "Remplir la fiche")
                          : copy(fr, "Start sheet", "Démarrer la fiche")}
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(16rem,.8fr)_minmax(0,1.2fr)]">
                  <div className="rounded-xl border border-border bg-surface-2 p-3">
                    <p className="text-xs font-semibold uppercase tracking-[.1em] text-ink-secondary">
                      {copy(fr, "Responsibilities", "Responsabilités")}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {authorizations.length ? (
                        authorizations.map((authorization) => (
                          <span
                            className="rounded-full bg-surface-1 px-2.5 py-1 text-xs text-ink"
                            key={`${value(authorization.memberId)}-${value(authorization.responsibility)}`}
                          >
                            {value(authorization.memberName)} ·{" "}
                            {value(authorization.responsibility) === "driver"
                              ? copy(fr, "Driver", "Conducteur")
                              : value(authorization.responsibility) ===
                                  "operator"
                                ? copy(fr, "Operator", "Opérateur")
                                : value(authorization.responsibility) ===
                                    "fleet_controller"
                                  ? copy(
                                      fr,
                                      "Fleet controller",
                                      "Contrôleur flotte",
                                    )
                                  : value(authorization.responsibility) ===
                                      "maintenance_controller"
                                    ? copy(fr, "Maintenance", "Maintenance")
                                    : copy(
                                        fr,
                                        "Gate verifier",
                                        "Vérificateur portail",
                                      )}
                          </span>
                        ))
                      ) : (
                        <p className="text-xs text-warning-ink">
                          {copy(
                            fr,
                            "Assign a driver before creating a sheet.",
                            "Affectez un conducteur avant de créer une fiche.",
                          )}
                        </p>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-subtle px-2.5 py-1 text-brand">
                        <Gauge className="size-3" />
                        {value(profile.currentMeterReading) || "—"}{" "}
                        {value(profile.meterType) === "mileage_km"
                          ? "km"
                          : value(profile.meterType) === "engine_hours"
                            ? "h"
                            : ""}
                      </span>
                      {profile.requiresOperatorLicence ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-surface-1 px-2.5 py-1 text-ink-secondary">
                          <KeyRound className="size-3" />
                          {copy(fr, "Licence required", "Permis requis")}
                        </span>
                      ) : null}
                      {profile.expectedConsumption ? (
                        <span className="rounded-full bg-surface-1 px-2.5 py-1 text-ink-secondary">
                          {copy(fr, "Target", "Norme")} ·{" "}
                          {value(profile.expectedConsumption)}{" "}
                          {value(profile.expectedConsumptionUnit) ===
                          "litres_per_100km"
                            ? "L/100 km"
                            : "L/h"}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-surface-2 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[.1em] text-ink-secondary">
                        {copy(fr, "Daily sheets", "Fiches quotidiennes")}
                      </p>
                      <Badge
                        variant={
                          profileRuns.some(
                            (run) => value(run.status) === "open",
                          )
                            ? "warning"
                            : "info"
                        }
                      >
                        {profileRuns.length} {copy(fr, "sheet(s)", "fiche(s)")}
                      </Badge>
                    </div>
                    {profileRuns.length ? (
                      <div className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
                        {profileRuns.map((run) => (
                          <div
                            className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border bg-surface-1 p-2.5"
                            key={run.id}
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-medium text-ink">
                                  {value(run.runCode)}
                                </p>
                                <Badge variant={tone(run.status)}>
                                  {stateLabel(run.status, fr)}
                                </Badge>
                              </div>
                              <p className="mt-1 text-xs font-medium text-ink-secondary">
                                {copy(fr, "Sheet date", "Date de la fiche")} :{" "}
                                {dateLabel(run.runDate, fr)}
                              </p>
                              <p className="mt-1 text-xs text-ink-secondary">
                                {copy(fr, "Driver", "Conducteur")} :{" "}
                                {value(run.operatorName)} · {value(run.purpose)}
                              </p>
                              <p className="mt-1 text-xs text-ink-secondary">
                                {copy(fr, "Signed by", "Signée par")} :{" "}
                                {value(run.preTripSignerName) || "—"}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              {(personal || canManage) &&
                              value(run.status) === "open" ? (
                                <Button size="sm" onClick={() => onReturn(run)}>
                                  <CheckCircle2 />
                                  {copy(fr, "Return", "Clôturer")}
                                </Button>
                              ) : null}
                              <a
                                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 text-xs font-semibold text-ink hover:bg-surface-2"
                                href={orgApiUrl(
                                  orgSlug,
                                  `my-fleet/runs/${value(run.id)}/export.pdf`,
                                )}
                              >
                                <Download className="size-3.5" />
                                PDF
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-ink-secondary">
                        {copy(
                          fr,
                          "No daily sheet for this equipment yet.",
                          "Aucune fiche quotidienne pour cet engin pour le moment.",
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="p-4">
          <EmptyState
            icon={CarFront}
            title={copy(fr, "No controlled equipment", "Aucun engin contrôlé")}
            description={copy(
              fr,
              "Register and configure equipment before assigning its operator.",
              "Enregistrez et configurez un engin avant d’affecter son opérateur.",
            )}
          />
        </div>
      )}
    </section>
  );
}

function _FleetDailySheets({
  profiles,
  runs,
  orgSlug,
  fr,
  canCloseRun,
  onReturn,
}: {
  profiles: Row[];
  runs: Row[];
  orgSlug: string;
  fr: boolean;
  canCloseRun: boolean;
  onReturn: (run: Row) => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface-1">
      <div className="border-b border-border px-4 py-4">
        <h2 className="font-semibold text-ink">
          {copy(
            fr,
            "Daily sheets by equipment",
            "Fiches quotidiennes par engin",
          )}
        </h2>
        <p className="mt-1 text-xs text-ink-secondary">
          {copy(
            fr,
            "Each record stays with the exact vehicle or engine it concerns.",
            "Chaque fiche reste rattachée au véhicule ou à l’engin exact concerné.",
          )}
        </p>
      </div>
      {profiles.length ? (
        <div className="divide-y divide-border">
          {profiles.map((profile) => {
            const profileRuns = runs.filter(
              (run) => value(run.fleetProfileId) === value(profile.id),
            );
            return (
              <article className="p-4" key={profile.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-ink">
                      {value(profile.assetName)}
                    </h3>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {value(profile.assetNumber)} ·{" "}
                      {value(profile.siteName) ||
                        copy(fr, "No site", "Sans site")}
                    </p>
                  </div>
                  <Badge
                    variant={
                      profileRuns.some((run) => value(run.status) === "open")
                        ? "warning"
                        : "info"
                    }
                  >
                    {profileRuns.length} {copy(fr, "sheet(s)", "fiche(s)")}
                  </Badge>
                </div>
                {profileRuns.length ? (
                  <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                    {profileRuns.map((run) => (
                      <div
                        className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-surface-2 p-3"
                        key={run.id}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-ink">
                              {value(run.runCode)}
                            </p>
                            <Badge variant={tone(run.status)}>
                              {stateLabel(run.status, fr)}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs font-medium text-ink-secondary">
                            {copy(fr, "Sheet date", "Date de la fiche")} :{" "}
                            {dateLabel(run.runDate, fr)}
                          </p>
                          <p className="mt-1 text-xs text-ink-secondary">
                            {copy(fr, "Driver", "Conducteur")} :{" "}
                            {value(run.operatorName)} · {value(run.purpose)}
                          </p>
                          <p className="mt-1 text-xs text-ink-secondary">
                            {copy(
                              fr,
                              "Pre-trip signed by",
                              "Avant-départ signé par",
                            )}{" "}
                            : {value(run.preTripSignerName) || "—"}
                            {value(run.postTripSignerName)
                              ? ` · ${copy(fr, "Return signed by", "Retour signé par")} : ${value(run.postTripSignerName)}`
                              : ""}
                          </p>
                          <p className="mt-1 text-xs text-ink-secondary">
                            {copy(fr, "Meter", "Compteur")} :{" "}
                            {value(run.startMeter) || "—"} →{" "}
                            {value(run.endMeter) || "—"}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          {canCloseRun && value(run.status) === "open" ? (
                            <Button size="sm" onClick={() => onReturn(run)}>
                              <CheckCircle2 />
                              {copy(fr, "Return", "Clôturer le retour")}
                            </Button>
                          ) : null}
                          <a
                            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 text-xs font-semibold text-ink hover:bg-surface-2"
                            href={orgApiUrl(
                              orgSlug,
                              `my-fleet/runs/${value(run.id)}/export.pdf`,
                            )}
                          >
                            <Download className="size-3.5" />
                            PDF
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 rounded-xl border border-dashed border-border bg-surface-2 px-3 py-3 text-sm text-ink-secondary">
                    {copy(
                      fr,
                      "No daily sheet for this equipment yet.",
                      "Aucune fiche quotidienne pour cet engin pour le moment.",
                    )}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="p-4">
          <EmptyState
            icon={ClipboardCheck}
            title={copy(fr, "No controlled equipment", "Aucun engin contrôlé")}
            description={copy(
              fr,
              "Configure an engine before recording its daily sheets.",
              "Configurez un engin avant d’enregistrer ses fiches quotidiennes.",
            )}
          />
        </div>
      )}
    </section>
  );
}

function FormError({ error }: { error: unknown }) {
  return error ? (
    <p className="mt-3 rounded-lg bg-critical/10 px-3 py-2 text-xs text-critical">
      {error instanceof Error ? error.message : "Could not save this record"}
    </p>
  ) : null;
}

function ProfileDialog({
  assets,
  fr,
  pending,
  error,
  onClose,
  onSave,
}: {
  assets: Row[];
  fr: boolean;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (
    body: Parameters<typeof ownerManagementApi.createFleetProfile>[1],
  ) => void;
}) {
  return (
    <Dialog
      title={copy(
        fr,
        "Configure a vehicle or engine",
        "Configurer un véhicule ou engin",
      )}
      onClose={onClose}
    >
      <p className="mt-1 text-sm text-ink-secondary">
        {copy(
          fr,
          "Use this only for an asset that must have a controlled daily check-out and return.",
          "Utilisez ceci seulement pour un actif qui nécessite une sortie et un retour journalier contrôlés.",
        )}
      </p>
      <form
        className="mt-5 grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          onSave({
            assetId: value(form.get("assetId")),
            operationKind: value(form.get("operationKind")) as Parameters<
              typeof ownerManagementApi.createFleetProfile
            >[1]["operationKind"],
            requiresPreTrip: form.get("requiresPreTrip") === "on",
            requiresPostTrip: form.get("requiresPostTrip") === "on",
            requiresGateCheck: form.get("requiresGateCheck") === "on",
            requiresOperatorLicence:
              form.get("requiresOperatorLicence") === "on",
            requiredLicenceClass:
              value(form.get("requiredLicenceClass")) || null,
            dailyMeterRequired: form.get("dailyMeterRequired") === "on",
            preventDispatchWhenDue: form.get("preventDispatchWhenDue") === "on",
            fuelTankCapacityLitres: number(form.get("fuelTankCapacityLitres")),
            expectedConsumption: number(form.get("expectedConsumption")),
            expectedConsumptionUnit: (value(
              form.get("expectedConsumptionUnit"),
            ) || null) as "litres_per_100km" | "litres_per_hour" | null,
            consumptionTolerancePercent:
              number(form.get("consumptionTolerancePercent")) ?? 20,
            notes: value(form.get("notes")) || null,
          });
        }}
      >
        <Field label={copy(fr, "Equipment", "Équipement")} required>
          <select
            className="h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink"
            name="assetId"
            required
          >
            <option value="">
              {copy(fr, "Choose equipment", "Choisir un équipement")}
            </option>
            {assets.map((asset) => (
              <option value={asset.id} key={asset.id}>
                {value(asset.name)} · {value(asset.assetNumber)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={copy(fr, "Engine type", "Type d’engin")} required>
          <select
            className="h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink"
            name="operationKind"
            defaultValue="vehicle"
          >
            <option value="vehicle">{copy(fr, "Vehicle", "Véhicule")}</option>
            <option value="motorcycle">{copy(fr, "Motorcycle", "Moto")}</option>
            <option value="tractor">{copy(fr, "Tractor", "Tracteur")}</option>
            <option value="generator">
              {copy(fr, "Generator", "Groupe électrogène")}
            </option>
            <option value="pump">{copy(fr, "Pump", "Pompe motorisée")}</option>
            <option value="motorized_equipment">
              {copy(fr, "Other motorized equipment", "Autre engin motorisé")}
            </option>
          </select>
        </Field>
        <Field
          label={copy(
            fr,
            "Tank capacity (litres)",
            "Capacité du réservoir (litres)",
          )}
        >
          <Input
            name="fuelTankCapacityLitres"
            type="number"
            min="0"
            step="0.01"
          />
        </Field>
        <Field
          label={copy(fr, "Expected consumption", "Consommation attendue")}
          hint={copy(
            fr,
            "For example: 8 L/100 km or 3.5 L/h.",
            "Exemple : 8 L/100 km ou 3,5 L/h.",
          )}
        >
          <Input name="expectedConsumption" type="number" min="0" step="0.01" />
        </Field>
        <Field label={copy(fr, "Consumption unit", "Unité de consommation")}>
          <select
            name="expectedConsumptionUnit"
            className="h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink"
          >
            <option value="">—</option>
            <option value="litres_per_100km">L / 100 km</option>
            <option value="litres_per_hour">L / h</option>
          </select>
        </Field>
        <Field label={copy(fr, "Allowed variance (%)", "Écart autorisé (%)")}>
          <Input
            name="consumptionTolerancePercent"
            type="number"
            min="0"
            max="200"
            defaultValue="20"
          />
        </Field>
        <div className="sm:col-span-2 grid gap-2 rounded-xl border border-border bg-surface-2 p-3 sm:grid-cols-2">
          {[
            [
              "requiresPreTrip",
              copy(
                fr,
                "Require signed pre-trip",
                "Exiger le contrôle signé avant départ",
              ),
            ],
            [
              "requiresPostTrip",
              copy(
                fr,
                "Require signed post-trip",
                "Exiger le contrôle signé au retour",
              ),
            ],
            [
              "requiresGateCheck",
              copy(
                fr,
                "Require independent gate verifier",
                "Exiger un vérificateur portail distinct",
              ),
            ],
            [
              "requiresOperatorLicence",
              copy(
                fr,
                "Require a verified licence",
                "Exiger un permis vérifié",
              ),
            ],
            [
              "dailyMeterRequired",
              copy(
                fr,
                "Require a daily meter reading",
                "Exiger le relevé journalier du compteur",
              ),
            ],
            [
              "preventDispatchWhenDue",
              copy(
                fr,
                "Block dispatch when safety service is due",
                "Bloquer la sortie si l’entretien sécurité est dû",
              ),
            ],
          ].map(([key, label]) => (
            <label
              className="flex items-start gap-2 text-xs text-ink"
              key={key}
            >
              <input
                className="mt-0.5 size-4 accent-brand"
                name={key}
                type="checkbox"
                defaultChecked={key !== "requiresGateCheck"}
              />
              {label}
            </label>
          ))}
        </div>
        <Field
          className="sm:col-span-2"
          label={copy(
            fr,
            "Licence class (if required)",
            "Catégorie de permis (si requise)",
          )}
        >
          <Input name="requiredLicenceClass" placeholder="A, B, C…" />
        </Field>
        <Field
          className="sm:col-span-2"
          label={copy(fr, "Control notes", "Notes de contrôle")}
        >
          <Textarea name="notes" />
        </Field>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {copy(fr, "Cancel", "Annuler")}
          </Button>
          <Button type="submit" loading={pending}>
            <Settings2 />
            {copy(fr, "Configure", "Configurer")}
          </Button>
        </div>
      </form>
      <FormError error={error} />
    </Dialog>
  );
}

function EditFleetProfileDialog({
  profile,
  fr,
  pending,
  error,
  onClose,
  onSave,
}: {
  profile: Row;
  fr: boolean;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (body: FleetProfileUpdateBody) => void;
}) {
  const checkboxes: Array<[keyof FleetProfileUpdateBody, string]> = [
    [
      "requiresPreTrip",
      copy(
        fr,
        "Require signed pre-trip",
        "Exiger le contrôle signé avant départ",
      ),
    ],
    [
      "requiresPostTrip",
      copy(
        fr,
        "Require signed post-trip",
        "Exiger le contrôle signé au retour",
      ),
    ],
    [
      "requiresGateCheck",
      copy(
        fr,
        "Require an independent gate verifier",
        "Exiger un vérificateur portail distinct",
      ),
    ],
    [
      "requiresOperatorLicence",
      copy(fr, "Require a verified licence", "Exiger un permis vérifié"),
    ],
    [
      "dailyMeterRequired",
      copy(
        fr,
        "Require a daily meter reading",
        "Exiger le relevé journalier du compteur",
      ),
    ],
    [
      "preventDispatchWhenDue",
      copy(
        fr,
        "Block dispatch when safety service is due",
        "Bloquer la sortie si l’entretien sécurité est dû",
      ),
    ],
  ];
  return (
    <Dialog
      title={`${copy(fr, "Edit equipment controls", "Modifier les contrôles")} · ${value(profile.assetName)}`}
      onClose={onClose}
    >
      <p className="mt-1 text-sm leading-6 text-ink-secondary">
        {copy(
          fr,
          "The equipment itself cannot be changed here, so its daily-sheet history remains intact.",
          "L’équipement lui-même ne peut pas être changé ici : l’historique de ses fiches quotidiennes reste intact.",
        )}
      </p>
      <form
        className="mt-5 grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          onSave({
            operationKind: value(
              form.get("operationKind"),
            ) as FleetProfileUpdateBody["operationKind"],
            requiresPreTrip: form.get("requiresPreTrip") === "on",
            requiresPostTrip: form.get("requiresPostTrip") === "on",
            requiresGateCheck: form.get("requiresGateCheck") === "on",
            requiresOperatorLicence:
              form.get("requiresOperatorLicence") === "on",
            requiredLicenceClass:
              value(form.get("requiredLicenceClass")) || null,
            dailyMeterRequired: form.get("dailyMeterRequired") === "on",
            preventDispatchWhenDue: form.get("preventDispatchWhenDue") === "on",
            fuelTankCapacityLitres: number(form.get("fuelTankCapacityLitres")),
            expectedConsumption: number(form.get("expectedConsumption")),
            expectedConsumptionUnit: (value(
              form.get("expectedConsumptionUnit"),
            ) || null) as FleetProfileUpdateBody["expectedConsumptionUnit"],
            consumptionTolerancePercent:
              number(form.get("consumptionTolerancePercent")) ?? 20,
            isActive: form.get("isActive") === "on",
            notes: value(form.get("notes")) || null,
          });
        }}
      >
        <Field label={copy(fr, "Engine type", "Type d’engin")} required>
          <select
            name="operationKind"
            defaultValue={value(profile.operationKind)}
            className="h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink"
          >
            <option value="vehicle">{copy(fr, "Vehicle", "Véhicule")}</option>
            <option value="motorcycle">{copy(fr, "Motorcycle", "Moto")}</option>
            <option value="tractor">{copy(fr, "Tractor", "Tracteur")}</option>
            <option value="generator">
              {copy(fr, "Generator", "Groupe électrogène")}
            </option>
            <option value="pump">{copy(fr, "Pump", "Pompe motorisée")}</option>
            <option value="motorized_equipment">
              {copy(fr, "Other motorized equipment", "Autre engin motorisé")}
            </option>
          </select>
        </Field>
        <Field
          label={copy(
            fr,
            "Licence class (if required)",
            "Catégorie de permis (si requise)",
          )}
        >
          <Input
            name="requiredLicenceClass"
            defaultValue={value(profile.requiredLicenceClass)}
            placeholder="A, B, C…"
          />
        </Field>
        <Field
          label={copy(
            fr,
            "Tank capacity (litres)",
            "Capacité du réservoir (litres)",
          )}
        >
          <Input
            name="fuelTankCapacityLitres"
            type="number"
            min="0"
            step="0.01"
            defaultValue={value(profile.fuelTankCapacityLitres)}
          />
        </Field>
        <Field
          label={copy(fr, "Expected consumption", "Consommation attendue")}
        >
          <Input
            name="expectedConsumption"
            type="number"
            min="0"
            step="0.01"
            defaultValue={value(profile.expectedConsumption)}
          />
        </Field>
        <Field label={copy(fr, "Consumption unit", "Unité de consommation")}>
          <select
            name="expectedConsumptionUnit"
            defaultValue={value(profile.expectedConsumptionUnit)}
            className="h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink"
          >
            <option value="">—</option>
            <option value="litres_per_100km">L / 100 km</option>
            <option value="litres_per_hour">L / h</option>
          </select>
        </Field>
        <Field label={copy(fr, "Allowed variance (%)", "Écart autorisé (%)")}>
          <Input
            name="consumptionTolerancePercent"
            type="number"
            min="0"
            max="200"
            defaultValue={value(profile.consumptionTolerancePercent) || "20"}
          />
        </Field>
        <div className="grid gap-2 rounded-xl border border-border bg-surface-2 p-3 sm:col-span-2 sm:grid-cols-2">
          {checkboxes.map(([key, label]) => (
            <label
              className="flex items-start gap-2 text-xs text-ink"
              key={key}
            >
              <input
                className="mt-0.5 size-4 accent-brand"
                name={key}
                type="checkbox"
                defaultChecked={Boolean(profile[key])}
              />
              {label}
            </label>
          ))}
          <label className="flex items-start gap-2 text-xs text-ink">
            <input
              className="mt-0.5 size-4 accent-brand"
              name="isActive"
              type="checkbox"
              defaultChecked={Boolean(profile.isActive)}
            />
            {copy(fr, "Control profile active", "Profil de contrôle actif")}
          </label>
        </div>
        <Field
          className="sm:col-span-2"
          label={copy(fr, "Control notes", "Notes de contrôle")}
        >
          <Textarea name="notes" defaultValue={value(profile.notes)} />
        </Field>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {copy(fr, "Cancel", "Annuler")}
          </Button>
          <Button type="submit" loading={pending}>
            <Pencil />
            {copy(fr, "Save changes", "Enregistrer les modifications")}
          </Button>
        </div>
      </form>
      <FormError error={error} />
    </Dialog>
  );
}

function ResponsibilityDialog({
  profile,
  employees,
  fr,
  pending,
  error,
  onClose,
  onSave,
}: {
  profile: Row;
  employees: Employee[];
  fr: boolean;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (
    body: Parameters<typeof ownerManagementApi.addFleetAuthorization>[2],
  ) => void;
}) {
  return (
    <Dialog
      title={`${copy(fr, "Assign responsibility", "Affecter une responsabilité")} · ${value(profile.assetName)}`}
      onClose={onClose}
    >
      <p className="mt-1 text-sm leading-6 text-ink-secondary">
        {copy(
          fr,
          "Give each person one clear responsibility. A driver can start and return only this asset; a gate verifier confirms departures; a controller resolves alerts.",
          "Donnez à chacun une responsabilité claire. Le conducteur ne peut démarrer et retourner que cet actif ; le vérificateur confirme le départ ; le contrôleur traite les alertes.",
        )}
      </p>
      <form
        className="mt-5 grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          onSave({
            memberId: value(form.get("memberId")),
            responsibility: value(form.get("responsibility")) as Parameters<
              typeof ownerManagementApi.addFleetAuthorization
            >[2]["responsibility"],
            licenceNumber: value(form.get("licenceNumber")) || null,
            licenceExpiresOn: value(form.get("licenceExpiresOn")) || null,
            notes: value(form.get("notes")) || null,
          });
        }}
      >
        <Field label={copy(fr, "Employee", "Employé")} required>
          <select
            className="h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink"
            name="memberId"
            required
          >
            <option value="">
              {copy(fr, "Choose employee", "Choisir l’employé")}
            </option>
            {employees
              .filter((employee) => employee.member?.memberId)
              .map((employee) => (
                <option
                  key={employee.id}
                  value={employee.member?.memberId ?? ""}
                >
                  {employee.fullName} · {employee.employeeNumber}
                </option>
              ))}
          </select>
        </Field>
        <Field label={copy(fr, "Responsibility", "Responsabilité")} required>
          <select
            className="h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink"
            name="responsibility"
            defaultValue="driver"
          >
            <option value="driver">{copy(fr, "Driver", "Conducteur")}</option>
            <option value="operator">
              {copy(fr, "Engine operator", "Opérateur d’engin")}
            </option>
            <option value="fleet_controller">
              {copy(fr, "Fleet controller", "Contrôleur flotte")}
            </option>
            <option value="gate_verifier">
              {copy(fr, "Gate verifier", "Vérificateur portail")}
            </option>
            <option value="maintenance_controller">
              {copy(fr, "Maintenance controller", "Responsable maintenance")}
            </option>
          </select>
        </Field>
        <Field label={copy(fr, "Licence number", "Numéro de permis")}>
          <Input name="licenceNumber" />
        </Field>
        <Field label={copy(fr, "Licence expiry", "Expiration du permis")}>
          <Input name="licenceExpiresOn" type="date" />
        </Field>
        <Field
          className="sm:col-span-2"
          label={copy(fr, "Assignment note", "Note d’affectation")}
        >
          <Textarea name="notes" />
        </Field>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {copy(fr, "Cancel", "Annuler")}
          </Button>
          <Button type="submit" loading={pending}>
            <ShieldCheck />
            {copy(fr, "Assign", "Affecter")}
          </Button>
        </div>
      </form>
      <p className="mt-3 rounded-lg bg-warning/10 p-3 text-xs leading-5 text-ink-secondary">
        {copy(
          fr,
          "For a licence-controlled asset, first upload the driver's permit in the employee dossier. LiteHubs checks the verified, current permit automatically before every departure.",
          "Pour un actif soumis au permis, importez d’abord le permis dans le dossier employé. LiteHubs vérifie automatiquement que le permis est validé et encore valable avant chaque départ.",
        )}
      </p>
      <FormError error={error} />
    </Dialog>
  );
}

function _StartDialog({
  profile,
  fr,
  pending,
  error,
  onClose,
  onSave,
}: {
  profile: Row;
  fr: boolean;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (body: ManagementBody) => void;
}) {
  const items = (profile.preTripChecklist as ChecklistItem[] | undefined) ?? [];
  const gateVerifiers = (
    (profile.authorizations as Row[] | undefined) ?? []
  ).filter(
    (authorization) => value(authorization.responsibility) === "gate_verifier",
  );
  return (
    <Dialog
      title={`${copy(fr, "Start daily sheet", "Démarrer la fiche quotidienne")} · ${value(profile.assetName)}`}
      onClose={onClose}
    >
      <p className="mt-1 text-sm text-ink-secondary">
        {copy(
          fr,
          "The unique code is assigned when this signed pre-trip check is saved.",
          "Le code unique est attribué lorsque ce contrôle avant départ signé est enregistré.",
        )}
      </p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          onSave({
            profileId: profile.id,
            purpose: value(form.get("purpose")),
            destination: value(form.get("destination")) || null,
            gateVerifierMemberId:
              value(form.get("gateVerifierMemberId")) || null,
            startMeter: number(form.get("startMeter")),
            openingFuelLitres: number(form.get("openingFuelLitres")),
            preTripResponses: responsesFrom(form, "preTrip", items),
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={copy(fr, "Purpose", "But du déplacement / travail")}
            required
          >
            <Input name="purpose" required />
          </Field>
          <Field
            label={copy(
              fr,
              "Destination or work area",
              "Destination ou zone de travail",
            )}
          >
            <Input name="destination" />
          </Field>
          {profile.requiresGateCheck ? (
            <Field
              label={copy(fr, "Gate verifier", "Vérificateur portail")}
              required
            >
              <select
                name="gateVerifierMemberId"
                required
                className="h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink"
              >
                <option value="">
                  {copy(fr, "Choose gate verifier", "Choisir le vérificateur")}
                </option>
                {gateVerifiers.map((verifier) => (
                  <option
                    key={value(verifier.memberId)}
                    value={value(verifier.memberId)}
                  >
                    {value(verifier.memberName)}
                  </option>
                ))}
              </select>
              {!gateVerifiers.length ? (
                <p className="mt-1 text-xs text-warning-ink">
                  {copy(
                    fr,
                    "No gate verifier is assigned yet.",
                    "Aucun vérificateur portail n’est encore affecté.",
                  )}
                </p>
              ) : null}
            </Field>
          ) : null}
          <Field
            label={copy(fr, "Departure meter", "Compteur de départ")}
            required={Boolean(profile.dailyMeterRequired)}
          >
            <Input
              name="startMeter"
              type="number"
              min="0"
              step="0.01"
              required={Boolean(profile.dailyMeterRequired)}
            />
          </Field>
          <Field
            label={copy(
              fr,
              "Opening fuel (litres)",
              "Carburant au départ (litres)",
            )}
          >
            <Input name="openingFuelLitres" type="number" min="0" step="0.01" />
          </Field>
        </div>
        <Checklist stage="preTrip" items={items} fr={fr} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {copy(fr, "Cancel", "Annuler")}
          </Button>
          <Button
            type="submit"
            loading={pending}
            disabled={
              Boolean(profile.requiresGateCheck) && !gateVerifiers.length
            }
          >
            <ClipboardCheck />
            {copy(fr, "Sign and start", "Signer et démarrer")}
          </Button>
        </div>
      </form>
      <FormError error={error} />
    </Dialog>
  );
}

function ManagedStartDialog({
  profile,
  fr,
  pending,
  error,
  canFillForAnotherOperator,
  onClose,
  onSave,
}: {
  profile: Row;
  fr: boolean;
  pending: boolean;
  error: unknown;
  canFillForAnotherOperator: boolean;
  onClose: () => void;
  onSave: (body: ManagementBody) => void;
}) {
  const items = (profile.preTripChecklist as ChecklistItem[] | undefined) ?? [];
  const drivers = ((profile.authorizations as Row[] | undefined) ?? []).filter(
    (authorization) =>
      ["driver", "operator"].includes(value(authorization.responsibility)),
  );
  const gateVerifiers = (
    (profile.authorizations as Row[] | undefined) ?? []
  ).filter(
    (authorization) => value(authorization.responsibility) === "gate_verifier",
  );
  const unavailable = canFillForAnotherOperator && drivers.length === 0;

  return (
    <Dialog
      title={`${copy(fr, "Start daily sheet", "Démarrer la fiche quotidienne")} · ${value(profile.assetName)}`}
      onClose={onClose}
    >
      <p className="mt-1 text-sm text-ink-secondary">
        {canFillForAnotherOperator
          ? copy(
              fr,
              "Choose the real driver below. Your name stays on the record as the person who signed this pre-trip check.",
              "Choisissez ci-dessous le conducteur réel. Votre nom reste enregistré comme personne ayant signé ce contrôle avant départ.",
            )
          : copy(
              fr,
              "The unique code is assigned when this signed pre-trip check is saved.",
              "Le code unique est attribué lorsque ce contrôle avant départ signé est enregistré.",
            )}
      </p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          onSave({
            profileId: profile.id,
            operatorMemberId: value(form.get("operatorMemberId")) || null,
            runDate: value(form.get("runDate")),
            purpose: value(form.get("purpose")),
            destination: value(form.get("destination")) || null,
            gateVerifierMemberId:
              value(form.get("gateVerifierMemberId")) || null,
            startMeter: number(form.get("startMeter")),
            openingFuelLitres: number(form.get("openingFuelLitres")),
            preTripResponses: responsesFrom(form, "preTrip", items),
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={copy(fr, "Sheet date", "Date de la fiche")} required>
            <Input
              name="runDate"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
            />
          </Field>
          {canFillForAnotherOperator ? (
            <Field
              label={copy(
                fr,
                "Real driver / operator",
                "Conducteur / opérateur réel",
              )}
              required
            >
              <select
                name="operatorMemberId"
                required
                className="h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink"
              >
                <option value="">
                  {copy(
                    fr,
                    "Choose assigned driver",
                    "Choisir le conducteur affecté",
                  )}
                </option>
                {drivers.map((driver) => (
                  <option
                    key={value(driver.memberId)}
                    value={value(driver.memberId)}
                  >
                    {value(driver.memberName)} ·{" "}
                    {value(driver.responsibility) === "operator"
                      ? copy(fr, "Operator", "Opérateur")
                      : copy(fr, "Driver", "Conducteur")}
                  </option>
                ))}
              </select>
              {unavailable ? (
                <p className="mt-1 text-xs text-warning-ink">
                  {copy(
                    fr,
                    "Assign a driver or operator before creating this sheet.",
                    "Affectez d’abord un conducteur ou opérateur avant de créer cette fiche.",
                  )}
                </p>
              ) : null}
            </Field>
          ) : null}
          <Field
            label={copy(fr, "Purpose", "But du déplacement / travail")}
            required
          >
            <Input name="purpose" required />
          </Field>
          <Field
            label={copy(
              fr,
              "Destination or work area",
              "Destination ou zone de travail",
            )}
          >
            <Input name="destination" />
          </Field>
          {profile.requiresGateCheck ? (
            <Field
              label={copy(fr, "Gate verifier", "Vérificateur portail")}
              required
            >
              <select
                name="gateVerifierMemberId"
                required
                className="h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink"
              >
                <option value="">
                  {copy(fr, "Choose gate verifier", "Choisir le vérificateur")}
                </option>
                {gateVerifiers.map((verifier) => (
                  <option
                    key={value(verifier.memberId)}
                    value={value(verifier.memberId)}
                  >
                    {value(verifier.memberName)}
                  </option>
                ))}
              </select>
              {!gateVerifiers.length ? (
                <p className="mt-1 text-xs text-warning-ink">
                  {copy(
                    fr,
                    "No gate verifier is assigned yet.",
                    "Aucun vérificateur portail n’est encore affecté.",
                  )}
                </p>
              ) : null}
            </Field>
          ) : null}
          <Field
            label={copy(fr, "Departure meter", "Compteur de départ")}
            required={Boolean(profile.dailyMeterRequired)}
          >
            <Input
              name="startMeter"
              type="number"
              min="0"
              step="0.01"
              required={Boolean(profile.dailyMeterRequired)}
            />
          </Field>
          <Field
            label={copy(
              fr,
              "Opening fuel (litres)",
              "Carburant au départ (litres)",
            )}
          >
            <Input name="openingFuelLitres" type="number" min="0" step="0.01" />
          </Field>
        </div>
        <Checklist stage="preTrip" items={items} fr={fr} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {copy(fr, "Cancel", "Annuler")}
          </Button>
          <Button
            type="submit"
            loading={pending}
            disabled={
              unavailable ||
              (Boolean(profile.requiresGateCheck) && !gateVerifiers.length)
            }
          >
            <ClipboardCheck />
            {copy(fr, "Sign and start", "Signer et démarrer")}
          </Button>
        </div>
      </form>
      <FormError error={error} />
    </Dialog>
  );
}

function ReturnDialog({
  run,
  profile,
  fr,
  pending,
  error,
  onClose,
  onSave,
}: {
  run: Row;
  profile: Row | null;
  fr: boolean;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (body: ManagementBody) => void;
}) {
  const items =
    (profile?.postTripChecklist as ChecklistItem[] | undefined) ?? [];
  return (
    <Dialog
      title={`${copy(fr, "Close return sheet", "Clôturer la fiche de retour")} · ${value(run.runCode)}`}
      onClose={onClose}
    >
      <p className="mt-1 text-sm text-ink-secondary">
        {copy(
          fr,
          "The return meter and the end fuel level protect the company and the operator. A fuel variance becomes a review alert, not an accusation.",
          "Le compteur de retour et le niveau final de carburant protègent l’entreprise et l’opérateur. Un écart de carburant devient une alerte à examiner, pas une accusation.",
        )}
      </p>
      <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs leading-5 text-ink-secondary">
        {copy(fr, "Real driver", "Conducteur réel")} :{" "}
        <b className="text-ink">{value(run.operatorName) || "—"}</b> ·{" "}
        {copy(
          fr,
          "Your name will be stored as the person who signed this return.",
          "Votre nom sera enregistré comme personne ayant signé ce retour.",
        )}
      </p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          onSave({
            endMeter: number(form.get("endMeter")),
            closingFuelLitres: number(form.get("closingFuelLitres")),
            fuelAddedLitres: number(form.get("fuelAddedLitres")),
            fuelAmount: number(form.get("fuelAmount")),
            fuelCurrencyCode: value(form.get("fuelCurrencyCode")) || null,
            returnNotes: value(form.get("returnNotes")) || null,
            postTripResponses: responsesFrom(form, "postTrip", items),
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={copy(fr, "Return meter", "Compteur de retour")}
            required={Boolean(profile?.dailyMeterRequired)}
          >
            <Input
              name="endMeter"
              type="number"
              min="0"
              step="0.01"
              required={Boolean(profile?.dailyMeterRequired)}
            />
          </Field>
          <Field
            label={copy(
              fr,
              "Fuel remaining (litres)",
              "Carburant restant (litres)",
            )}
          >
            <Input name="closingFuelLitres" type="number" min="0" step="0.01" />
          </Field>
          <Field
            label={copy(
              fr,
              "Fuel added today (litres)",
              "Carburant ajouté aujourd’hui (litres)",
            )}
          >
            <Input name="fuelAddedLitres" type="number" min="0" step="0.01" />
          </Field>
          <Field label={copy(fr, "Fuel amount", "Montant carburant")}>
            <Input name="fuelAmount" type="number" min="0" step="0.01" />
          </Field>
          <Field label={copy(fr, "Currency", "Devise")}>
            <select
              name="fuelCurrencyCode"
              className="h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink"
            >
              <option value="">—</option>
              <option>CDF</option>
              <option>USD</option>
              <option>EUR</option>
            </select>
          </Field>
          <Field label={copy(fr, "Return note", "Note de retour")}>
            <Input name="returnNotes" />
          </Field>
        </div>
        <Checklist stage="postTrip" items={items} fr={fr} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {copy(fr, "Cancel", "Annuler")}
          </Button>
          <Button type="submit" loading={pending}>
            <CheckCircle2 />
            {copy(fr, "Sign and return", "Signer et clôturer")}
          </Button>
        </div>
      </form>
      <FormError error={error} />
    </Dialog>
  );
}
