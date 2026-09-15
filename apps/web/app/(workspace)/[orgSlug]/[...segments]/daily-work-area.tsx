"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileText,
  Handshake,
  Pencil,
  Plus,
  Send,
  Siren,
  Wheat,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError, get, orgUrl } from "@/lib/api";
import { dailyWorkApi } from "@/lib/daily-work-api";
import { can } from "@/lib/permissions";
import { formatInstant } from "@/lib/utils";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";
import { DailyWorkTemplateManager } from "./daily-work-template-manager";

type ChecklistTemplate = {
  id: string;
  code: string;
  name: string;
  domain: string;
  siteId: string | null;
  siteName?: string | null;
  itemCount: number | string;
};
type ChecklistItem = {
  id: string;
  position: number;
  prompt: string;
  responseType: "boolean" | "number" | "text" | "choice" | "photo";
  unit: string | null;
  isRequired: boolean;
  booleanValue?: boolean | null;
  numberValue?: string | number | null;
  textValue?: string | null;
  passed?: boolean | null;
  comment?: string | null;
  alertId?: string | null;
};
type ChecklistRun = {
  id: string;
  templateId: string;
  templateName?: string;
  domain?: string;
  workDate: string;
  siteId: string | null;
  siteName?: string | null;
  status: "in_progress" | "completed" | "verified" | "missed";
  itemsTotal: number;
  itemsCompleted: number;
  itemsFailed: number;
  notes?: string | null;
  completedAt?: string | null;
  completedByName?: string | null;
  verifiedAt?: string | null;
  verifiedByName?: string | null;
  items?: ChecklistItem[];
};
type Report = {
  id: string;
  workDate: string;
  reportLevel: string;
  summary: string;
  workDone?: string | null;
  problems?: string | null;
  helpNeeded?: string | null;
  status: "draft" | "submitted" | "reviewed" | "flagged";
  employeeName?: string | null;
  siteName?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
};
type Handover = {
  id: string;
  workDate: string;
  siteName?: string | null;
  summary: string;
  urgentItems?: string | null;
  outstandingWork?: string | null;
  acknowledgedAt?: string | null;
  outgoingEmployeeName?: string | null;
  incomingEmployeeName?: string | null;
  canAcknowledge?: boolean;
};
type Site = { id: string; name: string; code: string };
type Overview = {
  workDate: string;
  scope: "organization" | "province" | "self";
  summary: {
    checklists: number;
    reports: number;
    handovers: number;
    alerts: number;
    tasks: number;
  };
  production: {
    poultry: { records: number; birds: number; mortality: number };
    pigs: { records: number; animals: number; mortality: number };
    agriculture: { operations: number; labourHours: string | number };
  };
  checklists: ChecklistRun[];
  reports: Report[];
  handovers: Handover[];
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate?: string | null;
  }>;
  alerts: Array<{
    id: string;
    title: string;
    severity: string;
    domain: string;
  }>;
};
const titleCase = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
const localToday = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};
const badge = (status: string) =>
  status === "verified" || status === "reviewed"
    ? ("good" as const)
    : status === "flagged" || status === "missed"
      ? ("serious" as const)
      : status === "completed"
        ? ("info" as const)
        : ("warning" as const);

