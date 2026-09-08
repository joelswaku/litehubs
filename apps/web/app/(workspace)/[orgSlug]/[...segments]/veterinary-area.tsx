"use client";

import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bird,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  HeartPulse,
  PiggyBank,
  ShieldCheck,
  Stethoscope,
  Syringe,
  X,
} from "lucide-react";
import Link from "next/link";
import { Badge, severityVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { get, orgUrl } from "@/lib/api";
import { poultryApi } from "@/lib/poultry-api";
import { pigsApi } from "@/lib/pigs-api";
import { can } from "@/lib/permissions";
import { formatBusinessDay } from "@/lib/utils";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type Species = "poultry" | "pigs";
type View = "overview" | "incidents" | "prevention" | "visits";
type Place = { id: string; name?: string | null; code?: string | null };
type Site = { id: string; name: string; code?: string | null };
type ClinicalRecord = Record<string, unknown> & {
  id: string;
  flock?: Place | null;
  house?: Place | null;
  pen?: Place | null;
  group?: Place | null;
  animal?: Place | null;
  site?: Place | null;
};
type SourceCategory = Exclude<View, "overview">;

const clinicalSources = [
  {
    key: "poultry-health",
    species: "poultry",
    resource: "health",
    category: "incidents",
    permission: "poultry.health.read",
    load: (orgSlug: string, siteId: string) =>
      poultryApi.list<{ records: ClinicalRecord[] }>(orgSlug, "health", {
        siteId: siteId || undefined,
      }),
  },
  {
    key: "poultry-mortality",
    species: "poultry",
    resource: "mortality",
    category: "incidents",
    permission: "poultry.mortality.read",
    load: (orgSlug: string, siteId: string) =>
      poultryApi.list<{ records: ClinicalRecord[] }>(orgSlug, "mortality", {
        siteId: siteId || undefined,
      }),
  },
  {
    key: "poultry-vaccinations",
    species: "poultry",
    resource: "vaccinations",
    category: "prevention",
    permission: "poultry.vaccinations.read",
    load: (orgSlug: string, siteId: string) =>
      poultryApi.list<{ records: ClinicalRecord[] }>(orgSlug, "vaccinations", {
        siteId: siteId || undefined,
      }),
  },
  {
    key: "poultry-treatments",
    species: "poultry",
    resource: "treatments",
    category: "prevention",
    permission: "poultry.treatments.read",
    load: (orgSlug: string, siteId: string) =>
      poultryApi.list<{ records: ClinicalRecord[] }>(orgSlug, "treatments", {
        siteId: siteId || undefined,
      }),
  },
  {
    key: "poultry-biosecurity",
    species: "poultry",
    resource: "biosecurity",
    category: "prevention",
    permission: "poultry.biosecurity.read",
    load: (orgSlug: string, siteId: string) =>
      poultryApi.list<{ records: ClinicalRecord[] }>(orgSlug, "biosecurity", {
        siteId: siteId || undefined,
      }),
  },
  {
    key: "pig-health",
    species: "pigs",
    resource: "health",
    category: "incidents",
    permission: "pigs.health.read",
    load: (orgSlug: string, siteId: string) =>
      pigsApi.list<{ records: ClinicalRecord[] }>(orgSlug, "health", {
        siteId: siteId || undefined,
      }),
  },
  {
    key: "pig-mortality",
    species: "pigs",
    resource: "mortality",
    category: "incidents",
    permission: "pigs.mortality.read",
    load: (orgSlug: string, siteId: string) =>
      pigsApi.list<{ records: ClinicalRecord[] }>(orgSlug, "mortality", {
        siteId: siteId || undefined,
      }),
  },
  {
    key: "pig-vaccinations",
    species: "pigs",
    resource: "vaccinations",
    category: "prevention",
    permission: "pigs.vaccinations.read",
    load: (orgSlug: string, siteId: string) =>
      pigsApi.list<{ records: ClinicalRecord[] }>(orgSlug, "vaccinations", {
        siteId: siteId || undefined,
      }),
  },
  {
    key: "pig-treatments",
    species: "pigs",
    resource: "treatments",
    category: "prevention",
    permission: "pigs.treatments.read",
    load: (orgSlug: string, siteId: string) =>
      pigsApi.list<{ records: ClinicalRecord[] }>(orgSlug, "treatments", {
        siteId: siteId || undefined,
      }),
  },
  {
    key: "pig-quarantine",
    species: "pigs",
    resource: "quarantine",
    category: "prevention",
    permission: "pigs.quarantine.read",
    load: (orgSlug: string, siteId: string) =>
      pigsApi.list<{ records: ClinicalRecord[] }>(orgSlug, "quarantine", {
        siteId: siteId || undefined,
      }),
  },
  {
    key: "pig-veterinary",
    species: "pigs",
    resource: "veterinary",
    category: "visits",
    permission: "pigs.veterinary.read",
    load: (orgSlug: string, siteId: string) =>
      pigsApi.list<{ records: ClinicalRecord[] }>(orgSlug, "veterinary", {
        siteId: siteId || undefined,
      }),
  },
] as const;
type ClinicalSource = (typeof clinicalSources)[number];
type ClinicalEntry = {
  source: ClinicalSource;
  record: ClinicalRecord;
  date: string | null;
};

const text = (fr: boolean, english: string, french: string) =>
  fr ? french : english;
const readable = (value: unknown, fr: boolean) => {
  const labels: Record<string, string> = {
    open: "Ouvert",
    monitoring: "Surveillance",
    resolved: "Résolu",
    closed: "Clôturé",
    active: "Actif",
    extended: "Prolongé",
    released: "Libéré",
    cancelled: "Annulé",
    low: "Faible",
    medium: "Moyen",
    high: "Élevé",
    critical: "Critique",
    compliant: "Conforme",
    non_compliant: "Non conforme",
    not_checked: "Non contrôlé",
    observation: "Observation",
    suspected_disease: "Maladie suspectée",
    confirmed_disease: "Maladie confirmée",
    outbreak: "Épidémie",
    injury: "Blessure",
    lameness: "Boiterie",
    reproductive: "Reproduction",
    routine: "Routine",
    emergency: "Urgence",
    diagnostic: "Diagnostic",
    follow_up: "Suivi",
    advisory: "Conseil",
    disease: "Maladie",
    heat_stress: "Stress thermique",
    cold_stress: "Stress dû au froid",
    access_control: "Contrôle d’accès",
    visitor: "Visiteur",
    vehicle: "Véhicule",
    footbath: "Pédiluve",
    ppe: "Équipement de protection",
    pest_control: "Contrôle des nuisibles",
    quarantine: "Quarantaine",
  };
  const raw = String(value ?? "—");
  if (fr && labels[raw]) return labels[raw];
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};
const dateOf = (record: ClinicalRecord) => {
  const value =
    record.recordDate ??
    record.mortalityDate ??
    record.vaccinationDate ??
    record.treatmentDate ??
    record.startDate ??
    record.visitDate;
  return typeof value === "string" && value.length >= 10
    ? value.slice(0, 10)
    : null;
};
const day = () => new Date().toISOString().slice(0, 10);
const plusDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};
const displayDate = (value: string | null | undefined, fr: boolean) => {
  if (!value) return "—";
  const [year, month, date] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !date) return value;
  return new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, date));
};
const sourceLabel = (source: ClinicalSource, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    health: ["Health event", "Événement de santé"],
    mortality: ["Mortality", "Mortalité"],
    vaccinations: ["Vaccination", "Vaccination"],
    treatments: ["Treatment", "Traitement"],
    biosecurity: ["Biosecurity check", "Contrôle de biosécurité"],
    quarantine: ["Quarantine", "Quarantaine"],
    veterinary: ["Veterinary visit", "Visite vétérinaire"],
  };
  return labels[source.resource]?.[fr ? 1 : 0] ?? source.resource;
};
const titleOf = (entry: ClinicalEntry, fr: boolean) => {
  const { resource } = entry.source;
  const item = entry.record;
  if (resource === "health")
    return readable(item.eventType ?? sourceLabel(entry.source, fr), fr);
  if (resource === "mortality")
    return `${Number(item.deathCount ?? 0)} ${text(fr, "deaths", "décès")}`;
  if (resource === "vaccinations")
    return String(item.vaccineName ?? sourceLabel(entry.source, fr));
  if (resource === "treatments")
    return String(item.productName ?? sourceLabel(entry.source, fr));
  if (resource === "biosecurity")
    return readable(item.checkType ?? sourceLabel(entry.source, fr), fr);
  if (resource === "quarantine") return text(fr, "Quarantine", "Quarantaine");
  return readable(item.visitType ?? sourceLabel(entry.source, fr), fr);
};
const subjectOf = (record: ClinicalRecord) =>
  record.flock?.name ??
  record.house?.name ??
  record.animal?.name ??
  record.animal?.code ??
  record.group?.name ??
  record.pen?.name ??
  record.site?.name ??
  "—";
