import crypto from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db, transaction } from "../../config/database";
import {
  provisionOrganizationIn,
  type OrganizationAddress,
} from "../../platform/provisioning/provisioning.service";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import {
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
} from "../../services/notification.service";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../../utils/errors";
import * as repository from "./auth.repository";
import { createNotificationInTransaction } from "../notifications/notifications.service";
import type {
  ActiveMembership,
  AuthenticatedUser,
  IssuedTokens,
  LoginResult,
  RequestContext,
} from "./auth.types";

const BCRYPT_ROUNDS = 12;
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const RESET_TOKEN_TTL_SECONDS = 60 * 60;

const MAX_FAILED_LOGINS = env.auth.maxFailedLogins;
const LOCK_DURATION = `${env.auth.lockDurationSeconds} seconds`;

const TOKEN_ISSUER = "litehubs";
const TOKEN_AUDIENCE = "litehubs-api";

/**
 * Compared against when the email does not exist, so a missing account costs
 * the same time as a wrong password and cannot be detected by timing.
 */
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing-parity", 10);

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/** Opaque tokens are stored as an HMAC, never in the clear. */
function fingerprint(rawToken: string): string {
  return crypto
    .createHmac("sha256", env.refreshTokenSecret)
    .update(rawToken)
    .digest("hex");
}

function generateOpaqueToken(): string {
  return crypto.randomBytes(48).toString("base64url");
}

/**
 * The `org` claim names the workspace this token is for. It is a *default*, not
 * an authority: every request re-checks the membership behind it, so a stale
 * token cannot keep someone inside an organization they were removed from.
 * Roles are not in the token at all — they change per organization and would go
 * stale within the token's lifetime.
 */
function issueAccessToken(
  user: AuthenticatedUser,
  organizationId: string | null,
): { token: string; expiresAt: Date } {
  const token = jwt.sign(
    { email: user.email, org: organizationId },
    env.jwtSecret,
    {
      subject: user.id,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    },
  );
  return {
    token,
    expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000),
  };
}

/** Verifies signature, issuer and audience. Throws on anything suspect. */
export function verifyAccessToken(token: string): {
  userId: string;
  organizationId: string | null;
} {
  try {
    const payload = jwt.verify(token, env.jwtSecret, {
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });

    if (typeof payload === "string" || !payload.sub) {
      throw new UnauthorizedError("Malformed access token");
    }
    const org = (payload as { org?: unknown }).org;
    return {
      userId: payload.sub,
      organizationId: typeof org === "string" && org ? org : null,
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError("Access token has expired", {
        reason: "token_expired",
      });
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new UnauthorizedError("Invalid access token");
    }
    throw error;
  }
}

