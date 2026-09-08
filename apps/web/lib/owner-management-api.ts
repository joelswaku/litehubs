import { del, get, orgUrl, patch, post, put } from "./api";

/**
 * One tenant-safe client for the connected owner-management system.  Projects
 * do not own copies of livestock or crop records; instead this client manages
 * the planning, money, procurement, materials and durable-resource records
 * that explain how an operation was created or expanded.
 */
export const OWNER_MANAGEMENT_RESOURCES = [
  "projects",
  "project-members",
  "operational-links",
  "phases",
  "phase-dependencies",
  "tasks",
  "task-dependencies",
  "budget-lines",
  "materials",
  "material-movements",
  "suppliers",
  "inventory-items",
  "warehouses",
  "stock-movements",
  "purchase-requests",
  "purchase-request-lines",
  "purchase-orders",
  "purchase-order-lines",
  "receipts",
  "receipt-lines",
  "assets",
  "asset-assignments",
  "asset-movements",
  "asset-usage",
  "vehicle-profiles",
  "vehicle-trips",
  "maintenance-plans",
  "maintenance-work-orders",
  "maintenance-parts",
  "expenses",
  "approvals",
  "documents",
  "incidents",
  "security-visitors",
  "security-asset-movements",
  "security-keys",
  "security-key-handovers",
] as const;

export type OwnerManagementResource =
  (typeof OWNER_MANAGEMENT_RESOURCES)[number];
export type ManagementBody = Record<string, unknown>;
export type ManagementQuery = Record<
  string,
  string | number | boolean | null | undefined
>;

function queryString(query?: ManagementQuery) {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "")
      params.set(key, String(value));
  }
  return params.size ? `?${params.toString()}` : "";
}

function path(orgSlug: string, pathPart: string) {
  return orgUrl(orgSlug, `owner-management/${pathPart}`);
}

export const ownerManagementApi = {
  dashboard<T>(orgSlug: string, query?: ManagementQuery) {
    return get<T>(path(orgSlug, `dashboard${queryString(query)}`));
  },
  projectSummary<T>(orgSlug: string, projectId: string) {
    return get<T>(path(orgSlug, `projects/${projectId}/summary`));
  },
  list<T>(
    orgSlug: string,
    resource: OwnerManagementResource,
    query?: ManagementQuery,
  ) {
    return get<T>(path(orgSlug, `${resource}${queryString(query)}`));
  },
  stockBalances<T>(orgSlug: string, query?: ManagementQuery) {
    return get<T>(path(orgSlug, `inventory-stock${queryString(query)}`));
  },
  get<T>(orgSlug: string, resource: OwnerManagementResource, recordId: string) {
    return get<T>(path(orgSlug, `${resource}/${recordId}`));
  },
  create<T>(
    orgSlug: string,
    resource: OwnerManagementResource,
    body: ManagementBody,
  ) {
    return post<T>(path(orgSlug, resource), body);
  },
  update<T>(
    orgSlug: string,
    resource: OwnerManagementResource,
    recordId: string,
    body: ManagementBody,
  ) {
    return patch<T>(path(orgSlug, `${resource}/${recordId}`), body);
  },
  remove<T>(
    orgSlug: string,
    resource: OwnerManagementResource,
    recordId: string,
  ) {
    return del<T>(path(orgSlug, `${resource}/${recordId}`));
  },
  documentAccess<T>(orgSlug: string, documentId: string) {
    return get<T>(path(orgSlug, `documents/${documentId}/access`));
  },
  updateDocumentAccess<T>(
    orgSlug: string,
    documentId: string,
    body: {
      visibility:
        | "company"
        | "project_team"
        | "owner_only"
        | "owner_partner"
        | "selected_roles"
        | "selected_people";
      allowedRoleIds: string[];
      allowedMemberIds: string[];
      isLocked: boolean;
      canDownload: boolean;
      canEdit: boolean;
    },
  ) {
    return patch<T>(path(orgSlug, `documents/${documentId}/access`), body);
  },
  documentCategories<T>(orgSlug: string, includeInactive = false) {
    return get<T>(
      path(
        orgSlug,
        `document-categories${includeInactive ? "?includeInactive=true" : ""}`,
      ),
    );
  },
  createDocumentCategory<T>(
    orgSlug: string,
    body: {
      name: string;
      code?: string;
      description?: string | null;
      sortOrder?: number;
      isActive?: boolean;
      visibility?: "company" | "owner_only";
    },
  ) {
    return post<T>(path(orgSlug, "document-categories"), body);
  },
  updateDocumentCategory<T>(
    orgSlug: string,
    categoryId: string,
    body: {
      name?: string;
      description?: string | null;
      sortOrder?: number;
      isActive?: boolean;
      visibility?: "company" | "owner_only";
    },
  ) {
    return patch<T>(path(orgSlug, `document-categories/${categoryId}`), body);
  },
  archiveDocumentCategory<T>(orgSlug: string, categoryId: string) {
    return del<T>(path(orgSlug, `document-categories/${categoryId}`));
  },
  assignDocumentCategory<T>(
    orgSlug: string,
    documentId: string,
    categoryId: string | null,
  ) {
    return patch<T>(path(orgSlug, `documents/${documentId}/category`), {
      categoryId,
    });
  },
  taskDocuments<T>(orgSlug: string, taskId: string) {
    return get<T>(path(orgSlug, `tasks/${taskId}/documents`));
  },
  replaceTaskDocuments<T>(
    orgSlug: string,
    taskId: string,
    documentIds: string[],
  ) {
    return put<T>(path(orgSlug, `tasks/${taskId}/documents`), {
      documentIds,
    });
  },
  decideApproval<T>(
    orgSlug: string,
    approvalId: string,
    body: {
      decision: "approved" | "rejected" | "partially_approved";
      approvedAmount?: number;
      decisionNotes?: string;
    },
  ) {
    return post<T>(path(orgSlug, `approvals/${approvalId}/decide`), body);
  },
};
