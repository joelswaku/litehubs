"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  CircleDollarSign,
  Factory,
  FolderKanban,
  Leaf,
  ReceiptText,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { ownerManagementApi } from "@/lib/owner-management-api";
import { useLanguage } from "@/providers/language-provider";

type ProjectMetric = {
  id: string;
  name: string;
  code: string;
  projectType: string;
  status: string;
  priority: string;
  provinceId: string | null;
  provinceName: string | null;
  siteId: string | null;
  siteName: string | null;
  responsibleMemberId: string | null;
  managerName: string | null;
  startDate: string | null;
  targetCompletionDate: string | null;
  revisedCompletionDate: string | null;
  currencyCode: string;
  initialBudget: number;
  revisedBudget: number;
  actualBudget: number;
  planned: number;
  allocated: number;
  unallocated: number;
  committed: number;
  spent: number;
  available: number;
  utilizationPercent: number;
  openTasks: number;
  overdueTasks: number;
  linkedOperations: number;
  isProductionProject: boolean;
  revenue: number;
  operationalResult: number | null;
  cashReceived: number;
  outstandingRevenue: number;
  cashForecast: {
    alert: boolean;
    windows: CashForecastWindow[];
  };
};

type CashForecastWindow = {
  days: number;
  expectedSalesRevenue: number;
  expectedCustomerCash: number;
  supplierPayments: number;
  operating: {
    salaries: number;
    feed: number;
    health: number;
    fuel: number;
    transport: number;
    utilities: number;
    other: number;
  };
  operatingOutflows: number;
  expectedOutflows: number;
  netCashFlow: number;
  fundingGap: number;
  atRisk: boolean;
};

type CurrencyTotal = {
  currencyCode: string;
  projectCount: number;
  productionProjectCount: number;
  planned: number;
  allocated: number;
  unallocated: number;
  committed: number;
  spent: number;
  available: number;
  revenue: number;
  operationalResult: number;
  cashReceived: number;
  openTasks: number;
  overdueTasks: number;
};

type PortfolioAnalytics = {
  generatedAt: string;
  projects: ProjectMetric[];
  totalsByCurrency: CurrencyTotal[];
};

type PortfolioView = "all" | "production" | "attention";
type PortfolioPeriod = "all" | "next30" | "next90" | "year";

const copy = (fr: boolean, english: string, french: string) =>
  fr ? french : english;
const numeric = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const formatMoney = (value: unknown, currency: string, locale: string) =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency || "CDF",
    maximumFractionDigits: 0,
  }).format(numeric(value));
const formatCount = (value: unknown, locale: string) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    numeric(value),
  );

function budgetStatus(project: ProjectMetric, fr: boolean) {
  if (project.available < 0)
    return {
      label: copy(fr, "Over budget", "Dépassé"),
      tone: "critical" as const,
    };
  if (project.utilizationPercent >= 90)
    return {
      label: copy(fr, "Nearly exhausted", "Presque épuisé"),
      tone: "warning" as const,
    };
  if (project.utilizationPercent >= 80 || project.overdueTasks > 0)
    return {
      label: copy(fr, "Attention", "Attention"),
      tone: "warning" as const,
    };
  return {
    label: copy(fr, "On track", "Dans le budget"),
    tone: "good" as const,
  };
}

function portfolioRisk(project: ProjectMetric, fr: boolean) {
  const hasNegativeResult =
    project.isProductionProject && numeric(project.operationalResult) < 0;
  if (
    project.available < 0 ||
    project.overdueTasks > 0 ||
    hasNegativeResult ||
    project.cashForecast?.alert
  )
    return { label: copy(fr, "High", "Élevé"), tone: "critical" as const };
  if (project.utilizationPercent >= 80)
    return {
      label: copy(fr, "Watch", "À surveiller"),
      tone: "warning" as const,
    };
  return { label: copy(fr, "Low", "Faible"), tone: "good" as const };
}

function projectMatchesPeriod(project: ProjectMetric, period: PortfolioPeriod) {
  if (period === "all") return true;
  const today = new Date();
  const currentYear = today.getUTCFullYear();
  const start = String(project.startDate ?? "").slice(0, 10);
  const end = String(
    project.revisedCompletionDate ?? project.targetCompletionDate ?? start,
  ).slice(0, 10);
  if (period === "year")
    return (
      (!start || start.slice(0, 4) <= String(currentYear)) &&
      (!end || end.slice(0, 4) >= String(currentYear))
    );
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() + (period === "next30" ? 30 : 90));
  const horizonDate = horizon.toISOString().slice(0, 10);
  return (
    !end || (end >= today.toISOString().slice(0, 10) && end <= horizonDate)
  );
}

function projectTypeLabel(value: string, fr: boolean) {
  const labels: Record<string, [string, string]> = {
    land: ["Land", "Terrain"],
    construction: ["Construction", "Construction"],
    expansion: ["Expansion", "Expansion"],
    infrastructure: ["Infrastructure", "Infrastructure"],
    equipment: ["Equipment", "Équipement"],
    livestock: ["Livestock", "Élevage"],
    housing: ["Housing", "Bâtiment"],
    technology: ["Technology", "Technologie"],
    maintenance: ["Maintenance", "Maintenance"],
    other: ["Other", "Autre"],
  };
  const item = labels[value];
  return item ? copy(fr, item[0], item[1]) : value;
}

