export const productionCostCategories = [
  "animals",
  "feed",
  "health",
  "labour",
  "transport",
  "utilities",
  "equipment_depreciation",
  "other",
] as const;

export type ProductionCostCategory = (typeof productionCostCategories)[number];
export type ProductionCostBreakdown = Record<ProductionCostCategory, number>;

export type ProductionFlockProfitabilityInput = {
  id: string;
  name?: string | null;
  code?: string | null;
  costs?: Partial<Record<ProductionCostCategory, number>>;
  eggsProduced?: number;
  eggsSold?: number;
  birdsSold?: number;
  revenue?: number;
  cashReceived?: number;
};

export type ProductionProfitabilityInput = {
  /** Kept for existing callers while they move to category-based costing. */
  operationalCost?: number;
  costBreakdown?: Partial<Record<ProductionCostCategory, number>>;
  flocks?: ProductionFlockProfitabilityInput[];
  revenue: number;
  cashReceived: number;
  eggsProduced: number;
  eggsSold: number;
  birdsSold: number;
  linkedFlockCount: number;
};

const amount = (value: number | string | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const emptyProductionCostBreakdown = (): ProductionCostBreakdown => ({
  animals: 0,
  feed: 0,
  health: 0,
  labour: 0,
  transport: 0,
  utilities: 0,
  equipment_depreciation: 0,
  other: 0,
});

export function normalizeProductionCostBreakdown(
  costs?: Partial<Record<ProductionCostCategory, number>>,
): ProductionCostBreakdown {
  const normalized = emptyProductionCostBreakdown();
  for (const category of productionCostCategories)
    normalized[category] = Math.max(0, amount(costs?.[category]));
  return normalized;
}

export const totalProductionCost = (
  costs: Partial<Record<ProductionCostCategory, number>>,
) =>
  productionCostCategories.reduce(
    (sum, category) => sum + Math.max(0, amount(costs[category])),
    0,
  );

/**
 * Revenue is recognised at confirmed delivery. Cash is tracked independently
 * when the invoice is paid. Costs are constructed from one source per event:
 * declared animal acquisition, issued feed, direct production costs and
 * eligible non-stock receipts. Supplier settlement is deliberately absent.
 */
export function calculateProductionProfitability(
  input: ProductionProfitabilityInput,
) {
  const hasBreakdown = input.costBreakdown !== undefined;
  const costBreakdown = normalizeProductionCostBreakdown(input.costBreakdown);
  const operationalCost = hasBreakdown
    ? totalProductionCost(costBreakdown)
    : Math.max(0, amount(input.operationalCost));
  const revenue = amount(input.revenue);
  const cashReceived = amount(input.cashReceived);
  const eggsProduced = amount(input.eggsProduced);
  const eggsSold = amount(input.eggsSold);
  const birdsSold = amount(input.birdsSold);
  const profit = revenue - operationalCost;
  const flocks = (input.flocks ?? []).map((flock) => {
    const flockCosts = normalizeProductionCostBreakdown(flock.costs);
    const flockOperationalCost = totalProductionCost(flockCosts);
    const flockRevenue = amount(flock.revenue);
    const flockCashReceived = amount(flock.cashReceived);
    const flockEggsProduced = amount(flock.eggsProduced);
    const flockEggsSold = amount(flock.eggsSold);
    const flockBirdsSold = amount(flock.birdsSold);
    const flockProfit = flockRevenue - flockOperationalCost;
    return {
      id: flock.id,
      name: flock.name ?? null,
      code: flock.code ?? null,
      costBreakdown: flockCosts,
      operationalCost: flockOperationalCost,
      revenue: flockRevenue,
      cashReceived: flockCashReceived,
      outstandingRevenue: Math.max(flockRevenue - flockCashReceived, 0),
      profit: flockProfit,
      marginPercent: flockRevenue > 0 ? (flockProfit / flockRevenue) * 100 : 0,
      eggsProduced: flockEggsProduced,
      eggsSold: flockEggsSold,
      birdsSold: flockBirdsSold,
      costPerEggProduced:
        flockEggsProduced > 0 ? flockOperationalCost / flockEggsProduced : 0,
      costPerBirdSold:
        flockBirdsSold > 0 ? flockOperationalCost / flockBirdsSold : 0,
    };
  });

  return {
    linkedFlockCount: Math.max(0, amount(input.linkedFlockCount)),
    costBreakdown,
    operationalCost,
    revenue,
    cashReceived,
    outstandingRevenue: Math.max(revenue - cashReceived, 0),
    profit,
    marginPercent: revenue > 0 ? (profit / revenue) * 100 : 0,
    eggsProduced,
    eggsSold,
    birdsSold,
    costPerEggProduced: eggsProduced > 0 ? operationalCost / eggsProduced : 0,
    costPerBirdSold: birdsSold > 0 ? operationalCost / birdsSold : 0,
    revenuePerEggSold: eggsSold > 0 ? revenue / eggsSold : 0,
    flocks,
  };
}
