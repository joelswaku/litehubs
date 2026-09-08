"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Building2,
  ChevronRight,
  CircleDollarSign,
  Factory,
  Layers3,
  PauseCircle,
  PlayCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { CategoryChart } from "@/components/charts/category-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ErrorState, SkeletonCard } from "@/components/ui/states";
import { ApiError, get, patch, post, put } from "@/lib/api";
import { canPlatform } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";

type Tenant = {
  id: string;
  slug: string;
  legalName: string;
  displayName: string;
  industryCode: string | null;
  country: string | null;
  city: string | null;
  currency: string;
  status: string;
  createdAt: string;
  subscription: {
    planCode: string;
    status: string;
    seats: number;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
  } | null;
};
type PlatformSummary = {
  tenants: { total: number; byStatus: Record<string, number> };
  subscriptions: {
    byPlan: Record<string, number>;
    byStatus: Record<string, number>;
  };
  industries: { code: string; name: string; tenantCount: number }[];
  recentSignups: { slug: string; displayName: string; createdAt: string }[];
};
type StaffRole = {
  code: string;
  name: string;
  description: string | null;
  permissionCodes: string[];
};
type PlatformRole = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  level: number;
};
type StaffMember = {
  id: string;
  email: string;
  fullName: string;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  roles: string[];
};

function statusKey(status: string) {
  const values: Record<
    string,
    | "platform.statusActive"
    | "platform.statusSuspended"
    | "platform.statusProvisioning"
    | "platform.statusArchived"
    | "platform.statusTrialing"
    | "platform.statusUnknown"
  > = {
    active: "platform.statusActive",
    suspended: "platform.statusSuspended",
    provisioning: "platform.statusProvisioning",
    archived: "platform.statusArchived",
    trialing: "platform.statusTrialing",
  };
  return values[status] ?? "platform.statusUnknown";
}
function statusVariant(
  status: string,
): "good" | "warning" | "critical" | "neutral" {
  if (status === "active") return "good";
  if (status === "trialing" || status === "provisioning") return "warning";
  if (status === "suspended") return "critical";
  return "neutral";
}
function dateFor(value: string | null | undefined, locale: "fr" | "en") {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(
    locale === "fr" ? "fr-FR" : "en-GB",
    { day: "numeric", month: "short", year: "numeric" },
  );
}

