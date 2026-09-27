import { describe, expect, it } from "vitest";
import { isValidPhone, normalizePhone } from "../../src/utils/phone";

describe("DRC phone normalization", () => {
  it("converts local and country-code formats to E.164", () => {
    expect(normalizePhone("0898 869 772")).toBe("+243898869772");
    expect(normalizePhone("243 898 869 772")).toBe("+243898869772");
    expect(normalizePhone("+243 898 869 772")).toBe("+243898869772");
  });

  it("rejects an incomplete DRC number before it can be used for SMS", () => {
    expect(isValidPhone("24389886772")).toBe(false);
    expect(isValidPhone("+243898869772")).toBe(true);
  });
});
