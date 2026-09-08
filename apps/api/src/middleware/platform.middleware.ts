import type { RequestHandler } from "express";
import { ForbiddenError, UnauthorizedError } from "../utils/errors";

/**
 * Guards the platform plane — running LiteHubs itself, as opposed to running a
 * business inside it.
 *
 * These codes are a separate namespace (`platform.*`) held through
 * `user_platform_roles`, and they are checked against a separate list. That
 * separation is the point: a platform administrator is not implicitly a member
 * of any customer's workspace, so nothing here grants sight of tenant data.
 * Cross-tenant reads stay an explicit, audited action.
 */
function platformCallerOf(req: Parameters<RequestHandler>[0]) {
  if (!req.user) {
    // Signals that authenticate() was not mounted ahead of this guard.
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

/** Caller must hold every listed platform permission code. */
export function requirePlatformPermission(...codes: string[]): RequestHandler {
  return (req, _res, next) => {
    try {
      const user = platformCallerOf(req);
      const missing = codes.filter(
        (code) => !user.platformPermissions.includes(code),
      );

      if (missing.length > 0) {
        throw new ForbiddenError("This is a LiteHubs staff action", {
          required: codes,
          missing,
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Caller must hold at least one of the listed platform role codes. */
export function requirePlatformRole(...codes: string[]): RequestHandler {
  return (req, _res, next) => {
    try {
      const user = platformCallerOf(req);
      if (!codes.some((code) => user.platformRoles.includes(code))) {
        throw new ForbiddenError("This is a LiteHubs staff action", {
          requiredAnyOf: codes,
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Any platform grant at all. For the staff area's own entry point. */
export const requirePlatformStaff: RequestHandler = (req, _res, next) => {
  try {
    const user = platformCallerOf(req);
    if (user.platformRoles.length === 0) {
      throw new ForbiddenError("This area is for LiteHubs staff");
    }
    next();
  } catch (error) {
    next(error);
  }
};
