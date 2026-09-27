import { describe, expect, it } from "vitest";
import { scaledRecipeIngredientKg } from "../../src/modules/owner-management/feed-nutrition.service";

describe("feed recipe scaling", () => {
  it("scales kilogram ingredients from a 100 kg recipe to a 2,500 kg order", () => {
    expect(scaledRecipeIngredientKg(60, "kg", 100, 2500)).toBe(1500);
  });

  it("converts micro ingredients from grams to kilograms before scaling", () => {
    expect(scaledRecipeIngredientKg(250, "g", 100, 2500)).toBe(6.25);
  });

  it("converts 50 kg bags and prevents invalid batch quantities", () => {
    expect(scaledRecipeIngredientKg(1, "bag_50", 100, 2500)).toBe(1250);
    expect(scaledRecipeIngredientKg(1, "kg", 0, 2500)).toBe(0);
    expect(scaledRecipeIngredientKg(1, "unknown", 100, 2500)).toBe(0);
  });
});
