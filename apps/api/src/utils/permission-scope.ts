/**
 * Data scope of a member FOR A GIVEN FAMILY OF PERMISSIONS.
 *
 * A member often holds several roles (e.g. « Ouvrier porcin » with self scope
 * and « Responsable réseaux sociaux » with organisation scope). The scope that
 * applies to a module must come only from the roles that actually grant that
 * module's permissions — never from an unrelated role. Otherwise one wide role
 * would silently widen every other role of the same person.
 *
 *   const scope = await permissionScope(client, context, ["pigs."]);
 *
 * `families` are permission prefixes ("pigs.", "employees.") or exact codes
 * ("documents.read"). The widest scope among the matching roles wins.
 */
import type { PoolClient } from "pg";

export type DataScope = "organization" | "province" | "project" | "self";

const RANK: Record<DataScope, number> = { organization: 3, province: 2, project: 1, self: 0 };

export type ScopeContext = { organizationId: string; memberId: string | null | undefined; isOwner?: boolean };

export async function permissionScope(client: PoolClient, context: ScopeContext, families: string[]): Promise<DataScope> {
  if (context.isOwner) return "organization";
  if (!context.memberId) return "self";
  const exact = families.filter((family) => !family.endsWith("."));
  const prefixes = families.filter((family) => family.endsWith(".")).map((family) => `${family.replace(/[\\%_]/g, "\\$&")}%`);
  const result = await client.query<{ data_scope: DataScope }>(
    `SELECT DISTINCT r.data_scope
       FROM member_roles mr
       JOIN roles r ON r.organization_id = mr.organization_id AND r.id = mr.role_id
       JOIN role_permissions rp ON rp.organization_id = r.organization_id AND rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE mr.organization_id = $1 AND mr.member_id = $2
        AND (p.code = ANY($3::text[]) OR p.code LIKE ANY($4::text[]))`,
    [context.organizationId, context.memberId, exact, prefixes],
  );
  let best: DataScope = "self";
  for (const row of result.rows) if (RANK[row.data_scope] > RANK[best]) best = row.data_scope;
  return best;
}

/** True when the member reaches the whole organisation for these permissions. */
export async function hasOrganizationScope(client: PoolClient, context: ScopeContext, families: string[]) {
  return (await permissionScope(client, context, families)) === "organization";
}
