"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  FileUp,
  Home,
  MapPin,
  SearchCheck,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/ui/states";
import { get } from "@/lib/api";
import {
  CareersBrandMark,
  careersBrandStyle,
  careersHeroStyle,
  type CareersBranding,
} from "@/components/careers/careers-branding";

const label = (fr: boolean, french: string, english: string) =>
  fr ? french : english;
const publicUrl = (org: string, rest: string) =>
  `/public/organizations/${org}/careers/${rest}`;
const cleanTitle = (value: unknown) =>
  String(value ?? "").replace(/^\s*:\s*/, "");
const candidateContactEmail = "recrutement@congoomega.com";
const publicOrganizationName = (orgSlug: string, reportedName?: unknown) => {
  // Congo Omega's public recruitment pages must never inherit the LiteHubs
  // product label from an older organization record or a stale API response.
  if (["congo-omega", "kins"].includes(orgSlug.trim().toLowerCase())) {
    return "Congo Omega";
  }
  const name = String(reportedName ?? "").trim();
  return name || "Entreprise";
};
const hasPublicCustomerAccount = (orgSlug: string) =>
  ["congo-omega", "kins"].includes(orgSlug.trim().toLowerCase());
// The careers pages are also served on carrieres.congoomega.com, where "/"
// is the careers list.  "Home" and "My account" must open the company
// website itself, never the LiteHubs application.
const publicWebsiteUrl = (orgSlug: string) =>
  hasPublicCustomerAccount(orgSlug) ? "https://congoomega.com" : "/";
