import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format as formatDate,
  isValid,
  parseISO,
  startOfMonth,
} from "date-fns";

/**
 * Dates as the business means them, not as UTC instants.
 *
 * The distinction matters here more than in most systems. A farm's day is
 * decided by where the farm is: a mortality record entered at 01:00 in Kinshasa
 * belongs to that day's flock report, but its UTC timestamp says the day
 * before. Every organization carries a `timezone`, and anything that groups,
 * buckets or reports "by day" has to use it.
 *
 * So there are two kinds of value, kept apart on purpose:
 *
 *   - **Business day** — a `yyyy-MM-dd` string. What a daily record is keyed on,
 *     what a shift roster covers, what a payroll period runs between. It has no
 *     time and no zone, and comparing two of them as strings is correct.
 *   - **Instant** — a `Date`/timestamptz. When something actually happened:
 *     a clock-in, an audit entry, a token expiry.
 *
 * Storing a business day as a timestamp is the bug this file exists to prevent.
 */

/** A calendar day with no time and no zone: `2026-08-26`. */
export type BusinessDay = string;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_FORMAT = "yyyy-MM-dd";

/**
 * The calendar day an instant falls on in a given zone.
 *
 * Uses Intl rather than a timezone library: Node already carries the full ICU
 * database, so this needs no dependency and never goes stale relative to it.
 * Parts are read individually rather than trusting a locale's format string,
 * because "which locale renders ISO order" is not a guarantee worth relying on.
 */
function dayInZone(instant: Date, timezone: string): BusinessDay {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;

  const year = get("year");
  const month = get("month");
  const day = get("day");

  if (!year || !month || !day) {
    throw new Error(`Could not resolve a calendar day in zone "${timezone}"`);
  }
  return `${year}-${month}-${day}`;
}

/** Throws early on a bad zone, so the failure names the setting, not the format. */
export function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error(`Not a recognised timezone: ${timezone}`);
  }
}

export function isBusinessDay(value: unknown): value is BusinessDay {
  return (
    typeof value === "string" &&
    DAY_PATTERN.test(value) &&
    isValid(parseISO(value))
  );
}

/**
 * Today, where the organization is.
 *
 * Passing the organization's timezone is not optional in practice: without it
 * this returns the *server's* today, which in a UTC container is wrong for
 * roughly a third of every Kinshasa day.
 */
export function today(timezone?: string | null): BusinessDay {
  const now = new Date();
  return timezone ? dayInZone(now, timezone) : formatDate(now, DAY_FORMAT);
}

/** The business day an instant falls on, in the organization's timezone. */
export function businessDayOf(
  instant: Date | string,
  timezone?: string | null,
): BusinessDay {
  const date = typeof instant === "string" ? parseISO(instant) : instant;
  if (!isValid(date))
    throw new Error(`Not a valid instant: ${String(instant)}`);
  return timezone ? dayInZone(date, timezone) : formatDate(date, DAY_FORMAT);
}

/** Parses a business day, rejecting anything that is not exactly one. */
export function toBusinessDay(value: unknown): BusinessDay {
  if (isBusinessDay(value)) return value;

  // A full timestamp is a common mistake — a client sending new Date()
  // .toISOString() where a day was asked for. Truncating silently would put the
  // record on the wrong day near midnight, so it is refused.
  throw new Error(
    `Expected a calendar day as yyyy-MM-dd, got: ${String(value)}`,
  );
}

/** Days between two business days. Negative when `to` is earlier. */
export function daysBetween(from: BusinessDay, to: BusinessDay): number {
  return differenceInCalendarDays(
    parseISO(toBusinessDay(to)),
    parseISO(toBusinessDay(from)),
  );
}

export function shiftDays(day: BusinessDay, days: number): BusinessDay {
  return formatDate(addDays(parseISO(toBusinessDay(day)), days), DAY_FORMAT);
}

/**
 * Every day in an inclusive range.
 *
 * Bounded because the caller is usually filling a report grid or generating
 * daily work items, and an unbounded range from a bad filter would try to
 * materialise centuries.
 */
export function daysInRange(
  from: BusinessDay,
  to: BusinessDay,
  maximum = 366,
): BusinessDay[] {
  const start = parseISO(toBusinessDay(from));
  const end = parseISO(toBusinessDay(to));

  if (end < start) {
    throw new Error(`Range ends before it starts: ${from} to ${to}`);
  }

  const span = differenceInCalendarDays(end, start) + 1;
  if (span > maximum) {
    throw new Error(
      `Range covers ${span} days, more than the ${maximum} allowed`,
    );
  }

  return eachDayOfInterval({ start, end }).map((date) =>
    formatDate(date, DAY_FORMAT),
  );
}

/** First and last day of the month a day falls in. For payroll and reports. */
export function monthBounds(day: BusinessDay): {
  from: BusinessDay;
  to: BusinessDay;
} {
  const date = parseISO(toBusinessDay(day));
  return {
    from: formatDate(startOfMonth(date), DAY_FORMAT),
    to: formatDate(endOfMonth(date), DAY_FORMAT),
  };
}

/**
 * Age in whole days of something dated `from`, as of `asOf`.
 *
 * This is flock age, crop age, days since a vaccination — the number every
 * performance model is indexed by.
 */
export function ageInDays(
  from: BusinessDay,
  asOf: BusinessDay | undefined,
  timezone?: string | null,
): number {
  return daysBetween(from, asOf ?? today(timezone));
}

/** Whole weeks, for performance models keyed by week rather than day. */
export function ageInWeeks(
  from: BusinessDay,
  asOf?: BusinessDay,
  timezone?: string | null,
): number {
  return Math.floor(ageInDays(from, asOf, timezone) / 7);
}

/** True when `day` is within the inclusive range. Plain string comparison is
 *  correct for `yyyy-MM-dd`, which is why the format is fixed. */
export function isWithin(
  day: BusinessDay,
  from: BusinessDay | null | undefined,
  to: BusinessDay | null | undefined,
): boolean {
  const value = toBusinessDay(day);
  if (from && value < toBusinessDay(from)) return false;
  if (to && value > toBusinessDay(to)) return false;
  return true;
}

export { DAY_FORMAT, formatDate, parseISO };
