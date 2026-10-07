"use client";

/**
 * Motion for the public website renderer: scroll / hover animations, text
 * reveals and the responsive carousel. Everything here is optional, starts
 * from fully visible content, and switches itself off when the visitor asks
 * the system for reduced motion.
 */

import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Pause, Play } from "lucide-react";
import { BREAKPOINTS, animationOf, type StyleValues } from "./website-element-style";

/* ── Shared CSS ─────────────────────────────────────────────────────────── */

export const MOTION_CSS = [
  // Not inherited, so a child of an animated box is not animated twice.
  "@property --wb-anim{syntax:'*';inherits:false;initial-value:none}",
  // Word-by-word and typewriter reveals: only opacity changes, so wrapping
  // and line lengths never move while the text appears.
  "[data-site-root] .wb-w{transition:opacity calc(var(--anim-dur,700ms)*.5) ease;transition-delay:calc(var(--anim-delay,0ms) + var(--i,0)*var(--wb-step,70ms))}",
  "[data-site-root] .wb-c{transition:opacity 1ms linear;transition-delay:calc(var(--anim-delay,0ms) + var(--i,0)*var(--wb-step,30ms))}",
  '[data-site-root] [data-anim-state="hidden"] :is(.wb-w,.wb-c){opacity:0}',
  ".wb-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}",
  // Carousel track: native touch swipe and snapping, no visible scrollbar.
  "[data-site-root] .wb-track{scrollbar-width:none;-webkit-overflow-scrolling:touch}",
  "[data-site-root] .wb-track::-webkit-scrollbar{display:none}",
  // Reduced motion and printing always show everything, immediately.
  // (The builder still previews animations so the owner can see them.)
  "@media (prefers-reduced-motion:reduce){[data-site-root]:not([data-anim-preview]) [data-anim-state],[data-site-root]:not([data-anim-preview]) :is(.wb-w,.wb-c){opacity:1!important;transform:none!important;transition:none!important}[data-site-root] .wb-track{scroll-behavior:auto}}",
  "@media print{[data-site-root] [data-anim-state],[data-site-root] :is(.wb-w,.wb-c){opacity:1!important;transform:none!important}}",
].join("");

/* ── Text split for word-by-word / typewriter ─────────────────────────────── */

const BlockStylesContext = React.createContext<Record<string, StyleValues> | null>(null);

export function BlockStylesProvider({
  styles,
  children,
}: {
  styles: unknown;
  children: React.ReactNode;
}) {
  const value =
    styles && typeof styles === "object" ? (styles as Record<string, StyleValues>) : null;
  return <BlockStylesContext.Provider value={value}>{children}</BlockStylesContext.Provider>;
}

/**
 * Renders a text normally, or split into words / letters when the owner chose
 * a text reveal for this element. Screen readers always get the plain text.
 */
export function AnimatedText({
  name,
  shared,
  text,
}: {
  name: string;
  /** "All cards" style name, used when this item has no own animation. */
  shared?: string;
  text: string;
}) {
  const styles = React.useContext(BlockStylesContext);
  const own = styles?.[name] ? animationOf(styles[name]!) : null;
  const animation = own ?? (shared && styles?.[shared] ? animationOf(styles[shared]!) : null);
  if (!animation?.definition.text || !text) return <>{text}</>;
  // Very long texts reveal word by word: one span per letter would be heavy.
  const mode = animation.definition.text === "type" && text.length <= 420 ? "type" : "words";
  const parts = mode === "type" ? Array.from(text) : text.split(/(\s+)/);
  const visible = parts.filter((part) => part.trim()).length || 1;
  const step = Math.min(mode === "type" ? 80 : 160, Math.max(mode === "type" ? 12 : 30, animation.duration / visible));
  let index = 0;
  return (
    <>
      <span className="wb-sr">{text}</span>
      <span aria-hidden="true" style={{ "--wb-step": `${Math.round(step)}ms` } as React.CSSProperties}>
        {parts.map((part, position) => {
          if (!part.trim()) return part;
          const i = index++;
          return (
            <span
              key={position}
              className={mode === "type" ? "wb-c" : "wb-w"}
              style={{ "--i": i } as React.CSSProperties}
            >
              {part}
            </span>
          );
        })}
      </span>
    </>
  );
}

/* ── Runtime: arms elements and plays them when they enter the screen ────── */

