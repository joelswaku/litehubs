"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardPlus, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge, severityVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError } from "@/lib/api";
import {
  POULTRY_RESOURCES,
  poultryApi,
  type PoultryResource,
} from "@/lib/poultry-api";
import { can } from "@/lib/permissions";
import { formatBusinessDay } from "@/lib/utils";
import { useSessionUser } from "@/stores/session-store";
import { useLanguage } from "@/providers/language-provider";

type Flock = {
  id: string;
  name: string;
  code: string;
  productionType?: string | null;
  birdType?: string | null;
};
type House = { id: string; name: string; code: string };
type RecordItem = {
  id: string;
  flock?: { name?: string | null } | null;
  house?: { name?: string | null } | null;
  [key: string]: unknown;
};
type OperationResource = Exclude<PoultryResource, "houses" | "flocks">;
type Editor = { resource: OperationResource; record?: RecordItem } | null;

const OPERATIONS = POULTRY_RESOURCES.filter(
  (item) => item !== "houses" && item !== "flocks",
) as OperationResource[];
const resourceLabel: Record<OperationResource, string> = {
  "daily-records": "Daily counts & climate",
  mortality: "Mortality",
  feed: "Feed issued",
  water: "Water use",
  weights: "Weight samples",
  eggs: "Egg collection",
  health: "Health events",
  vaccinations: "Vaccinations",
  treatments: "Treatments",
  sanitation: "Sanitation",
  biosecurity: "Biosecurity checks",
  "production-targets": "Flock targets",
  losses: "Operational losses",
};
const resourceName = (resource: OperationResource, fr: boolean) =>
  fr
    ? (
        {
          "daily-records": "Comptages quotidiens et climat",
          mortality: "Mortalité",
          feed: "Aliment distribué",
          water: "Consommation d eau",
          weights: "Échantillons de poids",
          eggs: "Collecte des œufs",
          health: "Événements de santé",
          vaccinations: "Vaccinations",
          treatments: "Traitements",
          sanitation: "Assainissement",
          biosecurity: "Contrôles de biosécurité",
          "production-targets": "Objectifs du lot",
          losses: "Pertes opérationnelles",
        } satisfies Record<OperationResource, string>
      )[resource]
    : resourceLabel[resource];
