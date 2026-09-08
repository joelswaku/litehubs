export type UserStatus = "active" | "suspended" | "disabled";

export type MemberStatus = "invited" | "active" | "suspended" | "removed";

/**
 * One workspace the caller can enter. A person may belong to several — the
 * whole point of the platform plane / organization plane split — so nothing
 * here is a property of the user themselves.
 */
export interface Membership {
  organizationId: string;
  slug: string;
  displayName: string;
  memberId: string;
  status: MemberStatus;
  isOwner: boolean;
}

/**
 * A membership with its grants resolved. Roles and permissions are read for one
 * organization at a time, because the same person can be an owner in one
 * workspace and a read-only guest in the next.
 */
export interface ActiveMembership extends Membership {
  roles: string[];
  permissions: string[];
}

/** The caller, as resolved from a verified access token. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  status: UserStatus;
  mustChangePassword: boolean;
  /**
   * Platform plane — the codes for running LiteHubs itself. Empty for ordinary
   * customers, and deliberately *not* a shortcut into anyone's data: holding
   * `platform.organizations.read` does not make you a member of an
   * organization.
   */
  platformRoles: string[];
  platformPermissions: string[];
  /** Every workspace this person can enter, for the picker and the guards. */
  memberships: Membership[];
  /**
   * The organization this request is acting on. Null until one is resolved —
   * on login before a workspace is chosen, and on platform-plane routes that
   * are not scoped to a tenant at all.
   */
  activeMembership: ActiveMembership | null;
}

/** Access-token claims we set ourselves, on top of the registered ones. */
export interface AccessTokenClaims {
  sub: string;
  email: string;
  /** Active organization id, or null when the caller has not picked one. */
  org: string | null;
}

export interface IssuedTokens {
  accessToken: string;
  /** Opaque, single-use, rotated on every refresh. */
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}

export interface LoginResult extends IssuedTokens {
  user: AuthenticatedUser;
}

/** Request provenance, recorded against issued refresh tokens. */
export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}
