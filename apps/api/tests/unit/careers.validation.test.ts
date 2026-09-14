import { describe, expect, it } from "vitest";
import {
  jobPostInput,
  publicApplicationInput,
} from "../../src/modules/careers/careers.validation";

const siteId = "d7c6cacf-b5d2-47fb-9c8c-c2d995867c15";

describe("careers input validation", () => {
  it("requires explicit privacy consent from a public candidate", () => {
    const result = publicApplicationInput.safeParse({
      fullName: "Marie Kabongo",
      email: "marie@example.test",
      phone: "+243800000000",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a complete public candidate application", () => {
    const result = publicApplicationInput.safeParse({
      fullName: "Marie Kabongo",
      email: "marie@example.test",
      phone: "+243800000000",
      yearsExperience: "4",
      consent: "true",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.preferredLanguage).toBe("fr");
  });

  it("accepts the candidate portal language only when it is French or English", () => {
    const result = publicApplicationInput.safeParse({
      fullName: "Marie Kabongo",
      email: "marie@example.test",
      phone: "+243800000000",
      consent: "true",
      preferredLanguage: "en",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.preferredLanguage).toBe("en");
  });

  it("does not allow an invalid public vacancy code", () => {
    const result = jobPostInput.safeParse({
      siteId,
      code: "Poultry Worker",
      title: "Poultry worker",
      shortSummary: "Support daily poultry production and animal welfare.",
      description:
        "Complete role description for daily poultry production work.",
    });
    expect(result.success).toBe(false);
  });

  it("uses safe defaults for optional vacancy select fields", () => {
    const result = jobPostInput.parse({
      siteId,
      code: "poultry_worker",
      title: "Poultry worker",
      shortSummary: "Support daily poultry production and animal welfare.",
      description:
        "Complete role description for daily poultry production work.",
    });

    expect(result.employmentType).toBe("permanent");
    expect(result.experienceLevel).toBe("not_specified");
    expect(result.positionsOpen).toBe(1);
    expect(result.status).toBe("draft");
  });
});
