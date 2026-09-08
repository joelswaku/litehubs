import type { CookieOptions, Request, RequestHandler, Response } from "express";
import { env } from "../../config/env";
import { ForbiddenError, UnauthorizedError } from "../../utils/errors";
import * as authService from "./auth.service";
import type { AuthenticatedUser, IssuedTokens } from "./auth.types";
import type { RegisterInput } from "./auth.validation";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

function cookieBase(): CookieOptions {
  return {
    httpOnly: true,
    // Only require HTTPS in production, otherwise local dev cannot log in.
    secure: env.isProduction,
    // 'lax' still sends the cookie for same-site XHR; ports do not affect
    // same-site, so localhost:3000 -> localhost:5000 works.
    sameSite: "lax",
  };
}

function setAuthCookies(res: Response, tokens: IssuedTokens): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...cookieBase(),
    path: "/",
    maxAge: authService.authTokenTtl.accessSeconds * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...cookieBase(),
    // Scoped to the auth routes — no other endpoint needs to see it.
    path: "/api/v1/auth",
    maxAge: authService.authTokenTtl.refreshSeconds * 1000,
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...cookieBase(), path: "/" });
  res.clearCookie(REFRESH_COOKIE, {
    ...cookieBase(),
    path: "/api/v1/auth",
  });
}

function contextOf(req: Request) {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

/**
 * The client needs three separable things: who this is, which workspaces they
 * can enter, and what they may do in the one they are currently in. Keeping
 * them apart in the payload is what stops the frontend from treating a role in
 * one organization as a role everywhere.
 */
function publicUser(user: AuthenticatedUser) {
  const active = user.activeMembership;

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    platformRoles: user.platformRoles,
    platformPermissions: user.platformPermissions,
    isPlatformStaff: user.platformRoles.length > 0,
    organizations: user.memberships.map((membership) => ({
      id: membership.organizationId,
      slug: membership.slug,
      displayName: membership.displayName,
      isOwner: membership.isOwner,
    })),
    activeOrganization: active
      ? {
          id: active.organizationId,
          slug: active.slug,
          displayName: active.displayName,
          isOwner: active.isOwner,
        }
      : null,
    /** Scoped to activeOrganization; empty until a workspace is chosen. */
    roles: active?.roles ?? [],
    permissions: active?.permissions ?? [],
  };
}

/** Signup: creates the person, their company, and signs them in as owner. */
export const register: RequestHandler = async (req, res) => {
  const input = req.body as RegisterInput;
  const result = await authService.register(input, contextOf(req));

  setAuthCookies(res, result);
  res.status(201).json({
    user: publicUser(result.user),
    organization: result.user.activeMembership
      ? {
          id: result.user.activeMembership.organizationId,
          slug: result.user.activeMembership.slug,
          displayName: result.user.activeMembership.displayName,
          url: `/${result.user.activeMembership.slug}/dashboard`,
        }
      : null,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: result.accessTokenExpiresAt.toISOString(),
  });
};

/** Company entrance. A platform staff member who also belongs to a company may
 * use this entrance; the web app deliberately sends this login to their
 * workspace, while /auth/staff-login sends the same person to /platform. */
/** Accept a company invitation using the authenticated account already tied to its email. */
export const acceptExistingInvitation: RequestHandler = async (req, res) => {
  const result = await authService.acceptExistingInvitation(
    req.body as { token: string },
    req.user!,
    contextOf(req),
  );
  setAuthCookies(res, result);
  res.json({
    user: publicUser(result.user),
    organization: result.user.activeMembership
      ? {
          id: result.user.activeMembership.organizationId,
          slug: result.user.activeMembership.slug,
          displayName: result.user.activeMembership.displayName,
          url: `/${result.user.activeMembership.slug}/dashboard`,
        }
      : null,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: result.accessTokenExpiresAt.toISOString(),
  });
};

export const login: RequestHandler = async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  const result = await authService.login(email, password, contextOf(req));

  setAuthCookies(res, result);
  res.json({
    user: publicUser(result.user),
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: result.accessTokenExpiresAt.toISOString(),
  });
};

