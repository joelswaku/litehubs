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
const ownerEmail = `platform-owner-${suffix}@test.invalid`;
const supportEmail = `platform-support-${suffix}@test.invalid`;
const slug = `platform-staff-${suffix}`;
const password = "SecurePass123";

async function deleteUserAndCompanies(email: string) {
  const user = await query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1",
    [email],
  );
  const userId = user.rows[0]?.id;
  if (!userId) return;
  const companies = await withUserContext(userId, async (client) => {
    const found = await client.query<{ organization_id: string }>(
      "SELECT organization_id FROM organization_members WHERE user_id = $1",
      [userId],
    );
    return found.rows;
  });
  for (const company of companies) {
    await withTenantContext(
      { userId, organizationId: company.organization_id },
      (client) =>
        client.query("DELETE FROM organizations WHERE id = $1", [
          company.organization_id,
        ]),
    );
  }
  await query("DELETE FROM users WHERE id = $1", [userId]);
}

afterAll(async () => {
  await deleteUserAndCompanies(supportEmail);
  await deleteUserAndCompanies(ownerEmail);
});

describe("LiteHubs platform staff", () => {
  it("lets a Super Admin create, view, change and suspend staff accounts", async () => {
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({
        fullName: "Platform Test Owner",
        email: ownerEmail,
        password,
        organization: {
          slug,
          legalName: "Platform Test Company",
          displayName: "Platform Test Company",
          industryCode: "mixed_farm",
          country: "CD",
        },
      });
    expect(registered.status).toBe(201);

    const ownerId = registered.body.user.id as string;
    const superAdmin = await query<{ id: string }>(
      "SELECT id FROM platform_roles WHERE code = 'platform_super_admin'",
    );
    await query(
      `INSERT INTO user_platform_roles (user_id, platform_role_id)
       VALUES ($1, $2)`,
      [ownerId, superAdmin.rows[0]!.id],
    );

    const asSuperAdmin = (call: request.Test) =>
      call.set(
        "Authorization",
        `Bearer ${registered.body.accessToken as string}`,
      );

    const roles = await asSuperAdmin(
      request(app).get("/api/v1/platform/staff/roles"),
    );
    expect(roles.status).toBe(200);
    expect(
      roles.body.roles.map((role: { code: string }) => role.code),
    ).toContain("platform_support");

    const created = await asSuperAdmin(
      request(app)
        .post("/api/v1/platform/staff/users")
        .send({
          fullName: "Platform Support Test",
          email: supportEmail,
          password,
          roles: ["platform_support"],
        }),
    );
    expect(created.status).toBe(201);
    expect(created.body.staff.mustChangePassword).toBe(true);
    expect(created.body.staff.roles).toEqual(["platform_support"]);

    const staffId = created.body.staff.id as string;
    const changedRoles = await asSuperAdmin(
      request(app)
        .put(`/api/v1/platform/staff/users/${staffId}/roles`)
        .send({
          roles: ["platform_admin"],
        }),
    );
    expect(changedRoles.status).toBe(200);
    expect(changedRoles.body.staff.roles).toEqual(["platform_admin"]);

    const suspended = await asSuperAdmin(
      request(app)
        .patch(`/api/v1/platform/staff/users/${staffId}/status`)
        .send({
          status: "suspended",
        }),
    );
    expect(suspended.status).toBe(200);
    expect(suspended.body.staff.status).toBe("suspended");
  });
});
