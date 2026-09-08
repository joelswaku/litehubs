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
const ownerEmail = `setup-owner-${suffix}@test.invalid`;
const workerEmail = `setup-worker-${suffix}@test.invalid`;
const organizationSlug = `setup-congo-${suffix}`;

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
  await cleanUp(workerEmail);
});

describe("Congo Omega company setup", () => {
  it("sets up a province, farm and department, then invites a province-scoped supervisor", async () => {
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({
        fullName: "Congo Omega Setup Owner",
        email: ownerEmail,
        password: PASSWORD,
        organization: {
          slug: organizationSlug,
          legalName: "Congo Omega Setup SARL",
          displayName: "Congo Omega Setup",
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
          city: "Kinshasa",
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

    const roles = await authorized(
      request(app).get(`/api/v1/organizations/${organizationSlug}/roles`),
    );
    expect(roles.status).toBe(200);
    expect(roles.body.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "poultry_supervisor",
          dataScope: "province",
        }),
      ]),
    );

    const ownerRoleInvitation = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/invitations`)
        .send({
          email: workerEmail,
          roleCodes: ["owner"],
          provinceIds: [],
        }),
    );
    expect(ownerRoleInvitation.status).toBe(400);

    const invitation = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/invitations`)
        .send({
          email: workerEmail,
          roleCodes: ["poultry_supervisor"],
          provinceIds: [kinshasa.body.province.id],
          jobTitle: "Poultry Supervisor",
        }),
    );
    expect(invitation.status).toBe(201);
    expect(invitation.body.invitation.roleCodes).toEqual([
      "poultry_supervisor",
    ]);
    expect(invitation.body.acceptUrl).toBeTruthy();

    const invitationToken = new URL(invitation.body.acceptUrl).searchParams.get(
      "token",
    );
    expect(invitationToken).toBeTruthy();

    const accepted = await request(app)
      .post("/api/v1/auth/accept-invitation")
      .send({
        token: invitationToken,
        fullName: "Kinshasa Poultry Supervisor",
        email: workerEmail,
        password: PASSWORD,
      });
    expect(accepted.status).toBe(201);
    expect(accepted.body.user.roles).toEqual(["poultry_supervisor"]);

    const workerToken = accepted.body.accessToken as string;
    const workerProvinces = await request(app)
      .get(`/api/v1/organizations/${organizationSlug}/provinces`)
      .set("Authorization", `Bearer ${workerToken}`);
    expect(workerProvinces.status).toBe(200);
    expect(workerProvinces.body.provinces).toHaveLength(1);
    expect(workerProvinces.body.provinces[0].id).toBe(
      kinshasa.body.province.id,
    );

    const workerSites = await request(app)
      .get(`/api/v1/organizations/${organizationSlug}/sites`)
      .set("Authorization", `Bearer ${workerToken}`);
    expect(workerSites.status).toBe(200);
    expect(workerSites.body.sites).toHaveLength(1);
    expect(workerSites.body.sites[0].id).toBe(farm.body.site.id);

    const workerDepartments = await request(app)
      .get(`/api/v1/organizations/${organizationSlug}/departments`)
      .set("Authorization", `Bearer ${workerToken}`);
    expect(workerDepartments.status).toBe(200);
    expect(workerDepartments.body.departments).toHaveLength(1);
    expect(workerDepartments.body.departments[0].id).toBe(
      department.body.department.id,
    );

    const members = await authorized(
      request(app).get(`/api/v1/organizations/${organizationSlug}/members`),
    );
    expect(members.status).toBe(200);
    expect(members.body.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: workerEmail,
          roleCodes: ["poultry_supervisor"],
          provinces: [
            expect.objectContaining({ id: kinshasa.body.province.id }),
          ],
        }),
      ]),
    );

    expect(kongoCentral.body.province.id).not.toBe(kinshasa.body.province.id);
  });
});
