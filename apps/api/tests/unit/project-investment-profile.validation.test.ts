import { describe, expect, it } from "vitest";
import { parseOwnerManagementBody } from "../../src/modules/owner-management/owner-management.validation";

const activeMemberId = "11111111-1111-4111-8111-111111111111";

describe("structured project investment profile", () => {
  it("accepts measurable targets and a lifecycle separate from execution status", () => {
    const result = parseOwnerManagementBody(
      "projects",
      {
        name: "Poule pondeuse",
        startDate: "2026-09-01",
        operationalStartDate: "2026-10-15",
        benefitReviewDate: "2026-11-15",
        benefitOwnerMemberId: activeMemberId,
        lifecycleStage: "operating",
        benefitTargets: {
          targetProductionQuantity: 10_000,
          targetProductionUnit: "œufs",
          targetProductionPeriod: "monthly",
          targetSalesAmount: 5_000_000,
          targetMarginPercent: 28.5,
          targetMortalityPercent: 2,
          targetUnitCost: 350,
        },
      },
      "create",
    );

    expect(result).toMatchObject({
      lifecycleStage: "operating",
      operationalStartDate: "2026-10-15",
      benefitOwnerMemberId: activeMemberId,
      benefitTargets: expect.objectContaining({
        targetProductionQuantity: 10_000,
        targetProductionUnit: "œufs",
        targetProductionPeriod: "monthly",
        targetMarginPercent: 28.5,
      }),
    });
  });

  it("rejects an operational start before the investment begins", () => {
    expect(() =>
      parseOwnerManagementBody(
        "projects",
        {
          startDate: "2026-10-01",
          operationalStartDate: "2026-09-30",
        },
        "update",
      ),
    ).toThrow(/Operational start cannot be before the project start date/);
  });

  it("requires a unit and period when a production target exists", () => {
    expect(() =>
      parseOwnerManagementBody(
        "projects",
        {
          benefitTargets: { targetProductionQuantity: 10_000 },
        },
        "update",
      ),
    ).toThrow(/Choose the unit for the production target/);
  });
});
