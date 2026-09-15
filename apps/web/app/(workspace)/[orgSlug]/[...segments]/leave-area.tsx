"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  FilePlus2,
  HeartPulse,
  Palmtree,
  Plus,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HrPdfButton } from "@/components/hr/hr-pdf-button";
import { Field, Input, Textarea } from "@/components/ui/input";
import {
  EmptyState,
  ErrorState,
  NoAccessState,
  SkeletonCard,
} from "@/components/ui/states";
import { ApiError, get, orgUrl, patch, post } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type Employee = {
  id: string;
  employeeNumber: string;
  fullName: string;
  jobTitle: string;
  province?: { id: string; name: string } | null;
  site?: { id: string; name: string } | null;
};
type LeaveType = {
  id: string;
  code: string;
  name: string;
  annualEntitlementDays: number | null;
  isPaid: boolean;
  requiresApproval: boolean;
  allowsBackdating: boolean;
  isActive: boolean;
  notes?: string | null;
};
type LeaveRequest = {
  id: string;
  employee: Employee;
  leaveType: { id: string; code: string; name: string; isPaid: boolean };
  province?: { id: string; name: string } | null;
  site?: { id: string; name: string } | null;
  startsOn: string;
  endsOn: string;
  requestedDays: number;
  reason?: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled" | "taken";
  requestedByName?: string | null;
  decision?: {
    decidedAt: string;
    decidedByName?: string | null;
    note?: string | null;
  } | null;
  createdAt: string;
};
type Summary = {
  metrics: {
    pending: number;
    approved: number;
    taken: number;
    people: number;
    days: number;
  };
  balances: {
    employee: Employee;
    leaveType: { id: string; name: string };
    entitledDays: number;
    carriedOverDays: number;
    takenDays: number;
    remainingDays: number;
  }[];
};
const selectClass =
  "h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink focus:outline-2 focus:outline-ring";
const t = (fr: boolean, en: string, frText: string) => (fr ? frText : en);
const status = (value: string): "good" | "warning" | "serious" | "outline" =>
  value === "approved" || value === "taken"
    ? "good"
    : value === "pending"
      ? "warning"
      : value === "rejected"
        ? "serious"
        : "outline";
const display = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (x) => x.toUpperCase());
const apiError = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : error
      ? "Impossible de terminer cette action."
      : null;
const today = () => new Date().toISOString().slice(0, 10);

