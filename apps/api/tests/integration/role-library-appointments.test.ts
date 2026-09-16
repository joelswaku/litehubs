import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { query } from "../../src/config/database";
import {
  withTenantContext,
  withUserContext,
} from "../../src/utils/tenant-query";

const app = createApp();
const suffix = randomUUID().slice(0, 8);
const PASSWORD = "SecurePass123";
const ownerEmail = "role-library-owner-" + suffix + "@test.invalid";
const receptionistEmail = "role-library-reception-" + suffix + "@test.invalid";
const organizationSlug = "role-library-" + suffix;

async function cleanUp(address: string): Promise<void> {
  const found = await query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1",
    [address],
  );
  const userId = found.rows[0]?.id;
  if (!userId) return;

  const memberships = await withUserContext(userId, async (client) => {
    const result = await client.query<{ organization_id: string }>(
      "SELECT organization_id FROM organization_members WHERE user_id = $1",
      [userId],
    );
    return result.rows.map((row) => row.organization_id);
  });

  for (const organizationId of memberships) {
    await withTenantContext({ userId, organizationId }, (client) =>
      client.query("DELETE FROM organizations WHERE id = $1", [organizationId]),
    );
  }

  await query("DELETE FROM users WHERE id = $1", [userId]);
}

afterAll(async () => {
  // Deleting the owner first removes the temporary organization. The invited
  // receptionist can then be removed without ever touching another tenant.
  await cleanUp(ownerEmail);
  await cleanUp(receptionistEmail);
});