function projectStatusLabel(value: string, fr: boolean) {
  const labels: Record<string, [string, string]> = {
    planning: ["Planning", "Planification"],
    approved: ["Approved", "Approuvé"],
    in_progress: ["In progress", "En cours"],
    on_hold: ["On hold", "En attente"],
    completed: ["Completed", "Terminé"],
    cancelled: ["Cancelled", "Annulé"],
  };
  const item = labels[value];
  return item ? copy(fr, item[0], item[1]) : value;
}

function MetricCard({
  label,
  value,
  description,
  tone = "blue",
  icon: Icon,
  delay,
}: {
  label: string;
  value: string;
  description: string;
  tone?: "blue" | "green" | "orange" | "rose";
  icon: typeof Wallet;
  delay: number;
}) {
  const reduceMotion = useReducedMotion();
  const tones = {
    blue: "border-blue-200 bg-blue-50/85 text-[#0d366b] dark:border-blue-400/25 dark:bg-blue-400/10 dark:text-blue-200",
    green:
      "border-emerald-200 bg-emerald-50/85 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200",
    orange:
      "border-amber-200 bg-amber-50/85 text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200",
    rose: "border-rose-200 bg-rose-50/85 text-rose-900 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200",
  } as const;
  return (
    <motion.article
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay * 0.06, duration: 0.32 }}
      className={`rounded-2xl border p-4 shadow-sm ${tones[tone]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[.12em] opacity-75">
          {label}
        </p>
        <span className="grid size-9 place-items-center rounded-xl bg-white/70 shadow-sm dark:bg-black/15">
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="mt-4 text-2xl font-bold tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 opacity-75">{description}</p>
    </motion.article>
  );
}

function FlowStep({
  icon: Icon,
  title,
  description,
  href,
  last = false,
}: {
  icon: typeof Leaf;
  title: string;
  description: string;
  href: string;
  last?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="flex min-w-52 flex-1 items-center gap-2">
      <Link
        href={href}
        className="group min-h-30 flex-1 rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm transition hover:-translate-y-0.5 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <span className="grid size-9 place-items-center rounded-xl bg-white/15 text-white">
          <Icon className="size-4" aria-hidden />
        </span>
        <p className="mt-3 text-sm font-bold text-white">{title}</p>
        <p className="mt-1 text-xs leading-5 text-blue-100">{description}</p>
      </Link>
      {!last ? (
        <motion.span
          animate={reduceMotion ? undefined : { x: [0, 4, 0] }}
          transition={{ duration: 1.7, repeat: Infinity, ease: "easeInOut" }}
          className="hidden text-blue-100 lg:block"
          aria-hidden
        >
          <ArrowRight className="size-5" />
        </motion.span>
      ) : null}
    </div>
  );
}

export function ProjectAnalyticsArea({
  orgSlug,
  embedded = false,
  onSelectProject,
}: {
  orgSlug: string;
  embedded?: boolean;
  onSelectProject?: (projectId: string) => void;
}) {
  const { locale } = useLanguage();
  const fr = locale.startsWith("fr");
  const reduceMotion = useReducedMotion();
  const [currencyChoice, setCurrencyChoice] = useState("");
  const [view, setView] = useState<PortfolioView>("all");
  const [provinceId, setProvinceId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [projectType, setProjectType] = useState("");
  const [managerId, setManagerId] = useState("");
  const [status, setStatus] = useState("");
  const [period, setPeriod] = useState<PortfolioPeriod>("all");
  const [cashWindowDays, setCashWindowDays] = useState<30 | 60 | 90>(30);
  const analytics = useQuery({
    queryKey: ["project-portfolio-analytics", orgSlug],
    queryFn: () =>
      ownerManagementApi.projectAnalytics<{ analytics: PortfolioAnalytics }>(
        orgSlug,
      ),
    select: (response) => response.analytics,
  });
  const currencies = analytics.data?.totalsByCurrency ?? [];
  const currency = currencies.some(
    (entry) => entry.currencyCode === currencyChoice,
  )
    ? currencyChoice
    : (currencies[0]?.currencyCode ?? "CDF");
  const projects = useMemo(() => {
    const records = (analytics.data?.projects ?? []).filter(
      (project) =>
        project.currencyCode === currency &&
        (!provinceId || project.provinceId === provinceId) &&
        (!siteId || project.siteId === siteId) &&
        (!projectType || project.projectType === projectType) &&
        (!managerId || project.responsibleMemberId === managerId) &&
        (!status || project.status === status) &&
        projectMatchesPeriod(project, period),
    );
    if (view === "production")
      return records.filter((project) => project.isProductionProject);
    if (view === "attention")
      return records.filter(
        (project) =>
          project.available < 0 ||
          project.utilizationPercent >= 80 ||
          project.overdueTasks > 0 ||
          project.cashForecast?.alert,
      );
    return records;
  }, [
    analytics.data?.projects,
    currency,
    managerId,
    period,
    projectType,
    provinceId,
    siteId,
    status,
    view,
  ]);
  const filterOptions = useMemo(() => {
    const records = analytics.data?.projects ?? [];
    const unique = <T,>(items: T[], key: (item: T) => string) => [
      ...new Map(
        items.filter((item) => key(item)).map((item) => [key(item), item]),
      ).values(),
    ];
    return {
      provinces: unique(records, (project) => project.provinceId ?? ""),
      sites: unique(records, (project) => project.siteId ?? ""),
      types: [
        ...new Set(
          records.map((project) => project.projectType).filter(Boolean),
        ),
      ].sort(),
      managers: unique(records, (project) => project.responsibleMemberId ?? ""),
      statuses: [
        ...new Set(records.map((project) => project.status).filter(Boolean)),
      ].sort(),
    };
  }, [analytics.data?.projects]);
  const cashForecast = useMemo(() => {
    const total = {
      expectedSalesRevenue: 0,
      expectedCustomerCash: 0,
      supplierPayments: 0,
      salaries: 0,
      feed: 0,
      health: 0,
      fuel: 0,
      transport: 0,
      utilities: 0,
      other: 0,
      expectedOutflows: 0,
      netCashFlow: 0,
      fundingGap: 0,
      projectsAtRisk: 0,
    };
    for (const project of projects) {
      const window = project.cashForecast?.windows?.find(
        (item) => item.days === cashWindowDays,
      );
      if (!window) continue;
      total.expectedSalesRevenue += numeric(window.expectedSalesRevenue);
      total.expectedCustomerCash += numeric(window.expectedCustomerCash);
      total.supplierPayments += numeric(window.supplierPayments);
      total.salaries += numeric(window.operating?.salaries);
      total.feed += numeric(window.operating?.feed);
      total.health += numeric(window.operating?.health);
      total.fuel += numeric(window.operating?.fuel);
      total.transport += numeric(window.operating?.transport);
      total.utilities += numeric(window.operating?.utilities);
      total.other += numeric(window.operating?.other);
      total.expectedOutflows += numeric(window.expectedOutflows);
      total.netCashFlow += numeric(window.netCashFlow);
      total.fundingGap += numeric(window.fundingGap);
      if (window.atRisk) total.projectsAtRisk += 1;
    }
    return total;
  }, [cashWindowDays, projects]);
  const budgetComparison = useMemo(
    () =>
      projects.reduce(
        (total, project) => ({
          initial: total.initial + numeric(project.initialBudget),
          revised: total.revised + numeric(project.revisedBudget),
          actual: total.actual + numeric(project.actualBudget),
        }),
        { initial: 0, revised: 0, actual: 0 },
      ),
    [projects],
  );
  const portfolioTotals = useMemo(
    () =>
      projects.reduce(
        (total, project) => ({
          projectCount: total.projectCount + 1,
          productionProjectCount:
            total.productionProjectCount +
            (project.isProductionProject ? 1 : 0),
          planned: total.planned + numeric(project.planned),
          committed: total.committed + numeric(project.committed),
          spent: total.spent + numeric(project.actualBudget),
          available: total.available + numeric(project.available),
          revenue: total.revenue + numeric(project.revenue),
          operationalResult:
            total.operationalResult +
            (project.isProductionProject
              ? numeric(project.operationalResult)
              : 0),
          cashReceived: total.cashReceived + numeric(project.cashReceived),
        }),
        {
          projectCount: 0,
          productionProjectCount: 0,
          planned: 0,
          committed: 0,
          spent: 0,
          available: 0,
          revenue: 0,
          operationalResult: 0,
          cashReceived: 0,
        },
      ),
    [projects],
  );
  const chartData = projects
    .filter((project) => project.isProductionProject)
    .map((project) => ({
      name:
        project.name.length > 16
          ? `${project.name.slice(0, 16)}…`
          : project.name,
      result: numeric(project.operationalResult),
    }));
  const visibleProjectCount = analytics.data?.projects.length ?? 0;
  const Container = embedded ? "section" : "main";
  const pageClass = embedded
    ? "space-y-5"
    : "mx-auto max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8";

  if (analytics.isPending)
    return (
      <Container
        className={embedded ? "" : "mx-auto max-w-7xl p-4 sm:p-6 lg:p-8"}
      >
        <Skeleton className="h-72 rounded-3xl" />
      </Container>
    );
  if (analytics.isError)
    return (
      <Container
        className={embedded ? "" : "mx-auto max-w-7xl p-4 sm:p-6 lg:p-8"}
      >
        <ErrorState
          title={copy(
            fr,
            "Could not load the portfolio",
            "Impossible de charger le portefeuille",
          )}
          description={
            analytics.error instanceof Error
              ? analytics.error.message
              : undefined
          }
          onRetry={() => void analytics.refetch()}
        />
      </Container>
    );

  return (
    <Container className={pageClass}>
      <motion.section
        initial={reduceMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative isolate overflow-hidden rounded-3xl border border-blue-300/30 bg-[radial-gradient(circle_at_88%_-12%,rgba(147,197,253,.38),transparent_34%),linear-gradient(125deg,#082d5c_0%,#184f95_52%,#2a78d6_100%)] px-5 py-6 text-white shadow-[0_24px_65px_-35px_rgba(13,54,107,.85)] sm:px-7 sm:py-8"
      >
        <div className="pointer-events-none absolute -right-20 -top-24 size-80 rounded-full border border-white/10 bg-white/5" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-blue-50">
              <BarChart3 className="size-3.5" aria-hidden />
              {copy(
                fr,
                "CONNECTED PROJECT ANALYTICS",
                "ANALYSE CONNECTÉE DES PROJETS",
              )}
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">
              {copy(
                fr,
                "One view of costs, production and results",
                "Une vue des coûts, de la production et des résultats",
              )}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-50/90">
              {copy(
                fr,
                "Each physical item exists once in company stock. This portfolio follows the cost through projects, from purchase or harvest to production and external sales, without counting it twice.",
                "Chaque article physique existe une seule fois dans le stock de l’entreprise. Ce portefeuille suit son coût entre projets, de l’achat ou la récolte jusqu’à la production et aux ventes externes, sans double comptage.",
              )}
            </p>
          </div>
          {!embedded ? (
            <Link href={`/${orgSlug}/projects`}>
              <Button
                variant="secondary"
                className="border-white/20 bg-white text-[#0d366b] hover:bg-blue-50"
              >
                <FolderKanban className="size-4" />
                {copy(fr, "Open projects", "Ouvrir les projets")}
              </Button>
            </Link>
          ) : null}
        </div>
        <div className="relative mt-7 flex gap-3 overflow-x-auto pb-1">
          <FlowStep
            icon={Leaf}
            title={copy(fr, "Harvest or purchase", "Récolte ou achat")}
            description={copy(fr, "Source cost", "Coût d’origine")}
            href={`/${orgSlug}/agriculture`}
          />
          <FlowStep
            icon={Boxes}
            title={copy(fr, "Shared stock", "Stock partagé")}
            description={copy(
              fr,
              "One physical balance",
              "Un seul stock physique",
            )}
            href={`/${orgSlug}/inventory`}
          />
          <FlowStep
            icon={Factory}
            title={copy(fr, "Feed mill", "Provenderie")}
            description={copy(
              fr,
              "Recipe and conversion",
              "Recette et transformation",
            )}
            href={`/${orgSlug}/feed-mill`}
          />
          <FlowStep
            icon={ReceiptText}
            title={copy(fr, "Animal production", "Production animale")}
            description={copy(
              fr,
              "Feed allocated to the lot",
              "Aliment affecté au lot",
            )}
            href={`/${orgSlug}/poultry`}
          />
          <FlowStep
            icon={CircleDollarSign}
            title={copy(fr, "Sales and result", "Ventes et résultat")}
            description={copy(
              fr,
              "External revenue only",
              "Recettes externes seulement",
            )}
            href={`/${orgSlug}/sales`}
            last
          />
        </div>
      </motion.section>

      {currencies.length > 1 ? (
        <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface-1 p-3 shadow-sm">
          <p className="mr-1 text-xs font-semibold text-ink-secondary">
            {copy(fr, "Currency", "Devise")}
          </p>
          {currencies.map((entry) => (
            <button
              key={entry.currencyCode}
              type="button"
              onClick={() => setCurrencyChoice(entry.currencyCode)}
              className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${currency === entry.currencyCode ? "bg-brand text-brand-ink shadow-sm" : "bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink"}`}
            >
              {entry.currencyCode}
            </button>
          ))}
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">
              {copy(fr, "Portfolio filters", "Filtres du portefeuille")}
            </h2>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              {copy(
                fr,
                "Narrow the comparison without ever expanding your approved project scope.",
                "Affinez la comparaison sans jamais élargir votre périmètre de projets autorisés.",
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setProvinceId("");
              setSiteId("");
              setProjectType("");
              setManagerId("");
              setStatus("");
              setPeriod("all");
              setView("all");
            }}
            className="text-xs font-semibold text-brand hover:underline"
          >
            {copy(fr, "Reset filters", "Effacer les filtres")}
          </button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <select
            value={provinceId}
            onChange={(event) => setProvinceId(event.target.value)}
            className="h-10 rounded-xl border border-border bg-surface px-3 text-sm text-ink"
          >
            <option value="">
              {copy(fr, "All provinces", "Toutes les provinces")}
            </option>
            {filterOptions.provinces.map((project) => (
              <option key={project.provinceId} value={project.provinceId ?? ""}>
                {project.provinceName || project.provinceId}
              </option>
            ))}
          </select>
          <select
            value={siteId}
            onChange={(event) => setSiteId(event.target.value)}
            className="h-10 rounded-xl border border-border bg-surface px-3 text-sm text-ink"
          >
            <option value="">{copy(fr, "All sites", "Tous les sites")}</option>
            {filterOptions.sites.map((project) => (
              <option key={project.siteId} value={project.siteId ?? ""}>
                {project.siteName || project.siteId}
              </option>
            ))}
          </select>
          <select
            value={projectType}
            onChange={(event) => setProjectType(event.target.value)}
            className="h-10 rounded-xl border border-border bg-surface px-3 text-sm text-ink"
          >
            <option value="">
              {copy(fr, "All project types", "Tous les types de projet")}
            </option>
            {filterOptions.types.map((type) => (
              <option key={type} value={type}>
                {projectTypeLabel(type, fr)}
              </option>
            ))}
          </select>
          <select
            value={managerId}
            onChange={(event) => setManagerId(event.target.value)}
            className="h-10 rounded-xl border border-border bg-surface px-3 text-sm text-ink"
          >
            <option value="">
              {copy(fr, "All managers", "Tous les responsables")}
            </option>
            {filterOptions.managers.map((project) => (
              <option
                key={project.responsibleMemberId}
                value={project.responsibleMemberId ?? ""}
              >
                {project.managerName || copy(fr, "Unassigned", "Non attribué")}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-10 rounded-xl border border-border bg-surface px-3 text-sm text-ink"
          >
            <option value="">
              {copy(fr, "All statuses", "Tous les statuts")}
            </option>
            {filterOptions.statuses.map((item) => (
              <option key={item} value={item}>
                {projectStatusLabel(item, fr)}
              </option>
            ))}
          </select>
          <select
            value={period}
            onChange={(event) =>
              setPeriod(event.target.value as PortfolioPeriod)
            }
            className="h-10 rounded-xl border border-border bg-surface px-3 text-sm text-ink"
          >
            <option value="all">
              {copy(fr, "All periods", "Toutes les périodes")}
            </option>
            <option value="next30">
              {copy(fr, "Due within 30 days", "Échéance sous 30 jours")}
            </option>
            <option value="next90">
              {copy(fr, "Due within 90 days", "Échéance sous 90 jours")}
            </option>
            <option value="year">
              {copy(fr, "Current year", "Année en cours")}
            </option>
          </select>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={copy(fr, "Project budget", "Budget des projets")}
          value={formatMoney(portfolioTotals.planned, currency, locale)}
          description={copy(
            fr,
            `${formatCount(portfolioTotals.projectCount, locale)} connected project(s)`,
            `${formatCount(portfolioTotals.projectCount, locale)} projet(s) connecté(s)`,
          )}
          icon={Wallet}
          delay={0}
        />
        <MetricCard
          label={copy(fr, "Committed", "Engagé")}
          value={formatMoney(portfolioTotals.committed, currency, locale)}
          description={copy(
            fr,
            "Released supplier commitments",
            "Commandes déjà envoyées aux fournisseurs",
          )}
          icon={ReceiptText}
          tone="orange"
          delay={1}
        />
        <MetricCard
          label={copy(fr, "Actual spent", "Dépensé")}
          value={formatMoney(portfolioTotals.spent, currency, locale)}
          description={copy(
            fr,
            "Confirmed receiving and direct costs",
            "Réceptions confirmées et dépenses directes",
          )}
          icon={TrendingDown}
          tone="rose"
          delay={2}
        />
        <MetricCard
          label={copy(fr, "Available", "Disponible")}
          value={formatMoney(portfolioTotals.available, currency, locale)}
          description={copy(
            fr,
            "Project budget still free",
            "Budget projet restant disponible",
          )}
          icon={Wallet}
          tone="blue"
          delay={3}
        />
      </section>

      <section className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              {copy(
                fr,
                "Cash forecast and revised budget",
                "Prévision de trésorerie et budget révisé",
              )}
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-secondary">
              {copy(
                fr,
                "Cash is forecast from dated customer invoices, supplier obligations, open orders and planned direct costs. Expected sales remain separate until invoiced or paid.",
                "La trésorerie est prévue depuis les factures clients datées, obligations fournisseurs, commandes ouvertes et dépenses directes planifiées. Les ventes attendues restent séparées jusqu’à leur facturation ou encaissement.",
              )}
            </p>
          </div>
          <div className="flex rounded-xl bg-surface-2 p-1">
            {([30, 60, 90] as const).map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setCashWindowDays(days)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${cashWindowDays === days ? "bg-brand text-brand-ink shadow-sm" : "text-ink-secondary hover:text-ink"}`}
              >
                {days} {copy(fr, "days", "jours")}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <MetricCard
            label={copy(fr, "Initial budget", "Budget initial")}
            value={formatMoney(budgetComparison.initial, currency, locale)}
            description={copy(
              fr,
              "First recorded project baseline",
              "Premier budget enregistré",
            )}
            icon={Wallet}
            delay={0}
          />
          <MetricCard
            label={copy(fr, "Revised budget", "Budget révisé")}
            value={formatMoney(budgetComparison.revised, currency, locale)}
            description={copy(
              fr,
              "Current approved project budget",
              "Budget projet actuellement approuvé",
            )}
            icon={BarChart3}
            tone="blue"
            delay={1}
          />
          <MetricCard
            label={copy(fr, "Actual spent", "Réel dépensé")}
            value={formatMoney(budgetComparison.actual, currency, locale)}
            description={copy(
              fr,
              "Confirmed receipts and approved direct costs",
              "Réceptions confirmées et dépenses directes approuvées",
            )}
            icon={TrendingDown}
            tone="rose"
            delay={2}
          />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label={copy(fr, "Expected sales", "Ventes attendues")}
            value={formatMoney(
              cashForecast.expectedSalesRevenue,
              currency,
              locale,
            )}
            description={copy(
              fr,
              "Confirmed orders not yet invoiced",
              "Commandes confirmées non facturées",
            )}
            icon={TrendingUp}
            tone="green"
            delay={0}
          />
          <MetricCard
            label={copy(fr, "Expected collections", "Encaissements attendus")}
            value={formatMoney(
              cashForecast.expectedCustomerCash,
              currency,
              locale,
            )}
            description={copy(
              fr,
              "Customer invoices due",
              "Factures clients à échéance",
            )}
            icon={CircleDollarSign}
            tone="blue"
            delay={1}
          />
          <MetricCard
            label={copy(fr, "Supplier payments", "Paiements fournisseurs")}
            value={formatMoney(cashForecast.supplierPayments, currency, locale)}
            description={copy(
              fr,
              "Received goods, payables and open orders",
              "Réceptions, dettes et commandes ouvertes",
            )}
            icon={ReceiptText}
            tone="orange"
            delay={2}
          />
          <MetricCard
            label={copy(fr, "Planned operating costs", "Charges planifiées")}
            value={formatMoney(
              cashForecast.expectedOutflows - cashForecast.supplierPayments,
              currency,
              locale,
            )}
            description={copy(
              fr,
              "Salaries, feed, health, fuel and operations",
              "Salaires, aliment, santé, carburant et opérations",
            )}
            icon={TrendingDown}
            tone="rose"
            delay={3}
          />
          <MetricCard
            label={copy(fr, "Net cash forecast", "Flux de trésorerie net")}
            value={formatMoney(cashForecast.netCashFlow, currency, locale)}
            description={copy(
              fr,
              "Expected collections less forecast outflows",
              "Encaissements attendus moins sorties prévues",
            )}
            icon={Wallet}
            tone={cashForecast.netCashFlow < 0 ? "rose" : "green"}
            delay={4}
          />
        </div>
        <div
          className={`mt-4 rounded-xl border p-3 text-sm leading-6 ${cashForecast.fundingGap > 0 ? "border-warning/35 bg-warning/10 text-ink" : "border-emerald-500/30 bg-emerald-500/[.08] text-ink"}`}
        >
          <span className="font-semibold">
            {cashForecast.fundingGap > 0
              ? copy(
                  fr,
                  "Funding need to plan",
                  "Besoin de financement à prévoir",
                )
              : copy(
                  fr,
                  "No forecast funding gap",
                  "Aucun besoin de financement prévu",
                )}
          </span>{" "}
          {cashForecast.fundingGap > 0 ? (
            <>
              {formatMoney(cashForecast.fundingGap, currency, locale)} ·{" "}
              {formatCount(cashForecast.projectsAtRisk, locale)}{" "}
              {copy(
                fr,
                "project(s) need close monitoring in this horizon.",
                "projet(s) demandent une surveillance rapprochée sur cet horizon.",
              )}
            </>
          ) : (
            copy(
              fr,
              "Expected customer cash covers dated supplier and operating outflows in this selected portfolio.",
              "Les encaissements clients attendus couvrent les sorties fournisseurs et opérationnelles datées de ce portefeuille.",
            )
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary">
          <span>
            {copy(fr, "Salaries", "Salaires")} ·{" "}
            <strong className="text-ink">
              {formatMoney(cashForecast.salaries, currency, locale)}
            </strong>
          </span>
          <span>
            {copy(fr, "Feed", "Aliment")} ·{" "}
            <strong className="text-ink">
              {formatMoney(cashForecast.feed, currency, locale)}
            </strong>
          </span>
          <span>
            {copy(fr, "Vaccines & health", "Vaccins et santé")} ·{" "}
            <strong className="text-ink">
              {formatMoney(cashForecast.health, currency, locale)}
            </strong>
          </span>
          <span>
            {copy(fr, "Fuel", "Carburant")} ·{" "}
            <strong className="text-ink">
              {formatMoney(cashForecast.fuel, currency, locale)}
            </strong>
          </span>
          <span>
            {copy(fr, "Transport", "Transport")} ·{" "}
            <strong className="text-ink">
              {formatMoney(cashForecast.transport, currency, locale)}
            </strong>
          </span>
          <span>
            {copy(fr, "Water & electricity", "Eau et électricité")} ·{" "}
            <strong className="text-ink">
              {formatMoney(cashForecast.utilities, currency, locale)}
            </strong>
          </span>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(20rem,.92fr)]">
        <section className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">
                {copy(fr, "Production results", "Résultat des productions")}
              </h2>
              <p className="mt-1 text-sm text-ink-secondary">
                {copy(
                  fr,
                  "Only projects linked to a real poultry production source show commercial revenue and operating result.",
                  "Seuls les projets liés à une production avicole réelle affichent les recettes commerciales et le résultat opérationnel.",
                )}
              </p>
            </div>
            <Badge variant="info">
              {formatCount(portfolioTotals.productionProjectCount, locale)}{" "}
              {copy(fr, "production project(s)", "projet(s) de production")}
            </Badge>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <MetricCard
              label={copy(fr, "Sales revenue", "Recettes des ventes")}
              value={formatMoney(portfolioTotals.revenue, currency, locale)}
              description={copy(
                fr,
                "Confirmed deliveries",
                "Livraisons confirmées",
              )}
              icon={TrendingUp}
              tone="green"
              delay={1}
            />
            <MetricCard
              label={copy(fr, "Operating result", "Résultat opérationnel")}
              value={formatMoney(
                portfolioTotals.operationalResult,
                currency,
                locale,
              )}
              description={copy(
                fr,
                "Revenue less recorded operating costs",
                "Recettes moins coûts opérationnels enregistrés",
              )}
              icon={BarChart3}
              tone={
                numeric(portfolioTotals.operationalResult) < 0
                  ? "rose"
                  : "green"
              }
              delay={2}
            />
            <MetricCard
              label={copy(fr, "Cash collected", "Encaissements")}
              value={formatMoney(
                portfolioTotals.cashReceived,
                currency,
                locale,
              )}
              description={copy(
                fr,
                "Customer payments received",
                "Paiements clients reçus",
              )}
              icon={CircleDollarSign}
              tone="blue"
              delay={3}
            />
          </div>
          <div className="mt-5 h-62 rounded-2xl border border-border bg-surface-2/45 p-3">
            {chartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
                >
                  <XAxis
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--ink-secondary)", fontSize: 11 }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    tick={{ fill: "var(--ink-secondary)", fontSize: 11 }}
                    tickFormatter={(value) =>
                      new Intl.NumberFormat(locale, {
                        notation: "compact",
                        maximumFractionDigits: 1,
                      }).format(value)
                    }
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(42,120,214,.08)" }}
                    formatter={(value) => [
                      formatMoney(value, currency, locale),
                      copy(fr, "Operating result", "Résultat opérationnel"),
                    ]}
                    contentStyle={{
                      borderRadius: 12,
                      borderColor: "var(--border)",
                      background: "var(--surface-1)",
                      color: "var(--ink-primary)",
                    }}
                  />
                  <Bar dataKey="result" radius={[8, 8, 3, 3]}>
                    {chartData.map((entry, index) => (
                      <Cell
                        key={`${entry.name}-${index}`}
                        fill={entry.result < 0 ? "#d03b3b" : "#2a78d6"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center text-center">
                <p className="max-w-sm text-sm leading-6 text-ink-secondary">
                  {copy(
                    fr,
                    "Link a flock to a project, record production, then confirm a sale to see its commercial result here.",
                    "Liez un lot à un projet, enregistrez la production, puis confirmez une vente pour voir son résultat commercial ici.",
                  )}
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm sm:p-5">
          <h2 className="text-lg font-semibold text-ink">
            {copy(fr, "Reading the chain", "Lire la chaîne")}
          </h2>
          <ol className="mt-4 space-y-3">
            {[
              [
                copy(fr, "1. Origin", "1. Origine"),
                copy(
                  fr,
                  "A field project or a purchase creates the original cost.",
                  "Un projet champ ou un achat crée le coût d’origine.",
                ),
              ],
              [
                copy(fr, "2. Transformation", "2. Transformation"),
                copy(
                  fr,
                  "A recipe turns stocked ingredients into feed but does not duplicate their cost.",
                  "Une recette transforme les ingrédients en aliment sans dupliquer leur coût.",
                ),
              ],
              [
                copy(fr, "3. Allocation", "3. Affectation"),
                copy(
                  fr,
                  "Feed becomes a cost of the poultry or pig project only when it is distributed to that lot.",
                  "L’aliment devient un coût du projet volaille ou porcin seulement lorsqu’il est distribué à ce lot.",
                ),
              ],
              [
                copy(fr, "4. Result", "4. Résultat"),
                copy(
                  fr,
                  "Only external sales become revenue. Result equals sales less recorded operating costs.",
                  "Seules les ventes externes deviennent une recette. Le résultat égale ventes moins coûts opérationnels enregistrés.",
                ),
              ],
            ].map(([title, description], index) => (
              <li
                key={title}
                className="flex gap-3 rounded-xl bg-surface-2/60 p-3"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-brand-ink">
                  {index + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-ink-secondary">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-5 rounded-xl border border-emerald-500/25 bg-emerald-500/[.08] p-3">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
              {copy(fr, "No double counting", "Aucun double comptage")}
            </p>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              {copy(
                fr,
                "A supplier payment settles a receipt but never lowers the budget or operating result for a second time.",
                "Un paiement fournisseur règle une réception mais ne réduit jamais le budget ou le résultat opérationnel une deuxième fois.",
              )}
            </p>
          </div>
        </section>
      </section>

      <section className="rounded-2xl border border-border bg-surface-1 p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              {copy(
                fr,
                "Connected project portfolio",
                "Portefeuille des projets connectés",
              )}
            </h2>
            <p className="mt-1 text-sm text-ink-secondary">
              {copy(
                fr,
                "Compare the financial position, delivered revenue, real result and cash collected before opening a project.",
                "Comparez la position financière, les recettes livrées, le résultat réel et la trésorerie avant d’ouvrir un projet.",
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["all", "production", "attention"] as PortfolioView[]).map(
              (choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => setView(choice)}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${view === choice ? "bg-brand text-brand-ink" : "bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink"}`}
                >
                  {choice === "all"
                    ? copy(fr, "All", "Tous")
                    : choice === "production"
                      ? copy(fr, "Production", "Production")
                      : copy(fr, "Attention", "Attention")}
                </button>
              ),
            )}
          </div>
        </div>
        {!visibleProjectCount ? (
          <EmptyState
            title={copy(fr, "No project yet", "Aucun projet pour le moment")}
            description={copy(
              fr,
              "Create a project, link its real operations, then this portfolio will calculate its progress and results.",
              "Créez un projet, liez ses opérations réelles, puis ce portefeuille calculera son avancement et ses résultats.",
            )}
          />
        ) : !projects.length ? (
          <EmptyState
            title={copy(
              fr,
              "No project matches these filters",
              "Aucun projet ne correspond à ces filtres",
            )}
            description={copy(
              fr,
              "Change or clear one of the filters to compare another part of the portfolio.",
              "Modifiez ou effacez un filtre pour comparer une autre partie du portefeuille.",
            )}
          />
        ) : (
          <div className="mt-5 max-h-[38rem] overflow-auto rounded-2xl border border-border">
            <table className="min-w-[1120px] w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-surface-2 text-xs uppercase tracking-wide text-ink-secondary">
                <tr>
                  <th className="px-4 py-3">{copy(fr, "Project", "Projet")}</th>
                  <th className="px-4 py-3">{copy(fr, "Budget", "Budget")}</th>
                  <th className="px-4 py-3">
                    {copy(fr, "Committed", "Engagé")}
                  </th>
                  <th className="px-4 py-3">{copy(fr, "Spent", "Dépensé")}</th>
                  <th className="px-4 py-3">
                    {copy(fr, "Revenue", "Recettes")}
                  </th>
                  <th className="px-4 py-3">
                    {copy(fr, "Result", "Résultat")}
                  </th>
                  <th className="px-4 py-3">
                    {copy(fr, "Cash", "Trésorerie")}
                  </th>
                  <th className="px-4 py-3">{copy(fr, "Risk", "Risque")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-surface-1">
                {projects.map((project, index) => {
                  const risk = portfolioRisk(project, fr);
                  const projectName = onSelectProject ? (
                    <button
                      type="button"
                      onClick={() => onSelectProject(project.id)}
                      className="text-left font-semibold text-ink hover:text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand"
                    >
                      {project.name}
                    </button>
                  ) : (
                    <Link
                      href={`/${orgSlug}/projects`}
                      className="font-semibold text-ink hover:text-brand hover:underline"
                    >
                      {project.name}
                    </Link>
                  );
                  return (
                    <motion.tr
                      key={project.id}
                      initial={reduceMotion ? false : { opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(index, 10) * 0.035 }}
                      className="transition-colors hover:bg-surface-2/60"
                    >
                      <td className="px-4 py-3">
                        {projectName}
                        <p className="mt-1 text-xs text-ink-secondary">
                          {project.code} · {project.linkedOperations}{" "}
                          {copy(
                            fr,
                            "linked operation(s)",
                            "opération(s) liée(s)",
                          )}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-medium text-ink">
                        {formatMoney(project.revisedBudget, currency, locale)}
                        <p className="mt-1 text-xs text-ink-secondary">
                          {copy(fr, "Initial", "Initial")} ·{" "}
                          {formatMoney(project.initialBudget, currency, locale)}
                        </p>
                        <p className="mt-1 text-xs text-ink-secondary">
                          {project.utilizationPercent.toFixed(0)}%{" "}
                          {copy(fr, "used", "utilisé")}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-medium text-amber-800 dark:text-amber-200">
                        {formatMoney(project.committed, currency, locale)}
                      </td>
                      <td className="px-4 py-3 font-medium text-rose-800 dark:text-rose-200">
                        {formatMoney(project.actualBudget, currency, locale)}
                      </td>
                      <td className="px-4 py-3 font-medium text-emerald-800 dark:text-emerald-200">
                        {project.isProductionProject
                          ? formatMoney(project.revenue, currency, locale)
                          : "—"}
                      </td>
                      <td
                        className={`px-4 py-3 font-semibold ${numeric(project.operationalResult) < 0 ? "text-critical" : "text-brand"}`}
                      >
                        {project.isProductionProject
                          ? formatMoney(
                              project.operationalResult,
                              currency,
                              locale,
                            )
                          : "—"}
                      </td>
                      <td className="px-4 py-3 font-medium text-blue-800 dark:text-blue-200">
                        {project.isProductionProject
                          ? formatMoney(project.cashReceived, currency, locale)
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={risk.tone}>{risk.label}</Badge>
                        {project.overdueTasks > 0 ? (
                          <p className="mt-1 text-xs text-critical">
                            {project.overdueTasks}{" "}
                            {copy(fr, "overdue", "en retard")}
                          </p>
                        ) : null}
                        {project.cashForecast?.alert ? (
                          <p className="mt-1 text-xs text-warning">
                            {copy(fr, "Cash gap", "Écart de trésorerie")}
                          </p>
                        ) : null}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Container>
  );
}
