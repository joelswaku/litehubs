"use client";

import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  ChevronDown,
  Globe2,
  Languages,
  Mail,
  MapPin,
  Menu,
  Phone,
  Send,
  Sparkles,
  Sprout,
  X,
} from "lucide-react";
import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { ApiError, post } from "@/lib/api";

export type WebsiteSection = {
  id: string;
  section_type:
    | "hero"
    | "rich_text"
    | "feature_grid"
    | "metrics"
    | "image_callout"
    | "gallery"
    | "faq"
    | "cta"
    | "careers"
    | "contact";
  content: Record<string, unknown>;
  sort_order: number;
};

export type PublicWebsite = {
  organization_slug: string;
  /** Optional public organisation powering shared portals such as Careers.
   * A branded website can be restored before its operational workspace. */
  portal_organization_slug?: string;
  display_name: string;
  tagline: string | null;
  default_locale: "fr" | "en";
  theme_preset: string;
  primary_color: string;
  accent_color: string;
  logo_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  footer_text: string | null;
  navigation: Array<{ slug: string; label_fr: string; label_en: string }>;
};

export type PublicWebsitePage = {
  slug: string;
  title_fr: string;
  title_en: string;
  description_fr: string | null;
  description_en: string | null;
  sections: WebsiteSection[];
};

type Language = "fr" | "en";
type Content = Record<string, unknown>;

const copy = {
  fr: {
    menu: "Menu",
    close: "Fermer",
    contact: "Nous contacter",
    careers: "Voir les postes ouverts",
    discover: "Découvrir",
    address: "Adresse",
    phone: "Téléphone",
    email: "E-mail",
    allRights: "Tous droits réservés.",
    learnMore: "En savoir plus",
  },
  en: {
    menu: "Menu",
    close: "Close",
    contact: "Contact us",
    careers: "See open positions",
    discover: "Discover",
    address: "Address",
    phone: "Phone",
    email: "Email",
    allRights: "All rights reserved.",
    learnMore: "Learn more",
  },
} as const;

function careersHref(website: PublicWebsite): string {
  return `/careers/${website.portal_organization_slug ?? website.organization_slug}`;
}

/** A finished public landing remains visible for organisations that were
 * created with the original empty website shells. As soon as the owner adds
 * one image in the builder, their own sections take over completely. */
const congoOmegaLandingSections: WebsiteSection[] = [
  {
    id: "congo-omega-landing-hero",
    section_type: "hero",
    sort_order: 0,
    content: {
      kickerFr: "CONGO OMEGA · DEPUIS LE TERRAIN",
      kickerEn: "CONGO OMEGA · FROM THE GROUND UP",
      titleFr: "Nourrir demain, ici même.",
      titleEn: "Nourishing tomorrow, right here.",
      bodyFr:
        "Congo Omega développe une agriculture, un élevage et des équipes capables de produire localement avec rigueur, respect et ambition.",
      bodyEn:
        "Congo Omega develops agriculture, livestock and teams able to produce locally with rigor, care and ambition.",
      primaryLabelFr: "Découvrir Congo Omega",
      primaryLabelEn: "Discover Congo Omega",
      primaryHref: "/notre-entreprise",
      secondaryLabelFr: "Voir nos activités",
      secondaryLabelEn: "Explore our work",
      secondaryHref: "/activites",
      imageUrl: "/website/congo-omega-hero.png",
      secondaryImageUrl: "/website/congo-omega-market.png",
      tertiaryImageUrl: "/website/congo-omega-team.png",
    },
  },
  {
    id: "congo-omega-landing-activities",
    section_type: "feature_grid",
    sort_order: 1,
    content: {
      kickerFr: "CE QUE NOUS FAISONS",
      kickerEn: "WHAT WE DO",
      titleFr: "Une même chaîne, du sol jusqu’aux familles.",
      titleEn: "One chain, from soil to families.",
      bodyFr:
        "Nous relions les ressources, les savoir-faire et la production pour bâtir une offre locale fiable.",
      bodyEn:
        "We connect resources, expertise and production to build a reliable local supply.",
      items: [
        {
          titleFr: "Cultiver",
          titleEn: "Cultivate",
          bodyFr:
            "Des champs et des récoltes pensés avec le rythme des saisons et des besoins réels.",
          bodyEn: "Fields and harvests planned around seasons and real needs.",
        },
        {
          titleFr: "Élever",
          titleEn: "Raise",
          bodyFr:
            "Des élevages suivis chaque jour avec exigence, santé et respect du vivant.",
          bodyEn:
            "Livestock followed every day with rigor, health and care for life.",
        },
        {
          titleFr: "Transformer",
          titleEn: "Transform",
          bodyFr:
            "Des intrants maîtrisés pour créer une alimentation traçable et utile.",
          bodyEn: "Controlled inputs to create traceable, useful feed.",
        },
      ],
    },
  },
  {
    id: "congo-omega-landing-method",
    section_type: "metrics",
    sort_order: 2,
    content: {
      kickerFr: "NOTRE MÉTHODE",
      kickerEn: "OUR APPROACH",
      titleFr: "Faire simple. Faire juste. Mesurer l’impact.",
      titleEn: "Keep it simple. Do it right. Measure the impact.",
      bodyFr:
        "Notre travail avance avec des objectifs clairs, des équipes responsables et des résultats visibles.",
      bodyEn:
        "Our work advances through clear goals, accountable teams and visible outcomes.",
      items: [
        { value: "01", labelFr: "Vision locale", labelEn: "Local vision" },
        { value: "02", labelFr: "Équipes formées", labelEn: "Trained teams" },
        {
          value: "03",
          labelFr: "Ressources suivies",
          labelEn: "Tracked resources",
        },
        { value: "04", labelFr: "Impact durable", labelEn: "Lasting impact" },
      ],
    },
  },
  {
    id: "congo-omega-landing-commitment",
    section_type: "image_callout",
    sort_order: 3,
    content: {
      kickerFr: "NOTRE ENGAGEMENT",
      kickerEn: "OUR COMMITMENT",
      titleFr: "Produire près de chez vous. Grandir avec vous.",
      titleEn: "Produce close to you. Grow with you.",
      bodyFr:
        "Des équipes responsables, des ressources maîtrisées et une valeur qui reste dans les communautés.",
      bodyEn:
        "Accountable teams, controlled resources and value that remains in communities.",
      buttonLabelFr: "Explorer nos activités",
      buttonLabelEn: "Explore our work",
      buttonHref: "/activites",
      imageUrl: "/website/congo-omega-operations.png",
    },
  },
  {
    id: "congo-omega-landing-gallery",
    section_type: "gallery",
    sort_order: 4,
    content: {
      kickerFr: "NOS VISAGES, NOS LIEUX",
      kickerEn: "OUR PEOPLE, OUR PLACES",
      titleFr: "Une ambition qui se voit sur le terrain.",
      titleEn: "An ambition you can see on the ground.",
      bodyFr:
        "Découvrez les lieux, les équipes et les gestes qui donnent vie à Congo Omega.",
      bodyEn:
        "Discover the places, teams and actions that bring Congo Omega to life.",
      items: [
        {
          imageUrl: "/website/congo-omega-hero.png",
          captionFr: "Une production proche du terrain",
          captionEn: "Production close to the ground",
        },
        {
          imageUrl: "/website/congo-omega-market.png",
          captionFr: "Une valeur locale qui circule",
          captionEn: "Local value in motion",
        },
        {
          imageUrl: "/website/congo-omega-team.png",
          captionFr: "Des équipes qui avancent ensemble",
          captionEn: "Teams moving forward together",
        },
        {
          imageUrl: "/website/congo-omega-impact.png",
          captionFr: "Un impact construit dans la durée",
          captionEn: "Impact built to last",
        },
      ],
    },
  },
  {
    id: "congo-omega-landing-cta",
    section_type: "cta",
    sort_order: 5,
    content: {
      kickerFr: "ÉCRIVONS LA SUITE",
      kickerEn: "LET’S WRITE THE NEXT CHAPTER",
      titleFr: "Une idée, un besoin, une collaboration ?",
      titleEn: "An idea, a need, a collaboration?",
      bodyFr:
        "Échangeons sur ce que nous pouvons construire ensemble pour une agriculture locale plus forte.",
      bodyEn:
        "Let’s talk about what we can build together for stronger local agriculture.",
      buttonLabelFr: "Parlons-en",
      buttonLabelEn: "Let’s talk",
      buttonHref: "/contact",
    },
  },
  {
    id: "congo-omega-landing-contact",
    section_type: "contact",
    sort_order: 6,
    content: {
      kickerFr: "CONTACT",
      kickerEn: "CONTACT",
      titleFr: "Parlons de votre besoin.",
      titleEn: "Let’s discuss your needs.",
      bodyFr:
        "Choisissez le canal le plus simple : rendez-vous, téléphone ou e-mail.",
      bodyEn: "Choose the easiest channel: an appointment, phone or email.",
      buttonLabelFr: "Prendre rendez-vous",
      buttonLabelEn: "Book an appointment",
      buttonHref: "/rendezvous",
    },
  },
];