export function AnimationRuntime({
  rootRef,
  replayKey,
  preview = false,
}: {
  rootRef: React.RefObject<HTMLElement | null>;
  replayKey?: number;
  /** In the builder: play even when the computer asks for reduced motion. */
  preview?: boolean;
}) {
  React.useEffect(() => {
    const root = rootRef.current;
    const doc = root?.ownerDocument;
    const win = doc?.defaultView;
    if (!root || !doc || !win || typeof win.IntersectionObserver !== "function") return;
    const reduced = win.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches && !preview) return;

    const show = (element: Element) => element.setAttribute("data-anim-state", "shown");
    const observer = new win.IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          // Two frames later, so the hidden state is painted first and the
          // transition really plays (also when replaying in the builder).
          const target = entry.target;
          win.requestAnimationFrame(() => win.requestAnimationFrame(() => show(target)));
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -4% 0px" },
    );
    const hoverReplay = new WeakSet<Element>();
    const replay = (element: Element) => {
      element.setAttribute("data-anim-state", "hidden");
      win.requestAnimationFrame(() => win.requestAnimationFrame(() => show(element)));
    };

    const scan = () => {
      const candidates = root.querySelectorAll("[data-el],[data-block-style]");
      candidates.forEach((element) => {
        const mode = win.getComputedStyle(element).getPropertyValue("--wb-anim").trim();
        const parentMode = element.parentElement
          ? win.getComputedStyle(element.parentElement).getPropertyValue("--wb-anim").trim()
          : "";
        const own = mode && mode !== "none" && mode !== parentMode ? mode : "";
        const armed = element.getAttribute("data-anim-armed");
        if (!own) {
          if (armed) {
            element.removeAttribute("data-anim-armed");
            element.removeAttribute("data-anim-state");
            observer.unobserve(element);
          }
          return;
        }
        if (armed === own) return;
        element.setAttribute("data-anim-armed", own);
        if (own === "view") {
          element.setAttribute("data-anim-state", "hidden");
          observer.observe(element);
        } else {
          element.removeAttribute("data-anim-state");
          observer.unobserve(element);
          // Text reveals replay on hover; box effects are pure CSS :hover.
          if (!hoverReplay.has(element) && element.querySelector(".wb-w,.wb-c")) {
            hoverReplay.add(element);
            element.addEventListener("mouseenter", () => {
              if (element.getAttribute("data-anim-armed") === "hover") replay(element);
            });
          }
        }
      });
    };

    let timer = 0;
    const schedule = () => {
      win.clearTimeout(timer);
      timer = win.setTimeout(scan, 120);
    };
    scan();
    // The builder changes styles and content live: re-scan after edits.
    const mutations = new win.MutationObserver(schedule);
    mutations.observe(root, { childList: true, subtree: true, characterData: true });
    const onReplay = () => {
      root.querySelectorAll('[data-anim-armed="view"]').forEach((element) => {
        element.setAttribute("data-anim-state", "hidden");
        observer.observe(element);
      });
    };
    doc.addEventListener("wb-replay", onReplay);
    const onReduce = () => {
      if (!reduced.matches || preview) return;
      root.querySelectorAll("[data-anim-state]").forEach(show);
    };
    reduced.addEventListener?.("change", onReduce);
    return () => {
      win.clearTimeout(timer);
      observer.disconnect();
      mutations.disconnect();
      doc.removeEventListener("wb-replay", onReplay);
      reduced.removeEventListener?.("change", onReduce);
      root.querySelectorAll("[data-anim-state]").forEach(show);
      // Forget the armed state so a replay ("Rejouer") hides and plays
      // every animation again from the start.
      root.querySelectorAll("[data-anim-armed]").forEach((element) => element.removeAttribute("data-anim-armed"));
    };
  }, [rootRef, replayKey, preview]);
  return null;
}

/* ── Carousel ───────────────────────────────────────────────────────────── */

export type SliderSettings = {
  perView?: number;
  perViewTablet?: number;
  perViewMobile?: number;
  gap?: number;
  arrows?: boolean;
  dots?: boolean;
  autoplay?: boolean;
  interval?: number;
  speed?: number;
  loop?: boolean;
  pauseOnHover?: boolean;
  /** Arrows appear only when the mouse is over the carousel. */
  arrowsOnHover?: boolean;
  /** Finger swipe (and trackpad scroll) to change slides. */
  swipe?: boolean;
  /** Left / right arrows, Home and End when the carousel has the focus. */
  keyboard?: boolean;
  /** Autoplay direction: "next" (right to left) or "prev" (left to right). */
  direction?: "next" | "prev";
  pauseOnFocus?: boolean;
  pauseWhenHidden?: boolean;
  /** Public play / pause button. */
  playButton?: boolean;
  /** Slides side by side (horizontal) or stacked (vertical). */
  orientation?: "horizontal" | "vertical";
  /** Height of a vertical carousel, in px. */
  height?: number;
  gapTablet?: number;
  gapMobile?: number;
};

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(number)
    ? Math.round(Math.min(max, Math.max(min, number)))
    : fallback;
}