const statusOf = (entry: ClinicalEntry) =>
  String(
    entry.record.severity ??
      entry.record.riskLevel ??
      entry.record.status ??
      entry.record.complianceStatus ??
      "recorded",
  );
const detailLabel = (key: string, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    recordDate: ["Record date", "Date de saisie"],
    mortalityDate: ["Mortality date", "Date de mortalité"],
    vaccinationDate: ["Vaccination date", "Date de vaccination"],
    treatmentDate: ["Treatment date", "Date du traitement"],
    startDate: ["Quarantine start", "Début de la quarantaine"],
    endDate: ["End date", "Date de fin"],
    visitDate: ["Visit date", "Date de visite"],
    eventType: ["Event type", "Type d’événement"],
    severity: ["Severity", "Gravité"],
    status: ["Status", "Statut"],
    symptoms: ["Symptoms", "Symptômes"],
    diagnosis: ["Diagnosis", "Diagnostic"],
    actionTaken: ["Action taken", "Action prise"],
    veterinarianName: ["Veterinarian", "Vétérinaire"],
    animalsAffected: ["Animals affected", "Animaux affectés"],
    birdsAffected: ["Birds affected", "Oiseaux affectés"],
    vaccineName: ["Vaccine", "Vaccin"],
    manufacturer: ["Manufacturer", "Fabricant"],
    batchNumber: ["Batch", "Lot"],
    dose: ["Dose", "Dose"],
    administrationRoute: ["Route", "Voie d’administration"],
    nextDueDate: ["Next due", "Prochaine échéance"],
    administeredBy: ["Administered by", "Administré par"],
    productName: ["Product", "Produit"],
    reason: ["Reason", "Motif"],
    dosage: ["Dosage", "Posologie"],
    withdrawalEndDate: ["Withdrawal end", "Fin du délai d’attente"],
    prescribedBy: ["Prescribed by", "Prescrit par"],
    checkType: ["Check type", "Type de contrôle"],
    complianceStatus: ["Compliance", "Conformité"],
    riskLevel: ["Risk level", "Niveau de risque"],
    visitType: ["Visit type", "Type de visite"],
    recommendations: ["Recommendations", "Recommandations"],
    followUpDate: ["Follow-up date", "Date de suivi"],
    clearanceNotes: ["Clearance notes", "Notes de libération"],
    notes: ["Notes", "Notes"],
  };
  return (
    labels[key]?.[fr ? 1 : 0] ??
    key
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (letter) => letter.toUpperCase())
  );
};
const detailValue = (value: unknown, fr: boolean) => {
  if (value == null || value === "") return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value))
    return displayDate(value.slice(0, 10), fr);
  if (typeof value === "boolean")
    return text(fr, value ? "Yes" : "No", value ? "Oui" : "Non");
  if (typeof value === "object")
    return (value as Place).name ?? (value as Place).code ?? "—";
  return String(value);
};

