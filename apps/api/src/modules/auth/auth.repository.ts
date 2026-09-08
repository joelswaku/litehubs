import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { query } from "../../config/database";
import { withTenantContext, withUserContext } from "../../utils/tenant-query";
import type {
  ActiveMembership,
  AuthenticatedUser,
  MemberStatus,
  Membership,
  UserStatus,
} from "./auth.types";

/**
 * Every write here can either run standalone or join a caller's transaction —
 * password reset, for example, must revoke tokens and set the hash atomically.
 */
export type Queryable = Pool | PoolClient;

async function run<T extends QueryResultRow = QueryResultRow>(
  client: Queryable | undefined,
  text: string,
  params?: readonly unknown[],
): Promise<QueryResult<T>> {
  if (client) return client.query<T>(text, params as unknown[] | undefined);
  // Falls back to the pool wrapper, which adds slow-query logging.
  return query<T>(text, params);
}

/** Row shape for the login path only — carries the password hash. */
export interface LoginCandidateRow {
  id: string;
  email: string;
  password_hash: string;
  status: UserStatus;
  failed_login_attempts: number;
  locked_until: Date | null;
}

interface IdentityRow {
  id: string;
  email: string;
  full_name: string;
  status: UserStatus;
  must_change_password: boolean;
  platform_roles: string[];
  platform_permissions: string[];
}

interface MembershipRow {
  member_id: string;
  status: MemberStatus;
  is_owner: boolean;
  organization_id: string;
  slug: string;
  display_name: string;
}

