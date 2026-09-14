/**
 * Values shared between the two dashboards.
 *
 * The header names and cookie names must match apps/api exactly — they are the
 * contract between the two halves. They are listed here rather than typed
 * inline at each call site so a rename cannot half-land.
 */

export const APP_NAME = "LiteHubs";

/** Same-origin thanks to the rewrite in next.config.ts. */
export const API_PREFIX = "/api/v1";

/** Set by apps/api/src/modules/auth/auth.controller.ts. */
export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

/**
 * How a client names the workspace it is acting on when the slug is not in the
 * path. Read by apps/api/src/middleware/organization.middleware.ts, and listed
 * in the API's CORS allowedHeaders.
 */
export const ORGANIZATION_SLUG_HEADER = "X-Organization-Slug";

/** Where the user lands after choosing a workspace. */
export const workspaceHome = (slug: string) => `/${slug}/dashboard`;

export const PLATFORM_HOME = "/platform";
export const LOGIN_PATH = "/login";
export const SELECT_ORGANIZATION_PATH = "/select-organization";

/**
 * Routes reachable without a session. The edge middleware treats everything
 * else as protected, so a new page is private by default — forgetting to list a
 * page here locks it down, which is the safe direction to fail.
 */
export const PUBLIC_PATHS = [
  "/",
  "/robots.txt",
  "/sitemap.xml",
  "/opengraph-image",
  "/contact",
  "/rendezvous",
  "/rendez-vous",
  "/book",
  "/check-in",
  "/queue",
  "/careers",
  "/login",
  "/staff",
  "/staff/register",
  "/staff/login",
  "/staff/loging",
  "/forgot-password",
  "/reset-password",
  "/accept-invitation",
  "/register",
] as const;

/**
 * The four platform-plane roles. Used to decide what a staff member sees; the
 * API enforces the same codes, so this list is for rendering only and is never
 * the authority.
 */
export const PLATFORM_ROLES = {
  superAdmin: "platform_super_admin",
  admin: "platform_admin",
  support: "platform_support",
  billing: "platform_billing",
} as const;

/** Severity ordering, worst first. Drives sorting and colour selection. */
export const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

/**
 * Status colour tokens. Kept as a map rather than string interpolation so a
 * typo is a type error, and so the reserved status palette is never reached for
 * by accident when a series colour was meant.
 */
export const SEVERITY_TOKEN: Record<Severity, string> = {
  critical: "critical",
  high: "serious",
  medium: "warning",
  low: "good",
};

export const PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** Query cache lifetimes. Operational data goes stale quickly; a catalogue does not. */
export const STALE_TIME = {
  /** Alerts, today's work — anything an operator is watching. */
  live: 15_000,
  /** Lists a user is browsing. */
  standard: 60_000,
  /** Industries, permission catalogue, chart of accounts. */
  reference: 10 * 60_000,
} as const;
