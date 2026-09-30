import { describe, expect, it } from "vitest";
import { createProfessionalCourseSchema } from "../../src/modules/training/lms.validation";

const course = {
  code: "safety_induction",
  name: "Safety induction",
  category: "safety" as const,
  languages: ["fr"] as const,
};

describe("professional course validation", () => {
  it("requires the renewal interval before a renewal can be required", () => {
    const result = createProfessionalCourseSchema.safeParse({
      ...course,
      renewalRequired: true,
      renewalMonths: null,
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ["renewalMonths"] }),
      );
  });

  it("accepts a course without renewal and one with a complete renewal rule", () => {
    expect(createProfessionalCourseSchema.safeParse(course).success).toBe(true);
    expect(
      createProfessionalCourseSchema.safeParse({
        ...course,
        renewalRequired: true,
        renewalMonths: 12,
      }).success,
    ).toBe(true);
  });
});