export function VeterinaryArea({ orgSlug }: { orgSlug: string }) {
  const user = useSessionUser();
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const [siteId, setSiteId] = useState("");
  const [view, setView] = useState<View>("overview");
  const [selected, setSelected] = useState<ClinicalEntry | null>(null);
  const allowed = (source: ClinicalSource) => can(user, source.permission);
  const sources = clinicalSources.filter(allowed);
  const sites = useQuery({
    queryKey: ["veterinary-sites", orgSlug],
    queryFn: () => get<{ sites: Site[] }>(orgUrl(orgSlug, "sites")),
    enabled: can(user, "sites.read"),
    select: (data) => data.sites,
  });
  const queries = useQueries({
    queries: clinicalSources.map((source) => ({
      queryKey: ["veterinary", orgSlug, source.key, siteId],
      queryFn: () => source.load(orgSlug, siteId),
      enabled: allowed(source),
      select: (data: { records: ClinicalRecord[] }) => data.records,
    })),
  });
  const loading = queries.some(
    (query, index) =>
      Boolean(clinicalSources[index] && allowed(clinicalSources[index])) &&
      query.isPending,
  );
  const failed = queries
    .filter((_, index) =>
      Boolean(clinicalSources[index] && allowed(clinicalSources[index])),
    )
    .some((query) => query.isError);
  const retry = () =>
    queries.forEach((query, index) => {
      const source = clinicalSources[index];
      if (source && allowed(source)) void query.refetch();
    });
  const entries = useMemo(
    () =>
      clinicalSources
        .flatMap((source, index) =>
          ((queries[index]?.data as ClinicalRecord[] | undefined) ?? []).map(
            (record) => ({ source, record, date: dateOf(record) }),
          ),
        )
        .sort((a, b) =>
          String(b.date ?? "").localeCompare(String(a.date ?? "")),
        ),
    [queries],
  );
  const visibleEntries =
    view === "overview"
      ? entries
      : entries.filter((entry) => entry.source.category === view);
  const openCases = entries.filter(
    (entry) =>
      entry.source.resource === "health" &&
      ["open", "monitoring"].includes(String(entry.record.status)),
  ).length;
  const highRisk = entries.filter(
    (entry) =>
      ["health", "biosecurity"].includes(entry.source.resource) &&
      ["high", "critical"].includes(
        String(entry.record.severity ?? entry.record.riskLevel),
      ),
  ).length;
  const vaccineDue = entries.filter(
    (entry) =>
      entry.source.resource === "vaccinations" &&
      typeof entry.record.nextDueDate === "string" &&
      entry.record.nextDueDate.slice(0, 10) <= plusDays(14),
  ).length;
  const quarantined = entries.filter(
    (entry) =>
      entry.source.resource === "quarantine" &&
      ["active", "extended"].includes(String(entry.record.status)),
  ).length;
  const tabs: Array<{ value: View; label: string; icon: typeof HeartPulse }> = [
    {
      value: "overview",
      label: text(fr, "Clinical overview", "Vue clinique"),
      icon: HeartPulse,
    },
    {
      value: "incidents",
      label: text(fr, "Incidents", "Incidents"),
      icon: AlertTriangle,
    },
    {
      value: "prevention",
      label: text(fr, "Prevention", "Prévention"),
      icon: ShieldCheck,
    },
    {
      value: "visits",
      label: text(fr, "Veterinary visits", "Visites vétérinaires"),
      icon: Stethoscope,
    },
  ];

  if (!sources.length)
    return (
      <main className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
        <EmptyState
          title={text(fr, "No clinical access", "Aucun accès clinique")}
          description={text(
            fr,
            "Your role has no permission to view Pig or Poultry clinical records.",
            "Votre rôle ne possède aucune permission pour consulter les dossiers cliniques Porcs ou Volaille.",
          )}
          icon={HeartPulse}
        />
      </main>
    );

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <section className="relative isolate overflow-hidden rounded-2xl bg-[linear-gradient(120deg,#083a43_0%,#10636a_54%,#169a8d_100%)] px-5 py-6 text-white shadow-[0_20px_55px_-30px_rgba(8,58,67,.75)] sm:px-7 sm:py-8">
        <div
          className="absolute -right-12 -top-16 size-72 rounded-full border border-white/10 bg-white/5"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-teal-100">
              {text(fr, "Animal health", "Santé animale")}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.035em]">
              {text(fr, "Veterinary centre", "Centre vétérinaire")}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-teal-50/90">
              {text(
                fr,
                "One clinical view for Pig and Poultry health, prevention, mortality and follow-up. Records remain in their original production module.",
                "Une vue clinique unique pour la santé, la prévention, la mortalité et le suivi Porcs et Volaille. Les dossiers restent dans leur module de production d’origine.",
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {can(user, "poultry.health.read") ? (
              <Link
                href={`/${orgSlug}/poultry`}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-white/25 bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                <Bird className="size-4" />
                {text(fr, "Open Poultry", "Ouvrir Volaille")}
              </Link>
            ) : null}
            {can(user, "pigs.health.read") ? (
              <Link
                href={`/${orgSlug}/pigs`}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-white/25 bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                <PiggyBank className="size-4" />
                {text(fr, "Open Pigs", "Ouvrir Porcs")}
              </Link>
            ) : null}
          </div>
        </div>
        <div className="relative mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <HeroMetric
            label={text(fr, "Open cases", "Cas ouverts")}
            value={openCases}
            icon={ClipboardCheck}
          />
          <HeroMetric
            label={text(fr, "High-risk signals", "Alertes à risque élevé")}
            value={highRisk}
            icon={AlertTriangle}
            critical={highRisk > 0}
          />
          <HeroMetric
            label={text(
              fr,
              "Vaccinations due in 14 days",
              "Vaccinations à échéance sous 14 jours",
            )}
            value={vaccineDue}
            icon={Syringe}
            critical={vaccineDue > 0}
          />
          <HeroMetric
            label={text(fr, "Active quarantine", "Quarantaines actives")}
            value={quarantined}
            icon={ShieldCheck}
            critical={quarantined > 0}
          />
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 p-3 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {tabs.map(({ value, label, icon: Icon }) => (
            <button
              type="button"
              key={value}
              onClick={() => setView(value)}
              className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors ${view === value ? "bg-brand text-brand-ink" : "text-ink-secondary hover:bg-surface-2 hover:text-ink"}`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
        {sites.data?.length ? (
          <label className="flex items-center gap-2 text-xs font-medium text-ink-secondary">
            <span>{text(fr, "Site / farm", "Site / ferme")}</span>
            <select
              value={siteId}
              onChange={(event) => setSiteId(event.target.value)}
              className="h-9 rounded-lg border border-border bg-surface-1 px-2 text-xs text-ink"
            >
              <option value="">
                {text(fr, "All permitted sites", "Tous les sites autorisés")}
              </option>
              {sites.data.map((site) => (
                <option value={site.id} key={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>

      {failed ? (
        <ErrorState
          title={text(
            fr,
            "Unable to load all clinical records",
            "Impossible de charger tous les dossiers cliniques",
          )}
          description={text(
            fr,
            "Only records you have permission to see are requested. Try again if your connection was interrupted.",
            "Seuls les dossiers autorisés pour votre rôle sont demandés. Réessayez si la connexion a été interrompue.",
          )}
          onRetry={retry}
        />
      ) : loading ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </section>
      ) : (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.7fr)]">
          <div className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
                  {tabs.find((tab) => tab.value === view)?.label}
                </p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-ink">
                  {text(fr, "Clinical register", "Registre clinique")}
                </h2>
                <p className="mt-1 text-sm text-ink-secondary">
                  {text(
                    fr,
                    "Select a record to review the clinical information and open its source module.",
                    "Sélectionnez un dossier pour consulter les informations cliniques et ouvrir son module source.",
                  )}
                </p>
              </div>
              <Badge variant="info">
                {visibleEntries.length} {text(fr, "records", "dossiers")}
              </Badge>
            </div>
            {visibleEntries.length ? (
              <div className="divide-y divide-border">
                {visibleEntries.slice(0, 100).map((entry) => (
                  <ClinicalRow
                    key={`${entry.source.key}-${entry.record.id}`}
                    entry={entry}
                    fr={fr}
                    onSelect={() => setSelected(entry)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title={text(
                  fr,
                  "No clinical record in this view",
                  "Aucun dossier clinique dans cette vue",
                )}
                description={text(
                  fr,
                  "Use the Pig or Poultry module to add the first field record.",
                  "Utilisez le module Porcs ou Volaille pour ajouter le premier enregistrement terrain.",
                )}
                icon={HeartPulse}
              />
            )}
          </div>
          <aside className="space-y-5">
            <section className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
                {text(
                  fr,
                  "Today’s clinical priorities",
                  "Priorités cliniques du jour",
                )}
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-ink">
                {text(
                  fr,
                  "What needs attention",
                  "Ce qui demande une attention",
                )}
              </h2>
              <Priority
                label={text(
                  fr,
                  "High-risk events",
                  "Événements à risque élevé",
                )}
                value={highRisk}
                good={highRisk === 0}
                icon={AlertTriangle}
              />
              <Priority
                label={text(
                  fr,
                  "Vaccinations due soon",
                  "Vaccinations bientôt dues",
                )}
                value={vaccineDue}
                good={vaccineDue === 0}
                icon={CalendarClock}
              />
              <Priority
                label={text(
                  fr,
                  "Animals/groups in quarantine",
                  "Animaux / groupes en quarantaine",
                )}
                value={quarantined}
                good={quarantined === 0}
                icon={ShieldCheck}
              />
            </section>
            <section className="rounded-2xl border border-brand/20 bg-brand-subtle p-5">
              <Stethoscope className="size-5 text-brand" aria-hidden />
              <h2 className="mt-3 text-sm font-semibold text-ink">
                {text(fr, "One source of truth", "Une seule source de vérité")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink-secondary">
                {text(
                  fr,
                  "The veterinary centre does not duplicate treatment, vaccine or health records. It groups the authorized production records so every change stays traceable to its flock, house, pen or animal.",
                  "Le centre vétérinaire ne duplique pas les traitements, vaccins ou dossiers de santé. Il regroupe les enregistrements de production autorisés afin que chaque modification reste liée à son lot, bâtiment, enclos ou animal.",
                )}
              </p>
            </section>
          </aside>
        </section>
      )}
      {selected ? (
        <ClinicalDetail
          entry={selected}
          fr={fr}
          orgSlug={orgSlug}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </main>
  );
}

function HeroMetric({
  label,
  value,
  icon: Icon,
  critical,
}: {
  label: string;
  value: number;
  icon: typeof HeartPulse;
  critical?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 backdrop-blur ${critical ? "border-critical/35 bg-critical/15" : "border-white/15 bg-white/10"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-teal-50/90">{label}</p>
        <Icon className="size-4 text-teal-100" aria-hidden />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums text-white">
        {value}
      </p>
    </div>
  );
}
function Priority({
  label,
  value,
  icon: Icon,
  good,
}: {
  label: string;
  value: number;
  icon: typeof AlertTriangle;
  good?: boolean;
}) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-xl border border-border p-3">
      <span
        className={`grid size-8 place-items-center rounded-lg ${good ? "bg-good/10 text-good-ink" : "bg-warning/15 text-warning-ink"}`}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-ink-secondary">{label}</p>
        <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
          {value}
        </p>
      </div>
    </div>
  );
}
function ClinicalRow({
  entry,
  fr,
  onSelect,
}: {
  entry: ClinicalEntry;
  fr: boolean;
  onSelect: () => void;
}) {
  const speciesLabel =
    entry.source.species === "poultry"
      ? text(fr, "Poultry", "Volaille")
      : text(fr, "Pigs", "Porcs");
  const status = statusOf(entry);
  const showSeverity = ["health", "biosecurity"].includes(
    entry.source.resource,
  );
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-surface-2"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg ${entry.source.species === "poultry" ? "bg-amber-500/10 text-amber-700" : "bg-rose-500/10 text-rose-700"}`}
        >
          {entry.source.species === "poultry" ? (
            <Bird className="size-4" aria-hidden />
          ) : (
            <PiggyBank className="size-4" aria-hidden />
          )}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-ink">
              {titleOf(entry, fr)}
            </p>
            <Badge variant="outline">{speciesLabel}</Badge>
            {showSeverity ? (
              <Badge variant={severityVariant(status)}>
                {readable(status, fr)}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs text-ink-secondary">
            {subjectOf(entry.record)} · {sourceLabel(entry.source, fr)}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {displayDate(entry.date, fr)}
          </p>
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden />
    </button>
  );
}
function ClinicalDetail({
  entry,
  fr,
  orgSlug,
  onClose,
}: {
  entry: ClinicalEntry;
  fr: boolean;
  orgSlug: string;
  onClose: () => void;
}) {
  const destination = entry.source.species === "poultry" ? "poultry" : "pigs";
  const keys = [
    "recordDate",
    "mortalityDate",
    "vaccinationDate",
    "treatmentDate",
    "startDate",
    "endDate",
    "visitDate",
    "eventType",
    "visitType",
    "severity",
    "status",
    "symptoms",
    "diagnosis",
    "actionTaken",
    "veterinarianName",
    "animalsAffected",
    "birdsAffected",
    "vaccineName",
    "manufacturer",
    "batchNumber",
    "dose",
    "administrationRoute",
    "nextDueDate",
    "administeredBy",
    "productName",
    "reason",
    "dosage",
    "withdrawalEndDate",
    "prescribedBy",
    "checkType",
    "complianceStatus",
    "riskLevel",
    "recommendations",
    "followUpDate",
    "clearanceNotes",
    "notes",
  ].filter((key) => entry.record[key] != null && entry.record[key] !== "");
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={text(
        fr,
        "Clinical record details",
        "Détails du dossier clinique",
      )}
    >
      <div className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-surface-1 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-brand">
              {entry.source.species === "poultry"
                ? text(
                    fr,
                    "Poultry clinical record",
                    "Dossier clinique Volaille",
                  )
                : text(fr, "Pig clinical record", "Dossier clinique Porcs")}
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink">
              {titleOf(entry, fr)}
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">
              {subjectOf(entry.record)} · {displayDate(entry.date, fr)}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X />
            {text(fr, "Close", "Fermer")}
          </Button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {keys.map((key) => (
            <div
              key={key}
              className={`rounded-xl border border-border p-3 ${["symptoms", "diagnosis", "actionTaken", "recommendations", "notes"].includes(key) ? "sm:col-span-2" : ""}`}
            >
              <p className="text-xs font-medium text-ink-secondary">
                {detailLabel(key, fr)}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">
                {detailValue(entry.record[key], fr)}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {text(fr, "Close", "Fermer")}
          </Button>
          <Link
            href={`/${orgSlug}/${destination}`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-brand-ink transition-colors hover:bg-brand-hover"
          >
            <ChevronRight className="size-4" />
            {entry.source.species === "poultry"
              ? text(fr, "Open Poultry records", "Ouvrir les dossiers Volaille")
              : text(fr, "Open Pig records", "Ouvrir les dossiers Porcs")}
          </Link>
        </div>
      </div>
    </div>
  );
}
