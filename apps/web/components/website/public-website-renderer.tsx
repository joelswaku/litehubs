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
  UserRound,
  X,
} from "lucide-react";
import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { ApiError, post } from "@/lib/api";
import {
  BREAKPOINTS,
  SITE_RESPONSIVE_CSS,
  cssLength,
  elementRules,
  googleFontsHref,
  type StyleValues,
} from "./website-element-style";
import {
  AnimatedText,
  AnimationRuntime,
  BlockStylesProvider,
  MOTION_CSS,
  WebsiteSlider,
  type SliderSettings,
} from "./website-motion";
import {
  SITE_THEMES,
  SiteRenderContext,
  ZONE_CSS,
  ZONE_ELEMENT_TYPES,
  ZoneElement,
  ZoneNameContext,
  readDesign,
  themeCss,
  themeFontsHref,
  type SiteRenderInfo,
  type ZoneData,
  type ZoneName,
  zoneLinksOf,
  zoneLookOf,
} from "./website-zones";
import { VARIANT_CSS, validVariant } from "./website-templates";

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
    | "contact"
    | "container";
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
  /** Site design from the builder: theme and global zones (top bar,
   * header, footer). Without it the site keeps its original header/footer. */
  design?: Record<string, unknown>;
  /** Every published page; `in_menu: false` pages are kept out of menus. */
  navigation: Array<{ slug: string; label_fr: string; label_en: string; in_menu?: boolean }>;
};

export type PublicWebsitePage = {
  /** Page design chosen in the builder (background, width, spacing, header…). */
  settings?: Record<string, unknown>;
  slug: string;
  title_fr: string;
  title_en: string;
  description_fr: string | null;
  description_en: string | null;
  sections: WebsiteSection[];
};

/** Optional bridge used only by the private visual builder. The public site
 * never passes it, so visitors get exactly the same markup as before. */
export type WebsiteEditorBridge = {
  selectedSectionId: string | null;
  /** The element clicked inside the selected block (title, body, button…). */
  selectedElement?: string | null;
  /** clickedText: the click landed on text that has no own selectable element,
   *  so the selection is the container around it. */
  onSelectSection: (sectionId: string, element: string | null, clickedText?: boolean) => void;
  sectionLabel: (section: WebsiteSection) => string;
  /** Changing this number replays the entrance animations in the preview. */
  replayKey?: number;
  /** "Aperçu": nothing is selectable and links work (inside the builder). */
  preview?: boolean;
  /** Shows the selected element in a state (hover, active, focus…) while it is edited. */
  previewState?: string | null;
  /** In preview, a link to another page of the site opens it in the builder. */
  onNavigatePage?: (slug: string) => void;
};

/** Per-element styling chosen in the visual builder, keyed by the element's
 * `data-el` name (eyebrow, title, body, primaryButton, …). */
export type WebsiteElementStyle = {
  color?: string;
  background?: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  size?: number;
  // Spacing, in px, for any element.
  marginTop?: number;
  marginBottom?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  // Box and layout, mainly for containers.
  gap?: number;
  direction?: "row" | "column";
  justify?: "start" | "center" | "end" | "between";
  alignItems?: "start" | "center" | "end" | "stretch";
  wrap?: boolean;
  radius?: number;
  borderWidth?: number;
  borderColor?: string;
  width?: "auto" | "full";
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

function appointmentHref(website: PublicWebsite): string {
  return `/book/${website.portal_organization_slug ?? website.organization_slug}`;
}

/** A finished public landing remains visible for organisations that were
 * created with the original empty website shells. As soon as the owner adds
 * one image in the builder, their own sections take over completely. */
export const congoOmegaLandingSections: WebsiteSection[] = [
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
    (href.startsWith("/") && !href.startsWith("//")) ||
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

function hexColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim())
    ? value.trim()
    : null;
}

/** Elements the owner added inside a block from the visual builder. */
export type WebsiteExtraElement = {
  id: string;
  type:
    | "heading"
    | "text"
    | "button"
    | "image"
    | "spacer"
    | "group"
    | "slider"
    // Site elements, mainly for the top bar, header and footer.
    | "logo"
    | "menu"
    | "language"
    | "social"
    | "contact"
    | "copyright"
    | "newsletter";
  textFr?: string;
  textEn?: string;
  href?: string;
  imageUrl?: string;
  /** Buttons: primary / secondary. Logo: name / name-tagline / image.
   * Menu: row / column. */
  variant?: string;
  /** Contact detail (phone, email, address, hours) or newsletter button text. */
  value?: string;
  contactKind?: "phone" | "email" | "address" | "hours";
  /** Menu: the site's pages, or owner-chosen entries. */
  menuSource?: "pages" | "custom";
  /** Menu: only the first ("start") or second ("end") half of the links. */
  part?: "start" | "end";
  /** Menu entries ({labelFr, labelEn, link}) or social links ({network, url}). */
  items?: Array<Record<string, unknown>>;
  /** For "group" and "slider": the elements (or slides) placed inside. */
  children?: WebsiteExtraElement[];
  /** Only for "slider": carousel behaviour. */
  slider?: SliderSettings;
  /** Set on elements a zone template created, until the owner edits them. */
  tpl?: boolean;
  /** Headings and texts: semantic tag (h1 to h6, or p) for search engines. */
  tag?: string;
  /** Only for "group": makes the whole container a link. */
  link?: WebsiteLinkSetting;
};

/** True when a click hit text that is not itself a selectable element. */
function textHitOf(target: HTMLElement): boolean {
  const owner = target.closest("[data-el]");
  if (!owner || owner === target) return false;
  return Array.from(target.childNodes).some((node) => node.nodeType === 3 && (node.textContent ?? "").trim().length > 0);
}

const TEXT_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6", "p"] as const;
/** A semantic tag from a closed list (never free HTML). */
function textTag(value: unknown, fallback: (typeof TEXT_TAGS)[number]): (typeof TEXT_TAGS)[number] {
  return TEXT_TAGS.includes(value as (typeof TEXT_TAGS)[number]) ? (value as (typeof TEXT_TAGS)[number]) : fallback;
}

const extraTypes = ["heading", "text", "button", "image", "spacer", "group", "slider", ...ZONE_ELEMENT_TYPES];
/** Elements that sit in a row like buttons (a row of them wraps, it does not
 * stack into a column on phones). */
const inlineTypes = new Set(["button", "language", "social", "contact"]);
const containerTypes = new Set(["group", "slider"]);

function validExtra(item: unknown, allowGroup: boolean): item is WebsiteExtraElement {
  if (!item || typeof item !== "object") return false;
  const candidate = item as WebsiteExtraElement;
  return (
    typeof candidate.id === "string" &&
    /^[a-z0-9-]{1,40}$/.test(candidate.id) &&
    extraTypes.includes(candidate.type) &&
    (allowGroup || !containerTypes.has(candidate.type))
  );
}

/** How deep containers can nest (a container in a container in a …). */
export const MAX_CONTAINER_DEPTH = 4;

function readExtraList(raw: unknown, depth: number): WebsiteExtraElement[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is WebsiteExtraElement =>
      validExtra(item, depth < MAX_CONTAINER_DEPTH),
    )
    .map((item) =>
      containerTypes.has(item.type)
        ? { ...item, children: readExtraList(item.children, depth + 1) }
        : item,
    );
}

/** Reads added elements, including containers nested inside containers. */
export function readExtraElements(content: Content): WebsiteExtraElement[] {
  return readExtraList(content.extras, 1);
}

/** Same friendly-path handling as the built-in buttons. */
function resolveWebsiteHref(
  value: string,
  website: PublicWebsite,
  pageLink: (slug: string) => string,
) {
  if (value === "/rendezvous" || value === "/rendez-vous") return appointmentHref(website);
  const match = value.match(/^\/(notre-entreprise|activites|projets|impact|carrieres|contact)$/);
  return match ? pageLink(match[1]!) : value;
}

/** Whole-area links: content stays on top and click-through, the link sits
 * underneath; real buttons / links / fields inside keep their own action. */
const LINK_CSS = [
  // Every clickable element keeps a visible keyboard focus (low weight: an
  // owner's own focus style can add to it).
  "[data-site-root] :where(a,button,summary,[tabindex]):focus-visible{outline:3px solid #0ea5e9;outline-offset:3px}",
  "[data-site-root] [data-link-live]{position:relative;isolation:isolate;cursor:pointer}",
  "[data-site-root] [data-link-live]>.wb-link{position:absolute;inset:0;z-index:-1;border-radius:inherit}",
  "[data-site-root] [data-link-live]>:not(.wb-link){pointer-events:none}",
  "[data-site-root] [data-link-live] :is(a,button,input,select,textarea,summary,label,video,iframe,.wb-track,[tabindex]):not(.wb-link){pointer-events:auto}",
  "[data-site-root] [data-link-live]:has(>.wb-link:focus-visible){outline:3px solid #0ea5e9;outline-offset:3px}",
  "[data-site-root] [data-link-live]>.wb-link:focus{outline:none}",
  "[data-site-root] .wb-text-link{color:inherit;text-decoration:none}",
  "[data-site-root] .wb-text-link:hover{text-decoration:underline;text-underline-offset:.18em}",
  "[data-site-root] .wb-text-link:focus-visible{outline:3px solid #0ea5e9;outline-offset:3px;border-radius:4px}",
  "[data-site-root] .wb-text-link-edit{text-decoration:underline dotted;text-underline-offset:.2em}",
  "[data-site-root] .wb-image-link{display:block}",
  "[data-site-root] .wb-image-link:focus-visible{outline:3px solid #0ea5e9;outline-offset:3px;border-radius:1rem}",
  // Header / footer variants chosen in the page settings.
  '[data-site-root][data-header-variant="minimal"] .wb-topbar{display:none}',
  '[data-site-root][data-footer-variant="minimal"] .wb-footer-main{display:none}',
  '[data-site-root][data-footer-variant="minimal"] .wb-footer{padding-top:0;margin-top:2.5rem}',
  '[data-site-root][data-footer-variant="minimal"] .wb-footer>div{margin-top:0}',
].join("");

const PAGE_WIDTHS: Record<string, string> = {
  narrow: "960px",
  normal: "1400px",
  wide: "1600px",
  full: "none",
};

