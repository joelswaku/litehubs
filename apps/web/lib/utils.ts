import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges class names so a later class actually wins.
 *
 * `clsx` alone concatenates, which means `cn("p-2", "p-4")` produces both and
 * Tailwind's own source order decides — the caller's intent is lost. twMerge
 * resolves conflicting utilities so a component's prop can reliably override
 * its default.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Formats money for display.
 *
 * The API sends amounts already rounded to the currency's scale (see
 * apps/api/src/utils/money.ts), so this only formats — it never does
 * arithmetic. Never add these values in the browser; ask the API for a total.
 */
export function formatMoney(
  amount: number | string | null | undefined,
  currency?: string | null,
  options: { compact?: boolean } = {},
): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) return "—";

  // Currencies without a minor unit must not be shown with cents.
  const zeroDecimal = new Set([
    "BIF",
    "CLP",
    "DJF",
    "GNF",
    "JPY",
    "KMF",
    "KRW",
    "PYG",
    "RWF",
    "UGX",
    "VND",
    "VUV",
    "XAF",
    "XOF",
    "XPF",
  ]);
  const fractionDigits = currency && zeroDecimal.has(currency) ? 0 : 2;

  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: options.compact ? 0 : fractionDigits,
    maximumFractionDigits: options.compact ? 1 : fractionDigits,
    ...(options.compact ? { notation: "compact" } : {}),
  }).format(value);

  return currency ? `${formatted} ${currency}` : formatted;
}

/** Formats a quantity. Quantities carry more decimal places than money. */
export function formatQuantity(
  value: number | string | null | undefined,
  unit?: string | null,
  places = 2,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return "—";

  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: places,
  }).format(numeric);

  return unit ? `${formatted} ${unit}` : formatted;
}

export function formatPercent(
  value: number | string | null | undefined,
  places = 1,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return "—";
  return `${numeric.toFixed(places)}%`;
}

/**
 * Formats a `yyyy-MM-dd` business day for display.
 *
 * Parsed as local rather than through `new Date("2026-08-26")`, which JS treats
 * as UTC midnight — that renders as the previous day for anyone west of
 * Greenwich, including the whole of the Americas.
 */
export function formatBusinessDay(
  day: string | null | undefined,
  style: "short" | "long" = "short",
): string {
  if (!day) return "—";
  const parts = day.split("-").map(Number);
  const [year, month, date] = parts;
  if (!year || !month || !date) return day;

  const value = new Date(year, month - 1, date);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: style === "long" ? "long" : "short",
    year: "numeric",
  }).format(value);
}

/** Formats a timestamp, including the time. For audit entries and clock-ins. */
export function formatInstant(
  instant: string | Date | null | undefined,
): string {
  if (!instant) return "—";
  const value = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(value.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

/** "3 days ago". For activity feeds, where the exact instant is noise. */
export function formatRelative(
  instant: string | Date | null | undefined,
): string {
  if (!instant) return "—";
  const value = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(value.getTime())) return "—";

  const seconds = Math.round((value.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  const thresholds: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];

  for (const [unit, size] of thresholds) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return formatter.format(seconds, "second");
}

/** Initials for an avatar, from a full name. */
export function initialsOf(name: string | null | undefined): string {
  if (!name) return "?";
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/** Truncates without cutting a word in half. */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}
