import type { RequestHandler } from "express";
import { UnauthorizedError } from "../utils/errors";
import { ACCESS_COOKIE } from "../modules/auth/auth.controller";
import { verifyAccessToken } from "../modules/auth/auth.service";
import { findAuthenticatedUserById } from "../modules/auth/auth.repository";

function extractToken(
  authorization: string | undefined,
  cookieToken: unknown,
): string | undefined {
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice(7).trim();
    if (token) return token;
  }
  return typeof cookieToken === "string" && cookieToken
    ? cookieToken
    : undefined;
}

/**
 * Requires a valid access token and loads the caller fresh from the database.
 *
 * The extra read per request is deliberate: it means suspending a user or
 * changing their roles takes effect immediately, instead of lingering until
 * their 15-minute token expires.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractToken(
      req.get("authorization"),
      req.cookies?.[ACCESS_COOKIE],
    );

    if (!token) {
      throw new UnauthorizedError("Authentication required");
    }

    const { userId, organizationId } = verifyAccessToken(token);

    const user = await findAuthenticatedUserById(userId);
    if (!user) {
      throw new UnauthorizedError("Account no longer exists");
    }
    if (user.status !== "active") {
      throw new UnauthorizedError(
        user.status === "suspended"
          ? "This account is suspended"
          : "This account has been disabled",
      );
    }

    req.user = user;
    // Only a hint. Which organization the request acts on is settled by
    // organization.middleware, which proves the membership before honouring it.
    req.tokenOrganizationId = organizationId;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Populates req.user when a valid token is present, but lets the request
 * through when it is not. For endpoints that behave differently for signed-in
 * callers without demanding it.
 */
export const optionalAuthenticate: RequestHandler = async (req, _res, next) => {
  const token = extractToken(
    req.get("authorization"),
    req.cookies?.[ACCESS_COOKIE],
  );
  if (!token) return next();

  try {
    const { userId, organizationId } = verifyAccessToken(token);
    const user = await findAuthenticatedUserById(userId);
    if (user?.status === "active") {
      req.user = user;
      req.tokenOrganizationId = organizationId;
    }
  } catch {
    // A bad token is treated as no token here.
  }
  next();
};