const fieldText = (value: string, fr: boolean) => {
  if (!fr) return value;
  const labels: Record<string, string> = {
    Flock: "Lot",
    House: "Bâtiment",
    "Select flock": "Sélectionner un lot",
    "Select house": "Sélectionner un bâtiment",
    "Physical live bird count": "Comptage physique des oiseaux vivants",
    Arrivals: "Arrivées",
    "Transfers out": "Transferts sortants",
    Culls: "Réformes",
    "Temperature (°C)": "Température (°C)",
    "Humidity (%)": "Humidité (%)",
    "Bird deaths": "Décès d oiseaux",
    "Cause category": "Catégorie de cause",
    "Suspected cause": "Cause présumée",
    "Post-mortem": "Autopsie",
    "Disposal method": "Méthode d élimination",
    Veterinarian: "Vétérinaire",
    "Feed name": "Nom de l aliment",
    "Feed stage": "Phase de l aliment",
    "Quantity (kg)": "Quantité (kg)",
    "Bag count": "Nombre de sacs",
    "Batch number": "Numéro de lot",
    "Inventory item ID": "Identifiant de l article en stock",
    "Optional — keeps inventory linkage ready.":
      "Optionnel — prépare le lien avec le stock.",
    "Volume (L)": "Volume (L)",
    "Water source": "Source d eau",
    "Sample size": "Taille de l échantillon",
    "Average weight (g)": "Poids moyen (g)",
    "Minimum weight (g)": "Poids minimum (g)",
    "Maximum weight (g)": "Poids maximum (g)",
    "Uniformity (%)": "Uniformité (%)",
    "Total eggs": "Total des œufs",
    "Cracked eggs": "Œufs cassés",
    "Dirty eggs": "Œufs sales",
    "Hatching eggs": "Œufs à couver",
    "Other rejected eggs": "Autres œufs rejetés",
    "Event type": "Type d événement",
    Severity: "Gravité",
    "Birds affected": "Oiseaux affectés",
    Diagnosis: "Diagnostic",
    Status: "Statut",
    "Vaccine name": "Nom du vaccin",
    Manufacturer: "Fabricant",
    Dose: "Dose",
    "Administration route": "Voie d administration",
    "Next due date": "Prochaine échéance",
    "Administered by": "Administré par",
    "Product name": "Nom du produit",
    Reason: "Motif",
    Dosage: "Posologie",
    "End date": "Date de fin",
    "Withdrawal end date": "Fin du délai d attente",
    "Prescribed by": "Prescrit par",
    Activity: "Activité",
    "Product used": "Produit utilisé",
    Result: "Résultat",
    "Performed by": "Réalisé par",
    "Check type": "Type de contrôle",
    Compliance: "Conformité",
    "Risk level": "Niveau de risque",
    "Action taken": "Action prise",
    Metric: "Indicateur",
    "Target value": "Valeur cible",
    "Effective from": "Valable à partir du",
    "Effective to": "Valable jusqu au",
    "Loss type": "Type de perte",
    Quantity: "Quantité",
    Unit: "Unité",
    Description: "Description",
    Symptoms: "Symptômes",
    "Clinical signs": "Signes cliniques",
    Notes: "Notes",
    "Record date": "Date de saisie",
  };
  return labels[value] ?? value;
};
const choiceText = (value: string, fr: boolean) => {
  if (!fr) return readable(value);
  const labels: Record<string, string> = {
    starter: "Démarrage",
    grower: "Croissance",
    finisher: "Finition",
    layer: "Pondeuse",
    breeder: "Reproducteur",
    medicated: "Médicamenté",
    other: "Autre",
    unknown: "Inconnue",
    disease: "Maladie",
    heat_stress: "Stress thermique",
    cold_stress: "Stress dû au froid",
    injury: "Blessure",
    predation: "Prédation",
    deformity: "Malformation",
    management: "Gestion",
    not_done: "Non effectuée",
    pending: "En attente",
    done: "Effectuée",
    burial: "Enterrement",
    incineration: "Incinération",
    composting: "Compostage",
    rendering: "Équarrissage",
    observation: "Observation",
    suspected_disease: "Maladie suspectée",
    confirmed_disease: "Maladie confirmée",
    outbreak: "Épidémie",
    low: "Faible",
    medium: "Moyen",
    high: "Élevé",
    critical: "Critique",
    open: "Ouvert",
    monitoring: "Surveillance",
    resolved: "Résolu",
    completed: "Terminé",
    partial: "Partiel",
    failed: "Échec",
    access_control: "Contrôle d accès",
    visitor: "Visiteur",
    vehicle: "Véhicule",
    footbath: "Pédiluve",
    ppe: "Équipement de protection",
    pest_control: "Contrôle des nuisibles",
    quarantine: "Quarantaine",
    compliant: "Conforme",
    non_compliant: "Non conforme",
    not_checked: "Non contrôlé",
    mortality_percent: "Pourcentage de mortalité",
    feed_kg_per_bird: "Aliment kg par oiseau",
    water_liters_per_bird: "Eau litres par oiseau",
    average_weight_g: "Poids moyen g",
    egg_count: "Nombre d œufs",
    egg_lay_percent: "Taux de ponte",
    bird_missing: "Oiseau manquant",
    egg_breakage: "Casse d œufs",
    feed_spoilage: "Aliment avarié",
    equipment_damage: "Dommage matériel",
  };
  return labels[value] ?? readable(value);
};
const healthResources = new Set<OperationResource>([
  "health",
  "vaccinations",
  "treatments",
  "sanitation",
  "biosecurity",
  "losses",
]);
const houseResources = new Set<OperationResource>([
  "sanitation",
  "biosecurity",
]);
const readable = (value: unknown) =>
  String(value ?? "—")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const textValue = (form: FormData, name: string) =>
  String(form.get(name) ?? "").trim();
const optional = (form: FormData, name: string) =>
  textValue(form, name) || null;
const numberValue = (form: FormData, name: string, fallback = 0) => {
  const value = Number(textValue(form, name));
  return Number.isFinite(value) ? value : fallback;
};
const optionalNumber = (form: FormData, name: string) => {
  const value = textValue(form, name);
  return value === "" ? null : numberValue(form, name);
};
const dateFor = (value: unknown) => (value ? String(value).slice(0, 10) : "");
const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : "This change could not be saved.";
const dateOf = (item: RecordItem) =>
  item.recordDate ??
  item.mortalityDate ??
  item.feedDate ??
  item.waterDate ??
  item.vaccinationDate ??
  item.treatmentDate ??
  item.sanitationDate ??
  item.lossDate ??
  item.effectiveFrom;

/**
 * A complete, permission-aware record desk. It deliberately leaves houses and
 * flocks to the Setup page, where their lifecycle safeguards live.
 */