async function mintTokens(
  user: AuthenticatedUser,
  context: RequestContext,
): Promise<IssuedTokens> {
  const access = issueAccessToken(
    user,
    user.activeMembership?.organizationId ?? null,
  );
  const refreshToken = generateOpaqueToken();
  const refreshTokenExpiresAt = new Date(
    Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000,
  );

  await repository.insertRefreshToken({
    userId: user.id,
    tokenHash: fingerprint(refreshToken),
    expiresAt: refreshTokenExpiresAt,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt,
    refreshToken,
    refreshTokenExpiresAt,
  };
}

/**
 * Loads and attaches the caller's standing in one organization.
 *
 * Every entry point into a workspace goes through here — login, refresh,
 * switching, and the per-request middleware — so membership is proved in one
 * place rather than trusted from whatever named the organization.
 */
export async function activateOrganization(
  user: AuthenticatedUser,
  organizationId: string,
): Promise<ActiveMembership> {
  const membership = await repository.findActiveMembership(
    user.id,
    organizationId,
  );

  if (!membership) {
    // Deliberately the same answer for "no such organization" and "not a member
    // of it": the response must not confirm that a workspace exists.
    throw new ForbiddenError("You do not have access to that workspace", {
      reason: "not_a_member",
    });
  }

  user.activeMembership = membership;
  return membership;
}

/** Maps a workspace slug to its id using only what the caller can already see. */
export function organizationIdForSlug(
  user: AuthenticatedUser,
  slug: string,
): string {
  const match = user.memberships.find(
    (membership) => membership.slug === slug.trim().toLowerCase(),
  );
  if (!match) {
    throw new NotFoundError("No such workspace", { slug });
  }
  return match.organizationId;
}

/**
 * Picks the workspace to land in after sign-in. One membership needs no
 * decision, so activating it skips a pointless picker; with several, the client
 * asks and then calls the switch endpoint.
 */
async function activateDefaultOrganization(
  user: AuthenticatedUser,
): Promise<void> {
  const only = user.memberships.length === 1 ? user.memberships[0] : undefined;
  if (only) await activateOrganization(user, only.organizationId);
}

function assertUsable(user: AuthenticatedUser): void {
  if (user.status !== "active") {
    throw new ForbiddenError(
      user.status === "suspended"
        ? "This account is suspended"
        : "This account has been disabled",
      { reason: `account_${user.status}` },
    );
  }
}

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  organization: {
    slug: string;
    legalName: string;
    displayName?: string;
    industryCode?: string | null;
    country?: string | null;
    address?: OrganizationAddress | undefined;
    timezone?: string;
    currency?: string;
  };
}

/**
 * Self-serve signup: a person with no account creates it and their company in
 * one call, and is signed in as the owner.
 *
 * The account and the organization commit together. That matters more than it
 * looks: if they were separate, a slug that turned out to be taken would leave
 * behind an account whose email is now also taken, so the person could neither
 * finish nor start again. Registering twice with a free slug would work; the
 * one case that traps someone is exactly the one that fails.
 */
export async function register(
  input: RegisterInput,
  context: RequestContext,
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);

  const client = await db.connect();
  let userId: string;

  try {
    await client.query("BEGIN");

    // `users` is a platform-plane table with no RLS — a session belongs to a
    // person, not to a company — so this insert needs no organization context.
    const created = await client
      .query<{ id: string }>(
        `INSERT INTO users (email, password_hash, full_name, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING id`,
        [email, passwordHash, input.fullName.trim()],
      )
      .catch((error: unknown) => {
        const pgError = error as { code?: string; constraint?: string };
        if (pgError.code === "23505") {
          // Signup unavoidably reveals that an address is taken; there is no
          // way to offer "create an account" without it. Password reset stays
          // silent, which is where enumeration would actually cost something.
          throw new ConflictError("An account with that email already exists", {
            reason: "email_taken",
          });
        }
        throw error;
      });

    userId = created.rows[0]!.id;

    await provisionOrganizationIn(client, {
      ...input.organization,
      ownerUserId: userId,
    });

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const user = await repository.findAuthenticatedUserById(userId);
  if (!user) {
    // The transaction committed, so this cannot happen from a failed insert.
    throw new AppError(
      "Account was created but could not be loaded",
      500,
      "REGISTRATION_INCOMPLETE",
    );
  }

  await activateDefaultOrganization(user);
  const tokens = await mintTokens(user, context);

  logger.info(
    {
      userId,
      email,
      organizationId: user.activeMembership?.organizationId,
      slug: user.activeMembership?.slug,
    },
    "Company registered",
  );

  // The account and company are already committed. A mail delivery issue must
  // never undo a successful registration or expose a password in an email.
  const welcomeDelivery = await sendWelcomeEmail(
    email,
    user.fullName,
    undefined,
    user.activeMembership?.displayName ??
      input.organization.displayName ??
      input.organization.legalName,
  );
  if (!welcomeDelivery.sent && !env.isTest) {
    logger.warn(
      { userId, reason: welcomeDelivery.reason },
      "Welcome email was not delivered",
    );
  }

  return { user, ...tokens };
}

