"use client";

/**
 * Global zones of the public website (top bar, header, footer) and site
 * themes. A zone is edited like a free block: Zone → Conteneur → Élément,
 * stored in the site design (draft / published) and shown on every page.
 *
 * "Thème du site" changes colours, fonts, buttons, cards and the zones' look
 * for the whole site. "Modèle d'une zone" changes the layout of one zone.
 */

import * as React from "react";
import { Clock, Mail, MapPin, Menu as MenuIcon, Phone, X } from "lucide-react";
import { ApiError, post } from "@/lib/api";
import { BREAKPOINTS, WEBSITE_FONTS, type StyleValues } from "./website-element-style";

export type ZoneName = "topbar" | "header" | "footer";
export const ZONE_NAMES: ZoneName[] = ["topbar", "header", "footer"];

export type ZoneData = {
  template: string;
  hidden?: boolean;
  sticky?: boolean;
  /** Own look and link style; otherwise the site theme's. */
  look?: string;
  links?: string;
  content: Record<string, unknown>;
};

export type SiteDesign = {
  version?: number;
  theme?: string;
  /** Site template chosen (for display) and its block designs. */
  template?: string;
  blockVariants?: Record<string, string>;
  zones?: Partial<Record<ZoneName, ZoneData>>;
};

export function readDesign(raw: unknown): SiteDesign {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const design = raw as SiteDesign;
  const zones: Partial<Record<ZoneName, ZoneData>> = {};
  for (const name of ZONE_NAMES) {
    const zone = design.zones?.[name];
    if (zone && typeof zone === "object" && typeof zone.template === "string" && zone.content && typeof zone.content === "object")
      zones[name] = zone;
  }
  const blockVariants: Record<string, string> = {};
  if (design.blockVariants && typeof design.blockVariants === "object")
    for (const [type, variant] of Object.entries(design.blockVariants))
      if (typeof variant === "string" && /^[a-z-]{2,40}$/.test(variant)) blockVariants[type] = variant;
  return {
    version: 1,
    theme: typeof design.theme === "string" && SITE_THEMES[design.theme] ? design.theme : undefined,
    template: typeof design.template === "string" && /^[a-z-]{2,40}$/.test(design.template) ? design.template : undefined,
    blockVariants: Object.keys(blockVariants).length ? blockVariants : undefined,
    zones,
  };
}

/* ── Themes ─────────────────────────────────────────────────────────────── */

/** How a zone looks (its colours and shape), independent of its layout. */
export type ZoneLook =
  | "solid"
  | "glass"
  | "bordered"
  | "floating"
  | "transparent"
  | "dark"
  | "accent"
  | "light"
  | "line"
  | "minimal";
/** How the menu links of a zone look. */
export type LinkStyle = "plain" | "underline" | "pill" | "caps" | "dots";

export const ZONE_LOOKS: Record<ZoneName, Array<[ZoneLook, [string, string]]>> = {
  topbar: [
    ["dark", ["Sombre", "Dark"]],
    ["accent", ["Couleur principale", "Main colour"]],
    ["light", ["Clair", "Light"]],
    ["line", ["Discret (ligne)", "Subtle (line)"]],
  ],
  header: [
    ["solid", ["Plein", "Solid"]],
    ["glass", ["Verre (flou)", "Glass (blur)"]],
    ["bordered", ["Filet fin", "Thin line"]],
    ["floating", ["Flottant arrondi", "Floating rounded"]],
    ["transparent", ["Transparent sur l’image", "Transparent over image"]],
    ["dark", ["Sombre", "Dark"]],
  ],
  footer: [
    ["dark", ["Sombre", "Dark"]],
    ["light", ["Clair", "Light"]],
    ["accent", ["Couleur principale", "Main colour"]],
    ["minimal", ["Minimal (ligne)", "Minimal (line)"]],
  ],
};
export const LINK_STYLES: Array<[LinkStyle, [string, string]]> = [
  ["plain", ["Simple", "Plain"]],
  ["underline", ["Soulignement animé", "Animated underline"]],
  ["pill", ["Pastilles", "Pills"]],
  ["caps", ["Majuscules espacées", "Spaced capitals"]],
  ["dots", ["Séparés par des points", "Separated by dots"]],
];

export type SiteTheme = {
  label: [string, string];
  description: [string, string];
  /** Colours of the whole site. */
  primary: string;
  accent: string;
  background: string;
  surface: string;
  alt: string;
  text: string;
  muted: string;
  border: string;
  dark: string;
  darkText: string;
  headingFont: string;
  bodyFont: string;
  headingCase?: "none" | "uppercase";
  buttonRadius: number;
  buttonStyle: "solid" | "outline" | "soft";
  cardRadius: number;
  panelRadius: number;
  cardShadow: string;
  /** Default look of each zone and of the menu links. */
  looks: Record<ZoneName, ZoneLook>;
  links: LinkStyle;
  /** Zone templates that suit this theme (offered when it is chosen). */
  templates: Record<ZoneName, string>;
  hideTopbar?: boolean;
};