/** Page design: content width, space between blocks, page padding. All
 * values are whitelisted or clamped; spacing shrinks on tablet and phone. */
function pageSettingsCss(settings: Record<string, unknown>): string {
  const rules: string[] = [];
  const width = typeof settings.contentWidth === "string" ? PAGE_WIDTHS[settings.contentWidth] : undefined;
  if (width) rules.push(`[data-page-content] section[class*="max-w-"]{max-width:${width}}`);
  const number = (key: string, max: number) => {
    const value = Number(settings[key]);
    return settings[key] !== undefined && settings[key] !== "" && Number.isFinite(value)
      ? Math.round(Math.min(max, Math.max(0, value)))
      : null;
  };
  const gap = number("blockGap", 200);
  const top = number("paddingTop", 300);
  const bottom = number("paddingBottom", 300);
  const spacing = (factor: number) =>
    [
      gap !== null ? `display:flex;flex-direction:column;gap:${Math.round(gap * factor)}px` : "",
      top !== null ? `padding-top:${Math.round(top * factor)}px` : "",
      bottom !== null ? `padding-bottom:${Math.round(bottom * factor)}px` : "",
    ]
      .filter(Boolean)
      .join(";");
  if (gap !== null || top !== null || bottom !== null) {
    rules.push(`[data-page-content]{${spacing(1)}}`);
    rules.push(`@media (max-width:${BREAKPOINTS.tablet}px){[data-page-content]{${spacing(0.75)}}}`);
    rules.push(`@media (max-width:${BREAKPOINTS.mobile}px){[data-page-content]{${spacing(0.5)}}}`);
  }
  return rules.join("");
}

/** "Lien au clic" of a block or a container. */
export type WebsiteLinkSetting = {
  kind?: "page" | "url";
  page?: string;
  url?: string;
  newTab?: boolean;
  label?: string;
};

type ResolvedLink = { href: string; newTab: boolean; label: string };

function resolveLink(
  raw: unknown,
  website: PublicWebsite,
  pageLink: (slug: string) => string,
  language: Language,
): ResolvedLink | null {
  if (!raw || typeof raw !== "object") return null;
  const link = raw as WebsiteLinkSetting;
  let href: string | null = null;
  let fallback = "";
  if (link.kind === "page" && typeof link.page === "string" && /^[a-z0-9-]{1,80}$/.test(link.page)) {
    href = pageLink(link.page);
    const target = website.navigation.find((item) => item.slug === link.page);
    fallback = target ? (language === "fr" ? target.label_fr : target.label_en) : link.page;
  } else if (link.kind === "url" && typeof link.url === "string") {
    href = safeHref(resolveWebsiteHref(link.url.trim(), website, pageLink));
    fallback = link.url.trim();
  }
  if (!href) return null;
  const label = typeof link.label === "string" && link.label.trim() ? link.label.trim() : fallback;
  return { href, newTab: link.newTab === true, label };
}

/**
 * Makes a whole block or container clickable without nesting links: a
 * transparent link fills the area underneath, while buttons and links
 * inside stay on top and keep their own action. In the builder nothing
 * navigates; a small badge shows that a link is set.
 */
function LinkSurface({
  link,
  editing,
  language,
}: {
  link: ResolvedLink;
  editing: boolean;
  language: Language;
}) {
  if (editing)
    return (
      <span className="pointer-events-none absolute right-2 top-2 z-30 rounded-md bg-sky-600 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">
        {language === "fr" ? "Lien" : "Link"} → {link.label.slice(0, 32)}
      </span>
    );
  return (
    <a
      className="wb-link"
      href={link.href}
      target={link.newTab ? "_blank" : undefined}
      rel={link.newTab ? "noopener noreferrer" : undefined}
      aria-label={
        link.newTab
          ? `${link.label} (${language === "fr" ? "nouvel onglet" : "new tab"})`
          : link.label
      }
    />
  );
}

/** Links set on single texts (titles, paragraphs…) of the current block. */
const ElementLinkContext = React.createContext<{
  resolve: (name: string) => ResolvedLink | null;
  editing: boolean;
  language: Language;
}>({ resolve: () => null, editing: false, language: "fr" });

/**
 * Wraps a text in a link when the owner set one. A text never contains other
 * links, so there is no nesting. In the builder it is only underlined.
 */
function TextLink({
  name,
  link: given,
  children,
}: {
  name?: string;
  link?: ResolvedLink | null;
  children: React.ReactNode;
}) {
  const context = React.useContext(ElementLinkContext);
  const link = given !== undefined ? given : name ? context.resolve(name) : null;
  if (!link) return <>{children}</>;
  if (context.editing)
    return (
      <span className="wb-text-link-edit" title={`→ ${link.label}`}>
        {children}
      </span>
    );
  return (
    <a
      className="wb-text-link"
      href={link.href}
      target={link.newTab ? "_blank" : undefined}
      rel={link.newTab ? "noopener noreferrer" : undefined}
    >
      {children}
    </a>
  );
}

/** True inside the builder preview. */
const BlockEditingContext = React.createContext(false);

/** Filled by the block that is rendering, read where its heading sits. */
const BlockExtrasContext = React.createContext<React.ReactNode>(null);

function BlockExtras({
  section,
  language,
  website,
  pageLink,
  editing = false,
}: {
  section: WebsiteSection;
  language: Language;
  website: PublicWebsite;
  pageLink: (slug: string) => string;
  /** In the builder, empty elements show a placeholder so they can be clicked. */
  editing?: boolean;
}) {
  const extras = readExtraElements(section.content);
  const placeholder = (id: string, label: string, nested = false) =>
    editing ? (
      <div
        key={id}
        data-el={`x:${id}`}
        className={`${nested ? "" : "mt-5 "}grid min-h-16 w-full max-w-xl place-items-center rounded-2xl border-2 border-dashed border-current/40 px-4 text-center text-sm opacity-70`}
      >
        {label}
      </div>
    ) : null;
  if (!extras.length)
    return editing && section.section_type === "container" && section.content.divMode === true ? (
      // A label over the empty div: it adds no size, so the editor shows the
      // div exactly as the published site does.
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 grid place-items-center px-4 text-center text-sm opacity-60"
      >
        {language === "fr" ? "Div vide : ajoutez des éléments à droite" : "Empty div: add elements on the right"}
      </span>
    ) : editing && section.section_type === "container" ? (
      <div className="grid min-h-32 w-full place-items-center rounded-2xl border-2 border-dashed border-current/30 px-4 text-center text-sm opacity-70">
        {language === "fr"
          ? "Bloc libre vide : utilisez « Ajouter dans ce bloc » à droite"
          : "Empty free block: use “Add inside this block” on the right"}
      </div>
    ) : null;
  const renderItem = (item: WebsiteExtraElement, nested: boolean): React.ReactNode => {
        const el = `x:${item.id}`;
        // Inside a container, the container's gap spaces its elements.
        const space = nested ? "" : "mt-5 ";
        const words = (language === "fr" ? item.textFr : item.textEn) ?? item.textFr ?? "";
        switch (item.type) {
          case "heading": {
            if (!words) return placeholder(item.id, language === "fr" ? "Sous-titre vide" : "Empty subheading", nested);
            // The tag is a semantic (SEO) choice; the look stays the same.
            const Heading = textTag(item.tag, "h3");
            return (
              <Heading key={item.id} data-el={el} className={`${space}text-2xl font-semibold leading-tight tracking-[-.025em] sm:text-3xl`}>
                <TextLink link={resolveLink(item.link, website, pageLink, language)}>
                  <AnimatedText name={el} text={words} />
                </TextLink>
              </Heading>
            );
          }
          case "text": {
            if (!words) return placeholder(item.id, language === "fr" ? "Paragraphe vide" : "Empty paragraph", nested);
            const Paragraph = textTag(item.tag, "p");
            return (
              <Paragraph key={item.id} data-el={el} className={`${space}max-w-2xl whitespace-pre-line text-base leading-7 opacity-85`}>
                <TextLink link={resolveLink(item.link, website, pageLink, language)}>
                  <AnimatedText name={el} text={words} />
                </TextLink>
              </Paragraph>
            );
          }
          case "button": {
            const buttonLink = resolveLink(item.link, website, pageLink, language);
            const href = buttonLink?.href ?? safeHref(resolveWebsiteHref(item.href ?? "", website, pageLink));
            if (!words || !href)
              return placeholder(item.id, language === "fr" ? "Bouton : ajoutez un texte et un lien" : "Button: add text and a link", nested);
            return (
              <a
                key={item.id}
                data-el={el}
                href={href}
                target={buttonLink?.newTab ? "_blank" : undefined}
                rel={buttonLink?.newTab ? "noopener noreferrer" : undefined}
                className={`${space}wb-btn flex min-h-11 w-fit items-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors ${
                  item.variant === "secondary"
                    ? "wb-btn-secondary border border-current bg-transparent hover:opacity-80"
                    : "border border-slate-200 bg-white text-slate-900 shadow-[0_16px_30px_-18px_rgba(15,23,42,.7)] hover:bg-amber-50"
                }`}
              >
                {words}
                <ArrowRight className="size-4" />
              </a>
            );
          }
          case "image": {
            const source = safeImage(item.imageUrl);
            if (!source)
              return placeholder(item.id, language === "fr" ? "Choisissez une image" : "Choose an image", nested);
            const imageLink = resolveLink(item.link, website, pageLink, language);
            const image = (
              <img
                key={item.id}
                data-el={el}
                src={source}
                alt={words || website.display_name}
                className={`${space}block w-full max-w-xl rounded-2xl object-cover`}
              />
            );
            // A linked image sits in a plain link; in the builder it stays selectable.
            return imageLink && !editing ? (
              <a
                key={item.id}
                className="wb-image-link"
                href={imageLink.href}
                target={imageLink.newTab ? "_blank" : undefined}
                rel={imageLink.newTab ? "noopener noreferrer" : undefined}
                aria-label={words ? undefined : imageLink.label}
              >
                {image}
              </a>
            ) : (
              image
            );
          }
          case "spacer":
            return (
              <div
                key={item.id}
                data-el={el}
                aria-hidden="true"
                className={`${space}h-10 ${editing ? "rounded-lg border border-dashed border-current/25" : ""}`}
              />
            );
          case "slider":
            return (
              <div key={item.id} className={`${space}w-full min-w-0`}>
                <WebsiteSlider
                  el={el}
                  settings={item.slider}
                  slides={(item.children ?? []).map((child) => renderItem(child, true))}
                  editing={editing}
                  language={language}
                />
              </div>
            );
          case "group": {
            const children = item.children ?? [];
            const link = resolveLink(item.link, website, pageLink, language);
            return (
              <div
                key={item.id}
                data-el={el}
                data-el-kind="group"
                data-stack={children.some((child) => !inlineTypes.has(child.type)) ? "auto" : undefined}
                data-link-live={link && !editing ? "" : undefined}
                className={`${space}flex flex-wrap items-center gap-3 ${(link && editing) || (editing && !children.length) ? "relative" : ""} ${
                  // Editor only: an empty div stays clickable (min height, used
                  // only when the div has none of its own) and gets a dashed
                  // outline, which takes no space.
                  editing && !children.length ? "min-h-16 outline-dashed outline-2 -outline-offset-2 outline-current/40" : ""
                }`}
              >
                {link ? <LinkSurface link={link} editing={editing} language={language} /> : null}
                {children.length
                  ? children.map((child) => renderItem(child, true))
                  : editing ? (
                      <span aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center px-2 text-center text-sm opacity-60">
                        {language === "fr"
                          ? "Conteneur vide : sélectionnez-le puis ajoutez des éléments"
                          : "Empty container: select it, then add elements"}
                      </span>
                    ) : null}
              </div>
            );
          }
          default:
            return ZONE_ELEMENT_TYPES.includes(item.type) ? (
              <ZoneElement key={item.id} item={item} el={el} space={space} />
            ) : null;
        }
  };
  return (
    // A fragment, not a wrapper: added elements sit beside the block's own
    // title, text and buttons, so the owner can reorder all of them together.
    <>{extras.map((item) => renderItem(item, false))}</>
  );
}

