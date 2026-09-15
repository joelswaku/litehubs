"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Clock3,
  FileText,
  HeartPulse,
  Landmark,
  MapPin,
  ReceiptText,
  ShieldCheck,
  PenLine,
  Type,
  Upload,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ErrorState, SkeletonCard } from "@/components/ui/states";
import { ApiError, get, orgApiUrl, orgUrl, patch } from "@/lib/api";
import { useLanguage } from "@/providers/language-provider";
import { MyAccountProfile } from "./my-account-profile";
import type {
  ScheduleException,
  WeeklyScheduleDay,
} from "@/lib/attendance-api";
import { PayslipStatement } from "@/components/payroll/payslip-statement";

const copy = (fr: boolean, english: string, french: string) =>
  fr ? french : english;
const pretty = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const day = (value: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(`${value}T12:00:00`),
  );
const instant = (value: string | null, locale: string) =>
  value
    ? new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
const money = (value: number, currency: string, locale: string) =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "CDF",
    maximumFractionDigits: 0,
  }).format(value);

const weeklyMinutes = (plan?: WeeklyScheduleDay[]) =>
  (plan ?? []).reduce((total, item) => {
    if (!item.enabled || !item.startsAt || !item.endsAt) return total;
    const [startHour = 0, startMinute = 0] = item.startsAt
      .split(":")
      .map(Number);
    const [endHour = 0, endMinute = 0] = item.endsAt.split(":").map(Number);
    const span =
      (endHour * 60 + endMinute - (startHour * 60 + startMinute) + 1440) %
        1440 || 1440;
    return total + Math.max(0, span - Math.max(0, item.breakMinutes ?? 0));
  }, 0);
const hoursText = (hours: number, locale: string) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(hours);
const weekdayLabel = (dayNumber: number, fr: boolean) =>
  (fr
    ? ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])[
    Math.max(1, Math.min(7, dayNumber)) - 1
  ] ?? "—";

const localDateKey = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const date = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
};

type EmployeePaymentState = "scheduled" | "pending_payment" | "paid";

// Pay dates are stored as UTC-safe calendar dates. Compare the date portion at
// local noon so an employee never sees the status change a day early or late.
const employeePaymentState = (
  payslip: { payDate: string; status: string },
  todayKey = localDateKey(new Date()),
): EmployeePaymentState => {
  if (payslip.status === "paid") return "paid";
  const payDate = new Date(`${payslip.payDate}T12:00:00`);
  const pendingFrom = new Date(payDate);
  pendingFrom.setDate(pendingFrom.getDate() - 3);
  const today = new Date(`${todayKey}T12:00:00`);
  return today >= pendingFrom ? "pending_payment" : "scheduled";
};

const employeePaymentCopy = (state: EmployeePaymentState, fr: boolean) => {
  const labels: Record<EmployeePaymentState, [string, string]> = {
    scheduled: ["Scheduled", "Paiement prévu"],
    pending_payment: ["Pending payment", "En attente de paiement"],
    paid: ["Paid", "Payée"],
  };
  return copy(fr, labels[state][0], labels[state][1]);
};

const employeePaymentHint = (
  state: EmployeePaymentState,
  payDate: string,
  locale: string,
  fr: boolean,
) => {
  const formattedDate = day(payDate, locale);
  if (state === "paid")
    return copy(fr, `Paid on ${formattedDate}`, `Payée le ${formattedDate}`);
  if (state === "pending_payment")
    return copy(
      fr,
      `Expected on ${formattedDate}`,
      `Prévue le ${formattedDate}`,
    );
  return copy(
    fr,
    `Payment is scheduled for ${formattedDate}`,
    `Paiement prévu le ${formattedDate}`,
  );
};
const isIncomeTaxPayslipLine = (line: { code: string; type: string }) =>
  line.type === "deduction" &&
  /(income_?tax|taxe?|imp[ôo]t|withholding)/i.test(line.code);
