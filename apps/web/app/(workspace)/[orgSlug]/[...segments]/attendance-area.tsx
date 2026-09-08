"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  LogIn,
  LogOut,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HrPdfButton } from "@/components/hr/hr-pdf-button";
import { Field, Input } from "@/components/ui/input";
import {
  EmptyState,
  ErrorState,
  NoAccessState,
  SkeletonCard,
} from "@/components/ui/states";
import { ApiError } from "@/lib/api";
import {
  attendanceApi,
  type AttendanceRecord,
  type Shift,
  type ShiftAssignment,
} from "@/lib/attendance-api";
import { can } from "@/lib/permissions";
import { formatBusinessDay, formatInstant } from "@/lib/utils";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";
import { useEmployees } from "@/hooks/useWorkspace";

type Tab = "timesheets" | "roster";

type AttendanceEmployee = {
  id: string;
  employeeNumber: string;
  fullName: string;
  jobTitle?: string | null;
};

const employeeName = (row: {
  employee?: AttendanceEmployee | null;
  employeeName?: string | null;
  employeeId?: string | null;
}) => row.employee?.fullName ?? row.employeeName ?? row.employeeId ?? "—";

const employeeNumber = (row: {
  employee?: AttendanceEmployee | null;
  employeeNumber?: string | null;
}) => row.employee?.employeeNumber ?? row.employeeNumber ?? null;

const copy = (locale: string, english: string, french: string) =>
  locale.startsWith("fr") ? french : english;

const approvalDate = (row: AttendanceRecord) =>
  row.approval?.approvedAt ?? row.approvedAt ?? null;

const shiftHours = (shift: Shift, locale: string) => {
  const startsAt = shift.startsAt?.slice(0, 5) ?? "—";
  const endsAt = shift.endsAt?.slice(0, 5) ?? "—";
  if (startsAt === "00:00" && endsAt === "23:59")
    return copy(locale, "All-day shift", "Horaire de journée entière");
  return `${startsAt} – ${endsAt}`;
};

/**
 * Attendance and rosters.
 *
 * Two jobs that belong on one screen because a supervisor does them in the same
 * sitting: sign off yesterday's hours, and put people on tomorrow's shift.
 *
 * The approve action is gated on `attendance.approve`, which the API keeps
 * separate from `attendance.correct` on purpose — whoever fixes a wrong clock-in
 * should not also be the person who signs it off. The button is hidden without
 * the permission, and the API refuses it regardless, so hiding it is only a
 * courtesy.
 */