const elementNames = new Set([
  "canvas",
  "root",
  "panel",
  "media",
  "items",
  "card",
  "sideCard",
  "sideText",
  "sideLink",
  "eyebrow",
  "title",
  "body",
  "buttons",
  "primaryButton",
  "secondaryButton",
  "badges",
]);

/** Containers that hold more than buttons: they stack into one column on
 * phones. A row of buttons simply wraps instead. */
function stackableContainers(extras: WebsiteExtraElement[], into = new Set<string>()) {
  for (const item of extras) {
    if (item.type !== "group") continue;
    const children = item.children ?? [];
    if (children.some((child) => !inlineTypes.has(child.type))) into.add(`x:${item.id}`);
    stackableContainers(children, into);
  }
  return into;
}

/** Turns the builder's per-element choices into CSS scoped to one block.
 * Every value is validated, so stored content can never inject CSS. */
function elementStyleCss(
  scope: string,
  value: unknown,
  order?: unknown,
  stackable: Set<string> = new Set(),
  hidden?: unknown,
): string {
  const rules: string[] = [];
  const validName = (name: string) =>
    elementNames.has(name) ||
    /^x:[a-z0-9-]{1,40}$/.test(name) ||
    /^item:\d{1,2}(:[a-z]{2,12})?$/.test(name) ||
    /^card:[a-z]{2,12}$/.test(name);
  // Owner-chosen order of the elements inside the block (CSS flex order).
  const names = Array.isArray(order)
    ? order.filter((name): name is string => typeof name === "string" && validName(name))
    : [];
  if (names.length) {
    rules.push(`[data-block-style="${scope}"] [data-el]{order:999}`);
    names.forEach((name, index) =>
      rules.push(`[data-block-style="${scope}"] [data-el="${name}"]{order:${index + 1}}`),
    );
  }
  // Built-in elements the owner deleted from this block.
  if (Array.isArray(hidden))
    for (const name of hidden)
      if (typeof name === "string" && validName(name))
        rules.push(`[data-block-style="${scope}"] [data-el="${name}"]{display:none!important}`);
  if (!value || typeof value !== "object") return rules.join("");
  // "All cards" styles first, so one card's own settings win over them.
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => Number(!a.startsWith("card")) - Number(!b.startsWith("card")),
  );
  for (const [name, raw] of entries) {
    if (!validName(name) || !raw || typeof raw !== "object") continue;
    const style = raw as StyleValues;
    const attribute = name === "card" || name.startsWith("card:") ? "data-el-shared" : "data-el";
    // "root": the block's own outer element (its <section>), the "div" of the block.
    const selector =
      name === "root"
        ? `[data-block-style="${scope}"] > section`
        : `[data-block-style="${scope}"] [${attribute}="${name}"]`;
    rules.push(...elementRules(selector, name, style, { stack: stackable.has(name) }));
  }
  return rules.join("");
}

/** Optional per-block background chosen in the builder: a colour, an image
 * with its own opacity over that colour, and a text colour. Blocks without
 * these settings render exactly as before. */
function SectionBackdrop({
  section,
  index,
  link: blockLink,
  editing = false,
  language = "fr",
  scope: scopeName,
  stack = [],
  variant,
  children,
}: {
  section: WebsiteSection;
  index: number;
  link?: ResolvedLink | null;
  editing?: boolean;
  language?: Language;
  /** CSS scope; blocks use their position, global zones their name. */
  scope?: string;
  /** Extra elements that stack into one column on phones. */
  stack?: string[];
  /** Design variant of the block ("hero-split", "cards-dark"…). */
  variant?: string;
  children: React.ReactNode;
}) {
  const c = section.content;
  // A Div block carries its link on the div itself, not on this wrapper.
  const link = c.divMode === true ? null : blockLink;
  const color = hexColor(c.blockBackgroundColor);
  const image = safeImage(text(c, "blockBackgroundImageUrl"));
  const rawOpacity = Number(c.blockBackgroundImageOpacity);
  const opacity = Number.isFinite(rawOpacity)
    ? Math.min(100, Math.max(0, rawOpacity)) / 100
    : 1;
  const textColor = hexColor(c.blockTextColor);
  const scope = scopeName ?? `b${index}`;
  const elementCss = elementStyleCss(
    scope,
    c.elementStyles,
    c.elementOrder,
    stackableContainers(readExtraElements(c), new Set(stack)),
    c.hiddenElements,
  );
  const fontsHref = googleFontsHref(c.elementStyles);
  // Block spacing, reduced automatically on tablets and phones.
  const blockSpace = (key: string) => {
    const number = Number(c[key]);
    return c[key] !== undefined && c[key] !== "" && Number.isFinite(number)
      ? Math.round(Math.min(320, Math.max(0, number)))
      : null;
  };
  const spacingCss = (factor: number, keep: number) =>
    (
      [
        ["blockPaddingTop", "padding-top"],
        ["blockPaddingBottom", "padding-bottom"],
        ["blockMarginTop", "margin-top"],
        ["blockMarginBottom", "margin-bottom"],
      ] as const
    )
      .map(([key, property]) => {
        const value = blockSpace(key);
        if (value === null) return null;
        const scaled = value <= keep ? value : Math.max(keep, Math.round(value * factor));
        return `${property}:${scaled}px`;
      })
      .filter(Boolean)
      .join(";");
  const blockSpacing = spacingCss(1, 0);
  const spacingRules = blockSpacing
    ? `[data-block-style="${scope}"]{${blockSpacing}}@media (max-width:${BREAKPOINTS.tablet}px){[data-block-style="${scope}"]{${spacingCss(0.75, 24)}}}@media (max-width:${BREAKPOINTS.mobile}px){[data-block-style="${scope}"]{${spacingCss(0.5, 16)}}}`
    : "";
  // Optional size of the whole block (the coloured band): width, alignment,
  // minimum height and rounded corners. Phones always get the full width.
  const blockLength = (value: unknown, units: RegExp) => {
    if (typeof value === "number" && Number.isFinite(value)) return `${Math.min(4000, Math.max(0, Math.round(value)))}px`;
    const length = cssLength(value);
    return length && length !== "auto" && units.test(length) ? length : null;
  };
  const blockWidth = blockLength(c.blockWidth, /(px|%|vw|rem)$/);
  const blockMinHeight = blockLength(c.blockMinHeight, /(px|vh|rem)$/);
  const blockRadiusNumber = Number(c.blockRadius);
  const blockRadius =
    c.blockRadius !== undefined && c.blockRadius !== "" && Number.isFinite(blockRadiusNumber)
      ? Math.min(80, Math.max(0, Math.round(blockRadiusNumber)))
      : null;
  const sizeDeclarations = [
    blockWidth ? `width:${blockWidth};max-width:100%` : "",
    blockWidth && c.blockAlign !== "left" ? (c.blockAlign === "right" ? "margin-left:auto" : "margin-left:auto;margin-right:auto") : "",
    blockMinHeight ? `min-height:${blockMinHeight}` : "",
    blockRadius !== null ? `border-radius:${blockRadius}px` : "",
  ]
    .filter(Boolean)
    .join(";");
  const sizeRules = sizeDeclarations
    ? `[data-block-style="${scope}"]{${sizeDeclarations}}${
        blockWidth ? `@media (max-width:${BREAKPOINTS.mobile}px){[data-block-style="${scope}"]{width:100%}}` : ""
      }`
    : "";
  // Optional entrance / hover animation of the whole block.
  const blockAnimation =
    c.blockAnimation && typeof c.blockAnimation === "object"
      ? elementRules(`[data-block-style="${scope}"]`, "block", c.blockAnimation as StyleValues).join("")
      : "";
  if (!color && !image && !textColor && !elementCss && !spacingRules && !sizeRules && !blockAnimation && !link && !variant)
    return <>{children}</>;
  return (
    <div
      data-block-style={scope}
      data-block-variant={variant}
      data-link-live={link && !editing ? "" : undefined}
      // overflow-clip (not hidden) keeps "sticky" elements working inside.
      className="relative isolate overflow-clip"
      style={color || textColor ? { ...(color ? { backgroundColor: color } : {}), ...(textColor ? { color: textColor } : {}) } : undefined}
    >
      {link ? <LinkSurface link={link} editing={editing} language={language} /> : null}
      {spacingRules ? <style>{spacingRules}</style> : null}
      {sizeRules ? <style>{sizeRules}</style> : null}
      {blockAnimation ? <style>{blockAnimation}</style> : null}
      {fontsHref ? <link rel="stylesheet" href={fontsHref} precedence="default" /> : null}
      {image ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center"
          style={{
            backgroundImage: `url("${image.replace(/["\\\n]/g, encodeURIComponent)}")`,
            opacity,
          }}
        />
      ) : null}
      {textColor ? (
        <style>{`[data-block-style="${scope}"] :is(h1,h2,h3,h4,h5,h6,p,li,dt,dd,blockquote,figcaption):not(a *,button *){color:${textColor}}`}</style>
      ) : null}
      {elementCss ? <style>{elementCss}</style> : null}
      {children}
    </div>
  );
}

