"use client";
/**
 * « Vue d'ensemble » of the dashboard: the day's alerts, spending by
 * category, sales and expenses trends, production, critical points and the
 * main counts. Every block comes from /dashboard/insights, which only returns
 * what the signed-in person may see (blocks they cannot see are null).
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bird,
  Boxes,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Egg,
  FileWarning,
  MapPin,
  PiggyBank,
  ShoppingCart,
  Sparkles,
  Sprout,
  Stethoscope,
  Truck,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { get, orgUrl } from "@/lib/api";

type Tone = "critical" | "warning" | "info" | "good";
type Point = { date: string; amount: number };
export type Insights = {
  generatedAt: string;
  currency: string | null;
  alerts: { key: string; tone: Tone; count: number; label: string; href: string }[];
  spend: { days: number; total: number; currency: string; categories: { label: string; amount: number }[] } | null;
  sales: { currency: string; total7d: number; previous7d: number; daily: Point[] } | null;
  expensesTrend: { currency: string; total7d: number; previous7d: number; daily: Point[] } | null;
  stock: { itemCount: number; value: number | null; currency: string | null; lowCount: number } | null;
  production: {
    poultry: { flocks: number; birds: number; eggsToday: number; eggs7d: number; previousEggs7d: number; deaths7d: number; eggsDaily: Point[] } | null;
    pigs: { pens: number; heads: number; deaths7d: number; farrowings30d: number } | null;
    crops: { activePlantings: number; harvest30d: number; harvestUnit: string | null } | null;
  };
  critical: { key: string; kind: "stock" | "flock" | "pen" | "vaccine" | "vehicle" | "task" | "invoice" | "approval"; title: string; detail: string; place: string | null; badge: string; tone: Tone; href: string }[];
  overview: { key: string; label: string; value: number; sub: string | null; href: string }[];
  finance: { currency: string; receivables: number; overdueInvoices: number; overdueAmount: number } | null;
  people: { active: number; presentToday: number; onLeaveToday: number; pendingLeave: number } | null;
};

const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--chart-7)"];
const TONE: Record<Tone, string> = {
  critical: "bg-critical/12 text-critical",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  info: "bg-brand/10 text-brand",
  good: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
};
const KIND_ICON: Record<Insights["critical"][number]["kind"], LucideIcon> = {
  stock: Boxes,
  flock: Bird,
  pen: PiggyBank,
  vaccine: Stethoscope,
  vehicle: Truck,
  task: ClipboardCheck,
  invoice: FileWarning,
  approval: CheckCircle2,
};
const TILE_ICON: Record<string, LucideIcon> = {
  sites: MapPin,
  equipment: Truck,
  projects: BriefcaseBusiness,
  "purchase-requests": ShoppingCart,
  appointments: CalendarClock,
  attendance: Users,
};

function useMoney(fr: boolean) {
  return useMemo(() => {
    const cache = new Map<string, Intl.NumberFormat>();
    return (value: number, currency: string | null | undefined, compact = false) => {
      const code = currency || "USD";
      const key = `${code}-${compact}`;
      if (!cache.has(key)) {
        try {
          cache.set(key, new Intl.NumberFormat(fr ? "fr-FR" : "en-US", { style: "currency", currency: code, maximumFractionDigits: compact ? 1 : 0, notation: compact ? "compact" : "standard" }));
        } catch {
          cache.set(key, new Intl.NumberFormat(fr ? "fr-FR" : "en-US", { maximumFractionDigits: 0 }));
        }
      }
      return cache.get(key)!.format(value);
    };
  }, [fr]);
}

function Card({ title, action, children, className = "" }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col rounded-3xl border border-border bg-surface-1 p-5 shadow-[0_18px_40px_-34px_rgba(15,23,42,.55)] ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Delta({ now, before, fr, invert = false }: { now: number; before: number; fr: boolean; invert?: boolean }) {
  if (!before && !now) return <span className="text-xs text-ink-muted">{fr ? "Aucune activité sur 14 jours" : "No activity in 14 days"}</span>;
  const diff = now - before;
  const percent = before ? Math.round((diff / before) * 100) : null;
  const up = diff >= 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${good ? "text-emerald-700 dark:text-emerald-400" : "text-critical"}`}>
      <Icon className="size-3.5" aria-hidden />
      {percent === null ? (fr ? "nouveau" : "new") : `${up ? "+" : ""}${percent} %`}
      <span className="font-normal text-ink-muted">{fr ? "vs semaine précédente" : "vs previous week"}</span>
    </span>
  );
}

/** Area sparkline with a crosshair + tooltip (one series). */
function Sparkline({ points, color, format, fr }: { points: Point[]; color: string; format: (value: number) => string; fr: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 320;
  const height = 84;
  const max = Math.max(1, ...points.map((point) => point.amount));
  const x = (index: number) => (points.length <= 1 ? width / 2 : (index / (points.length - 1)) * width);
  const y = (value: number) => height - 6 - (value / max) * (height - 16);
  const line = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.amount).toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const gradient = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;
  const active = hover !== null ? points[hover] : null;
  if (!points.length) return null;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-20 w-full overflow-visible"
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - box.left) / box.width;
          setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
        }}
        role="img"
        aria-label={fr ? "Évolution sur 30 jours" : "30-day trend"}
      >
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d={area} fill={`url(#${gradient})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {active ? (
          <>
            <line x1={x(hover!)} x2={x(hover!)} y1="0" y2={height} stroke="var(--border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <circle cx={x(hover!)} cy={y(active.amount)} r="4" fill={color} stroke="var(--surface-1)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        ) : (
          <circle cx={x(points.length - 1)} cy={y(points[points.length - 1]!.amount)} r="3.5" fill={color} stroke="var(--surface-1)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {active ? (
        <div
          className="pointer-events-none absolute -top-9 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-surface-1 px-2.5 py-1 text-xs shadow-lg"
          style={{ left: `${(x(hover!) / width) * 100}%` }}
        >
          <span className="text-ink-muted">{new Date(`${active.date}T12:00:00`).toLocaleDateString(fr ? "fr-FR" : "en-GB", { day: "numeric", month: "short" })} · </span>
          <span className="font-semibold text-ink">{format(active.amount)}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Donut of spending by category, with a 2px surface gap between slices. */
function Donut({ slices, total, center, sub, format }: { slices: { label: string; amount: number }[]; total: number; center: string; sub: string; format: (value: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const radius = 62;
  const stroke = 18;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const active = hover !== null ? slices[hover] : null;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative size-44 shrink-0">
        <svg viewBox="0 0 160 160" className="size-full -rotate-90" role="img" aria-label={sub}>
          <circle cx="80" cy="80" r={radius} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
          {total > 0
            ? slices.map((slice, index) => {
                const length = (slice.amount / total) * circumference;
                const gap = slices.length > 1 ? Math.min(2, length / 2) : 0;
                const dash = `${Math.max(0, length - gap)} ${circumference}`;
                const element = (
                  <circle
                    key={slice.label}
                    cx="80"
                    cy="80"
                    r={radius}
                    fill="none"
                    stroke={SERIES[index % SERIES.length]}
                    strokeWidth={hover === index ? stroke + 4 : stroke}
                    strokeDasharray={dash}
                    strokeDashoffset={-offset}
                    className="cursor-pointer transition-[stroke-width]"
                    onMouseEnter={() => setHover(index)}
                    onMouseLeave={() => setHover(null)}
                  />
                );
                offset += length;
                return element;
              })
            : null}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div className="px-6">
            <p className="text-lg font-semibold leading-tight text-ink tabular-nums">{active ? format(active.amount) : center}</p>
            <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{active ? active.label : sub}</p>
          </div>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-1.5">
        {slices.map((slice, index) => (
          <li
            key={slice.label}
            className={`flex items-center gap-2 rounded-lg px-2 py-1 text-xs transition ${hover === index ? "bg-surface-2" : ""}`}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: SERIES[index % SERIES.length] }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-ink-secondary">{slice.label}</span>
            <span className="font-semibold text-ink tabular-nums">{total ? Math.round((slice.amount / total) * 100) : 0} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, sub, href, orgSlug }: { icon: LucideIcon; label: string; value: string; sub?: string; href?: string; orgSlug: string }) {
  const body = (
    <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3 transition hover:bg-surface-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-1 text-brand shadow-sm">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase leading-4 tracking-wide text-ink-muted">{label}</p>
        <p className="truncate text-base font-semibold text-ink tabular-nums">{value}</p>
        {sub ? <p className="truncate text-[11px] text-ink-muted">{sub}</p> : null}
      </div>
    </div>
  );
  return href ? <Link href={`/${orgSlug}${href}`}>{body}</Link> : body;
}

export function InsightsBoard({ orgSlug, fr }: { orgSlug: string; fr: boolean }) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const query = useQuery({
    queryKey: ["dashboard-insights", orgSlug, days],
    queryFn: () => get<Insights>(orgUrl(orgSlug, "dashboard/insights"), { params: { days } }),
    refetchInterval: 5 * 60_000,
    placeholderData: (previous) => previous,
  });
  const money = useMoney(fr);
  const number = useMemo(() => new Intl.NumberFormat(fr ? "fr-FR" : "en-US"), [fr]);
  // Appointments have their own page: keep them off the home dashboard.
  const data = query.data ? { ...query.data, overview: query.data.overview.filter((tile) => tile.key !== "appointments") } : undefined;

  if (query.isLoading)
    return (
      <div className="grid gap-4 lg:grid-cols-3" aria-busy>
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="h-56 animate-pulse rounded-3xl bg-surface-2" />
        ))}
      </div>
    );
  if (!data) return null;

  const alertsTotal = data.alerts.reduce((sum, alert) => sum + alert.count, 0);
  const worst = data.alerts.some((alert) => alert.tone === "critical") ? "critical" : data.alerts.length ? "warning" : "good";
  const poultry = data.production.poultry;
  const pigs = data.production.pigs;
  const crops = data.production.crops;
  const hasProduction = Boolean(poultry || pigs || crops);
  const hasTrends = Boolean(data.sales || data.expensesTrend || data.stock);

  return (
    <div className="space-y-5">
      {/* Day banner */}
      <section
        className={`relative overflow-hidden rounded-3xl border p-5 sm:p-6 ${
          worst === "critical" ? "border-critical/25 bg-critical/[0.06]" : worst === "warning" ? "border-amber-500/25 bg-amber-500/[0.07]" : "border-emerald-500/25 bg-emerald-500/[0.07]"
        }`}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex items-center gap-4">
            <span
              className={`grid size-14 shrink-0 place-items-center rounded-2xl text-white shadow-lg ${
                worst === "critical" ? "bg-gradient-to-br from-rose-500 to-red-600" : worst === "warning" ? "bg-gradient-to-br from-amber-400 to-orange-500" : "bg-gradient-to-br from-emerald-500 to-green-600"
              }`}
            >
              {alertsTotal ? <Sparkles className="size-6" aria-hidden /> : <CheckCircle2 className="size-6" aria-hidden />}
            </span>
            <div>
              <p className="text-3xl font-semibold tracking-tight text-ink tabular-nums">{alertsTotal ? number.format(alertsTotal) : fr ? "Tout est en ordre" : "All clear"}</p>
              <p className="text-sm text-ink-secondary">
                {alertsTotal
                  ? fr
                    ? `point(s) demandent votre attention aujourd’hui`
                    : "item(s) need your attention today"
                  : fr
                    ? "Aucune alerte sur les données que vous suivez."
                    : "No alert on the data you follow."}
              </p>
            </div>
          </div>
          {data.alerts.length ? (
            <div className="flex flex-wrap gap-2 lg:ml-auto lg:justify-end">
              {data.alerts.map((alert) => (
                <Link
                  key={alert.key}
                  href={`/${orgSlug}${alert.href}`}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition hover:brightness-95 ${TONE[alert.tone]}`}
                >
                  {alert.tone === "critical" ? <AlertTriangle className="size-3.5" aria-hidden /> : null}
                  {alert.label}
                  <ArrowRight className="size-3" aria-hidden />
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {/* Spending + trends */}
      {data.spend || hasTrends ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          {data.spend ? (
            <Card
              title={fr ? "Dépenses par catégorie" : "Spending by category"}
              action={
                <div className="flex rounded-full bg-surface-2 p-0.5 text-xs font-semibold" role="group" aria-label={fr ? "Période" : "Period"}>
                  {([7, 30, 90] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDays(value)}
                      aria-pressed={days === value}
                      className={`rounded-full px-2.5 py-1 transition ${days === value ? "bg-surface-1 text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}
                    >
                      {value} {fr ? "j" : "d"}
                    </button>
                  ))}
                </div>
              }
            >
              {data.spend.total > 0 ? (
                <Donut
                  slices={data.spend.categories}
                  total={data.spend.total}
                  center={money(data.spend.total, data.spend.currency, true)}
                  sub={fr ? `Total ${data.spend.days} jours` : `Total ${data.spend.days} days`}
                  format={(value) => money(value, data.spend!.currency)}
                />
              ) : (
                <p className="grid flex-1 place-items-center py-10 text-sm text-ink-muted">{fr ? "Aucune dépense approuvée sur la période." : "No approved expense in this period."}</p>
              )}
            </Card>
          ) : null}
          {hasTrends ? (
            <Card title={fr ? "Ventes, dépenses et stock" : "Sales, spending and stock"} className={data.spend ? "" : "xl:col-span-2"}>
              <div className="grid gap-6 md:grid-cols-2">
                {data.sales ? (
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-ink-muted">{fr ? "Ventes · 7 derniers jours" : "Sales · last 7 days"}</p>
                    <p className="mt-1 text-3xl font-semibold tracking-tight text-ink tabular-nums">{money(data.sales.total7d, data.sales.currency)}</p>
                    <Delta now={data.sales.total7d} before={data.sales.previous7d} fr={fr} />
                    <div className="mt-3">
                      <Sparkline points={data.sales.daily} color="var(--chart-3)" format={(value) => money(value, data.sales!.currency)} fr={fr} />
                    </div>
                  </div>
                ) : null}
                {data.expensesTrend ? (
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-ink-muted">{fr ? "Dépenses · 7 derniers jours" : "Spending · last 7 days"}</p>
                    <p className="mt-1 text-3xl font-semibold tracking-tight text-ink tabular-nums">{money(data.expensesTrend.total7d, data.expensesTrend.currency)}</p>
                    <Delta now={data.expensesTrend.total7d} before={data.expensesTrend.previous7d} fr={fr} invert />
                    <div className="mt-3">
                      <Sparkline points={data.expensesTrend.daily} color="var(--chart-1)" format={(value) => money(value, data.expensesTrend!.currency)} fr={fr} />
                    </div>
                  </div>
                ) : null}
              </div>
              {data.stock || data.finance ? (
                <div className="mt-5 grid gap-2 border-t border-border pt-4 sm:grid-cols-2">
                  {data.stock ? (
                    <MiniStat orgSlug={orgSlug} href="/inventory" icon={Boxes} label={fr ? "Valeur du stock" : "Stock value"} value={data.stock.value !== null ? money(data.stock.value, data.stock.currency, true) : `${number.format(data.stock.itemCount)} ${fr ? "article(s)" : "item(s)"}`} sub={data.stock.lowCount ? `${data.stock.lowCount} ${fr ? "sous le minimum" : "below minimum"}` : fr ? "Aucun article en rupture" : "Nothing below minimum"} />
                  ) : null}
                  {data.finance ? (
                    <>
                      <MiniStat orgSlug={orgSlug} href="/invoices" icon={Wallet} label={fr ? "À encaisser" : "Receivables"} value={money(data.finance.receivables, data.finance.currency, true)} />
                      <MiniStat orgSlug={orgSlug} href="/invoices" icon={FileWarning} label={fr ? "Factures en retard" : "Overdue invoices"} value={number.format(data.finance.overdueInvoices)} sub={data.finance.overdueAmount ? money(data.finance.overdueAmount, data.finance.currency, true) : undefined} />
                    </>
                  ) : null}
                  {data.people ? (
                    <MiniStat orgSlug={orgSlug} href="/attendance" icon={Users} label={fr ? "Présents aujourd’hui" : "Present today"} value={`${number.format(data.people.presentToday)} / ${number.format(data.people.active)}`} sub={data.people.onLeaveToday ? `${data.people.onLeaveToday} ${fr ? "en congé" : "on leave"}` : undefined} />
                  ) : null}
                </div>
              ) : null}
            </Card>
          ) : null}
        </div>
      ) : null}

      {/* Production */}
      {hasProduction ? (
        <Card title={fr ? "Production" : "Production"}>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            {poultry ? (
              <div className="min-w-0">
                <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                  <div>
                    <p className="text-xs font-medium text-ink-muted">{fr ? "Œufs · 7 derniers jours" : "Eggs · last 7 days"}</p>
                    <p className="mt-1 text-3xl font-semibold tracking-tight text-ink tabular-nums">{number.format(poultry.eggs7d)}</p>
                    <Delta now={poultry.eggs7d} before={poultry.previousEggs7d} fr={fr} />
                  </div>
                  <div className="text-sm text-ink-secondary">
                    <p>
                      <span className="font-semibold text-ink tabular-nums">{number.format(poultry.eggsToday)}</span> {fr ? "aujourd’hui" : "today"}
                    </p>
                  </div>
                </div>
                <div className="mt-3">
                  <Sparkline points={poultry.eggsDaily} color="var(--chart-4)" format={(value) => `${number.format(value)} ${fr ? "œufs" : "eggs"}`} fr={fr} />
                </div>
              </div>
            ) : null}
            <div className="grid content-start gap-2 sm:grid-cols-2">
              {poultry ? (
                <>
                  <MiniStat orgSlug={orgSlug} href="/poultry" icon={Bird} label={fr ? "Volaille" : "Poultry"} value={`${number.format(poultry.birds)} ${fr ? "oiseaux" : "birds"}`} sub={`${poultry.flocks} ${fr ? "lot(s) actif(s)" : "active flock(s)"}`} />
                  <MiniStat orgSlug={orgSlug} href="/poultry" icon={AlertTriangle} label={fr ? "Mortalité volaille 7 j" : "Poultry deaths 7d"} value={number.format(poultry.deaths7d)} />
                </>
              ) : null}
              {pigs ? (
                <>
                  <MiniStat orgSlug={orgSlug} href="/pigs" icon={PiggyBank} label={fr ? "Porcs" : "Pigs"} value={`${number.format(pigs.heads)} ${fr ? "têtes" : "head"}`} sub={`${pigs.pens} ${fr ? "loge(s)" : "pen(s)"} · ${pigs.deaths7d} ${fr ? "mort(s) 7 j" : "death(s) 7d"}`} />
                  <MiniStat orgSlug={orgSlug} href="/pigs" icon={Egg} label={fr ? "Mises bas 30 j" : "Farrowings 30d"} value={number.format(pigs.farrowings30d)} />
                </>
              ) : null}
              {crops ? (
                <MiniStat orgSlug={orgSlug} href="/agriculture" icon={Sprout} label={fr ? "Cultures en cours" : "Active crops"} value={number.format(crops.activePlantings)} sub={`${fr ? "Récolte 30 j" : "Harvest 30d"} : ${number.format(crops.harvest30d)}${crops.harvestUnit ? ` ${crops.harvestUnit}` : ""}`} />
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {/* Critical points + overview */}
      {data.critical.length || data.overview.length ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Card title={fr ? "Points critiques" : "Critical points"}>
            {data.critical.length ? (
              <ul className="divide-y divide-border">
                {data.critical.map((item) => {
                  const Icon = KIND_ICON[item.kind] ?? Wrench;
                  return (
                    <li key={item.key}>
                      <Link href={`/${orgSlug}${item.href}`} className="group flex items-center gap-3 py-2.5">
                        <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${TONE[item.tone]}`}>
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">{item.title}</span>
                          <span className="block truncate text-xs text-ink-muted">
                            {item.detail}
                            {item.place ? ` · ${item.place}` : ""}
                          </span>
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[item.tone]}`}>{item.badge}</span>
                        <ArrowRight className="size-4 shrink-0 text-ink-muted transition group-hover:translate-x-0.5" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="flex items-center gap-2 py-6 text-sm text-ink-muted">
                <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
                {fr ? "Aucun point critique." : "Nothing critical."}
              </p>
            )}
          </Card>
          {data.overview.length ? (
            <Card title={fr ? "Vue d’ensemble" : "Overview"}>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {data.overview.map((tile) => {
                  const Icon = TILE_ICON[tile.key] ?? BriefcaseBusiness;
                  return (
                    <Link key={tile.key} href={`/${orgSlug}${tile.href}`} className="group flex items-center gap-3 rounded-2xl border border-border bg-surface-2/60 p-3.5 transition hover:-translate-y-0.5 hover:border-brand/40 hover:bg-surface-1 hover:shadow-md">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xl font-semibold leading-tight text-ink tabular-nums">{number.format(tile.value)}</span>
                        <span className="block text-xs leading-4 text-ink-secondary">{tile.label}</span>
                        {tile.sub ? <span className="block truncate text-[11px] text-ink-muted">{tile.sub}</span> : null}
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-ink-muted transition group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  );
                })}
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