export function AttendanceArea({
  orgSlug,
  initialTab = "timesheets",
}: {
  orgSlug: string;
  initialTab?: Tab;
}) {
  const { t, locale } = useLanguage();
  const user = useSessionUser();
  const [tab, setTab] = useState<Tab>(initialTab);

  const canReadAttendance = can(user, "attendance.read");
  const canApprove = can(user, "attendance.approve");
  const canReadShifts = can(user, "shifts.read");
  const canRoster = can(user, "shifts.update");
  const canClock =
    can(user, "attendance.clock_self") ||
    can(user, "attendance.clock_others");

  if (!canReadAttendance && !canReadShifts && !canClock) {
    return <NoAccessState what={t("attendance.title")} />;
  }

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <header className="relative overflow-hidden rounded-3xl border border-brand/15 bg-[radial-gradient(circle_at_94%_12%,rgba(56,189,248,.16),transparent_24%),radial-gradient(circle_at_8%_110%,rgba(34,197,94,.12),transparent_36%),linear-gradient(135deg,var(--surface-1),var(--surface-2))] p-5 shadow-[0_22px_52px_-38px_rgba(15,23,42,.42)] sm:p-7 dark:shadow-[0_22px_52px_-38px_rgba(0,0,0,.9)]">
        <span className="pointer-events-none absolute -right-10 -top-10 size-44 rounded-full border border-brand/10" />
        <div className="relative flex flex-wrap items-start gap-4">
          <span className="grid size-11 place-items-center rounded-2xl border border-brand/20 bg-brand-subtle text-brand shadow-sm">
            <CalendarClock className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-brand">
              {t("nav.attendance")}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              {t("attendance.title")}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">
              {t("attendance.description")}
            </p>
          </div>
        </div>
      </header>

      {canReadAttendance ? <div className="flex justify-end"><HrPdfButton orgSlug={orgSlug} report="attendance" fr={locale.startsWith("fr")} className="border-brand/30 bg-brand/10 text-brand hover:bg-brand/15" /></div> : null}

      {canClock ? <ClockTerminal orgSlug={orgSlug} locale={locale} /> : null}

      <div
        className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1"
        role="tablist"
      >
        {canReadAttendance ? (
          <TabButton
            active={tab === "timesheets"}
            onClick={() => setTab("timesheets")}
            icon={Clock3}
            label={t("attendance.timesheets")}
          />
        ) : null}
        {canReadShifts ? (
          <TabButton
            active={tab === "roster"}
            onClick={() => setTab("roster")}
            icon={Users}
            label={t("attendance.roster")}
          />
        ) : null}
      </div>

      {tab === "timesheets" && canReadAttendance ? (
        <Timesheets
          orgSlug={orgSlug}
          canApprove={canApprove}
          locale={locale}
          t={t}
        />
      ) : null}
      {tab === "roster" && canReadShifts ? (
        <Roster orgSlug={orgSlug} canRoster={canRoster} locale={locale} t={t} />
      ) : null}
    </main>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Clock3;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
        active
          ? "bg-surface-1 text-ink shadow-sm"
          : "text-ink-secondary hover:text-ink"
      }`}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  );
}

/* -------------------------------------------------------------- clock -- */

function ClockTerminal({ orgSlug, locale }: { orgSlug: string; locale: string }) {
  const queryClient = useQueryClient();
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [workDate, setWorkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [action, setAction] = useState<"in" | "out">("in");

  const clock = useMutation({
    mutationFn: () => {
      const body = { employeeNumber, workDate };
      return action === "in"
        ? attendanceApi.clockIn<{ attendance: AttendanceRecord }>(orgSlug, body)
        : attendanceApi.clockOut<{ attendance: AttendanceRecord }>(orgSlug, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance-records", orgSlug] });
      setEmployeeNumber("");
    },
  });

  const error = clock.error instanceof ApiError ? clock.error.message : null;
  const isValidNumber = /^\d{5}$/.test(employeeNumber);

  return (
    <section className="overflow-hidden rounded-3xl border border-brand/25 bg-[radial-gradient(circle_at_96%_0%,rgba(56,189,248,.18),transparent_31%),linear-gradient(135deg,color-mix(in_srgb,var(--brand)_12%,var(--surface-1)),var(--surface-1)_56%,var(--surface-2))] shadow-[0_22px_52px_-38px_rgba(15,23,42,.42)] dark:shadow-[0_22px_52px_-38px_rgba(0,0,0,.9)]">
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <div className="flex items-center gap-2 text-brand">
            <Clock3 className="size-4" aria-hidden />
            <p className="text-xs font-semibold uppercase tracking-wide">
              {copy(locale, "Attendance terminal", "Terminal de pointage")}
            </p>
          </div>
          <h2 className="mt-2 text-lg font-semibold text-ink">
            {copy(locale, "Clock using the five-digit employee number", "Pointez avec le matricule à cinq chiffres")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-secondary">
            {copy(locale, "Enter the employee number, not a database ID. The system identifies the employee, their assigned shift and authorized scope automatically.", "Saisissez le matricule employé, et non un identifiant technique. Le système identifie automatiquement la personne, son horaire et son périmètre autorisé.")}
          </p>
        </div>

        <form
          className="grid gap-3 xl:grid-cols-[minmax(170px,1fr)_150px_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            if (isValidNumber) clock.mutate();
          }}
        >
          <Field
            label={copy(locale, "Employee number", "Matricule employé")}
            htmlFor="clock-employee-number"
            hint={copy(locale, "Exactly 5 digits", "Exactement 5 chiffres")}
            required
          >
            <Input
              id="clock-employee-number"
              inputMode="numeric"
              autoComplete="off"
              placeholder="10001"
              value={employeeNumber}
              maxLength={5}
              onChange={(event) => setEmployeeNumber(event.target.value.replace(/\D/g, "").slice(0, 5))}
              required
            />
          </Field>
          <Field label={copy(locale, "Work date", "Date de travail")} htmlFor="clock-work-date" required>
            <Input id="clock-work-date" type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} required />
          </Field>
          <div className="flex items-end gap-2 rounded-xl border border-brand/15 bg-brand-subtle/45 p-1">
            <Button
              type="button"
              variant={action === "in" ? "primary" : "secondary"}
              onClick={() => setAction("in")}
              aria-pressed={action === "in"}
            >
              <LogIn />
              {copy(locale, "Clock in", "Arrivée")}
            </Button>
            <Button
              type="button"
              variant={action === "out" ? "primary" : "secondary"}
              onClick={() => setAction("out")}
              aria-pressed={action === "out"}
            >
              <LogOut />
              {copy(locale, "Clock out", "Départ")}
            </Button>
          </div>
          <div className="xl:col-span-3">
            <Button type="submit" loading={clock.isPending} disabled={!isValidNumber || !workDate}>
              {action === "in" ? <LogIn /> : <LogOut />}
              {action === "in"
                ? copy(locale, "Record arrival", "Enregistrer l’arrivée")
                : copy(locale, "Record departure", "Enregistrer le départ")}
            </Button>
          </div>
          {error ? <p className="xl:col-span-3 text-xs text-critical" role="alert">{error}</p> : null}
          {clock.isSuccess ? <p className="xl:col-span-3 text-xs text-positive">{copy(locale, "Attendance recorded successfully.", "Pointage enregistré avec succès.")}</p> : null}
        </form>
      </div>
    </section>
  );
}
/* ------------------------------------------------------------ timesheets -- */

function Timesheets({
  orgSlug,
  canApprove,
  locale,
  t,
}: {
  orgSlug: string;
  canApprove: boolean;
  locale: string;
  t: (key: never, values?: Record<string, string | number>) => string;
}) {
  const queryClient = useQueryClient();
  const [pendingOnly, setPendingOnly] = useState(true);

  const records = useQuery({
    queryKey: ["attendance-records", orgSlug],
    queryFn: () =>
      attendanceApi.listAttendance<{ attendance: AttendanceRecord[] }>(orgSlug),
    select: (data) => data.attendance,
  });

  const approve = useMutation({
    mutationFn: (attendanceId: string) =>
      attendanceApi.approve<{ attendance: AttendanceRecord }>(
        orgSlug,
        attendanceId,
      ),
    // Invalidate rather than patch the cache: approving can change derived
    // fields the API computes (overtime, status), and guessing them here would
    // show a number the server disagrees with.
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["attendance-records", orgSlug],
      }),
  });

  if (records.isPending) return <SkeletonCard rows={6} />;
  if (records.isError) {
    return (
      <ErrorState
        description={(records.error as ApiError)?.message}
        onRetry={() => void records.refetch()}
      />
    );
  }

  const all = records.data ?? [];
  const rows = pendingOnly ? all.filter((row) => !approvalDate(row)) : all;
  const awaiting = all.filter((row) => !approvalDate(row)).length;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-surface-1 via-surface-1 to-surface-2 shadow-[0_18px_42px_-32px_rgba(15,23,42,.38)] dark:shadow-[0_18px_42px_-32px_rgba(0,0,0,.85)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {t("attendance.timesheets" as never)}
          </h2>
          <p className="mt-0.5 text-xs text-ink-secondary">
            {t("attendance.awaitingApproval" as never, { count: awaiting })}
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-ink-secondary">
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(event) => setPendingOnly(event.target.checked)}
            className="size-4 accent-[var(--brand)]"
          />
          {t("attendance.onlyPending" as never)}
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={t("attendance.nothingToApprove" as never)}
          description={t("attendance.nothingToApproveDescription" as never)}
          icon={CheckCircle2}
        />
      ) : (
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-2">
              <tr>
                <Th>{t("attendance.employee" as never)}</Th>
                <Th>{t("attendance.date" as never)}</Th>
                <Th>{t("attendance.clockIn" as never)}</Th>
                <Th>{t("attendance.clockOut" as never)}</Th>
                <Th align="right">{t("attendance.hours" as never)}</Th>
                <Th>{t("attendance.status" as never)}</Th>
                <Th align="right">{""}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-surface-2">
                  <Td>
                    <span className="font-medium text-ink">
                      {employeeName(row)}
                    </span>
                    {employeeNumber(row) ? (
                      <span className="ml-1 text-xs text-ink-muted">
                        #{employeeNumber(row)}
                      </span>
                    ) : null}
                  </Td>
                  <Td>{formatBusinessDay(row.workDate)}</Td>
                  <Td>{row.clockInAt ? formatInstant(row.clockInAt) : "—"}</Td>
                  <Td>
                    {row.clockOutAt ? formatInstant(row.clockOutAt) : "—"}
                  </Td>
                  <Td align="right">
                    <span className="tabular">
                      {row.workedHours != null
                        ? Number(row.workedHours).toFixed(2)
                        : "—"}
                    </span>
                  </Td>
                  <Td>
                    {approvalDate(row) ? (
                      <Badge variant="good">
                        {t("attendance.approved" as never)}
                      </Badge>
                    ) : (
                      <Badge variant="warning">
                        {t("attendance.pending" as never)}
                      </Badge>
                    )}
                  </Td>
                  <Td align="right">
                    {!approvalDate(row) && canApprove ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={
                          approve.isPending && approve.variables === row.id
                        }
                        onClick={() => approve.mutate(row.id)}
                      >
                        {t("attendance.approve" as never)}
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- roster -- */

function Roster({
  orgSlug,
  canRoster,
  locale,
  t,
}: {
  orgSlug: string;
  canRoster: boolean;
  locale: string;
  t: (key: never, values?: Record<string, string | number>) => string;
}) {
  const queryClient = useQueryClient();
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(
    // A roster change almost always starts today, so today is the default
    // rather than an empty field the user must fill every time.
    new Date().toISOString().slice(0, 10),
  );
  const [effectiveTo, setEffectiveTo] = useState("");

  const shifts = useQuery({
    queryKey: ["shifts", orgSlug],
    queryFn: () => attendanceApi.listShifts<{ shifts: Shift[] }>(orgSlug),
    select: (data) => data.shifts,
  });

  const activeShiftId = shiftId ?? shifts.data?.[0]?.id ?? null;

  const assignments = useQuery({
    queryKey: ["shift-assignments", orgSlug, activeShiftId],
    queryFn: () =>
      attendanceApi.listAssignments<{ assignments: ShiftAssignment[] }>(
        orgSlug,
        String(activeShiftId),
      ),
    enabled: Boolean(activeShiftId),
    select: (data) => data.assignments,
  });

  const employees = useEmployees(orgSlug);

  const assign = useMutation({
    mutationFn: () =>
      attendanceApi.assignEmployee(orgSlug, String(activeShiftId), {
        employeeId,
        effectiveFrom,
        ...(effectiveTo ? { effectiveTo } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["shift-assignments", orgSlug, activeShiftId],
      });
      setEmployeeId("");
      setEffectiveTo("");
      setFormOpen(false);
    },
  });

  if (shifts.isPending) return <SkeletonCard rows={5} />;
  if (shifts.isError) {
    return (
      <ErrorState
        description={(shifts.error as ApiError)?.message}
        onRetry={() => void shifts.refetch()}
      />
    );
  }

  const shiftList = shifts.data ?? [];
  if (shiftList.length === 0) {
    return (
      <EmptyState
        title={t("attendance.noShifts" as never)}
        description={t("attendance.noShiftsDescription" as never)}
        icon={CalendarClock}
      />
    );
  }

  const alreadyAssigned = new Set(
    (assignments.data ?? []).map((row) => row.employee?.id ?? row.employeeId),
  );
  const assignable = (employees.data ?? []).filter(
    (employee) =>
      employee.employmentStatus === "active" &&
      !alreadyAssigned.has(employee.id),
  );
  const failure =
    assign.error instanceof ApiError ? assign.error.message : null;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(260px,.85fr)_minmax(0,2fr)]">
      <section className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-surface-1 via-surface-1 to-surface-2 shadow-[0_18px_42px_-32px_rgba(15,23,42,.38)] dark:shadow-[0_18px_42px_-32px_rgba(0,0,0,.85)]">
        <div className="border-b border-border bg-gradient-to-r from-brand-subtle/35 via-surface-1 to-surface-1 p-4">
          <h2 className="text-sm font-semibold text-ink">
            {t("nav.shifts" as never)}
          </h2>
        </div>
        <ul className="max-h-[60dvh] divide-y divide-border overflow-y-auto">
          {shiftList.map((shift) => (
            <li key={shift.id}>
              <button
                type="button"
                onClick={() => setShiftId(shift.id)}
                aria-current={shift.id === activeShiftId ? "true" : undefined}
                className={`w-full border-l-2 px-4 py-3.5 text-left transition ${
                  shift.id === activeShiftId
                    ? "border-l-brand bg-brand-subtle shadow-sm"
                    : "border-l-transparent hover:bg-surface-2"
                }`}
              >
                <p className="truncate text-sm font-medium text-ink">
                  {shift.name}
                </p>
                <p className="mt-0.5 text-xs text-ink-secondary tabular">
                  {shiftHours(shift, locale)}
                </p>
                {shift.site?.name ?? shift.siteName ? (
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {shift.site?.name ?? shift.siteName}
                  </p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-surface-1 via-surface-1 to-surface-2 shadow-[0_18px_42px_-32px_rgba(15,23,42,.38)] dark:shadow-[0_18px_42px_-32px_rgba(0,0,0,.85)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">
              {t("attendance.assignedEmployees" as never)}
            </h2>
            <p className="mt-0.5 text-xs text-ink-secondary">
              {t("attendance.assignedCount" as never, {
                count: assignments.data?.length ?? 0,
              })}
            </p>
          </div>
          {canRoster ? (
            <Button size="sm" onClick={() => setFormOpen((open) => !open)}>
              <UserPlus />
              {formOpen
                ? t("attendance.cancel" as never)
                : t("attendance.assign" as never)}
            </Button>
          ) : null}
        </div>

        {formOpen && canRoster ? (
          <form
            className="m-4 grid gap-3 rounded-2xl border border-brand/20 bg-brand-subtle/35 p-4 sm:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              assign.mutate();
            }}
          >
            <Field
              label={t("attendance.employee" as never)}
              htmlFor="assign-employee"
              required
            >
              <select
                id="assign-employee"
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
                required
                className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
              >
                <option value="">
                  {t("attendance.chooseEmployee" as never)}
                </option>
                {assignable.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.fullName} · #{employee.employeeNumber}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label={t("attendance.from" as never)}
              htmlFor="assign-from"
              required
            >
              <Input
                type="date"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
                required
              />
            </Field>

            <Field
              label={t("attendance.until" as never)}
              htmlFor="assign-to"
              hint={t("attendance.untilHint" as never)}
            >
              <Input
                type="date"
                value={effectiveTo}
                min={effectiveFrom}
                onChange={(event) => setEffectiveTo(event.target.value)}
              />
            </Field>

            {failure ? (
              <p className="text-xs text-critical sm:col-span-3" role="alert">
                {failure}
              </p>
            ) : null}

            <div className="xl:col-span-3">
              <Button
                type="submit"
                loading={assign.isPending}
                disabled={!employeeId}
              >
                {t("attendance.confirmAssign" as never)}
              </Button>
            </div>
          </form>
        ) : null}

        {assignments.isPending ? (
          <SkeletonCard rows={4} />
        ) : assignments.isError ? (
          <ErrorState onRetry={() => void assignments.refetch()} />
        ) : (assignments.data ?? []).length === 0 ? (
          <EmptyState
            title={t("attendance.nobodyAssigned" as never)}
            description={t("attendance.nobodyAssignedDescription" as never)}
            icon={Users}
          />
        ) : (
          <ul className="divide-y divide-border">
            {(assignments.data ?? []).map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 transition hover:bg-surface-2/70"
              >
                <div className="min-w-48 flex-1">
                  <p className="text-sm font-medium text-ink">
                    {employeeName(row)}
                  </p>
                  {employeeNumber(row) ? (
                    <p className="text-xs text-ink-muted">
                      #{employeeNumber(row)}
                    </p>
                  ) : null}
                </div>
                <p className="text-xs text-ink-secondary">
                  {formatBusinessDay(row.effectiveFrom)}
                  {row.effectiveTo
                    ? ` → ${formatBusinessDay(row.effectiveTo)}`
                    : ` → ${t("attendance.openEnded" as never)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={`px-4 py-2.5 text-xs font-medium text-ink-secondary ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      className={`px-4 py-3 text-ink-secondary ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </td>
  );
}
