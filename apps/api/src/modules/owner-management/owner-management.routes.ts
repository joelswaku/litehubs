import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireOrganization } from "../../middleware/organization.middleware";
import {
  requireOwner,
  requirePermission,
} from "../../middleware/permissions.middleware";
import { validate } from "../../middleware/validation.middleware";
import { ForbiddenError } from "../../utils/errors";
import * as controller from "./owner-management.controller";
import {
  approvalDecisionBody,
  documentAccessBody,
  documentCategoryAssignmentBody,
  documentCategoryCreateBody,
  documentCategoryUpdateBody,
  inventoryStockQuery,
  ownerManagementDashboardQuery,
  ownerManagementDecisionParams,
  ownerManagementDocumentAccessParams,
  ownerManagementDocumentCategoryParams,
  ownerManagementListQuery,
  ownerManagementRecordParams,
  ownerManagementProjectParams,
  ownerManagementResourceParams,
  ownerManagementTaskDocumentParams,
  organizationParams,
  parseOwnerManagementBody,
  taskDocumentLinksBody,
  type OwnerManagementResource,
} from "./owner-management.validation";

export const ownerManagementRoutes = Router();

const permissionResource: Record<OwnerManagementResource, string> = {
  projects: "projects",
  "project-members": "projects",
  "operational-links": "projects",
  phases: "projects",
  "phase-dependencies": "projects",
  tasks: "tasks",
  "task-dependencies": "tasks",
  "budget-lines": "projects",
  materials: "projects",
  "material-movements": "projects",
  suppliers: "suppliers",
  "inventory-items": "inventory.items",
  warehouses: "inventory.warehouses",
  "stock-movements": "inventory.movements",
  "purchase-requests": "procurement",
  "purchase-request-lines": "procurement",
  "purchase-orders": "procurement",
  "purchase-order-lines": "procurement",
  receipts: "procurement",
  "receipt-lines": "procurement",
  assets: "equipment",
  "asset-assignments": "equipment",
  "asset-movements": "equipment",
  "asset-usage": "equipment",
  "vehicle-profiles": "vehicles",
  "vehicle-trips": "vehicles",
  "maintenance-plans": "maintenance",
  "maintenance-work-orders": "work_orders",
  "maintenance-parts": "maintenance",
  expenses: "finance.expenses",
  approvals: "approvals",
  documents: "documents",
  incidents: "incidents",
  "security-visitors": "security",
  "security-asset-movements": "security",
  "security-keys": "security",
  "security-key-handovers": "security",
};

const inOrganization = [
  authenticate,
  validate({ params: organizationParams }),
  requireOrganization,
] as const;

function resourceOf(
  req: Parameters<RequestHandler>[0],
): OwnerManagementResource {
  const value = req.params.resource;
  return (Array.isArray(value) ? value[0] : value) as OwnerManagementResource;
}

