import Decimal from "decimal.js";

/**
 * Money arithmetic that does not lose cents.
 *
 * Two facts drive this file.
 *
 * First, `pg` returns `numeric` columns as **strings**, deliberately: a
 * numeric(14,2) can hold values a JS `number` cannot represent exactly. Calling
 * `Number()` on it works right up until it doesn't.
 *
 * Second, binary floating point cannot represent most decimal fractions.
 * `0.1 + 0.2` is `0.30000000000000004`, and summing a few thousand invoice
 * lines that way drifts by real money. A payroll run or a supplier statement
 * that is off by a cent is a support ticket; off by a cent per row is a
 * reconciliation that never balances.
 *
 * So amounts travel as strings, arithmetic happens in Decimal, and the boundary
 * conversions are in one place. `toNumber` exists for JSON responses, where a
 * float is what the client expects — but never feed its result back into a sum.
 */

// Enough precision for any realistic total; ROUND_HALF_UP is what accountants
// and every tax authority expect, and is not JS's default.
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

/** What a money column can arrive as: a pg string, a literal, or already parsed. */
export type MoneyInput = string | number | Decimal | null | undefined;

/** Minor units per major unit. Two for almost every currency LiteHubs will see. */
const DEFAULT_SCALE = 2;

/**
 * Currencies with no minor unit. Charging 1050.00 CDF is fine, but a currency
 * that has no cents must not be *stored* or *displayed* with them.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
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

export function scaleFor(currency?: string | null): number {
  if (!currency) return DEFAULT_SCALE;
  return ZERO_DECIMAL_CURRENCIES.has(currency.trim().toUpperCase())
    ? 0
    : DEFAULT_SCALE;
}

/**
 * Parses a money value. A null, undefined or blank column becomes zero, which
 * is what every caller here wants — "no amount recorded" and "zero" behave the
 * same in a sum, and the alternative is a null check at every call site.
 *
 * Anything that is not a number at all throws rather than becoming NaN, because
 * a NaN silently poisons every total downstream of it.
 */
export function money(value: MoneyInput): Decimal {
  if (value === null || value === undefined || value === "")
    return new Decimal(0);
  if (value instanceof Decimal) return value;

  try {
    const parsed = new Decimal(value);
    if (!parsed.isFinite()) {
      throw new Error(`Money value is not finite: ${String(value)}`);
    }
    return parsed;
  } catch {
    throw new Error(`Not a valid money value: ${String(value)}`);
  }
}

/** Exact sum. Use this instead of `array.reduce((t, r) => t + Number(r.x), 0)`. */
export function sum(values: readonly MoneyInput[]): Decimal {
  return values.reduce<Decimal>(
    (total, value) => total.plus(money(value)),
    new Decimal(0),
  );
}

export function add(...values: readonly MoneyInput[]): Decimal {
  return sum(values);
}

export function subtract(
  from: MoneyInput,
  ...amounts: readonly MoneyInput[]
): Decimal {
  return amounts.reduce<Decimal>(
    (total, value) => total.minus(money(value)),
    money(from),
  );
}

/**
 * Quantity times unit price, rounded to the currency's scale.
 *
 * Rounding here rather than at the end is deliberate: a line total is a real
 * figure that gets printed, stored and re-summed, so it has to be the same
 * number everywhere it appears. Keeping unrounded products and rounding only
 * the grand total makes an invoice whose lines do not add up to its footer.
 */
export function lineTotal(
  quantity: MoneyInput,
  unitPrice: MoneyInput,
  currency?: string | null,
): Decimal {
  return round(money(quantity).times(money(unitPrice)), currency);
}

export function round(value: MoneyInput, currency?: string | null): Decimal {
  return money(value).toDecimalPlaces(
    scaleFor(currency),
    Decimal.ROUND_HALF_UP,
  );
}

/**
 * A percentage of an amount — VAT, a discount, a retention.
 * `percentage` is the human figure: 16 means 16%, not 0.16.
 */
export function percentOf(
  amount: MoneyInput,
  percentage: MoneyInput,
  currency?: string | null,
): Decimal {
  return round(money(amount).times(money(percentage)).dividedBy(100), currency);
}

/**
 * The string form to hand to a `numeric` parameter.
 *
 * Always a plain decimal string, never exponential: `1e-7` is a valid JS number
 * literal and a syntax error to PostgreSQL's numeric parser.
 */
export function toColumn(value: MoneyInput, currency?: string | null): string {
  return round(value, currency).toFixed(scaleFor(currency));
}

/**
 * For JSON responses, where clients expect a number.
 *
 * Safe because the value has already been rounded to at most 2 decimal places,
 * so it is exactly representable until it exceeds 2^53 minor units — about
 * 90 trillion. Do not sum these; sum the Decimals and convert once.
 */
export function toNumber(value: MoneyInput, currency?: string | null): number {
  return round(value, currency).toNumber();
}

/** True when the amount is exactly zero, ignoring sign and trailing zeros. */
export function isZero(value: MoneyInput): boolean {
  return money(value).isZero();
}

export function isNegative(value: MoneyInput): boolean {
  return money(value).isNegative() && !money(value).isZero();
}

/**
 * Splits an amount into `parts` shares that add back to exactly the original.
 *
 * Naively dividing and rounding loses or invents money: 100.00 over 3 gives
 * 33.33 × 3 = 99.99. The remainder is distributed one minor unit at a time
 * across the first shares, so the total is preserved and the difference between
 * any two shares is at most one cent.
 */
export function allocate(
  total: MoneyInput,
  parts: number,
  currency?: string | null,
): Decimal[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new Error(`Cannot allocate across ${parts} parts`);
  }

  const scale = scaleFor(currency);
  const unit = new Decimal(10).pow(-scale);
  const amount = round(total, currency);

  const base = amount
    .dividedBy(parts)
    .toDecimalPlaces(scale, Decimal.ROUND_DOWN);
  const shares = Array.from({ length: parts }, () => base);

  // Whatever rounding down left over, in whole minor units.
  let remainder = amount
    .minus(base.times(parts))
    .dividedBy(unit)
    .round()
    .toNumber();

  for (
    let index = 0;
    remainder > 0;
    index = (index + 1) % parts, remainder -= 1
  ) {
    shares[index] = shares[index]!.plus(unit);
  }

  return shares;
}

/** Human-readable, for reports and emails. Not for storage. */
export function format(value: MoneyInput, currency?: string | null): string {
  const scale = scaleFor(currency);
  const rounded = round(value, currency);
  const [whole, fraction] = rounded.abs().toFixed(scale).split(".");
  const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const body = fraction ? `${grouped}.${fraction}` : grouped;
  const signed = rounded.isNegative() ? `-${body}` : body;
  return currency ? `${signed} ${currency.trim().toUpperCase()}` : signed;
}

export { Decimal };
