import { describe, expect, it } from "vitest";
import { forgotPasswordSchema } from "../../src/modules/auth/auth.validation";

describe("password reset delivery validation", () => {
  it("accepts an email reset request and retains the selected channel", () => {
    expect(
      forgotPasswordSchema.parse({
        identifier: "JEAN@EXAMPLE.COM ",
        deliveryMethod: "email",
      }),
    ).toEqual({
      identifier: "JEAN@EXAMPLE.COM",
      deliveryMethod: "email",
    });
  });

  it("accepts an SMS reset request with a Congolese number", () => {
    expect(
      forgotPasswordSchema.parse({
        identifier: "243 898 869 772",
        deliveryMethod: "sms",
      }),
    ).toEqual({
      identifier: "243 898 869 772",
      deliveryMethod: "sms",
    });
  });

  it("rejects an email when the user selected SMS", () => {
    expect(() =>
      forgotPasswordSchema.parse({
        identifier: "jean@example.com",
        deliveryMethod: "sms",
      }),
    ).toThrow(/phone number/i);
  });

  it("keeps the old email request body compatible", () => {
    expect(forgotPasswordSchema.parse({ email: "jean@example.com" })).toEqual({
      identifier: "jean@example.com",
      deliveryMethod: "email",
    });
  });
});