export function readSliderSettings(raw: unknown) {
  const s = (raw && typeof raw === "object" ? raw : {}) as SliderSettings;
  const perView = clampInt(s.perView, 1, 6, 3);
  return {
    perView,
    perViewTablet: clampInt(s.perViewTablet, 1, 6, Math.min(perView, 2)),
    perViewMobile: clampInt(s.perViewMobile, 1, 3, 1),
    gap: clampInt(s.gap, 0, 80, 24),
    arrows: s.arrows !== false,
    dots: s.dots !== false,
    // Scrolls by itself unless the owner turned it off.
    autoplay: s.autoplay !== false,
    interval: clampInt(s.interval, 1500, 20000, 5000),
    speed: clampInt(s.speed, 100, 2000, 500),
    loop: s.loop !== false,
    pauseOnHover: s.pauseOnHover !== false,
    arrowsOnHover: s.arrowsOnHover === true,
    swipe: s.swipe !== false,
    keyboard: s.keyboard !== false,
    direction: s.direction === "prev" ? ("prev" as const) : ("next" as const),
    pauseOnFocus: s.pauseOnFocus !== false,
    pauseWhenHidden: s.pauseWhenHidden !== false,
    playButton: s.playButton === true,
    orientation: s.orientation === "vertical" ? ("vertical" as const) : ("horizontal" as const),
    height: clampInt(s.height, 160, 1200, 420),
    gapTablet: s.gapTablet === undefined ? null : clampInt(s.gapTablet, 0, 80, 24),
    gapMobile: s.gapMobile === undefined ? null : clampInt(s.gapMobile, 0, 80, 16),
  };
}

