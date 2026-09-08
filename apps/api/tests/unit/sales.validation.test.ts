import { describe, expect, it } from "vitest";
import { createOrderInput, offerInput, paymentInput } from "../../src/modules/sales/sales.validation";

const ids = {
  customer: "5d4e13c1-0225-4495-99e9-b4d9a0a68b23",
  offer: "d7c6cacf-b5d2-47fb-9c8c-c2d995867c15",
  invoice: "58c19f65-ea0b-4bd3-9faf-1b5e26954d0d",
};

describe("sales input validation", () => {
  it("accepts a decimal kilogram sale, including gram-level quantities", () => {
    const parsed = createOrderInput.parse({
      customerId: ids.customer,
      orderDate: "2026-09-07",
      currency: "cdf",
      lines: [{
        offerId: ids.offer,
        description: "Pork cut",
        quantity: 0.001,
        unit: "kg",
        unitPrice: 7200,
      }],
    });

    expect(parsed.currency).toBe("CDF");
    expect(parsed.lines[0]?.quantity).toBe(0.001);
  });

  it("requires a currency when a reference selling price is configured", () => {
    const result = offerInput.safeParse({
      code: "PORK-01",
      sourceType: "pig_group",
      sourceId: ids.offer,
      defaultUnitPrice: 2500,
    });

    expect(result.success).toBe(false);
  });

  it("rejects payment allocations that exceed the received payment", () => {
    const result = paymentInput.safeParse({
      customerId: ids.customer,
      receivedOn: "2026-09-07",
      currency: "USD",
      amount: 10,
      allocations: [{ invoiceId: ids.invoice, amount: 10.01 }],
    });

    expect(result.success).toBe(false);
  });
});
