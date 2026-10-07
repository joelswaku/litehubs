/**
 * Per-element styling for the visual website builder.
 *
 * The builder stores plain, small values (numbers, keywords, "120px") in a
 * block's `elementStyles`. This module is the single place that turns them
 * into CSS. Every value is validated against a whitelist or a strict pattern,
 * so stored content can never inject arbitrary CSS into a public page.
 */

export type StyleValues = Record<string, unknown>;

export const LENGTH_UNITS = ["px", "%", "rem", "vh", "vw"] as const;

export const WEBSITE_FONTS: Record<
  string,
  { label: string; stack: string; google?: string }
> = {
  sans: { label: "Sans (par défaut)", stack: "ui-sans-serif, system-ui, sans-serif" },
  serif: { label: "Serif", stack: "Georgia, 'Times New Roman', serif" },
  mono: { label: "Mono", stack: "ui-monospace, 'SFMono-Regular', Menlo, monospace" },
  poppins: { label: "Poppins", stack: "'Poppins', sans-serif", google: "Poppins:wght@300;400;500;600;700;800" },
  montserrat: { label: "Montserrat", stack: "'Montserrat', sans-serif", google: "Montserrat:wght@300;400;500;600;700;800" },
  roboto: { label: "Roboto", stack: "'Roboto', sans-serif", google: "Roboto:wght@300;400;500;700;900" },
  inter: { label: "Inter", stack: "'Inter', sans-serif", google: "Inter:wght@300;400;500;600;700;800" },
  playfair: { label: "Playfair Display", stack: "'Playfair Display', serif", google: "Playfair+Display:wght@400;600;700;800" },
  lora: { label: "Lora", stack: "'Lora', serif", google: "Lora:wght@400;500;600;700" },
};

export const SHADOWS: Record<string, string> = {
  none: "none",
  sm: "0 1px 3px rgba(15,23,42,.12)",
  md: "0 8px 20px -6px rgba(15,23,42,.22)",
  lg: "0 18px 40px -12px rgba(15,23,42,.30)",
  xl: "0 32px 70px -20px rgba(15,23,42,.42)",
};

const HEX = /^#[0-9a-f]{6}$/i;
const LENGTH = /^(-?\d{1,4}(\.\d{1,2})?)(px|%|rem|vh|vw)$/;

export function hexColor(value: unknown): string | null {
  return typeof value === "string" && HEX.test(value.trim()) ? value.trim() : null;
}

/** "auto", or a number with a whitelisted unit. Negative only when allowed. */
export function cssLength(value: unknown, allowNegative = false): string | null {
  if (value === "auto") return "auto";
  if (typeof value !== "string") return null;
  const match = value.trim().match(LENGTH);
  if (!match) return null;
  const number = Number(match[1]);
  if (!allowNegative && number < 0) return null;
  return `${number}${match[3]}`;
}

function clampNumber(value: unknown, min: number, max: number): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : null;
}

