"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeDollarSign,
  Banknote,
  Calculator,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileText,
  Landmark,
  Plus,
  ReceiptText,
  Settings2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HrPdfButton } from "@/components/hr/hr-pdf-button";
import { Field as BaseField, Input, Textarea } from "@/components/ui/input";
import {
  EmptyState,
  ErrorState,
  NoAccessState,
  SkeletonCard,
} from "@/components/ui/states";
import { ApiError, get, orgUrl, post } from "@/lib/api";
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
type Component = {
  id: string;
  code: string;
  name: string;
  componentType: "earning" | "deduction" | "employer_cost";
  calculation: string;
  percentage?: number | null;
  defaultAmount?: number | null;
  isTaxable: boolean;
  affectsGross: boolean;
  isActive: boolean;
  notes?: string | null;
};
type Compensation = {
  id: string;
  employee: Employee;
  effectiveFrom: string;
  effectiveTo?: string | null;
  currency: string;
  basicSalary: number;
  payFrequency: string;
  contractHoursPerWeek?: number | null;
  paymentMethod: string;
  bankName?: string | null;
  bankAccount?: string | null;
  mobileMoneyNumber?: string | null;
  notes?: string | null;
};
type Assignment = {
  id: string;
  employee: Employee;
  component: Component;
  amount?: number | null;
  percentage?: number | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  totalToRecover?: number | null;
  recoveredToDate: number;
  isActive: boolean;
  notes?: string | null;
};
type PayrollRun = {
  id: string;
  reference: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  currency: string;
  status: "draft" | "calculated" | "approved" | "paid" | "cancelled";
  province?: { id: string; name: string } | null;
  employeeCount: number;
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
  employerCostTotal: number;
  notes?: string | null;
  createdBy?: { id: string; fullName?: string | null } | null;
  approvedBy?: { id: string; fullName?: string | null } | null;
  approvedAt?: string | null;
  paidAt?: string | null;
};
type Payslip = {
  id: string;
  employee: Employee;
  currency: string;
  basicSalary: number;
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  employerCost: number;
  paymentMethod?: string | null;
  lines: {
    id: string;
    code: string;
    name: string;
    type: string;
    amount: number;
    basis?: string | null;
  }[];
};
type Summary = {
  totalRuns: number;
  draft: number;
  readyForApproval: number;
  approved: number;
  paid: number;
  paidThisMonth: number;
};

const selectClass =
  "h-10 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";
