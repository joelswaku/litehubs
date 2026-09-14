import { describe, expect, it } from "vitest";
import {
  appointmentCallMessageInput,
  appointmentDeskInput,
  appointmentSiteSettingsInput,
  callNextInput,
  publicBookingInput,
publicCheckInInput,
  createStaffAppointmentInput,
} from "../../src/modules/appointments/appointments.validation";

const ids = {
  service: "5d4e13c1-0225-4495-99e9-b4d9a0a68b23",
  site: "d7c6cacf-b5d2-47fb-9c8c-c2d995867c15",
  token: "58c19f65-ea0b-4bd3-9faf-1b5e26954d0d",
};

describe("appointment input validation", () => {
  it("requires a visitor contact method for public QR arrival", () => {
    const result = publicCheckInInput.safeParse({
      token: ids.token,
      serviceId: ids.service,
      visitorName: "Visitor without contact",
    });
    expect(result.success).toBe(false);
  });

  it("requires a reason and email for a QR arrival that needs queue updates", () => {
    const invalid = publicCheckInInput.safeParse({
      token: ids.token,
      serviceId: ids.service,
      visitorName: "Marie Kabongo",
      visitorEmail: "marie@example.com",
    });
    const valid = publicCheckInInput.safeParse({
      token: ids.token,
      serviceId: ids.service,
      visitorName: "Marie Kabongo",
      visitorEmail: "marie@example.com",
      reason: "Rendez-vous avec le responsable du site",
    });
    expect(invalid.success).toBe(false);
    expect(valid.success).toBe(true);
  });

  it("accepts a future online appointment with a phone contact", () => {
    const result = publicBookingInput.safeParse({
      siteCode: "kinshasa_farm",
      serviceId: ids.service,
      visitorName: "Marie Kabongo",
      visitorPhone: "+243 800 000 000",
      scheduledAt: "2030-01-02T09:30:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty optional phone when staff records the visitor by email", () => {
    const result = createStaffAppointmentInput.safeParse({
      siteId: ids.site,
      visitorName: "Marie Kabongo",
      visitorEmail: "marie@example.com",
      visitorPhone: "",
      scheduledAt: "2030-01-02T09:30:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("requires a scheduled date and time for a staff-created appointment", () => {
    const result = createStaffAppointmentInput.safeParse({
      siteId: ids.site,
      visitorName: "Marie Kabongo",
      visitorEmail: "marie@example.com",
    });
    expect(result.success).toBe(false);
  });

  it("requires an active desk when an agent calls the next visitor", () => {
    const withoutDesk = callNextInput.safeParse({ siteId: ids.site });
    const withDesk = callNextInput.safeParse({ siteId: ids.site, deskId: ids.service });
    const selectedMessage = callNextInput.safeParse({ siteId: ids.site, deskId: ids.service, messageTemplateId: ids.token });
    expect(withoutDesk.success).toBe(false);
    expect(withDesk.success).toBe(true);
    expect(selectedMessage.success).toBe(true);
  });

  it("accepts a public call message but rejects empty or oversized content", () => {
    const valid = appointmentCallMessageInput.safeParse({
      siteId: ids.site,
      title: "Accueil avec pièce d’identité",
      content: "Bienvenue. Présentez-vous au guichet avec votre pièce d’identité.",
    });
    const empty = appointmentCallMessageInput.safeParse({ siteId: ids.site, title: "Accueil", content: "  " });
    const tooLong = appointmentCallMessageInput.safeParse({ siteId: ids.site, title: "Accueil", content: "a".repeat(501) });
    expect(valid.success).toBe(true);
    expect(empty.success).toBe(false);
    expect(tooLong.success).toBe(false);
  });

  it("accepts a named desk but rejects an unsafe desk code", () => {
    const valid = appointmentDeskInput.safeParse({ siteId: ids.site, code: "guichet_1", name: "Guichet 1" });
    const invalid = appointmentDeskInput.safeParse({ siteId: ids.site, code: "Guichet 1", name: "Guichet 1" });
    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });
  it("accepts a bounded owner-configured idle TV message", () => {
    const valid = appointmentSiteSettingsInput.safeParse({
      siteId: ids.site,
      bookingOpensAt: "08:00",
      bookingClosesAt: "17:00",
      idleDisplayTitle: "Bienvenue à Congo Omega",
      idleDisplayMessage: "Nous sommes prêts à vous accueillir.",
    });
    const tooLong = appointmentSiteSettingsInput.safeParse({
      siteId: ids.site,
      bookingOpensAt: "08:00",
      bookingClosesAt: "17:00",
      idleDisplayMessage: "a".repeat(601),
    });
    expect(valid.success).toBe(true);
    expect(tooLong.success).toBe(false);
  });
  it("rejects a site queue configuration whose closing time is before opening", () => {
    const result = appointmentSiteSettingsInput.safeParse({
      siteId: ids.site,
      bookingOpensAt: "17:00",
      bookingClosesAt: "08:00",
    });
    expect(result.success).toBe(false);
  });
});