export const SITE_THEMES: Record<string, SiteTheme> = {
  verdant: {
    label: ["Verdoyant", "Verdant"],
    description: ["Vert profond et or : l’identité Congo Omega, claire et naturelle.", "Deep green and gold: Congo Omega’s identity, light and natural."],
    primary: "#075c4d",
    accent: "#e9a43a",
    background: "#fbfcf8",
    surface: "#ffffff",
    alt: "#f1f7f1",
    text: "#0f172a",
    muted: "#475569",
    border: "#e2e8f0",
    dark: "#0b1f1a",
    darkText: "#d1e7dd",
    headingFont: "sans",
    bodyFont: "sans",
    buttonRadius: 999,
    buttonStyle: "solid",
    cardRadius: 24,
    panelRadius: 32,
    cardShadow: "0 18px 45px -34px rgba(15,23,42,.65)",
    looks: { topbar: "dark", header: "solid", footer: "dark" },
    links: "underline",
    templates: { topbar: "contact", header: "left", footer: "columns" },
  },
  ocean: {
    label: ["Océan", "Ocean"],
    description: ["Bleu marine et cyan, header en verre, liens en pastilles, grand footer.", "Navy and cyan, glass header, pill links, large footer."],
    primary: "#0b3d91",
    accent: "#00b4d8",
    background: "#f5f9ff",
    surface: "#ffffff",
    alt: "#e8f1ff",
    text: "#0b1b3a",
    muted: "#46557a",
    border: "#d6e2f5",
    dark: "#061a40",
    darkText: "#bfdbfe",
    headingFont: "montserrat",
    bodyFont: "inter",
    buttonRadius: 10,
    buttonStyle: "solid",
    cardRadius: 16,
    panelRadius: 20,
    cardShadow: "0 12px 30px -18px rgba(11,61,145,.35)",
    looks: { topbar: "accent", header: "glass", footer: "dark" },
    links: "pill",
    templates: { topbar: "announcement-button", header: "cta", footer: "mega" },
  },
  terre: {
    label: ["Terre", "Earth"],
    description: ["Brun et ocre, polices à empattement, logo centré, footer clair.", "Brown and ochre, serif fonts, centred logo, light footer."],
    primary: "#7c4a1e",
    accent: "#c99a2e",
    background: "#fbf6ef",
    surface: "#fffdf9",
    alt: "#f3e9dc",
    text: "#2a1a0e",
    muted: "#6f5845",
    border: "#e8d9c6",
    dark: "#2a1a0e",
    darkText: "#e8d5bd",
    headingFont: "playfair",
    bodyFont: "lora",
    buttonRadius: 4,
    buttonStyle: "outline",
    cardRadius: 8,
    panelRadius: 12,
    cardShadow: "0 10px 26px -20px rgba(124,74,30,.5)",
    looks: { topbar: "light", header: "bordered", footer: "light" },
    links: "dots",
    templates: { topbar: "social", header: "centered", footer: "centered" },
  },
  minimal: {
    label: ["Minimal", "Minimal"],
    description: ["Noir et blanc, sans ombre, menu ☰ et footer en une ligne.", "Black and white, no shadows, ☰ menu and one-line footer."],
    primary: "#111111",
    accent: "#6b7280",
    background: "#ffffff",
    surface: "#ffffff",
    alt: "#f5f5f5",
    text: "#111111",
    muted: "#555555",
    border: "#e5e5e5",
    dark: "#111111",
    darkText: "#e5e5e5",
    headingFont: "inter",
    bodyFont: "inter",
    buttonRadius: 0,
    buttonStyle: "outline",
    cardRadius: 0,
    panelRadius: 0,
    cardShadow: "none",
    looks: { topbar: "line", header: "bordered", footer: "minimal" },
    links: "plain",
    templates: { topbar: "announcement", header: "minimal", footer: "minimal-bar" },
    hideTopbar: true,
  },
  soleil: {
    label: ["Soleil", "Sunrise"],
    description: ["Orange et jaune, header flottant arrondi, footer coloré.", "Orange and yellow, rounded floating header, colourful footer."],
    primary: "#c2410c",
    accent: "#facc15",
    background: "#fffaf0",
    surface: "#ffffff",
    alt: "#ffedd5",
    text: "#1c1917",
    muted: "#57534e",
    border: "#fed7aa",
    dark: "#1c1917",
    darkText: "#fde68a",
    headingFont: "poppins",
    bodyFont: "poppins",
    buttonRadius: 999,
    buttonStyle: "soft",
    cardRadius: 28,
    panelRadius: 36,
    cardShadow: "0 24px 50px -30px rgba(194,65,12,.45)",
    looks: { topbar: "accent", header: "floating", footer: "accent" },
    links: "pill",
    templates: { topbar: "announcement", header: "left", footer: "newsletter" },
  },
  nuit: {
    label: ["Nuit dorée", "Golden night"],
    description: ["Site sombre et or, header transparent sur l’image, logo au milieu.", "Dark site with gold, transparent header over the image, logo in the middle."],
    primary: "#b8893b",
    accent: "#d4af6f",
    background: "#0d0c0a",
    surface: "#16140f",
    alt: "#121009",
    text: "#ede8df",
    muted: "#a89a85",
    border: "rgba(212,175,111,.2)",
    dark: "#060504",
    darkText: "#d8cdb9",
    headingFont: "playfair",
    bodyFont: "sans",
    headingCase: "none",
    buttonRadius: 0,
    buttonStyle: "outline",
    cardRadius: 2,
    panelRadius: 4,
    cardShadow: "none",
    looks: { topbar: "dark", header: "transparent", footer: "dark" },
    links: "caps",
    templates: { topbar: "split", header: "split", footer: "cta" },
    hideTopbar: true,
  },
  entreprise: {
    label: ["Entreprise", "Corporate"],
    description: ["Bleu acier et gris, menu sur deux lignes, footer complet.", "Steel blue and grey, two-row menu, complete footer."],
    primary: "#1d4ed8",
    accent: "#0ea5e9",
    background: "#f8fafc",
    surface: "#ffffff",
    alt: "#eef2f7",
    text: "#0f172a",
    muted: "#475569",
    border: "#dbe2ea",
    dark: "#0f172a",
    darkText: "#cbd5e1",
    headingFont: "roboto",
    bodyFont: "roboto",
    headingCase: "none",
    buttonRadius: 6,
    buttonStyle: "solid",
    cardRadius: 10,
    panelRadius: 14,
    cardShadow: "0 8px 24px -16px rgba(15,23,42,.35)",
    looks: { topbar: "dark", header: "solid", footer: "dark" },
    links: "caps",
    templates: { topbar: "links", header: "two-rows", footer: "mega" },
  },
};

/** The look and link style a zone really uses: its own choice, else the theme's. */
export function zoneLookOf(name: ZoneName, zone: ZoneData | undefined, theme: string | undefined): ZoneLook {
  const own = zone?.look as ZoneLook | undefined;
  if (own && ZONE_LOOKS[name].some(([key]) => key === own)) return own;
  return (theme && SITE_THEMES[theme]?.looks[name]) || DEFAULT_LOOKS[name];
}
export function zoneLinksOf(zone: ZoneData | undefined, theme: string | undefined): LinkStyle {
  const own = zone?.links as LinkStyle | undefined;
  if (own && LINK_STYLES.some(([key]) => key === own)) return own;
  return (theme && SITE_THEMES[theme]?.links) || "underline";
}
const DEFAULT_LOOKS: Record<ZoneName, ZoneLook> = { topbar: "dark", header: "solid", footer: "dark" };

/**
 * CSS of a theme: colours, fonts, buttons, cards and panels of every page.
 * Everything sits in :where() (no weight), so the owner's own block and
 * element settings always win over the theme.
 */
export function themeCss(key: string | undefined): string {
  const theme = key ? SITE_THEMES[key] : undefined;
  if (!theme) return "";
  const root = `:where([data-site-root][data-theme="${key}"])`;
  const page = `${root} :where([data-page-content])`;
  const font = (name: string) => WEBSITE_FONTS[name]?.stack ?? WEBSITE_FONTS.sans!.stack;
  const button =
    theme.buttonStyle === "solid"
      ? "background:var(--website-primary);color:#fff;border-color:var(--website-primary)"
      : theme.buttonStyle === "outline"
        ? "background:transparent;color:var(--website-primary);border:2px solid var(--website-primary);box-shadow:none"
        : "background:color-mix(in srgb,var(--website-primary) 14%,transparent);color:var(--website-primary);border-color:transparent;box-shadow:none";
  return [
    `${root}{--website-primary:${theme.primary};--website-accent:${theme.accent};--t-bg:${theme.background};--t-surface:${theme.surface};--t-alt:${theme.alt};--t-text:${theme.text};--t-muted:${theme.muted};--t-border:${theme.border};--t-dark:${theme.dark};--t-dark-text:${theme.darkText};--t-radius:${theme.cardRadius}px;--t-panel-radius:${theme.panelRadius}px;--t-shadow:${theme.cardShadow};background-color:var(--t-bg);color:var(--t-text);font-family:${font(theme.bodyFont)}}`,
    `${root} :where(h1,h2,h3,h4){font-family:${font(theme.headingFont)}${theme.headingCase === "uppercase" ? ";text-transform:uppercase;letter-spacing:.04em" : ""}}`,
    `${root} :where(.wb-btn){border-radius:${theme.buttonRadius}px}`,
    `${root} :where(.wb-btn:not(.wb-btn-secondary)){${button}}`,
    // Texts of the blocks follow the theme's text colours.
    `${page} :where(.text-slate-950,.text-slate-900,.text-slate-800){color:var(--t-text)}`,
    `${page} :where(.text-slate-700,.text-slate-600,.text-slate-500){color:var(--t-muted)}`,
    `${page} :where(.text-emerald-700,.text-emerald-800,.text-amber-700,.text-amber-800){color:var(--website-primary)}`,
    `${page} :where(.bg-emerald-50,.bg-amber-50){background-color:color-mix(in srgb,var(--website-primary) 12%,var(--t-surface))}`,
    `${page} :where([class*="border-slate-2"],[class*="border-amber-2"],[class*="border-white/80"]){border-color:var(--t-border)}`,
    `${page} :where(.divide-slate-200)>*{border-color:var(--t-border)}`,
    // Light panels, dark panels, cards.
    `${page} :where([data-el="panel"]:not(.text-white):not([class*="bg-slate-950"])){background-color:var(--t-alt);border-radius:var(--t-panel-radius)}`,
    `${page} :where([data-el="panel"][class*="bg-slate-950"]){background-color:var(--t-dark);border-radius:var(--t-panel-radius)}`,
    `${page} :where([data-el="panel"].text-white){border-radius:var(--t-panel-radius)}`,
    `${page} :where([data-el-shared="card"],[data-el="sideCard"],[data-el="items"].bg-white){background-color:var(--t-surface);border-color:var(--t-border);border-radius:var(--t-radius);box-shadow:var(--t-shadow)}`,
    `${page} :where(input,textarea,select){background-color:var(--t-surface);color:var(--t-text);border-color:var(--t-border)}`,
  ].join("");
}