describe("role library defaults", () => {
  it("gives the Reception & Appointments role its complete operational workflow", async () => {
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({
        fullName: "Role Library Owner",
        email: ownerEmail,
        password: PASSWORD,
        organization: {
          slug: organizationSlug,
          legalName: "Role Library Test SARL",
          displayName: "Role Library Test",
          industryCode: "mixed_farm",
          country: "CD",
          currency: "CDF",
        },
      });
    expect(registered.status).toBe(201);

    const ownerToken = registered.body.accessToken as string;
    const authorized = (call: request.Test) =>
      call.set("Authorization", "Bearer " + ownerToken);

    const province = await authorized(
      request(app)
        .post("/api/v1/organizations/" + organizationSlug + "/provinces")
        .send({ code: "kinshasa", name: "Kinshasa" }),
    );
    expect(province.status).toBe(201);

    const site = await authorized(
      request(app)
        .post("/api/v1/organizations/" + organizationSlug + "/sites")
        .send({
          provinceId: province.body.province.id,
          code: "reception_site",
          name: "Reception Site",
          siteType: "office",
          city: "Kinshasa",
        }),
    );
    expect(site.status).toBe(201);

    const roles = await authorized(
      request(app).get("/api/v1/organizations/" + organizationSlug + "/roles"),
    );
    expect(roles.status).toBe(200);

    // This is the complete built-in library delivered to a mixed farm. The
    // audit guards against a role appearing in the UI with no usable grants.
    const requiredRoleCodes = [
      "owner",
      "general_manager",
      "provincial_manager",
      "farm_manager",
      "farm_operations_manager",
      "project_manager",
      "supervisor",
      "agriculture_supervisor",
      "agronomist",
      "pig_supervisor",
      "poultry_supervisor",
      "veterinarian",
      "accountant",
      "hr_officer",
      "security_officer",
      "storekeeper",
      "appointment_receptionist",
      "employee",
      "poultry_worker",
      "pig_worker",
      "agriculture_worker",
    ];
    for (const code of requiredRoleCodes) {
      const role = roles.body.roles.find(
        (row: { code: string }) => row.code === code,
      );
      expect(role).toBeTruthy();
      expect(role.permissionCodes.length).toBeGreaterThan(0);
    }

    const receptionistRole = roles.body.roles.find(
      (row: { code: string }) => row.code === "appointment_receptionist",
    );
    expect(receptionistRole.dataScope).toBe("province");
    expect(receptionistRole.permissionCodes).toEqual(
      expect.arrayContaining([
        "appointments.read",
        "appointments.create",
        "appointments.update",
      ]),
    );

    const invitation = await authorized(
      request(app)
        .post("/api/v1/organizations/" + organizationSlug + "/invitations")
        .send({
          email: receptionistEmail,
          roleCodes: ["appointment_receptionist"],
          provinceIds: [province.body.province.id],
          jobTitle: "Receptionist",
        }),
    );
    expect(invitation.status).toBe(201);

    const invitationToken = new URL(invitation.body.acceptUrl).searchParams.get(
      "token",
    );
    expect(invitationToken).toBeTruthy();

    const accepted = await request(app)
      .post("/api/v1/auth/accept-invitation")
      .send({
        token: invitationToken,
        fullName: "Appointment Receptionist",
        email: receptionistEmail,
        password: PASSWORD,
      });
    expect(accepted.status).toBe(201);

    const receptionistToken = accepted.body.accessToken as string;
    const receptionist = (call: request.Test) =>
      call.set("Authorization", "Bearer " + receptionistToken);

    const receptionistCannotCreateService = await receptionist(
      request(app)
        .post(
          "/api/v1/organizations/" +
            organizationSlug +
            "/appointments/services",
        )
        .send({
          siteId: site.body.site.id,
          code: "general_reception",
          name: "General reception",
          durationMinutes: 20,
          allowsOnlineBooking: true,
          allowsQrCheckin: true,
          isActive: true,
        }),
    );
    expect(receptionistCannotCreateService.status).toBe(403);

    const service = await authorized(
      request(app)
        .post(
          "/api/v1/organizations/" +
            organizationSlug +
            "/appointments/services",
        )
        .send({
          siteId: site.body.site.id,
          code: "general_reception",
          name: "General reception",
          durationMinutes: 20,
          allowsOnlineBooking: true,
          allowsQrCheckin: true,
          isActive: true,
        }),
    );
    expect(service.status).toBe(201);

    const receptionistCannotCreateDesk = await receptionist(
      request(app)
        .post(
          "/api/v1/organizations/" + organizationSlug + "/appointments/desks",
        )
        .send({
          siteId: site.body.site.id,
          code: "desk_1",
          name: "Desk 1",
          isActive: true,
        }),
    );
    expect(receptionistCannotCreateDesk.status).toBe(403);

    const desk = await authorized(
      request(app)
        .post(
          "/api/v1/organizations/" + organizationSlug + "/appointments/desks",
        )
        .send({
          siteId: site.body.site.id,
          code: "desk_1",
          name: "Desk 1",
          isActive: true,
        }),
    );
    expect(desk.status).toBe(201);

    const appointment = await receptionist(
      request(app)
        .post("/api/v1/organizations/" + organizationSlug + "/appointments")
        .send({
          siteId: site.body.site.id,
          serviceId: service.body.service.id,
          visitorName: "Walk-in visitor",
          visitorEmail: "visitor-" + suffix + "@test.invalid",
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
    );
    expect(appointment.status).toBe(201);
    expect(appointment.body.appointment.source).toBe("staff");

    const checkedIn = await receptionist(
      request(app).post(
        "/api/v1/organizations/" +
          organizationSlug +
          "/appointments/" +
          appointment.body.appointment.id +
          "/check-in",
      ),
    );
    expect(checkedIn.status).toBe(200);
    expect(checkedIn.body.appointment.status).toBe("waiting");

    const settings = await receptionist(
      request(app)
        .put(
          "/api/v1/organizations/" +
            organizationSlug +
            "/appointments/settings",
        )
        .send({
          siteId: site.body.site.id,
          publicBookingEnabled: true,
          qrCheckinEnabled: true,
          queueDisplayEnabled: true,
          bookingOpensAt: "08:00",
          bookingClosesAt: "17:00",
          slotIntervalMinutes: 30,
          defaultServiceMinutes: 20,
        }),
    );
    // Publishing a public channel stays reserved for the company owner.
    expect(settings.status).toBe(403);
  });
});
