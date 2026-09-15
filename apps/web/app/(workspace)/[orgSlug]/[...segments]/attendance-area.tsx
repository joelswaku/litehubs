"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ClipboardCheck,
  LogIn,
  LogOut,
  TimerReset,
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
  type ScheduleException,
  type WeeklyScheduleDay,
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

const employeeInitials = (row: {
  employee?: AttendanceEmployee | null;
  employeeName?: string | null;
  employeeId?: string | null;
}) =>
  employeeName(row)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "—";
const copy = (locale: string, english: string, french: string) =>
  locale.startsWith("fr") ? french : english;

const approvalDate = (row: AttendanceRecord) =>
  row.approval?.approvedAt ?? row.approvedAt ?? null;

const shiftHours = (shift: Shift, locale: string) => {
  if (shift.weeklySchedule?.length === 7) {
    return planHoursLabel(shift.weeklySchedule, locale);
  }
  const startsAt = shift.startsAt?.slice(0, 5) ?? "—";
  const endsAt = shift.endsAt?.slice(0, 5) ?? "—";
  if (startsAt === "00:00" && endsAt === "23:59")
    return copy(locale, "All-day shift", "Horaire de journée entière");
  return `${startsAt} – ${endsAt}`;
};

/** The next work day is the earliest safe point to replace an assignment. */
const dayAfter = (workDay: string) => {
  const date = new Date(`${workDay}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
};

const weekDayNames = (locale: string) =>
  locale.startsWith("fr")
    ? ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const defaultWeeklyPlan = (): WeeklyScheduleDay[] =>
  Array.from({ length: 7 }, (_, index) => ({
    day: index + 1,
    enabled: index < 5,
    startsAt: "08:00",
    endsAt: "17:00",
    breakMinutes: 0,
  }));

const normaliseWeeklyPlan = (
  plan: WeeklyScheduleDay[] | undefined,
  startsAt = "08:00",
  endsAt = "17:00",
): WeeklyScheduleDay[] =>
  Array.from({ length: 7 }, (_, index) => {
    const stored = plan?.find((day) => day.day === index + 1);
    return {
      day: index + 1,
      enabled: stored?.enabled ?? index < 5,
      startsAt: stored?.startsAt ?? startsAt,
      endsAt: stored?.endsAt ?? endsAt,
      breakMinutes: stored?.breakMinutes ?? 0,
    };
  });

const planMinutes = (plan: WeeklyScheduleDay[]) =>
  plan.reduce((total, day) => {
    if (!day.enabled || !day.startsAt || !day.endsAt) return total;
    const [startHour = 0, startMinute = 0] = day.startsAt.split(":").map(Number);
    const [endHour = 0, endMinute = 0] = day.endsAt.split(":").map(Number);
    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;
    const span = (end - start + 1440) % 1440 || 1440;
    return total + Math.max(0, span - (day.breakMinutes ?? 0));
  }, 0);

const planHoursLabel = (plan: WeeklyScheduleDay[], locale: string) =>
  `${(planMinutes(plan) / 60).toLocaleString(locale.startsWith("fr") ? "fr-FR" : "en-US", { maximumFractionDigits: 1 })} ${copy(locale, "h/week", "h/semaine")}`;

const firstWorkingTime = (plan: WeeklyScheduleDay[], field: "startsAt" | "endsAt", fallback: string) =>
  plan.find((day) => day.enabled)?.[field] ?? fallback;

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
  const canCreateShift = can(user, "shifts.create");
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
            {canReadAttendance ? (
            <HrPdfButton
              orgSlug={orgSlug}
              report="attendance"
              fr={locale.startsWith("fr")}
              className="ml-auto border-brand/30 bg-surface-1/75 text-brand shadow-sm hover:bg-brand/10"
            />
          ) : null}
        </div>
        </div>
      </header>



      {canClock ? <ClockTerminal orgSlug={orgSlug} locale={locale} /> : null}

      <div
        className="flex gap-1 rounded-2xl border border-border bg-surface-2/80 p-1.5 shadow-sm"
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
        <Roster
          orgSlug={orgSlug}
          canRoster={canRoster}
          canCreateShift={canCreateShift}
          locale={locale}
          t={t}
        />
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
      <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-brand">
            <span className="grid size-7 place-items-center rounded-lg border border-brand/20 bg-brand-subtle">
              <Clock3 className="size-4" aria-hidden />
            </span>
            <p className="text-xs font-semibold uppercase tracking-[.14em]">
              {copy(locale, "Attendance terminal", "Terminal de pointage")}
            </p>
          </div>
          <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">
            {copy(locale, "Clock using the five-digit employee number", "Pointez avec le matricule à cinq chiffres")}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">
            {copy(locale, "Enter the employee number, not a database ID. The system identifies the employee, their assigned shift and authorized scope automatically.", "Saisissez le matricule employé, et non un identifiant technique. Le système identifie automatiquement la personne, son horaire et son périmètre autorisé.")}
          </p>
        </div>
        <span className="rounded-full border border-brand/20 bg-surface-1/80 px-3 py-1.5 text-xs font-medium text-brand shadow-sm">
          {copy(locale, "Verified attendance", "Pointage vérifié")}
        </span>
      </div>

      <form
        className="grid gap-4 border-t border-brand/15 bg-surface-1/55 p-5 sm:p-6 lg:grid-cols-[minmax(185px,1fr)_minmax(160px,.75fr)_auto] lg:items-end"
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
        <div className="rounded-xl border border-brand/15 bg-brand-subtle/45 p-1.5">
          <div className="grid grid-cols-2 gap-1">
            <Button
              type="button"
              size="sm"
              variant={action === "in" ? "primary" : "secondary"}
              onClick={() => setAction("in")}
              aria-pressed={action === "in"}
            >
              <LogIn />
              {copy(locale, "Clock in", "Arrivée")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={action === "out" ? "primary" : "secondary"}
              onClick={() => setAction("out")}
              aria-pressed={action === "out"}
            >
              <LogOut />
              {copy(locale, "Clock out", "Départ")}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 lg:col-span-3">
          <Button type="submit" loading={clock.isPending} disabled={!isValidNumber || !workDate}>
            {action === "in" ? <LogIn /> : <LogOut />}
            {action === "in"
              ? copy(locale, "Record arrival", "Enregistrer l’arrivée")
              : copy(locale, "Record departure", "Enregistrer le départ")}
          </Button>
          <p className="text-xs text-ink-muted">
            {copy(locale, "The official time is recorded securely.", "L’heure officielle est enregistrée de façon sécurisée.")}
          </p>
        </div>
        {error ? <p className="text-xs text-critical lg:col-span-3" role="alert">{error}</p> : null}
        {clock.isSuccess ? <p className="text-xs text-positive lg:col-span-3">{copy(locale, "Attendance recorded successfully.", "Pointage enregistré avec succès.")}</p> : null}
      </form>
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
  canCreateShift,
  locale,
  t,
}: {
  orgSlug: string;
  canRoster: boolean;
  canCreateShift: boolean;
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
  const [editingShift, setEditingShift] = useState(false);
  const [shiftName, setShiftName] = useState("");
  const [shiftStartsAt, setShiftStartsAt] = useState("");
  const [shiftEndsAt, setShiftEndsAt] = useState("");
  const [shiftWeeklySchedule, setShiftWeeklySchedule] = useState<WeeklyScheduleDay[]>(
    defaultWeeklyPlan(),
  );
  const [changingAssignmentId, setChangingAssignmentId] = useState<string | null>(null);
  const [exceptionAssignmentId, setExceptionAssignmentId] = useState<string | null>(null);
  const [exceptionWorkDate, setExceptionWorkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [exceptionIsWorking, setExceptionIsWorking] = useState(true);
  const [exceptionStartsAt, setExceptionStartsAt] = useState("08:00");
  const [exceptionEndsAt, setExceptionEndsAt] = useState("17:00");
  const [exceptionBreakMinutes, setExceptionBreakMinutes] = useState(0);
  const [exceptionNote, setExceptionNote] = useState("");  const [targetShiftId, setTargetShiftId] = useState("");
  const [changeEffectiveFrom, setChangeEffectiveFrom] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [createShiftOpen, setCreateShiftOpen] = useState(false);
  const [newShiftCode, setNewShiftCode] = useState("");
  const [newShiftName, setNewShiftName] = useState("");
  const [newShiftStartsAt, setNewShiftStartsAt] = useState("08:00");
  const [newShiftEndsAt, setNewShiftEndsAt] = useState("17:00");
  const [newWeeklySchedule, setNewWeeklySchedule] = useState<WeeklyScheduleDay[]>(
    defaultWeeklyPlan(),
  );

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
        queryKey: ["shift-assignments", orgSlug],
      });
      setEmployeeId("");
      setEffectiveTo("");
      setFormOpen(false);
    },
  });

  const updateShift = useMutation({
    mutationFn: () =>
      attendanceApi.updateShift(orgSlug, String(activeShiftId), {
        name: shiftName,
        startsAt: firstWorkingTime(shiftWeeklySchedule, "startsAt", shiftStartsAt),
        endsAt: firstWorkingTime(shiftWeeklySchedule, "endsAt", shiftEndsAt),
        weeklySchedule: shiftWeeklySchedule,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["shifts", orgSlug] });
      setEditingShift(false);
    },
  });

  const changeAssignment = useMutation({
    mutationFn: () =>
      attendanceApi.changeAssignment(
        orgSlug,
        String(activeShiftId),
        String(changingAssignmentId),
        { targetShiftId, effectiveFrom: changeEffectiveFrom },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["shift-assignments", orgSlug],
      });
      setChangingAssignmentId(null);
      setTargetShiftId("");
    },
  });

  const assignmentExceptions = useQuery({
    queryKey: ["shift-assignment-exceptions", orgSlug, activeShiftId, exceptionAssignmentId],
    queryFn: () => attendanceApi.listAssignmentExceptions<{ exceptions: ScheduleException[] }>(orgSlug, String(activeShiftId), String(exceptionAssignmentId)),
    enabled: Boolean(activeShiftId && exceptionAssignmentId),
    select: (data) => data.exceptions,
  });

  const saveException = useMutation({
    mutationFn: () => attendanceApi.saveAssignmentException<{ exception: ScheduleException }>(orgSlug, String(activeShiftId), String(exceptionAssignmentId), {
      workDate: exceptionWorkDate,
      isWorking: exceptionIsWorking,
      ...(exceptionIsWorking ? { startsAt: exceptionStartsAt, endsAt: exceptionEndsAt, breakMinutes: exceptionBreakMinutes } : {}),
      ...(exceptionNote.trim() ? { note: exceptionNote.trim() } : { note: null }),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["shift-assignment-exceptions", orgSlug] });
      setExceptionNote("");
    },
  });

  const deleteException = useMutation({
    mutationFn: (exceptionId: string) => attendanceApi.removeAssignmentException(orgSlug, String(activeShiftId), String(exceptionAssignmentId), exceptionId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["shift-assignment-exceptions", orgSlug] }),
  });
  const createShift = useMutation({
    mutationFn: () => {
      const siteId = selectedShift?.site?.id ?? selectedShift?.siteId;
      if (!siteId) throw new Error("Choose an existing site schedule first");
      return attendanceApi.createShift<{ shift: Shift }>(orgSlug, {
        code: newShiftCode,
        name: newShiftName,
        siteId,
        startsAt: firstWorkingTime(newWeeklySchedule, "startsAt", newShiftStartsAt),
        endsAt: firstWorkingTime(newWeeklySchedule, "endsAt", newShiftEndsAt),
        weeklySchedule: newWeeklySchedule,
      });
    },
    onSuccess: ({ shift }) => {
      void queryClient.invalidateQueries({ queryKey: ["shifts", orgSlug] });
      setShiftId(shift.id);
      setCreateShiftOpen(false);
      setNewShiftCode("");
      setNewShiftName("");
      setNewWeeklySchedule(defaultWeeklyPlan());
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

  const rosterToday = new Date().toISOString().slice(0, 10);
  const assignmentRows = assignments.data ?? [];
  const assignmentState = (row: ShiftAssignment) =>
    row.effectiveFrom > rosterToday
      ? "scheduled"
      : row.effectiveTo && row.effectiveTo < rosterToday
        ? "ended"
        : "active";
  const activeAssignmentCount = assignmentRows.filter(
    (row) => assignmentState(row) === "active",
  ).length;
  const scheduledAssignmentCount = assignmentRows.filter(
    (row) => assignmentState(row) === "scheduled",
  ).length;
  const rosterAssignmentSummary = [
    activeAssignmentCount
      ? copy(
          locale,
          `${activeAssignmentCount} active`,
          `${activeAssignmentCount} en cours`,
        )
      : null,
    scheduledAssignmentCount
      ? copy(
          locale,
          `${scheduledAssignmentCount} scheduled`,
          `${scheduledAssignmentCount} à venir`,
        )
      : null,
  ]
    .filter(Boolean)
    .join(" · ") || copy(locale, "No current assignment", "Aucune affectation en cours");
  const alreadyAssigned = new Set(
    assignmentRows
      .filter((row) => assignmentState(row) !== "ended")
      .map((row) => row.employee?.id ?? row.employeeId),
  );
  const assignable = (employees.data ?? []).filter(
    (employee) =>
      employee.employmentStatus === "active" &&
      !alreadyAssigned.has(employee.id),
  );
  const failure =
    assign.error instanceof ApiError ? assign.error.message : null;
  const selectedShift = shiftList.find((shift) => shift.id === activeShiftId);
  const rawScheduleChangeError =
    changeAssignment.error instanceof ApiError
      ? changeAssignment.error.message
      : null;
  const scheduleChangeError = rawScheduleChangeError?.includes(
    "Choose a new-shift date",
  )
    ? copy(
        locale,
        "Choose a date after this employee’s current schedule starts.",
        "Choisissez une date postérieure au début de l’horaire actuel de cet employé.",
      )
    : rawScheduleChangeError?.includes("already assigned to this schedule") ||
        rawScheduleChangeError?.includes("code or assignment already exists")
      ? copy(
          locale,
          "This employee is already assigned to this schedule. Choose another schedule or use a date exception.",
          "Cet employé est déjà affecté à cet horaire. Choisissez un autre horaire ou utilisez une exception de date.",
        )
      : rawScheduleChangeError;
  const shiftUpdateError =
    updateShift.error instanceof ApiError ? updateShift.error.message : null;
  const createShiftError =
    createShift.error instanceof ApiError
      ? createShift.error.message
      : createShift.error instanceof Error
        ? createShift.error.message
        : null;
  const availableReplacementShifts = shiftList.filter(
    (shift) =>
      shift.id !== activeShiftId &&
      (!selectedShift?.province?.id ||
        shift.province?.id === selectedShift.province?.id),
  );

  return (
    <div className={`grid gap-5 ${createShiftOpen ? "" : "2xl:grid-cols-[minmax(300px,.82fr)_minmax(0,2fr)]"}`}>
      <section className="overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-surface-1 via-surface-1 to-surface-2 shadow-[0_20px_48px_-34px_rgba(15,23,42,.38)] dark:shadow-[0_20px_48px_-34px_rgba(0,0,0,.85)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-gradient-to-r from-brand-subtle/45 via-surface-1 to-surface-1 p-4 sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-brand/20 bg-brand-subtle text-brand">
              <CalendarDays className="size-4.5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[.14em] text-brand">
                {copy(locale, "Work schedules", "Horaires de travail")}
              </p>
              <h2 className="truncate text-base font-semibold text-ink">
                {t("nav.shifts" as never)}
              </h2>
              <p className="mt-0.5 text-xs text-ink-secondary">
                {shiftList.length} {copy(locale, "configured", "configuré(s)")}
              </p>
            </div>
          </div>
          {canCreateShift ? (
            <Button size="sm" variant="outline" onClick={() => setCreateShiftOpen((open) => !open)}>
              {createShiftOpen
                ? copy(locale, "Close form", "Fermer le formulaire")
                : copy(locale, "Add schedule", "Ajouter un horaire")}
            </Button>
          ) : null}
        </div>
        {createShiftOpen && canCreateShift ? (
          <form
            className="m-4 grid gap-5 rounded-2xl border border-brand/25 bg-gradient-to-br from-brand-subtle/45 via-surface-1 to-surface-2 p-5 shadow-inner md:grid-cols-2 sm:m-5 sm:p-6"
            onSubmit={(event) => {
              event.preventDefault();
              createShift.mutate();
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3 md:col-span-2">
              <div className="flex min-w-0 gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-brand/20 bg-brand-subtle text-brand">
                  <CalendarDays className="size-5" aria-hidden />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-ink">
                    {copy(locale, "New weekly schedule", "Nouvel horaire hebdomadaire")}
                  </h3>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-secondary">
                    {copy(
                      locale,
                      "The new schedule is created for the same site as the selected schedule. You can then move one employee to it without changing other employees.",
                      "Le nouvel horaire est créé pour le même site que l’horaire sélectionné. Vous pourrez ensuite y déplacer un seul employé sans modifier les autres.",
                    )}
                  </p>
                </div>
              </div>
              <span className="rounded-full border border-brand/20 bg-surface-1 px-3 py-1.5 text-xs font-semibold text-brand">
                {copy(locale, "Repeats every week", "Se répète chaque semaine")}
              </span>
            </div>
            <Field label={copy(locale, "Unique code", "Code unique")} htmlFor="new-shift-code" required>
              <Input id="new-shift-code" value={newShiftCode} onChange={(event) => setNewShiftCode(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} placeholder="matin_0800" required />
            </Field>
            <Field label={copy(locale, "Schedule name", "Nom de l’horaire")} htmlFor="new-shift-name" required>
              <Input id="new-shift-name" value={newShiftName} onChange={(event) => setNewShiftName(event.target.value)} placeholder={copy(locale, "Morning schedule", "Horaire du matin")} required />
            </Field>
            <div className="md:col-span-2">
              <WeeklyPlanEditor
                plan={newWeeklySchedule}
                onChange={setNewWeeklySchedule}
                locale={locale}
                idPrefix="new-shift-week"
              />
            </div>
            {createShiftError ? <p className="text-xs text-critical md:col-span-2" role="alert">{createShiftError}</p> : null}
            <div className="flex flex-wrap items-center gap-2 md:col-span-2">
              <Button type="submit" loading={createShift.isPending} disabled={!newShiftCode || !newShiftName || !newWeeklySchedule.some((day) => day.enabled)}>
                <CalendarDays />
                {copy(locale, "Create schedule", "Créer l’horaire")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCreateShiftOpen(false)}>
                {t("attendance.cancel" as never)}
              </Button>
            </div>
          </form>
        ) : null}        <ul className="max-h-[60dvh] divide-y divide-border overflow-y-auto p-2">
          {shiftList.map((shift) => (
            <li key={shift.id}>
              <button
                type="button"
                onClick={() => setShiftId(shift.id)}
                aria-current={shift.id === activeShiftId ? "true" : undefined}
                className={`w-full rounded-xl border-l-4 px-3.5 py-3.5 text-left transition ${
                  shift.id === activeShiftId
                    ? "border-l-brand bg-brand-subtle shadow-sm ring-1 ring-brand/10"
                    : "border-l-transparent hover:bg-surface-2"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-semibold text-ink">
                    {shift.name}
                  </p>
                  <span className="shrink-0 rounded-full bg-surface-1 px-2 py-1 text-[11px] font-semibold tabular text-brand shadow-sm">
                    {shiftHours(shift, locale)}
                  </span>
                </div>
                {shift.site?.name ?? shift.siteName ? (
                  <p className="mt-2 flex items-center gap-1.5 truncate text-xs text-ink-muted">
                    <Building2 className="size-3.5 shrink-0" aria-hidden />
                    {shift.site?.name ?? shift.siteName}
                  </p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-surface-1 via-surface-1 to-surface-2 shadow-[0_20px_48px_-34px_rgba(15,23,42,.38)] dark:shadow-[0_20px_48px_-34px_rgba(0,0,0,.85)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-gradient-to-r from-surface-1 via-surface-1 to-brand-subtle/20 p-4 sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-brand/20 bg-brand-subtle text-brand">
              <ClipboardCheck className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[.14em] text-brand">
                {copy(locale, "Selected schedule", "Horaire sélectionné")}
              </p>
              <h2 className="truncate text-base font-semibold text-ink">
                {selectedShift?.name ?? t("attendance.assignedEmployees" as never)}
              </h2>
              <p className="mt-0.5 truncate text-xs text-ink-secondary">
                {selectedShift?.site?.name ?? selectedShift?.siteName ?? "—"}
                {" · "}
                {rosterAssignmentSummary}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedShift ? (
              <span className="rounded-full border border-brand/20 bg-brand-subtle px-2.5 py-1 text-xs font-semibold tabular text-brand">
                {shiftHours(selectedShift, locale)}
              </span>
            ) : null}
          {canRoster ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!editingShift && selectedShift) {
                    setShiftName(selectedShift.name);
                    setShiftStartsAt(selectedShift.startsAt?.slice(0, 5) ?? "");
                    setShiftEndsAt(selectedShift.endsAt?.slice(0, 5) ?? "");
                    setShiftWeeklySchedule(
                      normaliseWeeklyPlan(
                        selectedShift.weeklySchedule,
                        selectedShift.startsAt?.slice(0, 5),
                        selectedShift.endsAt?.slice(0, 5),
                      ),
                    );
                  }
                  setEditingShift((open) => !open);
                }}
              >
                {copy(locale, "Edit shift", "Modifier l’horaire")}
              </Button>
              <Button size="sm" onClick={() => setFormOpen((open) => !open)}>
                <UserPlus />
                {formOpen
                  ? t("attendance.cancel" as never)
                  : t("attendance.assign" as never)}
              </Button>
            </div>
          ) : null}
          </div>
        </div>

        {editingShift && canRoster ? (
          <form
            className="m-4 grid gap-4 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 shadow-inner sm:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              updateShift.mutate();
            }}
          >
            <div className="sm:col-span-3">
              <p className="text-sm font-semibold text-ink">
                {copy(locale, "Edit shared shift", "Modifier l’horaire partagé")}
              </p>
              <p className="mt-1 text-xs text-ink-secondary">
                {copy(
                  locale,
                  "These hours apply to every employee currently assigned to this shift. Attendance already recorded is preserved.",
                  "Ces heures s’appliquent à chaque employé affecté à cet horaire. Les présences déjà enregistrées sont conservées.",
                )}
              </p>
            </div>
            <div className="sm:col-span-3">
              <Field label={copy(locale, "Shift name", "Nom de l’horaire")} htmlFor="edit-shift-name" required>
                <Input id="edit-shift-name" value={shiftName} onChange={(event) => setShiftName(event.target.value)} required />
              </Field>
            </div>
            <WeeklyPlanEditor
              plan={shiftWeeklySchedule}
              onChange={setShiftWeeklySchedule}
              locale={locale}
              idPrefix="edit-shift-week"
            />
            {shiftUpdateError ? <p className="text-xs text-critical sm:col-span-3" role="alert">{shiftUpdateError}</p> : null}
            <div className="flex flex-wrap gap-2 sm:col-span-3">
              <Button type="submit" loading={updateShift.isPending} disabled={!shiftName || !shiftWeeklySchedule.some((day) => day.enabled)}>
                {copy(locale, "Save shift", "Enregistrer l’horaire")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditingShift(false)}>
                {t("attendance.cancel" as never)}
              </Button>
            </div>
          </form>
        ) : null}

        {formOpen && canRoster ? (
          <form
            className="m-4 grid gap-4 rounded-2xl border border-brand/20 bg-brand-subtle/35 p-4 shadow-inner sm:grid-cols-3"
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
          <ul className="grid gap-3 p-3 sm:p-4">
            {(assignments.data ?? []).map((row) => (
              <li key={row.id} className="rounded-2xl border border-border bg-surface-1 p-4 shadow-[0_12px_28px_-26px_rgba(15,23,42,.45)] transition hover:border-brand/25 hover:bg-surface-2/45 dark:shadow-[0_12px_28px_-26px_rgba(0,0,0,.8)]">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-brand/15 bg-brand-subtle text-xs font-bold text-brand">
                    {employeeInitials(row)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-ink">
                        {employeeName(row)}
                      </p>
                      {assignmentState(row) === "scheduled" ? (
                        <Badge variant="info">{copy(locale, "Scheduled", "À venir")}</Badge>
                      ) : assignmentState(row) === "ended" ? (
                        <Badge variant="outline">{copy(locale, "Ended", "Terminée")}</Badge>
                      ) : (
                        <Badge variant="good">{copy(locale, "Active", "Active")}</Badge>
                      )}
                    </div>
                    {employeeNumber(row) ? (
                      <p className="mt-0.5 text-xs text-ink-muted">
                        #{employeeNumber(row)}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                  <p className="text-xs text-ink-secondary">
                    <span className="font-medium text-ink-secondary">{copy(locale, "Assigned", "Affecté")}</span>{" · "}
                    {formatBusinessDay(row.effectiveFrom)}
                    {row.effectiveTo
                      ? ` → ${formatBusinessDay(row.effectiveTo)}`
                      : ` → ${t("attendance.openEnded" as never)}`}
                  </p>
                  {canRoster && !row.effectiveTo ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setChangingAssignmentId(
                          changingAssignmentId === row.id ? null : row.id,
                        );
                        setTargetShiftId("");
                        setChangeEffectiveFrom(dayAfter(row.effectiveFrom));
                      }}
                    >
                      {copy(locale, "Change schedule", "Changer d’horaire")}
                    </Button>
                  ) : null}
                  {canRoster && !row.effectiveTo ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const opening = exceptionAssignmentId !== row.id;
                        setExceptionAssignmentId(opening ? row.id : null);
                        if (opening) {
                          setExceptionWorkDate(new Date().toISOString().slice(0, 10));
                          setExceptionIsWorking(true);
                          setExceptionStartsAt(selectedShift?.startsAt?.slice(0, 5) ?? "08:00");
                          setExceptionEndsAt(selectedShift?.endsAt?.slice(0, 5) ?? "17:00");
                          setExceptionBreakMinutes(0);
                          setExceptionNote("");
                        }
                      }}
                    >
                      {exceptionAssignmentId === row.id
                        ? copy(locale, "Close exceptions", "Fermer les exceptions")
                        : copy(locale, "Date exception", "Exception de date")}
                    </Button>
                  ) : null}
                </div>

                {exceptionAssignmentId === row.id ? (
                  <form
                    className="mt-4 grid gap-4 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 shadow-inner sm:grid-cols-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveException.mutate();
                    }}
                  >
                    <div className="sm:col-span-3">
                      <p className="text-sm font-semibold text-ink">{copy(locale, "One-day schedule exception", "Exception de planning sur une date")}</p>
                      <p className="mt-1 text-xs leading-5 text-ink-secondary">
                        {copy(locale, "Use this only for one date. It does not change this employee’s recurring weekly schedule or another employee’s schedule.", "Utilisez cette option uniquement pour une date. Elle ne modifie ni l’horaire hebdomadaire récurrent de cet employé, ni celui des autres employés.")}
                      </p>
                    </div>
                    <Field label={copy(locale, "Exception date", "Date de l’exception")} htmlFor={`exception-date-${row.id}`} required>
                      <Input
                        id={`exception-date-${row.id}`}
                        type="date"
                        min={row.effectiveFrom}
                        max={row.effectiveTo ?? undefined}
                        value={exceptionWorkDate}
                        onChange={(event) => setExceptionWorkDate(event.target.value)}
                        required
                      />
                    </Field>
                    <div className="sm:col-span-2">
                      <p className="mb-1.5 text-xs font-medium text-ink-secondary">{copy(locale, "That day", "Pour cette journée")}</p>
                      <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface-1 p-1.5">
                        <Button type="button" size="sm" variant={exceptionIsWorking ? "primary" : "secondary"} onClick={() => setExceptionIsWorking(true)}>{copy(locale, "Working day", "Jour travaillé")}</Button>
                        <Button type="button" size="sm" variant={!exceptionIsWorking ? "primary" : "secondary"} onClick={() => setExceptionIsWorking(false)}>{copy(locale, "Rest day", "Jour de repos")}</Button>
                      </div>
                    </div>
                    {exceptionIsWorking ? <>
                      <Field label={copy(locale, "Start", "Début")} htmlFor={`exception-start-${row.id}`} required>
                        <Input id={`exception-start-${row.id}`} type="time" value={exceptionStartsAt} onChange={(event) => setExceptionStartsAt(event.target.value)} required />
                      </Field>
                      <Field label={copy(locale, "End", "Fin")} htmlFor={`exception-end-${row.id}`} required>
                        <Input id={`exception-end-${row.id}`} type="time" value={exceptionEndsAt} onChange={(event) => setExceptionEndsAt(event.target.value)} required />
                      </Field>
                      <Field label={copy(locale, "Break (minutes)", "Pause (minutes)")} htmlFor={`exception-break-${row.id}`}>
                        <Input id={`exception-break-${row.id}`} type="number" min="0" max="720" value={exceptionBreakMinutes} onChange={(event) => setExceptionBreakMinutes(Number(event.target.value || 0))} />
                      </Field>
                    </> : null}
                    <label className="grid gap-1 text-xs font-medium text-ink-secondary sm:col-span-3">
                      {copy(locale, "Reason / internal note", "Motif / note interne")}
                      <textarea className="control min-h-20 resize-y" maxLength={1000} value={exceptionNote} onChange={(event) => setExceptionNote(event.target.value)} placeholder={copy(locale, "Example: approved Sunday stock count", "Ex. inventaire approuvé du dimanche")} />
                    </label>
                    {saveException.error instanceof ApiError ? <p className="text-xs text-critical sm:col-span-3" role="alert">{saveException.error.message}</p> : null}
                    <div className="flex flex-wrap gap-2 sm:col-span-3">
                      <Button type="submit" loading={saveException.isPending} disabled={!exceptionWorkDate || (exceptionIsWorking && (!exceptionStartsAt || !exceptionEndsAt))}>{copy(locale, "Save exception", "Enregistrer l’exception")}</Button>
                      <Button type="button" variant="ghost" onClick={() => setExceptionAssignmentId(null)}>{t("attendance.cancel" as never)}</Button>
                    </div>
                    <div className="border-t border-amber-500/15 pt-3 sm:col-span-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{copy(locale, "Scheduled exceptions", "Exceptions enregistrées")}</p>
                      {assignmentExceptions.isPending ? <p className="mt-2 text-xs text-ink-secondary">{copy(locale, "Loading…", "Chargement…")}</p> : assignmentExceptions.isError ? <p className="mt-2 text-xs text-critical">{(assignmentExceptions.error as ApiError)?.message}</p> : assignmentExceptions.data?.length ? <div className="mt-2 space-y-2">{assignmentExceptions.data.map((exception) => <div key={exception.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 px-3 py-2.5"><div><p className="text-xs font-semibold text-ink">{formatBusinessDay(exception.workDate)} · {exception.isWorking ? `${exception.startsAt}–${exception.endsAt}` : copy(locale, "Rest day", "Jour de repos")}</p>{exception.note ? <p className="mt-0.5 text-xs text-ink-secondary">{exception.note}</p> : null}</div><Button type="button" size="sm" variant="ghost" className="text-critical hover:bg-critical/10 hover:text-critical" loading={deleteException.isPending && deleteException.variables === exception.id} onClick={() => deleteException.mutate(exception.id)}>{copy(locale, "Remove", "Retirer")}</Button></div>)}</div> : <p className="mt-2 text-xs text-ink-secondary">{copy(locale, "No date exception for this employee.", "Aucune exception de date pour cet employé.")}</p>}
                    </div>
                  </form>
                ) : null}
                {changingAssignmentId === row.id ? (
                  <form
                    className="mt-4 grid gap-4 rounded-2xl border border-brand/20 bg-brand-subtle/30 p-4 shadow-inner sm:grid-cols-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      changeAssignment.mutate();
                    }}
                  >
                    <div className="sm:col-span-2">
                      <p className="text-sm font-semibold text-ink">
                        {copy(locale, "Change this employee’s schedule", "Changer l’horaire de cet employé")}
                      </p>
                      <p className="mt-1 text-xs text-ink-secondary">
                        {copy(
                          locale,
                          "The current assignment will end the day before the selected date. Previous attendance records are not changed.",
                          "L’affectation actuelle se terminera la veille de la date choisie. Les présences précédentes ne sont pas modifiées.",
                        )}
                      </p>
                    </div>
                    <Field label={copy(locale, "New schedule", "Nouvel horaire")} htmlFor={`change-shift-${row.id}`} required>
                      <select
                        id={`change-shift-${row.id}`}
                        value={targetShiftId}
                        onChange={(event) => setTargetShiftId(event.target.value)}
                        required
                        className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
                      >
                        <option value="">{copy(locale, "Choose a schedule", "Choisissez un horaire")}</option>
                        {availableReplacementShifts.map((shift) => (
                          <option key={shift.id} value={shift.id}>
                            {shift.name} · {shiftHours(shift, locale)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={copy(locale, "New schedule starts", "Nouvel horaire à partir du")} htmlFor={`change-from-${row.id}`} required>
                      <Input
                        id={`change-from-${row.id}`}
                        type="date"
                        min={dayAfter(row.effectiveFrom)}
                        value={changeEffectiveFrom}
                        onChange={(event) => setChangeEffectiveFrom(event.target.value)}
                        required
                      />
                    </Field>
                    {availableReplacementShifts.length === 0 ? (
                      <p className="text-xs text-ink-secondary sm:col-span-2">
                        {copy(
                          locale,
                          "Create another shift for this province first, then return here to move this employee.",
                          "Créez d’abord un autre horaire pour cette province, puis revenez ici pour déplacer cet employé.",
                        )}
                      </p>
                    ) : null}
                    {scheduleChangeError ? <p className="text-xs text-critical sm:col-span-2" role="alert">{scheduleChangeError}</p> : null}
                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                      <Button type="submit" loading={changeAssignment.isPending} disabled={!targetShiftId || !changeEffectiveFrom}>
                        {copy(locale, "Confirm schedule change", "Confirmer le changement")}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setChangingAssignmentId(null)}>
                        {t("attendance.cancel" as never)}
                      </Button>
                    </div>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function WeeklyPlanEditor({
  plan,
  onChange,
  locale,
  idPrefix,
}: {
  plan: WeeklyScheduleDay[];
  onChange: (next: WeeklyScheduleDay[]) => void;
  locale: string;
  idPrefix: string;
}) {
  const labels = weekDayNames(locale);
  const changeDay = (day: number, patch: Partial<WeeklyScheduleDay>) =>
    onChange(plan.map((item) => (item.day === day ? { ...item, ...patch } : item)));

  return (
    <fieldset className="rounded-2xl border border-border bg-gradient-to-br from-surface-1 via-surface-1 to-brand-subtle/20 p-4 shadow-inner sm:col-span-3 sm:p-5">
      <legend className="px-1">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="grid size-7 place-items-center rounded-lg bg-brand-subtle text-brand">
            <CalendarDays className="size-4" aria-hidden />
          </span>
          {copy(locale, "Weekly work plan", "Planning hebdomadaire")}
        </span>
      </legend>
      <p className="mt-1 max-w-3xl text-xs leading-5 text-ink-secondary">
        {copy(
          locale,
          "This pattern repeats every week until the employee’s schedule changes. Turn off Sunday when it is a rest day; use shorter hours on Saturday where applicable.",
          "Ce planning se répète chaque semaine jusqu’à un changement d’horaire. Désactivez dimanche lorsqu’il est chômé et définissez un samedi plus court si nécessaire.",
        )}
      </p>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {plan.map((day) => (
          <div
            key={day.day}
            className={`rounded-xl border p-3 transition sm:p-3.5 ${
              day.enabled
                ? "border-border bg-surface-1 shadow-sm"
                : "border-border/70 bg-surface-2/60"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <label className="flex min-w-0 items-center gap-2.5 text-sm font-semibold text-ink">
                <input
                  type="checkbox"
                  checked={day.enabled}
                  onChange={(event) => changeDay(day.day, { enabled: event.target.checked })}
                  className="size-4 rounded border-border-strong accent-brand"
                />
                {labels[day.day - 1]}
              </label>
              {day.enabled ? (
                <span className="rounded-full bg-brand-subtle px-2.5 py-1 text-xs font-semibold tabular text-brand">
                  {planHoursLabel([day], locale)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                  <TimerReset className="size-3.5" aria-hidden />
                  {copy(locale, "Rest", "Repos")}
                </span>
              )}
            </div>
            {day.enabled ? (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-ink-secondary">
                  <span>{copy(locale, "Start", "Début")}</span>
                  <Input
                    className="h-11 min-w-0 bg-surface-1 px-3 text-sm font-medium text-ink shadow-sm"
                    id={`${idPrefix}-${day.day}-start`}
                    aria-label={`${labels[day.day - 1]} ${copy(locale, "start", "début")}`}
                    type="time"
                    value={day.startsAt ?? "08:00"}
                    onChange={(event) => changeDay(day.day, { startsAt: event.target.value })}
                    required
                  />
                </label>
                <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-ink-secondary">
                  <span>{copy(locale, "End", "Fin")}</span>
                  <Input
                    className="h-11 min-w-0 bg-surface-1 px-3 text-sm font-medium text-ink shadow-sm"
                    id={`${idPrefix}-${day.day}-end`}
                    aria-label={`${labels[day.day - 1]} ${copy(locale, "end", "fin")}`}
                    type="time"
                    value={day.endsAt ?? "17:00"}
                    onChange={(event) => changeDay(day.day, { endsAt: event.target.value })}
                    required
                  />
                </label>
                <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-ink-secondary">
                  <span>{copy(locale, "Break (minutes)", "Pause (minutes)")}</span>
                  <Input
                    className="h-11 min-w-0 bg-surface-1 px-3 text-sm font-medium text-ink shadow-sm"
                    id={`${idPrefix}-${day.day}-break`}
                    aria-label={`${labels[day.day - 1]} ${copy(locale, "break minutes", "minutes de pause")}`}
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="720"
                    value={day.breakMinutes ?? 0}
                    onChange={(event) => changeDay(day.day, { breakMinutes: Number(event.target.value || 0) })}
                  />
                </label>
              </div>
            ) : (
              <p className="mt-3 rounded-lg border border-dashed border-border bg-surface-1/45 px-3 py-2 text-xs text-ink-muted">
                {copy(locale, "No attendance is expected for this day.", "Aucun pointage n’est attendu ce jour.")}
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand/20 bg-brand-subtle/55 px-3 py-2.5">
        <span className="text-xs font-medium text-ink-secondary">
          {copy(locale, "Planned work time", "Temps de travail prévu")}
        </span>
        <span className="text-sm font-semibold tabular text-brand">
          {planHoursLabel(plan, locale)}
        </span>
      </div>
    </fieldset>
  );
}function Th({
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
