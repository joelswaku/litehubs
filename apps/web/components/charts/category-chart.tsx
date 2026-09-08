"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
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

/**
 * Magnitude across categories, as horizontal bars.
 *
 * Horizontal rather than vertical because the categories here are words —
 * "Nord-Kivu", "Poultry Supervisor", "Feed & supplements" — and a vertical
 * column chart has to either rotate those labels 45° or truncate them. A bar
 * chart gives the label a full line of horizontal room.
 *
 * Values are labelled at the bar tip, so the reader gets the number without
 * counting gridlines. Only the tips — never a number on every internal point.
 */
export function CategoryChart({
  title,
  description,
  data,
  labelKey,
  valueKey,
  height,
  formatValue = (value) => new Intl.NumberFormat("en-US").format(value),
  /**
   * Colours each bar from the series palette instead of one hue.
   *
   * Off by default, and that default matters: when bars are the *same* measure
   * across different categories, one hue is correct — a rainbow implies the
   * categories differ in kind rather than in size. Turn it on only when each bar
   * genuinely is a different entity that appears elsewhere in the same colour.
   */
  colorByCategory = false,
  action,
}: {
  title: string;
  description?: string;
  data: { [key: string]: string | number }[];
  labelKey: string;
  valueKey: string;
  height?: number;
  formatValue?: (value: number) => string;
  colorByCategory?: boolean;
  action?: React.ReactNode;
}) {
  const rows = data.slice(0, colorByCategory ? MAX_SERIES : data.length);

  if (rows.length === 0) {
    return (
      <ChartFrame title={title} description={description} action={action}>
        <EmptyState title="No data for this period" />
      </ChartFrame>
    );
  }

  // 32px a row keeps a 24px bar with air around it, which is the spec.
  const plotHeight = height ?? Math.max(140, rows.length * 34 + 24);

  const legend = colorByCategory
    ? rows.map((row, index) => ({
        label: String(row[labelKey]),
        color: seriesColor(index),
      }))
    : [];

  return (
    <ChartFrame
      title={title}
      description={description}
      action={action}
      footer={
        <div className="space-y-2">
          {/* A single-hue chart needs no legend — the title says what is
              plotted, and one swatch would just restate it. */}
          <ChartLegend series={legend} />
          <ChartTable
            caption={title}
            columns={[labelKey, valueKey]}
            rows={rows.map((row) => [
              String(row[labelKey]),
              typeof row[valueKey] === "number"
                ? formatValue(row[valueKey] as number)
                : "—",
            ])}
          />
        </div>
      }
    >
      <div style={{ height: plotHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 0, right: 44, bottom: 0, left: 0 }}
            // The 2px surface gap between adjacent bars, done with spacing
            // rather than a stroke — a border round a mark is ink that is not
            // data.
            barCategoryGap={MARK.surfaceGap * 4}
          >
            <CartesianGrid
              horizontal={false}
              stroke="var(--grid)"
              strokeWidth={1}
            />

            <XAxis
              type="number"
              tickFormatter={(value: number) =>
                new Intl.NumberFormat("en-US", { notation: "compact" }).format(
                  value,
                )
              }
              tick={{ fill: "var(--ink-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border-strong)" }}
            />

            <YAxis
              type="category"
              dataKey={labelKey}
              tick={{ fill: "var(--ink-secondary)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={128}
            />

            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0];
                if (!point) return null;
                return (
                  <ChartTooltip
                    label={String(point.payload?.[labelKey] ?? "")}
                    rows={[
                      {
                        name: valueKey,
                        value:
                          typeof point.value === "number"
                            ? formatValue(point.value)
                            : "—",
                        color: point.color,
                      },
                    ]}
                  />
                );
              }}
            />

            <Bar
              dataKey={valueKey}
              // 4px rounded at the data end, square at the baseline.
              radius={[0, MARK.barRadius, MARK.barRadius, 0]}
              maxBarSize={MARK.barMaxThickness}
              fill={seriesColor(0)}
            >
              {colorByCategory
                ? rows.map((row, index) => (
                    <Cell
                      key={String(row[labelKey])}
                      fill={seriesColor(index)}
                    />
                  ))
                : null}

              {/* Value at the tip, in an ink token — never the bar's colour,
                  which is illegible as text for several of the hues. */}
              <LabelList
                dataKey={valueKey}
                position="right"
                formatter={(value: unknown) =>
                  typeof value === "number" ? formatValue(value) : ""
                }
                style={{
                  fill: "var(--ink-secondary)",
                  fontSize: 11,
                  fontVariantNumeric: "tabular-nums",
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
