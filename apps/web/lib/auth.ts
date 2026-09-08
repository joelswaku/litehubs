import { get, post } from "./api";

/**
 * The session shape as the API returns it, and the calls that change it.
 *
 * The important structural point mirrors the API: **identity, workspace list,
 * and grants-in-the-current-workspace are three separate things.** Flattening
 * `roles` onto the user is what made the old code assume a role held anywhere
 * was held everywhere — the bug the whole multi-tenant rework existed to fix.
 * Keeping them apart here means the frontend cannot make that mistake either.
 */

export interface OrganizationSummary {
  id: string;
  slug: string;
  displayName: string;
  isOwner: boolean;
}

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  status: "active" | "suspended" | "disabled";
  mustChangePassword: boolean;

  /** Platform plane. Empty for an ordinary customer. */
  platformRoles: string[];
  platformPermissions: string[];
  isPlatformStaff: boolean;

  /** Every workspace this person can enter. */
  organizations: OrganizationSummary[];

  /** Null until a workspace is chosen. */
  activeOrganization: OrganizationSummary | null;

  /** Scoped to activeOrganization. Empty when none is active. */
  roles: string[];
  permissions: string[];
}

interface SessionResponse {
  user: SessionUser;
}

interface LoginResponse extends SessionResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export async function login(
  email: string,
  password: string,
): Promise<SessionUser> {
  const response = await post<LoginResponse>("/auth/login", {
    email,
    password,
  });
  return response.user;
}

/**
 * Reads the current session.
 *
 * `organizationSlug` is passed as a header by the api client when set, so /me
 * answers with the permissions that apply to the workspace on screen rather
 * than whichever one the token happened to name.
 */
export async function fetchSession(): Promise<SessionUser> {
  const response = await get<SessionResponse>("/auth/me");
  return response.user;
}

export async function logout(): Promise<void> {
  await post("/auth/logout");
}

export async function logoutEverywhere(): Promise<{ revokedSessions: number }> {
  return post("/auth/logout-all");
}

/**
 * Moves the session to another workspace.
 *
 * Only the access token is reissued; the refresh token identifies the person,
 * not the workspace, so switching is not a re-authentication.
 */
export async function switchOrganization(
  organizationSlug: string,
): Promise<SessionUser> {
  const response = await post<SessionResponse & { accessToken: string }>(
    "/auth/switch-organization",
    { organizationSlug },
  );
  return response.user;
}

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  organization: {
    slug: string;
    legalName: string;
    displayName?: string;
    industryCode?: string;
    country?: string;
    currency?: string;
    timezone?: string;
    address?: {
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      region?: string;
      postalCode?: string;
    };
  };
}

export interface RegisterResult {
  user: SessionUser;
  organization: { id: string; slug: string; displayName: string; url: string };
}

/** Signup: creates the person and their company together, signed in as owner. */
export async function register(input: RegisterInput): Promise<RegisterResult> {
  return post<RegisterResult>("/auth/register", input);
}

export async function requestPasswordReset(email: string): Promise<void> {
  await post("/auth/forgot-password", { email });
}

export async function resetPassword(
  token: string,
  password: string,
): Promise<void> {
  await post("/auth/reset-password", { token, password });
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await post("/auth/change-password", { currentPassword, newPassword });
}

/**
 * Where to send someone straight after signing in.
 *
 * LiteHubs staff always enter the platform console first. A staff member who
 * also belongs to a company can still enter that company separately, but their
 * staff sign-in must never be redirected into a customer workspace.
 */
export function landingPathFor(user: SessionUser): string {
  if (user.isPlatformStaff) return "/platform";
  if (user.activeOrganization) {
    return `/${user.activeOrganization.slug}/dashboard`;
  }
  if (user.organizations.length === 1) {
    return `/${user.organizations[0]!.slug}/dashboard`;
  }
  if (user.organizations.length > 1) return "/select-organization";
  // No workspace and no platform role: they need to create a company.
  return "/select-organization";
}

/** Company entrance landing. It intentionally ignores platform roles so a
 * dual-role account goes to its company when it used the normal sign-in page. */
export function workspaceLandingPathFor(user: SessionUser): string {
  if (user.activeOrganization)
    return `/${user.activeOrganization.slug}/dashboard`;
  if (user.organizations.length === 1)
    return `/${user.organizations[0]!.slug}/dashboard`;
  if (user.organizations.length > 1) return "/select-organization";
  return user.isPlatformStaff ? "/platform" : "/select-organization";
}
