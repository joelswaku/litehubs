"use client";

import Link from "next/link";
import {
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  KeyRound,
  LogIn,
  ShieldCheck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { useLanguage } from "@/providers/language-provider";

type LandingCopy = {
  nav: readonly string[];
  signIn: string;
  contact: string;
  eyebrow: string;
  title: string;
  description: string;
  primary: string;
  secondary: string;
  proof: readonly string[];
  dashboard: string;
  today: string;
  onTrack: string;
  ready: string;
  metrics: readonly { label: string; value: string }[];
  featureEyebrow: string;
  featureTitle: string;
  featureDescription: string;
  features: readonly { title: string; description: string }[];
  processEyebrow: string;
  processTitle: string;
  processDescription: string;
  steps: readonly { title: string; description: string }[];
  footer: string;
  opening: string;
  loginEyebrow: string;
  loginTitle: string;
  loginDescription: string;
  loginEmail: string;
  loginPassword: string;
  loginHelp: string;
};

const french: LandingCopy = {
  nav: ["Fonctionnalités", "Pour les équipes", "Sécurité"],
  signIn: "Se connecter",
  contact: "Contact",
  eyebrow: "LE PILOTAGE, EN UNE VUE",
  title: "Faites avancer votre entreprise avec une vision nette.",
  description:
    "LiteHubs relie le terrain, les équipes, les projets et les décisions pour que chaque responsable sache quoi faire ensuite.",
  primary: "Se connecter à LiteHubs",
  secondary: "Découvrir la plateforme",
  proof: ["Accès par rôle", "Données par site", "Suivi en temps réel"],
  dashboard: "Vue opérationnelle",
  today: "Aujourd’hui",
  onTrack: "Activité maîtrisée",
  ready: "Prêt à agir",
  metrics: [
    { label: "Tâches ouvertes", value: "12" },
    { label: "Équipe présente", value: "36" },
    { label: "Budget suivi", value: "84%" },
  ],
  featureEyebrow: "UNE PLATEFORME, PAS DES SILOS",
  featureTitle: "Le contrôle de l’entreprise, au bon endroit.",
  featureDescription:
    "Conçue pour les opérations qui ne peuvent pas attendre : agriculture, élevage, projets, personnel et finances.",
  features: [
    {
      title: "Opérations sur le terrain",
      description:
        "Planifiez, enregistrez et suivez ce qui se passe réellement sur chaque site.",
    },
    {
      title: "Équipes et conformité",
      description:
        "Gérez les personnes, horaires, formations, contrats et accès sans perdre le contexte.",
    },
    {
      title: "Projets et décisions",
      description:
        "Reliez budgets, achats, tâches, ressources et documents dans un même contrôle.",
    },
  ],
  processEyebrow: "UN RYTHME SIMPLE",
  processTitle: "Du fait terrain à la décision, sans ressaisie.",
  processDescription:
    "Le travail quotidien devient une information fiable, puis une action claire pour la bonne personne.",
  steps: [
    {
      title: "Organisez",
      description: "Structurez vos provinces, sites et équipes.",
    },
    {
      title: "Pilotez",
      description:
        "Les équipes saisissent leur travail, incidents et résultats au bon endroit.",
    },
    {
      title: "Décidez",
      description:
        "Les responsables voient les priorités, valident et agissent rapidement.",
    },
  ],
  footer:
    "Une plateforme opérationnelle sécurisée pour les organisations qui avancent.",
  opening: "Ouverture de votre espace",
  loginEyebrow: "ACCÈS ÉQUIPE",
  loginTitle: "Connectez-vous à votre espace de travail",
  loginDescription:
    "Employés, responsables et propriétaires accèdent ici à leurs tâches, horaires, documents et opérations.",
  loginEmail: "E-mail professionnel",
  loginPassword: "Mot de passe",
  loginHelp: "Votre accès est sécurisé et adapté à votre rôle.",
};

const english: LandingCopy = {
  nav: ["Features", "For teams", "Security"],
  signIn: "Sign in",
  contact: "Contact",
  eyebrow: "OPERATIONS, IN ONE VIEW",
  title: "Move your business forward with a clear view.",
  description:
    "LiteHubs connects field work, teams, projects and decisions so every leader knows what to do next.",
  primary: "Sign in to LiteHubs",
  secondary: "Explore the platform",
  proof: ["Role-based access", "Site-level data", "Real-time follow-up"],
  dashboard: "Operational view",
  today: "Today",
  onTrack: "Activity under control",
  ready: "Ready to act",
  metrics: [
    { label: "Open tasks", value: "12" },
    { label: "Team present", value: "36" },
    { label: "Budget tracked", value: "84%" },
  ],
  featureEyebrow: "ONE PLATFORM, NOT SILOS",
  featureTitle: "Business control, in the right place.",
  featureDescription:
    "Built for operations that cannot wait: agriculture, livestock, projects, people and finance.",
  features: [
    {
      title: "Field operations",
      description:
        "Plan, record and follow what is actually happening at every site.",
    },
    {
      title: "People & compliance",
      description:
        "Manage people, schedules, training, contracts and access without losing context.",
    },
    {
      title: "Projects & decisions",
      description:
        "Connect budgets, procurement, tasks, resources and documents in one control centre.",
    },
  ],
  processEyebrow: "A SIMPLE RHYTHM",
  processTitle: "From field fact to decision, without duplicate work.",
  processDescription:
    "Daily work becomes reliable information, then a clear action for the right person.",
  steps: [
    {
      title: "Organize",
      description: "Structure your provinces, sites and teams.",
    },
    {
      title: "Operate",
      description:
        "Teams record work, incidents and results where they belong.",
    },
    {
      title: "Decide",
      description: "Leaders see priorities, approve and act quickly.",
    },
  ],
  footer: "A secure operational platform for organizations that move forward.",
  opening: "Opening your workspace",
  loginEyebrow: "TEAM ACCESS",
  loginTitle: "Sign in to your workspace",
  loginDescription:
    "Employees, managers and owners access their tasks, schedules, documents and operations here.",
  loginEmail: "Work email",
  loginPassword: "Password",
  loginHelp: "Your access is secure and tailored to your role.",
};

const featureIcons = [ClipboardCheck, UsersRound, WalletCards] as const;

export function LandingPage() {
  const { locale, setLocale } = useLanguage();
  const text = locale === "fr" ? french : english;

  return (
    <main className="min-h-dvh overflow-x-hidden bg-page text-ink">
      <section className="relative isolate overflow-hidden border-b border-border">
        <div
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
          aria-hidden
        >
          <div className="absolute left-1/2 top-[-22rem] size-[48rem] -translate-x-1/2 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute right-[-10rem] top-52 size-[30rem] rounded-full bg-chart-3/10 blur-3xl" />
          <div className="absolute inset-x-0 bottom-0 h-44 bg-[linear-gradient(to_bottom,transparent,var(--page))]" />
        </div>

        <nav
          className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10"
          aria-label="Main navigation"
        >
          <Link
            href="/"
            className="flex items-center gap-3 rounded-md"
            aria-label="LiteHubs home"
          >
            <BrandMark size={34} className="rounded-lg shadow-sm" />
            <span className="text-lg font-semibold tracking-[-0.04em] text-ink">
              LiteHubs
            </span>
          </Link>
          <div className="hidden items-center gap-7 text-sm font-medium text-ink-secondary lg:flex">
            {text.nav.map((item, index) => (
              <a
                key={item}
                href={
                  index === 0
                    ? "#features"
                    : index === 1
                      ? "#teams"
                      : "#security"
                }
                className="transition-colors hover:text-ink"
              >
                {item}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div
              className="hidden rounded-md border border-border bg-surface-1 p-0.5 sm:flex"
              aria-label="Language"
            >
              {(["fr", "en"] as const).map((nextLocale) => (
                <button
                  key={nextLocale}
                  type="button"
                  onClick={() => setLocale(nextLocale)}
                  className={`rounded px-2 py-1 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors ${locale === nextLocale ? "bg-surface-3 text-ink" : "text-ink-muted hover:text-ink"}`}
                >
                  {nextLocale}
                </button>
              ))}
            </div>
            <Link
              href="/contact"
              className="hidden h-10 items-center rounded-md px-3 text-sm font-semibold text-ink-secondary transition hover:bg-surface-2 hover:text-ink sm:inline-flex"
            >
              {text.contact}
            </Link>
            <Link
              href="/staff"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-brand-ink shadow-sm transition-colors hover:bg-brand-hover sm:px-5"
            >
              {text.signIn}
              <LogIn className="size-4" aria-hidden />
            </Link>
          </div>
        </nav>

        <div className="mx-auto grid max-w-7xl gap-12 px-5 pb-16 pt-14 sm:px-8 sm:pb-24 sm:pt-20 lg:grid-cols-[1.02fr_.98fr] lg:items-center lg:gap-16 lg:px-10 lg:py-28">
          <div className="max-w-2xl">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-bold tracking-[0.13em] text-brand">
              <span className="size-1.5 rounded-full bg-brand" />
              {text.eyebrow}
            </p>
            <h1 className="max-w-xl text-4xl font-semibold leading-[1.05] tracking-[-0.06em] text-ink sm:text-5xl lg:text-[4.25rem]">
              {text.title}
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-ink-secondary sm:text-lg sm:leading-8">
              {text.description}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/staff"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-brand px-6 text-sm font-semibold text-brand-ink shadow-sm transition-colors hover:bg-brand-hover"
              >
                {text.primary}
                <LogIn className="size-4" aria-hidden />
              </Link>
              <a
                href="#features"
                className="inline-flex h-12 items-center justify-center rounded-md border border-border-strong bg-surface-1 px-6 text-sm font-semibold text-ink transition-colors hover:bg-surface-2"
              >
                {text.secondary}
              </a>
            </div>
            <ul
              className="mt-9 flex flex-wrap gap-x-5 gap-y-3"
              aria-label="LiteHubs benefits"
            >
              {text.proof.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-2 text-sm text-ink-secondary"
                >
                  <CheckCircle2 className="size-4 text-good" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <EmployeeLoginCard text={text} />
        </div>
      </section>

      <section
        id="features"
        className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10 lg:py-28"
      >
        <div className="max-w-2xl">
          <p className="text-xs font-bold tracking-[0.14em] text-brand">
            {text.featureEyebrow}
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-4xl">
            {text.featureTitle}
          </h2>
          <p className="mt-4 text-base leading-7 text-ink-secondary">
            {text.featureDescription}
          </p>
        </div>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {text.features.map((feature, index) => {
            const Icon = featureIcons[index] ?? BarChart3;
            return (
              <article
                key={feature.title}
                className="rounded-xl border border-border bg-surface-1 p-6 shadow-[0_1px_0_rgba(0,0,0,0.02)] transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lg"
              >
                <div className="grid size-11 place-items-center rounded-lg bg-brand/10 text-brand">
                  <Icon className="size-5" aria-hidden />
                </div>
                <h3 className="mt-6 text-lg font-semibold tracking-[-0.025em] text-ink">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-ink-secondary">
                  {feature.description}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="teams" className="border-y border-border bg-surface-2/70">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[.8fr_1.2fr] lg:items-center lg:px-10 lg:py-28">
          <div>
            <p className="text-xs font-bold tracking-[0.14em] text-brand">
              {text.processEyebrow}
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-4xl">
              {text.processTitle}
            </h2>
            <p className="mt-5 max-w-md text-base leading-7 text-ink-secondary">
              {text.processDescription}
            </p>
          </div>
          <ol className="grid gap-3 sm:grid-cols-3">
            {text.steps.map((step, index) => (
              <li
                key={step.title}
                className="rounded-xl border border-border bg-surface-1 p-5"
              >
                <span className="grid size-8 place-items-center rounded-full bg-brand text-sm font-bold text-brand-ink">
                  {index + 1}
                </span>
                <h3 className="mt-5 font-semibold text-ink">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-ink-secondary">
                  {step.description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        id="security"
        className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10 lg:py-28"
      >
        <div className="rounded-2xl border border-border bg-[linear-gradient(135deg,var(--surface-1),var(--surface-2))] p-7 shadow-sm sm:p-10 lg:p-14">
          <div className="max-w-2xl">
            <div className="grid size-11 place-items-center rounded-lg bg-brand/10 text-brand">
              <ShieldCheck className="size-5" aria-hidden />
            </div>
            <h2 className="mt-6 text-3xl font-semibold tracking-[-0.05em] text-ink sm:text-4xl">
              {text.nav[2]}
            </h2>
            <p className="mt-4 text-base leading-7 text-ink-secondary">
              {text.proof.join(" · ")}
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-ink-secondary sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <div className="flex items-center gap-2">
            <BrandMark size={22} />
            <span className="font-semibold text-ink">LiteHubs</span>
          </div>
          <p>{text.footer}</p>
        </div>
      </footer>
    </main>
  );
}

function EmployeeLoginCard({ text }: { text: LandingCopy }) {
  return (
    <aside className="relative mx-auto w-full max-w-xl">
      <div
        className="absolute -inset-5 -z-10 rounded-[2rem] bg-brand/10 blur-2xl"
        aria-hidden
      />
      <div className="overflow-hidden rounded-2xl border border-border-strong bg-surface-1 p-6 shadow-2xl shadow-brand/10 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand text-brand-ink shadow-sm">
            <KeyRound className="size-5" aria-hidden />
          </div>
          <div>
            <p className="text-xs font-bold tracking-[0.14em] text-brand">
              {text.loginEyebrow}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-ink">
              {text.loginTitle}
            </h2>
          </div>
        </div>
        <p className="mt-5 text-sm leading-6 text-ink-secondary">
          {text.loginDescription}
        </p>
        <div className="mt-7 grid gap-4" aria-hidden>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-ink-secondary">
              {text.loginEmail}
            </p>
            <div className="h-11 rounded-md border border-border bg-surface-2" />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-ink-secondary">
              {text.loginPassword}
            </p>
            <div className="h-11 rounded-md border border-border bg-surface-2" />
          </div>
        </div>
        <Link
          href="/staff"
          className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-brand px-6 text-sm font-semibold text-brand-ink shadow-sm transition-colors hover:bg-brand-hover"
        >
          {text.signIn}
          <LogIn className="size-4" aria-hidden />
        </Link>
        <p className="mt-4 text-center text-xs leading-5 text-ink-muted">
          {text.loginHelp}
        </p>
      </div>
    </aside>
  );
}