interface ActiveMembershipRow extends MembershipRow {
  roles: string[];
  permissions: string[];
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface PasswordResetRow {
  id: string;
  user_id: string;
  expires_at: Date;
  used_at: Date | null;
}

function toMembership(row: MembershipRow): Membership {
  return {
    organizationId: row.organization_id,
    slug: row.slug,
    displayName: row.display_name,
    memberId: row.member_id,
    status: row.status,
    isOwner: row.is_owner,
  };
}

/**
 * Identity plus the *platform* plane only. Organization roles are deliberately
 * absent: they hang off a membership, not off the user, so there is no such
 * thing as this person's roles without naming an organization first.
 *
 * FILTER keeps the arrays empty rather than [null] for the ordinary customer
 * who holds no platform grants at all.
 */
const IDENTITY_SELECT = `
  SELECT u.id,
         u.email,
         u.full_name,
         u.status,
         u.must_change_password,
         COALESCE(array_agg(DISTINCT pr.code)
                  FILTER (WHERE pr.code IS NOT NULL), '{}') AS platform_roles,
         COALESCE(array_agg(DISTINCT pp.code)
                  FILTER (WHERE pp.code IS NOT NULL), '{}') AS platform_permissions
  FROM users u
  LEFT JOIN user_platform_roles upr       ON upr.user_id = u.id
  LEFT JOIN platform_roles pr             ON pr.id = upr.platform_role_id
  LEFT JOIN platform_role_permissions prp ON prp.platform_role_id = pr.id
  LEFT JOIN platform_permissions pp       ON pp.id = prp.platform_permission_id
`;

/**
 * The workspaces this person may enter.
 *
 * Runs under user context, not organization context: no organization has been
 * chosen yet. That is exactly what the `user_id = current_user_id()` leg of the
 * membership_visibility policy exists for — it lets you see your own rows in
 * every tenant and nobody else's in any of them.
 */
export async function findMemberships(userId: string): Promise<Membership[]> {
  return withUserContext(userId, async (client) => {
    const result = await client.query<MembershipRow>(
      `SELECT m.id AS member_id,
              m.status,
              m.is_owner,
              o.id AS organization_id,
              o.slug,
              o.display_name
         FROM organization_members m
         JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = $1
          AND m.status = 'active'
          AND o.status <> 'archived'
        ORDER BY o.display_name`,
      [userId],
    );
    return result.rows.map(toMembership);
  });
}

/**
 * The caller's standing inside one organization: their membership plus every
 * permission their roles there grant them.
 *
 * Returns undefined when they are not an active member, which is the same
 * answer a non-existent organization gives — a caller cannot tell the two
 * apart, so this does not leak which slugs are taken.
 */
export async function findActiveMembership(
  userId: string,
  organizationId: string,
): Promise<ActiveMembership | undefined> {
  return withTenantContext({ userId, organizationId }, async (client) => {
    const result = await client.query<ActiveMembershipRow>(
      `SELECT m.id AS member_id,
              m.status,
              m.is_owner,
              o.id AS organization_id,
              o.slug,
              o.display_name,
              COALESCE(array_agg(DISTINCT r.code)
                       FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
              COALESCE(array_agg(DISTINCT p.code)
                       FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
         FROM organization_members m
         JOIN organizations o
           ON o.id = m.organization_id
         LEFT JOIN member_roles mr
           ON mr.organization_id = m.organization_id AND mr.member_id = m.id
         LEFT JOIN roles r
           ON r.organization_id = mr.organization_id AND r.id = mr.role_id
         LEFT JOIN role_permissions rp
           ON rp.organization_id = r.organization_id AND rp.role_id = r.id
         LEFT JOIN permissions p
           ON p.id = rp.permission_id
        WHERE m.user_id = $1
          AND m.organization_id = $2
          AND m.status = 'active'
        GROUP BY m.id, m.status, m.is_owner, o.id, o.slug, o.display_name`,
      [userId, organizationId],
    );

    const row = result.rows[0];
    if (!row) return undefined;

    return {
      ...toMembership(row),
      roles: row.roles,
      permissions: row.permissions,
    };
  });
}

export async function findLoginCandidate(
  email: string,
): Promise<LoginCandidateRow | undefined> {
  const result = await query<LoginCandidateRow>(
    `SELECT id, email, password_hash, status, failed_login_attempts, locked_until
       FROM users
      WHERE email = $1`,
    [email],
  );
  return result.rows[0];
}

/**
 * Loads the caller for a request: who they are, what they may do on the
 * platform plane, and which workspaces they can enter.
 *
 * `activeMembership` is left null here on purpose. Which organization a request
 * is acting on is decided by the URL, a header or the token claim — resolving
 * it is the organization middleware's job, and most routes never need it.
 */
export async function findAuthenticatedUserById(
  id: string,
  options: { withMemberships?: boolean } = {},
): Promise<AuthenticatedUser | undefined> {
  const result = await query<IdentityRow>(
    `${IDENTITY_SELECT} WHERE u.id = $1 GROUP BY u.id`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return undefined;

  // Skipped for callers that only need the identity check, so the common
  // authenticated request stays at one query.
  const memberships =
    options.withMemberships === false ? [] : await findMemberships(id);

  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    status: row.status,
    mustChangePassword: row.must_change_password,
    platformRoles: row.platform_roles,
    platformPermissions: row.platform_permissions,
    memberships,
    activeMembership: null,
  };
}

/** Returns the attempt count after incrementing, and any lock applied. */
export async function recordFailedLogin(
  userId: string,
  maxAttempts: number,
  lockDuration: string,
): Promise<{ attempts: number; lockedUntil: Date | null }> {
  const result = await query<{
    failed_login_attempts: number;
    locked_until: Date | null;
  }>(
    `UPDATE users
        SET failed_login_attempts = failed_login_attempts + 1,
            locked_until = CASE
              WHEN failed_login_attempts + 1 >= $2 THEN now() + $3::interval
              ELSE locked_until
            END
      WHERE id = $1
      RETURNING failed_login_attempts, locked_until`,
    [userId, maxAttempts, lockDuration],
  );
  const row = result.rows[0];
  return {
    attempts: row?.failed_login_attempts ?? 0,
    lockedUntil: row?.locked_until ?? null,
  };
}

export async function recordSuccessfulLogin(userId: string): Promise<void> {
  await query(
    `UPDATE users
        SET failed_login_attempts = 0,
            locked_until = NULL,
            last_login_at = now()
      WHERE id = $1`,
    [userId],
  );
}

export async function insertRefreshToken(
  input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
  },
  client?: Queryable,
): Promise<string> {
  const result = await run<{ id: string }>(
    client,
    `INSERT INTO refresh_tokens
       (user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      input.userId,
      input.tokenHash,
      input.expiresAt,
      input.ipAddress,
      input.userAgent,
    ],
  );
  // RETURNING on a successful INSERT always yields a row.
  return result.rows[0]!.id;
}

/**
 * Atomically spends a refresh token: revokes it and returns its owner, but only
 * if it was still live. Two concurrent refreshes with the same token cannot
 * both win, because only one UPDATE can match `revoked_at IS NULL`.
 *
 * Returns undefined when the token is unknown, already spent, or expired — the
 * caller then works out which, to distinguish replay from simple expiry.
 */
export async function consumeRefreshToken(
  tokenHash: string,
  client?: Queryable,
): Promise<{ id: string; userId: string } | undefined> {
  const result = await run<{ id: string; user_id: string }>(
    client,
    `UPDATE refresh_tokens
        SET revoked_at = now()
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND expires_at > now()
      RETURNING id, user_id`,
    [tokenHash],
  );
  const row = result.rows[0];
  return row ? { id: row.id, userId: row.user_id } : undefined;
}

export async function findRefreshTokenByHash(
  tokenHash: string,
  client?: Queryable,
): Promise<RefreshTokenRow | undefined> {
  const result = await run<RefreshTokenRow>(
    client,
    `SELECT id, user_id, expires_at, revoked_at
       FROM refresh_tokens
      WHERE token_hash = $1`,
    [tokenHash],
  );
  return result.rows[0];
}

export async function revokeRefreshToken(
  id: string,
  replacedById: string | null,
  client?: Queryable,
): Promise<void> {
  await run(
    client,
    `UPDATE refresh_tokens
        SET revoked_at = now(), replaced_by_id = $2
      WHERE id = $1 AND revoked_at IS NULL`,
    [id, replacedById],
  );
}

/** Used on logout-everywhere, password change, and replay detection. */
export async function revokeAllRefreshTokensForUser(
  userId: string,
  client?: Queryable,
): Promise<number> {
  const result = await run(
    client,
    `UPDATE refresh_tokens
        SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  return result.rowCount ?? 0;
}

export async function findActiveUserIdByEmail(
  email: string,
): Promise<string | undefined> {
  const result = await query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1 AND status = 'active'",
    [email],
  );
  return result.rows[0]?.id;
}