export function themeFontsHref(key: string | undefined): string | null {
  const theme = key ? SITE_THEMES[key] : undefined;
  if (!theme) return null;
  const families = new Set<string>();
  for (const name of [theme.headingFont, theme.bodyFont]) {
    const google = WEBSITE_FONTS[name]?.google;
    if (google) families.add(google);
  }
  return families.size
    ? `https://fonts.googleapis.com/css2?${[...families].map((family) => `family=${family}`).join("&")}&display=swap`
    : null;
}

/* ── Zone CSS (shared by the builder preview and the live site) ─────────── */

const Z = "[data-zone]";
export const ZONE_CSS = [
  // Colour tokens without a theme: the current Congo Omega look.
  ":where([data-site-root]){--t-bg:#fbfcf8;--t-surface:#ffffff;--t-alt:#f1f7f1;--t-text:#0f172a;--t-muted:#475569;--t-border:#e2e8f0;--t-dark:#020617;--t-dark-text:#cbd5e1}",
  `${Z}{position:relative;--zbg:var(--t-surface);--zfg:var(--t-text);background:var(--zone-bg,var(--zbg));color:var(--zone-fg,var(--zfg));transition:background-color .3s,color .3s,box-shadow .3s}`,
  // Looks.
  `${Z}[data-look="dark"]{--zbg:var(--t-dark);--zfg:var(--t-dark-text)}`,
  `${Z}[data-look="accent"]{--zbg:var(--website-primary);--zfg:#fff}`,
  `${Z}[data-look="light"]{--zbg:var(--t-alt);--zfg:var(--t-text)}`,
  `${Z}[data-look="line"],${Z}[data-look="minimal"]{--zbg:var(--t-bg);--zfg:var(--t-text)}`,
  '[data-zone="topbar"][data-look="line"]{border-bottom:1px solid var(--t-border)}',
  '[data-zone="footer"][data-look="minimal"]{border-top:1px solid var(--t-border)}',
  '[data-zone="header"][data-look="solid"]{box-shadow:0 1px 0 var(--t-border)}',
  '[data-zone="header"][data-look="glass"]{--zbg:color-mix(in srgb,var(--t-surface) 74%,transparent);backdrop-filter:blur(16px) saturate(1.4);-webkit-backdrop-filter:blur(16px) saturate(1.4);box-shadow:0 1px 0 color-mix(in srgb,var(--t-border) 70%,transparent)}',
  '[data-zone="header"][data-look="bordered"]{border-bottom:1px solid var(--t-border)}',
  '[data-zone="header"][data-look="floating"]{--zbg:transparent;padding:12px 12px 0}',
  '[data-zone="header"][data-look="floating"] .wb-zone-inner{background:var(--zone-bg,var(--t-surface));border-radius:22px;box-shadow:0 18px 40px -24px rgba(15,23,42,.45);max-width:1240px}',
  // Transparent header over the first image; solid again once the page scrolls.
  "[data-zone-overlay]{position:absolute;top:0;left:0;right:0;z-index:40}",
  "[data-zone-overlay][data-sticky]{position:fixed}",
  '[data-zone-overlay] [data-zone="topbar"]{--zbg:rgba(0,0,0,.28);--zfg:#fff;transition:max-height .3s,opacity .3s;max-height:120px;overflow:hidden}',
  '[data-zone="header"][data-look="transparent"]{--zbg:transparent;--zfg:#fff}',
  '[data-site-root][data-scrolled] [data-zone-overlay] [data-zone="topbar"]{max-height:0;opacity:0}',
  '[data-site-root][data-scrolled] [data-zone-overlay][data-sticky] [data-zone="header"][data-look="transparent"]{--zbg:color-mix(in srgb,var(--t-surface) 92%,transparent);--zfg:var(--t-text);backdrop-filter:blur(14px);box-shadow:0 10px 30px -20px rgba(0,0,0,.5)}',
  '[data-overlay-header] [data-page-content]>:first-child section{max-width:none;padding:0}',
  '[data-overlay-header] [data-page-content]>:first-child section>div:first-child{border-radius:0;min-height:100svh}',
  '[data-overlay-header] [data-page-content]>:first-child section>div:first-child>.grid{min-height:100svh;padding-top:150px}',
  '[data-zone="header"][data-sticky]{position:sticky;top:0;z-index:30}',
  '[data-zone-overlay] [data-zone="header"][data-sticky]{position:relative}',
  '[data-zone="footer"]{margin-top:4rem}',
  `${Z} .wb-zone-inner{max-width:1400px;margin:0 auto;padding-left:20px;padding-right:20px}`,
  `${Z}[data-width="full"] .wb-zone-inner{max-width:none}`,
  '[data-zone="topbar"] .wb-zone-inner{padding-top:8px;padding-bottom:8px}',
  '[data-zone="header"] .wb-zone-inner{padding-top:14px;padding-bottom:14px}',
  '[data-zone="footer"] .wb-zone-inner{padding-top:56px;padding-bottom:28px}',
  '[data-zone="footer"][data-look="minimal"] .wb-zone-inner{padding-top:28px;padding-bottom:28px}',
  '[data-site-root][data-footer-variant="minimal"] [data-zone="footer"] [data-el="canvas"]>:not(:last-child){display:none}',
  '[data-site-root][data-footer-variant="minimal"] [data-zone="footer"] .wb-zone-inner{padding-top:20px}',
  // Defaults only (no weight): the zone's own layout settings always win.
  `:where(${Z} [data-el="canvas"]){display:flex;flex-wrap:wrap;align-items:center;gap:16px}`,
  `:where(${Z} [data-el="canvas"]>*,${Z} [data-el-kind="group"]>*){margin-top:0}`,
  '[data-zone="topbar"] :where([data-el]){font-size:13px;line-height:1.4}',
  `${Z} :where(h3[data-el]){font-size:15px;line-height:1.3;font-weight:600;letter-spacing:.01em}`,
  `${Z} :where(p[data-el]){font-size:14px;line-height:1.6;opacity:.85}`,
  '[data-zone="topbar"] :where(.wb-btn){min-height:30px;padding:0 12px;font-size:12px}',
  `${Z}[data-look="accent"] :where(.wb-btn:not(.wb-btn-secondary)),${Z}[data-look="dark"] :where(.wb-btn:not(.wb-btn-secondary)),[data-zone="header"][data-look="transparent"] :where(.wb-btn:not(.wb-btn-secondary)){background:#fff;color:#111;border-color:#fff}`,
  // Menu links and their styles.
  ".wb-menu-list a{color:inherit;text-decoration:none}",
  '[data-zone="header"] .wb-menu-list a,[data-zone="header"] .wb-btn{white-space:nowrap}',
  '[data-zone="header"] .wb-menu-list:not(.flex-col){flex-wrap:nowrap;column-gap:clamp(12px,1.6vw,24px)}',
  `${Z}[data-links="plain"] .wb-menu-list a{opacity:.82}`,
  `${Z}[data-links="plain"] .wb-menu-list a:hover,${Z}[data-links="plain"] .wb-menu-list a[aria-current=page]{opacity:1}`,
  `${Z}[data-links="underline"] .wb-menu-list a{background:linear-gradient(currentColor,currentColor) 0 100%/0 1.5px no-repeat;padding-bottom:3px;transition:background-size .25s}`,
  `${Z}[data-links="underline"] .wb-menu-list a:hover,${Z}[data-links="underline"] .wb-menu-list a[aria-current=page]{background-size:100% 1.5px}`,
  `${Z}[data-links="pill"] .wb-menu-list a{display:inline-block;padding:6px 12px;border-radius:999px;transition:background-color .2s}`,
  `${Z}[data-links="pill"] .wb-menu-list a:hover{background:color-mix(in srgb,currentColor 12%,transparent)}`,
  `${Z}[data-links="pill"] .wb-menu-list a[aria-current=page]{background:var(--website-primary);color:#fff}`,
  `${Z}[data-links="caps"] .wb-menu-list a{text-transform:uppercase;letter-spacing:.16em;font-size:11.5px!important;font-weight:600;opacity:.8}`,
  `${Z}[data-links="caps"] .wb-menu-list a:hover,${Z}[data-links="caps"] .wb-menu-list a[aria-current=page]{opacity:1;color:var(--website-accent)}`,
  `${Z}[data-links="dots"] .wb-menu-list:not(.flex-col){column-gap:0!important}`,
  `${Z}[data-links="dots"] .wb-menu-list:not(.flex-col)>li+li::before{content:"·";margin:0 .8em;opacity:.5}`,
  `${Z}[data-links="dots"] .wb-menu-list a{font-style:italic}`,
  `${Z}[data-links="dots"] .wb-menu-list a:hover,${Z}[data-links="dots"] .wb-menu-list a[aria-current=page]{color:var(--website-primary)}`,
  // Drop-down sub-menus.
  ".wb-menu-list li{position:relative}",
  // Sub-menus open below the zone: the zone must not clip them.
  "[data-zone] [data-block-style]{overflow:visible}",
  ".wb-submenu{display:none;position:absolute;left:0;top:100%;z-index:50;min-width:200px;margin:0;padding:8px;list-style:none;border-radius:12px;background:var(--t-surface);color:var(--t-text);box-shadow:0 18px 40px -18px rgba(15,23,42,.45)}",
  ".wb-menu-list li:hover>.wb-submenu,.wb-menu-list li:focus-within>.wb-submenu{display:block}",
  ".wb-submenu a{display:block;padding:8px 10px;border-radius:8px;background:none!important;text-transform:none!important;letter-spacing:normal!important;color:var(--t-text)!important}",
  ".wb-submenu a:hover{background:color-mix(in srgb,var(--website-primary) 10%,transparent)!important}",
  ".wb-menu-list.flex-col .wb-submenu{display:block;position:static;box-shadow:none;background:none;color:inherit;padding:4px 0 0 12px;min-width:0}",
  ".wb-menu-list.flex-col .wb-submenu a{color:inherit!important;padding:2px 0}",
  '.wb-menu[data-part="end"] .wb-menu-list{justify-content:flex-end}',
  ".wb-menu-toggle{display:none}",
  '.wb-menu[data-variant="drawer"] .wb-menu-list{display:none}',
  '.wb-menu[data-variant="drawer"] .wb-menu-toggle{display:inline-grid}',
  // Tablets and phones: the header keeps one row — logo, actions, then the
  // menu button at the end (the menu itself opens in a side panel).
  `@media (max-width:${BREAKPOINTS.tablet}px){[data-zone="header"] .wb-menu-list{display:none}[data-zone="header"] .wb-menu:not([data-part="start"]) .wb-menu-toggle{display:inline-grid}[data-zone="header"] .wb-menu[data-part="start"]{display:none}[data-zone="header"] [data-el="canvas"]{flex-wrap:nowrap!important}[data-zone="header"] [data-el="canvas"]>*{min-width:0}[data-zone="header"] .wb-menu{order:99!important}}`,
  `@media (max-width:${BREAKPOINTS.mobile}px){[data-zone="header"] .wb-lang{display:none!important}[data-zone="header"] .wb-btn{min-height:36px!important;padding:0 12px!important;font-size:12px!important;white-space:nowrap!important;flex-shrink:0}[data-zone="header"] [data-el="canvas"]{gap:10px!important}[data-zone="header"] .wb-btn svg{display:none}[data-zone="header"] .wb-zone-inner{padding-top:10px;padding-bottom:10px}}`,
  `@media (max-width:${BREAKPOINTS.mobile}px){[data-zone="topbar"] [data-el="canvas"]{justify-content:center;text-align:center;gap:6px!important}[data-zone="topbar"] [data-el-kind="group"]{gap:4px 14px!important;justify-content:center}[data-zone="footer"] .wb-zone-inner{padding-top:40px}}`,
  ".wb-social a{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:999px;border:1px solid color-mix(in srgb,currentColor 30%,transparent);font-size:11px;font-weight:700;color:inherit;text-decoration:none}",
  ".wb-social a:hover{background:color-mix(in srgb,currentColor 12%,transparent)}",
].join("");