function Action({
  label,
  href,
  secondary = false,
  el,
}: {
  label: string;
  href?: string;
  secondary?: boolean;
  el?: string;
}) {
  const safe = safeHref(href);
  if (!label || !safe) return null;
  const classes = secondary
    ? "border border-white/50 bg-white/10 text-white hover:bg-white/20"
    : "border border-slate-200 bg-white text-slate-900 shadow-[0_16px_30px_-18px_rgba(15,23,42,.7)] hover:bg-amber-50";
  return (
    <a
      href={safe}
      data-el={el}
      className={`wb-btn ${secondary ? "wb-btn-secondary " : ""}inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors ${classes}`}
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
  const extras = React.useContext(BlockExtrasContext);
  const editingPreview = React.useContext(BlockEditingContext);
  // Every repeated item (card, figure, question…) and its parts can be
  // selected and styled in the builder, one by one or all together ("card").
  const itemEl = (index: number, part?: string) => ({
    "data-el": part ? `item:${index}:${part}` : `item:${index}`,
    "data-el-shared": part ? `card:${part}` : "card",
  });
  // "Lien au clic" of a card: the whole card becomes clickable.
  const cardLink = (item: Content) => resolveLink(item.link, website, pageLink, language);
  const cardLinkAttributes = (item: Content) =>
    cardLink(item) && !editingPreview ? { "data-link-live": "" } : {};
  const cardLinkSurface = (item: Content) => {
    const link = cardLink(item);
    return link ? <LinkSurface link={link} editing={editingPreview} language={language} /> : null;
  };
  const itemText = (item: Content, base: string, fallback = "") =>
    text(item, `${base}_${language}`, text(item, base, fallback));
  // Grid blocks can be shown as a carousel instead (builder option).
  const asCarousel = c.itemsLayout === "carousel";
  const itemsLayout = (className: string, nodes: React.ReactNode[]) =>
    asCarousel ? (
      <div className="mt-10">
        <WebsiteSlider
          el="items"
          settings={c.itemsCarousel}
          slides={nodes}
          language={language}
          editing={editingPreview}
        />
      </div>
    ) : (
      <div data-el="items" className={className}>
        {nodes}
      </div>
    );
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
  // Congo Omega can receive public messages through its verified domain even
  // before the owner has completed every optional identity field in the
  // builder. Keep the contact path usable instead of hiding the form.
  const contactEmail =
    website.contact_email ??
    (contactDomain?.replace(/^www\./i, "").toLowerCase() === "congoomega.com"
      ? "contact@congoomega.com"
      : null);
  // The editor stores friendly paths such as /contact. In the LiteHubs preview
  // they must stay inside this company website rather than open product pages.
  const websiteHref = (value: string) => {
    if (value === "/rendezvous" || value === "/rendez-vous") {
      return appointmentHref(website);
    }
    const match = value.match(
      /^\/(notre-entreprise|activites|projets|impact|carrieres|contact)$/,
    );
    return match ? pageLink(match[1]!) : value;
  };

  switch (section.section_type) {
    case "hero":
      return (
        <section className="mx-auto max-w-[1500px] px-3 pt-3 sm:px-6 sm:pt-6 lg:px-8">
          <div className="wb-hero relative isolate min-h-[590px] overflow-hidden rounded-[2rem] bg-slate-950 text-white shadow-[0_36px_80px_-46px_rgba(15,23,42,.88)] sm:min-h-[650px] sm:rounded-[2.5rem]">
            {source ? (
              <img
                src={source}
                alt={heading || website.display_name}
                className="wb-hero-img absolute inset-0 -z-30 size-full object-cover"
              />
            ) : null}
            <div className="wb-hero-shade absolute inset-0 -z-20 bg-gradient-to-r from-slate-950/[.94] via-slate-950/[.66] to-slate-950/[.14]" />
            <div className="wb-hero-ring absolute -right-24 top-0 -z-10 size-[28rem] rounded-full border border-white/10" />
            <div className="wb-hero-ring absolute -right-10 top-12 -z-10 size-[19rem] rounded-full border border-white/15" />
            <div className="wb-hero-grid grid min-h-[590px] items-end gap-8 p-7 pb-9 sm:min-h-[650px] sm:p-12 sm:pb-12 lg:grid-cols-[minmax(0,1fr)_270px] lg:p-16 lg:pb-14">
              <motion.div
                className="wb-hero-text flex max-w-3xl flex-col items-start"
                initial={reduceMotion ? false : { opacity: 0, y: 22 }}
                animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                transition={{ duration: 0.68, ease: [0.22, 1, 0.36, 1] }}
              >
                {eyebrow ? (
                  <p data-el="eyebrow" className="mb-5 inline-flex rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[.17em] text-amber-50 backdrop-blur">
                    <TextLink name="eyebrow"><AnimatedText name="eyebrow" text={eyebrow} /></TextLink>
                  </p>
                ) : null}
                <h1 data-el="title" className="text-4xl font-semibold leading-[.98] tracking-[-.055em] sm:text-6xl lg:text-7xl">
                  <TextLink name="title"><AnimatedText name="title" text={heading || website.display_name} /></TextLink>
                </h1>
                {body ? (
                  <p data-el="body" className="mt-6 max-w-2xl text-base leading-7 text-white/78 sm:text-lg sm:leading-8">
                    <TextLink name="body"><AnimatedText name="body" text={body} /></TextLink>
                  </p>
                ) : website.tagline ? (
                  <p data-el="body" className="mt-6 max-w-2xl text-base leading-7 text-white/78 sm:text-lg sm:leading-8">
                    {website.tagline}
                  </p>
                ) : null}
                <div data-el="buttons" className="mt-8 flex flex-wrap gap-3">
                  <Action
                    el="primaryButton"
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
                    el="secondaryButton"
                  />
                </div>
                <div data-el="badges" className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3 text-xs font-medium text-white/78">
                  {(
                    [
                      ["badge1", "Production locale", "Local production"],
                      ["badge2", "Équipes engagées", "Committed teams"],
                      ["badge3", "Impact suivi", "Tracked impact"],
                    ] as const
                  ).map(([key, defaultFr, defaultEn], badgeIndex) => {
                    // The owner can rename or empty each badge in the builder.
                    const stored = c[`${key}${language === "fr" ? "Fr" : "En"}`];
                    const label =
                      typeof stored === "string"
                        ? stored
                        : language === "fr"
                          ? defaultFr
                          : defaultEn;
                    if (!label.trim()) return null;
                    return (
                      <span key={key} className="inline-flex items-center gap-2">
                        {badgeIndex === 0 ? (
                          <span className="flex size-5 items-center justify-center rounded-full bg-emerald-300/15 text-emerald-100">
                            <Sprout className="size-3" />
                          </span>
                        ) : (
                          <span
                            className={`size-1.5 rounded-full ${badgeIndex === 1 ? "bg-amber-300" : "bg-sky-300"}`}
                          />
                        )}
                        {label}
                      </span>
                    );
                  })}
                </div>
                {extras}
              </motion.div>
              <motion.div
                className="wb-hero-side relative hidden min-h-[280px] lg:block"
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
                        alt={`${heading || website.display_name} — ${language === "fr" ? "au cœur de l’action" : "at the heart of the work"}`}
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
                        alt={`${heading || website.display_name} — ${language === "fr" ? "équipe et terrain" : "team and field work"}`}
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
    case "container":
      if (c.divMode === true) {
        // A Div block is one single box: no band, no inner zone. Its own
        // style (canvas) sets width, height, background, border, padding…
        const divLink = resolveLink(c.blockLink, website, pageLink, language);
        return (
          <div
            data-el="canvas"
            data-el-kind="group"
            data-link-live={divLink && !editingPreview ? "" : undefined}
            className="wb-div relative flex flex-col [&>*]:mt-0"
          >
            {divLink ? <LinkSurface link={divLink} editing={editingPreview} language={language} /> : null}
            {extras}
          </div>
        );
      }
      // A free block (old format): only the elements the owner placed in it.
      return (
        <section className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8 sm:py-16">
          <div
            data-el="canvas"
            data-el-kind="group"
            className="flex min-h-24 flex-col items-start gap-5 [&>*]:mt-0"
          >
            {extras}
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
          <div data-el="panel" className="rounded-[2rem] bg-[#f1f7f1] px-5 py-12 sm:px-10 sm:py-16 lg:px-14">
            <SectionHeading eyebrow={eyebrow} title={heading} body={body} />{" "}
            {itemsLayout(
              "mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3",
              cards.map((item, index) => {
                const tag = itemText(item, "tag", "IMPACT");
                const linkLabel = itemText(item, "link", language === "fr" ? "Découvrir" : "Explore");
                const linkHref = safeHref(websiteHref(text(item, "href")));
                const linkClass =
                  "mt-6 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[.13em]";
                return (
                  <article
                    key={`${text(item, "title")}-${index}`}
                    {...itemEl(index)}
                    {...cardLinkAttributes(item)}
                    className="group h-full rounded-3xl border border-white/80 bg-white p-6 shadow-[0_18px_45px_-34px_rgba(15,23,42,.65)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_25px_48px_-30px_rgba(15,23,42,.42)]"
                  >
                    {cardLinkSurface(item)}
                    <div className="mb-7 flex items-start justify-between">
                      {item.hideNumber === true ? (
                        <span />
                      ) : (
                        <div
                          {...itemEl(index, "number")}
                          className="flex size-11 items-center justify-center rounded-2xl bg-emerald-50 text-sm font-bold"
                          style={{ color: "var(--website-primary)" }}
                        >
                          {String(index + 1).padStart(2, "0")}
                        </div>
                      )}
                      {tag ? (
                        <span {...itemEl(index, "tag")} className="text-[11px] font-bold tracking-[.15em] text-emerald-900/30">
                          {tag}
                        </span>
                      ) : null}
                    </div>
                    <h3 {...itemEl(index, "title")} className="text-xl font-semibold tracking-[-.025em] text-slate-950">
                      <AnimatedText name={`item:${index}:title`} shared="card:title" text={itemText(item, "title")} />
                    </h3>
                    <p {...itemEl(index, "body")} className="mt-3 text-sm leading-6 text-slate-600">
                      <AnimatedText name={`item:${index}:body`} shared="card:body" text={itemText(item, "body")} />
                    </p>
                    {linkLabel ? (
                      linkHref ? (
                        <a {...itemEl(index, "link")} href={linkHref} className={linkClass} style={{ color: "var(--website-primary)" }}>
                          {linkLabel}
                          <ArrowRight className="size-3.5 transition group-hover:translate-x-1" />
                        </a>
                      ) : (
                        <span {...itemEl(index, "link")} className={linkClass} style={{ color: "var(--website-primary)" }}>
                          {linkLabel}
                          <ArrowRight className="size-3.5 transition group-hover:translate-x-1" />
                        </span>
                      )
                    ) : null}
                  </article>
                );
              }),
            )}
          </div>
        </section>
      );
    }
    case "metrics":
      return (
        <section className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8 sm:py-16">
          <div
            data-el="panel"
            className="wb-metrics-panel overflow-hidden rounded-[2rem] px-5 py-12 text-white sm:px-10 sm:py-16 lg:px-14"
          >
            <SectionHeading
              eyebrow={eyebrow}
              title={heading}
              body={body}
              inverted
            />
            {itemsLayout(
              "mt-10 grid gap-px overflow-hidden rounded-2xl border border-white/15 bg-white/15 sm:grid-cols-2 lg:grid-cols-4",
              list(c, "items").map((item, index) => (
                <div
                  key={`${text(item, "label")}-${index}`}
                  {...itemEl(index)}
                  {...cardLinkAttributes(item)}
                  className="wb-metric h-full bg-[color-mix(in_srgb,var(--website-primary)_88%,#001b18)] p-6 sm:p-7"
                >
                  {cardLinkSurface(item)}
                  <p {...itemEl(index, "value")} className="text-4xl font-semibold tracking-[-.05em] text-amber-100">
                    {text(item, "value")}
                  </p>
                  <p {...itemEl(index, "label")} className="mt-2 text-sm leading-5 text-white/75">
                    <AnimatedText name={`item:${index}:label`} shared="card:label" text={itemText(item, "label")} />
                  </p>
                </div>
              )),
            )}
          </div>
        </section>
      );
    case "image_callout":
      return (
        <section className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8 sm:py-16">
          <div data-el="panel" className="grid overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_24px_55px_-46px_rgba(15,23,42,.6)] lg:grid-cols-[1.02fr_.98fr]">
            <div data-el="media" className="relative min-h-[300px] bg-slate-200 lg:min-h-[480px]">
              {source ? (
                <img
                  src={source}
                  alt={heading || website.display_name}
                  className="absolute inset-0 size-full object-cover"
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-tr from-emerald-950/25 via-transparent to-amber-300/15" />
            </div>
            <div className="wb-callout-text flex items-center p-7 sm:p-12 lg:p-16">
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
                    el="primaryButton"
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
          {itemsLayout(
            "mt-10 grid grid-cols-2 gap-3 md:grid-cols-4",
            list(c, "items").map((item, index) => {
              const image = safeImage(text(item, "image"));
              const caption = itemText(item, "caption");
              return (
                <figure
                  key={`${caption}-${index}`}
                  {...itemEl(index)}
                  {...cardLinkAttributes(item)}
                  className={`wb-gallery-item group relative h-full overflow-hidden rounded-3xl bg-slate-200 ${index === 0 && !asCarousel ? "col-span-2 row-span-2" : ""}`}
                >
                  {cardLinkSurface(item)}
                  {image ? (
                    <img
                      {...itemEl(index, "image")}
                      src={image}
                      alt={caption || `${heading || website.display_name} — ${index + 1}`}
                      className="aspect-square size-full object-cover transition duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="aspect-square" />
                  )}
                  {caption ? (
                    <figcaption {...itemEl(index, "caption")} className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/75 to-transparent px-4 pb-4 pt-12 text-sm font-medium text-white">
                      {caption}
                    </figcaption>
                  ) : null}
                </figure>
              );
            }),
          )}
        </section>
      );
    case "faq":
      return (
        <section className="wb-faq mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-24">
          <SectionHeading
            eyebrow={eyebrow}
            title={heading}
            body={body}
            centered
          />
          <div data-el="items" className="mt-10 divide-y divide-slate-200 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_45px_-38px_rgba(15,23,42,.45)]">
            {list(c, "items").map((item, index) => (
              <details
                key={`${text(item, "question")}-${index}`}
                {...itemEl(index)}
                className="group p-5 sm:p-7"
              >
                <summary {...itemEl(index, "question")} className="flex cursor-pointer list-none items-center justify-between gap-5 font-semibold text-slate-900">
                  {itemText(item, "question")}
                  <ChevronDown className="size-5 shrink-0 text-emerald-700 transition group-open:rotate-180" />
                </summary>
                <p {...itemEl(index, "answer")} className="mt-4 max-w-3xl text-sm leading-6 text-slate-600">
                  {itemText(item, "answer")}
                </p>
              </details>
            ))}
          </div>
        </section>
      );
    case "cta":
      return (
        <section className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8 sm:py-16">
          <div data-el="panel" className="relative overflow-hidden rounded-[2rem] bg-slate-950 px-7 py-12 text-white shadow-[0_28px_56px_-42px_rgba(15,23,42,.8)] sm:px-12 sm:py-16">
            <div className="wb-cta-deco absolute -right-24 -top-40 size-[32rem] rounded-full bg-[var(--website-accent)] opacity-20 blur-3xl" />
            <div className="wb-cta-deco absolute -bottom-36 left-1/2 size-[24rem] rounded-full border border-white/10" />
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
                  el="primaryButton"
                />
              </div>
            </div>
          </div>
        </section>
      );
    case "careers":
      return (
        <section className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8 sm:py-16">
          <div data-el="panel" className="grid gap-8 rounded-[2rem] bg-[#fff8e7] px-6 py-12 sm:px-12 sm:py-16 lg:grid-cols-[1fr_auto] lg:items-end">
            <SectionHeading eyebrow={eyebrow} title={heading} body={body} />
            <div data-el="sideCard" className="rounded-3xl border border-amber-200/80 bg-white p-6 shadow-[0_18px_42px_-34px_rgba(120,53,15,.45)]">
              <Sparkles className="size-6 text-amber-700" />
              <p data-el="sideText" className="mt-5 max-w-[250px] text-sm leading-6 text-slate-600">
                <TextLink name="sideText">{text(
                  c,
                  language === "fr" ? "side_text_fr" : "side_text_en",
                  language === "fr"
                    ? "Des opportunités sérieuses pour les personnes prêtes à agir sur le terrain."
                    : "Meaningful opportunities for people ready to make an impact on the ground.",
                )}</TextLink>
              </p>
              <a
                data-el="sideLink"
                href={careersHref(website)}
                className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-amber-800 hover:text-amber-950"
              >
                {text(
                  c,
                  language === "fr" ? "label_fr" : "label_en",
                  t.careers,
                )}
                <ArrowRight className="size-4" />
              </a>
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
          <div data-el="panel" className="rounded-[2rem] bg-slate-950 px-6 py-12 text-white sm:px-12 sm:py-16">
            <div className="grid gap-10 lg:grid-cols-[.92fr_1.08fr]">
              <div>
                <SectionHeading
                  eyebrow={eyebrow}
                  title={heading || t.contact}
                  body={body || website.tagline || ""}
                  inverted
                />
                <p data-el="sideText" className="mt-8 text-sm font-medium text-amber-100">
                  <TextLink name="sideText">{text(
                    c,
                    language === "fr" ? "side_text_fr" : "side_text_en",
                    language === "fr"
                      ? "Une équipe vous répond dans le bon contexte."
                      : "A team will respond in the right context.",
                  )}</TextLink>
                </p>
                <div data-el="buttons" className="mt-7 flex flex-wrap gap-3">
                  <Action
                    label={text(
                      c,
                      language === "fr" ? "label_fr" : "label_en",
                      language === "fr"
                        ? "Prendre rendez-vous"
                        : "Book an appointment",
                    )}
                    href={websiteHref(text(c, "href", "/rendezvous"))}
                    el="primaryButton"
                  />
                  {contactEmail ? (
                    <a
                      data-el="secondaryButton"
                      href={`mailto:${contactEmail}`}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/25 bg-white/10 px-5 text-sm font-semibold text-white transition hover:bg-white/18"
                    >
                      <Mail className="size-4" />
                      {language === "fr" ? "Écrire un e-mail" : "Send an email"}
                    </a>
                  ) : null}
                </div>
              </div>
              <div className="space-y-5">
                <div data-el="items" className="grid gap-3 sm:grid-cols-2">
                  {contactEmail ? (
                    <ContactItem
                      icon={Mail}
                      label={t.email}
                      value={contactEmail}
                      href={`mailto:${contactEmail}`}
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
                {contactEmail ? (
                  <PublicContactForm
                    contactEmail={contactEmail}
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
  const extras = React.useContext(BlockExtrasContext);
  return (
    <div
      className={
        centered
          ? "wb-heading mx-auto flex max-w-3xl flex-col items-center text-center"
          : "wb-heading flex max-w-3xl flex-col items-start"
      }
    >
      {eyebrow ? (
        <p
          data-el="eyebrow"
          className={`mb-3 text-xs font-bold uppercase tracking-[.18em] ${inverted ? "text-amber-100/70" : "text-emerald-700"}`}
        >
          <TextLink name="eyebrow"><AnimatedText name="eyebrow" text={eyebrow} /></TextLink>
        </p>
      ) : null}
      {title ? (
        <h2
          data-el="title"
          className={`text-3xl font-semibold leading-[1.08] tracking-[-.035em] sm:text-4xl lg:text-[2.7rem] ${inverted ? "text-white" : "text-slate-950"}`}
        >
          <TextLink name="title"><AnimatedText name="title" text={title} /></TextLink>
        </h2>
      ) : null}
      {body ? (
        <p
          data-el="body"
          className={`mt-5 text-base leading-7 sm:text-[1.05rem] ${inverted ? "text-white/75" : "text-slate-600"}`}
        >
          <TextLink name="body"><AnimatedText name="body" text={body} /></TextLink>
        </p>
      ) : null}
      {extras}
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
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
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
    const values = new FormData(form);
    const name = String(values.get("name") ?? "").trim();
    const email = String(values.get("email") ?? "").trim();
    const phone = String(values.get("phone") ?? "").trim();
    const subject = String(values.get("subject") ?? "").trim();
    const message = String(values.get("message") ?? "").trim();
    const clientErrors: Record<string, string[]> = {};
    if (name.length < 2) clientErrors.fullName = [french ? "Saisissez votre nom complet (au moins 2 caractères)." : "Enter your full name (at least 2 characters)."];
    if (!/^\S+@\S+\.\S+$/.test(email)) clientErrors.email = [french ? "Saisissez une adresse e-mail valide." : "Enter a valid email address."];
    if (subject.length < 3) clientErrors.subject = [french ? "Saisissez un objet d’au moins 3 caractères." : "Enter a subject of at least 3 characters."];
    if (message.length < 5) clientErrors.message = [french ? "Votre message doit contenir au moins 5 caractères." : "Your message must contain at least 5 characters."];
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      setError(french ? "Vérifiez les champs signalés ci-dessous." : "Please check the highlighted fields below.");
      setState("error");
      return;
    }
    setFieldErrors({});
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
        setFieldErrors(requestError instanceof ApiError ? requestError.fieldErrors : {});
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
  const fieldClassFor = (field: string) =>
    fieldErrors[field]?.[0]
      ? `${fieldClass} border-rose-300 bg-rose-950/30 focus:border-rose-200 focus:ring-rose-200/20`
      : fieldClass;

  return (
    <form
      noValidate
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
        <label className={`text-xs font-semibold ${fieldErrors.fullName?.[0] ? "text-rose-100" : "text-white/80"}`}>
          {french ? "Nom complet" : "Full name"} *
          <input className={fieldClassFor("fullName")} name="name" autoComplete="name" minLength={2} maxLength={150} required aria-invalid={Boolean(fieldErrors.fullName?.[0])} />
          {fieldErrors.fullName?.[0] ? <span className="mt-1 block text-xs font-medium text-rose-100">{fieldErrors.fullName[0]}</span> : null}
        </label>
        <label className="text-xs font-semibold text-white/80">
          {french ? "Téléphone" : "Phone"}
          <input className={fieldClassFor("phone")} name="phone" type="tel" autoComplete="tel" maxLength={40} aria-invalid={Boolean(fieldErrors.phone?.[0])} />
          {fieldErrors.phone?.[0] ? <span className="mt-1 block text-xs font-medium text-rose-100">{fieldErrors.phone[0]}</span> : null}
        </label>
        <label className={`text-xs font-semibold ${fieldErrors.email?.[0] ? "text-rose-100" : "text-white/80"}`}>
          {french ? "E-mail" : "Email"} *
          <input className={fieldClassFor("email")} name="email" type="email" autoComplete="email" maxLength={255} required aria-invalid={Boolean(fieldErrors.email?.[0])} />
          {fieldErrors.email?.[0] ? <span className="mt-1 block text-xs font-medium text-rose-100">{fieldErrors.email[0]}</span> : null}
        </label>
        <label className={`text-xs font-semibold ${fieldErrors.subject?.[0] ? "text-rose-100" : "text-white/80"}`}>
          {french ? "Objet" : "Subject"} *
          <input className={fieldClassFor("subject")} name="subject" minLength={3} maxLength={180} required aria-invalid={Boolean(fieldErrors.subject?.[0])} />
          {fieldErrors.subject?.[0] ? <span className="mt-1 block text-xs font-medium text-rose-100">{fieldErrors.subject[0]}</span> : null}
        </label>
        <label className={`text-xs font-semibold sm:col-span-2 ${fieldErrors.message?.[0] ? "text-rose-100" : "text-white/80"}`}>
          {french ? "Votre message" : "Your message"} *
          <textarea
            className={`${fieldClassFor("message")} min-h-28 py-3`}
            name="message"
            minLength={5}
            maxLength={4000}
            required
            rows={5}
            aria-invalid={Boolean(fieldErrors.message?.[0])}
          />
          {fieldErrors.message?.[0] ? <span className="mt-1 block text-xs font-medium text-rose-100">{fieldErrors.message[0]}</span> : null}
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

/** Builder-only labels of the global zones. */
export const ZONE_LABELS: Record<ZoneName, [string, string]> = {
  topbar: ["Barre supérieure (top bar)", "Top bar"],
  header: ["En-tête (header)", "Header"],
  footer: ["Pied de page (footer)", "Footer"],
};

/**
 * One global zone (top bar, header or footer), rendered like a free block:
 * Zone → Conteneur → Élément. The builder and the live site share it.
 */
function SiteZoneView({
  name,
  zone,
  look,
  links,
  website,
  pageLink,
  language,
  editing,
  editor,
}: {
  name: ZoneName;
  zone: ZoneData;
  look: string;
  links: string;
  website: PublicWebsite;
  pageLink: (slug: string) => string;
  language: Language;
  editing: boolean;
  editor?: WebsiteEditorBridge;
}) {
  const section: WebsiteSection = {
    id: `zone-${name}`,
    section_type: "container",
    content: zone.content,
    sort_order: 0,
  };
  const Tag = name === "header" ? "header" : name === "footer" ? "footer" : "div";
  const body = (
    <BlockStylesProvider styles={section.content.elementStyles}>
      <ElementLinkContext.Provider
        value={{ resolve: () => null, editing, language }}
      >
        <BlockEditingContext.Provider value={editing}>
          <ZoneNameContext.Provider value={name}>
            <SectionBackdrop
              section={section}
              index={0}
              scope={`z-${name}`}
              editing={editing}
              language={language}
              // The header keeps its row (its menu becomes a menu button);
              // the top bar and the footer stack into one column on phones.
              stack={name === "header" ? [] : ["canvas"]}
            >
              <div className="wb-zone-inner">
                <div data-el="canvas" data-el-kind="group" className="min-w-0">
                  <BlockExtras
                    section={section}
                    language={language}
                    website={website}
                    pageLink={pageLink}
                    editing={editing}
                  />
                </div>
              </div>
            </SectionBackdrop>
          </ZoneNameContext.Provider>
        </BlockEditingContext.Provider>
      </ElementLinkContext.Provider>
    </BlockStylesProvider>
  );
  const sticky = name === "header" && zone.sticky !== false;
  return (
    <Tag
      data-zone={name}
      data-look={look}
      data-links={links}
      data-sticky={sticky ? "" : undefined}
      data-width={zone.content.zoneWidth === "full" ? "full" : undefined}
      // Colours chosen for the zone also reach its mobile menu panel.
      style={
        {
          ...(hexColor(zone.content.blockBackgroundColor)
            ? { "--zone-bg": hexColor(zone.content.blockBackgroundColor) }
            : {}),
          ...(hexColor(zone.content.blockTextColor)
            ? { "--zone-fg": hexColor(zone.content.blockTextColor) }
            : {}),
        } as React.CSSProperties
      }
    >
      {editing && editor ? (
        <div
          data-builder-section={section.id}
          role="button"
          tabIndex={0}
          aria-label={ZONE_LABELS[name][language === "fr" ? 0 : 1]}
          aria-pressed={editor.selectedSectionId === section.id}
          onClick={(event) => {
            event.stopPropagation();
            const element = (event.target as HTMLElement).closest("[data-el]")?.getAttribute("data-el");
            editor.onSelectSection(section.id, element ?? null, textHitOf(event.target as HTMLElement));
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              editor.onSelectSection(section.id, null);
            }
          }}
          className="group/builder relative cursor-pointer outline-none"
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 z-20 transition ${
              editor.selectedSectionId === section.id
                ? "border-[3px] border-violet-500"
                : "border-2 border-dashed border-violet-400/40 group-hover/builder:border-violet-500/80"
            }`}
          />
          <span
            className={`pointer-events-none absolute right-3 top-1 z-20 rounded-md px-2 py-0.5 text-[10px] font-semibold text-white shadow-md transition ${
              editor.selectedSectionId === section.id
                ? "bg-violet-600 opacity-100"
                : "bg-violet-700/85 opacity-0 group-hover/builder:opacity-100"
            }`}
          >
            {language === "fr" ? "Zone globale · " : "Global zone · "}
            {ZONE_LABELS[name][language === "fr" ? 0 : 1]}
          </span>
          {body}
        </div>
      ) : (
        body
      )}
    </Tag>
  );
}

export function PublicWebsiteRenderer({
  website,
  page,
  initialLanguage,
  pathPrefix,
  contactDomain,
  editor,
}: {
  website: PublicWebsite;
  page: PublicWebsitePage;
  initialLanguage?: Language;
  pathPrefix?: string;
  contactDomain?: string;
  editor?: WebsiteEditorBridge;
}) {
  const [language, setLanguage] = React.useState<Language>(
    initialLanguage ?? website.default_locale ?? "fr",
  );
  const [menuOpen, setMenuOpen] = React.useState(false);
  const siteRootRef = React.useRef<HTMLElement>(null);
  // Builder: show the selected element in the state being edited.
  const previewState = editor?.previewState ?? null;
  const previewSection = editor?.selectedSectionId ?? null;
  const previewElement = editor?.selectedElement ?? null;
  React.useEffect(() => {
    const root = siteRootRef.current;
    if (!root) return;
    root.querySelectorAll("[data-wb-state]").forEach((node) => node.removeAttribute("data-wb-state"));
    if (!previewState || !previewSection || !previewElement) return;
    const safe = (value: string) => value.replace(/["\\]/g, "");
    root
      .querySelectorAll(`[data-builder-section="${safe(previewSection)}"] [data-el="${safe(previewElement)}"]`)
      .forEach((node) => node.setAttribute("data-wb-state", previewState));
  });
  // "data-scrolled" lets a transparent header turn solid once the page moves.
  React.useEffect(() => {
    const root = siteRootRef.current;
    const view = root?.ownerDocument.defaultView;
    if (!root || !view) return;
    const update = () => {
      if (view.scrollY > 40) root.setAttribute("data-scrolled", "");
      else root.removeAttribute("data-scrolled");
    };
    update();
    view.addEventListener("scroll", update, { passive: true });
    return () => view.removeEventListener("scroll", update);
  }, []);
  // Page design from the builder's "Réglages de la page".
  const pageSettings = (page.settings ?? {}) as Record<string, unknown>;
  const headerVariant = ["minimal", "hidden"].includes(String(pageSettings.header))
    ? String(pageSettings.header)
    : "standard";
  const footerVariant = ["minimal", "hidden"].includes(String(pageSettings.footer))
    ? String(pageSettings.footer)
    : "standard";
  const pageCss = pageSettingsCss(pageSettings);
  // In the builder: "Édition" selects elements, "Aperçu" behaves like the site.
  const editing = Boolean(editor) && !editor?.preview;
  // Site design (theme + global zones). Sites without one keep the original
  // header and footer exactly as before.
  const design = readDesign(website.design);
  const zones = design.zones ?? {};
  const useZones = Boolean(zones.topbar || zones.header || zones.footer);
  const theme = design.theme && SITE_THEMES[design.theme] ? design.theme : undefined;
  const themeFonts = themeFontsHref(theme);
  const lookOf = (name: ZoneName) => zoneLookOf(name, zones[name], theme);
  // A block's own design, else the one of the site template.
  const variantOf = (section: WebsiteSection) =>
    validVariant(section.section_type, section.content.blockVariant) ??
    validVariant(section.section_type, design.blockVariants?.[section.section_type]);
  const elementLinkResolver = (section: WebsiteSection, editing: boolean) => {
    const links =
      section.content.elementLinks && typeof section.content.elementLinks === "object"
        ? (section.content.elementLinks as Record<string, unknown>)
        : {};
    return {
      resolve: (name: string) => resolveLink(links[name], website, pageLink, language),
      editing,
      language,
    };
  };
  const pageBackground = hexColor(pageSettings.background);
  const reduceMotion = useReducedMotion();
  const currentTitle = language === "fr" ? page.title_fr : page.title_en;
  const siteBase =
    pathPrefix === undefined
      ? `/sites/${website.organization_slug}`
      : pathPrefix.replace(/\/$/, "");
  // A branded domain is mapped by the Next edge proxy. Normal anchors force
  // that proxy to run on every navigation, avoiding client-router prefetches
  // that can otherwise miss the custom-host rewrite.
  const useDirectNavigation = pathPrefix === "";
  const WebsiteLink = ({
    href,
    ...props
  }: React.ComponentPropsWithoutRef<"a"> & { href: string }) =>
    useDirectNavigation ? <a href={href} {...props} /> : <Link href={href} {...props} />;
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
  // Pages shown in menus (a page can be published but kept out of them).
  const menuPages = website.navigation.filter((item) => item.in_menu !== false);
  const projectsHref = website.navigation.some(
    (item) => item.slug === "projets",
  )
    ? pageLink("projets")
    : "#contact";
  // On the branded domain this is /account. Congo Omega's private builder
  // preview uses its own explicit path so the owner can test the same journey
  // locally before publishing it.
  const isCongoOmega = ["congo-omega", "kins"].includes(
    website.organization_slug.toLowerCase(),
  );
  const publicAccountHref = contactDomain
    ? "/account"
    : isCongoOmega
      ? `${siteBase}/account`
      : null;
  // The packaged Congo Omega landing is only a safety net for a genuinely
  // empty home page. Once an owner has blocks in the builder, their order and
  // content are authoritative — even before they choose an image.
  const useCongoOmegaLanding =
    website.display_name.replace(/\s+/g, "").toLowerCase() === "congoomega" &&
    page.slug === "accueil" &&
    page.sections.length === 0;
  const visibleSections = useCongoOmegaLanding
    ? congoOmegaLandingSections
    : page.sections;
  // A transparent header lies over the first block when it is a full image
  // (hero); elsewhere it is drawn as a normal solid header.
  const firstSection = visibleSections.slice().sort((a, b) => a.sort_order - b.sort_order)[0];
  const headerShown = useZones && Boolean(zones.header) && headerVariant !== "hidden";
  const overlayHeader =
    headerShown &&
    lookOf("header") === "transparent" &&
    firstSection?.section_type === "hero" &&
    !["hero-split", "hero-minimal"].includes(variantOf(firstSection) ?? "");
  const zoneView = (name: ZoneName) => {
    const zone = zones[name]!;
    const look = lookOf(name);
    return (
      <SiteZoneView
        name={name}
        zone={zone}
        look={name === "header" && look === "transparent" && !overlayHeader ? "solid" : look}
        links={zoneLinksOf(zone, theme)}
        website={website}
        pageLink={pageLink}
        language={language}
        editing={editing}
        editor={editor}
      />
    );
  };
  const siteInfo: SiteRenderInfo = {
    displayName: website.display_name,
    tagline: website.tagline,
    logoUrl: safeImage(website.logo_url ?? undefined),
    contactEmail: website.contact_email,
    navigation: menuPages,
    pageLink,
    resolveHref: (value) => safeHref(resolveWebsiteHref(value.trim(), website, pageLink)),
    homeHref: pageLink(homeSlug),
    currentSlug: page.slug,
    language,
    setLanguage,
    editing,
    contactDomain,
  };
  return (
    <main
      ref={siteRootRef}
      data-site-root=""
      data-header-variant={headerVariant}
      data-footer-variant={footerVariant}
      className="relative min-h-screen bg-[#fbfcf8] text-slate-950"
      // In the visual builder, links and forms must not navigate away from
      // the page being edited. Buttons such as the language switch still work.
      onClickCapture={
        editing
          ? (event) => {
              if ((event.target as HTMLElement).closest("a")) event.preventDefault();
            }
          : editor
            ? (event) => {
                // Preview inside the builder: links work without leaving it.
                const anchor = (event.target as HTMLElement).closest("a");
                const href = anchor?.getAttribute("href");
                if (!anchor || !href) return;
                event.preventDefault();
                if (href.startsWith("#")) {
                  const target = anchor.ownerDocument.getElementById(decodeURIComponent(href.slice(1)));
                  target?.scrollIntoView({ behavior: "smooth", block: "start" });
                  return;
                }
                const page = website.navigation.find((item) => pageLink(item.slug) === href);
                if (page) {
                  editor.onNavigatePage?.(page.slug);
                  return;
                }
                if (/^(https?:|mailto:|tel:)/.test(href) || href.startsWith("/"))
                  window.open(href, "_blank", "noopener,noreferrer");
              }
            : undefined
      }
      onSubmitCapture={editor ? (event) => event.preventDefault() : undefined}
      data-builder-canvas={editing ? "" : undefined}
      data-theme={theme}
      data-anim-preview={editor ? "" : undefined}
      data-overlay-header={overlayHeader ? "" : undefined}
      style={
        {
          ...(pageBackground ? { backgroundColor: pageBackground } : {}),
          // A site theme brings its own colours.
          ...(theme
            ? {}
            : {
                "--website-primary": website.primary_color || "#075c4d",
                "--website-accent": website.accent_color || "#e9a43a",
              }),
        } as React.CSSProperties
      }
    >
      <SiteRenderContext.Provider value={siteInfo}>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_8%_20%,rgba(16,185,129,.09),transparent_26%),radial-gradient(circle_at_94%_42%,rgba(245,158,11,.08),transparent_28%)]" />
      {useZones ? (
        overlayHeader ? (
          <div data-zone-overlay="" data-sticky={zones.header!.sticky !== false ? "" : undefined}>
            {zones.topbar && !zones.topbar.hidden && headerVariant === "standard" ? zoneView("topbar") : null}
            {zoneView("header")}
          </div>
        ) : (
          <>
            {zones.topbar && !zones.topbar.hidden && headerVariant === "standard" ? zoneView("topbar") : null}
            {headerShown ? zoneView("header") : null}
          </>
        )
      ) : headerVariant === "hidden" ? null : (
      <header className="sticky top-0 z-30 px-3 sm:px-5 lg:px-8">
        <div className="mx-auto max-w-[1500px]">
          <div className="wb-topbar hidden min-h-10 items-center justify-between gap-5 rounded-t-[1.35rem] bg-slate-950 px-5 text-[11px] font-medium text-white lg:flex xl:px-7">
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
              <WebsiteLink
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 font-semibold text-amber-100 transition hover:bg-white/16 hover:text-white"
                href={careersHref(website)}
              >
                <BriefcaseBusiness className="size-3" />
                {language === "fr" ? "Nous rejoindre" : "Join us"}
              </WebsiteLink>
              {publicAccountHref ? (
                <a
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 font-semibold text-white/88 transition hover:bg-white/16 hover:text-white"
                  href={publicAccountHref}
                >
                  <UserRound className="size-3" />
                  {language === "fr" ? "Mon compte" : "My account"}
                </a>
              ) : null}
            </div>
          </div>
          <div className="flex min-h-[70px] items-center justify-between gap-4 rounded-[1.35rem] border border-slate-200/80 bg-white/92 px-4 shadow-[0_20px_42px_-30px_rgba(15,23,42,.55)] backdrop-blur-xl sm:min-h-[76px] sm:px-6 lg:rounded-t-none lg:px-7 xl:px-9">
            <WebsiteLink
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
                    alt={`${website.display_name} — ${language === "fr" ? "logo" : "logo"}`}
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
            </WebsiteLink>
            <nav className="hidden items-center gap-1 xl:flex">
              {menuPages.map((item) => (
                <WebsiteLink
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
                </WebsiteLink>
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
              <div className="flex items-center gap-2">
                {publicAccountHref ? (
                  <a
                    href={publicAccountHref}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-[13px] font-semibold text-slate-800 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <UserRound className="size-3.5" />
                    {language === "fr" ? "Mon compte" : "My account"}
                  </a>
                ) : null}
                <a
                  href="#contact"
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-[13px] font-semibold text-white shadow-[0_16px_28px_-18px_rgba(15,23,42,.85)] transition hover:-translate-y-0.5 hover:bg-slate-800"
                >
                  {copy[language].contact}
                  <ArrowUpRight className="size-3.5" />
                </a>
              </div>
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
      )}
      {menuOpen ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#fbfcf8] p-5 lg:hidden">
          <div className="flex items-center justify-between">
            <WebsiteLink
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
                    alt={`${website.display_name} — ${language === "fr" ? "logo" : "logo"}`}
                    className="size-full rounded-xl object-cover"
                  />
                ) : (
                  website.display_name.slice(0, 2).toUpperCase()
                )}
              </span>
              {website.display_name}
            </WebsiteLink>
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
            {menuPages.map((item) => (
              <WebsiteLink
                key={item.slug}
                onClick={() => setMenuOpen(false)}
                href={pageLink(item.slug)}
                className={`rounded-2xl border px-5 py-4 font-medium ${item.slug === page.slug ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-white text-slate-900"}`}
              >
                {language === "fr" ? item.label_fr : item.label_en}
              </WebsiteLink>
            ))}
            {publicAccountHref ? (
              <a
                href={publicAccountHref}
                onClick={() => setMenuOpen(false)}
                className="mt-2 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-semibold text-emerald-950"
              >
                <UserRound className="size-4" />
                {language === "fr" ? "Mon compte client" : "My customer account"}
              </a>
            ) : null}
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
      <style>{SITE_RESPONSIVE_CSS + MOTION_CSS + LINK_CSS + ZONE_CSS + themeCss(theme) + VARIANT_CSS + pageCss}</style>
      {themeFonts ? <link rel="stylesheet" href={themeFonts} precedence="default" /> : null}
      <AnimationRuntime rootRef={siteRootRef} replayKey={editor?.replayKey} preview={Boolean(editor)} />
      {editing && editor ? (
        <style>{`[data-builder-section] [data-el-kind="group"]{outline:1px dashed rgba(14,165,233,.45);outline-offset:3px}[data-builder-section] [data-el]{cursor:pointer}[data-builder-section] [data-el]:hover{outline:2px dashed rgba(14,165,233,.75);outline-offset:4px}${
          editor.selectedSectionId && editor.selectedElement === "root"
            ? (() => {
                const id = editor.selectedSectionId.replace(/[^a-zA-Z0-9_-]/g, "");
                return `:is([data-builder-section="${id}"] > section,[data-builder-section="${id}"] > [data-block-style] > section){outline:3px solid #0ea5e9;outline-offset:-3px}`;
              })()
            : editor.selectedSectionId && editor.selectedElement
            ? `[data-builder-section="${editor.selectedSectionId.replace(/[^a-zA-Z0-9_-]/g, "")}"] [data-el="${editor.selectedElement.replace(/[^a-zA-Z0-9:-]/g, "")}"]{outline:3px solid #0ea5e9;outline-offset:4px}`
            : ""
        }`}</style>
      ) : null}
      <div aria-label={currentTitle} data-page-content="">
        {visibleSections
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((section, index) => (
            <motion.div
              key={section.id}
              // Anchor for "Aller vers une section" links (#mon-ancre).
              id={
                typeof section.content.anchor === "string" && /^[a-z0-9-]{1,60}$/.test(section.content.anchor)
                  ? section.content.anchor
                  : undefined
              }
              initial={
                reduceMotion || editor
                  ? false
                  : { opacity: 0, y: index === 0 ? 0 : 22 }
              }
              whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.16 }}
              transition={{
                duration: 0.52,
                delay: Math.min(index * 0.035, 0.18),
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {editing && editor && !useCongoOmegaLanding ? (
                <div
                  data-builder-section={section.id}
                  role="button"
                  tabIndex={0}
                  aria-label={editor.sectionLabel(section)}
                  aria-pressed={editor.selectedSectionId === section.id}
                  onClick={(event) => {
                    const element = (event.target as HTMLElement)
                      .closest("[data-el]")
                      ?.getAttribute("data-el");
                    editor.onSelectSection(section.id, element ?? null, textHitOf(event.target as HTMLElement));
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      editor.onSelectSection(section.id, null);
                    }
                  }}
                  className="group/builder relative cursor-pointer outline-none"
                >
                  {/* Drawn above the block so a background never hides it. */}
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-0 z-20 transition ${
                      editor.selectedSectionId === section.id
                        ? "border-[3px] border-sky-500"
                        : "border-2 border-transparent group-hover/builder:border-sky-400/70 group-focus-visible/builder:border-sky-500"
                    }`}
                  />
                  <span
                    className={`pointer-events-none absolute left-3 top-3 z-20 rounded-md px-2 py-1 text-[11px] font-semibold text-white shadow-md transition ${
                      editor.selectedSectionId === section.id
                        ? "bg-sky-600 opacity-100"
                        : "bg-slate-900/85 opacity-0 group-hover/builder:opacity-100"
                    }`}
                  >
                    {index + 1}. {editor.sectionLabel(section)}
                  </span>
                  <BlockStylesProvider styles={section.content.elementStyles}><ElementLinkContext.Provider value={elementLinkResolver(section, editing)}><BlockEditingContext.Provider value={editing}><BlockExtrasContext.Provider value={<BlockExtras section={section} language={language} website={website} pageLink={pageLink} editing={editing} />}><SectionBackdrop section={section} index={index} variant={variantOf(section)} link={resolveLink(section.content.blockLink, website, pageLink, language)} editing={editing} language={language}>
                    <PublicSection
                      section={section}
                      language={language}
                      website={website}
                      pageLink={pageLink}
                      contactDomain={contactDomain}
                    />
                  </SectionBackdrop></BlockExtrasContext.Provider></BlockEditingContext.Provider></ElementLinkContext.Provider></BlockStylesProvider>
                </div>
              ) : (
                <BlockStylesProvider styles={section.content.elementStyles}><ElementLinkContext.Provider value={elementLinkResolver(section, editing)}><BlockEditingContext.Provider value={editing}><BlockExtrasContext.Provider value={<BlockExtras section={section} language={language} website={website} pageLink={pageLink} editing={editing} />}><SectionBackdrop section={section} index={index} variant={variantOf(section)} link={resolveLink(section.content.blockLink, website, pageLink, language)} editing={editing} language={language}>
                  <PublicSection
                    section={section}
                    language={language}
                    website={website}
                    pageLink={pageLink}
                    contactDomain={contactDomain}
                  />
                </SectionBackdrop></BlockExtrasContext.Provider></BlockEditingContext.Provider></ElementLinkContext.Provider></BlockStylesProvider>
              )}
            </motion.div>
          ))}
      </div>
      {useZones ? (
        zones.footer && !zones.footer.hidden && footerVariant !== "hidden" ? (
          zoneView("footer")
        ) : null
      ) : footerVariant === "hidden" ? null : (
      <footer className="wb-footer mt-16 overflow-hidden bg-slate-950 px-5 pb-7 pt-14 text-white/65 sm:px-8 sm:pt-20">
        <div className="wb-footer-main mx-auto grid max-w-[1400px] gap-12 lg:grid-cols-[1.25fr_.8fr_.9fr_1.1fr]">
          <div>
            <WebsiteLink
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
                    alt={`${website.display_name} — ${language === "fr" ? "logo" : "logo"}`}
                    className="size-full object-cover"
                  />
                ) : (
                  website.display_name.slice(0, 2).toUpperCase()
                )}
              </span>
              <span className="text-lg font-semibold tracking-[-.03em] text-white">
                {website.display_name}
              </span>
            </WebsiteLink>
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
              {menuPages.map((item) => (
                <WebsiteLink
                  key={item.slug}
                  href={pageLink(item.slug)}
                  className="group inline-flex w-fit items-center gap-1 text-sm transition hover:text-white"
                >
                  {language === "fr" ? item.label_fr : item.label_en}
                  <ArrowUpRight className="size-3 opacity-0 transition group-hover:opacity-100" />
                </WebsiteLink>
              ))}
            </nav>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[.16em] text-amber-200">
              {language === "fr" ? "Nous rejoindre" : "Join us"}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3 text-sm sm:grid-cols-1">
              <WebsiteLink
                href={careersHref(website)}
                className="inline-flex w-fit items-center gap-2 transition hover:text-white"
              >
                <BriefcaseBusiness className="size-4 text-amber-200" />
                {language === "fr" ? "Carrières" : "Careers"}
              </WebsiteLink>
              <a
                href="#contact"
                className="inline-flex w-fit items-center gap-2 transition hover:text-white"
              >
                <Mail className="size-4 text-amber-200" />
                {copy[language].contact}
              </a>
              <WebsiteLink
                href={projectsHref}
                className="inline-flex w-fit items-center gap-2 transition hover:text-white"
              >
                <Globe2 className="size-4 text-amber-200" />
                {language === "fr" ? "Nos projets" : "Our projects"}
              </WebsiteLink>
              {publicAccountHref ? (
                <a
                  href={publicAccountHref}
                  className="inline-flex w-fit items-center gap-2 transition hover:text-white"
                >
                  <UserRound className="size-4 text-amber-200" />
                  {language === "fr" ? "Mon compte" : "My account"}
                </a>
              ) : null}
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
            {publicAccountHref ? (
              <a className="inline-flex items-center gap-1.5 font-semibold text-amber-100 transition hover:text-white" href={publicAccountHref}>
                <UserRound className="size-3.5" />
                {language === "fr" ? "Mon compte" : "My account"}
              </a>
            ) : null}
            <WebsiteLink
              className="transition hover:text-white"
              href={careersHref(website)}
            >
              {language === "fr" ? "Carrières" : "Careers"}
            </WebsiteLink>
            <span className="text-white/30">•</span>
            <span>
              {language === "fr" ? "Site sécurisé" : "Secure website"}
            </span>
          </div>
        </div>
      </footer>
      )}
      </SiteRenderContext.Provider>
    </main>
  );
}