function rgba(hex: string, opacity: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${(opacity / 100).toFixed(2)})`;
}

function pick<T extends string>(value: unknown, map: Record<string, T>): T | null {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(map, value)
    ? map[value]!
    : null;
}

/** Image sources allowed in CSS: site-relative paths or https URLs. */
function cssImage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const source = value.trim();
  if (!source) return null;
  const ok =
    (source.startsWith("/") && !source.startsWith("//")) ||
    (() => {
      try {
        return new URL(source).protocol === "https:";
      } catch {
        return false;
      }
    })();
  return ok ? source.replace(/["\\\n()]/g, encodeURIComponent) : null;
}

const JUSTIFY = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly",
};
const ALIGN = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };
const SELF = { auto: "auto", start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };

/**
 * CSS declarations for one element. `name` is its builder name; a few
 * built-in groups (button rows, highlights) interpret alignment differently.
 */
export function styleDeclarations(name: string, style: StyleValues): string[] {
  const out: string[] = [];
  const push = (property: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && value !== "") out.push(`${property}:${value}`);
  };

  // ── Texte ──
  push("color", hexColor(style.color));
  const font = typeof style.fontFamily === "string" ? WEBSITE_FONTS[style.fontFamily] : undefined;
  if (font) push("font-family", font.stack);
  const weight = clampNumber(style.weight, 100, 900);
  if (weight !== null) push("font-weight", Math.round(weight / 100) * 100);
  else if (style.bold === true) push("font-weight", 700);
  else if (style.bold === false) push("font-weight", 400);
  if (style.italic === true) push("font-style", "italic");
  const size = clampNumber(style.size, 8, 160);
  if (size !== null) {
    const min = Math.max(14, Math.round(size * 0.6));
    push(
      "font-size",
      size <= 22 ? `${size}px` : `clamp(${min}px,${(size / 12).toFixed(2)}vw,${size}px)`,
    );
    if (size > 22 && style.lineHeight === undefined) push("line-height", 1.08);
  }
  const lineHeight = clampNumber(style.lineHeight, 0.8, 3);
  if (lineHeight !== null) push("line-height", lineHeight);
  const letterSpacing = clampNumber(style.letterSpacing, -0.1, 0.5);
  if (letterSpacing !== null) push("letter-spacing", `${letterSpacing}em`);
  const textTransform = pick(style.textTransform, {
    none: "none",
    uppercase: "uppercase",
    lowercase: "lowercase",
    capitalize: "capitalize",
  });
  push("text-transform", textTransform);

  // Text alignment also positions the element itself (left / centre / right).
  const align = style.align;
  if (align === "left" || align === "center" || align === "right" || align === "justify") {
    if (name === "buttons" || name === "badges") {
      push("justify-content", align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center");
    } else {
      push("text-align", align);
      if (align !== "justify") {
        push("margin-left", align === "left" ? "0" : "auto");
        push("margin-right", align === "right" ? "0" : "auto");
      }
      if (name === "eyebrow") out.push("display:flex", "width:fit-content");
    }
  }

  // ── Dimensions ──
  if (style.width === "full") out.push("width:100%", "align-self:stretch");
  else if (style.width === "auto") out.push("width:fit-content");
  else push("width", cssLength(style.width));
  push("height", cssLength(style.height));
  // A fixed minimum never forces a page wider than the screen.
  const minWidth = cssLength(style.minWidth);
  push("min-width", minWidth && minWidth !== "auto" ? `min(${minWidth},100%)` : minWidth);
  const maxWidth = style.maxWidth === "none" ? "none" : cssLength(style.maxWidth);
  // A fixed width never overflows a smaller screen unless a max is chosen.
  push("max-width", maxWidth ?? (cssLength(style.width) ? "100%" : null));
  // Media with a fixed height is cropped, never stretched.
  if (cssLength(style.height)) push("object-fit", "cover");
  push("min-height", cssLength(style.minHeight));
  push("max-height", style.maxHeight === "none" ? "none" : cssLength(style.maxHeight));

  // ── Disposition ──
  const display = pick(style.display, { block: "block", flex: "flex", grid: "grid", none: "none" });
  push("display", display);
  push(
    "flex-direction",
    pick(style.direction, {
      row: "row",
      column: "column",
      "row-reverse": "row-reverse",
      "column-reverse": "column-reverse",
    }),
  );
  if (style.wrap === true) push("flex-wrap", "wrap");
  if (style.wrap === false) push("flex-wrap", "nowrap");
  push("justify-content", pick(style.justify, JUSTIFY));
  push("align-items", pick(style.alignItems, ALIGN));
  push("align-content", pick(style.alignContent, { ...JUSTIFY, stretch: "stretch" }));

  // ── Grille ──
  const columns = clampNumber(style.gridColumns, 1, 12);
  if (columns !== null) {
    const columnWidth = cssLength(style.gridColumnWidth);
    const track = columnWidth && columnWidth !== "auto" ? columnWidth : "minmax(0,1fr)";
    push("grid-template-columns", `repeat(${Math.round(columns)},${track})`);
  }
  // A child spanning every column of its grid (e.g. the footer's bottom row).
  if (style.spanAll === true) push("grid-column", "1/-1");
  // A thin separator line above (footer bottom row, second header row).
  if (style.dividerTop === true && style.borderWidth === undefined)
    push("border-top", "1px solid color-mix(in srgb,currentColor 18%,transparent)");

  // ── Espacement ──
  const px = (key: string, min = 0, max = 400) => {
    const number = clampNumber(style[key], min, max);
    return number === null ? null : `${Math.round(number)}px`;
  };
  push("gap", px("gap", 0, 200));
  push("row-gap", px("rowGap", 0, 200));
  push("column-gap", px("columnGap", 0, 200));
  for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
    const margin = style[`margin${side}`] === "auto" ? "auto" : px(`margin${side}`, -400, 400);
    push(`margin-${side.toLowerCase()}`, margin);
    push(`padding-${side.toLowerCase()}`, px(`padding${side}`));
  }

  // ── Fond ──
  const base = hexColor(style.background);
  if (base) push("background-color", base);
  const layers: Array<{ image: string; size: string; position: string; repeat: string }> = [];
  const overlay = hexColor(style.overlayColor);
  const overlayOpacity = clampNumber(style.overlayOpacity, 0, 100) ?? 40;
  if (overlay) {
    const color = rgba(overlay, overlayOpacity);
    layers.push({ image: `linear-gradient(${color},${color})`, size: "100% 100%", position: "center", repeat: "no-repeat" });
  }
  const image = cssImage(style.backgroundImage);
  if (image) {
    layers.push({
      image: `url("${image}")`,
      size: pick(style.backgroundSize, { cover: "cover", contain: "contain", auto: "auto" }) ?? "cover",
      position:
        pick(style.backgroundPosition, {
          center: "center",
          top: "top",
          bottom: "bottom",
          left: "left",
          right: "right",
        }) ?? "center",
      repeat:
        pick(style.backgroundRepeat, {
          "no-repeat": "no-repeat",
          repeat: "repeat",
          "repeat-x": "repeat-x",
          "repeat-y": "repeat-y",
        }) ?? "no-repeat",
    });
  }
  const from = hexColor(style.gradientFrom);
  const to = hexColor(style.gradientTo);
  if (from && to) {
    const angle = clampNumber(style.gradientAngle, 0, 360) ?? 135;
    layers.push({
      image: `linear-gradient(${Math.round(angle)}deg,${from},${to})`,
      size: "100% 100%",
      position: "center",
      repeat: "no-repeat",
    });
  }
  if (layers.length) {
    out.push(
      `background-image:${layers.map((layer) => layer.image).join(",")}`,
      `background-size:${layers.map((layer) => layer.size).join(",")}`,
      `background-position:${layers.map((layer) => layer.position).join(",")}`,
      `background-repeat:${layers.map((layer) => layer.repeat).join(",")}`,
    );
  }

  // ── Bordure ──
  const borderWidth = px("borderWidth", 0, 24);
  if (borderWidth !== null) {
    const borderStyle =
      pick(style.borderStyle, {
        solid: "solid",
        dashed: "dashed",
        dotted: "dotted",
        double: "double",
        none: "none",
      }) ?? "solid";
    out.push(`border:${borderWidth} ${borderStyle} ${hexColor(style.borderColor) ?? "currentColor"}`);
  }
  push("border-radius", px("radius", 0, 400));
  push("border-top-left-radius", px("radiusTopLeft", 0, 400));
  push("border-top-right-radius", px("radiusTopRight", 0, 400));
  push("border-bottom-right-radius", px("radiusBottomRight", 0, 400));
  push("border-bottom-left-radius", px("radiusBottomLeft", 0, 400));

  // ── Effets ──
  push("box-shadow", pick(style.shadow, SHADOWS));
  const opacity = clampNumber(style.opacity, 0, 100);
  if (opacity !== null) push("opacity", (opacity / 100).toFixed(2));

  // ── Position ──
  push(
    "position",
    pick(style.position, {
      static: "static",
      relative: "relative",
      absolute: "absolute",
      fixed: "fixed",
      sticky: "sticky",
    }),
  );
  for (const side of ["top", "right", "bottom", "left"] as const) push(side, cssLength(style[side], true));
  const zIndex = clampNumber(style.zIndex, -10, 100);
  if (zIndex !== null) push("z-index", Math.round(zIndex));

  // ── Débordement ──
  push("overflow", pick(style.overflow, { visible: "visible", hidden: "hidden", auto: "auto", scroll: "scroll" }));

  // ── Élément enfant ──
  const order = clampNumber(style.order, -20, 100);
  if (order !== null) push("order", Math.round(order));
  const grow = clampNumber(style.flexGrow, 0, 10);
  if (grow !== null) push("flex-grow", grow);
  const shrink = clampNumber(style.flexShrink, 0, 10);
  if (shrink !== null) push("flex-shrink", shrink);
  push("flex-basis", cssLength(style.flexBasis));
  push("align-self", pick(style.alignSelf, SELF));

  // ── Animations ──
  out.push(...animationDeclarations(style));

  return out;
}

/** Google Fonts stylesheet URL for the fonts a block uses, if any. */
export function googleFontsHref(styles: unknown): string | null {
  if (!styles || typeof styles !== "object") return null;
  const families = new Set<string>();
  for (const style of Object.values(styles as Record<string, StyleValues>)) {
    const font =
      style && typeof style === "object" && typeof style.fontFamily === "string"
        ? WEBSITE_FONTS[style.fontFamily]
        : undefined;
    if (font?.google) families.add(font.google);
  }
  if (!families.size) return null;
  return `https://fonts.googleapis.com/css2?${[...families]
    .map((family) => `family=${family}`)
    .join("&")}&display=swap`;
}

/* ────────────────────────────────────────────────────────────────────────
 * Automatic responsive engine
 *
 * The owner designs on a laptop. These rules derive the tablet and phone
 * versions from the same values, so every block, container and element —
 * existing or future — adapts without a separate mobile design. Optional
 * per-device adjustments (style.tablet / style.mobile) are applied last.
 * ──────────────────────────────────────────────────────────────────────── */

export const BREAKPOINTS = { tablet: 1024, mobile: 640 } as const;
export type Breakpoint = "desktop" | "tablet" | "mobile";

const SPACING_KEYS = [
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
];

/** Keys that only make sense together; an override of one keeps the others. */
const LINKED_GROUPS = [
  [
    "background",
    "gradientFrom",
    "gradientTo",
    "gradientAngle",
    "backgroundImage",
    "backgroundSize",
    "backgroundPosition",
    "backgroundRepeat",
    "overlayColor",
    "overlayOpacity",
  ],
  ["borderWidth", "borderStyle", "borderColor"],
  ["gridColumns", "gridColumnWidth"],
  ["size", "lineHeight"],
];

function overrideStyle(base: StyleValues, override: StyleValues): StyleValues {
  const result: StyleValues = { ...override };
  for (const group of LINKED_GROUPS) {
    if (group.some((key) => key in override))
      for (const key of group) if (!(key in result) && key in base) result[key] = base[key];
  }
  return result;
}

function deviceOverride(style: StyleValues, device: "tablet" | "mobile"): StyleValues | null {
  const value = style[device];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as StyleValues)
    : null;
}

function lengthNumber(value: unknown): { number: number; unit: string } | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(-?\d+(?:\.\d+)?)(px|%|rem|vh|vw)$/);
  return match ? { number: Number(match[1]), unit: match[2]! } : null;
}

/** Spacing shrinks on smaller screens, but small values are kept as-is. */
function scaledSpacing(style: StyleValues, factor: number, keep: number): string[] {
  const out: string[] = [];
  for (const key of SPACING_KEYS) {
    const raw = style[key];
    if (raw === "auto" || raw === undefined || raw === "") continue;
    const number = Number(raw);
    if (!Number.isFinite(number) || Math.abs(number) <= keep) continue;
    const scaled = Math.sign(number) * Math.max(keep, Math.round(Math.abs(number) * factor));
    const property = key.replace(/[A-Z]/, (letter) => `-${letter.toLowerCase()}`);
    out.push(`${property}:${scaled}px`);
  }
  for (const [key, property] of [
    ["gap", "gap"],
    ["rowGap", "row-gap"],
    ["columnGap", "column-gap"],
  ] as const) {
    const number = Number(style[key]);
    if (style[key] !== undefined && Number.isFinite(number) && number > keep)
      out.push(`${property}:${Math.max(keep, Math.round(number * factor))}px`);
  }
  return out;
}

function autoTablet(style: StyleValues): string[] {
  const out = scaledSpacing(style, 0.75, 16);
  // A fixed height becomes a minimum: content is never cut on a narrower screen.
  const height = lengthNumber(style.height);
  if (height && height.unit !== "%") out.push("height:auto", `min-height:${style.height}`);
  if (style.wrap === false) out.push("flex-wrap:wrap");
  const columns = Number(style.gridColumns);
  if (Number.isFinite(columns) && (columns > 2 || Number(style.gridColumnsTablet) > 0)) {
    const tabletColumns = Number(style.gridColumnsTablet) || Math.max(2, Math.ceil(columns / 2));
    out.push(`grid-template-columns:repeat(${Math.min(12, Math.round(tabletColumns))},minmax(0,1fr))`);
  }
  const columnWidth = lengthNumber(style.gridColumnWidth);
  if (columnWidth && columnWidth.unit === "px")
    out.push(
      `grid-template-columns:repeat(auto-fill,minmax(min(${columnWidth.number}px,100%),1fr))`,
    );
  return out;
}

function autoMobile(style: StyleValues, stack: boolean): string[] {
  const out = scaledSpacing(style, 0.5, 12);
  // Large titles shrink further on phones while staying readable.
  const size = Number(style.size);
  if (style.size !== undefined && Number.isFinite(size) && size > 22) {
    const min = Math.max(18, Math.round(size * 0.45));
    out.push(`font-size:clamp(${min}px,${(size / 12).toFixed(2)}vw,${Math.round(size * 0.7)}px)`);
  }
  const height = lengthNumber(style.height);
  if (height && height.unit !== "%") out.push("height:auto", `min-height:${style.height}`);
  // Columns side by side become one readable column, in document order.
  if (stack && style.display !== "grid" && style.display !== "block") {
    out.push("flex-direction:column", "flex-wrap:nowrap");
    if (style.alignItems === undefined) out.push("align-items:stretch");
  }
  const columns = Number(style.gridColumns);
  if (Number.isFinite(columns) && columns >= 1) {
    const mobile = Number(style.gridColumnsMobile) || 1;
    out.push(`grid-template-columns:repeat(${Math.min(6, Math.round(mobile))},minmax(0,1fr))`);
  }
  // Partial widths (50%, 40vw…) take the full line once stacked.
  const width = lengthNumber(style.width);
  if (width && (width.unit === "%" || width.unit === "vw") && width.number < 100)
    out.push("width:100%");
  if (style.flexBasis !== undefined) out.push("flex-basis:auto");
  // Absolutely placed pieces rejoin the flow so nothing overlaps on a phone.
  if (style.position === "absolute")
    out.push("position:relative", "top:auto", "right:auto", "bottom:auto", "left:auto");
  if (style.position === "fixed") out.push("max-width:calc(100vw - 16px)");
  return out;
}

/**
 * Every CSS rule for one element: the laptop design, the automatic tablet
 * and phone adaptations, then the owner's optional per-device adjustments.
 * The builder preview and the public site both use exactly this output.
 */
export function elementRules(
  selector: string,
  name: string,
  style: StyleValues,
  options: { stack?: boolean } = {},
): string[] {
  const rules: string[] = [];
  const base = [...styleDeclarations(name, style), ...interactionBaseDeclarations(style)];
  if (base.length) rules.push(`${selector}{${base.join(";")}}`);
  rules.push(...animationRules(selector, style));
  rules.push(...stateRules(selector, style));
  const media = (width: number, declarations: string[]) => {
    if (declarations.length)
      rules.push(`@media (max-width:${width}px){${selector}{${declarations.join(";")}}}`);
  };
  media(BREAKPOINTS.tablet, autoTablet(style));
  const tablet = deviceOverride(style, "tablet");
  if (tablet) media(BREAKPOINTS.tablet, styleDeclarations(name, overrideStyle(style, tablet)));
  media(BREAKPOINTS.mobile, autoMobile({ ...style, ...(tablet ?? {}) }, Boolean(options.stack)));
  const mobile = deviceOverride(style, "mobile");
  if (mobile)
    media(
      BREAKPOINTS.mobile,
      styleDeclarations(name, overrideStyle({ ...style, ...(tablet ?? {}) }, mobile)),
    );
  return rules;
}

/* ── States and interactions (normal, hover, active, focus, disabled) ───── */

export const INTERACTION_STATES = ["hover", "active", "focus", "disabled"] as const;
export type InteractionState = (typeof INTERACTION_STATES)[number];
const STATE_PSEUDO: Record<InteractionState, string[]> = {
  hover: [":hover"],
  active: [":active"],
  focus: [":focus-visible", ":focus-within"],
  disabled: [":disabled", '[aria-disabled="true"]'],
};
export const CURSORS = ["auto", "default", "pointer", "zoom-in", "zoom-out", "grab", "help", "text", "move", "not-allowed"];
export const EASINGS: Record<string, string> = {
  ease: "ease",
  "ease-in": "ease-in",
  "ease-out": "ease-out",
  "ease-in-out": "ease-in-out",
  linear: "linear",
  spring: "cubic-bezier(.34,1.56,.64,1)",
};

/** translate / scale / rotate from validated numbers only. */
function transformOf(style: StyleValues): string | null {
  const x = clampNumber(style.translateX, -400, 400);
  const y = clampNumber(style.translateY, -400, 400);
  const scale = clampNumber(style.scale, 10, 300);
  const rotate = clampNumber(style.rotate, -360, 360);
  if (x === null && y === null && scale === null && rotate === null) return null;
  const parts: string[] = [];
  if (x !== null || y !== null) parts.push(`translate(${Math.round(x ?? 0)}px,${Math.round(y ?? 0)}px)`);
  if (scale !== null) parts.push(`scale(${(scale / 100).toFixed(2)})`);
  if (rotate !== null) parts.push(`rotate(${Math.round(rotate)}deg)`);
  return parts.join(" ");
}

function stateStyle(style: StyleValues, state: InteractionState): StyleValues | null {
  const value = style[state];
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length
    ? (value as StyleValues)
    : null;
}

/** What one state changes. Every value is validated: no free CSS. */
function stateDeclarations(state: StyleValues): { look: string[]; motion: string[] } {
  const look: string[] = [];
  const color = hexColor(state.color);
  if (color) look.push(`color:${color}`);
  const background = hexColor(state.background);
  if (background) look.push(`background-color:${background}`);
  const image = cssImage(state.backgroundImage);
  if (image) look.push(`background-image:url("${image}")`, "background-size:cover", "background-position:center");
  const borderColor = hexColor(state.borderColor);
  const borderOpacity = clampNumber(state.borderOpacity, 0, 100);
  const border =
    borderColor && borderOpacity !== null && borderOpacity < 100
      ? `color-mix(in srgb,${borderColor} ${Math.round(borderOpacity)}%,transparent)`
      : borderColor;
  const borderWidth = clampNumber(state.borderWidth, 0, 24);
  if (borderWidth !== null) look.push(`border:${Math.round(borderWidth)}px solid ${border ?? "currentColor"}`);
  else if (border) look.push(`border-color:${border}`);
  const radius = clampNumber(state.radius, 0, 400);
  if (radius !== null) look.push(`border-radius:${Math.round(radius)}px`);
  const shadow = typeof state.shadow === "string" ? SHADOWS[state.shadow] : undefined;
  if (shadow) look.push(`box-shadow:${shadow}`);
  const opacity = clampNumber(state.opacity, 0, 100);
  if (opacity !== null) look.push(`opacity:${(opacity / 100).toFixed(2)}`);
  if (typeof state.cursor === "string" && CURSORS.includes(state.cursor)) look.push(`cursor:${state.cursor}`);
  const transform = transformOf(state);
  return { look, motion: transform ? [`transform:${transform}`] : [] };
}

function hasStates(style: StyleValues) {
  return INTERACTION_STATES.some((state) => stateStyle(style, state));
}

/** Normal state: cursor, resting transform and the transition between states. */
function interactionBaseDeclarations(style: StyleValues): string[] {
  const out: string[] = [];
  if (typeof style.cursor === "string" && CURSORS.includes(style.cursor)) out.push(`cursor:${style.cursor}`);
  const transform = transformOf(style);
  if (transform) out.push(`transform:${transform}`);
  const duration = clampNumber(style.transitionDuration, 0, 3000);
  if ((hasStates(style) || duration !== null) && !animationOf(style)) {
    const time = Math.round(duration ?? 220);
    const delay = Math.round(clampNumber(style.transitionDelay, 0, 3000) ?? 0);
    const easing = EASINGS[String(style.transitionEasing)] ?? "ease";
    out.push(
      `transition:${["color", "background-color", "border-color", "box-shadow", "opacity", "transform", "border-radius"]
        .map((property) => `${property} ${time}ms ${easing} ${delay}ms`)
        .join(",")}`,
    );
  }
  return out;
}

/**
 * Hover / active / focus / disabled rules. "[data-wb-state]" lets the
 * builder show a state while it is being edited. Movement (transform) is
 * left out for visitors who ask for reduced motion.
 */
function stateRules(selector: string, style: StyleValues): string[] {
  const rules: string[] = [];
  for (const state of INTERACTION_STATES) {
    const values = stateStyle(style, state);
    if (!values) continue;
    const { look, motion } = stateDeclarations(values);
    const live = STATE_PSEUDO[state].map((pseudo) => `${selector}${pseudo}`);
    const preview = `${selector}[data-wb-state="${state}"]`;
    if (look.length) rules.push(`${[...live, preview].join(",")}{${look.join(";")}}`);
    if (motion.length) {
      rules.push(`@media (prefers-reduced-motion:no-preference){${live.join(",")}{${motion.join(";")}}}`);
      rules.push(`${preview}{${motion.join(";")}}`);
    }
  }
  if (hasStates(style) || style.transitionDuration !== undefined)
    rules.push(`@media (prefers-reduced-motion:reduce){[data-site-root]:not([data-anim-preview]) ${selector}{transition:none}}`);
  return rules;
}

/** Page-wide safety rules, shared by the builder preview and the live site. */
export const SITE_RESPONSIVE_CSS = [
  // Tailwind utilities keep priority over these defaults (lower layer).
  "@layer base{",
  // Long words may break so a text never forces its box wider than the screen.
  "[data-site-root] :is(h1,h2,h3,h4,h5,h6,p,li,a,span,label,dt,dd,blockquote){overflow-wrap:anywhere}",
  "[data-site-root] :is(img,video,iframe,canvas,svg){max-width:100%}",
  "[data-site-root] :is(video,iframe){height:auto;aspect-ratio:16/9}",
  "[data-site-root] :is(input,select,textarea,button){max-width:100%}",
  "}",
  // Never a horizontal scroll caused by the page itself (clip keeps sticky).
  "[data-site-root]{overflow-x:clip}",
  `@media (max-width:${BREAKPOINTS.mobile}px){`,
  // Containers holding more than buttons stack into one column on phones.
  '[data-site-root] [data-stack="auto"]{flex-direction:column;flex-wrap:nowrap;align-items:stretch}',
  '[data-site-root] [data-stack="auto"]>*{max-width:100%}',
  // Touch-friendly buttons that wrap instead of overflowing.
  "[data-site-root] a[data-el]{min-height:44px;white-space:normal}",
  "}",
].join("");

/* ── Animation settings → CSS (used by the style engine) ─────────────────── */

const ANIMATIONS: Record<string, { hidden?: string; hover?: string; text?: "words" | "type" }> = {
  fade: { hidden: "opacity:0", hover: "opacity:.82" },
  "slide-up": { hidden: "opacity:0;transform:translateY(28px)", hover: "transform:translateY(-6px)" },
  "slide-down": { hidden: "opacity:0;transform:translateY(-28px)", hover: "transform:translateY(6px)" },
  "slide-left": { hidden: "opacity:0;transform:translateX(28px)", hover: "transform:translateX(-6px)" },
  "slide-right": { hidden: "opacity:0;transform:translateX(-28px)", hover: "transform:translateX(6px)" },
  zoom: { hidden: "opacity:0;transform:scale(.94)", hover: "transform:scale(1.035)" },
  words: { text: "words" },
  typewriter: { text: "type" },
};

export function animationOf(style: StyleValues) {
  const type = typeof style.animType === "string" ? style.animType : "";
  const definition = ANIMATIONS[type];
  if (!definition) return null;
  const number = (value: unknown, min: number, max: number, fallback: number) => {
    const parsed = Number(value);
    return value !== undefined && value !== "" && Number.isFinite(parsed)
      ? Math.round(Math.min(max, Math.max(min, parsed)))
      : fallback;
  };
  return {
    type,
    definition,
    trigger: style.animTrigger === "hover" ? "hover" : "view",
    duration: number(style.animDuration, 100, 4000, 700),
    delay: number(style.animDelay, 0, 5000, 0),
  } as const;
}

/** Declarations added to the element's own rule. */
export function animationDeclarations(style: StyleValues): string[] {
  const animation = animationOf(style);
  if (!animation) return [];
  const out = [
    `--wb-anim:${animation.trigger}`,
    `--anim-dur:${animation.duration}ms`,
    `--anim-delay:${animation.delay}ms`,
  ];
  if (!animation.definition.text)
    out.push(
      `transition:opacity ${animation.duration}ms ease ${animation.trigger === "view" ? animation.delay : 0}ms,transform ${animation.duration}ms cubic-bezier(.22,1,.36,1) ${animation.trigger === "view" ? animation.delay : 0}ms`,
    );
  return out;
}

/** Extra rules: the hidden starting state and the hover effect. */
export function animationRules(selector: string, style: StyleValues): string[] {
  const animation = animationOf(style);
  if (!animation || animation.definition.text) return [];
  if (animation.trigger === "view")
    return [`${selector}[data-anim-state="hidden"]{${animation.definition.hidden}}`];
  return [
    `@media (prefers-reduced-motion:no-preference){${selector}:hover{${animation.definition.hover}}}`,
    // The builder previews hover effects even with reduced motion turned on.
    `[data-anim-preview] ${selector}:hover{${animation.definition.hover}}`,
  ];
}

