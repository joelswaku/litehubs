import { describe, expect, it } from "vitest";
import { calculateProjectDecisionSimulation } from "../../src/modules/owner-management/project-decision-simulation";
import { projectDecisionSimulationBody } from "../../src/modules/owner-management/owner-management.validation";

describe("project decision simulation", () => {
  const baseline = {
    currencyCode: "CDF",
    plannedBudget: 100_000,
    operationalCost: 20_000,
    feedCost: 5_000,
    revenue: 30_000,
    cashReceived: 10_000,
    eggsSold: 100,
    revenuePerEggSold: 200,
    observedDays: 30,
  };

  it("projects combined egg-price, feed, mortality, delay and budget assumptions without mutating the baseline", () => {
    const result = calculateProjectDecisionSimulation(baseline, {
      eggPriceChangePercent: -20,
      feedCostChangePercent: 15,
      mortalityPercent: 5,
      saleDelayDays: 30,
      budgetChangePercent: 10,
    });

    expect(result.baseline).toMatchObject({
      revenue: 30_000,
      operationalCost: 20_000,
      operatingResult: 10_000,
    });
    expect(result.impacts).toMatchObject({
      eggPriceRevenueChange: -4_000,
      feedCostChange: 750,
      mortalityRevenueLoss: 1_300,
      budgetChange: 10_000,
    });
    expect(result.scenario).toMatchObject({
      revenue: 24_700,
      operationalCost: 20_750,
      operatingResult: 3_950,
      investment: 110_000,
      breakEvenRevenue: 20_750,
      breakEvenPricePerEgg: 207.5,
      paybackDays: 866,
    });
  });

  it("validates safe owner simulation assumptions", () => {
    expect(projectDecisionSimulationBody.parse({})).toEqual({
      eggPriceChangePercent: 0,
      feedCostChangePercent: 0,
      mortalityPercent: 0,
      saleDelayDays: 0,
      budgetChangePercent: 0,
    });
    expect(() =>
      projectDecisionSimulationBody.parse({ mortalityPercent: 101 }),
    ).toThrow();
  });
});
