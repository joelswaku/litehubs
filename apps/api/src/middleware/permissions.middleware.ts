import type { RequestHandler } from "express";
import {
  BadRequestError,
  ForbiddenError,
  UnauthorizedError,
} from "../utils/errors";

/**
 * Organization-plane guards. Every code checked here is scoped to the workspace
 * the request is acting on, so the same person can be an owner in one
 * organization and hold nothing in the next.
 *
 * `requireOrganization` has already resolved that membership and its grants, so
 * these checks are in-memory — no extra query per guard.
 */
function membershipOf(req: Parameters<RequestHandler>[0]) {
  if (!req.user) {
    // Signals that authenticate() was not mounted ahead of this guard.
    throw new UnauthorizedError("Authentication required");
  }
  if (!req.user.activeMembership) {
    // Signals a routing mistake rather than a permission problem: an
    // organization-scoped code cannot be evaluated without an organization.
    throw new BadRequestError(
      "No workspace selected for a workspace-scoped action",
      { reason: "no_active_organization" },
    );
  }
  return req.user.activeMembership;
}

/** Restricts a personal employee endpoint to an active employee profile in the
 * current workspace. Each downstream service derives the employee again and
 * scopes records to it; no employee identifier comes from the browser. */
export const requireActiveEmployeeProfile: RequestHandler = async (req, _res, next) => {
  try {
    const membership = membershipOf(req);
    if (!req.tenant) {
      throw new BadRequestError("No workspace selected for a personal action", {
        reason: "no_active_organization",
      });
    }
    const employee = await req.tenant.run((client) =>
      client.query(
        `SELECT 1 FROM employees
          WHERE organization_id=$1 AND member_id=$2
            AND employment_status IN ('active','probation','on_leave')
          LIMIT 1`,
        [membership.organizationId, membership.memberId],
      ),
    );
    if (!employee.rowCount) {
      throw new ForbiddenError("An active employee profile is required for this personal area");
    }
    next();
  } catch (error) {
    next(error);
  }
};

/** Caller must hold every listed permission code in the active workspace. */
export function requirePermission(...codes: string[]): RequestHandler {
  return (req, _res, next) => {
    try {
      const membership = membershipOf(req);
      const missing = codes.filter(
        (code) => !membership.permissions.includes(code),
      );

      if (missing.length > 0) {
        throw new ForbiddenError("You do not have permission to do that", {
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

/** Caller must hold at least one of the listed permission codes. */
export function requireAnyPermission(...codes: string[]): RequestHandler {
  return (req, _res, next) => {
    try {
      const membership = membershipOf(req);
      const held = codes.some((code) => membership.permissions.includes(code));

      if (!held) {
        throw new ForbiddenError("You do not have permission to do that", {
          requiredAnyOf: codes,
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Caller must hold at least one of the listed role codes. */
export function requireRole(...codes: string[]): RequestHandler {
  return (req, _res, next) => {
    try {
      const membership = membershipOf(req);
      const held = codes.some((code) => membership.roles.includes(code));

      if (!held) {
        throw new ForbiddenError("This action is restricted", {
          requiredAnyOf: codes,
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Owners bypass the code list; used for billing and workspace deletion. */
export const requireOwner: RequestHandler = (req, _res, next) => {
  try {
    if (!membershipOf(req).isOwner) {
      throw new ForbiddenError("Only the workspace owner can do that");
    }
    next();
  } catch (error) {
    next(error);
  }
};
