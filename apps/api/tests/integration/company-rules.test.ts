import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { query } from "../../src/config/database";
import { withTenantContext, withUserContext } from "../../src/utils/tenant-query";

const app = createApp();
const suffix = randomUUID().slice(0, 8);
const password = "SecurePass123";
const ownerEmail = `rules-owner-${suffix}@test.invalid`;
const workerEmail = `rules-worker-${suffix}@test.invalid`;
const organizationSlug = `rules-${suffix}`;

async function clean(address: string) {
  const found = await query<{ id: string }>("SELECT id FROM users WHERE email=$1", [address]);
  const userId = found.rows[0]?.id;
  if (!userId) return;
  const organizations = await withUserContext(userId, async (client) => {
    const result = await client.query<{ organization_id: string }>("SELECT organization_id FROM organization_members WHERE user_id=$1", [userId]);
    return result.rows.map((row) => row.organization_id);
  });
  for (const organizationId of organizations) {
    await withTenantContext({ userId, organizationId }, (client) =>
      client.query("DELETE FROM organizations WHERE id=$1", [organizationId]),
    );
  }
  await query("DELETE FROM users WHERE id=$1", [userId]);
}

afterAll(async () => {
  await clean(ownerEmail);
  await clean(workerEmail);
});

describe("Company rulebook", () => {
  it("keeps old owner-published versions while allowing every member to read the current rulebook", async () => {
    const registered = await request(app).post("/api/v1/auth/register").send({
      fullName: "Rules Owner",
      email: ownerEmail,
      password,
      organization: {
        slug: organizationSlug,
        legalName: "Rules Test SARL",
        displayName: "Rules Test",
        industryCode: "mixed_farm",
        country: "CD",
        currency: "CDF",
      },
    });
    expect(registered.status).toBe(201);
    const owner = (call: request.Test) => call.set("Authorization", `Bearer ${registered.body.accessToken as string}`);
    const base = `/api/v1/organizations/${organizationSlug}`;

    const empty = await owner(request(app).get(`${base}/company-rules`));
    expect(empty.status).toBe(200);
    expect(empty.body.policy).toBeNull();
    const referencePdf = await owner(
      request(app).get(`${base}/company-rules/export.pdf?lang=fr`),
    );
    expect(referencePdf.status).toBe(200);
    if (process.env.LITEHUBS_PDF_DEFAULT_QA_OUTPUT) {
      await mkdir(path.dirname(process.env.LITEHUBS_PDF_DEFAULT_QA_OUTPUT), {
        recursive: true,
      });
      await writeFile(
        process.env.LITEHUBS_PDF_DEFAULT_QA_OUTPUT,
        referencePdf.body,
      );
    }

    const first = await owner(request(app).put(`${base}/company-rules`).send({
      title: "Règlement Congo Omega",
      content: "Première règle officielle pour protéger les personnes, les animaux, les stocks et les finances de l’entreprise.",
      changeNote: "Première version officielle",
    }));
    expect(first.status).toBe(201);
    expect(first.body.policy.versionNumber).toBe(1);

    const second = await owner(request(app).put(`${base}/company-rules`).send({
      title: "Règlement Congo Omega",
      content: "Deuxième règle officielle pour protéger les personnes, les animaux, les stocks, les équipements et les finances de l’entreprise.",
      changeNote: "Ajout des règles équipements",
    }));
    expect(second.status).toBe(201);
    expect(second.body.policy.versionNumber).toBe(2);

    const pdf = await owner(
      request(app).get(`${base}/company-rules/export.pdf?lang=fr`),
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.headers["content-disposition"]).toContain("attachment");
    expect(pdf.body.length).toBeGreaterThan(1_000);
    // Optional visual QA hook. It remains off in normal tests, but lets the
    // PDF workflow render the exact HTTP response without a second generator.
    if (process.env.LITEHUBS_PDF_QA_OUTPUT) {
      await mkdir(path.dirname(process.env.LITEHUBS_PDF_QA_OUTPUT), {
        recursive: true,
      });
      await writeFile(process.env.LITEHUBS_PDF_QA_OUTPUT, pdf.body);
    }

    const history = await owner(request(app).get(`${base}/company-rules/versions`));
    expect(history.status).toBe(200);
    expect(history.body.versions.map((item: { versionNumber: number; status: string }) => [item.versionNumber, item.status])).toEqual([
      [2, "published"],
      [1, "superseded"],
    ]);

    const invitation = await owner(request(app).post(`${base}/invitations`).send({
      email: workerEmail,
      roleCodes: ["employee"],
      provinceIds: [],
    }));
    expect(invitation.status).toBe(201);
    const token = new URL(invitation.body.acceptUrl).searchParams.get("token");
    const accepted = await request(app).post("/api/v1/auth/accept-invitation").send({
      token,
      fullName: "Rules Worker",
      email: workerEmail,
      password,
    });
    expect(accepted.status).toBe(201);
    const worker = (call: request.Test) => call.set("Authorization", `Bearer ${accepted.body.accessToken as string}`);

    const visible = await worker(request(app).get(`${base}/company-rules`));
    expect(visible.status).toBe(200);
    expect(visible.body.policy.versionNumber).toBe(2);
    const denied = await worker(request(app).put(`${base}/company-rules`).send({
      title: "Unauthorized edit",
      content: "This operation must never publish because only an owner can change the official company rulebook.",
    }));
    expect(denied.status).toBe(403);
  });
});
