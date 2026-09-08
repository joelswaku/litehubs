"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Plus,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { Badge, severityVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError, del, get, orgUrl, patch, post } from "@/lib/api";
import { can } from "@/lib/permissions";
import { formatInstant } from "@/lib/utils";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type Severity = "low" | "medium" | "high" | "critical";
type Status =
  "open" | "acknowledged" | "in_progress" | "resolved" | "dismissed";
type AlertItem = {
  id: string;
  reference: string;
  title: string;
  detail: string | null;
  domain: string;
  severity: Severity;
  status: Status;
  source: "job" | "manual" | "import" | "integration";
  province: { id: string; code: string | null; name: string | null } | null;
  site: { id: string; code: string | null; name: string | null } | null;
  assignedTo: { memberId: string; fullName: string | null } | null;
  dueAt: string | null;
  createdAt: string;
  resolutionNote: string | null;
};
type Province = { id: string; code: string; name: string };

function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function statusVariant(status: Status) {
  return status === "resolved"
    ? "good"
    : status === "dismissed"
      ? "neutral"
      : status === "in_progress"
        ? "info"
        : status === "acknowledged"
          ? "warning"
          : ("serious" as const);
}

export function AlertsArea({ orgSlug }: { orgSlug: string }) {
  const { locale, t } = useLanguage();
  const user = useSessionUser();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status | "">("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
  const canCreate = can(user, "alerts.create");
  const canUpdate = can(user, "alerts.update");
  const canDelete = can(user, "alerts.delete");
  const copy =
    locale === "fr"
      ? {
          kicker: "Centre de contrôle",
          heading: "Alertes opérationnelles",
          description:
            "Les risques, retards et écarts qui demandent une décision ou une action.",
          new: "Nouvelle alerte",
          scan: "Lancer les contrôles",
          open: "Ouvertes",
          active: "À traiter",
          critical: "Critiques",
          total: "Total affiché",
          filters: "Filtres",
          all: "Toutes",
          loading: "Chargement des alertes…",
          create: "Signaler une alerte",
          createDescription:
            "Utilisez cette action pour un problème constaté sur le terrain. Les alertes automatiques sont créées par les contrôles du système.",
          title: "Titre",
          details: "Détails",
          severity: "Gravité",
          domain: "Domaine",
          province: "Province",
          createAction: "Créer l’alerte",
          cancel: "Annuler",
          noAlerts: "Aucune alerte ne correspond à ces filtres.",
          detailsPanel: "Détail de l’alerte",
          select: "Sélectionnez une alerte pour voir ses détails et agir.",
          acknowledge: "Accuser réception",
          progress: "Démarrer le traitement",
          resolve: "Résoudre",
          dismiss: "Écarter",
          note: "Note de résolution",
          noteHint: "Expliquez la décision ou le travail réalisé.",
          delete: "Supprimer",
          created: "Créée",
          due: "Échéance",
          location: "Emplacement",
          source: "Source",
          status: "Statut",
          assigned: "Responsable",
          automatic: "Automatique",
          manual: "Manuelle",
          failed: "L’action n’a pas pu être effectuée.",
        }
      : {
          kicker: "Control centre",
          heading: "Operational alerts",
          description:
            "Risks, delays and exceptions that need a decision or action.",
          new: "New alert",
          scan: "Run checks",
          open: "Open",
          active: "Needs attention",
          critical: "Critical",
          total: "Shown total",
          filters: "Filters",
          all: "All",
          loading: "Loading alerts…",
          create: "Report an alert",
          createDescription:
            "Use this for a field issue you observed. Automatic alerts are created by system controls.",
          title: "Title",
          details: "Details",
          severity: "Severity",
          domain: "Domain",
          province: "Province",
          createAction: "Create alert",
          cancel: "Cancel",
          noAlerts: "No alerts match these filters.",
          detailsPanel: "Alert details",
          select: "Select an alert to see its details and take action.",
          acknowledge: "Acknowledge",
          progress: "Start work",
          resolve: "Resolve",
          dismiss: "Dismiss",
          note: "Resolution note",
          noteHint: "Explain the decision or work completed.",
          delete: "Delete",
          created: "Created",
          due: "Due",
          location: "Location",
          source: "Source",
          status: "Status",
          assigned: "Assigned to",
          automatic: "Automatic",
          manual: "Manual",
          failed: "The action could not be completed.",
        };
  const filter = new URLSearchParams();
  if (status) filter.set("status", status);
  if (severity) filter.set("severity", severity);
  const suffix = filter.toString() ? `?${filter}` : "";
  const alerts = useQuery({
    queryKey: ["alerts", orgSlug, status, severity],
    queryFn: () =>
      get<{ alerts: AlertItem[]; pagination: { total: number } }>(
        orgUrl(orgSlug, `alerts${suffix}`),
      ),
    enabled: can(user, "alerts.read"),
  });
  const provinces = useQuery({
    queryKey: ["provinces", orgSlug],
    queryFn: () => get<{ provinces: Province[] }>(orgUrl(orgSlug, "provinces")),
    select: (data) => data.provinces,
    enabled: canCreate,
  });
  const detail = useQuery({
    queryKey: ["alert", orgSlug, selectedId],
    queryFn: () =>
      get<{ alert: AlertItem }>(orgUrl(orgSlug, `alerts/${selectedId}`)),
    enabled: Boolean(selectedId) && can(user, "alerts.read"),
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["alerts", orgSlug] });
    if (selectedId)
      queryClient.invalidateQueries({
        queryKey: ["alert", orgSlug, selectedId],
      });
  };
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      post<{ alert: AlertItem }>(orgUrl(orgSlug, "alerts"), body),
    onSuccess: (result) => {
      setCreateOpen(false);
      setSelectedId(result.alert.id);
      refresh();
    },
  });
  const update = useMutation({
    mutationFn: (body: { alertId: string; status: Status }) =>
      patch<{ alert: AlertItem }>(orgUrl(orgSlug, `alerts/${body.alertId}`), {
        status: body.status,
      }),
    onSuccess: refresh,
  });
  const acknowledge = useMutation({
    mutationFn: (alertId: string) =>
      post<{ alert: AlertItem }>(
        orgUrl(orgSlug, `alerts/${alertId}/acknowledge`),
      ),
    onSuccess: refresh,
  });
  const resolve = useMutation({
    mutationFn: ({
      alertId,
      action,
    }: {
      alertId: string;
      action: "resolve" | "dismiss";
    }) =>
      post<{ alert: AlertItem }>(
        orgUrl(orgSlug, `alerts/${alertId}/${action}`),
        { resolutionNote },
      ),
    onSuccess: () => {
      setResolutionNote("");
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (alertId: string) =>
      del<void>(orgUrl(orgSlug, `alerts/${alertId}`)),
    onSuccess: () => {
      setSelectedId(null);
      refresh();
    },
  });
  const evaluate = useMutation({
    mutationFn: () =>
      post<{ evaluation: { activeSignals: number } }>(
        orgUrl(orgSlug, "alerts/evaluate"),
      ),
    onSuccess: refresh,
  });
  const actionError = [
    create.error,
    update.error,
    acknowledge.error,
    resolve.error,
    remove.error,
    evaluate.error,
  ].find(Boolean);
  const message =
    actionError instanceof ApiError
      ? actionError.message
      : actionError
        ? copy.failed
        : null;
  const items = alerts.data?.alerts ?? [];
  const selected =
    detail.data?.alert ?? items.find((item) => item.id === selectedId) ?? null;
  const openCount = items.filter((item) => item.status === "open").length;
  const activeCount = items.filter(
    (item) => !["resolved", "dismissed"].includes(item.status),
  ).length;
  const criticalCount = items.filter(
    (item) =>
      item.severity === "critical" &&
      !["resolved", "dismissed"].includes(item.status),
  ).length;

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const provinceId = String(form.get("provinceId") ?? "");
    create.mutate({
      title: String(form.get("title") ?? ""),
      detail: String(form.get("detail") ?? "") || null,
      severity: String(form.get("severity") ?? "medium"),
      domain: String(form.get("domain") ?? "general"),
      ...(provinceId ? { provinceId } : {}),
    });
  }

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <section className="overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_85%_10%,rgba(250,204,21,.28),transparent_25%),linear-gradient(125deg,#0b2748_0%,#0d4a83_55%,#276bb1_100%)] px-5 py-7 text-white sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-blue-100">
              {copy.kicker}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-.03em]">
              {t("nav.alerts")}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-50/90">
              {copy.description}
            </p>
          </div>
          {canCreate ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                onClick={() => evaluate.mutate()}
                loading={evaluate.isPending}
              >
                <ShieldAlert aria-hidden />
                {copy.scan}
              </Button>
              <Button
                className="bg-white text-brand hover:bg-blue-50"
                onClick={() => setCreateOpen((open) => !open)}
              >
                <Plus aria-hidden />
                {copy.new}
              </Button>
            </div>
          ) : null}
        </div>
        <div className="mt-6 grid max-w-3xl gap-3 sm:grid-cols-3">
          <HeroMetric label={copy.open} value={openCount} />
          <HeroMetric label={copy.active} value={activeCount} />
          <HeroMetric label={copy.critical} value={criticalCount} critical />
        </div>
      </section>
      {createOpen ? (
        <section className="rounded-2xl border border-brand/25 bg-surface-1 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-ink">
                {copy.create}
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-secondary">
                {copy.createDescription}
              </p>
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              aria-label={copy.cancel}
            >
              <X aria-hidden />
            </Button>
          </div>
          <form
            className="mt-5 grid gap-4 md:grid-cols-2"
            onSubmit={submitCreate}
          >
            <Field
              label={copy.title}
              htmlFor="alert-title"
              required
              className="md:col-span-2"
            >
              <Input name="title" required maxLength={240} autoFocus />
            </Field>
            <Field
              label={copy.details}
              htmlFor="alert-detail"
              className="md:col-span-2"
            >
              <Textarea name="detail" maxLength={8000} />
            </Field>
            <Field label={copy.severity} htmlFor="alert-severity">
              <select
                id="alert-severity"
                name="severity"
                defaultValue="medium"
                className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
              >
                <option value="low">{titleCase("low")}</option>
                <option value="medium">{titleCase("medium")}</option>
                <option value="high">{titleCase("high")}</option>
                <option value="critical">{titleCase("critical")}</option>
              </select>
            </Field>
            <Field label={copy.domain} htmlFor="alert-domain">
              <Input
                id="alert-domain"
                name="domain"
                defaultValue="general"
                pattern="[a-z][a-z0-9_]{1,62}"
              />
            </Field>
            <Field label={copy.province} htmlFor="alert-province">
              <select
                id="alert-province"
                name="provinceId"
                className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
              >
                <option value="">—</option>
                {provinces.data?.map((province) => (
                  <option value={province.id} key={province.id}>
                    {province.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-end gap-2">
              <Button type="submit" loading={create.isPending}>
                <ShieldAlert aria-hidden />
                {copy.createAction}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateOpen(false)}
              >
                {copy.cancel}
              </Button>
            </div>
          </form>
        </section>
      ) : null}
      {message ? (
        <p
          className="rounded-lg border border-critical/35 bg-critical/10 px-3 py-2 text-sm text-critical"
          role="alert"
        >
          {message}
        </p>
      ) : null}
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(310px,.8fr)]">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface-1">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-ink">{copy.heading}</h2>
              <p className="mt-0.5 text-xs text-ink-secondary">
                {alerts.data?.pagination.total ?? 0} {copy.total.toLowerCase()}
              </p>
            </div>
            <div className="flex gap-2">
              <select
                aria-label={`${copy.filters} ${copy.status}`}
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as Status | "");
                  setSelectedId(null);
                }}
                className="h-8 rounded-md border border-border bg-surface-1 px-2 text-xs text-ink"
              >
                <option value="">
                  {copy.all} {copy.status.toLowerCase()}
                </option>
                {[
                  "open",
                  "acknowledged",
                  "in_progress",
                  "resolved",
                  "dismissed",
                ].map((value) => (
                  <option value={value} key={value}>
                    {titleCase(value)}
                  </option>
                ))}
              </select>
              <select
                aria-label={`${copy.filters} ${copy.severity}`}
                value={severity}
                onChange={(event) => {
                  setSeverity(event.target.value as Severity | "");
                  setSelectedId(null);
                }}
                className="h-8 rounded-md border border-border bg-surface-1 px-2 text-xs text-ink"
              >
                <option value="">
                  {copy.all} {copy.severity.toLowerCase()}
                </option>
                {["low", "medium", "high", "critical"].map((value) => (
                  <option value={value} key={value}>
                    {titleCase(value)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {alerts.isPending ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : alerts.isError ? (
            <ErrorState
              description={copy.failed}
              onRetry={() => alerts.refetch()}
            />
          ) : items.length ? (
            <div className="divide-y divide-border">
              {items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => {
                    setSelectedId(item.id);
                    setResolutionNote(item.resolutionNote ?? "");
                  }}
                  className={`flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-2 ${selectedId === item.id ? "bg-brand-subtle" : ""}`}
                >
                  <div
                    className={`grid size-9 shrink-0 place-items-center rounded-full ${item.severity === "critical" ? "bg-critical/15 text-critical" : item.severity === "high" ? "bg-serious/15 text-serious" : "bg-brand-subtle text-brand"}`}
                  >
                    <AlertTriangle className="size-4" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-ink">
                        {item.title}
                      </p>
                      <Badge variant={severityVariant(item.severity)}>
                        {titleCase(item.severity)}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-ink-secondary">
                      {item.reference} ·{" "}
                      {item.site?.name ?? item.province?.name ?? item.domain}
                    </p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <Badge variant={statusVariant(item.status)}>
                      {titleCase(item.status)}
                    </Badge>
                    <p className="mt-1 text-xs text-ink-muted">
                      {formatInstant(item.dueAt ?? item.createdAt)}
                    </p>
                  </div>
                  <ChevronRight
                    className="size-4 shrink-0 text-ink-muted"
                    aria-hidden
                  />
                </button>
              ))}
            </div>
          ) : (
            <div className="p-10 text-center">
              <CircleAlert
                className="mx-auto size-7 text-ink-muted"
                aria-hidden
              />
              <p className="mt-3 text-sm text-ink-secondary">{copy.noAlerts}</p>
            </div>
          )}
        </div>
        <AlertDetails
          item={selected}
          pending={detail.isPending}
          copy={copy}
          canUpdate={canUpdate}
          canDelete={canDelete}
          resolutionNote={resolutionNote}
          setResolutionNote={setResolutionNote}
          onAcknowledge={() => selected && acknowledge.mutate(selected.id)}
          onProgress={() =>
            selected &&
            update.mutate({ alertId: selected.id, status: "in_progress" })
          }
          onResolve={() =>
            selected &&
            resolve.mutate({ alertId: selected.id, action: "resolve" })
          }
          onDismiss={() =>
            selected &&
            resolve.mutate({ alertId: selected.id, action: "dismiss" })
          }
          onDelete={() => selected && remove.mutate(selected.id)}
          working={
            acknowledge.isPending ||
            update.isPending ||
            resolve.isPending ||
            remove.isPending
          }
        />
      </section>
    </main>
  );
}

