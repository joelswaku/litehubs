import { del, get, orgUrl, patch, post, put } from "./api";

/**
 * Company setup: provinces, sites, departments, roles, members and invitations.
 *
 * The two `members` calls here are the ones that matter most. Until they were
 * wired, an owner could invite somebody but could not change what that person
 * may do, or which provinces they can see — the only way to fix a wrong role
 * was a database query. Given province scoping is how a multi-province company
 * limits who sees which site, that was the sharpest gap in the product.
 */

function base(orgSlug: string, path: string): string {
  return orgUrl(orgSlug, path);
}

export interface Province {
  id: string;
  code: string;
  name: string;
  isActive?: boolean;
}

export interface OrganizationSite {
  id: string;
  code: string;
  name: string;
  province: { id: string; code: string; name: string };
  siteType: "farm" | "office" | "warehouse" | "other" | string;
  address?: {
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    postalCode?: string | null;
  };
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}
export interface OrganizationRole {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  level: number;
  dataScope?: "organization" | "province" | "self";
  isSystem: boolean;
  permissionCodes?: string[];
}

export interface OrganizationPermission {
  code: string;
  resource: string;
  action: string;
  moduleCode?: string | null;
  description?: string | null;
}
export interface Invitation {
  invitationId: string;
  employeeId?: string | null;
  employeeName?: string | null;
  email: string;
  jobTitle?: string | null;
  roleCodes: string[];
  provinces: { id: string; code: string; name: string }[];
  expiresAt: string;
  acceptedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
}
export interface Member {
  memberId: string;
  userId: string;
  email: string;
  fullName: string;
  status: string;
  isOwner: boolean;
  jobTitle?: string | null;
  joinedAt?: string | null;
  roleCodes: string[];
  provinces: { id: string; code: string; name: string }[];
  employee?: { id: string; employeeNumber: string | null } | null;
}

export interface EmployeeCreationAllowance {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  province: { id: string; code: string; name: string };
  maxEmployees: number;
  usedEmployees: number;
  remainingEmployees: number;
  createdAt: string;
  updatedAt: string;
}
export const companySetupApi = {
  listProvinces<T>(orgSlug: string) {
    return get<T>(base(orgSlug, "provinces"));
  },
  createProvince<T>(orgSlug: string, body: Record<string, unknown>) {
    return post<T>(base(orgSlug, "provinces"), body);
  },
  updateProvince<T>(
    orgSlug: string,
    provinceId: string,
    body: Record<string, unknown>,
  ) {
    return patch<T>(base(orgSlug, `provinces/${provinceId}`), body);
  },
  removeProvince<T>(orgSlug: string, provinceId: string) {
    return del<T>(base(orgSlug, `provinces/${provinceId}`));
  },

  listSites<T>(orgSlug: string) {
    return get<T>(base(orgSlug, "sites"));
  },
  createSite<T>(orgSlug: string, body: Record<string, unknown>) {
    return post<T>(base(orgSlug, "sites"), body);
  },
  updateSite<T>(
    orgSlug: string,
    siteId: string,
    body: Record<string, unknown>,
  ) {
    return patch<T>(base(orgSlug, `sites/${siteId}`), body);
  },
  removeSite<T>(orgSlug: string, siteId: string) {
    return del<T>(base(orgSlug, `sites/${siteId}`));
  },

  listDepartments<T>(orgSlug: string) {
    return get<T>(base(orgSlug, "departments"));
  },
  createDepartment<T>(orgSlug: string, body: Record<string, unknown>) {
    return post<T>(base(orgSlug, "departments"), body);
  },
  updateDepartment<T>(
    orgSlug: string,
    departmentId: string,
    body: Record<string, unknown>,
  ) {
    return patch<T>(base(orgSlug, `departments/${departmentId}`), body);
  },
  removeDepartment<T>(orgSlug: string, departmentId: string) {
    return del<T>(base(orgSlug, `departments/${departmentId}`));
  },

  listRoles<T>(orgSlug: string) {
    return get<T>(base(orgSlug, "roles"));
  },
  listPermissions<T>(orgSlug: string) {
    return get<T>(base(orgSlug, "permissions"));
  },
  updateRole<T>(
    orgSlug: string,
    roleId: string,
    body: Record<string, unknown>,
  ) {
    return patch<T>(base(orgSlug, `roles/${roleId}`), body);
  },
  listMembers<T>(orgSlug: string) {
    return get<T>(base(orgSlug, "members"));
  },
  /**
   * Replaces the member's roles outright — PUT, not PATCH, because the API takes
   * the complete set. Sending a partial list silently removes the rest, so the
   * UI must always submit every role the member should end up with.
   */
  replaceMemberRoles<T>(
    orgSlug: string,
    memberId: string,
    roleCodes: string[],
  ) {
    return put<T>(base(orgSlug, `members/${memberId}/roles`), { roleCodes });
  },
  /**
   * Replaces the provinces a member may see. An empty array is meaningful and
   * allowed: it means "no province restriction recorded", which for a
   * province-scoped role is what locks them out of every site.
   */
  replaceMemberProvinces<T>(
    orgSlug: string,
    memberId: string,
    provinceIds: string[],
  ) {
    return put<T>(base(orgSlug, `members/${memberId}/provinces`), {
      provinceIds,
    });
  },

  listEmployeeCreationAllowances<T>(orgSlug: string) {
    return get<T>(base(orgSlug, "employee-creation-allowances"));
  },
  setEmployeeCreationAllowance<T>(
    orgSlug: string,
    memberId: string,
    provinceId: string,
    maxEmployees: number,
  ) {
    return put<T>(
      base(
        orgSlug,
        `employee-creation-allowances/${memberId}/provinces/${provinceId}`,
      ),
      { maxEmployees },
    );
  },
  removeEmployeeCreationAllowance<T>(
    orgSlug: string,
    memberId: string,
    provinceId: string,
  ) {
    return del<T>(
      base(
        orgSlug,
        `employee-creation-allowances/${memberId}/provinces/${provinceId}`,
      ),
    );
  },
  listAccessAssignments<T>(orgSlug: string) {
    return get<T>(base(orgSlug, "invitations"));
  },
  assignAccess<T>(orgSlug: string, body: Record<string, unknown>) {
    return post<T>(base(orgSlug, "invitations"), body);
  },
  revokeAccessAssignment<T>(orgSlug: string, assignmentId: string) {
    return del<T>(base(orgSlug, `invitations/${assignmentId}`));
  },
  listInvitations<T>(orgSlug: string) {
    return get<T>(base(orgSlug, "invitations"));
  },
  createInvitation<T>(orgSlug: string, body: Record<string, unknown>) {
    return post<T>(base(orgSlug, "invitations"), body);
  },
  revokeInvitation<T>(orgSlug: string, invitationId: string) {
    return del<T>(base(orgSlug, `invitations/${invitationId}`));
  },
};
