import type { Request, RequestHandler } from "express";
import { evaluateAutomaticAlerts } from "../alerts/alert-engine.service";
import * as service from "./owner-management.service";
import type {
  InventoryStockQuery,
  OwnerManagementListQuery,
  OwnerManagementResource,
} from "./owner-management.validation";

function contextOf(req: Request): service.OwnerManagementContext {
  return {
    organizationId: req.organization!.id,
    userId: req.user!.id,
    memberId: req.membership!.memberId,
    isOwner: req.membership!.isOwner,
  };
}

function parameter(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

const alertingResources = new Set<OwnerManagementResource>([
  "tasks",
  "maintenance-plans",
  "maintenance-work-orders",
]);
async function refreshAlerts(req: Request, resource: OwnerManagementResource) {
  if (alertingResources.has(resource))
    await evaluateAutomaticAlerts(
      contextOf(req),
      resource === "tasks" ? ["projects"] : ["maintenance"],
    );
}
function resourceOf(req: Request): OwnerManagementResource {
  return parameter(req, "resource") as OwnerManagementResource;
}

export const listOwnerManagementRecords: RequestHandler = async (req, res) => {
  res.json({
    resource: resourceOf(req),
    records: await service.listOwnerManagementRecords(
      contextOf(req),
      resourceOf(req),
      req.query as unknown as OwnerManagementListQuery,
    ),
  });
};

export const listInventoryStockBalances: RequestHandler = async (req, res) => {
  res.json({
    records: await service.listInventoryStockBalances(
      contextOf(req),
      req.query as unknown as InventoryStockQuery,
    ),
  });
};
export const getOwnerManagementRecord: RequestHandler = async (req, res) => {
  res.json({
    record: await service.getOwnerManagementRecord(
      contextOf(req),
      resourceOf(req),
      parameter(req, "recordId"),
    ),
  });
};

export const createOwnerManagementRecord: RequestHandler = async (req, res) => {
  const record = await service.createOwnerManagementRecord(
    contextOf(req),
    resourceOf(req),
    req.body,
  );
  await refreshAlerts(req, resourceOf(req));
  res.status(201).json({ record });
};

export const updateOwnerManagementRecord: RequestHandler = async (req, res) => {
  const resource = resourceOf(req);
  const record = await service.updateOwnerManagementRecord(
    contextOf(req),
    resource,
    parameter(req, "recordId"),
    req.body,
  );
  await refreshAlerts(req, resource);
  res.json({ record });
};

export const deleteOwnerManagementRecord: RequestHandler = async (req, res) => {
  await service.deleteOwnerManagementRecord(
    contextOf(req),
    resourceOf(req),
    parameter(req, "recordId"),
  );
  res.status(204).send();
};

export const assignDocumentCategory: RequestHandler = async (req, res) => {
  res.json({
    document: await service.assignDocumentCategory(
      contextOf(req),
      parameter(req, "documentId"),
      (
        req.body as import("./owner-management.validation").DocumentCategoryAssignmentInput
      ).categoryId,
    ),
  });
};
export const listDocumentCategories: RequestHandler = async (req, res) => {
  res.json({
    categories: await service.listDocumentCategories(
      contextOf(req),
      req.query.includeInactive === "true",
    ),
  });
};
export const createDocumentCategory: RequestHandler = async (req, res) => {
  res.status(201).json({
    category: await service.createDocumentCategory(
      contextOf(req),
      req.body as import("./owner-management.validation").DocumentCategoryCreateInput,
    ),
  });
};
export const updateDocumentCategory: RequestHandler = async (req, res) => {
  res.json({
    category: await service.updateDocumentCategory(
      contextOf(req),
      parameter(req, "categoryId"),
      req.body as import("./owner-management.validation").DocumentCategoryUpdateInput,
    ),
  });
};
export const archiveDocumentCategory: RequestHandler = async (req, res) => {
  await service.archiveDocumentCategory(
    contextOf(req),
    parameter(req, "categoryId"),
  );
  res.status(204).send();
};
export const getDocumentAccess: RequestHandler = async (req, res) => {
  res.json({
    access: await service.getDocumentAccess(
      contextOf(req),
      parameter(req, "documentId"),
    ),
  });
};

export const updateDocumentAccess: RequestHandler = async (req, res) => {
  res.json({
    access: await service.updateDocumentAccess(
      contextOf(req),
      parameter(req, "documentId"),
      req.body as import("./owner-management.validation").DocumentAccessInput,
    ),
  });
};
export const listTaskDocuments: RequestHandler = async (req, res) => {
  res.json({
    documents: await service.listTaskDocuments(
      contextOf(req),
      parameter(req, "taskId"),
    ),
  });
};

export const replaceTaskDocuments: RequestHandler = async (req, res) => {
  const body = req.body as { documentIds: string[] };
  res.json({
    documents: await service.replaceTaskDocuments(
      contextOf(req),
      parameter(req, "taskId"),
      body.documentIds,
    ),
  });
};
export const ownerDashboard: RequestHandler = async (req, res) => {
  res.json({
    dashboard: await service.ownerDashboard(contextOf(req), req.query),
  });
};

export const projectSummary: RequestHandler = async (req, res) => {
  res.json({
    project: await service.projectSummary(
      contextOf(req),
      parameter(req, "projectId"),
    ),
  });
};

export const projectActivity: RequestHandler = async (req, res) => {
  res.json({
    activity: await service.projectActivity(
      contextOf(req),
      parameter(req, "projectId"),
    ),
  });
};

export const exportProjectPdf: RequestHandler = async (req, res) => {
  const report = await service.exportProjectPdf(
    contextOf(req),
    parameter(req, "projectId"),
  );
  res
    .status(200)
    .type("application/pdf")
    .attachment(report.filename)
    .send(report.buffer);
};
export const exportProjectWorkbook: RequestHandler = async (req, res) => {
  const workbook = await service.exportProjectWorkbook(
    contextOf(req),
    parameter(req, "projectId"),
  );
  res
    .status(200)
    .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .attachment(workbook.filename)
    .send(workbook.buffer);
};
export const decideApproval: RequestHandler = async (req, res) => {
  const body = req.body as {
    decision: "approved" | "rejected" | "partially_approved";
    decisionNotes?: string;
    approvedAmount?: number;
  };
  res.json({
    approval: await service.decideApproval(
      contextOf(req),
      parameter(req, "recordId"),
      body.decision,
      body.decisionNotes,
      body.approvedAmount,
    ),
  });
};