function text(content: Content, key: string, fallback = ""): string {
  const camelKey = key.replace(/_([a-z])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  );
  const aliases: Record<string, string> = {
    image: "imageUrl",
    href: "buttonHref",
    eyebrow_fr: "kickerFr",
    eyebrow_en: "kickerEn",
    label_fr: "buttonLabelFr",
    label_en: "buttonLabelEn",
    secondary_image: "secondaryImageUrl",
    tertiary_image: "tertiaryImageUrl",
  };
  const value =
    content[key] ?? content[camelKey] ?? content[aliases[key] ?? ""];
  return typeof value === "string" ? value : fallback;
}

function list(content: Content, key: string): Content[] {
  const value = content[key];
  return Array.isArray(value)
    ? value.filter(
        (item): item is Content => !!item && typeof item === "object",
      )
    : [];
}

function safeHref(value: string | undefined): string | null {
  const href = value?.trim();
  if (!href) return null;
  if (
    href.startsWith("/") ||
    href.startsWith("#") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:")
  )
    return href;
  try {
    const url = new URL(href);
    return url.protocol === "https:" ? href : null;
  } catch {
    return null;
  }
}

function safeImage(value: string | undefined): string | null {
  const source = value?.trim();
  if (!source) return null;
  if (source.startsWith("/") && !source.startsWith("//")) return source;
  try {
    return new URL(source).protocol === "https:" ? source : null;
  } catch {
    return null;
  }
}

