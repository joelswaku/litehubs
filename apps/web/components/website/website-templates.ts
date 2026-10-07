/**
 * Design variants of the standard blocks, and complete site templates
 * (theme + top bar / header / footer templates + block designs).
 *
 * A variant only changes how a block looks: its texts, images, links and
 * cards stay the same. The CSS sits in :where() (no weight), so the owner's
 * own element settings always win.
 */

import { BREAKPOINTS } from "./website-element-style";

export type BlockType =
  | "hero"
  | "rich_text"
  | "feature_grid"
  | "metrics"
  | "image_callout"
  | "gallery"
  | "faq"
  | "cta"
  | "careers";

/** [key, [French, English] label, short description FR/EN]. The first one is the original design. */
export const BLOCK_VARIANTS: Record<BlockType, Array<[string, [string, string]]>> = {
  hero: [
    ["hero-image", ["Grande image", "Large image"]],
    ["hero-split", ["Texte + image côte à côte", "Text + image side by side"]],
    ["hero-centered", ["Texte centré sur l’image", "Centred text over image"]],
    ["hero-minimal", ["Sans image, épuré", "No image, clean"]],
  ],
  rich_text: [
    ["text-centered", ["Centré", "Centred"]],
    ["text-left", ["Aligné à gauche", "Left aligned"]],
    ["text-split", ["Titre à gauche, texte à droite", "Title left, text right"]],
  ],
  feature_grid: [
    ["cards-default", ["Cartes", "Cards"]],
    ["cards-minimal", ["Épuré (ligne de couleur)", "Clean (colour line)"]],
    ["cards-numbered", ["Grands numéros", "Large numbers"]],
    ["cards-dark", ["Fond sombre", "Dark background"]],
  ],
  metrics: [
    ["metrics-band", ["Bandeau coloré", "Colour band"]],
    ["metrics-light", ["Cartes claires", "Light cards"]],
    ["metrics-inline", ["Chiffres en ligne", "Figures in a row"]],
  ],
  image_callout: [
    ["callout-left", ["Image à gauche", "Image left"]],
    ["callout-right", ["Image à droite", "Image right"]],
    ["callout-overlay", ["Texte sur l’image", "Text over the image"]],
  ],
  gallery: [
    ["gallery-mosaic", ["Mosaïque", "Mosaic"]],
    ["gallery-grid", ["Grille régulière", "Even grid"]],
  ],
  faq: [
    ["faq-list", ["Liste", "List"]],
    ["faq-split", ["Titre à gauche, questions à droite", "Title left, questions right"]],
  ],
  cta: [
    ["cta-dark", ["Sombre", "Dark"]],
    ["cta-light", ["Clair", "Light"]],
    ["cta-accent", ["Couleur principale", "Main colour"]],
  ],
  careers: [
    ["careers-warm", ["Chaleureux", "Warm"]],
    ["careers-dark", ["Sombre", "Dark"]],
  ],
};

export function isBlockType(type: string): type is BlockType {
  return type in BLOCK_VARIANTS;
}

export function validVariant(type: string, value: unknown): string | undefined {
  if (typeof value !== "string" || !isBlockType(type)) return undefined;
  return BLOCK_VARIANTS[type].some(([key]) => key === value) ? value : undefined;
}

const V = (variant: string, selector: string) =>
  selector
    .split(",")
    .map((part) => `:where([data-block-variant="${variant}"] ${part.trim()})`)
    .join(",");
const LG = `@media (min-width:${BREAKPOINTS.tablet + 1}px)`;
const MD = `@media (max-width:${BREAKPOINTS.tablet}px)`;

/** Hero texts in dark colours (for designs on a light background). */
const lightHero = (variant: string) => [
  `${V(variant, ".wb-hero")}{background:var(--t-alt,#f1f7f1);color:var(--t-text,#0f172a);box-shadow:none}`,
  `${V(variant, '.wb-hero [data-el="body"],.wb-hero [data-el="badges"]')}{color:var(--t-muted,#475569)}`,
  `${V(variant, '.wb-hero [data-el="eyebrow"]')}{color:var(--website-primary);border-color:color-mix(in srgb,var(--website-primary) 35%,transparent);background:transparent;backdrop-filter:none}`,
  `${V(variant, ".wb-hero .wb-btn-secondary")}{color:var(--t-text,#0f172a);border-color:currentColor;background:transparent}`,
  `${V(variant, ".wb-hero .wb-btn:not(.wb-btn-secondary)")}{background:var(--website-primary);color:#fff;border-color:var(--website-primary)}`,
  `${V(variant, ".wb-hero-shade,.wb-hero-ring,.wb-hero-side")}{display:none}`,
];