export function PoultryRecordCentre({
  orgSlug,
  flocks,
  houses,
  initialResource = "health",
}: {
  orgSlug: string;
  flocks: Flock[];
  houses: House[];
  initialResource?: OperationResource;
}) {
  const user = useSessionUser();
  const fr = useLanguage().locale === "fr";
  const client = useQueryClient();
  const [resource, setResource] = useState<OperationResource>(initialResource);
  const [editor, setEditor] = useState<Editor>(null);
  const list = useQuery({
    queryKey: ["poultry-record-centre", orgSlug, resource],
    queryFn: () =>
      poultryApi.list<{ records: RecordItem[] }>(orgSlug, resource),
    enabled: can(user, `poultry.${resource.replace(/-/g, "_")}.read`),
    select: (data) => data.records,
  });
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["poultry"] });
    client.invalidateQueries({ queryKey: ["poultry-record-centre", orgSlug] });
    client.invalidateQueries({ queryKey: ["poultry-overview", orgSlug] });
    client.invalidateQueries({ queryKey: ["poultry-performance", orgSlug] });
  };
  const detail = useMutation({
    mutationFn: (recordId: string) =>
      poultryApi.get<{ record: RecordItem }>(orgSlug, resource, recordId),
    onSuccess: (data) => setEditor({ resource, record: data.record }),
  });
  const save = useMutation({
    mutationFn: ({
      record,
      body,
    }: {
      record?: RecordItem;
      body: Record<string, unknown>;
    }) =>
      record
        ? poultryApi.update(orgSlug, resource, record.id, body)
        : poultryApi.create(orgSlug, resource, body),
    onSuccess: () => {
      setEditor(null);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (recordId: string) =>
      poultryApi.remove(orgSlug, resource, recordId),
    onSuccess: refresh,
  });
  const permissionPrefix = `poultry.${resource.replace(/-/g, "_")}`;
  const canCreate = can(user, `${permissionPrefix}.create`);
  const canEdit = can(user, `${permissionPrefix}.update`);
  const canDelete = can(user, `${permissionPrefix}.delete`);
  const mutationError = [detail.error, save.error, remove.error].find(Boolean);

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200/90 bg-surface-1 ring-1 ring-white/70 shadow-[0_24px_56px_-34px_rgba(15,23,42,.52)] dark:border-white/10 dark:ring-white/[0.035] dark:shadow-[0_24px_56px_-34px_rgba(0,0,0,.92)]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/90 bg-[radial-gradient(circle_at_92%_0%,color-mix(in_srgb,var(--brand)_22%,transparent),transparent_34%),linear-gradient(115deg,var(--brand-subtle),transparent_64%)] px-5 py-5 dark:border-white/10 sm:px-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">
            {fr ? "Saisie opérationnelle" : "Operational record desk"}
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-ink">
            {fr
              ? "Enregistrez, corrigez et vérifiez les données terrain"
              : "Record, correct and verify field data"}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-secondary">
            {fr
              ? "Chaque saisie est rattachée à votre société et à votre périmètre de travail. Les bâtiments et le cycle des lots restent dans Configuration."
              : "Every operational Poultry record uses the live API, company scope and role permissions. Houses and flock lifecycle stay in Setup."}
          </p>
        </div>
        {canCreate ? (
          <Button size="sm" onClick={() => setEditor({ resource })}>
            <Plus />
            {fr ? "Nouvel enregistrement" : "New record"}
          </Button>
        ) : null}
      </div>
      <div className="grid gap-2 border-b border-slate-200/80 bg-slate-50/80 px-5 py-4 dark:border-white/10 dark:bg-white/[0.025] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 sm:px-6">
        {OPERATIONS.map((item) => (
          <button
            type="button"
            key={item}
            onClick={() => {
              setResource(item);
              setEditor(null);
            }}
            className={`group flex min-h-12 items-center rounded-xl border px-3 text-left text-xs font-semibold shadow-[0_1px_1px_rgba(15,23,42,.03)] transition duration-200 ${resource === item ? "border-brand/70 bg-brand text-white shadow-[0_10px_20px_-12px_color-mix(in_srgb,var(--brand)_85%,transparent)]" : "border-slate-200/90 bg-white/90 text-ink-secondary hover:-translate-y-px hover:border-brand/35 hover:bg-brand-subtle/55 hover:text-ink dark:border-white/10 dark:bg-white/[.035]"}`}
          >
            <span className={`mr-2 size-1.5 shrink-0 rounded-full ${resource === item ? "bg-white" : "bg-brand/60 group-hover:bg-brand"}`} />
            <span className="min-w-0 leading-4">{resourceName(item, fr)}</span>
          </button>
        ))}
      </div>
      {mutationError ? (
        <p
          className="mt-4 rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical"
          role="alert"
        >
          {errorMessage(mutationError)}
        </p>
      ) : null}
      <div className="p-5 sm:p-6">
        {list.isPending ? (
          <Skeleton className="h-52" />
        ) : list.isError ? (
          <ErrorState
            title="Could not load Poultry records"
            description={errorMessage(list.error)}
            onRetry={() => list.refetch()}
          />
        ) : list.data?.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {list.data.slice(0, 25).map((item) => (
              <RecordRow
                key={item.id}
                item={item}
                resource={resource}
                fr={fr}
                edit={canEdit ? () => detail.mutate(item.id) : undefined}
                erase={
                  canDelete
                    ? () => {
                        if (
                          window.confirm(
                            "Delete this record? This cannot be undone.",
                          )
                        )
                          remove.mutate(item.id);
                      }
                    : undefined
                }
                busy={detail.isPending || remove.isPending}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title={
              fr
                ? `Aucun enregistrement : ${resourceName(resource, true).toLowerCase()}.`
                : `No ${resourceLabel[resource].toLowerCase()} recorded.`
            }
            description={
              canCreate
                ? fr
                  ? "Ajoutez le premier enregistrement lorsque le travail est terminé."
                  : "Add the first operational record when the work is done."
                : fr
                  ? "Vous n avez pas la permission d ajouter ce type d enregistrement."
                  : "You do not have permission to add records of this type."
            }
            icon={ClipboardPlus}
            action={
              canCreate
                ? {
                    label: fr ? "Nouvel enregistrement" : "New record",
                    onClick: () => setEditor({ resource }),
                  }
                : undefined
            }
          />
        )}
      </div>
      {editor ? (
        <RecordModal
          fr={fr}
          resource={editor.resource}
          item={editor.record}
          flocks={flocks}
          houses={houses}
          busy={save.isPending}
          onClose={() => setEditor(null)}
          onSubmit={(body) => save.mutate({ record: editor.record, body })}
        />
      ) : null}
    </section>
  );
}

function RecordRow({
  item,
  resource,
  fr,
  edit,
  erase,
  busy,
}: {
  item: RecordItem;
  resource: OperationResource;
  fr: boolean;
  edit?: () => void;
  erase?: () => void;
  busy: boolean;
}) {
  const title =
    resource === "health"
      ? choiceText(String(item.eventType ?? ""), fr)
      : resource === "vaccinations"
        ? String(item.vaccineName ?? "Vaccination")
        : resource === "treatments"
          ? String(item.productName ?? (fr ? "Traitement" : "Treatment"))
          : resource === "feed"
            ? String(
                item.feedName ?? (fr ? "Distribution d aliment" : "Feed issue"),
              )
            : resource === "sanitation"
              ? choiceText(String(item.activityType ?? ""), fr)
              : resource === "biosecurity"
                ? choiceText(String(item.checkType ?? ""), fr)
                : resource === "losses"
                  ? choiceText(String(item.lossType ?? ""), fr)
                  : resource === "production-targets"
                    ? choiceText(String(item.metric ?? ""), fr)
                    : resource === "mortality"
                      ? `${item.deathCount ?? 0} ${fr ? "décès d oiseaux" : "bird deaths"}`
                      : resource === "eggs"
                        ? `${item.totalEggs ?? 0} ${fr ? "œufs" : "eggs"}`
                        : resource === "water"
                          ? `${item.volumeLiters ?? 0} L ${fr ? "eau" : "water"}`
                          : resource === "weights"
                            ? `${item.averageWeightG ?? 0} g ${fr ? "poids moyen" : "average weight"}`
                            : fr
                              ? "Comptage quotidien"
                              : "Daily count";
  const status = String(
    item.severity ?? item.riskLevel ?? item.status ?? "recorded",
  );
  return (
    <article className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-surface-1 p-4 ring-1 ring-white/60 shadow-[0_16px_34px_-26px_rgba(15,23,42,.5)] transition duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-[0_20px_38px_-24px_rgba(15,23,42,.26)] dark:border-white/10 dark:ring-white/[.03] dark:shadow-[0_16px_34px_-26px_rgba(0,0,0,.9)] dark:hover:border-brand/45">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-brand/20 bg-brand-subtle text-brand shadow-inner">
          <ClipboardPlus className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold tracking-tight text-ink">{title}</p>
            {["health", "biosecurity"].includes(resource) ? (
              <Badge variant={severityVariant(status)}>
                {choiceText(status, fr)}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1.5 truncate text-xs text-ink-secondary">
            {item.flock?.name ?? item.house?.name ?? "—"}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/85 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/[.035]">
        <span className="font-medium text-ink-secondary">{fr ? "Date de saisie" : "Record date"}</span>
        <span className="truncate font-semibold text-ink">{formatBusinessDay(dateOf(item) as string | null)}</span>
      </div>
      {edit || erase ? (
        <footer className="mt-4 flex flex-wrap justify-end gap-1 border-t border-slate-200/80 pt-3 dark:border-white/10">
          {edit ? (
            <Button size="sm" variant="ghost" onClick={edit} loading={busy}>
              <Pencil />
              {fr ? "Modifier" : "Edit"}
            </Button>
          ) : null}
          {erase ? (
            <Button size="sm" variant="ghost" onClick={erase} disabled={busy}>
              <Trash2 className="text-critical" />
              {fr ? "Supprimer" : "Delete"}
            </Button>
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}
function RecordModal({
  resource,
  item,
  flocks,
  houses,
  busy,
  fr,
  onClose,
  onSubmit,
}: {
  resource: OperationResource;
  item?: RecordItem;
  flocks: Flock[];
  houses: House[];
  busy: boolean;
  fr: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(buildBody(resource, new FormData(event.currentTarget)));
  }
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-surface-1 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
              {item
                ? "Correction"
                : fr
                  ? "Nouvel enregistrement terrain"
                  : "New field record"}
            </p>
            <h3 className="mt-1 text-xl font-semibold text-ink">
              {item ? (fr ? "Modifier" : "Edit") : fr ? "Ajouter" : "Add"}{" "}
              {resourceName(resource, fr)}
            </h3>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X />
            {fr ? "Fermer" : "Close"}
          </Button>
        </div>
        <form className="mt-5" onSubmit={submit}>
          <RecordFields
            resource={resource}
            item={item}
            flocks={flocks}
            houses={houses}
          />
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {fr ? "Annuler" : "Cancel"}
            </Button>
            <Button type="submit" loading={busy}>
              {fr ? "Enregistrer la saisie" : "Save record"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
function RecordFields({
  resource,
  item,
  flocks,
  houses,
}: {
  resource: OperationResource;
  item?: RecordItem;
  flocks: Flock[];
  houses: House[];
}) {
  const fr = useLanguage().locale === "fr";
  const label = (value: string) => fieldText(value, fr);
  const flockRequired = !houseResources.has(resource);
  const selectableFlocks =
    resource === "eggs"
      ? flocks.filter((flock) =>
          ["layer", "breeder"].includes(
            String(flock.productionType ?? flock.birdType ?? ""),
          ),
        )
      : flocks;
  const subject = flockRequired ? (
    <Field label={label("Flock")} htmlFor="record-flock" required>
      <Select name="flockId" value={String(item?.flockId ?? "")} required>
        <option value="">{label("Select flock")}</option>
        {selectableFlocks.map((flock) => (
          <option key={flock.id} value={flock.id}>
            {flock.name} · {flock.code}
          </option>
        ))}
      </Select>
    </Field>
  ) : (
    <Field label={label("House")} htmlFor="record-house" required>
      <Select name="houseId" value={String(item?.houseId ?? "")} required>
        <option value="">{label("Select house")}</option>
        {houses.map((house) => (
          <option key={house.id} value={house.id}>
            {house.name} · {house.code}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {subject}
        <DateField resource={resource} item={item} />
        {resource === "daily-records" ? (
          <>
            <NumberField
              name="liveBirdCount"
              label="Physical live bird count"
              value={item?.liveBirdCount}
              required
              integer
            />
            <NumberField
              name="arrivalsCount"
              label="Arrivals"
              value={item?.arrivalsCount ?? 0}
              integer
            />
            <NumberField
              name="transfersOutCount"
              label="Transfers out"
              value={item?.transfersOutCount ?? 0}
              integer
            />
            <NumberField
              name="cullsCount"
              label="Culls"
              value={item?.cullsCount ?? 0}
              integer
            />
            <NumberField
              name="temperatureC"
              label="Temperature (°C)"
              value={item?.temperatureC}
            />
            <NumberField
              name="humidityPercent"
              label="Humidity (%)"
              value={item?.humidityPercent}
            />
          </>
        ) : null}
        {resource === "mortality" ? (
          <>
            <NumberField
              name="deathCount"
              label="Bird deaths"
              value={item?.deathCount}
              required
              integer
            />
            <Choice
              name="causeCategory"
              label="Cause category"
              value={item?.causeCategory}
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
            <Text
              name="suspectedCause"
              label="Suspected cause"
              value={item?.suspectedCause}
            />
            <Choice
              name="postmortemStatus"
              label="Post-mortem"
              value={item?.postmortemStatus}
              values={["not_done", "pending", "done"]}
            />
            <Choice
              name="disposalMethod"
              label="Disposal method"
              value={item?.disposalMethod}
              values={[
                "burial",
                "incineration",
                "composting",
                "rendering",
                "other",
              ]}
            />
            <Text
              name="veterinarianName"
              label="Veterinarian"
              value={item?.veterinarianName}
            />
          </>
        ) : null}
        {resource === "feed" ? (
          <>
            <Text
              name="feedName"
              label="Feed name"
              value={item?.feedName}
              required
            />
            <Choice
              name="feedStage"
              label="Feed stage"
              value={item?.feedStage}
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
              label="Quantity (kg)"
              value={item?.quantityKg}
              required
            />
            <NumberField
              name="bagCount"
              label="Bag count"
              value={item?.bagCount}
            />
            <Text
              name="batchNumber"
              label="Batch number"
              value={item?.batchNumber}
            />
            <Text
              name="inventoryItemId"
              label="Inventory item ID"
              value={item?.inventoryItemId}
              hint="Optional — keeps inventory linkage ready."
            />
          </>
        ) : null}
        {resource === "water" ? (
          <>
            <NumberField
              name="volumeLiters"
              label="Volume (L)"
              value={item?.volumeLiters}
              required
            />
            <Text
              name="sourceName"
              label="Water source"
              value={item?.sourceName}
            />
          </>
        ) : null}
        {resource === "weights" ? (
          <>
            <NumberField
              name="sampleSize"
              label="Sample size"
              value={item?.sampleSize}
              required
              integer
            />
            <NumberField
              name="averageWeightG"
              label="Average weight (g)"
              value={item?.averageWeightG}
              required
            />
            <NumberField
              name="minimumWeightG"
              label="Minimum weight (g)"
              value={item?.minimumWeightG}
            />
            <NumberField
              name="maximumWeightG"
              label="Maximum weight (g)"
              value={item?.maximumWeightG}
            />
            <NumberField
              name="uniformityPercent"
              label="Uniformity (%)"
              value={item?.uniformityPercent}
            />
          </>
        ) : null}
        {resource === "eggs" ? (
          <>
            <NumberField
              name="totalEggs"
              label="Total eggs"
              value={item?.totalEggs}
              required
              integer
            />
            <NumberField
              name="crackedEggs"
              label="Cracked eggs"
              value={item?.crackedEggs ?? 0}
              integer
            />
            <NumberField
              name="dirtyEggs"
              label="Dirty eggs"
              value={item?.dirtyEggs ?? 0}
              integer
            />
            <NumberField
              name="hatchingEggs"
              label="Hatching eggs"
              value={item?.hatchingEggs ?? 0}
              integer
            />
            <NumberField
              name="rejectedEggs"
              label="Other rejected eggs"
              value={item?.rejectedEggs ?? 0}
              integer
            />
          </>
        ) : null}
        {resource === "health" ? (
          <>
            <Choice
              name="eventType"
              label="Event type"
              value={item?.eventType}
              values={[
                "observation",
                "suspected_disease",
                "confirmed_disease",
                "outbreak",
                "injury",
                "other",
              ]}
            />
            <Choice
              name="severity"
              label="Severity"
              value={item?.severity}
              values={["low", "medium", "high", "critical"]}
            />
            <NumberField
              name="birdsAffected"
              label="Birds affected"
              value={item?.birdsAffected ?? 0}
              integer
            />
            <Text name="diagnosis" label="Diagnosis" value={item?.diagnosis} />
            <Text
              name="veterinarianName"
              label="Veterinarian"
              value={item?.veterinarianName}
            />
            <Choice
              name="status"
              label="Status"
              value={item?.status}
              values={["open", "monitoring", "resolved"]}
            />
          </>
        ) : null}
        {resource === "vaccinations" ? (
          <>
            <Text
              name="vaccineName"
              label="Vaccine name"
              value={item?.vaccineName}
              required
            />
            <Text
              name="manufacturer"
              label="Manufacturer"
              value={item?.manufacturer}
            />
            <Text
              name="batchNumber"
              label="Batch number"
              value={item?.batchNumber}
            />
            <Text name="dose" label="Dose" value={item?.dose} />
            <Text
              name="administrationRoute"
              label="Administration route"
              value={item?.administrationRoute}
            />
            <Text
              name="nextDueDate"
              label="Next due date"
              type="date"
              value={dateFor(item?.nextDueDate)}
            />
            <Text
              name="administeredBy"
              label="Administered by"
              value={item?.administeredBy}
            />
            <Text
              name="inventoryItemId"
              label="Inventory item ID"
              value={item?.inventoryItemId}
              hint="Optional — keeps inventory linkage ready."
            />
          </>
        ) : null}
        {resource === "treatments" ? (
          <>
            <Text
              name="productName"
              label="Product name"
              value={item?.productName}
              required
            />
            <Text name="reason" label="Reason" value={item?.reason} required />
            <Text name="dosage" label="Dosage" value={item?.dosage} />
            <Text
              name="administrationRoute"
              label="Administration route"
              value={item?.administrationRoute}
            />
            <Text
              name="endDate"
              label="End date"
              type="date"
              value={dateFor(item?.endDate)}
            />
            <Text
              name="withdrawalEndDate"
              label="Withdrawal end date"
              type="date"
              value={dateFor(item?.withdrawalEndDate)}
            />
            <Text
              name="prescribedBy"
              label="Prescribed by"
              value={item?.prescribedBy}
            />
            <Text
              name="inventoryItemId"
              label="Inventory item ID"
              value={item?.inventoryItemId}
              hint="Optional — keeps inventory linkage ready."
            />
          </>
        ) : null}
        {resource === "sanitation" ? (
          <>
            <Choice
              name="activityType"
              label="Activity"
              value={item?.activityType}
              values={[
                "cleaning",
                "disinfection",
                "litter_change",
                "downtime",
                "waste_removal",
                "other",
              ]}
            />
            <Text
              name="productName"
              label="Product used"
              value={item?.productName}
            />
            <Choice
              name="status"
              label="Result"
              value={item?.status}
              values={["completed", "partial", "failed"]}
            />
            <Text
              name="performedBy"
              label="Performed by"
              value={item?.performedBy}
            />
            <Text
              name="inventoryItemId"
              label="Inventory item ID"
              value={item?.inventoryItemId}
              hint="Optional — keeps inventory linkage ready."
            />
          </>
        ) : null}
        {resource === "biosecurity" ? (
          <>
            <Choice
              name="checkType"
              label="Check type"
              value={item?.checkType}
              values={[
                "access_control",
                "visitor",
                "vehicle",
                "footbath",
                "ppe",
                "pest_control",
                "quarantine",
                "other",
              ]}
            />
            <Choice
              name="complianceStatus"
              label="Compliance"
              value={item?.complianceStatus}
              values={["compliant", "non_compliant", "not_checked"]}
            />
            <Choice
              name="riskLevel"
              label="Risk level"
              value={item?.riskLevel}
              values={["low", "medium", "high", "critical"]}
            />
            <Text
              name="actionTaken"
              label="Action taken"
              value={item?.actionTaken}
            />
          </>
        ) : null}
        {resource === "production-targets" ? (
          <>
            <Choice
              name="metric"
              label="Metric"
              value={item?.metric}
              values={[
                "mortality_percent",
                "feed_kg_per_bird",
                "water_liters_per_bird",
                "average_weight_g",
                "egg_count",
                "egg_lay_percent",
              ]}
            />
            <NumberField
              name="targetValue"
              label="Target value"
              value={item?.targetValue}
              required
            />
            <Text
              name="effectiveTo"
              label="Effective to"
              type="date"
              value={dateFor(item?.effectiveTo)}
            />
          </>
        ) : null}
        {resource === "losses" ? (
          <>
            <Choice
              name="lossType"
              label="Loss type"
              value={item?.lossType}
              values={[
                "bird_missing",
                "predation",
                "egg_breakage",
                "feed_spoilage",
                "equipment_damage",
                "other",
              ]}
            />
            <NumberField
              name="quantity"
              label="Quantity"
              value={item?.quantity}
              required
            />
            <Text
              name="unit"
              label="Unit"
              value={item?.unit ?? "count"}
              required
            />
            <Text
              name="description"
              label="Description"
              value={item?.description}
              required
            />
          </>
        ) : null}
      </div>
      {resource === "health" ? (
        <Field
          label={label("Symptoms")}
          htmlFor="record-symptoms"
          className="mt-4"
        >
          <Textarea
            name="symptoms"
            defaultValue={String(item?.symptoms ?? "")}
          />
        </Field>
      ) : null}
      {resource === "health" || resource === "biosecurity" ? (
        <Field
          label={label("Action taken")}
          htmlFor="record-action"
          className="mt-4"
        >
          <Textarea
            name="actionTaken"
            defaultValue={String(item?.actionTaken ?? "")}
          />
        </Field>
      ) : null}
      {resource === "mortality" ? (
        <>
          <Field
            label={label("Clinical signs")}
            htmlFor="record-signs"
            className="mt-4"
          >
            <Textarea
              name="clinicalSigns"
              defaultValue={String(item?.clinicalSigns ?? "")}
            />
          </Field>
          <label className="mt-4 flex items-center gap-2 text-sm text-ink-secondary">
            <input
              name="requiresFollowUp"
              type="checkbox"
              defaultChecked={Boolean(item?.requiresFollowUp)}
            />
            {fr ? "Suivi nécessaire" : "Requires follow-up"}
          </label>
        </>
      ) : null}
      <Field label={label("Notes")} htmlFor="record-notes" className="mt-4">
        <Textarea name="notes" defaultValue={String(item?.notes ?? "")} />
      </Field>
    </div>
  );
}

function DateField({
  resource,
  item,
}: {
  resource: OperationResource;
  item?: RecordItem;
}) {
  const fr = useLanguage().locale === "fr";
  const name =
    resource === "mortality"
      ? "mortalityDate"
      : resource === "feed"
        ? "feedDate"
        : resource === "water"
          ? "waterDate"
          : resource === "vaccinations"
            ? "vaccinationDate"
            : resource === "treatments"
              ? "treatmentDate"
              : resource === "sanitation"
                ? "sanitationDate"
                : resource === "losses"
                  ? "lossDate"
                  : resource === "production-targets"
                    ? "effectiveFrom"
                    : "recordDate";
  return (
    <Field
      label={fieldText(
        resource === "production-targets" ? "Effective from" : "Record date",
        fr,
      )}
      htmlFor={name}
      required
    >
      <Input
        name={name}
        type="date"
        defaultValue={dateFor(item?.[name])}
        required
      />
    </Field>
  );
}
function Text({
  name,
  label,
  value,
  required,
  type = "text",
  hint,
}: {
  name: string;
  label: string;
  value?: unknown;
  required?: boolean;
  type?: string;
  hint?: string;
}) {
  const fr = useLanguage().locale === "fr";
  return (
    <Field
      label={fieldText(label, fr)}
      htmlFor={name}
      required={required}
      hint={hint ? fieldText(hint, fr) : undefined}
    >
      <Input
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
  required,
  integer,
}: {
  name: string;
  label: string;
  value?: unknown;
  required?: boolean;
  integer?: boolean;
}) {
  const fr = useLanguage().locale === "fr";
  return (
    <Field label={fieldText(label, fr)} htmlFor={name} required={required}>
      <Input
        name={name}
        type="number"
        min="0"
        step={integer ? "1" : "0.01"}
        defaultValue={value == null ? "" : String(value)}
        required={required}
      />
    </Field>
  );
}
function Choice({
  name,
  label,
  value,
  values,
}: {
  name: string;
  label: string;
  value?: unknown;
  values: string[];
}) {
  const fr = useLanguage().locale === "fr";
  return (
    <Field label={fieldText(label, fr)} htmlFor={name}>
      <Select name={name} value={String(value ?? values[0])}>
        {values.map((item) => (
          <option value={item} key={item}>
            {choiceText(item, fr)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
function Select({
  name,
  value,
  children,
  required,
}: {
  name: string;
  value?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <select
      name={name}
      defaultValue={value ?? ""}
      required={required}
      className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
    >
      {children}
    </select>
  );
}

function buildBody(
  resource: OperationResource,
  form: FormData,
): Record<string, unknown> {
  const flockId = textValue(form, "flockId");
  const houseId = textValue(form, "houseId");
  const notes = optional(form, "notes");
  if (resource === "daily-records")
    return {
      flockId,
      recordDate: textValue(form, "recordDate"),
      liveBirdCount: numberValue(form, "liveBirdCount"),
      arrivalsCount: numberValue(form, "arrivalsCount"),
      transfersOutCount: numberValue(form, "transfersOutCount"),
      cullsCount: numberValue(form, "cullsCount"),
      temperatureC: optionalNumber(form, "temperatureC"),
      humidityPercent: optionalNumber(form, "humidityPercent"),
      notes,
    };
  if (resource === "mortality")
    return {
      flockId,
      mortalityDate: textValue(form, "mortalityDate"),
      deathCount: numberValue(form, "deathCount"),
      causeCategory: textValue(form, "causeCategory"),
      suspectedCause: optional(form, "suspectedCause"),
      clinicalSigns: optional(form, "clinicalSigns"),
      postmortemStatus: textValue(form, "postmortemStatus"),
      disposalMethod: textValue(form, "disposalMethod"),
      veterinarianName: optional(form, "veterinarianName"),
      requiresFollowUp: form.get("requiresFollowUp") === "on",
      notes,
    };
  if (resource === "feed")
    return {
      flockId,
      feedDate: textValue(form, "feedDate"),
      feedName: textValue(form, "feedName"),
      feedStage: textValue(form, "feedStage"),
      quantityKg: numberValue(form, "quantityKg"),
      bagCount: optionalNumber(form, "bagCount"),
      batchNumber: optional(form, "batchNumber"),
      inventoryItemId: optional(form, "inventoryItemId"),
      notes,
    };
  if (resource === "water")
    return {
      flockId,
      waterDate: textValue(form, "waterDate"),
      volumeLiters: numberValue(form, "volumeLiters"),
      sourceName: optional(form, "sourceName"),
      notes,
    };
  if (resource === "weights")
    return {
      flockId,
      recordDate: textValue(form, "recordDate"),
      sampleSize: numberValue(form, "sampleSize"),
      averageWeightG: numberValue(form, "averageWeightG"),
      minimumWeightG: optionalNumber(form, "minimumWeightG"),
      maximumWeightG: optionalNumber(form, "maximumWeightG"),
      uniformityPercent: optionalNumber(form, "uniformityPercent"),
      notes,
    };
  if (resource === "eggs")
    return {
      flockId,
      recordDate: textValue(form, "recordDate"),
      totalEggs: numberValue(form, "totalEggs"),
      crackedEggs: numberValue(form, "crackedEggs"),
      dirtyEggs: numberValue(form, "dirtyEggs"),
      hatchingEggs: numberValue(form, "hatchingEggs"),
      rejectedEggs: numberValue(form, "rejectedEggs"),
      notes,
    };
  if (resource === "health")
    return {
      flockId,
      recordDate: textValue(form, "recordDate"),
      eventType: textValue(form, "eventType"),
      severity: textValue(form, "severity"),
      birdsAffected: numberValue(form, "birdsAffected"),
      symptoms: optional(form, "symptoms"),
      diagnosis: optional(form, "diagnosis"),
      actionTaken: optional(form, "actionTaken"),
      veterinarianName: optional(form, "veterinarianName"),
      status: textValue(form, "status"),
      notes,
    };
  if (resource === "vaccinations")
    return {
      flockId,
      vaccinationDate: textValue(form, "vaccinationDate"),
      vaccineName: textValue(form, "vaccineName"),
      manufacturer: optional(form, "manufacturer"),
      batchNumber: optional(form, "batchNumber"),
      dose: optional(form, "dose"),
      administrationRoute: optional(form, "administrationRoute"),
      nextDueDate: optional(form, "nextDueDate"),
      administeredBy: optional(form, "administeredBy"),
      inventoryItemId: optional(form, "inventoryItemId"),
      notes,
    };
  if (resource === "treatments")
    return {
      flockId,
      treatmentDate: textValue(form, "treatmentDate"),
      productName: textValue(form, "productName"),
      reason: textValue(form, "reason"),
      dosage: optional(form, "dosage"),
      administrationRoute: optional(form, "administrationRoute"),
      endDate: optional(form, "endDate"),
      withdrawalEndDate: optional(form, "withdrawalEndDate"),
      prescribedBy: optional(form, "prescribedBy"),
      inventoryItemId: optional(form, "inventoryItemId"),
      notes,
    };
  if (resource === "sanitation")
    return {
      houseId,
      sanitationDate: textValue(form, "sanitationDate"),
      activityType: textValue(form, "activityType"),
      productName: optional(form, "productName"),
      status: textValue(form, "status"),
      performedBy: optional(form, "performedBy"),
      inventoryItemId: optional(form, "inventoryItemId"),
      notes,
    };
  if (resource === "biosecurity")
    return {
      houseId,
      recordDate: textValue(form, "recordDate"),
      checkType: textValue(form, "checkType"),
      complianceStatus: textValue(form, "complianceStatus"),
      riskLevel: textValue(form, "riskLevel"),
      actionTaken: optional(form, "actionTaken"),
      notes,
    };
  if (resource === "production-targets")
    return {
      flockId,
      metric: textValue(form, "metric"),
      targetValue: numberValue(form, "targetValue"),
      effectiveFrom: textValue(form, "effectiveFrom"),
      effectiveTo: optional(form, "effectiveTo"),
      notes,
    };
  return {
    flockId,
    lossDate: textValue(form, "lossDate"),
    lossType: textValue(form, "lossType"),
    quantity: numberValue(form, "quantity"),
    unit: textValue(form, "unit"),
    description: textValue(form, "description"),
    notes,
  };
}