/* ── Element factories and zone templates ─────────────────────────────── */

type Extra = {
  id: string;
  type: string;
  textFr?: string;
  textEn?: string;
  href?: string;
  imageUrl?: string;
  variant?: string;
  value?: string;
  contactKind?: string;
  menuSource?: string;
  /** Menu: "start" / "end" show the first or second half of the links. */
  part?: string;
  items?: Array<Record<string, unknown>>;
  children?: Extra[];
  link?: Record<string, unknown>;
  /** Created by a template and not edited since. */
  tpl?: boolean;
};

let seed = 0;
const uid = (type: string) => `${type}-${Date.now().toString(36)}${(seed++).toString(36)}`;

export type SiteFacts = {
  displayName: string;
  tagline: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
};

/** A new zone element with sensible defaults (also used by the editor). */
export function zoneElement(type: string, facts?: SiteFacts, overrides: Partial<Extra> = {}): Extra {
  const id = uid(type);
  const base: Extra = { id, type };
  switch (type) {
    case "logo":
      return { ...base, variant: "name", ...overrides };
    case "menu":
      return { ...base, menuSource: "pages", variant: "row", ...overrides };
    case "language":
      return { ...base, ...overrides };
    case "social":
      return {
        ...base,
        items: [
          { network: "facebook", url: "https://facebook.com/" },
          { network: "linkedin", url: "https://linkedin.com/" },
        ],
        ...overrides,
      };
    case "contact":
      return {
        ...base,
        contactKind: "phone",
        value: facts?.phone ?? "+243 000 000 000",
        ...overrides,
      };
    case "copyright":
      return { ...base, textFr: "Tous droits réservés.", textEn: "All rights reserved.", ...overrides };
    case "newsletter":
      return {
        ...base,
        textFr: "Recevez nos nouvelles",
        textEn: "Get our news",
        value: "S’inscrire",
        ...overrides,
      };
    case "text":
      return {
        ...base,
        textFr: facts?.tagline ?? (facts ? `Bienvenue chez ${facts.displayName}` : "Votre texte"),
        textEn: facts?.tagline ?? (facts ? `Welcome to ${facts.displayName}` : "Your text"),
        ...overrides,
      };
    case "heading":
      return { ...base, textFr: "Titre", textEn: "Title", ...overrides };
    case "button":
      return { ...base, textFr: "Nous contacter", textEn: "Contact us", href: "/contact", variant: "primary", ...overrides };
    case "group":
      return { ...base, children: [], ...overrides };
    default:
      return { ...base, ...overrides };
  }
}

type Built = { extras: Extra[]; styles: Record<string, StyleValues> };
const group = (children: Extra[], style: StyleValues, styles: Record<string, StyleValues>): Extra => {
  const item = zoneElement("group", undefined, { children });
  styles[`x:${item.id}`] = style;
  return item;
};
const row = (justify = "start", gap = 16): StyleValues => ({ display: "flex", direction: "row", alignItems: "center", justify, gap, wrap: true });
const column = (gap = 10): StyleValues => ({ display: "flex", direction: "column", alignItems: "start", gap });