function ScheduleMonthCalendar({
  plan,
  exceptions,
  effectiveFrom,
  effectiveTo,
  fr,
  locale,
}: {
  plan: WeeklyScheduleDay[];
  exceptions: ScheduleException[];
  effectiveFrom: string;
  effectiveTo?: string | null;
  fr: boolean;
  locale: string;
}) {
  const [month, setMonth] = useState(() => {
    const start = new Date(`${effectiveFrom}T12:00:00`);
    return new Date(start.getFullYear(), start.getMonth(), 1);
  });
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const leadingDays = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();
  const today = localDateKey(new Date());
  const title = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(month);
  const headers = fr
    ? ["L", "M", "M", "J", "V", "S", "D"]
    : ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-surface-2/45">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-1 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-brand-subtle text-brand">
            <CalendarDays className="size-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold capitalize text-ink">{title}</p>
            <p className="text-xs text-ink-secondary">
              {copy(
                fr,
                "Your exact recurring work days",
                "Vos jours de travail récurrents exacts",
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label={copy(fr, "Previous month", "Mois précédent")}
            onClick={() =>
              setMonth(
                (value) =>
                  new Date(value.getFullYear(), value.getMonth() - 1, 1),
              )
            }
            className="grid size-8 place-items-center rounded-lg border border-border bg-surface-1 text-ink-secondary transition hover:border-brand/30 hover:text-brand"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={copy(fr, "Next month", "Mois suivant")}
            onClick={() =>
              setMonth(
                (value) =>
                  new Date(value.getFullYear(), value.getMonth() + 1, 1),
              )
            }
            className="grid size-8 place-items-center rounded-lg border border-border bg-surface-1 text-ink-secondary transition hover:border-brand/30 hover:text-brand"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px bg-border/70 p-px">
        {headers.map((label, index) => (
          <div
            key={`${label}-${index}`}
            className="bg-surface-2 px-1 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-ink-muted"
          >
            {label}
          </div>
        ))}
        {Array.from({ length: leadingDays }, (_, index) => (
          <div
            key={`empty-${index}`}
            className="min-h-16 bg-surface-1/45 sm:min-h-20"
            aria-hidden
          />
        ))}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const date = new Date(
            month.getFullYear(),
            month.getMonth(),
            index + 1,
          );
          const dateKey = localDateKey(date);
          const mondayDay = ((date.getDay() + 6) % 7) + 1;
          const configured = plan.find((item) => item.day === mondayDay);
          const exception = exceptions.find(
            (item) => item.workDate === dateKey,
          );
          const inPeriod =
            dateKey >= effectiveFrom &&
            (!effectiveTo || dateKey <= effectiveTo);
          const working = Boolean(
            inPeriod &&
            (exception ? exception.isWorking : configured?.enabled) &&
            (exception
              ? exception.startsAt && exception.endsAt
              : configured?.startsAt && configured?.endsAt),
          );
          const resting = Boolean(inPeriod && !working);
          const startsAt = exception
            ? exception.startsAt
            : configured?.startsAt;
          const endsAt = exception ? exception.endsAt : configured?.endsAt;
          return (
            <div
              key={dateKey}
              className={`min-h-16 p-1.5 sm:min-h-20 sm:p-2 ${exception ? "bg-amber-500/10" : working ? "bg-brand-subtle/75" : resting ? "bg-surface-1" : "bg-surface-1/45"}`}
            >
              <span
                className={`grid size-5 place-items-center rounded-full text-[10px] font-semibold sm:size-6 sm:text-xs ${dateKey === today ? "bg-brand text-white" : exception ? "text-amber-700 dark:text-amber-300" : working ? "text-brand" : "text-ink-muted"}`}
              >
                {index + 1}
              </span>
              {working ? (
                <p
                  className={`mt-1 hidden text-[10px] font-semibold tabular-nums sm:block ${exception ? "text-amber-700 dark:text-amber-300" : "text-brand"}`}
                >
                  {startsAt}–{endsAt}
                </p>
              ) : resting ? (
                <p
                  className={`mt-1 hidden text-[10px] sm:block ${exception ? "font-semibold text-amber-700 dark:text-amber-300" : "text-ink-muted"}`}
                >
                  {exception
                    ? copy(fr, "Exception", "Exception")
                    : copy(fr, "Rest", "Repos")}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border bg-surface-1 px-4 py-3 text-xs text-ink-secondary">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-brand" />
          {copy(fr, "Scheduled work day", "Jour travaillé")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-surface-2 ring-1 ring-border" />
          {copy(fr, "Rest day", "Jour de repos")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-amber-500" />
          {copy(fr, "Date exception", "Exception de date")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-surface-2/50" />
          {copy(fr, "Outside assignment period", "Hors période d’affectation")}
        </span>
      </div>
    </div>
  );
}
const contractStatusText = (status: string, fr: boolean) => {
  const labels: Record<string, [string, string]> = {
    draft: ["Draft", "Brouillon"],
    pending_signature: ["Awaiting signature", "À signer"],
    ready_for_signature: ["Ready for signature", "Prêt à signer"],
    awaiting_employee_signature: [
      "Awaiting employee signature",
      "En attente de votre signature",
    ],
    awaiting_employer_signature: [
      "Awaiting employer signature",
      "En attente de l’employeur",
    ],
    signed: ["Signed", "Signé"],
    rejected: ["Rejected", "Refusé"],
    active: ["Active", "Actif"],
    renewed: ["Renewed", "Renouvelé"],
    expired: ["Expired", "Expiré"],
    terminated: ["Terminated", "Résilié"],
    cancelled: ["Cancelled", "Annulé"],
  };
  const label = labels[status];
  return label ? copy(fr, label[0], label[1]) : pretty(status);
};
const statusVariant = (status: string) =>
  ["present", "approved", "paid", "taken", "active", "renewed"].includes(status)
    ? ("good" as const)
    : ["late", "pending"].includes(status)
      ? ("warning" as const)
      : ["absent", "rejected", "cancelled"].includes(status)
        ? ("serious" as const)
        : ("outline" as const);

type Account = {
  organization: {
    name: string;
    logoUrl?: string | null;
  };
  employee: {
    employeeNumber: string;
    fullName: string;
    jobTitle: string;
    positionCategory: string;
    member?: { email?: string | null } | null;
    province?: { name?: string | null } | null;
    site?: { name?: string | null } | null;
    department?: { name?: string | null } | null;
    employment: { status: string; type: string; startDate?: string | null };
  };
  schedule: {
    id: string;
    code: string;
    name: string;
    startsAt: string;
    endsAt: string;
    weeklySchedule?: WeeklyScheduleDay[];
    exceptions?: ScheduleException[];
    effectiveFrom: string;
    effectiveTo?: string | null;
    provinceName: string;
    siteName: string;
    departmentName?: string | null;
  } | null;
  attendance: {
    id: string;
    workDate: string;
    status: string;
    clockInAt?: string | null;
    clockOutAt?: string | null;
    expectedHours?: number | null;
    workedHours?: number | null;
    overtimeHours?: number | null;
    shiftName?: string | null;
    siteName?: string | null;
  }[];
  leave: {
    balances: {
      id: string;
      type: string;
      isPaid: boolean;
      entitledDays: number;
      carriedOverDays: number;
      takenDays: number;
      remainingDays: number;
    }[];
    requests: {
      id: string;
      type: string;
      isPaid: boolean;
      startsOn: string;
      endsOn: string;
      requestedDays: number;
      status: string;
    }[];
  };
  contracts: {
    id: string;
    reference: string;
    title: string;
    startsOn: string;
    endsOn?: string | null;
    autoRenews: boolean;
    renewalNoticeDays?: number | null;
    currency?: string | null;
    contractValue?: number | null;
    paymentTerms?: string | null;
    status: string;
    document?: {
      id: string;
      title?: string | null;
      fileName?: string | null;
    } | null;
    signedOn?: string | null;
    terminatedOn?: string | null;
    terminationReason?: string | null;
    signatureName?: string | null;
    signedAt?: string | null;
  }[];
  payslips: {
    id: string;
    reference: string;
    payrollRunReference: string;
    periodStart: string;
    periodEnd: string;
    payDate: string;
    currency: string;
    status: string;
    grossPay: number;
    totalDeductions: number;
    netPay: number;
    paymentMethod?: string | null;
    paymentReference?: string | null;
    lines: {
      id: string;
      code: string;
      name: string;
      type: "earning" | "deduction" | "employer_cost";
      amount: number;
      basis?: string | null;
    }[];
  }[];
};

function Section({
  title,
  description,
  icon: Icon,
  action,
  children,
  id,
  hidden,
}: {
  title: string;
  description: string;
  icon: typeof Wallet;
  action?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  hidden?: boolean;
}) {
  return (
    <section
      id={id}
      className={`group relative scroll-mt-5 overflow-hidden rounded-2xl border border-border-strong/80 bg-surface-1 shadow-[0_18px_42px_-32px_rgba(15,23,42,.5)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_44px_-30px_rgba(15,23,42,.58)] ${hidden ? "hidden" : ""}`}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(20,184,166,.55),transparent)]" />
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-[linear-gradient(115deg,rgba(20,184,166,.07),transparent_52%)] px-5 py-4">
        <div className="flex gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-brand/20 bg-brand-subtle text-brand shadow-sm">
            <Icon className="size-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            <p className="mt-0.5 max-w-md text-xs leading-5 text-ink-secondary">
              {description}
            </p>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function OpenLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-lg border border-brand/20 bg-brand-subtle px-2.5 py-1.5 text-xs font-semibold text-brand transition hover:border-brand/40 hover:bg-brand hover:text-white"
    >
      {children}
      <ChevronRight className="size-3.5" aria-hidden />
    </Link>
  );
}
type PersonalSection =
  "overview" | "schedule" | "leave" | "attendance" | "payslips" | "contracts";

const personalSectionKeys = [
  "schedule",
  "leave",
  "attendance",
  "payslips",
  "contracts",
] as const;

function sectionFromHash(hash: string): PersonalSection {
  const key = hash.replace(/^#/, "");
  return personalSectionKeys.includes(
    key as (typeof personalSectionKeys)[number],
  )
    ? (key as PersonalSection)
    : "overview";
}

function AccountSectionNav({
  fr,
  activeSection,
  onSelect,
}: {
  fr: boolean;
  activeSection: PersonalSection;
  onSelect: (section: PersonalSection) => void;
}) {
  const items: { id: PersonalSection; label: string; icon: typeof Wallet }[] = [
    {
      id: "overview",
      label: copy(fr, "Overview", "Vue d’ensemble"),
      icon: CircleUserRound,
    },
    {
      id: "schedule",
      label: copy(fr, "Schedule", "Horaire"),
      icon: CalendarClock,
    },
    { id: "leave", label: copy(fr, "Leave", "Congés"), icon: HeartPulse },
    {
      id: "attendance",
      label: copy(fr, "Attendance", "Présence"),
      icon: Clock3,
    },
    { id: "payslips", label: copy(fr, "Payslips", "Paie"), icon: ReceiptText },
    {
      id: "contracts",
      label: copy(fr, "Contracts", "Contrats"),
      icon: FileText,
    },
  ];

  return (
    <nav
      aria-label={copy(
        fr,
        "Personal account sections",
        "Rubriques de mon compte",
      )}
      className="overflow-x-auto rounded-2xl border border-border-strong/80 bg-surface-1 p-1.5 shadow-[0_16px_34px_-28px_rgba(15,23,42,.6)]"
    >
      <div className="flex min-w-max items-center gap-1">
        {items.map(({ id, label, icon: Icon }) => {
          const selected = activeSection === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              aria-current={selected ? "page" : undefined}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition sm:px-4 ${
                selected
                  ? "bg-brand text-white shadow-sm"
                  : "text-ink-secondary hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

type PayslipView = "current" | "history";

export function MyAccountArea({
  orgSlug,
  initialSection,
  payslipView = "current",
}: {
  orgSlug: string;
  initialSection?: PersonalSection;
  payslipView?: PayslipView;
}) {
  const { locale } = useLanguage();
  const fr = locale.startsWith("fr");
  const queryClient = useQueryClient();
  const [openedContract, setOpenedContract] = useState<
    Account["contracts"][number] | null
  >(null);
  const [openedPayslip, setOpenedPayslip] = useState<
    Account["payslips"][number] | null
  >(null);
  const [showAllHistoricPayslips, setShowAllHistoricPayslips] = useState(false);
  const [activeSection, setActiveSection] = useState<PersonalSection>(
    initialSection ?? "overview",
  );
  const [todayKey, setTodayKey] = useState(() => localDateKey(new Date()));
  const account = useQuery({
    queryKey: ["my-account", orgSlug],
    queryFn: () => get<{ account: Account }>(orgUrl(orgSlug, "my-account")),
    select: (response) => response.account,
  });
  const personalContracts = useQuery({
    queryKey: ["my-employment-contracts", orgSlug],
    queryFn: () =>
      get<{ contracts: Account["contracts"] }>(orgUrl(orgSlug, "my-contracts")),
    select: (response) => response.contracts,
    enabled: Boolean(account.data),
  });
  const signContract = useMutation({
    mutationFn: (contractId: string) =>
      patch(orgUrl(orgSlug, `my-contracts/${contractId}/sign`), {
        acknowledged: true,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["my-employment-contracts", orgSlug],
      });
      setOpenedContract(null);
    },
  });
  const signContractField = useMutation({
    mutationFn: ({
      contractId,
      fieldId,
      legalName,
      method,
      signatureData,
    }: {
      contractId: string;
      fieldId: string;
      legalName: string;
      method: "typed" | "drawn" | "uploaded";
      signatureData: string | null;
    }) =>
      patch(
        orgUrl(
          orgSlug,
          `my-contracts/${contractId}/workspace/signatures/${fieldId}`,
        ),
        { legalName, method, signatureData, acknowledged: true },
      ),
    onSuccess: (_, values) => {
      void queryClient.invalidateQueries({
        queryKey: ["my-employment-contracts", orgSlug],
      });
      void queryClient.invalidateQueries({
        queryKey: ["my-contract-workspace", orgSlug, values.contractId],
      });
    },
  });

  useEffect(() => {
    const updateSection = () =>
      setActiveSection(initialSection ?? sectionFromHash(window.location.hash));
    updateSection();
    if (initialSection) return;
    window.addEventListener("hashchange", updateSection);
    return () => window.removeEventListener("hashchange", updateSection);
  }, [initialSection]);

  // Keeps the employee-facing payment state correct if the page remains open
  // across midnight, without requiring a manual refresh.
  useEffect(() => {
    const refreshToday = () => setTodayKey(localDateKey(new Date()));
    const timer = window.setInterval(refreshToday, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const selectSection = (section: PersonalSection) => {
    setActiveSection(section);
    const hash = section === "overview" ? "" : `#${section}`;
    window.history.replaceState(null, "", `/${orgSlug}/my-account${hash}`);
  };
  if (account.isPending)
    return (
      <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
        <SkeletonCard rows={4} />
        <div className="grid gap-5 lg:grid-cols-2">
          <SkeletonCard rows={5} />
          <SkeletonCard rows={5} />
        </div>
      </main>
    );
  if (account.isError) {
    const message =
      account.error instanceof ApiError ? account.error.message : undefined;
    const missingProfile =
      account.error instanceof ApiError && account.error.status === 404;
    return (
      <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <ErrorState
          title={copy(
            fr,
            "Your employee account is not ready",
            "Votre compte employé n’est pas encore prêt",
          )}
          description={
            missingProfile
              ? copy(
                  fr,
                  "Ask the owner or HR team to link your LiteHubs account to your employee record.",
                  "Demandez au propriétaire ou aux RH de lier votre compte LiteHubs à votre fiche employé.",
                )
              : message
          }
          onRetry={() => void account.refetch()}
        />
      </main>
    );
  }

  const data = account.data;
  const schedulePlan = data.schedule?.weeklySchedule ?? [];
  const plannedWeeklyHours = weeklyMinutes(schedulePlan) / 60;

  // Mon compte reste limité à l’identité et à la sécurité. Les autres sujets
  // disposent chacun de leur entrée dédiée dans la navigation personnelle.
  if (!initialSection) return <MyAccountProfile account={data} />;

  const latestPay = data.payslips[0] ?? null;
  const historicPayslips = data.payslips.slice(1);
  const visibleHistoricPayslips = showAllHistoricPayslips
    ? historicPayslips
    : historicPayslips.slice(0, 12);
  const isPayslipHistory =
    initialSection === "payslips" && payslipView === "history";
  const displayedPayslips = isPayslipHistory
    ? visibleHistoricPayslips
    : latestPay
      ? [latestPay]
      : [];
  const remainingLeave = data.leave.balances.reduce(
    (total, balance) => total + balance.remainingDays,
    0,
  );
  const pendingLeave = data.leave.requests.filter(
    (request) => request.status === "pending",
  ).length;

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <section className="relative isolate overflow-hidden rounded-[1.65rem] border border-white/15 bg-[#0a315d] px-5 py-6 text-white shadow-[0_26px_58px_-34px_rgba(7,36,76,.88)] sm:px-7 sm:py-8">
        <div
          className="absolute inset-0 bg-[radial-gradient(circle_at_8%_-30%,rgba(115,205,255,.42),transparent_44%),radial-gradient(circle_at_92%_5%,rgba(69,211,170,.22),transparent_28%)]"
          aria-hidden
        />
        <div
          className="absolute -bottom-20 right-[19%] size-48 rounded-full border border-white/10"
          aria-hidden
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl border border-white/20 bg-white/10 text-blue-50 shadow-lg shadow-black/10">
              <CircleUserRound className="size-7" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[.16em] text-blue-100/85">
                {isPayslipHistory
                  ? copy(fr, "Payment history", "Historique de paie")
                  : initialSection === "payslips"
                    ? copy(fr, "My payslips", "Mes fiches de paie")
                    : copy(fr, "My account", "Mon compte")}
              </p>
              <h1 className="mt-1 truncate text-2xl font-semibold tracking-[-.035em] sm:text-3xl">
                {data.employee.fullName}
              </h1>
              <p className="mt-1 text-sm text-blue-50/90">
                {data.employee.jobTitle}{" "}
                <span className="text-blue-200/70">·</span> #
                {data.employee.employeeNumber}
              </p>
              {data.employee.member?.email ? (
                <p className="mt-1 truncate text-xs text-blue-100/75">
                  {data.employee.member.email}
                </p>
              ) : null}
            </div>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:max-w-md">
            <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-blue-100/80">
                <MapPin className="size-3.5" aria-hidden />
                <span className="text-[11px] font-semibold uppercase tracking-wide">
                  {copy(fr, "Work location", "Lieu de travail")}
                </span>
              </div>
              <p className="mt-2 truncate text-sm font-semibold text-white">
                {data.employee.site?.name ??
                  data.employee.province?.name ??
                  "—"}
              </p>
              <p className="mt-0.5 truncate text-xs text-blue-100/75">
                {data.employee.department?.name ??
                  copy(
                    fr,
                    "No department assigned",
                    "Aucun département affecté",
                  )}
              </p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-blue-100/80">
                <BadgeCheck className="size-3.5" aria-hidden />
                <span className="text-[11px] font-semibold uppercase tracking-wide">
                  {copy(fr, "Employment", "Emploi")}
                </span>
              </div>
              <p className="mt-2 text-sm font-semibold text-white">
                {pretty(data.employee.positionCategory)}
              </p>
              <p className="mt-0.5 text-xs text-blue-100/75">
                {pretty(data.employee.employment.status)} ·{" "}
                {pretty(data.employee.employment.type)}
              </p>
            </div>
          </div>
        </div>
      </section>
      {initialSection ? null : (
        <AccountSectionNav
          fr={fr}
          activeSection={activeSection}
          onSelect={selectSection}
        />
      )}

      {activeSection === "overview" ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            tone="blue"
            icon={CalendarClock}
            label={copy(fr, "My schedule", "Mon horaire")}
            value={
              data.schedule
                ? schedulePlan.length
                  ? `${hoursText(plannedWeeklyHours, locale)} ${copy(fr, "h/week", "h/semaine")}`
                  : `${data.schedule.startsAt}–${data.schedule.endsAt}`
                : "—"
            }
            hint={
              data.schedule?.name ??
              copy(fr, "No current shift", "Aucun horaire en cours")
            }
          />
          <Metric
            tone="rose"
            icon={HeartPulse}
            label={copy(fr, "Leave remaining", "Congés restants")}
            value={`${remainingLeave} ${copy(fr, "days", "jours")}`}
            hint={
              pendingLeave
                ? `${pendingLeave} ${copy(fr, "pending", "en attente")}`
                : copy(fr, "Current balance", "Solde actuel")
            }
          />
          <Metric
            tone="amber"
            icon={Clock3}
            label={copy(fr, "Attendance", "Présence")}
            value={String(data.attendance.length)}
            hint={copy(fr, "Recent records", "Enregistrements récents")}
          />
          <Metric
            tone="emerald"
            icon={Wallet}
            label={copy(fr, "Latest pay", "Dernière paie")}
            value={
              latestPay
                ? money(latestPay.netPay, latestPay.currency, locale)
                : "—"
            }
            hint={
              latestPay
                ? day(latestPay.payDate, locale)
                : copy(fr, "No published payslip", "Aucune fiche publiée")
            }
          />
        </section>
      ) : null}

      <section
        className={
          activeSection === "overview"
            ? "grid gap-5 xl:grid-cols-2"
            : "mx-auto grid w-full max-w-4xl gap-5"
        }
      >
        <Section
          id="schedule"
          hidden={activeSection !== "overview" && activeSection !== "schedule"}
          title={copy(fr, "My schedule", "Mon horaire")}
          description={copy(
            fr,
            "Your current assigned shift and work location.",
            "Votre horaire affecté et votre lieu de travail actuel.",
          )}
          icon={CalendarClock}
          action={
            <OpenLink href={`/${orgSlug}/my-attendance`}>
              {copy(fr, "Attendance", "Présence")}
            </OpenLink>
          }
        >
          {data.schedule ? (
            <div className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-ink">
                    {data.schedule.name}
                  </p>
                  <p className="mt-1 text-xs text-ink-secondary">
                    {data.schedule.code} · {data.schedule.siteName}
                  </p>
                </div>
                <span className="rounded-xl bg-brand/10 px-3 py-2 text-sm font-semibold text-brand">
                  {schedulePlan.length
                    ? `${hoursText(plannedWeeklyHours, locale)} ${copy(fr, "h/week", "h/semaine")}`
                    : `${data.schedule.startsAt} — ${data.schedule.endsAt}`}
                </span>
              </div>
              {schedulePlan.length ? (
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                  {schedulePlan.map((item) => (
                    <div
                      key={item.day}
                      className={`rounded-xl border px-3 py-2 ${item.enabled ? "border-border-strong bg-surface-2" : "border-border bg-surface-2/40"}`}
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                        {weekdayLabel(item.day, fr)}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-ink">
                        {item.enabled && item.startsAt && item.endsAt
                          ? `${item.startsAt}–${item.endsAt}`
                          : copy(fr, "Rest", "Repos")}
                      </p>
                      {item.enabled && item.breakMinutes ? (
                        <p className="mt-0.5 text-[11px] text-ink-secondary">
                          {item.breakMinutes}{" "}
                          {copy(fr, "min break", "min pause")}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {schedulePlan.length ? (
                <ScheduleMonthCalendar
                  plan={schedulePlan}
                  exceptions={data.schedule.exceptions ?? []}
                  effectiveFrom={data.schedule.effectiveFrom}
                  effectiveTo={data.schedule.effectiveTo}
                  fr={fr}
                  locale={locale}
                />
              ) : null}{" "}
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-secondary">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3.5" />
                  {data.schedule.provinceName}
                </span>
                {data.schedule.departmentName ? (
                  <span>{data.schedule.departmentName}</span>
                ) : null}
                <span>
                  {copy(fr, "Since", "Depuis le")}{" "}
                  {day(data.schedule.effectiveFrom, locale)}
                </span>
              </div>
            </div>
          ) : (
            <EmptyLine
              text={copy(
                fr,
                "No active shift has been assigned yet.",
                "Aucun horaire actif ne vous est encore affecté.",
              )}
            />
          )}
        </Section>

        <Section
          id="leave"
          hidden={activeSection !== "overview" && activeSection !== "leave"}
          title={copy(fr, "Leave and sick days", "Congés et jours maladie")}
          description={copy(
            fr,
            "Your personal balance and recent leave requests.",
            "Vos soldes personnels et vos dernières demandes.",
          )}
          icon={HeartPulse}
          action={
            <OpenLink href={`/${orgSlug}/my-leave`}>
              {copy(fr, "Open leave", "Ouvrir mes congés")}
            </OpenLink>
          }
        >
          {data.leave.balances.length ? (
            <div className="divide-y divide-border">
              {data.leave.balances.map((balance) => (
                <div
                  key={balance.id}
                  className="flex items-center justify-between gap-4 px-5 py-3.5"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {balance.type}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-secondary">
                      {balance.isPaid
                        ? copy(fr, "Paid leave", "Congé payé")
                        : copy(fr, "Unpaid leave", "Congé non payé")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums text-ink">
                      {balance.remainingDays}
                    </p>
                    <p className="text-xs text-ink-secondary">
                      {copy(fr, "days left", "jours restants")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyLine
              text={copy(
                fr,
                "No leave balance has been set for this year.",
                "Aucun solde de congé n’a été défini pour cette année.",
              )}
            />
          )}
          {data.leave.requests.length ? (
            <div className="border-t border-border bg-surface-2/60 px-5 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {copy(fr, "Recent requests", "Demandes récentes")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.leave.requests.slice(0, 4).map((request) => (
                  <Badge
                    key={request.id}
                    variant={statusVariant(request.status)}
                  >
                    {request.type} · {pretty(request.status)}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </Section>

        <Section
          id="attendance"
          hidden={
            activeSection !== "overview" && activeSection !== "attendance"
          }
          title={copy(fr, "My attendance", "Ma présence")}
          description={copy(
            fr,
            "Your recent clock-in and clock-out history.",
            "Votre historique récent d’arrivée et de départ.",
          )}
          icon={Clock3}
          action={
            <OpenLink href={`/${orgSlug}/my-attendance`}>
              {copy(fr, "Open attendance", "Ouvrir la présence")}
            </OpenLink>
          }
        >
          {data.attendance.length ? (
            <div className="divide-y divide-border">
              {data.attendance.slice(0, 6).map((record) => (
                <div
                  key={record.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {day(record.workDate, locale)}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-secondary">
                      {record.shiftName ?? record.siteName ?? "—"} ·{" "}
                      {instant(record.clockInAt ?? null, locale)} —{" "}
                      {instant(record.clockOutAt ?? null, locale)}
                      {record.workedHours !== null &&
                      record.workedHours !== undefined
                        ? ` · ${copy(fr, "Worked", "Réel")} ${hoursText(record.workedHours, locale)} ${copy(fr, "h", "h")}`
                        : ""}
                      {record.overtimeHours
                        ? ` · ${copy(fr, "Overtime", "Suppl.")} ${hoursText(record.overtimeHours, locale)} ${copy(fr, "h", "h")}`
                        : ""}
                    </p>
                  </div>
                  <Badge variant={statusVariant(record.status)}>
                    {pretty(record.status)}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyLine
              text={copy(
                fr,
                "No attendance record yet.",
                "Aucune présence enregistrée pour le moment.",
              )}
            />
          )}
        </Section>

        <Section
          id="payslips"
          hidden={activeSection !== "overview" && activeSection !== "payslips"}
          title={
            isPayslipHistory
              ? copy(fr, "Payment history", "Historique des paiements")
              : copy(fr, "My payslip", "Ma fiche de paie")
          }
          description={
            isPayslipHistory
              ? copy(
                  fr,
                  "Your previous payments are archived here. Open a paid payslip to consult it.",
                  "Vos paiements précédents sont archivés ici. Ouvrez une fiche payée pour la consulter.",
                )
              : copy(
                  fr,
                  "Your most recent payment is kept here.",
                  "Votre paie la plus récente est conservée ici.",
                )
          }
          icon={ReceiptText}
        >
          {displayedPayslips.length ? (
            <div className="divide-y divide-border">
              {displayedPayslips.map((payslip) => {
                const paymentState = employeePaymentState(payslip, todayKey);
                return (
                  <div
                    key={payslip.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-ink">
                          {payslip.reference}
                        </p>
                        <Badge
                          variant={
                            paymentState === "paid"
                              ? "good"
                              : paymentState === "pending_payment"
                                ? "warning"
                                : "outline"
                          }
                        >
                          {employeePaymentCopy(paymentState, fr)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-ink-secondary">
                        {day(payslip.periodStart, locale)} —{" "}
                        {day(payslip.periodEnd, locale)} ·{" "}
                        {employeePaymentHint(
                          paymentState,
                          payslip.payDate,
                          locale,
                          fr,
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums text-ink">
                        {money(payslip.netPay, payslip.currency, locale)}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-secondary">
                        {copy(fr, "Net pay", "Net à payer")}
                      </p>
                      {paymentState === "paid" ? (
                        <button
                          type="button"
                          onClick={() => setOpenedPayslip(payslip)}
                          className="mt-2 inline-flex items-center gap-1 rounded-lg border border-brand/20 bg-brand-subtle px-2 py-1 text-[11px] font-semibold text-brand transition hover:border-brand/40 hover:bg-brand hover:text-white"
                        >
                          <FileText className="size-3" aria-hidden />
                          {copy(fr, "View payslip", "Voir la fiche")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {isPayslipHistory && historicPayslips.length > 12 ? (
                <div className="flex justify-center bg-surface-2/45 px-5 py-3">
                  <button
                    type="button"
                    onClick={() =>
                      setShowAllHistoricPayslips((showingAll) => !showingAll)
                    }
                    className="rounded-lg border border-border-strong bg-surface-1 px-3 py-2 text-xs font-semibold text-ink transition hover:border-brand/40 hover:text-brand"
                  >
                    {showAllHistoricPayslips
                      ? copy(
                          fr,
                          "Show fewer payments",
                          "Afficher moins de paiements",
                        )
                      : copy(
                          fr,
                          `Show all ${historicPayslips.length} previous payments`,
                          `Afficher les ${historicPayslips.length} paiements précédents`,
                        )}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyLine
              text={copy(
                fr,
                isPayslipHistory
                  ? "No earlier payslip is available yet."
                  : "No current payslip is available yet.",
                isPayslipHistory
                  ? "Aucune fiche de paie précédente n’est disponible pour le moment."
                  : "Aucune fiche de paie actuelle n’est disponible pour le moment.",
              )}
            />
          )}
        </Section>
      </section>

      <div
        id="contracts"
        className={
          activeSection === "contracts"
            ? "mx-auto w-full max-w-4xl scroll-mt-6"
            : "hidden"
        }
      >
        <Section
          title={copy(fr, "My employment contracts", "Mes contrats de travail")}
          description={copy(
            fr,
            "Contracts and amendments made available by HR. Only you can open these documents from your personal account.",
            "Contrats et avenants mis à disposition par les RH. Vous seul pouvez ouvrir ces documents depuis votre compte personnel.",
          )}
          icon={FileText}
        >
          {personalContracts.isPending ? (
            <div className="px-5 py-8 text-sm text-ink-secondary">
              {copy(
                fr,
                "Loading your contracts…",
                "Chargement de vos contrats…",
              )}
            </div>
          ) : personalContracts.isError ? (
            <ErrorState
              title={copy(
                fr,
                "Your employment contracts could not load",
                "Vos contrats de travail n’ont pas pu être chargés",
              )}
              description={
                personalContracts.error instanceof ApiError &&
                personalContracts.error.status === 404
                  ? copy(
                      fr,
                      "This LiteHubs account is not linked to an employee profile yet. Ask the owner or HR to link your account to your employee record.",
                      "Ce compte LiteHubs n’est pas encore lié à une fiche employé. Demandez au propriétaire ou aux RH de le rattacher à votre fiche employé.",
                    )
                  : personalContracts.error instanceof ApiError
                    ? personalContracts.error.message
                    : undefined
              }
              onRetry={() => void personalContracts.refetch()}
            />
          ) : personalContracts.data?.length ? (
            <div className="divide-y divide-border">
              {personalContracts.data.map((contract) => (
                <div
                  key={contract.id}
                  className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-ink">
                        {contract.title}
                      </p>
                      <Badge variant={statusVariant(contract.status)}>
                        {contractStatusText(contract.status, fr)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-secondary">
                      {contract.reference} · {copy(fr, "Starts", "Début")}{" "}
                      {day(contract.startsOn, locale)}
                      {contract.endsOn
                        ? ` · ${copy(fr, "Ends", "Fin")} ${day(contract.endsOn, locale)}`
                        : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-secondary">
                      {contract.signedOn ? (
                        <span>
                          {copy(fr, "Signed on", "Signé le")}{" "}
                          {day(contract.signedOn, locale)}
                        </span>
                      ) : null}
                      {contract.autoRenews ? (
                        <span>
                          {copy(
                            fr,
                            "Auto-renewal",
                            "Renouvellement automatique",
                          )}
                        </span>
                      ) : null}
                      {contract.renewalNoticeDays !== null &&
                      contract.renewalNoticeDays !== undefined ? (
                        <span>
                          {contract.renewalNoticeDays}{" "}
                          {copy(fr, "days' notice", "jours de préavis")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {contract.document ? (
                    <button
                      type="button"
                      onClick={() => setOpenedContract(contract)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand-subtle px-3 py-2 text-xs font-semibold text-brand transition hover:border-brand/40 hover:bg-brand hover:text-white"
                    >
                      <FileText className="size-3.5" aria-hidden />
                      {[
                        "pending_signature",
                        "ready_for_signature",
                        "awaiting_employee_signature",
                      ].includes(contract.status)
                        ? copy(fr, "Review & sign", "Lire et signer")
                        : copy(fr, "Read contract", "Lire le contrat")}
                    </button>
                  ) : (
                    <span className="text-xs text-ink-muted">
                      {copy(
                        fr,
                        "Document pending from HR",
                        "Document en attente des RH",
                      )}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyLine
              text={copy(
                fr,
                "No employment contract is available on your account yet.",
                "Aucun contrat de travail n’est encore disponible sur votre compte.",
              )}
            />
          )}
        </Section>
      </div>

      {openedPayslip ? (
        <EmployeePayslipStatement
          payslip={openedPayslip}
          employee={data.employee}
          organization={data.organization}
          fr={fr}
          locale={locale}
          onClose={() => setOpenedPayslip(null)}
        />
      ) : null}

      {openedContract ? (
        <ContractReviewModal
          fr={fr}
          locale={locale}
          orgSlug={orgSlug}
          contract={openedContract}
          employeeName={account.data?.employee.fullName ?? ""}
          busy={signContract.isPending || signContractField.isPending}
          error={
            (signContractField.error ?? signContract.error) instanceof Error
              ? ((signContractField.error ?? signContract.error) as Error)
              : null
          }
          onClose={() => setOpenedContract(null)}
          onSign={(fieldId, legalName, method, signatureData) =>
            fieldId
              ? signContractField.mutate({
                  contractId: openedContract.id,
                  fieldId,
                  legalName: legalName ?? "",
                  method: method ?? "typed",
                  signatureData: signatureData ?? null,
                })
              : signContract.mutate(openedContract.id)
          }
        />
      ) : null}

      {initialSection === "contracts" ? (
        <section className="rounded-2xl border border-good/25 bg-[linear-gradient(125deg,rgba(34,197,94,.08),transparent_56%),var(--surface-2)] px-5 py-4 shadow-sm">
          <div className="flex items-start gap-3">
            <ShieldCheck
              className="mt-0.5 size-5 shrink-0 text-good"
              aria-hidden
            />
            <p className="text-xs leading-5 text-ink-secondary">
              {copy(
                fr,
                "Your contracts are personal. Only you can read, download or sign documents linked to your employee profile.",
                "Vos contrats sont personnels. Vous seul pouvez lire, télécharger ou signer les documents liés à votre fiche employé.",
              )}
            </p>
          </div>
        </section>
      ) : null}
    </main>
  );
}

type MetricTone = "blue" | "rose" | "amber" | "emerald";
const metricTone: Record<MetricTone, string> = {
  blue: "border-sky-500/30 from-sky-500/15 via-transparent to-transparent text-sky-700 dark:text-sky-300",
  rose: "border-rose-500/30 from-rose-500/15 via-transparent to-transparent text-rose-700 dark:text-rose-300",
  amber:
    "border-amber-500/30 from-amber-500/15 via-transparent to-transparent text-amber-700 dark:text-amber-300",
  emerald:
    "border-emerald-500/30 from-emerald-500/15 via-transparent to-transparent text-emerald-700 dark:text-emerald-300",
};
function Metric({
  icon: Icon,
  label,
  value,
  hint,
  tone = "blue",
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  hint: string;
  tone?: MetricTone;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,.45)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_34px_-25px_rgba(15,23,42,.52)] ${metricTone[tone]}`}
    >
      <span
        className="absolute right-4 top-4 size-9 rounded-full border border-current/15 bg-current/5"
        aria-hidden
      />
      <div className="relative">
        <Icon className="size-4" aria-hidden />
        <p className="mt-4 text-xs font-semibold text-ink-muted">{label}</p>
        <p className="mt-1 truncate text-xl font-semibold tabular-nums tracking-[-.03em] text-ink">
          {value}
        </p>
        <p className="mt-2 border-t border-border/80 pt-2 text-xs text-ink-secondary">
          {hint}
        </p>
      </div>
    </div>
  );
}
function EmptyLine({ text }: { text: string }) {
  return (
    <div className="bg-[radial-gradient(circle_at_50%_0%,rgba(20,184,166,.06),transparent_50%)] px-5 py-9 text-center text-sm text-ink-secondary">
      <span className="mx-auto mb-3 grid size-10 place-items-center rounded-xl border border-border bg-surface-2">
        <FileText className="size-5 text-ink-muted" aria-hidden />
      </span>
      {text}
    </div>
  );
}
function organizationLabelFromSlug(orgSlug: string) {
  return orgSlug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function EmployeePayslipStatement({
  payslip,
  employee,
  organization,
  fr,
  locale,
  onClose,
}: {
  payslip: Account["payslips"][number];
  employee: Account["employee"];
  organization: Account["organization"];
  fr: boolean;
  locale: string;
  onClose: () => void;
}) {
  const paymentState = employeePaymentState(payslip);
  const label = (english: string, french: string) => copy(fr, english, french);

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-slate-950/60 p-0 backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="employee-payslip-title"
        className="mx-auto min-h-full w-full overflow-hidden bg-slate-100 shadow-2xl sm:my-3 sm:min-h-0 sm:max-w-[58rem] sm:rounded-[1.6rem] sm:border sm:border-white/20"
      >
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.16em] text-[#182d72]">
              {label(
                "Private employee document",
                "Document personnel confidentiel",
              )}
            </p>
            <h2
              id="employee-payslip-title"
              className="mt-1 text-lg font-bold text-slate-900"
            >
              {label("Payslip statement", "Fiche de paie")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-lg text-slate-500 transition hover:border-[#182d72]/30 hover:text-[#182d72]"
            aria-label={label("Close", "Fermer")}
          >
            ×
          </button>
        </header>

        <div className="max-h-[calc(100vh-5.5rem)] overflow-y-auto p-4 sm:p-7">
          <PayslipStatement
            fr={fr}
            locale={locale}
            organization={organization}
            employee={employee}
            payslip={payslip}
            statusLabel={employeePaymentCopy(paymentState, fr)}
            statusHint={employeePaymentHint(
              paymentState,
              payslip.payDate,
              locale,
              fr,
            )}
          />
        </div>
      </section>
    </div>
  );
}
function InlineContractText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={`strong-${index}`} className="font-semibold text-ink">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={`text-${index}`}>{part}</span>
        ),
      )}
    </>
  );
}
function signedMoment(value: string | null | undefined, fr = true) {
  if (!value || Number.isNaN(new Date(value).getTime())) return null;
  return new Intl.DateTimeFormat(fr ? "fr-FR" : "en-US", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}
function ContractTextBlock({
  text,
  fr,
  employeeName,
  employeeField,
  canSign = false,
  onEmployeeSign,
  isEmployeeSection = false,
}: {
  text: string;
  fr: boolean;
  employeeName: string;
  employeeField?: {
    status: string;
    signedName?: string | null;
    signedAt?: string | null;
  };
  canSign?: boolean;
  onEmployeeSign?: () => void;
  isEmployeeSection?: boolean;
}) {
  const lines = text.replace(/\r/g, "").split("\n");
  let employeeSection = isEmployeeSection;
  const compactLabel =
    /^(r[ée]f[ée]rence|titre|adresse|nom|matricule|poste|lieu de travail|date|signature)\s*:/i;
  return (
    <div className="text-[17px] leading-8 text-ink">
      {lines.map((line, index) => {
        const heading = line.match(/^\s*#{1,6}\s+(.+?)\s*$/);
        const plain = line
          .replace(/^\s*#{1,6}\s*/, "")
          .replace(/\*\*/g, "")
          .replace(/\\$/, "")
          .trim();
        if (/^(le travailleur|employee|worker)$/i.test(plain))
          employeeSection = true;
        if (/^pour\s/i.test(plain)) employeeSection = false;
        if (employeeSection && /^nom\s*:/i.test(plain))
          return employeeField?.status === "signed" ? (
            <p
              key={`employee-name-${index}`}
              className="mt-8 whitespace-pre-wrap text-ink-secondary"
            >
              Nom :{" "}
              <strong className="font-semibold text-ink">
                {employeeField.signedName ?? employeeName}
              </strong>
            </p>
          ) : (
            <div key={`employee-name-${index}`} className="mt-8">
              <button
                type="button"
                onClick={onEmployeeSign}
                disabled={!canSign}
                className="mb-3 block rounded-lg border border-brand/30 bg-brand-subtle px-3 py-2 text-left text-xs font-semibold text-brand transition hover:bg-brand/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-2">
                  <PenLine className="size-4" />
                  {canSign
                    ? "Cliquez ici pour confirmer votre nom et signer"
                    : "Nom en attente de signature"}
                </span>
              </button>
              <p className="border-b border-ink/35 pb-1">
                Nom :{" "}
                <strong className="font-semibold text-ink">
                  {employeeName}
                </strong>
              </p>
            </div>
          );
        if (employeeSection && /^signature\s*:/i.test(plain))
          return employeeField?.status === "signed" ? (
            <div
              key={`employee-signature-${index}`}
              className="mt-5 border-b-2 border-good/45 pb-3"
            >
              <p className="font-serif text-xl italic text-good">
                Signature : {employeeField.signedName ?? employeeName}
              </p>
              {signedMoment(employeeField.signedAt, fr) ? (
                <p className="mt-2 text-xs leading-5 text-ink-muted">
                  {fr
                    ? "Signé électroniquement le"
                    : "Electronically signed on"}{" "}
                  {signedMoment(employeeField.signedAt, fr)}
                </p>
              ) : null}
            </div>
          ) : (
            <div key={`employee-signature-${index}`} className="mt-5">
              <button
                type="button"
                onClick={onEmployeeSign}
                disabled={!canSign}
                className="mb-3 block rounded-lg border border-brand/30 bg-brand-subtle px-3 py-2 text-left text-xs font-semibold text-brand transition hover:bg-brand/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-2">
                  <PenLine className="size-4" />
                  {canSign ? "Cliquez ici pour signer" : "Signature en attente"}
                </span>
              </button>
              <p className="border-b-2 border-ink/40 pb-1 text-sm text-ink">
                Signature :{" "}
                <span className="tracking-[.12em] text-ink-muted">
                  ________________________
                </span>
              </p>
            </div>
          );
        if (heading)
          return (
            <h3
              key={`markdown-heading-${index}`}
              className="mt-11 border-t border-border/70 pt-7 text-2xl font-bold leading-9 tracking-[-.02em] text-ink first:mt-0 first:border-0 first:pt-0"
            >
              <InlineContractText text={heading[1] ?? ""} />
            </h3>
          );
        if (!line.trim()) return <div key={`space-${index}`} className="h-4" />;
        const numbered = /^\d+[.)]\s+/.test(plain);
        return (
          <p
            key={`markdown-line-${index}`}
            className={`${compactLabel.test(plain) ? "mt-2 text-ink-secondary" : numbered ? "mt-4 pl-6 text-ink" : "mt-7 text-ink"} whitespace-pre-wrap`}
          >
            <InlineContractText text={line} />
          </p>
        );
      })}
    </div>
  );
}
function EmployeeContractSignatureLine({
  fr,
  employeeName,
  field,
  canSign,
  onSign,
}: {
  fr: boolean;
  employeeName: string;
  field:
    | {
        label: string;
        status: string;
        signedName?: string | null;
        signedAt?: string | null;
      }
    | undefined;
  canSign: boolean;
  onSign: () => void;
}) {
  const signed = field?.status === "signed";
  if (signed)
    return (
      <section className="mt-10 border-t border-ink/20 pt-5">
        <p className="text-sm font-semibold text-ink">
          {fr ? "Le travailleur" : "The employee"}
        </p>
        <p className="mt-2 text-sm text-ink-secondary">
          {fr ? "Nom :" : "Name:"}{" "}
          <span className="font-semibold text-ink">
            {field?.signedName ?? employeeName}
          </span>
        </p>
        <p className="mt-3 border-b-2 border-good/45 pb-2 font-serif text-xl italic text-good">
          {fr ? "Signature :" : "Signature:"}{" "}
          {field?.signedName ?? employeeName}
        </p>
        {signedMoment(field?.signedAt, fr) ? (
          <p className="mt-2 text-xs text-ink-muted">
            {fr ? "Signé électroniquement le" : "Electronically signed on"}{" "}
            {signedMoment(field?.signedAt, fr)}
          </p>
        ) : null}
      </section>
    );
  return (
    <section className="mt-9 rounded-2xl border border-brand/30 bg-brand-subtle p-5">
      <p className="text-sm font-semibold text-ink">
        {fr ? "Le travailleur" : "The employee"}
      </p>
      <p className="mt-2 text-sm text-ink-secondary">
        {fr ? "Nom :" : "Name:"}{" "}
        <span className="font-medium text-ink">{employeeName}</span>
      </p>
      <p className="mt-1 text-sm text-ink-secondary">
        {fr ? "Signature :" : "Signature:"}
      </p>
      <button
        type="button"
        onClick={onSign}
        disabled={!canSign}
        className="mt-2 flex w-full items-center gap-3 rounded-xl border border-dashed border-brand/50 bg-surface-1 px-4 py-3 text-left text-brand transition hover:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand text-white">
          <PenLine className="size-5" />
        </span>
        <span>
          <span className="block text-sm font-semibold">
            {fr ? "Cliquez ici pour signer" : "Click here to sign"}
          </span>
          <span className="mt-0.5 block text-xs text-ink-secondary">
            {fr
              ? "Votre signature est protégée et enregistrée dans LiteHubs."
              : "Your signature is protected and recorded in LiteHubs."}
          </span>
        </span>
      </button>
    </section>
  );
}
type EmployeeContractWorkspace = {
  version: {
    id: string;
    number: number;
    status: string;
    documentId: string | null;
    hash: string | null;
    blocks: {
      type: "heading" | "paragraph" | "table" | "page_break";
      text?: string;
      rows?: string[][];
    }[];
    fields: {
      id: string;
      label: string;
      status: string;
      signedName?: string | null;
      signedAt?: string | null;
    }[];
  };
  employeeCanSign: boolean;
};
function ContractReviewModal({
  fr,
  locale,
  orgSlug,
  contract,
  employeeName,
  busy,
  error,
  onClose,
  onSign,
}: {
  fr: boolean;
  locale: string;
  orgSlug: string;
  contract: Account["contracts"][number];
  employeeName: string;
  busy: boolean;
  error: Error | null;
  onClose: () => void;
  onSign: (
    fieldId?: string,
    legalName?: string,
    method?: "typed" | "drawn" | "uploaded",
    signatureData?: string | null,
  ) => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [legalName, setLegalName] = useState("");
  const [signatureMethod, setSignatureMethod] = useState<
    "typed" | "drawn" | "uploaded"
  >("drawn");
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [readerMode, setReaderMode] = useState<"text" | "pdf">("text");
  const [signatureDialog, setSignatureDialog] = useState(false);
  const signaturePanel = useRef<HTMLDivElement | null>(null);
  const workspace = useQuery({
    queryKey: ["my-contract-workspace", orgSlug, contract.id],
    queryFn: () =>
      get<EmployeeContractWorkspace>(
        orgUrl(orgSlug, `my-contracts/${contract.id}/workspace`),
      ),
    retry: false,
  });
  const fields = workspace.data?.version.fields ?? [];
  const modern = Boolean(workspace.data);
  const pending = fields.filter((field) => field.status !== "signed");
  const needsLegacy =
    contract.status === "pending_signature" ||
    (contract.status === "active" && !contract.signedAt);
  const needsSignature = modern
    ? workspace.data!.employeeCanSign && pending.length > 0
    : needsLegacy;
  const awaitingEmployerCountersignature =
    modern && workspace.data?.version.status === "awaiting_employer_signature";
  const blocks = workspace.data?.version.blocks ?? [];
  const hasReadableText = blocks.some(
    (block) =>
      block.type !== "page_break" &&
      Boolean(block.text?.trim() || block.rows?.length),
  );
  const employeeSignatureBlockIndexes = new Set<number>();
  let withinEmployeeSignatureSection = false;
  blocks.forEach((block, index) => {
    const plain = String(block.text ?? "")
      .replace(/^\s*#{1,6}\s*/, "")
      .trim();
    if (block.type === "heading") {
      if (/^(le travailleur|employee|worker)$/i.test(plain))
        withinEmployeeSignatureSection = true;
      else if (/^pour\s/i.test(plain)) withinEmployeeSignatureSection = false;
    } else if (withinEmployeeSignatureSection && block.type !== "page_break")
      employeeSignatureBlockIndexes.add(index);
  });
  const hasEmployeeSignatureSlot =
    employeeSignatureBlockIndexes.size > 0 &&
    blocks.some((block) =>
      /^\s*signature\s*:/i.test(
        String(block.text ?? "").replace(/^\s*#{1,6}\s*/, ""),
      ),
    );
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overflow-x-hidden bg-slate-950/55 p-0 backdrop-blur-sm sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="contract-review-title"
        className="mx-auto min-h-full w-full overflow-hidden rounded-none border-0 border-border bg-surface-1 shadow-2xl sm:my-3 sm:min-h-0 sm:max-w-[92rem] sm:rounded-[1.5rem] sm:border"
      >
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-surface-2/60 px-5 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.15em] text-brand">
              {copy(fr, "Employment document", "Document de travail")}
            </p>
            <h2
              id="contract-review-title"
              className="mt-1 text-lg font-semibold text-ink"
            >
              {contract.title}
            </h2>
            <p className="mt-1 text-xs text-ink-secondary">
              {contract.reference} · {copy(fr, "Starts", "Début")}{" "}
              {day(contract.startsOn, locale)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={orgApiUrl(orgSlug, `my-contracts/${contract.id}/document`)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-1 px-3 py-2 text-xs font-semibold text-ink shadow-sm transition hover:border-brand/35 hover:text-brand"
            >
              <FileText className="size-3.5" />
              {copy(fr, "Download PDF", "Télécharger le PDF")}
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2 text-ink-secondary hover:bg-surface-3"
              aria-label={copy(fr, "Close", "Fermer")}
            >
              ×
            </button>
          </div>
        </header>
        <div className="min-h-[78vh] bg-surface-2/25">
          <div className="min-h-[70vh] bg-slate-100 dark:bg-slate-950">
            {hasReadableText && readerMode === "text" ? (
              <article className="h-[calc(100vh-4.5rem)] min-h-[540px] overflow-y-auto bg-surface-1 px-6 py-9 text-[17px] leading-8 text-ink sm:h-[70vh] sm:px-14 sm:py-14">
                <div className="mx-auto max-w-3xl space-y-7">
                  {blocks.map((block, index) => {
                    if (block.type === "page_break")
                      return (
                        <hr
                          key={`page-${index}`}
                          className="my-10 border-border"
                        />
                      );
                    if (block.type === "heading")
                      return (
                        <h3
                          key={`heading-${index}`}
                          className="pt-3 text-xl font-bold leading-8 text-ink"
                        >
                          {block.text}
                        </h3>
                      );
                    if (block.type === "table")
                      return (
                        <div
                          key={`table-${index}`}
                          className="overflow-x-auto rounded-xl border border-border"
                        >
                          <table className="min-w-full border-collapse text-left text-sm">
                            <tbody>
                              {(block.rows ?? []).map((row, rowIndex) => (
                                <tr
                                  key={`row-${index}-${rowIndex}`}
                                  className={
                                    rowIndex === 0
                                      ? "bg-surface-2 font-semibold"
                                      : "border-t border-border"
                                  }
                                >
                                  {row.map((cell, cellIndex) => (
                                    <td
                                      key={`cell-${index}-${rowIndex}-${cellIndex}`}
                                      className="px-3 py-2 align-top"
                                    >
                                      {cell}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    return (
                      <ContractTextBlock
                        key={`paragraph-${index}`}
                        text={block.text ?? ""}
                        employeeName={employeeName}
                        employeeField={fields[0]}
                        canSign={needsSignature}
                        isEmployeeSection={employeeSignatureBlockIndexes.has(
                          index,
                        )}
                        onEmployeeSign={() => {
                          setSignatureMethod("drawn");
                          setSignatureData(null);
                          setSignatureDialog(true);
                        }}
                        fr={fr}
                      />
                    );
                  })}
                  {!hasEmployeeSignatureSlot ? (
                    <EmployeeContractSignatureLine
                      fr={fr}
                      employeeName={employeeName}
                      field={fields[0]}
                      canSign={needsSignature}
                      onSign={() => {
                        setSignatureMethod("drawn");
                        setSignatureData(null);
                        setSignatureDialog(true);
                      }}
                    />
                  ) : null}
                </div>
              </article>
            ) : (
              <iframe
                title={contract.title}
                src={`${orgApiUrl(orgSlug, `my-contracts/${contract.id}/preview`)}#view=FitH`}
                className="h-[calc(100vh-4.5rem)] min-h-[540px] w-full border-0 sm:h-[70vh]"
              />
            )}
          </div>
          <aside aria-hidden="true" className="hidden">
            <div className="rounded-2xl border border-border bg-surface-2/40 p-4">
              <Badge
                variant={statusVariant(
                  modern
                    ? (workspace.data?.version.status ?? contract.status)
                    : contract.status,
                )}
              >
                {contractStatusText(
                  modern
                    ? (workspace.data?.version.status ?? contract.status)
                    : contract.status,
                  fr,
                )}
              </Badge>
              <p className="mt-3 text-sm leading-6 text-ink-secondary">
                {needsSignature
                  ? copy(
                      fr,
                      "Read the contract, confirm your consent, then sign every field assigned to you. Employer countersigning follows automatically.",
                      "Lisez le contrat, confirmez votre consentement, puis signez chaque emplacement qui vous est attribué. La contre-signature de l’employeur suivra automatiquement.",
                    )
                  : copy(
                      fr,
                      "This is your private copy. Signatures and history remain protected in LiteHubs.",
                      "Voici votre exemplaire privé. Les signatures et l’historique restent protégés dans LiteHubs.",
                    )}
              </p>
            </div>
            {hasReadableText ? (
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface-2/45 p-1">
                <button
                  type="button"
                  onClick={() => setReaderMode("text")}
                  className={`rounded-lg px-2 py-2 text-xs font-semibold ${readerMode === "text" ? "bg-surface-1 text-brand shadow-sm" : "text-ink-secondary"}`}
                >
                  {copy(fr, "Comfortable reading", "Lecture confortable")}
                </button>
                <button
                  type="button"
                  onClick={() => setReaderMode("pdf")}
                  className={`rounded-lg px-2 py-2 text-xs font-semibold ${readerMode === "pdf" ? "bg-surface-1 text-brand shadow-sm" : "text-ink-secondary"}`}
                >
                  PDF
                </button>
              </div>
            ) : null}
            <a
              href={orgApiUrl(orgSlug, `my-contracts/${contract.id}/document`)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs font-semibold text-ink hover:border-brand/35 hover:text-brand"
            >
              <FileText className="size-3.5" />
              {awaitingEmployerCountersignature
                ? copy(
                    fr,
                    "Download copy with your signature",
                    "Télécharger la copie avec votre signature",
                  )
                : copy(
                    fr,
                    "Download signed PDF / file",
                    "Télécharger le PDF / fichier",
                  )}
            </a>
            <a
              href={`${orgApiUrl(orgSlug, `my-contracts/${contract.id}/preview`)}#view=FitH`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand/30 bg-brand-subtle px-3 py-2 text-xs font-semibold text-brand hover:bg-brand/15"
            >
              <FileText className="size-3.5" />
              {copy(fr, "Open full reader", "Lire en plein écran")}
            </a>
            {modern ? (
              <div className="rounded-xl border border-border bg-surface-2/45 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {copy(
                    fr,
                    "Your signature fields",
                    "Vos emplacements de signature",
                  )}
                </p>
                <div className="mt-2 space-y-2">
                  {fields.map((field) => (
                    <div
                      key={field.id}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="text-ink">{field.label}</span>
                      <Badge
                        variant={field.status === "signed" ? "good" : "warning"}
                      >
                        {field.status === "signed"
                          ? copy(fr, "Signed", "Signé")
                          : copy(fr, "Pending", "En attente")}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {needsSignature ? (
              <div
                ref={signaturePanel}
                className="mt-1 space-y-4 rounded-2xl border border-brand/20 bg-brand-subtle p-4"
              >
                <p className="text-sm font-semibold text-ink">
                  {copy(fr, "Sign the contract", "Signer le contrat")}
                </p>
                <label className="block text-xs font-semibold text-ink">
                  {copy(
                    fr,
                    "Legal name used for your signature",
                    "Nom légal utilisé pour la signature",
                  )}
                  <input
                    value={legalName}
                    onChange={(event) => setLegalName(event.target.value)}
                    className="mt-1.5 h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-ink"
                    placeholder={copy(
                      fr,
                      "Your full legal name",
                      "Votre nom légal complet",
                    )}
                  />
                </label>
                <div>
                  <p className="text-xs font-semibold text-ink">
                    {copy(fr, "Signature method", "Méthode de signature")}
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSignatureMethod("drawn");
                        setSignatureData(null);
                      }}
                      className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border px-2 text-center text-[11px] font-semibold ${signatureMethod === "drawn" ? "border-brand bg-brand-subtle text-brand shadow-sm" : "border-border bg-surface-1 text-ink-secondary"}`}
                    >
                      <PenLine className="size-4" />
                      {copy(fr, "Sign with pen", "Signer au stylo")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSignatureMethod("typed");
                        setSignatureData(null);
                      }}
                      className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border px-2 text-center text-[11px] font-semibold ${signatureMethod === "typed" ? "border-brand bg-brand-subtle text-brand shadow-sm" : "border-border bg-surface-1 text-ink-secondary"}`}
                    >
                      <Type className="size-4" />
                      {copy(fr, "Type my name", "Saisir mon nom")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSignatureMethod("uploaded");
                        setSignatureData(null);
                      }}
                      className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border px-2 text-center text-[11px] font-semibold ${signatureMethod === "uploaded" ? "border-brand bg-brand-subtle text-brand shadow-sm" : "border-border bg-surface-1 text-ink-secondary"}`}
                    >
                      <Upload className="size-4" />
                      {copy(fr, "Upload image", "Importer une image")}
                    </button>
                  </div>
                </div>
                {signatureMethod === "typed" ? (
                  <div className="rounded-xl border border-dashed border-border bg-surface-1 px-3 py-3">
                    <p className="text-[11px] font-medium text-ink-muted">
                      {copy(
                        fr,
                        "Typed signature preview",
                        "Aperçu de la signature saisie",
                      )}
                    </p>
                    <p className="mt-1 font-serif text-xl italic text-ink">
                      {legalName ||
                        copy(fr, "Your legal name", "Votre nom légal")}
                    </p>
                  </div>
                ) : (
                  <SignatureCapture
                    mode={signatureMethod}
                    value={signatureData}
                    onChange={setSignatureData}
                    fr={fr}
                  />
                )}
                <label className="flex gap-2 text-xs leading-5 text-ink">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                    className="mt-0.5 size-4 accent-brand"
                  />
                  {copy(
                    fr,
                    "I have read and understood this contract. I consent to signing it electronically with my authenticated LiteHubs account.",
                    "Je confirme avoir lu et compris ce contrat. Je consens à le signer électroniquement avec mon compte LiteHubs authentifié.",
                  )}
                </label>
                {error ? (
                  <p className="text-xs text-critical">{error.message}</p>
                ) : null}
                <button
                  type="button"
                  disabled={
                    !acknowledged ||
                    !legalName.trim() ||
                    busy ||
                    (signatureMethod !== "typed" && !signatureData)
                  }
                  onClick={() => {
                    const field = pending[0];
                    onSign(
                      field?.id,
                      legalName.trim(),
                      signatureMethod,
                      signatureData,
                    );
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-3 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ShieldCheck className="size-4" />
                  {busy
                    ? copy(fr, "Signing…", "Signature…")
                    : pending.length > 1
                      ? copy(
                          fr,
                          "Sign next field",
                          "Signer l’emplacement suivant",
                        )
                      : copy(fr, "Sign contract", "Signer le contrat")}
                </button>
              </div>
            ) : (
              <p className="mt-auto text-xs text-ink-muted">
                {contract.signedAt
                  ? `${copy(fr, "Signed", "Signé")} ${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(contract.signedAt))}`
                  : modern &&
                      workspace.data?.version.status ===
                        "awaiting_employer_signature"
                    ? copy(
                        fr,
                        "Your signature is complete. The contract now awaits the employer’s countersignature.",
                        "Votre signature est terminée. Le contrat attend désormais la contre-signature de l’employeur.",
                      )
                    : copy(
                        fr,
                        "No electronic signature is recorded for this copy.",
                        "Aucune signature électronique n’est enregistrée pour cet exemplaire.",
                      )}
              </p>
            )}
          </aside>
        </div>
      </section>
      {signatureDialog ? (
        <EmployeeSigningDialog
          fr={fr}
          busy={busy}
          error={error}
          legalName={legalName}
          onLegalName={setLegalName}
          signatureMethod={signatureMethod}
          onSignatureMethod={setSignatureMethod}
          signatureData={signatureData}
          onSignatureData={setSignatureData}
          acknowledged={acknowledged}
          onAcknowledged={setAcknowledged}
          pendingCount={pending.length}
          onClose={() => setSignatureDialog(false)}
          onSign={() => {
            const field = pending[0];
            onSign(field?.id, legalName.trim(), signatureMethod, signatureData);
            setSignatureDialog(false);
          }}
        />
      ) : null}
    </div>
  );
}
function SignatureCapture({
  mode,
  value,
  onChange,
  fr,
}: {
  mode: "drawn" | "uploaded";
  value: string | null;
  onChange: (value: string | null) => void;
  fr: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const node = canvas.current!;
    const box = node.getBoundingClientRect();
    return {
      x: (event.clientX - box.left) * (node.width / box.width),
      y: (event.clientY - box.top) * (node.height / box.height),
    };
  };
  const begin = (event: PointerEvent<HTMLCanvasElement>) => {
    if (mode !== "drawn") return;
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const ctx = canvas.current?.getContext("2d");
    const p = point(event);
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
  };
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || mode !== "drawn") return;
    const ctx = canvas.current?.getContext("2d");
    const p = point(event);
    if (ctx) {
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#0f766e";
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  };
  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvas.current?.toDataURL("image/png") ?? null);
  };
  if (mode === "uploaded")
    return (
      <label className="block rounded-xl border border-dashed border-border bg-surface-1 p-3 text-xs text-ink-secondary">
        {copy(
          fr,
          "Signature image (PNG or JPEG)",
          "Image de signature (PNG ou JPEG)",
        )}
        <input
          type="file"
          accept="image/png,image/jpeg"
          className="mt-2 block w-full text-xs"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () =>
              onChange(
                typeof reader.result === "string" ? reader.result : null,
              );
            reader.readAsDataURL(file);
          }}
        />
        {value ? (
          <span className="mt-2 block text-good">
            {copy(fr, "Image ready", "Image prête")}
          </span>
        ) : null}
      </label>
    );
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface-1 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-secondary">
          {copy(
            fr,
            "Draw your signature inside the frame",
            "Dessinez votre signature dans le cadre",
          )}
        </p>
        <button
          type="button"
          onClick={() => {
            const ctx = canvas.current?.getContext("2d");
            ctx?.clearRect(0, 0, 520, 130);
            onChange(null);
          }}
          className="text-xs font-semibold text-brand"
        >
          {copy(fr, "Clear", "Effacer")}
        </button>
      </div>
      <canvas
        ref={canvas}
        width={520}
        height={130}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
        className="mt-2 h-28 w-full touch-none rounded-lg bg-white"
        aria-label={copy(fr, "Draw your signature", "Dessinez votre signature")}
      />
    </div>
  );
}
function EmployeeSigningDialog({
  fr,
  busy,
  error,
  legalName,
  onLegalName,
  signatureMethod,
  onSignatureMethod,
  signatureData,
  onSignatureData,
  acknowledged,
  onAcknowledged,
  pendingCount,
  onClose,
  onSign,
}: {
  fr: boolean;
  busy: boolean;
  error: Error | null;
  legalName: string;
  onLegalName: (value: string) => void;
  signatureMethod: "typed" | "drawn" | "uploaded";
  onSignatureMethod: (value: "typed" | "drawn" | "uploaded") => void;
  signatureData: string | null;
  onSignatureData: (value: string | null) => void;
  acknowledged: boolean;
  onAcknowledged: (value: boolean) => void;
  pendingCount: number;
  onClose: () => void;
  onSign: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] grid place-items-end bg-slate-950/60 p-0 backdrop-blur-sm sm:place-items-center sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="employee-signature-title"
        className="w-full max-w-lg overflow-hidden rounded-t-[1.6rem] border border-border bg-surface-1 shadow-2xl sm:rounded-[1.6rem]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border bg-[linear-gradient(120deg,rgba(20,184,166,.14),transparent_60%)] px-5 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-brand">
              {fr ? "Signature électronique" : "Electronic signature"}
            </p>
            <h3
              id="employee-signature-title"
              className="mt-1 text-lg font-semibold text-ink"
            >
              {fr ? "Signer le contrat" : "Sign contract"}
            </h3>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              {fr
                ? "Votre signature est associée à votre compte LiteHubs et conservée avec l’historique du contrat."
                : "Your signature is connected to your LiteHubs account and retained with the contract history."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-ink-secondary hover:bg-surface-3"
            aria-label={fr ? "Fermer" : "Close"}
          >
            ×
          </button>
        </header>
        <div className="max-h-[72vh] space-y-4 overflow-y-auto px-5 py-5">
          <label className="block text-xs font-semibold text-ink">
            {fr
              ? "Nom légal utilisé pour la signature"
              : "Legal name used for your signature"}
            <input
              value={legalName}
              onChange={(event) => onLegalName(event.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-border bg-surface-1 px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              placeholder={
                fr ? "Votre nom légal complet" : "Your complete legal name"
              }
            />
          </label>
          <div>
            <p className="text-xs font-semibold text-ink">
              {fr ? "Méthode de signature" : "Signature method"}
            </p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  onSignatureMethod("drawn");
                  onSignatureData(null);
                }}
                className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border px-2 text-center text-[11px] font-semibold ${signatureMethod === "drawn" ? "border-brand bg-brand-subtle text-brand shadow-sm" : "border-border bg-surface-1 text-ink-secondary"}`}
              >
                <PenLine className="size-4" />
                {fr ? "Signer au stylo" : "Sign with pen"}
              </button>
              <button
                type="button"
                onClick={() => {
                  onSignatureMethod("typed");
                  onSignatureData(null);
                }}
                className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border px-2 text-center text-[11px] font-semibold ${signatureMethod === "typed" ? "border-brand bg-brand-subtle text-brand shadow-sm" : "border-border bg-surface-1 text-ink-secondary"}`}
              >
                <Type className="size-4" />
                {fr ? "Saisir mon nom" : "Type my name"}
              </button>
              <button
                type="button"
                onClick={() => {
                  onSignatureMethod("uploaded");
                  onSignatureData(null);
                }}
                className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border px-2 text-center text-[11px] font-semibold ${signatureMethod === "uploaded" ? "border-brand bg-brand-subtle text-brand shadow-sm" : "border-border bg-surface-1 text-ink-secondary"}`}
              >
                <Upload className="size-4" />
                {fr ? "Importer une image" : "Upload image"}
              </button>
            </div>
          </div>
          {signatureMethod === "typed" ? (
            <div className="rounded-xl border border-dashed border-border bg-surface-2/45 px-3 py-3">
              <p className="text-[11px] font-medium text-ink-muted">
                {fr
                  ? "Aperçu de la signature saisie"
                  : "Typed signature preview"}
              </p>
              <p className="mt-1 font-serif text-xl italic text-ink">
                {legalName || (fr ? "Votre nom légal" : "Your legal name")}
              </p>
            </div>
          ) : (
            <SignatureCapture
              mode={signatureMethod}
              value={signatureData}
              onChange={onSignatureData}
              fr={fr}
            />
          )}
          <label className="flex gap-2 text-xs leading-5 text-ink">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => onAcknowledged(event.target.checked)}
              className="mt-0.5 size-4 accent-brand"
            />
            {fr
              ? "Je confirme avoir lu et compris ce contrat. Je consens à le signer électroniquement avec mon compte LiteHubs authentifié."
              : "I confirm I have read and understood this contract. I consent to sign it electronically with my authenticated LiteHubs account."}
          </label>
          {error ? (
            <p className="rounded-xl border border-critical/30 bg-critical/10 p-3 text-xs text-critical">
              {error.message}
            </p>
          ) : null}
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-border bg-surface-2/45 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border bg-surface-1 px-4 py-2.5 text-sm font-semibold text-ink"
          >
            {fr ? "Annuler" : "Cancel"}
          </button>
          <button
            type="button"
            disabled={
              !acknowledged ||
              !legalName.trim() ||
              busy ||
              (signatureMethod !== "typed" && !signatureData)
            }
            onClick={onSign}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ShieldCheck className="size-4" />
            {busy
              ? fr
                ? "Signature…"
                : "Signing…"
              : pendingCount > 1
                ? fr
                  ? "Signer l’emplacement suivant"
                  : "Sign next field"
                : fr
                  ? "Signer le contrat"
                  : "Sign contract"}
          </button>
        </footer>
      </section>
    </div>
  );
}