function Action({
  label,
  href,
  secondary = false,
}: {
  label: string;
  href?: string;
  secondary?: boolean;
}) {
  const safe = safeHref(href);
  if (!label || !safe) return null;
  const classes = secondary
    ? "border border-white/50 bg-white/10 text-white hover:bg-white/20"
    : "border border-slate-200 bg-white text-slate-900 shadow-[0_16px_30px_-18px_rgba(15,23,42,.7)] hover:bg-amber-50";
  if (safe.startsWith("/")) {
    return (
      <Link
        href={safe}
        className={`inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors ${classes}`}
      >
        {label}
        <ArrowRight className="size-4" />
      </Link>
    );
  }
  return (
    <a
      href={safe}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors ${classes}`}
    >
      {label}
      <ArrowRight className="size-4" />
    </a>
  );
}

function PublicSection({
  section,
  language,
  website,
  pageLink,
  contactDomain,
}: {
  section: WebsiteSection;
  language: Language;
  website: PublicWebsite;
  pageLink: (slug: string) => string;
  contactDomain?: string;
}) {
  const c = section.content;
  const t = copy[language];
  const reduceMotion = useReducedMotion();
  const source = safeImage(text(c, "image"));
  const secondarySource = safeImage(text(c, "secondary_image"));
  const tertiarySource = safeImage(text(c, "tertiary_image"));
  const heading = text(
    c,
    language === "fr" ? "title_fr" : "title_en",
    text(c, "title"),
  );
  const body = text(
    c,
    language === "fr" ? "body_fr" : "body_en",
    text(c, "body"),
  );
  const eyebrow = text(
    c,
    language === "fr" ? "eyebrow_fr" : "eyebrow_en",
    text(c, "eyebrow"),
  );
  // The editor stores friendly paths such as /contact. In the LiteHubs preview
  // they must stay inside this company website rather than open product pages.
  const websiteHref = (value: string) => {
    const match = value.match(
      /^\/(notre-entreprise|activites|projets|impact|carrieres|contact)$/,
    );
    return match ? pageLink(match[1]!) : value;
  };

  switch (section.section_type) {
    case "hero":
      return (
        <section className="mx-auto max-w-[1500px] px-3 pt-3 sm:px-6 sm:pt-6 lg:px-8">
          <div className="relative isolate min-h-[590px] overflow-hidden rounded-[2rem] bg-slate-950 text-white shadow-[0_36px_80px_-46px_rgba(15,23,42,.88)] sm:min-h-[650px] sm:rounded-[2.5rem]">
            {source ? (
              <img
                src={source}
                alt=""
                className="absolute inset-0 -z-30 size-full object-cover"
              />
            ) : null}
            <div className="absolute inset-0 -z-20 bg-gradient-to-r from-slate-950/[.94] via-slate-950/[.66] to-slate-950/[.14]" />
            <div className="absolute -right-24 top-0 -z-10 size-[28rem] rounded-full border border-white/10" />
            <div className="absolute -right-10 top-12 -z-10 size-[19rem] rounded-full border border-white/15" />
            <div className="grid min-h-[590px] items-end gap-8 p-7 pb-9 sm:min-h-[650px] sm:p-12 sm:pb-12 lg:grid-cols-[minmax(0,1fr)_270px] lg:p-16 lg:pb-14">
              <motion.div
                className="max-w-3xl"
                initial={reduceMotion ? false : { opacity: 0, y: 22 }}
                animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                transition={{ duration: 0.68, ease: [0.22, 1, 0.36, 1] }}
              >
                {eyebrow ? (
                  <p className="mb-5 inline-flex rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[.17em] text-amber-50 backdrop-blur">
                    {eyebrow}
                  </p>
                ) : null}
                <h1 className="text-4xl font-semibold leading-[.98] tracking-[-.055em] sm:text-6xl lg:text-7xl">
                  {heading || website.display_name}
                </h1>
                {body ? (
                  <p className="mt-6 max-w-2xl text-base leading-7 text-white/78 sm:text-lg sm:leading-8">
                    {body}
                  </p>
                ) : website.tagline ? (
                  <p className="mt-6 max-w-2xl text-base leading-7 text-white/78 sm:text-lg sm:leading-8">
                    {website.tagline}
                  </p>
                ) : null}
                <div className="mt-8 flex flex-wrap gap-3">
                  <Action
                    label={text(
                      c,
                      language === "fr"
                        ? "primary_label_fr"
                        : "primary_label_en",
                      t.discover,
                    )}
                    href={websiteHref(text(c, "primary_href", "#contact"))}
                  />
                  <Action
                    label={text(
                      c,
                      language === "fr"
                        ? "secondary_label_fr"
                        : "secondary_label_en",
                    )}
                    href={websiteHref(text(c, "secondary_href"))}
                    secondary
                  />
                </div>
                <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3 text-xs font-medium text-white/78">
                  <span className="inline-flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-emerald-300/15 text-emerald-100">
                      <Sprout className="size-3" />
                    </span>
                    {language === "fr"
                      ? "Production locale"
                      : "Local production"}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-amber-300" />
                    {language === "fr" ? "Équipes engagées" : "Committed teams"}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-sky-300" />
                    {language === "fr" ? "Impact suivi" : "Tracked impact"}
                  </span>
                </div>
              </motion.div>
              <motion.div
                className="relative hidden min-h-[280px] lg:block"
                initial={
                  reduceMotion ? false : { opacity: 0, scale: 0.94, y: 18 }
                }
                animate={
                  reduceMotion ? undefined : { opacity: 1, scale: 1, y: 0 }
                }
                transition={{
                  duration: 0.8,
                  delay: 0.12,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                {secondarySource || tertiarySource ? (
                  <>
                    <div className="absolute inset-x-5 top-0 overflow-hidden rounded-3xl border border-white/20 bg-slate-800 shadow-2xl">
                      <img
                        src={secondarySource ?? source ?? ""}
                        alt=""
                        className="aspect-[5/4] w-full object-cover"
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/70 to-transparent px-4 pb-4 pt-12">
                        <p className="text-xs font-semibold text-white">
                          {language === "fr"
                            ? "Au cœur de l’action"
                            : "At the heart of action"}
                        </p>
                      </div>
                    </div>
                    <div className="absolute -bottom-2 -left-1 w-36 overflow-hidden rounded-2xl border-4 border-slate-950 shadow-xl">
                      <img
                        src={tertiarySource ?? source ?? ""}
                        alt=""
                        className="aspect-square w-full object-cover"
                      />
                    </div>
                    <div className="absolute -bottom-2 -right-2 rounded-2xl border border-white/20 bg-slate-950/85 px-4 py-3 shadow-xl backdrop-blur">
                      <p className="text-[10px] font-bold uppercase tracking-[.14em] text-amber-200">
                        {language === "fr" ? "Impact" : "Impact"}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-white">
                        {language === "fr"
                          ? "Local & durable"
                          : "Local & lasting"}
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="absolute bottom-0 left-0 right-0 rounded-3xl border border-white/15 bg-white/[.10] p-5 backdrop-blur-xl">
                    <Sparkles className="size-5 text-amber-200" />
                    <p className="mt-5 text-sm font-semibold leading-6 text-white">
                      {language === "fr"
                        ? "Une vision locale, un impact durable."
                        : "Local vision, lasting impact."}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-white/64">
                      {text(
                        c,
                        language === "fr" ? "highlight_fr" : "highlight_en",
                        website.tagline ?? "",
                      )}
                    </p>
                  </div>
                )}
              </motion.div>
            </div>
          </div>
        </section>
      );
    case "rich_text":
      return (
        <section className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-28">
          <SectionHeading
            eyebrow={eyebrow}
            title={heading}
            body={body}
            centered
          />
        </section>
      );
    case "feature_grid": {
      const cards = list(c, "items");
      return (
        <section className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8 sm:py-16">
          <div className="rounded-[2rem] bg-[#f1f7f1] px-5 py-12 sm:px-10 sm:py-16 lg:px-14">
            <SectionHeading eyebrow={eyebrow} title={heading} body={body} />{" "}
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((item, index) => (
                <article
                  className="group rounded-3xl border border-white/80 bg-white p-6 shadow-[0_18px_45px_-34px_rgba(15,23,42,.65)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_25px_48px_-30px_rgba(15,23,42,.42)]"
                  key={`${text(item, "title")}-${index}`}
                >
                  <div className="mb-7 flex items-start justify-between">
                    <div
                      className="flex size-11 items-center justify-center rounded-2xl bg-emerald-50 text-sm font-bold"
                      style={{ color: "var(--website-primary)" }}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <span className="text-[11px] font-bold tracking-[.15em] text-emerald-900/30">
                      {language === "fr" ? "IMPACT" : "IMPACT"}
                    </span>
                  </div>
                  <h3 className="text-xl font-semibold tracking-[-.025em] text-slate-950">
                    {text(
                      item,
                      language === "fr" ? "title_fr" : "title_en",
                      text(item, "title"),
                    )}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {text(
                      item,
                      language === "fr" ? "body_fr" : "body_en",
                      text(item, "body"),
                    )}
                  </p>
                  <span
                    className="mt-6 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[.13em]"
                    style={{ color: "var(--website-primary)" }}
                  >
                    {language === "fr" ? "Découvrir" : "Explore"}
                    <ArrowRight className="size-3.5 transition group-hover:translate-x-1" />
                  </span>
                </article>
              ))}
            </div>
          </div>
        </section>
      );
    }
    case "metrics":
      return (
        <section className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8 sm:py-16">
          <div
            className="overflow-hidden rounded-[2rem] px-5 py-12 text-white sm:px-10 sm:py-16 lg:px-14"
            style={{ backgroundColor: "var(--website-primary)" }}
          >
            <SectionHeading
              eyebrow={eyebrow}
              title={heading}
              body={body}
              inverted
            />
            <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-white/15 bg-white/15 sm:grid-cols-2 lg:grid-cols-4">
              {list(c, "items").map((item, index) => (
                <div
                  className="bg-[color-mix(in_srgb,var(--website-primary)_88%,#001b18)] p-6 sm:p-7"
                  key={`${text(item, "label")}-${index}`}
                >
                  <p className="text-4xl font-semibold tracking-[-.05em] text-amber-100">
                    {text(item, "value")}
                  </p>
                  <p className="mt-2 text-sm leading-5 text-white/75">
                    {text(
                      item,
                      language === "fr" ? "label_fr" : "label_en",
                      text(item, "label"),
                    )}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    case "image_callout":
      return (
        <section className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8 sm:py-16">
          <div className="grid overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_24px_55px_-46px_rgba(15,23,42,.6)] lg:grid-cols-[1.02fr_.98fr]">
            <div className="relative min-h-[300px] bg-slate-200 lg:min-h-[480px]">
              {source ? (
                <img
                  src={source}
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-tr from-emerald-950/25 via-transparent to-amber-300/15" />
            </div>
            <div className="flex items-center p-7 sm:p-12 lg:p-16">
              <div>
                <SectionHeading eyebrow={eyebrow} title={heading} body={body} />
                <div className="mt-8">
                  <Action
                    label={text(
                      c,
                      language === "fr" ? "label_fr" : "label_en",
                      t.learnMore,
                    )}
                    href={websiteHref(text(c, "href"))}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      );
    case "gallery":
      return (
        <section className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8 sm:py-16">
          <SectionHeading eyebrow={eyebrow} title={heading} body={body} />
          <div className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-4">
            {list(c, "items").map((item, index) => {
              const image = safeImage(text(item, "image"));
              return (
                <figure
                  className={`group relative overflow-hidden rounded-3xl bg-slate-200 ${index === 0 ? "col-span-2 row-span-2" : ""}`}
                  key={`${text(item, "caption")}-${index}`}
                >
                  {image ? (
                    <img
                      src={image}
                      alt={text(item, "caption")}
                      className="aspect-square size-full object-cover transition duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="aspect-square" />
                  )}
                  {text(item, "caption") ? (
                    <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/75 to-transparent px-4 pb-4 pt-12 text-sm font-medium text-white">
                      {text(item, "caption")}
                    </figcaption>
                  ) : null}
                </figure>
              );
            })}
          </div>
        </section>
      );
    case "faq":
      return (
        <section className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-24">
          <SectionHeading
            eyebrow={eyebrow}
            title={heading}
            body={body}
            centered
          />{" "}
          <div className="mt-10 divide-y divide-slate-200 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_45px_-38px_rgba(15,23,42,.45)]">
            {list(c, "items").map((item, index) => (
              <details
                className="group p-5 sm:p-7"
                key={`${text(item, "question")}-${index}`}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-5 font-semibold text-slate-900">
                  {text(
                    item,
                    language === "fr" ? "question_fr" : "question_en",
                    text(item, "question"),
                  )}
                  <ChevronDown className="size-5 shrink-0 text-emerald-700 transition group-open:rotate-180" />
                </summary>
                <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600">
                  {text(
                    item,
                    language === "fr" ? "answer_fr" : "answer_en",
                    text(item, "answer"),
                  )}
                </p>
              </details>
            ))}
          </div>
        </section>
      );
    case "cta":
      return (
        <section className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8 sm:py-16">
          <div className="relative overflow-hidden rounded-[2rem] bg-slate-950 px-7 py-12 text-white shadow-[0_28px_56px_-42px_rgba(15,23,42,.8)] sm:px-12 sm:py-16">
            <div className="absolute -right-24 -top-40 size-[32rem] rounded-full bg-[var(--website-accent)] opacity-20 blur-3xl" />
            <div className="absolute -bottom-36 left-1/2 size-[24rem] rounded-full border border-white/10" />
            <div className="relative max-w-3xl">
              <SectionHeading
                eyebrow={eyebrow}
                title={heading}
                body={body}
                inverted
              />
              <div className="mt-8">
                <Action
                  label={text(
                    c,
                    language === "fr" ? "label_fr" : "label_en",
                    t.contact,
                  )}
                  href={websiteHref(text(c, "href", "#contact"))}
                />
              </div>
            </div>
          </div>
        </section>
      );
    case "careers":
      return (
        <section className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8 sm:py-16">
          <div className="grid gap-8 rounded-[2rem] bg-[#fff8e7] px-6 py-12 sm:px-12 sm:py-16 lg:grid-cols-[1fr_auto] lg:items-end">
            <SectionHeading eyebrow={eyebrow} title={heading} body={body} />
            <div className="rounded-3xl border border-amber-200/80 bg-white p-6 shadow-[0_18px_42px_-34px_rgba(120,53,15,.45)]">
              <Sparkles className="size-6 text-amber-700" />
              <p className="mt-5 max-w-[250px] text-sm leading-6 text-slate-600">
                {language === "fr"
                  ? "Des opportunités sérieuses pour les personnes prêtes à agir sur le terrain."
                  : "Meaningful opportunities for people ready to make an impact on the ground."}
              </p>
              <Link
                href={careersHref(website)}
                className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-amber-800 hover:text-amber-950"
              >
                {text(
                  c,
                  language === "fr" ? "label_fr" : "label_en",
                  t.careers,
                )}
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </section>
      );
    case "contact":
      return (
        <section
          id="contact"
          className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8 sm:py-16"
        >
          <div className="rounded-[2rem] bg-slate-950 px-6 py-12 text-white sm:px-12 sm:py-16">
            <div className="grid gap-10 lg:grid-cols-[.92fr_1.08fr]">
              <div>
                <SectionHeading
                  eyebrow={eyebrow}
                  title={heading || t.contact}
                  body={body || website.tagline || ""}
                  inverted
                />
                <p className="mt-8 text-sm font-medium text-amber-100">
                  {language === "fr"
                    ? "Une équipe vous répond dans le bon contexte."
                    : "A team will respond in the right context."}
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <Action
                    label={text(
                      c,
                      language === "fr" ? "label_fr" : "label_en",
                      language === "fr"
                        ? "Prendre rendez-vous"
                        : "Book an appointment",
                    )}
                    href={websiteHref(text(c, "href", "/rendezvous"))}
                  />
                  {website.contact_email ? (
                    <a
                      href={`mailto:${website.contact_email}`}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/25 bg-white/10 px-5 text-sm font-semibold text-white transition hover:bg-white/18"
                    >
                      <Mail className="size-4" />
                      {language === "fr" ? "Écrire un e-mail" : "Send an email"}
                    </a>
                  ) : null}
                </div>
              </div>
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  {website.contact_email ? (
                    <ContactItem
                      icon={Mail}
                      label={t.email}
                      value={website.contact_email}
                      href={`mailto:${website.contact_email}`}
                    />
                  ) : null}
                  {website.contact_phone ? (
                    <ContactItem
                      icon={Phone}
                      label={t.phone}
                      value={website.contact_phone}
                      href={`tel:${website.contact_phone}`}
                    />
                  ) : null}
                  {website.address ? (
                    <ContactItem
                      icon={MapPin}
                      label={t.address}
                      value={website.address}
                    />
                  ) : null}
                </div>
                {website.contact_email ? (
                  <PublicContactForm
                    contactEmail={website.contact_email}
                    language={language}
                    domain={contactDomain}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </section>
      );
    default:
      return null;
  }
}

function SectionHeading({
  eyebrow,
  title,
  body,
  centered = false,
  inverted = false,
}: {
  eyebrow?: string;
  title?: string;
  body?: string;
  centered?: boolean;
  inverted?: boolean;
}) {
  return (
    <div className={centered ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      {eyebrow ? (
        <p
          className={`mb-3 text-xs font-bold uppercase tracking-[.18em] ${inverted ? "text-amber-100/70" : "text-emerald-700"}`}
        >
          {eyebrow}
        </p>
      ) : null}
      {title ? (
        <h2
          className={`text-3xl font-semibold leading-[1.08] tracking-[-.035em] sm:text-4xl lg:text-[2.7rem] ${inverted ? "text-white" : "text-slate-950"}`}
        >
          {title}
        </h2>
      ) : null}
      {body ? (
        <p
          className={`mt-5 text-base leading-7 sm:text-[1.05rem] ${inverted ? "text-white/75" : "text-slate-600"}`}
        >
          {body}
        </p>
      ) : null}
    </div>
  );
}

function ContactItem({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Mail;
  label: string;
  value: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
        <Icon className="size-4 text-amber-100" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-[.13em] text-white/55">
          {label}
        </span>
        <span className="mt-1 block break-words text-sm text-white">
          {value}
        </span>
      </span>
    </>
  );
  return href ? (
    <a
      className="flex min-h-20 items-center gap-3 rounded-2xl border border-white/10 bg-white/[.055] p-4 transition hover:bg-white/10"
      href={href}
    >
      {body}
    </a>
  ) : (
    <div className="flex min-h-20 items-center gap-3 rounded-2xl border border-white/10 bg-white/[.055] p-4">
      {body}
    </div>
  );
}

/** A visitor controls the final delivery: submitting prepares a complete
 * email to the public mailbox in their own chosen email application. This
 * keeps messages off private LiteHubs records until the visitor sends it. */
function PublicContactForm({
  contactEmail,
  language,
  domain,
}: {
  contactEmail: string;
  language: Language;
  /** Present only on a verified public custom domain. */
  domain?: string;
}) {
  const [state, setState] = React.useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [error, setError] = React.useState("");
  const french = language === "fr";

  function contactValidationMessage(requestError: unknown): string {
    if (requestError instanceof ApiError && requestError.code === "VALIDATION_ERROR") {
      const field = Object.keys(requestError.fieldErrors)[0];
      const messages: Record<string, { fr: string; en: string }> = {
        fullName: {
          fr: "Saisissez votre nom complet (au moins 2 caractères).",
          en: "Enter your full name (at least 2 characters).",
        },
        email: {
          fr: "Saisissez une adresse e-mail valide.",
          en: "Enter a valid email address.",
        },
        phone: {
          fr: "Vérifiez le numéro de téléphone saisi.",
          en: "Check the phone number entered.",
        },
        subject: {
          fr: "Saisissez un objet d’au moins 3 caractères.",
          en: "Enter a subject of at least 3 characters.",
        },
        message: {
          fr: "Votre message doit contenir au moins 5 caractères.",
          en: "Your message must contain at least 5 characters.",
        },
      };
      if (field && messages[field]) return messages[field][french ? "fr" : "en"];
    }
    return requestError instanceof Error
      ? requestError.message
      : french
        ? "Le message n’a pas pu être envoyé. Réessayez dans un instant."
        : "Your message could not be sent. Please try again shortly.";
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    const name = String(values.get("name") ?? "").trim();
    const email = String(values.get("email") ?? "").trim();
    const phone = String(values.get("phone") ?? "").trim();
    const subject = String(values.get("subject") ?? "").trim();
    const message = String(values.get("message") ?? "").trim();
    if (domain) {
      setState("sending");
      setError("");
      try {
        await post(`/public/websites/domains/${encodeURIComponent(domain)}/contact`, {
          fullName: name,
          email,
          phone: phone || null,
          subject,
          message,
          website: "",
        });
        form.reset();
        setState("sent");
      } catch (requestError) {
        setState("error");
        setError(contactValidationMessage(requestError));
      }
      return;
    }
    const body = [
      french ? "Message envoyé depuis le site Congo Omega" : "Message sent from the Congo Omega website",
      "",
      `${french ? "Nom" : "Name"} : ${name}`,
      email ? `${french ? "E-mail" : "Email"} : ${email}` : "",
      phone ? `${french ? "Téléphone" : "Phone"} : ${phone}` : "",
      "",
      message,
    ]
      .filter(Boolean)
      .join("\n");
    setState("sent");
    window.location.assign(
      `mailto:${encodeURIComponent(contactEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    );
  }

  const fieldClass =
    "mt-1.5 min-h-11 w-full rounded-xl border border-white/15 bg-white/[.07] px-3.5 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-amber-300 focus:bg-white/[.11] focus:ring-4 focus:ring-amber-300/15";

  return (
    <form
      className="rounded-2xl border border-white/12 bg-white/[.055] p-4 sm:p-5"
      onSubmit={submit}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-base font-semibold text-white">
            {french ? "Envoyez-nous un message" : "Send us a message"}
          </p>
          <p className="mt-1 text-xs leading-5 text-white/60">
            {french
              ? domain
                ? "Le message sera envoyé directement à notre équipe."
                : "Votre application e-mail s’ouvrira avec le message déjà préparé."
              : domain
                ? "Your message will be sent directly to our team."
                : "Your email application will open with the message already prepared."}
          </p>
        </div>
        <Send className="mt-0.5 size-5 shrink-0 text-amber-200" />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-white/80">
          {french ? "Nom complet" : "Full name"} *
          <input className={fieldClass} name="name" autoComplete="name" minLength={2} maxLength={150} required />
        </label>
        <label className="text-xs font-semibold text-white/80">
          {french ? "Téléphone" : "Phone"}
          <input className={fieldClass} name="phone" type="tel" autoComplete="tel" maxLength={40} />
        </label>
        <label className="text-xs font-semibold text-white/80">
          {french ? "E-mail" : "Email"} *
          <input className={fieldClass} name="email" type="email" autoComplete="email" maxLength={255} required />
        </label>
        <label className="text-xs font-semibold text-white/80">
          {french ? "Objet" : "Subject"} *
          <input className={fieldClass} name="subject" minLength={3} maxLength={180} required />
        </label>
        <label className="text-xs font-semibold text-white/80 sm:col-span-2">
          {french ? "Votre message" : "Your message"} *
          <textarea
            className={`${fieldClass} min-h-28 py-3`}
            name="message"
            minLength={5}
            maxLength={4000}
            required
            rows={5}
          />
        </label>
        <input
          className="hidden"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />
      </div>
      {state === "sent" ? (
        <p className="mt-3 text-xs font-medium text-emerald-200" role="status">
          {french
            ? domain
              ? "Votre message a bien été envoyé. Notre équipe vous répondra dès que possible."
              : "Le message est prêt dans votre application e-mail."
            : domain
              ? "Your message was sent. Our team will respond as soon as possible."
              : "The message is ready in your email application."}
        </p>
      ) : null}
      {state === "error" ? (
        <p className="mt-3 text-xs font-medium text-rose-200" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={state === "sending"}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-amber-300 px-5 text-sm font-bold text-slate-950 transition hover:bg-amber-200 focus:outline-none focus:ring-4 focus:ring-amber-300/30"
      >
        <Send className="size-4" />
        {state === "sending"
          ? french
            ? "Envoi en cours…"
            : "Sending…"
          : domain
            ? french
              ? "Envoyer le message"
              : "Send message"
            : french
              ? "Préparer l’e-mail"
              : "Prepare email"}
      </button>
    </form>
  );
}

export function PublicWebsiteRenderer({
  website,
  page,
  initialLanguage,
  pathPrefix,
  contactDomain,
}: {
  website: PublicWebsite;
  page: PublicWebsitePage;
  initialLanguage?: Language;
  pathPrefix?: string;
  contactDomain?: string;
}) {
  const [language, setLanguage] = React.useState<Language>(
    initialLanguage ?? website.default_locale ?? "fr",
  );
  const [menuOpen, setMenuOpen] = React.useState(false);
  const reduceMotion = useReducedMotion();
  const currentTitle = language === "fr" ? page.title_fr : page.title_en;
  const siteBase =
    pathPrefix === undefined
      ? `/sites/${website.organization_slug}`
      : pathPrefix.replace(/\/$/, "");
  // Public navigation is already delivered with the home page first. This
  // keeps custom home slugs working too, instead of assuming every owner calls
  // their start page "accueil".
  const homeSlug =
    website.navigation.find((item) => item.slug === "accueil")?.slug ??
    website.navigation[0]?.slug ??
    "accueil";
  const pageLink = (slug: string) =>
    slug === homeSlug || slug === "accueil"
      ? siteBase || "/"
      : `${siteBase}/${slug}`;
  const projectsHref = website.navigation.some(
    (item) => item.slug === "projets",
  )
    ? pageLink("projets")
    : "#contact";
  const hasSelectedWebsiteImage = page.sections.some((section) =>
    Boolean(
      safeImage(
        text(
          section.content,
          "image",
          text(section.content, "secondary_image"),
        ),
      ),
    ),
  );
  const legacyHeroTitle = text(
    page.sections.find((section) => section.section_type === "hero")?.content ??
      {},
    "title_fr",
  );
  const useCongoOmegaLanding =
    website.display_name.replace(/\s+/g, "").toLowerCase() === "congoomega" &&
    page.slug === "accueil" &&
    (!hasSelectedWebsiteImage ||
      legacyHeroTitle ===
        "Une entreprise proche du terrain, guidée par des résultats réels.");
  const visibleSections = useCongoOmegaLanding
    ? congoOmegaLandingSections
    : page.sections;
  return (
    <main
      className="min-h-screen bg-[#fbfcf8] text-slate-950"
      style={
        {
          "--website-primary": website.primary_color || "#075c4d",
          "--website-accent": website.accent_color || "#e9a43a",
        } as React.CSSProperties
      }
    >
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_8%_20%,rgba(16,185,129,.09),transparent_26%),radial-gradient(circle_at_94%_42%,rgba(245,158,11,.08),transparent_28%)]" />
      <header className="sticky top-0 z-30 px-3 sm:px-5 lg:px-8">
        <div className="mx-auto max-w-[1500px]">
          <div className="hidden min-h-10 items-center justify-between gap-5 rounded-t-[1.35rem] bg-slate-950 px-5 text-[11px] font-medium text-white lg:flex xl:px-7">
            <p className="flex min-w-0 items-center gap-2 truncate tracking-[.035em] text-white/72">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-300/15 text-amber-200">
                <Sparkles className="size-3" />
              </span>
              {website.tagline ||
                (language === "fr"
                  ? "Une agriculture locale, responsable et utile."
                  : "Local agriculture, responsibly grown.")}
            </p>
            <div className="flex shrink-0 items-center gap-4">
              {website.contact_phone ? (
                <a
                  className="inline-flex items-center gap-1.5 text-white/72 transition hover:text-white"
                  href={`tel:${website.contact_phone}`}
                >
                  <Phone className="size-3" />
                  {website.contact_phone}
                </a>
              ) : null}
              {website.contact_email ? (
                <a
                  className="inline-flex items-center gap-1.5 text-white/72 transition hover:text-white"
                  href={`mailto:${website.contact_email}`}
                >
                  <Mail className="size-3" />
                  {website.contact_email}
                </a>
              ) : null}
              <Link
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 font-semibold text-amber-100 transition hover:bg-white/16 hover:text-white"
                href={careersHref(website)}
              >
                <BriefcaseBusiness className="size-3" />
                {language === "fr" ? "Nous rejoindre" : "Join us"}
              </Link>
            </div>
          </div>
          <div className="flex min-h-[70px] items-center justify-between gap-4 rounded-[1.35rem] border border-slate-200/80 bg-white/92 px-4 shadow-[0_20px_42px_-30px_rgba(15,23,42,.55)] backdrop-blur-xl sm:min-h-[76px] sm:px-6 lg:rounded-t-none lg:px-7 xl:px-9">
            <Link
              href={pageLink("accueil")}
              className="flex min-w-0 items-center gap-3"
            >
              <div
                className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[1rem] text-sm font-bold text-white shadow-[0_14px_26px_-16px_color-mix(in_srgb,var(--website-primary)_92%,transparent)]"
                style={{ backgroundColor: "var(--website-primary)" }}
              >
                {website.logo_url ? (
                  <img
                    src={website.logo_url}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  website.display_name.slice(0, 2).toUpperCase()
                )}
              </div>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold tracking-[-.02em] text-slate-950">
                  {website.display_name}
                </span>
                <span className="mt-0.5 hidden text-[10px] font-bold uppercase tracking-[.16em] text-slate-400 sm:block">
                  {language === "fr" ? "Entreprise locale" : "Local enterprise"}
                </span>
              </span>
            </Link>
            <nav className="hidden items-center gap-1 xl:flex">
              {website.navigation.map((item) => (
                <Link
                  key={item.slug}
                  href={pageLink(item.slug)}
                  className={`relative px-3 py-3 text-[13px] font-semibold transition after:absolute after:bottom-1.5 after:left-3 after:right-3 after:h-0.5 after:origin-left after:rounded-full after:transition-transform ${item.slug === page.slug ? "text-slate-950 after:scale-x-100" : "text-slate-500 after:scale-x-0 after:bg-slate-950 hover:text-slate-950 hover:after:scale-x-100"}`}
                  style={
                    item.slug === page.slug
                      ? { color: "var(--website-primary)" }
                      : undefined
                  }
                >
                  {item.slug === page.slug ? (
                    <span
                      className="absolute bottom-1.5 left-3 right-3 h-0.5 rounded-full"
                      style={{ backgroundColor: "var(--website-primary)" }}
                    />
                  ) : null}
                  {language === "fr" ? item.label_fr : item.label_en}
                </Link>
              ))}
              <button
                className="ml-2 inline-flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-700 transition hover:border-slate-300 hover:bg-white"
                onClick={() => setLanguage(language === "fr" ? "en" : "fr")}
                aria-label={
                  language === "fr" ? "Switch to English" : "Passer en français"
                }
              >
                <span>{language === "fr" ? "EN" : "FR"}</span>
              </button>
            </nav>
            <div className="hidden xl:block">
              <a
                href="#contact"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-[13px] font-semibold text-white shadow-[0_16px_28px_-18px_rgba(15,23,42,.85)] transition hover:-translate-y-0.5 hover:bg-slate-800"
              >
                {copy[language].contact}
                <ArrowUpRight className="size-3.5" />
              </a>
            </div>
            <button
              onClick={() => setMenuOpen(true)}
              className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-slate-700 shadow-sm transition hover:bg-white xl:hidden"
              aria-label={copy[language].menu}
            >
              <Menu className="size-5" />
            </button>
          </div>
        </div>
      </header>
      {menuOpen ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#fbfcf8] p-5 lg:hidden">
          <div className="flex items-center justify-between">
            <Link
              href={pageLink("accueil")}
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 font-semibold text-slate-950"
            >
              <span
                className="flex size-9 items-center justify-center rounded-xl text-xs text-white"
                style={{ backgroundColor: "var(--website-primary)" }}
              >
                {website.logo_url ? (
                  <img
                    src={website.logo_url}
                    alt=""
                    className="size-full rounded-xl object-cover"
                  />
                ) : (
                  website.display_name.slice(0, 2).toUpperCase()
                )}
              </span>
              {website.display_name}
            </Link>
            <button
              onClick={() => setMenuOpen(false)}
              className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-700"
              aria-label={copy[language].close}
            >
              <X className="size-5" />
            </button>
          </div>
          <p className="mt-7 max-w-sm text-sm leading-6 text-slate-600">
            {website.tagline ||
              (language === "fr"
                ? "Découvrez nos activités, nos projets et les opportunités pour rejoindre nos équipes."
                : "Discover our activities, projects and opportunities to join our teams.")}
          </p>
          <nav className="mt-7 grid gap-2">
            {website.navigation.map((item) => (
              <Link
                key={item.slug}
                onClick={() => setMenuOpen(false)}
                href={pageLink(item.slug)}
                className={`rounded-2xl border px-5 py-4 font-medium ${item.slug === page.slug ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-white text-slate-900"}`}
              >
                {language === "fr" ? item.label_fr : item.label_en}
              </Link>
            ))}
            <a
              href="#contact"
              onClick={() => setMenuOpen(false)}
              className="mt-2 rounded-2xl bg-slate-950 px-5 py-4 font-semibold text-white"
            >
              {copy[language].contact}
            </a>
            <button
              className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left font-medium text-slate-900"
              onClick={() => setLanguage(language === "fr" ? "en" : "fr")}
            >
              <Languages className="mr-2 inline size-4" />
              {language === "fr" ? "English" : "Français"}
            </button>
          </nav>
          {website.contact_phone || website.contact_email ? (
            <div className="mt-8 rounded-3xl bg-slate-950 p-5 text-sm text-white">
              <p className="text-xs font-bold uppercase tracking-[.14em] text-amber-200">
                {copy[language].contact}
              </p>
              {website.contact_phone ? (
                <a
                  className="mt-4 flex items-center gap-2"
                  href={`tel:${website.contact_phone}`}
                >
                  <Phone className="size-4 text-amber-200" />
                  {website.contact_phone}
                </a>
              ) : null}
              {website.contact_email ? (
                <a
                  className="mt-3 flex items-center gap-2 break-all"
                  href={`mailto:${website.contact_email}`}
                >
                  <Mail className="size-4 shrink-0 text-amber-200" />
                  {website.contact_email}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div aria-label={currentTitle}>
        {visibleSections
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((section, index) => (
            <motion.div
              key={section.id}
              initial={
                reduceMotion ? false : { opacity: 0, y: index === 0 ? 0 : 22 }
              }
              whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.16 }}
              transition={{
                duration: 0.52,
                delay: Math.min(index * 0.035, 0.18),
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <PublicSection
                section={section}
                language={language}
                website={website}
                pageLink={pageLink}
                contactDomain={contactDomain}
              />
            </motion.div>
          ))}
      </div>
      <footer className="mt-16 overflow-hidden bg-slate-950 px-5 pb-7 pt-14 text-white/65 sm:px-8 sm:pt-20">
        <div className="mx-auto grid max-w-[1400px] gap-12 lg:grid-cols-[1.25fr_.8fr_.9fr_1.1fr]">
          <div>
            <Link
              href={pageLink(homeSlug)}
              className="inline-flex items-center gap-3"
            >
              <span
                className="flex size-11 items-center justify-center overflow-hidden rounded-2xl text-sm font-bold text-white"
                style={{ backgroundColor: "var(--website-primary)" }}
              >
                {website.logo_url ? (
                  <img
                    src={website.logo_url}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  website.display_name.slice(0, 2).toUpperCase()
                )}
              </span>
              <span className="text-lg font-semibold tracking-[-.03em] text-white">
                {website.display_name}
              </span>
            </Link>
            <p className="mt-5 max-w-sm text-sm leading-6 text-white/60">
              {website.footer_text ||
                website.tagline ||
                (language === "fr"
                  ? "Une entreprise proche du terrain, engagée pour une production locale solide et durable."
                  : "A field-led organisation committed to strong, sustainable local production.")}
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.06] px-3 py-2 text-xs font-semibold text-amber-100">
              <Sprout className="size-3.5" />
              {language === "fr"
                ? "Grandir avec le terrain"
                : "Growing with the field"}
            </div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[.16em] text-amber-200">
              {language === "fr" ? "Explorer" : "Explore"}
            </p>
            <nav className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3 text-sm sm:grid-cols-1">
              {website.navigation.map((item) => (
                <Link
                  key={item.slug}
                  href={pageLink(item.slug)}
                  className="group inline-flex w-fit items-center gap-1 text-sm transition hover:text-white"
                >
                  {language === "fr" ? item.label_fr : item.label_en}
                  <ArrowUpRight className="size-3 opacity-0 transition group-hover:opacity-100" />
                </Link>
              ))}
            </nav>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[.16em] text-amber-200">
              {language === "fr" ? "Nous rejoindre" : "Join us"}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3 text-sm sm:grid-cols-1">
              <Link
                href={careersHref(website)}
                className="inline-flex w-fit items-center gap-2 transition hover:text-white"
              >
                <BriefcaseBusiness className="size-4 text-amber-200" />
                {language === "fr" ? "Carrières" : "Careers"}
              </Link>
              <a
                href="#contact"
                className="inline-flex w-fit items-center gap-2 transition hover:text-white"
              >
                <Mail className="size-4 text-amber-200" />
                {copy[language].contact}
              </a>
              <Link
                href={projectsHref}
                className="inline-flex w-fit items-center gap-2 transition hover:text-white"
              >
                <Globe2 className="size-4 text-amber-200" />
                {language === "fr" ? "Nos projets" : "Our projects"}
              </Link>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[.16em] text-amber-200">
              {copy[language].contact}
            </p>
            <div className="mt-5 grid gap-4 text-sm">
              {website.address ? (
                <div className="flex gap-3">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-amber-200" />
                  <span className="leading-6">{website.address}</span>
                </div>
              ) : null}
              {website.contact_phone ? (
                <a
                  className="flex items-center gap-3 transition hover:text-white"
                  href={`tel:${website.contact_phone}`}
                >
                  <Phone className="size-4 text-amber-200" />
                  {website.contact_phone}
                </a>
              ) : null}
              {website.contact_email ? (
                <a
                  className="flex items-center gap-3 break-all transition hover:text-white"
                  href={`mailto:${website.contact_email}`}
                >
                  <Mail className="size-4 shrink-0 text-amber-200" />
                  {website.contact_email}
                </a>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mx-auto mt-14 flex max-w-[1400px] flex-col gap-3 border-t border-white/10 pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {website.display_name}.{" "}
            {copy[language].allRights}
          </p>
          <div className="flex items-center gap-4">
            <a className="transition hover:text-white" href="#contact">
              {language === "fr" ? "Contact" : "Contact"}
            </a>
            <Link
              className="transition hover:text-white"
              href={careersHref(website)}
            >
              {language === "fr" ? "Carrières" : "Careers"}
            </Link>
            <span className="text-white/30">•</span>
            <span>
              {language === "fr" ? "Site sécurisé" : "Secure website"}
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}
