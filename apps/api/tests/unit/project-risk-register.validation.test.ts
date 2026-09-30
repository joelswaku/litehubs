import { describe, expect, it } from "vitest";
import { parseOwnerManagementBody } from "../../src/modules/owner-management/owner-management.validation";

const projectId = "11111111-1111-4111-8111-111111111111";
const ownerMemberId = "22222222-2222-4222-8222-222222222222";

describe("project risk register validation", () => {
  it("accepts a structured risk with its accountable owner, trigger and review", () => {
    const risk = parseOwnerManagementBody(
      "risks",
      {
        projectId,
        recordType: "risk",
        category: "supplier_delay",
        title: "Feed ingredients arrive late",
        probability: "medium",
        impact: "high",
        ownerMemberId,
        triggerCondition: "Supplier has not confirmed dispatch",
        alertThreshold: "More than 3 days late",
        preventionAction:
          "Keep two approved suppliers and confirm stock weekly",
        contingencyAction: "Use the alternative approved supplier",
        reviewDate: "2026-10-04",
        status: "monitoring",
        decision: "mitigate",
        decisionTaken: "Activate the backup supplier",
        decisionJustification: "The forecast feed stock covers only two days",
      },
      "create",
    );

    expect(risk).toMatchObject({
      projectId,
      ownerMemberId,
      category: "supplier_delay",
      decision: "mitigate",
      reviewDate: "2026-10-04",
    });
  });

  it("refuses a risk with no action or review date", () => {
    expect(() =>
      parseOwnerManagementBody(
        "risks",
        {
          projectId,
          title: "Water shortage",
          ownerMemberId,
          triggerCondition: "Water tank below reserve",
          alertThreshold: "Less than 2 days of water",
        },
        "create",
      ),
    ).toThrow();
  });

  it("requires a reason when a decision is recorded", () => {
    expect(() =>
      parseOwnerManagementBody(
        "risks",
        {
          decision: "accept",
          decisionTaken: "Accept the delivery delay",
        },
        "update",
      ),
    ).toThrow(/Explain the decision/);
  });
});
