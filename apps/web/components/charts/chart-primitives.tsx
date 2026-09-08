"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The pieces every chart in the app is built from.
 *
 * Centralised so the mark specs are applied once rather than remembered
 * twenty times. The specs themselves are fixed, and the reasons are worth
 * keeping next to them:
 *
 * - **Bars cap at 24px and never fill their slot.** The leftover band is air.
 *   A bar that fills its slot turns a chart into a solid block.
 * - **Lines are 2px, round join and cap.** Thin enough to read as data, thick
 *   enough to follow across a gridline.
 * - **Markers are at least 8px across with a 2px surface ring.** The ring keeps
 *   a dot legible where it crosses a line, and it is part of the hit target —
 *   an unringed 6px dot is effectively unhoverable on a touch screen.
 * - **Adjacent fills get a 2px surface gap, never a stroke.** A border around a
 *   mark adds ink that is not data. White space does the separating.
 * - **Grid and axes are hairline and solid, never dashed.** Dashes draw the eye
 *   to the chrome.
 * - **Text never wears the series colour.** Identity comes from a swatch beside
 *   the label. Yellow and aqua are illegible as text on the light surface, and
 *   three of the eight series colours are below 3:1 there.
 */

/** The fixed mark specs, so a chart never re-invents them. */
export const MARK = {
  barMaxThickness: 24,
  barRadius: 4,
  lineWidth: 2,
  markerRadius: 4,
  surfaceGap: 2,
  areaOpacity: 0.1,
} as const;

/**
 * Series colours in fixed order. Never cycled, never reordered.
 *
 * The order is the colour-vision safety mechanism: adjacent slots were chosen
 * so neighbouring series stay separable under protanopia and tritanopia.
 * Reordering silently breaks that, and a ninth series is never a generated hue —
 * it folds into "Other" or the chart becomes small multiples.
 */
export const SERIES_TOKENS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
] as const;

/** Hard cap. Past this, aggregate or facet — do not invent a colour. */
export const MAX_SERIES = SERIES_TOKENS.length;

/**
 * Scatter, bubble and choropleth compare *every* pair rather than only
 * neighbours, and the full eight cannot clear the separation floors that way.
 * The first three do, in both themes.
 */
export const MAX_SERIES_ALL_PAIRS = 3;

export function seriesColor(index: number): string {
  return SERIES_TOKENS[index % MAX_SERIES] ?? SERIES_TOKENS[0];
}

/**
 * The frame around a chart: title, optional actions, and the plot.
 *
 * `description` is not decoration — for a single-series chart it replaces the
 * legend, which would otherwise be one swatch restating the title.
 */
export function ChartFrame({
  title,
  description,
  action,
  children,
  className,
  /** Rendered under the plot. Keeps values reachable without colour. */
  footer,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
}) {
  return (
    <figure
      className={cn(
        "rounded-lg border border-border bg-surface-1 p-4",
        className,
      )}
    >
      <figcaption className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ink">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-xs text-ink-secondary">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </figcaption>

      {children}

      {footer ? <div className="mt-3">{footer}</div> : null}
    </figure>
  );
}

/**
 * Legend. Always present for two or more series.
 *
 * The swatch carries identity; the text stays in an ink token. That split is
 * what makes the legend work for a reader who cannot distinguish two of the
 * hues — they still get the label.
 */
export function ChartLegend({
  series,
  className,
}: {
  series: { label: string; color: string }[];
  className?: string;
}) {
  if (series.length < 2) return null;

  return (
    <ul
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}
    >
      {series.map((item) => (
        <li
          key={item.label}
          className="flex items-center gap-1.5 text-xs text-ink-secondary"
        >
          <span
            className="size-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: item.color }}
            aria-hidden
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Tooltip body for a hovered point.
 *
 * Values are tabular here because they sit in a column and must align. The
 * series colour appears as a swatch, never as the text colour.
 */
export function ChartTooltip({
  label,
  rows,
}: {
  label: string;
  rows: { name: string; value: string; color?: string }[];
}) {
  return (
    <div className="pointer-events-none rounded-md border border-border bg-surface-1 px-2.5 py-2 shadow-lg">
      <p className="mb-1 text-xs font-medium text-ink">{label}</p>
      <table className="w-full">
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td className="pr-3 align-middle">
                <span className="flex items-center gap-1.5 text-xs text-ink-secondary">
                  {row.color ? (
                    <span
                      className="size-2 shrink-0 rounded-sm"
                      style={{ backgroundColor: row.color }}
                      aria-hidden
                    />
                  ) : null}
                  {row.name}
                </span>
              </td>
              <td className="text-right text-xs font-medium text-ink tabular">
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The table behind every chart.
 *
 * Required, not optional. Three of the eight light-mode series colours sit below
 * 3:1 against the surface, so the relief rule applies: the values have to be
 * reachable as text. It also happens to be how a screen-reader user reads a
 * chart at all.
 */
export function ChartTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs text-ink-secondary hover:text-ink">
        Show values as a table
      </summary>
      <div className="scrollbar-thin mt-2 max-h-64 overflow-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-surface-1">
            <tr className="border-b border-border">
              {columns.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  className={cn(
                    "py-1.5 pr-3 font-medium text-ink-secondary",
                    index > 0 && "text-right",
                  )}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-border/50">
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={cn(
                      "py-1.5 pr-3 text-ink",
                      cellIndex > 0 && "text-right",
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
