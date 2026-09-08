import { describe, expect, it } from "vitest";
import {
  allocate,
  format,
  isNegative,
  lineTotal,
  money,
  percentOf,
  round,
  subtract,
  sum,
  toColumn,
  toNumber,
} from "../../src/utils/money";

describe("money", () => {
  it("parses what pg actually returns for a numeric column", () => {
    // pg hands back numeric as a string, not a number.
    expect(money("1234.56").toFixed(2)).toBe("1234.56");
    expect(money("0.00").isZero()).toBe(true);
  });

  it("treats an unrecorded amount as zero rather than NaN", () => {
    expect(money(null).isZero()).toBe(true);
    expect(money(undefined).isZero()).toBe(true);
    expect(money("").isZero()).toBe(true);
  });

  it("refuses a value that is not a number at all", () => {
    // The alternative is NaN, which silently poisons every total downstream.
    expect(() => money("not money")).toThrow(/not a valid money value/i);
    expect(() => money(Number.NaN)).toThrow();
    expect(() => money(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("sums exactly where floating point does not", () => {
    // 0.1 + 0.2 === 0.30000000000000004 as JS numbers.
    expect(sum(["0.1", "0.2"]).toFixed(2)).toBe("0.30");

    // A thousand rows of a third of a cent: float drift shows up here.
    const rows = Array.from({ length: 1000 }, () => "0.01");
    expect(sum(rows).toFixed(2)).toBe("10.00");
  });

  it("subtracts a run of amounts from a starting figure", () => {
    expect(subtract("100.00", "10.50", "0.50").toFixed(2)).toBe("89.00");
  });

  it("rounds half away from zero, as an invoice is expected to", () => {
    // JS Math.round(0.5) is 1 but Math.round(-0.5) is -0; accounting wants -1.
    expect(round("0.005").toFixed(2)).toBe("0.01");
    expect(round("-0.005").toFixed(2)).toBe("-0.01");
    expect(round("2.675").toFixed(2)).toBe("2.68");
  });

  it("keeps line totals consistent with what gets printed", () => {
    // 3 × 19.99 = 59.97 exactly; the stored line must equal the shown line.
    expect(lineTotal("3", "19.99").toFixed(2)).toBe("59.97");
    expect(lineTotal("2.5", "10.01").toFixed(2)).toBe("25.03");
  });

  it("takes a percentage using the human figure, not a fraction", () => {
    expect(percentOf("1000.00", 16).toFixed(2)).toBe("160.00");
    expect(percentOf("99.99", "16").toFixed(2)).toBe("16.00");
  });

  it("honours currencies that have no minor unit", () => {
    // XAF (CFA franc) has no centimes per ISO 4217. CDF does have them, even
    // though they are worthless in practice — display preference is the
    // organization's business, storage follows the standard.
    expect(toColumn("1050.49", "XAF")).toBe("1050");
    expect(toColumn("1050.50", "XAF")).toBe("1051");
    expect(toColumn("1050.49", "CDF")).toBe("1050.49");
    expect(toColumn("1050.49", "USD")).toBe("1050.49");
  });

  it("never emits exponential notation to a numeric column", () => {
    // `1e-7` is valid JS and a syntax error to PostgreSQL's numeric parser.
    expect(toColumn("0.0000001")).toBe("0.00");
    expect(toColumn("1e3")).toBe("1000.00");
    expect(toColumn("12345678901.99")).toBe("12345678901.99");
  });

  describe("allocate", () => {
    it("splits without losing or inventing money", () => {
      // Naive division gives 33.33 x 3 = 99.99 and a lost cent.
      const shares = allocate("100.00", 3);
      expect(shares.map((s) => s.toFixed(2))).toEqual([
        "33.34",
        "33.33",
        "33.33",
      ]);
      expect(sum(shares).toFixed(2)).toBe("100.00");
    });

    it("keeps every share within one minor unit of the others", () => {
      const shares = allocate("0.05", 3).map((s) => s.toFixed(2));
      expect(shares).toEqual(["0.02", "0.02", "0.01"]);
      expect(sum(shares).toFixed(2)).toBe("0.05");
    });

    it("handles an amount that divides cleanly", () => {
      expect(allocate("90.00", 3).map((s) => s.toFixed(2))).toEqual([
        "30.00",
        "30.00",
        "30.00",
      ]);
    });

    it("preserves the total for a zero-decimal currency", () => {
      const shares = allocate("100", 3, "XAF");
      expect(shares.map((s) => s.toFixed(0))).toEqual(["34", "33", "33"]);
      expect(sum(shares).toFixed(0)).toBe("100");
    });

    it("refuses a nonsense number of parts", () => {
      expect(() => allocate("10.00", 0)).toThrow(/cannot allocate/i);
      expect(() => allocate("10.00", 2.5)).toThrow(/cannot allocate/i);
    });
  });

  it("reports a true negative but not a signed zero", () => {
    expect(isNegative("-0.01")).toBe(true);
    expect(isNegative("-0.00")).toBe(false);
    expect(isNegative("0.01")).toBe(false);
  });

  it("formats for a human without losing the sign", () => {
    expect(format("1234567.89", "USD")).toBe("1 234 567.89 USD");
    expect(format("-42.50", "USD")).toBe("-42.50 USD");
    expect(format("1500", "XAF")).toBe("1 500 XAF");
    expect(format("1500", "CDF")).toBe("1 500.00 CDF");
    expect(format("12.30")).toBe("12.30");
  });

  it("converts to a number only after rounding", () => {
    expect(toNumber("19.99")).toBe(19.99);
    expect(toNumber("0.005")).toBe(0.01);
  });
});