export const ZONE_TEMPLATES: Record<ZoneName, Record<string, { label: [string, string]; build: (facts: SiteFacts) => Built & { canvas: StyleValues } }>> = {
  topbar: {
    contact: {
      label: ["Coordonnées", "Contact details"],
      build: (facts) => {
        const styles: Record<string, StyleValues> = {};
        const contacts = group(
          [
            zoneElement("contact", facts, { contactKind: "phone", value: facts.phone ?? "+243 000 000 000" }),
            zoneElement("contact", facts, { contactKind: "email", value: facts.email ?? "contact@exemple.com" }),
            zoneElement("contact", facts, { contactKind: "hours", value: "Lun – Ven · 8h – 17h" }),
          ],
          row("start", 20),
          styles,
        );
        return { extras: [contacts, zoneElement("social")], styles, canvas: row("between") };
      },
    },
    announcement: {
      label: ["Annonce centrée", "Centred announcement"],
      build: (facts) => ({
        extras: [zoneElement("text", facts, { textFr: "Nouveau : découvrez nos dernières réalisations sur le terrain.", textEn: "New: discover our latest work on the ground." })],
        styles: {},
        canvas: row("center"),
      }),
    },
    social: {
      label: ["Réseaux sociaux", "Social networks"],
      build: (facts) => ({
        extras: [zoneElement("text", facts), zoneElement("social")],
        styles: {},
        canvas: row("between"),
      }),
    },
    "announcement-button": {
      label: ["Annonce avec bouton", "Announcement with button"],
      build: (facts) => ({
        extras: [
          zoneElement("text", facts, { textFr: "Nous recrutons pour la nouvelle saison.", textEn: "We are hiring for the new season." }),
          zoneElement("button", facts, { textFr: "Voir les offres", textEn: "See openings", href: "/carrieres" }),
        ],
        styles: {},
        canvas: row("center", 14),
      }),
    },
    split: {
      label: ["Slogan + coordonnées", "Tagline + contact"],
      build: (facts) => {
        const styles: Record<string, StyleValues> = {};
        const right = group(
          [
            zoneElement("contact", facts, { contactKind: "phone", value: facts.phone ?? "+243 000 000 000" }),
            zoneElement("contact", facts, { contactKind: "email", value: facts.email ?? "contact@exemple.com" }),
            zoneElement("social"),
          ],
          row("end", 18),
          styles,
        );
        return { extras: [zoneElement("text", facts), right], styles, canvas: row("between") };
      },
    },
    links: {
      label: ["Liens rapides", "Quick links"],
      build: (facts) => {
        const styles: Record<string, StyleValues> = {};
        const quick = zoneElement("menu", facts, {
          menuSource: "custom",
          items: [
            { labelFr: "Carrières", labelEn: "Careers", link: { kind: "page", page: "carrieres" } },
            { labelFr: "Projets", labelEn: "Projects", link: { kind: "page", page: "projets" } },
            { labelFr: "Contact", labelEn: "Contact", link: { kind: "page", page: "contact" } },
          ],
        });
        return {
          extras: [zoneElement("contact", facts, { contactKind: "email", value: facts.email ?? "contact@exemple.com" }), quick],
          styles,
          canvas: row("between"),
        };
      },
    },
  },
  header: {
    left: {
      label: ["Logo à gauche, menu à droite", "Logo left, menu right"],
      build: (facts) => {
        const styles: Record<string, StyleValues> = {};
        const actions = group([zoneElement("language"), zoneElement("button", facts)], { ...row("end", 12), wrap: false, flexShrink: 0 }, styles);
        return { extras: [zoneElement("logo"), zoneElement("menu"), actions], styles, canvas: { ...row("between", 24), wrap: false } };
      },
    },
    centered: {
      label: ["Logo centré", "Centred logo"],
      build: () => ({
        extras: [zoneElement("logo"), zoneElement("menu"), zoneElement("language")],
        styles: {},
        canvas: { display: "flex", direction: "column", alignItems: "center", gap: 12 },
      }),
    },
    "two-rows": {
      label: ["Menu sur deux lignes", "Two-row menu"],
      build: (facts) => {
        const styles: Record<string, StyleValues> = {};
        const first = group(
          [
            zoneElement("logo"),
            group([zoneElement("contact", facts, { contactKind: "phone", value: facts.phone ?? "+243 000 000 000" }), zoneElement("language"), zoneElement("button", facts)], row("end", 14), styles),
          ],
          { ...row("between", 16), width: "full" },
          styles,
        );
        const menu = zoneElement("menu");
        styles[`x:${menu.id}`] = { width: "full", paddingTop: 10, dividerTop: true };
        return { extras: [first, menu], styles, canvas: { display: "flex", direction: "column", alignItems: "stretch", gap: 10 } };
      },
    },
    split: {
      label: ["Logo au milieu, menu des deux côtés", "Logo in the middle, menu on both sides"],
      build: (facts) => {
        const styles: Record<string, StyleValues> = {};
        const start = zoneElement("menu", facts, { part: "start" });
        const end = zoneElement("menu", facts, { part: "end" });
        const actions = group([end, zoneElement("button", facts)], { ...row("end", 18), flexGrow: 1, flexBasis: "0px", wrap: false }, styles);
        styles[`x:${start.id}`] = { flexGrow: 1, flexBasis: "0px" };
        return { extras: [start, zoneElement("logo", facts, { variant: "image" }), actions], styles, canvas: { ...row("between", 24), wrap: false } };
      },
    },
    cta: {
      label: ["Menu au centre + 2 boutons", "Centred menu + 2 buttons"],
      build: (facts) => {
        const styles: Record<string, StyleValues> = {};
        const menu = zoneElement("menu", facts);
        styles[`x:${menu.id}`] = { flexGrow: 1, display: "flex", justify: "center" };
        const actions = group(
          [
            zoneElement("button", facts, { textFr: "Nos projets", textEn: "Our projects", href: "/projets", variant: "secondary" }),
            zoneElement("button", facts),
          ],
          { ...row("end", 10), wrap: false, flexShrink: 0 },
          styles,
        );
        return { extras: [zoneElement("logo"), menu, actions], styles, canvas: { ...row("between", 24), wrap: false } };
      },
    },
    minimal: {
      label: ["Minimal : logo + menu ☰", "Minimal: logo + ☰ menu"],
      build: (facts) => {
        const styles: Record<string, StyleValues> = {};
        const actions = group([zoneElement("language"), zoneElement("menu", facts, { variant: "drawer" })], row("end", 12), styles);
        return { extras: [zoneElement("logo"), actions], styles, canvas: { ...row("between", 24), wrap: false } };
      },
    },
  },
  footer: {
    simple: {
      label: ["Simple", "Simple"],
      build: () => ({
        extras: [zoneElement("copyright"), zoneElement("menu")],
        styles: {},
        canvas: row("between"),
      }),
    },
    columns: {
      label: ["Plusieurs colonnes", "Several columns"],
      build: (facts) => {
        const styles: Record<string, StyleValues> = {};
        const heading = (fr: string, en: string) => zoneElement("heading", facts, { textFr: fr, textEn: en });
        const columns = [
          group([zoneElement("logo"), zoneElement("text", facts)], column(12), styles),
          group([heading("Navigation", "Navigation"), zoneElement("menu", facts, { variant: "column" })], column(), styles),
          group(
            [
              heading("Contact", "Contact"),
              zoneElement("contact", facts, { contactKind: "phone", value: facts.phone ?? "+243 000 000 000" }),
              zoneElement("contact", facts, { contactKind: "email", value: facts.email ?? "contact@exemple.com" }),
              zoneElement("contact", facts, { contactKind: "address", value: facts.address ?? "Kinshasa, RDC" }),
            ],
            column(),
            styles,
          ),
          group([heading("Suivez-nous", "Follow us"), zoneElement("social")], column(), styles),
        ];
        const bottom = group([zoneElement("copyright")], { ...row("between"), spanAll: true, dividerTop: true, paddingTop: 20 }, styles);
        return { extras: [...columns, bottom], styles, canvas: { display: "grid", gridColumns: 4, gap: 40, alignItems: "start" } };
      },
    },
    "logo-contact": {
      label: ["Logo et coordonnées", "Logo and contact"],
      build: (facts) => {
        const styles: Record<string, StyleValues> = {};
        const columns = [
          group([zoneElement("logo"), zoneElement("text", facts)], column(12), styles),
          group(
            [
              zoneElement("contact", facts, { contactKind: "phone", value: facts.phone ?? "+243 000 000 000" }),
              zoneElement("contact", facts, { contactKind: "email", value: facts.email ?? "contact@exemple.com" }),
              zoneElement("contact", facts, { contactKind: "address", value: facts.address ?? "Kinshasa, RDC" }),
              zoneElement("contact", facts, { contactKind: "hours", value: "Lun – Ven · 8h – 17h" }),
            ],
            column(),
            styles,
          ),
        ];
        const bottom = group([zoneElement("copyright"), zoneElement("social")], { ...row("between"), spanAll: true, dividerTop: true, paddingTop: 20 }, styles);
        return { extras: [...columns, bottom], styles, canvas: { display: "grid", gridColumns: 2, gap: 40, alignItems: "start" } };
      },
    },
    newsletter: {
      label: ["Newsletter et réseaux", "Newsletter and social"],
      build: (facts) => {
        const styles: Record<string, StyleValues> = {};
        const columns = [
          group(
            [
              zoneElement("heading", facts, { textFr: "Restez informé", textEn: "Stay informed" }),
              zoneElement("text", facts, { textFr: "Nos actualités et projets, une fois par mois.", textEn: "Our news and projects, once a month." }),
              zoneElement("newsletter"),
            ],
            column(12),
            styles,
          ),
          group([zoneElement("heading", facts, { textFr: "Réseaux sociaux", textEn: "Social" }), zoneElement("social"), zoneElement("menu", facts, { variant: "column" })], column(12), styles),
        ];
        const bottom = group([zoneElement("copyright")], { ...row("between"), spanAll: true, dividerTop: true, paddingTop: 20 }, styles);
        return { extras: [...columns, bottom], styles, canvas: { display: "grid", gridColumns: 2, gap: 40, alignItems: "start" } };
      },
    },
    centered: {
      label: ["Centré", "Centred"],
      build: (facts) => {
        const styles: Record<string, StyleValues> = {};
        const tagline = zoneElement("text", facts);
        styles[`x:${tagline.id}`] = { align: "center", maxWidth: "560px" };
        const bottom = group([zoneElement("copyright")], { ...row("center"), width: "full", dividerTop: true, paddingTop: 20 }, styles);
        return {
          extras: [zoneElement("logo"), tagline, zoneElement("menu", facts), zoneElement("social"), bottom],
          styles,
          canvas: { display: "flex", direction: "column", alignItems: "center", gap: 22 },
        };
      },
    },
    cta: {
      label: ["Appel à l’action + colonnes", "Call to action + columns"],
      build: (facts) => {
        const styles: Record<string, StyleValues> = {};
        const title = zoneElement("heading", facts, { textFr: "Un projet ? Parlons-en.", textEn: "A project? Let’s talk." });
        styles[`x:${title.id}`] = { size: 34 };
        const band = group(
          [title, zoneElement("button", facts, { textFr: "Nous écrire", textEn: "Write to us" })],
          { ...row("between", 20), spanAll: true, paddingBottom: 36, marginBottom: 12 },
          styles,
        );
        const columns = [
          group([zoneElement("logo"), zoneElement("text", facts), zoneElement("social")], column(12), styles),
          group([zoneElement("heading", facts, { textFr: "Navigation", textEn: "Navigation" }), zoneElement("menu", facts, { variant: "column" })], column(), styles),
          group(
            [
              zoneElement("heading", facts, { textFr: "Contact", textEn: "Contact" }),
              zoneElement("contact", facts, { contactKind: "phone", value: facts.phone ?? "+243 000 000 000" }),
              zoneElement("contact", facts, { contactKind: "email", value: facts.email ?? "contact@exemple.com" }),
              zoneElement("contact", facts, { contactKind: "address", value: facts.address ?? "Kinshasa, RDC" }),
            ],
            column(),
            styles,
          ),
        ];
        const bottom = group([zoneElement("copyright")], { ...row("between"), spanAll: true, dividerTop: true, paddingTop: 20 }, styles);
        return { extras: [band, ...columns, bottom], styles, canvas: { display: "grid", gridColumns: 3, gap: 40, alignItems: "start" } };
      },
    },
    mega: {
      label: ["Grand footer (5 colonnes)", "Large footer (5 columns)"],
      build: (facts) => {
        const styles: Record<string, StyleValues> = {};
        const heading = (fr: string, en: string) => zoneElement("heading", facts, { textFr: fr, textEn: en });
        const columns = [
          group([zoneElement("logo", facts, { variant: "name-tagline" }), zoneElement("text", facts), zoneElement("social")], column(12), styles),
          group([heading("Navigation", "Navigation"), zoneElement("menu", facts, { variant: "column", part: "start" })], column(), styles),
          group([heading("Découvrir", "Discover"), zoneElement("menu", facts, { variant: "column", part: "end" })], column(), styles),
          group(
            [
              heading("Contact", "Contact"),
              zoneElement("contact", facts, { contactKind: "phone", value: facts.phone ?? "+243 000 000 000" }),
              zoneElement("contact", facts, { contactKind: "email", value: facts.email ?? "contact@exemple.com" }),
              zoneElement("contact", facts, { contactKind: "hours", value: "Lun – Ven · 8h – 17h" }),
            ],
            column(),
            styles,
          ),
          group([heading("Restez informé", "Stay informed"), zoneElement("newsletter")], column(), styles),
        ];
        const bottom = group([zoneElement("copyright"), zoneElement("language")], { ...row("between"), spanAll: true, dividerTop: true, paddingTop: 20 }, styles);
        return { extras: [...columns, bottom], styles, canvas: { display: "grid", gridColumns: 5, gap: 32, alignItems: "start" } };
      },
    },
    "minimal-bar": {
      label: ["Une seule ligne", "Single line"],
      build: (facts) => ({
        extras: [zoneElement("copyright"), zoneElement("menu", facts), zoneElement("social")],
        styles: {},
        canvas: row("between", 20),
      }),
    },
  },
};