/** Texts of a block on a dark background. */
const darkTexts = (variant: string, scope: string) => [
  `${V(variant, `${scope} [data-el="title"],${scope} h3`)}{color:#fff}`,
  `${V(variant, `${scope} [data-el="body"],${scope} p`)}{color:rgba(255,255,255,.72)}`,
  `${V(variant, `${scope} [data-el="eyebrow"]`)}{color:var(--website-accent)}`,
];

export const VARIANT_CSS = [
  // Default colour of the figures band (no weight: owner styles win).
  ":where(.wb-metrics-panel){background-color:var(--website-primary)}",
  // ── Hero ──
  ...lightHero("hero-split"),
  `${V("hero-split", ".wb-hero-img")}{inset:0 0 0 auto;width:46%;z-index:0}`,
  `${V("hero-split", '.wb-hero [data-el="title"]')}{font-size:clamp(2.1rem,3.6vw,3.6rem)}`,
  `${LG}{${V("hero-split", ".wb-hero-grid")}{grid-template-columns:minmax(0,1fr);padding-right:calc(46% + 3.5rem);align-items:center}}`,
  `${MD}{${V("hero-split", ".wb-hero-img")}{position:relative;display:block;width:100%;height:280px;inset:auto}${V("hero-split", ".wb-hero,.wb-hero-grid")}{min-height:0}}`,
  `${V("hero-centered", ".wb-hero-grid")}{grid-template-columns:minmax(0,1fr);align-items:center;justify-items:center;text-align:center}`,
  `${V("hero-centered", ".wb-hero-text")}{align-items:center;margin:0 auto}`,
  `${V("hero-centered", ".wb-hero-side,.wb-hero-ring")}{display:none}`,
  `${V("hero-centered", ".wb-hero-shade")}{background:rgba(2,6,23,.6)}`,
  `${V("hero-centered", '.wb-hero [data-el="buttons"],.wb-hero [data-el="badges"]')}{justify-content:center}`,
  ...lightHero("hero-minimal"),
  `${V("hero-minimal", ".wb-hero-img")}{display:none}`,
  `${V("hero-minimal", ".wb-hero,.wb-hero-grid")}{min-height:0}`,
  `${V("hero-minimal", ".wb-hero-grid")}{grid-template-columns:minmax(0,1fr);padding-top:96px;padding-bottom:80px}`,
  // ── Rich text ──
  `${V("text-left", ".wb-heading")}{align-items:flex-start;text-align:left;margin-left:0}`,
  `${LG}{${V("text-split", ".wb-heading")}{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);column-gap:56px;max-width:none;text-align:left;align-items:start}${V("text-split", '.wb-heading>[data-el="eyebrow"],.wb-heading>[data-el="title"]')}{grid-column:1}${V("text-split", '.wb-heading>[data-el="body"]')}{grid-column:2;grid-row:1/span 3;margin-top:0}${V("text-split", ".wb-heading>:not([data-el])")}{grid-column:2}}`,
  `${V("text-split", ".wb-heading")}{align-items:flex-start;text-align:left}`,
  // ── Cards ──
  `${V("cards-minimal", '[data-el="panel"]')}{background:transparent;padding-left:0;padding-right:0}`,
  `${V("cards-minimal", '[data-el-shared="card"]')}{background:transparent;box-shadow:none;border:0;border-top:3px solid var(--website-primary);border-radius:0;padding:22px 0 0}`,
  `${V("cards-numbered", '[data-el$=":number"]')}{width:auto;height:auto;background:none;font-size:46px;line-height:1;font-weight:700;letter-spacing:-.04em;color:var(--website-primary)}`,
  `${V("cards-numbered", '[data-el-shared="card"]')}{border-left:4px solid var(--website-accent)}`,
  `${V("cards-dark", '[data-el="panel"]')}{background:var(--t-dark,#0b1f1a)}`,
  `${V("cards-dark", '[data-el-shared="card"]')}{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.12);box-shadow:none}`,
  ...darkTexts("cards-dark", '[data-el="panel"]'),
  `${V("cards-dark", '[data-el$=":number"]')}{background:rgba(255,255,255,.1);color:var(--website-accent)}`,
  // ── Metrics ──
  `${V("metrics-light", '[data-el="panel"]')}{background:var(--t-alt,#f1f7f1);color:var(--t-text,#0f172a)}`,
  `${V("metrics-light", '[data-el="panel"] [data-el="title"]')}{color:var(--t-text,#0f172a)}`,
  `${V("metrics-light", '[data-el="panel"] [data-el="body"],[data-el="panel"] [data-el="eyebrow"]')}{color:var(--t-muted,#475569)}`,
  `${V("metrics-light", '[data-el="items"]')}{background:transparent;border:0;gap:16px}`,
  `${V("metrics-light", ".wb-metric")}{background:var(--t-surface,#fff);border-radius:var(--t-radius,20px);box-shadow:var(--t-shadow,0 18px 45px -34px rgba(15,23,42,.65))}`,
  `${V("metrics-light", '.wb-metric [data-el$=":value"]')}{color:var(--website-primary)}`,
  `${V("metrics-light", '.wb-metric [data-el$=":label"]')}{color:var(--t-muted,#475569)}`,
  `${V("metrics-inline", '[data-el="panel"]')}{background:transparent;color:var(--t-text,#0f172a);padding-left:0;padding-right:0}`,
  `${V("metrics-inline", '[data-el="panel"] [data-el="title"]')}{color:var(--t-text,#0f172a)}`,
  `${V("metrics-inline", '[data-el="panel"] [data-el="body"],[data-el="panel"] [data-el="eyebrow"]')}{color:var(--t-muted,#475569)}`,
  `${V("metrics-inline", '[data-el="items"]')}{background:transparent;border:0;border-radius:0}`,
  `${V("metrics-inline", ".wb-metric")}{background:transparent;border-left:3px solid var(--website-primary);padding:4px 0 4px 20px}`,
  `${V("metrics-inline", '.wb-metric [data-el$=":value"]')}{color:var(--website-primary);font-size:52px}`,
  `${V("metrics-inline", '.wb-metric [data-el$=":label"]')}{color:var(--t-muted,#475569)}`,
  // ── Image + text ──
  `${LG}{${V("callout-right", '[data-el="media"]')}{order:2}}`,
  `${V("callout-overlay", '[data-el="panel"]')}{position:relative;display:block;min-height:540px;border:0}`,
  `${V("callout-overlay", '[data-el="media"]')}{position:absolute;inset:0;min-height:0}`,
  `${V("callout-overlay", ".wb-callout-text")}{position:relative;z-index:1;max-width:560px;margin:56px;border-radius:var(--t-radius,24px);background:color-mix(in srgb,var(--t-surface,#fff) 94%,transparent);box-shadow:0 24px 60px -30px rgba(0,0,0,.6)}`,
  `${MD}{${V("callout-overlay", ".wb-callout-text")}{margin:180px 16px 16px}}`,
  // ── Gallery ──
  `${V("gallery-grid", ".wb-gallery-item")}{grid-column:auto;grid-row:auto}`,
  // ── Questions ──
  `${LG}{${V("faq-split", ".wb-faq")}{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.3fr);column-gap:64px;align-items:start;max-width:1400px}${V("faq-split", '.wb-faq>[data-el="items"]')}{margin-top:0}${V("faq-split", ".wb-faq .wb-heading")}{position:sticky;top:120px;align-items:flex-start;text-align:left;margin-left:0}}`,
  // ── Call to action ──
  `${V("cta-light", '[data-el="panel"]')}{background:var(--t-alt,#f1f7f1);color:var(--t-text,#0f172a);box-shadow:none}`,
  `${V("cta-light", '[data-el="panel"] [data-el="title"]')}{color:var(--t-text,#0f172a)}`,
  `${V("cta-light", '[data-el="panel"] [data-el="body"]')}{color:var(--t-muted,#475569)}`,
  `${V("cta-light", ".wb-cta-deco")}{display:none}`,
  `${V("cta-light", ".wb-btn:not(.wb-btn-secondary)")}{background:var(--website-primary);color:#fff;border-color:var(--website-primary)}`,
  `${V("cta-accent", '[data-el="panel"]')}{background:var(--website-primary)}`,
  `${V("cta-accent", ".wb-cta-deco")}{opacity:.25}`,
  // ── Careers ──
  `${V("careers-dark", '[data-el="panel"]')}{background:var(--t-dark,#0b1f1a)}`,
  ...darkTexts("careers-dark", '[data-el="panel"]>div:first-child'),
].join("");