export function PlatformDashboard() {
  const { locale, t } = useLanguage();
  const user = useSessionUser();
  const canReadTenants = canPlatform(user, "platform.organizations.read");
  const canReadSubscriptions = canPlatform(user, "platform.subscriptions.read");
  const canReadIndustries = canPlatform(user, "platform.industries.read");
  const summary = useQuery({
    queryKey: ["platform-summary"],
    queryFn: () => get<{ summary: PlatformSummary }>("/platform/summary"),
    select: (data) => data.summary,
    enabled: Boolean(user?.isPlatformStaff),
  });

  if (!user?.isPlatformStaff) return <NoPlatformAccess />;

  const number = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US");
  const data = summary.data;
  const totalTenants = data?.tenants.total ?? 0;
  const activeTenants = data?.tenants.byStatus.active ?? 0;
  const suspendedTenants = data?.tenants.byStatus.suspended ?? 0;
  const otherTenants = Math.max(
    totalTenants - activeTenants - suspendedTenants,
    0,
  );
  const activeRate = totalTenants
    ? Math.round((activeTenants / totalTenants) * 100)
    : 0;
  const activeSubscriptions = Object.entries(data?.subscriptions.byStatus ?? {})
    .filter(([status]) => status === "active" || status === "trialing")
    .reduce((total, [, count]) => total + count, 0);
  const industryData = (data?.industries ?? [])
    .slice()
    .sort((left, right) => right.tenantCount - left.tenantCount)
    .slice(0, 6)
    .map((industry) => ({
      industry: industry.name,
      companies: industry.tenantCount,
    }));
  const healthItems = [
    {
      label: t("platform.activeTenants"),
      value: activeTenants,
      color: "var(--good)",
    },
    {
      label: t("platform.suspendedTenants"),
      value: suspendedTenants,
      color: "var(--critical)",
    },
    {
      label: t("platform.statusUnknown"),
      value: otherTenants,
      color: "var(--seq-250)",
    },
  ];

  return (
    <main className="mx-auto max-w-[1480px] space-y-5 p-4 sm:space-y-6 sm:p-6 lg:p-8">
      <section className="relative isolate overflow-hidden rounded-2xl bg-[linear-gradient(125deg,#0d366b_0%,#184f95_48%,#2a78d6_100%)] px-5 py-6 text-white shadow-[0_20px_55px_-28px_rgba(13,54,107,0.75)] sm:px-7 sm:py-8">
        <div
          className="pointer-events-none absolute -right-16 -top-24 size-80 rounded-full border border-white/10 bg-white/5"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 right-[20%] size-64 rounded-full bg-brand-subtle/10 blur-2xl"
          aria-hidden
        />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-white/90">
              <Sparkles className="size-3.5" aria-hidden />
              {t("platform.kicker")}
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
              {t("platform.consoleTitle")}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-blue-50/85 sm:text-base">
              {t("platform.consoleDescription")}
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              {canReadTenants ? (
                <Link
                  href="/platform/organizations"
                  className="inline-flex items-center gap-2 rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-brand shadow-sm transition hover:bg-blue-50"
                >
                  <Building2 className="size-4" aria-hidden />
                  {t("platform.openOrganizations")}
                  <ArrowUpRight className="size-3.5" aria-hidden />
                </Link>
              ) : null}
              {canReadSubscriptions ? (
                <Link
                  href="/platform/subscriptions"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
                >
                  <CircleDollarSign className="size-4" aria-hidden />
                  {t("platform.openSubscriptions")}
                </Link>
              ) : null}
            </div>
          </div>
          <div className="min-w-52 rounded-xl border border-white/15 bg-slate-950/15 p-4 backdrop-blur-sm">
            <p className="text-xs font-medium text-blue-100">
              {t("platform.activeRate")}
            </p>
            <div className="mt-2 flex items-end gap-2">
              <p className="text-4xl font-semibold tracking-[-0.05em] tabular">
                {summary.isPending ? "—" : `${activeRate}%`}
              </p>
              <span className="mb-1 text-xs text-blue-100">
                {t("platform.activeTenants").toLowerCase()}
              </span>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-white transition-all duration-700"
                style={{ width: `${activeRate}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {canReadTenants ? (
          <>
            <DashboardMetric
              icon={Building2}
              label={t("platform.totalTenants")}
              value={
                summary.isPending ? undefined : number.format(totalTenants)
              }
              tone="brand"
            />
            <DashboardMetric
              icon={Factory}
              label={t("platform.activeTenants")}
              value={
                summary.isPending ? undefined : number.format(activeTenants)
              }
              detail={summary.isPending ? undefined : `${activeRate}%`}
              tone="good"
            />
            <DashboardMetric
              icon={PauseCircle}
              label={t("platform.suspendedTenants")}
              value={
                summary.isPending ? undefined : number.format(suspendedTenants)
              }
              tone="critical"
            />
          </>
        ) : null}
        {canReadSubscriptions ? (
          <DashboardMetric
            icon={CircleDollarSign}
            label={t("platform.liveSubscriptions")}
            value={
              summary.isPending ? undefined : number.format(activeSubscriptions)
            }
            tone="violet"
          />
        ) : null}
      </section>

      {summary.isError ? (
        <ErrorState
          description={t("platform.noData")}
          onRetry={() => summary.refetch()}
        />
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="rounded-2xl border border-border bg-surface-1 p-1 shadow-[0_12px_32px_-28px_rgba(11,11,11,0.55)]">
          {summary.isPending ? (
            <SkeletonCard rows={5} />
          ) : (
            <CategoryChart
              title={t("platform.industryDistribution")}
              description={t("platform.industryCatalogueDescription")}
              data={industryData}
              labelKey="industry"
              valueKey="companies"
              height={210}
              action={
                canReadIndustries ? (
                  <Link
                    href="/platform/industries"
                    className="text-xs font-semibold text-brand hover:underline"
                  >
                    {t("nav.industries")}
                  </Link>
                ) : null
              }
            />
          )}
        </div>
        <DashboardPanel
          title={t("platform.portfolioHealth")}
          description={t("platform.portfolioHealthDescription")}
          icon={Layers3}
        >
          {summary.isPending ? (
            <SkeletonCard rows={4} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center xl:grid-cols-1 2xl:grid-cols-[auto_1fr]">
              <StatusRing
                total={totalTenants}
                label={t("platform.totalTenants")}
                items={healthItems}
              />
              <div className="space-y-3">
                {healthItems.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="flex items-center gap-2 text-sm text-ink-secondary">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: item.color }}
                        aria-hidden
                      />
                      {item.label}
                    </span>
                    <span className="text-sm font-semibold text-ink tabular">
                      {number.format(item.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DashboardPanel>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        <DashboardPanel
          title={t("platform.recentRegistrations")}
          description={t("platform.recentRegistrationsDescription")}
          action={
            canReadTenants ? (
              <Link
                href="/platform/organizations"
                className="text-xs font-semibold text-brand hover:underline"
              >
                {t("platform.openOrganizations")}
              </Link>
            ) : null
          }
        >
          {summary.isPending ? (
            <SkeletonCard rows={4} />
          ) : data?.recentSignups.length ? (
            <div className="divide-y divide-border">
              {data.recentSignups.map((tenant, index) => (
                <Link
                  key={tenant.slug}
                  href={`/platform/organizations/${tenant.slug}`}
                  className="group flex items-center gap-3 px-4 py-3.5 transition hover:bg-surface-2"
                >
                  <span className="grid size-9 place-items-center rounded-xl bg-brand-subtle text-sm font-semibold text-brand">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {tenant.displayName}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-muted">
                      /{tenant.slug} · {dateFor(tenant.createdAt, locale)}
                    </span>
                  </span>
                  <span className="grid size-8 place-items-center rounded-lg text-ink-muted transition group-hover:bg-surface-1 group-hover:text-brand">
                    <ChevronRight className="size-4" aria-hidden />
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyLine text={t("platform.noData")} />
          )}
        </DashboardPanel>

        <DashboardPanel
          title={t("platform.planDistribution")}
          description={t("platform.subscriptionRegistryDescription")}
          action={
            canReadSubscriptions ? (
              <Link
                href="/platform/subscriptions"
                className="text-xs font-semibold text-brand hover:underline"
              >
                {t("platform.openSubscriptions")}
              </Link>
            ) : null
          }
        >
          {summary.isPending ? (
            <SkeletonCard rows={4} />
          ) : (
            <div className="space-y-3 p-4">
              {Object.entries(data?.subscriptions.byPlan ?? {}).length ? (
                Object.entries(data?.subscriptions.byPlan ?? {}).map(
                  ([plan, count]) => (
                    <PlanRow
                      key={plan}
                      plan={plan}
                      count={count}
                      total={activeSubscriptions || count}
                      number={number}
                    />
                  ),
                )
              ) : (
                <EmptyLine text={t("platform.noSubscriptions")} />
              )}
            </div>
          )}
        </DashboardPanel>
      </section>

      <section className="rounded-2xl border border-border bg-surface-1 p-4 shadow-[0_12px_32px_-28px_rgba(11,11,11,0.55)] sm:p-5">
        <div>
          <p className="text-sm font-semibold text-ink">
            {t("platform.quickActions")}
          </p>
          <p className="mt-1 text-xs text-ink-secondary">
            {t("platform.quickActionsDescription")}
          </p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {canReadTenants ? (
            <ActionTile
              href="/platform/organizations"
              icon={Building2}
              title={t("platform.tenantRegistry")}
              description={t("platform.tenantRegistryDescription")}
            />
          ) : null}
          {canReadSubscriptions ? (
            <ActionTile
              href="/platform/subscriptions"
              icon={CircleDollarSign}
              title={t("platform.subscriptionRegistry")}
              description={t("platform.subscriptionRegistryDescription")}
            />
          ) : null}
          {canReadIndustries ? (
            <ActionTile
              href="/platform/industries"
              icon={Layers3}
              title={t("platform.industryCatalogue")}
              description={t("platform.industryCatalogueDescription")}
            />
          ) : null}
        </div>
      </section>
    </main>
  );
}

function DashboardMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Building2;
  label: string;
  value?: string;
  detail?: string;
  tone: "brand" | "good" | "critical" | "violet";
}) {
  const tones = {
    brand:
      "border-brand/20 bg-[linear-gradient(135deg,var(--brand)_0%,var(--brand-active)_100%)] text-white shadow-[0_14px_26px_-22px_var(--brand)]",
    good: "border-good/20 bg-[linear-gradient(135deg,#087d32_0%,#0ca30c_100%)] text-white shadow-[0_14px_26px_-22px_rgba(12,163,12,0.75)]",
    critical:
      "border-critical/20 bg-[linear-gradient(135deg,#b42d3c_0%,#d03b3b_100%)] text-white shadow-[0_14px_26px_-22px_rgba(208,59,59,0.72)]",
    violet:
      "border-violet-500/25 bg-[linear-gradient(135deg,#4a3aa7_0%,#7463d5_100%)] text-white shadow-[0_14px_26px_-22px_rgba(74,58,167,0.7)]",
  } as const;
  return (
    <article
      className={`relative overflow-hidden rounded-2xl border p-4 ${tones[tone]}`}
    >
      <span
        className="absolute -right-4 -top-4 size-20 rounded-full bg-white/10"
        aria-hidden
      />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-white/75">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] tabular">
            {value ?? "—"}
          </p>
          {detail ? (
            <p className="mt-1 text-xs font-medium text-white/80">{detail}</p>
          ) : null}
        </div>
        <span className="grid size-10 place-items-center rounded-xl bg-white/15">
          <Icon className="size-5" aria-hidden />
        </span>
      </div>
    </article>
  );
}

function DashboardPanel({
  title,
  description,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  description: string;
  icon?: typeof Building2;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-[0_12px_32px_-28px_rgba(11,11,11,0.55)]">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="flex min-w-0 gap-3">
          {Icon ? (
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-subtle text-brand">
              <Icon className="size-4" aria-hidden />
            </span>
          ) : null}
          <div>
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
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

function StatusRing({
  total,
  label,
  items,
}: {
  total: number;
  label: string;
  items: { label: string; value: number; color: string }[];
}) {
  const parts = items.filter((item) => item.value > 0);
  let cursor = 0;
  const gradient =
    parts.length && total > 0
      ? `conic-gradient(${parts
          .map((item) => {
            const start = cursor;
            cursor += (item.value / total) * 100;
            return `${item.color} ${start}% ${cursor}%`;
          })
          .join(", ")})`
      : "var(--surface-2)";
  return (
    <div
      className="relative mx-auto grid size-40 place-items-center rounded-full p-3"
      style={{ background: gradient }}
      role="img"
      aria-label={`${total} ${label}`}
    >
      <div className="grid size-full place-items-center rounded-full bg-surface-1 text-center">
        <strong className="text-3xl font-semibold tracking-[-0.04em] text-ink tabular">
          {total}
        </strong>
        <span className="mt-0.5 text-[11px] font-medium text-ink-secondary">
          {label}
        </span>
      </div>
    </div>
  );
}

function PlanRow({
  plan,
  count,
  total,
  number,
}: {
  plan: string;
  count: number;
  total: number;
  number: Intl.NumberFormat;
}) {
  const percentage =
    total > 0 ? Math.min(100, Math.round((count / total) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <span className="truncate text-sm font-medium text-ink">{plan}</span>
        <span className="text-sm font-semibold text-ink tabular">
          {number.format(count)}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-brand transition-all duration-700"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function ActionTile({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: typeof Building2;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-border bg-surface-2/70 p-4 transition hover:-translate-y-0.5 hover:border-brand/35 hover:bg-surface-1 hover:shadow-sm"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-brand-subtle text-brand">
          <Icon className="size-4" aria-hidden />
        </span>
        <ArrowUpRight
          className="size-4 text-ink-muted transition group-hover:text-brand"
          aria-hidden
        />
      </span>
      <span className="mt-4 block text-sm font-semibold text-ink">{title}</span>
      <span className="mt-1 block line-clamp-2 text-xs leading-5 text-ink-secondary">
        {description}
      </span>
    </Link>
  );
}

export function TenantRegistry({
  subscriptionsOnly = false,
}: {
  subscriptionsOnly?: boolean;
}) {
  const { locale, t } = useLanguage();
  const user = useSessionUser();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const allowed = canPlatform(
    user,
    subscriptionsOnly
      ? "platform.subscriptions.read"
      : "platform.organizations.read",
  );
  const registry = useQuery({
    queryKey: ["platform-tenants", search, status],
    queryFn: () =>
      get<{ tenants: Tenant[]; total: number }>("/platform/organizations", {
        params: {
          search: search || undefined,
          status: status || undefined,
          limit: 100,
        },
      }),
    enabled: allowed,
  });
  if (!allowed) return <NoPlatformAccess />;
  const tenants = subscriptionsOnly
    ? (registry.data?.tenants ?? []).filter((tenant) => tenant.subscription)
    : (registry.data?.tenants ?? []);
  const title = subscriptionsOnly
    ? t("platform.subscriptionRegistry")
    : t("platform.tenantRegistry");
  const description = subscriptionsOnly
    ? t("platform.subscriptionRegistryDescription")
    : t("platform.tenantRegistryDescription");
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">
          {t("platform.kicker")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">
          {description}
        </p>
      </header>
      <section className="rounded-lg border border-border bg-surface-1">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-10 pl-9"
              placeholder={t("platform.searchPlaceholder")}
              aria-label={t("platform.searchOrganizations")}
            />
          </div>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-10 rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
          >
            <option value="">{t("platform.allStatuses")}</option>
            <option value="active">{t("platform.statusActive")}</option>
            <option value="suspended">{t("platform.statusSuspended")}</option>
            <option value="provisioning">
              {t("platform.statusProvisioning")}
            </option>
          </select>
        </div>
        {registry.isPending ? (
          <SkeletonCard rows={6} />
        ) : registry.isError ? (
          <ErrorState
            description={t("platform.noData")}
            onRetry={() => registry.refetch()}
          />
        ) : tenants.length ? (
          <div className="divide-y divide-border">
            {tenants.map((tenant) => (
              <div
                key={tenant.id}
                className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.5fr)_0.8fr_0.7fr_0.5fr_auto] lg:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {tenant.displayName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    /{tenant.slug} · {tenant.country ?? "—"}
                  </p>
                </div>
                <p className="text-sm text-ink-secondary">
                  {tenant.industryCode ?? "—"}
                </p>
                <div>
                  <Badge variant={statusVariant(tenant.status)}>
                    {t(statusKey(tenant.status))}
                  </Badge>
                  {subscriptionsOnly && tenant.subscription ? (
                    <p className="mt-1 text-xs text-ink-muted">
                      {tenant.subscription.planCode} ·{" "}
                      {tenant.subscription.seats}{" "}
                      {t("platform.seats").toLowerCase()}
                    </p>
                  ) : null}
                </div>
                <p className="text-xs text-ink-muted">
                  {dateFor(tenant.createdAt, locale)}
                </p>
                <Link
                  href={`/platform/organizations/${tenant.slug}`}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"
                >
                  {t("platform.open")}
                  <ChevronRight className="size-4" aria-hidden />
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <EmptyLine
            text={
              subscriptionsOnly
                ? t("platform.noSubscriptions")
                : t("platform.noOrganizations")
            }
          />
        )}
      </section>
    </main>
  );
}

export function IndustryCatalogue() {
  const { locale, t } = useLanguage();
  const user = useSessionUser();
  const allowed = canPlatform(user, "platform.industries.read");
  const summary = useQuery({
    queryKey: ["platform-summary"],
    queryFn: () => get<{ summary: PlatformSummary }>("/platform/summary"),
    select: (data) => data.summary,
    enabled: allowed,
  });
  if (!allowed) return <NoPlatformAccess />;
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">
          {t("platform.kicker")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
          {t("platform.industryCatalogue")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">
          {t("platform.industryCatalogueDescription")}
        </p>
      </header>
      <section className="overflow-hidden rounded-lg border border-border bg-surface-1">
        {summary.isPending ? (
          <SkeletonCard rows={5} />
        ) : summary.data?.industries.length ? (
          <div className="divide-y divide-border">
            {summary.data.industries.map((industry) => (
              <div
                key={industry.code}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-ink">
                    {industry.name}
                  </p>
                  <p className="text-xs text-ink-muted">{industry.code}</p>
                </div>
                <span className="text-sm font-semibold tabular text-ink">
                  {new Intl.NumberFormat(
                    locale === "fr" ? "fr-FR" : "en-US",
                  ).format(industry.tenantCount)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyLine text={t("platform.noIndustries")} />
        )}
      </section>
    </main>
  );
}

export function TenantDetail({ slug }: { slug: string }) {
  const { locale, t } = useLanguage();
  const user = useSessionUser();
  const queryClient = useQueryClient();
  const allowed = canPlatform(user, "platform.organizations.read");
  const canUpdate = canPlatform(user, "platform.organizations.update");
  const tenant = useQuery({
    queryKey: ["platform-tenant", slug],
    queryFn: () => get<{ tenant: Tenant }>(`/platform/organizations/${slug}`),
    select: (data) => data.tenant,
    enabled: allowed,
  });
  const setStatus = useMutation({
    mutationFn: (status: "active" | "suspended") =>
      patch<{ tenant: Tenant }>(`/platform/organizations/${slug}/status`, {
        status,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-tenant", slug] });
      queryClient.invalidateQueries({ queryKey: ["platform-tenants"] });
      queryClient.invalidateQueries({ queryKey: ["platform-summary"] });
    },
  });
  if (!allowed) return <NoPlatformAccess />;
  if (tenant.isPending)
    return (
      <main className="mx-auto max-w-4xl p-4 sm:p-6">
        <SkeletonCard rows={6} />
      </main>
    );
  if (tenant.isError || !tenant.data)
    return (
      <main className="mx-auto max-w-4xl p-4 sm:p-6">
        <ErrorState
          description={t("platform.noData")}
          onRetry={() => tenant.refetch()}
        />
      </main>
    );
  const item = tenant.data;
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <Link
        href="/platform/organizations"
        className="text-sm font-semibold text-brand hover:underline"
      >
        ← {t("platform.tenantRegistry")}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">
            /{item.slug}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            {item.displayName}
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">{item.legalName}</p>
        </div>
        <Badge variant={statusVariant(item.status)}>
          {t(statusKey(item.status))}
        </Badge>
      </header>
      <div className="rounded-lg border border-brand/25 bg-brand/5 p-4">
        <div className="flex gap-3">
          <ShieldCheck
            className="mt-0.5 size-5 shrink-0 text-brand"
            aria-hidden
          />
          <div>
            <p className="text-sm font-semibold text-ink">
              {t("platform.accountOnly")}
            </p>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              {t("platform.accountOnlyDescription")}
            </p>
          </div>
        </div>
      </div>
      <section className="grid gap-3 sm:grid-cols-2">
        <Info label={t("platform.status")} value={t(statusKey(item.status))} />
        <Info label={t("nav.industries")} value={item.industryCode ?? "—"} />
        <Info label={t("register.country")} value={item.country ?? "—"} />
        <Info
          label={t("platform.created")}
          value={dateFor(item.createdAt, locale)}
        />
        {item.subscription ? (
          <>
            <Info
              label={t("platform.plan")}
              value={item.subscription.planCode}
            />
            <Info
              label={t("platform.seats")}
              value={String(item.subscription.seats)}
            />
          </>
        ) : null}
      </section>
      {canUpdate && item.status !== "archived" ? (
        <div className="flex justify-end">
          {item.status === "suspended" ? (
            <Button
              onClick={() => setStatus.mutate("active")}
              loading={setStatus.isPending}
            >
              <PlayCircle className="size-4" aria-hidden />
              {t("platform.reactivate")}
            </Button>
          ) : (
            <Button
              variant="destructive"
              onClick={() => setStatus.mutate("suspended")}
              loading={setStatus.isPending}
            >
              <PauseCircle className="size-4" aria-hidden />
              {t("platform.suspend")}
            </Button>
          )}
        </div>
      ) : null}
    </main>
  );
}

export function PlatformStaffPage() {
  const { t } = useLanguage();
  const user = useSessionUser();
  if (!user?.isPlatformStaff) return <NoPlatformAccess />;
  const isSuperAdmin = user.platformRoles.includes("platform_super_admin");
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">
          {t("platform.kicker")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
          {t("platform.staffManagement")}
        </h1>
        <p className="mt-2 text-sm text-ink-secondary">
          {t("platform.staffDescription")}
        </p>
      </header>
      {isSuperAdmin ? <StaffManagement /> : <NoPlatformAccess />}
    </main>
  );
}

function StaffManagement() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("platform_support");
  const staff = useQuery({
    queryKey: ["platform-staff-users"],
    queryFn: () => get<{ staff: StaffMember[] }>("/platform/staff/users"),
    select: (data) => data.staff,
  });
  // The catalogue comes from the API so the picker cannot offer a role the
  // backend does not recognise, and gains new ones without a frontend change.
  const roles = useQuery({
    queryKey: ["platform-staff-roles"],
    queryFn: () => get<{ roles: PlatformRole[] }>("/platform/staff/roles"),
    select: (data) => data.roles,
  });
  const create = useMutation({
    mutationFn: () =>
      post("/platform/staff/users", {
        fullName,
        email,
        password,
        roles: [role],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-staff-users"] });
      setFullName("");
      setEmail("");
      setPassword("");
      setRole("platform_support");
      setFormOpen(false);
    },
  });
  const message =
    create.error instanceof ApiError
      ? create.error.message
      : create.error
        ? t("platform.failed")
        : null;
  return (
    <section className="rounded-lg border border-border bg-surface-1">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {t("platform.staff")}
          </h2>
          <p className="mt-0.5 text-xs text-ink-secondary">
            {t("platform.staffDescription")}
          </p>
        </div>
        <Button size="sm" onClick={() => setFormOpen((open) => !open)}>
          {formOpen ? t("platform.cancel") : t("platform.addStaff")}
        </Button>
      </div>
      {formOpen ? (
        <form
          className="grid gap-3 border-b border-border p-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Field
            label={t("platform.fullName")}
            htmlFor="staff-full-name"
            required
          >
            <Input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
            />
          </Field>
          <Field label={t("platform.email")} htmlFor="staff-email" required>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Field
            label={t("platform.temporaryPassword")}
            htmlFor="staff-password"
            required
            hint={t("platform.temporaryPasswordHint")}
          >
            <Input
              type="password"
              minLength={10}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          <Field
            label={t("platform.platformRole")}
            htmlFor="staff-role"
            required
          >
            <select
              id="staff-role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
            >
              {(roles.data ?? []).map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          {message ? (
            <p className="sm:col-span-2 text-xs text-critical" role="alert">
              {message}
            </p>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" loading={create.isPending}>
              {t("platform.createStaff")}
            </Button>
          </div>
        </form>
      ) : null}
      {staff.isPending ? (
        <SkeletonCard rows={4} />
      ) : staff.isError ? (
        <ErrorState
          description={t("platform.loadFailed")}
          onRetry={() => staff.refetch()}
        />
      ) : (
        <div className="divide-y divide-border">
          {staff.data?.map((member) => (
            <StaffRow
              key={member.id}
              member={member}
              roles={roles.data ?? []}
            />
          ))}
        </div>
      )}
    </section>
  );
}
/**
 * One staff member, with the two actions the console was missing: change their
 * platform role, and suspend or reactivate them.
 *
 * Both are Super Admin only at the API, so a Platform Admin cannot promote
 * itself or turn an ordinary account into an operator. The role write is a PUT
 * with the complete set — sending one code replaces whatever was there, which is
 * why this is a single-select rather than an additive control.
 */
function StaffRow({
  member,
  roles,
}: {
  member: StaffMember;
  roles: PlatformRole[];
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(member.roles[0] ?? "platform_support");
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["platform-staff-users"] });

  const saveRole = useMutation({
    mutationFn: () =>
      put(`/platform/staff/users/${member.id}/roles`, { roles: [role] }),
    onSuccess: () => {
      refresh();
      setEditing(false);
    },
  });

  const setStatus = useMutation({
    mutationFn: (status: "active" | "suspended") =>
      patch(`/platform/staff/users/${member.id}/status`, { status }),
    onSuccess: refresh,
  });

  const suspended = member.status !== "active";
  const failure = [saveRole.error, setStatus.error].find(Boolean);
  const message =
    failure instanceof ApiError
      ? failure.message
      : failure
        ? t("platform.failed")
        : null;

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-48 flex-1">
          <p className="text-sm font-medium text-ink">{member.fullName}</p>
          <p className="text-xs text-ink-secondary">{member.email}</p>
        </div>
        <p className="text-xs text-ink-secondary">
          {member.roles
            .map((item) => item.replace("platform_", "").replace(/_/g, " "))
            .join(", ") || "—"}
        </p>
        <Badge variant={suspended ? "warning" : "good"}>{member.status}</Badge>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setEditing((open) => !open)}
          >
            {editing ? t("platform.cancel") : t("platform.changeRole")}
          </Button>
          <Button
            size="sm"
            variant={suspended ? "secondary" : "destructive"}
            loading={setStatus.isPending}
            onClick={() => setStatus.mutate(suspended ? "active" : "suspended")}
          >
            {suspended ? <PlayCircle /> : <PauseCircle />}
            {suspended ? t("platform.reactivate") : t("platform.suspend")}
          </Button>
        </div>
      </div>

      {editing ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface-2 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            saveRole.mutate();
          }}
        >
          <Field
            label={t("platform.staffRole")}
            htmlFor={`role-${member.id}`}
            className="min-w-56"
          >
            <select
              id={`role-${member.id}`}
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="h-9 w-full rounded-md border border-border-strong bg-surface-1 px-3 text-sm text-ink"
            >
              {roles.length === 0 ? (
                <option value={role}>{t("platform.rolesUnavailable")}</option>
              ) : (
                roles.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))
              )}
            </select>
          </Field>
          <Button type="submit" size="sm" loading={saveRole.isPending}>
            {t("platform.saveRole")}
          </Button>
        </form>
      ) : null}

      {message ? (
        <p className="mt-2 text-xs text-critical" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2;
  label: string;
  value?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-ink-secondary">{label}</p>
        <Icon className="size-4 text-ink-muted" aria-hidden />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-ink">
        {value ?? "—"}
      </p>
    </div>
  );
}
function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface-1">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <p className="mt-0.5 text-xs text-ink-secondary">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-1 p-4">
      <p className="text-xs font-medium text-ink-secondary">{label}</p>
      <p className="mt-2 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}
function EmptyLine({ text }: { text: string }) {
  return (
    <p className="px-4 py-8 text-center text-sm text-ink-secondary">{text}</p>
  );
}
function NoPlatformAccess() {
  const { t } = useLanguage();
  return (
    <main className="grid min-h-[60dvh] place-items-center p-4">
      <div className="max-w-md text-center">
        <ShieldCheck className="mx-auto size-9 text-ink-muted" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold text-ink">
          {t("platform.accessRequired")}
        </h1>
        <p className="mt-1 text-sm text-ink-secondary">
          {t("platform.accessNotGranted")}
        </p>
      </div>
    </main>
  );
}
