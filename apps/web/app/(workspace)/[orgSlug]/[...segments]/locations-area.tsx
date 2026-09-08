"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  MapPin,
  Network,
  ShieldCheck,
  Warehouse,
} from "lucide-react";
import { NoAccessState, SkeletonCard } from "@/components/ui/states";
import {
  companySetupApi,
  type OrganizationSite,
  type Province,
} from "@/lib/company-setup-api";
import { can, isOwner } from "@/lib/permissions";
import { useLanguage } from "@/providers/language-provider";
import { useSessionUser } from "@/stores/session-store";
import { LocationsControl } from "./members-area";

/**
 * The company geographic structure has one authoritative source: provinces
 * own sites, and every operational module selects from these same records.
 * This dedicated Owner page is deliberately a presentation layer over the
 * established Company Setup API — it does not create another locations system.
 */
export function LocationsArea({ orgSlug }: { orgSlug: string }) {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const user = useSessionUser();
  const allowed = isOwner(user) && can(user, "sites.read");

  const provinces = useQuery({
    queryKey: ["org-provinces", orgSlug],
    queryFn: () =>
      companySetupApi.listProvinces<{ provinces: Province[] }>(orgSlug),
    enabled: allowed,
    select: (data) => data.provinces,
  });
  const sites = useQuery({
    queryKey: ["org-sites", orgSlug],
    queryFn: () =>
      companySetupApi.listSites<{ sites: OrganizationSite[] }>(orgSlug),
    enabled: allowed,
    select: (data) => data.sites,
  });

  if (!allowed)
    return (
      <NoAccessState
        what={fr ? "Structure géographique" : "Company location structure"}
      />
    );

  const provinceRows = provinces.data ?? [];
  const siteRows = sites.data ?? [];
  const activeSites = siteRows.filter((site) => site.isActive !== false).length;
  const farmCount = siteRows.filter((site) => site.siteType === "farm").length;
  const storageCount = siteRows.filter(
    (site) => site.siteType === "warehouse",
  ).length;

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="relative overflow-hidden rounded-3xl border border-brand/20 bg-[radial-gradient(circle_at_90%_12%,rgba(251,191,36,.28),transparent_26%),radial-gradient(circle_at_5%_108%,rgba(45,212,191,.24),transparent_40%),linear-gradient(125deg,#0c2949,#13577b_52%,#0c7071)] px-5 py-7 text-white shadow-[0_28px_62px_-40px_rgba(5,29,48,.92)] sm:px-7 sm:py-8">
        <div className="relative max-w-3xl">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.18em] text-teal-100">
            <Network className="size-4" aria-hidden />
            {fr ? "Configuration Owner" : "Owner configuration"}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            {fr ? "Provinces et sites" : "Provinces and sites"}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-100/90">
            {fr
              ? "Définissez la structure géographique de votre entreprise. Les fermes, bureaux et entrepôts créés ici sont utilisés dans les employés, projets, achats, stocks et opérations quotidiennes."
              : "Define your company’s geographic structure. Farms, offices and warehouses created here are used by employees, projects, purchasing, stock and daily operations."}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2 text-xs font-medium text-teal-50">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5">
              <ShieldCheck className="size-3.5" aria-hidden />
              {fr
                ? "Modifiable uniquement par le propriétaire"
                : "Owner-only changes"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5">
              <CheckCircle2 className="size-3.5" aria-hidden />
              {fr
                ? "Données partagées dans LiteHubs"
                : "Shared across LiteHubs"}
            </span>
          </div>
        </div>
      </header>

      {provinces.isPending || sites.isPending ? (
        <SkeletonCard rows={4} />
      ) : (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric
            icon={MapPin}
            label={fr ? "Provinces" : "Provinces"}
            value={provinceRows.length}
            detail={fr ? "structure régionale" : "regional structure"}
          />
          <Metric
            icon={Building2}
            label={fr ? "Sites" : "Sites"}
            value={siteRows.length}
            detail={fr ? "tous les emplacements" : "all locations"}
          />
          <Metric
            icon={CheckCircle2}
            label={fr ? "Actifs" : "Active"}
            value={activeSites}
            detail={fr ? "prêts pour les opérations" : "ready for operations"}
            emphasis
          />
          <Metric
            icon={Building2}
            label={fr ? "Fermes" : "Farms"}
            value={farmCount}
            detail={fr ? "production et élevage" : "production and livestock"}
          />
          <Metric
            icon={Warehouse}
            label={fr ? "Entrepôts" : "Warehouses"}
            value={storageCount}
            detail={fr ? "stockage et inventaire" : "storage and inventory"}
          />
        </section>
      )}

      <section className="rounded-2xl border border-border bg-surface-1 p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
            <Network className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-ink">
              {fr
                ? "Ordre de configuration recommandé"
                : "Recommended setup order"}
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-secondary">
              {fr
                ? "Créez d’abord une province, puis les sites qui y appartiennent. Vous pourrez ensuite y rattacher les départements, employés, projets, stocks et opérations de production."
                : "Create a province first, then the sites that belong to it. You can then connect departments, employees, projects, stock and production operations to those locations."}
            </p>
            <ol className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-ink-secondary">
              <li className="rounded-full bg-surface-3 px-3 py-1.5">
                1. {fr ? "Province" : "Province"}
              </li>
              <li aria-hidden className="text-ink-muted">
                →
              </li>
              <li className="rounded-full bg-surface-3 px-3 py-1.5">
                2. {fr ? "Site / ferme" : "Site / farm"}
              </li>
              <li aria-hidden className="text-ink-muted">
                →
              </li>
              <li className="rounded-full bg-surface-3 px-3 py-1.5">
                3. {fr ? "Département" : "Department"}
              </li>
              <li aria-hidden className="text-ink-muted">
                →
              </li>
              <li className="rounded-full bg-surface-3 px-3 py-1.5">
                4. {fr ? "Opérations" : "Operations"}
              </li>
            </ol>
          </div>
        </div>
      </section>

      <LocationsControl orgSlug={orgSlug} />
    </main>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
  emphasis = false,
}: {
  icon: typeof MapPin;
  label: string;
  value: number;
  detail: string;
  emphasis?: boolean;
}) {
  return (
    <article
      className={`rounded-2xl border p-4 shadow-sm ${
        emphasis ? "border-good/25 bg-good/10" : "border-border bg-surface-1"
      }`}
    >
      <Icon
        className={`size-4 ${emphasis ? "text-good-ink" : "text-brand"}`}
        aria-hidden
      />
      <p className="mt-3 text-2xl font-semibold tabular-nums text-ink">
        {value}
      </p>
      <p className="mt-1 text-xs font-semibold text-ink">{label}</p>
      <p className="mt-0.5 text-xs text-ink-muted">{detail}</p>
    </article>
  );
}
