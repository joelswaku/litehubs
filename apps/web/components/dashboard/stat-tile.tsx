"use client";

import { ArrowDown, ArrowRight, ArrowUp, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/states";

/**
 * A single headline figure.
 *
 * Deliberately not a chart. When the data's job is "one number, and whether it
 * moved", a chart adds axes and gridlines to communicate less — a big number
 * with a delta is the right form, and the sparkline is optional context rather
 * than the point.
 *
 * The delta pairs an **arrow with the colour**, never colour alone: red-green is
 * exactly the pair a colourblind reader cannot separate, and "down" is not
 * universally bad — down mortality is good, which is what `goodDirection`
 * expresses.
 */
export function StatTile({
  label,
  value,
  unit,
  delta,
  goodDirection = "up",
  icon: Icon,
  hint,
  loading,
  className,
}: {
  label: string;
  value: string | number | null | undefined;
  unit?: string;
  /** Percentage change against the comparison period. */
  delta?: number | null;
  /** Which way is an improvement. Mortality and cost are "down". */
  goodDirection?: "up" | "down" | "neutral";
  icon?: LucideIcon;
  hint?: string;
  loading?: boolean;
  className?: string;
}) {
  if (loading) {
    return (
      <div
        className={cn(
          "rounded-lg border border-border bg-surface-1 p-4",
          className,
        )}
      >
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-7 w-20" />
        <Skeleton className="mt-2 h-3 w-16" />
      </div>
    );
  }

  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const isFlat = hasDelta && Math.abs(delta) < 0.05;

  const isGood =
    !hasDelta || isFlat || goodDirection === "neutral"
      ? null
      : goodDirection === "up"
        ? delta > 0
        : delta < 0;

  const DeltaIcon =
    !hasDelta || isFlat ? ArrowRight : delta > 0 ? ArrowUp : ArrowDown;

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface-1 p-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-ink-secondary">{label}</p>
        {Icon ? (
          <Icon className="size-4 shrink-0 text-ink-muted" aria-hidden />
        ) : null}
      </div>

      {/* Proportional figures, not tabular — a standalone hero number reads
          better; tabular is for columns that must align. */}
      <motion.p
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="mt-2 text-2xl font-semibold tracking-tight text-ink"
      >
        {value ?? "—"}
        {unit ? (
          <span className="ml-1 text-sm font-normal text-ink-secondary">
            {unit}
          </span>
        ) : null}
      </motion.p>

      <div className="mt-1.5 flex items-center gap-1.5">
        {hasDelta ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium",
              isGood === null
                ? "text-ink-muted"
                : isGood
                  ? "text-good-ink"
                  : "text-critical",
            )}
          >
            <DeltaIcon className="size-3" aria-hidden />
            {isFlat ? "no change" : `${Math.abs(delta).toFixed(1)}%`}
          </span>
        ) : null}

        {hint ? (
          <span className="truncate text-xs text-ink-muted">{hint}</span>
        ) : null}
      </div>
    </div>
  );
}
