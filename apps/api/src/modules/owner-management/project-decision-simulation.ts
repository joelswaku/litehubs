/**
 * A decision simulation is deliberately read-only. It starts with the same
 * recognised revenue and de-duplicated production costs used by the project
 * dashboard, then applies the owner's assumptions without changing a project,
 * budget, order or sale.
 */
export type ProjectDecisionScenario = {
  eggPriceChangePercent?: number;
  feedCostChangePercent?: number;
  mortalityPercent?: number;
  saleDelayDays?: number;
  budgetChangePercent?: number;
};

export type ProjectDecisionSimulationBaseline = {
  currencyCode: string;
  plannedBudget: number;
  operationalCost: number;
  feedCost: number;
  revenue: number;
  cashReceived: number;
  eggsSold: number;
  revenuePerEggSold: number;
  observedDays: number;
};

const amount = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const percent = (value: unknown) => Math.max(-100, amount(value));
const roundedAmount = (value: number) => Math.round(value * 10_000) / 10_000;

export function calculateProjectDecisionSimulation(
  source: ProjectDecisionSimulationBaseline,
  scenario: ProjectDecisionScenario,
) {
  const baseline = {
    currencyCode: source.currencyCode || "CDF",
    plannedBudget: Math.max(0, amount(source.plannedBudget)),
    operationalCost: Math.max(0, amount(source.operationalCost)),
    feedCost: Math.max(0, amount(source.feedCost)),
    revenue: Math.max(0, amount(source.revenue)),
    cashReceived: Math.max(0, amount(source.cashReceived)),
    eggsSold: Math.max(0, amount(source.eggsSold)),
    revenuePerEggSold: Math.max(0, amount(source.revenuePerEggSold)),
    observedDays: Math.max(1, Math.round(amount(source.observedDays))),
  };
  const assumptions = {
    eggPriceChangePercent: percent(scenario.eggPriceChangePercent),
    feedCostChangePercent: percent(scenario.feedCostChangePercent),
    mortalityPercent: Math.min(
      100,
      Math.max(0, amount(scenario.mortalityPercent)),
    ),
    saleDelayDays: Math.min(
      3_650,
      Math.max(0, Math.round(amount(scenario.saleDelayDays))),
    ),
    budgetChangePercent: percent(scenario.budgetChangePercent),
  };

  // Revenue can contain eggs and birds. Only the identifiable egg part is
  // changed when the egg price assumption moves; the remaining revenue stays
  // untouched unless mortality reduces the projected saleable output.
  const eggRevenue = Math.min(
    baseline.revenue,
    baseline.eggsSold * baseline.revenuePerEggSold,
  );
  const otherRevenue = Math.max(0, baseline.revenue - eggRevenue);
  const simulatedEggRevenue = Math.max(
    0,
    eggRevenue * (1 + assumptions.eggPriceChangePercent / 100),
  );
  const revenueBeforeMortality = simulatedEggRevenue + otherRevenue;
  const mortalityRevenueLoss =
    revenueBeforeMortality * (assumptions.mortalityPercent / 100);
  const revenue = roundedAmount(
    Math.max(0, revenueBeforeMortality - mortalityRevenueLoss),
  );
  const feedCost = roundedAmount(
    Math.max(
      0,
      baseline.feedCost * (1 + assumptions.feedCostChangePercent / 100),
    ),
  );
  const operationalCost = roundedAmount(
    Math.max(0, baseline.operationalCost - baseline.feedCost + feedCost),
  );
  const operatingResult = roundedAmount(revenue - operationalCost);
  const investment = roundedAmount(
    Math.max(
      0,
      baseline.plannedBudget * (1 + assumptions.budgetChangePercent / 100),
    ),
  );
  const dailyResult =
    operatingResult > 0 ? operatingResult / baseline.observedDays : 0;
  const paybackDays =
    dailyResult > 0
      ? Math.ceil(investment / dailyResult) + assumptions.saleDelayDays
      : null;
  const breakEvenRevenue = operationalCost;
  const breakEvenPricePerEgg =
    baseline.eggsSold > 0 ? breakEvenRevenue / baseline.eggsSold : null;
  const unpaidRevenue = Math.max(revenue - baseline.cashReceived, 0);

  return {
    currencyCode: baseline.currencyCode,
    isProjection: true,
    assumptions,
    baseline: {
      revenue: baseline.revenue,
      operationalCost: baseline.operationalCost,
      operatingResult: baseline.revenue - baseline.operationalCost,
      plannedBudget: baseline.plannedBudget,
      roiPercent:
        baseline.plannedBudget > 0
          ? ((baseline.revenue - baseline.operationalCost) /
              baseline.plannedBudget) *
            100
          : null,
    },
    impacts: {
      eggPriceRevenueChange: roundedAmount(simulatedEggRevenue - eggRevenue),
      feedCostChange: roundedAmount(feedCost - baseline.feedCost),
      mortalityRevenueLoss: roundedAmount(mortalityRevenueLoss),
      budgetChange: roundedAmount(investment - baseline.plannedBudget),
      saleDelayDays: assumptions.saleDelayDays,
    },
    scenario: {
      revenue,
      operationalCost,
      operatingResult,
      investment,
      roiPercent: investment > 0 ? (operatingResult / investment) * 100 : null,
      paybackDays,
      breakEvenRevenue,
      breakEvenPricePerEgg,
      unpaidRevenue,
      cashArrivalDelayDays: assumptions.saleDelayDays,
    },
    method: {
      observedDays: baseline.observedDays,
      eggRevenue,
      message:
        "This simulation uses recorded project revenue and de-duplicated production costs. It does not change actual budget, stock, purchasing, sales or cash.",
    },
  };
}
