import type { SessionUser } from "./auth";

/**
 * Permission checks for rendering.
 *
 * **These decide what is *shown*, never what is *allowed*.** The API re-checks
 * every code on every request and row-level security backs that up, so hiding a
 * button here is a courtesy to the user, not a security control. Anyone can
 * open dev tools and call the endpoint; the answer is still 403.
 *
 * Stating that plainly matters, because the opposite belief — "the button is
 * hidden, so it's protected" — is how authorization bugs get shipped.
 */

/** Codes are `<resource>.<action>`, e.g. `poultry.flocks.update`. */
export type PermissionCode = string;

export function can(
  user: SessionUser | null | undefined,
  ...codes: PermissionCode[]
): boolean {
  if (!user) return false;
  return codes.every((code) => user.permissions.includes(code));
}

export function canAny(
  user: SessionUser | null | undefined,
  ...codes: PermissionCode[]
): boolean {
  if (!user) return false;
  return codes.some((code) => user.permissions.includes(code));
}

export function hasRole(
  user: SessionUser | null | undefined,
  ...codes: string[]
): boolean {
  if (!user) return false;
  return codes.some((code) => user.roles.includes(code));
}

export function isOwner(user: SessionUser | null | undefined): boolean {
  return user?.activeOrganization?.isOwner === true;
}

/** The HR directory is deliberately narrower than operational assignee lists.
 * Supervisors may receive safe employee names in a task/shift selector without
 * gaining access to every employment and contact record. */
export function canAccessEmployeeDirectory(
  user: SessionUser | null | undefined,
): boolean {
  if (isOwner(user)) return true;
  return Boolean(
    user?.roles.some(
      (role) =>
        role === "hr_officer" ||
        role === "manager" ||
        role.endsWith("_manager"),
    ),
  );
}

/* ------------------------------------------------------------- platform -- */

export function canPlatform(
  user: SessionUser | null | undefined,
  ...codes: PermissionCode[]
): boolean {
  if (!user) return false;
  return codes.every((code) => user.platformPermissions.includes(code));
}

export function hasPlatformRole(
  user: SessionUser | null | undefined,
  ...codes: string[]
): boolean {
  if (!user) return false;
  return codes.some((code) => user.platformRoles.includes(code));
}

/** Filters staff navigation using platform permissions, not company permissions. */
export function visiblePlatformTo<
  T extends {
    permission?: PermissionCode | PermissionCode[];
    platformRole?: string | string[];
  },
>(user: SessionUser | null | undefined, items: readonly T[]): T[] {
  return items.filter((item) => {
    const roles = item.platformRole
      ? Array.isArray(item.platformRole)
        ? item.platformRole
        : [item.platformRole]
      : [];
    if (
      roles.length &&
      !roles.some((role) => user?.platformRoles.includes(role))
    )
      return false;
    if (!item.permission) return true;
    const codes = Array.isArray(item.permission)
      ? item.permission
      : [item.permission];
    return canPlatform(user, ...codes);
  });
}

/* --------------------------------------------------------- module access -- */

/**
 * Whether a whole module area should appear at all.
 *
 * A module is visible when the caller holds *any* permission inside it, which
 * is why this tests the code prefix rather than a fixed list. An accountant
 * holding only `finance.*` codes sees Finance and nothing else, without anyone
 * maintaining a role-to-module table that would drift from the permission
 * catalogue.
 */
export function canSeeModule(
  user: SessionUser | null | undefined,
  moduleCode: string,
): boolean {
  if (!user) return false;
  const prefix = `${moduleCode}.`;
  return user.permissions.some((code) => code.startsWith(prefix));
}

/**
 * The five dashboard layouts. Seventeen roles collapse into these because
 * "what do I need on screen when I log in" has far fewer answers than there
 * are job titles.
 *
 * Derived from permissions rather than role codes on purpose: an organization
 * can rename or reshape its roles — they are per-tenant rows, not constants —
 * so keying the layout to a role code would break the moment a customer edits
 * one. What a role *can do* is stable; what it is *called* is not.
 */
export type DashboardLayout =
  "executive" | "manager" | "supervisor" | "back_office" | "employee";

export function dashboardLayoutFor(
  user: SessionUser | null | undefined,
): DashboardLayout {
  if (!user) return "employee";

  // System role presets are recognised first so the intended landing layout is
  // clear for Congo Omega. The permission checks below keep custom company
  // roles working even when their names differ from the presets.
  if (isOwner(user) || hasRole(user, "owner", "general_manager"))
    return "executive";
  if (
    hasRole(
      user,
      "provincial_manager",
      "farm_operations_manager",
      "farm_manager",
      "project_manager",
    )
  )
    return "manager";
  if (
    hasRole(
      user,
      "supervisor",
      "poultry_supervisor",
      "pig_supervisor",
      "agriculture_supervisor",
      "veterinarian",
      "agronomist",
    )
  )
    return "supervisor";
  if (
    hasRole(user, "accountant", "hr_officer", "storekeeper", "security_officer")
  )
    return "back_office";
  if (hasRole(user, "employee")) return "employee";

  // Owners and anyone who can see the whole company's money.
  if (isOwner(user) || can(user, "finance.transactions.read", "reports.read")) {
    return "executive";
  }

  // Runs a province or a site: production plus the people on it.
  if (canAny(user, "employees.update", "sites.update", "projects.update")) {
    return "manager";
  }

  // Approves the day's records for a unit.
  if (
    canAny(
      user,
      "daily_operations.approve",
      "attendance.approve",
      "corrective_actions.create",
    )
  ) {
    return "supervisor";
  }

  // Deep in one functional area — ledger, staff, stock, or the gate.
  if (
    canAny(
      user,
      "finance.accounts.read",
      "payroll.read",
      "inventory.stock.read",
      "security.read",
    )
  ) {
    return "back_office";
  }

  return "employee";
}

/**
 * Filters a list of items by the permission each declares.
 *
 * Used for nav entries and dashboard widgets so the filtering rule lives in one
 * place. An item with no `permission` is always shown.
 */
export function visibleTo<
  T extends {
    permission?: PermissionCode | PermissionCode[];
    ownerOnly?: boolean;
    peopleDirectoryOnly?: boolean;
  },
>(user: SessionUser | null | undefined, items: readonly T[]): T[] {
  return items.filter((item) => {
    if (item.ownerOnly && !isOwner(user)) return false;
    if (item.peopleDirectoryOnly && !canAccessEmployeeDirectory(user))
      return false;
    if (!item.permission) return true;
    const codes = Array.isArray(item.permission)
      ? item.permission
      : [item.permission];
    return canAny(user, ...codes);
  });
}