const displayDate = (value: string | null | undefined, fr: boolean) =>
  value
    ? new Date(value).toLocaleDateString(fr ? "fr-FR" : "en-US", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

function Shell({
  children,
  fr,
  setFr,
  organizationName,
  accountHref,
  trackHref,
  websiteHref = "/",
  branding,
}: {
  children: ReactNode;
  fr: boolean;
  setFr: (value: boolean) => void;
  organizationName: string;
  accountHref?: string;
  trackHref?: string;
  websiteHref?: string;
  branding?: CareersBranding | null;
}) {
  // On phones the buttons are icon-only so the bar stays on one line; the
  // labels appear from the small breakpoint upward.
  const chip =
    "inline-flex size-9 shrink-0 items-center justify-center gap-1.5 rounded-lg text-xs font-bold shadow-sm transition sm:w-auto sm:px-3";
  return (
    <main
      style={careersBrandStyle(branding)}
      className="min-h-dvh bg-[radial-gradient(circle_at_18%_-5%,rgba(15,23,42,.06),transparent_36%),var(--color-page)] px-4 py-5 sm:py-10"
    >
      <div className="mx-auto max-w-6xl">
        <header className="mb-5 flex items-center justify-between gap-2 sm:mb-6 sm:gap-3">
          <CareersBrandMark branding={branding} organizationName={organizationName} href={websiteHref} />
          <nav className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <a
              href={websiteHref}
              title={label(fr, "Retour au site", "Back to website")}
              className={`${chip} border border-border bg-surface-1 text-ink hover:bg-surface-2`}
            >
              <Home className="size-4" />
              <span className="hidden sm:inline">{label(fr, "Site web", "Website")}</span>
            </a>
            {trackHref ? (
              <Link
                href={trackHref}
                title={label(fr, "Suivre ma candidature", "Track my application")}
                className={`${chip} border border-brand/30 bg-surface-1 text-brand hover:bg-brand/[.06]`}
              >
                <SearchCheck className="size-4" />
                <span className="hidden sm:inline">{label(fr, "Suivre ma candidature", "Track my application")}</span>
              </Link>
            ) : null}
            {accountHref ? (
              <a
                href={accountHref}
                title={label(fr, "Mon compte", "My account")}
                className={`${chip} bg-brand text-brand-ink hover:brightness-110`}
              >
                <UserRound className="size-4" />
                <span className="hidden sm:inline">{label(fr, "Mon compte", "My account")}</span>
              </a>
            ) : null}
            <button
              type="button"
              className={`${chip} border border-border bg-surface-1 text-ink hover:bg-surface-2`}
              onClick={() => setFr(!fr)}
            >
              {fr ? "EN" : "FR"}
            </button>
          </nav>
        </header>
        {children}
        {accountHref ? (
          <footer className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-border/80 px-1 pt-5 text-xs text-ink-secondary">
            <span>© {new Date().getFullYear()} {organizationName}</span>
            <a
              href={accountHref}
              className="inline-flex items-center gap-1.5 font-semibold text-brand transition hover:underline"
            >
              <UserRound className="size-3.5" />
              {label(fr, "Mon compte client", "My customer account")}
            </a>
          </footer>
        ) : null}
      </div>
    </main>
  );
}

function typeLabel(value: string, fr: boolean) {
  const map: Record<string, [string, string]> = {
    permanent: ["Permanent", "Permanent"],
    temporary: ["Temporaire", "Temporary"],
    contract: ["Contrat", "Contract"],
    casual: ["Occasionnel", "Casual"],
    internship: ["Stage", "Internship"],
  };
  const values = map[value] ?? [value, value];
  return label(fr, values[0], values[1]);
}

export function PublicCareersPage({ orgSlug }: { orgSlug: string }) {
  const [fr, setFr] = useState(true);
  const [site, setSite] = useState("");
  useEffect(() => {
    setSite(new URLSearchParams(window.location.search).get("site") ?? "");
  }, []);
  const careers = useQuery({
    queryKey: ["public-careers", orgSlug],
    queryFn: () => get<any>(publicUrl(orgSlug, "jobs")),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const jobs = useMemo(
    () =>
      (careers.data?.jobs ?? []).filter(
        (job: any) => !site || job.site.code === site,
      ),
    [careers.data, site],
  );
  const sites = useMemo(
    () =>
      Array.from(
        new Map(
          (careers.data?.jobs ?? []).map((job: any) => [
            job.site.code,
            job.site,
          ]),
        ).values(),
      ) as any[],
    [careers.data],
  );
  return (
    <Shell
      trackHref={`/careers/${orgSlug}/suivi`}
      fr={fr}
      setFr={setFr}
      organizationName={publicOrganizationName(orgSlug, careers.data?.organizationName)}
      websiteHref={publicWebsiteUrl(orgSlug)}
      branding={careers.data?.branding}
      accountHref={hasPublicCustomerAccount(orgSlug) ? `${publicWebsiteUrl(orgSlug)}/account` : undefined}
    >
      <section className="overflow-hidden rounded-3xl border border-brand/20 bg-surface-1 shadow-[0_24px_70px_-45px_rgb(15_23_42_/_0.75)]">
        <div style={careersHeroStyle(careers.data?.branding)} className="relative overflow-hidden bg-[radial-gradient(circle_at_82%_-30%,rgba(125,211,252,.34),transparent_42%),linear-gradient(125deg,#172554,#2563a6)] px-6 py-9 text-white sm:px-9 sm:py-11">
          <p className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold tracking-[.16em] text-sky-50">
            {label(fr, "CARRIÈRES", "CAREERS")}
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            {publicOrganizationName(orgSlug, careers.data?.organizationName)}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-sky-50/95">
            {careers.data?.intro ??
              label(
                fr,
                "Découvrez les opportunités ouvertes et déposez votre candidature de façon sécurisée.",
                "Discover open opportunities and submit your application securely.",
              )}
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-xs font-medium text-sky-50">
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">
              {label(
                fr,
                "Candidatures confidentielles",
                "Confidential applications",
              )}
            </span>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">
              {label(fr, "Réponse par l’équipe RH", "Reply from the HR team")}
            </span>
          </div>
        </div>
        <CardContent className="p-5 sm:p-8">
          <Link
            href={`/careers/${orgSlug}/suivi`}
            className="mb-6 flex items-center gap-3 rounded-2xl border border-brand/25 bg-brand/[.06] p-4 transition hover:bg-brand/[.1]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-brand-ink">
              <SearchCheck className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">
                {label(fr, "Vous avez déjà postulé ?", "Already applied?")}
              </span>
              <span className="block text-xs leading-5 text-ink-secondary">
                {label(
                  fr,
                  "Suivez votre candidature et envoyez les documents demandés. Utilisez le lien reçu par e-mail ou SMS, ou demandez-en un nouveau ici.",
                  "Follow your application and send requested documents. Use the link received by e-mail or SMS, or request a new one here.",
                )}
              </span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-brand" />
          </Link>
          {careers.isLoading ? (
            <SkeletonCard rows={5} />
          ) : careers.isError ? (
            <ErrorState
              title={label(
                fr,
                "Carrières indisponibles",
                "Careers unavailable",
              )}
              description={(careers.error as Error).message}
              onRetry={() => void careers.refetch()}
            />
          ) : !careers.data?.jobs?.length ? (
            <EmptyState
              icon={BriefcaseBusiness}
              title={label(
                fr,
                "Aucun poste ouvert pour le moment",
                "No open vacancies at the moment",
              )}
              description={label(
                fr,
                "Cette entreprise ne recrute pas actuellement. Revenez plus tard.",
                "This organization is not recruiting right now. Please check back later.",
              )}
            />
          ) : (
            <>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {jobs.length}{" "}
                    {label(fr, "poste(s) disponible(s)", "open role(s)")}
                  </p>
                  <p className="mt-1 text-xs text-ink-secondary">
                    {label(
                      fr,
                      "Choisissez le site qui vous convient.",
                      "Choose the site that works for you.",
                    )}
                  </p>
                </div>
                <select
                  aria-label={label(fr, "Filtrer par site", "Filter by site")}
                  className="control h-10 max-w-64 bg-surface-1 shadow-sm"
                  value={site}
                  onChange={(event) => setSite(event.target.value)}
                >
                  <option value="">
                    {label(fr, "Tous les sites", "All sites")}
                  </option>
                  {sites.map((item: any) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {jobs.map((job: any) => (
                  <Link
                    key={job.code}
                    href={`/careers/${orgSlug}/${job.code}`}
                    className="group relative overflow-hidden rounded-2xl border border-brand/20 bg-surface-1 p-5 ring-1 ring-brand/[.03] shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-brand/45 hover:shadow-[0_18px_34px_-28px_rgb(30_64_175_/_0.7)]"
                  >
                    <div className="absolute inset-y-0 left-0 w-1 bg-brand/55" />
                    <div className="flex items-start justify-between gap-3">
                      <span className="grid size-11 place-items-center rounded-xl bg-brand/10 text-brand">
                        <BriefcaseBusiness className="size-5" />
                      </span>
                      <Badge variant="info">
                        {typeLabel(job.employmentType, fr)}
                      </Badge>
                    </div>
                    <h2 className="mt-5 text-lg font-semibold text-ink transition-colors group-hover:text-brand">
                      {cleanTitle(job.title)}
                    </h2>
                    <p className="mt-2 line-clamp-3 text-sm leading-6 text-ink-secondary">
                      {job.shortSummary}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-border/70 pt-3 text-xs text-ink-secondary">
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1">
                        <MapPin className="size-3.5" />
                        {job.site.name}
                      </span>
                      <span className="rounded-full bg-surface-2 px-2.5 py-1">
                        {job.positionsOpen}{" "}
                        {label(fr, "poste(s)", "position(s)")}
                      </span>
                    </div>
                    {job.applicationDeadline && (
                      <p className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand">
                        <CalendarDays className="size-3.5" />
                        {label(fr, "Clôture", "Deadline")}:{" "}
                        {displayDate(job.applicationDeadline, fr)}
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </section>
    </Shell>
  );
}

export function PublicCareerJobPage({
  orgSlug,
  jobCode,
}: {
  orgSlug: string;
  jobCode: string;
}) {
  const [fr, setFr] = useState(true);
  const [done, setDone] = useState(false);
  const [trackingUrl, setTrackingUrl] = useState<string | null>(null);
  const jobDetail = useQuery({
    queryKey: ["public-career-job", orgSlug, jobCode],
    queryFn: () => get<any>(publicUrl(orgSlug, `jobs/${jobCode}`)),
  });
  const job = jobDetail.data?.job;
  const title = cleanTitle(job?.title) || label(fr, "Chargement…", "Loading…");
  return (
    <Shell
      trackHref={`/careers/${orgSlug}/suivi`}
      fr={fr}
      setFr={setFr}
      organizationName={publicOrganizationName(orgSlug, jobDetail.data?.organizationName)}
      websiteHref={publicWebsiteUrl(orgSlug)}
      branding={jobDetail.data?.branding}
      accountHref={hasPublicCustomerAccount(orgSlug) ? `${publicWebsiteUrl(orgSlug)}/account` : undefined}
    >
      <section className="overflow-hidden rounded-3xl border border-brand/20 bg-surface-1 shadow-[0_24px_70px_-45px_rgb(15_23_42_/_0.75)]">
        <div style={careersHeroStyle(jobDetail.data?.branding)} className="relative overflow-hidden bg-[radial-gradient(circle_at_82%_-25%,rgba(125,211,252,.34),transparent_42%),linear-gradient(125deg,#172554,#2563a6)] px-6 py-8 text-white sm:px-9 sm:py-10">
          <Link
            href={`/careers/${orgSlug}`}
            className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/[.08] px-3 py-2 text-xs font-semibold text-sky-50 transition hover:bg-white/[.16]"
          >
            <ArrowLeft className="size-3.5" />
            {label(fr, "Tous les postes", "All roles")}
          </Link>
          {job && (
            <>
              <p className="mt-7 text-xs font-bold tracking-[.16em] text-sky-100">
                {job.site?.name ?? label(fr, "CARRIÈRES", "CAREERS")}
              </p>
              <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
                {title}
              </h1>
              <p className="mt-3 text-sm text-sky-50">
                {job.departmentName ||
                  job.province?.name ||
                  jobDetail.data?.organizationName}
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold">
                  {typeLabel(job.employmentType, fr)}
                </span>
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold">
                  {job.positionsOpen}{" "}
                  {label(fr, "poste(s) à pourvoir", "open position(s)")}
                </span>
                {job.applicationDeadline && (
                  <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold">
                    {label(fr, "Clôture", "Deadline")}:{" "}
                    {displayDate(job.applicationDeadline, fr)}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        <CardContent className="p-5 sm:p-8">
          {jobDetail.isLoading ? (
            <SkeletonCard rows={8} />
          ) : jobDetail.isError ? (
            <ErrorState
              title={label(
                fr,
                "Ce poste n’est plus disponible",
                "This role is no longer available",
              )}
              description={(jobDetail.error as Error).message}
              onRetry={() => void jobDetail.refetch()}
            />
          ) : done ? (
            <ApplicationReceived fr={fr} trackingUrl={trackingUrl} />
          ) : job ? (
            <div className="grid gap-7 lg:grid-cols-[minmax(0,1.18fr)_minmax(350px,.82fr)]">
              <article className="space-y-4">
                <DetailsSection
                  icon={FileText}
                  title={label(fr, "À propos du poste", "About the role")}
                  value={job.description}
                  accent="brand"
                />
                {job.responsibilities && (
                  <DetailsSection
                    icon={UsersRound}
                    title={label(fr, "Responsabilités", "Responsibilities")}
                    value={job.responsibilities}
                  />
                )}
                {job.requirements && (
                  <DetailsSection
                    icon={CheckCircle2}
                    title={label(fr, "Profil recherché", "Requirements")}
                    value={job.requirements}
                  />
                )}
                {job.benefits && (
                  <DetailsSection
                    icon={SparkleIcon}
                    title={label(fr, "Ce que nous proposons", "Benefits")}
                    value={job.benefits}
                  />
                )}
                {job.salarySummary && (
                  <div className="flex gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[.06] p-5">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600">
                      <BriefcaseBusiness className="size-5" />
                    </span>
                    <div>
                      <h2 className="font-semibold text-ink">
                        {label(fr, "Rémunération", "Compensation")}
                      </h2>
                      <p className="mt-1 text-sm text-ink-secondary">
                        {job.salarySummary}
                      </p>
                    </div>
                  </div>
                )}
              </article>
              <ApplicationForm
                orgSlug={orgSlug}
                jobCode={jobCode}
                fr={fr}
                jobTitle={title}
                onDone={(result) => {
                  setTrackingUrl(result?.trackingUrl ?? null);
                  setDone(true);
                }}
              />
            </div>
          ) : null}
        </CardContent>
      </section>
    </Shell>
  );
}

function SparkleIcon({ className }: { className?: string }) {
  return <span className={className}>✦</span>;
}

function ApplicationReceived({ fr, trackingUrl }: { fr: boolean; trackingUrl: string | null }) {
  return (
    <div className="py-10 text-center">
      <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-600">
        <CheckCircle2 className="size-8" />
      </span>
      <h2 className="mt-5 text-2xl font-semibold text-ink">
        {label(fr, "Candidature reçue", "Application received")}
      </h2>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-ink-secondary">
        {label(
          fr,
          "Une confirmation a été envoyée par e-mail et par SMS. L’équipe de recrutement examinera votre candidature de manière confidentielle et vous contactera si votre profil correspond au poste ou si des documents complémentaires sont nécessaires.",
          "A confirmation has been sent by email and SMS. The recruitment team will review your application confidentially and contact you if your profile fits the role or if further documents are needed.",
        )}
      </p>
      {trackingUrl ? (
        <div className="mx-auto mt-6 max-w-lg rounded-2xl border border-brand/25 bg-brand/[.05] p-5">
          <p className="text-sm font-semibold text-ink">
            {label(fr, "Votre Espace candidat est prêt", "Your candidate space is ready")}
          </p>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">
            {label(
              fr,
              "Suivez l’avancement, lisez les messages de l’équipe et envoyez les documents demandés. Le lien vous a aussi été envoyé par e-mail et SMS.",
              "Follow progress, read messages from the team and send requested documents. The link was also sent by email and SMS.",
            )}
          </p>
          <a
            href={trackingUrl}
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-brand-ink shadow-sm transition hover:brightness-110"
          >
            <SearchCheck className="size-4" />
            {label(fr, "Ouvrir mon Espace candidat", "Open my candidate space")}
          </a>
        </div>
      ) : null}
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-ink-secondary">
        {label(fr, "Une question ? Écrivez à ", "Questions? Email ")}
        <a className="font-semibold text-brand underline underline-offset-2" href={`mailto:${candidateContactEmail}`}>
          {candidateContactEmail}
        </a>
      </p>
    </div>
  );
}

function DetailsSection({
  icon: Icon,
  title,
  value,
  accent = "surface",
}: {
  icon: (props: { className?: string }) => ReactNode;
  title: string;
  value: string;
  accent?: "brand" | "surface";
}) {
  const isBrand = accent === "brand";
  return (
    <details
      className={`group rounded-xl border p-3.5 shadow-sm transition-colors sm:rounded-2xl sm:p-5 ${
        isBrand
          ? "border-brand/20 bg-brand/[.035]"
          : "border-border/80 bg-surface-1"
      }`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 sm:gap-3 [&::-webkit-details-marker]:hidden">
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-xl ${"bg-brand/10 text-brand"}`}
        >
          <Icon className="size-4 sm:size-5" />
        </span>
        <span className="min-w-0 flex-1 text-sm font-semibold text-ink sm:text-base">
          {title}
        </span>
        <ChevronDown className="size-4 shrink-0 text-ink-secondary transition-transform duration-200 group-open:rotate-180 sm:size-5" />
      </summary>
      <div className="ml-4 border-l border-border/70 pl-3 pt-3 sm:ml-[3.25rem] sm:pl-4 sm:pt-4">
        <p className="whitespace-pre-line text-sm leading-6 text-ink-secondary sm:leading-7">
          {value}
        </p>
      </div>
    </details>
  );
}

function ApplicationForm({
  orgSlug,
  jobCode,
  fr,
  jobTitle,
  onDone,
}: {
  orgSlug: string;
  jobCode: string;
  fr: boolean;
  jobTitle: string;
  onDone: (result?: { trackingUrl?: string }) => void;
}) {
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    city: "",
    yearsExperience: "",
    availability: "",
    coverLetter: "",
    consent: false,
  });
  const [resume, setResume] = useState<File | null>(null);
  const submit = useMutation({
    mutationFn: async () => {
      if (!resume)
        throw new Error(
          label(
            fr,
            "Ajoutez votre CV (PDF, DOC ou DOCX).",
            "Attach your résumé (PDF, DOC, or DOCX).",
          ),
        );
      const data = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        if (key !== "consent" && value !== "") data.append(key, String(value));
      });
      data.append("consent", form.consent ? "true" : "");
      data.append("preferredLanguage", fr ? "fr" : "en");
      data.append("resume", resume);
      const response = await fetch(
        `/api/v1${publicUrl(orgSlug, `jobs/${jobCode}/applications`)}`,
        { method: "POST", body: data, credentials: "same-origin" },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          body?.error?.message ??
            label(
              fr,
              "Impossible d’envoyer la candidature.",
              "Could not submit the application.",
            ),
        );
      return body;
    },
    onSuccess: (body) => onDone(body ?? undefined),
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <aside className="h-fit overflow-hidden rounded-2xl border border-brand/25 bg-surface-1 ring-1 ring-brand/[.04] shadow-[0_18px_38px_-30px_rgb(30_64_175_/_0.75)] lg:sticky lg:top-6">
      <div className="border-b border-brand/15 bg-[linear-gradient(135deg,rgba(37,99,235,.12),rgba(14,165,233,.05))] p-5">
        <div className="flex gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand text-brand-ink shadow-sm">
            <FileUp className="size-5" />
          </span>
          <div>
            <p className="text-[11px] font-bold tracking-[.14em] text-brand">
              {label(fr, "CANDIDATURE", "APPLICATION")}
            </p>
            <h2 className="mt-1 font-semibold text-ink">
              {label(fr, "Postuler au poste", "Apply for this role")}
            </h2>
            <p className="mt-1 text-xs leading-5 text-ink-secondary">
              {jobTitle}
            </p>
          </div>
        </div>
      </div>
      <form
        className="grid gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit.mutate();
        }}
      >
        <div className="rounded-xl border border-brand/15 bg-brand/[.035] px-3 py-2.5 text-xs leading-5 text-ink-secondary">
          <span className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />
            {label(
              fr,
              "Vos informations et votre CV sont transmis uniquement à l’équipe de recrutement autorisée.",
              "Your information and résumé are sent only to the authorized recruitment team.",
            )}
          </span>
        </div>
        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[.12em] text-ink-secondary">
            {label(fr, "Vos coordonnées", "Your details")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <Field
              className="sm:col-span-2 lg:col-span-1"
              label={label(fr, "Nom complet", "Full name")}
              required
            >
              <Input
                required
                autoComplete="name"
                value={form.fullName}
                onChange={(event) =>
                  setForm((state) => ({
                    ...state,
                    fullName: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="E-mail" required>
              <Input
                required
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(event) =>
                  setForm((state) => ({ ...state, email: event.target.value }))
                }
              />
            </Field>
            <Field label={label(fr, "Téléphone", "Phone")} required>
              <PhoneInput
                required
                fr={fr}
                value={form.phone}
                onChange={(event) =>
                  setForm((state) => ({ ...state, phone: event.target.value }))
                }
                onNormalizedChange={(phone) => setForm((state) => ({ ...state, phone }))}
              />
            </Field>
            <Field label={label(fr, "Ville", "City")}>
              <Input
                autoComplete="address-level2"
                value={form.city}
                onChange={(event) =>
                  setForm((state) => ({ ...state, city: event.target.value }))
                }
              />
            </Field>
            <Field
              label={label(fr, "Années d’expérience", "Years of experience")}
            >
              <Input
                type="number"
                min="0"
                max="80"
                inputMode="numeric"
                value={form.yearsExperience}
                onChange={(event) =>
                  setForm((state) => ({
                    ...state,
                    yearsExperience: event.target.value,
                  }))
                }
              />
            </Field>
          </div>
        </div>
        <div className="border-t border-border/70 pt-4">
          <p className="mb-3 text-xs font-bold uppercase tracking-[.12em] text-ink-secondary">
            {label(fr, "Votre profil", "Your profile")}
          </p>
          <div className="grid gap-3">
            <Field label={label(fr, "Disponibilité", "Availability")}>
              <Input
                placeholder={label(
                  fr,
                  "Ex. Disponible immédiatement",
                  "E.g. Available immediately",
                )}
                value={form.availability}
                onChange={(event) =>
                  setForm((state) => ({
                    ...state,
                    availability: event.target.value,
                  }))
                }
              />
            </Field>
            <Field
              label="CV"
              required
              hint={label(
                fr,
                "PDF, DOC ou DOCX · document privé",
                "PDF, DOC, or DOCX · private document",
              )}
            >
              <Input
                required
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => setResume(event.target.files?.[0] ?? null)}
              />
              {resume && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-brand">
                  <CheckCircle2 className="size-3.5" />
                  {resume.name}
                </p>
              )}
            </Field>
            <Field label={label(fr, "Message de motivation", "Cover letter")}>
              <Textarea
                rows={5}
                placeholder={label(
                  fr,
                  "Expliquez en quelques lignes pourquoi ce poste vous intéresse.",
                  "Briefly explain why this role interests you.",
                )}
                value={form.coverLetter}
                onChange={(event) =>
                  setForm((state) => ({
                    ...state,
                    coverLetter: event.target.value,
                  }))
                }
              />
            </Field>
          </div>
        </div>
        <label
          className={`flex cursor-pointer gap-2.5 rounded-xl border p-3 text-xs leading-5 transition ${form.consent ? "border-brand/35 bg-brand/[.045] text-ink" : "border-border bg-surface-2/45 text-ink-secondary"}`}
        >
          <input
            required
            className="mt-0.5 size-4 accent-[var(--color-brand)]"
            type="checkbox"
            checked={form.consent}
            onChange={(event) =>
              setForm((state) => ({ ...state, consent: event.target.checked }))
            }
          />
          <span>
            {label(
              fr,
              "Je consens à ce que mes informations soient utilisées uniquement pour l’examen de cette candidature.",
              "I consent to my information being used only to review this application.",
            )}
          </span>
        </label>
        <Button loading={submit.isPending} className="mt-1 h-11">
          <UsersRound className="size-4" />
          {label(fr, "Envoyer ma candidature", "Submit application")}
          <ChevronRight className="size-4" />
        </Button>
        <p className="text-center text-[11px] leading-5 text-ink-secondary">
          {label(
            fr,
            "Vous recevrez une réponse si votre profil correspond aux besoins du poste ou si des documents complémentaires sont nécessaires.",
            "You will receive a response if your profile matches the role requirements or if further documents are needed.",
          )}
          {" "}
          <a className="font-semibold text-brand underline underline-offset-2" href={`mailto:${candidateContactEmail}`}>
            {candidateContactEmail}
          </a>
        </p>
      </form>
    </aside>
  );
}