export async function login(
  email: string,
  password: string,
  context: RequestContext,
): Promise<LoginResult> {
  const candidate = await repository.findLoginCandidate(email);

  if (!candidate) {
    // Burn the same time a real comparison would take.
    await bcrypt.compare(password, DUMMY_HASH);
    throw new UnauthorizedError("Invalid email or password");
  }

  if (candidate.locked_until && candidate.locked_until > new Date()) {
    throw new AppError(
      "Too many failed attempts. This account is temporarily locked.",
      423,
      "ACCOUNT_LOCKED",
      { lockedUntil: candidate.locked_until.toISOString() },
    );
  }

  const matches = await bcrypt.compare(password, candidate.password_hash);
  if (!matches) {
    const { attempts, lockedUntil } = await repository.recordFailedLogin(
      candidate.id,
      MAX_FAILED_LOGINS,
      LOCK_DURATION,
    );
    logger.warn(
      { userId: candidate.id, attempts, locked: lockedUntil !== null },
      "Failed login",
    );
    throw new UnauthorizedError("Invalid email or password");
  }

  // Status is checked only after the password is proven, so the response does
  // not tell an attacker which emails belong to suspended accounts.
  const user = await repository.findAuthenticatedUserById(candidate.id);
  if (!user) throw new UnauthorizedError("Invalid email or password");
  assertUsable(user);

  await repository.recordSuccessfulLogin(user.id);
  await activateDefaultOrganization(user);
  const tokens = await mintTokens(user, context);

  logger.info(
    {
      userId: user.id,
      workspaces: user.memberships.length,
      activeOrganization: user.activeMembership?.slug ?? null,
    },
    "User signed in",
  );
  return { user, ...tokens };
}

/**
 * Rotates the refresh token. Presenting an already-revoked token means it
 * leaked and is being replayed, so every session for that user is dropped.
 */
export async function refresh(
  rawToken: string,
  context: RequestContext,
  /**
   * The workspace to stay in. Refresh tokens are not tied to an organization —
   * a session belongs to a person — so the client names the one it is currently
   * showing, and membership is re-proved before the new token carries it.
   */
  organizationSlug?: string,
): Promise<LoginResult> {
  const tokenHash = fingerprint(rawToken);

  // Spends the token in a single statement, so a concurrent refresh with the
  // same token loses rather than both succeeding.
  const consumed = await repository.consumeRefreshToken(tokenHash);

  if (!consumed) {
    // Work out *why* it could not be spent. Deliberately outside any
    // transaction: the revocation below must survive the throw that follows.
    const existing = await repository.findRefreshTokenByHash(tokenHash);
    if (!existing) throw new UnauthorizedError("Invalid refresh token");

    if (existing.revoked_at !== null) {
      const revoked = await repository.revokeAllRefreshTokensForUser(
        existing.user_id,
      );
      logger.error(
        { userId: existing.user_id, tokenId: existing.id, revoked },
        "Spent refresh token replayed — every session dropped",
      );
      throw new UnauthorizedError("Refresh token has already been used", {
        reason: "token_reuse",
      });
    }

    throw new UnauthorizedError("Refresh token has expired", {
      reason: "token_expired",
    });
  }

  const user = await repository.findAuthenticatedUserById(consumed.userId);
  if (!user) throw new UnauthorizedError("Invalid refresh token");
  assertUsable(user);

  if (organizationSlug) {
    await activateOrganization(
      user,
      organizationIdForSlug(user, organizationSlug),
    );
  } else {
    await activateDefaultOrganization(user);
  }

  const tokens = await mintTokens(user, context);
  return { user, ...tokens };
}

/**
 * Moves the session to another workspace by re-issuing the access token with a
 * different `org` claim. The refresh token is untouched — it identifies the
 * person, not the workspace, so switching is not a re-authentication.
 */
