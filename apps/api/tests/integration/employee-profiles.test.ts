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
const ownerEmail = `employee-owner-${suffix}@test.invalid`;
const supervisorEmail = `employee-supervisor-${suffix}@test.invalid`;
const organizationSlug = `employee-congo-${suffix}`;

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
  await cleanUp(ownerEmail);
  await cleanUp(supervisorEmail);
});

describe("Employee profiles", () => {
  it("links an employee to a member and limits a provincial supervisor to their province", async () => {
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({
        fullName: "Employee Profile Owner",
        email: ownerEmail,
        password: PASSWORD,
        organization: {
          slug: organizationSlug,
          legalName: "Employee Profile Congo SARL",
          displayName: "Employee Profile Congo",
          industryCode: "mixed_farm",
          country: "CD",
          currency: "CDF",
        },
      });
    expect(registered.status).toBe(201);
    const ownerToken = registered.body.accessToken as string;
    const authorized = (call: request.Test) =>
      call.set("Authorization", `Bearer ${ownerToken}`);

    const kinshasa = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/provinces`)
        .send({ code: "kinshasa", name: "Kinshasa" }),
    );
    expect(kinshasa.status).toBe(201);

    const kongoCentral = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/provinces`)
        .send({ code: "kongo_central", name: "Kongo Central" }),
    );
    expect(kongoCentral.status).toBe(201);

    const farm = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/sites`)
        .send({
          provinceId: kinshasa.body.province.id,
          code: "kinshasa_farm",
          name: "Kinshasa Farm",
          siteType: "farm",
        }),
    );
    expect(farm.status).toBe(201);

    const department = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/departments`)
        .send({
          siteId: farm.body.site.id,
          code: "poultry",
          name: "Poultry",
        }),
    );
    expect(department.status).toBe(201);

    const invitation = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/invitations`)
        .send({
          email: supervisorEmail,
          roleCodes: ["poultry_supervisor"],
          provinceIds: [kinshasa.body.province.id],
          jobTitle: "Poultry Supervisor",
        }),
    );
    expect(invitation.status).toBe(201);
    const invitationToken = new URL(invitation.body.acceptUrl).searchParams.get(
      "token",
    );

    const accepted = await request(app)
      .post("/api/v1/auth/accept-invitation")
      .send({
        token: invitationToken,
        fullName: "Kinshasa Poultry Supervisor",
        email: supervisorEmail,
        password: PASSWORD,
      });
    expect(accepted.status).toBe(201);
    const supervisorToken = accepted.body.accessToken as string;

    const members = await authorized(
      request(app).get(`/api/v1/organizations/${organizationSlug}/members`),
    );
    const supervisorMember = members.body.members.find(
      (member: { email: string }) => member.email === supervisorEmail,
    ) as { memberId: string } | undefined;
    expect(supervisorMember?.memberId).toBeTruthy();

    const linkedEmployee = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/employees`)
        .send({
          memberId: supervisorMember!.memberId,
          fullName: "Kinshasa Poultry Supervisor",
          jobTitle: "Poultry Supervisor",
          departmentId: department.body.department.id,
          employmentStatus: "active",
          employmentType: "permanent",
          startDate: "2026-08-23",
          phone: "+243800000001",
        }),
    );
    expect(linkedEmployee.status).toBe(201);
    expect(linkedEmployee.body.employee).toEqual(
      expect.objectContaining({
        employeeNumber: "20001",
        positionCategory: "supervisor",
        member: expect.objectContaining({
          memberId: supervisorMember!.memberId,
        }),
        province: expect.objectContaining({ id: kinshasa.body.province.id }),
        site: expect.objectContaining({ id: farm.body.site.id }),
        department: expect.objectContaining({
          id: department.body.department.id,
        }),
      }),
    );

    const outsideEmployee = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/employees`)
        .send({
          fullName: "Kongo Central Farm Worker",
          jobTitle: "Farm Worker",
          provinceId: kongoCentral.body.province.id,
          employmentStatus: "active",
          employmentType: "casual",
        }),
    );
    expect(outsideEmployee.status).toBe(201);

    const supervisorList = await request(app)
      .get(`/api/v1/organizations/${organizationSlug}/employees`)
      .set("Authorization", `Bearer ${supervisorToken}`);
    expect(supervisorList.status).toBe(200);
    expect(supervisorList.body.employees).toHaveLength(1);
    expect(supervisorList.body.employees[0].id).toBe(
      linkedEmployee.body.employee.id,
    );

    const hiddenEmployee = await request(app)
      .get(
        `/api/v1/organizations/${organizationSlug}/employees/${outsideEmployee.body.employee.id}`,
      )
      .set("Authorization", `Bearer ${supervisorToken}`);
    expect(hiddenEmployee.status).toBe(404);

    const updated = await authorized(
      request(app)
        .patch(
          `/api/v1/organizations/${organizationSlug}/employees/${linkedEmployee.body.employee.id}`,
        )
        .send({ phone: "+243800000002" }),
    );
    expect(updated.status).toBe(200);
    expect(updated.body.employee.contact.phone).toBe("+243800000002");
  });
});
