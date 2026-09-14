"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BriefcaseBusiness,
  ChevronRight,
  ExternalLink,
  FileDown,
  MapPin,
  Plus,
  Settings2,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/ui/states";
import { api, get, orgApiUrl, orgUrl, patch, post, put } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

const tr = (fr: boolean, french: string, english: string) =>
  fr ? french : english;
const blankJob = () => ({
  siteId: "",
  code: "",
  title: "",
  departmentName: "",
  employmentType: "permanent",
  experienceLevel: "not_specified",
  positionsOpen: 1,
  shortSummary: "",
  description: "",
  responsibilities: "",
  requirements: "",
  benefits: "",
  salarySummary: "",
  applicationDeadline: "",
  status: "draft",
});
const statuses: Record<
  string,
  [string, string, "good" | "warning" | "info" | "serious"]
> = {
  draft: ["Brouillon", "Draft", "warning"],
  published: ["Publiée", "Published", "good"],
  paused: ["En pause", "Paused", "info"],
  closed: ["Clôturée", "Closed", "serious"],
  archived: ["Archivée", "Archived", "serious"],
};
const applicationStatuses = [
  "received",
  "reviewing",
  "shortlisted",
  "interview",
  "offered",
  "hired",
  "rejected",
  "withdrawn",
];

export function CareersArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const client = useQueryClient();
  const readable = can(user, "careers.read");
  const editable = can(user, "careers.create");
  const manageable = can(user, "careers.update");
  const [jobEditor, setJobEditor] = useState<any | null>(null);
  const [settingsEditor, setSettingsEditor] = useState<any | null>(null);
  const [applicationFilter, setApplicationFilter] = useState("received");
  const [applicationViewer, setApplicationViewer] = useState<any | null>(null);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["careers", orgSlug] });
    void client.invalidateQueries({ queryKey: ["careers-summary", orgSlug] });
    void client.invalidateQueries({ queryKey: ["career-settings", orgSlug] });
  };
  const summary = useQuery({
    queryKey: ["careers-summary", orgSlug],
    enabled: readable,
    queryFn: () =>
      get<any>(orgUrl(orgSlug, "careers/summary")).then(
        (response) => response.summary,
      ),
  });
  const settings = useQuery({
    queryKey: ["career-settings", orgSlug],
    enabled: readable,
    queryFn: () =>
      get<any>(orgUrl(orgSlug, "careers/settings")).then(
        (response) => response.settings,
      ),
  });
  const jobs = useQuery({
    queryKey: ["careers", orgSlug, "jobs"],
    enabled: readable,
    queryFn: () =>
      get<any>(orgUrl(orgSlug, "careers/jobs?limit=100")).then(
        (response) => response.jobs,
      ),
  });
  const applications = useQuery({
    queryKey: ["careers", orgSlug, "applications", applicationFilter],
    enabled: readable,
    queryFn: () =>
      get<any>(
        orgUrl(
          orgSlug,
          `careers/applications?limit=100${applicationFilter ? `&status=${applicationFilter}` : ""}`,
        ),
      ).then((response) => response.applications),
  });
  const saveSettings = useMutation({
    mutationFn: (payload: any) =>
      put(orgUrl(orgSlug, "careers/settings"), payload),
    onSuccess: () => {
      refresh();
      setSettingsEditor(null);
      toast.success(
        tr(fr, "Portail carrière enregistré", "Careers portal saved"),
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const saveJob = useMutation({
    mutationFn: (payload: any) =>
      payload.id
        ? patch(orgUrl(orgSlug, `careers/jobs/${payload.id}`), payload)
        : post(orgUrl(orgSlug, "careers/jobs"), payload),
    onSuccess: () => {
      refresh();
      setJobEditor(null);
      toast.success(tr(fr, "Offre enregistrée", "Vacancy saved"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const updateApplication = useMutation({
    mutationFn: ({ id, payload }: any) =>
      patch(orgUrl(orgSlug, `careers/applications/${id}`), payload),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });
  const siteSettings = settings.data ?? [];
  const jobRows = jobs.data ?? [];
  const candidateRows = applications.data ?? [];
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const openNewJob = () =>
    setJobEditor({ ...blankJob(), siteId: siteSettings[0]?.site?.id ?? "" });

  if (!readable)
    return (
      <main className="p-6">
        <EmptyState
          icon={BriefcaseBusiness}
          title={tr(fr, "Accès non autorisé", "Access not permitted")}
          description={tr(
            fr,
            "Demandez l’autorisation Carrières à un propriétaire.",
            "Ask an owner for the Careers permission.",
          )}
        />
      </main>
    );
  return (
    <main className="mx-auto max-w-[1480px] space-y-6 p-4 sm:p-6 lg:p-8">
      <section className="relative isolate overflow-hidden rounded-3xl border border-brand/20 bg-surface-1 shadow-[0_20px_55px_-36px_rgb(30_64_175_/_0.7)]">
        <div className="relative grid gap-5 overflow-hidden bg-[radial-gradient(circle_at_82%_-25%,rgba(125,211,252,.32),transparent_38%),linear-gradient(125deg,#182a57,#2563a6)] px-6 py-8 text-white sm:px-8 md:grid-cols-[1fr_auto]">
          <div className="relative max-w-3xl">
            <p className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold tracking-[.16em] text-sky-50">
              {tr(fr, "TALENTS ET RECRUTEMENT", "TALENT & RECRUITMENT")}
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              {tr(fr, "Carrières par site", "Careers by site")}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-sky-50/95">
              {tr(
                fr,
                "Publiez les postes dont vos équipes ont réellement besoin. Les candidatures et CV restent privés dans le bon périmètre d’entreprise.",
                "Publish the roles your teams truly need. Applications and résumés remain private in the right company scope.",
              )}
            </p>
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2 self-end">
              <Button
                variant="secondary"
                onClick={() => setSettingsEditor(siteSettings[0] ?? null)}
              >
                <Settings2 className="size-4" />
                {tr(fr, "Portail par site", "Site portal")}
              </Button>
              <Button
                className="bg-white text-blue-950 hover:bg-sky-50"
                onClick={openNewJob}
              >
                <Plus className="size-4" />
                {tr(fr, "Créer un poste", "Create vacancy")}
              </Button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden bg-border/80 sm:grid-cols-5">
          {[
            [
              "published_jobs",
              "Postes ouverts",
              "Open roles",
              BriefcaseBusiness,
            ],
            [
              "inactive_jobs",
              "Brouillons / pause",
              "Drafts / paused",
              Settings2,
            ],
            ["applications", "Candidatures", "Applications", UsersRound],
            ["new_applications", "À examiner", "To review", UserRound],
            ["active_candidates", "En parcours", "In process", MapPin],
          ].map(([key, french, english, Icon]: any) => (
            <div
              key={key}
              className="group flex min-h-28 gap-3 bg-surface-1 p-4 transition-colors hover:bg-brand/[.035] sm:p-5"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand transition-transform group-hover:scale-105">
                <Icon className="size-5" />
              </span>
              <div className="pt-0.5">
                <b className="block text-2xl font-semibold tracking-tight text-ink">
                  {summary.data?.[key] ?? 0}
                </b>
                <p className="mt-1 text-xs font-medium text-ink-secondary">
                  {tr(fr, french, english)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {settingsEditor && (
        <SettingsEditor
          key={settingsEditor.site?.id ?? "none"}
          item={settingsEditor}
          fr={fr}
          saving={saveSettings.isPending}
          onClose={() => setSettingsEditor(null)}
          onSave={(payload: any) => saveSettings.mutate(payload)}
        />
      )}
      {jobEditor && (
        <JobEditor
          key={jobEditor.id ?? "new"}
          value={jobEditor}
          sites={siteSettings}
          fr={fr}
          saving={saveJob.isPending}
          onClose={() => setJobEditor(null)}
          onSave={(payload: any) => saveJob.mutate(payload)}
        />
      )}
      {applicationViewer && (
        <CandidateDetail
          key={applicationViewer.id}
          application={applicationViewer}
          fr={fr}
          editable={manageable}
          saving={updateApplication.isPending}
          orgSlug={orgSlug}
          onClose={() => setApplicationViewer(null)}
          onUpdate={(payload: any) =>
            updateApplication.mutate({ id: applicationViewer.id, payload })
          }
        />
      )}

      <section className="grid gap-6 xl:grid-cols-[1.25fr_.9fr]">
        <Card className="overflow-hidden border border-brand/25 bg-surface-1 ring-1 ring-brand/[.045] shadow-[0_16px_38px_-30px_rgb(30_64_175_/_0.55)]">
          <CardHeader className="gap-3 border-b border-border/70 bg-surface-2/45 px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>
                {tr(
                  fr,
                  "Postes publiés et brouillons",
                  "Published roles and drafts",
                )}
              </CardTitle>
              <CardDescription className="mt-1">
                {tr(
                  fr,
                  "Une offre est visible publiquement seulement si son site a activé le portail Carrières.",
                  "A vacancy is public only when its site has enabled the Careers portal.",
                )}
              </CardDescription>
            </div>
            {editable && (
              <Button size="sm" variant="secondary" onClick={openNewJob}>
                <Plus className="size-4" />
                {tr(fr, "Ajouter", "Add")}
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            {jobs.isLoading ? (
              <SkeletonCard />
            ) : jobs.isError ? (
              <ErrorState
                description={(jobs.error as Error).message}
                onRetry={() => void jobs.refetch()}
              />
            ) : jobRows.length ? (
              jobRows.map((job: any) => (
                <JobRow
                  key={job.id}
                  job={job}
                  fr={fr}
                  editable={manageable || editable}
                  onEdit={() => setJobEditor(job)}
                  publicUrl={`${origin}/careers/${orgSlug}/${job.code}`}
                />
              ))
            ) : (
              <EmptyState
                icon={BriefcaseBusiness}
                title={tr(fr, "Aucun poste créé", "No vacancies created")}
                description={tr(
                  fr,
                  "Créez un brouillon, puis activez le portail du site lorsque vous êtes prêt à recruter.",
                  "Create a draft, then activate the site portal when you are ready to recruit.",
                )}
                action={
                  editable
                    ? {
                        label: tr(fr, "Créer un poste", "Create vacancy"),
                        onClick: openNewJob,
                      }
                    : undefined
                }
              />
            )}
          </CardContent>
        </Card>
        <Card className="overflow-hidden border border-brand/25 bg-surface-1 ring-1 ring-brand/[.045] shadow-[0_16px_38px_-30px_rgb(30_64_175_/_0.55)]">
          <CardHeader className="border-b border-border/70 bg-surface-2/45 px-5 py-5">
            <CardTitle>
              {tr(fr, "Portails publics par site", "Public site portals")}
            </CardTitle>
            <CardDescription className="mt-1">
              {tr(
                fr,
                "Désactivez un site : les visiteurs ne voient plus ses offres ni le formulaire associé.",
                "Disable a site: visitors will no longer see its vacancies or application form.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            {settings.isLoading ? (
              <SkeletonCard />
            ) : siteSettings.length ? (
              siteSettings.map((item: any) => (
                <PortalCard
                  key={item.site.id}
                  item={item}
                  fr={fr}
                  editable={editable}
                  origin={origin}
                  orgSlug={orgSlug}
                  onConfigure={() => setSettingsEditor(item)}
                />
              ))
            ) : (
              <EmptyState
                icon={MapPin}
                title={tr(fr, "Aucun site disponible", "No sites available")}
                description={tr(
                  fr,
                  "Ajoutez un site actif avant de publier une offre.",
                  "Add an active site before publishing a vacancy.",
                )}
              />
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="overflow-hidden border border-brand/25 bg-surface-1 ring-1 ring-brand/[.045] shadow-[0_16px_38px_-30px_rgb(30_64_175_/_0.55)]">
        <CardHeader className="gap-3 border-b border-border/70 bg-surface-2/45 px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>
              {tr(fr, "Candidatures privées", "Private applications")}
            </CardTitle>
            <CardDescription className="mt-1">
              {tr(
                fr,
                "Seuls les utilisateurs autorisés dans le périmètre du site peuvent consulter les candidats et leur CV.",
                "Only users authorized in the site scope can view applicants and their résumés.",
              )}
            </CardDescription>
          </div>
          <select
            className="control h-10 max-w-56 bg-surface-1 shadow-sm"
            value={applicationFilter}
            onChange={(event) => setApplicationFilter(event.target.value)}
          >
            <option value="">
              {tr(fr, "Tous les statuts", "All statuses")}
            </option>
            {applicationStatuses.map((status) => (
              <option key={status} value={status}>
                {applicationLabel(status, fr)}
              </option>
            ))}
          </select>
        </CardHeader>
        <CardContent className="space-y-3 p-5">
          {applications.isLoading ? (
            <SkeletonCard />
          ) : applications.isError ? (
            <ErrorState
              description={(applications.error as Error).message}
              onRetry={() => void applications.refetch()}
            />
          ) : candidateRows.length ? (
            candidateRows.map((application: any) => (
              <CandidateRow
                key={application.id}
                application={application}
                fr={fr}
                onOpen={() => setApplicationViewer(application)}
              />
            ))
          ) : (
            <EmptyState
              icon={UsersRound}
              title={tr(
                fr,
                "Aucune candidature dans cette vue",
                "No applications in this view",
              )}
              description={tr(
                fr,
                "Les nouvelles candidatures apparaîtront ici dès qu’un visiteur soumet un formulaire complet.",
                "New applications appear here as soon as a visitor submits a complete form.",
              )}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function SettingsEditor({ item, fr, saving, onClose, onSave }: any) {
  const [state, setState] = useState({
    siteId: item?.site?.id ?? "",
    publicCareersEnabled: Boolean(item?.publicCareersEnabled),
    careersIntro: item?.careersIntro ?? "",
  });
  if (!item)
    return (
      <CareersModal
        title={tr(fr, "Portail Carrières", "Careers portal")}
        onClose={onClose}
      >
        <EmptyState
          icon={MapPin}
          title={tr(fr, "Aucun site disponible", "No site available")}
          description={tr(
            fr,
            "Ajoutez d’abord un site actif dans Paramètres.",
            "Add an active site in Settings first.",
          )}
        />
      </CareersModal>
    );
  return (
    <CareersModal
      title={tr(
        fr,
        "Configurer le portail Carrières",
        "Configure the Careers portal",
      )}
      description={`${item.site.name} · ${item.site.provinceName}`}
      onClose={onClose}
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(state);
        }}
      >
        <label
          className={`flex cursor-pointer gap-3 rounded-2xl border p-4 transition ${state.publicCareersEnabled ? "border-brand/45 bg-brand/[.06] ring-1 ring-brand/[.05]" : "border-border bg-surface-2/40"}`}
        >
          <input
            className="mt-0.5 size-4 accent-[var(--color-brand)]"
            type="checkbox"
            checked={state.publicCareersEnabled}
            onChange={(event) =>
              setState((previous) => ({
                ...previous,
                publicCareersEnabled: event.target.checked,
              }))
            }
          />
          <span>
            <b className="block text-sm text-ink">
              {tr(
                fr,
                "Accepter les candidatures publiques",
                "Accept public applications",
              )}
            </b>
            <span className="mt-1 block text-xs leading-5 text-ink-secondary">
              {tr(
                fr,
                "Les offres publiées pour ce site seront visibles sur le portail Carrières.",
                "Published roles for this site will be visible on the Careers portal.",
              )}
            </span>
          </span>
        </label>
        <Field label={tr(fr, "Texte d’accueil public", "Public welcome text")}>
          <Textarea
            rows={5}
            value={state.careersIntro}
            placeholder={tr(
              fr,
              "Présentez votre site et votre équipe en quelques lignes.",
              "Introduce this site and its team in a few lines.",
            )}
            onChange={(event) =>
              setState((previous) => ({
                ...previous,
                careersIntro: event.target.value,
              }))
            }
          />
        </Field>
        <ModalActions
          fr={fr}
          saving={saving}
          saveLabel={tr(fr, "Enregistrer", "Save")}
          onClose={onClose}
        />
      </form>
    </CareersModal>
  );
}

function JobEditor({ value, sites, fr, saving, onClose, onSave }: any) {
  const [state, setState] = useState(() => ({
    ...blankJob(),
    ...value,
    siteId: value.siteId ?? value.site?.id ?? "",
    departmentName: value.departmentName ?? "",
    employmentType: value.employmentType ?? "permanent",
    experienceLevel: value.experienceLevel ?? "not_specified",
    positionsOpen: value.positionsOpen ?? 1,
    shortSummary: value.shortSummary ?? "",
    description: value.description ?? "",
    responsibilities: value.responsibilities ?? "",
    requirements: value.requirements ?? "",
    benefits: value.benefits ?? "",
    salarySummary: value.salarySummary ?? "",
    applicationDeadline: value.applicationDeadline
      ? String(value.applicationDeadline).slice(0, 10)
      : "",
    status: value.status ?? "draft",
  }));
  const update = (key: string, nextValue: any) =>
    setState((previous: any) => ({ ...previous, [key]: nextValue }));
  const editing = Boolean(state.id);
  return (
    <CareersModal
      wide
      title={
        editing
          ? tr(fr, "Modifier le poste", "Edit vacancy")
          : tr(fr, "Créer un poste", "Create vacancy")
      }
      description={tr(
        fr,
        "Les offres publiées restent invisibles tant que leur site n’accepte pas les candidatures publiques.",
        "Published vacancies remain invisible until their site accepts public applications.",
      )}
      onClose={onClose}
    >
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            ...state,
            positionsOpen: Number(state.positionsOpen),
            departmentName: state.departmentName || undefined,
            responsibilities: state.responsibilities || undefined,
            requirements: state.requirements || undefined,
            benefits: state.benefits || undefined,
            salarySummary: state.salarySummary || undefined,
            applicationDeadline: state.applicationDeadline || null,
          });
        }}
      >
        <SelectField
          label={tr(fr, "Site", "Site")}
          required
          value={state.siteId}
          onChange={(nextValue) => update("siteId", nextValue)}
          placeholder={tr(fr, "Choisissez le site", "Choose a site")}
          items={sites.map((item: any) => [
            item.site.id,
            `${item.site.name} · ${item.site.provinceName}`,
          ])}
        />
        <FormField label={tr(fr, "Code", "Code")} required>
          <Input
            required
            value={state.code}
            placeholder="ouvrier_avicole_2026"
            onChange={(event) =>
              update(
                "code",
                event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
              )
            }
          />
          <p className="mt-1.5 text-xs text-ink-secondary">
            {tr(
              fr,
              "Lettres minuscules, chiffres et _ uniquement.",
              "Use lowercase letters, numbers and _ only.",
            )}
          </p>
        </FormField>
        <FormField label={tr(fr, "Titre du poste", "Job title")} required>
          <Input
            required
            value={state.title}
            placeholder={tr(fr, "Ex. Ouvrier avicole", "E.g. Poultry worker")}
            onChange={(event) => update("title", event.target.value)}
          />
        </FormField>
        <FormField label={tr(fr, "Département", "Department")}>
          <Input
            value={state.departmentName}
            placeholder={tr(
              fr,
              "Ex. Production avicole",
              "E.g. Poultry operations",
            )}
            onChange={(event) => update("departmentName", event.target.value)}
          />
        </FormField>
        <SelectField
          label={tr(fr, "Type de contrat", "Employment type")}
          value={state.employmentType}
          onChange={(nextValue) => update("employmentType", nextValue)}
          items={[
            ["permanent", tr(fr, "Permanent", "Permanent")],
            ["temporary", tr(fr, "Temporaire", "Temporary")],
            ["contract", tr(fr, "Contrat", "Contract")],
            ["casual", tr(fr, "Occasionnel", "Casual")],
            ["internship", tr(fr, "Stage", "Internship")],
          ]}
        />
        <SelectField
          label={tr(fr, "Niveau d’expérience", "Experience level")}
          value={state.experienceLevel}
          onChange={(nextValue) => update("experienceLevel", nextValue)}
          items={[
            ["not_specified", tr(fr, "Non précisé", "Not specified")],
            ["entry", tr(fr, "Débutant", "Entry")],
            ["junior", "Junior"],
            ["mid", tr(fr, "Intermédiaire", "Mid")],
            ["senior", "Senior"],
            ["lead", "Lead"],
          ]}
        />
        <FormField label={tr(fr, "Postes à pourvoir", "Open positions")}>
          <Input
            type="number"
            min="1"
            max="999"
            value={state.positionsOpen}
            onChange={(event) => update("positionsOpen", event.target.value)}
          />
        </FormField>
        <FormField
          label={tr(fr, "Clôture des candidatures", "Application deadline")}
        >
          <Input
            type="date"
            value={state.applicationDeadline}
            onChange={(event) =>
              update("applicationDeadline", event.target.value)
            }
          />
        </FormField>
        <FormField
          className="md:col-span-2"
          label={tr(fr, "Résumé", "Short summary")}
          required
        >
          <Textarea
            required
            rows={3}
            value={state.shortSummary}
            placeholder={tr(
              fr,
              "Une phrase claire pour présenter l’objectif du poste.",
              "A clear sentence presenting the role.",
            )}
            onChange={(event) => update("shortSummary", event.target.value)}
          />
        </FormField>
        <FormField
          className="md:col-span-2"
          label={tr(fr, "Description complète", "Full description")}
          required
        >
          <Textarea
            required
            rows={6}
            value={state.description}
            placeholder={tr(
              fr,
              "Décrivez le poste, l’équipe et le contexte de travail.",
              "Describe the role, team and work context.",
            )}
            onChange={(event) => update("description", event.target.value)}
          />
        </FormField>
        <FormField label={tr(fr, "Responsabilités", "Responsibilities")}>
          <Textarea
            rows={5}
            value={state.responsibilities}
            onChange={(event) => update("responsibilities", event.target.value)}
          />
        </FormField>
        <FormField label={tr(fr, "Exigences", "Requirements")}>
          <Textarea
            rows={5}
            value={state.requirements}
            onChange={(event) => update("requirements", event.target.value)}
          />
        </FormField>
        <FormField label={tr(fr, "Avantages", "Benefits")}>
          <Textarea
            rows={4}
            value={state.benefits}
            onChange={(event) => update("benefits", event.target.value)}
          />
        </FormField>
        <FormField
          label={tr(
            fr,
            "Salaire affiché (facultatif)",
            "Public salary (optional)",
          )}
        >
          <Input
            value={state.salarySummary}
            placeholder={tr(
              fr,
              "Ex. 500–650 USD / mois",
              "E.g. USD 500–650 / month",
            )}
            onChange={(event) => update("salarySummary", event.target.value)}
          />
        </FormField>
        <SelectField
          label={tr(fr, "Statut", "Status")}
          value={state.status}
          onChange={(nextValue) => update("status", nextValue)}
          items={Object.entries(statuses).map(([key, values]) => [
            key,
            tr(fr, values[0], values[1]),
          ])}
        />
        <div className="md:col-span-2">
          <ModalActions
            fr={fr}
            saving={saving}
            saveLabel={
              editing
                ? tr(fr, "Enregistrer les modifications", "Save changes")
                : tr(fr, "Enregistrer le poste", "Save vacancy")
            }
            onClose={onClose}
          />
        </div>
      </form>
    </CareersModal>
  );
}

function CareersModal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className={`max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-border bg-surface-1 shadow-2xl sm:rounded-3xl ${wide ? "max-w-5xl" : "max-w-2xl"}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border/70 bg-surface-1/95 px-5 py-5 backdrop-blur sm:px-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-xl bg-brand/10 text-brand">
                <Sparkles className="size-4" />
              </span>
              <CardTitle>{title}</CardTitle>
            </div>
            {description && (
              <CardDescription className="mt-2 max-w-3xl leading-5">
                {description}
              </CardDescription>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="shrink-0"
            onClick={onClose}
            aria-label={tr(true, "Fermer", "Close")}
          >
            <X className="size-4" />
          </Button>
        </header>
        <div className="p-5 sm:p-6">{children}</div>
      </section>
    </div>
  );
}

function ModalActions({
  fr,
  saving,
  saveLabel,
  onClose,
}: {
  fr: boolean;
  saving: boolean;
  saveLabel: string;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-5">
      <Button type="button" variant="ghost" onClick={onClose}>
        {tr(fr, "Annuler", "Cancel")}
      </Button>
      <Button loading={saving}>
        {saveLabel}
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

function PortalCard({ item, fr, editable, origin, orgSlug, onConfigure }: any) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-brand/25 bg-surface-1 p-4 ring-1 ring-brand/[.035] shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-brand/45 hover:shadow-[0_16px_34px_-28px_rgb(30_64_175_/_0.75)]">
      <div className="absolute inset-y-0 left-0 w-1 bg-brand/55" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
            <MapPin className="size-5" />
          </span>
          <div className="min-w-0">
            <b className="block truncate text-sm font-semibold text-ink">
              {item.site.name}
            </b>
            <p className="mt-1 text-xs text-ink-secondary">
              {item.site.provinceName}
            </p>
          </div>
        </div>
        <Badge variant={item.publicCareersEnabled ? "good" : "warning"}>
          {item.publicCareersEnabled
            ? tr(fr, "Ouvert", "Open")
            : tr(fr, "Fermé", "Closed")}
        </Badge>
      </div>
      {item.careersIntro ? (
        <p className="mt-4 border-y border-border/70 py-3 text-sm leading-6 text-ink-secondary">
          {item.careersIntro}
        </p>
      ) : (
        <p className="mt-4 border-y border-border/70 py-3 text-xs leading-5 text-ink-secondary">
          {tr(
            fr,
            "Ajoutez un texte d’accueil pour rendre ce portail plus clair aux candidats.",
            "Add a welcome message to make this portal clearer for applicants.",
          )}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {item.publicCareersEnabled && (
          <a
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface-1 px-3 text-xs font-semibold text-ink shadow-sm hover:bg-surface-2"
            target="_blank"
            rel="noreferrer"
            href={`${origin}/careers/${orgSlug}?site=${item.site.code}`}
          >
            <ExternalLink className="size-3.5" />
            {tr(fr, "Voir", "View")}
          </a>
        )}
        {editable && (
          <Button size="sm" variant="secondary" onClick={onConfigure}>
            <Settings2 className="size-3.5" />
            {tr(fr, "Configurer", "Configure")}
          </Button>
        )}
      </div>
    </div>
  );
}

function JobRow({ job, fr, editable, onEdit, publicUrl }: any) {
  const [french, english, variant] = statuses[job.status] ?? statuses.draft!;
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-brand/20 bg-surface-1 p-4 ring-1 ring-brand/[.03] shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-[0_14px_30px_-26px_rgb(30_64_175_/_0.65)]">
      <div className="absolute inset-y-0 left-0 w-1 bg-brand/55" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
            <BriefcaseBusiness className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-ink">{job.title}</h3>
              <Badge variant={variant}>{tr(fr, french, english)}</Badge>
            </div>
            <p className="mt-1 text-xs text-ink-secondary">
              {job.code} · {job.site?.name ?? "—"} · {job.province?.name ?? "—"}
            </p>
          </div>
        </div>
        <span className="rounded-xl bg-brand/10 px-3 py-2 text-center text-sm font-semibold text-brand">
          <b className="block leading-4">{job.applicationCount ?? 0}</b>
          <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-wide">
            {tr(fr, "candidatures", "applications")}
          </span>
        </span>
      </div>
      <p className="mt-4 text-sm leading-6 text-ink-secondary">
        {job.shortSummary}
      </p>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-border/70 pt-3 text-xs text-ink-secondary">
        <span className="rounded-full bg-surface-2 px-2.5 py-1">
          {job.employmentType}
        </span>
        <span className="rounded-full bg-surface-2 px-2.5 py-1">
          {job.experienceLevel}
        </span>
        <span className="rounded-full bg-surface-2 px-2.5 py-1">
          {job.positionsOpen} {tr(fr, "poste(s)", "position(s)")}
        </span>
        {job.applicationDeadline && (
          <span className="rounded-full bg-surface-2 px-2.5 py-1">
            {tr(fr, "Clôture", "Deadline")}: {job.applicationDeadline}
          </span>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {job.status === "published" && (
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface-1 px-3 text-xs font-semibold text-ink shadow-sm hover:bg-surface-2"
          >
            <ExternalLink className="size-3.5" />
            {tr(fr, "Voir le portail", "View portal")}
          </a>
        )}
        {editable && (
          <Button size="sm" variant="secondary" onClick={onEdit}>
            {tr(fr, "Modifier", "Edit")}
          </Button>
        )}
      </div>
    </article>
  );
}

function CandidateRow({ application, fr, onOpen }: any) {
  const openFromKeyboard = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  };
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={openFromKeyboard}
      aria-label={tr(
        fr,
        `Ouvrir le dossier de ${application.fullName}`,
        `Open ${application.fullName}'s application`,
      )}
      className="group relative cursor-pointer overflow-hidden rounded-2xl border border-brand/20 bg-surface-1 p-4 ring-1 ring-brand/[.03] shadow-sm transition hover:-translate-y-0.5 hover:border-brand/45 hover:bg-brand/[.025] hover:shadow-[0_14px_30px_-26px_rgb(30_64_175_/_0.65)] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
    >
      <div className="absolute inset-y-0 left-0 w-1 bg-brand/55" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
            <UserRound className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-ink">{application.fullName}</h3>
              <Badge
                variant={
                  application.status === "received"
                    ? "warning"
                    : application.status === "rejected"
                      ? "serious"
                      : "info"
                }
              >
                {applicationLabel(application.status, fr)}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-ink-secondary">
              {application.job?.title ?? "—"} · {application.site?.name ?? "—"}{" "}
              ·{" "}
              {application.submittedAt
                ? new Date(application.submittedAt).toLocaleDateString(
                    fr ? "fr-FR" : "en-US",
                  )
                : "—"}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          {tr(fr, "Voir le dossier", "View application")}
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-border/70 pt-3 text-xs text-ink-secondary">
        <span className="rounded-full bg-surface-2 px-2.5 py-1">
          {application.city ||
            tr(fr, "Ville non précisée", "City not specified")}
        </span>
        {application.yearsExperience !== null && (
          <span className="rounded-full bg-surface-2 px-2.5 py-1">
            {application.yearsExperience}{" "}
            {tr(fr, "ans d’expérience", "years’ experience")}
          </span>
        )}
        {application.resume && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-1 font-semibold text-brand">
            <FileDown className="size-3" /> CV
          </span>
        )}
      </div>
    </article>
  );
}

function CandidateDetail({
  application,
  fr,
  editable,
  saving,
  orgSlug,
  onClose,
  onUpdate,
}: any) {
  const [notes, setNotes] = useState(application.internalNotes ?? "");
  const [status, setStatus] = useState(application.status);
  const resumeDownloadUrl = application.resume
    ? orgApiUrl(orgSlug, `careers/applications/${application.id}/resume`)
    : null;
  const isPdf = application.resume?.mimeType === "application/pdf";
  const [resumePreviewUrl, setResumePreviewUrl] = useState<string | null>(null);
  const [resumePreviewError, setResumePreviewError] = useState(false);

  useEffect(() => {
    if (!isPdf) {
      setResumePreviewUrl(null);
      setResumePreviewError(false);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    setResumePreviewUrl(null);
    setResumePreviewError(false);
    void api
      .get<Blob>(
        orgUrl(orgSlug, `careers/applications/${application.id}/resume`),
        {
          params: { view: "inline" },
          responseType: "blob",
        },
      )
      .then((response) => {
        objectUrl = URL.createObjectURL(response.data);
        if (active) setResumePreviewUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => {
        if (active) setResumePreviewError(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [application.id, isPdf, orgSlug]);

  const submittedAt = application.submittedAt
    ? new Date(application.submittedAt).toLocaleString(fr ? "fr-FR" : "en-US", {
        dateStyle: "long",
        timeStyle: "short",
      })
    : "—";

  return (
    <CareersModal
      wide
      title={tr(fr, "Dossier de candidature", "Candidate application")}
      description={`${application.fullName} · ${application.job?.title ?? "—"} · ${application.site?.name ?? "—"}`}
      onClose={onClose}
    >
      <div className="space-y-6">
        <section className="rounded-2xl border border-brand/20 bg-brand/[.035] p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
                <UserRound className="size-5" />
              </span>
              <div>
                <h3 className="font-semibold text-ink">
                  {application.fullName}
                </h3>
                <p className="mt-1 text-sm text-ink-secondary">
                  {application.job?.title ?? "—"} ·{" "}
                  {application.site?.name ?? "—"}
                </p>
                <p className="mt-1 text-xs text-ink-secondary">
                  {tr(fr, "Reçue le", "Received on")} {submittedAt}
                </p>
              </div>
            </div>
            <Badge
              variant={
                status === "received"
                  ? "warning"
                  : status === "rejected"
                    ? "serious"
                    : "info"
              }
            >
              {applicationLabel(status, fr)}
            </Badge>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-ink">
            {tr(fr, "Coordonnées et disponibilité", "Contact and availability")}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <CandidateFact label={tr(fr, "E-mail", "Email")}>
              <a
                className="break-all text-brand underline-offset-2 hover:underline"
                href={`mailto:${application.email}`}
              >
                {application.email}
              </a>
            </CandidateFact>
            <CandidateFact label={tr(fr, "Téléphone", "Phone")}>
              <a
                className="text-brand underline-offset-2 hover:underline"
                href={`tel:${application.phone}`}
              >
                {application.phone}
              </a>
            </CandidateFact>
            <CandidateFact label={tr(fr, "Ville", "City")}>
              {application.city || "—"}
            </CandidateFact>
            <CandidateFact label={tr(fr, "Expérience", "Experience")}>
              {application.yearsExperience === null
                ? "—"
                : `${application.yearsExperience} ${tr(fr, "ans", "years")}`}
            </CandidateFact>
            <CandidateFact label={tr(fr, "Disponibilité", "Availability")}>
              {application.availability || "—"}
            </CandidateFact>
          </div>
        </section>

        {application.coverLetter && (
          <section>
            <h3 className="text-sm font-semibold text-ink">
              {tr(fr, "Message de motivation", "Cover letter")}
            </h3>
            <p className="mt-3 whitespace-pre-line rounded-2xl border border-border/70 bg-surface-2/55 p-4 text-sm leading-6 text-ink-secondary">
              {application.coverLetter}
            </p>
          </section>
        )}

        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-ink">CV</h3>
              <p className="mt-1 text-xs text-ink-secondary">
                {application.resume
                  ? `${application.resume.fileName} · ${application.resume.mimeType}`
                  : tr(fr, "Aucun CV joint", "No résumé attached")}
              </p>
            </div>
            {resumeDownloadUrl && (
              <a
                href={resumeDownloadUrl}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 text-xs font-semibold text-ink shadow-sm transition hover:bg-surface-2"
              >
                <FileDown className="size-3.5" />
                {tr(fr, "Télécharger le CV", "Download résumé")}
              </a>
            )}
          </div>
          {isPdf && resumeDownloadUrl ? (
            resumePreviewUrl ? (
              <iframe
                title={tr(
                  fr,
                  `CV de ${application.fullName}`,
                  `${application.fullName}'s résumé`,
                )}
                src={resumePreviewUrl}
                className="mt-3 h-[55dvh] min-h-96 w-full rounded-2xl border border-border bg-surface-2"
              />
            ) : (
              <div className="mt-3 grid min-h-52 place-items-center rounded-2xl border border-border bg-surface-2/55 p-5 text-center text-sm text-ink-secondary">
                {resumePreviewError
                  ? tr(
                      fr,
                      "L’aperçu du CV est indisponible. Vous pouvez le télécharger de façon sécurisée.",
                      "The résumé preview is unavailable. You can download it securely.",
                    )
                  : tr(
                      fr,
                      "Chargement sécurisé du CV…",
                      "Loading résumé securely…",
                    )}
              </div>
            )
          ) : application.resume ? (
            <div className="mt-3 rounded-2xl border border-dashed border-border bg-surface-2/40 p-5 text-sm leading-6 text-ink-secondary">
              {tr(
                fr,
                "Ce format de CV doit être téléchargé pour être consulté. Les PDF sont affichés directement ici.",
                "This résumé format must be downloaded to view it. PDFs are displayed directly here.",
              )}
            </div>
          ) : null}
        </section>

        {editable && (
          <section className="rounded-2xl border border-border bg-surface-2/35 p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-ink">
              {tr(fr, "Suivi de recrutement", "Recruitment follow-up")}
            </h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-[190px_1fr_auto]">
              <select
                className="control bg-surface-1"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                {applicationStatuses.map((item) => (
                  <option key={item} value={item}>
                    {applicationLabel(item, fr)}
                  </option>
                ))}
              </select>
              <Input
                value={notes}
                placeholder={tr(fr, "Note interne", "Internal note")}
                onChange={(event) => setNotes(event.target.value)}
              />
              <Button
                loading={saving}
                onClick={() =>
                  onUpdate({ status, internalNotes: notes || undefined })
                }
              >
                {tr(fr, "Mettre à jour", "Update")}
              </Button>
            </div>
          </section>
        )}
      </div>
    </CareersModal>
  );
}

function CandidateFact({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-surface-1 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
        {label}
      </p>
      <div className="mt-1 text-sm text-ink">{children}</div>
    </div>
  );
}

function applicationLabel(status: string, fr: boolean) {
  const map: Record<string, [string, string]> = {
    received: ["Reçue", "Received"],
    reviewing: ["En examen", "Reviewing"],
    shortlisted: ["Présélectionné", "Shortlisted"],
    interview: ["Entretien", "Interview"],
    offered: ["Offre envoyée", "Offered"],
    hired: ["Recruté", "Hired"],
    rejected: ["Refusée", "Rejected"],
    withdrawn: ["Retirée", "Withdrawn"],
  };
  const values = map[status] ?? [status, status];
  return tr(fr, values[0], values[1]);
}
function FormField({
  label,
  children,
  required,
  className,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <Field className={className} label={label} required={required}>
      {children}
    </Field>
  );
}
function SelectField({
  label,
  value,
  items,
  onChange,
  required,
  placeholder,
}: {
  label: string;
  value: string;
  items: [string, string][];
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <FormField label={label} required={required}>
      <select
        className="control"
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder ?? "—"}</option>
        {items.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </FormField>
  );
}
