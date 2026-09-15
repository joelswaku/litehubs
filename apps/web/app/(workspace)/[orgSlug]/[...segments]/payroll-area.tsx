"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeDollarSign,
  Banknote,
  Calculator,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  FileText,
  Landmark,
  Plus,
  ReceiptText,
  Search,
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
import { ApiError, del, get, orgApiUrl, orgUrl, patch, post } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";
import { PayslipStatement } from "@/components/payroll/payslip-statement";

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
  overtimeMultiplier?: number | null;
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
type RunExclusion = {
  id: string;
  employee: Employee;
  reason?: string | null;
  createdAt?: string;
};
type Payslip = {
  id: string;
  reference: string;
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
const isIncomeTaxLine = (line: { code: string; type: string }) =>
  line.type === "deduction" &&
  /(income_?tax|taxe?|imp[ôo]t|withholding)/i.test(line.code);
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
  const [editingRun, setEditingRun] = useState<PayrollRun | null>(null);
  const [dialog, setDialog] = useState<
    | "run"
    | "edit-run"
    | "component"
    | "compensation"
    | "assignment"
    | "end-assignment"
    | null
  >(null);
  const [filter, setFilter] = useState("all");
  const [editingCompensation, setEditingCompensation] =
    useState<Compensation | null>(null);
  const [editingComponent, setEditingComponent] = useState<Component | null>(
    null,
  );
  const [componentPreset, setComponentPreset] = useState<"tax" | null>(null);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(
    null,
  );
  const [endingAssignment, setEndingAssignment] = useState<Assignment | null>(
    null,
  );
  const [assignmentEmployeeId, setAssignmentEmployeeId] = useState<
    string | null
  >(null);
  const [compensationEmployeeId, setCompensationEmployeeId] = useState<
    string | null
  >(null);
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
  const organization = useQuery({
    queryKey: ["payroll-organization-profile", orgSlug],
    queryFn: () =>
      get<{
        organization: {
          displayName?: string | null;
          legalName?: string | null;
          logoUrl?: string | null;
        };
      }>(orgUrl(orgSlug, "")),
    enabled: canRead,
    select: (data) => data.organization,
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
  useEffect(() => {
    const available = runs.data ?? [];
    if (!available.length) return;
    const defaultRun =
      available.find((run) => run.status !== "cancelled") ?? available[0]!;
    setSelectedRun((current) =>
      current && available.some((run) => run.id === current.id)
        ? current
        : defaultRun,
    );
  }, [runs.data]);
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
  const exclusions = useQuery({
    queryKey: ["payroll-run-exclusions", orgSlug, selectedRun?.id],
    queryFn: () =>
      get<{ exclusions: RunExclusion[] }>(
        orgUrl(orgSlug, `payroll-runs/${selectedRun!.id}/exclusions`),
      ),
    enabled: canRead && Boolean(selectedRun),
    select: (data) => data.exclusions,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["payroll-runs", orgSlug] });
    void client.invalidateQueries({ queryKey: ["payroll-summary", orgSlug] });
    void client.invalidateQueries({
      queryKey: ["payroll-payslips", orgSlug, selectedRun?.id],
    });
    void client.invalidateQueries({
      queryKey: ["payroll-run-exclusions", orgSlug, selectedRun?.id],
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
  const excludeEmployee = useMutation({
    mutationFn: ({
      runId,
      employeeId,
    }: {
      runId: string;
      employeeId: string;
    }) =>
      post<{ payrollRun: PayrollRun }>(
        orgUrl(orgSlug, `payroll-runs/${runId}/exclusions`),
        { employeeId },
      ),
    onSuccess: (data, variables) => {
      setSelectedRun(data.payrollRun);
      refresh();
      calculate.mutate(variables.runId);
    },
  });
  const includeEmployee = useMutation({
    mutationFn: ({
      runId,
      employeeId,
    }: {
      runId: string;
      employeeId: string;
    }) =>
      del<{ payrollRun: PayrollRun }>(
        orgUrl(orgSlug, `payroll-runs/${runId}/exclusions/${employeeId}`),
      ),
    onSuccess: (data, variables) => {
      setSelectedRun(data.payrollRun);
      refresh();
      calculate.mutate(variables.runId);
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
              onClick={() => {
                setEditingCompensation(null);
                setDialog("compensation");
              }}
            >
              <UserRound />
              {t(fr, "Set salary", "Définir un salaire")}
            </Button>
          ) : null}
        </div>
      </header>
      <div className="flex justify-end">
        <HrPdfButton
          orgSlug={orgSlug}
          report="payroll"
          fr={fr}
          className="border-brand/30 bg-brand/10 text-brand hover:bg-brand/15"
        />
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
          orgSlug={orgSlug}
          organization={organization.data}
          selected={selected}
          payslips={payslips.data ?? []}
          pending={payslips.isPending}
          error={apiError(payslips.error)}
          canCreate={canCreate}
          canUpdate={canUpdate}
          canApprove={canApprove}
          canReject={canReject}
          exclusions={exclusions.data ?? []}
          exclusionsPending={exclusions.isPending}
          exclusionsError={apiError(exclusions.error)}
          onEditRun={() => {
            if (!selected) return;
            setEditingRun(selected);
            setDialog("edit-run");
          }}
          calculate={calculate}
          excludeEmployee={excludeEmployee}
          includeEmployee={includeEmployee}
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
          onAddSalary={(employeeId) => {
            setEditingCompensation(null);
            setCompensationEmployeeId(employeeId ?? null);
            setDialog("compensation");
          }}
          onEditSalary={(record) => {
            setEditingCompensation(record);
            setCompensationEmployeeId(null);
            setDialog("compensation");
          }}
          onAddComponent={(employeeId) => {
            setEditingAssignment(null);
            setAssignmentEmployeeId(employeeId ?? null);
            setDialog("assignment");
          }}
          onEditComponent={(assignment) => {
            setEditingAssignment(assignment);
            setAssignmentEmployeeId(null);
            setDialog("assignment");
          }}
          onEndComponent={(assignment) => {
            setEndingAssignment(assignment);
            setDialog("end-assignment");
          }}
          canCreate={canCreate}
          canUpdate={canUpdate}
        />
      ) : null}
      {tab === "components" ? (
        <ComponentsPanel
          fr={fr}
          rows={components.data ?? []}
          canCreate={canCreate}
          canUpdate={canUpdate}
          onAdd={() => {
            setEditingComponent(null);
            setComponentPreset(null);
            setDialog("component");
          }}
          onAddTax={() => {
            setEditingComponent(null);
            setComponentPreset("tax");
            setDialog("component");
          }}
          onEdit={(component) => {
            setEditingComponent(component);
            setComponentPreset(null);
            setDialog("component");
          }}
        />
      ) : null}
      {dialog === "run" ? (
        <RunDialog
          fr={fr}
          orgSlug={orgSlug}
          editing={null}
          onClose={() => setDialog(null)}
          onSaved={(run) => {
            setSelectedRun(run);
            setDialog(null);
            refresh();
          }}
        />
      ) : null}
      {dialog === "edit-run" && editingRun ? (
        <RunDialog
          fr={fr}
          orgSlug={orgSlug}
          editing={editingRun}
          onClose={() => {
            setEditingRun(null);
            setDialog(null);
          }}
          onSaved={(run) => {
            setSelectedRun(run);
            setEditingRun(null);
            setDialog(null);
            refresh();
          }}
        />
      ) : null}{" "}
      {dialog === "component" ? (
        <ComponentDialog
          fr={fr}
          orgSlug={orgSlug}
          editing={editingComponent}
          preset={componentPreset}
          onClose={() => {
            setEditingComponent(null);
            setComponentPreset(null);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === "compensation" ? (
        <CompensationDialog
          fr={fr}
          orgSlug={orgSlug}
          employees={employees.data ?? []}
          occupiedEmployeeIds={(compensation.data ?? [])
            .filter(
              (record) => !record.effectiveTo || record.effectiveTo >= today(),
            )
            .map((record) => record.employee.id)}
          editing={editingCompensation}
          defaultEmployeeId={compensationEmployeeId}
          onClose={() => {
            setEditingCompensation(null);
            setCompensationEmployeeId(null);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === "assignment" ? (
        <AssignmentDialog
          fr={fr}
          orgSlug={orgSlug}
          employees={employees.data ?? []}
          components={components.data ?? []}
          editing={editingAssignment}
          defaultEmployeeId={assignmentEmployeeId}
          onClose={() => {
            setEditingAssignment(null);
            setAssignmentEmployeeId(null);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === "end-assignment" && endingAssignment ? (
        <EndComponentDialog
          fr={fr}
          orgSlug={orgSlug}
          assignment={endingAssignment}
          onClose={() => {
            setEndingAssignment(null);
            setDialog(null);
          }}
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
  orgSlug,
  organization,
  selected,
  payslips,
  pending,
  error,
  canCreate,
  canUpdate,
  canApprove,
  canReject,
  exclusions,
  exclusionsPending,
  exclusionsError,
  onEditRun,
  calculate,
  excludeEmployee,
  includeEmployee,
  approve,
  paid,
  cancel,
}: {
  fr: boolean;
  orgSlug: string;
  organization?: {
    displayName?: string | null;
    legalName?: string | null;
    logoUrl?: string | null;
  };
  selected: PayrollRun | null;
  payslips: Payslip[];
  pending: boolean;
  error: string | null;
  canCreate: boolean;
  canUpdate: boolean;
  canApprove: boolean;
  canReject: boolean;
  exclusions: RunExclusion[];
  exclusionsPending: boolean;
  exclusionsError: string | null;
  onEditRun: () => void;
  calculate: any;
  excludeEmployee: any;
  includeEmployee: any;
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
  const editable =
    ["draft", "calculated"].includes(selected.status) && canUpdate;
  const problem =
    apiError(calculate.error) ||
    apiError(excludeEmployee.error) ||
    apiError(includeEmployee.error) ||
    apiError(approve.error) ||
    apiError(paid.error) ||
    apiError(cancel.error) ||
    exclusionsError ||
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
          {editable ? (
            <Button variant="secondary" onClick={onEditRun}>
              <Settings2 />
              {t(fr, "Edit run", "Modifier le cycle")}
            </Button>
          ) : null}
          {["draft", "calculated"].includes(selected.status) && canCreate ? (
            <Button
              onClick={() => calculate.mutate(selected.id)}
              loading={calculate.isPending}
            >
              <Calculator />
              {selected.status === "calculated"
                ? t(fr, "Recalculate payslips", "Recalculer les bulletins")
                : t(fr, "Calculate payslips", "Calculer les bulletins")}
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
          {editable && canReject ? (
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
      {selected.status === "calculated" ? (
        <p className="border-b border-border bg-amber-500/10 px-5 py-3 text-sm text-ink-secondary">
          {t(
            fr,
            "Salary, component and employee selection changes take effect when payslips are recalculated. Draft payslips will be replaced.",
            "Les modifications de salaire, de composante ou d’employé prennent effet au prochain recalcul. Les bulletins non approuvés seront remplacés.",
          )}
        </p>
      ) : null}
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
            <div
              key={slip.id}
              className="flex flex-wrap items-center gap-3 p-5 transition hover:bg-surface-2"
            >
              <button
                type="button"
                onClick={() => setOpen(slip)}
                className="grid min-w-[14rem] flex-1 gap-3 text-left sm:grid-cols-[1.2fr_auto_auto_auto] sm:items-center"
              >
                <div>
                  <p className="font-semibold text-ink">
                    {slip.employee.fullName}
                  </p>
                  <p className="mt-1 text-xs text-ink-secondary">
                    #{slip.employee.employeeNumber} · {slip.employee.jobTitle}
                  </p>
                  <p className="mt-1 text-xs font-semibold tracking-wide text-brand">
                    {slip.reference}
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
              {editable ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    excludeEmployee.mutate({
                      runId: selected.id,
                      employeeId: slip.employee.id,
                    })
                  }
                  loading={excludeEmployee.isPending}
                >
                  <X />
                  {t(fr, "Exclude", "Exclure")}
                </Button>
              ) : null}
            </div>
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
      {exclusionsPending ? (
        <div className="border-t border-border p-5">
          <SkeletonCard rows={2} />
        </div>
      ) : exclusions.length ? (
        <div className="border-t border-border bg-surface-2/45 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-ink">
                {t(
                  fr,
                  "Employees excluded from this run",
                  "Employés exclus de ce cycle",
                )}
              </h3>
              <p className="mt-1 text-sm text-ink-secondary">
                {t(
                  fr,
                  "They will not be paid in this cycle. You can restore them before approval.",
                  "Ils ne seront pas payés dans ce cycle. Vous pouvez les réintégrer avant l’approbation.",
                )}
              </p>
            </div>
            <Badge variant="outline">{exclusions.length}</Badge>
          </div>
          <div className="mt-3 grid gap-2">
            {exclusions.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 px-3 py-3"
              >
                <div>
                  <p className="font-medium text-ink">
                    {item.employee.fullName}
                  </p>
                  <p className="text-xs text-ink-secondary">
                    #{item.employee.employeeNumber} · {item.employee.jobTitle}
                  </p>
                </div>
                {editable ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      includeEmployee.mutate({
                        runId: selected.id,
                        employeeId: item.employee.id,
                      })
                    }
                    loading={includeEmployee.isPending}
                  >
                    <Plus />
                    {t(fr, "Restore", "Réintégrer")}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {open ? (
        <PayslipDialog
          fr={fr}
          orgSlug={orgSlug}
          organization={organization}
          item={open}
          run={selected}
          downloadable={["approved", "paid"].includes(selected.status)}
          onClose={() => setOpen(null)}
        />
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
  onEditSalary,
  onAddComponent,
  onEditComponent,
  onEndComponent,
  canCreate,
  canUpdate,
}: {
  fr: boolean;
  rows: Compensation[];
  assignments: Assignment[];
  onAddSalary: (employeeId?: string) => void;
  onEditSalary: (record: Compensation) => void;
  onAddComponent: (employeeId?: string) => void;
  onEditComponent: (assignment: Assignment) => void;
  onEndComponent: (assignment: Assignment) => void;
  canCreate: boolean;
  canUpdate: boolean;
}) {
  type RemunerationGroup = {
    employee: Employee;
    salaries: Compensation[];
    components: Assignment[];
  };
  const grouped = new Map<string, RemunerationGroup>();
  const include = (employee: Employee) => {
    const current = grouped.get(employee.id);
    if (current) return current;
    const next = { employee, salaries: [], components: [] };
    grouped.set(employee.id, next);
    return next;
  };
  rows.forEach((salary) => include(salary.employee).salaries.push(salary));
  assignments.forEach((component) =>
    include(component.employee).components.push(component),
  );
  const people = Array.from(grouped.values()).sort((a, b) =>
    a.employee.fullName.localeCompare(b.employee.fullName),
  );
  const assignmentValue = (item: Assignment) =>
    item.amount ??
    (item.percentage != null
      ? `${item.percentage}%`
      : (item.component.defaultAmount ??
        (item.component.percentage != null
          ? `${item.component.percentage}%`
          : "—")));
  const isPersonal = (item: Assignment) =>
    item.amount != null || item.percentage != null;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [showEndedComponents, setShowEndedComponents] = useState(false);
  const pageSize = 8;
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredPeople = normalizedSearch
    ? people.filter((person) =>
        [
          person.employee.fullName,
          person.employee.employeeNumber,
          person.employee.jobTitle,
          ...person.components.map((item) => item.component.name),
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedSearch),
      )
    : people;
  const totalPages = Math.max(1, Math.ceil(filteredPeople.length / pageSize));
  const activePage = Math.min(page, totalPages - 1);
  const visiblePeople = filteredPeople.slice(
    activePage * pageSize,
    (activePage + 1) * pageSize,
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-border-strong bg-surface-1 shadow-[0_18px_42px_-32px_rgba(15,23,42,.55)]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-[linear-gradient(115deg,rgba(20,184,166,.08),transparent_55%)] px-5 py-5 sm:px-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.14em] text-brand">
            {t(fr, "Employee pay", "Rémunération des employés")}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-ink">
            {t(
              fr,
              "Salary and components by employee",
              "Salaire et composantes par employé",
            )}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-secondary">
            {t(
              fr,
              "Each employee's salary, allowances and deductions are kept together for a clear payroll review.",
              "Le salaire, les primes et les retenues de chaque employé restent regroupés pour une lecture claire.",
            )}
          </p>
        </div>
        {canCreate ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onAddComponent()}
            >
              <Plus />
              {t(fr, "Add component", "Ajouter une composante")}
            </Button>
            <Button size="sm" onClick={() => onAddSalary()}>
              <Plus />
              {t(fr, "Set salary", "Définir un salaire")}
            </Button>
          </div>
        ) : null}
      </div>

      {people.length ? (
        <div className="bg-surface-2/40 p-4 sm:p-5">
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <label className="relative block w-full sm:max-w-md">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
                aria-hidden
              />
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                placeholder={t(
                  fr,
                  "Search by employee, number, role or component…",
                  "Rechercher un employé, matricule, poste ou composante…",
                )}
                aria-label={t(
                  fr,
                  "Search employee pay",
                  "Rechercher une rémunération",
                )}
                className="h-10 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
            </label>
            <p className="shrink-0 text-xs font-semibold text-ink-secondary">
              {filteredPeople.length} / {people.length}{" "}
              {t(fr, "employees", "employés")}
            </p>
          </div>
          {assignments.some(
            (item) =>
              !item.isActive ||
              (item.effectiveTo && item.effectiveTo < today()),
          ) ? (
            <div className="mb-4 flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowEndedComponents((value) => !value)}
              >
                {showEndedComponents
                  ? t(
                      fr,
                      "Hide ended components",
                      "Masquer les composantes terminées",
                    )
                  : t(
                      fr,
                      "Show ended components",
                      "Afficher les composantes terminées",
                    )}
              </Button>
            </div>
          ) : null}
          {visiblePeople.length ? (
            <div className="space-y-4">
              {visiblePeople.map((person) => {
                const currency = person.salaries[0]?.currency ?? "CDF";
                const salaryRows = [...person.salaries].sort((a, b) =>
                  b.effectiveFrom.localeCompare(a.effectiveFrom),
                );
                const activeComponents = person.components.filter(
                  (item) =>
                    item.isActive &&
                    (!item.effectiveTo || item.effectiveTo >= today()),
                );
                const endedComponents = person.components.filter(
                  (item) =>
                    !activeComponents.some((active) => active.id === item.id),
                );
                const componentRows = showEndedComponents
                  ? person.components
                  : activeComponents;
                return (
                  <article
                    key={person.employee.id}
                    className="overflow-hidden rounded-2xl border border-border-strong bg-surface-1 shadow-sm"
                  >
                    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-[linear-gradient(110deg,rgba(20,184,166,.07),transparent_60%)] px-4 py-4 sm:px-5">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-brand/20 bg-brand-subtle text-sm font-bold text-brand">
                          {person.employee.fullName.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-semibold text-ink">
                            {person.employee.fullName}
                          </h3>
                          <p className="mt-0.5 truncate text-xs text-ink-secondary">
                            #{person.employee.employeeNumber} ·{" "}
                            {person.employee.jobTitle}
                          </p>
                        </div>
                      </div>
                      <span className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-secondary">
                        {salaryRows.length}{" "}
                        {t(
                          fr,
                          salaryRows.length === 1
                            ? "salary record"
                            : "salary records",
                          salaryRows.length === 1
                            ? "salaire défini"
                            : "salaires définis",
                        )}{" "}
                        · {person.components.length}{" "}
                        {t(
                          fr,
                          person.components.length === 1
                            ? "component"
                            : "components",
                          person.components.length === 1
                            ? "composante"
                            : "composantes",
                        )}
                      </span>
                    </header>
                    <div className="grid divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
                      <section className="p-4 sm:p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[.12em] text-ink-muted">
                              {t(fr, "Base salary", "Salaire de base")}
                            </p>
                            <p className="mt-1 text-xs text-ink-secondary">
                              {t(
                                fr,
                                "Effective-dated history",
                                "Historique daté",
                              )}
                            </p>
                          </div>
                          {canCreate && salaryRows.length === 0 ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => onAddSalary(person.employee.id)}
                            >
                              <Plus />
                              {t(fr, "Set", "Définir")}
                            </Button>
                          ) : null}
                        </div>
                        {salaryRows.length ? (
                          <div className="mt-4 space-y-3">
                            {salaryRows.map((salary) => (
                              <div
                                key={salary.id}
                                className="rounded-xl border border-border bg-surface-2/55 p-3.5"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <p className="text-lg font-semibold tabular-nums text-ink">
                                      {money(
                                        salary.basicSalary,
                                        salary.currency,
                                        fr,
                                      )}
                                    </p>
                                    <p className="mt-1 text-xs text-ink-secondary">
                                      {words(salary.payFrequency)} ·{" "}
                                      {words(salary.paymentMethod)}
                                    </p>
                                  </div>
                                  {canUpdate ? (
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => onEditSalary(salary)}
                                    >
                                      <Settings2 />
                                      {t(fr, "Edit", "Modifier")}
                                    </Button>
                                  ) : null}
                                </div>
                                <p className="mt-3 border-t border-border pt-2.5 text-xs leading-5 text-ink-secondary">
                                  {date(salary.effectiveFrom, fr)}{" "}
                                  {salary.effectiveTo
                                    ? `→ ${date(salary.effectiveTo, fr)}`
                                    : `→ ${t(fr, "No end date", "sans fin")}`}
                                  {salary.contractHoursPerWeek
                                    ? ` · ${salary.contractHoursPerWeek} ${t(fr, "h/week", "h/semaine")}`
                                    : ""}
                                  {salary.overtimeMultiplier
                                    ? ` · ${t(fr, "Overtime ×", "Heures suppl. ×")}${salary.overtimeMultiplier}`
                                    : ""}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-4 rounded-xl border border-dashed border-border bg-surface-2/40 px-3 py-4 text-sm text-ink-secondary">
                            {t(
                              fr,
                              "No salary is set for this employee.",
                              "Aucun salaire n’est défini pour cet employé.",
                            )}
                          </p>
                        )}
                      </section>
                      <section className="p-4 sm:p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[.12em] text-ink-muted">
                              {t(
                                fr,
                                "Personal components",
                                "Primes et retenues",
                              )}
                            </p>
                            <p className="mt-1 text-xs text-ink-secondary">
                              {t(
                                fr,
                                "Allowances, deductions and recovery plans",
                                "Indemnités, retenues et récupérations",
                              )}
                            </p>
                          </div>
                          {canCreate ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => onAddComponent(person.employee.id)}
                            >
                              <Plus />
                              {t(fr, "Add", "Ajouter")}
                            </Button>
                          ) : null}
                        </div>
                        {componentRows.length ? (
                          <div className="mt-4 space-y-3">
                            {componentRows.map((item) => {
                              const amount = assignmentValue(item);
                              return (
                                <div
                                  key={item.id}
                                  className="rounded-xl border border-border bg-surface-2/55 p-3.5"
                                >
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="font-semibold text-ink">
                                        {item.component.name}
                                      </p>
                                      <p className="mt-1 text-xs text-ink-secondary">
                                        {words(item.component.componentType)} ·{" "}
                                        {isPersonal(item)
                                          ? t(
                                              fr,
                                              "Personal amount",
                                              "Montant personnalisé",
                                            )
                                          : t(
                                              fr,
                                              "Template amount",
                                              "Montant du modèle",
                                            )}
                                      </p>
                                    </div>
                                    <div className="text-right">
                                      <p className="text-base font-semibold tabular-nums text-ink">
                                        {typeof amount === "number"
                                          ? money(amount, currency, fr)
                                          : amount}
                                      </p>
                                      {isPersonal(item) ? (
                                        <p className="mt-1 text-[11px] text-ink-muted">
                                          {t(fr, "Template", "Modèle")} :{" "}
                                          {item.component.defaultAmount != null
                                            ? money(
                                                item.component.defaultAmount,
                                                currency,
                                                fr,
                                              )
                                            : item.component.percentage != null
                                              ? `${item.component.percentage}%`
                                              : "—"}
                                        </p>
                                      ) : null}
                                    </div>
                                  </div>
                                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
                                    <p className="text-xs text-ink-muted">
                                      {date(item.effectiveFrom, fr)}{" "}
                                      {item.effectiveTo
                                        ? `→ ${date(item.effectiveTo, fr)}`
                                        : `→ ${t(fr, "No end date", "sans fin")}`}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-1">
                                      {canUpdate ? (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => onEditComponent(item)}
                                        >
                                          <Settings2 />
                                          {t(
                                            fr,
                                            "Edit allowance",
                                            "Modifier la prime",
                                          )}
                                        </Button>
                                      ) : null}
                                      {canUpdate &&
                                      item.isActive &&
                                      (!item.effectiveTo ||
                                        item.effectiveTo >= today()) ? (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => onEndComponent(item)}
                                        >
                                          <X />
                                          {t(fr, "End", "Terminer")}
                                        </Button>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="mt-4 rounded-xl border border-dashed border-border bg-surface-2/40 px-3 py-4 text-sm text-ink-secondary">
                            {t(
                              fr,
                              "No recurring component for this employee.",
                              "Aucune composante récurrente pour cet employé.",
                            )}
                          </p>
                        )}
                      </section>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-surface-1 px-5 py-12 text-center">
              <Search className="mx-auto size-5 text-ink-muted" aria-hidden />
              <p className="mt-3 font-semibold text-ink">
                {t(fr, "No employee found", "Aucun employé trouvé")}
              </p>
              <p className="mt-1 text-sm text-ink-secondary">
                {t(
                  fr,
                  "Try an employee name, number, role or pay component.",
                  "Essayez un nom, matricule, poste ou nom de composante.",
                )}
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-4"
                onClick={() => setSearch("")}
              >
                {t(fr, "Clear search", "Effacer la recherche")}
              </Button>
            </div>
          )}
          {filteredPeople.length > pageSize ? (
            <nav
              className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 px-3 py-2.5"
              aria-label={t(fr, "Employee pay pages", "Pages de rémunération")}
            >
              <Button
                size="sm"
                variant="secondary"
                disabled={activePage === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                <ChevronLeft />
                {t(fr, "Previous", "Précédent")}
              </Button>
              <p className="text-xs font-semibold text-ink-secondary">
                {t(fr, "Page", "Page")} {activePage + 1} {t(fr, "of", "sur")}{" "}
                {totalPages}
              </p>
              <Button
                size="sm"
                variant="secondary"
                disabled={activePage >= totalPages - 1}
                onClick={() =>
                  setPage((current) => Math.min(totalPages - 1, current + 1))
                }
              >
                {t(fr, "Next", "Suivant")}
                <ChevronRight />
              </Button>
            </nav>
          ) : null}
        </div>
      ) : (
        <EmptyState
          icon={UsersRound}
          title={t(
            fr,
            "No employee pay record yet",
            "Aucune rémunération définie",
          )}
          description={t(
            fr,
            "Set a salary or assign a pay component to begin.",
            "Définissez un salaire ou affectez une composante pour commencer.",
          )}
          action={
            canCreate
              ? {
                  label: t(fr, "Set salary", "Définir un salaire"),
                  onClick: () => onAddSalary(),
                }
              : undefined
          }
        />
      )}
    </section>
  );
}
function ComponentsPanel({
  fr,
  rows,
  canCreate,
  canUpdate,
  onAdd,
  onAddTax,
  onEdit,
}: {
  fr: boolean;
  rows: Component[];
  canCreate: boolean;
  canUpdate: boolean;
  onAdd: () => void;
  onAddTax: () => void;
  onEdit: (component: Component) => void;
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
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onAddTax}>
              <Landmark />
              {t(fr, "Set income tax", "Définir l’impôt")}
            </Button>
            <Button onClick={onAdd}>
              <Plus />
              {t(fr, "Add component", "Ajouter une composante")}
            </Button>
          </div>
        ) : null}
      </div>
      {rows.length ? (
        <div className="divide-y divide-border">
          {rows.map((item) => (
            <article
              key={item.id}
              className="grid gap-3 p-5 sm:grid-cols-[1.2fr_auto_auto_auto_auto] sm:items-center"
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
              {canUpdate ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onEdit(item)}
                >
                  <Settings2 />
                  {t(fr, "Edit", "Modifier")}
                </Button>
              ) : null}
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
  editing,
  onClose,
  onSaved,
}: {
  fr: boolean;
  orgSlug: string;
  editing: PayrollRun | null;
  onClose: () => void;
  onSaved: (run: PayrollRun) => void;
}) {
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? patch<{ payrollRun: PayrollRun }>(
            orgUrl(orgSlug, `payroll-runs/${editing.id}`),
            body,
          )
        : post<{ payrollRun: PayrollRun }>(
            orgUrl(orgSlug, "payroll-runs"),
            body,
          ),
    onSuccess: (data) => onSaved(data.payrollRun),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    save.mutate({
      ...(editing
        ? { reference: String(f.get("reference") ?? "").trim() }
        : {}),
      periodStart: String(f.get("periodStart") ?? ""),
      periodEnd: String(f.get("periodEnd") ?? ""),
      payDate: String(f.get("payDate") ?? ""),
      currency: String(f.get("currency") ?? "USD"),
      notes: String(f.get("notes") ?? "").trim() || null,
    });
  };
  return (
    <Modal
      title={
        editing
          ? `${t(fr, "Edit payroll run", "Modifier le cycle")} · ${editing.reference}`
          : t(fr, "New payroll run", "Nouveau cycle de paie")
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        {editing ? (
          <p className="sm:col-span-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-ink-secondary">
            {t(
              fr,
              "Changing the period, currency or scope returns this cycle to Draft and clears its unapproved payslips. The cycle must then be recalculated.",
              "Changer la période, la devise ou le périmètre replace ce cycle en brouillon et efface ses bulletins non approuvés. Il faudra ensuite le recalculer.",
            )}
          </p>
        ) : null}
        {editing ? (
          <FormField label={t(fr, "Reference", "Référence")} required>
            <Input name="reference" required defaultValue={editing.reference} />
          </FormField>
        ) : (
          <div className="rounded-xl border border-brand/25 bg-brand/5 px-4 py-3 text-sm leading-6 text-ink-secondary">
            <p className="font-semibold text-ink">
              {t(fr, "Automatic reference", "Référence automatique")}
            </p>
            <p>
              {t(
                fr,
                "The cycle will receive a reference such as PAIE202609001. The year and month come from the period start date; the last number increases automatically for each cycle created that month.",
                "Le cycle recevra une référence telle que PAIE202609001. L’année et le mois proviennent du début de période ; le dernier numéro augmente automatiquement pour chaque cycle créé ce mois-là.",
              )}
            </p>
          </div>
        )}
        <FormField label={t(fr, "Currency", "Devise")} required>
          <select
            name="currency"
            defaultValue={editing?.currency ?? "USD"}
            className={selectClass}
          >
            <option value="USD">USD — US dollar</option>
            <option value="CDF">CDF — Franc congolais</option>
            <option value="EUR">EUR — Euro</option>
          </select>
        </FormField>
        <FormField label={t(fr, "Period start", "Début de période")} required>
          <Input
            name="periodStart"
            type="date"
            required
            defaultValue={editing?.periodStart?.slice(0, 10) ?? ""}
          />
        </FormField>
        <FormField label={t(fr, "Period end", "Fin de période")} required>
          <Input
            name="periodEnd"
            type="date"
            required
            defaultValue={editing?.periodEnd?.slice(0, 10) ?? ""}
          />
        </FormField>
        <FormField label={t(fr, "Pay date", "Date de paiement")} required>
          <Input
            name="payDate"
            type="date"
            defaultValue={editing?.payDate?.slice(0, 10) ?? today()}
            required
          />
        </FormField>
        <FormField label={t(fr, "Notes", "Notes")} className="sm:col-span-2">
          <Textarea
            name="notes"
            rows={3}
            defaultValue={editing?.notes ?? ""}
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
            {editing ? <Settings2 /> : <Plus />}
            {editing
              ? t(fr, "Save changes", "Enregistrer les modifications")
              : t(fr, "Create payroll run", "Créer le cycle")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function ComponentDialog({
  fr,
  orgSlug,
  editing,
  preset,
  onClose,
}: {
  fr: boolean;
  orgSlug: string;
  editing: Component | null;
  preset?: "tax" | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const taxPreset = !editing && preset === "tax";
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? patch(orgUrl(orgSlug, `payroll-components/${editing.id}`), body)
        : post(orgUrl(orgSlug, "payroll-components"), body),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["payroll-components", orgSlug],
      });
      void client.invalidateQueries({
        queryKey: ["employee-payroll-components", orgSlug],
      });
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    const enteredCode = String(f.get("code") ?? "").trim();
    const generatedCode = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
    const code = enteredCode || editing?.code || generatedCode;
    const amount = String(f.get("defaultAmount") ?? "").trim(),
      percentage = String(f.get("percentage") ?? "").trim();
    save.mutate({
      name,
      code,
      componentType: f.get("componentType"),
      calculation: f.get("calculation"),
      defaultAmount: amount === "" ? null : Number(amount),
      percentage: percentage === "" ? null : Number(percentage),
      isTaxable: f.get("isTaxable") === "on",
      affectsGross: f.get("affectsGross") === "on",
      notes: String(f.get("notes") ?? "").trim() || null,
    });
  };
  return (
    <Modal
      title={
        editing
          ? `${t(fr, "Edit pay component", "Modifier la composante")} · ${editing.name}`
          : taxPreset
            ? t(fr, "Set income tax", "Définir l’impôt sur le revenu")
            : t(fr, "Add pay component", "Ajouter une composante de paie")
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        {taxPreset ? (
          <div className="sm:col-span-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-ink-secondary">
            {t(
              fr,
              "Set the rate your company is legally required to withhold. LiteHubs does not impose a country tax rate; confirm it with your payroll adviser.",
              "Définissez le taux que votre entreprise doit légalement retenir. LiteHubs n’impose aucun taux national : confirmez-le avec votre conseiller paie.",
            )}
          </div>
        ) : null}
        <FormField label={t(fr, "Name", "Nom")} required>
          <Input
            name="name"
            required
            defaultValue={
              editing?.name ??
              (taxPreset ? t(fr, "Income tax", "Impôt sur le revenu") : "")
            }
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
          <Input
            name="code"
            defaultValue={editing?.code ?? (taxPreset ? "income_tax" : "")}
          />
        </FormField>
        <FormField label={t(fr, "Type", "Type")} required>
          <select
            name="componentType"
            defaultValue={
              editing?.componentType ?? (taxPreset ? "deduction" : "earning")
            }
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
            defaultValue={
              editing?.calculation ??
              (taxPreset ? "percentage_of_gross" : "fixed")
            }
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
          <Input
            name="defaultAmount"
            type="number"
            defaultValue={editing?.defaultAmount ?? ""}
            min="0"
            step="0.01"
          />
        </FormField>
        <FormField label={t(fr, "Percentage", "Pourcentage")}>
          <Input
            name="percentage"
            type="number"
            defaultValue={editing?.percentage ?? (taxPreset ? 0 : "")}
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
              defaultChecked={editing?.isTaxable ?? !taxPreset}
              className="size-4 accent-[var(--brand)]"
            />
            {t(fr, "Taxable", "Imposable")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="affectsGross"
              defaultChecked={editing?.affectsGross ?? !taxPreset}
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
          <Textarea
            name="notes"
            rows={3}
            defaultValue={
              editing?.notes ??
              (taxPreset
                ? t(
                    fr,
                    "Configured income-tax withholding. Verify the rate and applicability with your payroll adviser.",
                    "Retenue d’impôt configurée. Vérifiez le taux et son application avec votre conseiller paie.",
                  )
                : "")
            }
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
            {editing
              ? t(fr, "Save changes", "Enregistrer les modifications")
              : t(fr, "Create component", "Créer la composante")}
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
  occupiedEmployeeIds,
  editing,
  defaultEmployeeId,
  onClose,
}: {
  fr: boolean;
  orgSlug: string;
  employees: Employee[];
  occupiedEmployeeIds: string[];
  editing: Compensation | null;
  defaultEmployeeId?: string | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const availableEmployees = editing
    ? employees
    : employees.filter(
        (employee) => !occupiedEmployeeIds.includes(employee.id),
      );
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? patch(orgUrl(orgSlug, `employee-compensation/${editing.id}`), body)
        : post(orgUrl(orgSlug, "employee-compensation"), body),
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
    const overtimeMultiplier = String(f.get("overtimeMultiplier") ?? "").trim();
    const payload = {
      effectiveFrom: f.get("effectiveFrom"),
      effectiveTo: String(f.get("effectiveTo") ?? "").trim() || null,
      currency: f.get("currency"),
      basicSalary: Number(f.get("basicSalary")),
      payFrequency: f.get("payFrequency"),
      contractHoursPerWeek: hours ? Number(hours) : null,
      overtimeMultiplier: overtimeMultiplier
        ? Number(overtimeMultiplier)
        : null,
      paymentMethod: f.get("paymentMethod"),
      bankName: String(f.get("bankName") ?? "").trim() || null,
      bankAccount: String(f.get("bankAccount") ?? "").trim() || null,
      mobileMoneyNumber:
        String(f.get("mobileMoneyNumber") ?? "").trim() || null,
      notes: String(f.get("notes") ?? "").trim() || null,
    };
    save.mutate(
      editing ? payload : { ...payload, employeeId: f.get("employeeId") },
    );
  };
  return (
    <Modal
      title={
        editing
          ? `${t(fr, "Edit salary", "Modifier le salaire")} · ${editing.employee.fullName}`
          : t(fr, "Set employee salary", "Définir le salaire d’un employé")
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <FormField label={t(fr, "Employee", "Employé")} required>
          <select
            name="employeeId"
            required
            defaultValue={editing?.employee.id ?? defaultEmployeeId ?? ""}
            disabled={Boolean(editing)}
            className={selectClass}
          >
            <option value="">
              {availableEmployees.length
                ? t(fr, "Choose an employee", "Choisir un employé")
                : t(
                    fr,
                    "Every employee already has an active salary",
                    "Tous les employés ont déjà un salaire actif",
                  )}
            </option>
            {availableEmployees.map((e) => (
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
            defaultValue={editing?.basicSalary ?? ""}
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
            defaultValue={editing?.effectiveFrom ?? today()}
            required
          />
        </FormField>
        <FormField label={t(fr, "Effective until", "Applicable jusqu’au")}>
          <Input
            name="effectiveTo"
            type="date"
            defaultValue={editing?.effectiveTo ?? ""}
          />
        </FormField>
        <FormField label={t(fr, "Currency", "Devise")} required>
          <select
            name="currency"
            defaultValue={editing?.currency ?? "USD"}
            className={selectClass}
          >
            <option value="USD">USD</option>
            <option value="CDF">CDF</option>
            <option value="EUR">EUR</option>
          </select>
        </FormField>
        <FormField label={t(fr, "Pay frequency", "Fréquence de paie")}>
          <select
            name="payFrequency"
            defaultValue={editing?.payFrequency ?? "monthly"}
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
            defaultValue={editing?.paymentMethod ?? "bank_transfer"}
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
        <FormField
          label={t(fr, "Hours per week", "Heures par semaine")}
          hint={t(
            fr,
            "Used to calculate the hourly reference for a monthly salary.",
            "Utilisées pour calculer la référence horaire du salaire mensuel.",
          )}
        >
          <Input
            name="hours"
            type="number"
            defaultValue={editing?.contractHoursPerWeek ?? ""}
            min="1"
            max="168"
            step="0.5"
          />
        </FormField>
        <FormField
          label={t(
            fr,
            "Overtime multiplier",
            "Coefficient heures supplémentaires",
          )}
          hint={t(
            fr,
            "Leave blank to track overtime without adding it to payroll.",
            "Laissez vide pour suivre les heures supplémentaires sans les ajouter automatiquement à la paie.",
          )}
        >
          <Input
            name="overtimeMultiplier"
            type="number"
            defaultValue={editing?.overtimeMultiplier ?? ""}
            min="1"
            max="10"
            step="0.01"
            placeholder="1.50"
          />
        </FormField>
        <FormField label={t(fr, "Bank name", "Banque")}>
          <Input name="bankName" defaultValue={editing?.bankName ?? ""} />
        </FormField>
        <FormField label={t(fr, "Account number", "Numéro de compte")}>
          <Input name="bankAccount" defaultValue={editing?.bankAccount ?? ""} />
        </FormField>
        <FormField label="Mobile money">
          <Input
            name="mobileMoneyNumber"
            defaultValue={editing?.mobileMoneyNumber ?? ""}
          />
        </FormField>
        <FormField label={t(fr, "Notes", "Notes")} className="sm:col-span-2">
          <Textarea name="notes" rows={2} defaultValue={editing?.notes ?? ""} />
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
            disabled={!availableEmployees.length && !editing}
          >
            <UserRound />
            {editing
              ? t(fr, "Save changes", "Enregistrer les modifications")
              : t(fr, "Save salary", "Enregistrer le salaire")}
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
  editing,
  defaultEmployeeId,
  onClose,
}: {
  fr: boolean;
  orgSlug: string;
  employees: Employee[];
  components: Component[];
  editing: Assignment | null;
  defaultEmployeeId?: string | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [effectiveFrom, setEffectiveFrom] = useState(
    editing?.effectiveFrom ?? today(),
  );
  const [dateError, setDateError] = useState<string | null>(null);
  const [selectedComponentId, setSelectedComponentId] = useState(
    editing?.component.id ?? "",
  );
  const selectedComponent = components.find(
    (component) => component.id === selectedComponentId,
  );
  const percentageBased =
    selectedComponent?.calculation === "percentage_of_basic" ||
    selectedComponent?.calculation === "percentage_of_gross";
  const recoveryComponent = selectedComponent?.componentType === "deduction";
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? patch(
            orgUrl(orgSlug, `employee-payroll-components/${editing.id}`),
            body,
          )
        : post(orgUrl(orgSlug, "employee-payroll-components"), body),
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
      recover = String(f.get("totalToRecover") ?? "").trim(),
      submittedFrom = String(f.get("effectiveFrom") ?? "").trim(),
      submittedTo = String(f.get("effectiveTo") ?? "").trim();
    if (submittedTo && submittedTo < submittedFrom) {
      setDateError(
        t(
          fr,
          "End date must be on or after the start date.",
          "La date de fin doit être identique ou postérieure à la date de début.",
        ),
      );
      return;
    }
    setDateError(null);
    const values = {
      // A fixed allowance uses an amount; a percentage component uses its
      // percentage. Keeping the unused field null prevents old zero values
      // from looking like an intentional personal override.
      amount: percentageBased ? null : amount ? Number(amount) : null,
      percentage: percentageBased && percentage ? Number(percentage) : null,
      effectiveFrom: submittedFrom,
      effectiveTo: submittedTo || null,
      // Recovery limits have meaning only for deductions such as an advance.
      totalToRecover: recoveryComponent && recover ? Number(recover) : null,
      notes: String(f.get("notes") ?? "").trim() || null,
    };
    save.mutate(
      editing
        ? values
        : {
            ...values,
            employeeId: f.get("employeeId"),
            componentId: f.get("componentId"),
            recoveredToDate: 0,
            isActive: true,
          },
    );
  };
  return (
    <Modal
      title={t(
        fr,
        editing ? "Edit personal pay component" : "Assign pay component",
        editing
          ? "Modifier la composante personnelle"
          : "Affecter une composante",
      )}
      onClose={onClose}
    >
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        <FormField label={t(fr, "Employee", "Employé")} required>
          {editing ? (
            <div className="flex h-10 items-center rounded-lg border border-border bg-surface-2 px-3 text-sm text-ink">
              {editing.employee.fullName} · #{editing.employee.employeeNumber}
            </div>
          ) : (
            <select
              name="employeeId"
              required
              defaultValue={defaultEmployeeId ?? ""}
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
          )}
        </FormField>
        <FormField label={t(fr, "Component", "Composante")} required>
          {editing ? (
            <div className="flex h-10 items-center rounded-lg border border-border bg-surface-2 px-3 text-sm text-ink">
              {editing.component.name} ·{" "}
              {words(editing.component.componentType)}
            </div>
          ) : (
            <select
              name="componentId"
              required
              value={selectedComponentId}
              onChange={(event) => {
                setSelectedComponentId(event.target.value);
                setDateError(null);
                save.reset();
              }}
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
          )}
        </FormField>
        {editing && selectedComponent ? (
          <div className="sm:col-span-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm">
            <p className="font-medium text-ink">
              {selectedComponent.name} · {editing.employee.fullName}
            </p>
            <p className="mt-1 text-ink-secondary">
              {percentageBased
                ? t(
                    fr,
                    `Template: ${selectedComponent.percentage ?? 0}%`,
                    `Modèle : ${selectedComponent.percentage ?? 0}%`,
                  )
                : t(
                    fr,
                    `Template: ${selectedComponent.defaultAmount ?? 0}`,
                    `Montant du modèle : ${selectedComponent.defaultAmount ?? 0}`,
                  )}
            </p>
          </div>
        ) : null}
        {percentageBased ? (
          <FormField
            label={t(fr, "Percentage override", "Pourcentage personnalisé")}
            hint={t(
              fr,
              "Leave blank to use the template percentage.",
              "Laissez vide pour utiliser le pourcentage du modèle.",
            )}
          >
            <Input
              name="percentage"
              type="number"
              min="0"
              max="1000"
              step="0.01"
              defaultValue={editing?.percentage ?? ""}
            />
          </FormField>
        ) : (
          <FormField
            label={t(fr, "Amount override", "Montant personnalisé")}
            hint={t(
              fr,
              "Leave blank to use the template amount.",
              "Laissez vide pour utiliser le montant du modèle.",
            )}
          >
            <Input
              name="amount"
              type="number"
              min="0"
              step="0.01"
              defaultValue={editing?.amount ?? ""}
            />
          </FormField>
        )}
        <FormField
          label={t(fr, "Effective from", "Applicable à partir du")}
          required
        >
          <Input
            name="effectiveFrom"
            type="date"
            value={effectiveFrom}
            onChange={(event) => {
              setEffectiveFrom(event.target.value);
              setDateError(null);
              save.reset();
            }}
            required
          />
        </FormField>
        <FormField label={t(fr, "Effective until", "Applicable jusqu’au")}>
          <Input
            name="effectiveTo"
            type="date"
            min={effectiveFrom}
            defaultValue={editing?.effectiveTo ?? ""}
            onChange={() => {
              setDateError(null);
              save.reset();
            }}
          />
        </FormField>
        {recoveryComponent ? (
          <FormField
            label={t(fr, "Total to recover", "Total à récupérer")}
            hint={t(
              fr,
              "For an advance repayment only.",
              "Uniquement pour le remboursement d’une avance.",
            )}
          >
            <Input
              name="totalToRecover"
              type="number"
              min="0"
              step="0.01"
              defaultValue={editing?.totalToRecover ?? ""}
            />
          </FormField>
        ) : null}
        <FormField label={t(fr, "Notes", "Notes")} className="sm:col-span-2">
          <Textarea name="notes" rows={3} defaultValue={editing?.notes ?? ""} />
        </FormField>
        {dateError || apiError(save.error) ? (
          <p className="sm:col-span-2 text-sm text-critical">
            {dateError ??
              (apiError(save.error) ===
              "End date must be on or after the start date"
                ? t(
                    fr,
                    "End date must be on or after the start date.",
                    "La date de fin doit être identique ou postérieure à la date de début.",
                  )
                : apiError(save.error))}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t(fr, "Cancel", "Annuler")}
          </Button>
          <Button
            type="submit"
            loading={save.isPending}
            disabled={!editing && (!employees.length || !components.length)}
          >
            {editing ? <Settings2 /> : <Plus />}
            {t(
              fr,
              editing ? "Save changes" : "Assign component",
              editing ? "Enregistrer les modifications" : "Affecter",
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function EndComponentDialog({
  fr,
  orgSlug,
  assignment,
  onClose,
}: {
  fr: boolean;
  orgSlug: string;
  assignment: Assignment;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [effectiveTo, setEffectiveTo] = useState(
    assignment.effectiveTo ?? today(),
  );
  const [dateError, setDateError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (date: string) =>
      patch(orgUrl(orgSlug, `employee-payroll-components/${assignment.id}`), {
        effectiveTo: date,
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["employee-payroll-components", orgSlug],
      });
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (effectiveTo < assignment.effectiveFrom) {
      setDateError(
        t(
          fr,
          "The end date must be on or after the component start date.",
          "La date de fin doit être identique ou postérieure à la date de début.",
        ),
      );
      return;
    }
    setDateError(null);
    save.mutate(effectiveTo);
  };

  return (
    <Modal
      title={t(fr, "End pay component", "Terminer la composante")}
      onClose={onClose}
    >
      <form onSubmit={submit} className="mt-5 space-y-5">
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-ink-secondary">
          <p className="font-semibold text-ink">
            {assignment.component.name} · {assignment.employee.fullName}
          </p>
          <p className="mt-1">
            {t(
              fr,
              "This component will no longer be included in payroll cycles that start after the selected end date. Existing payslips remain unchanged.",
              "Cette composante ne sera plus prise en compte dans les cycles de paie qui commencent après la date de fin choisie. Les bulletins déjà calculés restent inchangés.",
            )}
          </p>
        </div>
        <FormField
          label={t(fr, "Last applicable date", "Dernier jour applicable")}
          required
        >
          <Input
            type="date"
            value={effectiveTo}
            min={assignment.effectiveFrom}
            onChange={(event) => {
              setEffectiveTo(event.target.value);
              setDateError(null);
              save.reset();
            }}
            required
          />
        </FormField>
        {dateError || apiError(save.error) ? (
          <p className="text-sm text-critical">
            {dateError ?? apiError(save.error)}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t(fr, "Cancel", "Annuler")}
          </Button>
          <Button type="submit" loading={save.isPending}>
            <X />
            {t(fr, "End component", "Terminer la composante")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function PayslipDialog({
  fr,
  orgSlug,
  organization,
  item,
  run,
  downloadable,
  onClose,
}: {
  fr: boolean;
  orgSlug: string;
  organization?: {
    displayName?: string | null;
    legalName?: string | null;
    logoUrl?: string | null;
  };
  item: Payslip;
  run: PayrollRun;
  downloadable: boolean;
  onClose: () => void;
}) {
  const organizationName =
    organization?.displayName?.trim() ||
    organization?.legalName?.trim() ||
    orgSlug
      .split("-")
      .filter(Boolean)
      .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join(" ");
  const pdfUrl = orgApiUrl(
    orgSlug,
    "payslips/" + item.id + "/pdf?lang=" + (fr ? "fr" : "en"),
  );

  return (
    <Modal
      title={t(fr, "Official payslip", "Bulletin de paie officiel")}
      onClose={onClose}
    >
      <div className="mt-5">
        <PayslipStatement
          fr={fr}
          locale={fr ? "fr-FR" : "en-US"}
          organization={{
            name: organizationName,
            logoUrl: organization?.logoUrl,
          }}
          employee={item.employee}
          payslip={{
            ...item,
            reference: item.reference,
            payrollRunReference: run.reference,
            periodStart: run.periodStart,
            periodEnd: run.periodEnd,
            payDate: run.payDate,
          }}
          statusLabel={
            run.status === "paid"
              ? t(fr, "Paid", "Payé")
              : t(fr, "Approved", "Approuvé")
          }
          statusHint={t(
            fr,
            "Issued from an approved company payroll cycle",
            "Émis depuis un cycle de paie approuvé de l’entreprise",
          )}
        />
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {downloadable ? (
          <a
            href={pdfUrl}
            download
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-brand-ink transition hover:bg-brand-hover"
          >
            <Download className="size-4" />
            {t(fr, "Download PDF", "Télécharger le PDF")}
          </a>
        ) : (
          <p className="self-center text-xs text-ink-secondary">
            {t(
              fr,
              "The PDF becomes available after approval.",
              "Le PDF devient disponible après approbation.",
            )}
          </p>
        )}
        <Button variant="secondary" onClick={onClose}>
          {t(fr, "Close", "Fermer")}
        </Button>
      </div>
    </Modal>
  );
}
