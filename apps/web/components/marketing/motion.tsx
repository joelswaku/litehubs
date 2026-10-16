"use client";

/**
 * Small motion helpers for the public pages. Content is rendered visible on the
 * server; only after mounting does an element below the fold get hidden and
 * then revealed when it scrolls into view.
 */
import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: ElementType;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<"idle" | "pending" | "shown">("idle");

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Already on screen at load: leave it alone, no flash.
    if (element.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    setState("pending");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setState("shown");
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={cn(
        state === "pending" && "lh-reveal-pending",
        state === "shown" && "lh-reveal-shown",
        className,
      )}
      style={state === "shown" && delay ? ({ transitionDelay: `${delay}ms` } as CSSProperties) : undefined}
    >
      {children}
    </Tag>
  );
}

/** A card whose border glows and whose surface follows the pointer. */
export function SpotlightCard({
  children,
  className,
  as: Tag = "div",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  [key: string]: unknown;
}) {
  return (
    <Tag
      {...rest}
      className={cn("lh-gradient-card lh-spotlight", className)}
      onMouseMove={(event: React.MouseEvent<HTMLElement>) => {
        const box = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--mx", `${event.clientX - box.left}px`);
        event.currentTarget.style.setProperty("--my", `${event.clientY - box.top}px`);
      }}
    >
      {children}
    </Tag>
  );
}

/** Endless, slow strip of labels (paused for reduced motion by globals.css). */
export function Ticker({ items }: { items: string[] }) {
  const row = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center gap-3 pr-3" aria-hidden={hidden || undefined}>
      {items.map((item) => (
        <li
          key={item}
          className="whitespace-nowrap rounded-full border border-border bg-surface-1 px-4 py-2 text-sm font-medium text-ink-secondary shadow-sm"
        >
          {item}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="relative flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
      <div className="flex w-max animate-[lh-marquee_45s_linear_infinite] hover:[animation-play-state:paused]">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