export const DEFAULT_TEMPLATES: Record<ZoneName, string> = { topbar: "contact", header: "left", footer: "columns" };

/** Builds a zone from a template. */
export function buildZone(name: ZoneName, template: string, facts: SiteFacts): ZoneData {
  const definition = ZONE_TEMPLATES[name][template] ?? ZONE_TEMPLATES[name][DEFAULT_TEMPLATES[name]]!;
  const built = definition.build(facts);
  const mark = (items: Extra[]): Extra[] =>
    items.map((item) => (item.type === "group" ? { ...item, children: mark(item.children ?? []) } : { ...item, tpl: true }));
  built.extras = mark(built.extras);
  return {
    template,
    sticky: name === "header" ? true : undefined,
    content: {
      extras: built.extras,
      elementOrder: built.extras.map((item) => `x:${item.id}`),
      elementStyles: { canvas: built.canvas, ...built.styles },
    },
  };
}

const TEMPLATE_HEADINGS = new Set([
  "Navigation",
  "Contact",
  "Suivez-nous",
  "Restez informé",
  "Réseaux sociaux",
  "Titre",
  "Nouvelle colonne",
  "Découvrir",
  "Un projet ? Parlons-en.",
]);

const DEFAULT_TEXTS = new Set([
  "Votre texte",
  "Écrivez votre texte ici.",
  "Nouveau : découvrez nos dernières réalisations sur le terrain.",
  "Nous recrutons pour la nouvelle saison.",
  "Nos actualités et projets, une fois par mois.",
]);
const DEFAULT_BUTTONS = new Set(["Nous contacter", "Voir les offres", "Nos projets", "Nous écrire", "En savoir plus"]);
const PLACEHOLDERS = new Set(["+243 000 000 000", "contact@exemple.com", "Kinshasa, RDC", "Lun – Ven · 8h – 17h"]);

/**
 * An element a template created and the owner never changed. Changing the
 * template replaces it with the new template's own element, without a
 * warning: nothing the owner wrote is lost.
 */
