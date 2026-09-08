import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { query } from "../../src/config/database";
import {
  withTenantContext,
  withUserContext,
} from "../../src/utils/tenant-query";

/**
 * Self-serve signup: a person with no account creates it and their company in
 * one call. The case worth guarding is the failure — see the atomicity test.
 */

const app = createApp();
const suffix = randomUUID().slice(0, 8);

const email = (label: string) => `register-${label}-${suffix}@test.invalid`;
const slug = (label: string) => `register-${label}-${suffix}`;

const PASSWORD = "SecurePass123";

function payload(label: string, overrides: Record<string, unknown> = {}) {
  return {
    fullName: `Register ${label}`,
    email: email(label),
    password: PASSWORD,
    organization: {
      slug: slug(label),
      legalName: `Register ${label} SARL`,
      industryCode: "poultry",
      country: "CD",
      currency: "CDF",
      ...overrides,
    },
  };
}

/** Removes anything a test created, without reaching for an admin connection. */
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

const created: string[] = [];

afterAll(async () => {
  for (const address of created) await cleanUp(address);
});

describe("POST /api/v1/auth/register", () => {
  it("creates the person and their company, and signs them in as owner", async () => {
    created.push(email("happy"));

    const response = await request(app)
      .post("/api/v1/auth/register")
      .send(payload("happy"));

    expect(response.status).toBe(201);
    expect(response.body.organization.slug).toBe(slug("happy"));
    expect(response.body.organization.url).toBe(`/${slug("happy")}/dashboard`);

    const user = response.body.user;
    expect(user.activeOrganization.slug).toBe(slug("happy"));
    expect(user.activeOrganization.isOwner).toBe(true);
    expect(user.roles).toEqual(["owner"]);
    // The owner preset carries the whole organization-plane catalogue.
    expect(user.permissions.length).toBeGreaterThan(400);

    // Signing up must not confer any platform-plane standing.
    expect(user.isPlatformStaff).toBe(false);
    expect(user.platformPermissions).toEqual([]);

    expect(response.body.accessToken).toBeTruthy();
    expect(response.body.refreshToken).toBeTruthy();
  });

  it("stores the company address and reads it back", async () => {
    created.push(email("addr"));

    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send(
        payload("addr", {
          address: {
            addressLine1: "12 Avenue du Commerce",
            addressLine2: "2e étage",
            city: "Goma",
            region: "Nord-Kivu",
            postalCode: "243",
          },
        }),
      );
    expect(registered.status).toBe(201);

    const profile = await request(app)
      .get(`/api/v1/organizations/${slug("addr")}`)
      .set("Authorization", `Bearer ${registered.body.accessToken}`);

    expect(profile.status).toBe(200);
    expect(profile.body.organization.address).toEqual({
      addressLine1: "12 Avenue du Commerce",
      addressLine2: "2e étage",
      city: "Goma",
      region: "Nord-Kivu",
      postalCode: "243",
      country: "CD",
    });
  });

  it("accepts a company with no address at all", async () => {
    created.push(email("noaddr"));

    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send(payload("noaddr"));
    expect(registered.status).toBe(201);

    const profile = await request(app)
      .get(`/api/v1/organizations/${slug("noaddr")}`)
      .set("Authorization", `Bearer ${registered.body.accessToken}`);

    // Absent, not blank: an empty string would print as an empty line on an
    // invoice, so the table refuses it and "not recorded" stays null.
    expect(profile.body.organization.address).toEqual({
      addressLine1: null,
      addressLine2: null,
      city: null,
      region: null,
      postalCode: null,
      country: "CD",
    });
  });

  it("refuses a blank address line rather than storing it", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send(payload("blank", { address: { city: "   " } }));

    expect(response.status).toBe(422);
    expect(
      response.body.error.details.some((issue: { field: string }) =>
        issue.field.includes("city"),
      ),
    ).toBe(true);
  });

  it("leaves no account behind when the workspace address is taken", async () => {
    created.push(email("holder"));

    const first = await request(app)
      .post("/api/v1/auth/register")
      .send(payload("holder"));
    expect(first.status).toBe(201);

    // Someone else wants the same address. Registration must fail whole.
    const collision = await request(app)
      .post("/api/v1/auth/register")
      .send({
        fullName: "Second Comer",
        email: email("collider"),
        password: PASSWORD,
        organization: {
          slug: slug("holder"),
          legalName: "Second Comer SARL",
        },
      });

    expect(collision.status).toBe(409);

    // The point of the single transaction: without it this account would exist,
    // and its owner could then neither finish signing up nor start again,
    // because their email would be taken by the half-finished attempt.
    const orphan = await query("SELECT id FROM users WHERE email = $1", [
      email("collider"),
    ]);
    expect(orphan.rowCount).toBe(0);

    // Which means retrying with a free address works.
    created.push(email("collider"));
    const retry = await request(app)
      .post("/api/v1/auth/register")
      .send(payload("collider", { slug: slug("collider") }));
    expect(retry.status).toBe(201);
  });

  it("refuses an email that already has an account", async () => {
    created.push(email("dup"));

    const first = await request(app)
      .post("/api/v1/auth/register")
      .send(payload("dup"));
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/v1/auth/register")
      .send(payload("dup", { slug: slug("dup-two") }));

    expect(second.status).toBe(409);
    expect(second.body.error.details.reason).toBe("email_taken");

    // And the second attempt's company was not created either.
    const leftover = await query(
      "SELECT id FROM organizations WHERE slug = $1",
      [slug("dup-two")],
    );
    expect(leftover.rowCount).toBe(0);
  });

  it("rejects an industry that is not on offer, and creates nothing", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send(payload("industry", { industryCode: "spaceflight" }));

    expect(response.status).toBe(400);
    expect(response.body.error.details.available).toContain("poultry");

    const leftover = await query("SELECT id FROM users WHERE email = $1", [
      email("industry"),
    ]);
    expect(leftover.rowCount).toBe(0);
  });

  it("rejects a password that does not meet the policy", async () => {
    const response = await request(app)
      .post("/api/v1/auth/register")
      .send({ ...payload("weak"), password: "abc" });

    expect(response.status).toBe(422);
    expect(
      response.body.error.details.some(
        (issue: { field: string }) => issue.field === "password",
      ),
    ).toBe(true);
  });

  it("does not let a newly registered owner reach another company", async () => {
    created.push(email("nosy"));
    created.push(email("neighbour"));

    const neighbour = await request(app)
      .post("/api/v1/auth/register")
      .send(payload("neighbour"));
    expect(neighbour.status).toBe(201);

    const nosy = await request(app)
      .post("/api/v1/auth/register")
      .send(payload("nosy"));
    expect(nosy.status).toBe(201);

    const probe = await request(app)
      .get(`/api/v1/organizations/${slug("neighbour")}`)
      .set("Authorization", `Bearer ${nosy.body.accessToken}`);

    // 404 rather than 403: a caller must not be able to learn which workspace
    // addresses are in use by probing them.
    expect(probe.status).toBe(404);
  });
  it("adds the Congo Omega province-scoped role foundation to a Mixed Farm", async () => {
    created.push(email("congo-roles"));

    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send(payload("congo-roles", { industryCode: "mixed_farm" }));

    expect(registered.status).toBe(201);

    const userId = registered.body.user.id as string;
    const organizationId = registered.body.organization.id as string;
    const codes = [
      "provincial_manager",
      "farm_operations_manager",
      "poultry_supervisor",
      "pig_supervisor",
      "agriculture_supervisor",
    ];

    const roles = await withTenantContext(
      { userId, organizationId },
      (client) =>
        client.query<{ code: string; data_scope: string }>(
          "SELECT code, data_scope FROM roles WHERE code = ANY($1::text[])",
          [codes],
        ),
    );
    const scopeByCode = Object.fromEntries(
      roles.rows.map((role) => [role.code, role.data_scope]),
    );

    expect(scopeByCode).toMatchObject({
      provincial_manager: "province",
      farm_operations_manager: "organization",
      poultry_supervisor: "province",
      pig_supervisor: "province",
      agriculture_supervisor: "province",
    });

    const provincialPermissions = await withTenantContext(
      { userId, organizationId },
      (client) =>
        client.query<{ code: string }>(
          `SELECT p.code
             FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
             JOIN permissions p ON p.id = rp.permission_id
            WHERE r.code = 'provincial_manager'`,
        ),
    );
    const grants = provincialPermissions.rows.map(
      (permission) => permission.code,
    );

    expect(grants).toContain("poultry.flocks.read");
    expect(grants).toContain("pigs.animals.read");
    expect(grants).toContain("agriculture.crops.read");
    expect(grants).not.toContain("finance.accounts.read");
  });
});
