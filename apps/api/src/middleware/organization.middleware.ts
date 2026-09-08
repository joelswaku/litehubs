import type { Request, RequestHandler } from "express";
import { withTenantContext } from "../utils/tenant-query";
import { BadRequestError, UnauthorizedError } from "../utils/errors";
import {
  activateOrganization,
  organizationIdForSlug,
} from "../modules/auth/auth.service";
import type { ActiveMembership } from "../modules/auth/auth.types";

/** Header form, for API clients that do not put the workspace in the path. */
const SLUG_HEADER = "x-organization-slug";
const ID_HEADER = "x-organization-id";

/**
 * Works out which workspace the request is addressing, in order of how
 * explicit the caller was:
 *
 *   1. the URL — `/api/v1/orgs/congo-omega/employees`
 *   2. an X-Organization-Slug / X-Organization-Id header
 *   3. the `org` claim on the access token
 *
 * A slug is mapped through the caller's own memberships, so an unknown or
 * foreign slug is indistinguishable from one that does not exist.
 */
function requestedOrganizationId(req: Request): string | null {
  const user = req.user;
  if (!user) throw new UnauthorizedError("Authentication required");

  // Express types a route param as string | string[]; a repeated :orgSlug would
  // be ambiguous about which workspace was meant, so it is refused outright.
  const fromPath = req.params.orgSlug;
  if (Array.isArray(fromPath)) {
    throw new BadRequestError("More than one workspace named in the path");
  }
  if (fromPath) return organizationIdForSlug(user, fromPath);

  const fromHeader = req.get(SLUG_HEADER);
  if (fromHeader) return organizationIdForSlug(user, fromHeader);

  const idHeader = req.get(ID_HEADER);
  if (idHeader) return idHeader.trim();

  return req.tokenOrganizationId ?? null;
}

function attach(req: Request, membership: ActiveMembership): void {
  req.membership = membership;
  req.organization = {
    id: membership.organizationId,
    slug: membership.slug,
    displayName: membership.displayName,
  };
  // Bound so a handler cannot run tenant work against the wrong organization
  // even by accident — there is no parameter left to get wrong.
  req.tenant = {
    organizationId: membership.organizationId,
    run: (handler) =>
      withTenantContext(
        { userId: req.user!.id, organizationId: membership.organizationId },
        handler,
      ),
  };
}

/**
 * Demanded by every tenant-scoped route. Resolves the workspace, proves the
 * caller is an active member of it, and loads the roles and permissions they
 * hold *there* — which is what the permission guards then read.
 */
export const requireOrganization: RequestHandler = async (req, _res, next) => {
  try {
    const user = req.user;
    if (!user) throw new UnauthorizedError("Authentication required");

    const organizationId = requestedOrganizationId(req);
    if (!organizationId) {
      throw new BadRequestError(
        user.memberships.length === 0
          ? "You do not belong to a workspace yet. Create one to continue."
          : "No workspace selected. Choose one, or send the X-Organization-Slug header.",
        {
          reason: "no_active_organization",
          workspaces: user.memberships.map((m) => m.slug),
        },
      );
    }

    attach(req, await activateOrganization(user, organizationId));
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * For routes that behave differently inside a workspace but are still usable
 * without one — the notification inbox, say. A workspace the caller cannot
 * enter is treated as no workspace rather than an error.
 */
export const resolveOrganization: RequestHandler = async (req, _res, next) => {
  if (!req.user) return next();
  try {
    const organizationId = requestedOrganizationId(req);
    if (organizationId) {
      attach(req, await activateOrganization(req.user, organizationId));
    }
  } catch {
    // Left unresolved on purpose; req.organization stays undefined.
  }
  next();
};