function untouchedDefault(item: Extra, facts: SiteFacts): boolean {
  // Elements a template created carry "tpl" until the owner edits them.
  if (item.tpl) return true;
  const text = String(item.textFr ?? "").trim();
  switch (item.type) {
    case "heading":
      return TEMPLATE_HEADINGS.has(text);
    case "text":
      return (
        DEFAULT_TEXTS.has(text) ||
        text === `Bienvenue chez ${facts.displayName}` ||
        (Boolean(facts.tagline) && text === facts.tagline)
      );
    case "button":
      return DEFAULT_BUTTONS.has(text) && !item.link;
    case "menu":
      return item.menuSource !== "custom";
    case "language":
      return true;
    case "logo":
      return !item.imageUrl;
    case "social":
      return (item.items ?? []).every((entry) => /^https:\/\/(facebook|linkedin)\.com\/$/.test(String(entry.url ?? "")));
    case "contact": {
      const value = String(item.value ?? "").trim();
      return PLACEHOLDERS.has(value) || value === facts.phone || value === facts.email || value === facts.address;
    }
    case "copyright":
      return text === "Tous droits réservés.";
    case "newsletter":
      return text === "Recevez nos nouvelles" && String(item.value ?? "") === "S’inscrire";
    case "image":
      return !item.imageUrl;
    case "spacer":
      return true;
    default:
      return false;
  }
}

function flatten(extras: Extra[]): Extra[] {
  return extras.flatMap((item) => (item.type === "group" || item.type === "slider" ? flatten(item.children ?? []) : [item]));
}

const matchKey = (item: Extra) =>
  item.type === "contact" ? `contact:${item.contactKind ?? ""}` : item.type === "button" ? "button" : item.type;

/**
 * Applies a template while keeping compatible content: each element of the
 * new layout takes the text, links and settings of an old element of the
 * same kind. Elements with no place in the new layout are returned so the
 * editor can warn, and are kept in an extra column rather than lost.
 */
export function applyZoneTemplate(
  name: ZoneName,
  template: string,
  previous: ZoneData | undefined,
  facts: SiteFacts,
): { zone: ZoneData; leftovers: Extra[] } {
  const zone = buildZone(name, template, facts);
  if (!previous) return { zone, leftovers: [] };
  const oldItems = flatten((previous.content.extras as Extra[] | undefined) ?? []);
  const oldStyles = (previous.content.elementStyles as Record<string, StyleValues> | undefined) ?? {};
  const used = new Set<string>();
  const styles = { ...((zone.content.elementStyles as Record<string, StyleValues>) ?? {}) };
  // Column titles written by a template are part of its layout: they are
  // neither carried over nor reported. Titles the owner wrote are kept.
  for (const old of oldItems)
    if (untouchedDefault(old, facts)) used.add(old.id);
  const reuse = (items: Extra[]): Extra[] =>
    items.map((item) => {
      if (item.type === "group") return { ...item, children: reuse(item.children ?? []) };
      if (item.type === "heading") return item;
      const match = oldItems.find((old) => !used.has(old.id) && matchKey(old) === matchKey(item));
      if (!match) return item;
      used.add(match.id);
      // Content and links come from the old element; a template's own
      // styles for its slot win, otherwise the old element's styles stay.
      // The template's own styles for this place apply (its layout).
      const ownStyle = styles[`x:${item.id}`];
      delete styles[`x:${item.id}`];
      if (ownStyle) styles[`x:${match.id}`] = ownStyle;
      // The menu's direction is part of the layout, not of the content.
      return match.type === "menu" ? { ...match, variant: item.variant, part: item.part } : match;
    });
  const extras = reuse((zone.content.extras as Extra[]) ?? []);
  const leftovers = oldItems.filter((item) => !used.has(item.id));
  if (leftovers.length) {
    const kept = zoneElement("group", undefined, { children: leftovers });
    styles[`x:${kept.id}`] = { display: "flex", direction: "row", alignItems: "center", gap: 12, wrap: true };
    for (const item of leftovers) if (oldStyles[`x:${item.id}`]) styles[`x:${item.id}`] = oldStyles[`x:${item.id}`]!;
    extras.push(kept);
  }
  return {
    zone: {
      ...zone,
      hidden: previous.hidden,
      sticky: name === "header" ? (previous.sticky ?? zone.sticky) : undefined,
      content: {
        ...zone.content,
        // Zone background / text colours chosen by the owner are kept.
        ...Object.fromEntries(
          Object.entries(previous.content).filter(([key]) => key.startsWith("block")),
        ),
        extras,
        elementOrder: extras.map((item) => `x:${item.id}`),
        elementStyles: styles,
      },
    },
    leftovers,
  };
}

/* ── Rendering of the zone-only elements ───────────────────────────────── */

export type SiteRenderInfo = {
  displayName: string;
  tagline: string | null;
  logoUrl: string | null;
  contactEmail: string | null;
  navigation: Array<{ slug: string; label_fr: string; label_en: string }>;
  pageLink: (slug: string) => string;
  resolveHref: (value: string) => string | null;
  homeHref: string;
  currentSlug: string;
  language: "fr" | "en";
  setLanguage: (language: "fr" | "en") => void;
  editing: boolean;
  contactDomain?: string;
};

export const SiteRenderContext = React.createContext<SiteRenderInfo | null>(null);
export const ZoneNameContext = React.createContext<ZoneName | null>(null);

const SOCIAL_NETWORKS: Record<string, { label: string; glyph: string }> = {
  facebook: { label: "Facebook", glyph: "f" },
  instagram: { label: "Instagram", glyph: "IG" },
  linkedin: { label: "LinkedIn", glyph: "in" },
  youtube: { label: "YouTube", glyph: "YT" },
  x: { label: "X", glyph: "X" },
  tiktok: { label: "TikTok", glyph: "TT" },
  whatsapp: { label: "WhatsApp", glyph: "WA" },
};
export const SOCIAL_NETWORK_KEYS = Object.keys(SOCIAL_NETWORKS);

