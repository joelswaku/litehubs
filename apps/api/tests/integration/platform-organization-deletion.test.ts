import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { query } from "../../src/config/database";
import { withTenantContext, withUserContext } from "../../src/utils/tenant-query";

const app = createApp();
const suffix = randomUUID().slice(0, 8);
const password = "SecurePass123";
const superEmail = `delete-super-${suffix}@test.invalid`;
const otherEmail = `delete-other-${suffix}@test.invalid`;
const targetSlug = `delete-target-${suffix}`;
const otherSlug = `delete-other-${suffix}`;
let superUserId = "";

async function removeCreatedCompany(email: string): Promise<void> {
  const result = await query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  const userId = result.rows[0]?.id;
  if (!userId) return;
  const memberships = await withUserContext(userId, async (client) => {
    const rows = await client.query<{ organization_id: string }>(
      "SELECT organization_id FROM organization_members WHERE user_id = $1",
      [userId],
    );
    return rows.rows;
  });
  for (const membership of memberships) {
    await withTenantContext({ userId, organizationId: membership.organization_id }, (client) =>
      client.query("DELETE FROM organizations WHERE id = $1", [membership.organization_id]),
    );
  }
  await query("DELETE FROM users WHERE id = $1", [userId]);
}

afterAll(async () => {
  await removeCreatedCompany(otherEmail);
  await removeCreatedCompany(superEmail);
});

describe("platform company deletion", () => {
  it("requires a Super Admin, hides only the scheduled workspace, and never purges another tenant", async () => {
    const superRegistration = await request(app).post("/api/v1/auth/register").send({
      fullName: "Deletion Super Admin",
      email: superEmail,
      password,
      organization: {
        slug: targetSlug,
        legalName: "Deletion Target SARL",
        displayName: "Deletion Target",
        industryCode: "mixed_farm",
        country: "CD",
      },
    });
    expect(superRegistration.status).toBe(201);
    superUserId = superRegistration.body.user.id as string;

    const role = await query<{ id: string }>(
      "SELECT id FROM platform_roles WHERE code = 'platform_super_admin'",
    );
    await query(
      "INSERT INTO user_platform_roles (user_id, platform_role_id) VALUES ($1, $2)",
      [superUserId, role.rows[0]!.id],
    );

    const otherRegistration = await request(app).post("/api/v1/auth/register").send({
      fullName: "Unprivileged Owner",
      email: otherEmail,
      password,
      organization: {
        slug: otherSlug,
        legalName: "Other Tenant SARL",
        displayName: "Other Tenant",
        industryCode: "mixed_farm",
        country: "CD",
      },
    });
    expect(otherRegistration.status).toBe(201);

    const superRequest = (call: request.Test) =>
      call.set("Authorization", `Bearer ${superRegistration.body.accessToken as string}`);
    const otherRequest = (call: request.Test) =>
      call.set("Authorization", `Bearer ${otherRegistration.body.accessToken as string}`);

    const forbidden = await otherRequest(
      request(app).post(`/api/v1/platform/organizations/${targetSlug}/deletion`).send({
        confirmationName: "Deletion Target SARL",
        currentPassword: password,
      }),
    );
    expect(forbidden.status).toBe(403);

    const wrongPassword = await superRequest(
      request(app).post(`/api/v1/platform/organizations/${targetSlug}/deletion`).send({
        confirmationName: "Deletion Target SARL",
        currentPassword: "wrong-password",
      }),
    );
    expect(wrongPassword.status).toBe(401);

    const scheduled = await superRequest(
      request(app).post(`/api/v1/platform/organizations/${targetSlug}/deletion`).send({
        confirmationName: "Deletion Target SARL",
        currentPassword: password,
      }),
    );
    expect(scheduled.status).toBe(200);
    expect(scheduled.body.tenant.deletionStatus).toBe("scheduled");
    expect(scheduled.body.tenant.purgeAfter).toBeTruthy();

    const hiddenFromCompanyMember = await request(app)
      .get(`/api/v1/organizations/${targetSlug}`)
      .set("Authorization", `Bearer ${superRegistration.body.accessToken as string}`);
    expect(hiddenFromCompanyMember.status).toBe(404);

    const deletionContext = await superRequest(
      request(app).get(`/api/v1/platform/organizations/${targetSlug}/deletion-context`),
    );
    expect(deletionContext.status).toBe(200);
    expect(deletionContext.body.detail.tenant.id).toBeTruthy();
    expect(deletionContext.body.detail.counts.members).toBe(1);

    const cancelled = await superRequest(
      request(app).delete(`/api/v1/platform/organizations/${targetSlug}/deletion`),
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.tenant.deletionStatus).toBe("cancelled");

    const reachableAfterCancellation = await request(app)
      .get(`/api/v1/organizations/${targetSlug}`)
      .set("Authorization", `Bearer ${superRegistration.body.accessToken as string}`);
    expect(reachableAfterCancellation.status).toBe(200);

    const rescheduled = await superRequest(
      request(app).post(`/api/v1/platform/organizations/${targetSlug}/deletion`).send({
        confirmationName: "Deletion Target SARL",
        currentPassword: password,
      }),
    );
    expect(rescheduled.status).toBe(200);

    const restored = await superRequest(
      request(app).post(`/api/v1/platform/organizations/${targetSlug}/restore`),
    );
    expect(restored.status).toBe(200);
    expect(restored.body.tenant.deletionStatus).toBe("none");

    const reachableAfterRestore = await request(app)
      .get(`/api/v1/organizations/${targetSlug}`)
      .set("Authorization", `Bearer ${superRegistration.body.accessToken as string}`);
    expect(reachableAfterRestore.status).toBe(200);

    const scheduledForPurge = await superRequest(
      request(app).post(`/api/v1/platform/organizations/${targetSlug}/deletion`).send({
        confirmationName: "Deletion Target SARL",
        currentPassword: password,
      }),
    );
    expect(scheduledForPurge.status).toBe(200);

    await withUserContext(superUserId, (client) =>
      client.query(
        `UPDATE organizations
            SET purge_after = now() - interval '1 minute'
          WHERE slug = $1 AND deletion_status = 'scheduled'`,
        [targetSlug],
      ),
    );

    const purged = await superRequest(
      request(app).post(`/api/v1/platform/organizations/${targetSlug}/purge`).send({
        confirmationName: "Deletion Target SARL",
        currentPassword: password,
      }),
    );
    expect(purged.status).toBe(204);

    const audit = await query<{ event_type: string }>(
      `SELECT event_type
         FROM platform_organization_deletion_audit
        WHERE organization_id = $1
        ORDER BY created_at`,
      [scheduled.body.tenant.id],
    );
    expect(audit.rows.map((row) => row.event_type)).toEqual(
      expect.arrayContaining([
        "deletion_requested",
        "deletion_cancelled",
        "organization_restored",
        "permanent_purge",
      ]),
    );

    // The purge predicate is organization-id scoped. The second company stays
    // reachable under its own owner and is proof that no cross-tenant delete ran.
    const otherStillExists = await request(app)
      .get(`/api/v1/organizations/${otherSlug}`)
      .set("Authorization", `Bearer ${otherRegistration.body.accessToken as string}`);
    expect(otherStillExists.status).toBe(200);
  });
});