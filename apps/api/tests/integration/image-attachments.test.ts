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
const ownerEmail = `image-upload-${suffix}@test.invalid`;
const organizationSlug = `image-upload-${suffix}`;
const password = "SecurePass123";
const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);

async function cleanUp(): Promise<void> {
  const found = await query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1",
    [ownerEmail],
  );
  const userId = found.rows[0]?.id;
  if (!userId) return;
  const organizations = await withUserContext(userId, async (client) => {
    const result = await client.query<{ organization_id: string }>(
      "SELECT organization_id FROM organization_members WHERE user_id = $1",
      [userId],
    );
    return result.rows.map((row) => row.organization_id);
  });
  for (const organizationId of organizations) {
    await withTenantContext({ userId, organizationId }, (client) =>
      client.query("DELETE FROM organizations WHERE id = $1", [organizationId]),
    );
  }
  await query("DELETE FROM users WHERE id = $1", [userId]);
}

afterAll(cleanUp);

describe("image attachments", () => {
  it("checks the linked record and reports a clear setup error until Cloudinary is configured", async () => {
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({
        fullName: "Image Upload Owner",
        email: ownerEmail,
        password,
        organization: {
          slug: organizationSlug,
          legalName: "Image Upload Congo SARL",
          displayName: "Image Upload Congo",
          industryCode: "mixed_farm",
          country: "CD",
          currency: "CDF",
        },
      });
    expect(registered.status).toBe(201);
    const owner = (call: request.Test) =>
      call.set(
        "Authorization",
        `Bearer ${String(registered.body.accessToken)}`,
      );
    const base = `/api/v1/organizations/${organizationSlug}`;
    const province = await owner(
      request(app)
        .post(`${base}/provinces`)
        .send({ code: `imageprovince${suffix}`, name: "Image Province" }),
    );
    expect(province.status).toBe(201);
    const project = await owner(
      request(app)
        .post(`${base}/owner-management/projects`)
        .send({
          code: `image_${suffix}`,
          name: "Image Attachment Project",
          projectType: "construction",
          provinceId: province.body.province.id,
        }),
    );
    expect(project.status).toBe(201);

    const emptyImages = await owner(
      request(app).get(
        `${base}/images/owner-management/projects/${project.body.record.id}`,
      ),
    );
    expect(emptyImages.status).toBe(200);
    expect(emptyImages.body.images).toEqual([]);

    const upload = await owner(
      request(app)
        .post(
          `${base}/images/owner-management/projects/${project.body.record.id}`,
        )
        .field("imageType", "site_photo")
        .attach("file", jpeg, {
          filename: "project.jpg",
          contentType: "image/jpeg",
        }),
    );
    expect(upload.status).toBe(503);
    expect(upload.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});