export async function switchOrganization(
  userId: string,
  slug: string,
): Promise<{
  user: AuthenticatedUser;
  accessToken: string;
  accessTokenExpiresAt: Date;
}> {
  const user = await repository.findAuthenticatedUserById(userId);
  if (!user) throw new UnauthorizedError("Account no longer exists");
  assertUsable(user);

  const membership = await activateOrganization(
    user,
    organizationIdForSlug(user, slug),
  );
  const access = issueAccessToken(user, membership.organizationId);

  logger.info(
    {
      userId,
      organizationId: membership.organizationId,
      slug: membership.slug,
    },
    "Active workspace switched",
  );

  return {
    user,
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt,
  };
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  const existing = await repository.findRefreshTokenByHash(
    fingerprint(rawToken),
  );
  if (existing && existing.revoked_at === null) {
    await repository.revokeRefreshToken(existing.id, null);
  }
}

export async function logoutEverywhere(userId: string): Promise<number> {
  return repository.revokeAllRefreshTokensForUser(userId);
}

export async function getCurrentUser(
  userId: string,
  organizationId?: string | null,
): Promise<AuthenticatedUser> {
  const user = await repository.findAuthenticatedUserById(userId);
  if (!user) throw new UnauthorizedError("Account no longer exists");

  if (organizationId) {
    // A token can outlive the membership it names. Losing access is reported as
    // "no active workspace", not as a failed request, so the client can show
    // the picker instead of logging the user out.
    const membership = await repository.findActiveMembership(
      userId,
      organizationId,
    );
    user.activeMembership = membership ?? null;
  }

  return user;
}

/**
 * Always resolves, whether or not the email is registered — the response must
 * not reveal which addresses have accounts.
 */
export async function requestPasswordReset(
  email: string,
  context: RequestContext,
): Promise<void> {
  const userId = await repository.findActiveUserIdByEmail(email);
  if (!userId) {
    logger.info({ email }, "Password reset requested for unknown email");
    return;
  }

  const rawToken = generateOpaqueToken();
  await repository.insertPasswordResetToken({
    userId,
    tokenHash: fingerprint(rawToken),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_SECONDS * 1000),
    ipAddress: context.ipAddress,
  });

  const resetUrl = `${env.frontendUrl}/reset-password?token=${rawToken}`;

  const result = await sendPasswordResetEmail(
    email,
    resetUrl,
    RESET_TOKEN_TTL_SECONDS / 60,
  );

  // Delivery failure is logged, never surfaced — the response must look the
  // same whether or not the address is registered.
  if (!result.sent) {
    logger.warn(
      { userId, reason: result.reason },
      "Password reset email was not delivered",
    );
    if (!env.isProduction) {
      logger.info({ userId, resetUrl }, "Reset link (development fallback)");
    }
  }
}

export async function resetPassword(
  rawToken: string,
  newPassword: string,
): Promise<void> {
  const tokenHash = fingerprint(rawToken);
  const passwordHash = await hashPassword(newPassword);

  await transaction(async (client) => {
    const record = await repository.findPasswordResetByHash(tokenHash, client);
    if (!record) throw new UnauthorizedError("Invalid reset token");
    if (record.used_at !== null) {
      throw new UnauthorizedError("This reset link has already been used");
    }
    if (record.expires_at <= new Date()) {
      throw new UnauthorizedError("This reset link has expired");
    }

    await repository.updatePassword(record.user_id, passwordHash, client);
    await repository.markPasswordResetUsed(record.id, client);
    // A password change invalidates every existing session.
    await repository.revokeAllRefreshTokensForUser(record.user_id, client);

    logger.info({ userId: record.user_id }, "Password reset completed");
    return record.user_id;
  }).then(async (userId) => {
    // Confirmation goes out only once the reset is committed.
    const email = await repository.findUserEmail(userId);
    if (email) await sendPasswordChangedEmail(email);
  });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const credentials = await repository.findCredentials(userId);
  if (!credentials) throw new UnauthorizedError("Account no longer exists");

  const matches = await bcrypt.compare(
    currentPassword,
    credentials.passwordHash,
  );
  if (!matches) {
    throw new UnauthorizedError("Current password is incorrect");
  }

  const passwordHash = await hashPassword(newPassword);

  await transaction(async (client) => {
    await repository.updatePassword(userId, passwordHash, client);
    await repository.revokeAllRefreshTokensForUser(userId, client);
  });

  logger.info({ userId }, "Password changed");

  // Notify after the change is committed; a mail failure must not undo it.
  await sendPasswordChangedEmail(credentials.email);
}