const t = (fr: boolean, en: string, frText: string) => (fr ? frText : en);
const words = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const money = (value: number, currency: string, fr: boolean) =>
  new Intl.NumberFormat(fr ? "fr-FR" : "en-US", {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
const date = (value: string | null | undefined, fr: boolean) =>
  value
    ? new Intl.DateTimeFormat(fr ? "fr-FR" : "en-US", {
        dateStyle: "medium",
      }).format(new Date(`${value.slice(0, 10)}T00:00:00`))
    : "—";
const apiError = (error: unknown) =>
  error instanceof ApiError
    ? (Object.values(error.fieldErrors).flat()[0] ?? error.message)
    : error
      ? "Impossible de terminer cette action."
      : null;
const statusVariant = (
  status: PayrollRun["status"],
): "good" | "warning" | "info" | "serious" | "outline" =>
  status === "paid"
    ? "good"
    : status === "approved"
      ? "info"
      : status === "calculated"
        ? "warning"
        : status === "cancelled"
          ? "serious"
          : "outline";
const today = () => new Date().toISOString().slice(0, 10);

export function PayrollArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const client = useQueryClient();
  const canRead = can(user, "payroll.read"),
    canCreate = can(user, "payroll.create"),
    canUpdate = can(user, "payroll.update"),
    canApprove = can(user, "payroll.approve"),
    canReject = can(user, "payroll.reject"),
    canEmployees = can(user, "employees.read");
  const [tab, setTab] = useState<
    "runs" | "payslips" | "compensation" | "components"
  >("runs");
  const [selectedRun, setSelectedRun] = useState<PayrollRun | null>(null);
  const [dialog, setDialog] = useState<
    "run" | "component" | "compensation" | "assignment" | null
  >(null);
  const [filter, setFilter] = useState("all");
  const runs = useQuery({
    queryKey: ["payroll-runs", orgSlug],
    queryFn: () =>
      get<{ payrollRuns: PayrollRun[] }>(orgUrl(orgSlug, "payroll-runs")),
    enabled: canRead,
    select: (data) => data.payrollRuns,
  });
  const summary = useQuery({
    queryKey: ["payroll-summary", orgSlug],
    queryFn: () =>
      get<{ summary: Summary }>(orgUrl(orgSlug, "payroll-summary")),
    enabled: canRead,
    select: (data) => data.summary,
  });
  const components = useQuery({
    queryKey: ["payroll-components", orgSlug],
    queryFn: () =>
      get<{ components: Component[] }>(orgUrl(orgSlug, "payroll-components")),
    enabled: canRead,
    select: (data) => data.components,
  });
  const compensation = useQuery({
    queryKey: ["employee-compensation", orgSlug],
    queryFn: () =>
      get<{ compensations: Compensation[] }>(
        orgUrl(orgSlug, "employee-compensation"),
      ),
    enabled: canRead,
    select: (data) => data.compensations,
  });
  const assignments = useQuery({
    queryKey: ["employee-payroll-components", orgSlug],
    queryFn: () =>
      get<{ assignments: Assignment[] }>(
        orgUrl(orgSlug, "employee-payroll-components"),
      ),
    enabled: canRead,
    select: (data) => data.assignments,
  });
  const employees = useQuery({
    queryKey: ["payroll-employees", orgSlug],
    queryFn: () => get<{ employees: Employee[] }>(orgUrl(orgSlug, "employees")),
    enabled: canEmployees,
    select: (data) => data.employees,
  });
  const payslips = useQuery({
    queryKey: ["payroll-payslips", orgSlug, selectedRun?.id],
    queryFn: () =>
      get<{ payslips: Payslip[] }>(
        orgUrl(orgSlug, `payroll-runs/${selectedRun!.id}/payslips`),
      ),
    enabled: canRead && Boolean(selectedRun),
    select: (data) => data.payslips,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["payroll-runs", orgSlug] });
    void client.invalidateQueries({ queryKey: ["payroll-summary", orgSlug] });
    void client.invalidateQueries({
      queryKey: ["payroll-payslips", orgSlug, selectedRun?.id],
    });
  };
  const calculate = useMutation({
    mutationFn: (id: string) =>
      post<{ payrollRun: PayrollRun }>(
        orgUrl(orgSlug, `payroll-runs/${id}/calculate`),
        {},
      ),
    onSuccess: (data) => {
      setSelectedRun(data.payrollRun);
      refresh();
    },
  });
  const approve = useMutation({
    mutationFn: (id: string) =>
      post<{ payrollRun: PayrollRun }>(
        orgUrl(orgSlug, `payroll-runs/${id}/approve`),
        {},
      ),
    onSuccess: (data) => {
      setSelectedRun(data.payrollRun);
      refresh();
    },
  });
  const paid = useMutation({
    mutationFn: (id: string) =>
      post<{ payrollRun: PayrollRun }>(
        orgUrl(orgSlug, `payroll-runs/${id}/mark-paid`),
        { paidAt: today() },
      ),
    onSuccess: (data) => {
      setSelectedRun(data.payrollRun);
      refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) =>
      post<{ payrollRun: PayrollRun }>(
        orgUrl(orgSlug, `payroll-runs/${id}/reject`),
        { notes: "Cancelled from payroll workspace" },
      ),
    onSuccess: (data) => {
      setSelectedRun(data.payrollRun);
      refresh();
    },
  });
  const activeRuns = useMemo(
    () =>
      (runs.data ?? []).filter(
        (run) => filter === "all" || run.status === filter,
      ),
    [runs.data, filter],
  );
  if (!canRead) return <NoAccessState what={t(fr, "payroll", "la paie")} />;
  if (
    runs.isPending ||
    summary.isPending ||
    components.isPending ||
    compensation.isPending ||
    assignments.isPending
  )
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <SkeletonCard rows={10} />
      </main>
    );
  if (
    runs.isError ||
    summary.isError ||
    components.isError ||
    compensation.isError ||
    assignments.isError
  )
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <ErrorState
          description={
            apiError(runs.error) ||
            apiError(summary.error) ||
            apiError(components.error) ||
            apiError(compensation.error) ||
            apiError(assignments.error) ||
            undefined
          }
          onRetry={() => {
            void runs.refetch();
            void summary.refetch();
            void components.refetch();
            void compensation.refetch();
            void assignments.refetch();
          }}
        />
      </main>
    );
  const metrics = summary.data ?? {
    totalRuns: 0,
    draft: 0,
    readyForApproval: 0,
    approved: 0,
    paid: 0,
    paidThisMonth: 0,
  };
  const selected = selectedRun
    ? ((runs.data ?? []).find((run) => run.id === selectedRun.id) ??
      selectedRun)
    : null;
  return (
    <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="relative overflow-hidden rounded-3xl border border-violet-300/20 bg-[radial-gradient(circle_at_92%_15%,rgba(247,196,95,.26),transparent_29%),radial-gradient(circle_at_8%_100%,rgba(107,78,210,.34),transparent_38%),linear-gradient(135deg,#20174d,#3c277d_52%,#76468f)] px-5 py-7 text-white shadow-[0_26px_60px_-38px_rgba(36,17,83,.95)] sm:px-7 sm:py-8">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-violet-100">
            {t(fr, "Compensation control", "Pilotage de la rémunération")}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {t(fr, "Payroll", "Paie")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-violet-50/90">
            {t(
              fr,
              "Prepare consistent payroll, verify every amount, approve securely and keep a permanent payslip history.",
              "Préparez une paie fiable, vérifiez chaque montant, approuvez en sécurité et conservez l’historique des bulletins.",
            )}
          </p>
        </div>
        <div className="relative mt-5 flex flex-wrap gap-2">
          {canCreate ? (
            <Button
              className="bg-white text-violet-900 hover:bg-violet-50"
              onClick={() => setDialog("run")}
            >
              <Plus />
              {t(fr, "New payroll run", "Nouveau cycle de paie")}
            </Button>
          ) : null}
          {canCreate ? (
            <Button
              variant="secondary"
              className="border-white/20 bg-white/10 text-white hover:bg-white/20"
              onClick={() => setDialog("compensation")}
            >
              <UserRound />
              {t(fr, "Set salary", "Définir un salaire")}
            </Button>
          ) : null}
        </div>
      </header>
      <div className="flex justify-end">
        <HrPdfButton orgSlug={orgSlug} report="payroll" fr={fr} className="border-brand/30 bg-brand/10 text-brand hover:bg-brand/15" />
      </div>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          icon={ReceiptText}
          label={t(fr, "Payroll runs", "Cycles de paie")}
          value={metrics.totalRuns}
          tone="violet"
        />
        <Metric
          icon={Calculator}
          label={t(fr, "Ready for approval", "À approuver")}
          value={metrics.readyForApproval}
          tone="amber"
        />
        <Metric
          icon={CheckCircle2}
          label={t(fr, "Approved", "Approuvés")}
          value={metrics.approved}
          tone="blue"
        />
        <Metric
          icon={Banknote}
          label={t(fr, "Paid this month", "Payé ce mois")}
          value={money(metrics.paidThisMonth, selected?.currency ?? "USD", fr)}
          tone="green"
        />
      </section>
      <nav
        className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-surface-1 p-1"
        aria-label={t(fr, "Payroll sections", "Sections de paie")}
      >
        {(
          [
            ["runs", t(fr, "Payroll runs", "Cycles")],
            ["payslips", t(fr, "Payslips", "Bulletins")],
            ["compensation", t(fr, "Compensation", "Rémunérations")],
            ["components", t(fr, "Pay components", "Composantes")],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition ${tab === value ? "bg-brand text-white shadow-sm" : "text-ink-secondary hover:bg-surface-2 hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "runs" ? (
        <RunsPanel
          fr={fr}
          rows={activeRuns}
          filter={filter}
          setFilter={setFilter}
          selected={selected}
          onSelect={(run) => {
            setSelectedRun(run);
            setTab("payslips");
          }}
          canCreate={canCreate}
          onCreate={() => setDialog("run")}
        />
      ) : null}
      {tab === "payslips" ? (
        <PayslipsPanel
          fr={fr}
          selected={selected}
          payslips={payslips.data ?? []}
          pending={payslips.isPending}
          error={apiError(payslips.error)}
          canCreate={canCreate}
          canApprove={canApprove}
          canReject={canReject}
          calculate={calculate}
          approve={approve}
          paid={paid}
          cancel={cancel}
        />
      ) : null}
      {tab === "compensation" ? (
        <CompensationPanel
          fr={fr}
          rows={compensation.data ?? []}
          assignments={assignments.data ?? []}
          onAddSalary={() => setDialog("compensation")}
          onAddComponent={() => setDialog("assignment")}
          canCreate={canCreate}
        />
      ) : null}
      {tab === "components" ? (
        <ComponentsPanel
          fr={fr}
          rows={components.data ?? []}
          canCreate={canCreate}
          onAdd={() => setDialog("component")}
        />
      ) : null}
      {dialog === "run" ? (
        <RunDialog
          fr={fr}
          orgSlug={orgSlug}
          onClose={() => setDialog(null)}
          onSaved={(run) => {
            setSelectedRun(run);
            setDialog(null);
            refresh();
          }}
        />
      ) : null}
      {dialog === "component" ? (
        <ComponentDialog
          fr={fr}
          orgSlug={orgSlug}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "compensation" ? (
        <CompensationDialog
          fr={fr}
          orgSlug={orgSlug}
          employees={employees.data ?? []}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "assignment" ? (
        <AssignmentDialog
          fr={fr}
          orgSlug={orgSlug}
          employees={employees.data ?? []}
          components={components.data ?? []}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </main>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof ReceiptText;
  label: string;
  value: string | number;
  tone: "violet" | "amber" | "blue" | "green";
}) {
  const colors = {
    violet:
      "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200",
    amber:
      "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
    blue: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200",
    green:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200",
  };
  return (
    <article className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm">
      <span
        className={`grid size-9 place-items-center rounded-xl ${colors[tone]}`}
      >
        <Icon className="size-4" />
      </span>
      <p className="mt-4 text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-ink">
        {value}
      </p>
    </article>
  );
}
function RunsPanel({
  fr,
  rows,
  filter,
  setFilter,
  selected,
  onSelect,
  canCreate,
  onCreate,
}: {
  fr: boolean;
  rows: PayrollRun[];
  filter: string;
  setFilter: (value: string) => void;
  selected: PayrollRun | null;
  onSelect: (run: PayrollRun) => void;
  canCreate: boolean;
  onCreate: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface-1 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div>
          <h2 className="text-lg font-semibold text-ink">
            {t(fr, "Payroll runs", "Cycles de paie")}
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            {t(
              fr,
              "Each cycle stays traceable from draft through payment.",
              "Chaque cycle reste traçable du brouillon au paiement.",
            )}
          </p>
        </div>
        {canCreate ? (
          <Button onClick={onCreate}>
            <Plus />
            {t(fr, "Create run", "Créer un cycle")}
          </Button>
        ) : null}
      </div>
      <div className="flex gap-2 overflow-x-auto px-5 pt-4">
        {["all", "draft", "calculated", "approved", "paid", "cancelled"].map(
          (value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${filter === value ? "bg-brand text-white" : "bg-surface-2 text-ink-secondary hover:text-ink"}`}
            >
              {value === "all" ? t(fr, "All", "Tous") : words(value)}
            </button>
          ),
        )}
      </div>
      {rows.length ? (
        <div className="divide-y divide-border">
          {rows.map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => onSelect(run)}
              className={`grid w-full gap-3 p-5 text-left transition hover:bg-surface-2 sm:grid-cols-[1.2fr_auto_auto_auto] sm:items-center ${selected?.id === run.id ? "bg-brand/5" : ""}`}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink">{run.reference}</p>
                  <Badge variant={statusVariant(run.status)}>
                    {words(run.status)}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-ink-secondary">
                  {date(run.periodStart, fr)} — {date(run.periodEnd, fr)}{" "}
                  {run.province ? `· ${run.province.name}` : ""}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">
                  {t(fr, "Employees", "Employés")}
                </p>
                <p className="text-sm font-semibold text-ink">
                  {run.employeeCount}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">
                  {t(fr, "Net pay", "Net à payer")}
                </p>
                <p className="text-sm font-semibold text-ink">
                  {money(run.netTotal, run.currency, fr)}
                </p>
              </div>
              <ChevronRight className="size-5 justify-self-end text-ink-muted" />
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ReceiptText}
          title={t(fr, "No payroll run yet", "Aucun cycle de paie")}
          description={t(
            fr,
            "Create the first cycle when salaries and standing components are ready.",
            "Créez le premier cycle lorsque les salaires et composantes sont prêts.",
          )}
          action={
            canCreate
              ? {
                  label: t(fr, "Create payroll run", "Créer un cycle"),
                  onClick: onCreate,
                }
              : undefined
          }
        />
      )}
    </section>
  );
}

function PayslipsPanel({
  fr,
  selected,
  payslips,
  pending,
  error,
  canCreate,
  canApprove,
  canReject,
  calculate,
  approve,
  paid,
  cancel,
}: {
  fr: boolean;
  selected: PayrollRun | null;
  payslips: Payslip[];
  pending: boolean;
  error: string | null;
  canCreate: boolean;
  canApprove: boolean;
  canReject: boolean;
  calculate: any;
  approve: any;
  paid: any;
  cancel: any;
}) {
  const [open, setOpen] = useState<Payslip | null>(null);
  if (!selected)
    return (
      <section className="rounded-2xl border border-border bg-surface-1">
        <EmptyState
          icon={FileText}
          title={t(fr, "Select a payroll run", "Sélectionnez un cycle de paie")}
          description={t(
            fr,
            "Open a payroll run from Cycles to calculate and inspect individual payslips.",
            "Ouvrez un cycle depuis Cycles pour calculer et consulter les bulletins individuels.",
          )}
        />
      </section>
    );
  const problem =
    apiError(calculate.error) ||
    apiError(approve.error) ||
    apiError(paid.error) ||
    apiError(cancel.error) ||
    error;
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-ink">
              {selected.reference}
            </h2>
            <Badge variant={statusVariant(selected.status)}>
              {words(selected.status)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-ink-secondary">
            {date(selected.periodStart, fr)} — {date(selected.periodEnd, fr)} ·{" "}
            {date(selected.payDate, fr)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {["draft", "calculated"].includes(selected.status) && canCreate ? (
            <Button
              onClick={() => calculate.mutate(selected.id)}
              loading={calculate.isPending}
            >
              <Calculator />
              {t(fr, "Calculate payslips", "Calculer les bulletins")}
            </Button>
          ) : null}
          {selected.status === "calculated" && canApprove ? (
            <Button
              onClick={() => approve.mutate(selected.id)}
              loading={approve.isPending}
            >
              <CheckCircle2 />
              {t(fr, "Approve", "Approuver")}
            </Button>
          ) : null}
          {selected.status === "approved" && canApprove ? (
            <Button
              onClick={() => paid.mutate(selected.id)}
              loading={paid.isPending}
            >
              <Banknote />
              {t(fr, "Mark paid", "Marquer payé")}
            </Button>
          ) : null}
          {["draft", "calculated"].includes(selected.status) && canReject ? (
            <Button
              variant="secondary"
              onClick={() => cancel.mutate(selected.id)}
              loading={cancel.isPending}
            >
              {t(fr, "Cancel run", "Annuler le cycle")}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="grid gap-px border-b border-border bg-border sm:grid-cols-4">
        <SummaryCell
          label={t(fr, "Gross pay", "Brut")}
          value={money(selected.grossTotal, selected.currency, fr)}
        />
        <SummaryCell
          label={t(fr, "Deductions", "Retenues")}
          value={money(selected.deductionTotal, selected.currency, fr)}
        />
        <SummaryCell
          label={t(fr, "Net pay", "Net à payer")}
          value={money(selected.netTotal, selected.currency, fr)}
        />
        <SummaryCell
          label={t(fr, "Employer cost", "Coût employeur")}
          value={money(selected.employerCostTotal, selected.currency, fr)}
        />
      </div>
      {problem ? (
        <p className="m-5 rounded-xl bg-critical/10 px-3 py-2 text-sm text-critical">
          {problem}
        </p>
      ) : null}
      {pending ? (
        <div className="p-5">
          <SkeletonCard rows={5} />
        </div>
      ) : payslips.length ? (
        <div className="divide-y divide-border">
          {payslips.map((slip) => (
            <button
              type="button"
              key={slip.id}
              onClick={() => setOpen(slip)}
              className="grid w-full gap-3 p-5 text-left transition hover:bg-surface-2 sm:grid-cols-[1.2fr_auto_auto_auto] sm:items-center"
            >
              <div>
                <p className="font-semibold text-ink">
                  {slip.employee.fullName}
                </p>
                <p className="mt-1 text-xs text-ink-secondary">
                  #{slip.employee.employeeNumber} · {slip.employee.jobTitle}
                </p>
              </div>
              <Amount
                label={t(fr, "Gross", "Brut")}
                value={money(slip.grossPay, slip.currency, fr)}
              />
              <Amount
                label={t(fr, "Deductions", "Retenues")}
                value={money(slip.totalDeductions, slip.currency, fr)}
              />
              <Amount
                label={t(fr, "Net", "Net")}
                value={money(slip.netPay, slip.currency, fr)}
              />
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Calculator}
          title={t(fr, "No payslips calculated", "Aucun bulletin calculé")}
          description={t(
            fr,
            "Check employee salary records, then calculate this cycle.",
            "Vérifiez les rémunérations des employés, puis calculez ce cycle.",
          )}
        />
      )}
      {open ? (
        <PayslipDialog fr={fr} item={open} onClose={() => setOpen(null)} />
      ) : null}
    </section>
  );
}
function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-1 px-5 py-4">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 text-base font-semibold text-ink">{value}</p>
    </div>
  );
}
function Amount({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}
function CompensationPanel({
  fr,
  rows,
  assignments,
  onAddSalary,
  onAddComponent,
  canCreate,
}: {
  fr: boolean;
  rows: Compensation[];
  assignments: Assignment[];
  onAddSalary: () => void;
  onAddComponent: () => void;
  canCreate: boolean;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              {t(fr, "Employee salaries", "Salaires des employés")}
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">
              {t(
                fr,
                "Effective-dated records protect historic payslips.",
                "Les enregistrements datés protègent les bulletins historiques.",
              )}
            </p>
          </div>
          {canCreate ? (
            <Button size="sm" onClick={onAddSalary}>
              <Plus />
              {t(fr, "Set salary", "Définir un salaire")}
            </Button>
          ) : null}
        </div>
        {rows.length ? (
          <div className="divide-y divide-border">
            {rows.map((row) => (
              <article key={row.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">
                      {row.employee.fullName}
                    </p>
                    <p className="mt-1 text-xs text-ink-secondary">
                      #{row.employee.employeeNumber} · {row.employee.jobTitle}
                    </p>
                  </div>
                  <p className="font-semibold text-ink">
                    {money(row.basicSalary, row.currency, fr)}
                  </p>
                </div>
                <p className="mt-3 text-sm text-ink-secondary">
                  {words(row.payFrequency)} · {words(row.paymentMethod)} ·{" "}
                  {date(row.effectiveFrom, fr)}{" "}
                  {row.effectiveTo ? `→ ${date(row.effectiveTo, fr)}` : ""}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={UsersRound}
            title={t(fr, "No salary record yet", "Aucun salaire défini")}
            description={t(
              fr,
              "Set basic salaries before creating a payroll run.",
              "Définissez les salaires de base avant de créer un cycle de paie.",
            )}
            action={
              canCreate
                ? {
                    label: t(fr, "Set salary", "Définir un salaire"),
                    onClick: onAddSalary,
                  }
                : undefined
            }
          />
        )}
      </section>
      <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              {t(fr, "Standing adjustments", "Composantes personnelles")}
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">
              {t(
                fr,
                "Recurring allowances, deductions and advance recovery plans.",
                "Indemnités, retenues et récupérations récurrentes.",
              )}
            </p>
          </div>
          {canCreate ? (
            <Button size="sm" onClick={onAddComponent}>
              <Plus />
              {t(fr, "Add", "Ajouter")}
            </Button>
          ) : null}
        </div>
        {assignments.length ? (
          <div className="divide-y divide-border">
            {assignments.map((item) => (
              <article key={item.id} className="p-5">
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">
                      {item.component.name}
                    </p>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {item.employee.fullName} ·{" "}
                      {words(item.component.componentType)}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-ink">
                    {item.amount != null
                      ? item.amount
                      : item.percentage != null
                        ? `${item.percentage}%`
                        : "—"}
                  </p>
                </div>
                <p className="mt-2 text-xs text-ink-muted">
                  {date(item.effectiveFrom, fr)}{" "}
                  {item.effectiveTo ? `→ ${date(item.effectiveTo, fr)}` : ""}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Settings2}
            title={t(
              fr,
              "No standing adjustment",
              "Aucune composante personnelle",
            )}
            description={t(
              fr,
              "Use this for recurring allowances, deductions or an advance recovery.",
              "Utilisez ceci pour une indemnité, retenue ou récupération récurrente.",
            )}
          />
        )}
      </section>
    </div>
  );
}
function ComponentsPanel({
  fr,
  rows,
  canCreate,
  onAdd,
}: {
  fr: boolean;
  rows: Component[];
  canCreate: boolean;
  onAdd: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div>
          <h2 className="text-lg font-semibold text-ink">
            {t(fr, "Pay components", "Composantes de paie")}
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            {t(
              fr,
              "Reusable earnings, deductions and employer costs.",
              "Gains, retenues et coûts employeur réutilisables.",
            )}
          </p>
        </div>
        {canCreate ? (
          <Button onClick={onAdd}>
            <Plus />
            {t(fr, "Add component", "Ajouter une composante")}
          </Button>
        ) : null}
      </div>
      {rows.length ? (
        <div className="divide-y divide-border">
          {rows.map((item) => (
            <article
              key={item.id}
              className="grid gap-3 p-5 sm:grid-cols-[1.2fr_auto_auto_auto] sm:items-center"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-ink">{item.name}</p>
                  <Badge variant={item.isActive ? "good" : "outline"}>
                    {item.isActive
                      ? t(fr, "Active", "Actif")
                      : t(fr, "Inactive", "Inactif")}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-ink-secondary">
                  {item.code} · {words(item.calculation)}
                </p>
              </div>
              <Badge
                variant={
                  item.componentType === "earning"
                    ? "good"
                    : item.componentType === "deduction"
                      ? "warning"
                      : "info"
                }
              >
                {item.componentType === "earning"
                  ? t(fr, "Earning", "Gain")
                  : item.componentType === "deduction"
                    ? t(fr, "Deduction", "Retenue")
                    : t(fr, "Employer cost", "Coût employeur")}
              </Badge>
              <p className="text-sm text-ink-secondary">
                {item.percentage != null
                  ? `${item.percentage}%`
                  : (item.defaultAmount ?? "—")}
              </p>
              <p className="text-xs text-ink-muted">
                {item.isTaxable
                  ? t(fr, "Taxable", "Imposable")
                  : t(fr, "Non-taxable", "Non imposable")}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Settings2}
          title={t(
            fr,
            "No component configured",
            "Aucune composante configurée",
          )}
          description={t(
            fr,
            "Start with a transport allowance, tax deduction or employer contribution.",
            "Commencez par une indemnité de transport, une retenue fiscale ou une cotisation employeur.",
          )}
          action={
            canCreate
              ? {
                  label: t(fr, "Add component", "Ajouter une composante"),
                  onClick: onAdd,
                }
              : undefined
          }
        />
      )}
    </section>
  );
}
function FormField({
  label,
  required,
  hint,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  const id = `payroll-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <BaseField
      htmlFor={id}
      label={label}
      required={required}
      hint={hint}
      className={className}
    >
      {children}
    </BaseField>
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
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/55 p-4"
      role="dialog"
      aria-modal="true"
    >
      <section className="my-6 w-full max-w-2xl rounded-2xl border border-border bg-surface-1 p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-2 hover:text-ink"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function RunDialog({
  fr,
  orgSlug,
  onClose,
  onSaved,
}: {
  fr: boolean;
  orgSlug: string;
  onClose: () => void;
  onSaved: (run: PayrollRun) => void;
}) {
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      post<{ payrollRun: PayrollRun }>(orgUrl(orgSlug, "payroll-runs"), body),
    onSuccess: (data) => onSaved(data.payrollRun),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    save.mutate({
      reference: String(f.get("reference") ?? "").trim(),
      periodStart: String(f.get("periodStart") ?? ""),
      periodEnd: String(f.get("periodEnd") ?? ""),
      payDate: String(f.get("payDate") ?? ""),
      currency: String(f.get("currency") ?? "USD"),
      notes: String(f.get("notes") ?? "").trim() || null,
    });
  };
  return (
    <Modal
      title={t(fr, "New payroll run", "Nouveau cycle de paie")}
      onClose={onClose}
    >
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <FormField label={t(fr, "Reference", "Référence")} required>
          <Input name="reference" required placeholder="PAY-2026-09" />
        </FormField>
        <FormField label={t(fr, "Currency", "Devise")} required>
          <select name="currency" defaultValue="USD" className={selectClass}>
            <option value="USD">USD — US dollar</option>
            <option value="CDF">CDF — Franc congolais</option>
            <option value="EUR">EUR — Euro</option>
          </select>
        </FormField>
        <FormField label={t(fr, "Period start", "Début de période")} required>
          <Input name="periodStart" type="date" required />
        </FormField>
        <FormField label={t(fr, "Period end", "Fin de période")} required>
          <Input name="periodEnd" type="date" required />
        </FormField>
        <FormField label={t(fr, "Pay date", "Date de paiement")} required>
          <Input name="payDate" type="date" defaultValue={today()} required />
        </FormField>
        <FormField label={t(fr, "Notes", "Notes")} className="sm:col-span-2">
          <Textarea
            name="notes"
            rows={3}
            placeholder={t(
              fr,
              "Optional payroll context",
              "Contexte facultatif du cycle",
            )}
          />
        </FormField>
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
            {t(fr, "Create payroll run", "Créer le cycle")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function ComponentDialog({
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
      post(orgUrl(orgSlug, "payroll-components"), body),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["payroll-components", orgSlug],
      });
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    const code = String(
      f.get("code") ??
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, ""),
    );
    const amount = String(f.get("defaultAmount") ?? "").trim(),
      percentage = String(f.get("percentage") ?? "").trim();
    save.mutate({
      name,
      code,
      componentType: f.get("componentType"),
      calculation: f.get("calculation"),
      defaultAmount: amount ? Number(amount) : null,
      percentage: percentage ? Number(percentage) : null,
      isTaxable: f.get("isTaxable") === "on",
      affectsGross: f.get("affectsGross") === "on",
      notes: String(f.get("notes") ?? "").trim() || null,
    });
  };
  return (
    <Modal
      title={t(fr, "Add pay component", "Ajouter une composante de paie")}
      onClose={onClose}
    >
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <FormField label={t(fr, "Name", "Nom")} required>
          <Input
            name="name"
            required
            placeholder={t(fr, "Transport allowance", "Indemnité de transport")}
          />
        </FormField>
        <FormField
          label={t(fr, "Code", "Code")}
          hint={t(
            fr,
            "Generated from the name when blank",
            "Généré depuis le nom si vide",
          )}
        >
          <Input name="code" />
        </FormField>
        <FormField label={t(fr, "Type", "Type")} required>
          <select
            name="componentType"
            defaultValue="earning"
            className={selectClass}
          >
            <option value="earning">{t(fr, "Earning", "Gain")}</option>
            <option value="deduction">{t(fr, "Deduction", "Retenue")}</option>
            <option value="employer_cost">
              {t(fr, "Employer cost", "Coût employeur")}
            </option>
          </select>
        </FormField>
        <FormField label={t(fr, "Calculation", "Calcul")} required>
          <select
            name="calculation"
            defaultValue="fixed"
            className={selectClass}
          >
            <option value="fixed">
              {t(fr, "Fixed amount", "Montant fixe")}
            </option>
            <option value="percentage_of_basic">
              {t(fr, "% of basic salary", "% du salaire de base")}
            </option>
            <option value="percentage_of_gross">
              {t(fr, "% of gross pay", "% du brut")}
            </option>
            <option value="per_day">{t(fr, "Per day", "Par jour")}</option>
            <option value="per_hour">{t(fr, "Per hour", "Par heure")}</option>
          </select>
        </FormField>
        <FormField label={t(fr, "Default amount", "Montant par défaut")}>
          <Input name="defaultAmount" type="number" min="0" step="0.01" />
        </FormField>
        <FormField label={t(fr, "Percentage", "Pourcentage")}>
          <Input
            name="percentage"
            type="number"
            min="0"
            max="1000"
            step="0.01"
          />
        </FormField>
        <div className="space-y-2 text-sm text-ink sm:col-span-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="isTaxable"
              defaultChecked
              className="size-4 accent-[var(--brand)]"
            />
            {t(fr, "Taxable", "Imposable")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="affectsGross"
              defaultChecked
              className="size-4 accent-[var(--brand)]"
            />
            {t(
              fr,
              "Include in gross-pay calculation",
              "Inclure dans le calcul du brut",
            )}
          </label>
        </div>
        <FormField label={t(fr, "Notes", "Notes")} className="sm:col-span-2">
          <Textarea name="notes" rows={3} />
        </FormField>
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
            {t(fr, "Create component", "Créer la composante")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function CompensationDialog({
  fr,
  orgSlug,
  employees,
  onClose,
}: {
  fr: boolean;
  orgSlug: string;
  employees: Employee[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      post(orgUrl(orgSlug, "employee-compensation"), body),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["employee-compensation", orgSlug],
      });
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const hours = String(f.get("hours") ?? "").trim();
    save.mutate({
      employeeId: f.get("employeeId"),
      effectiveFrom: f.get("effectiveFrom"),
      effectiveTo: String(f.get("effectiveTo") ?? "").trim() || null,
      currency: f.get("currency"),
      basicSalary: Number(f.get("basicSalary")),
      payFrequency: f.get("payFrequency"),
      contractHoursPerWeek: hours ? Number(hours) : null,
      paymentMethod: f.get("paymentMethod"),
      bankName: String(f.get("bankName") ?? "").trim() || null,
      bankAccount: String(f.get("bankAccount") ?? "").trim() || null,
      mobileMoneyNumber:
        String(f.get("mobileMoneyNumber") ?? "").trim() || null,
      notes: String(f.get("notes") ?? "").trim() || null,
    });
  };
  return (
    <Modal
      title={t(fr, "Set employee salary", "Définir le salaire d’un employé")}
      onClose={onClose}
    >
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <FormField label={t(fr, "Employee", "Employé")} required>
          <select
            name="employeeId"
            required
            defaultValue=""
            className={selectClass}
          >
            <option value="">
              {employees.length
                ? t(fr, "Choose an employee", "Choisir un employé")
                : t(fr, "No employee available", "Aucun employé disponible")}
            </option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName} · #{e.employeeNumber}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label={t(fr, "Basic salary", "Salaire de base")} required>
          <Input
            name="basicSalary"
            type="number"
            min="0"
            step="0.01"
            required
          />
        </FormField>
        <FormField
          label={t(fr, "Effective from", "Applicable à partir du")}
          required
        >
          <Input
            name="effectiveFrom"
            type="date"
            defaultValue={today()}
            required
          />
        </FormField>
        <FormField label={t(fr, "Effective until", "Applicable jusqu’au")}>
          <Input name="effectiveTo" type="date" />
        </FormField>
        <FormField label={t(fr, "Currency", "Devise")} required>
          <select name="currency" defaultValue="USD" className={selectClass}>
            <option value="USD">USD</option>
            <option value="CDF">CDF</option>
            <option value="EUR">EUR</option>
          </select>
        </FormField>
        <FormField label={t(fr, "Pay frequency", "Fréquence de paie")}>
          <select
            name="payFrequency"
            defaultValue="monthly"
            className={selectClass}
          >
            <option value="monthly">{t(fr, "Monthly", "Mensuel")}</option>
            <option value="fortnightly">
              {t(fr, "Fortnightly", "Bihebdomadaire")}
            </option>
            <option value="weekly">{t(fr, "Weekly", "Hebdomadaire")}</option>
            <option value="daily">{t(fr, "Daily", "Journalier")}</option>
            <option value="hourly">{t(fr, "Hourly", "Horaire")}</option>
          </select>
        </FormField>
        <FormField label={t(fr, "Payment method", "Mode de paiement")}>
          <select
            name="paymentMethod"
            defaultValue="bank_transfer"
            className={selectClass}
          >
            <option value="bank_transfer">
              {t(fr, "Bank transfer", "Virement bancaire")}
            </option>
            <option value="cash">{t(fr, "Cash", "Espèces")}</option>
            <option value="mobile_money">Mobile money</option>
            <option value="cheque">{t(fr, "Cheque", "Chèque")}</option>
          </select>
        </FormField>
        <FormField label={t(fr, "Hours per week", "Heures par semaine")}>
          <Input name="hours" type="number" min="1" max="168" step="0.5" />
        </FormField>
        <FormField label={t(fr, "Bank name", "Banque")}>
          <Input name="bankName" />
        </FormField>
        <FormField label={t(fr, "Account number", "Numéro de compte")}>
          <Input name="bankAccount" />
        </FormField>
        <FormField label="Mobile money">
          <Input name="mobileMoneyNumber" />
        </FormField>
        <FormField label={t(fr, "Notes", "Notes")} className="sm:col-span-2">
          <Textarea name="notes" rows={2} />
        </FormField>
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
            disabled={!employees.length}
          >
            <UserRound />
            {t(fr, "Save salary", "Enregistrer le salaire")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function AssignmentDialog({
  fr,
  orgSlug,
  employees,
  components,
  onClose,
}: {
  fr: boolean;
  orgSlug: string;
  employees: Employee[];
  components: Component[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      post(orgUrl(orgSlug, "employee-payroll-components"), body),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["employee-payroll-components", orgSlug],
      });
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const amount = String(f.get("amount") ?? "").trim(),
      percentage = String(f.get("percentage") ?? "").trim(),
      recover = String(f.get("totalToRecover") ?? "").trim();
    save.mutate({
      employeeId: f.get("employeeId"),
      componentId: f.get("componentId"),
      amount: amount ? Number(amount) : null,
      percentage: percentage ? Number(percentage) : null,
      effectiveFrom: f.get("effectiveFrom"),
      effectiveTo: String(f.get("effectiveTo") ?? "").trim() || null,
      totalToRecover: recover ? Number(recover) : null,
      recoveredToDate: 0,
      isActive: true,
      notes: String(f.get("notes") ?? "").trim() || null,
    });
  };
  return (
    <Modal
      title={t(fr, "Assign pay component", "Affecter une composante")}
      onClose={onClose}
    >
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <FormField label={t(fr, "Employee", "Employé")} required>
          <select
            name="employeeId"
            required
            defaultValue=""
            className={selectClass}
          >
            <option value="">
              {t(fr, "Choose an employee", "Choisir un employé")}
            </option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName} · #{e.employeeNumber}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label={t(fr, "Component", "Composante")} required>
          <select
            name="componentId"
            required
            defaultValue=""
            className={selectClass}
          >
            <option value="">
              {t(fr, "Choose a component", "Choisir une composante")}
            </option>
            {components
              .filter((x) => x.isActive)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} · {words(x.componentType)}
                </option>
              ))}
          </select>
        </FormField>
        <FormField label={t(fr, "Amount override", "Montant personnalisé")}>
          <Input name="amount" type="number" min="0" step="0.01" />
        </FormField>
        <FormField
          label={t(fr, "Percentage override", "Pourcentage personnalisé")}
        >
          <Input
            name="percentage"
            type="number"
            min="0"
            max="1000"
            step="0.01"
          />
        </FormField>
        <FormField
          label={t(fr, "Effective from", "Applicable à partir du")}
          required
        >
          <Input
            name="effectiveFrom"
            type="date"
            defaultValue={today()}
            required
          />
        </FormField>
        <FormField label={t(fr, "Effective until", "Applicable jusqu’au")}>
          <Input name="effectiveTo" type="date" />
        </FormField>
        <FormField
          label={t(fr, "Total to recover", "Total à récupérer")}
          hint={t(
            fr,
            "For an advance repayment",
            "Pour le remboursement d’une avance",
          )}
        >
          <Input name="totalToRecover" type="number" min="0" step="0.01" />
        </FormField>
        <FormField label={t(fr, "Notes", "Notes")} className="sm:col-span-2">
          <Textarea name="notes" rows={3} />
        </FormField>
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
            disabled={!employees.length || !components.length}
          >
            <Plus />
            {t(fr, "Assign component", "Affecter")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function PayslipDialog({
  fr,
  item,
  onClose,
}: {
  fr: boolean;
  item: Payslip;
  onClose: () => void;
}) {
  return (
    <Modal title={t(fr, "Payslip", "Bulletin de paie")} onClose={onClose}>
      <div className="mt-5">
        <div className="rounded-xl bg-surface-2 p-4">
          <p className="font-semibold text-ink">{item.employee.fullName}</p>
          <p className="mt-1 text-sm text-ink-secondary">
            #{item.employee.employeeNumber} · {item.employee.jobTitle}
          </p>
        </div>
        <div className="mt-4 divide-y divide-border rounded-xl border border-border">
          {item.lines.map((line) => (
            <div
              key={line.id}
              className="flex items-start justify-between gap-3 p-3"
            >
              <div>
                <p className="text-sm font-medium text-ink">{line.name}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {line.basis || words(line.type)}
                </p>
              </div>
              <p className="text-sm font-semibold text-ink">
                {money(line.amount, item.currency, fr)}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-2 rounded-xl bg-brand/10 p-4 sm:grid-cols-3">
          <Amount
            label={t(fr, "Gross", "Brut")}
            value={money(item.grossPay, item.currency, fr)}
          />
          <Amount
            label={t(fr, "Deductions", "Retenues")}
            value={money(item.totalDeductions, item.currency, fr)}
          />
          <Amount
            label={t(fr, "Net pay", "Net à payer")}
            value={money(item.netPay, item.currency, fr)}
          />
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t(fr, "Close", "Fermer")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
