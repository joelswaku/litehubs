import Decimal from "decimal.js";
import { money, type MoneyInput } from "./money";

/**
 * Units of measure, and converting between them without silent nonsense.
 *
 * A farm records feed in bags, sacks and kilograms; water in litres and cubic
 * metres; land in hectares and acres; weight in grams for a day-old chick and
 * kilograms for a finished pig. Reports have to add those together, and the
 * only safe way is to convert everything to one base unit per *dimension* and
 * refuse to cross dimensions at all.
 *
 * The refusal is the point. Adding 3 kg to 3 litres is not a rounding problem,
 * it is a wrong answer, and a conversion table indexed only by unit name would
 * happily produce one. Every unit here declares its dimension, and a conversion
 * between two dimensions throws.
 */

export type Dimension =
  "mass" | "volume" | "area" | "length" | "count" | "time";

interface UnitDefinition {
  readonly code: string;
  readonly dimension: Dimension;
  /** How many base units one of these is. Base unit has a factor of 1. */
  readonly perBase: string;
  readonly name: string;
}

/** The base unit each dimension is stored and summed in. */
export const BASE_UNIT: Record<Dimension, string> = {
  mass: "kg",
  volume: "l",
  area: "ha",
  length: "m",
  count: "unit",
  time: "h",
};

const DEFINITIONS: readonly UnitDefinition[] = [
  // ---------------------------------------------------------------- mass ----
  { code: "kg", dimension: "mass", perBase: "1", name: "Kilogram" },
  { code: "g", dimension: "mass", perBase: "0.001", name: "Gram" },
  { code: "t", dimension: "mass", perBase: "1000", name: "Tonne" },
  { code: "lb", dimension: "mass", perBase: "0.45359237", name: "Pound" },
  // -------------------------------------------------------------- volume ----
  { code: "l", dimension: "volume", perBase: "1", name: "Litre" },
  { code: "ml", dimension: "volume", perBase: "0.001", name: "Millilitre" },
  { code: "m3", dimension: "volume", perBase: "1000", name: "Cubic metre" },
  // ---------------------------------------------------------------- area ----
  { code: "ha", dimension: "area", perBase: "1", name: "Hectare" },
  { code: "m2", dimension: "area", perBase: "0.0001", name: "Square metre" },
  { code: "acre", dimension: "area", perBase: "0.40468564224", name: "Acre" },
  // -------------------------------------------------------------- length ----
  { code: "m", dimension: "length", perBase: "1", name: "Metre" },
  { code: "cm", dimension: "length", perBase: "0.01", name: "Centimetre" },
  { code: "km", dimension: "length", perBase: "1000", name: "Kilometre" },
  // --------------------------------------------------------------- count ----
  // A count is dimensionless but still needs a unit, because "500" of a thing
  // is meaningless in a report that also holds crates and doses.
  { code: "unit", dimension: "count", perBase: "1", name: "Unit" },
  { code: "bird", dimension: "count", perBase: "1", name: "Bird" },
  { code: "animal", dimension: "count", perBase: "1", name: "Animal" },
  { code: "egg", dimension: "count", perBase: "1", name: "Egg" },
  { code: "dose", dimension: "count", perBase: "1", name: "Dose" },
  { code: "tray", dimension: "count", perBase: "30", name: "Tray (30 eggs)" },
  {
    code: "crate",
    dimension: "count",
    perBase: "360",
    name: "Crate (12 trays)",
  },
  // ---------------------------------------------------------------- time ----
  { code: "h", dimension: "time", perBase: "1", name: "Hour" },
  {
    code: "min",
    dimension: "time",
    perBase: "0.016666666666666667",
    name: "Minute",
  },
  { code: "day", dimension: "time", perBase: "24", name: "Day" },
];

const BY_CODE = new Map(DEFINITIONS.map((unit) => [unit.code, unit]));

export type UnitCode = string;

export function unitsOf(dimension: Dimension): readonly UnitDefinition[] {
  return DEFINITIONS.filter((unit) => unit.dimension === dimension);
}

export function allUnits(): readonly UnitDefinition[] {
  return DEFINITIONS;
}