export async function insertPasswordResetToken(input: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  ipAddress: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO password_reset_tokens
       (user_id, token_hash, expires_at, ip_address)
     VALUES ($1, $2, $3, $4)`,
    [input.userId, input.tokenHash, input.expiresAt, input.ipAddress],
  );
}

export async function findPasswordResetByHash(
  tokenHash: string,
  client?: Queryable,
): Promise<PasswordResetRow | undefined> {
  const result = await run<PasswordResetRow>(
    client,
    `SELECT id, user_id, expires_at, used_at
       FROM password_reset_tokens
      WHERE token_hash = $1`,
    [tokenHash],
  );
  return result.rows[0];
}

export async function markPasswordResetUsed(
  id: string,
  client?: Queryable,
): Promise<void> {
  await run(
    client,
    "UPDATE password_reset_tokens SET used_at = now() WHERE id = $1",
    [id],
  );
}

export async function findCredentials(
  userId: string,
): Promise<{ email: string; passwordHash: string } | undefined> {
  const result = await query<{ email: string; password_hash: string }>(
    "SELECT email, password_hash FROM users WHERE id = $1",
    [userId],
  );
  const row = result.rows[0];
  return row
    ? { email: row.email, passwordHash: row.password_hash }
    : undefined;
}

export async function findUserEmail(
  userId: string,
): Promise<string | undefined> {
  const result = await query<{ email: string }>(
    "SELECT email FROM users WHERE id = $1",
    [userId],
  );
  return result.rows[0]?.email;
}

export async function updatePassword(
  userId: string,
  passwordHash: string,
  client?: Queryable,
): Promise<void> {
  await run(
    client,
    `UPDATE users
        SET password_hash = $2,
            must_change_password = false,
            failed_login_attempts = 0,
            locked_until = NULL
      WHERE id = $1`,
    [userId, passwordHash],
  );
}