function HeroMetric({
  label,
  value,
  critical = false,
}: {
  label: string;
  value: number;
  critical?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 backdrop-blur ${critical ? "border-critical/35 bg-critical/15" : "border-white/15 bg-white/10"}`}
    >
      <p className="text-xs font-medium text-blue-100">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
        {value}
      </p>
    </div>
  );
}

function AlertDetails({
  item,
  pending,
  copy,
  canUpdate,
  canDelete,
  resolutionNote,
  setResolutionNote,
  onAcknowledge,
  onProgress,
  onResolve,
  onDismiss,
  onDelete,
  working,
}: {
  item: AlertItem | null;
  pending: boolean;
  copy: {
    detailsPanel: string;
    select: string;
    location: string;
    assigned: string;
    source: string;
    manual: string;
    automatic: string;
    created: string;
    due: string;
    note: string;
    noteHint: string;
    acknowledge: string;
    progress: string;
    resolve: string;
    dismiss: string;
    delete: string;
  };
  canUpdate: boolean;
  canDelete: boolean;
  resolutionNote: string;
  setResolutionNote: (value: string) => void;
  onAcknowledge: () => void;
  onProgress: () => void;
  onResolve: () => void;
  onDismiss: () => void;
  onDelete: () => void;
  working: boolean;
}) {
  if (pending)
    return (
      <aside className="rounded-2xl border border-border bg-surface-1 p-5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-5 h-28" />
      </aside>
    );
  if (!item)
    return (
      <aside className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-border-strong bg-surface-1 p-8 text-center">
        <div>
          <ShieldAlert className="mx-auto size-8 text-ink-muted" aria-hidden />
          <h2 className="mt-3 text-sm font-semibold text-ink">
            {copy.detailsPanel}
          </h2>
          <p className="mt-1 max-w-xs text-sm leading-6 text-ink-secondary">
            {copy.select}
          </p>
        </div>
      </aside>
    );
  const live = !["resolved", "dismissed"].includes(item.status);
  return (
    <aside className="h-fit rounded-2xl border border-border bg-surface-1">
      <div className="border-b border-border p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={severityVariant(item.severity)}>
            {titleCase(item.severity)}
          </Badge>
          <Badge variant={statusVariant(item.status)}>
            {titleCase(item.status)}
          </Badge>
        </div>
        <h2 className="mt-3 text-lg font-semibold tracking-tight text-ink">
          {item.title}
        </h2>
        <p className="mt-1 text-xs text-ink-muted">{item.reference}</p>
      </div>
      <div className="space-y-4 p-5">
        {item.detail ? (
          <p className="text-sm leading-6 text-ink-secondary">{item.detail}</p>
        ) : null}
        <dl className="grid gap-3 text-sm">
          <Detail
            label={copy.location}
            value={item.site?.name ?? item.province?.name ?? "—"}
          />
          <Detail
            label={copy.assigned}
            value={item.assignedTo?.fullName ?? "—"}
          />
          <Detail
            label={copy.source}
            value={item.source === "manual" ? copy.manual : copy.automatic}
          />
          <Detail label={copy.created} value={formatInstant(item.createdAt)} />
          <Detail label={copy.due} value={formatInstant(item.dueAt)} />
        </dl>
        {live && canUpdate ? (
          <>
            <Field
              label={copy.note}
              hint={copy.noteHint}
              htmlFor="alert-resolution"
            >
              <Textarea
                id="alert-resolution"
                value={resolutionNote}
                onChange={(event) => setResolutionNote(event.target.value)}
                maxLength={8000}
              />
            </Field>
            <div className="grid gap-2 sm:grid-cols-2">
              {item.status === "open" ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onAcknowledge}
                  loading={working}
                >
                  <Check aria-hidden />
                  {copy.acknowledge}
                </Button>
              ) : null}
              {item.status !== "in_progress" ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onProgress}
                  loading={working}
                >
                  <Clock3 aria-hidden />
                  {copy.progress}
                </Button>
              ) : null}
              <Button
                size="sm"
                onClick={onResolve}
                loading={working}
                disabled={!resolutionNote.trim()}
              >
                <Check aria-hidden />
                {copy.resolve}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onDismiss}
                loading={working}
                disabled={!resolutionNote.trim()}
              >
                {copy.dismiss}
              </Button>
            </div>
          </>
        ) : null}
        {item.source === "manual" && canDelete ? (
          <div className="border-t border-border pt-4">
            <Button
              size="sm"
              variant="destructive"
              onClick={onDelete}
              loading={working}
            >
              <Trash2 aria-hidden />
              {copy.delete}
            </Button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="max-w-[60%] text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