export function DailyWorkArea({ orgSlug }: { orgSlug: string }) {
  const { locale, t } = useLanguage();
  const user = useSessionUser();
  const queryClient = useQueryClient();
  const [workDate, setWorkDate] = useState(localToday);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<Report | null>(null);
  const [tab, setTab] = useState<"checklists" | "reports" | "handovers">(
    "checklists",
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [createRunOpen, setCreateRunOpen] = useState(false);
  const [createReportOpen, setCreateReportOpen] = useState(false);
  const [createHandoverOpen, setCreateHandoverOpen] = useState(false);
  const canRead = can(user, "daily_operations.read"),
    canCreate = can(user, "daily_operations.create"),
    canUpdate = can(user, "daily_operations.update"),
    canApprove = can(user, "daily_operations.approve");
  const copy =
    locale === "fr"
      ? {
          kicker: "Centre d’exécution",
          heading: "Travail quotidien",
          description:
            "Le point de contrôle de chaque équipe : contrôles, rapport de production, passation et actions à ne pas oublier.",
          date: "Date de travail",
          checks: "Checklists",
          reports: "Rapports",
          handovers: "Passations",
          todayChecks: "Contrôles du jour",
          pendingReports: "Rapports à vérifier",
          pendingHandovers: "Passations",
          alerts: "Alertes actives",
          poultry: "Volaille",
          pigs: "Porcs",
          agriculture: "Agriculture",
          birds: "oiseaux vivants",
          animals: "animaux en clôture",
          mortality: "mortalité",
          operations: "opérations terminées",
          labour: "heures de travail",
          start: "Démarrer une checklist",
          selectTemplate: "Checklist",
          selectSite: "Site",
          create: "Créer",
          runDetail: "Exécution de checklist",
          selectRun:
            "Sélectionnez une checklist pour exécuter et confirmer chaque contrôle.",
          complete: "Terminer la checklist",
          verify: "Vérifier",
          pass: "Conforme",
          fail: "Non conforme",
          comment: "Observation / action",
          submit: "Enregistrer la réponse",
          newReport: "Nouveau rapport",
          summary: "Résumé de la journée",
          workDone: "Travail réalisé",
          problems: "Problèmes",
          help: "Aide requise",
          fileReport: "Envoyer le rapport",
          review: "Valider",
          flag: "Signaler",
          newHandover: "Nouvelle passation",
          handoverSummary: "Résumé pour l’équipe suivante",
          urgent: "Éléments urgents",
          outstanding: "Travail restant",
          sendHandover: "Envoyer la passation",
          acknowledge: "Accuser réception",
          noData: "Aucun élément pour cette date.",
          failed: "L’action n’a pas pu être enregistrée.",
          taskQueue: "Actions dues",
          noTasks: "Aucune action en retard ou due aujourd’hui.",
        }
      : {
          kicker: "Execution centre",
          heading: "Daily work",
          description:
            "One control point for every team: checks, production reporting, handovers, and next actions.",
          date: "Work date",
          checks: "Checklists",
          reports: "Reports",
          handovers: "Handovers",
          todayChecks: "Today’s checks",
          pendingReports: "Reports to review",
          pendingHandovers: "Handovers",
          alerts: "Active alerts",
          poultry: "Poultry",
          pigs: "Pigs",
          agriculture: "Agriculture",
          birds: "live birds",
          animals: "animals closing",
          mortality: "mortality",
          operations: "completed operations",
          labour: "labour hours",
          start: "Start checklist",
          selectTemplate: "Checklist",
          selectSite: "Site",
          create: "Create",
          runDetail: "Checklist run",
          selectRun:
            "Select a checklist to work through and confirm each control.",
          complete: "Complete checklist",
          verify: "Verify",
          pass: "Pass",
          fail: "Fail",
          comment: "Observation / action",
          submit: "Save response",
          newReport: "New report",
          summary: "Day summary",
          workDone: "Work completed",
          problems: "Problems",
          help: "Help needed",
          fileReport: "File report",
          review: "Review",
          flag: "Flag",
          newHandover: "New handover",
          handoverSummary: "Summary for next team",
          urgent: "Urgent items",
          outstanding: "Outstanding work",
          sendHandover: "Send handover",
          acknowledge: "Acknowledge",
          noData: "Nothing is recorded for this date.",
          failed: "The action could not be saved.",
          taskQueue: "Due actions",
          noTasks: "No overdue or due-today actions.",
        };
  const overview = useQuery({
    queryKey: ["daily-work-overview", orgSlug, workDate],
    queryFn: () =>
      dailyWorkApi
        .overview<{ overview: Overview }>(orgSlug, { workDate })
        .then((data) => data.overview),
    enabled: canRead,
  });
  const templates = useQuery({
    queryKey: ["daily-work-templates", orgSlug],
    queryFn: () =>
      dailyWorkApi.templates
        .list<{ templates: ChecklistTemplate[] }>(orgSlug, { limit: 200 })
        .then((data) => data.templates),
    enabled: canRead,
  });
  const runs = useQuery({
    queryKey: ["daily-work-runs", orgSlug, workDate],
    queryFn: () =>
      dailyWorkApi.runs
        .list<{ runs: ChecklistRun[] }>(orgSlug, { workDate, limit: 100 })
        .then((data) => data.runs),
    enabled: canRead,
  });
  const reports = useQuery({
    queryKey: ["daily-work-reports", orgSlug, workDate],
    queryFn: () =>
      dailyWorkApi.reports
        .list<{ reports: Report[] }>(orgSlug, { workDate, limit: 100 })
        .then((data) => data.reports),
    enabled: canRead,
  });
  const handovers = useQuery({
    queryKey: ["daily-work-handovers", orgSlug, workDate],
    queryFn: () =>
      dailyWorkApi.handovers
        .list<{ handovers: Handover[] }>(orgSlug, { workDate, limit: 100 })
        .then((data) => data.handovers),
    enabled: canRead,
  });
  const sites = useQuery({
    queryKey: ["daily-work-sites", orgSlug],
    queryFn: () =>
      get<{ sites: Site[] }>(orgUrl(orgSlug, "sites")).then((data) =>
        Array.isArray(data.sites) ? data.sites : [],
      ),
    enabled: canCreate && can(user, "sites.read"),
  });
  const detail = useQuery({
    queryKey: ["daily-work-run", orgSlug, selectedRunId],
    queryFn: () =>
      dailyWorkApi.runs
        .get<{ run: ChecklistRun }>(orgSlug, selectedRunId!)
        .then((data) => data.run),
    enabled: Boolean(selectedRunId) && canRead,
  });
  const employeeScope = overview.data?.scope === "self";
  const canManageTemplates =
    canCreate && Boolean(overview.data) && !employeeScope;
  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: ["daily-work-overview", orgSlug],
    });
    queryClient.invalidateQueries({ queryKey: ["daily-work-runs", orgSlug] });
    queryClient.invalidateQueries({
      queryKey: ["daily-work-reports", orgSlug],
    });
    queryClient.invalidateQueries({
      queryKey: ["daily-work-handovers", orgSlug],
    });
    if (selectedRunId)
      queryClient.invalidateQueries({
        queryKey: ["daily-work-run", orgSlug, selectedRunId],
      });
  };
  const createRun = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      dailyWorkApi.runs.create<{ run: ChecklistRun }>(orgSlug, body),
    onSuccess: (data) => {
      setCreateRunOpen(false);
      setSelectedRunId(data.run.id);
      refresh();
    },
  });
  const createTemplate = useMutation({
    mutationFn: async (body: {
      code: string;
      name: string;
      domain: string;
      siteId: string;
      prompt: string;
      responseType: string;
    }) => {
      const result = await dailyWorkApi.templates.create<{
        template: ChecklistTemplate;
      }>(orgSlug, {
        code: body.code,
        name: body.name,
        domain: body.domain,
        siteId: body.siteId,
        frequency: "daily",
      });
      await dailyWorkApi.templates.items.create(orgSlug, result.template.id, {
        position: 1,
        prompt: body.prompt,
        responseType: body.responseType,
        isRequired: true,
      });
      return result;
    },
    onSuccess: () => {
      setTemplateOpen(false);
      queryClient.invalidateQueries({
        queryKey: ["daily-work-templates", orgSlug],
      });
    },
  });
  const response = useMutation({
    mutationFn: ({
      itemId,
      body,
    }: {
      itemId: string;
      body: Record<string, unknown>;
    }) =>
      dailyWorkApi.runs.answerItem<{ run: ChecklistRun }>(
        orgSlug,
        selectedRunId!,
        itemId,
        body,
      ),
    onSuccess: refresh,
  });
  const complete = useMutation({
    mutationFn: () =>
      dailyWorkApi.runs.complete<{ run: ChecklistRun }>(
        orgSlug,
        selectedRunId!,
      ),
    onSuccess: refresh,
  });
  const verify = useMutation({
    mutationFn: () =>
      dailyWorkApi.runs.verify<{ run: ChecklistRun }>(orgSlug, selectedRunId!),
    onSuccess: refresh,
  });
  const createReport = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      dailyWorkApi.reports.create<{ report: Report }>(orgSlug, body),
    onSuccess: () => {
      setCreateReportOpen(false);
      refresh();
    },
  });
  const updateReport = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      dailyWorkApi.reports.update<{ report: Report }>(orgSlug, id, body),
    onSuccess: () => {
      setEditingReport(null);
      refresh();
    },
  });
  const review = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: "reviewed" | "flagged";
    }) =>
      dailyWorkApi.reports.review<{ report: Report }>(orgSlug, id, { status }),
    onSuccess: refresh,
  });
  const createHandover = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      dailyWorkApi.handovers.create<{ handover: Handover }>(orgSlug, body),
    onSuccess: () => {
      setCreateHandoverOpen(false);
      refresh();
    },
  });
  const acknowledge = useMutation({
    mutationFn: (id: string) =>
      dailyWorkApi.handovers.acknowledge<{ handover: Handover }>(orgSlug, id),
    onSuccess: refresh,
  });
  const error = [
    createRun.error,
    response.error,
    complete.error,
    verify.error,
    createReport.error,
    updateReport.error,
    review.error,
    createHandover.error,
    acknowledge.error,
  ].find(Boolean);
  const message =
    error instanceof ApiError ? error.message : error ? copy.failed : null;
  const selected =
    detail.data ?? runs.data?.find((run) => run.id === selectedRunId) ?? null;
  const overallLoading =
    overview.isPending ||
    runs.isPending ||
    reports.isPending ||
    handovers.isPending;
  function submitRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const siteId = data.get("siteId");
    createRun.mutate({
      templateId: String(data.get("templateId")),
      siteId: siteId ? String(siteId) : undefined,
      workDate,
    });
  }
  function submitTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    createTemplate.mutate({
      code: String(data.get("code")),
      name: String(data.get("name")),
      domain: String(data.get("domain")),
      siteId: String(data.get("siteId")),
      prompt: String(data.get("prompt")),
      responseType: String(data.get("responseType")),
    });
  }
  function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    createReport.mutate({
      workDate,
      reportLevel: "supervisor",
      summary: String(data.get("summary")),
      workDone: String(data.get("workDone")) || null,
      problems: String(data.get("problems")) || null,
      helpNeeded: String(data.get("helpNeeded")) || null,
    });
  }
  function submitEditReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingReport) return;
    const data = new FormData(event.currentTarget);
    updateReport.mutate({
      id: editingReport.id,
      body: {
        summary: String(data.get("summary")),
        workDone: String(data.get("workDone")) || null,
        problems: String(data.get("problems")) || null,
        helpNeeded: String(data.get("helpNeeded")) || null,
      },
    });
  }
  function submitHandover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const siteId = data.get("siteId");
    createHandover.mutate({
      workDate,
      siteId: siteId ? String(siteId) : undefined,
      summary: String(data.get("summary")),
      urgentItems: String(data.get("urgent")) || null,
      outstandingWork: String(data.get("outstanding")) || null,
    });
  }
  if (!canRead)
    return (
      <main className="grid min-h-[60dvh] place-items-center p-6">
        <div className="max-w-md text-center">
          <ClipboardCheck className="mx-auto size-9 text-ink-muted" />
          <h1 className="mt-3 text-lg font-semibold text-ink">
            {copy.heading}
          </h1>
          <p className="mt-2 text-sm text-ink-secondary">No access.</p>
        </div>
      </main>
    );
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <section className="overflow-hidden rounded-3xl border border-white/15 bg-[radial-gradient(circle_at_86%_10%,rgba(250,204,21,.25),transparent_25%),radial-gradient(circle_at_12%_100%,rgba(45,212,191,.18),transparent_30%),linear-gradient(125deg,#152b4b_0%,#155b76_58%,#198176_100%)] px-5 py-7 text-white shadow-[0_20px_50px_-26px_rgba(8,47,73,.8)] sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-teal-100">
              {copy.kicker}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-.03em]">
              {copy.heading}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-teal-50/90">
              {copy.description}
            </p>
          </div>
          <Field
            label={copy.date}
            htmlFor="daily-work-date"
            className="w-44 text-teal-50"
          >
            <Input
              id="daily-work-date"
              type="date"
              min={localToday()}
              value={workDate}
              onChange={(event) => {
                setWorkDate(event.target.value);
                setSelectedRunId(null);
              }}
              className="border-white/25 bg-white/10 text-white [color-scheme:dark]"
            />
          </Field>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Hero
            label={copy.todayChecks}
            value={overview.data?.summary.checklists ?? 0}
          />
          <Hero
            label={copy.pendingReports}
            value={overview.data?.summary.reports ?? 0}
          />
          <Hero
            label={copy.pendingHandovers}
            value={overview.data?.summary.handovers ?? 0}
          />
          <Hero
            label={copy.alerts}
            value={overview.data?.summary.alerts ?? 0}
            warning
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
      <section className="grid gap-3 sm:grid-cols-3">
        <Production
          label={copy.poultry}
          main={overview.data?.production.poultry.birds ?? 0}
          unit={copy.birds}
          meta={`${overview.data?.production.poultry.mortality ?? 0} ${copy.mortality}`}
        />
        <Production
          label={copy.pigs}
          main={overview.data?.production.pigs.animals ?? 0}
          unit={copy.animals}
          meta={`${overview.data?.production.pigs.mortality ?? 0} ${copy.mortality}`}
        />
        <Production
          label={copy.agriculture}
          main={overview.data?.production.agriculture.operations ?? 0}
          unit={copy.operations}
          meta={`${overview.data?.production.agriculture.labourHours ?? 0} ${copy.labour}`}
        />
      </section>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,.85fr)]">
        <div className="overflow-hidden rounded-2xl border border-border-strong/80 bg-surface-1 shadow-[0_16px_38px_-30px_rgba(15,23,42,.45)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-[linear-gradient(115deg,rgba(20,184,166,.07),transparent_42%)] px-5 py-4">
            <div className="flex gap-1">
              {(["checklists", "reports", "handovers"] as const).map((name) => (
                <button
                  type="button"
                  key={name}
                  onClick={() => setTab(name)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${tab === name ? "bg-brand text-white shadow-sm" : "text-ink-secondary hover:bg-surface-2 hover:text-ink"}`}
                >
                  {name === "checklists"
                    ? copy.checks
                    : name === "reports"
                      ? copy.reports
                      : copy.handovers}
                </button>
              ))}
            </div>
            {canCreate ? (
              <div className="flex gap-2">
                {tab === "checklists" && canManageTemplates ? (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setTemplateOpen(true)}
                    >
                      {locale === "fr" ? "Checklist" : "Checklist"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setTemplateManagerOpen(true)}
                    >
                      {locale === "fr" ? "Gérer" : "Manage"}
                    </Button>
                  </>
                ) : null}
                <Button
                  size="sm"
                  onClick={() =>
                    tab === "checklists"
                      ? setCreateRunOpen(true)
                      : tab === "reports"
                        ? setCreateReportOpen(true)
                        : setCreateHandoverOpen(true)
                  }
                >
                  <Plus />
                  {tab === "checklists"
                    ? copy.start
                    : tab === "reports"
                      ? copy.newReport
                      : copy.newHandover}
                </Button>
              </div>
            ) : null}
          </div>
          {tab === "checklists" ? (
            <RunList
              items={runs.data ?? []}
              loading={runs.isPending}
              selectedId={selectedRunId}
              onSelect={setSelectedRunId}
              empty={copy.noData}
            />
          ) : tab === "reports" ? (
            <Reports
              items={reports.data ?? []}
              loading={reports.isPending}
              copy={copy}
              canApprove={canApprove}
              canUpdate={canUpdate}
              onEdit={setEditingReport}
              onReview={(id, status) => review.mutate({ id, status })}
              working={review.isPending}
            />
          ) : (
            <Handovers
              items={handovers.data ?? []}
              loading={handovers.isPending}
              copy={copy}
              canUpdate={canUpdate}
              onAck={(id) => acknowledge.mutate(id)}
              working={acknowledge.isPending}
            />
          )}
        </div>
        {tab === "checklists" ? (
          <RunDetail
            run={selected}
            loading={detail.isPending}
            copy={copy}
            canUpdate={canUpdate}
            canApprove={canApprove}
            onResponse={(item, body) =>
              response.mutate({ itemId: item.id, body })
            }
            onComplete={() => complete.mutate()}
            onVerify={() => verify.mutate()}
            working={
              response.isPending || complete.isPending || verify.isPending
            }
          />
        ) : (
          <Aside
            overview={overview.data}
            copy={copy}
            loading={overallLoading}
          />
        )}
      </section>
      {templateManagerOpen ? (
        <DailyWorkTemplateManager
          orgSlug={orgSlug}
          onClose={() => setTemplateManagerOpen(false)}
        />
      ) : null}
      {templateOpen ? (
        <Panel
          title={locale === "fr" ? "Créer une checklist" : "Create checklist"}
          close={() => setTemplateOpen(false)}
        >
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitTemplate}>
            <Field label="Code" htmlFor="template-code" required>
              <Input
                name="code"
                required
                pattern="[a-z][a-z0-9_]{1,62}"
                placeholder="poultry_morning_check"
              />
            </Field>
            <Field label={copy.selectSite} htmlFor="template-site" required>
              <select
                id="template-site"
                name="siteId"
                required
                className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm"
              >
                {sites.data?.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={locale === "fr" ? "Nom de la checklist" : "Checklist name"}
              htmlFor="template-name"
              required
            >
              <Input name="name" required placeholder="Poultry morning check" />
            </Field>
            <Field label="Domaine" htmlFor="template-domain">
              <select
                id="template-domain"
                name="domain"
                defaultValue="general"
                className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm"
              >
                {[
                  "general",
                  "poultry",
                  "pigs",
                  "agriculture",
                  "biosecurity",
                  "safety",
                  "maintenance",
                  "hygiene",
                  "inventory",
                ].map((domain) => (
                  <option key={domain} value={domain}>
                    {titleCase(domain)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={locale === "fr" ? "Premier contrôle" : "First check"}
              htmlFor="template-prompt"
              required
              className="sm:col-span-2"
            >
              <Input
                name="prompt"
                required
                placeholder="Water is available and clean"
              />
            </Field>
            <Field
              label={locale === "fr" ? "Type de réponse" : "Answer type"}
              htmlFor="template-response"
            >
              <select
                id="template-response"
                name="responseType"
                defaultValue="boolean"
                className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm"
              >
                <option value="boolean">Yes / No</option>
                <option value="number">Number</option>
                <option value="text">Text</option>
              </select>
            </Field>
            <Button type="submit" loading={createTemplate.isPending}>
              <Plus />
              {copy.create}
            </Button>
          </form>
        </Panel>
      ) : null}
      {createRunOpen ? (
        <Panel title={copy.start} close={() => setCreateRunOpen(false)}>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitRun}>
            <Field label={copy.selectTemplate} htmlFor="run-template" required>
              <select
                id="run-template"
                name="templateId"
                required
                className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm"
              >
                {templates.data?.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} · {titleCase(template.domain)}
                  </option>
                ))}
              </select>
            </Field>
            {employeeScope ? (
              <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-ink-secondary">
                {locale === "fr"
                  ? "Cette checklist sera enregistrée pour votre site de travail affecté."
                  : "This checklist will be recorded for your assigned work site."}
              </div>
            ) : (
              <Field label={copy.selectSite} htmlFor="run-site" required>
                <select
                  id="run-site"
                  name="siteId"
                  required
                  className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm"
                >
                  {sites.data?.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Button type="submit" loading={createRun.isPending}>
              <ClipboardCheck />
              {copy.create}
            </Button>
          </form>
        </Panel>
      ) : null}
      {createReportOpen ? (
        <Panel title={copy.newReport} close={() => setCreateReportOpen(false)}>
          <form className="grid gap-4" onSubmit={submitReport}>
            <Field label={copy.summary} htmlFor="report-summary" required>
              <Textarea name="summary" required maxLength={4000} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={copy.workDone} htmlFor="report-work">
                <Textarea name="workDone" maxLength={8000} />
              </Field>
              <Field label={copy.problems} htmlFor="report-problems">
                <Textarea name="problems" maxLength={8000} />
              </Field>
              <Field label={copy.help} htmlFor="report-help">
                <Textarea name="helpNeeded" maxLength={8000} />
              </Field>
            </div>
            <Button type="submit" loading={createReport.isPending}>
              <Send />
              {copy.fileReport}
            </Button>
          </form>
        </Panel>
      ) : null}
      {editingReport ? (
        <Panel
          title={locale === "fr" ? "Modifier le rapport" : "Edit daily report"}
          close={() => setEditingReport(null)}
        >
          <form className="grid gap-4" onSubmit={submitEditReport}>
            <Field label={copy.summary} htmlFor="edit-report-summary" required>
              <Textarea
                name="summary"
                required
                maxLength={4000}
                defaultValue={editingReport.summary}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={copy.workDone} htmlFor="edit-report-work">
                <Textarea
                  name="workDone"
                  maxLength={8000}
                  defaultValue={editingReport.workDone ?? ""}
                />
              </Field>
              <Field label={copy.problems} htmlFor="edit-report-problems">
                <Textarea
                  name="problems"
                  maxLength={8000}
                  defaultValue={editingReport.problems ?? ""}
                />
              </Field>
              <Field label={copy.help} htmlFor="edit-report-help">
                <Textarea
                  name="helpNeeded"
                  maxLength={8000}
                  defaultValue={editingReport.helpNeeded ?? ""}
                />
              </Field>
            </div>
            <Button type="submit" loading={updateReport.isPending}>
              <Check />
              {locale === "fr" ? "Enregistrer" : "Save changes"}
            </Button>
          </form>
        </Panel>
      ) : null}
      {createHandoverOpen ? (
        <Panel
          title={copy.newHandover}
          close={() => setCreateHandoverOpen(false)}
        >
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitHandover}>
            {employeeScope ? (
              <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-ink-secondary">
                {locale === "fr"
                  ? "La passation sera enregistrée pour votre site de travail affecté."
                  : "The handover will be recorded for your assigned work site."}
              </div>
            ) : (
              <Field label={copy.selectSite} htmlFor="handover-site" required>
                <select
                  id="handover-site"
                  name="siteId"
                  required
                  className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm"
                >
                  {sites.data?.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field
              label={copy.handoverSummary}
              htmlFor="handover-summary"
              required
              className="sm:col-span-2"
            >
              <Textarea name="summary" required maxLength={4000} />
            </Field>
            <Field label={copy.urgent} htmlFor="handover-urgent">
              <Textarea name="urgent" maxLength={8000} />
            </Field>
            <Field label={copy.outstanding} htmlFor="handover-outstanding">
              <Textarea name="outstanding" maxLength={8000} />
            </Field>
            <Button type="submit" loading={createHandover.isPending}>
              <Handshake />
              {copy.sendHandover}
            </Button>
          </form>
        </Panel>
      ) : null}
    </main>
  );
}
function Hero({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: number;
  warning?: boolean;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border px-4 py-3.5 shadow-lg shadow-black/10 backdrop-blur-sm transition-transform duration-200 hover:-translate-y-0.5 ${warning ? "border-warning/45 bg-warning/18" : "border-white/18 bg-white/11"}`}
    >
      <div
        className={`absolute inset-x-0 top-0 h-px ${warning ? "bg-warning" : "bg-teal-200/75"}`}
      />
      <div className="relative flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-teal-50/85">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-[-.03em] text-white">
            {value}
          </p>
        </div>
        <span
          className={`mb-1 size-2 rounded-full ${warning ? "bg-warning shadow-[0_0_0_5px_rgba(250,204,21,.14)]" : "bg-teal-200 shadow-[0_0_0_5px_rgba(153,246,228,.12)]"}`}
          aria-hidden
        />
      </div>
    </div>
  );
}
function Production({
  label,
  main,
  unit,
  meta,
}: {
  label: string;
  main: number | string;
  unit: string;
  meta: string;
}) {
  const key = label.toLowerCase();
  const tone = key.includes("agri")
    ? "border-emerald-500/30 from-emerald-500/15 via-transparent to-transparent text-emerald-700 dark:text-emerald-300"
    : key.includes("porc") || key.includes("pig")
      ? "border-amber-500/30 from-amber-500/15 via-transparent to-transparent text-amber-700 dark:text-amber-300"
      : "border-sky-500/30 from-sky-500/15 via-transparent to-transparent text-sky-700 dark:text-sky-300";
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-[0_12px_30px_-24px_rgba(15,23,42,.48)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_35px_-24px_rgba(15,23,42,.55)] ${tone}`}
    >
      <div className="absolute right-4 top-4 size-10 rounded-full border border-current/15 bg-current/5" />
      <div className="relative">
        <p className="text-sm font-semibold text-ink">{label}</p>
        <div className="mt-4 flex items-end gap-2">
          <p className="text-3xl font-semibold tabular-nums tracking-[-.04em] text-ink">
            {main}
          </p>
          <span className="mb-1 text-xs font-medium text-ink-secondary">{unit}</span>
        </div>
        <p className="mt-4 border-t border-border/80 pt-3 text-xs font-medium text-ink-muted">{meta}</p>
      </div>
    </div>
  );
}
function RunList({
  items,
  loading,
  selectedId,
  onSelect,
  empty,
}: {
  items: ChecklistRun[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  empty: string;
}) {
  if (loading)
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  if (!items.length) return <Empty text={empty} />;
  return (
    <div className="divide-y divide-border/90">
      {items.map((run) => (
        <button
          type="button"
          key={run.id}
          onClick={() => onSelect(run.id)}
          className={`group relative flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors ${run.id === selectedId ? "bg-brand-subtle shadow-[inset_3px_0_0_var(--brand)]" : "hover:bg-surface-2/80"}`}
        >
          <div>
            <p className="text-sm font-semibold text-ink">
              {run.templateName ?? "Checklist"}
            </p>
            <p className="mt-1 text-xs text-ink-secondary">
              {run.siteName ?? "—"} · {run.itemsCompleted}/{run.itemsTotal}
            </p>
          </div>
          <Badge variant={badge(run.status)}>{titleCase(run.status)}</Badge>
        </button>
      ))}
    </div>
  );
}
function RunDetail({
  run,
  loading,
  copy,
  canUpdate,
  canApprove,
  onResponse,
  onComplete,
  onVerify,
  working,
}: {
  run: ChecklistRun | null;
  loading: boolean;
  copy: {
    runDetail: string;
    selectRun: string;
    complete: string;
    verify: string;
    pass: string;
    fail: string;
    comment: string;
    submit: string;
  };
  canUpdate: boolean;
  canApprove: boolean;
  onResponse: (item: ChecklistItem, body: Record<string, unknown>) => void;
  onComplete: () => void;
  onVerify: () => void;
  working: boolean;
}) {
  const { locale } = useLanguage();
  const signedLabel = locale === "fr" ? "Terminé et signé" : "Completed and signed";
  const verifiedLabel = locale === "fr" ? "Vérifié par un responsable" : "Verified by a supervisor";
  if (loading)
    return (
      <aside className="rounded-2xl border border-border-strong/80 bg-surface-1 p-5 shadow-[0_10px_30px_-24px_rgba(15,23,42,.45)]">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="mt-4 h-40" />
      </aside>
    );
  if (!run)
    return (
      <aside className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-brand/35 bg-[radial-gradient(circle_at_50%_0%,rgba(20,184,166,.09),transparent_45%)] p-8 text-center">
        <div>
          <ClipboardCheck className="mx-auto size-8 text-ink-muted" />
          <h2 className="mt-3 text-sm font-semibold text-ink">
            {copy.runDetail}
          </h2>
          <p className="mt-1 max-w-xs text-sm leading-6 text-ink-secondary">
            {copy.selectRun}
          </p>
        </div>
      </aside>
    );
  return (
    <aside className="h-fit overflow-hidden rounded-2xl border border-border-strong/80 bg-surface-1 shadow-[0_14px_34px_-28px_rgba(15,23,42,.48)]">
      <div className="border-b border-border bg-[linear-gradient(115deg,rgba(20,184,166,.07),transparent_52%)] p-5">
        <Badge variant={badge(run.status)}>{titleCase(run.status)}</Badge>
        <h2 className="mt-3 text-lg font-semibold text-ink">
          {run.templateName}
        </h2>
        <p className="mt-1 text-xs text-ink-secondary">
          {run.itemsCompleted}/{run.itemsTotal} · {run.itemsFailed} failed
        </p>
        {run.completedAt ? (
          <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-ink-secondary">
            <p className="font-semibold text-emerald-800 dark:text-emerald-300">
              {signedLabel}
            </p>
            <p className="mt-1">
              {run.completedByName ?? "—"} · {formatInstant(run.completedAt)}
            </p>
            {run.verifiedAt ? (
              <p className="mt-1">
                {verifiedLabel} · {run.verifiedByName ?? "—"} · {formatInstant(run.verifiedAt)}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="divide-y divide-border/90">
        {run.items?.map((item) => (
          <ChecklistAnswer
            key={item.id}
            item={item}
            copy={copy}
            canUpdate={canUpdate && run.status === "in_progress"}
            working={working}
            onSave={onResponse}
          />
        ))}
      </div>
      {run.status === "in_progress" && canUpdate ? (
        <div className="border-t border-border p-4">
          <Button className="w-full" onClick={onComplete} loading={working}>
            <CheckCircle2 />
            {copy.complete}
          </Button>
        </div>
      ) : null}
      {run.status === "completed" && canApprove ? (
        <div className="border-t border-border p-4">
          <Button className="w-full" onClick={onVerify} loading={working}>
            <Check />
            {copy.verify}
          </Button>
        </div>
      ) : null}
    </aside>
  );
}
function ChecklistAnswer({
  item,
  copy,
  canUpdate,
  working,
  onSave,
}: {
  item: ChecklistItem;
  copy: { pass: string; fail: string; comment: string; submit: string };
  canUpdate: boolean;
  working: boolean;
  onSave: (item: ChecklistItem, body: Record<string, unknown>) => void;
}) {
  const [value, setValue] = useState(
    item.booleanValue ?? item.numberValue ?? item.textValue ?? "",
  );
  const [passed, setPassed] = useState(item.passed ?? true);
  const [comment, setComment] = useState(item.comment ?? "");
  const save = () => {
    const body: Record<string, unknown> = { passed, comment: comment || null };
    if (item.responseType === "boolean")
      body.booleanValue = value === true || value === "true";
    else if (item.responseType === "number") body.numberValue = Number(value);
    else body.textValue = String(value);
    onSave(item, body);
  };
  return (
    <div className="space-y-3 p-4 transition-colors hover:bg-surface-2/45">
      <div className="flex gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-full border border-brand/20 bg-brand-subtle text-xs font-bold text-brand">
          {item.position}
        </span>
        <div>
          <p className="text-sm font-medium text-ink">{item.prompt}</p>
          {item.unit ? (
            <p className="mt-0.5 text-xs text-ink-muted">{item.unit}</p>
          ) : null}
        </div>
      </div>
      {canUpdate ? (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <ResponseInput item={item} value={value} setValue={setValue} />
          <select
            value={String(passed)}
            onChange={(event) => setPassed(event.target.value === "true")}
            className="h-9 rounded-md border border-border-strong bg-surface-1 px-2 text-sm"
          >
            <option value="true">{copy.pass}</option>
            <option value="false">{copy.fail}</option>
          </select>
          <Input
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={copy.comment}
            className="sm:col-span-2"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={save}
            loading={working}
          >
            <Check />
            {copy.submit}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <Badge variant={item.passed === false ? "serious" : "good"}>
            {item.passed === false ? copy.fail : copy.pass}
          </Badge>
          {item.alertId ? <Siren className="size-4 text-critical" /> : null}
        </div>
      )}
    </div>
  );
}
function ResponseInput({
  item,
  value,
  setValue,
}: {
  item: ChecklistItem;
  value: string | number | boolean;
  setValue: (value: string | number | boolean) => void;
}) {
  if (item.responseType === "boolean")
    return (
      <select
        value={String(value)}
        onChange={(event) => setValue(event.target.value)}
        className="h-9 rounded-md border border-border-strong bg-surface-1 px-2 text-sm"
      >
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  if (item.responseType === "number")
    return (
      <Input
        type="number"
        value={String(value)}
        onChange={(event) => setValue(event.target.value)}
      />
    );
  return (
    <Input
      value={String(value)}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}
function Reports({
  items,
  loading,
  copy,
  canApprove,
  canUpdate,
  onEdit,
  onReview,
  working,
}: {
  items: Report[];
  loading: boolean;
  copy: { noData: string; review: string; flag: string };
  canApprove: boolean;
  canUpdate: boolean;
  onEdit: (report: Report) => void;
  onReview: (id: string, status: "reviewed" | "flagged") => void;
  working: boolean;
}) {
  const { locale } = useLanguage();
  const signedLabel = locale === "fr" ? "Terminé et signé" : "Completed and signed";
  const verifiedLabel = locale === "fr" ? "Vérifié par un responsable" : "Verified by a supervisor";
  if (loading)
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  if (!items.length) return <Empty text={copy.noData} />;
  return (
    <div className="divide-y divide-border/90">
      {items.map((report) => (
        <div key={report.id} className="px-5 py-4 transition-colors hover:bg-surface-2/65">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">{report.summary}</p>
              <p className="mt-1 text-xs text-ink-secondary">
                {titleCase(report.reportLevel)} · {report.siteName ?? "—"}
              </p>
            </div>
            <Badge variant={badge(report.status)}>
              {titleCase(report.status)}
            </Badge>
          </div>
          {report.problems ? (
            <p className="mt-3 text-sm text-ink-secondary">{report.problems}</p>
          ) : null}
          {canUpdate && ["draft", "submitted"].includes(report.status) ? (
            <Button
              className="mt-3"
              size="sm"
              variant="ghost"
              onClick={() => onEdit(report)}
            >
              <Pencil />
              Edit
            </Button>
          ) : null}
          {report.status === "submitted" && canApprove ? (
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                onClick={() => onReview(report.id, "reviewed")}
                loading={working}
              >
                <Check />
                {copy.review}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onReview(report.id, "flagged")}
                loading={working}
              >
                <Siren />
                {copy.flag}
              </Button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
function Handovers({
  items,
  loading,
  copy,
  canUpdate,
  onAck,
  working,
}: {
  items: Handover[];
  loading: boolean;
  copy: { noData: string; acknowledge: string };
  canUpdate: boolean;
  onAck: (id: string) => void;
  working: boolean;
}) {
  const { locale } = useLanguage();
  const signedLabel = locale === "fr" ? "Terminé et signé" : "Completed and signed";
  const verifiedLabel = locale === "fr" ? "Vérifié par un responsable" : "Verified by a supervisor";
  if (loading)
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  if (!items.length) return <Empty text={copy.noData} />;
  return (
    <div className="divide-y divide-border/90">
      {items.map((handover) => (
        <div key={handover.id} className="px-5 py-4 transition-colors hover:bg-surface-2/65">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">
                {handover.summary}
              </p>
              <p className="mt-1 text-xs text-ink-secondary">
                {handover.siteName ?? "—"} ·{" "}
                {handover.incomingEmployeeName ?? "Next team"}
              </p>
            </div>
            <Badge variant={handover.acknowledgedAt ? "good" : "warning"}>
              {handover.acknowledgedAt ? "Acknowledged" : "Pending"}
            </Badge>
          </div>
          {handover.urgentItems ? (
            <p className="mt-3 text-sm text-critical">{handover.urgentItems}</p>
          ) : null}
          {!handover.acknowledgedAt && canUpdate && handover.canAcknowledge !== false ? (
            <Button
              className="mt-3"
              size="sm"
              onClick={() => onAck(handover.id)}
              loading={working}
            >
              <Handshake />
              {copy.acknowledge}
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
function Aside({
  overview,
  copy,
  loading,
}: {
  overview: Overview | undefined;
  copy: { taskQueue: string; noTasks: string };
  loading: boolean;
}) {
  return (
    <aside className="h-fit overflow-hidden rounded-2xl border border-border-strong/80 bg-surface-1 shadow-[0_14px_34px_-28px_rgba(15,23,42,.48)]">
      <div className="border-b border-border bg-[linear-gradient(115deg,rgba(20,184,166,.07),transparent_52%)] p-5">
        <h2 className="text-sm font-semibold text-ink">{copy.taskQueue}</h2>
      </div>
      {loading ? (
        <div className="p-5">
          <Skeleton className="h-32" />
        </div>
      ) : overview?.tasks.length ? (
        <div className="divide-y divide-border/90">
          {overview.tasks.map((task) => (
            <div key={task.id} className="border-l-2 border-transparent p-4 transition hover:border-brand hover:bg-brand-subtle/45">
              <p className="text-sm font-medium text-ink">{task.title}</p>
              <p className="mt-1 text-xs text-ink-secondary">
                {titleCase(task.priority)} · {task.dueDate ?? "—"}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <Empty text={copy.noTasks} />
      )}
    </aside>
  );
}
function Panel({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] overflow-y-auto bg-ink/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="mx-auto my-4 w-full max-w-2xl rounded-2xl border border-border-strong bg-surface-1 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border bg-surface-2/65 px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-lg font-semibold text-ink">{title}</h2>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={close}
            aria-label="Close"
          >
            <X />
          </Button>
        </header>
        <div className="p-5 sm:p-6">{children}</div>
      </section>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-b-2xl bg-[radial-gradient(circle_at_50%_0%,rgba(20,184,166,.06),transparent_45%)] p-10 text-center">
      <Clock3 className="mx-auto size-7 text-ink-muted" />
      <p className="mt-3 text-sm text-ink-secondary">{text}</p>
    </div>
  );
}
