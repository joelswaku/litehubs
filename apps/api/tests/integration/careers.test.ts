import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { query } from "../../src/config/database";
import { withTenantContext, withUserContext } from "../../src/utils/tenant-query";

const app = createApp();
const suffix = randomUUID().slice(0, 8);
const ownerEmail = `careers-owner-${suffix}@test.invalid`;
const organizationSlug = `careers-${suffix}`;
const PASSWORD = "SecurePass123";

async function cleanUp(): Promise<void> {
  const found = await query<{ id: string }>("SELECT id FROM users WHERE email = $1", [ownerEmail]);
  const userId = found.rows[0]?.id;
  if (!userId) return;

  const organizationIds = await withUserContext(userId, async (client) => {
    const memberships = await client.query<{ organization_id: string }>(
      "SELECT organization_id FROM organization_members WHERE user_id = $1",
      [userId],
    );
    return memberships.rows.map((row) => row.organization_id);
  });

  for (const organizationId of organizationIds) {
    await withTenantContext({ userId, organizationId }, (client) =>
      client.query("DELETE FROM organizations WHERE id = $1", [organizationId]),
    );
  }
  await query("DELETE FROM users WHERE id = $1", [userId]);
}

afterAll(cleanUp);

describe("Careers job posts", () => {
  it("creates a site-scoped vacancy and applies safe defaults", async () => {
    const registered = await request(app).post("/api/v1/auth/register").send({
      fullName: "Careers test owner",
      email: ownerEmail,
      password: PASSWORD,
      organization: {
        slug: organizationSlug,
        legalName: "Careers test company",
        displayName: "Careers test company",
        industryCode: "poultry",
        country: "CD",
        currency: "CDF",
      },
    });
    expect(registered.status).toBe(201);
    const authorized = (call: request.Test) => call.set("Authorization", `Bearer ${registered.body.accessToken}`);

    const province = await authorized(
      request(app).post(`/api/v1/organizations/${organizationSlug}/provinces`).send({ code: "kinshasa", name: "Kinshasa" }),
    );
    expect(province.status).toBe(201);

    const site = await authorized(
      request(app).post(`/api/v1/organizations/${organizationSlug}/sites`).send({
        provinceId: province.body.province.id,
        code: "career_site",
        name: "Career Site",
        siteType: "farm",
      }),
    );
    expect(site.status).toBe(201);

    const portal = await authorized(
      request(app).put(`/api/v1/organizations/${organizationSlug}/careers/settings`).send({
        siteId: site.body.site.id,
        publicCareersEnabled: true,
      }),
    );
    expect(portal.status).toBe(200);

    const created = await authorized(
      request(app).post(`/api/v1/organizations/${organizationSlug}/careers/jobs`).send({
        siteId: site.body.site.id,
        code: "poultry_worker",
        title: "Poultry worker",
        shortSummary: "Support daily poultry production and animal welfare.",
        description: "Complete role description for daily poultry production work.",
        status: "published",
      }),
    );
    expect(created.status).toBe(201);
    expect(created.body.job).toMatchObject({
      code: "poultry_worker",
      employmentType: "permanent",
      experienceLevel: "not_specified",
      positionsOpen: 1,
      status: "published",
      site: { id: site.body.site.id },
    });

    const listed = await authorized(request(app).get(`/api/v1/organizations/${organizationSlug}/careers/jobs`));
    expect(listed.status).toBe(200);
    expect(listed.body.jobs).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.job.id })]));

    const publicCatalog = await request(app).get(`/api/v1/public/organizations/${organizationSlug}/careers/jobs`);
    expect(publicCatalog.status).toBe(200);
    expect(publicCatalog.body.jobs).toEqual(expect.arrayContaining([expect.objectContaining({ code: "poultry_worker" })]));

    const publicDetail = await request(app).get(`/api/v1/public/organizations/${organizationSlug}/careers/jobs/poultry_worker`);
    expect(publicDetail.status).toBe(200);
    expect(publicDetail.body.job).toMatchObject({ code: "poultry_worker", title: "Poultry worker" });
  });
});