/** Dedicated platform entrance. Ordinary company accounts cannot use it. */
export const staffLogin: RequestHandler = async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  const result = await authService.login(email, password, contextOf(req));

  if (result.user.platformRoles.length === 0) {
    await authService.logout(result.refreshToken);
    throw new ForbiddenError(
      "This is a company account. Use the company sign-in page.",
      {
        reason: "company_account",
        companyLogin: "/login",
      },
    );
  }

  setAuthCookies(res, result);
  res.json({
    user: publicUser(result.user),
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: result.accessTokenExpiresAt.toISOString(),
  });
};

export const refresh: RequestHandler = async (req, res) => {
  const fromCookie = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  const fromBody = (req.body as { refreshToken?: string } | undefined)
    ?.refreshToken;
  const rawToken = fromCookie ?? fromBody;

  if (!rawToken) {
    throw new UnauthorizedError("No refresh token was provided");
  }

  // The client says which workspace it is showing, so the new access token
  // comes back pointed at the same one.
  const organizationSlug =
    (req.body as { organizationSlug?: string } | undefined)?.organizationSlug ??
    req.get("x-organization-slug") ??
    undefined;

  const result = await authService.refresh(
    rawToken,
    contextOf(req),
    organizationSlug,
  );

  setAuthCookies(res, result);
  res.json({
    user: publicUser(result.user),
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: result.accessTokenExpiresAt.toISOString(),
  });
};

/**
 * Moves the session to another workspace. Only the access token is reissued —
 * the refresh token identifies the person, not the workspace.
 */
export const switchOrganization: RequestHandler = async (req, res) => {
  const { organizationSlug } = req.body as { organizationSlug: string };
  const result = await authService.switchOrganization(
    req.user!.id,
    organizationSlug,
  );

  res.cookie(ACCESS_COOKIE, result.accessToken, {
    ...cookieBase(),
    path: "/",
    maxAge: authService.authTokenTtl.accessSeconds * 1000,
  });

  res.json({
    user: publicUser(result.user),
    accessToken: result.accessToken,
    expiresAt: result.accessTokenExpiresAt.toISOString(),
  });
};

export const logout: RequestHandler = async (req, res) => {
  const fromCookie = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  const fromBody = (req.body as { refreshToken?: string } | undefined)
    ?.refreshToken;

  await authService.logout(fromCookie ?? fromBody);
  clearAuthCookies(res);
  res.status(204).send();
};

export const logoutEverywhere: RequestHandler = async (req, res) => {
  // `authenticate` guarantees req.user on this route.
  const revoked = await authService.logoutEverywhere(req.user!.id);
  clearAuthCookies(res);
  res.json({ revokedSessions: revoked });
};

export const me: RequestHandler = async (req, res) => {
  // Honours the workspace the caller is currently in, so /me returns the
  // permissions that actually apply to what they are looking at.
  const user = await authService.getCurrentUser(
    req.user!.id,
    req.organization?.id ?? req.tokenOrganizationId ?? null,
  );
  res.json({ user: publicUser(user) });
};

export const forgotPassword: RequestHandler = async (req, res) => {
  const { email } = req.body as { email: string };
  await authService.requestPasswordReset(email, contextOf(req));

  // Always the same response, so the endpoint cannot enumerate accounts.
  res.status(202).json({
    message: "If that email is registered, a reset link has been sent.",
  });
};

export const resetPassword: RequestHandler = async (req, res) => {
  const { token, password } = req.body as { token: string; password: string };
  await authService.resetPassword(token, password);

  clearAuthCookies(res);
  res.json({ message: "Password updated. Please sign in again." });
};

export const changePassword: RequestHandler = async (req, res) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };

  await authService.changePassword(req.user!.id, currentPassword, newPassword);

  clearAuthCookies(res);
  res.json({ message: "Password changed. Please sign in again." });
};
import type { AcceptInvitationInput } from "./auth.validation";

/** A person activates their assigned access to create an account and join the company. */
export const acceptInvitation: RequestHandler = async (req, res) => {
  const input = req.body as AcceptInvitationInput;
  const result = await authService.acceptInvitation(input, contextOf(req));

  setAuthCookies(res, result);
  res.status(201).json({
    user: publicUser(result.user),
    organization: result.user.activeMembership
      ? {
          id: result.user.activeMembership.organizationId,
          slug: result.user.activeMembership.slug,
          displayName: result.user.activeMembership.displayName,
          url: `/${result.user.activeMembership.slug}/dashboard`,
        }
      : null,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: result.accessTokenExpiresAt.toISOString(),
  });
};
