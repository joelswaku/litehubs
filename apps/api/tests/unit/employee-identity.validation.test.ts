import { describe, expect, it } from "vitest";
import {
  createEmployeeSchema,
  updateEmployeeSchema,
} from "../../src/modules/employees/employee.validation";

describe("employee identity and residential address validation", () => {
  it("accepts a structured Congolese identity and full residential address", () => {
    const value = createEmployeeSchema.parse({
      lastName: "Mbuyi",
      postName: "Kasongo",
      firstName: "Jean",
      jobTitle: "Poultry Farm Worker",
      addressLine1: "12 avenue de la Paix",
      addressLine2: "Quartier Matonge",
      addressCity: "Kinshasa",
      addressRegion: "Kinshasa",
      addressPostalCode: "00000",
      addressCountry: "République démocratique du Congo",
    });

    expect(value).toMatchObject({
      lastName: "Mbuyi",
      postName: "Kasongo",
      firstName: "Jean",
      addressCity: "Kinshasa",
    });
  });

  it("keeps existing full-name integrations compatible and rejects a nameless record", () => {
    expect(
      createEmployeeSchema.parse({
        fullName: "Ancien dossier employé",
        jobTitle: "Farm Worker",
      }).fullName,
    ).toBe("Ancien dossier employé");

    expect(() =>
      createEmployeeSchema.parse({ jobTitle: "Farm Worker" }),
    ).toThrow(/last name and first name/);
  });

  it("allows an address part to be intentionally cleared during an update", () => {
    expect(updateEmployeeSchema.parse({ addressLine2: null })).toEqual({
      addressLine2: null,
    });
  });
});
