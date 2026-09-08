import bcrypt from "bcrypt";
import { query } from "../../config/database";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../utils/errors";
import type {
  CreateStaffUserInput,
  UpdateStaffRolesInput,
} from "./platform-staff.validation";

const BCRYPT_ROUNDS = 12;
const SYSTEM_ROLE_CODES = [
  "platform_super_admin",
  "platform_admin",
  "platform_support",
  "platform_billing",
] as const;

type StaffRow = {
  id: string;
  email: string;
  full_name: string;
  status: "active" | "suspended" | "disabled";
  must_change_password: boolean;
  last_login_at: Date | null;
  created_at: Date;
  roles: string[];
};

function toStaff(row: StaffRow) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    status: row.status,
    mustChangePassword: row.must_change_password,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    roles: row.roles,
  };
}

const STAFF_SELECT = `
  SELECT u.id, u.email, u.full_name, u.status, u.must_change_password,
         u.last_login_at, u.created_at,
         COALESCE(array_agg(DISTINCT pr.code)
                  FILTER (WHERE pr.code IS NOT NULL), '{}') AS roles
    FROM users u
    JOIN user_platform_roles upr ON upr.user_id = u.id
    JOIN platform_roles pr ON pr.id = upr.platform_role_id
   GROUP BY u.id`;

export async function listPlatformRoles() {
  const result = await query<{
    code: string;
    name: string;
    description: string | null;
    level: number;
    permission_codes: string[];
  }>(
    `SELECT pr.code, pr.name, pr.description, pr.level,
            COALESCE(array_agg(pp.code ORDER BY pp.code)
                     FILTER (WHERE pp.code IS NOT NULL), '{}') AS permission_codes
       FROM platform_roles pr
       LEFT JOIN platform_role_permissions prp
         ON prp.platform_role_id = pr.id
       LEFT JOIN platform_permissions pp ON pp.id = prp.platform_permission_id
      WHERE pr.code = ANY($1::text[])
      GROUP BY pr.id
      ORDER BY pr.level`,
    [SYSTEM_ROLE_CODES],
  );
  return result.rows.map((row) => ({
    code: row.code,
    name: row.name,
    description: row.description,
    level: row.level,
    permissionCodes: row.permission_codes,
  }));
}

export async function listPlatformStaff() {
  const result = await query<StaffRow>(
    `${STAFF_SELECT} ORDER BY u.full_name, u.email`,
  );
  return result.rows.map(toStaff);
}

async function roleIds(codes: readonly string[]) {
  const result = await query<{ id: string; code: string }>(
    `SELECT id, code FROM platform_roles WHERE code = ANY($1::text[])`,
    [codes],
  );
  if (result.rows.length !== new Set(codes).size) {
    throw new BadRequestError("One or more LiteHubs staff roles are unknown");
  }
  return result.rows;
}

export async function createPlatformStaff(input: CreateStaffUserInput) {
  const roles = await roleIds(input.roles);
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const user = await query<StaffRow>(
    `INSERT INTO users
       (email, password_hash, full_name, status, must_change_password)
     VALUES ($1, $2, $3, 'active', true)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, full_name, status, must_change_password,
               last_login_at, created_at, '{}'::text[] AS roles`,
    [input.email, passwordHash, input.fullName],
  );
  if (!user.rows[0]) {
    throw new ConflictError("An account with that email already exists", {
      reason: "email_taken",
    });
  }

  await query(
    `INSERT INTO user_platform_roles (user_id, platform_role_id)
     SELECT $1, id FROM platform_roles WHERE id = ANY($2::uuid[])`,
    [user.rows[0].id, roles.map((role) => role.id)],
  );
  return getPlatformStaff(user.rows[0].id);
}

export async function getPlatformStaff(userId: string) {
  const result = await query<StaffRow>(`${STAFF_SELECT} HAVING u.id = $1`, [
    userId,
  ]);
  const row = result.rows[0];
  if (!row) throw new NotFoundError("LiteHubs staff account not found");
  return toStaff(row);
}

async function ensureAnotherSuperAdmin(
  userId: string,
  requestedRoleCodes: readonly string[],
): Promise<void> {
  if (requestedRoleCodes.includes("platform_super_admin")) return;
  const result = await query<{ count: string }>(
    `SELECT count(DISTINCT upr.user_id)::text AS count
       FROM user_platform_roles upr
       JOIN platform_roles pr ON pr.id = upr.platform_role_id
      WHERE pr.code = 'platform_super_admin'
        AND upr.user_id <> $1`,
    [userId],
  );
  if (Number(result.rows[0]?.count ?? 0) === 0) {
    throw new BadRequestError(
      "LiteHubs must always keep at least one Platform Super Admin",
    );
  }
}

export async function replacePlatformStaffRoles(
  actorId: string,
  userId: string,
  input: UpdateStaffRolesInput,
) {
  if (actorId === userId) {
    throw new BadRequestError(
      "You cannot change your own LiteHubs staff roles",
    );
  }
  await getPlatformStaff(userId);
  await ensureAnotherSuperAdmin(userId, input.roles);
  const roles = await roleIds(input.roles);
  await query("DELETE FROM user_platform_roles WHERE user_id = $1", [userId]);
  await query(
    `INSERT INTO user_platform_roles (user_id, platform_role_id, assigned_by)
     SELECT $1, id, $2 FROM platform_roles WHERE id = ANY($3::uuid[])`,
    [userId, actorId, roles.map((role) => role.id)],
  );
  return getPlatformStaff(userId);
}

export async function updatePlatformStaffStatus(
  actorId: string,
  userId: string,
  status: "active" | "suspended" | "disabled",
) {
  if (actorId === userId) {
    throw new BadRequestError("You cannot change your own account status");
  }
  if (status !== "active") await ensureAnotherSuperAdmin(userId, []);
  const result = await query<StaffRow>(
    `UPDATE users SET status = $2 WHERE id = $1
      RETURNING id, email, full_name, status, must_change_password,
                last_login_at, created_at, '{}'::text[] AS roles`,
    [userId, status],
  );
  if (!result.rows[0])
    throw new NotFoundError("LiteHubs staff account not found");
  return getPlatformStaff(userId);
}
