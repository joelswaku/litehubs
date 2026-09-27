export type ProductionProfitabilityInput = {
  operationalCost: number;
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

/**
 * Production reporting deliberately reuses the project budget's actual spend.
 * Receipt payments are already excluded there, so the same supplier cost can
 * never lower both the budget and the production result twice.
 */
export function calculateProductionProfitability(
  input: ProductionProfitabilityInput,
) {
  const operationalCost = amount(input.operationalCost);
  const revenue = amount(input.revenue);
  const cashReceived = amount(input.cashReceived);
  const eggsProduced = amount(input.eggsProduced);
  const eggsSold = amount(input.eggsSold);
  const birdsSold = amount(input.birdsSold);
  const profit = revenue - operationalCost;

  return {
    linkedFlockCount: Math.max(0, amount(input.linkedFlockCount)),
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
    revenuePerEggSold: eggsSold > 0 ? revenue / eggsSold : 0,
  };
}
