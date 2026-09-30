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

  it("separates delivered revenue, collected cash and real costs for each flock", () => {
    const result = calculateProductionProfitability({
      linkedFlockCount: 2,
      costBreakdown: {
        animals: 4_000,
        feed: 1_200,
        health: 300,
        labour: 500,
      },
      revenue: 10_000,
      cashReceived: 6_000,
      eggsProduced: 500,
      eggsSold: 400,
      birdsSold: 5,
      flocks: [
        {
          id: "flock-a",
          name: "Pondeuses A",
          costs: { animals: 2_500, feed: 800, health: 200, labour: 300 },
          eggsProduced: 300,
          eggsSold: 250,
          revenue: 7_000,
          cashReceived: 4_000,
        },
        {
          id: "flock-b",
          name: "Pondeuses B",
          costs: { animals: 1_500, feed: 400, health: 100, labour: 200 },
          eggsProduced: 200,
          eggsSold: 150,
          birdsSold: 5,
          revenue: 3_000,
          cashReceived: 2_000,
        },
      ],
    });

    expect(result.operationalCost).toBe(6_000);
    expect(result.revenue).toBe(10_000);
    expect(result.cashReceived).toBe(6_000);
    expect(result.outstandingRevenue).toBe(4_000);
    expect(result.profit).toBe(4_000);
    expect(result.costPerEggProduced).toBe(12);
    expect(result.costPerBirdSold).toBe(1_200);
    expect(result.flocks[0]).toMatchObject({
      operationalCost: 3_800,
      revenue: 7_000,
      cashReceived: 4_000,
      outstandingRevenue: 3_000,
      profit: 3_200,
    });
    expect(result.flocks[1]).toMatchObject({
      operationalCost: 2_200,
      revenue: 3_000,
      cashReceived: 2_000,
      outstandingRevenue: 1_000,
      profit: 800,
    });
  });
});