export const authTokenTtl = {
  accessSeconds: ACCESS_TOKEN_TTL_SECONDS,
  refreshSeconds: REFRESH_TOKEN_TTL_SECONDS,
};

async function notifyActivatedEmployeeAboutContracts(
  client: import("pg").PoolClient,
  organizationId: string,
  userId: string,
) {
  const linkedEmployee = await client.query<{ id: string; member_id: string; province_id: string | null }>(
    `SELECT e.id,e.member_id,e.province_id
       FROM employees e
       JOIN organization_members m ON m.id=e.member_id AND m.organization_id=e.organization_id
      WHERE e.organization_id=$1 AND m.user_id=$2 AND m.status='active'
      LIMIT 1`,
    [organizationId, userId],
  );
  const employee = linkedEmployee.rows[0];
  if (!employee) return;
  const awaitingContracts = await client.query<{ id: string; title: string; reference: string; province_id: string | null; version_id: string }>(
    `SELECT c.id,c.title,c.reference,c.province_id,v.id AS version_id
       FROM contracts c
       JOIN LATERAL (
         SELECT id FROM contract_document_versions
          WHERE organization_id=c.organization_id AND contract_id=c.id
          ORDER BY version_number DESC LIMIT 1
       ) v ON true
      WHERE c.organization_id=$1 AND c.employee_id=$2
        AND c.contract_type='employment'
        AND c.status='awaiting_employee_signature'`,
    [organizationId, employee.id],
  );
  for (const contract of awaitingContracts.rows) {
    await createNotificationInTransaction(client, {
      organizationId,
      recipientMemberId: employee.member_id,
      recipientEmployeeId: employee.id,
      actorUserId: null,
      provinceId: contract.province_id,
      category: "contract",
      type: "contract_signature_requested",
      priority: "high",
      title: "Contract signature required",
      message: `${contract.title} (${contract.reference}) is ready for your secure review and signature.`,
      actionUrl: "/my-account",
      entityType: "contract",
      entityId: contract.id,
      deduplicationKey: `contract-signature-request:${contract.version_id}`,
    });
  }
}

/**
 * A team member can join without first creating their own company. The opaque
 * invitation is verified inside a narrowly scoped database function, and the
 * person account plus membership commit together.
 */
