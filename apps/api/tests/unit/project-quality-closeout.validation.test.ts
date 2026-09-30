import { describe, expect, it } from "vitest";
import { parseOwnerManagementBody } from "../../src/modules/owner-management/owner-management.validation";

const projectId = "11111111-1111-4111-8111-111111111111";
const receiptId = "22222222-2222-4222-8222-222222222222";

describe("project quality and close-out validation", () => {
  it("accepts a receipt control with its evidence and commissioning checks", () => {
    const check = parseOwnerManagementBody(
      "quality-checks",
      {
        projectId,
        receiptId,
        qualityStatus: "accepted",
        quantityMatches: true,
        conditionAccepted: true,
        documentsComplete: true,
        functionalTestPassed: true,
        safetyCheckPassed: true,
        commissioningStatus: "validated",
        warrantyProvider: "Fournitures Congo",
        warrantyExpiresOn: "2027-09-28",
      },
      "create",
    );

    expect(check).toMatchObject({
      projectId,
      receiptId,
      qualityStatus: "accepted",
      commissioningStatus: "validated",
    });
  });

  it("requires an inspected receipt or asset and the required acceptance checks", () => {
    expect(() =>
      parseOwnerManagementBody(
        "quality-checks",
        { projectId, qualityStatus: "pending" },
        "create",
      ),
    ).toThrow(/Choose a receipt or an equipment asset/);

    expect(() =>
      parseOwnerManagementBody(
        "quality-checks",
        {
          projectId,
          receiptId,
          qualityStatus: "accepted",
          quantityMatches: false,
          conditionAccepted: true,
          documentsComplete: true,
        },
        "create",
      ),
    ).toThrow(/Complete the required reception checks/);

    expect(() =>
      parseOwnerManagementBody(
        "quality-checks",
        {
          projectId,
          receiptId,
          qualityStatus: "returned",
          returnReason: "Damaged",
        },
        "create",
      ),
    ).toThrow(/Record the quantity returned/);
  });

  it("requires an outcome decision, commissioning validation and lessons before closure", () => {
    expect(() =>
      parseOwnerManagementBody(
        "project-closeouts",
        {
          projectId,
          status: "completed",
          expectedOutcomeAchieved: true,
          achievementSummary: "The new house is operational.",
          commissioningValidated: false,
        },
        "create",
      ),
    ).toThrow(/Record what the team learned/);

    const closeout = parseOwnerManagementBody(
      "project-closeouts",
      {
        projectId,
        status: "completed",
        expectedOutcomeAchieved: true,
        achievementSummary:
          "The new house passed quantity, quality and commissioning checks.",
        lessonsLearned: "Confirm the delivery note before supplier arrival.",
        commissioningValidated: true,
      },
      "create",
    );
    expect(closeout).toMatchObject({ projectId, status: "completed" });
  });
});