export function LeaveArea({
  orgSlug,
  personal = false,
}: {
  orgSlug: string;
  personal?: boolean;
}) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const client = useQueryClient();
  const canRead = can(user, "leave.read"),
    canRequest = can(user, "leave.create"),
    canManage = !personal && can(user, "leave.update"),
    canApprove = !personal && can(user, "leave.approve"),
    canEmployees = !personal && can(user, "employees.read");
  const [requestOpen, setRequestOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [selected, setSelected] = useState<LeaveRequest | null>(null);
  const [filter, setFilter] = useState("all");
  const types = useQuery({
    queryKey: ["leave-types", orgSlug],
    queryFn: () =>
      get<{ leaveTypes: LeaveType[] }>(orgUrl(orgSlug, "leave-types")),
    enabled: canRead,
    select: (d) => d.leaveTypes,
  });
  const requests = useQuery({
    queryKey: ["leave-requests", orgSlug],
    queryFn: () =>
      get<{ requests: LeaveRequest[] }>(orgUrl(orgSlug, "leave-requests")),
    enabled: canRead,
    select: (d) => d.requests,
  });
  const summary = useQuery({
    queryKey: ["leave-summary", orgSlug, new Date().getUTCFullYear()],
    queryFn: () =>
      get<Summary>(
        orgUrl(orgSlug, `leave-summary?year=${new Date().getUTCFullYear()}`),
      ),
    enabled: canRead,
  });
  const employees = useQuery({
    queryKey: ["leave-employees", orgSlug],
    queryFn: () => get<{ employees: Employee[] }>(orgUrl(orgSlug, "employees")),
    enabled: canEmployees,
    select: (d) => d.employees,
  });
  const mine = useQuery({
    queryKey: ["leave-me", orgSlug],
    queryFn: () =>
      get<{ employee: Employee | null }>(orgUrl(orgSlug, "leave-me")),
    enabled: canRead,
    select: (d) => d.employee,
  });
  const decide = useMutation({
    mutationFn: ({
      id,
      decision,
    }: {
      id: string;
      decision: "approved" | "rejected";
    }) =>
      post<{ request: LeaveRequest }>(
        orgUrl(orgSlug, `leave-requests/${id}/decision`),
        { status: decision },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["leave-requests", orgSlug] });
      void client.invalidateQueries({ queryKey: ["leave-summary", orgSlug] });
      setSelected(null);
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) =>
      post<{ request: LeaveRequest }>(
        orgUrl(orgSlug, `leave-requests/${id}/cancel`),
        {},
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["leave-requests", orgSlug] });
      void client.invalidateQueries({ queryKey: ["leave-summary", orgSlug] });
      setSelected(null);
    },
  });
  const rows = useMemo(
    () =>
      (requests.data ?? []).filter(
        (row) => filter === "all" || row.status === filter,
      ),
    [requests.data, filter],
  );
  if (!canRead) return <NoAccessState what={t(fr, "leave", "les congés")} />;
  if (types.isPending || requests.isPending || summary.isPending)
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <SkeletonCard rows={8} />
      </main>
    );
  if (types.isError || requests.isError || summary.isError)
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <ErrorState
          description={
            (apiError(types.error) ||
              apiError(requests.error) ||
              apiError(summary.error)) ??
            undefined
          }
          onRetry={() => {
            void types.refetch();
            void requests.refetch();
            void summary.refetch();
          }}
        />
      </main>
    );
  const metrics = summary.data?.metrics ?? {
    pending: 0,
    approved: 0,
    taken: 0,
    people: 0,
    days: 0,
  };
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="relative overflow-hidden rounded-2xl border border-emerald-300/25 bg-[radial-gradient(circle_at_88%_15%,rgba(91,229,178,.2),transparent_26%),linear-gradient(127deg,#073b45,#08745c)] px-5 py-6 text-white shadow-[0_20px_42px_-30px_rgba(4,61,58,.9)] sm:px-7">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-100">
            {personal ? t(fr, "My time off", "Mes absences") : t(fr, "People care", "Bien-être des équipes")}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {personal ? t(fr, "My leave", "Mes congés") : t(fr, "Leave & availability", "Congés et disponibilités")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-emerald-50/90">
            {personal ? t(fr, "Request time off, follow its decision, and check your available balance.", "Demandez un congé, suivez la décision et consultez votre solde.") : t(fr, "A clear, auditable view of time away — from request to approval and balance.", "Une vue claire et traçable des absences : demande, décision et solde.")}
          </p>
        </div>
        <div className="relative mt-5 flex flex-wrap gap-2">
          {canRequest ? (
            <Button
              className="bg-white text-emerald-800 hover:bg-emerald-50"
              onClick={() => setRequestOpen(true)}
            >
              <Plus />
              {t(fr, "Request leave", "Demander un congé")}
            </Button>
          ) : null}
          {canManage ? (
            <Button
              variant="secondary"
              className="border-white/25 bg-white/10 text-white hover:bg-white/20"
              onClick={() => setTypeOpen(true)}
            >
              <FilePlus2 />
              {t(fr, "Manage leave types", "Gérer les types")}
            </Button>
          ) : null}
        </div>
      </header>
      {!personal ? (
        <div className="flex justify-end">
          <HrPdfButton orgSlug={orgSlug} report="leave" fr={fr} className="border-brand/30 bg-brand/10 text-brand hover:bg-brand/15" />
        </div>
      ) : null}
      <section className={`grid gap-3 sm:grid-cols-2 ${personal ? "xl:grid-cols-4" : "xl:grid-cols-5"}`}>
        <Metric
          icon={Clock3}
          title={t(fr, "Waiting decision", "En attente")}
          value={metrics.pending}
          text={t(fr, "Requests awaiting review", "Demandes à traiter")}
          tone="warning"
        />
        <Metric
          icon={Check}
          title={t(fr, "Approved", "Approuvés")}
          value={metrics.approved}
          text={t(fr, "Scheduled absences", "Absences planifiées")}
          tone="good"
        />
        <Metric
          icon={Palmtree}
          title={t(fr, "Days planned", "Jours prévus")}
          value={metrics.days}
          text={t(fr, "Approved this year", "Approuvés cette année")}
          tone="brand"
        />
        {!personal ? (
          <Metric
            icon={Users}
            title={t(fr, "People away", "Personnes concernées")}
            value={metrics.people}
            text={t(fr, "This calendar year", "Cette année")}
          />
        ) : null}
        <Metric
          icon={HeartPulse}
          title={t(fr, "Taken", "Pris")}
          value={metrics.taken}
          text={t(fr, "Completed leave", "Congés terminés")}
        />
      </section>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(19rem,.75fr)]">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
            <div>
              <h2 className="text-base font-semibold text-ink">
                {t(fr, "Leave requests", "Demandes de congé")}
              </h2>
              <p className="mt-1 text-xs text-ink-secondary">
                {t(
                  fr,
                  "Select a request to review the dates, reason, approval and employee location.",
                  "Sélectionnez une demande pour consulter les dates, le motif, la décision et le lieu d’affectation.",
                )}
              </p>
            </div>
            <select
              className={selectClass + " w-40"}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">{t(fr, "All requests", "Toutes")}</option>
              {["pending", "approved", "rejected", "cancelled", "taken"].map(
                (value) => (
                  <option key={value} value={value}>
                    {display(value)}
                  </option>
                ),
              )}
            </select>
          </div>
          {rows.length ? (
            <div className="divide-y divide-border">
              {rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelected(row)}
                  className={`flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-surface-2 sm:px-5 ${selected?.id === row.id ? "bg-emerald-500/5" : ""}`}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700">
                    <CalendarDays className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">
                        {row.employee.fullName}
                      </span>
                      <Badge variant={status(row.status)}>
                        {display(row.status)}
                      </Badge>
                    </span>
                    <span className="mt-1 block truncate text-xs text-ink-secondary">
                      {row.leaveType.name} · {row.startsOn} → {row.endsOn} ·{" "}
                      {row.requestedDays} {t(fr, "day(s)", "jour(s)")}
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-ink-muted" />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Palmtree}
              title={t(
                fr,
                "No leave requests in this view",
                "Aucune demande dans cette vue",
              )}
              description={t(
                fr,
                "Start by creating a leave request for an employee.",
                "Commencez par créer une demande pour un employé.",
              )}
            />
          )}
        </section>
        <RequestDetail
          request={selected}
          fr={fr}
          canApprove={canApprove}
          canCancel={canRequest}
          busy={decide.isPending || cancel.isPending}
          error={apiError(decide.error) || apiError(cancel.error)}
          onApprove={() =>
            selected && decide.mutate({ id: selected.id, decision: "approved" })
          }
          onReject={() =>
            selected && decide.mutate({ id: selected.id, decision: "rejected" })
          }
          onCancel={() => selected && cancel.mutate(selected.id)}
        />
      </section>
      <section className={personal ? "grid gap-5" : "grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(19rem,.75fr)]"}>
        <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
          <div className="border-b border-border p-4 sm:p-5">
            <h2 className="text-base font-semibold text-ink">
              {t(fr, "Leave balances", "Soldes de congés")}
            </h2>
            <p className="mt-1 text-xs text-ink-secondary">
              {t(
                fr,
                "Balances are created when a leave type is used and remain tied to the employee and calendar year.",
                "Les soldes sont créés lors de l’utilisation d’un type de congé et restent liés à l’employé et à l’année civile.",
              )}
            </p>
          </div>
          {(summary.data?.balances ?? []).length ? (
            <div className="divide-y divide-border">
              {summary.data!.balances.map((balance, index) => (
                <div
                  key={`${balance.employee.id}-${balance.leaveType.id}-${index}`}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {balance.employee.fullName}
                    </p>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {balance.leaveType.name} · #
                      {balance.employee.employeeNumber}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-right text-xs">
                    <span>
                      <b className="block text-sm text-ink">
                        {balance.entitledDays + balance.carriedOverDays}
                      </b>
                      {t(fr, "Accordé", "Granted")}
                    </span>
                    <span>
                      <b className="block text-sm text-ink">
                        {balance.takenDays}
                      </b>
                      {t(fr, "Pris", "Taken")}
                    </span>
                    <span>
                      <b className="block text-sm text-emerald-700">
                        {balance.remainingDays}
                      </b>
                      {t(fr, "Restant", "Remaining")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Clock3}
              title={t(fr, "No balance yet", "Aucun solde pour le moment")}
              description={t(
                fr,
                "Approved leave will create the appropriate annual balance.",
                "Un congé approuvé créera le solde annuel approprié.",
              )}
            />
          )}
        </section>
        {!personal ? (
          <LeaveTypes
            types={types.data ?? []}
            fr={fr}
            canManage={canManage}
            onAdd={() => setTypeOpen(true)}
          />
        ) : null}
      </section>
      {requestOpen ? (
        <RequestDialog
          fr={fr}
          types={(types.data ?? []).filter((x) => x.isActive)}
          employees={employees.data ?? []}
          mine={mine.data ?? null}
          canSelectEmployee={canEmployees}
          orgSlug={orgSlug}
          onClose={() => setRequestOpen(false)}
        />
      ) : null}
      {typeOpen ? (
        <LeaveTypeDialog
          fr={fr}
          orgSlug={orgSlug}
          onClose={() => setTypeOpen(false)}
        />
      ) : null}
    </main>
  );
}
function Metric({
  icon: Icon,
  title,
  value,
  text,
  tone = "neutral",
}: {
  icon: typeof CalendarDays;
  title: string;
  value: number;
  text: string;
  tone?: "neutral" | "good" | "brand" | "warning";
}) {
  const c = {
    neutral: "bg-surface-3 text-ink",
    good: "bg-good/10 text-good-ink",
    brand: "bg-brand/10 text-brand",
    warning: "bg-warning/15 text-warning-ink",
  };
  return (
    <article className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm">
      <span className={`grid size-9 place-items-center rounded-xl ${c[tone]}`}>
        <Icon className="size-4" />
      </span>
      <p className="mt-4 text-xs font-medium text-ink-secondary">{title}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">
        {value}
      </p>
      <p className="mt-1 text-xs text-ink-muted">{text}</p>
    </article>
  );
}
function RequestDetail({
  request,
  fr,
  canApprove,
  canCancel,
  busy,
  error,
  onApprove,
  onReject,
  onCancel,
}: {
  request: LeaveRequest | null;
  fr: boolean;
  canApprove: boolean;
  canCancel: boolean;
  busy: boolean;
  error: string | null;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
}) {
  if (!request)
    return (
      <aside className="rounded-2xl border border-dashed border-border bg-surface-1 p-6">
        <CalendarDays className="size-6 text-ink-muted" />
        <h2 className="mt-4 text-base font-semibold text-ink">
          {t(fr, "Select a request", "Sélectionnez une demande")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-ink-secondary">
          {t(
            fr,
            "Its dates, reason and approval decision will appear here.",
            "Ses dates, son motif et la décision apparaîtront ici.",
          )}
        </p>
      </aside>
    );
  return (
    <aside className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">
            {request.leaveType.name}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-ink">
            {request.employee.fullName}
          </h2>
          <p className="mt-1 text-xs text-ink-secondary">
            #{request.employee.employeeNumber} · {request.employee.jobTitle}
          </p>
        </div>
        <Badge variant={status(request.status)}>
          {display(request.status)}
        </Badge>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <Info title={t(fr, "Start", "Début")} value={request.startsOn} />
        <Info title={t(fr, "End", "Fin")} value={request.endsOn} />
        <Info
          title={t(fr, "Duration", "Durée")}
          value={`${request.requestedDays} ${t(fr, "day(s)", "jour(s)")}`}
        />
        <Info
          title={t(fr, "Paid leave", "Congé payé")}
          value={
            request.leaveType.isPaid ? t(fr, "Yes", "Oui") : t(fr, "No", "Non")
          }
        />
        <Info title={t(fr, "Site", "Site")} value={request.site?.name ?? "—"} />
        <Info
          title={t(fr, "Requested by", "Demandé par")}
          value={request.requestedByName ?? "—"}
        />
      </dl>
      {request.reason ? (
        <div className="mt-4 rounded-xl bg-surface-2 p-3">
          <p className="text-xs font-semibold text-ink-secondary">
            {t(fr, "Reason", "Motif")}
          </p>
          <p className="mt-1 text-sm leading-6 text-ink">{request.reason}</p>
        </div>
      ) : null}
      {request.decision ? (
        <div className="mt-3 rounded-xl border border-border p-3">
          <p className="text-xs font-semibold text-ink-secondary">
            {t(fr, "Decision", "Décision")}
          </p>
          <p className="mt-1 text-sm text-ink">
            {request.decision.decidedByName ?? "—"} ·{" "}
            {new Intl.DateTimeFormat(fr ? "fr-FR" : "en-US", {
              dateStyle: "medium",
            }).format(new Date(request.decision.decidedAt))}
          </p>
          {request.decision.note ? (
            <p className="mt-1 text-xs text-ink-secondary">
              {request.decision.note}
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="mt-3 text-xs text-critical">{error}</p> : null}
      <div className="mt-5 flex flex-wrap gap-2">
        {canApprove && request.status === "pending" ? (
          <>
            <Button size="sm" loading={busy} onClick={onApprove}>
              <Check />
              {t(fr, "Approve", "Approuver")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={onReject}
            >
              {t(fr, "Reject", "Refuser")}
            </Button>
          </>
        ) : null}
        {canCancel && request.status === "pending" ? (
          <Button size="sm" variant="ghost" loading={busy} onClick={onCancel}>
            {t(fr, "Cancel request", "Annuler")}
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
function Info({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{title}</dt>
      <dd className="mt-1 font-medium text-ink">{value}</dd>
    </div>
  );
}
function LeaveTypes({
  types,
  fr,
  canManage,
  onAdd,
}: {
  types: LeaveType[];
  fr: boolean;
  canManage: boolean;
  onAdd: () => void;
}) {
  return (
    <aside className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">
            {t(fr, "Leave types", "Types de congés")}
          </h2>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            {t(
              fr,
              "Your company policy controls the entitlement and approval rule.",
              "La politique de l’entreprise contrôle le droit et la règle d’approbation.",
            )}
          </p>
        </div>
        {canManage ? (
          <Button size="sm" variant="secondary" onClick={onAdd}>
            <Plus />
          </Button>
        ) : null}
      </div>
      <div className="mt-4 space-y-2">
        {types.length ? (
          types.map((type) => (
            <div key={type.id} className="rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink">{type.name}</p>
                <Badge variant={type.isActive ? "good" : "outline"}>
                  {type.isPaid
                    ? t(fr, "Paid", "Payé")
                    : t(fr, "Unpaid", "Non payé")}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-ink-secondary">
                {type.annualEntitlementDays === null
                  ? t(fr, "No annual cap", "Sans plafond annuel")
                  : `${type.annualEntitlementDays} ${t(fr, "days / year", "jours / an")}`}{" "}
                ·{" "}
                {type.requiresApproval
                  ? t(fr, "Approval required", "Approbation requise")
                  : t(fr, "Direct", "Direct")}
              </p>
            </div>
          ))
        ) : (
          <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm text-ink-secondary">
            {t(
              fr,
              "No leave type is configured. Add one before submitting a request.",
              "Aucun type configuré. Ajoutez-en un avant de soumettre une demande.",
            )}
          </p>
        )}
      </div>
    </aside>
  );
}
function Modal({
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
      className="fixed inset-0 z-50 overflow-y-auto bg-ink/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <section className="mx-auto my-5 w-full max-w-2xl rounded-2xl border border-border bg-surface-1 p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-xl font-semibold text-ink">{title}</h2>
          <Button size="icon-sm" variant="ghost" onClick={onClose}>
            <X />
          </Button>
        </div>
        {children}
      </section>
    </div>
  );
}
function RequestDialog({
  fr,
  types,
  employees,
  mine,
  canSelectEmployee,
  orgSlug,
  onClose,
}: {
  fr: boolean;
  types: LeaveType[];
  employees: Employee[];
  mine: Employee | null;
  canSelectEmployee: boolean;
  orgSlug: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      post<{ request: LeaveRequest }>(orgUrl(orgSlug, "leave-requests"), body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["leave-requests", orgSlug] });
      void client.invalidateQueries({ queryKey: ["leave-summary", orgSlug] });
      onClose();
    },
  });
  const available = canSelectEmployee ? employees : mine ? [mine] : [];
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const starts = String(form.get("startsOn"));
    const ends = String(form.get("endsOn"));
    const days = Math.max(
      0.5,
      Math.round(
        ((new Date(`${ends}T00:00:00`).getTime() -
          new Date(`${starts}T00:00:00`).getTime()) /
          86400000 +
          1) *
          2,
      ) / 2,
    );
    save.mutate({
      employeeId: String(form.get("employeeId")),
      leaveTypeId: String(form.get("leaveTypeId")),
      startsOn: starts,
      endsOn: ends,
      requestedDays: days,
      reason: String(form.get("reason") ?? "").trim() || undefined,
    });
  };
  return (
    <Modal
      title={t(fr, "Request leave", "Demander un congé")}
      onClose={onClose}
    >
      <p className="mt-1 text-sm text-ink-secondary">
        {t(
          fr,
          "Dates and leave balance are validated securely when the request is submitted.",
          "Les dates et le solde sont validés de manière sécurisée à l’envoi.",
        )}
      </p>
      <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <Field
          htmlFor="leave-employee"
          label={t(fr, "Employee", "Employé")}
          required
        >
          <select
            name="employeeId"
            required
            defaultValue={mine?.id ?? ""}
            className={selectClass}
            disabled={
              !available.length || (!canSelectEmployee && Boolean(mine))
            }
          >
            {!available.length ? (
              <option>
                {t(
                  fr,
                  "No employee profile linked",
                  "Aucune fiche employé liée",
                )}
              </option>
            ) : null}
            {available.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName} · #{e.employeeNumber}
              </option>
            ))}
          </select>
        </Field>
        <Field
          htmlFor="leave-type"
          label={t(fr, "Leave type", "Type de congé")}
          required
        >
          <select
            name="leaveTypeId"
            required
            defaultValue=""
            className={selectClass}
          >
            <option value="">
              {t(fr, "Choose a type", "Choisir un type")}
            </option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          htmlFor="leave-start"
          label={t(fr, "Start date", "Date de début")}
          required
        >
          <Input type="date" name="startsOn" min={today()} required />
        </Field>
        <Field
          htmlFor="leave-end"
          label={t(fr, "End date", "Date de fin")}
          required
        >
          <Input type="date" name="endsOn" min={today()} required />
        </Field>
        <Field
          htmlFor="leave-reason"
          label={t(fr, "Reason", "Motif")}
          className="sm:col-span-2"
        >
          <Textarea
            name="reason"
            rows={3}
            placeholder={t(
              fr,
              "Optional context for the reviewer",
              "Contexte facultatif pour le responsable",
            )}
          />
        </Field>
        {apiError(save.error) ? (
          <p className="sm:col-span-2 text-sm text-critical">
            {apiError(save.error)}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t(fr, "Cancel", "Annuler")}
          </Button>
          <Button
            type="submit"
            loading={save.isPending}
            disabled={!types.length || !available.length}
          >
            <CalendarDays />
            {t(fr, "Submit request", "Envoyer la demande")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function LeaveTypeDialog({
  fr,
  orgSlug,
  onClose,
}: {
  fr: boolean;
  orgSlug: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      post<{ leaveType: LeaveType }>(orgUrl(orgSlug, "leave-types"), body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["leave-types", orgSlug] });
      onClose();
    },
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    const code = String(
      f.get("code") ??
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, ""),
    );
    const entitlement = String(f.get("entitlement") ?? "").trim();
    save.mutate({
      name,
      code,
      annualEntitlementDays: entitlement ? Number(entitlement) : null,
      isPaid: f.get("isPaid") === "on",
      requiresApproval: f.get("requiresApproval") === "on",
      allowsBackdating: f.get("allowsBackdating") === "on",
      notes: String(f.get("notes") ?? "").trim() || undefined,
    });
  };
  return (
    <Modal
      title={t(fr, "Add leave type", "Ajouter un type de congé")}
      onClose={onClose}
    >
      <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <Field htmlFor="leave-type-name" label={t(fr, "Name", "Nom")} required>
          <Input
            name="name"
            required
            placeholder={t(fr, "Annual leave", "Congé annuel")}
          />
        </Field>
        <Field
          htmlFor="leave-type-code"
          label={t(fr, "Code", "Code")}
          hint={t(
            fr,
            "Generated from name when blank",
            "Généré depuis le nom si vide",
          )}
        >
          <Input name="code" />
        </Field>
        <Field
          htmlFor="leave-type-entitlement"
          label={t(fr, "Annual entitlement (days)", "Droit annuel (jours)")}
          hint={t(
            fr,
            "Leave blank for unlimited leave",
            "Laissez vide pour un congé sans plafond",
          )}
        >
          <Input name="entitlement" type="number" min="0" step="0.5" />
        </Field>
        <div className="space-y-2 pt-1 text-sm text-ink">
          <label className="flex items-center gap-2">
            <input
              name="isPaid"
              type="checkbox"
              defaultChecked
              className="size-4 accent-[var(--brand)]"
            />
            {t(fr, "Paid leave", "Congé payé")}
          </label>
          <label className="flex items-center gap-2">
            <input
              name="requiresApproval"
              type="checkbox"
              defaultChecked
              className="size-4 accent-[var(--brand)]"
            />
            {t(fr, "Approval required", "Approbation requise")}
          </label>
          <label className="flex items-center gap-2">
            <input
              name="allowsBackdating"
              type="checkbox"
              className="size-4 accent-[var(--brand)]"
            />
            {t(fr, "Allow backdating", "Autoriser l’antidatage")}
          </label>
        </div>
        <Field
          htmlFor="leave-type-notes"
          label={t(fr, "Notes", "Notes")}
          className="sm:col-span-2"
        >
          <Textarea name="notes" rows={3} />
        </Field>
        {apiError(save.error) ? (
          <p className="sm:col-span-2 text-sm text-critical">
            {apiError(save.error)}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t(fr, "Cancel", "Annuler")}
          </Button>
          <Button type="submit" loading={save.isPending}>
            <Plus />
            {t(fr, "Create type", "Créer")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