function safeExternal(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Renders logo, menu, language, social, contact, copyright, newsletter. */
export function ZoneElement({ item, el, space }: { item: Extra; el: string; space: string }) {
  const site = React.useContext(SiteRenderContext);
  const zone = React.useContext(ZoneNameContext);
  const [open, setOpen] = React.useState(false);
  const [sent, setSent] = React.useState<"idle" | "sending" | "done" | "error">("idle");
  if (!site) return null;
  const fr = site.language === "fr";
  const words = (fr ? item.textFr : item.textEn) ?? item.textFr ?? "";
  switch (item.type) {
    case "logo": {
      const initials = site.displayName
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
      const href = site.homeHref;
      return (
        <a data-el={el} href={href} className={`${space}inline-flex min-w-0 items-center gap-3 text-inherit no-underline`} aria-label={site.displayName}>
          {item.imageUrl || site.logoUrl ? (
            <img src={item.imageUrl || site.logoUrl || ""} alt="" className="h-10 w-auto max-w-[180px] object-contain" />
          ) : (
            <span className="grid size-10 shrink-0 place-items-center rounded-xl text-sm font-bold text-white" style={{ background: "var(--website-primary)" }}>
              {initials}
            </span>
          )}
          {item.variant !== "image" ? (
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-base font-semibold">{site.displayName}</span>
              {site.tagline && item.variant === "name-tagline" ? (
                <span className="block truncate text-xs opacity-70">{site.tagline}</span>
              ) : null}
            </span>
          ) : null}
        </a>
      );
    }
    case "menu": {
      type MenuLink = { key: string; label: string; href: string | null; active: boolean; children: MenuLink[] };
      const customLink = (entry: Record<string, unknown>, key: string): MenuLink => {
        const label = String((fr ? entry.labelFr : entry.labelEn) ?? entry.labelFr ?? "");
        const link = entry.link as { kind?: string; page?: string; url?: string } | undefined;
        const href =
          link?.kind === "page" && typeof link.page === "string"
            ? site.pageLink(link.page)
            : typeof link?.url === "string"
              ? site.resolveHref(link.url)
              : null;
        const children = Array.isArray(entry.children)
          ? (entry.children as Array<Record<string, unknown>>).map((child, index) => customLink(child, `${key}-${index}`))
          : [];
        return {
          key,
          label,
          href,
          active: link?.kind === "page" && link.page === site.currentSlug,
          children: children.filter((child) => child.label && child.href),
        };
      };
      const all: MenuLink[] = (
        item.menuSource === "custom"
          ? (item.items ?? []).map((entry, index) => customLink(entry, `custom-${index}`))
          : site.navigation.map((entry) => ({
              key: entry.slug,
              label: fr ? entry.label_fr : entry.label_en,
              href: site.pageLink(entry.slug),
              active: entry.slug === site.currentSlug,
              children: [],
            }))
      ).filter((link) => link.label && (link.href || link.children.length));
      // "Logo au milieu": one menu shows the first half, another the second.
      const half = Math.ceil(all.length / 2);
      const links = item.part === "start" ? all.slice(0, half) : item.part === "end" ? all.slice(half) : all;
      const vertical = item.variant === "column";
      const list = (
        <ul className={`wb-menu-list m-0 flex list-none p-0 ${vertical ? "flex-col items-start gap-2" : "flex-wrap items-center gap-x-6 gap-y-2"}`}>
          {links.map((link) => (
            <li key={link.key}>
              {link.href ? (
                <a href={link.href} aria-current={link.active ? "page" : undefined} className="text-sm font-medium">
                  {link.label}
                </a>
              ) : (
                <span tabIndex={0} className="cursor-default text-sm font-medium">
                  {link.label}
                </span>
              )}
              {link.children.length ? (
                <ul className="wb-submenu">
                  {link.children.map((child) => (
                    <li key={child.key}>
                      <a href={child.href!} className="text-sm">
                        {child.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      );
      return (
        <nav
          data-el={el}
          data-part={item.part}
          data-variant={item.variant === "drawer" ? "drawer" : undefined}
          aria-label={fr ? "Menu" : "Menu"}
          className={`${space}wb-menu`}
        >
          {list}
          {zone === "header" && item.part !== "start" ? (
            <>
              <button
                type="button"
                className="wb-menu-toggle size-10 place-items-center rounded-full border border-current/25"
                aria-expanded={open}
                aria-label={fr ? "Ouvrir le menu" : "Open menu"}
                onClick={() => setOpen(true)}
              >
                <MenuIcon className="size-5" />
              </button>
              {open ? (
                <div className="fixed inset-0 z-50 bg-slate-950/50" onClick={() => setOpen(false)}>
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Menu"
                    className="ml-auto flex h-full w-[min(86vw,360px)] flex-col gap-4 overflow-y-auto p-5 shadow-2xl"
                    style={{ background: "var(--t-surface,#fff)", color: "var(--t-text,#0f172a)" }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button type="button" className="ml-auto grid size-10 place-items-center rounded-full border border-current/25" aria-label={fr ? "Fermer le menu" : "Close menu"} onClick={() => setOpen(false)}>
                      <X className="size-5" />
                    </button>
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {all.map((link) => (
                        <li key={link.key}>
                          {link.href ? (
                            <a href={link.href} aria-current={link.active ? "page" : undefined} className="block rounded-lg px-3 py-3 text-base font-semibold hover:bg-current/10" onClick={() => setOpen(false)}>
                              {link.label}
                            </a>
                          ) : (
                            <span className="block px-3 pt-3 text-xs font-bold uppercase tracking-wider opacity-60">{link.label}</span>
                          )}
                          {link.children.length ? (
                            <ul className="m-0 list-none border-l border-current/15 pl-3">
                              {link.children.map((child) => (
                                <li key={child.key}>
                                  <a href={child.href!} className="block rounded-lg px-3 py-2 text-sm font-medium hover:bg-current/10" onClick={() => setOpen(false)}>
                                    {child.label}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    <button type="button" className="mt-2 w-fit rounded-full border border-current/25 px-4 py-2 text-sm font-semibold" onClick={() => site.setLanguage(fr ? "en" : "fr")}>
                      {fr ? "English" : "Français"}
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </nav>
      );
    }
    case "language":
      return (
        <button
          data-el={el}
          type="button"
          className={`${space}wb-lang inline-flex h-9 items-center gap-1 rounded-full border border-current/25 px-3 text-xs font-bold`}
          onClick={() => site.setLanguage(fr ? "en" : "fr")}
          aria-label={fr ? "Switch to English" : "Passer en français"}
        >
          <span className={fr ? "" : "opacity-50"}>FR</span>
          <span className="opacity-40">/</span>
          <span className={fr ? "opacity-50" : ""}>EN</span>
        </button>
      );
    case "social":
      return (
        <div data-el={el} className={`${space}wb-social flex flex-wrap items-center gap-2`}>
          {(item.items ?? []).map((entry, index) => {
            const network = SOCIAL_NETWORKS[String(entry.network)] ?? { label: String(entry.network ?? "Lien"), glyph: "•" };
            const href = safeExternal(entry.url);
            return href ? (
              <a key={index} href={href} target="_blank" rel="noopener noreferrer" aria-label={`${network.label} (${fr ? "nouvel onglet" : "new tab"})`}>
                {network.glyph}
              </a>
            ) : null;
          })}
        </div>
      );
    case "contact": {
      const value = String(item.value ?? "").trim();
      if (!value) return null;
      const Icon = item.contactKind === "email" ? Mail : item.contactKind === "address" ? MapPin : item.contactKind === "hours" ? Clock : Phone;
      const href =
        item.contactKind === "phone"
          ? `tel:${value.replace(/[^\d+]/g, "")}`
          : item.contactKind === "email" && /^\S+@\S+\.\S+$/.test(value)
            ? `mailto:${value}`
            : null;
      const inner = (
        <>
          <Icon className="size-4 shrink-0 opacity-75" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{value}</span>
        </>
      );
      return href ? (
        <a data-el={el} href={href} className={`${space}inline-flex items-center gap-2 text-inherit no-underline hover:underline`}>
          {inner}
        </a>
      ) : (
        <span data-el={el} className={`${space}inline-flex items-center gap-2`}>
          {inner}
        </span>
      );
    }
    case "copyright":
      return (
        <p data-el={el} className={`${space}m-0 text-sm opacity-75`}>
          © {new Date().getFullYear()} {site.displayName}. {words}
        </p>
      );
    case "newsletter": {
      const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (site.editing) return;
        const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
        if (!/^\S+@\S+\.\S+$/.test(email)) {
          setSent("error");
          return;
        }
        if (!site.contactDomain) {
          if (site.contactEmail)
            window.location.href = `mailto:${site.contactEmail}?subject=${encodeURIComponent("Newsletter")}&body=${encodeURIComponent(email)}`;
          return;
        }
        setSent("sending");
        try {
          await post(`/public/websites/domains/${encodeURIComponent(site.contactDomain)}/contact`, {
            fullName: fr ? "Abonné newsletter" : "Newsletter subscriber",
            email,
            subject: "Newsletter",
            message: fr ? `Inscription à la newsletter : ${email}` : `Newsletter subscription: ${email}`,
          });
          setSent("done");
        } catch (error) {
          setSent(error instanceof ApiError ? "error" : "error");
        }
      };
      return (
        <form data-el={el} onSubmit={submit} className={`${space}flex w-full max-w-sm flex-col gap-2`}>
          <label className="text-sm font-medium">{words}</label>
          <div className="flex flex-wrap gap-2">
            <input
              name="email"
              type="email"
              required
              placeholder={fr ? "votre@email.com" : "your@email.com"}
              className="h-10 min-w-0 flex-1 rounded-full border border-current/25 bg-white/95 px-4 text-sm text-slate-900"
            />
            <button type="submit" className="wb-btn h-10 rounded-full px-4 text-sm font-semibold" style={{ background: "var(--website-primary)", color: "#fff" }}>
              {String(item.value ?? (fr ? "S’inscrire" : "Subscribe"))}
            </button>
          </div>
          {sent === "done" ? <p className="m-0 text-xs">{fr ? "Merci, inscription reçue." : "Thanks, you are subscribed."}</p> : null}
          {sent === "error" ? <p className="m-0 text-xs">{fr ? "Vérifiez l’adresse e-mail et réessayez." : "Check the email address and try again."}</p> : null}
        </form>
      );
    }
    default:
      return null;
  }
}

export const ZONE_ELEMENT_TYPES = ["logo", "menu", "language", "social", "contact", "copyright", "newsletter"];
