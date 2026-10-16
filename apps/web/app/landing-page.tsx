"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bird,
  CheckCircle2,
  PiggyBank,
  KeyRound,
  LogIn,
  ShieldCheck,
  Sprout,
} from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { Reveal, SpotlightCard, Ticker } from "@/components/marketing/motion";
import { PublicMarketingAnalytics, trackMarketingEvent } from "@/components/analytics/public-marketing-analytics";
import { useLanguage } from "@/providers/language-provider";

type LandingCopy = {
  nav: readonly string[];
  signIn: string;
  contact: string;
  appointment: string;
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
  appointment: "Demander une démonstration",
  eyebrow: "LOGICIEL DE GESTION AGRICOLE",
  title: "LiteHubs, le logiciel de gestion de vos élevages et de vos fermes.",
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
  featureEyebrow: "LOGICIELS POUR EXPLOITATIONS AGRICOLES",
  featureTitle: "Pilotez l’aviculture, les porcs et l’agriculture depuis un seul logiciel.",
  featureDescription:
    "Suivez les lots, animaux, récoltes, alimentation, santé, équipes et décisions sans perdre la réalité du terrain.",
  features: [
    {
      title: "Gestion avicole",
      description:
        "Pilotez les lots, bâtiments, alimentation, mortalité, santé, œufs, performances et tâches quotidiennes.",
    },
    {
      title: "Gestion d’élevage porcin",
      description:
        "Suivez les enclos, groupes, reproduction, traitements, mouvements, poids et opérations porcines.",
    },
    {
      title: "Gestion agricole",
      description:
        "Organisez fermes, champs, cultures, intrants, travaux, observations, récoltes et ventes.",
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
  appointment: "Request a demo",
  eyebrow: "FARM MANAGEMENT SOFTWARE",
  title: "LiteHubs, the management software for your livestock and farms.",
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
  featureEyebrow: "SOFTWARE FOR FARM OPERATIONS",
  featureTitle: "Run poultry, pig and agriculture operations from one platform.",
  featureDescription:
    "Follow flocks, animals, crops, feed, health, teams and decisions without losing what is happening in the field.",
  features: [
    {
      title: "Poultry farm management",
      description:
        "Run flocks, houses, feed, mortality, health, eggs, performance and daily work.",
    },
    {
      title: "Pig farm management",
      description:
        "Follow pens, groups, breeding, treatments, movements, weights and pig operations.",
    },
    {
      title: "Agriculture management",
      description:
        "Organize farms, fields, crops, inputs, work, observations, harvests and sales.",
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

const featureIcons = [Bird, PiggyBank, Sprout] as const;

/** Product pages behind the three feature cards, in card order. */
const FEATURE_PAGES = ["gestion-avicole", "elevage-porcin", "gestion-agricole"];

/** Free Unsplash photos, served by Unsplash's CDN at the size we need. */
const photo = (id: string, width = 1200) =>
  `https://images.unsplash.com/photo-${id}?w=${width}&q=75&auto=format&fit=crop`;
const PHOTOS = {
  hero: "1741874299706-2b8e16839aaa",
  heroSide: "1569466593977-94ee7ed02ec9",
  features: ["1548550023-2bdb3c5beed7", "1580682777666-24a7b3024e24", "1723645013435-c3c8948faf59"],
  teams: "1791395183274-6391ccbd134e",
  field: "1761634373241-5abcfcaa0c39",
};

export function LandingPage() {
  const { locale } = useLanguage();
  const fr = locale === "fr";
  const text = fr ? french : english;

  useEffect(() => {
    trackMarketingEvent("view_item_list", {
      item_list_id: "farm_management_software",
      item_list_name: "poultry_pig_agriculture",
    });
  }, []);

  const teamPoints = fr
    ? ["Dossiers, rôles et accès par site", "Recrutement et Espace candidat", "Formations, présences et congés", "Paie et bulletins en PDF", "Messages par e-mail, SMS ou notification"]
    : ["Records, roles and site access", "Recruitment and candidate space", "Training, attendance and leave", "Payroll and PDF payslips", "Messages by e-mail, SMS or notification"];
  const securityPoints = fr
    ? [
        { title: "Accès par rôle", text: "Chaque personne ne voit que son site, ses équipes et ses tâches." },
        { title: "Données séparées", text: "Les données de chaque entreprise sont isolées dans la base." },
        { title: "Journal d’audit", text: "Connexions et actions importantes sont tracées." },
      ]
    : [
        { title: "Role-based access", text: "Everyone only sees their own site, teams and tasks." },
        { title: "Separated data", text: "Each company’s data is isolated in the database." },
        { title: "Audit log", text: "Sign-ins and important actions are recorded." },
      ];

  return (
    <div className="min-h-dvh overflow-x-hidden bg-page text-ink">
      <PublicMarketingAnalytics />
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className="relative isolate overflow-hidden pt-16">
          <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
            <div className="absolute left-[-10rem] top-[-12rem] size-[38rem] rounded-full bg-brand/12 blur-3xl" />
            <div className="absolute right-[-12rem] top-40 size-[34rem] rounded-full bg-chart-3/12 blur-3xl" />
            <div className="lh-grid-bg absolute inset-0" />
          </div>
          <div className="mx-auto grid max-w-7xl gap-12 px-5 pb-16 pt-12 sm:px-8 sm:pt-16 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-14 lg:px-10 lg:pb-24 lg:pt-20">
            <div className="max-w-2xl">
              <p className="lh-enter mb-5 inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-bold tracking-[0.13em] text-brand">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand/60" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-brand" />
                </span>
                {text.eyebrow}
              </p>
              <h1
                className="lh-enter text-4xl font-semibold leading-[1.06] tracking-[-0.055em] text-ink sm:text-5xl lg:text-[3.5rem]"
                style={{ animationDelay: "80ms" }}
              >
                {text.title}
              </h1>
              <p className="lh-enter mt-6 max-w-xl text-base leading-7 text-ink-secondary sm:text-lg sm:leading-8" style={{ animationDelay: "160ms" }}>
                {text.description}
              </p>
              <div className="lh-enter mt-8 flex flex-col gap-3 sm:flex-row" style={{ animationDelay: "240ms" }}>
                <Link
                  href="/contact?sujet=demo"
                  onClick={() => trackMarketingEvent("select_content", { content_type: "cta", item_id: "hero_demo" })}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-sm font-semibold text-brand-ink shadow-lg shadow-brand/20 transition hover:bg-brand-hover"
                >
                  {fr ? "Demander une démonstration" : "Book a demo"}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
                <a
                  href="/login"
                  onClick={() => trackMarketingEvent("select_content", { content_type: "cta", item_id: "hero_sign_in" })}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface-1 px-6 text-sm font-semibold text-ink transition hover:bg-surface-2"
                >
                  {text.primary}
                  <LogIn className="size-4" aria-hidden />
                </a>
              </div>
              <ul className="lh-enter mt-9 flex flex-wrap gap-x-5 gap-y-3" style={{ animationDelay: "320ms" }} aria-label="LiteHubs benefits">
                {text.proof.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-ink-secondary">
                    <CheckCircle2 className="size-4 text-good" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="lh-enter relative mx-auto w-full max-w-xl lg:max-w-none" style={{ animationDelay: "200ms" }}>
              <div className="grid grid-cols-[1.35fr_1fr] gap-3 sm:gap-4">
                <img
                  src={photo(PHOTOS.hero, 1100)}
                  alt={fr ? "Agriculteur dans son champ" : "Farmer in his field"}
                  className="h-72 w-full rounded-3xl bg-surface-2 object-cover shadow-2xl sm:h-[26rem]"
                  loading="eager"
                />
                <div className="grid gap-3 sm:gap-4">
                  <img
                    src={photo(PHOTOS.heroSide, 700)}
                    alt={fr ? "Poules dans un élevage" : "Hens on a farm"}
                    className="h-[8.6rem] w-full rounded-3xl bg-surface-2 object-cover shadow-xl sm:h-[12.6rem]"
                    loading="eager"
                  />
                  <div className="lh-bob flex flex-col justify-between rounded-3xl bg-[linear-gradient(145deg,#0b1220,#13305a)] p-4 text-white shadow-xl sm:p-5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] opacity-70">{text.today}</p>
                    <div>
                      <p className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">98,4 %</p>
                      <p className="mt-1 text-xs opacity-70">{fr ? "Taux de survie du lot" : "Flock survival rate"}</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="lh-bob absolute -bottom-5 left-4 hidden items-center gap-3 rounded-2xl border border-border bg-surface-1/95 px-4 py-3 shadow-xl backdrop-blur sm:left-8 sm:flex">
                <span className="grid size-9 place-items-center rounded-xl bg-good/15 text-good">
                  <CheckCircle2 className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">{text.onTrack}</p>
                  <p className="text-xs text-ink-secondary">
                    {text.metrics.map((metric) => `${metric.label} ${metric.value}`).slice(0, 2).join(" · ")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="border-y border-border bg-surface-2/40 py-5">
          <Ticker
            items={
              fr
                ? ["Lots et bâtiments", "Mortalité et santé", "Provenderie", "Ponte", "Truies et portées", "Cultures et récoltes", "Stocks et achats", "Ventes", "Employés et accès", "Recrutement", "Paie", "Messenger et Instagram", "Rapports par site"]
                : ["Flocks and houses", "Mortality and health", "Feed mill", "Egg laying", "Sows and litters", "Crops and harvests", "Stock and purchasing", "Sales", "Employees and access", "Recruitment", "Payroll", "Messenger and Instagram", "Reports by site"]
            }
          />
        </div>

        {/* Modules */}
        <section id="features" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10 lg:py-28">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-bold tracking-[0.14em] text-brand">{text.featureEyebrow}</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-4xl">{text.featureTitle}</h2>
            <p className="mt-4 text-base leading-7 text-ink-secondary">{text.featureDescription}</p>
          </Reveal>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {text.features.map((feature, index) => {
              const Icon = featureIcons[index] ?? Sprout;
              return (
                <Reveal key={feature.title} delay={index * 120}>
                <SpotlightCard
                  as={Link}
                  href={`/logiciel/${FEATURE_PAGES[index] ?? "gestion-agricole"}`}
                  className="group block h-full overflow-hidden rounded-2xl"
                >
                  <div className="relative h-52 overflow-hidden rounded-t-[15px]">
                    <div className="absolute inset-0 z-10 bg-[linear-gradient(to_top,rgba(11,18,32,.35),transparent_55%)]" aria-hidden />
                    <img
                      src={photo(PHOTOS.features[index] ?? PHOTOS.field, 800)}
                      alt={feature.title}
                      loading="lazy"
                      className="size-full bg-surface-2 object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <span className="absolute left-4 top-4 z-20 grid size-10 place-items-center rounded-xl bg-white/90 text-brand shadow-sm backdrop-blur">
                      <Icon className="size-5" aria-hidden />
                    </span>
                  </div>
                  <div className="p-6">
                    <h3 className="text-lg font-semibold tracking-[-0.025em] text-ink">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-ink-secondary">{feature.description}</p>
                    <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand">
                      {fr ? "En savoir plus" : "Learn more"}
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
                    </span>
                  </div>
                </SpotlightCard>
                </Reveal>
              );
            })}
          </div>
        </section>

        {/* Teams */}
        <section id="teams" className="border-y border-border bg-surface-2/60">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:items-center lg:px-10 lg:py-28">
            <Reveal className="relative">
            <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-[linear-gradient(135deg,var(--brand),var(--chart-3))] opacity-15 blur-2xl" aria-hidden />
            <img
              src={photo(PHOTOS.teams, 1000)}
              alt={fr ? "Deux personnes consultent un téléphone dans une ferme" : "Two people checking a phone on a farm"}
              loading="lazy"
              className="h-80 w-full rounded-3xl bg-surface-2 object-cover shadow-xl sm:h-[30rem]"
            />
            </Reveal>
            <Reveal delay={120}>
              <p className="text-xs font-bold tracking-[0.14em] text-brand">{fr ? "ÉQUIPES ET RH" : "TEAMS AND HR"}</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-4xl">
                {fr ? "Vos équipes, sur le terrain et au bureau, dans le même outil." : "Your field and office teams in the same tool."}
              </h2>
              <p className="mt-4 text-base leading-7 text-ink-secondary">
                {fr
                  ? "Les employés saisissent leur travail depuis leur téléphone. Les responsables gèrent les dossiers, les accès, le recrutement et la paie."
                  : "Employees record their work from their phone. Managers handle records, access, recruitment and payroll."}
              </p>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {teamPoints.map((point) => (
                  <li key={point} className="flex gap-2 text-sm leading-6 text-ink">
                    <CheckCircle2 className="mt-1 size-4 shrink-0 text-brand" aria-hidden />
                    {point}
                  </li>
                ))}
              </ul>
              <Link href="/logiciel/equipes-rh" className="mt-7 inline-flex items-center gap-1 text-sm font-semibold text-brand">
                {fr ? "Découvrir la gestion des équipes" : "Explore team management"}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Reveal>
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10 lg:py-28">
          <Reveal className="max-w-2xl">
            <p className="text-xs font-bold tracking-[0.14em] text-brand">{text.processEyebrow}</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-4xl">{text.processTitle}</h2>
            <p className="mt-4 text-base leading-7 text-ink-secondary">{text.processDescription}</p>
          </Reveal>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {text.steps.map((step, index) => (
              <Reveal as="li" key={step.title} delay={index * 120}>
                <SpotlightCard className="h-full rounded-2xl p-6">
                  <span className="bg-[linear-gradient(135deg,var(--brand),var(--chart-3))] bg-clip-text text-5xl font-semibold tracking-[-0.06em] text-transparent">
                    0{index + 1}
                  </span>
                  <h3 className="mt-3 text-lg font-semibold text-ink">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-ink-secondary">{step.description}</p>
                </SpotlightCard>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* Security + team access */}
        <section id="security" className="mx-auto max-w-7xl px-5 pb-20 sm:px-8 lg:px-10 lg:pb-28">
          <Reveal className="grid gap-8 rounded-3xl border border-border bg-[linear-gradient(135deg,var(--surface-1),var(--surface-2))] p-6 shadow-sm sm:p-10 lg:grid-cols-[1fr_.9fr] lg:items-center lg:p-14">
            <div>
              <div className="grid size-11 place-items-center rounded-xl bg-brand/10 text-brand">
                <ShieldCheck className="size-5" aria-hidden />
              </div>
              <h2 className="mt-6 text-3xl font-semibold tracking-[-0.05em] text-ink sm:text-4xl">
                {fr ? "Sécurisé par conception" : "Secure by design"}
              </h2>
              <div className="mt-6 grid gap-4">
                {securityPoints.map((point) => (
                  <div key={point.title} className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-good" aria-hidden />
                    <div>
                      <p className="font-semibold text-ink">{point.title}</p>
                      <p className="text-sm leading-6 text-ink-secondary">{point.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <EmployeeLoginCard text={text} />
          </Reveal>
        </section>

        {/* Call to action */}
        <section className="relative isolate overflow-hidden">
          <img
            src={photo(PHOTOS.field, 1800)}
            alt=""
            loading="lazy"
            className="absolute inset-0 -z-20 size-full object-cover"
          />
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(110deg,rgba(11,18,32,.92),rgba(11,18,32,.65))]" aria-hidden />
          <Reveal className="mx-auto max-w-7xl px-5 py-20 text-white sm:px-8 lg:px-10 lg:py-28">
            <h2 className="max-w-2xl text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
              {fr ? "Prêt à piloter votre exploitation avec des chiffres fiables ?" : "Ready to run your operation on reliable numbers?"}
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-white/80">
              {fr
                ? "Présentez-nous votre activité : nous vous montrons LiteHubs avec vos propres sites et équipes."
                : "Tell us about your operation: we will show you LiteHubs with your own sites and teams."}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/contact?sujet=demo"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 text-sm font-semibold text-[#0b1220] transition hover:bg-white/90"
              >
                {text.appointment}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link
                href="/contact"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-white/30 px-6 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                {text.contact}
              </Link>
            </div>
          </Reveal>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function EmployeeLoginCard({ text }: { text: LandingCopy }) {
  return (
    <aside id="acces" className="relative mx-auto w-full max-w-xl">
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
        <a
          href="/login"
          onClick={() => trackMarketingEvent("select_content", { content_type: "cta", item_id: "team_sign_in" })}
          className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-brand px-6 text-sm font-semibold text-brand-ink shadow-sm transition-colors hover:bg-brand-hover"
        >
          {text.signIn}
          <LogIn className="size-4" aria-hidden />
        </a>
        <p className="mt-4 text-center text-xs leading-5 text-ink-muted">
          {text.loginHelp}
        </p>
      </div>
    </aside>
  );
}