/* ── Complete site templates ──────────────────────────────────────────── */

export type SiteTemplate = {
  label: [string, string];
  description: [string, string];
  theme: string;
  /** Block designs used by every page (a block's own choice still wins). */
  blockVariants: Partial<Record<BlockType, string>>;
};

export const SITE_TEMPLATES: Record<string, SiteTemplate> = {
  nature: {
    label: ["Agro nature", "Agro nature"],
    description: ["Le design Congo Omega : grande image, cartes, bandeau de chiffres.", "Congo Omega’s design: large image, cards, figures band."],
    theme: "verdant",
    blockVariants: { hero: "hero-image", feature_grid: "cards-default", metrics: "metrics-band", image_callout: "callout-left", cta: "cta-dark" },
  },
  corporate: {
    label: ["Corporate", "Corporate"],
    description: ["Sobre et structuré : texte + image, cartes épurées, FAQ en deux colonnes.", "Sober and structured: text + image, clean cards, two-column FAQ."],
    theme: "entreprise",
    blockVariants: {
      hero: "hero-split",
      rich_text: "text-split",
      feature_grid: "cards-minimal",
      metrics: "metrics-light",
      image_callout: "callout-right",
      faq: "faq-split",
      cta: "cta-accent",
    },
  },
  startup: {
    label: ["Moderne", "Modern"],
    description: ["Bleu, header en verre, chiffres en cartes, appel à l’action coloré.", "Blue, glass header, figure cards, colourful call to action."],
    theme: "ocean",
    blockVariants: { hero: "hero-split", feature_grid: "cards-numbered", metrics: "metrics-light", faq: "faq-split", cta: "cta-accent", gallery: "gallery-grid" },
  },
  elegant: {
    label: ["Élégant", "Elegant"],
    description: ["Polices à empattement, titre centré, image avec texte superposé.", "Serif fonts, centred title, image with overlaid text."],
    theme: "terre",
    blockVariants: {
      hero: "hero-centered",
      rich_text: "text-centered",
      feature_grid: "cards-numbered",
      metrics: "metrics-inline",
      image_callout: "callout-overlay",
      gallery: "gallery-grid",
      cta: "cta-light",
    },
  },
  luxe: {
    label: ["Luxe nuit", "Night luxury"],
    description: ["Site sombre et or, header transparent, logo au milieu, cartes sombres.", "Dark and gold site, transparent header, centred logo, dark cards."],
    theme: "nuit",
    blockVariants: { hero: "hero-centered", feature_grid: "cards-dark", metrics: "metrics-inline", image_callout: "callout-overlay", cta: "cta-accent" },
  },
  epure: {
    label: ["Épuré", "Clean"],
    description: ["Noir et blanc, sans image en haut, beaucoup d’espace.", "Black and white, no top image, lots of space."],
    theme: "minimal",
    blockVariants: {
      hero: "hero-minimal",
      rich_text: "text-left",
      feature_grid: "cards-minimal",
      metrics: "metrics-inline",
      gallery: "gallery-grid",
      faq: "faq-split",
      cta: "cta-light",
    },
  },
  chaleureux: {
    label: ["Chaleureux", "Warm"],
    description: ["Orange et arrondi, header flottant, grands numéros.", "Orange and rounded, floating header, large numbers."],
    theme: "soleil",
    blockVariants: { hero: "hero-image", feature_grid: "cards-numbered", metrics: "metrics-light", image_callout: "callout-right", cta: "cta-accent" },
  },
};