export async function acceptInvitation(
  input: {
    token: string;
    fullName: string;
    email: string;
    password: string;
  },
  context: RequestContext,
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  const tokenHash = fingerprint(input.token);
  const client = await db.connect();
  let userId: string;

  try {
    await client.query("BEGIN");

    const created = await client
      .query<{ id: string }>(
        `INSERT INTO users (email, password_hash, full_name, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING id`,
        [email, passwordHash, input.fullName.trim()],
      )
      .catch((error: unknown) => {
        const pgError = error as { code?: string };
        if (pgError.code === "23505") {
          throw new ConflictError(
            "An account with that email already exists. Sign in with that account to use its assigned access.",
            { reason: "email_taken" },
          );
        }
        throw error;
      });

    userId = created.rows[0]!.id;

    const accepted = await client.query<{
      organization_id: string;
      organization_slug: string;
    }>(
      `SELECT accepted_organization_id AS organization_id,
              accepted_organization_slug AS organization_slug
         FROM accept_organization_invitation($1, $2, $3::citext)`,
      [tokenHash, userId, email],
    );

    if (accepted.rowCount === 0) {
      throw new UnauthorizedError("This access link is invalid or has expired");
    }

    // A contract may have been sent before this employee activated their access.
    await notifyActivatedEmployeeAboutContracts(client, accepted.rows[0]!.organization_id, userId);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const user = await repository.findAuthenticatedUserById(userId);
  if (!user) {
    throw new AppError(
      "Invitation was accepted but the account could not be loaded",
      500,
      "INVITATION_ACCEPTANCE_INCOMPLETE",
    );
  }

  await activateDefaultOrganization(user);
  const tokens = await mintTokens(user, context);

  logger.info(
    { userId, organizationId: user.activeMembership?.organizationId },
    "Company access assignment activated",
  );

  // A successful access activation creates a real user account, so it receives the
  // same welcome email as a newly registered company owner.
  const welcomeDelivery = await sendWelcomeEmail(
    email,
    user.fullName,
    undefined,
    user.activeMembership?.displayName,
  );
  if (!welcomeDelivery.sent && !env.isTest) {
    logger.warn(
      { userId, reason: welcomeDelivery.reason },
      "Welcome email was not delivered",
    );
  }

  return { user, ...tokens };
}

/**
 * An invited person who already has a LiteHubs account proves control of that
 * account by signing in first. The invitation token is still single-use and
 * its email must match the signed-in account inside the database function.
 */
export async function acceptExistingInvitation(
  input: { token: string },
  signedInUser: AuthenticatedUser,
  context: RequestContext,
): Promise<LoginResult> {
  const tokenHash = fingerprint(input.token);
  const client = await db.connect();
  let acceptedOrganizationId: string;
  try {
    await client.query("BEGIN");
    const invitation = await client.query<{ organization_id: string }>(
      `SELECT organization_id FROM organization_invitations
        WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL
          AND expires_at>now() AND email=$2::citext
        FOR UPDATE`,
      [tokenHash, signedInUser.email.toLowerCase()],
    );
    if (!invitation.rowCount)
      throw new UnauthorizedError("This invitation is invalid, expired, already used, or belongs to a different email address");
    const existingMembership = await client.query<{ id: string }>(
      `SELECT id FROM organization_members
        WHERE organization_id=$1 AND user_id=$2 AND status='active'
        LIMIT 1`,
      [invitation.rows[0]!.organization_id, signedInUser.id],
    );
    if (existingMembership.rowCount)
      throw new ConflictError(
        "This LiteHubs account already belongs to this company. Use a different work email for the employee, or link the employee profile from Team and access.",
        { reason: "account_already_in_company" },
      );
    const accepted = await client.query<{ organization_id: string; organization_slug: string }>(
      `SELECT accepted_organization_id AS organization_id,
              accepted_organization_slug AS organization_slug
         FROM accept_organization_invitation($1, $2, $3::citext)`,
      [tokenHash, signedInUser.id, signedInUser.email.toLowerCase()],
    );
    if (!accepted.rowCount)
      throw new UnauthorizedError("This invitation is invalid, expired, already used, or belongs to a different email address");
    acceptedOrganizationId = accepted.rows[0]!.organization_id;
    await notifyActivatedEmployeeAboutContracts(client, acceptedOrganizationId, signedInUser.id);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const user = await repository.findAuthenticatedUserById(signedInUser.id);
  if (!user)
    throw new AppError("The invitation was accepted but the account could not be loaded", 500, "INVITATION_ACCEPTANCE_INCOMPLETE");
  await activateOrganization(user, acceptedOrganizationId);
  const tokens = await mintTokens(user, context);
  logger.info({ userId: user.id, organizationId: acceptedOrganizationId }, "Existing LiteHubs account joined an organization");
  return { user, ...tokens };
}