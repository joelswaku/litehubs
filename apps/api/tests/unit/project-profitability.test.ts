import { describe, expect, it } from "vitest";
import { calculateProductionProfitability } from "../../src/modules/owner-management/project-profitability";

describe("project poultry profitability", () => {
  it("keeps an accepted receipt cost once when its supplier payment is recorded", () => {
    // The 6,000 accepted receipt is already the budget's actual operating
    // cost. Its later supplier payment is settlement only and is not passed
    // as an additional cost here.
    const result = calculateProductionProfitability({
      linkedFlockCount: 1,
      operationalCost: 8_000,
      revenue: 20_000,
      cashReceived: 6_000,
      eggsProduced: 120,
      eggsSold: 100,
      birdsSold: 0,
    });

    expect(result.operationalCost).toBe(8_000);
    expect(result.revenue).toBe(20_000);
    expect(result.profit).toBe(12_000);
    expect(result.outstandingRevenue).toBe(14_000);
    expect(result.costPerEggProduced).toBeCloseTo(66.6667, 3);
  });
});
