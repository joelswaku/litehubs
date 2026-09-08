"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartFrame,
  ChartLegend,
  ChartTable,
  ChartTooltip,
  MARK,
  MAX_SERIES,
  seriesColor,
} from "./chart-primitives";
import { EmptyState } from "@/components/ui/states";

export interface TrendSeries {
  key: string;
  label: string;
  /** Renders a 10%-opacity wash under the line. One series only. */
  area?: boolean;
}

/**
 * Change over time, as a line or area.
 *
 * Deliberately **single-axis only**. Two measures of different scale get two
 * charts, small multiples, or indexing to a common base — a second y-axis lets
 * the author choose where the lines cross, which is the most misleading thing a
 * chart can do.
 *
 * Ships a crosshair tooltip by default. An HTML chart is interactive whether or
 * not you plan for it, and a line chart without a tooltip forces the reader to
 * eyeball values against gridlines.
 */
export function TrendChart({
  title,
  description,
  data,
  series,
  xKey,
  height = 240,
  formatValue = (value) => String(value),
  formatX = (value) => String(value),
  action,
}: {
  title: string;
  description?: string;
  data: Record<string, string | number | null>[];
  series: TrendSeries[];
  xKey: string;
  height?: number;
  formatValue?: (value: number) => string;
  formatX?: (value: string | number) => string;
  action?: React.ReactNode;
}) {
  const shown = series.slice(0, MAX_SERIES);
  const legend = shown.map((item, index) => ({
    label: item.label,
    color: seriesColor(index),
  }));

  if (data.length === 0) {
    return (
      <ChartFrame title={title} description={description} action={action}>
        <EmptyState
          title="Nothing recorded yet"
          description="Once records are entered for this period they will appear here."
        />
      </ChartFrame>
    );
  }

  return (
    <ChartFrame
      title={title}
      description={description}
      action={action}
      footer={
        <div className="space-y-2">
          <ChartLegend series={legend} />
          <ChartTable
            caption={title}
            columns={[xKey, ...shown.map((item) => item.label)]}
            rows={data.map((row) => [
              formatX(row[xKey] ?? ""),
              ...shown.map((item) => {
                const value = row[item.key];
                return typeof value === "number" ? formatValue(value) : "—";
              }),
            ])}
          />
        </div>
      }
    >
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 4, right: 8, bottom: 0, left: -12 }}
          >
            <defs>
              {shown.map((item, index) =>
                item.area ? (
                  <linearGradient
                    key={item.key}
                    id={`area-${item.key}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor={seriesColor(index)}
                      stopOpacity={MARK.areaOpacity * 2}
                    />
                    <stop
                      offset="100%"
                      stopColor={seriesColor(index)}
                      stopOpacity={0}
                    />
                  </linearGradient>
                ) : null,
              )}
            </defs>

            {/* Horizontal only, hairline, solid. Vertical gridlines on a time
                axis add a second grid the eye has to ignore. */}
            <CartesianGrid
              vertical={false}
              stroke="var(--grid)"
              strokeWidth={1}
            />

            <XAxis
              dataKey={xKey}
              tickFormatter={formatX}
              stroke="var(--border-strong)"
              tick={{ fill: "var(--ink-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border-strong)" }}
              minTickGap={24}
            />

            <YAxis
              tickFormatter={(value: number) =>
                new Intl.NumberFormat("en-US", { notation: "compact" }).format(
                  value,
                )
              }
              stroke="var(--border-strong)"
              tick={{ fill: "var(--ink-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={48}
            />

            <Tooltip
              // The crosshair. Recessive, so it guides without competing.
              cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <ChartTooltip
                    label={formatX(label as string | number)}
                    rows={payload.map((entry) => ({
                      name: String(entry.name ?? ""),
                      value:
                        typeof entry.value === "number"
                          ? formatValue(entry.value)
                          : "—",
                      color: entry.color,
                    }))}
                  />
                );
              }}
            />

            {shown.map((item, index) =>
              item.area ? (
                <Area
                  key={item.key}
                  type="monotone"
                  dataKey={item.key}
                  name={item.label}
                  stroke={seriesColor(index)}
                  strokeWidth={MARK.lineWidth}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill={`url(#area-${item.key})`}
                  // 2px surface ring keeps the dot legible where it crosses the
                  // line, and enlarges the hover target.
                  activeDot={{
                    r: MARK.markerRadius + 1,
                    stroke: "var(--surface-1)",
                    strokeWidth: MARK.surfaceGap,
                  }}
                  dot={false}
                />
              ) : (
                <Line
                  key={item.key}
                  type="monotone"
                  dataKey={item.key}
                  name={item.label}
                  stroke={seriesColor(index)}
                  strokeWidth={MARK.lineWidth}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  activeDot={{
                    r: MARK.markerRadius + 1,
                    stroke: "var(--surface-1)",
                    strokeWidth: MARK.surfaceGap,
                  }}
                  dot={false}
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
