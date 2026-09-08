import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query } from "../../src/config/database";
import { provisionOrganization } from "../../src/platform/provisioning/provisioning.service";
import {
  setRequestContext,
  withTenantContext,
  withUserContext,
} from "../../src/utils/tenant-query";
import { db } from "../../src/config/database";

/**
 * The isolation contract from structure.md §4: two organizations, real rows in
 * both, and each must see only its own — through list, detail-by-id, update and
 * delete alike.
 *
 * These run against the same helpers production uses, as the same least-
 * privilege role, so a policy that is wrong here is wrong in the product.
 */

interface Tenant {
  organizationId: string;
  slug: string;
  ownerUserId: string;
  roleId: string;
}

const suffix = randomUUID().slice(0, 8);

async function createUser(label: string): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name, status)
     VALUES ($1, 'x-not-a-real-hash', $2, 'active')
     RETURNING id`,
    [`tenancy-${label}-${suffix}@test.invalid`, `Tenancy ${label}`],
  );
  return result.rows[0]!.id;
}

async function createTenant(label: string): Promise<Tenant> {
  const ownerUserId = await createUser(label);
  const slug = `tenancy-${label}-${suffix}`;

  const provisioned = await provisionOrganization({
    slug,
    legalName: `Tenancy ${label}`,
    industryCode: null,
    ownerUserId,
  });

  // A row that only this organization should ever see, named after its owner so
  // a leak is unmistakable in the assertion output.
  const role = await withTenantContext(
    { userId: ownerUserId, organizationId: provisioned.organizationId },
    (client) =>
      client.query<{ id: string }>(
        `INSERT INTO roles (organization_id, code, name, level)
         VALUES ($1, $2, $3, 500)
         RETURNING id`,
        [provisioned.organizationId, `secret_${label}`, `Secret ${label}`],
      ),
  );

  return {
    organizationId: provisioned.organizationId,
    slug,
    ownerUserId,
    roleId: role.rows[0]!.id,
  };
}

let alpha: Tenant;
let beta: Tenant;

beforeAll(async () => {
  alpha = await createTenant("alpha");
  beta = await createTenant("beta");
});

afterAll(async () => {
  // Cleanup runs as the app role with no organization pinned, so RLS would hide
  // the rows from a DELETE. Reaching for the admin connection here would prove
  // nothing about the product, so the delete is scoped per organization instead.
  for (const tenant of [alpha, beta]) {
    if (!tenant) continue;
    await withTenantContext(
      { userId: tenant.ownerUserId, organizationId: tenant.organizationId },
      (client) =>
        client.query("DELETE FROM organizations WHERE id = $1", [
          tenant.organizationId,
        ]),
    );
    await query("DELETE FROM users WHERE id = $1", [tenant.ownerUserId]);
  }
});

describe("organization isolation", () => {
  it("provisions two distinct organizations", () => {
    expect(alpha.organizationId).not.toBe(beta.organizationId);
    expect(alpha.roleId).not.toBe(beta.roleId);
  });

  it("hides the other tenant's rows from an unqualified list", async () => {
    const codes = await withTenantContext(
      { userId: alpha.ownerUserId, organizationId: alpha.organizationId },
      async (client) => {
        // Deliberately no WHERE organization_id — this is the forgotten-clause
        // case that RLS exists to catch.
        const result = await client.query<{ code: string }>(
          "SELECT code FROM roles",
        );
        return result.rows.map((row) => row.code);
      },
    );

    expect(codes).toContain("secret_alpha");
    expect(codes).not.toContain("secret_beta");
  });

  it("returns nothing for a detail-by-id read across tenants", async () => {
    const found = await withTenantContext(
      { userId: alpha.ownerUserId, organizationId: alpha.organizationId },
      async (client) => {
        const result = await client.query(
          "SELECT id, code FROM roles WHERE id = $1",
          [beta.roleId],
        );
        return result.rowCount;
      },
    );

    expect(found).toBe(0);
  });

  it("cannot update the other tenant's row", async () => {
    const updated = await withTenantContext(
      { userId: alpha.ownerUserId, organizationId: alpha.organizationId },
      async (client) => {
        const result = await client.query(
          "UPDATE roles SET name = 'hijacked' WHERE id = $1",
          [beta.roleId],
        );
        return result.rowCount;
      },
    );

    expect(updated).toBe(0);

    // And the row is genuinely untouched, not merely reported as unaffected.
    const name = await withTenantContext(
      { userId: beta.ownerUserId, organizationId: beta.organizationId },
      async (client) => {
        const result = await client.query<{ name: string }>(
          "SELECT name FROM roles WHERE id = $1",
          [beta.roleId],
        );
        return result.rows[0]?.name;
      },
    );
    expect(name).toBe("Secret beta");
  });

  it("cannot delete the other tenant's row", async () => {
    const deleted = await withTenantContext(
      { userId: alpha.ownerUserId, organizationId: alpha.organizationId },
      async (client) => {
        const result = await client.query("DELETE FROM roles WHERE id = $1", [
          beta.roleId,
        ]);
        return result.rowCount;
      },
    );

    expect(deleted).toBe(0);
  });

  it("refuses to write a row stamped with another tenant's id", async () => {
    await expect(
      withTenantContext(
        { userId: alpha.ownerUserId, organizationId: alpha.organizationId },
        (client) =>
          client.query(
            `INSERT INTO roles (organization_id, code, name, level)
             VALUES ($1, 'smuggled', 'Smuggled', 500)`,
            [beta.organizationId],
          ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("shows a user only their own memberships, in every tenant", async () => {
    const rows = await withUserContext(alpha.ownerUserId, async (client) => {
      const result = await client.query<{ organization_id: string }>(
        "SELECT organization_id FROM organization_members",
      );
      return result.rows.map((row) => row.organization_id);
    });

    expect(rows).toContain(alpha.organizationId);
    expect(rows).not.toContain(beta.organizationId);
  });

  it("sees no tenant rows at all when no organization is pinned", async () => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      // The state a pooled connection is in before any middleware runs. It must
      // fail closed — no rows — rather than open.
      await setRequestContext(client, { userId: null, organizationId: null });

      const roles = await client.query("SELECT id FROM roles");
      const members = await client.query("SELECT id FROM organization_members");
      const organizations = await client.query("SELECT id FROM organizations");

      expect(roles.rowCount).toBe(0);
      expect(members.rowCount).toBe(0);
      expect(organizations.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("keeps no context on a connection returned to the pool", async () => {
    await withTenantContext(
      { userId: alpha.ownerUserId, organizationId: alpha.organizationId },
      (client) => client.query("SELECT 1"),
    );

    // set_config(..., true) is transaction-local, so the next borrower of that
    // same pooled connection must start with nothing pinned.
    const leaked = await query<{ organization_id: string | null }>(
      "SELECT current_organization_id() AS organization_id",
    );
    expect(leaked.rows[0]?.organization_id).toBeNull();
  });
});