export function isKnownUnit(code: unknown): code is UnitCode {
  return typeof code === "string" && BY_CODE.has(code.trim().toLowerCase());
}

function define(code: string): UnitDefinition {
  const unit = BY_CODE.get(code.trim().toLowerCase());
  if (!unit) throw new Error(`Unknown unit of measure: ${code}`);
  return unit;
}

export function dimensionOf(code: UnitCode): Dimension {
  return define(code).dimension;
}

/**
 * A bag of feed is not a fixed weight — a 25 kg bag and a 50 kg bag are both
 * "a bag". So a pack is not a unit; it is a *quantity of* a unit, defined per
 * inventory item. This converts a pack count into its base unit.
 */
export function fromPacks(
  packs: MoneyInput,
  packSize: MoneyInput,
  packUnit: UnitCode,
): Decimal {
  return toBase(money(packs).times(money(packSize)), packUnit);
}

/** Converts a quantity into its dimension's base unit. */
export function toBase(quantity: MoneyInput, from: UnitCode): Decimal {
  const unit = define(from);
  return money(quantity).times(new Decimal(unit.perBase));
}

/** Converts a base-unit quantity out into a display unit of the same dimension. */
export function fromBase(baseQuantity: MoneyInput, to: UnitCode): Decimal {
  const unit = define(to);
  return money(baseQuantity).dividedBy(new Decimal(unit.perBase));
}

/**
 * Converts between two units, refusing to cross dimensions.
 *
 * The error names both units and both dimensions, because the caller that hits
 * this has confused two columns and needs to know which.
 */
export function convert(
  quantity: MoneyInput,
  from: UnitCode,
  to: UnitCode,
): Decimal {
  const source = define(from);
  const target = define(to);

  if (source.dimension !== target.dimension) {
    throw new Error(
      `Cannot convert ${source.code} (${source.dimension}) to ` +
        `${target.code} (${target.dimension}) — different dimensions`,
    );
  }
  if (source.code === target.code) return money(quantity);

  return money(quantity)
    .times(new Decimal(source.perBase))
    .dividedBy(new Decimal(target.perBase));
}

/**
 * Sums quantities that may be recorded in different units, in the base unit of
 * their shared dimension. Throws if the list mixes dimensions, rather than
 * returning a number that means nothing.
 */
export function sumInBase(
  entries: readonly { quantity: MoneyInput; unit: UnitCode }[],
): { total: Decimal; unit: UnitCode; dimension: Dimension } | null {
  if (entries.length === 0) return null;

  const dimension = dimensionOf(entries[0]!.unit);
  let total = new Decimal(0);

  for (const entry of entries) {
    const entryDimension = dimensionOf(entry.unit);
    if (entryDimension !== dimension) {
      throw new Error(
        `Cannot total a list mixing ${dimension} and ${entryDimension}`,
      );
    }
    total = total.plus(toBase(entry.quantity, entry.unit));
  }

  return { total, unit: BASE_UNIT[dimension], dimension };
}

/**
 * Feed conversion ratio: feed consumed per unit of weight gained.
 *
 * Both sides are converted to kilograms first, so a flock recorded in bags and
 * weighed in grams still produces a correct, comparable ratio. Returns null
 * rather than Infinity when there is no gain to divide by — an FCR of Infinity
 * renders as a broken chart, while a null renders as "not yet available".
 */
export function feedConversionRatio(
  feed: { quantity: MoneyInput; unit: UnitCode },
  gain: { quantity: MoneyInput; unit: UnitCode },
): Decimal | null {
  const feedKg = toBase(feed.quantity, feed.unit);
  const gainKg = toBase(gain.quantity, gain.unit);

  if (dimensionOf(feed.unit) !== "mass" || dimensionOf(gain.unit) !== "mass") {
    throw new Error("Feed conversion ratio needs both figures as a mass");
  }
  if (gainKg.isZero() || gainKg.isNegative()) return null;

  return feedKg.dividedBy(gainKg);
}

/** Rounds a quantity for display. Quantities carry more places than money. */
export function formatQuantity(
  quantity: MoneyInput,
  unit: UnitCode,
  places = 3,
): string {
  const value = money(quantity).toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
  return `${value.toFixed()} ${define(unit).code}`;
}