function requireOwnerManagementPermission(
  action: "create" | "read" | "update" | "delete",
): RequestHandler {
  return (req, _res, next) => {
    try {
      const code = permissionResource[resourceOf(req)] + "." + action;
      if (!req.membership!.permissions.includes(code))
        throw new ForbiddenError("You do not have permission to do that", {
          required: [code],
        });
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Managers can read projects that fall inside their existing project/province
 * scope and record day-to-day project work. The portfolio itself, team
 * assignment, phases, and budget baseline remain owner decisions.
 */
function requireProjectOwnerForRegistry(
  req: Parameters<RequestHandler>[0],
  _res: Parameters<RequestHandler>[1],
  next: Parameters<RequestHandler>[2],
): void {
  try {
    const ownerControlled: OwnerManagementResource[] = [
      "projects",
      "project-members",
      "phases",
      "phase-dependencies",
      "budget-lines",
    ];
    if (
      req.method !== "GET" &&
      ownerControlled.includes(resourceOf(req)) &&
      !req.membership!.isOwner
    )
      throw new ForbiddenError(
        "Only the workspace owner can change the project plan or budget",
      );
    next();
  } catch (error) {
    next(error);
  }
}

function validateOwnerManagementBody(
  mode: "create" | "update",
): RequestHandler {
  return (req, _res, next) => {
    try {
      req.body = parseOwnerManagementBody(resourceOf(req), req.body, mode);
      next();
    } catch (error) {
      next(error);
    }
  };
}

ownerManagementRoutes.get(
  "/organizations/:orgSlug/owner-management/dashboard",
  ...inOrganization,
  requireOwner,
  requirePermission("projects.read"),
  validate({ query: ownerManagementDashboardQuery }),
  controller.ownerDashboard,
);

ownerManagementRoutes.get(
  "/organizations/:orgSlug/owner-management/projects/:projectId/summary",
  ...inOrganization,
  requirePermission("projects.read"),
  validate({ params: ownerManagementProjectParams }),
  controller.projectSummary,
);

ownerManagementRoutes.get(
  "/organizations/:orgSlug/owner-management/projects/:projectId/activity",
  ...inOrganization,
  requirePermission("projects.read"),
  validate({ params: ownerManagementProjectParams }),
  controller.projectActivity,
);

ownerManagementRoutes.get(
  "/organizations/:orgSlug/owner-management/projects/:projectId/export.pdf",
  ...inOrganization,
  requireOwner,
  requirePermission("projects.read"),
  validate({ params: ownerManagementProjectParams }),
  controller.exportProjectPdf,
);
ownerManagementRoutes.get(
  "/organizations/:orgSlug/owner-management/projects/:projectId/export.xlsx",
  ...inOrganization,
  requireOwner,
  requirePermission("projects.read"),
  validate({ params: ownerManagementProjectParams }),
  controller.exportProjectWorkbook,
);

ownerManagementRoutes.get(
  "/organizations/:orgSlug/owner-management/documents/:documentId/access",
  ...inOrganization,
  requireOwner,
  requirePermission("documents.read"),
  validate({ params: ownerManagementDocumentAccessParams }),
  controller.getDocumentAccess,
);

ownerManagementRoutes.patch(
  "/organizations/:orgSlug/owner-management/documents/:documentId/access",
  ...inOrganization,
  requireOwner,
  requirePermission("documents.update"),
  validate({
    params: ownerManagementDocumentAccessParams,
    body: documentAccessBody,
  }),
  controller.updateDocumentAccess,
);

ownerManagementRoutes.patch(
  "/organizations/:orgSlug/owner-management/documents/:documentId/category",
  ...inOrganization,
  requireOwner,
  requirePermission("documents.update"),
  validate({
    params: ownerManagementDocumentAccessParams,
    body: documentCategoryAssignmentBody,
  }),
  controller.assignDocumentCategory,
);
ownerManagementRoutes.get(
  "/organizations/:orgSlug/owner-management/document-categories",
  ...inOrganization,
  requirePermission("documents.read"),
  controller.listDocumentCategories,
);

ownerManagementRoutes.post(
  "/organizations/:orgSlug/owner-management/document-categories",
  ...inOrganization,
  requireOwner,
  requirePermission("documents.create"),
  validate({ body: documentCategoryCreateBody }),
  controller.createDocumentCategory,
);

ownerManagementRoutes.patch(
  "/organizations/:orgSlug/owner-management/document-categories/:categoryId",
  ...inOrganization,
  requireOwner,
  requirePermission("documents.update"),
  validate({
    params: ownerManagementDocumentCategoryParams,
    body: documentCategoryUpdateBody,
  }),
  controller.updateDocumentCategory,
);

ownerManagementRoutes.delete(
  "/organizations/:orgSlug/owner-management/document-categories/:categoryId",
  ...inOrganization,
  requireOwner,
  requirePermission("documents.update"),
  validate({ params: ownerManagementDocumentCategoryParams }),
  controller.archiveDocumentCategory,
);
ownerManagementRoutes.get(
  "/organizations/:orgSlug/owner-management/tasks/:taskId/documents",
  ...inOrganization,
  requirePermission("tasks.read"),
  validate({ params: ownerManagementTaskDocumentParams }),
  controller.listTaskDocuments,
);

ownerManagementRoutes.put(
  "/organizations/:orgSlug/owner-management/tasks/:taskId/documents",
  ...inOrganization,
  requirePermission("tasks.update"),
  requirePermission("documents.read"),
  validate({
    params: ownerManagementTaskDocumentParams,
    body: taskDocumentLinksBody,
  }),
  controller.replaceTaskDocuments,
);
ownerManagementRoutes.post(
  "/organizations/:orgSlug/owner-management/approvals/:recordId/decide",
  ...inOrganization,
  requireOwner,
  validate({
    params: ownerManagementDecisionParams,
    body: approvalDecisionBody,
  }),
  (req, _res, next) => {
    const decision = (req.body as { decision: string }).decision;
    const permission =
      decision === "rejected" ? "approvals.reject" : "approvals.approve";
    if (!req.membership!.permissions.includes(permission))
      return next(
        new ForbiddenError(
          "You do not have permission to decide this approval",
          { required: [permission] },
        ),
      );
    next();
  },
  controller.decideApproval,
);

ownerManagementRoutes.get(
  "/organizations/:orgSlug/owner-management/inventory-stock",
  ...inOrganization,
  requirePermission("inventory.stock.read"),
  validate({ query: inventoryStockQuery }),
  controller.listInventoryStockBalances,
);
ownerManagementRoutes.get(
  "/organizations/:orgSlug/owner-management/:resource",
  ...inOrganization,
  validate({
    params: ownerManagementResourceParams,
    query: ownerManagementListQuery,
  }),
  requireProjectOwnerForRegistry,
  requireOwnerManagementPermission("read"),
  controller.listOwnerManagementRecords,
);

ownerManagementRoutes.post(
  "/organizations/:orgSlug/owner-management/:resource",
  ...inOrganization,
  validate({ params: ownerManagementResourceParams }),
  requireProjectOwnerForRegistry,
  requireOwnerManagementPermission("create"),
  validateOwnerManagementBody("create"),
  controller.createOwnerManagementRecord,
);

ownerManagementRoutes.get(
  "/organizations/:orgSlug/owner-management/:resource/:recordId",
  authenticate,
  validate({ params: ownerManagementRecordParams }),
  requireOrganization,
  requireProjectOwnerForRegistry,
  requireOwnerManagementPermission("read"),
  controller.getOwnerManagementRecord,
);

ownerManagementRoutes.patch(
  "/organizations/:orgSlug/owner-management/:resource/:recordId",
  authenticate,
  validate({ params: ownerManagementRecordParams }),
  requireOrganization,
  requireProjectOwnerForRegistry,
  requireOwnerManagementPermission("update"),
  validateOwnerManagementBody("update"),
  controller.updateOwnerManagementRecord,
);

ownerManagementRoutes.delete(
  "/organizations/:orgSlug/owner-management/:resource/:recordId",
  authenticate,
  validate({ params: ownerManagementRecordParams }),
  requireOrganization,
  requireProjectOwnerForRegistry,
  requireOwnerManagementPermission("delete"),
  controller.deleteOwnerManagementRecord,
);