export function WebsiteSlider({
  el,
  settings: rawSettings,
  slides,
  editing = false,
  language,
}: {
  el: string;
  settings: unknown;
  slides: React.ReactNode[];
  editing?: boolean;
  language: "fr" | "en";
}) {
  const settings = readSliderSettings(rawSettings);
  const fr = language === "fr";
  const scopeId = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [index, setIndex] = React.useState(0);
  const [pages, setPages] = React.useState(1);
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [reduced, setReduced] = React.useState(false);
  const animating = React.useRef(0);
  const count = slides.length;

  const vertical = settings.orientation === "vertical";
  // Position along the carousel's direction (left for horizontal, top for vertical).
  const position = React.useCallback(
    (track: HTMLElement) => (vertical ? track.scrollTop : track.scrollLeft),
    [vertical],
  );
  const setPosition = React.useCallback(
    (track: HTMLElement, value: number) => {
      if (vertical) track.scrollTop = value;
      else track.scrollLeft = value;
    },
    [vertical],
  );
  const metrics = React.useCallback(() => {
    const track = trackRef.current;
    const items = track ? (Array.from(track.children) as HTMLElement[]) : [];
    if (!track || items.length < 1) return null;
    const step = vertical
      ? items.length > 1 ? items[1]!.offsetTop - items[0]!.offsetTop : items[0]!.offsetHeight
      : items.length > 1 ? items[1]!.offsetLeft - items[0]!.offsetLeft : items[0]!.offsetWidth;
    const size = vertical ? track.clientHeight : track.clientWidth;
    const visible = Math.max(1, Math.round((size + 1) / Math.max(1, step)));
    const max = vertical ? track.scrollHeight - track.clientHeight : track.scrollWidth - track.clientWidth;
    return { track, items, step: Math.max(1, step), last: Math.max(0, items.length - visible), max };
  }, [vertical]);

  const sync = React.useCallback(() => {
    const m = metrics();
    if (!m) return;
    setPages(m.last + 1);
    setIndex(Math.min(m.last, Math.round(position(m.track) / m.step)));
  }, [metrics, position]);

  React.useEffect(() => {
    const track = trackRef.current;
    const win = track?.ownerDocument.defaultView;
    if (!track || !win) return;
    const query = win.matchMedia("(prefers-reduced-motion: reduce)");
    // In the builder the owner always sees the real movement.
    const inBuilder = Boolean(track.closest("[data-anim-preview]"));
    setReduced(query.matches && !inBuilder);
    const onChange = () => setReduced(query.matches && !inBuilder);
    query.addEventListener?.("change", onChange);
    let frame = 0;
    const onScroll = () => {
      win.cancelAnimationFrame(frame);
      frame = win.requestAnimationFrame(sync);
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    const resize = new win.ResizeObserver(sync);
    resize.observe(track);
    sync();
    return () => {
      query.removeEventListener?.("change", onChange);
      track.removeEventListener("scroll", onScroll);
      resize.disconnect();
      win.cancelAnimationFrame(frame);
    };
  }, [sync, count]);

  const goTo = React.useCallback(
    (target: number) => {
      const m = metrics();
      if (!m) return;
      let next = target;
      if (next > m.last) next = settings.loop ? 0 : m.last;
      if (next < 0) next = settings.loop ? m.last : 0;
      const to = Math.min(next * m.step, m.max);
      const from = position(m.track);
      const win = m.track.ownerDocument.defaultView!;
      win.cancelAnimationFrame(animating.current);
      if (reduced || Math.abs(to - from) < 1) {
        setPosition(m.track, to);
        setIndex(next);
        return;
      }
      // Our own easing, so the chosen speed is respected; snapping is paused
      // during the movement and restored right after.
      const start = win.performance.now();
      m.track.style.scrollSnapType = "none";
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / settings.speed);
        const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        setPosition(m.track, from + (to - from) * eased);
        if (t < 1) animating.current = win.requestAnimationFrame(tick);
        else {
          m.track.style.scrollSnapType = "";
          setIndex(next);
        }
      };
      animating.current = win.requestAnimationFrame(tick);
    },
    [metrics, reduced, settings.loop, settings.speed, position, setPosition],
  );

  // Autoplay also runs in the builder; there it pauses under the mouse so
  // slides stay easy to click and edit.
  const running =
    settings.autoplay &&
    !reduced &&
    !paused &&
    !(settings.pauseOnFocus && focused) &&
    !((settings.pauseOnHover || editing) && hovered) &&
    pages > 1;
  React.useEffect(() => {
    if (!running) return;
    const win = trackRef.current?.ownerDocument.defaultView;
    if (!win) return;
    const timer = win.setInterval(() => {
      if (settings.pauseWhenHidden && win.document.visibilityState !== "visible") return;
      const m = metrics();
      if (!m) return;
      const current = Math.round(position(m.track) / m.step);
      const step = settings.direction === "prev" ? -1 : 1;
      if (!settings.loop && (step > 0 ? current >= m.last : current <= 0)) return;
      goTo(current + step);
    }, settings.interval);
    return () => win.clearInterval(timer);
  }, [running, settings.interval, settings.loop, settings.direction, settings.pauseWhenHidden, goTo, metrics, position]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!settings.keyboard) return;
    if (event.key === "ArrowRight" || (vertical && event.key === "ArrowDown")) {
      event.preventDefault();
      goTo(index + 1);
    } else if (event.key === "ArrowLeft" || (vertical && event.key === "ArrowUp")) {
      event.preventDefault();
      goTo(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      goTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      goTo(pages - 1);
    }
  };

  const scope = `[data-slider-id="${scopeId}"]`;
  // The number of visible slides chosen by the owner is always respected.
  const fit = (perView: number) => perView;
  const css =
    `${scope}{--pv:${fit(settings.perView)};--gap:${settings.gap}px}` +
    `@media (max-width:${BREAKPOINTS.tablet}px){${scope}{--pv:${fit(settings.perViewTablet)}${settings.gapTablet !== null ? `;--gap:${settings.gapTablet}px` : ""}}}` +
    `@media (max-width:${BREAKPOINTS.mobile}px){${scope}{--pv:${fit(settings.perViewMobile)};--gap:${settings.gapMobile ?? Math.min(settings.gapTablet ?? settings.gap, 16)}px}}` +
    // Vertical: a fixed height, slides stacked, scrolling up and down.
    (vertical
      ? `${scope} .wb-track{flex-direction:column;height:${settings.height}px;overflow-x:hidden;overflow-y:auto;scroll-snap-type:y mandatory;overscroll-behavior-y:contain}@media (max-width:${BREAKPOINTS.mobile}px){${scope} .wb-track{height:${Math.min(settings.height, 520)}px}}`
      : "") +
    // Without swipe the slides only change with arrows, dots or autoplay.
    (settings.swipe ? "" : `${scope} .wb-track{overflow:hidden;touch-action:${vertical ? "pan-x" : "pan-y"}}`) +
    // Arrows on mouse-over only (always visible on touch screens and focus).
    (settings.arrowsOnHover
      ? `@media (hover:hover){${scope} .wb-arrow{opacity:0}${scope}:hover .wb-arrow,${scope} .wb-arrow:focus-visible{opacity:1}}`
      : "");
  const canPrev = settings.loop || index > 0;
  const canNext = settings.loop || index < pages - 1;
  const arrowClass =
    "absolute top-1/2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-slate-200 bg-white/95 text-slate-900 shadow-md transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:pointer-events-none disabled:opacity-0";
  const arrowVertical = arrowClass.replace("top-1/2", "left-1/2").replace("-translate-y-1/2", "-translate-x-1/2");

  return (
    <div
      data-el={el}
      data-slider-id={scopeId}
      role="region"
      aria-roledescription={fr ? "carrousel" : "carousel"}
      aria-label={fr ? "Carrousel" : "Carousel"}
      className="relative w-full max-w-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <style>{css}</style>
      <div
        ref={trackRef}
        tabIndex={settings.keyboard ? 0 : undefined}
        aria-label={settings.keyboard ? (fr ? "Diapositives — flèches gauche et droite pour naviguer" : "Slides — left and right arrows to navigate") : undefined}
        onKeyDown={onKeyDown}
        aria-live={running ? "off" : "polite"}
        className="wb-track flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-[inherit] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-600"
        style={{ gap: "var(--gap)" }}
      >
        {slides.length ? (
          slides.map((slide, position) => (
            <div
              key={position}
              role="group"
              aria-roledescription={fr ? "diapositive" : "slide"}
              aria-label={fr ? `Diapositive ${position + 1} sur ${count}` : `Slide ${position + 1} of ${count}`}
              className="flex min-w-0 snap-start flex-col [&>*]:mt-0 [&>*]:h-full"
              style={{ flex: "0 0 calc((100% - (var(--pv) - 1) * var(--gap)) / var(--pv))" }}
            >
              {slide}
            </div>
          ))
        ) : editing ? (
          <div className="grid min-h-40 w-full place-items-center rounded-2xl border-2 border-dashed border-current/30 text-sm opacity-70">
            {fr ? "Carrousel vide : sélectionnez-le puis ajoutez des diapositives" : "Empty carousel: select it, then add slides"}
          </div>
        ) : null}
      </div>
      {settings.arrows && pages > 1 ? (
        <>
          <button
            type="button"
            className={vertical ? `wb-arrow ${arrowVertical} top-2` : `wb-arrow ${arrowClass} left-2`}
            onClick={() => goTo(index - 1)}
            disabled={!canPrev}
            aria-label={fr ? "Diapositive précédente" : "Previous slide"}
          >
            {vertical ? <ChevronUp className="size-5" /> : <ChevronLeft className="size-5" />}
          </button>
          <button
            type="button"
            className={vertical ? `wb-arrow ${arrowVertical} bottom-2` : `wb-arrow ${arrowClass} right-2`}
            onClick={() => goTo(index + 1)}
            disabled={!canNext}
            aria-label={fr ? "Diapositive suivante" : "Next slide"}
          >
            {vertical ? <ChevronDown className="size-5" /> : <ChevronRight className="size-5" />}
          </button>
        </>
      ) : null}
      {(settings.dots && pages > 1) || (settings.playButton && settings.autoplay && !reduced && pages > 1) ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {settings.playButton && settings.autoplay && !reduced && pages > 1 ? (
            <button
              type="button"
              onClick={() => setPaused((value) => !value)}
              aria-label={
                paused
                  ? fr ? "Reprendre le défilement" : "Resume autoplay"
                  : fr ? "Mettre le défilement en pause" : "Pause autoplay"
              }
              className="grid size-8 place-items-center rounded-full border border-current/25 opacity-80 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600"
            >
              {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            </button>
          ) : null}
          {settings.dots && pages > 1
            ? Array.from({ length: pages }, (_unused, dot) => (
                <button
                  key={dot}
                  type="button"
                  onClick={() => goTo(dot)}
                  aria-label={`${fr ? "Aller à la diapositive" : "Go to slide"} ${dot + 1}`}
                  aria-current={dot === index ? "true" : undefined}
                  className="grid size-6 place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600"
                >
                  <span
                    className={`block h-2 rounded-full bg-current transition-all ${
                      dot === index ? "w-6 opacity-90" : "w-2 opacity-35"
                    }`}
                  />
                </button>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}
