import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import { calculateProjectBudget } from "./project-budget";
import {
  calculateProductionProfitability,
  emptyProductionCostBreakdown,
  productionCostCategories,
  type ProductionCostBreakdown,
  type ProductionCostCategory,
} from "./project-profitability";
import { calculateProjectDecisionSimulation } from "./project-decision-simulation";
import {
  createNotificationInTransaction,
  notifyOrganizationOwnersInTransaction,
} from "../notifications/notifications.service";
import {
  assertDocumentPolicy,
  visibleDocumentIds,
} from "../../services/document-access.service";
import type {
  DocumentAccessInput,
  DocumentCategoryAssignmentInput,
  DocumentCategoryCreateInput,
  DocumentCategoryUpdateInput,
  EquipmentCategoryCreateInput,
  EquipmentCategoryUpdateInput,
  InventoryMovementHistoryPdfQuery,
  InventoryStockQuery,
  MyTaskUpdateInput,
  OwnerManagementListQuery,
  ProjectAnalyticsQuery,
  ProjectDecisionSimulationInput,
  ProcurementDocumentType,
  OwnerManagementResource,
} from "./owner-management.validation";

export interface OwnerManagementContext {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
}

type Row = Record<string, unknown>;
type Input = Record<string, unknown>;
type Scope = "organization" | "province" | "project" | "self";

interface ResourceConfig {
  table: string;
  fields: readonly string[];
  scopeFrom: string;
  scopeSelect: string;
  projectField?: string;
  provinceField?: string;
  siteField?: string;
  statusField?: string;
  dateField?: string;
  sortField?: string;
  immutable?: boolean;
  readOnly?: boolean;
  deleteProtected?: boolean;
}

const snake = (name: string) =>
  name.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase());
const camel = (name: string) =>
  name.replace(/_([a-z0-9])/g, (_, character: string) =>
    character.toUpperCase(),
  );
const stockOutboundMovementTypes = new Set([
  "issue",
  "adjustment_out",
  "transfer_out",
  "maintenance_issue",
]);

function normalizedStockMovementDelta(
  movementType: unknown,
  quantity: unknown,
): unknown {
  const parsed = Number(quantity);
  if (!Number.isFinite(parsed) || parsed === 0) return quantity;
  const absolute = Math.abs(parsed);
  return stockOutboundMovementTypes.has(String(movementType))
    ? -absolute
    : absolute;
}

function supplierCode(value: unknown, supplierName: unknown): string {
  const normalize = (source: unknown) =>
    String(source ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  const valid = (source: string) => {
    const prefixed = /^[a-z]/.test(source) ? source : `fournisseur_${source}`;
    const trimmed = prefixed.slice(0, 63).replace(/_+$/g, "");
    return trimmed.length >= 2 ? trimmed : "fournisseur";
  };
  const typed = normalize(value);
  if (typed) return valid(typed);
  const name = normalize(supplierName) || "fournisseur";
  const suffix = randomUUID().replace(/-/g, "").slice(0, 6);
  return valid(`fournisseur_${name.slice(0, 44)}_${suffix}`);
}

function warehouseCode(value: unknown, warehouseName: unknown): string {
  const normalize = (source: unknown) =>
    String(source ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  const valid = (source: string) => {
    const prefixed = /^[a-z]/.test(source) ? source : `entrepot_${source}`;
    const trimmed = prefixed.slice(0, 63).replace(/_+$/g, "");
    return trimmed.length >= 2 ? trimmed : "entrepot";
  };
  const typed = normalize(value);
  if (typed) return valid(typed);
  const name = normalize(warehouseName) || "stock";
  const suffix = randomUUID().replace(/-/g, "").slice(0, 6);
  return valid(`entrepot_${name.slice(0, 42)}_${suffix}`);
}

function mapRow(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      camel(key),
      value instanceof Date
        ? value.toISOString().slice(0, key.endsWith("_at") ? undefined : 10)
        : value,
    ]),
  );
}

/** Stored-provider locations never leave ordinary document APIs. Preview and
 * download must go through the access-checked file endpoint instead. */
function redactDocumentStorage(row: Row): Row {
  const { storageKey, storagePublicId, storageUrl, ...safe } = row;
  return safe;
}

const projectScope =
  "r.project_id AS project_id, p.province_id AS province_id, NULL::uuid AS assigned_member_id";
const projectJoin =
  " JOIN management_projects p ON p.organization_id = r.organization_id AND p.id = r.project_id";
const assetScope =
  "r.project_id AS project_id, r.province_id AS province_id, NULL::uuid AS assigned_member_id";

const resources: Record<OwnerManagementResource, ResourceConfig> = {
  projects: {
    table: "management_projects",
    fields: [
      "code",
      "name",
      "description",
      "projectType",
      "provinceId",
      "siteId",
      "departmentId",
      "responsibleMemberId",
      "benefitOwnerMemberId",
      "startDate",
      "operationalStartDate",
      "benefitReviewDate",
      "targetCompletionDate",
      "revisedCompletionDate",
      "completedDate",
      "lifecycleStage",
      "status",
      "priority",
      "estimatedTotalBudget",
      "currencyCode",
      "progressPercent",
      "blueprint",
      "fundingSource",
      "expectedOutcome",
      "benefitTargets",
      "approvalRequired",
      "notes",
      "createdByUserId",
    ],
    scopeFrom: "management_projects r",
    scopeSelect:
      "r.id AS project_id, r.province_id AS province_id, NULL::uuid AS assigned_member_id",
    provinceField: "province_id",
    statusField: "status",
    dateField: "start_date",
  },
  "project-members": {
    table: "management_project_members",
    fields: [
      "projectId",
      "memberId",
      "assignmentRole",
      "isManager",
      "assignmentStartDate",
      "assignmentEndDate",
      "assignedBy",
      "notes",
    ],
    scopeFrom: "management_project_members r" + projectJoin,
    scopeSelect: projectScope,
    projectField: "project_id",
    sortField: "assigned_at",
  },
  "operational-links": {
    table: "management_project_operational_links",
    fields: [
      "projectId",
      "moduleCode",
      "resourceCode",
      "recordId",
      "linkType",
      "notes",
      "linkedByMemberId",
    ],
    scopeFrom: "management_project_operational_links r" + projectJoin,
    scopeSelect: projectScope,
    projectField: "project_id",
  },
  phases: {
    table: "management_project_phases",
    fields: [
      "projectId",
      "code",
      "name",
      "description",
      "phaseOrder",
      "responsibleMemberId",
      "startDate",
      "actualStartDate",
      "targetEndDate",
      "completedDate",
      "status",
      "priority",
      "plannedBudget",
      "progressPercent",
      "notes",
    ],
    scopeFrom: "management_project_phases r" + projectJoin,
    scopeSelect: projectScope,
    projectField: "project_id",
    statusField: "status",
    dateField: "start_date",
  },
  "phase-dependencies": {
    table: "management_project_phase_dependencies",
    fields: [
      "phaseId",
      "dependsOnPhaseId",
      "dependencyType",
      "createdByMemberId",
    ],
    scopeFrom:
      "management_project_phase_dependencies r JOIN management_project_phases ph ON ph.organization_id = r.organization_id AND ph.id = r.phase_id JOIN management_projects p ON p.organization_id = ph.organization_id AND p.id = ph.project_id",
    scopeSelect:
      "ph.project_id AS project_id, p.province_id AS province_id, NULL::uuid AS assigned_member_id",
    immutable: true,
  },
  risks: {
    table: "management_project_risks",
    fields: [
      "projectId",
      "code",
      "recordType",
      "category",
      "title",
      "description",
      "probability",
      "impact",
      "ownerMemberId",
      "triggerCondition",
      "alertThreshold",
      "preventionAction",
      "contingencyAction",
      "reviewDate",
      "status",
      "triggeredAt",
      "resolvedAt",
      "decision",
      "decisionTaken",
      "decisionJustification",
      "decidedByMemberId",
      "decidedAt",
      "createdByMemberId",
      "notes",
    ],
    scopeFrom: "management_project_risks r" + projectJoin,
    scopeSelect: projectScope,
    projectField: "project_id",
    statusField: "status",
    dateField: "review_date",
    sortField: "review_date",
    deleteProtected: true,
  },
  "quality-checks": {
    table: "management_project_quality_checks",
    fields: [
      "projectId",
      "receiptId",
      "assetId",
      "checkNumber",
      "qualityStatus",
      "quantityMatches",
      "conditionAccepted",
      "documentsComplete",
      "functionalTestPassed",
      "safetyCheckPassed",
      "returnedQuantity",
      "returnReason",
      "warrantyProvider",
      "warrantyReference",
      "warrantyExpiresOn",
      "beforePhotoDocumentId",
      "afterPhotoDocumentId",
      "checkedByMemberId",
      "checkedAt",
      "commissioningStatus",
      "commissionedByMemberId",
      "commissionedAt",
      "commissioningNotes",
      "notes",
    ],
    scopeFrom: "management_project_quality_checks r" + projectJoin,
    scopeSelect: projectScope,
    projectField: "project_id",
    statusField: "quality_status",
    dateField: "checked_at",
    deleteProtected: true,
  },
  "project-closeouts": {
    table: "management_project_closeouts",
    fields: [
      "projectId",
      "status",
      "expectedOutcomeAchieved",
      "achievementSummary",
      "actualOutcome",
      "lessonsLearned",
      "handoverMemberId",
      "commissioningValidated",
      "commissioningSummary",
      "closeoutDocumentId",
      "preparedByMemberId",
      "approvedByMemberId",
      "completedAt",
      "notes",
    ],
    scopeFrom: "management_project_closeouts r" + projectJoin,
    scopeSelect: projectScope,
    projectField: "project_id",
    statusField: "status",
    dateField: "completed_at",
    deleteProtected: true,
  },
  tasks: {
    table: "management_project_tasks",
    fields: [
      "projectId",
      "provinceId",
      "siteId",
      "phaseId",
      "budgetCurrencyCode",
      "budgetOverrideReason",
      "taskType",
      "code",
      "title",
      "description",
      "assignedMemberId",
      "assignedDepartmentId",
      "startDate",
      "dueDate",
      "completedDate",
      "priority",
      "status",
      "progressPercent",
      "estimatedCost",
      "blockedReason",
      "notes",
      "createdByUserId",
    ],
    // A task can be project-linked or normal company work. Project geography
    // takes precedence; normal work stores its own province/site.
    scopeFrom:
      "management_project_tasks r LEFT JOIN management_projects p ON p.organization_id = r.organization_id AND p.id = r.project_id",
    scopeSelect:
      "r.project_id AS project_id, COALESCE(p.province_id, r.province_id) AS province_id, r.assigned_member_id AS assigned_member_id",
    projectField: "project_id",
    statusField: "status",
    dateField: "due_date",
  },
  "task-dependencies": {
    table: "management_task_dependencies",
    fields: ["taskId", "dependsOnTaskId", "dependencyType"],
    scopeFrom:
      "management_task_dependencies r JOIN management_project_tasks t ON t.organization_id = r.organization_id AND t.id = r.task_id JOIN management_projects p ON p.organization_id = t.organization_id AND p.id = t.project_id",
    scopeSelect:
      "t.project_id AS project_id, p.province_id AS province_id, NULL::uuid AS assigned_member_id",
    immutable: true,
  },
  "budget-lines": {
    table: "management_project_budget_lines",
    fields: [
      "projectId",
      "provinceId",
      "siteId",
      "phaseId",
      "category",
      "description",
      "plannedAmount",
      "currencyCode",
      "notes",
    ],
    scopeFrom: "management_project_budget_lines r" + projectJoin,
    scopeSelect: projectScope,
    projectField: "project_id",
    readOnly: true,
    immutable: true,
  },
  materials: {
    table: "management_project_materials",
    fields: [
      "projectId",
      "provinceId",
      "siteId",
      "phaseId",
      "inventoryItemId",
      "defaultWarehouseId",
      "preferredSupplierId",
      "code",
      "name",
      "category",
      "unit",
      "plannedQuantity",
      "estimatedUnitCost",
      "notes",
    ],
    scopeFrom: "management_project_materials r" + projectJoin,
    scopeSelect: projectScope,
    projectField: "project_id",
  },
  "material-movements": {
    table: "management_material_movements",
    fields: [
      "projectMaterialId",
      "warehouseId",
      "movementDate",
      "movementType",
      "quantity",
      "usedByMemberId",
      "issuedByMemberId",
      "projectTaskId",
      "notes",
    ],
    scopeFrom:
      "management_material_movements r JOIN management_project_materials pm ON pm.organization_id = r.organization_id AND pm.id = r.project_material_id JOIN management_projects p ON p.organization_id = pm.organization_id AND p.id = pm.project_id",
    scopeSelect:
      "pm.project_id AS project_id, p.province_id AS province_id, NULL::uuid AS assigned_member_id",
    immutable: true,
  },
  suppliers: {
    table: "management_suppliers",
    fields: [
      "code",
      "name",
      "supplierType",
      "contactName",
      "email",
      "phone",
      "taxNumber",
      "address",
      "status",
      "notes",
    ],
    scopeFrom: "management_suppliers r",
    scopeSelect:
      "NULL::uuid AS project_id, NULL::uuid AS province_id, NULL::uuid AS assigned_member_id",
    statusField: "status",
  },
  "inventory-items": {
    table: "management_inventory_items",
    fields: [
      "code",
      "name",
      "category",
      "unit",
      "reorderLevel",
      "standardUnitCost",
      "isActive",
      "notes",
    ],
    scopeFrom: "management_inventory_items r",
    scopeSelect:
      "NULL::uuid AS project_id, NULL::uuid AS province_id, NULL::uuid AS assigned_member_id",
  },
  warehouses: {
    table: "management_warehouses",
    fields: ["siteId", "code", "name", "managerMemberId", "isActive", "notes"],
    scopeFrom:
      "management_warehouses r JOIN sites s ON s.organization_id = r.organization_id AND s.id = r.site_id",
    scopeSelect:
      "NULL::uuid AS project_id, s.province_id AS province_id, NULL::uuid AS assigned_member_id",
    siteField: "site_id",
  },
  "stock-movements": {
    table: "management_inventory_stock_movements",
    fields: [
      "warehouseId",
      "itemId",
      "projectId",
      "projectMaterialId",
      "movementDate",
      "movementType",
      "quantityDelta",
      "unitCost",
      "referenceType",
      "referenceId",
      "performedByMemberId",
      "notes",
    ],
    scopeFrom:
      "management_inventory_stock_movements r LEFT JOIN management_projects p ON p.organization_id = r.organization_id AND p.id = r.project_id LEFT JOIN management_warehouses w ON w.organization_id = r.organization_id AND w.id = r.warehouse_id LEFT JOIN sites s ON s.organization_id = w.organization_id AND s.id = w.site_id",
    scopeSelect:
      "r.project_id AS project_id, COALESCE(p.province_id, s.province_id) AS province_id, NULL::uuid AS assigned_member_id",
    projectField: "project_id",
    dateField: "movement_date",
    immutable: true,
  },
  "feed-batches": {
    table: "management_feed_batches",
    fields: [
      "projectId",
      "siteId",
      "warehouseId",
      "batchNumber",
      "feedName",
      "targetSpecies",
      "productionDate",
      "outputItemId",
      "outputQuantityKg",
      "bagWeightKg",
      "bagCount",
      "status",
      "producedByMemberId",
      "notes",
    ],
    scopeFrom:
      "management_feed_batches r JOIN sites s ON s.organization_id = r.organization_id AND s.id = r.site_id LEFT JOIN management_projects p ON p.organization_id = r.organization_id AND p.id = r.project_id",
    scopeSelect:
      "r.project_id AS project_id, s.province_id AS province_id, NULL::uuid AS assigned_member_id",
    projectField: "project_id",
    siteField: "site_id",
    statusField: "status",
    dateField: "production_date",
  },
  "feed-batch-inputs": {
    table: "management_feed_batch_inputs",
    fields: [
      "batchId",
      "sourceType",
      "harvestRecordId",
      "inventoryItemId",
      "warehouseId",
      "quantityKg",
      "unitCost",
      "notes",
    ],
    scopeFrom:
      "management_feed_batch_inputs r JOIN management_feed_batches b ON b.organization_id = r.organization_id AND b.id = r.batch_id JOIN sites s ON s.organization_id = b.organization_id AND s.id = b.site_id",
    scopeSelect:
      "b.project_id AS project_id, s.province_id AS province_id, NULL::uuid AS assigned_member_id",
  },
  "nutrition-profiles": {
    table: "nutrition_feed_profiles",
    fields: [
      "code",
      "species",
      "stage",
      "minAgeDays",
      "maxAgeDays",
      "dailyRationKg",
      "rationMode",
      "benchmarkFcr",
      "isActive",
      "notes",
    ],
    scopeFrom: "nutrition_feed_profiles r",
    scopeSelect:
      "NULL::uuid AS project_id, NULL::uuid AS province_id, NULL::uuid AS assigned_member_id",
  },
  "feed-recipes": {
    table: "nutrition_feed_recipes",
    fields: [
      "code",
      "name",
      "targetSpecies",
      "feedStage",
      "baseQuantityKg",
      "outputItemId",
      "overheadPerKg",
      "isActive",
      "notes",
      "createdByMemberId",
    ],
    scopeFrom: "nutrition_feed_recipes r",
    scopeSelect:
      "NULL::uuid AS project_id, NULL::uuid AS province_id, NULL::uuid AS assigned_member_id",
  },
  "feed-recipe-lines": {
    table: "nutrition_feed_recipe_lines",
    fields: [
      "recipeId",
      "inventoryItemId",
      "ingredientName",
      "unit",
      "quantityPerBase",
      "unitCostOverride",
      "sortOrder",
      "notes",
    ],
    scopeFrom:
      "nutrition_feed_recipe_lines r JOIN nutrition_feed_recipes recipe ON recipe.organization_id = r.organization_id AND recipe.id = r.recipe_id",
    scopeSelect:
      "NULL::uuid AS project_id, NULL::uuid AS province_id, NULL::uuid AS assigned_member_id",
  },
  "feed-orders": {
    table: "nutrition_feed_orders",
    fields: [
      "orderNumber",
      "recipeId",
      "projectId",
      "siteId",
      "inputWarehouseId",
      "outputWarehouseId",
      "outputItemId",
      "plannedQuantityKg",
      "actualQuantityKg",
      "bagWeightKg",
      "overheadTotal",
      "productionDate",
      "status",
      "producedByMemberId",
      "notes",
    ],
    scopeFrom:
      "nutrition_feed_orders r JOIN sites s ON s.organization_id = r.organization_id AND s.id = r.site_id LEFT JOIN management_projects p ON p.organization_id = r.organization_id AND p.id = r.project_id",
    scopeSelect:
      "r.project_id AS project_id, s.province_id AS province_id, NULL::uuid AS assigned_member_id",
    projectField: "project_id",
    siteField: "site_id",
    statusField: "status",
    dateField: "production_date",
  },
  "purchase-requests": {
    table: "management_purchase_requests",
    fields: [
      "requestNumber",
      "projectId",
      "provinceId",
      "siteId",
      "phaseId",
      "projectTaskId",
      "requestedByMemberId",
      "reviewedByMemberId",
      "supplierId",
      "requestDate",
      "requiredDate",
      "priority",
      "status",
      "approvalStatus",
      "reason",
      "currencyCode",
      "notes",
    ],
    scopeFrom: "management_purchase_requests r" + projectJoin,
    scopeSelect: projectScope,
    projectField: "project_id",
    statusField: "status",
    dateField: "request_date",
  },
  "purchase-request-lines": {
    table: "management_purchase_request_lines",
    fields: [
      "purchaseRequestId",
      "projectMaterialId",
      "inventoryItemId",
      "description",
      "itemKind",
      "unit",
      "requestedQuantity",
      "approvedQuantity",
      "estimatedUnitCost",
      "notes",
    ],
    scopeFrom:
      "management_purchase_request_lines r JOIN management_purchase_requests pr ON pr.organization_id = r.organization_id AND pr.id = r.purchase_request_id JOIN management_projects p ON p.organization_id = pr.organization_id AND p.id = pr.project_id",
    scopeSelect:
      "pr.project_id AS project_id, p.province_id AS province_id, NULL::uuid AS assigned_member_id",
  },
  "purchase-orders": {
    table: "management_purchase_orders",
    fields: [
      "orderNumber",
      "projectId",
      "provinceId",
      "siteId",
      "phaseId",
      "projectTaskId",
      "purchaseRequestId",
      "supplierId",
      "warehouseId",
      "orderedByMemberId",
      "orderDate",
      "expectedDeliveryDate",
      "status",
      "currencyCode",
      "supplierReference",
      "deliveryAddress",
      "notes",
      "budgetOverrideReason",
    ],
    scopeFrom: "management_purchase_orders r" + projectJoin,
    scopeSelect: projectScope,
    projectField: "project_id",
    statusField: "status",
    dateField: "order_date",
  },
  "purchase-order-lines": {
    table: "management_purchase_order_lines",
    fields: [
      "purchaseOrderId",
      "purchaseRequestLineId",
      "projectMaterialId",
      "inventoryItemId",
      "description",
      "itemKind",
      "unit",
      "orderedQuantity",
      "unitCost",
      "taxAmount",
      "assetName",
      "assetCategory",
      "notes",
    ],
    scopeFrom:
      "management_purchase_order_lines r JOIN management_purchase_orders po ON po.organization_id = r.organization_id AND po.id = r.purchase_order_id JOIN management_projects p ON p.organization_id = po.organization_id AND p.id = po.project_id",
    scopeSelect:
      "po.project_id AS project_id, p.province_id AS province_id, NULL::uuid AS assigned_member_id",
  },
  receipts: {
    table: "management_receipts",
    fields: [
      "receiptNumber",
      "purchaseOrderId",
      "projectId",
      "warehouseId",
      "receivedByMemberId",
      "receivedDate",
      "deliveryNoteNumber",
      "status",
      "notes",
      "budgetOverrideReason",
    ],
    scopeFrom: "management_receipts r" + projectJoin,
    scopeSelect: projectScope,
    projectField: "project_id",
    statusField: "status",
    dateField: "received_date",
  },
  "receipt-lines": {
    table: "management_receipt_lines",
    fields: [
      "receiptId",
      "purchaseOrderLineId",
      "projectMaterialId",
      "inventoryItemId",
      "receivedQuantity",
      "damagedQuantity",
      "rejectedQuantity",
      "actualUnitCost",
      "assetRequired",
      "assetName",
      "assetCategory",
      "receiverNotes",
    ],
    scopeFrom:
      "management_receipt_lines r JOIN management_receipts re ON re.organization_id = r.organization_id AND re.id = r.receipt_id JOIN management_projects p ON p.organization_id = re.organization_id AND p.id = re.project_id",
    scopeSelect:
      "re.project_id AS project_id, p.province_id AS province_id, NULL::uuid AS assigned_member_id",
  },
  assets: {
    table: "management_assets",
    fields: [
      "assetNumber",
      "projectId",
      "provinceId",
      "siteId",
      "phaseId",
      "projectTaskId",
      "provinceId",
      "siteId",
      "departmentId",
      "supplierId",
      "name",
      "category",
      "brand",
      "model",
      "serialNumber",
      "purchasePrice",
      "purchaseDate",
      "currencyCode",
      "condition",
      "status",
      "currentLocation",
      "assignedMemberId",
      "meterType",
      "currentMeterReading",
      "fuelType",
      "warrantyExpiresOn",
      "insuranceExpiresOn",
      "notes",
      "retiredAt",
    ],
    scopeFrom: "management_assets r",
    scopeSelect: assetScope,
    projectField: "project_id",
    provinceField: "province_id",
    siteField: "site_id",
    statusField: "status",
  },
  "asset-assignments": {
    table: "management_asset_assignments",
    fields: [
      "assetId",
      "assignedMemberId",
      "assignedProjectId",
      "assignedSiteId",
      "assignedByMemberId",
      "assignedAt",
      "returnedAt",
      "conditionOut",
      "conditionIn",
      "notes",
    ],
    scopeFrom:
      "management_asset_assignments r JOIN management_assets a ON a.organization_id = r.organization_id AND a.id = r.asset_id",
    scopeSelect:
      "a.project_id AS project_id, a.province_id AS province_id, NULL::uuid AS assigned_member_id",
  },
  "asset-movements": {
    table: "management_asset_movements",
    fields: [
      "assetId",
      "fromSiteId",
      "toSiteId",
      "fromLocation",
      "toLocation",
      "movedByMemberId",
      "movedAt",
      "reason",
      "notes",
    ],
    scopeFrom:
      "management_asset_movements r JOIN management_assets a ON a.organization_id = r.organization_id AND a.id = r.asset_id",
    scopeSelect:
      "a.project_id AS project_id, a.province_id AS province_id, NULL::uuid AS assigned_member_id",
    immutable: true,
  },
  "asset-usage": {
    table: "management_asset_usage_logs",
    fields: [
      "assetId",
      "projectId",
      "siteId",
      "operatorMemberId",
      "usageDate",
      "meterStart",
      "meterEnd",
      "fuelConsumed",
      "fuelUnit",
      "workPerformed",
      "areaCovered",
      "inputQuantity",
      "outputQuantity",
      "quantityUnit",
      "downtimeMinutes",
      "problemReported",
      "notes",
    ],
    scopeFrom:
      "management_asset_usage_logs r JOIN management_assets a ON a.organization_id = r.organization_id AND a.id = r.asset_id LEFT JOIN management_projects p ON p.organization_id = r.organization_id AND p.id = COALESCE(r.project_id, a.project_id)",
    scopeSelect:
      "COALESCE(r.project_id, a.project_id) AS project_id, COALESCE(p.province_id, a.province_id) AS province_id, NULL::uuid AS assigned_member_id",
    projectField: "project_id",
    immutable: true,
  },
  "vehicle-profiles": {
    table: "management_vehicle_profiles",
    fields: [
      "assetId",
      "vehicleNumber",
      "registrationNumber",
      "plateNumber",
      "vehicleYear",
      "vin",
      "make",
      "model",
      "defaultDriverMemberId",
      "insuranceProvider",
      "insuranceExpiresOn",
      "registrationExpiresOn",
      "inspectionExpiresOn",
    ],
    scopeFrom:
      "management_vehicle_profiles r JOIN management_assets a ON a.organization_id = r.organization_id AND a.id = r.asset_id",
    scopeSelect:
      "a.project_id AS project_id, a.province_id AS province_id, NULL::uuid AS assigned_member_id",
  },
  "vehicle-trips": {
    table: "management_vehicle_trips",
    fields: [
      "vehicleId",
      "projectId",
      "driverMemberId",
      "tripDate",
      "destination",
      "purpose",
      "startMileage",
      "endMileage",
      "fuelUsed",
      "fuelCost",
      "notes",
    ],
    scopeFrom:
      "management_vehicle_trips r JOIN management_vehicle_profiles v ON v.organization_id = r.organization_id AND v.id = r.vehicle_id JOIN management_assets a ON a.organization_id = v.organization_id AND a.id = v.asset_id LEFT JOIN management_projects p ON p.organization_id = r.organization_id AND p.id = COALESCE(r.project_id, a.project_id)",
    scopeSelect:
      "COALESCE(r.project_id, a.project_id) AS project_id, COALESCE(p.province_id, a.province_id) AS province_id, NULL::uuid AS assigned_member_id",
    projectField: "project_id",
    dateField: "trip_date",
    immutable: true,
  },
  "maintenance-plans": {
    table: "management_maintenance_plans",
    fields: [
      "assetId",
      "name",
      "maintenanceType",
      "description",
      "intervalDays",
      "intervalMeter",
      "nextDueDate",
      "nextDueMeter",
      "serviceCategory",
      "warningWindowDays",
      "warningWindowMeter",
      "blocksDispatchWhenDue",
      "estimatedCost",
      "isActive",
      "createdByMemberId",
    ],
    scopeFrom:
      "management_maintenance_plans r JOIN management_assets a ON a.organization_id = r.organization_id AND a.id = r.asset_id",
    scopeSelect:
      "a.project_id AS project_id, a.province_id AS province_id, NULL::uuid AS assigned_member_id",
    dateField: "next_due_date",
  },
  "maintenance-work-orders": {
    table: "management_maintenance_work_orders",
    fields: [
      "workOrderNumber",
      "planId",
      "assetId",
      "projectId",
      "reportedByMemberId",
      "assignedMemberId",
      "maintenanceType",
      "status",
      "priority",
      "title",
      "problemDescription",
      "dueDate",
      "openedAt",
      "startedAt",
      "completedAt",
      "meterReading",
      "workPerformed",
      "problemFound",
      "recommendation",
      "laborCost",
      "partsCost",
      "otherCost",
      "nextDueDate",
      "nextDueMeter",
      "notes",
    ],
    scopeFrom:
      "management_maintenance_work_orders r JOIN management_assets a ON a.organization_id = r.organization_id AND a.id = r.asset_id LEFT JOIN management_projects p ON p.organization_id = r.organization_id AND p.id = COALESCE(r.project_id, a.project_id)",
    scopeSelect:
      "COALESCE(r.project_id, a.project_id) AS project_id, COALESCE(p.province_id, a.province_id) AS province_id, NULL::uuid AS assigned_member_id",
    projectField: "project_id",
    statusField: "status",
    dateField: "due_date",
  },
  "maintenance-parts": {
    table: "management_maintenance_parts",
    fields: [
      "workOrderId",
      "inventoryItemId",
      "warehouseId",
      "partName",
      "quantity",
      "unit",
      "unitCost",
      "issuedAt",
      "issuedByMemberId",
      "notes",
    ],
    scopeFrom:
      "management_maintenance_parts r JOIN management_maintenance_work_orders wo ON wo.organization_id = r.organization_id AND wo.id = r.work_order_id JOIN management_assets a ON a.organization_id = wo.organization_id AND a.id = wo.asset_id LEFT JOIN management_projects p ON p.organization_id = wo.organization_id AND p.id = COALESCE(wo.project_id, a.project_id)",
    scopeSelect:
      "COALESCE(wo.project_id, a.project_id) AS project_id, COALESCE(p.province_id, a.province_id) AS province_id, NULL::uuid AS assigned_member_id",
    immutable: true,
  },
  expenses: {
    table: "management_expenses",
    fields: [
      "expenseNumber",
      "expenseType",
      "projectId",
      "provinceId",
      "siteId",
      "phaseId",
      "projectTaskId",
      "departmentId",
      "supplierId",
      "purchaseOrderId",
      "receiptId",
      "reimbursesExpenseId",
      "title",
      "beneficiaryName",
      "category",
      "description",
      "amount",
      "currencyCode",
      "expenseDate",
      "paymentMethod",
      "paymentReference",
      "paymentIdempotencyKey",
      "paidByMemberId",
      "approvedByMemberId",
      "status",
      "receiptReference",
      "notes",
      "budgetOverrideReason",
      "submittedAt",
      "cancelledAt",
      "createdByUserId",
    ],
    scopeFrom: "management_expenses r",
    scopeSelect:
      "r.project_id AS project_id, r.province_id AS province_id, NULL::uuid AS assigned_member_id",
    projectField: "project_id",
    provinceField: "province_id",
    siteField: "site_id",
    statusField: "status",
    dateField: "expense_date",
  },
  approvals: {
    table: "management_approval_requests",
    fields: [
      "approvalNumber",
      "projectId",
      "entityType",
      "entityId",
      "requestType",
      "requestedByMemberId",
      "requestedAmount",
      "currencyCode",
      "requestNotes",
    ],
    scopeFrom:
      "management_approval_requests r LEFT JOIN management_projects p ON p.organization_id = r.organization_id AND p.id = r.project_id",
    scopeSelect:
      "r.project_id AS project_id, p.province_id AS province_id, NULL::uuid AS assigned_member_id",
    projectField: "project_id",
    statusField: "status",
    sortField: "requested_at",
    immutable: true,
  },
  incidents: {
    table: "incidents",
    fields: [
      "reference",
      "provinceId",
      "siteId",
      "occurredAt",
      "reportedAt",
      "category",
      "severity",
      "title",
      "description",
      "locationDetail",
      "employeeId",
      "otherParties",
      "injuryOccurred",
      "daysLost",
      "estimatedLoss",
      "currency",
      "status",
      "immediateAction",
      "rootCause",
      "reportedToAuthorities",
      "authorityReference",
      "reportedBy",
      "investigatedBy",
      "closedAt",
      "closedBy",
    ],
    scopeFrom: "incidents r",
    scopeSelect:
      "NULL::uuid AS project_id, r.province_id AS province_id, NULL::uuid AS assigned_member_id",
    provinceField: "province_id",
    siteField: "site_id",
    statusField: "status",
    dateField: "occurred_at",
  },
  "security-visitors": {
    table: "security_visitors",
    fields: [
      "provinceId",
      "siteId",
      "visitorName",
      "organizationName",
      "phone",
      "idNumber",
      "purpose",
      "hostEmployeeId",
      "vehiclePlate",
      "enteredAt",
      "exitedAt",
      "lastFarmVisitDays",
      "disinfected",
      "recordedBy",
      "notes",
    ],
    scopeFrom:
      "security_visitors r JOIN sites s ON s.organization_id=r.organization_id AND s.id=r.site_id",
    scopeSelect:
      "NULL::uuid AS project_id, s.province_id AS province_id, NULL::uuid AS assigned_member_id",
    siteField: "site_id",
    dateField: "entered_at",
  },
  "security-asset-movements": {
    table: "security_asset_movements",
    fields: [
      "provinceId",
      "siteId",
      "direction",
      "assetId",
      "description",
      "quantity",
      "unit",
      "authorisedBy",
      "carriedBy",
      "vehiclePlate",
      "gatePassNumber",
      "movedAt",
      "expectedReturnAt",
      "returnedAt",
      "recordedBy",
      "notes",
    ],
    scopeFrom:
      "security_asset_movements r JOIN sites s ON s.organization_id=r.organization_id AND s.id=r.site_id",
    scopeSelect:
      "NULL::uuid AS project_id, s.province_id AS province_id, NULL::uuid AS assigned_member_id",
    siteField: "site_id",
    dateField: "moved_at",
  },
  "security-keys": {
    table: "security_keys",
    fields: [
      "siteId",
      "code",
      "name",
      "locationDetail",
      "copiesTotal",
      "isActive",
      "notes",
    ],
    scopeFrom:
      "security_keys r JOIN sites s ON s.organization_id=r.organization_id AND s.id=r.site_id",
    scopeSelect:
      "NULL::uuid AS project_id, s.province_id AS province_id, NULL::uuid AS assigned_member_id",
    siteField: "site_id",
  },
  "security-key-handovers": {
    table: "security_key_handovers",
    fields: [
      "keyId",
      "employeeId",
      "holderName",
      "issuedAt",
      "returnedAt",
      "issuedBy",
      "receivedBy",
      "notes",
    ],
    scopeFrom:
      "security_key_handovers r JOIN security_keys k ON k.organization_id=r.organization_id AND k.id=r.key_id JOIN sites s ON s.organization_id=k.organization_id AND s.id=k.site_id",
    scopeSelect:
      "NULL::uuid AS project_id, s.province_id AS province_id, NULL::uuid AS assigned_member_id",
    dateField: "issued_at",
  },
  documents: {
    table: "management_document_links",
    fields: [
      "projectId",
      "entityType",
      "entityId",
      "title",
      "documentType",
      "storageKey",
      "storageUrl",
      "storageProvider",
      "altText",
      "mimeType",
      "fileSizeBytes",
      "uploadedByMemberId",
    ],
    scopeFrom:
      "management_document_links r LEFT JOIN management_projects p ON p.organization_id = r.organization_id AND p.id = r.project_id",
    scopeSelect:
      "r.project_id AS project_id, p.province_id AS province_id, NULL::uuid AS assigned_member_id",
    projectField: "project_id",
    immutable: true,
  },
};

function configFor(resource: OwnerManagementResource): ResourceConfig {
  return resources[resource];
}

function ownerManagementLabel(row: Row): string | null {
  for (const key of [
    "name",
    "title",
    "code",
    "request_number",
    "order_number",
    "receipt_number",
    "expense_number",
    "asset_number",
    "work_order_number",
    "category",
  ]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Writes an append-only proof of the person, role and time behind a project
 * action. The audit record deliberately stores field names, not sensitive
 * values, while the source record remains the operational source of truth.
 */
async function writeOwnerManagementAudit(
  client: PoolClient,
  context: OwnerManagementContext,
  action: "create" | "update" | "delete" | "approve" | "reject",
  resource: OwnerManagementResource,
  row: Row,
  changedFields: string[],
  metadata?: Record<string, unknown>,
): Promise<void> {
  const actor = await client.query<{
    email: string | null;
    full_name: string | null;
    role_names: string | null;
  }>(
    "SELECT u.email, u.full_name, NULLIF(string_agg(DISTINCT r.name, ', '), '') AS role_names FROM users u LEFT JOIN organization_members m ON m.organization_id = $2 AND m.user_id = u.id LEFT JOIN member_roles mr ON mr.organization_id = m.organization_id AND mr.member_id = m.id LEFT JOIN roles r ON r.organization_id = mr.organization_id AND r.id = mr.role_id WHERE u.id = $1 GROUP BY u.id, u.email, u.full_name",
    [context.userId, context.organizationId],
  );
  const actorRow = actor.rows[0];
  const projectId =
    resource === "projects"
      ? String(row.id)
      : typeof row.project_id === "string"
        ? row.project_id
        : null;
  await client.query(
    "INSERT INTO audit_log (organization_id, user_id, member_id, actor_email, actor_name, action, entity_table, entity_id, entity_label, changes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)",
    [
      context.organizationId,
      context.userId,
      context.memberId,
      actorRow?.email ?? null,
      actorRow?.full_name ?? "System",
      action,
      configFor(resource).table,
      String(row.id),
      ownerManagementLabel(row),
      JSON.stringify({
        fields: [...new Set(changedFields)].sort(),
        projectId,
        actorRole: actorRow?.role_names ?? "Member",
        ...metadata,
      }),
    ],
  );
}

/** Budget changes are immutable project evidence.  Store the before/after
 * values in the existing audit JSON so no financial history table can drift
 * away from the actual project and task records. */
async function budgetChangeAuditMetadata(
  client: PoolClient,
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  current: Row | undefined,
  saved: Row,
): Promise<Record<string, unknown> | undefined> {
  const amount = (value: unknown) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const changed = (before: unknown, after: unknown) =>
    Math.abs(amount(before) - amount(after)) > 0.0001;

  if (resource === "projects") {
    if (!changed(current?.estimated_total_budget, saved.estimated_total_budget))
      return undefined;
    const before = amount(current?.estimated_total_budget);
    const after = amount(saved.estimated_total_budget);
    return {
      budgetChange: {
        scope: "project",
        before,
        after,
        difference: after - before,
        currencyCode: String(
          saved.currency_code ?? current?.currency_code ?? "CDF",
        ),
      },
    };
  }

  if (
    resource !== "tasks" ||
    !saved.project_id ||
    String(saved.task_type) !== "work" ||
    !changed(current?.estimated_cost, saved.estimated_cost)
  )
    return undefined;

  const currency = saved.budget_currency_code ?? current?.budget_currency_code;
  const projectCurrency = currency
    ? currency
    : (
        await client.query<{ currency_code: string }>(
          "SELECT currency_code FROM management_projects WHERE organization_id = $1 AND id = $2",
          [context.organizationId, saved.project_id],
        )
      ).rows[0]?.currency_code;
  const before = amount(current?.estimated_cost);
  const after = amount(saved.estimated_cost);
  return {
    budgetChange: {
      scope: "task",
      before,
      after,
      difference: after - before,
      currencyCode: String(projectCurrency ?? "CDF"),
      justification:
        String(saved.budget_override_reason ?? "").trim() || undefined,
    },
  };
}
async function enrichAuditMetadata(
  client: PoolClient,
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  rows: Row[],
): Promise<Row[]> {
  const ids = rows.map((row) => String(row.id)).filter(Boolean);
  if (!ids.length) return rows;
  const result = await client.query<Row>(
    "SELECT DISTINCT ON (entity_id) entity_id, action, actor_name, occurred_at, changes ->> 'actorRole' AS actor_role FROM audit_log WHERE organization_id = $1 AND entity_table = $2 AND entity_id = ANY($3::uuid[]) ORDER BY entity_id, occurred_at DESC",
    [context.organizationId, configFor(resource).table, ids],
  );
  const byId = new Map(result.rows.map((row) => [String(row.entity_id), row]));
  return rows.map((row) => {
    const audit = byId.get(String(row.id));
    if (!audit) return row;
    return {
      ...row,
      lastAction: audit.action,
      lastActionByName: audit.actor_name,
      lastActionByRole: audit.actor_role,
      lastActionAt:
        audit.occurred_at instanceof Date
          ? audit.occurred_at.toISOString()
          : audit.occurred_at,
    };
  });
}
function ownerManagementDatabaseError(
  error: unknown,
  resource: OwnerManagementResource,
  columns: readonly string[] = [],
  parameterOffset = 1,
): never {
  const pg = error as {
    code?: string;
    constraint?: string;
    column?: string;
    where?: string;
  };
  // PostgreSQL's 22P02 error otherwise reaches the form as the unhelpful
  // “A value has the wrong format”. A task request has a fixed allow-list, so
  // we can safely turn PostgreSQL's parameter number back into the exact form
  // field without ever exposing the rejected value.
  if (resource === "tasks" && pg.code === "22P02") {
    const parameter = Number(
      pg.where?.match(/parameter \$(\d+)/i)?.[1] ?? Number.NaN,
    );
    const candidate = pg.column
      ? camel(pg.column)
      : Number.isInteger(parameter)
        ? columns[parameter - parameterOffset]
        : undefined;
    const field = configFor("tasks").fields.includes(String(candidate))
      ? String(candidate)
      : undefined;
    const names: Record<string, string> = {
      projectId: "project",
      phaseId: "project phase",
      assignedMemberId: "assigned employee",
      startDate: "start date",
      dueDate: "due date",
      progressPercent: "progress",
      estimatedCost: "estimated cost",
      taskType: "task type",
      status: "status",
      priority: "priority",
    };
    throw new BadRequestError(
      field
        ? `The ${names[field] ?? field} has the wrong format`
        : "One task field has the wrong format",
      field ? { field } : undefined,
    );
  }
  if (
    resource === "phases" &&
    pg.code === "23505" &&
    pg.constraint === "management_project_phases_order_unique"
  )
    throw new ConflictError(
      "Another phase already uses this phase order. Choose the next available order.",
    );
  if (
    resource === "phases" &&
    pg.code === "23505" &&
    pg.constraint === "management_project_phases_code_unique"
  )
    throw new ConflictError(
      "Another phase already uses this phase code. Choose a different code.",
    );
  if (resource === "purchase-orders") {
    if (
      pg.code === "23505" &&
      pg.constraint === "management_purchase_orders_number_unique"
    )
      throw new ConflictError(
        "Another purchase order already uses this BC reference. Refresh and try again.",
        { field: "orderNumber" },
      );
    if (pg.code === "23502") {
      const field = camel(String(pg.column ?? ""));
      const labels: Record<string, string> = {
        orderNumber: "purchase order reference",
        projectId: "project",
        supplierId: "supplier",
        orderDate: "order date",
        currencyCode: "currency",
      };
      throw new BadRequestError(
        `The ${labels[field] ?? "purchase order information"} is required`,
        field ? { field } : undefined,
      );
    }
    if (pg.code === "23514") {
      const failures: Record<string, { text: string; field?: string }> = {
        management_purchase_orders_dates_check: {
          text: "Expected delivery must be on or after the order date",
          field: "expectedDeliveryDate",
        },
        management_purchase_orders_status_check: {
          text: "Choose a valid purchase order status",
          field: "status",
        },
        management_purchase_orders_text_check: {
          text: "The BC reference and any supplied text cannot be blank",
          field: "orderNumber",
        },
      };
      const failure = failures[pg.constraint ?? ""];
      throw new BadRequestError(
        failure?.text ?? "The purchase-order details are not valid together",
        failure?.field ? { field: failure.field } : undefined,
      );
    }
    if (pg.code === "23503") {
      const fields: Record<string, string> = {
        management_purchase_orders_project_fk: "projectId",
        management_purchase_orders_phase_fk: "phaseId",
        management_purchase_orders_request_fk: "purchaseRequestId",
        management_purchase_orders_supplier_fk: "supplierId",
        management_purchase_orders_warehouse_fk: "warehouseId",
        management_purchase_orders_ordered_by_fk: "orderedByMemberId",
        management_purchase_orders_task_fk: "projectTaskId",
      };
      const field = fields[pg.constraint ?? ""];
      throw new BadRequestError(
        field
          ? "Choose a valid " +
              ({
                projectId: "project",
                phaseId: "project phase",
                purchaseRequestId: "approved purchase request",
                supplierId: "supplier",
                warehouseId: "receiving warehouse",
                orderedByMemberId: "ordering employee",
                projectTaskId: "linked task",
              }[field] ?? "linked record")
          : "One selected purchase-order record is no longer available",
        field ? { field } : undefined,
      );
    }
  }
  if (pg.code === "23505")
    throw new ConflictError("A record with that value already exists");
  if (resource === "receipts" && pg.code === "23502") {
    const field = camel(String(pg.column ?? ""));
    const labels: Record<string, string> = {
      purchaseOrderId: "purchase order",
      projectId: "linked project",
      receivedByMemberId: "receiving employee",
      receivedDate: "received date",
      receiptNumber: "receipt reference",
    };
    throw new BadRequestError(
      `The ${labels[field] ?? "receipt information"} is required`,
      field ? { field } : undefined,
    );
  }
  if (resource === "suppliers" && pg.code === "23514") {
    const failures: Record<string, { text: string; field?: string }> = {
      management_suppliers_code_format: {
        text: "Supplier code must start with a lowercase letter and use only lowercase letters, numbers and underscores (for example four_alim_001)",
        field: "code",
      },
      management_suppliers_type_check: {
        text: "Choose a valid supplier type",
        field: "supplierType",
      },
      management_suppliers_status_check: {
        text: "Choose a valid supplier status",
        field: "status",
      },
      management_suppliers_text_check: {
        text: "Supplier name and any provided contact details cannot be blank",
        field: "name",
      },
    };
    const failure = failures[pg.constraint ?? ""];
    throw new BadRequestError(
      failure?.text ?? "The supplier details are not valid together",
      failure?.field ? { field: failure.field } : undefined,
    );
  }
  if (resource === "projects" && pg.code === "23514") {
    const message: Record<string, string> = {
      management_projects_code_format:
        "Project code must use lowercase letters, numbers and underscores, and start with a letter (for example kongo_farm_2026)",
      management_projects_values_check:
        "Project budget must be zero or higher, and progress must be between 0 and 100",
      management_projects_dates_check:
        "Project milestones and benefit review dates cannot be before the project start or operational start date",
      management_projects_text_check:
        "Project name and any supplied description, blueprint or notes cannot be blank",
      management_projects_type_check: "Choose a valid project type",
      management_projects_status_check: "Choose a valid project status",
      management_projects_priority_check: "Choose a valid project priority",
      management_projects_lifecycle_stage_check:
        "Choose a valid investment lifecycle stage",
      management_projects_benefit_targets_check:
        "The investment targets must have a valid format",
    };
    throw new BadRequestError(
      message[pg.constraint ?? ""] ??
        "The project values are not valid together",
      pg.constraint ? { field: pg.constraint } : undefined,
    );
  }
  if (resource === "project-members" && pg.code === "23514") {
    const message: Record<string, string> = {
      management_project_members_role_check: "Choose a valid project role",
      management_project_members_assignment_dates_check:
        "The assignment end date cannot be before the assignment start date",
    };
    throw new BadRequestError(
      message[pg.constraint ?? ""] ??
        "The project assignment values are not valid together",
      pg.constraint === "management_project_members_assignment_dates_check"
        ? { field: "assignmentEndDate" }
        : pg.constraint
          ? { field: "assignmentRole" }
          : undefined,
    );
  }
  if (resource === "phases" && pg.code === "23514") {
    const message: Record<string, string> = {
      management_project_phases_code_format:
        "Phase code must use lowercase letters, numbers and underscores, and start with a letter",
      management_project_phases_values_check:
        "Phase order must be 1 or higher, the planned budget must be zero or higher, and progress must be between 0 and 100",
      management_project_phases_dates_check:
        "The planned phase end date cannot be before the phase start date",
      management_project_phases_text_check:
        "Phase name and any supplied description or notes cannot be blank",
      management_project_phases_status_check: "Choose a valid phase status",
      management_project_phases_priority_check: "Choose a valid phase priority",
    };
    throw new BadRequestError(
      message[pg.constraint ?? ""] ?? "The phase values are not valid together",
      pg.constraint ? { field: pg.constraint } : undefined,
    );
  }
  if (resource === "tasks" && pg.code === "23514") {
    const message: Record<string, { text: string; field: string }> = {
      management_project_tasks_type_check: {
        text: "Choose Work or Milestone",
        field: "taskType",
      },
      management_project_tasks_status_check: {
        text: "Choose a valid task status",
        field: "status",
      },
      management_project_tasks_priority_check: {
        text: "Choose a valid task priority",
        field: "priority",
      },
      management_project_tasks_values_check: {
        text: "Progress must be between 0 and 100, and estimated cost cannot be negative",
        field: "progressPercent",
      },
      management_project_tasks_dates_check: {
        text: "Due date and completed date cannot be before the task start date",
        field: "dueDate",
      },
      management_project_tasks_text_check: {
        text: "Task title and supplied notes cannot be blank",
        field: "title",
      },
    };
    const failure = message[pg.constraint ?? ""];
    throw new BadRequestError(
      failure?.text ?? "The task values are not valid together",
      failure ? { field: failure.field } : undefined,
    );
  }
  throw error;
}

async function scopeOf(
  client: PoolClient,
  context: OwnerManagementContext,
): Promise<Scope> {
  if (context.isOwner) return "organization";
  const result = await client.query<{
    organization_scope: boolean;
    province_scope: boolean;
    project_scope: boolean;
  }>(
    "SELECT EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id = mr.organization_id AND r.id = mr.role_id WHERE mr.organization_id = $1 AND mr.member_id = $2 AND r.data_scope = 'organization') AS organization_scope, EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id = mr.organization_id AND r.id = mr.role_id WHERE mr.organization_id = $1 AND mr.member_id = $2 AND r.data_scope = 'province') AS province_scope, EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id = mr.organization_id AND r.id = mr.role_id WHERE mr.organization_id = $1 AND mr.member_id = $2 AND r.data_scope = 'project') AS project_scope",
    [context.organizationId, context.memberId],
  );
  const row = result.rows[0];
  if (row?.organization_scope) return "organization";
  if (row?.province_scope) return "province";
  if (row?.project_scope) return "project";
  return "self";
}

async function scopeInfo(
  client: PoolClient,
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  recordId: string,
): Promise<Row> {
  const config = configFor(resource);
  const result = await client.query<Row>(
    "SELECT " +
      config.scopeSelect +
      " FROM " +
      config.scopeFrom +
      " WHERE r.organization_id = $1 AND r.id = $2",
    [context.organizationId, recordId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Owner Management record not found");
  return row;
}

async function assertVisible(
  client: PoolClient,
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  recordId: string,
): Promise<void> {
  // A project is an owner-controlled investment. Its own manager assignment
  // always governs access to that project, even when the same person also has
  // a broad operational role such as General Manager or Site Manager.
  if (context.isOwner) return;

  const info = await scopeInfo(client, context, resource, recordId);
  if (info.project_id) {
    const assignedManager = await client.query(
      "SELECT 1 FROM management_project_members WHERE organization_id = $1 AND project_id = $2 AND member_id = $3 AND is_manager AND assignment_start_date <= current_date AND (assignment_end_date IS NULL OR assignment_end_date >= current_date)",
      [context.organizationId, info.project_id, context.memberId],
    );
    if (assignedManager.rowCount) return;
    throw new NotFoundError("Owner Management record not found");
  }

  const scope = await scopeOf(client, context);
  // Suppliers and stock items are organization-wide catalog records. They do
  // not carry a province, so a province-scoped operator with the matching
  // permission may read the company catalogue while warehouse stock remains
  // limited by the warehouse's province/site.
  if (resource === "suppliers" || resource === "inventory-items") return;
  if (scope === "organization") return;
  if (scope === "self") {
    if (String(info.assigned_member_id ?? "") === context.memberId) return;
    throw new NotFoundError("Owner Management record not found");
  }
  if (scope === "province") {
    if (!info.province_id)
      throw new NotFoundError("Owner Management record not found");
    const allowed = await client.query(
      "SELECT 1 FROM member_provinces WHERE organization_id = $1 AND member_id = $2 AND province_id = $3",
      [context.organizationId, context.memberId, info.province_id],
    );
    if (allowed.rowCount) return;
    throw new NotFoundError("Owner Management record not found");
  }
  throw new NotFoundError("Owner Management record not found");
}

async function rawRecord(
  client: PoolClient,
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  recordId: string,
): Promise<Row> {
  const config = configFor(resource);
  const result = await client.query<Row>(
    "SELECT * FROM " + config.table + " WHERE organization_id = $1 AND id = $2",
    [context.organizationId, recordId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Owner Management record not found");
  await assertVisible(client, context, resource, recordId);
  return row;
}

/** Prevent a manager from creating a project-linked record outside their scope. */
async function assertProjectWriteScope(
  client: PoolClient,
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  input: Input,
): Promise<void> {
  if (context.isOwner) return;
  const directProjectId =
    typeof input.projectId === "string" && input.projectId.trim()
      ? input.projectId
      : null;
  const inherited = async (table: string, recordId: unknown) => {
    if (typeof recordId !== "string" || !recordId) return null;
    const result = await client.query<{ project_id: string | null }>(
      "SELECT project_id FROM " +
        table +
        " WHERE organization_id = $1 AND id = $2",
      [context.organizationId, recordId],
    );
    return result.rows[0]?.project_id ?? null;
  };
  const projectId =
    directProjectId ??
    (resource === "material-movements"
      ? await inherited("management_project_materials", input.projectMaterialId)
      : resource === "purchase-request-lines"
        ? await inherited(
            "management_purchase_requests",
            input.purchaseRequestId,
          )
        : resource === "purchase-order-lines"
          ? await inherited("management_purchase_orders", input.purchaseOrderId)
          : resource === "receipt-lines"
            ? await inherited("management_receipts", input.receiptId)
            : resource === "asset-assignments" ||
                resource === "asset-movements" ||
                resource === "maintenance-plans" ||
                resource === "maintenance-work-orders"
              ? await inherited("management_assets", input.assetId)
              : null);
  if (!projectId) {
    // A general manager can manage normal Operations records anywhere in their
    // current organization, but never outside it (tenant context still applies).
    if ((await scopeOf(client, context)) === "organization") return;
    // Supplier and inventory item catalogues are organization-wide reference
    // data. Their own resource permissions decide whether this user may edit.
    if (["suppliers", "inventory-items"].includes(resource)) return;

    const inAssignedProvince = async (provinceId: unknown) => {
      if (typeof provinceId !== "string" || !provinceId.trim()) return false;
      const result = await client.query(
        "SELECT 1 FROM member_provinces WHERE organization_id = $1 AND member_id = $2 AND province_id = $3",
        [context.organizationId, context.memberId, provinceId],
      );
      return Boolean(result.rowCount);
    };
    const provinceForSite = async (siteId: unknown) => {
      if (typeof siteId !== "string" || !siteId.trim()) return null;
      const result = await client.query<{ province_id: string }>(
        "SELECT province_id FROM sites WHERE organization_id = $1 AND id = $2",
        [context.organizationId, siteId],
      );
      return result.rows[0]?.province_id ?? null;
    };
    const provinceForWarehouse = async (warehouseId: unknown) => {
      if (typeof warehouseId !== "string" || !warehouseId.trim()) return null;
      const result = await client.query<{ province_id: string }>(
        "SELECT s.province_id FROM management_warehouses w JOIN sites s ON s.organization_id = w.organization_id AND s.id = w.site_id WHERE w.organization_id = $1 AND w.id = $2",
        [context.organizationId, warehouseId],
      );
      return result.rows[0]?.province_id ?? null;
    };
    const scopeForAsset = async (assetId: unknown) => {
      if (typeof assetId !== "string" || !assetId.trim()) return null;
      const result = await client.query<{
        province_id: string | null;
        site_id: string | null;
      }>(
        "SELECT province_id, site_id FROM management_assets WHERE organization_id = $1 AND id = $2",
        [context.organizationId, assetId],
      );
      const asset = result.rows[0];
      return asset?.province_id ?? (await provinceForSite(asset?.site_id));
    };

    if (resource === "tasks") {
      const provinceId =
        typeof input.provinceId === "string" && input.provinceId.trim()
          ? input.provinceId
          : null;
      if (!provinceId)
        throw new ForbiddenError(
          "Choose a province for a normal company task",
          {
            field: "provinceId",
          },
        );
      if (!(await inAssignedProvince(provinceId)))
        throw new ForbiddenError(
          "You can only create normal tasks in an assigned province",
          { field: "provinceId" },
        );
      if (typeof input.siteId === "string" && input.siteId.trim()) {
        const siteProvince = await provinceForSite(input.siteId);
        if (siteProvince !== provinceId)
          throw new BadRequestError("Choose a site in the selected province", {
            field: "siteId",
          });
      }
      return;
    }

    let provinceId: string | null = null;
    if (resource === "warehouses")
      provinceId = await provinceForSite(input.siteId);
    else if (resource === "stock-movements")
      provinceId = await provinceForWarehouse(input.warehouseId);
    else if (resource === "assets")
      provinceId =
        (typeof input.provinceId === "string" && input.provinceId) ||
        (await provinceForSite(input.siteId));
    else if (
      [
        "asset-assignments",
        "asset-movements",
        "asset-usage",
        "maintenance-plans",
        "maintenance-work-orders",
      ].includes(resource)
    )
      provinceId = await scopeForAsset(input.assetId);
    else if (resource === "maintenance-parts") {
      const result = await client.query<{ asset_id: string }>(
        "SELECT asset_id FROM management_maintenance_work_orders WHERE organization_id = $1 AND id = $2",
        [context.organizationId, input.workOrderId],
      );
      provinceId = await scopeForAsset(result.rows[0]?.asset_id);
    }
    if (provinceId && (await inAssignedProvince(provinceId))) return;
    throw new ForbiddenError(
      "You can only manage this Operations record in an assigned province or project",
    );
  }
  await rawRecord(client, context, "projects", String(projectId));
  if (resource === "purchase-orders") {
    if (typeof input.purchaseRequestId !== "string" || !input.purchaseRequestId)
      throw new ForbiddenError(
        "Managers must create a purchase request before placing an order",
      );
    const request = await client.query<{ approval_status: string }>(
      "SELECT approval_status FROM management_purchase_requests WHERE organization_id = $1 AND id = $2 AND project_id = $3",
      [context.organizationId, input.purchaseRequestId, projectId],
    );
    if (
      !request.rows[0] ||
      !["approved", "partially_approved"].includes(
        request.rows[0].approval_status,
      )
    )
      throw new ForbiddenError(
        "The owner must approve the purchase request before an order can be placed",
      );
  }
}

/** A manager can submit a request or expense; an owner makes the final decision. */
function assertManagerWorkflowInput(
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  input: Input,
): void {
  const status = typeof input.status === "string" ? input.status : undefined;
  if (resource === "purchase-requests") {
    if (input.requestDate !== undefined)
      throw new ForbiddenError(
        "The purchase-request date is created automatically and cannot be changed",
      );
    if (
      input.approvalStatus !== undefined ||
      input.reviewedByMemberId !== undefined
    )
      throw new ForbiddenError(
        "Purchase-request approval is controlled only through the approval queue",
      );
    if (status && !["draft", "submitted", "cancelled"].includes(status))
      throw new ForbiddenError(
        "Submit the purchase request first; only the owner can decide it from the approval queue",
      );
  }
  if (
    resource === "purchase-request-lines" &&
    input.approvedQuantity !== undefined &&
    !context.isOwner
  )
    throw new ForbiddenError(
      "Only the company owner can set an approved quantity",
    );
  if (resource === "purchase-orders") {
    if (status === "cancelled" && !context.isOwner)
      throw new ForbiddenError(
        "Only the company owner can cancel a purchase order",
      );
    if (status && !["draft", "sent", "cancelled"].includes(status))
      throw new ForbiddenError(
        "A purchase order becomes partially or fully received only after accepted receipt items are recorded",
      );
  }
  if (
    resource === "receipts" &&
    status &&
    !["draft", "received", "verified", "rejected", "cancelled"].includes(status)
  )
    throw new BadRequestError("Choose a valid receipt status", {
      field: "status",
    });
  if (context.isOwner) return;
  if (resource === "expenses") {
    if (status && !["draft", "submitted"].includes(status))
      throw new ForbiddenError(
        "Managers can submit expenses, but only the owner can approve or pay them",
      );
    if (
      input.approvedByMemberId !== undefined ||
      input.paidByMemberId !== undefined
    )
      throw new ForbiddenError(
        "Managers cannot approve or mark an expense as paid",
      );
  }
}

async function assertPurchaseRequestItemsCanChange(
  client: PoolClient,
  context: OwnerManagementContext,
  purchaseRequestId: unknown,
): Promise<void> {
  if (typeof purchaseRequestId !== "string" || !purchaseRequestId.trim())
    throw new BadRequestError("Choose a purchase request", {
      field: "purchaseRequestId",
    });
  const request = await client.query<{ status: string }>(
    "SELECT status FROM management_purchase_requests WHERE organization_id = $1 AND id = $2",
    [context.organizationId, purchaseRequestId],
  );
  if (!request.rows[0]) throw new NotFoundError("Purchase request not found");
  if (String(request.rows[0].status) !== "draft")
    throw new ForbiddenError(
      "Purchase request items are locked once the request is submitted for approval",
    );
}

/** A BR is edited only while it is being prepared. Confirming it freezes the
 * actual quantities, protects the audit trail, and lets the budget/stock
 * calculation use a single authoritative receipt. */
async function assertReceiptItemsCanChange(
  client: PoolClient,
  context: OwnerManagementContext,
  receiptId: unknown,
): Promise<void> {
  if (typeof receiptId !== "string" || !receiptId.trim())
    throw new BadRequestError("Choose a receipt", { field: "receiptId" });
  const receipt = await client.query<{ status: string }>(
    "SELECT status FROM management_receipts WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    [context.organizationId, receiptId],
  );
  if (!receipt.rows[0]) throw new NotFoundError("Receipt not found");
  if (String(receipt.rows[0].status) !== "draft")
    throw new ForbiddenError(
      "Received items are locked once the receipt has been confirmed. Create a correction or a new receipt instead.",
    );
}

/**
 * Receipt statuses are an auditable lifecycle, not interchangeable labels:
 * draft -> received -> verified, or draft -> rejected/cancelled. A confirmed
 * receipt can be cancelled only before it creates a paid supplier balance or
 * durable assets that would need a separate correction record.
 */
async function assertReceiptStatusTransition(
  client: PoolClient,
  context: OwnerManagementContext,
  receiptId: string,
  currentStatus: unknown,
  requestedStatus: unknown,
): Promise<void> {
  if (typeof requestedStatus !== "string") return;
  const current = String(currentStatus || "draft");
  const next = requestedStatus;
  if (next === current) return;

  const allowed: Record<string, string[]> = {
    draft: ["received", "rejected", "cancelled"],
    received: ["verified", "cancelled"],
    verified: ["cancelled"],
    rejected: [],
    cancelled: ["draft", "received"],
  };
  if (!allowed[current]?.includes(next))
    throw new BadRequestError(
      "This receipt status change is not allowed. A receipt is prepared, confirmed, optionally verified, or closed by rejection/cancellation.",
      { field: "status" },
    );

  if (
    current === "cancelled" &&
    ["draft", "received"].includes(next) &&
    !context.isOwner
  )
    throw new ForbiddenError(
      "Only the company owner can reactivate a cancelled receipt",
    );

  if (["received", "verified"].includes(next)) {
    const lines = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM management_receipt_lines WHERE organization_id = $1 AND receipt_id = $2",
      [context.organizationId, receiptId],
    );
    if (Number(lines.rows[0]?.count ?? 0) < 1)
      throw new BadRequestError(
        "Record at least one received item before confirming this receipt",
        { field: "status" },
      );
    await assertReceiptDoesNotExceedOrder(client, context, receiptId);
  }

  if (next === "verified") {
    const [quality, durableItems] = await Promise.all([
      client.query<{
        quality_status: string;
        commissioning_status: string;
      }>(
        "SELECT quality_status, commissioning_status FROM management_project_quality_checks WHERE organization_id = $1 AND receipt_id = $2",
        [context.organizationId, receiptId],
      ),
      client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM management_receipt_lines WHERE organization_id = $1 AND receipt_id = $2 AND asset_required = true",
        [context.organizationId, receiptId],
      ),
    ]);
    const check = quality.rows[0];
    if (
      !check ||
      !["accepted", "accepted_with_observations"].includes(check.quality_status)
    )
      throw new BadRequestError(
        "Complete and accept the reception quality checklist before verifying this receipt",
        { field: "status" },
      );
    if (
      Number(durableItems.rows[0]?.count ?? 0) > 0 &&
      check.commissioning_status !== "validated"
    )
      throw new BadRequestError(
        "Validate commissioning for the received equipment before verifying this receipt",
        { field: "status" },
      );
  }

  if (next === "cancelled" && ["received", "verified"].includes(current)) {
    if (!context.isOwner)
      throw new ForbiddenError(
        "Only the company owner can cancel a confirmed receipt",
      );
    const [payments, assets] = await Promise.all([
      client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM management_expenses WHERE organization_id = $1 AND receipt_id = $2 AND status IN ('approved', 'paid')",
        [context.organizationId, receiptId],
      ),
      client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM management_receipt_line_assets a JOIN management_receipt_lines l ON l.organization_id = a.organization_id AND l.id = a.receipt_line_id WHERE a.organization_id = $1 AND l.receipt_id = $2",
        [context.organizationId, receiptId],
      ),
    ]);
    if (Number(payments.rows[0]?.count ?? 0) > 0)
      throw new ConflictError(
        "This receipt already has a recorded supplier payment. Record a reimbursement or correction before cancelling the receipt.",
      );
    if (Number(assets.rows[0]?.count ?? 0) > 0)
      throw new ConflictError(
        "This receipt created durable assets. Record an asset return or correction instead of cancelling the receipt.",
      );
  }
}
/**
 * A rejected or cancelled BR posts an explicit counter-movement instead of
 * deleting receipt history. This prevents returned deliveries from remaining
 * available in inventory while keeping the stock audit trail intact.
 */
/** A purchase order may be received through several BRs, but the total
 * accepted quantity for each ordered line must never exceed the order. */
async function assertReceiptDoesNotExceedOrder(
  client: PoolClient,
  context: OwnerManagementContext,
  receiptId: string,
): Promise<void> {
  const totals = await client.query<{
    description: string | null;
    ordered_quantity: string;
    current_accepted: string;
    accepted_before: string;
  }>(
    "SELECT pol.description, pol.ordered_quantity::text, COALESCE(SUM(rl.received_quantity - rl.damaged_quantity - rl.rejected_quantity), 0)::text AS current_accepted, COALESCE((SELECT SUM(existing_line.received_quantity - existing_line.damaged_quantity - existing_line.rejected_quantity) FROM management_receipt_lines existing_line JOIN management_receipts existing_receipt ON existing_receipt.organization_id = existing_line.organization_id AND existing_receipt.id = existing_line.receipt_id WHERE existing_line.organization_id = pol.organization_id AND existing_line.purchase_order_line_id = pol.id AND existing_receipt.id <> $2 AND existing_receipt.status IN ('received', 'verified')), 0)::text AS accepted_before FROM management_receipt_lines rl JOIN management_purchase_order_lines pol ON pol.organization_id = rl.organization_id AND pol.id = rl.purchase_order_line_id WHERE rl.organization_id = $1 AND rl.receipt_id = $2 GROUP BY pol.id, pol.organization_id, pol.description, pol.ordered_quantity",
    [context.organizationId, receiptId],
  );
  const exceeded = totals.rows.find(
    (line) =>
      Number(line.current_accepted) + Number(line.accepted_before) >
      Number(line.ordered_quantity),
  );
  if (exceeded)
    throw new BadRequestError(
      "The accepted quantity for " +
        (exceeded.description ?? "this item") +
        " exceeds the quantity ordered. Create a new order or correct the receipt quantities.",
      { field: "receivedQuantity" },
    );
}
async function receiptInventoryLines(
  client: PoolClient,
  context: OwnerManagementContext,
  receiptId: string,
): Promise<Row[]> {
  const result = await client.query<Row>(
    "SELECT rl.id, rl.received_quantity, rl.damaged_quantity, rl.rejected_quantity, rl.inventory_item_id, rl.project_material_id, rl.actual_unit_cost, re.project_id, re.warehouse_id AS receipt_warehouse_id, po.warehouse_id AS order_warehouse_id, pol.inventory_item_id AS order_item_id, pol.project_material_id AS order_material_id, pol.unit_cost FROM management_receipt_lines rl JOIN management_receipts re ON re.organization_id = rl.organization_id AND re.id = rl.receipt_id JOIN management_purchase_orders po ON po.organization_id = re.organization_id AND po.id = re.purchase_order_id JOIN management_purchase_order_lines pol ON pol.organization_id = rl.organization_id AND pol.id = rl.purchase_order_line_id WHERE rl.organization_id = $1 AND rl.receipt_id = $2",
    [context.organizationId, receiptId],
  );
  return result.rows;
}

async function receiptLineStockBalance(
  client: PoolClient,
  context: OwnerManagementContext,
  receiptLineId: string,
): Promise<number> {
  const result = await client.query<{ quantity: string }>(
    "SELECT COALESCE(SUM(quantity_delta), 0)::text AS quantity FROM management_inventory_stock_movements WHERE organization_id = $1 AND reference_id = $2 AND reference_type IN ('receipt_line', 'receipt_return', 'receipt_reinstatement')",
    [context.organizationId, receiptLineId],
  );
  return Number(result.rows[0]?.quantity ?? 0);
}

/**
 * A rejected or cancelled BR posts an explicit counter-movement instead of
 * deleting receipt history. This prevents returned deliveries from remaining
 * available in inventory while keeping the stock audit trail intact.
 */
async function reverseReceiptInventory(
  client: PoolClient,
  context: OwnerManagementContext,
  receiptId: string,
): Promise<void> {
  for (const line of await receiptInventoryLines(client, context, receiptId)) {
    const accepted =
      Number(line.received_quantity) -
      Number(line.damaged_quantity) -
      Number(line.rejected_quantity);
    const itemId = line.inventory_item_id ?? line.order_item_id;
    const warehouseId = line.receipt_warehouse_id ?? line.order_warehouse_id;
    if (!(accepted > 0 && itemId && warehouseId)) continue;
    const inStock = Math.max(
      0,
      await receiptLineStockBalance(client, context, String(line.id)),
    );
    const quantityToReturn = Math.min(accepted, inStock);
    if (!(quantityToReturn > 0)) continue;
    await writeStockLedger(client, context, {
      warehouseId: String(warehouseId),
      itemId: String(itemId),
      projectId: String(line.project_id),
      projectMaterialId: line.project_material_id
        ? String(line.project_material_id)
        : line.order_material_id
          ? String(line.order_material_id)
          : null,
      movementType: "return",
      quantityDelta: -quantityToReturn,
      unitCost: Number(line.actual_unit_cost ?? line.unit_cost),
      referenceType: "receipt_return",
      referenceId: String(line.id),
      notes: "Receipt cancelled or delivery rejected",
    });
  }
}

/** Reactivating an owner-cancelled BR restores only the quantity that its
 * cancellation removed. The ledger balance check makes repeated confirmation
 * idempotent and prevents duplicate stock entries. */
async function restoreReceiptInventory(
  client: PoolClient,
  context: OwnerManagementContext,
  receiptId: string,
): Promise<void> {
  for (const line of await receiptInventoryLines(client, context, receiptId)) {
    const accepted =
      Number(line.received_quantity) -
      Number(line.damaged_quantity) -
      Number(line.rejected_quantity);
    const itemId = line.inventory_item_id ?? line.order_item_id;
    const warehouseId = line.receipt_warehouse_id ?? line.order_warehouse_id;
    if (!(accepted > 0 && itemId && warehouseId)) continue;
    const inStock = Math.max(
      0,
      await receiptLineStockBalance(client, context, String(line.id)),
    );
    const quantityToRestore = accepted - inStock;
    if (!(quantityToRestore > 0)) continue;
    await writeStockLedger(client, context, {
      warehouseId: String(warehouseId),
      itemId: String(itemId),
      projectId: String(line.project_id),
      projectMaterialId: line.project_material_id
        ? String(line.project_material_id)
        : line.order_material_id
          ? String(line.order_material_id)
          : null,
      movementType: "receipt",
      quantityDelta: quantityToRestore,
      unitCost: Number(line.actual_unit_cost ?? line.unit_cost),
      referenceType: "receipt_reinstatement",
      referenceId: String(line.id),
      notes: "Cancelled receipt reactivated and confirmed again",
    });
  }
}
async function assertDependenciesCanStart(
  client: PoolClient,
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  recordId: string,
  input: Input,
): Promise<void> {
  const status = String(input.status ?? "");
  if (!["in_progress", "completed"].includes(status)) return;
  if (resource === "tasks") {
    const blocked = await client.query<{ title: string }>(
      "SELECT prerequisite.title FROM management_task_dependencies d JOIN management_project_tasks prerequisite ON prerequisite.organization_id = d.organization_id AND prerequisite.id = d.depends_on_task_id WHERE d.organization_id = $1 AND d.task_id = $2 AND prerequisite.status <> 'completed' ORDER BY prerequisite.title LIMIT 1",
      [context.organizationId, recordId],
    );
    if (blocked.rowCount)
      throw new BadRequestError(
        "Complete the prerequisite task before starting this task: " +
          (blocked.rows[0]?.title ?? "a prerequisite task"),
      );
  }
  if (resource === "phases") {
    const blocked = await client.query<{ name: string }>(
      "SELECT prerequisite.name FROM management_project_phase_dependencies d JOIN management_project_phases prerequisite ON prerequisite.organization_id = d.organization_id AND prerequisite.id = d.depends_on_phase_id WHERE d.organization_id = $1 AND d.phase_id = $2 AND prerequisite.status <> 'completed' ORDER BY prerequisite.phase_order LIMIT 1",
      [context.organizationId, recordId],
    );
    if (blocked.rowCount)
      throw new BadRequestError(
        "Complete the prerequisite phase before starting this phase: " +
          (blocked.rows[0]?.name ?? "a prerequisite phase"),
      );
  }
}
function prepareInput(
  resource: OwnerManagementResource,
  input: Input,
): { columns: string[]; values: unknown[] } {
  if (
    resource === "tasks" &&
    input.taskType !== undefined &&
    !["work", "milestone"].includes(String(input.taskType))
  )
    throw new BadRequestError("Task type must be work or milestone", {
      field: "taskType",
    });
  if (resource === "project-members") {
    if (String(input.assignmentRole ?? "") !== "project_manager")
      throw new BadRequestError(
        "A project team can contain only the designated Project Manager. Assign workers directly to project tasks.",
        { field: "assignmentRole" },
      );
    if (input.isManager !== true)
      throw new BadRequestError(
        "The designated Project Manager must be the active project manager.",
        { field: "isManager" },
      );
  }
  const allowed = new Set(configFor(resource).fields);
  const entries = Object.entries(input).filter(
    ([, value]) => value !== undefined,
  );
  const invalid = entries
    .map(([key]) => key)
    .filter((key) => !allowed.has(key));
  if (invalid.length) {
    throw new BadRequestError(
      "One or more fields are not allowed for this record",
      {
        fields: invalid,
      },
    );
  }
  return {
    columns: entries.map(([key]) => snake(key)),
    values: entries.map(([, value]) => value),
  };
}

function withDefaults(
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  input: Input,
): Input {
  const result: Input = { ...input };
  if (resource === "projects" || resource === "tasks")
    result.createdByUserId = context.userId;
  // The database intentionally treats a NULL task code as a value for its
  // uniqueness rule. Give an omitted code a readable, collision-resistant
  // value so normal company tasks and project tasks can both be created from
  // the Operations workspace without a hidden database constraint failure.
  if (
    resource === "tasks" &&
    (typeof result.code !== "string" || !result.code.trim())
  )
    result.code = `task-${randomUUID().slice(0, 8)}`;
  if (resource === "stock-movements" && result.quantityDelta !== undefined)
    result.quantityDelta = normalizedStockMovementDelta(
      result.movementType,
      result.quantityDelta,
    );
  if (resource === "project-members") result.assignedBy = context.userId;
  if (resource === "risks") {
    result.recordType ??= "risk";
    result.category ??= "other";
    result.probability ??= "medium";
    result.impact ??= "medium";
    result.status ??= "open";
    result.decision ??= "pending";
    result.createdByMemberId ??= context.memberId;
    if (String(result.status) === "triggered" && !result.triggeredAt)
      result.triggeredAt = new Date().toISOString();
    if (String(result.status) === "closed" && !result.resolvedAt)
      result.resolvedAt = new Date().toISOString();
    if (String(result.decision) !== "pending") {
      result.decidedByMemberId = context.memberId;
      result.decidedAt ??= new Date().toISOString();
    }
  }
  if (resource === "quality-checks") {
    result.qualityStatus ??= "pending";
    result.commissioningStatus ??= "not_required";
    result.returnedQuantity ??= 0;
    result.checkedByMemberId ??= context.memberId;
    result.checkedAt ??= new Date().toISOString();
    if (String(result.commissioningStatus) === "validated") {
      result.commissionedByMemberId ??= context.memberId;
      result.commissionedAt ??= new Date().toISOString();
    }
  }
  if (resource === "project-closeouts") {
    result.status ??= "draft";
    result.preparedByMemberId ??= context.memberId;
    if (String(result.status) === "completed") {
      result.approvedByMemberId ??= context.memberId;
      result.completedAt ??= new Date().toISOString();
    }
  }
  if (resource === "suppliers")
    result.code = supplierCode(result.code, result.name);
  if (resource === "warehouses")
    result.code = warehouseCode(result.code, result.name);
  if (
    resource === "feed-recipes" &&
    (typeof result.code !== "string" || !result.code.trim())
  ) {
    const stem =
      String(result.name ?? "feed")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 42) || "feed";
    result.code =
      `recette_${stem}_${randomUUID().replace(/-/g, "").slice(0, 5)}`.slice(
        0,
        63,
      );
    result.createdByMemberId ??= context.memberId;
  }
  if (
    resource === "nutrition-profiles" &&
    (typeof result.code !== "string" || !result.code.trim())
  )
    result.code = `profil_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  if (resource === "feed-orders") {
    result.status ??= "draft";
    result.productionDate ??= new Date().toISOString().slice(0, 10);
    result.producedByMemberId ??= context.memberId;
  }
  if (resource === "operational-links" && !result.linkedByMemberId)
    result.linkedByMemberId = context.memberId;
  if (resource === "phase-dependencies" && !result.createdByMemberId)
    result.createdByMemberId = context.memberId;
  if (resource === "purchase-requests") {
    result.requestedByMemberId = context.memberId;
    delete result.requestDate;
  }
  if (resource === "purchase-orders" && !result.orderedByMemberId)
    result.orderedByMemberId = context.memberId;
  if (resource === "receipts" && !result.receivedByMemberId)
    result.receivedByMemberId = context.memberId;
  if (resource === "approvals" && !result.requestedByMemberId)
    result.requestedByMemberId = context.memberId;
  if (resource === "documents" && !result.uploadedByMemberId)
    result.uploadedByMemberId = context.memberId;
  if (resource === "maintenance-plans" && !result.createdByMemberId)
    result.createdByMemberId = context.memberId;
  if (resource === "maintenance-parts" && !result.issuedByMemberId)
    result.issuedByMemberId = context.memberId;
  if (resource === "asset-assignments" && !result.assignedByMemberId)
    result.assignedByMemberId = context.memberId;
  if (resource === "asset-movements" && !result.movedByMemberId)
    result.movedByMemberId = context.memberId;
  if (resource === "asset-usage" && !result.operatorMemberId)
    result.operatorMemberId = context.memberId;
  if (resource === "maintenance-work-orders" && !result.reportedByMemberId)
    result.reportedByMemberId = context.memberId;
  if (resource === "incidents" && !result.reportedBy)
    result.reportedBy = context.userId;
  if (
    ["security-visitors", "security-asset-movements"].includes(resource) &&
    !result.recordedBy
  )
    result.recordedBy = context.userId;
  if (resource === "security-key-handovers" && !result.issuedBy)
    result.issuedBy = context.userId;
  if (resource === "expenses") {
    result.createdByUserId = context.userId;
    if (
      typeof result.expenseNumber !== "string" ||
      !result.expenseNumber.trim()
    )
      delete result.expenseNumber;
    if (String(result.status ?? "draft") === "submitted" && !result.submittedAt)
      result.submittedAt = new Date().toISOString();
    if (String(result.status ?? "draft") === "paid" && !result.paidByMemberId)
      result.paidByMemberId = context.memberId;
  }
  return result;
}

async function assertConsistency(
  client: PoolClient,
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  row: Row,
): Promise<void> {
  const org = context.organizationId;
  const sameProject = async (
    phaseId: unknown,
    projectId: unknown,
    message: string,
  ) => {
    if (!phaseId || !projectId) return;
    const found = await client.query(
      "SELECT 1 FROM management_project_phases WHERE organization_id = $1 AND id = $2 AND project_id = $3",
      [org, phaseId, projectId],
    );
    if (!found.rowCount) throw new BadRequestError(message);
  };
  /**
   * Physical stock must remain at the same operational location as the
   * project. The browser narrows its selector for clarity, while this check is
   * the authoritative protection for API calls, imports, and later edits.
   */
  const assertWarehouseMatchesProject = async (
    projectId: unknown,
    warehouseId: unknown,
  ) => {
    if (!projectId || !warehouseId) return;
    const scope = await client.query<{
      project_province_id: string;
      project_site_id: string | null;
      warehouse_province_id: string;
      warehouse_site_id: string;
    }>(
      "SELECT p.province_id AS project_province_id, p.site_id AS project_site_id, s.province_id AS warehouse_province_id, w.site_id AS warehouse_site_id FROM management_projects p JOIN management_warehouses w ON w.organization_id = p.organization_id AND w.id = $3 AND w.is_active = true JOIN sites s ON s.organization_id = w.organization_id AND s.id = w.site_id WHERE p.organization_id = $1 AND p.id = $2",
      [org, projectId, warehouseId],
    );
    const match = scope.rows[0];
    if (!match)
      throw new BadRequestError(
        "Choose an active warehouse in this organization",
        { field: "warehouseId" },
      );
    if (
      String(match.project_province_id) !== String(match.warehouse_province_id)
    )
      throw new BadRequestError(
        "Choose a warehouse in the project's province",
        { field: "warehouseId" },
      );
    if (
      match.project_site_id &&
      String(match.project_site_id) !== String(match.warehouse_site_id)
    )
      throw new BadRequestError("Choose a warehouse at the project's site", {
        field: "warehouseId",
      });
  };
  // The project budget is authoritative. A task estimate is an allocation of
  // that one amount, never an extra budget line or a second source of funds.
  if (resource === "projects") {
    const allocation = await client.query<Row>(
      "SELECT COALESCE(SUM(estimated_cost) FILTER (WHERE task_type = 'work'), 0) AS allocated FROM management_project_tasks WHERE organization_id = $1 AND project_id = $2",
      [org, row.id],
    );
    if (
      Number(allocation.rows[0]?.allocated ?? 0) >
      Number(row.estimated_total_budget ?? 0) + 0.0001
    )
      throw new BadRequestError(
        "The main project budget cannot be lower than the total task budgets",
        { field: "estimatedTotalBudget" },
      );
    if (String(row.lifecycle_stage ?? "investment") === "closed") {
      const closeout = await client.query<{ status: string }>(
        "SELECT status FROM management_project_closeouts WHERE organization_id = $1 AND project_id = $2",
        [org, row.id],
      );
      if (String(closeout.rows[0]?.status ?? "") !== "completed")
        throw new BadRequestError(
          "Complete the formal project close-out before closing its lifecycle",
          { field: "lifecycleStage" },
        );
    }
  }
  if (resource === "quality-checks") {
    const target = await client.query<{
      receipt_project_id: string | null;
      receipt_status: string | null;
      asset_project_id: string | null;
      accepted_quantity: string | null;
    }>(
      "SELECT receipt.project_id AS receipt_project_id, receipt.status AS receipt_status, asset.project_id AS asset_project_id, COALESCE((SELECT SUM(line.received_quantity - line.damaged_quantity - line.rejected_quantity) FROM management_receipt_lines line WHERE line.organization_id = $1 AND line.receipt_id = receipt.id), 0)::text AS accepted_quantity FROM management_project_quality_checks quality LEFT JOIN management_receipts receipt ON receipt.organization_id = quality.organization_id AND receipt.id = quality.receipt_id LEFT JOIN management_assets asset ON asset.organization_id = quality.organization_id AND asset.id = quality.asset_id WHERE quality.organization_id = $1 AND quality.id = $2",
      [org, row.id],
    );
    const value = target.rows[0];
    if (!value) throw new NotFoundError("Quality check not found");
    if (
      value.receipt_project_id &&
      String(value.receipt_project_id) !== String(row.project_id)
    )
      throw new BadRequestError(
        "The quality receipt must belong to this project",
        { field: "receiptId" },
      );
    if (
      value.asset_project_id &&
      String(value.asset_project_id) !== String(row.project_id)
    )
      throw new BadRequestError(
        "The inspected equipment must belong to this project",
        { field: "assetId" },
      );
    if (
      row.receipt_id &&
      !["received", "verified"].includes(String(value.receipt_status))
    )
      throw new BadRequestError(
        "Confirm the receipt before performing its quality check",
        { field: "receiptId" },
      );
    if (
      Number(row.returned_quantity ?? 0) > Number(value.accepted_quantity ?? 0)
    )
      throw new BadRequestError(
        "The declared return cannot exceed the quantity accepted on this receipt",
        { field: "returnedQuantity" },
      );
    if (
      String(row.quality_status) === "returned" &&
      Number(row.returned_quantity ?? 0) <= 0
    )
      throw new BadRequestError(
        "Record the quantity returned to the supplier",
        { field: "returnedQuantity" },
      );
    if (
      String(row.quality_status) === "accepted" &&
      (!row.quantity_matches ||
        !row.condition_accepted ||
        !row.documents_complete)
    )
      throw new BadRequestError(
        "Complete the quantity, condition and document checks before accepting this receipt",
        { field: "qualityStatus" },
      );
    if (
      String(row.commissioning_status) === "validated" &&
      (!row.functional_test_passed || !row.safety_check_passed)
    )
      throw new BadRequestError(
        "Complete the functional and safety checks before validating commissioning",
        { field: "commissioningStatus" },
      );
  }
  if (resource === "project-closeouts") {
    if (!context.isOwner)
      throw new ForbiddenError(
        "Only the workspace owner can formally close a project",
      );
    if (String(row.status) === "completed") {
      const openTasks = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM management_project_tasks WHERE organization_id = $1 AND project_id = $2 AND status NOT IN ('completed', 'cancelled')",
        [org, row.project_id],
      );
      if (Number(openTasks.rows[0]?.count ?? 0) > 0)
        throw new ConflictError(
          "Complete, cancel or archive the remaining project tasks before formal close-out",
          { field: "status" },
        );
    }
  }
  if (resource === "tasks" && row.project_id && row.task_type === "work") {
    const totals = await client.query<Row>(
      "SELECT p.estimated_total_budget, p.currency_code AS project_currency_code, COALESCE(SUM(t.estimated_cost) FILTER (WHERE t.task_type = 'work'), 0) AS allocated FROM management_projects p LEFT JOIN management_project_tasks t ON t.organization_id = p.organization_id AND t.project_id = p.id WHERE p.organization_id = $1 AND p.id = $2 GROUP BY p.estimated_total_budget, p.currency_code",
      [org, row.project_id],
    );
    const project = totals.rows[0];
    if (!project)
      throw new BadRequestError("Choose a valid project for this task", {
        field: "projectId",
      });
    if (
      row.budget_currency_code &&
      project.project_currency_code &&
      String(row.budget_currency_code) !== String(project.project_currency_code)
    )
      throw new BadRequestError(
        "A task budget must use the project budget currency",
        { field: "budgetCurrencyCode" },
      );
    if (
      Number(project.allocated ?? 0) >
        Number(project.estimated_total_budget ?? 0) + 0.0001 &&
      (!context.isOwner || !String(row.budget_override_reason ?? "").trim())
    )
      throw new BadRequestError(
        "Task budgets cannot exceed the main project budget without an owner justification",
        { field: "estimatedCost" },
      );
  }
  if (resource === "tasks" && !row.project_id) {
    if (!row.province_id)
      throw new BadRequestError("Choose a province for a normal company task", {
        field: "provinceId",
      });
    if (row.site_id) {
      const site = await client.query(
        "SELECT 1 FROM sites WHERE organization_id = $1 AND id = $2 AND province_id = $3",
        [org, row.site_id, row.province_id],
      );
      if (!site.rowCount)
        throw new BadRequestError("Choose a site in the selected province", {
          field: "siteId",
        });
    }
  }
  if (
    [
      "phases",
      "tasks",
      "budget-lines",
      "materials",
      "purchase-requests",
      "purchase-orders",
      "expenses",
    ].includes(resource)
  )
    await sameProject(
      row.phase_id,
      row.project_id,
      "The selected phase must belong to the selected project",
    );
  if (
    ["materials", "purchase-orders", "receipts", "stock-movements"].includes(
      resource,
    )
  )
    await assertWarehouseMatchesProject(
      row.project_id,
      resource === "materials" ? row.default_warehouse_id : row.warehouse_id,
    );
  if (resource === "material-movements" && row.warehouse_id) {
    const material = await client.query<{ project_id: string }>(
      "SELECT project_id FROM management_project_materials WHERE organization_id = $1 AND id = $2",
      [org, row.project_material_id],
    );
    await assertWarehouseMatchesProject(
      material.rows[0]?.project_id,
      row.warehouse_id,
    );
  }
  if (resource === "tasks" && row.phase_id)
    await sameProject(
      row.phase_id,
      row.project_id,
      "The selected phase must belong to this task's project",
    );
  if (
    ["expenses", "purchase-requests", "purchase-orders", "assets"].includes(
      resource,
    ) &&
    row.project_task_id
  ) {
    const task = await client.query<{ project_id: string; task_type: string }>(
      "SELECT project_id, task_type FROM management_project_tasks WHERE organization_id = $1 AND id = $2",
      [org, row.project_task_id],
    );
    if (
      !task.rowCount ||
      String(task.rows[0]?.project_id) !== String(row.project_id)
    )
      throw new BadRequestError(
        "The linked work item must belong to the same project",
      );
    if (task.rows[0]?.task_type !== "work")
      throw new BadRequestError(
        "Expenses, purchases and assets must be linked to a work item, not a milestone",
      );
  }
  if (resource === "material-movements" && row.project_task_id) {
    const task = await client.query<{
      task_type: string;
      same_project: boolean;
    }>(
      "SELECT t.task_type, t.project_id = pm.project_id AS same_project FROM management_project_tasks t JOIN management_project_materials pm ON pm.organization_id = t.organization_id AND pm.id = $2 WHERE t.organization_id = $1 AND t.id = $3",
      [org, row.project_material_id, row.project_task_id],
    );
    if (!task.rowCount || !task.rows[0]?.same_project)
      throw new BadRequestError(
        "The linked work item must belong to the material's project",
      );
    if (task.rows[0]?.task_type !== "work")
      throw new BadRequestError(
        "Material use must be linked to a work item, not a milestone",
      );
  }
  if (resource === "project-members") {
    if (row.assignment_role === "project_manager" && !row.is_manager)
      throw new BadRequestError(
        "Select the primary project manager checkbox for the Project Manager role",
        { field: "isManager" },
      );
    const assignmentStart = row.assignment_start_date
      ? new Date(String(row.assignment_start_date))
      : null;
    const assignmentEnd = row.assignment_end_date
      ? new Date(String(row.assignment_end_date))
      : null;
    if (
      assignmentStart &&
      assignmentEnd &&
      !Number.isNaN(assignmentStart.getTime()) &&
      !Number.isNaN(assignmentEnd.getTime()) &&
      assignmentEnd.getTime() < assignmentStart.getTime()
    )
      throw new BadRequestError(
        "The assignment end date cannot be before the assignment start date",
        { field: "assignmentEndDate" },
      );
  }
  if (resource === "tasks" && row.project_id && row.assigned_member_id) {
    const eligible = await client.query(
      "SELECT 1 FROM management_projects project JOIN employees employee ON employee.organization_id = project.organization_id AND employee.member_id = $3 JOIN organization_members member ON member.organization_id = employee.organization_id AND member.id = employee.member_id WHERE project.organization_id = $1 AND project.id = $2 AND employee.employment_status = 'active' AND member.status = 'active' AND (employee.site_id = project.site_id OR employee.province_id = project.province_id)",
      [org, row.project_id, row.assigned_member_id],
    );
    if (!eligible.rowCount)
      throw new BadRequestError(
        "Assign this project task only to an active employee at the project site or province",
        { field: "assignedMemberId" },
      );
  }
  if (resource === "tasks" && row.task_type === "milestone") {
    const linked = await client.query(
      "SELECT 1 FROM management_expenses WHERE organization_id = $1 AND project_task_id = $2 UNION ALL SELECT 1 FROM management_purchase_requests WHERE organization_id = $1 AND project_task_id = $2 UNION ALL SELECT 1 FROM management_purchase_orders WHERE organization_id = $1 AND project_task_id = $2 UNION ALL SELECT 1 FROM management_assets WHERE organization_id = $1 AND project_task_id = $2 UNION ALL SELECT 1 FROM management_material_movements WHERE organization_id = $1 AND project_task_id = $2 LIMIT 1",
      [org, row.id],
    );
    if (linked.rowCount)
      throw new BadRequestError(
        "A work item with linked costs or resources cannot be converted into a milestone",
      );
  }
  if (resource === "operational-links") {
    // Every target is defined here, never from request input. This prevents an
    // arbitrary table name being used and gives us the resource location for
    // the project scope check below.
    const targets: Record<string, { from: string }> = {
      "poultry:flocks": {
        from: "poultry_flocks r JOIN poultry_houses h ON h.organization_id = r.organization_id AND h.id = r.house_id JOIN sites s ON s.organization_id = h.organization_id AND s.id = h.site_id",
      },
      "pigs:animals": {
        from: "pig_animals r JOIN pig_pens p ON p.organization_id = r.organization_id AND p.id = r.pen_id JOIN sites s ON s.organization_id = p.organization_id AND s.id = p.site_id",
      },
      "pigs:groups": {
        from: "pig_groups r JOIN pig_pens p ON p.organization_id = r.organization_id AND p.id = r.pen_id JOIN sites s ON s.organization_id = p.organization_id AND s.id = p.site_id",
      },
      "pigs:pens": {
        from: "pig_pens r JOIN sites s ON s.organization_id = r.organization_id AND s.id = r.site_id",
      },
      "agriculture:farms": {
        from: "agriculture_farms r JOIN sites s ON s.organization_id = r.organization_id AND s.id = r.site_id",
      },
      "agriculture:fields": {
        from: "agriculture_fields r JOIN agriculture_farms f ON f.organization_id = r.organization_id AND f.id = r.farm_id JOIN sites s ON s.organization_id = f.organization_id AND s.id = f.site_id",
      },
      "agriculture:plots": {
        from: "agriculture_plots r JOIN agriculture_fields fi ON fi.organization_id = r.organization_id AND fi.id = r.field_id JOIN agriculture_farms f ON f.organization_id = fi.organization_id AND f.id = fi.farm_id JOIN sites s ON s.organization_id = f.organization_id AND s.id = f.site_id",
      },
      "agriculture:plantings": {
        from: "agriculture_plantings r JOIN agriculture_plots pl ON pl.organization_id = r.organization_id AND pl.id = r.plot_id JOIN agriculture_fields fi ON fi.organization_id = pl.organization_id AND fi.id = pl.field_id JOIN agriculture_farms f ON f.organization_id = fi.organization_id AND f.id = fi.farm_id JOIN sites s ON s.organization_id = f.organization_id AND s.id = f.site_id",
      },
    };
    const target =
      targets[`${String(row.module_code)}:${String(row.resource_code)}`];
    if (!target)
      throw new BadRequestError(
        "This operational resource cannot be linked to a project",
      );
    const found = await client.query<{
      project_province_id: string;
      project_site_id: string | null;
      record_province_id: string;
      record_site_id: string;
    }>(
      "SELECT p.province_id AS project_province_id, p.site_id AS project_site_id, s.province_id AS record_province_id, s.id AS record_site_id FROM management_projects p CROSS JOIN " +
        target.from +
        " WHERE p.organization_id = $1 AND p.id = $2 AND r.organization_id = p.organization_id AND r.id = $3",
      [org, row.project_id, row.record_id],
    );
    const scope = found.rows[0];
    if (!scope)
      throw new NotFoundError(
        "Operational record not found in this organization",
      );
    if (String(scope.project_province_id) !== String(scope.record_province_id))
      throw new BadRequestError(
        "Choose an operational record in the project's province",
        { field: "recordId" },
      );
    if (
      scope.project_site_id &&
      String(scope.project_site_id) !== String(scope.record_site_id)
    )
      throw new BadRequestError(
        "Choose an operational record at the project's site",
        { field: "recordId" },
      );
  }
  if (resource === "phase-dependencies") {
    const match = await client.query<{
      waiting_project_id: string;
      prerequisite_project_id: string;
    }>(
      "SELECT p1.project_id AS waiting_project_id, p2.project_id AS prerequisite_project_id FROM management_project_phases p1 JOIN management_project_phases p2 ON p2.organization_id = p1.organization_id AND p2.id = $3 WHERE p1.organization_id = $1 AND p1.id = $2",
      [org, row.phase_id, row.depends_on_phase_id],
    );
    const dependency = match.rows[0];
    if (!dependency)
      throw new BadRequestError(
        "Choose phases that belong to this organization",
      );
    if (
      dependency.waiting_project_id !== dependency.prerequisite_project_id &&
      !context.isOwner
    )
      throw new ForbiddenError(
        "Only the workspace owner can create a dependency between projects",
      );
    const cycle = await client.query(
      "WITH RECURSIVE upstream(id) AS (SELECT depends_on_phase_id FROM management_project_phase_dependencies WHERE organization_id = $1 AND phase_id = $3 UNION SELECT d.depends_on_phase_id FROM management_project_phase_dependencies d JOIN upstream u ON u.id = d.phase_id WHERE d.organization_id = $1) SELECT 1 FROM upstream WHERE id = $2 LIMIT 1",
      [org, row.phase_id, row.depends_on_phase_id],
    );
    if (cycle.rowCount)
      throw new BadRequestError("A phase dependency cannot create a cycle");
  }
  if (resource === "task-dependencies") {
    const match = await client.query<{
      waiting_project_id: string | null;
      prerequisite_project_id: string | null;
    }>(
      "SELECT t1.project_id AS waiting_project_id, t2.project_id AS prerequisite_project_id FROM management_project_tasks t1 JOIN management_project_tasks t2 ON t2.organization_id = t1.organization_id AND t2.id = $3 WHERE t1.organization_id = $1 AND t1.id = $2",
      [org, row.task_id, row.depends_on_task_id],
    );
    const dependency = match.rows[0];
    if (!dependency)
      throw new BadRequestError(
        "Choose tasks that belong to this organization",
      );
    if (
      dependency.waiting_project_id !== dependency.prerequisite_project_id &&
      !context.isOwner
    )
      throw new ForbiddenError(
        "Only the workspace owner can create a dependency between projects",
      );
    const cycle = await client.query(
      "WITH RECURSIVE upstream(id) AS (SELECT depends_on_task_id FROM management_task_dependencies WHERE organization_id = $1 AND task_id = $3 UNION SELECT d.depends_on_task_id FROM management_task_dependencies d JOIN upstream u ON u.id = d.task_id WHERE d.organization_id = $1) SELECT 1 FROM upstream WHERE id = $2 LIMIT 1",
      [org, row.task_id, row.depends_on_task_id],
    );
    if (cycle.rowCount)
      throw new BadRequestError("A task dependency cannot create a cycle");
  }
  if (resource === "purchase-request-lines") {
    const match = await client.query(
      "SELECT pr.project_id, pm.project_id AS material_project_id FROM management_purchase_request_lines l JOIN management_purchase_requests pr ON pr.organization_id = l.organization_id AND pr.id = l.purchase_request_id LEFT JOIN management_project_materials pm ON pm.organization_id = l.organization_id AND pm.id = l.project_material_id WHERE l.organization_id = $1 AND l.id = $2",
      [org, row.id],
    );
    const value = match.rows[0];
    if (
      value?.material_project_id &&
      value.material_project_id !== value.project_id
    )
      throw new BadRequestError(
        "The material must belong to the purchase request project",
      );
  }
  if (resource === "receipts") {
    if (["rejected", "cancelled"].includes(String(row.status)))
      await reverseReceiptInventory(client, context, String(row.id));
    if (String(row.status) === "received") {
      await restoreReceiptInventory(client, context, String(row.id));
      // Receipt lines are prepared while the BR is a draft. Their stock and
      // durable-asset effects start only at confirmation, never while someone
      // is still editing quantities on the delivery note.
      const receiptLines = await client.query<Row>(
        "SELECT * FROM management_receipt_lines WHERE organization_id = $1 AND receipt_id = $2",
        [context.organizationId, row.id],
      );
      for (const receiptLine of receiptLines.rows)
        await applyEffects(client, context, "receipt-lines", receiptLine);
    }
    await refreshPurchaseOrderStatus(
      client,
      context,
      String(row.purchase_order_id),
    );
  }
  if (resource === "purchase-orders" && row.purchase_request_id) {
    const match = await client.query<{ status: string }>(
      "SELECT status FROM management_purchase_requests WHERE organization_id = $1 AND id = $2 AND project_id = $3 FOR UPDATE",
      [org, row.purchase_request_id, row.project_id],
    );
    if (!match.rowCount)
      throw new BadRequestError(
        "The purchase request must belong to the order project",
      );
    if (
      !["approved", "partially_approved"].includes(
        String(match.rows[0]?.status),
      )
    )
      throw new BadRequestError(
        "Choose a purchase request that has been approved",
        { field: "purchaseRequestId" },
      );
    // A DA may create only one live BC. Locking the DA row above makes this
    // rule safe even when two users try to create a BC at the same time.
    const existingOrder = await client.query<{ order_number: string }>(
      "SELECT order_number FROM management_purchase_orders WHERE organization_id = $1 AND purchase_request_id = $2 AND id <> $3 AND status <> 'cancelled' LIMIT 1",
      [org, row.purchase_request_id, row.id],
    );
    if (existingOrder.rowCount)
      throw new ConflictError(
        "This purchase request is already linked to purchase order " +
          String(existingOrder.rows[0]?.order_number ?? ""),
        { field: "purchaseRequestId" },
      );
  }
  if (resource === "receipts") {
    const match = await client.query(
      "SELECT 1 FROM management_purchase_orders WHERE organization_id = $1 AND id = $2 AND project_id = $3",
      [org, row.purchase_order_id, row.project_id],
    );
    if (!match.rowCount)
      throw new BadRequestError(
        "The receipt project must match its purchase order",
      );
  }
  if (resource === "receipt-lines") {
    const match = await client.query<{
      project_material_id: string | null;
      inventory_item_id: string | null;
    }>(
      "SELECT pol.project_material_id, pol.inventory_item_id FROM management_receipts re JOIN management_purchase_order_lines pol ON pol.organization_id = re.organization_id AND pol.purchase_order_id = re.purchase_order_id WHERE re.organization_id = $1 AND re.id = $2 AND pol.id = $3",
      [org, row.receipt_id, row.purchase_order_line_id],
    );
    const orderLine = match.rows[0];
    if (!orderLine)
      throw new BadRequestError(
        "The received item must belong to the receipt's purchase order",
      );
    if (
      row.project_material_id != null &&
      String(row.project_material_id) !==
        String(orderLine.project_material_id ?? "")
    )
      throw new BadRequestError(
        "The project material must match the ordered item",
        { field: "projectMaterialId" },
      );
    if (
      row.inventory_item_id != null &&
      String(row.inventory_item_id) !==
        String(orderLine.inventory_item_id ?? "")
    )
      throw new BadRequestError(
        "The inventory item must match the ordered item",
        { field: "inventoryItemId" },
      );
  }
}

async function adjustStock(
  client: PoolClient,
  context: OwnerManagementContext,
  warehouseId: string,
  itemId: string,
  delta: number,
): Promise<void> {
  const updated = await client.query(
    "UPDATE management_inventory_stock SET quantity_on_hand = quantity_on_hand + $4, updated_at = now() WHERE organization_id = $1 AND warehouse_id = $2 AND item_id = $3 AND quantity_on_hand + $4 >= 0 RETURNING quantity_on_hand",
    [context.organizationId, warehouseId, itemId, delta],
  );
  if (updated.rowCount) return;
  if (delta < 0)
    throw new BadRequestError("There is not enough stock for this issue");
  await client.query(
    "INSERT INTO management_inventory_stock (organization_id, warehouse_id, item_id, quantity_on_hand) VALUES ($1, $2, $3, $4)",
    [context.organizationId, warehouseId, itemId, delta],
  );
}

export async function writeStockLedger(
  client: PoolClient,
  context: OwnerManagementContext,
  data: {
    warehouseId: string;
    itemId: string;
    projectId?: string | null;
    projectMaterialId?: string | null;
    movementType: string;
    quantityDelta: number;
    unitCost?: number | null;
    referenceType: string;
    referenceId: string;
    notes?: string | null;
  },
): Promise<void> {
  await adjustStock(
    client,
    context,
    data.warehouseId,
    data.itemId,
    data.quantityDelta,
  );
  await client.query(
    "INSERT INTO management_inventory_stock_movements (organization_id, warehouse_id, item_id, project_id, project_material_id, movement_type, quantity_delta, unit_cost, reference_type, reference_id, performed_by_member_id, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    [
      context.organizationId,
      data.warehouseId,
      data.itemId,
      data.projectId ?? null,
      data.projectMaterialId ?? null,
      data.movementType,
      data.quantityDelta,
      data.unitCost ?? null,
      data.referenceType,
      data.referenceId,
      context.memberId,
      data.notes ?? null,
    ],
  );
}

export async function transferInventoryStock(
  context: OwnerManagementContext,
  input: {
    sourceWarehouseId: string;
    destinationWarehouseId: string;
    itemId: string;
    quantity: number;
    movementDate: string;
    notes?: string;
  },
): Promise<{
  transferId: string;
  sourceMovement: Row;
  destinationMovement: Row;
}> {
  return withTenantContext(context, async (client) => {
    if (input.sourceWarehouseId === input.destinationWarehouseId)
      throw new BadRequestError("Choose a different destination warehouse", {
        field: "destinationWarehouseId",
      });
    const quantity = Number(input.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0)
      throw new BadRequestError("Enter a quantity greater than zero", {
        field: "quantity",
      });

    const [sourceWarehouse, destinationWarehouse, item] = await Promise.all([
      rawRecord(client, context, "warehouses", input.sourceWarehouseId),
      rawRecord(client, context, "warehouses", input.destinationWarehouseId),
      rawRecord(client, context, "inventory-items", input.itemId),
    ]);
    if (sourceWarehouse.is_active === false)
      throw new BadRequestError("The source warehouse is inactive", {
        field: "sourceWarehouseId",
      });
    if (destinationWarehouse.is_active === false)
      throw new BadRequestError("The destination warehouse is inactive", {
        field: "destinationWarehouseId",
      });
    if (item.is_active === false)
      throw new BadRequestError("The inventory item is inactive", {
        field: "itemId",
      });

    // The paired ledger rows identify the other warehouse. Keep only the
    // optional human note in the ledger so the screen can translate direction
    // and destination for the reader's selected language.
    const transferId = randomUUID();
    const detail = input.notes?.trim() || null;
    const writeTransferEntry = async (
      warehouseId: string,
      movementType: "transfer_out" | "transfer_in",
      quantityDelta: number,
      notes: string | null,
    ): Promise<Row> => {
      await adjustStock(
        client,
        context,
        warehouseId,
        input.itemId,
        quantityDelta,
      );
      const result = await client.query<Row>(
        "INSERT INTO management_inventory_stock_movements (organization_id, warehouse_id, item_id, movement_date, movement_type, quantity_delta, reference_type, reference_id, performed_by_member_id, notes) VALUES ($1,$2,$3,$4,$5,$6,'warehouse_transfer',$7,$8,$9) RETURNING *",
        [
          context.organizationId,
          warehouseId,
          input.itemId,
          input.movementDate,
          movementType,
          quantityDelta,
          transferId,
          context.memberId,
          notes,
        ],
      );
      const movement = result.rows[0];
      if (!movement)
        throw new BadRequestError("Could not record stock transfer");
      return movement;
    };

    // Both ledger entries and balance updates run in this same database
    // transaction: a transfer is either fully completed or not recorded at all.
    const sourceMovement = await writeTransferEntry(
      input.sourceWarehouseId,
      "transfer_out",
      -quantity,
      detail,
    );
    const destinationMovement = await writeTransferEntry(
      input.destinationWarehouseId,
      "transfer_in",
      quantity,
      detail,
    );
    const auditMetadata = {
      transferId,
      counterpartWarehouseId: input.destinationWarehouseId,
      quantity,
      movementDate: input.movementDate,
    };
    await writeOwnerManagementAudit(
      client,
      context,
      "create",
      "stock-movements",
      sourceMovement,
      ["sourceWarehouseId", "destinationWarehouseId", "itemId", "quantity"],
      { ...auditMetadata, direction: "out" },
    );
    await writeOwnerManagementAudit(
      client,
      context,
      "create",
      "stock-movements",
      destinationMovement,
      ["sourceWarehouseId", "destinationWarehouseId", "itemId", "quantity"],
      {
        ...auditMetadata,
        counterpartWarehouseId: input.sourceWarehouseId,
        direction: "in",
      },
    );

    return {
      transferId,
      sourceMovement: mapRow(sourceMovement),
      destinationMovement: mapRow(destinationMovement),
    };
  });
}
async function updateAssetMeter(
  client: PoolClient,
  context: OwnerManagementContext,
  assetId: string,
  meter: unknown,
): Promise<void> {
  if (meter === null || meter === undefined) return;
  await client.query(
    "UPDATE management_assets SET current_meter_reading = GREATEST(COALESCE(current_meter_reading, 0), $3) WHERE organization_id = $1 AND id = $2",
    [context.organizationId, assetId, meter],
  );
}

async function refreshPurchaseOrderStatus(
  client: PoolClient,
  context: OwnerManagementContext,
  orderId: string,
): Promise<void> {
  const result = await client.query<{
    ordered: string;
    accepted: string;
    current_status: string;
  }>(
    "SELECT COALESCE(SUM(pol.ordered_quantity), 0) AS ordered, COALESCE(SUM(COALESCE(x.accepted, 0)), 0) AS accepted, po.status AS current_status FROM management_purchase_orders po LEFT JOIN management_purchase_order_lines pol ON pol.organization_id = po.organization_id AND pol.purchase_order_id = po.id LEFT JOIN LATERAL (SELECT SUM(rl.received_quantity - rl.damaged_quantity - rl.rejected_quantity) AS accepted FROM management_receipt_lines rl JOIN management_receipts re ON re.organization_id = rl.organization_id AND re.id = rl.receipt_id AND re.status IN ('received', 'verified') WHERE rl.organization_id = pol.organization_id AND rl.purchase_order_line_id = pol.id) x ON true WHERE po.organization_id = $1 AND po.id = $2 GROUP BY po.status",
    [context.organizationId, orderId],
  );
  const row = result.rows[0];
  if (!row || ["draft", "cancelled", "closed"].includes(row.current_status))
    return;
  const ordered = Number(row.ordered);
  const accepted = Number(row.accepted);
  const status =
    accepted >= ordered && ordered > 0
      ? "received"
      : accepted > 0
        ? "partially_received"
        : ["received", "partially_received"].includes(row.current_status)
          ? "sent"
          : row.current_status;
  await client.query(
    "UPDATE management_purchase_orders SET status = $3 WHERE organization_id = $1 AND id = $2",
    [context.organizationId, orderId, status],
  );
}

type AutomaticApproval = {
  entityType: string;
  entityId: string;
  projectId?: string | null;
  requestType:
    "purchase_request" | "expense" | "maintenance_expense" | "phase_completion";
  requestedAmount?: number | null;
  currencyCode?: string | null;
  requestNotes?: string | null;
};

/**
 * Creates one pending decision for a business record.  The database trigger
 * assigns the human approval number, and the live-pending check makes repeated
 * edits idempotent: submitting a request twice never creates two decisions.
 */
async function queueAutomaticApproval(
  client: PoolClient,
  context: OwnerManagementContext,
  input: AutomaticApproval,
): Promise<void> {
  const existing = await client.query(
    "SELECT 1 FROM management_approval_requests WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND status = 'pending' LIMIT 1",
    [context.organizationId, input.entityType, input.entityId],
  );
  if (existing.rowCount) return;

  await client.query(
    "INSERT INTO management_approval_requests (organization_id, project_id, entity_type, entity_id, request_type, requested_by_member_id, requested_amount, currency_code, request_notes) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'CDF'), $9)",
    [
      context.organizationId,
      input.projectId ?? null,
      input.entityType,
      input.entityId,
      input.requestType,
      context.memberId,
      input.requestedAmount ?? null,
      input.currencyCode ?? null,
      input.requestNotes ?? null,
    ],
  );
}

async function purchaseRequestEstimatedAmount(
  client: PoolClient,
  organizationId: string,
  purchaseRequestId: string,
): Promise<number | null> {
  const result = await client.query<{
    item_count: string;
    missing_cost_count: string;
    estimated_amount: string | number | null;
  }>(
    "SELECT count(*)::text AS item_count, count(*) FILTER (WHERE estimated_unit_cost IS NULL)::text AS missing_cost_count, SUM(requested_quantity * estimated_unit_cost) AS estimated_amount FROM management_purchase_request_lines WHERE organization_id = $1 AND purchase_request_id = $2",
    [organizationId, purchaseRequestId],
  );
  const row = result.rows[0];
  if (
    !row ||
    Number(row.item_count) === 0 ||
    Number(row.missing_cost_count) > 0
  )
    return null;
  const amount = Number(row.estimated_amount);
  return Number.isFinite(amount) ? amount : null;
}

/** Turn an operational "submitted / waiting approval" state into the decision queue. */
async function queueApprovalForWorkflow(
  client: PoolClient,
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  row: Row,
): Promise<void> {
  if (
    resource === "purchase-requests" &&
    ["submitted", "under_review"].includes(String(row.status))
  ) {
    await queueAutomaticApproval(client, context, {
      entityType: "purchase_request",
      entityId: String(row.id),
      projectId: String(row.project_id),
      requestType: "purchase_request",
      requestedAmount: await purchaseRequestEstimatedAmount(
        client,
        context.organizationId,
        String(row.id),
      ),
      currencyCode: row.currency_code as string | null,
      requestNotes: (row.reason ?? row.notes ?? null) as string | null,
    });
    await client.query(
      "UPDATE management_purchase_requests SET approval_status = 'pending' WHERE organization_id = $1 AND id = $2 AND approval_status <> 'pending'",
      [context.organizationId, row.id],
    );
    return;
  }

  if (resource === "expenses" && String(row.status) === "submitted") {
    await queueAutomaticApproval(client, context, {
      entityType: "expense",
      entityId: String(row.id),
      projectId: (row.project_id as string | null) ?? null,
      requestType: "expense",
      requestedAmount: Number(row.amount ?? 0),
      currencyCode: row.currency_code as string | null,
      requestNotes: (row.description ?? row.notes ?? null) as string | null,
    });
    return;
  }

  if (
    resource === "maintenance-work-orders" &&
    row.status === "waiting_approval"
  ) {
    await queueAutomaticApproval(client, context, {
      entityType: "maintenance_work_order",
      entityId: String(row.id),
      projectId: (row.project_id as string | null) ?? null,
      requestType: "maintenance_expense",
      requestedAmount:
        Number(row.labor_cost ?? 0) +
        Number(row.parts_cost ?? 0) +
        Number(row.other_cost ?? 0),
      requestNotes: (row.title ?? row.problem_description ?? null) as
        string | null,
    });
    return;
  }

  if (resource === "phases" && row.status === "waiting_approval") {
    await queueAutomaticApproval(client, context, {
      entityType: "project_phase",
      entityId: String(row.id),
      projectId: String(row.project_id),
      requestType: "phase_completion",
      requestedAmount: Number(row.planned_budget ?? 0),
      requestNotes: (row.name ?? row.notes ?? null) as string | null,
    });
  }
}
/** A project's named responsible manager is an operational assignment, not
 * merely a label. Keep its active project-manager record and role in sync. */
async function syncResponsibleProjectManager(
  client: PoolClient,
  context: OwnerManagementContext,
  project: Row,
): Promise<void> {
  const memberId = String(project.responsible_member_id ?? "").trim();
  if (!memberId) {
    // Clearing the responsible manager also removes every current primary
    // manager flag. Historical assignments are left intact for the audit log.
    await client.query(
      "UPDATE management_project_members SET is_manager = false WHERE organization_id = $1 AND project_id = $2 AND is_manager AND assignment_start_date <= current_date AND (assignment_end_date IS NULL OR assignment_end_date >= current_date)",
      [context.organizationId, project.id],
    );
    return;
  }
  const member = await client.query<{ id: string }>(
    "SELECT id FROM organization_members WHERE organization_id = $1 AND id = $2 AND status = 'active'",
    [context.organizationId, memberId],
  );
  if (!member.rowCount)
    throw new BadRequestError(
      "Choose an active company member as the responsible project manager",
      { field: "responsibleMemberId" },
    );

  // Only one person leads the project at a time. Historical assignments remain
  // intact; only currently active primary-manager records are changed.
  await client.query(
    "UPDATE management_project_members SET is_manager = false WHERE organization_id = $1 AND project_id = $2 AND member_id <> $3 AND is_manager AND assignment_start_date <= current_date AND (assignment_end_date IS NULL OR assignment_end_date >= current_date)",
    [context.organizationId, project.id, memberId],
  );
  const active = await client.query<{ id: string }>(
    "SELECT id FROM management_project_members WHERE organization_id = $1 AND project_id = $2 AND member_id = $3 AND assignment_start_date <= current_date AND (assignment_end_date IS NULL OR assignment_end_date >= current_date) ORDER BY assignment_start_date DESC, assigned_at DESC LIMIT 1 FOR UPDATE",
    [context.organizationId, project.id, memberId],
  );
  if (active.rowCount) {
    await client.query(
      "UPDATE management_project_members SET assignment_role = 'project_manager', is_manager = true WHERE organization_id = $1 AND id = $2",
      [context.organizationId, active.rows[0]!.id],
    );
  } else {
    await client.query(
      "INSERT INTO management_project_members (organization_id, project_id, member_id, assignment_role, is_manager, assignment_start_date, assigned_by, notes) VALUES ($1,$2,$3,'project_manager',true,current_date,$4,'Automatically assigned from Responsible manager')",
      [context.organizationId, project.id, memberId, context.userId],
    );
  }
  const projectManagerRole = await client.query<{ id: string }>(
    "SELECT id FROM roles WHERE organization_id = $1 AND code = 'project_manager'",
    [context.organizationId],
  );
  const roleId = projectManagerRole.rows[0]?.id;
  if (!roleId)
    throw new BadRequestError(
      "The Project Manager role is not configured for this company",
    );
  await client.query(
    "INSERT INTO member_roles (organization_id, member_id, role_id, assigned_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [context.organizationId, memberId, roleId, context.userId],
  );
}

/** The person accountable for outcomes may be different from the person who
 * delivered the investment. Keep that accountability inside the company and
 * make the form error precise before the foreign key is reached. */
async function assertActiveProjectBenefitOwner(
  client: PoolClient,
  context: OwnerManagementContext,
  memberId: unknown,
): Promise<void> {
  if (memberId == null || !String(memberId).trim()) return;
  const member = await client.query<{ id: string }>(
    "SELECT id FROM organization_members WHERE organization_id = $1 AND id = $2 AND status = 'active'",
    [context.organizationId, memberId],
  );
  if (!member.rowCount)
    throw new BadRequestError(
      "Choose an active company member as the benefit owner",
      { field: "benefitOwnerMemberId" },
    );
}

async function assertActiveProjectRiskOwner(
  client: PoolClient,
  context: OwnerManagementContext,
  memberId: unknown,
): Promise<void> {
  if (memberId == null || !String(memberId).trim())
    throw new BadRequestError(
      "Choose an active person responsible for this risk",
      {
        field: "ownerMemberId",
      },
    );
  const member = await client.query<{ id: string }>(
    "SELECT id FROM organization_members WHERE organization_id = $1 AND id = $2 AND status = 'active'",
    [context.organizationId, memberId],
  );
  if (!member.rowCount)
    throw new BadRequestError(
      "Choose an active company member responsible for this risk",
      { field: "ownerMemberId" },
    );
}

/** A material purchased for a project must not disappear simply because the
 * requester typed a new description instead of selecting a pre-existing
 * material. The purchase order is the first committed source: create (or
 * reuse) one project-material record there and preserve the links through the
 * request, order and receipt trail. */
async function ensureProjectMaterialForPurchaseOrderLine(
  client: PoolClient,
  context: OwnerManagementContext,
  purchaseOrderLineId: string,
): Promise<string | null> {
  const sourceResult = await client.query<Row>(
    "SELECT pol.id, pol.purchase_request_line_id, pol.project_material_id, pol.inventory_item_id, pol.description, pol.unit, pol.ordered_quantity, pol.unit_cost, po.project_id, po.phase_id, po.supplier_id FROM management_purchase_order_lines pol JOIN management_purchase_orders po ON po.organization_id = pol.organization_id AND po.id = pol.purchase_order_id WHERE pol.organization_id = $1 AND pol.id = $2 AND pol.item_kind = 'material'",
    [context.organizationId, purchaseOrderLineId],
  );
  const source = sourceResult.rows[0];
  if (!source) return null;
  if (source.project_material_id) return String(source.project_material_id);

  const existing = await client.query<{ id: string }>(
    "SELECT id FROM management_project_materials WHERE organization_id = $1 AND project_id = $2 AND lower(btrim(name)) = lower(btrim($3)) AND lower(btrim(unit)) = lower(btrim($4)) ORDER BY created_at ASC LIMIT 1",
    [
      context.organizationId,
      source.project_id,
      source.description,
      source.unit,
    ],
  );
  let materialId = existing.rows[0]?.id ?? null;
  if (!materialId) {
    const created = await client.query<{ id: string }>(
      "INSERT INTO management_project_materials (organization_id, project_id, phase_id, inventory_item_id, preferred_supplier_id, code, name, category, unit, planned_quantity, estimated_unit_cost, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,'Procurement',$8,$9,$10,'Created automatically from a purchase order') RETURNING id",
      [
        context.organizationId,
        source.project_id,
        source.phase_id ?? null,
        source.inventory_item_id ?? null,
        source.supplier_id ?? null,
        `auto_material_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
        source.description,
        source.unit,
        Math.max(Number(source.ordered_quantity ?? 0), 0.001),
        source.unit_cost ?? null,
      ],
    );
    materialId = created.rows[0]?.id ?? null;
  }
  if (!materialId)
    throw new BadRequestError("Could not create the project material");

  await client.query(
    "UPDATE management_purchase_order_lines SET project_material_id = $3 WHERE organization_id = $1 AND id = $2 AND project_material_id IS NULL",
    [context.organizationId, purchaseOrderLineId, materialId],
  );
  if (source.purchase_request_line_id)
    await client.query(
      "UPDATE management_purchase_request_lines SET project_material_id = $3 WHERE organization_id = $1 AND id = $2 AND project_material_id IS NULL",
      [context.organizationId, source.purchase_request_line_id, materialId],
    );
  return materialId;
}
/** A project material becomes a company inventory article only when goods are
 * actually accepted. Planning or ordering alone never creates physical stock. */
async function ensureInventoryItemForProjectMaterial(
  client: PoolClient,
  context: OwnerManagementContext,
  projectMaterialId: string,
): Promise<string | null> {
  const materialResult = await client.query<Row>(
    "SELECT inventory_item_id, name, category, unit, estimated_unit_cost FROM management_project_materials WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    [context.organizationId, projectMaterialId],
  );
  const material = materialResult.rows[0];
  if (!material) return null;
  if (material.inventory_item_id) return String(material.inventory_item_id);

  const existing = await client.query<{ id: string }>(
    "SELECT id FROM management_inventory_items WHERE organization_id = $1 AND lower(btrim(name)) = lower(btrim($2)) AND lower(btrim(unit)) = lower(btrim($3)) ORDER BY created_at ASC LIMIT 1",
    [context.organizationId, material.name, material.unit],
  );
  let itemId = existing.rows[0]?.id ?? null;
  if (!itemId) {
    const created = await client.query<{ id: string }>(
      "INSERT INTO management_inventory_items (organization_id, code, name, category, unit, standard_unit_cost, notes) VALUES ($1,$2,$3,$4,$5,$6,'Created automatically when this project material was first received') RETURNING id",
      [
        context.organizationId,
        `auto_item_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
        material.name,
        material.category ?? "Project material",
        material.unit,
        material.estimated_unit_cost ?? null,
      ],
    );
    itemId = created.rows[0]?.id ?? null;
  }
  if (!itemId) throw new BadRequestError("Could not create the inventory item");
  await client.query(
    "UPDATE management_project_materials SET inventory_item_id = $3 WHERE organization_id = $1 AND id = $2 AND inventory_item_id IS NULL",
    [context.organizationId, projectMaterialId, itemId],
  );
  return itemId;
}
function isKilogramUnit(value: unknown): boolean {
  return ["kg", "kilogram", "kilograms"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}

async function assertFeedBatchContext(
  client: PoolClient,
  context: OwnerManagementContext,
  input: Input,
): Promise<void> {
  const siteId = String(input.siteId ?? "");
  const warehouseId = String(input.warehouseId ?? "");
  if (!siteId || !warehouseId)
    throw new BadRequestError(
      "Choose the production site and finished-feed warehouse",
    );
  const warehouse = await client.query<{ site_id: string }>(
    "SELECT site_id FROM management_warehouses WHERE organization_id = $1 AND id = $2 AND is_active = true",
    [context.organizationId, warehouseId],
  );
  if (!warehouse.rowCount || warehouse.rows[0]?.site_id !== siteId)
    throw new BadRequestError(
      "The finished-feed warehouse must belong to the production site",
      { field: "warehouseId" },
    );
  if (input.projectId) {
    const project = await client.query<{ site_id: string | null }>(
      "SELECT site_id FROM management_projects WHERE organization_id = $1 AND id = $2",
      [context.organizationId, input.projectId],
    );
    if (!project.rowCount)
      throw new BadRequestError("Choose a project in this company", {
        field: "projectId",
      });
    if (project.rows[0]?.site_id && project.rows[0]?.site_id !== siteId)
      throw new BadRequestError(
        "The feed batch site must match the linked project site",
        { field: "siteId" },
      );
  }
}

async function assertNutritionRecipeLineContext(
  client: PoolClient,
  context: OwnerManagementContext,
  input: Input,
): Promise<void> {
  const recipeId = String(input.recipeId ?? "");
  const itemId = String(input.inventoryItemId ?? "");
  if (!recipeId || !itemId) return;
  const [recipe, item] = await Promise.all([
    client.query(
      "SELECT 1 FROM nutrition_feed_recipes WHERE organization_id=$1 AND id=$2",
      [context.organizationId, recipeId],
    ),
    client.query<{ category: string | null; unit: string; is_active: boolean }>(
      "SELECT category,unit,is_active FROM management_inventory_items WHERE organization_id=$1 AND id=$2",
      [context.organizationId, itemId],
    ),
  ]);
  if (!recipe.rowCount)
    throw new BadRequestError("Choose a feed recipe in this company", {
      field: "recipeId",
    });
  const stockItem = item.rows[0];
  const category = String(stockItem?.category ?? "")
    .trim()
    .toLowerCase();
  if (
    !stockItem?.is_active ||
    ![
      "provenderie · matière première",
      "provenderie · additif / minéral",
      "feed_raw_material",
      "feed_additive",
      "matière première alimentaire",
      "matiere premiere alimentaire",
      "feed raw material",
      "feed additive",
      "additif alimentaire",
      "additif & minéral",
    ].includes(category)
  )
    throw new BadRequestError(
      "Choose an active stock item classified as « Provenderie · matière première » or « Provenderie · additif / minéral ».",
      { field: "inventoryItemId" },
    );
  if (
    !isKilogramUnit(stockItem.unit) &&
    ![
      "g",
      "gram",
      "gramme",
      "bag_50",
      "sac_50",
      "50kg",
      "50 kg",
      "sac 50 kg",
    ].includes(String(stockItem.unit).trim().toLowerCase())
  )
    throw new BadRequestError(
      "A feed ingredient must use kg, g, or a 50 kg bag.",
      { field: "inventoryItemId" },
    );
}

async function assertNutritionFeedOrderContext(
  client: PoolClient,
  context: OwnerManagementContext,
  input: Input,
): Promise<void> {
  const recipeId = String(input.recipeId ?? "");
  const siteId = String(input.siteId ?? "");
  const inputWarehouseId = String(input.inputWarehouseId ?? "");
  const outputWarehouseId = String(input.outputWarehouseId ?? "");
  if (!recipeId || !siteId || !inputWarehouseId || !outputWarehouseId)
    throw new BadRequestError(
      "Choose a recipe, production site, ingredient warehouse and finished-feed warehouse",
    );
  const recipe = await client.query<{ id: string }>(
    "SELECT id FROM nutrition_feed_recipes WHERE organization_id=$1 AND id=$2 AND is_active=true",
    [context.organizationId, recipeId],
  );
  if (!recipe.rowCount)
    throw new BadRequestError("Choose an active feed recipe in this company", {
      field: "recipeId",
    });
  const warehouses = await client.query<{
    id: string;
    site_id: string;
    is_active: boolean;
  }>(
    "SELECT id,site_id,is_active FROM management_warehouses WHERE organization_id=$1 AND id = ANY($2::uuid[])",
    [context.organizationId, [inputWarehouseId, outputWarehouseId]],
  );
  if (
    warehouses.rowCount !== 2 ||
    warehouses.rows.some(
      (warehouse) => !warehouse.is_active || warehouse.site_id !== siteId,
    )
  )
    throw new BadRequestError(
      "Both selected warehouses must be active and belong to the production site",
      { field: "inputWarehouseId" },
    );
  if (input.projectId) {
    const project = await client.query<{ site_id: string | null }>(
      "SELECT site_id FROM management_projects WHERE organization_id=$1 AND id=$2",
      [context.organizationId, input.projectId],
    );
    if (
      !project.rowCount ||
      (project.rows[0]?.site_id && project.rows[0].site_id !== siteId)
    )
      throw new BadRequestError(
        "The production order site must match the linked project site",
        { field: "siteId" },
      );
  }
}

async function lockedFeedBatch(
  client: PoolClient,
  context: OwnerManagementContext,
  batchId: unknown,
): Promise<Row> {
  const result = await client.query<Row>(
    "SELECT * FROM management_feed_batches WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    [context.organizationId, batchId],
  );
  const batch = result.rows[0];
  if (!batch) throw new NotFoundError("Feed batch not found");
  return batch;
}

async function assertFeedBatchInputsCanChange(
  client: PoolClient,
  context: OwnerManagementContext,
  batchId: unknown,
): Promise<Row> {
  const batch = await lockedFeedBatch(client, context, batchId);
  if (String(batch.status) !== "draft")
    throw new ForbiddenError(
      "Ingredients are locked after the feed batch is confirmed or cancelled",
    );
  return batch;
}

async function assertFeedBatchInputContext(
  client: PoolClient,
  context: OwnerManagementContext,
  input: Input,
): Promise<void> {
  const batch = await assertFeedBatchInputsCanChange(
    client,
    context,
    input.batchId,
  );
  const quantity = Number(input.quantityKg ?? 0);
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw new BadRequestError(
      "Enter an ingredient quantity greater than zero",
      {
        field: "quantityKg",
      },
    );
  const sourceType = String(input.sourceType ?? "");
  if (sourceType === "harvest") {
    const harvest = await client.query<{ site_id: string; unit: string }>(
      "SELECT s.id AS site_id, h.unit FROM agriculture_harvest_records h JOIN agriculture_plantings p ON p.organization_id = h.organization_id AND p.id = h.planting_id JOIN agriculture_plots pl ON pl.organization_id = p.organization_id AND pl.id = p.plot_id JOIN agriculture_fields f ON f.organization_id = pl.organization_id AND f.id = pl.field_id JOIN agriculture_farms farm ON farm.organization_id = f.organization_id AND farm.id = f.farm_id JOIN sites s ON s.organization_id = farm.organization_id AND s.id = farm.site_id WHERE h.organization_id = $1 AND h.id = $2",
      [context.organizationId, input.harvestRecordId],
    );
    if (!harvest.rowCount || harvest.rows[0]?.site_id !== batch.site_id)
      throw new BadRequestError(
        "Choose a harvest from the same feed-production site",
        { field: "harvestRecordId" },
      );
    if (!isKilogramUnit(harvest.rows[0]?.unit))
      throw new BadRequestError(
        "Only harvests recorded in kilograms can be used as feed ingredients",
        { field: "harvestRecordId" },
      );
    return;
  }
  if (sourceType === "inventory") {
    const source = await client.query<{
      warehouse_site_id: string;
      unit: string;
    }>(
      "SELECT w.site_id AS warehouse_site_id, i.unit FROM management_inventory_items i JOIN management_warehouses w ON w.organization_id = i.organization_id AND w.id = $3 AND w.is_active = true WHERE i.organization_id = $1 AND i.id = $2 AND i.is_active = true",
      [context.organizationId, input.inventoryItemId, input.warehouseId],
    );
    if (!source.rowCount || source.rows[0]?.warehouse_site_id !== batch.site_id)
      throw new BadRequestError(
        "Choose a stocked ingredient from a warehouse at the feed-production site",
        { field: "warehouseId" },
      );
    if (!isKilogramUnit(source.rows[0]?.unit))
      throw new BadRequestError(
        "Only stock measured in kilograms can be used as a feed ingredient",
        { field: "inventoryItemId" },
      );
    return;
  }
  throw new BadRequestError(
    "Choose harvest or inventory as the ingredient source",
    {
      field: "sourceType",
    },
  );
}

async function ensureFeedOutputItem(
  client: PoolClient,
  context: OwnerManagementContext,
  batch: Row,
): Promise<string> {
  if (batch.output_item_id) {
    const output = await client.query<{
      id: string;
      unit: string;
      is_active: boolean;
    }>(
      "SELECT id, unit, is_active FROM management_inventory_items WHERE organization_id = $1 AND id = $2",
      [context.organizationId, batch.output_item_id],
    );
    if (
      !output.rowCount ||
      !output.rows[0]?.is_active ||
      !isKilogramUnit(output.rows[0]?.unit)
    )
      throw new BadRequestError(
        "The finished-feed item must be an active inventory item measured in kilograms",
        { field: "outputItemId" },
      );
    return output.rows[0]!.id;
  }
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM management_inventory_items WHERE organization_id = $1 AND lower(btrim(name)) = lower(btrim($2)) AND lower(btrim(unit)) = 'kg' ORDER BY created_at LIMIT 1",
    [context.organizationId, batch.feed_name],
  );
  const itemId = existing.rows[0]?.id;
  if (itemId) {
    await client.query(
      "UPDATE management_feed_batches SET output_item_id = $3 WHERE organization_id = $1 AND id = $2",
      [context.organizationId, batch.id, itemId],
    );
    return itemId;
  }
  const stem =
    String(batch.feed_name)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 42) || "fabrique";
  const code =
    `alim_${stem}_${randomUUID().replace(/-/g, "").slice(0, 6)}`.slice(0, 63);
  const created = await client.query<{ id: string }>(
    "INSERT INTO management_inventory_items (organization_id, code, name, category, unit, is_active, notes) VALUES ($1,$2,$3,'Aliment fabriqué','kg',true,'Created automatically from a confirmed feed batch') RETURNING id",
    [context.organizationId, code, batch.feed_name],
  );
  const createdId = created.rows[0]?.id;
  if (!createdId)
    throw new BadRequestError("Could not create the finished-feed stock item");
  await client.query(
    "UPDATE management_feed_batches SET output_item_id = $3 WHERE organization_id = $1 AND id = $2",
    [context.organizationId, batch.id, createdId],
  );
  return createdId;
}

async function applyFeedBatchInventoryEffects(
  client: PoolClient,
  context: OwnerManagementContext,
  batchId: string,
): Promise<void> {
  const batch = await lockedFeedBatch(client, context, batchId);
  const status = String(batch.status);
  if (status === "confirmed") {
    if (batch.stock_applied_at) return;
    const inputs = await client.query<Row>(
      "SELECT * FROM management_feed_batch_inputs WHERE organization_id = $1 AND batch_id = $2 ORDER BY created_at, id",
      [context.organizationId, batch.id],
    );
    if (!inputs.rowCount)
      throw new BadRequestError(
        "Add at least one harvest or stocked ingredient before confirming this feed batch",
      );
    let totalInputCost = 0;
    for (const input of inputs.rows) {
      const quantity = Number(input.quantity_kg);
      if (String(input.source_type) === "harvest") {
        const harvest = await client.query<{
          net_quantity: string;
          unit: string;
          site_id: string;
        }>(
          "SELECT h.quantity - h.rejected_quantity AS net_quantity, h.unit, s.id AS site_id FROM agriculture_harvest_records h JOIN agriculture_plantings p ON p.organization_id = h.organization_id AND p.id = h.planting_id JOIN agriculture_plots pl ON pl.organization_id = p.organization_id AND pl.id = p.plot_id JOIN agriculture_fields f ON f.organization_id = pl.organization_id AND f.id = pl.field_id JOIN agriculture_farms farm ON farm.organization_id = f.organization_id AND farm.id = f.farm_id JOIN sites s ON s.organization_id = farm.organization_id AND s.id = farm.site_id WHERE h.organization_id = $1 AND h.id = $2 FOR UPDATE",
          [context.organizationId, input.harvest_record_id],
        );
        const source = harvest.rows[0];
        if (
          !source ||
          source.site_id !== batch.site_id ||
          !isKilogramUnit(source.unit)
        )
          throw new BadRequestError(
            "A harvest ingredient is no longer available at this site",
          );
        const alreadyUsed = await client.query<{ quantity: string }>(
          "SELECT COALESCE(SUM(i.quantity_kg), 0) AS quantity FROM management_feed_batch_inputs i JOIN management_feed_batches b ON b.organization_id = i.organization_id AND b.id = i.batch_id WHERE i.organization_id = $1 AND i.harvest_record_id = $2 AND b.id <> $3 AND b.status = 'confirmed' AND b.stock_applied_at IS NOT NULL",
          [context.organizationId, input.harvest_record_id, batch.id],
        );
        const remaining =
          Number(source.net_quantity) -
          Number(alreadyUsed.rows[0]?.quantity ?? 0);
        if (quantity > remaining + 0.0001)
          throw new BadRequestError(
            "This feed batch uses more harvest than is still available",
            { field: "quantityKg" },
          );
        totalInputCost += quantity * Number(input.unit_cost ?? 0);
        continue;
      }
      const item = await client.query<{
        standard_unit_cost: string | null;
        unit: string;
      }>(
        "SELECT standard_unit_cost, unit FROM management_inventory_items WHERE organization_id = $1 AND id = $2 AND is_active = true",
        [context.organizationId, input.inventory_item_id],
      );
      if (!item.rowCount || !isKilogramUnit(item.rows[0]?.unit))
        throw new BadRequestError(
          "A stocked feed ingredient is no longer available",
        );
      const unitCost =
        input.unit_cost == null
          ? Number(item.rows[0]?.standard_unit_cost ?? 0)
          : Number(input.unit_cost);
      await writeStockLedger(client, context, {
        warehouseId: String(input.warehouse_id),
        itemId: String(input.inventory_item_id),
        projectId: batch.project_id ? String(batch.project_id) : null,
        movementType: "issue",
        quantityDelta: -quantity,
        unitCost,
        referenceType: "feed_batch_input",
        referenceId: String(input.id),
        notes: `Ingredient for ${String(batch.batch_number)}`,
      });
      totalInputCost += quantity * unitCost;
    }
    const outputItemId = await ensureFeedOutputItem(client, context, batch);
    const outputQuantity = Number(batch.output_quantity_kg);
    await writeStockLedger(client, context, {
      warehouseId: String(batch.warehouse_id),
      itemId: outputItemId,
      projectId: batch.project_id ? String(batch.project_id) : null,
      movementType: "adjustment_in",
      quantityDelta: outputQuantity,
      unitCost: outputQuantity > 0 ? totalInputCost / outputQuantity : 0,
      referenceType: "feed_batch_output",
      referenceId: String(batch.id),
      notes: `${String(batch.batch_number)} · ${String(batch.feed_name)}`,
    });
    await client.query(
      "UPDATE management_feed_batches SET stock_applied_at = now() WHERE organization_id = $1 AND id = $2",
      [context.organizationId, batch.id],
    );
    return;
  }
  if (status !== "cancelled" || batch.cancelled_at) return;
  if (batch.stock_applied_at && batch.output_item_id) {
    await writeStockLedger(client, context, {
      warehouseId: String(batch.warehouse_id),
      itemId: String(batch.output_item_id),
      projectId: batch.project_id ? String(batch.project_id) : null,
      movementType: "adjustment_out",
      quantityDelta: -Number(batch.output_quantity_kg),
      referenceType: "feed_batch_cancellation",
      referenceId: String(batch.id),
      notes: `Cancellation of ${String(batch.batch_number)}`,
    });
    const inputs = await client.query<Row>(
      "SELECT * FROM management_feed_batch_inputs WHERE organization_id = $1 AND batch_id = $2 AND source_type = 'inventory' ORDER BY created_at, id",
      [context.organizationId, batch.id],
    );
    for (const input of inputs.rows)
      await writeStockLedger(client, context, {
        warehouseId: String(input.warehouse_id),
        itemId: String(input.inventory_item_id),
        projectId: batch.project_id ? String(batch.project_id) : null,
        movementType: "return",
        quantityDelta: Number(input.quantity_kg),
        unitCost: input.unit_cost == null ? null : Number(input.unit_cost),
        referenceType: "feed_batch_cancellation",
        referenceId: String(input.id),
        notes: `Return from cancelled ${String(batch.batch_number)}`,
      });
  }
  await client.query(
    "UPDATE management_feed_batches SET cancelled_at = now() WHERE organization_id = $1 AND id = $2",
    [context.organizationId, batch.id],
  );
}
async function applyEffects(
  client: PoolClient,
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  row: Row,
): Promise<void> {
  if (resource === "projects") {
    await syncResponsibleProjectManager(client, context, row);
  }
  if (resource === "projects" && String(row.status) === "completed") {
    await client.query(
      "UPDATE management_projects SET completed_date = COALESCE(completed_date, current_date) WHERE organization_id = $1 AND id = $2",
      [context.organizationId, row.id],
    );
  }
  if (resource === "quality-checks" && row.warranty_expires_on) {
    if (row.asset_id)
      await client.query(
        "UPDATE management_assets SET warranty_expires_on = GREATEST(COALESCE(warranty_expires_on, $3::date), $3::date) WHERE organization_id = $1 AND id = $2",
        [context.organizationId, row.asset_id, row.warranty_expires_on],
      );
    else if (row.receipt_id)
      await client.query(
        "UPDATE management_assets asset SET warranty_expires_on = GREATEST(COALESCE(asset.warranty_expires_on, $3::date), $3::date) FROM management_receipt_line_assets link JOIN management_receipt_lines line ON line.organization_id = link.organization_id AND line.id = link.receipt_line_id WHERE asset.organization_id = $1 AND asset.id = link.asset_id AND line.receipt_id = $2",
        [context.organizationId, row.receipt_id, row.warranty_expires_on],
      );
  }
  if (resource === "project-closeouts" && String(row.status) === "completed") {
    await client.query(
      "UPDATE management_projects SET status = 'completed', lifecycle_stage = 'closed', completed_date = COALESCE(completed_date, current_date) WHERE organization_id = $1 AND id = $2",
      [context.organizationId, row.project_id],
    );
  }
  if (resource === "phases") {
    if (String(row.status) === "not_started")
      await client.query(
        "UPDATE management_project_phases SET progress_percent = 0, actual_start_date = NULL, completed_date = NULL WHERE organization_id = $1 AND id = $2",
        [context.organizationId, row.id],
      );
    if (String(row.status) === "in_progress")
      await client.query(
        "UPDATE management_project_phases SET actual_start_date = COALESCE(actual_start_date, current_date) WHERE organization_id = $1 AND id = $2",
        [context.organizationId, row.id],
      );
    if (String(row.status) === "completed")
      await client.query(
        "UPDATE management_project_phases SET progress_percent = 100, completed_date = COALESCE(completed_date, current_date) WHERE organization_id = $1 AND id = $2",
        [context.organizationId, row.id],
      );
  }
  if (resource === "project-members" && row.is_manager) {
    await client.query(
      "UPDATE management_project_members SET is_manager = false WHERE organization_id = $1 AND project_id = $2 AND id <> $3 AND is_manager AND assignment_start_date <= COALESCE($5::date, 'infinity'::date) AND COALESCE(assignment_end_date, 'infinity'::date) >= $4::date",
      [
        context.organizationId,
        row.project_id,
        row.id,
        row.assignment_start_date,
        row.assignment_end_date,
      ],
    );
    await client.query(
      "UPDATE management_project_members SET assignment_role = 'project_manager' WHERE organization_id = $1 AND id = $2",
      [context.organizationId, row.id],
    );
    const role = await client.query<{ id: string }>(
      "SELECT id FROM roles WHERE organization_id = $1 AND code = 'project_manager'",
      [context.organizationId],
    );
    const roleId = role.rows[0]?.id;
    if (!roleId)
      throw new BadRequestError(
        "The Project Manager role is not configured for this company",
      );
    await client.query(
      "INSERT INTO member_roles (organization_id, member_id, role_id, assigned_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
      [context.organizationId, row.member_id, roleId, context.userId],
    );
  }
  if (resource === "tasks") {
    if (row.task_type === "milestone")
      await client.query(
        "UPDATE management_project_tasks SET estimated_cost = NULL WHERE organization_id = $1 AND id = $2",
        [context.organizationId, row.id],
      );
    if (String(row.status) === "not_started")
      await client.query(
        "UPDATE management_project_tasks SET progress_percent = 0, completed_date = NULL WHERE organization_id = $1 AND id = $2",
        [context.organizationId, row.id],
      );
    if (String(row.status) === "completed")
      await client.query(
        "UPDATE management_project_tasks SET progress_percent = 100, completed_date = COALESCE(completed_date, current_date) WHERE organization_id = $1 AND id = $2",
        [context.organizationId, row.id],
      );
    if (row.phase_id)
      await client.query(
        "UPDATE management_project_phases SET progress_percent = COALESCE((SELECT COALESCE(AVG(progress_percent) FILTER (WHERE task_type = 'work'), AVG(progress_percent)) FROM management_project_tasks WHERE organization_id = $1 AND phase_id = $3), progress_percent) WHERE organization_id = $1 AND id = $2",
        [context.organizationId, row.phase_id, row.phase_id],
      );
  }
  if (resource === "feed-batches")
    await applyFeedBatchInventoryEffects(client, context, String(row.id));
  if (resource === "receipts") {
    if (["rejected", "cancelled"].includes(String(row.status)))
      await reverseReceiptInventory(client, context, String(row.id));
    if (String(row.status) === "received") {
      await restoreReceiptInventory(client, context, String(row.id));
      // Receipt lines are prepared while the BR is a draft. Their stock and
      // durable-asset effects start only at confirmation, never while someone
      // is still editing quantities on the delivery note.
      const receiptLines = await client.query<Row>(
        "SELECT * FROM management_receipt_lines WHERE organization_id = $1 AND receipt_id = $2",
        [context.organizationId, row.id],
      );
      for (const receiptLine of receiptLines.rows)
        await applyEffects(client, context, "receipt-lines", receiptLine);
    }
    await refreshPurchaseOrderStatus(
      client,
      context,
      String(row.purchase_order_id),
    );
  }
  if (resource === "purchase-order-lines" && row.item_kind === "material")
    await ensureProjectMaterialForPurchaseOrderLine(
      client,
      context,
      String(row.id),
    );
  if (resource === "purchase-orders" && row.purchase_request_id) {
    if (!row.project_task_id)
      await client.query(
        "UPDATE management_purchase_orders po SET project_task_id = pr.project_task_id, phase_id = COALESCE(po.phase_id, pr.phase_id) FROM management_purchase_requests pr WHERE po.organization_id = $1 AND po.id = $2 AND po.project_task_id IS NULL AND pr.organization_id = po.organization_id AND pr.id = po.purchase_request_id",
        [context.organizationId, row.id],
      );

    // An approved request is the source of truth for the first draft of a
    // purchase order. Copy its approved lines once, keeping the request-line
    // link for a complete audit trail. Draft order lines can still be refined
    // before the order is sent to its supplier.
    const existingLines = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM management_purchase_order_lines WHERE organization_id = $1 AND purchase_order_id = $2",
      [context.organizationId, row.id],
    );
    if (Number(existingLines.rows[0]?.count ?? 0) === 0)
      await client.query(
        "INSERT INTO management_purchase_order_lines (organization_id, purchase_order_id, purchase_request_line_id, project_material_id, inventory_item_id, description, item_kind, unit, ordered_quantity, unit_cost, tax_amount, notes) SELECT $1, $2, l.id, l.project_material_id, l.inventory_item_id, l.description, l.item_kind, l.unit, CASE WHEN pr.status = 'approved' THEN l.requested_quantity ELSE l.approved_quantity END, COALESCE(l.estimated_unit_cost, 0), 0, l.notes FROM management_purchase_request_lines l JOIN management_purchase_requests pr ON pr.organization_id = l.organization_id AND pr.id = l.purchase_request_id WHERE l.organization_id = $1 AND l.purchase_request_id = $3 AND ((pr.status = 'approved' AND l.requested_quantity > 0) OR (pr.status = 'partially_approved' AND l.approved_quantity > 0))",
        [context.organizationId, row.id, row.purchase_request_id],
      );
    const unlinkedMaterialLines = await client.query<{ id: string }>(
      "SELECT id FROM management_purchase_order_lines WHERE organization_id = $1 AND purchase_order_id = $2 AND item_kind = 'material' AND project_material_id IS NULL",
      [context.organizationId, row.id],
    );
    for (const line of unlinkedMaterialLines.rows)
      await ensureProjectMaterialForPurchaseOrderLine(client, context, line.id);
  }
  if (resource === "expenses" && !row.project_task_id) {
    if (row.purchase_order_id)
      await client.query(
        "UPDATE management_expenses e SET project_task_id = po.project_task_id, phase_id = COALESCE(e.phase_id, po.phase_id) FROM management_purchase_orders po WHERE e.organization_id = $1 AND e.id = $2 AND e.project_task_id IS NULL AND po.organization_id = e.organization_id AND po.id = e.purchase_order_id",
        [context.organizationId, row.id],
      );
    else if (row.receipt_id)
      await client.query(
        "UPDATE management_expenses e SET project_task_id = po.project_task_id, phase_id = COALESCE(e.phase_id, po.phase_id) FROM management_receipts r JOIN management_purchase_orders po ON po.organization_id = r.organization_id AND po.id = r.purchase_order_id WHERE e.organization_id = $1 AND e.id = $2 AND e.project_task_id IS NULL AND r.organization_id = e.organization_id AND r.id = e.receipt_id",
        [context.organizationId, row.id],
      );
  }
  if (resource === "stock-movements") {
    await adjustStock(
      client,
      context,
      String(row.warehouse_id),
      String(row.item_id),
      Number(row.quantity_delta),
    );
  }
  if (resource === "material-movements") {
    const material = await client.query<Row>(
      "SELECT project_id, inventory_item_id, default_warehouse_id FROM management_project_materials WHERE organization_id = $1 AND id = $2",
      [context.organizationId, row.project_material_id],
    );
    const item = material.rows[0];
    const warehouseId = row.warehouse_id ?? item?.default_warehouse_id;
    if (item?.inventory_item_id && warehouseId) {
      const direction = ["used", "damaged", "adjustment_out"].includes(
        String(row.movement_type),
      )
        ? -1
        : 1;
      await writeStockLedger(client, context, {
        warehouseId: String(warehouseId),
        itemId: String(item.inventory_item_id),
        projectId: String(item.project_id),
        projectMaterialId: String(row.project_material_id),
        movementType: direction < 0 ? "issue" : "return",
        quantityDelta: direction * Number(row.quantity),
        referenceType: "material_movement",
        referenceId: String(row.id),
        notes: row.notes as string | null,
      });
    }
  }
  if (resource === "receipt-lines") {
    const details = await client.query<Row>(
      "SELECT re.project_id, re.status AS receipt_status, re.warehouse_id AS receipt_warehouse_id, po.id AS order_id, po.supplier_id, po.warehouse_id AS order_warehouse_id, po.currency_code, pol.id AS order_line_id, pol.inventory_item_id AS order_item_id, pol.project_material_id AS order_material_id, pol.item_kind, pol.asset_name AS order_asset_name, pol.asset_category AS order_asset_category, pol.unit_cost FROM management_receipt_lines rl JOIN management_receipts re ON re.organization_id = rl.organization_id AND re.id = rl.receipt_id JOIN management_purchase_orders po ON po.organization_id = re.organization_id AND po.id = re.purchase_order_id JOIN management_purchase_order_lines pol ON pol.organization_id = rl.organization_id AND pol.id = rl.purchase_order_line_id WHERE rl.organization_id = $1 AND rl.id = $2",
      [context.organizationId, row.id],
    );
    const receipt = details.rows[0];
    if (!receipt) throw new BadRequestError("Receipt line cannot be completed");
    if (receipt.item_kind === "material" && !receipt.order_material_id) {
      const materialId = await ensureProjectMaterialForPurchaseOrderLine(
        client,
        context,
        String(receipt.order_line_id),
      );
      receipt.order_material_id = materialId;
    }
    const accepted =
      Number(row.received_quantity) -
      Number(row.damaged_quantity) -
      Number(row.rejected_quantity);
    const materialId = row.project_material_id ?? receipt.order_material_id;
    const receiptConfirmed = ["received", "verified"].includes(
      String(receipt.receipt_status),
    );
    const warehouseId =
      receipt.receipt_warehouse_id ?? receipt.order_warehouse_id;
    let itemId = row.inventory_item_id ?? receipt.order_item_id;
    // The inventory catalogue is created only when an accepted quantity reaches
    // a confirmed receipt with a real storage location. Planned, ordered,
    // rejected, or fully damaged material never becomes physical stock.
    if (
      !itemId &&
      materialId &&
      receiptConfirmed &&
      accepted > 0 &&
      warehouseId
    ) {
      itemId = await ensureInventoryItemForProjectMaterial(
        client,
        context,
        String(materialId),
      );
      if (itemId)
        await client.query(
          "UPDATE management_purchase_order_lines SET inventory_item_id = $3 WHERE organization_id = $1 AND id = $2 AND inventory_item_id IS NULL",
          [context.organizationId, receipt.order_line_id, itemId],
        );
    }
    await client.query(
      "UPDATE management_receipt_lines SET project_material_id = COALESCE(project_material_id, $3), inventory_item_id = COALESCE(inventory_item_id, $4) WHERE organization_id = $1 AND id = $2",
      [context.organizationId, row.id, materialId ?? null, itemId ?? null],
    );
    if (receiptConfirmed && accepted > 0 && itemId && warehouseId) {
      const stockBalance = Math.max(
        0,
        await receiptLineStockBalance(client, context, String(row.id)),
      );
      const quantityToRecord = accepted - stockBalance;
      if (quantityToRecord > 0)
        await writeStockLedger(client, context, {
          warehouseId: String(warehouseId),
          itemId: String(itemId),
          projectId: String(receipt.project_id),
          projectMaterialId: materialId ? String(materialId) : null,
          movementType: "receipt",
          quantityDelta: quantityToRecord,
          unitCost: Number(row.actual_unit_cost ?? receipt.unit_cost),
          referenceType: "receipt_line",
          referenceId: String(row.id),
          notes: row.receiver_notes as string | null,
        });
    }
    const isDurable =
      Boolean(row.asset_required) || receipt.item_kind === "asset";
    if (receiptConfirmed && isDurable && accepted > 0) {
      if (!Number.isInteger(accepted))
        throw new BadRequestError(
          "A durable asset receipt must use a whole accepted quantity",
        );
      const existingAssets = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM management_receipt_line_assets WHERE organization_id = $1 AND receipt_line_id = $2",
        [context.organizationId, row.id],
      );
      if (Number(existingAssets.rows[0]?.count ?? 0) === 0) {
        const assetName = row.asset_name ?? receipt.order_asset_name;
        const assetCategory =
          row.asset_category ?? receipt.order_asset_category;
        if (!assetName || !assetCategory)
          throw new BadRequestError(
            "Give the durable item an asset name and category before receiving it",
          );
        let firstAssetId: string | null = null;
        for (let index = 0; index < accepted; index += 1) {
          const asset = await client.query<{ id: string }>(
            "INSERT INTO management_assets (organization_id, project_id, province_id, site_id, supplier_id, name, category, purchase_price, currency_code) SELECT $1, p.id, p.province_id, p.site_id, $2, $3, $4, $5, $6 FROM management_projects p WHERE p.organization_id = $1 AND p.id = $7 RETURNING id",
            [
              context.organizationId,
              receipt.supplier_id,
              assetName,
              assetCategory,
              row.actual_unit_cost ?? receipt.unit_cost,
              receipt.currency_code,
              receipt.project_id,
            ],
          );
          const assetId = asset.rows[0]?.id;
          if (!assetId)
            throw new BadRequestError("Could not register the received asset");
          firstAssetId ??= assetId;
          await client.query(
            "INSERT INTO management_receipt_line_assets (organization_id, receipt_line_id, asset_id) VALUES ($1, $2, $3)",
            [context.organizationId, row.id, assetId],
          );
        }
        await client.query(
          "UPDATE management_receipt_lines SET asset_id = $3 WHERE organization_id = $1 AND id = $2",
          [context.organizationId, row.id, firstAssetId],
        );
      }
    }
    await refreshPurchaseOrderStatus(client, context, String(receipt.order_id));
  }
  if (resource === "asset-assignments") {
    await client.query(
      "UPDATE management_assets SET assigned_member_id = $3, project_id = COALESCE($4, project_id), site_id = COALESCE($5, site_id), status = CASE WHEN $6 IS NULL THEN 'assigned' ELSE 'available' END WHERE organization_id = $1 AND id = $2",
      [
        context.organizationId,
        row.asset_id,
        row.assigned_member_id,
        row.assigned_project_id,
        row.assigned_site_id,
        row.returned_at,
      ],
    );
  }
  if (resource === "asset-movements") {
    await client.query(
      "UPDATE management_assets SET site_id = COALESCE($3, site_id), current_location = COALESCE($4, current_location) WHERE organization_id = $1 AND id = $2",
      [context.organizationId, row.asset_id, row.to_site_id, row.to_location],
    );
  }
  if (resource === "asset-usage")
    await updateAssetMeter(
      client,
      context,
      String(row.asset_id),
      row.meter_end,
    );
  if (resource === "vehicle-trips") {
    const asset = await client.query<Row>(
      "SELECT asset_id FROM management_vehicle_profiles WHERE organization_id = $1 AND id = $2",
      [context.organizationId, row.vehicle_id],
    );
    if (asset.rows[0]?.asset_id)
      await updateAssetMeter(
        client,
        context,
        String(asset.rows[0].asset_id),
        row.end_mileage,
      );
  }
  if (resource === "maintenance-parts") {
    if (row.inventory_item_id && row.warehouse_id) {
      await writeStockLedger(client, context, {
        warehouseId: String(row.warehouse_id),
        itemId: String(row.inventory_item_id),
        movementType: "maintenance_issue",
        quantityDelta: -Number(row.quantity),
        unitCost: Number(row.unit_cost),
        referenceType: "maintenance_part",
        referenceId: String(row.id),
        notes: row.notes as string | null,
      });
    }
    await client.query(
      "UPDATE management_maintenance_work_orders wo SET parts_cost = COALESCE(x.total, 0) FROM (SELECT work_order_id, SUM(quantity * unit_cost) AS total FROM management_maintenance_parts WHERE organization_id = $1 AND work_order_id = $2 GROUP BY work_order_id) x WHERE wo.organization_id = $1 AND wo.id = $2 AND x.work_order_id = wo.id",
      [context.organizationId, row.work_order_id],
    );
  }
  await queueApprovalForWorkflow(client, context, resource, row);
  if (resource === "maintenance-work-orders" && row.status === "completed") {
    await updateAssetMeter(
      client,
      context,
      String(row.asset_id),
      row.meter_reading,
    );
    await client.query(
      "UPDATE management_assets SET status = 'available' WHERE organization_id = $1 AND id = $2 AND status = 'under_maintenance'",
      [context.organizationId, row.asset_id],
    );
    if (row.plan_id) {
      await client.query(
        "UPDATE management_maintenance_plans mp SET next_due_date = COALESCE($3, CASE WHEN mp.interval_days IS NULL THEN mp.next_due_date ELSE COALESCE($4::date, current_date) + mp.interval_days END), next_due_meter = COALESCE($5, CASE WHEN mp.interval_meter IS NULL OR $6::numeric IS NULL THEN mp.next_due_meter ELSE $6::numeric + mp.interval_meter END) WHERE mp.organization_id = $1 AND mp.id = $2",
        [
          context.organizationId,
          row.plan_id,
          row.next_due_date,
          row.completed_at,
          row.next_due_meter,
          row.meter_reading,
        ],
      );
    }
  }
}
/** Adds human labels only to approval responses; authorization still happens first. */
async function enrichApprovalRows(
  client: PoolClient,
  context: OwnerManagementContext,
  rows: Row[],
): Promise<Row[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => String(row.id));
  const labels = await client.query<Row>(
    "SELECT r.*, p.name AS project_name, p.code AS project_code, requester.full_name AS requested_by_name, decider.full_name AS decided_by_name FROM management_approval_requests r LEFT JOIN management_projects p ON p.organization_id = r.organization_id AND p.id = r.project_id LEFT JOIN organization_members requested_member ON requested_member.organization_id = r.organization_id AND requested_member.id = r.requested_by_member_id LEFT JOIN users requester ON requester.id = requested_member.user_id LEFT JOIN organization_members decided_member ON decided_member.organization_id = r.organization_id AND decided_member.id = r.decided_by_member_id LEFT JOIN users decider ON decider.id = decided_member.user_id WHERE r.organization_id = $1 AND r.id = ANY($2::uuid[])",
    [context.organizationId, ids],
  );
  const byId = new Map(labels.rows.map((row) => [String(row.id), mapRow(row)]));
  const purchaseRequestIds = [
    ...new Set(
      labels.rows
        .filter((row) => String(row.request_type) === "purchase_request")
        .map((row) => String(row.entity_id))
        .filter(Boolean),
    ),
  ];
  const purchaseDetails = new Map<
    string,
    {
      requestNumber: string | null;
      requiredDate: string | null;
      priority: string | null;
      reason: string | null;
      items: Row[];
    }
  >();

  if (purchaseRequestIds.length) {
    const detailRows = await client.query<Row>(
      "SELECT pr.id AS purchase_request_id, pr.request_number, pr.required_date, pr.priority, pr.reason, l.id AS line_id, l.description, l.item_kind, l.unit, l.requested_quantity, l.approved_quantity, l.estimated_unit_cost, l.notes, (l.requested_quantity * l.estimated_unit_cost) AS estimated_total FROM management_purchase_requests pr LEFT JOIN management_purchase_request_lines l ON l.organization_id = pr.organization_id AND l.purchase_request_id = pr.id WHERE pr.organization_id = $1 AND pr.id = ANY($2::uuid[]) ORDER BY pr.request_number, l.created_at, l.id",
      [context.organizationId, purchaseRequestIds],
    );
    for (const source of detailRows.rows) {
      const detail = mapRow(source);
      const requestId = String(detail.purchaseRequestId);
      const current = purchaseDetails.get(requestId) ?? {
        requestNumber: (detail.requestNumber as string | null) ?? null,
        requiredDate: (detail.requiredDate as string | null) ?? null,
        priority: (detail.priority as string | null) ?? null,
        reason: (detail.reason as string | null) ?? null,
        items: [],
      };
      if (detail.lineId) {
        current.items.push({
          id: String(detail.lineId),
          description: detail.description ?? null,
          itemKind: detail.itemKind ?? null,
          unit: detail.unit ?? null,
          requestedQuantity: detail.requestedQuantity ?? null,
          approvedQuantity: detail.approvedQuantity ?? null,
          estimatedUnitCost: detail.estimatedUnitCost ?? null,
          estimatedTotal: detail.estimatedTotal ?? null,
          notes: detail.notes ?? null,
        });
      }
      purchaseDetails.set(requestId, current);
    }
  }

  return ids
    .map((id) => byId.get(id))
    .filter((row): row is Row => Boolean(row))
    .map((row) => {
      if (String(row.requestType) !== "purchase_request") return row;
      const detail = purchaseDetails.get(String(row.entityId));
      if (!detail) return row;
      const allItemsEstimated =
        detail.items.length > 0 &&
        detail.items.every((item) => item.estimatedUnitCost != null);
      const estimatedAmount = allItemsEstimated
        ? detail.items.reduce(
            (sum, item) =>
              sum +
              Number(item.requestedQuantity ?? 0) *
                Number(item.estimatedUnitCost ?? 0),
            0,
          )
        : null;
      return {
        ...row,
        requestedAmount: row.requestedAmount ?? estimatedAmount,
        purchaseRequestDetails: {
          requestNumber: detail.requestNumber,
          requiredDate: detail.requiredDate,
          priority: detail.priority,
          reason: detail.reason,
        },
        purchaseRequestItems: detail.items,
      };
    });
}
async function enrichProjectMemberRows(
  client: PoolClient,
  context: OwnerManagementContext,
  rows: Row[],
): Promise<Row[]> {
  if (!rows.length) return rows;
  const ids = rows.map((row) => String(row.id));
  const labels = await client.query<{
    id: string;
    full_name: string | null;
    email: string | null;
    employee_number: string | null;
  }>(
    "SELECT pm.id, u.full_name, u.email, e.employee_number FROM management_project_members pm JOIN organization_members m ON m.organization_id = pm.organization_id AND m.id = pm.member_id JOIN users u ON u.id = m.user_id LEFT JOIN employees e ON e.organization_id = pm.organization_id AND e.member_id = m.id WHERE pm.organization_id = $1 AND pm.id = ANY($2::uuid[])",
    [context.organizationId, ids],
  );
  const byId = new Map(labels.rows.map((row) => [row.id, row]));
  return rows.map((row) => {
    const member = byId.get(String(row.id));
    const name = member?.full_name ?? member?.email ?? null;
    return {
      ...row,
      name: name ?? row.name,
      memberName: name,
      memberEmail: member?.email ?? null,
      employeeNumber: member?.employee_number ?? null,
    };
  });
}
/** Human labels for the risk register are fetched after scope filtering, so a
 * risk owner or decision maker never leaks a person outside the tenant. */
async function enrichProjectRiskRows(
  client: PoolClient,
  context: OwnerManagementContext,
  rows: Row[],
): Promise<Row[]> {
  if (!rows.length) return rows;
  const ids = rows.map((row) => String(row.id));
  const result = await client.query<Row>(
    `SELECT risk.id,
            COALESCE(owner_user.full_name, owner_user.email, '—') AS "ownerName",
            COALESCE(decider_user.full_name, decider_user.email, NULL) AS "decidedByName",
            COALESCE(creator_user.full_name, creator_user.email, NULL) AS "createdByName"
       FROM management_project_risks risk
       LEFT JOIN organization_members owner_member
         ON owner_member.organization_id=risk.organization_id
        AND owner_member.id=risk.owner_member_id
       LEFT JOIN users owner_user ON owner_user.id=owner_member.user_id
       LEFT JOIN organization_members decider_member
         ON decider_member.organization_id=risk.organization_id
        AND decider_member.id=risk.decided_by_member_id
       LEFT JOIN users decider_user ON decider_user.id=decider_member.user_id
       LEFT JOIN organization_members creator_member
         ON creator_member.organization_id=risk.organization_id
        AND creator_member.id=risk.created_by_member_id
       LEFT JOIN users creator_user ON creator_user.id=creator_member.user_id
      WHERE risk.organization_id=$1 AND risk.id = ANY($2::uuid[])`,
    [context.organizationId, ids],
  );
  const labels = new Map(
    result.rows.map((row) => [String(row.id), mapRow(row)]),
  );
  return rows.map((row) => ({ ...row, ...(labels.get(String(row.id)) ?? {}) }));
}

async function enrichTaskCostRows(
  client: PoolClient,
  context: OwnerManagementContext,
  rows: Row[],
): Promise<Row[]> {
  if (!rows.length) return rows;
  const ids = rows.map((row) => String(row.id));
  // A task recipient needs its operational context even when the Project
  // Control Centre itself is owner-only. These labels deliberately contain no
  // project financial or planning data.
  const [totals, labels] = await Promise.all([
    client.query<Row>(
      "SELECT t.id, COALESCE(expenses.actual_cost, 0) + COALESCE(received.actual_purchase_cost, 0) AS actual_cost, COALESCE(orders.committed_cost, 0) AS committed_cost FROM management_project_tasks t LEFT JOIN LATERAL (SELECT SUM(CASE WHEN e.expense_type = 'direct_expense' THEN e.amount WHEN e.expense_type = 'reimbursement' AND e.receipt_id IS NULL THEN -e.amount ELSE 0 END) AS actual_cost FROM management_expenses e WHERE e.organization_id = t.organization_id AND e.project_task_id = t.id AND e.status IN ('approved', 'paid')) expenses ON true LEFT JOIN LATERAL (SELECT SUM((rl.received_quantity - rl.damaged_quantity - rl.rejected_quantity) * COALESCE(rl.actual_unit_cost, pol.unit_cost, 0)) AS actual_purchase_cost FROM management_purchase_orders po JOIN management_purchase_order_lines pol ON pol.organization_id = po.organization_id AND pol.purchase_order_id = po.id JOIN management_receipt_lines rl ON rl.organization_id = pol.organization_id AND rl.purchase_order_line_id = pol.id WHERE po.organization_id = t.organization_id AND po.project_task_id = t.id) received ON true LEFT JOIN LATERAL (SELECT SUM(GREATEST(pol.ordered_quantity - COALESCE(received_line.accepted_quantity, 0), 0) * pol.unit_cost + CASE WHEN pol.ordered_quantity = 0 THEN 0 ELSE pol.tax_amount * GREATEST(pol.ordered_quantity - COALESCE(received_line.accepted_quantity, 0), 0) / pol.ordered_quantity END) AS committed_cost FROM management_purchase_orders po JOIN management_purchase_order_lines pol ON pol.organization_id = po.organization_id AND pol.purchase_order_id = po.id LEFT JOIN LATERAL (SELECT SUM(received_quantity - damaged_quantity - rejected_quantity) AS accepted_quantity FROM management_receipt_lines WHERE organization_id = pol.organization_id AND purchase_order_line_id = pol.id) received_line ON true WHERE po.organization_id = t.organization_id AND po.project_task_id = t.id AND po.status IN ('sent', 'partially_received')) orders ON true WHERE t.organization_id = $1 AND t.id = ANY($2::uuid[])",
      [context.organizationId, ids],
    ),
    client.query<Row>(
      "SELECT t.id, p.name AS project_name, p.code AS project_code, ph.name AS phase_name, ph.code AS phase_code, province.name AS province_name, province.code AS province_code, site.name AS site_name, site.code AS site_code, assigned_user.full_name AS assigned_member_name, assigned_user.email AS assigned_member_email FROM management_project_tasks t LEFT JOIN management_projects p ON p.organization_id = t.organization_id AND p.id = t.project_id LEFT JOIN management_project_phases ph ON ph.organization_id = t.organization_id AND ph.id = t.phase_id LEFT JOIN provinces province ON province.organization_id = t.organization_id AND province.id = COALESCE(p.province_id, t.province_id) LEFT JOIN sites site ON site.organization_id = t.organization_id AND site.id = COALESCE(p.site_id, t.site_id) LEFT JOIN organization_members assigned_member ON assigned_member.organization_id = t.organization_id AND assigned_member.id = t.assigned_member_id LEFT JOIN users assigned_user ON assigned_user.id = assigned_member.user_id WHERE t.organization_id = $1 AND t.id = ANY($2::uuid[])",
      [context.organizationId, ids],
    ),
  ]);
  const totalsById = new Map(
    totals.rows.map((row) => [String(row.id), mapRow(row)]),
  );
  const labelsById = new Map(
    labels.rows.map((row) => [String(row.id), mapRow(row)]),
  );
  return rows.map((row) => {
    const total = totalsById.get(String(row.id));
    const label = labelsById.get(String(row.id));
    return {
      ...row,
      actualCost: total?.actualCost ?? 0,
      committedCost: total?.committedCost ?? 0,
      projectName: label?.projectName ?? null,
      projectCode: label?.projectCode ?? null,
      phaseName: label?.phaseName ?? null,
      phaseCode: label?.phaseCode ?? null,
      provinceName: label?.provinceName ?? null,
      provinceCode: label?.provinceCode ?? null,
      siteName: label?.siteName ?? null,
      siteCode: label?.siteCode ?? null,
      assignedMemberName: label?.assignedMemberName ?? null,
      assignedMemberEmail: label?.assignedMemberEmail ?? null,
    };
  });
}
async function taskDocumentRows(
  client: PoolClient,
  organizationId: string,
  taskId: string,
): Promise<Row[]> {
  const result = await client.query<Row>(
    "SELECT d.*, c.name AS document_category_name, c.code AS document_category_code, l.id AS task_document_link_id, l.task_id, l.phase_id AS linked_phase_id, l.created_at AS linked_at, uploader.full_name AS uploaded_by_name FROM management_project_task_document_links l JOIN management_document_links d ON d.organization_id = l.organization_id AND d.id = l.document_id LEFT JOIN management_document_categories c ON c.organization_id = d.organization_id AND c.id = d.document_category_id LEFT JOIN organization_members uploaded_member ON uploaded_member.organization_id = d.organization_id AND uploaded_member.id = d.uploaded_by_member_id LEFT JOIN users uploader ON uploader.id = uploaded_member.user_id WHERE l.organization_id = $1 AND l.task_id = $2 ORDER BY l.created_at DESC",
    [organizationId, taskId],
  );
  return result.rows.map((row) => redactDocumentStorage(mapRow(row)));
}

async function taskForDocumentLink(
  client: PoolClient,
  context: OwnerManagementContext,
  taskId: string,
): Promise<Row> {
  const task = await rawRecord(client, context, "tasks", taskId);
  if (!task.project_id)
    throw new BadRequestError("The task must belong to a project");
  return task;
}

export async function linkTaskDocumentInTransaction(
  client: PoolClient,
  context: OwnerManagementContext,
  taskId: string,
  documentId: string,
): Promise<void> {
  const task = await taskForDocumentLink(client, context, taskId);
  await assertDocumentPolicy(client, context, documentId, "read");
  const document = await client.query<{ id: string }>(
    "SELECT id FROM management_document_links WHERE organization_id = $1 AND id = $2 AND project_id = $3",
    [context.organizationId, documentId, task.project_id],
  );
  if (!document.rowCount)
    throw new BadRequestError(
      "Choose a document that belongs to the same project as this task",
      { field: "documentIds" },
    );
  await client.query(
    "INSERT INTO management_project_task_document_links (organization_id, project_id, task_id, phase_id, document_id, linked_by_member_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (organization_id, task_id, document_id) DO UPDATE SET phase_id = EXCLUDED.phase_id, linked_by_member_id = EXCLUDED.linked_by_member_id",
    [
      context.organizationId,
      task.project_id,
      taskId,
      task.phase_id ?? null,
      documentId,
      context.memberId,
    ],
  );
}

export async function listTaskDocuments(
  context: OwnerManagementContext,
  taskId: string,
): Promise<Row[]> {
  return withTenantContext(context, async (client) => {
    await taskForDocumentLink(client, context, taskId);
    const documents = await taskDocumentRows(
      client,
      context.organizationId,
      taskId,
    );
    const visible = await visibleDocumentIds(
      client,
      context,
      documents.map((document) => String(document.id)),
    );
    return documents.filter((document) => visible.has(String(document.id)));
  });
}

export async function replaceTaskDocuments(
  context: OwnerManagementContext,
  taskId: string,
  documentIds: string[],
): Promise<Row[]> {
  return withTenantContext(context, async (client) => {
    try {
      const task = await taskForDocumentLink(client, context, taskId);
      const uniqueDocumentIds = [...new Set(documentIds)];
      if (uniqueDocumentIds.length > 100)
        throw new BadRequestError("Attach at most 100 documents to one task", {
          field: "documentIds",
        });
      if (uniqueDocumentIds.length) {
        const validDocuments = await client.query<{ id: string }>(
          "SELECT id FROM management_document_links WHERE organization_id = $1 AND project_id = $2 AND id = ANY($3::uuid[])",
          [context.organizationId, task.project_id, uniqueDocumentIds],
        );
        if (validDocuments.rowCount !== uniqueDocumentIds.length)
          throw new BadRequestError(
            "Every selected document must belong to the same project as this task",
            { field: "documentIds" },
          );
        await client.query(
          "DELETE FROM management_project_task_document_links WHERE organization_id = $1 AND task_id = $2 AND NOT (document_id = ANY($3::uuid[]))",
          [context.organizationId, taskId, uniqueDocumentIds],
        );
      } else {
        await client.query(
          "DELETE FROM management_project_task_document_links WHERE organization_id = $1 AND task_id = $2",
          [context.organizationId, taskId],
        );
      }
      for (const documentId of uniqueDocumentIds)
        await linkTaskDocumentInTransaction(
          client,
          context,
          taskId,
          documentId,
        );
      return taskDocumentRows(client, context.organizationId, taskId);
    } catch (error: unknown) {
      const pg = error as { code?: string };
      if (pg.code === "22P02")
        throw new BadRequestError(
          "One selected document has an invalid reference",
          { field: "documentIds" },
        );
      throw error;
    }
  });
}

export async function getDocumentAccess(
  context: OwnerManagementContext,
  documentId: string,
): Promise<Row> {
  if (!context.isOwner)
    throw new ForbiddenError(
      "Only the workspace owner can manage document access",
    );
  return withTenantContext(context, async (client) => {
    const document = await client.query<Row>(
      `SELECT d.id, d.visibility, d.can_download, d.can_edit, d.is_locked,
              d.locked_by_member_id, d.locked_at, locked_user.full_name AS locked_by_name
         FROM management_document_links d
         LEFT JOIN organization_members locked_member
           ON locked_member.organization_id = d.organization_id
          AND locked_member.id = d.locked_by_member_id
         LEFT JOIN users locked_user ON locked_user.id = locked_member.user_id
        WHERE d.organization_id = $1 AND d.id = $2`,
      [context.organizationId, documentId],
    );
    const row = document.rows[0];
    if (!row) throw new NotFoundError("Document not found");
    const [roles, members] = await Promise.all([
      client.query<Row>(
        `SELECT access.role_id, r.code, r.name
           FROM management_document_role_access access
           JOIN roles r
             ON r.organization_id = access.organization_id AND r.id = access.role_id
          WHERE access.organization_id = $1 AND access.document_id = $2
          ORDER BY r.name`,
        [context.organizationId, documentId],
      ),
      client.query<Row>(
        `SELECT access.member_id, u.full_name, u.email
           FROM management_document_member_access access
           JOIN organization_members m
             ON m.organization_id = access.organization_id AND m.id = access.member_id
           JOIN users u ON u.id = m.user_id
          WHERE access.organization_id = $1 AND access.document_id = $2
          ORDER BY u.full_name`,
        [context.organizationId, documentId],
      ),
    ]);
    return mapRow({
      ...row,
      allowedRoles: roles.rows.map(mapRow),
      allowedMembers: members.rows.map(mapRow),
    });
  });
}

export async function updateDocumentAccess(
  context: OwnerManagementContext,
  documentId: string,
  input: DocumentAccessInput,
): Promise<Row> {
  if (!context.isOwner)
    throw new ForbiddenError(
      "Only the workspace owner can manage document access",
    );
  await withTenantContext(context, async (client) => {
    const document = await client.query<{ id: string }>(
      "SELECT id FROM management_document_links WHERE organization_id = $1 AND id = $2 FOR UPDATE",
      [context.organizationId, documentId],
    );
    if (!document.rowCount) throw new NotFoundError("Document not found");
    const roleIds = [...new Set(input.allowedRoleIds)];
    const memberIds = [...new Set(input.allowedMemberIds)];
    if (roleIds.length) {
      const roles = await client.query<{ id: string }>(
        "SELECT id FROM roles WHERE organization_id = $1 AND id = ANY($2::uuid[])",
        [context.organizationId, roleIds],
      );
      if (roles.rowCount !== roleIds.length)
        throw new BadRequestError(
          "Every allowed role must belong to this company",
          {
            field: "allowedRoleIds",
          },
        );
    }
    if (memberIds.length) {
      const members = await client.query<{ id: string }>(
        "SELECT id FROM organization_members WHERE organization_id = $1 AND id = ANY($2::uuid[])",
        [context.organizationId, memberIds],
      );
      if (members.rowCount !== memberIds.length)
        throw new BadRequestError(
          "Every allowed person must belong to this company",
          {
            field: "allowedMemberIds",
          },
        );
    }
    await client.query(
      "UPDATE management_document_links SET visibility = $3, can_download = $4, can_edit = $5, is_locked = $6, locked_by_member_id = CASE WHEN $6 THEN $7::uuid ELSE NULL END, locked_at = CASE WHEN $6 THEN now() ELSE NULL END WHERE organization_id = $1 AND id = $2",
      [
        context.organizationId,
        documentId,
        input.visibility,
        input.canDownload,
        input.canEdit,
        input.isLocked,
        context.memberId,
      ],
    );
    await client.query(
      "DELETE FROM management_document_role_access WHERE organization_id = $1 AND document_id = $2",
      [context.organizationId, documentId],
    );
    await client.query(
      "DELETE FROM management_document_member_access WHERE organization_id = $1 AND document_id = $2",
      [context.organizationId, documentId],
    );
    for (const roleId of roleIds)
      await client.query(
        "INSERT INTO management_document_role_access (organization_id, document_id, role_id) VALUES ($1, $2, $3)",
        [context.organizationId, documentId, roleId],
      );
    for (const memberId of memberIds)
      await client.query(
        "INSERT INTO management_document_member_access (organization_id, document_id, member_id) VALUES ($1, $2, $3)",
        [context.organizationId, documentId, memberId],
      );
  });
  return getDocumentAccess(context, documentId);
}
function documentCategoryCode(name: string): string {
  const code = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 79);
  if (!code)
    throw new BadRequestError("Enter a category name with letters or numbers", {
      field: "name",
    });
  return code;
}

export async function listDocumentCategories(
  context: OwnerManagementContext,
  includeInactive = false,
): Promise<Row[]> {
  return withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      "SELECT id, code, name, description, sort_order, is_active, visibility, created_at, updated_at FROM management_document_categories WHERE organization_id = $1" +
        (includeInactive ? "" : " AND is_active = true") +
        (context.isOwner ? "" : " AND visibility = 'company'") +
        " ORDER BY sort_order ASC, name ASC",
      [context.organizationId],
    );
    return result.rows.map(mapRow);
  });
}

export async function createDocumentCategory(
  context: OwnerManagementContext,
  input: DocumentCategoryCreateInput,
): Promise<Row> {
  if (!context.isOwner)
    throw new ForbiddenError(
      "Only the workspace owner can manage document categories",
    );
  return withTenantContext(context, async (client) => {
    const code = input.code ?? documentCategoryCode(input.name);
    try {
      const result = await client.query<Row>(
        "INSERT INTO management_document_categories (organization_id, code, name, description, sort_order, is_active, visibility, created_by_member_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, code, name, description, sort_order, is_active, visibility, created_at, updated_at",
        [
          context.organizationId,
          code,
          input.name.trim(),
          input.description?.trim() || null,
          input.sortOrder ?? 500,
          input.isActive ?? true,
          input.visibility ?? "company",
          context.memberId,
        ],
      );
      return mapRow(result.rows[0] ?? {});
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      )
        throw new ConflictError(
          "A document category with that name or code already exists",
          { field: "name" },
        );
      throw error;
    }
  });
}

export async function updateDocumentCategory(
  context: OwnerManagementContext,
  categoryId: string,
  input: DocumentCategoryUpdateInput,
): Promise<Row> {
  if (!context.isOwner)
    throw new ForbiddenError(
      "Only the workspace owner can manage document categories",
    );
  return withTenantContext(context, async (client) => {
    const current = await client.query<Row>(
      "SELECT id FROM management_document_categories WHERE organization_id = $1 AND id = $2 FOR UPDATE",
      [context.organizationId, categoryId],
    );
    if (!current.rowCount)
      throw new NotFoundError("Document category not found");
    const columns: string[] = [];
    const values: unknown[] = [context.organizationId, categoryId];
    const add = (column: string, value: unknown) => {
      if (value === undefined) return;
      values.push(value);
      columns.push(`${column} = $${values.length}`);
    };
    // The code stays stable so renaming a folder never disconnects legacy file metadata.
    add("name", input.name?.trim());
    add("description", input.description?.trim() || null);
    add("sort_order", input.sortOrder);
    add("is_active", input.isActive);
    add("visibility", input.visibility);
    if (!columns.length)
      throw new BadRequestError(
        "Provide at least one category value to update",
      );
    columns.push("updated_at = now()");
    try {
      const result = await client.query<Row>(
        "UPDATE management_document_categories SET " +
          columns.join(", ") +
          " WHERE organization_id = $1 AND id = $2 RETURNING id, code, name, description, sort_order, is_active, visibility, created_at, updated_at",
        values,
      );
      return mapRow(result.rows[0] ?? {});
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      )
        throw new ConflictError(
          "A document category with that name already exists",
          { field: "name" },
        );
      throw error;
    }
  });
}

export async function assignDocumentCategory(
  context: OwnerManagementContext,
  documentId: string,
  categoryId: DocumentCategoryAssignmentInput["categoryId"],
): Promise<Row> {
  if (!context.isOwner)
    throw new ForbiddenError(
      "Only the workspace owner can organise project document folders",
    );
  return withTenantContext(context, async (client) => {
    const document = await client.query<Row>(
      "SELECT id, document_type FROM management_document_links WHERE organization_id = $1 AND id = $2 FOR UPDATE",
      [context.organizationId, documentId],
    );
    if (!document.rowCount) throw new NotFoundError("Document not found");
    let category: { id: string; code: string } | null = null;
    if (categoryId) {
      const result = await client.query<{ id: string; code: string }>(
        "SELECT id, code FROM management_document_categories WHERE organization_id = $1 AND id = $2 AND is_active = true",
        [context.organizationId, categoryId],
      );
      category = result.rows[0] ?? null;
      if (!category)
        throw new BadRequestError(
          "Choose an active document category that belongs to this company",
          { field: "categoryId" },
        );
    }
    const result = await client.query<Row>(
      "UPDATE management_document_links SET document_category_id = $3, document_type = COALESCE($4, document_type) WHERE organization_id = $1 AND id = $2 RETURNING id, project_id, title, document_type, document_category_id, mime_type, file_size_bytes, created_at",
      [
        context.organizationId,
        documentId,
        category?.id ?? null,
        category?.code ?? null,
      ],
    );
    return mapRow(result.rows[0] ?? {});
  });
}

export async function archiveDocumentCategory(
  context: OwnerManagementContext,
  categoryId: string,
): Promise<void> {
  await updateDocumentCategory(context, categoryId, { isActive: false });
}

function equipmentCategoryCode(name: string): string {
  const code = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 79);
  if (!code)
    throw new BadRequestError("Enter a category name with letters or numbers", {
      field: "name",
    });
  return code;
}

export async function listEquipmentCategories(
  context: OwnerManagementContext,
  includeInactive = false,
): Promise<{ categories: Row[]; categoryStoreReady: boolean }> {
  return withTenantContext(context, async (client) => {
    try {
      const result = await client.query<Row>(
        "SELECT id, code, name, description, is_active, created_at, updated_at FROM management_equipment_categories WHERE organization_id = $1" +
          (includeInactive ? "" : " AND is_active = true") +
          " ORDER BY name ASC",
        [context.organizationId],
      );
      return {
        categories: result.rows.map(mapRow),
        categoryStoreReady: true,
      };
    } catch (error: unknown) {
      // A web deployment can arrive slightly before its migration. Keep the
      // equipment register available and expose existing labels until the
      // tenant category table is ready.
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code?: string }).code === "42P01"
      ) {
        const legacy = await client.query<Row>(
          "SELECT 'legacy-' || md5(lower(btrim(category))) AS id, 'legacy_' || substr(md5(lower(btrim(category))), 1, 12) AS code, btrim(category) AS name, NULL::text AS description, true AS is_active FROM management_assets WHERE organization_id = $1 AND nullif(btrim(category), '') IS NOT NULL GROUP BY category ORDER BY btrim(category) ASC",
          [context.organizationId],
        );
        return {
          categories: legacy.rows.map(mapRow),
          categoryStoreReady: false,
        };
      }
      throw error;
    }
  });
}

export async function createEquipmentCategory(
  context: OwnerManagementContext,
  input: EquipmentCategoryCreateInput,
): Promise<Row> {
  if (!context.isOwner)
    throw new ForbiddenError(
      "Only the workspace owner can manage equipment categories",
    );
  return withTenantContext(context, async (client) => {
    const code = equipmentCategoryCode(input.name);
    try {
      const result = await client.query<Row>(
        "INSERT INTO management_equipment_categories (organization_id, code, name, description, is_active, created_by_member_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, code, name, description, is_active, created_at, updated_at",
        [
          context.organizationId,
          code,
          input.name.trim(),
          input.description?.trim() || null,
          input.isActive ?? true,
          context.memberId,
        ],
      );
      return mapRow(result.rows[0] ?? {});
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      )
        throw new ConflictError(
          "An equipment category with that name already exists",
          { field: "name" },
        );
      throw error;
    }
  });
}

export async function updateEquipmentCategory(
  context: OwnerManagementContext,
  categoryId: string,
  input: EquipmentCategoryUpdateInput,
): Promise<Row> {
  if (!context.isOwner)
    throw new ForbiddenError(
      "Only the workspace owner can manage equipment categories",
    );
  return withTenantContext(context, async (client) => {
    const current = await client.query<Row>(
      "SELECT id FROM management_equipment_categories WHERE organization_id = $1 AND id = $2 FOR UPDATE",
      [context.organizationId, categoryId],
    );
    if (!current.rowCount)
      throw new NotFoundError("Equipment category not found");
    const columns: string[] = [];
    const values: unknown[] = [context.organizationId, categoryId];
    const add = (column: string, value: unknown) => {
      if (value === undefined) return;
      values.push(value);
      columns.push(`${column} = $${values.length}`);
    };
    // Categories are stored as labels on assets, so codes remain stable on rename.
    add("name", input.name?.trim());
    add("description", input.description?.trim() || null);
    add("is_active", input.isActive);
    if (!columns.length)
      throw new BadRequestError(
        "Provide at least one category value to update",
      );
    columns.push("updated_at = now()");
    try {
      const result = await client.query<Row>(
        "UPDATE management_equipment_categories SET " +
          columns.join(", ") +
          " WHERE organization_id = $1 AND id = $2 RETURNING id, code, name, description, is_active, created_at, updated_at",
        values,
      );
      return mapRow(result.rows[0] ?? {});
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      )
        throw new ConflictError(
          "An equipment category with that name already exists",
          { field: "name" },
        );
      throw error;
    }
  });
}

export async function archiveEquipmentCategory(
  context: OwnerManagementContext,
  categoryId: string,
): Promise<void> {
  await updateEquipmentCategory(context, categoryId, { isActive: false });
}
async function enrichDocumentRows(
  client: PoolClient,
  context: OwnerManagementContext,
  rows: Row[],
): Promise<Row[]> {
  if (!rows.length) return rows;
  const categoryIds = [
    ...new Set(
      rows
        .map((row) =>
          String(row.documentCategoryId ?? row.document_category_id ?? ""),
        )
        .filter(Boolean),
    ),
  ];
  const categories = categoryIds.length
    ? await client.query<Row>(
        "SELECT id, code, name, is_active, visibility FROM management_document_categories WHERE organization_id = $1 AND id = ANY($2::uuid[])",
        [context.organizationId, categoryIds],
      )
    : { rows: [] as Row[] };
  const categoryById = new Map(
    categories.rows.map((category) => [String(category.id), mapRow(category)]),
  );
  const documentIds = rows.map((row) => String(row.id));
  const usages = await client.query<Row>(
    "SELECT l.document_id, COUNT(DISTINCT l.task_id)::integer AS task_usage_count, string_agg(DISTINCT concat_ws(' · ', t.title, ph.name), ' | ') AS task_usage_summary, string_agg(DISTINCT NULLIF(btrim(assignee.full_name), ''), ' | ') AS task_assignee_summary FROM management_project_task_document_links l JOIN management_project_tasks t ON t.organization_id = l.organization_id AND t.id = l.task_id LEFT JOIN management_project_phases ph ON ph.organization_id = l.organization_id AND ph.id = l.phase_id LEFT JOIN organization_members assigned_member ON assigned_member.organization_id = t.organization_id AND assigned_member.id = t.assigned_member_id LEFT JOIN users assignee ON assignee.id = assigned_member.user_id WHERE l.organization_id = $1 AND l.document_id = ANY($2::uuid[]) GROUP BY l.document_id",
    [context.organizationId, documentIds],
  );
  const byDocumentId = new Map(
    usages.rows.map((row) => [String(row.document_id), mapRow(row)]),
  );
  const uploaders = await client.query<Row>(
    "SELECT d.id AS document_id, uploader.full_name AS uploaded_by_name FROM management_document_links d LEFT JOIN organization_members uploaded_member ON uploaded_member.organization_id = d.organization_id AND uploaded_member.id = d.uploaded_by_member_id LEFT JOIN users uploader ON uploader.id = uploaded_member.user_id WHERE d.organization_id = $1 AND d.id = ANY($2::uuid[])",
    [context.organizationId, documentIds],
  );
  const uploaderByDocumentId = new Map(
    uploaders.rows.map((row) => [
      String(row.document_id),
      String(row.uploaded_by_name ?? "").trim() || null,
    ]),
  );
  return rows.map((row) => {
    const usage = byDocumentId.get(String(row.id));
    const category = categoryById.get(
      String(row.documentCategoryId ?? row.document_category_id ?? ""),
    );
    const direct = String(row.entityType ?? "");
    const directSummary =
      direct && direct !== "owner-management:projects" ? direct : null;
    const taskSummary = usage?.taskUsageSummary;
    return {
      ...row,
      documentCategoryName:
        category?.name ?? row.documentType ?? row.document_type ?? null,
      documentCategoryCode:
        category?.code ?? row.documentType ?? row.document_type ?? null,
      documentCategoryActive: category?.isActive ?? null,
      documentCategoryVisibility: category?.visibility ?? "company",
      taskUsageCount: usage?.taskUsageCount ?? 0,
      taskUsageSummary: taskSummary ?? null,
      taskAssigneeSummary: usage?.taskAssigneeSummary ?? null,
      uploadedByName: uploaderByDocumentId.get(String(row.id)) ?? null,
      usageSummary:
        [directSummary, taskSummary]
          .filter((value) => typeof value === "string" && value.trim())
          .join(" | ") || null,
    };
  });
}
async function enrichProcurementActorRows(
  client: PoolClient,
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  rows: Row[],
): Promise<Row[]> {
  if (!rows.length || !["purchase-orders", "receipts"].includes(resource))
    return rows;
  const memberField =
    resource === "receipts" ? "receivedByMemberId" : "orderedByMemberId";
  const outputField =
    resource === "receipts" ? "receivedByName" : "orderedByName";
  const memberIds = [
    ...new Set(
      rows
        .map((row) => row[memberField])
        .filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        ),
    ),
  ];
  if (!memberIds.length) return rows;
  const people = await client.query<Row>(
    "SELECT m.id, u.full_name FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1 AND m.id = ANY($2::uuid[])",
    [context.organizationId, memberIds],
  );
  const names = new Map(
    people.rows.map((row) => [
      String(row.id),
      String(row.full_name ?? "").trim(),
    ]),
  );
  return rows.map((row) => ({
    ...row,
    [outputField]: names.get(String(row[memberField])) || null,
  }));
}

/**
 * A receipt line stores delivered quantities, while its description and unit
 * stay on the source purchase-order line. Return both together for the
 * receiver without creating a duplicated item or quantity.
 */
async function enrichReceiptLineRows(
  client: PoolClient,
  context: OwnerManagementContext,
  rows: Row[],
): Promise<Row[]> {
  const receiptLineIds = rows.map((row) => String(row.id)).filter(Boolean);
  if (!receiptLineIds.length) return rows;
  const result = await client.query<Row>(
    `SELECT receipt_line.id,
            order_line.description,
            order_line.unit,
            order_line.ordered_quantity,
            order_line.item_kind,
            order_line.unit_cost AS order_unit_cost,
            project_material.name AS project_material_name,
            inventory_item.name AS inventory_item_name
       FROM management_receipt_lines receipt_line
       JOIN management_purchase_order_lines order_line
         ON order_line.organization_id = receipt_line.organization_id
        AND order_line.id = receipt_line.purchase_order_line_id
       LEFT JOIN management_project_materials project_material
         ON project_material.organization_id = receipt_line.organization_id
        AND project_material.id = COALESCE(receipt_line.project_material_id, order_line.project_material_id)
       LEFT JOIN management_inventory_items inventory_item
         ON inventory_item.organization_id = receipt_line.organization_id
        AND inventory_item.id = COALESCE(receipt_line.inventory_item_id, order_line.inventory_item_id)
      WHERE receipt_line.organization_id = $1
        AND receipt_line.id = ANY($2::uuid[])`,
    [context.organizationId, receiptLineIds],
  );
  const detailsById = new Map(
    result.rows.map((row) => [String(row.id), mapRow(row)]),
  );
  return rows.map((row) => {
    const details = detailsById.get(String(row.id)) ?? {};
    // PostgreSQL returns numeric columns as strings. Receipt lines are rendered
    // and validated as quantities in the browser, so keep the source order
    // context while returning consistent numeric values to the caller.
    return {
      ...row,
      ...details,
      receivedQuantity: Number(row.receivedQuantity ?? 0),
      damagedQuantity: Number(row.damagedQuantity ?? 0),
      rejectedQuantity: Number(row.rejectedQuantity ?? 0),
      actualUnitCost:
        row.actualUnitCost == null ? null : Number(row.actualUnitCost),
      orderedQuantity:
        details.orderedQuantity == null ? null : Number(details.orderedQuantity),
      orderUnitCost:
        details.orderUnitCost == null ? null : Number(details.orderUnitCost),
    };
  });
}

async function enrichStockMovementActorRows(
  client: PoolClient,
  context: OwnerManagementContext,
  rows: Row[],
): Promise<Row[]> {
  const memberIds = [
    ...new Set(
      rows
        .map((row) => row.performedByMemberId)
        .filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        ),
    ),
  ];
  if (!memberIds.length) return rows;
  const people = await client.query<Row>(
    "SELECT m.id, u.full_name FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1 AND m.id = ANY($2::uuid[])",
    [context.organizationId, memberIds],
  );
  const names = new Map(
    people.rows.map((row) => [
      String(row.id),
      String(row.full_name ?? "").trim(),
    ]),
  );
  return rows.map((row) => ({
    ...row,
    performedByName: names.get(String(row.performedByMemberId ?? "")) || null,
  }));
}
async function enrichExpenseRows(
  client: PoolClient,
  context: OwnerManagementContext,
  rows: Row[],
): Promise<Row[]> {
  const receiptIds = [
    ...new Set(
      rows
        .map((row) => row.receiptId)
        .filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        ),
    ),
  ];
  if (!receiptIds.length) return rows;
  const result = await client.query<Row>(
    "SELECT re.id, re.receipt_number, po.order_number, supplier.name AS supplier_name, COALESCE(SUM((rl.received_quantity - rl.damaged_quantity - rl.rejected_quantity) * COALESCE(rl.actual_unit_cost, pol.unit_cost, 0)), 0) AS receipt_total, COALESCE((SELECT SUM(CASE WHEN e.expense_type = 'receipt_payment' THEN e.amount WHEN e.expense_type = 'reimbursement' THEN -e.amount ELSE 0 END) FROM management_expenses e WHERE e.organization_id = re.organization_id AND e.receipt_id = re.id AND e.status IN ('approved', 'paid')), 0) AS paid_amount FROM management_receipts re JOIN management_purchase_orders po ON po.organization_id = re.organization_id AND po.id = re.purchase_order_id LEFT JOIN management_suppliers supplier ON supplier.organization_id = po.organization_id AND supplier.id = po.supplier_id LEFT JOIN management_receipt_lines rl ON rl.organization_id = re.organization_id AND rl.receipt_id = re.id LEFT JOIN management_purchase_order_lines pol ON pol.organization_id = rl.organization_id AND pol.id = rl.purchase_order_line_id WHERE re.organization_id = $1 AND re.id = ANY($2::uuid[]) GROUP BY re.id, re.receipt_number, po.order_number, supplier.name",
    [context.organizationId, receiptIds],
  );
  const byId = new Map(result.rows.map((row) => [String(row.id), row]));
  return rows.map((row) => {
    const receipt = byId.get(String(row.receiptId));
    if (!receipt) return row;
    const total = Number(receipt.receipt_total ?? 0);
    const paid = Number(receipt.paid_amount ?? 0);
    const balance = Math.max(total - paid, 0);
    return {
      ...row,
      receiptNumber: receipt.receipt_number,
      purchaseOrderNumber: receipt.order_number,
      supplierName: receipt.supplier_name,
      receiptTotal: total,
      receiptPaid: paid,
      receiptBalance: balance,
      receiptPaymentStatus:
        balance <= 0.0001 ? "paid" : paid > 0 ? "partially_paid" : "unpaid",
    };
  });
}
export async function listOwnerManagementRecords(
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  query: OwnerManagementListQuery,
): Promise<Row[]> {
  const config = configFor(resource);
  return withTenantContext(context, async (client) => {
    const values: unknown[] = [context.organizationId];
    const conditions = ["organization_id = $1"];
    const filter = (
      value: string | undefined,
      field: string | undefined,
      label: string,
    ) => {
      if (!value) return;
      if (!field)
        throw new BadRequestError(
          "This record type cannot be filtered by " + label,
        );
      values.push(value);
      conditions.push(field + " = $" + values.length);
    };
    filter(query.projectId, config.projectField, "projectId");
    filter(query.provinceId, config.provinceField, "provinceId");
    filter(query.siteId, config.siteField, "siteId");
    if (query.receiptId) {
      if (resource !== "receipt-lines")
        throw new BadRequestError(
          "This record type cannot be filtered by receiptId",
        );
      values.push(query.receiptId);
      conditions.push("receipt_id = $" + values.length);
    }
    if (query.phaseId) {
      if (!config.fields.includes("phaseId"))
        throw new BadRequestError(
          "This record type cannot be filtered by phaseId",
        );
      values.push(query.phaseId);
      conditions.push("phase_id = $" + values.length);
    }
    if (query.status) {
      if (!config.statusField)
        throw new BadRequestError("This record type does not have a status");
      values.push(query.status);
      conditions.push(config.statusField + "::text = $" + values.length);
    }
    if (query.fromDate || query.toDate) {
      if (!config.dateField)
        throw new BadRequestError(
          "This record type does not have a date filter",
        );
      if (query.fromDate) {
        values.push(query.fromDate);
        conditions.push(config.dateField + " >= $" + values.length);
      }
      if (query.toDate) {
        values.push(query.toDate);
        conditions.push(config.dateField + " <= $" + values.length);
      }
    }
    const result = await client.query<Row>(
      "SELECT * FROM " +
        config.table +
        " WHERE " +
        conditions.join(" AND ") +
        " ORDER BY " +
        (config.sortField ?? "created_at") +
        " DESC LIMIT 1000",
      values,
    );
    const visible: Row[] = [];
    for (const row of result.rows) {
      try {
        await assertVisible(client, context, resource, String(row.id));
        visible.push(mapRow(row));
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
      }
    }
    const offset = Number.isInteger(query.offset) ? query.offset : 0;
    const limit = Number.isInteger(query.limit) ? query.limit : 50;
    const page = visible.slice(offset, offset + limit);
    const policyVisible =
      resource === "documents"
        ? await visibleDocumentIds(
            client,
            context,
            page.map((document) => String(document.id)),
          )
        : null;
    const readablePage = policyVisible
      ? page.filter((document) => policyVisible.has(String(document.id)))
      : page;
    const enriched =
      resource === "approvals"
        ? await enrichApprovalRows(client, context, readablePage)
        : resource === "project-members"
          ? await enrichProjectMemberRows(client, context, readablePage)
          : resource === "risks"
            ? await enrichProjectRiskRows(client, context, readablePage)
            : resource === "tasks"
              ? await enrichTaskCostRows(client, context, readablePage)
              : resource === "documents"
                ? await enrichDocumentRows(client, context, readablePage)
                : resource === "purchase-orders" || resource === "receipts"
                  ? await enrichProcurementActorRows(
                      client,
                      context,
                      resource,
                      readablePage,
                    )
                  : resource === "stock-movements"
                    ? await enrichStockMovementActorRows(
                        client,
                        context,
                        readablePage,
                      )
                    : resource === "receipt-lines"
                      ? await enrichReceiptLineRows(
                          client,
                          context,
                          readablePage,
                        )
                    : resource === "expenses"
                      ? await enrichExpenseRows(client, context, readablePage)
                      : readablePage;
    const audited = await enrichAuditMetadata(
      client,
      context,
      resource,
      enriched,
    );
    return resource === "documents"
      ? audited.map(redactDocumentStorage)
      : audited;
  });
}

/**
 * Private task queue used by employee accounts. This deliberately bypasses a
 * member's broader province role: an employee can only ever receive the rows
 * where they are the direct assignee, never a project portfolio or team queue.
 */
export async function listMyAssignedTasks(
  context: OwnerManagementContext,
): Promise<Row[]> {
  return withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      `SELECT t.id,t.code,t.title,t.description,t.task_type,t.status,t.priority,
              t.start_date,t.due_date,t.progress_percent,t.blocked_reason,t.notes,
              t.project_id,t.phase_id,COALESCE(p.province_id,t.province_id) AS province_id,
              COALESCE(p.site_id,t.site_id) AS site_id,
              p.name AS project_name,p.code AS project_code,
              ph.name AS phase_name,ph.code AS phase_code,
              province.name AS province_name,province.code AS province_code,
              site.name AS site_name,site.code AS site_code,
              project_progress.progress_percent AS project_progress_percent
         FROM management_project_tasks t
         LEFT JOIN management_projects p
           ON p.organization_id=t.organization_id AND p.id=t.project_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(
             AVG(project_task.progress_percent) FILTER (WHERE project_task.task_type='work'),
             AVG(project_task.progress_percent)
           ) AS progress_percent
           FROM management_project_tasks project_task
           WHERE project_task.organization_id=t.organization_id
             AND project_task.project_id=t.project_id
         ) project_progress ON true
         LEFT JOIN management_project_phases ph
           ON ph.organization_id=t.organization_id AND ph.id=t.phase_id
         LEFT JOIN provinces province
           ON province.organization_id=t.organization_id
          AND province.id=COALESCE(p.province_id,t.province_id)
         LEFT JOIN sites site
           ON site.organization_id=t.organization_id
          AND site.id=COALESCE(p.site_id,t.site_id)
        WHERE t.organization_id=$1
          AND t.assigned_member_id=$2
          AND COALESCE(t.task_type,'work')='work'
        ORDER BY CASE WHEN t.status='blocked' THEN 0 WHEN t.status='in_progress' THEN 1 ELSE 2 END,
                 t.due_date NULLS LAST,t.created_at DESC
        LIMIT 200`,
      [context.organizationId, context.memberId],
    );
    return result.rows.map(mapRow);
  });
}

export async function updateMyAssignedTask(
  context: OwnerManagementContext,
  taskId: string,
  input: MyTaskUpdateInput,
): Promise<Row> {
  return withTenantContext(context, async (client) => {
    const currentResult = await client.query<Row>(
      `SELECT * FROM management_project_tasks
        WHERE organization_id=$1 AND id=$2 AND assigned_member_id=$3
          AND COALESCE(task_type,'work')='work'`,
      [context.organizationId, taskId, context.memberId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new NotFoundError("Assigned task not found");

    await assertDependenciesCanStart(client, context, "tasks", taskId, input);
    const columns: Array<[string, unknown]> = [];
    if (input.status !== undefined) columns.push(["status", input.status]);

    if (input.blockedReason !== undefined)
      columns.push(["blocked_reason", input.blockedReason]);
    if (input.notes !== undefined) columns.push(["notes", input.notes]);
    if (!columns.length) throw new BadRequestError("Provide a work update");

    await client.query(
      `UPDATE management_project_tasks
          SET ${columns.map(([column], index) => `${column}=$${index + 4}`).join(", ")}
        WHERE organization_id=$1 AND id=$2 AND assigned_member_id=$3`,
      [
        context.organizationId,
        taskId,
        context.memberId,
        ...columns.map(([, value]) => value),
      ],
    );
    const savedResult = await client.query<Row>(
      "SELECT * FROM management_project_tasks WHERE organization_id=$1 AND id=$2 AND assigned_member_id=$3",
      [context.organizationId, taskId, context.memberId],
    );
    const saved = savedResult.rows[0];
    if (!saved) throw new NotFoundError("Assigned task not found");
    await applyEffects(client, context, "tasks", saved);
    const finalResult = await client.query<Row>(
      "SELECT * FROM management_project_tasks WHERE organization_id=$1 AND id=$2 AND assigned_member_id=$3",
      [context.organizationId, taskId, context.memberId],
    );
    const finalTask = finalResult.rows[0] ?? saved;
    await notifyManagementEvent(
      client,
      context,
      "updated",
      "tasks",
      finalTask,
      String(current.status ?? ""),
    );
    await writeOwnerManagementAudit(
      client,
      context,
      "update",
      "tasks",
      finalTask,
      columns.map(([column]) => camel(column)),
    );
    return mapRow(finalTask);
  });
}
export async function listInventoryStockBalances(
  context: OwnerManagementContext,
  query: InventoryStockQuery,
): Promise<Row[]> {
  return withTenantContext(context, async (client) => {
    const values: unknown[] = [context.organizationId];
    const conditions = ["stock.organization_id = $1"];
    const filter = (value: string | undefined, column: string) => {
      if (!value) return;
      values.push(value);
      conditions.push(`${column} = $${values.length}`);
    };
    filter(query.warehouseId, "stock.warehouse_id");
    filter(query.itemId, "stock.item_id");
    filter(query.provinceId, "site.province_id");
    filter(query.siteId, "warehouse.site_id");
    if (query.lowStock) {
      conditions.push(
        "item.reorder_level IS NOT NULL AND stock.quantity_on_hand - stock.quantity_reserved <= item.reorder_level",
      );
    }
    const result = await client.query<Row>(
      "SELECT concat(stock.warehouse_id::text, ':', stock.item_id::text) AS id, stock.warehouse_id, stock.item_id, stock.quantity_on_hand, stock.quantity_reserved, stock.quantity_on_hand - stock.quantity_reserved AS quantity_available, stock.updated_at, warehouse.name AS warehouse_name, warehouse.code AS warehouse_code, warehouse.site_id, site.name AS site_name, site.province_id, province.name AS province_name, item.name AS item_name, item.code AS item_code, item.category AS item_category, item.unit AS item_unit, item.reorder_level, latest.movement_date AS last_movement_date, latest.movement_type AS last_movement_type FROM management_inventory_stock stock JOIN management_warehouses warehouse ON warehouse.organization_id = stock.organization_id AND warehouse.id = stock.warehouse_id JOIN management_inventory_items item ON item.organization_id = stock.organization_id AND item.id = stock.item_id JOIN sites site ON site.organization_id = warehouse.organization_id AND site.id = warehouse.site_id JOIN provinces province ON province.organization_id = site.organization_id AND province.id = site.province_id LEFT JOIN LATERAL (SELECT movement_date, movement_type FROM management_inventory_stock_movements movement WHERE movement.organization_id = stock.organization_id AND movement.warehouse_id = stock.warehouse_id AND movement.item_id = stock.item_id ORDER BY movement.movement_date DESC, movement.created_at DESC LIMIT 1) latest ON true WHERE " +
        conditions.join(" AND ") +
        " ORDER BY warehouse.name ASC, item.name ASC",
      values,
    );
    const visible: Row[] = [];
    for (const row of result.rows) {
      try {
        await assertVisible(
          client,
          context,
          "warehouses",
          String(row.warehouse_id),
        );
        visible.push(mapRow(row));
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
      }
    }
    return visible;
  });
}
export async function getOwnerManagementRecord(
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  recordId: string,
): Promise<Row> {
  return withTenantContext(context, async (client) => {
    const row = await rawRecord(client, context, resource, recordId);
    if (resource === "documents")
      await assertDocumentPolicy(client, context, recordId, "read");
    const mapped =
      resource === "approvals"
        ? ((await enrichApprovalRows(client, context, [row]))[0] ?? mapRow(row))
        : resource === "project-members"
          ? ((
              await enrichProjectMemberRows(client, context, [mapRow(row)])
            )[0] ?? mapRow(row))
          : resource === "risks"
            ? ((
                await enrichProjectRiskRows(client, context, [mapRow(row)])
              )[0] ?? mapRow(row))
            : resource === "tasks"
              ? ((
                  await enrichTaskCostRows(client, context, [mapRow(row)])
                )[0] ?? mapRow(row))
              : resource === "documents"
                ? ((
                    await enrichDocumentRows(client, context, [mapRow(row)])
                  )[0] ?? mapRow(row))
                : mapRow(row);
    const audited =
      (await enrichAuditMetadata(client, context, resource, [mapped]))[0] ??
      mapped;
    return resource === "documents" ? redactDocumentStorage(audited) : audited;
  });
}

async function notifyManagementEvent(
  client: PoolClient,
  context: OwnerManagementContext,
  action: "created" | "updated",
  resource: OwnerManagementResource,
  row: Row,
  previousStatus?: string | null,
): Promise<void> {
  const recordId = String(row.id ?? "");
  if (!recordId) return;
  const label = String(
    row.title ??
      row.name ??
      row.code ??
      row.request_number ??
      row.work_order_number ??
      "record",
  );
  const provinceId = row.province_id ? String(row.province_id) : null;
  const projectId = row.project_id ? String(row.project_id) : null;
  const owner = async (
    type: string,
    category: string,
    priority: "normal" | "high",
    title: string,
    message: string,
    actionUrl: string,
  ) =>
    notifyOrganizationOwnersInTransaction(client, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      provinceId,
      type,
      category,
      priority,
      title,
      message,
      actionUrl,
      entityType: `management_${resource}`,
      entityId: recordId,
      metadata: projectId ? { projectId } : {},
      deduplicationKey: `${resource}:${recordId}:${type}`,
    });
  if (resource === "tasks") {
    const assignedMemberId = row.assigned_member_id
      ? String(row.assigned_member_id)
      : null;
    if (
      assignedMemberId &&
      assignedMemberId !== context.memberId &&
      action === "created"
    ) {
      await createNotificationInTransaction(client, {
        organizationId: context.organizationId,
        recipientMemberId: assignedMemberId,
        actorUserId: context.userId,
        provinceId,
        type: "task_assigned",
        category: "task",
        priority:
          String(row.priority) === "critical"
            ? "urgent"
            : String(row.priority) === "high"
              ? "high"
              : "normal",
        title: "New task assigned",
        message: label,
        actionUrl: "/my-tasks",
        entityType: "management_project_task",
        entityId: recordId,
        metadata: projectId ? { projectId } : {},
        deduplicationKey: `task-assigned:${recordId}:${assignedMemberId}`,
      });
    }
    if (String(row.status) === "completed" && previousStatus !== "completed")
      await owner(
        "task_completed",
        "task",
        "normal",
        "Task completed",
        label,
        "/projects",
      );
    return;
  }
  if (resource === "risks") {
    const riskOwnerId = row.owner_member_id
      ? String(row.owner_member_id)
      : null;
    if (action === "created" && riskOwnerId && riskOwnerId !== context.memberId)
      await createNotificationInTransaction(client, {
        organizationId: context.organizationId,
        recipientMemberId: riskOwnerId,
        actorUserId: context.userId,
        provinceId,
        type: "project_risk_assigned",
        category: "project",
        priority: String(row.impact) === "critical" ? "urgent" : "high",
        title: "Project risk assigned",
        message: label,
        actionUrl: "/projects",
        entityType: "management_project_risk",
        entityId: recordId,
        metadata: projectId ? { projectId } : {},
        deduplicationKey: `project-risk-assigned:${recordId}:${riskOwnerId}`,
      });
    if (String(row.status) === "triggered" && previousStatus !== "triggered")
      await owner(
        "project_risk_triggered",
        "project",
        String(row.impact) === "critical" ? "high" : "normal",
        "Project risk triggered",
        label,
        "/projects",
      );
    return;
  }
  if (
    resource === "phases" &&
    String(row.status) === "completed" &&
    previousStatus !== "completed"
  ) {
    await owner(
      "phase_completed",
      "project",
      "normal",
      "Project phase completed",
      label,
      "/projects",
    );
    return;
  }
  if (resource === "purchase-requests" && action === "created") {
    await owner(
      "purchase_request_created",
      "procurement",
      "high",
      "Purchase request needs review",
      label,
      "/procurement",
    );
    return;
  }
  if (
    resource === "expenses" &&
    String(row.status) === "submitted" &&
    previousStatus !== "submitted"
  ) {
    await owner(
      "expense_submitted",
      "finance",
      "high",
      "Expense awaiting approval",
      label,
      "/approvals",
    );
    return;
  }
  if (resource === "maintenance-work-orders" && action === "created")
    await owner(
      "maintenance_scheduled",
      "maintenance",
      "normal",
      "Maintenance work scheduled",
      label,
      "/maintenance",
    );
}
/** A purchase order follows its approved purchase request. The request is the
 * single source of the project, phase and task context, which prevents a form
 * from mixing records from different project phases. */
async function hydratePurchaseOrderFromRequest(
  client: PoolClient,
  context: OwnerManagementContext,
  input: Input,
): Promise<void> {
  if (
    typeof input.purchaseRequestId !== "string" ||
    !input.purchaseRequestId.trim()
  )
    throw new BadRequestError("Choose an approved purchase request", {
      field: "purchaseRequestId",
    });
  const result = await client.query<Row>(
    "SELECT project_id, phase_id, project_task_id, supplier_id, currency_code, approval_status FROM management_purchase_requests WHERE organization_id = $1 AND id = $2",
    [context.organizationId, input.purchaseRequestId],
  );
  const request = result.rows[0];
  if (!request)
    throw new BadRequestError(
      "Choose a purchase request from this organization",
      {
        field: "purchaseRequestId",
      },
    );
  if (
    !["approved", "partially_approved"].includes(
      String(request.approval_status),
    )
  )
    throw new BadRequestError(
      "Only an approved purchase request can be used for a purchase order",
      { field: "purchaseRequestId" },
    );
  if (input.projectId && String(input.projectId) !== String(request.project_id))
    throw new BadRequestError(
      "The selected purchase request belongs to a different project",
      { field: "purchaseRequestId" },
    );
  // Never trust phase/task selectors supplied by the browser. They must remain
  // the same as the request that was approved by the owner.
  input.projectId = request.project_id;
  input.phaseId = request.phase_id ?? null;
  input.projectTaskId = request.project_task_id ?? null;
  // The request supplies sensible defaults. A purchaser may still choose a
  // different supplier or currency for the draft order before it is sent.
  if (!input.supplierId && request.supplier_id)
    input.supplierId = request.supplier_id;
  if (!input.currencyCode && request.currency_code)
    input.currencyCode = request.currency_code;
}

/** A new BR is allowed only when an order has been sent and still has a
 * deliverable balance. Draft, cancelled and fully received orders must never
 * become selectable again just because a browser holds an old order id. */
async function assertPurchaseOrderCanReceive(
  client: PoolClient,
  context: OwnerManagementContext,
  orderId: string,
): Promise<void> {
  const existingDraft = await client.query<{ receipt_number: string | null }>(
    "SELECT receipt_number FROM management_receipts WHERE organization_id = $1 AND purchase_order_id = $2 AND status = 'draft' LIMIT 1",
    [context.organizationId, orderId],
  );
  if (existingDraft.rowCount)
    throw new BadRequestError(
      "This purchase order already has a draft receipt. Open it to finish the delivery, or cancel it before creating another receipt.",
      { field: "purchaseOrderId" },
    );
  const result = await client.query<{
    status: string;
    ordered_quantity: string;
    accepted_quantity: string;
  }>(
    "SELECT po.status, COALESCE(SUM(pol.ordered_quantity), 0)::text AS ordered_quantity, COALESCE(SUM(CASE WHEN re.status IN ('received', 'verified') THEN rl.received_quantity - rl.damaged_quantity - rl.rejected_quantity ELSE 0 END), 0)::text AS accepted_quantity FROM management_purchase_orders po LEFT JOIN management_purchase_order_lines pol ON pol.organization_id = po.organization_id AND pol.purchase_order_id = po.id LEFT JOIN management_receipt_lines rl ON rl.organization_id = pol.organization_id AND rl.purchase_order_line_id = pol.id LEFT JOIN management_receipts re ON re.organization_id = rl.organization_id AND re.id = rl.receipt_id WHERE po.organization_id = $1 AND po.id = $2 GROUP BY po.id, po.status",
    [context.organizationId, orderId],
  );
  const order = result.rows[0];
  if (!order)
    throw new BadRequestError(
      "Choose a valid purchase order before recording this receipt",
      {
        field: "purchaseOrderId",
      },
    );
  if (!["sent", "partially_received"].includes(String(order.status)))
    throw new BadRequestError(
      "Only a sent purchase order with items still to receive can be selected for a new receipt",
      { field: "purchaseOrderId" },
    );
  const ordered = Number(order.ordered_quantity);
  const accepted = Number(order.accepted_quantity);
  if (!(ordered > 0))
    throw new BadRequestError(
      "Add at least one ordered item before creating a receipt",
      { field: "purchaseOrderId" },
    );
  if (accepted >= ordered)
    throw new BadRequestError(
      "This purchase order has already been fully received",
      { field: "purchaseOrderId" },
    );
}

/** A receipt always follows its purchase order. The purchase order owns the
 * project (and, indirectly, its task and phase), so a BR cannot be filed under
 * another project even if a browser submits a stale hidden field. */
async function hydrateReceiptFromPurchaseOrder(
  client: PoolClient,
  context: OwnerManagementContext,
  input: Input,
  requireReceivingBalance = false,
): Promise<void> {
  if (
    typeof input.purchaseOrderId !== "string" ||
    !input.purchaseOrderId.trim()
  )
    throw new BadRequestError("Choose the purchase order that was delivered", {
      field: "purchaseOrderId",
    });
  const result = await client.query<Row>(
    "SELECT project_id FROM management_purchase_orders WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    [context.organizationId, input.purchaseOrderId],
  );
  const order = result.rows[0];
  if (!order)
    throw new BadRequestError(
      "Choose a valid purchase order before recording this receipt",
      {
        field: "purchaseOrderId",
      },
    );
  if (input.projectId && String(input.projectId) !== String(order.project_id))
    throw new BadRequestError(
      "The selected purchase order belongs to a different project",
      { field: "purchaseOrderId" },
    );
  if (requireReceivingBalance)
    await assertPurchaseOrderCanReceive(client, context, input.purchaseOrderId);
  input.projectId = order.project_id;
}

/**
 * A BR is the physical delivery of an existing BC, not a second order-entry
 * screen. Copy each still-unreceived BC line into the new draft so the person
 * receiving only has to correct what differs from the delivery.
 */
async function copyRemainingOrderLinesToDraftReceipt(
  client: PoolClient,
  context: OwnerManagementContext,
  receiptId: string,
  purchaseOrderId: string,
): Promise<void> {
  const copied = await client.query<{ id: string }>(
    "INSERT INTO management_receipt_lines (organization_id, receipt_id, purchase_order_line_id, project_material_id, inventory_item_id, received_quantity, damaged_quantity, rejected_quantity, actual_unit_cost, asset_required, asset_name, asset_category, receiver_notes) SELECT $1, $2, pol.id, pol.project_material_id, pol.inventory_item_id, pol.ordered_quantity - COALESCE(accepted.quantity, 0), 0, 0, pol.unit_cost, false, NULL, NULL, NULL FROM management_purchase_order_lines pol LEFT JOIN LATERAL (SELECT COALESCE(SUM(rl.received_quantity - rl.damaged_quantity - rl.rejected_quantity), 0) AS quantity FROM management_receipt_lines rl JOIN management_receipts re ON re.organization_id = rl.organization_id AND re.id = rl.receipt_id WHERE rl.organization_id = pol.organization_id AND rl.purchase_order_line_id = pol.id AND re.status IN ('received', 'verified')) accepted ON true WHERE pol.organization_id = $1 AND pol.purchase_order_id = $3 AND pol.ordered_quantity > COALESCE(accepted.quantity, 0) RETURNING id",
    [context.organizationId, receiptId, purchaseOrderId],
  );
  if (!copied.rowCount)
    throw new BadRequestError(
      "This purchase order has no remaining ordered items to receive",
      { field: "purchaseOrderId" },
    );
}

/** Carry task geography and project context into every linked financial record.
 * The client may select only a task; the API verifies tenant ownership then
 * owns the project/phase fields so a browser cannot link across projects. */
async function hydrateProjectTaskContext(
  client: PoolClient,
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  input: Input,
): Promise<void> {
  if (!["purchase-requests", "purchase-orders", "expenses"].includes(resource))
    return;
  let taskId =
    typeof input.projectTaskId === "string" ? input.projectTaskId : null;
  if (!taskId && resource === "purchase-orders" && input.purchaseRequestId) {
    const request = await client.query<Row>(
      "SELECT project_task_id FROM management_purchase_requests WHERE organization_id = $1 AND id = $2",
      [context.organizationId, input.purchaseRequestId],
    );
    taskId = request.rows[0]?.project_task_id
      ? String(request.rows[0].project_task_id)
      : null;
  }
  if (!taskId && resource === "expenses" && input.purchaseOrderId) {
    const order = await client.query<Row>(
      "SELECT project_task_id FROM management_purchase_orders WHERE organization_id = $1 AND id = $2",
      [context.organizationId, input.purchaseOrderId],
    );
    taskId = order.rows[0]?.project_task_id
      ? String(order.rows[0].project_task_id)
      : null;
  }
  if (!taskId) return;
  const task = await client.query<Row>(
    "SELECT project_id, phase_id FROM management_project_tasks WHERE organization_id = $1 AND id = $2 AND task_type = 'work'",
    [context.organizationId, taskId],
  );
  const row = task.rows[0];
  if (!row)
    throw new BadRequestError("Choose a valid project work task", {
      field: "projectTaskId",
    });
  if (input.projectId && String(input.projectId) !== String(row.project_id))
    throw new BadRequestError(
      "The linked task belongs to a different project",
      {
        field: "projectTaskId",
      },
    );
  // When a task is selected, its own phase is authoritative. This makes the
  // request, order and direct-expense flows resilient to a stale phase control
  // in the browser while preserving a phase-only record when no task is used.
  input.projectTaskId = taskId;
  input.projectId = row.project_id;
  input.phaseId = row.phase_id ?? null;
}

/** Validate budget effects after the proposed row is inside the same PostgreSQL
 * transaction. This makes concurrent orders/receipts safe: an over-budget
 * write rolls back rather than relying on the browser calculation. */
async function assertProjectBudgetImpact(
  client: PoolClient,
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  row: Row,
): Promise<void> {
  // Order and receipt lines are saved independently. Resolve their financial
  // parent after the line has been written so a user cannot bypass this check
  // by creating a zero-value header first and adding the amount afterward.
  let budgetResource = resource;
  let budgetRow = row;
  if (resource === "purchase-order-lines") {
    budgetResource = "purchase-orders";
    budgetRow = await rawRecord(
      client,
      context,
      "purchase-orders",
      String(row.purchase_order_id),
    );
  }
  if (resource === "receipt-lines") {
    budgetResource = "receipts";
    budgetRow = await rawRecord(
      client,
      context,
      "receipts",
      String(row.receipt_id),
    );
  }

  const status = String(budgetRow.status ?? "");
  const affectsBudget =
    (budgetResource === "purchase-orders" &&
      ["sent", "partially_received"].includes(status)) ||
    (budgetResource === "receipts" &&
      ["received", "verified"].includes(status)) ||
    (budgetResource === "expenses" &&
      ["approved", "paid"].includes(status) &&
      !budgetRow.receipt_id);
  if (!affectsBudget || !budgetRow.project_id) return;

  const summary = await projectSummaryFor(
    client,
    context,
    String(budgetRow.project_id),
  );
  const budget = summary.budget as Row;
  let taskId =
    budgetRow.project_task_id == null
      ? null
      : String(budgetRow.project_task_id);
  if (!taskId && budgetResource === "receipts") {
    const order = await client.query<Row>(
      "SELECT project_task_id FROM management_purchase_orders WHERE organization_id = $1 AND id = $2",
      [context.organizationId, budgetRow.purchase_order_id],
    );
    taskId = order.rows[0]?.project_task_id
      ? String(order.rows[0].project_task_id)
      : null;
  }
  const task = taskId
    ? ((summary.taskBudgets as Row[] | undefined) ?? []).find(
        (item) => String(item.id) === taskId,
      )
    : null;
  const tooHigh =
    Number(budget.available ?? 0) < -0.0001 ||
    (task != null && Number(task.available ?? 0) < -0.0001);
  if (!tooHigh) return;
  if (context.isOwner && String(budgetRow.budget_override_reason ?? "").trim())
    return;
  throw new BadRequestError(
    task
      ? "This operation exceeds the linked task budget. An owner justification is required to continue."
      : "This operation exceeds the remaining project budget. An owner justification is required to continue.",
    { field: task ? "projectTaskId" : "amount" },
  );
} /** A payment attached to a confirmed BR is only a settlement record.  The BR
 * already consumed the budget, so the server owns its amount, currency and
 * procurement links and prevents a second budget impact. */
function expenseType(
  input: Input,
): "direct_expense" | "receipt_payment" | "reimbursement" {
  if (input.reimbursesExpenseId) return "reimbursement";
  const requested = String(input.expenseType ?? "").trim();
  if (
    ["direct_expense", "receipt_payment", "reimbursement"].includes(requested)
  )
    return requested as "direct_expense" | "receipt_payment" | "reimbursement";
  // Historical payments did not have a type. A receipt is the reliable signal.
  return input.receiptId ? "receipt_payment" : "direct_expense";
}

function paymentCountsTowardPayable(status: unknown): boolean {
  return ["approved", "paid"].includes(String(status));
}

/**
 * A receipt consumes the budget when it is accepted. Supplier payments only
 * settle that payable. The server—not the browser—hydrates every accounting
 * link, limits partial payments to the remaining balance, and keeps retries
 * idempotent.
 */
async function hydrateSupplierPaymentFromReceipt(
  client: PoolClient,
  context: OwnerManagementContext,
  input: Input,
  currentExpenseId?: string,
): Promise<void> {
  const type = expenseType(input);
  input.expenseType = type;

  if (type === "reimbursement") {
    const original = await client.query<Row>(
      "SELECT project_id, project_task_id, phase_id, province_id, site_id, supplier_id, purchase_order_id, receipt_id, currency_code, amount, expense_type, status FROM management_expenses WHERE organization_id = $1 AND id = $2",
      [context.organizationId, input.reimbursesExpenseId],
    );
    const source = original.rows[0];
    if (!source)
      throw new BadRequestError(
        "Choose the original financial record to reimburse",
        {
          field: "reimbursesExpenseId",
        },
      );
    if (!paymentCountsTowardPayable(source.status))
      throw new BadRequestError(
        "Only an approved or paid record can be reimbursed",
        {
          field: "reimbursesExpenseId",
        },
      );
    const refundAmount = Number(input.amount ?? 0);
    if (
      !Number.isFinite(refundAmount) ||
      refundAmount <= 0 ||
      refundAmount > Number(source.amount ?? 0)
    )
      throw new BadRequestError(
        "The reimbursement must be greater than zero and cannot exceed the original amount",
        {
          field: "amount",
        },
      );
    input.projectId = source.project_id;
    input.projectTaskId = source.project_task_id ?? null;
    input.phaseId = source.phase_id ?? null;
    input.provinceId = source.province_id;
    input.siteId = source.site_id ?? null;
    input.supplierId = source.supplier_id ?? null;
    input.purchaseOrderId = source.purchase_order_id ?? null;
    input.receiptId = source.receipt_id ?? null;
    input.currencyCode = source.currency_code;
    input.category = input.category || "reimbursement";
    input.title = input.title || "Reimbursement";
    input.description = input.description || input.title;
    return;
  }

  if (type !== "receipt_payment") {
    input.receiptId = null;
    input.title = input.title || input.description || "Direct expense";
    input.description = input.description || input.title;
    if (!String(input.category ?? "").trim())
      throw new BadRequestError("Choose a category for this direct expense", {
        field: "category",
      });
    return;
  }

  if (!input.receiptId)
    throw new BadRequestError(
      "Choose a confirmed receipt before recording its supplier payment",
      {
        field: "receiptId",
      },
    );
  const result = await client.query<Row>(
    "SELECT re.id, re.project_id, re.purchase_order_id, po.project_task_id, po.phase_id, po.currency_code, po.supplier_id, COALESCE(SUM((rl.received_quantity - rl.damaged_quantity - rl.rejected_quantity) * COALESCE(rl.actual_unit_cost, pol.unit_cost, 0)), 0) AS receipt_amount FROM management_receipts re JOIN management_purchase_orders po ON po.organization_id = re.organization_id AND po.id = re.purchase_order_id LEFT JOIN management_receipt_lines rl ON rl.organization_id = re.organization_id AND rl.receipt_id = re.id LEFT JOIN management_purchase_order_lines pol ON pol.organization_id = rl.organization_id AND pol.id = rl.purchase_order_line_id WHERE re.organization_id = $1 AND re.id = $2 AND re.status IN ('received', 'verified') GROUP BY re.id, re.project_id, re.purchase_order_id, po.project_task_id, po.phase_id, po.currency_code, po.supplier_id",
    [context.organizationId, input.receiptId],
  );
  const receipt = result.rows[0];
  if (!receipt)
    throw new BadRequestError(
      "Choose a confirmed receipt before recording its supplier payment",
      {
        field: "receiptId",
      },
    );
  if (input.projectId && String(input.projectId) !== String(receipt.project_id))
    throw new BadRequestError(
      "The linked receipt must belong to the same project",
      {
        field: "receiptId",
      },
    );
  if (
    input.projectTaskId &&
    receipt.project_task_id &&
    String(input.projectTaskId) !== String(receipt.project_task_id)
  )
    throw new BadRequestError(
      "The linked receipt belongs to a different project task",
      {
        field: "receiptId",
      },
    );

  const paid = await client.query<Row>(
    "SELECT COALESCE(SUM(CASE WHEN expense_type = 'receipt_payment' THEN amount WHEN expense_type = 'reimbursement' THEN -amount ELSE 0 END), 0) AS paid_amount FROM management_expenses WHERE organization_id = $1 AND receipt_id = $2 AND status IN ('approved', 'paid') AND ($3::uuid IS NULL OR id <> $3::uuid)",
    [context.organizationId, receipt.id, currentExpenseId ?? null],
  );
  const balance = Math.max(
    Number(receipt.receipt_amount ?? 0) -
      Number(paid.rows[0]?.paid_amount ?? 0),
    0,
  );
  const amount = Number(input.amount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0)
    throw new BadRequestError(
      "Enter a supplier payment amount greater than zero",
      {
        field: "amount",
      },
    );
  if (amount > balance + 0.0001)
    throw new BadRequestError(
      "This payment exceeds the remaining balance of the receipt",
      {
        field: "amount",
      },
    );

  input.projectId = receipt.project_id;
  input.purchaseOrderId = receipt.purchase_order_id;
  input.projectTaskId = receipt.project_task_id ?? null;
  input.phaseId = receipt.phase_id ?? null;
  input.supplierId = receipt.supplier_id ?? null;
  input.currencyCode = receipt.currency_code;
  input.category = input.category || "supplier_payment";
  input.title = input.title || "Supplier payment";
  input.description = input.description || input.title;
}
export async function createOwnerManagementRecord(
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  input: Input,
): Promise<Row> {
  const config = configFor(resource);
  if (config.readOnly)
    throw new BadRequestError(
      "This is a calculated record and cannot be created directly",
    );
  return withTenantContext(context, async (client) => {
    const defaults = withDefaults(context, resource, input);
    if (resource === "projects")
      await assertActiveProjectBenefitOwner(
        client,
        context,
        defaults.benefitOwnerMemberId,
      );
    if (resource === "risks")
      await assertActiveProjectRiskOwner(
        client,
        context,
        defaults.ownerMemberId,
      );
    if (resource === "feed-batches") {
      defaults.status ??= "draft";
      defaults.producedByMemberId ??= context.memberId;
      const outputQuantity = Number(defaults.outputQuantityKg ?? 0);
      const bagWeight = Number(defaults.bagWeightKg ?? 50);
      if (outputQuantity > 0 && bagWeight > 0 && !Number(defaults.bagCount))
        defaults.bagCount = Math.ceil(outputQuantity / bagWeight);
      if (!defaults.batchNumber) {
        const next = await client.query<{ next_number: string }>(
          "SELECT COALESCE(MAX(CASE WHEN batch_number ~ '^ALM-[0-9]+$' THEN substring(batch_number FROM 5)::integer ELSE 0 END), 0) + 1 AS next_number FROM management_feed_batches WHERE organization_id = $1",
          [context.organizationId],
        );
        defaults.batchNumber = `ALM-${String(Number(next.rows[0]?.next_number ?? 1)).padStart(6, "0")}`;
      }
      await assertFeedBatchContext(client, context, defaults);
    }
    if (resource === "feed-batch-inputs")
      await assertFeedBatchInputContext(client, context, defaults);
    if (resource === "feed-recipe-lines")
      await assertNutritionRecipeLineContext(client, context, defaults);
    if (resource === "feed-orders") {
      if (String(defaults.status) !== "draft")
        throw new BadRequestError(
          "Create a feed production order as a draft, then confirm it from the production workspace",
          { field: "status" },
        );
      if (!defaults.orderNumber) {
        const next = await client.query<{ next_number: string }>(
          "SELECT COALESCE(MAX(CASE WHEN order_number ~ '^OF-[0-9]+$' THEN substring(order_number FROM 4)::integer ELSE 0 END),0)+1 AS next_number FROM nutrition_feed_orders WHERE organization_id=$1",
          [context.organizationId],
        );
        defaults.orderNumber = `OF-${String(Number(next.rows[0]?.next_number ?? 1)).padStart(6, "0")}`;
      }
      await assertNutritionFeedOrderContext(client, context, defaults);
    }
    if (resource === "purchase-orders")
      await hydratePurchaseOrderFromRequest(client, context, defaults);
    await hydrateProjectTaskContext(client, context, resource, defaults);
    if (resource === "purchase-orders") {
      // Production uses the concurrent-safe database trigger from migration 118.
      // This fallback keeps a local or older database usable until that migration
      // is present, without ever asking a person to type a BC reference.
      if (!defaults.orderNumber) {
        const sequence = await client.query<Row>(
          "SELECT COALESCE(MAX(CASE WHEN order_number ~ '^BC-[0-9]+$' THEN substring(order_number FROM 4)::integer ELSE 0 END), 0) + 1 AS next_number FROM management_purchase_orders WHERE organization_id = $1",
          [context.organizationId],
        );
        const nextNumber = Number(sequence.rows[0]?.next_number ?? 1);
        defaults.orderNumber = `BC-${String(nextNumber).padStart(6, "0")}`;
      }
      // A document dated today is valid by default. An explicitly selected
      // expected delivery date still must not precede the order date.
      if (!defaults.orderDate)
        defaults.orderDate = new Date().toISOString().slice(0, 10);
      if (
        defaults.expectedDeliveryDate &&
        String(defaults.expectedDeliveryDate) < String(defaults.orderDate)
      )
        throw new BadRequestError(
          "Expected delivery must be on or after the order date",
          { field: "expectedDeliveryDate" },
        );
    }
    if (resource === "receipts") {
      await hydrateReceiptFromPurchaseOrder(client, context, defaults, true);
      if (!defaults.receiptNumber) {
        // The current database trigger is the authoritative, concurrent-safe
        // BR counter. Supplying this fallback keeps older local databases
        // usable until that migration has been applied as well.
        const sequence = await client.query<Row>(
          "SELECT COALESCE(MAX(CASE WHEN receipt_number ~ '^BR-[0-9]+$' THEN substring(receipt_number FROM 4)::integer ELSE 0 END), 0) + 1 AS next_number FROM management_receipts WHERE organization_id = $1",
          [context.organizationId],
        );
        const nextNumber = Number(sequence.rows[0]?.next_number ?? 1);
        defaults.receiptNumber = `BR-${String(nextNumber).padStart(6, "0")}`;
      }
      if (!defaults.receivedDate)
        defaults.receivedDate = new Date().toISOString().slice(0, 10);
    }
    if (resource === "expenses") {
      await hydrateSupplierPaymentFromReceipt(client, context, defaults);
      await hydrateProjectTaskContext(client, context, resource, defaults);
    }
    assertManagerWorkflowInput(context, resource, defaults);
    if (
      resource === "purchase-requests" &&
      String(defaults.status ?? "draft") !== "draft"
    )
      throw new BadRequestError(
        "Create the purchase request as a draft, add its items, then submit it for approval",
        { field: "status" },
      );
    if (resource === "purchase-request-lines")
      await assertPurchaseRequestItemsCanChange(
        client,
        context,
        defaults.purchaseRequestId,
      );
    if (resource === "receipt-lines") {
      await assertReceiptItemsCanChange(client, context, defaults.receiptId);
      const duplicate = await client.query<{ id: string }>(
        "SELECT id FROM management_receipt_lines WHERE organization_id = $1 AND receipt_id = $2 AND purchase_order_line_id = $3 LIMIT 1",
        [
          context.organizationId,
          defaults.receiptId,
          defaults.purchaseOrderLineId,
        ],
      );
      if (duplicate.rowCount)
        throw new ConflictError(
          "This ordered item is already included in the draft receipt. Edit its copied line instead of adding it again.",
          { field: "purchaseOrderLineId" },
        );
    }
    await assertProjectWriteScope(client, context, resource, defaults);
    // Retrying the same receipt-payment request must return the first record,
    // rather than settle a supplier twice after a network timeout.
    if (
      resource === "expenses" &&
      String(defaults.expenseType) === "receipt_payment" &&
      typeof defaults.paymentIdempotencyKey === "string" &&
      defaults.paymentIdempotencyKey.trim()
    ) {
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM management_expenses WHERE organization_id = $1 AND payment_idempotency_key = $2 AND expense_type = 'receipt_payment' LIMIT 1",
        [context.organizationId, defaults.paymentIdempotencyKey.trim()],
      );
      if (existing.rows[0]?.id)
        return mapRow(
          await rawRecord(client, context, resource, existing.rows[0].id),
        );
    }
    const prepared = prepareInput(resource, defaults);
    const columns = ["organization_id", ...prepared.columns];
    const values: unknown[] = [context.organizationId, ...prepared.values];
    let result;
    try {
      result = await client.query<{ id: string }>(
        "INSERT INTO " +
          config.table +
          " (" +
          columns.join(", ") +
          ") VALUES (" +
          values.map((_, index) => "$" + (index + 1)).join(", ") +
          ") RETURNING id",
        values,
      );
    } catch (error: unknown) {
      ownerManagementDatabaseError(error, resource, prepared.columns, 2);
    }
    const recordId = result.rows[0]?.id;
    if (!recordId) throw new BadRequestError("Could not create the record");
    if (resource === "receipts")
      await copyRemainingOrderLinesToDraftReceipt(
        client,
        context,
        recordId,
        String(defaults.purchaseOrderId),
      );
    await assertConsistency(
      client,
      context,
      resource,
      await rawRecord(client, context, resource, recordId),
    );
    const row = await rawRecord(client, context, resource, recordId);
    await assertProjectBudgetImpact(client, context, resource, row);
    await applyEffects(client, context, resource, row);
    const saved = await rawRecord(client, context, resource, recordId);
    await notifyManagementEvent(client, context, "created", resource, saved);
    const budgetAuditMetadata = await budgetChangeAuditMetadata(
      client,
      context,
      resource,
      undefined,
      saved,
    );
    await writeOwnerManagementAudit(
      client,
      context,
      "create",
      resource,
      saved,
      Object.keys(input),
      budgetAuditMetadata,
    );
    const mapped = mapRow(saved);
    return resource === "documents" ? redactDocumentStorage(mapped) : mapped;
  });
}

export async function updateOwnerManagementRecord(
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  recordId: string,
  input: Input,
): Promise<Row> {
  const config = configFor(resource);
  if (config.immutable)
    throw new BadRequestError(
      "This is an immutable history record. Create a correcting adjustment instead.",
    );
  return withTenantContext(context, async (client) => {
    const current = await rawRecord(client, context, resource, recordId);
    if (resource === "projects" && input.benefitOwnerMemberId !== undefined)
      await assertActiveProjectBenefitOwner(
        client,
        context,
        input.benefitOwnerMemberId,
      );
    if (resource === "risks") {
      if (input.ownerMemberId !== undefined)
        await assertActiveProjectRiskOwner(
          client,
          context,
          input.ownerMemberId,
        );
      const nextStatus = String(input.status ?? current.status);
      if (nextStatus === "triggered" && String(current.status) !== "triggered")
        input.triggeredAt ??= new Date().toISOString();
      if (nextStatus === "closed" && String(current.status) !== "closed")
        input.resolvedAt ??= new Date().toISOString();
      const nextDecision = String(input.decision ?? current.decision);
      if (
        String(current.decision) !== "pending" &&
        (input.decision !== undefined ||
          input.decisionTaken !== undefined ||
          input.decisionJustification !== undefined)
      )
        throw new ForbiddenError(
          "A recorded risk decision is preserved. Add a note or create a follow-up risk instead of replacing it.",
        );
      if (
        nextDecision !== "pending" &&
        (input.decision !== undefined ||
          input.decisionTaken !== undefined ||
          input.decisionJustification !== undefined)
      ) {
        input.decidedByMemberId = context.memberId;
        input.decidedAt = new Date().toISOString();
      }
    }
    if (resource === "quality-checks") {
      const nextCommissioningStatus = String(
        input.commissioningStatus ?? current.commissioning_status,
      );
      if (
        nextCommissioningStatus === "validated" &&
        String(current.commissioning_status) !== "validated"
      ) {
        input.commissionedByMemberId ??= context.memberId;
        input.commissionedAt ??= new Date().toISOString();
      }
      input.checkedByMemberId ??=
        current.checked_by_member_id ?? context.memberId;
      input.checkedAt ??= current.checked_at ?? new Date().toISOString();
    }
    if (resource === "project-closeouts") {
      const nextStatus = String(input.status ?? current.status);
      if (
        nextStatus === "completed" &&
        String(current.status) !== "completed"
      ) {
        if (!context.isOwner)
          throw new ForbiddenError(
            "Only the workspace owner can formally close a project",
          );
        input.approvedByMemberId = context.memberId;
        input.completedAt = new Date().toISOString();
      }
      input.preparedByMemberId ??=
        current.prepared_by_member_id ?? context.memberId;
    }
    if (resource === "feed-batches") {
      const currentStatus = String(current.status);
      const nextStatus = String(input.status ?? currentStatus);
      if (currentStatus === "confirmed") {
        const changingBusinessData = Object.keys(input).some(
          (key) => key !== "status",
        );
        if (nextStatus !== "cancelled" || changingBusinessData)
          throw new ForbiddenError(
            "A confirmed feed batch is locked. Cancel it to reverse the stock movements.",
          );
      }
      if (currentStatus === "cancelled")
        throw new ForbiddenError("A cancelled feed batch cannot be changed");
      if (!["draft", "confirmed", "cancelled"].includes(nextStatus))
        throw new BadRequestError(
          "Choose draft, confirmed, or cancelled for this feed batch",
          {
            field: "status",
          },
        );
      await assertFeedBatchContext(client, context, {
        ...mapRow(current),
        ...input,
      });
    }
    if (resource === "feed-batch-inputs")
      await assertFeedBatchInputContext(client, context, {
        ...mapRow(current),
        ...input,
      });
    if (resource === "feed-recipe-lines")
      await assertNutritionRecipeLineContext(client, context, {
        ...mapRow(current),
        ...input,
      });
    if (resource === "feed-orders") {
      const currentStatus = String(current.status);
      const nextStatus = String(input.status ?? currentStatus);
      if (["confirmed", "cancelled"].includes(currentStatus))
        throw new ForbiddenError(
          "A confirmed or cancelled feed production order is locked. Use the controlled production actions instead.",
        );
      if (!["draft", "in_progress"].includes(nextStatus))
        throw new BadRequestError(
          "Confirm or cancel a feed production order from its controlled action, not by editing the status",
          { field: "status" },
        );
      await assertNutritionFeedOrderContext(client, context, {
        ...mapRow(current),
        ...input,
      });
    }
    if (resource === "purchase-requests" && String(current.status) !== "draft")
      throw new ForbiddenError(
        "A submitted or decided purchase request is locked. Create a new request for any change.",
      );
    if (resource === "purchase-request-lines")
      await assertPurchaseRequestItemsCanChange(
        client,
        context,
        current.purchase_request_id,
      );
    if (resource === "receipt-lines")
      await assertReceiptItemsCanChange(client, context, current.receipt_id);
    if (
      resource === "purchase-requests" &&
      String(input.status ?? current.status) === "submitted"
    ) {
      const lines = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM management_purchase_request_lines WHERE organization_id = $1 AND purchase_request_id = $2",
        [context.organizationId, recordId],
      );
      if (Number(lines.rows[0]?.count ?? 0) < 1)
        throw new BadRequestError(
          "Add at least one requested item before submitting this purchase request",
          { field: "status" },
        );
    }
    if (
      resource === "purchase-orders" &&
      String(input.status ?? current.status) === "cancelled" &&
      String(current.status) !== "cancelled"
    ) {
      if (!context.isOwner)
        throw new ForbiddenError(
          "Only the company owner can cancel a purchase order",
        );
      const receipt = await client.query<{ receipt_number: string | null }>(
        "SELECT receipt_number FROM management_receipts WHERE organization_id = $1 AND purchase_order_id = $2 LIMIT 1",
        [context.organizationId, recordId],
      );
      if (receipt.rowCount)
        throw new ConflictError(
          "A purchase order cannot be cancelled after a receiving record exists. Correct the receiving record instead.",
        );
    }
    if (resource === "receipts")
      if (
        input.purchaseOrderId !== undefined &&
        String(input.purchaseOrderId) !== String(current.purchase_order_id)
      )
        throw new ForbiddenError(
          "The purchase order cannot be changed after a draft receipt has been created. Cancel this draft and create a receipt for the other order instead.",
        );
    if (resource === "receipts")
      await assertReceiptStatusTransition(
        client,
        context,
        recordId,
        current.status,
        input.status,
      );
    if (
      resource === "receipts" &&
      ["received", "verified"].includes(
        String(input.status ?? current.status),
      ) &&
      String(current.status) === "draft"
    ) {
      const lines = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM management_receipt_lines WHERE organization_id = $1 AND receipt_id = $2",
        [context.organizationId, recordId],
      );
      if (Number(lines.rows[0]?.count ?? 0) < 1)
        throw new BadRequestError(
          "Record at least one received item before confirming this receipt",
          { field: "status" },
        );
    }
    if (
      !context.isOwner &&
      resource === "expenses" &&
      !["draft", "submitted"].includes(String(current.status))
    )
      throw new ForbiddenError(
        "Managers cannot change an expense after the owner has decided it",
      );
    if (resource === "expenses") {
      const currentInput = mapRow(current);
      const prospective: Input = {};
      for (const field of config.fields)
        prospective[field] = input[field] ?? currentInput[field];
      await hydrateSupplierPaymentFromReceipt(
        client,
        context,
        prospective,
        recordId,
      );
      for (const field of [
        "expenseType",
        "projectId",
        "projectTaskId",
        "phaseId",
        "provinceId",
        "siteId",
        "supplierId",
        "purchaseOrderId",
        "receiptId",
        "currencyCode",
        "category",
        "title",
        "description",
      ]) {
        if (prospective[field] !== undefined) input[field] = prospective[field];
      }
      if (
        String(input.status ?? current.status) === "submitted" &&
        !current.submitted_at
      )
        input.submittedAt = new Date().toISOString();
      if (
        String(input.status ?? current.status) === "paid" &&
        !current.paid_by_member_id
      )
        input.paidByMemberId = context.memberId;
      if (
        ["cancelled", "void", "refunded"].includes(
          String(input.status ?? current.status),
        ) &&
        !current.cancelled_at
      )
        input.cancelledAt = new Date().toISOString();
    }
    if (resource === "purchase-orders" && input.purchaseRequestId !== undefined)
      await hydratePurchaseOrderFromRequest(client, context, input);
    if (resource === "receipts" && input.purchaseOrderId !== undefined)
      await hydrateReceiptFromPurchaseOrder(client, context, input);
    await hydrateProjectTaskContext(client, context, resource, input);
    assertManagerWorkflowInput(context, resource, input);
    await assertDependenciesCanStart(
      client,
      context,
      resource,
      recordId,
      input,
    );
    const localOperationsResources: OwnerManagementResource[] = [
      "tasks",
      "warehouses",
      "stock-movements",
      "feed-batches",
      "feed-batch-inputs",
      "assets",
      "asset-assignments",
      "asset-movements",
      "asset-usage",
      "maintenance-plans",
      "maintenance-work-orders",
      "maintenance-parts",
    ];
    if (localOperationsResources.includes(resource))
      await assertProjectWriteScope(client, context, resource, {
        ...input,
        projectId: input.projectId ?? current.project_id ?? undefined,
        provinceId: input.provinceId ?? current.province_id ?? undefined,
        siteId: input.siteId ?? current.site_id ?? undefined,
        assetId: input.assetId ?? current.asset_id ?? undefined,
        warehouseId: input.warehouseId ?? current.warehouse_id ?? undefined,
        workOrderId: input.workOrderId ?? current.work_order_id ?? undefined,
      });
    else if (input.projectId !== undefined)
      await assertProjectWriteScope(client, context, resource, input);
    const prepared = prepareInput(resource, input);
    if (!prepared.columns.length)
      throw new BadRequestError("Provide at least one value to change");
    const values: unknown[] = [
      context.organizationId,
      recordId,
      ...prepared.values,
    ];
    try {
      await client.query(
        "UPDATE " +
          config.table +
          " SET " +
          prepared.columns
            .map((column, index) => column + " = $" + (index + 3))
            .join(", ") +
          " WHERE organization_id = $1 AND id = $2",
        values,
      );
    } catch (error: unknown) {
      ownerManagementDatabaseError(error, resource, prepared.columns, 3);
    }
    const row = await rawRecord(client, context, resource, recordId);
    await assertConsistency(client, context, resource, row);
    await assertProjectBudgetImpact(client, context, resource, row);
    await applyEffects(client, context, resource, row);
    const saved = await rawRecord(client, context, resource, recordId);
    await notifyManagementEvent(
      client,
      context,
      "updated",
      resource,
      saved,
      String(current.status ?? ""),
    );
    const budgetAuditMetadata = await budgetChangeAuditMetadata(
      client,
      context,
      resource,
      current,
      saved,
    );
    await writeOwnerManagementAudit(
      client,
      context,
      "update",
      resource,
      saved,
      Object.keys(input),
      budgetAuditMetadata,
    );
    return mapRow(saved);
  });
}

export async function deleteOwnerManagementRecord(
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  recordId: string,
): Promise<void> {
  const config = configFor(resource);
  if (config.immutable)
    throw new BadRequestError(
      "This history record cannot be deleted. Add an adjustment or reversal instead.",
    );
  if (config.deleteProtected)
    throw new BadRequestError(
      "A risk register entry is retained for traceability. Close it instead of deleting it.",
    );
  await withTenantContext(context, async (client) => {
    const deleted = await rawRecord(client, context, resource, recordId);
    if (resource === "feed-batches" && String(deleted.status) !== "draft")
      throw new ForbiddenError(
        "A confirmed or cancelled feed batch is preserved for stock traceability. Cancel it instead of deleting it.",
      );
    if (resource === "feed-batch-inputs")
      await assertFeedBatchInputsCanChange(client, context, deleted.batch_id);
    if (resource === "feed-orders" && String(deleted.status) !== "draft")
      throw new ForbiddenError(
        "A confirmed or cancelled feed production order is preserved for stock traceability. Cancel it instead of deleting it.",
      );
    if (
      resource === "expenses" &&
      ["approved", "paid", "reimbursed", "refunded"].includes(
        String(deleted.status),
      )
    )
      throw new ForbiddenError(
        "An approved financial record cannot be deleted. Cancel it or create an audited reimbursement instead.",
      );
    if (resource === "purchase-requests" && String(deleted.status) !== "draft")
      throw new ForbiddenError(
        "A submitted or decided purchase request cannot be deleted",
      );
    if (resource === "purchase-request-lines")
      await assertPurchaseRequestItemsCanChange(
        client,
        context,
        deleted.purchase_request_id,
      );
    if (resource === "receipt-lines")
      await assertReceiptItemsCanChange(client, context, deleted.receipt_id);
    if (resource === "tasks") {
      const financialLinks = await client.query(
        "SELECT 1 FROM management_purchase_requests WHERE organization_id = $1 AND project_task_id = $2 UNION ALL SELECT 1 FROM management_purchase_orders WHERE organization_id = $1 AND project_task_id = $2 UNION ALL SELECT 1 FROM management_expenses WHERE organization_id = $1 AND project_task_id = $2 UNION ALL SELECT 1 FROM management_receipts receipt JOIN management_purchase_orders purchase_order ON purchase_order.organization_id = receipt.organization_id AND purchase_order.id = receipt.purchase_order_id WHERE receipt.organization_id = $1 AND purchase_order.project_task_id = $2 LIMIT 1",
        [context.organizationId, recordId],
      );
      if (financialLinks.rowCount)
        throw new BadRequestError(
          "A task with financial operations cannot be deleted. Archive it by cancelling the task instead.",
          { field: "status" },
        );
    }
    const result = await client.query(
      "DELETE FROM " + config.table + " WHERE organization_id = $1 AND id = $2",
      [context.organizationId, recordId],
    );
    if (!result.rowCount)
      throw new NotFoundError("Owner Management record not found");
    await writeOwnerManagementAudit(
      client,
      context,
      "delete",
      resource,
      deleted,
      [],
    );
  });
}

/**
 * Reopens a request before it has been used in a purchase order. This is an
 * owner-only correction workflow: the original approval remains in history,
 * any pending approval is closed, and the requester can amend the draft.
 */
export async function returnPurchaseRequestToDraft(
  context: OwnerManagementContext,
  recordId: string,
  correctionNote?: string,
): Promise<Row> {
  if (!context.isOwner)
    throw new ForbiddenError(
      "Only the company owner can return a purchase request to draft",
    );
  return withTenantContext(context, async (client) => {
    const requestResult = await client.query<Row>(
      "SELECT * FROM management_purchase_requests WHERE organization_id = $1 AND id = $2 FOR UPDATE",
      [context.organizationId, recordId],
    );
    const request = requestResult.rows[0];
    if (!request) throw new NotFoundError("Purchase request not found");
    const currentStatus = String(request.status);
    if (currentStatus === "draft") return mapRow(request);
    if (
      !["submitted", "approved", "partially_approved", "rejected"].includes(
        currentStatus,
      )
    )
      throw new BadRequestError(
        "Only a submitted or decided purchase request can be returned to draft",
      );

    const linkedOrders = await client.query<{ order_number: string }>(
      "SELECT order_number FROM management_purchase_orders WHERE organization_id = $1 AND purchase_request_id = $2 ORDER BY created_at LIMIT 1",
      [context.organizationId, recordId],
    );
    if (linkedOrders.rowCount)
      throw new ConflictError(
        "This request is already used by purchase order " +
          String(linkedOrders.rows[0]?.order_number ?? "").trim() +
          ". Cancel or replace that order instead of reopening the request.",
      );

    const closedApprovals = await client.query<Row>(
      "UPDATE management_approval_requests SET status = 'cancelled', decided_by_member_id = $3, decided_at = now(), decision_notes = COALESCE(decision_notes, $4) WHERE organization_id = $1 AND entity_type = 'purchase_request' AND entity_id = $2 AND status = 'pending' RETURNING *",
      [
        context.organizationId,
        recordId,
        context.memberId,
        correctionNote?.trim() ||
          "Returned to draft by the owner for correction",
      ],
    );
    for (const approval of closedApprovals.rows)
      await writeOwnerManagementAudit(
        client,
        context,
        "update",
        "approvals",
        approval,
        ["status", "decisionNotes"],
      );
    const restored = await client.query<Row>(
      "UPDATE management_purchase_requests SET status = 'draft', approval_status = 'not_requested', reviewed_by_member_id = NULL, notes = CASE WHEN $3::text IS NULL OR btrim($3::text) = '' THEN notes WHEN notes IS NULL OR btrim(notes) = '' THEN 'Correction demandée : ' || btrim($3::text) ELSE notes || E'\\n\\nCorrection demandée : ' || btrim($3::text) END WHERE organization_id = $1 AND id = $2 RETURNING *",
      [context.organizationId, recordId, correctionNote ?? null],
    );
    const record = restored.rows[0];
    if (!record) throw new NotFoundError("Purchase request not found");
    await writeOwnerManagementAudit(
      client,
      context,
      "update",
      "purchase-requests",
      record,
      ["status", "approvalStatus", "reviewedByMemberId", "correctionNote"],
    );
    return mapRow(record);
  });
}
export async function decideApproval(
  context: OwnerManagementContext,
  recordId: string,
  decision: "approved" | "rejected" | "partially_approved",
  decisionNotes?: string,
  approvedAmount?: number,
): Promise<Row> {
  return withTenantContext(context, async (client) => {
    const approval = await rawRecord(client, context, "approvals", recordId);
    if (approval.status !== "pending")
      throw new BadRequestError("Only a pending approval can be decided");
    let requestedAmount = approval.requested_amount as number | string | null;
    if (approval.request_type === "purchase_request") {
      const recalculated = await purchaseRequestEstimatedAmount(
        client,
        context.organizationId,
        String(approval.entity_id),
      );
      if (recalculated != null) {
        requestedAmount = recalculated;
        await client.query(
          "UPDATE management_approval_requests SET requested_amount = $3 WHERE organization_id = $1 AND id = $2",
          [context.organizationId, recordId, recalculated],
        );
      }
    }
    const settledAmount =
      decision === "approved"
        ? requestedAmount
        : decision === "partially_approved"
          ? approvedAmount
          : null;
    await client.query(
      "UPDATE management_approval_requests SET status = $3, decided_by_member_id = $4, decided_at = now(), decision_notes = $5, approved_amount = $6 WHERE organization_id = $1 AND id = $2",
      [
        context.organizationId,
        recordId,
        decision,
        context.memberId,
        decisionNotes ?? null,
        settledAmount ?? null,
      ],
    );
    if (approval.request_type === "purchase_request") {
      await client.query(
        "UPDATE management_purchase_requests SET approval_status = $3, status = CASE WHEN $3 = 'approved' THEN 'approved' WHEN $3 = 'partially_approved' THEN 'partially_approved' ELSE 'rejected' END WHERE organization_id = $1 AND id = $2",
        [context.organizationId, approval.entity_id, decision],
      );
    }
    if (approval.request_type === "expense") {
      await client.query(
        "UPDATE management_expenses SET status = CASE WHEN $3 IN ('approved', 'partially_approved') THEN 'approved' ELSE 'rejected' END, approved_by_member_id = $4 WHERE organization_id = $1 AND id = $2",
        [
          context.organizationId,
          approval.entity_id,
          decision,
          context.memberId,
        ],
      );
    }
    if (approval.request_type === "maintenance_expense") {
      await client.query(
        "UPDATE management_maintenance_work_orders SET status = CASE WHEN $3 IN ('approved', 'partially_approved') THEN 'approved' ELSE 'reported' END WHERE organization_id = $1 AND id = $2",
        [context.organizationId, approval.entity_id, decision],
      );
    }
    if (approval.request_type === "phase_completion") {
      await client.query(
        "UPDATE management_project_phases SET status = CASE WHEN $3 IN ('approved', 'partially_approved') THEN 'completed' ELSE 'in_progress' END, completed_date = CASE WHEN $3 IN ('approved', 'partially_approved') THEN current_date ELSE NULL END WHERE organization_id = $1 AND id = $2",
        [context.organizationId, approval.entity_id, decision],
      );
    }

    const decided = await rawRecord(client, context, "approvals", recordId);
    await writeOwnerManagementAudit(
      client,
      context,
      decision === "rejected" ? "reject" : "approve",
      "approvals",
      decided,
      ["status", "decisionNotes", "approvedAmount"],
    );
    return mapRow(decided);
  });
}

async function materialSummaryForProject(
  client: PoolClient,
  organizationId: string,
  projectId: string,
): Promise<Row[]> {
  const result = await client.query<Row>(
    "SELECT pm.id, pm.code, pm.name, pm.unit, pm.inventory_item_id, pm.planned_quantity, pm.estimated_unit_cost, COALESCE(pr.requested_quantity, 0) AS requested_quantity, COALESCE(pr.approved_quantity, 0) AS approved_quantity, COALESCE(po.ordered_quantity, 0) AS purchased_quantity, COALESCE(re.received_quantity, 0) AS received_quantity, COALESCE(mu.used_quantity, 0) AS used_quantity, GREATEST(pm.planned_quantity - COALESCE(po.ordered_quantity, 0), 0) AS still_needed, GREATEST(COALESCE(re.received_quantity, 0) - COALESCE(mu.used_quantity, 0), 0) AS available_quantity, CASE WHEN pm.planned_quantity = 0 THEN 0 ELSE ROUND((COALESCE(po.ordered_quantity, 0) / pm.planned_quantity) * 100, 2) END AS material_completion_percent, pm.planned_quantity * COALESCE(pm.estimated_unit_cost, 0) AS planned_total, COALESCE(re.actual_total, 0) AS actual_total FROM management_project_materials pm LEFT JOIN LATERAL (SELECT SUM(requested_quantity) AS requested_quantity, SUM(approved_quantity) AS approved_quantity FROM management_purchase_request_lines WHERE organization_id = pm.organization_id AND project_material_id = pm.id) pr ON true LEFT JOIN LATERAL (SELECT SUM(pol.ordered_quantity) AS ordered_quantity FROM management_purchase_order_lines pol JOIN management_purchase_orders purchase_order ON purchase_order.organization_id = pol.organization_id AND purchase_order.id = pol.purchase_order_id WHERE pol.organization_id = pm.organization_id AND pol.project_material_id = pm.id AND purchase_order.status IN ('sent', 'partially_received', 'received')) po ON true LEFT JOIN LATERAL (SELECT SUM(receipt_line.received_quantity - receipt_line.damaged_quantity - receipt_line.rejected_quantity) AS received_quantity, SUM((receipt_line.received_quantity - receipt_line.damaged_quantity - receipt_line.rejected_quantity) * COALESCE(receipt_line.actual_unit_cost, 0)) AS actual_total FROM management_receipt_lines receipt_line JOIN management_receipts receipt ON receipt.organization_id = receipt_line.organization_id AND receipt.id = receipt_line.receipt_id WHERE receipt_line.organization_id = pm.organization_id AND receipt_line.project_material_id = pm.id AND receipt.status IN ('received', 'verified')) re ON true LEFT JOIN LATERAL (SELECT SUM(CASE WHEN movement_type IN ('used', 'damaged', 'adjustment_out') THEN quantity ELSE -quantity END) AS used_quantity FROM management_material_movements WHERE organization_id = pm.organization_id AND project_material_id = pm.id) mu ON true WHERE pm.organization_id = $1 AND pm.project_id = $2 ORDER BY pm.name",
    [organizationId, projectId],
  );
  return result.rows.map(mapRow);
}

async function operationalLinksForProject(
  client: PoolClient,
  organizationId: string,
  projectId: string,
): Promise<Row[]> {
  const links = await client.query<Row>(
    "SELECT * FROM management_project_operational_links WHERE organization_id = $1 AND project_id = $2 ORDER BY created_at DESC",
    [organizationId, projectId],
  );
  const targets: Record<string, string> = {
    "poultry:flocks": "poultry_flocks",
    "pigs:animals": "pig_animals",
    "pigs:groups": "pig_groups",
    "pigs:pens": "pig_pens",
    "agriculture:farms": "agriculture_farms",
    "agriculture:fields": "agriculture_fields",
    "agriculture:plots": "agriculture_plots",
    "agriculture:plantings": "agriculture_plantings",
  };
  return Promise.all(
    links.rows.map(async (link) => {
      const table =
        targets[`${String(link.module_code)}:${String(link.resource_code)}`];
      if (!table) return mapRow(link);
      const target = await client.query<Row>(
        "SELECT id, COALESCE(to_jsonb(t)->>'name', to_jsonb(t)->>'ear_tag', to_jsonb(t)->>'code', t.id::text) AS target_name, COALESCE(to_jsonb(t)->>'status', to_jsonb(t)->>'operational_status', CASE WHEN to_jsonb(t)->>'is_active' = 'true' THEN 'active' WHEN to_jsonb(t)->>'is_active' = 'false' THEN 'inactive' ELSE NULL END) AS target_status, to_jsonb(t)->>'code' AS target_code, to_jsonb(t)->>'site_id' AS target_site_id FROM " +
          table +
          " t WHERE t.organization_id = $1 AND t.id = $2",
        [organizationId, link.record_id],
      );
      return mapRow({ ...link, ...(target.rows[0] ?? {}) });
    }),
  );
}

function productionCostCategory(value: unknown): ProductionCostCategory {
  const category = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[éèêë]/g, "e")
    .replace(/[^a-z0-9]+/g, "_");
  if (
    /(animal|livestock|poulet|volaille|poultry|bird|bovin|porc)/.test(category)
  )
    return "animals";
  if (/(feed|aliment|nutrition|provende)/.test(category)) return "feed";
  if (/(health|vaccin|vaccine|treatment|traitement|medic|veter)/.test(category))
    return "health";
  if (
    /(labou?r|salary|wage|salaire|main.*oeuvre|main.*œuvre|personnel)/.test(
      category,
    )
  )
    return "labour";
  if (/(transport|delivery|livraison|freight)/.test(category))
    return "transport";
  if (
    /(utilit|electric|eau|water|fuel|carburant|energy|energie)/.test(category)
  )
    return "utilities";
  if (/(depreciation|amortissement)/.test(category))
    return "equipment_depreciation";
  return "other";
}

function addProductionCost(
  costs: ProductionCostBreakdown,
  category: ProductionCostCategory,
  value: unknown,
) {
  const amount = Number(value ?? 0);
  if (Number.isFinite(amount) && amount > 0) costs[category] += amount;
}

function distributeProductionCost(
  flocks: Array<{
    id: string;
    initialBirdCount: number;
    costs: ProductionCostBreakdown;
  }>,
  costs: ProductionCostBreakdown,
) {
  const totalBirds = flocks.reduce(
    (sum, flock) => sum + Math.max(1, flock.initialBirdCount),
    0,
  );
  if (!totalBirds) return;
  for (const flock of flocks) {
    const ratio = Math.max(1, flock.initialBirdCount) / totalBirds;
    for (const category of productionCostCategories)
      flock.costs[category] += costs[category] * ratio;
  }
}

/**
 * A poultry project does not copy sales or operating data into a second
 * ledger. Feed is costed only when it is issued to a linked flock. Stocked
 * supplies stay out of the production result until consumption; supplier
 * settlement is cash-only and is never a second production cost.
 */
async function productionProfitabilityFor(
  client: PoolClient,
  organizationId: string,
  projectId: string,
  currencyCode: string,
): Promise<Row | null> {
  const flocks = await client.query<Row>(
    "SELECT f.id, f.name, f.code, f.initial_bird_count, COALESCE(f.purchase_cost_total, 0) AS declared_purchase_cost FROM management_project_operational_links link JOIN poultry_flocks f ON f.organization_id = link.organization_id AND f.id = link.record_id WHERE link.organization_id = $1 AND link.project_id = $2 AND link.module_code = 'poultry' AND link.resource_code = 'flocks' ORDER BY f.arrival_date, f.name",
    [organizationId, projectId],
  );
  if (!flocks.rowCount) return null;

  const [
    eggProduction,
    sales,
    cash,
    feedIssues,
    directExpenses,
    serviceReceipts,
  ] = await Promise.all([
    client.query<Row>(
      "SELECT eggs.flock_id, COALESCE(SUM(eggs.total_eggs), 0) AS eggs_produced FROM poultry_egg_records eggs JOIN management_project_operational_links link ON link.organization_id = eggs.organization_id AND link.record_id = eggs.flock_id WHERE eggs.organization_id = $1 AND link.project_id = $2 AND link.module_code = 'poultry' AND link.resource_code = 'flocks' GROUP BY eggs.flock_id",
      [organizationId, projectId],
    ),
    client.query<Row>(
      "WITH linked_flocks AS (SELECT record_id FROM management_project_operational_links WHERE organization_id = $1 AND project_id = $2 AND module_code = 'poultry' AND resource_code = 'flocks') SELECT offer.source_id AS flock_id, COALESCE(SUM(CASE WHEN offer.source_type = 'egg_flock' THEN line.delivered_quantity ELSE 0 END), 0) AS eggs_sold, COALESCE(SUM(CASE WHEN offer.source_type = 'poultry_flock' THEN line.delivered_quantity ELSE 0 END), 0) AS birds_sold, COALESCE(SUM(line.delivered_quantity * line.unit_price * (1 - line.discount_percent / 100) * (1 + line.tax_percent / 100)), 0) AS revenue FROM sales_order_lines line JOIN sales_orders sale ON sale.organization_id = line.organization_id AND sale.id = line.order_id JOIN sales_operational_offers offer ON offer.organization_id = line.organization_id AND offer.id = line.operational_offer_id JOIN linked_flocks flock ON flock.record_id = offer.source_id WHERE line.organization_id = $1 AND offer.source_type IN ('egg_flock', 'poultry_flock') AND sale.currency = $3 AND sale.status IN ('partially_delivered', 'delivered', 'invoiced') GROUP BY offer.source_id",
      [organizationId, projectId, currencyCode],
    ),
    client.query<Row>(
      "WITH production_lines AS (SELECT line.order_id, offer.source_id AS flock_id, SUM(line.delivered_quantity * line.unit_price * (1 - line.discount_percent / 100) * (1 + line.tax_percent / 100)) AS revenue FROM sales_order_lines line JOIN sales_orders sale ON sale.organization_id = line.organization_id AND sale.id = line.order_id JOIN sales_operational_offers offer ON offer.organization_id = line.organization_id AND offer.id = line.operational_offer_id JOIN management_project_operational_links link ON link.organization_id = line.organization_id AND link.record_id = offer.source_id WHERE line.organization_id = $1 AND link.project_id = $2 AND link.module_code = 'poultry' AND link.resource_code = 'flocks' AND offer.source_type IN ('egg_flock', 'poultry_flock') AND sale.currency = $3 AND sale.status IN ('partially_delivered', 'delivered', 'invoiced') GROUP BY line.order_id, offer.source_id), order_totals AS (SELECT order_id, SUM(revenue) AS revenue FROM production_lines GROUP BY order_id), invoice_cash AS (SELECT invoice.order_id, SUM(allocation.amount) AS cash_received FROM payment_allocations allocation JOIN sales_invoices invoice ON invoice.organization_id = allocation.organization_id AND invoice.id = allocation.invoice_id WHERE allocation.organization_id = $1 AND invoice.currency = $3 AND invoice.status NOT IN ('draft', 'cancelled', 'written_off') GROUP BY invoice.order_id) SELECT production_lines.flock_id, COALESCE(SUM(COALESCE(invoice_cash.cash_received, 0) * (production_lines.revenue / NULLIF(order_totals.revenue, 0))), 0) AS cash_received FROM production_lines JOIN order_totals ON order_totals.order_id = production_lines.order_id LEFT JOIN invoice_cash ON invoice_cash.order_id = production_lines.order_id GROUP BY production_lines.flock_id",
      [organizationId, projectId, currencyCode],
    ),
    client.query<Row>(
      "SELECT feed.flock_id, COALESCE(SUM(ABS(stock.quantity_delta) * COALESCE(stock.unit_cost, item.standard_unit_cost, 0)), 0) AS feed_cost FROM management_inventory_stock_movements stock JOIN poultry_feed_records feed ON feed.organization_id = stock.organization_id AND feed.id = stock.reference_id JOIN management_project_operational_links link ON link.organization_id = feed.organization_id AND link.record_id = feed.flock_id LEFT JOIN management_inventory_items item ON item.organization_id = stock.organization_id AND item.id = stock.item_id WHERE stock.organization_id = $1 AND link.project_id = $2 AND link.module_code = 'poultry' AND link.resource_code = 'flocks' AND stock.reference_type = 'poultry_feed' AND stock.movement_type = 'issue' GROUP BY feed.flock_id",
      [organizationId, projectId],
    ),
    client.query<Row>(
      "SELECT category, COALESCE(SUM(amount), 0) AS amount FROM management_expenses WHERE organization_id = $1 AND project_id = $2 AND currency_code = $3 AND expense_type = 'direct_expense' AND receipt_id IS NULL AND status IN ('approved', 'paid') GROUP BY category",
      [organizationId, projectId, currencyCode],
    ),
    client.query<Row>(
      "SELECT purchase_line.item_kind, purchase_line.description, COALESCE(SUM((receipt_line.received_quantity - receipt_line.damaged_quantity - receipt_line.rejected_quantity) * COALESCE(receipt_line.actual_unit_cost, purchase_line.unit_cost, 0)), 0) AS amount FROM management_receipt_lines receipt_line JOIN management_receipts receipt ON receipt.organization_id = receipt_line.organization_id AND receipt.id = receipt_line.receipt_id JOIN management_purchase_orders purchase_order ON purchase_order.organization_id = receipt.organization_id AND purchase_order.id = receipt.purchase_order_id JOIN management_purchase_order_lines purchase_line ON purchase_line.organization_id = receipt_line.organization_id AND purchase_line.id = receipt_line.purchase_order_line_id WHERE receipt_line.organization_id = $1 AND receipt.project_id = $2 AND purchase_order.currency_code = $3 AND receipt.status IN ('received', 'verified') AND purchase_line.item_kind IN ('service', 'other') GROUP BY purchase_line.item_kind, purchase_line.description",
      [organizationId, projectId, currencyCode],
    ),
  ]);

  const eggsByFlock = new Map(
    eggProduction.rows.map((row) => [
      String(row.flock_id),
      Number(row.eggs_produced ?? 0),
    ]),
  );
  const salesByFlock = new Map(
    sales.rows.map((row) => [
      String(row.flock_id),
      {
        eggsSold: Number(row.eggs_sold ?? 0),
        birdsSold: Number(row.birds_sold ?? 0),
        revenue: Number(row.revenue ?? 0),
      },
    ]),
  );
  const cashByFlock = new Map(
    cash.rows.map((row) => [
      String(row.flock_id),
      Number(row.cash_received ?? 0),
    ]),
  );
  const feedCostByFlock = new Map(
    feedIssues.rows.map((row) => [
      String(row.flock_id),
      Number(row.feed_cost ?? 0),
    ]),
  );
  const flockRows = flocks.rows.map((flock) => ({
    id: String(flock.id),
    name: String(flock.name ?? ""),
    code: String(flock.code ?? ""),
    initialBirdCount: Number(flock.initial_bird_count ?? 0),
    declaredPurchaseCost: Number(flock.declared_purchase_cost ?? 0),
    costs: emptyProductionCostBreakdown(),
  }));

  const sharedCosts = emptyProductionCostBreakdown();
  for (const expense of directExpenses.rows)
    addProductionCost(
      sharedCosts,
      productionCostCategory(expense.category),
      expense.amount,
    );
  for (const receipt of serviceReceipts.rows)
    addProductionCost(
      sharedCosts,
      productionCostCategory(receipt.description),
      receipt.amount,
    );
  distributeProductionCost(flockRows, sharedCosts);

  // Animal acquisition is recorded on the flock itself. It is the unique
  // source for animal cost, while stock purchases wait for actual issue.
  for (const flock of flockRows) {
    flock.costs.animals += Math.max(0, flock.declaredPurchaseCost);
    flock.costs.feed += Math.max(0, feedCostByFlock.get(flock.id) ?? 0);
  }
  const costBreakdown = emptyProductionCostBreakdown();
  for (const flock of flockRows)
    for (const category of productionCostCategories)
      costBreakdown[category] += flock.costs[category];

  const calculated = calculateProductionProfitability({
    linkedFlockCount: flocks.rowCount,
    costBreakdown,
    revenue: sales.rows.reduce((sum, row) => sum + Number(row.revenue ?? 0), 0),
    cashReceived: cash.rows.reduce(
      (sum, row) => sum + Number(row.cash_received ?? 0),
      0,
    ),
    eggsProduced: eggProduction.rows.reduce(
      (sum, row) => sum + Number(row.eggs_produced ?? 0),
      0,
    ),
    eggsSold: sales.rows.reduce(
      (sum, row) => sum + Number(row.eggs_sold ?? 0),
      0,
    ),
    birdsSold: sales.rows.reduce(
      (sum, row) => sum + Number(row.birds_sold ?? 0),
      0,
    ),
    flocks: flockRows.map((flock) => {
      const sale = salesByFlock.get(flock.id);
      return {
        id: flock.id,
        name: flock.name,
        code: flock.code,
        costs: flock.costs,
        eggsProduced: eggsByFlock.get(flock.id) ?? 0,
        eggsSold: sale?.eggsSold ?? 0,
        birdsSold: sale?.birdsSold ?? 0,
        revenue: sale?.revenue ?? 0,
        cashReceived: cashByFlock.get(flock.id) ?? 0,
      };
    }),
  });

  return {
    ...calculated,
    currencyCode,
    declaredFlockPurchaseCost: flockRows.reduce(
      (sum, flock) => sum + flock.declaredPurchaseCost,
      0,
    ),
  };
}
async function projectSummaryFor(
  client: PoolClient,
  context: OwnerManagementContext,
  projectId: string,
): Promise<Row> {
  const project = await rawRecord(client, context, "projects", projectId);
  const benefitOwner = project.benefit_owner_member_id
    ? await client.query<{ full_name: string | null }>(
        "SELECT user_account.full_name FROM organization_members member JOIN users user_account ON user_account.id = member.user_id WHERE member.organization_id = $1 AND member.id = $2",
        [context.organizationId, project.benefit_owner_member_id],
      )
    : null;
  const [
    tasksResult,
    ordersResult,
    receiptsResult,
    expensesResult,
    progressResult,
  ] = await Promise.all([
    client.query<Row>(
      "SELECT t.id, t.phase_id, t.title, t.estimated_cost, t.budget_currency_code, ph.name AS phase_name FROM management_project_tasks t LEFT JOIN management_project_phases ph ON ph.organization_id = t.organization_id AND ph.id = t.phase_id WHERE t.organization_id = $1 AND t.project_id = $2 AND t.task_type = 'work' ORDER BY ph.phase_order NULLS LAST, t.created_at",
      [context.organizationId, projectId],
    ),
    client.query<Row>(
      "SELECT po.id, po.project_task_id, po.status, COALESCE(SUM(pol.ordered_quantity * pol.unit_cost + pol.tax_amount), 0) AS amount FROM management_purchase_orders po LEFT JOIN management_purchase_order_lines pol ON pol.organization_id = po.organization_id AND pol.purchase_order_id = po.id WHERE po.organization_id = $1 AND po.project_id = $2 GROUP BY po.id, po.project_task_id, po.status",
      [context.organizationId, projectId],
    ),
    client.query<Row>(
      "SELECT re.id, re.purchase_order_id, po.project_task_id, re.status, COALESCE(SUM((rl.received_quantity - rl.damaged_quantity - rl.rejected_quantity) * COALESCE(rl.actual_unit_cost, pol.unit_cost, 0)), 0) AS amount FROM management_receipts re JOIN management_purchase_orders po ON po.organization_id = re.organization_id AND po.id = re.purchase_order_id LEFT JOIN management_receipt_lines rl ON rl.organization_id = re.organization_id AND rl.receipt_id = re.id LEFT JOIN management_purchase_order_lines pol ON pol.organization_id = rl.organization_id AND pol.id = rl.purchase_order_line_id WHERE re.organization_id = $1 AND re.project_id = $2 GROUP BY re.id, re.purchase_order_id, po.project_task_id, re.status",
      [context.organizationId, projectId],
    ),
    client.query<Row>(
      "SELECT id, project_task_id, receipt_id, reimburses_expense_id, expense_type, status, amount FROM management_expenses WHERE organization_id = $1 AND project_id = $2",
      [context.organizationId, projectId],
    ),
    client.query<Row>(
      "SELECT COALESCE(AVG(progress_percent) FILTER (WHERE task_type = 'work'), AVG(progress_percent), 0) AS progress_percent, COUNT(*) FILTER (WHERE task_type = 'work' AND status NOT IN ('completed', 'cancelled')) AS open_tasks, COUNT(*) FILTER (WHERE task_type = 'work' AND due_date < current_date AND status NOT IN ('completed', 'cancelled')) AS overdue_tasks FROM management_project_tasks WHERE organization_id = $1 AND project_id = $2",
      [context.organizationId, projectId],
    ),
  ]);
  const calculation = calculateProjectBudget({
    planned: Number(project.estimated_total_budget ?? 0),
    tasks: tasksResult.rows.map((task) => ({
      id: String(task.id),
      phaseId: task.phase_id == null ? null : String(task.phase_id),
      phaseName: task.phase_name == null ? null : String(task.phase_name),
      title: String(task.title),
      planned: Number(task.estimated_cost ?? 0),
      currencyCode: String(
        task.budget_currency_code ?? project.currency_code ?? "CDF",
      ),
    })),
    orders: ordersResult.rows.map((order) => ({
      id: String(order.id),
      taskId:
        order.project_task_id == null ? null : String(order.project_task_id),
      status: String(order.status),
      amount: Number(order.amount ?? 0),
    })),
    receipts: receiptsResult.rows.map((receipt) => ({
      id: String(receipt.id),
      orderId: String(receipt.purchase_order_id),
      taskId:
        receipt.project_task_id == null
          ? null
          : String(receipt.project_task_id),
      status: String(receipt.status),
      amount: Number(receipt.amount ?? 0),
    })),
    expenses: expensesResult.rows.map((expense) => ({
      id: String(expense.id),
      taskId:
        expense.project_task_id == null
          ? null
          : String(expense.project_task_id),
      receiptId: expense.receipt_id == null ? null : String(expense.receipt_id),
      reimbursesExpenseId:
        expense.reimburses_expense_id == null
          ? null
          : String(expense.reimburses_expense_id),
      expenseType:
        expense.expense_type == null ? null : String(expense.expense_type),
      status: String(expense.status),
      amount: Number(expense.amount ?? 0),
    })),
  });
  const phaseCostsById = new Map<
    string,
    {
      phaseId: string;
      phaseName: string | null | undefined;
      plannedBudget: number;
      committedAmount: number;
      actualSpent: number;
      availableAmount: number;
    }
  >();
  for (const task of calculation.tasks) {
    if (!task.phaseId) continue;
    const current = phaseCostsById.get(task.phaseId) ?? {
      phaseId: task.phaseId,
      phaseName: task.phaseName,
      plannedBudget: 0,
      committedAmount: 0,
      actualSpent: 0,
      availableAmount: 0,
    };
    current.plannedBudget += task.planned;
    current.committedAmount += task.committed;
    current.actualSpent += task.spent;
    current.availableAmount += task.available;
    phaseCostsById.set(task.phaseId, current);
  }
  const phaseCosts = [...phaseCostsById.values()];
  const materials = await materialSummaryForProject(
    client,
    context.organizationId,
    projectId,
  );
  const operationalLinks = await operationalLinksForProject(
    client,
    context.organizationId,
    projectId,
  );
  const productionProfitability = await productionProfitabilityFor(
    client,
    context.organizationId,
    projectId,
    String(project.currency_code ?? "CDF"),
  );
  const nextActions = await client.query<Row>(
    "SELECT task.id, task.title, task.status, task.priority, task.due_date, task.blocked_reason, task.assigned_member_id, assigned_user.full_name AS assigned_member_name FROM management_project_tasks task LEFT JOIN organization_members assigned_member ON assigned_member.organization_id = task.organization_id AND assigned_member.id = task.assigned_member_id LEFT JOIN users assigned_user ON assigned_user.id = assigned_member.user_id WHERE task.organization_id = $1 AND task.project_id = $2 AND task.task_type = 'work' AND task.status NOT IN ('completed', 'cancelled') ORDER BY CASE WHEN task.status = 'blocked' THEN 0 ELSE 1 END, task.due_date NULLS LAST, task.priority DESC LIMIT 10",
    [context.organizationId, projectId],
  );
  const progress = progressResult.rows[0] ?? {};
  return {
    ...mapRow(project),
    benefitOwnerName: benefitOwner?.rows[0]?.full_name ?? null,
    calculatedProgressPercent: progress.progress_percent ?? 0,
    openTasks: progress.open_tasks ?? 0,
    overdueTasks: progress.overdue_tasks ?? 0,
    budget: {
      planned: calculation.planned,
      allocated: calculation.allocated,
      unallocated: calculation.unallocated,
      overallocated: Math.max(-calculation.unallocated, 0),
      spent: calculation.spent,
      committed: calculation.committed,
      available: calculation.available,
      utilizationPercent: calculation.utilizationPercent,
      unassignedCommitted: calculation.unassignedCommitted,
      unassignedSpent: calculation.unassignedSpent,
    },
    taskBudgets: calculation.tasks,
    phaseCosts,
    materials,
    operationalLinks,
    productionProfitability,
    nextActions: nextActions.rows.map(mapRow),
  };
}
export async function projectSummary(
  context: OwnerManagementContext,
  projectId: string,
): Promise<Row> {
  return withTenantContext(context, (client) =>
    projectSummaryFor(client, context, projectId),
  );
}

type CashForecastEvent = {
  eventDate: string;
  direction: "in" | "out";
  kind: string;
  category: string;
  amount: number;
};

const forecastDate = (days: number) => {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

function forecastExpenseGroup(
  value: unknown,
):
  | "salaries"
  | "feed"
  | "health"
  | "fuel"
  | "transport"
  | "utilities"
  | "other" {
  const category = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[éèêë]/g, "e");
  if (
    /(labou?r|salary|wage|salaire|main.*oeuvre|main.*œuvre|personnel)/.test(
      category,
    )
  )
    return "salaries";
  if (/(feed|aliment|nutrition|provende)/.test(category)) return "feed";
  if (/(health|vaccin|vaccine|treatment|traitement|medic|veter)/.test(category))
    return "health";
  if (/(fuel|carburant|diesel|essence)/.test(category)) return "fuel";
  if (/(transport|delivery|livraison|freight)/.test(category))
    return "transport";
  if (/(utilit|electric|eau|water|energy|energie)/.test(category))
    return "utilities";
  return "other";
}

export async function projectDecisionSimulation(
  context: OwnerManagementContext,
  projectId: string,
  input: ProjectDecisionSimulationInput,
): Promise<Row> {
  if (!context.isOwner)
    throw new ForbiddenError(
      "Only the workspace owner can simulate a project decision",
    );
  return withTenantContext(context, async (client) => {
    const summary = await projectSummaryFor(client, context, projectId);
    const profitability = (summary.productionProfitability ?? {}) as Row;
    const costs = (profitability.costBreakdown ?? {}) as Row;
    const started = String(
      summary.operationalStartDate ??
        summary.startDate ??
        summary.createdAt ??
        "",
    );
    const startedAt = Date.parse(started);
    const observedDays = Number.isFinite(startedAt)
      ? Math.max(1, Math.floor((Date.now() - startedAt) / 86_400_000) + 1)
      : 30;
    return calculateProjectDecisionSimulation(
      {
        currencyCode: String(summary.currencyCode ?? "CDF"),
        plannedBudget: Number(((summary.budget ?? {}) as Row).planned ?? 0),
        operationalCost: Number(profitability.operationalCost ?? 0),
        feedCost: Number(costs.feed ?? 0),
        revenue: Number(profitability.revenue ?? 0),
        cashReceived: Number(profitability.cashReceived ?? 0),
        eggsSold: Number(profitability.eggsSold ?? 0),
        revenuePerEggSold: Number(profitability.revenuePerEggSold ?? 0),
        observedDays,
      },
      input,
    );
  });
}

function forecastWindow(events: CashForecastEvent[], days: number): Row {
  const cutoff = forecastDate(days);
  const value = (amount: unknown) => {
    const parsed = Number(amount ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const operating = {
    salaries: 0,
    feed: 0,
    health: 0,
    fuel: 0,
    transport: 0,
    utilities: 0,
    other: 0,
  };
  let expectedCustomerCash = 0;
  let expectedSalesRevenue = 0;
  let supplierPayments = 0;

  for (const event of events) {
    if (event.eventDate > cutoff) continue;
    if (event.kind === "expected_sale") {
      expectedSalesRevenue += value(event.amount);
      continue;
    }
    if (event.kind === "customer_payment") {
      expectedCustomerCash += value(event.amount);
      continue;
    }
    if (event.kind === "supplier_payment") {
      supplierPayments += value(event.amount);
      continue;
    }
    if (event.direction === "out")
      operating[forecastExpenseGroup(event.category)] += value(event.amount);
  }

  const operatingOutflows = Object.values(operating).reduce(
    (sum, amount) => sum + amount,
    0,
  );
  const expectedOutflows = supplierPayments + operatingOutflows;
  const netCashFlow = expectedCustomerCash - expectedOutflows;
  return {
    days,
    expectedSalesRevenue,
    expectedCustomerCash,
    supplierPayments,
    operating,
    operatingOutflows,
    expectedOutflows,
    netCashFlow,
    fundingGap: Math.max(expectedOutflows - expectedCustomerCash, 0),
    atRisk: expectedOutflows > expectedCustomerCash + 0.0001,
  };
}

/**
 * Cash forecasting deliberately differs from the project result. It uses due
 * customer invoices for cash in, then unpaid supplier obligations and planned
 * direct costs for cash out. A confirmed delivery remains a revenue event,
 * even when its customer has not paid yet.
 */
async function projectCashForecastFor(
  client: PoolClient,
  organizationId: string,
  projectId: string,
  currencyCode: string,
): Promise<Row> {
  const events = await client.query<Row>(
    `WITH receipt_totals AS (
       SELECT receipt.id, receipt.purchase_order_id, receipt.received_date,
              COALESCE(SUM((line.received_quantity - line.damaged_quantity - line.rejected_quantity) * COALESCE(line.actual_unit_cost, purchase_line.unit_cost, 0)), 0) AS amount
         FROM management_receipts receipt
         JOIN management_purchase_orders purchase_order ON purchase_order.organization_id = receipt.organization_id AND purchase_order.id = receipt.purchase_order_id
         LEFT JOIN management_receipt_lines line ON line.organization_id = receipt.organization_id AND line.receipt_id = receipt.id
         LEFT JOIN management_purchase_order_lines purchase_line ON purchase_line.organization_id = line.organization_id AND purchase_line.id = line.purchase_order_line_id
        WHERE receipt.organization_id = $1 AND receipt.project_id = $2
          AND purchase_order.currency_code = $3 AND receipt.status IN ('received', 'verified')
        GROUP BY receipt.id, receipt.purchase_order_id, receipt.received_date
     ), receipt_payments AS (
       SELECT expense.receipt_id,
              COALESCE(SUM(CASE WHEN expense.expense_type = 'receipt_payment' THEN expense.amount WHEN expense.expense_type = 'reimbursement' THEN -expense.amount ELSE 0 END), 0) AS paid
         FROM management_expenses expense
        WHERE expense.organization_id = $1 AND expense.status IN ('approved', 'paid')
        GROUP BY expense.receipt_id
     ), project_order_revenue AS (
       SELECT sale_line.order_id,
              COALESCE(SUM(sale_line.line_total), 0) AS project_total
         FROM sales_order_lines sale_line
         JOIN sales_operational_offers offer ON offer.organization_id = sale_line.organization_id AND offer.id = sale_line.operational_offer_id
         JOIN management_project_operational_links link ON link.organization_id = offer.organization_id AND link.record_id = offer.source_id
        WHERE sale_line.organization_id = $1 AND link.project_id = $2
        GROUP BY sale_line.order_id
     ), order_revenue AS (
       SELECT sale_line.order_id, COALESCE(SUM(sale_line.line_total), 0) AS total
         FROM sales_order_lines sale_line
        WHERE sale_line.organization_id = $1
        GROUP BY sale_line.order_id
     ), purchase_remaining AS (
       SELECT purchase_order.id, COALESCE(purchase_order.expected_delivery_date, purchase_order.order_date) AS event_date,
              COALESCE(SUM(GREATEST(purchase_line.ordered_quantity - COALESCE(received.accepted_quantity, 0), 0) * purchase_line.unit_cost + CASE WHEN purchase_line.ordered_quantity = 0 THEN 0 ELSE purchase_line.tax_amount * GREATEST(purchase_line.ordered_quantity - COALESCE(received.accepted_quantity, 0), 0) / purchase_line.ordered_quantity END), 0) AS amount
         FROM management_purchase_orders purchase_order
         JOIN management_purchase_order_lines purchase_line ON purchase_line.organization_id = purchase_order.organization_id AND purchase_line.purchase_order_id = purchase_order.id
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(received_line.received_quantity - received_line.damaged_quantity - received_line.rejected_quantity), 0) AS accepted_quantity
             FROM management_receipt_lines received_line
             JOIN management_receipts received_receipt ON received_receipt.organization_id = received_line.organization_id AND received_receipt.id = received_line.receipt_id
            WHERE received_line.organization_id = purchase_line.organization_id
              AND received_line.purchase_order_line_id = purchase_line.id
              AND received_receipt.status IN ('received', 'verified')
         ) received ON true
        WHERE purchase_order.organization_id = $1 AND purchase_order.project_id = $2
          AND purchase_order.currency_code = $3
          AND purchase_order.status IN ('sent', 'partially_received')
          AND NOT EXISTS (
            SELECT 1 FROM finance_payables payable
             WHERE payable.organization_id = purchase_order.organization_id
               AND payable.purchase_order_id = purchase_order.id
               AND payable.status IN ('open', 'partially_paid', 'overdue', 'disputed')
          )
        GROUP BY purchase_order.id, purchase_order.expected_delivery_date, purchase_order.order_date
     )
     SELECT receipt_totals.received_date::text AS event_date, 'out'::text AS direction,
            'supplier_payment'::text AS kind, 'supplier'::text AS category,
            GREATEST(receipt_totals.amount - COALESCE(receipt_payments.paid, 0), 0) AS amount
       FROM receipt_totals
       LEFT JOIN receipt_payments ON receipt_payments.receipt_id = receipt_totals.id
      WHERE NOT EXISTS (
        SELECT 1 FROM finance_payables payable
         WHERE payable.organization_id = $1 AND payable.purchase_order_id = receipt_totals.purchase_order_id
           AND payable.status IN ('open', 'partially_paid', 'overdue', 'disputed')
      )
     UNION ALL
     SELECT payable.due_date::text, 'out'::text, 'supplier_payment'::text, 'supplier'::text,
            GREATEST(payable.total - payable.paid_total, 0)
       FROM finance_payables payable
       JOIN management_purchase_orders purchase_order ON purchase_order.organization_id = payable.organization_id AND purchase_order.id = payable.purchase_order_id
      WHERE payable.organization_id = $1 AND purchase_order.project_id = $2 AND payable.currency = $3
        AND payable.status IN ('open', 'partially_paid', 'overdue', 'disputed')
     UNION ALL
     SELECT purchase_remaining.event_date::text, 'out'::text, 'supplier_payment'::text, 'supplier'::text, purchase_remaining.amount
       FROM purchase_remaining
     UNION ALL
     SELECT expense.expense_date::text, 'out'::text, 'planned_direct_expense'::text, expense.category, expense.amount
       FROM management_expenses expense
      WHERE expense.organization_id = $1 AND expense.project_id = $2 AND expense.currency_code = $3
        AND expense.expense_type = 'direct_expense' AND expense.status IN ('draft', 'submitted')
     UNION ALL
     SELECT invoice.due_date::text, 'in'::text, 'customer_payment'::text, 'customer'::text,
            GREATEST(invoice.total - invoice.paid_total, 0) * project_order_revenue.project_total / NULLIF(order_revenue.total, 0)
       FROM sales_invoices invoice
       JOIN project_order_revenue ON project_order_revenue.order_id = invoice.order_id
       JOIN order_revenue ON order_revenue.order_id = invoice.order_id
      WHERE invoice.organization_id = $1 AND invoice.currency = $3
        AND invoice.status IN ('issued', 'partially_paid', 'overdue')
     UNION ALL
     SELECT COALESCE(sale.required_date, sale.order_date)::text, 'in'::text, 'expected_sale'::text, 'sales'::text,
            COALESCE(SUM((sale_line.quantity - sale_line.delivered_quantity) * sale_line.unit_price * (1 - sale_line.discount_percent / 100) * (1 + sale_line.tax_percent / 100)), 0)
       FROM sales_orders sale
       JOIN sales_order_lines sale_line ON sale_line.organization_id = sale.organization_id AND sale_line.order_id = sale.id
       JOIN sales_operational_offers offer ON offer.organization_id = sale_line.organization_id AND offer.id = sale_line.operational_offer_id
       JOIN management_project_operational_links link ON link.organization_id = offer.organization_id AND link.record_id = offer.source_id
      WHERE sale.organization_id = $1 AND sale.currency = $3 AND link.project_id = $2
        AND sale.status IN ('confirmed', 'partially_delivered')
        AND NOT EXISTS (
          SELECT 1 FROM sales_invoices invoice
           WHERE invoice.organization_id = sale.organization_id AND invoice.order_id = sale.id
             AND invoice.status NOT IN ('draft', 'cancelled', 'written_off')
        )
      GROUP BY sale.required_date, sale.order_date`,
    [organizationId, projectId, currencyCode],
  );
  const normalized = events.rows
    .map((event) => ({
      eventDate: String(event.event_date ?? "").slice(0, 10),
      direction: (String(event.direction) === "in" ? "in" : "out") as
        "in" | "out",
      kind: String(event.kind ?? ""),
      category: String(event.category ?? ""),
      amount: Math.max(0, Number(event.amount ?? 0)),
    }))
    .filter(
      (event) =>
        event.eventDate && Number.isFinite(event.amount) && event.amount > 0,
    )
    .filter((event) => event.eventDate <= forecastDate(90));
  const windows = [30, 60, 90].map((days) => forecastWindow(normalized, days));
  return {
    windows,
    alert: windows.some((window) => Boolean(window.atRisk)),
  };
}

/**
 * Cross-project portfolio analytics. The physical stock stays single-instance
 * for the organisation; this view only aggregates each visible project's
 * already de-duplicated financial summary. Amounts are never converted or
 * mixed across currencies.
 */
export async function projectAnalytics(
  context: OwnerManagementContext,
  filters: ProjectAnalyticsQuery = {},
): Promise<Row> {
  const allVisibleProjects = await listOwnerManagementRecords(
    context,
    "projects",
    {
      limit: 200,
      offset: 0,
    },
  );
  const intersectsPeriod = (project: Row) => {
    const start = String(project.startDate ?? project.createdAt ?? "").slice(
      0,
      10,
    );
    const end = String(
      project.revisedCompletionDate ??
        project.targetCompletionDate ??
        project.completedDate ??
        start,
    ).slice(0, 10);
    if (filters.fromDate && end && end < filters.fromDate) return false;
    if (filters.toDate && start && start > filters.toDate) return false;
    return true;
  };
  const visibleProjects = allVisibleProjects.filter(
    (project) =>
      (!filters.provinceId ||
        String(project.provinceId) === filters.provinceId) &&
      (!filters.siteId || String(project.siteId) === filters.siteId) &&
      (!filters.projectType ||
        String(project.projectType) === filters.projectType) &&
      (!filters.managerId ||
        String(project.responsibleMemberId) === filters.managerId) &&
      (!filters.status || String(project.status) === filters.status) &&
      intersectsPeriod(project),
  );
  return withTenantContext(context, async (client) => {
    const ids = visibleProjects.map((project) => String(project.id));
    if (!ids.length)
      return {
        generatedAt: new Date().toISOString(),
        filters,
        projects: [],
        totalsByCurrency: [],
      };
    const [metadata, budgetBaselines] = await Promise.all([
      client.query<Row>(
        "SELECT project.id, project.province_id, province.name AS province_name, project.site_id, site.name AS site_name, project.responsible_member_id, COALESCE(member_user.full_name, direct_user.full_name) AS manager_name FROM management_projects project LEFT JOIN provinces province ON province.organization_id = project.organization_id AND province.id = project.province_id LEFT JOIN sites site ON site.organization_id = project.organization_id AND site.id = project.site_id LEFT JOIN organization_members member ON member.organization_id = project.organization_id AND member.id = project.responsible_member_id LEFT JOIN users member_user ON member_user.id = member.user_id LEFT JOIN users direct_user ON direct_user.id = project.created_by_user_id WHERE project.organization_id = $1 AND project.id = ANY($2::uuid[])",
        [context.organizationId, ids],
      ),
      client.query<Row>(
        "SELECT DISTINCT ON (a.changes ->> 'projectId') a.changes ->> 'projectId' AS project_id, NULLIF(a.changes -> 'budgetChange' ->> 'after', '')::numeric AS initial_budget FROM audit_log a WHERE a.organization_id = $1 AND a.changes ? 'budgetChange' AND a.changes -> 'budgetChange' ->> 'scope' = 'project' AND a.changes ->> 'projectId' = ANY($2::text[]) ORDER BY a.changes ->> 'projectId', a.occurred_at ASC, a.id ASC",
        [context.organizationId, ids],
      ),
    ]);
    const metadataById = new Map(
      metadata.rows.map((row) => [String(row.id), row]),
    );
    const initialBudgetById = new Map(
      budgetBaselines.rows.map((row) => [
        String(row.project_id),
        Number(row.initial_budget ?? 0),
      ]),
    );
    const summaries: Array<{ project: Row; cashForecast: Row }> = [];
    // One client/transaction is deliberately processed sequentially. It keeps
    // tenant context stable and avoids concurrent statements on the same pg client.
    for (const project of visibleProjects) {
      const summary = await projectSummaryFor(
        client,
        context,
        String(project.id),
      );
      const cashForecast = await projectCashForecastFor(
        client,
        context.organizationId,
        String(project.id),
        String(summary.currencyCode ?? "CDF"),
      );
      summaries.push({ project: summary, cashForecast });
    }

    const totalByCurrency = new Map<string, Row>();
    const projects = summaries.map(({ project, cashForecast }) => {
      const budget = (project.budget ?? {}) as Row;
      const profitability = project.productionProfitability as
        Row | null | undefined;
      const currencyCode = String(project.currencyCode ?? "CDF");
      const metadata = metadataById.get(String(project.id));
      const number = (value: unknown) => {
        const parsed = Number(value ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const planned = number(budget.planned);
      const committed = number(budget.committed);
      const spent = number(budget.spent);
      const available = number(budget.available);
      const revenue = profitability ? number(profitability.revenue) : 0;
      const operationalResult = profitability
        ? number(profitability.profit)
        : null;
      const cashReceived = profitability
        ? number(profitability.cashReceived)
        : 0;
      const entry: Row = {
        id: project.id,
        name: project.name,
        code: project.code,
        projectType: project.projectType,
        status: project.status,
        priority: project.priority,
        provinceId: metadata?.province_id ?? project.provinceId ?? null,
        provinceName: metadata?.province_name ?? null,
        siteId: metadata?.site_id ?? project.siteId ?? null,
        siteName: metadata?.site_name ?? null,
        responsibleMemberId:
          metadata?.responsible_member_id ??
          project.responsibleMemberId ??
          null,
        managerName: metadata?.manager_name ?? null,
        startDate: project.startDate ?? null,
        targetCompletionDate: project.targetCompletionDate ?? null,
        revisedCompletionDate: project.revisedCompletionDate ?? null,
        currencyCode,
        initialBudget: initialBudgetById.get(String(project.id)) ?? planned,
        revisedBudget: planned,
        actualBudget: spent,
        planned,
        allocated: number(budget.allocated),
        unallocated: number(budget.unallocated),
        committed,
        spent,
        available,
        utilizationPercent: number(budget.utilizationPercent),
        openTasks: number(project.openTasks),
        overdueTasks: number(project.overdueTasks),
        linkedOperations: Array.isArray(project.operationalLinks)
          ? project.operationalLinks.length
          : 0,
        isProductionProject: Boolean(profitability),
        revenue,
        operationalResult,
        cashReceived,
        outstandingRevenue: profitability
          ? number(profitability.outstandingRevenue)
          : 0,
        cashForecast,
      };
      const current = totalByCurrency.get(currencyCode) ?? {
        currencyCode,
        projectCount: 0,
        productionProjectCount: 0,
        planned: 0,
        allocated: 0,
        unallocated: 0,
        committed: 0,
        spent: 0,
        available: 0,
        revenue: 0,
        operationalResult: 0,
        cashReceived: 0,
        openTasks: 0,
        overdueTasks: 0,
      };
      current.projectCount = number(current.projectCount) + 1;
      current.productionProjectCount =
        number(current.productionProjectCount) + (profitability ? 1 : 0);
      for (const field of [
        "planned",
        "allocated",
        "unallocated",
        "committed",
        "spent",
        "available",
        "revenue",
        "cashReceived",
      ])
        current[field] = number(current[field]) + number(entry[field]);
      if (operationalResult !== null)
        current.operationalResult =
          number(current.operationalResult) + operationalResult;
      current.openTasks = number(current.openTasks) + number(entry.openTasks);
      current.overdueTasks =
        number(current.overdueTasks) + number(entry.overdueTasks);
      totalByCurrency.set(currencyCode, current);
      return entry;
    });

    return {
      generatedAt: new Date().toISOString(),
      projects,
      totalsByCurrency: [...totalByCurrency.values()].sort((a, b) =>
        String(a.currencyCode).localeCompare(String(b.currencyCode)),
      ),
    };
  });
}
/** A project-only timeline assembled from the existing transaction records. */
/**
 * Employees eligible for work in this project. The result is scoped to the
 * project first, never to the manager's own province list, so a responsible
 * Project Manager can allocate site work without gaining company-wide HR access.
 */
export async function listProjectTaskAssignees(
  context: OwnerManagementContext,
  projectId: string,
): Promise<Row[]> {
  return withTenantContext(context, async (client) => {
    const project = await rawRecord(client, context, "projects", projectId);
    const result = await client.query<Row>(
      "SELECT employee.member_id AS id, employee.full_name AS name, employee.employee_number, employee.job_title, employee.site_id, site.name AS site_name, province.name AS province_name FROM employees employee JOIN organization_members member ON member.organization_id = employee.organization_id AND member.id = employee.member_id LEFT JOIN sites site ON site.organization_id = employee.organization_id AND site.id = employee.site_id LEFT JOIN provinces province ON province.organization_id = employee.organization_id AND province.id = employee.province_id WHERE employee.organization_id = $1 AND employee.member_id IS NOT NULL AND employee.employment_status = 'active' AND member.status = 'active' AND (employee.site_id = $2::uuid OR employee.province_id = $3::uuid) ORDER BY employee.full_name, employee.employee_number",
      [
        context.organizationId,
        project.site_id ?? null,
        project.province_id ?? null,
      ],
    );
    return result.rows.map(mapRow);
  });
}
export async function projectActivity(
  context: OwnerManagementContext,
  projectId: string,
): Promise<Row[]> {
  return withTenantContext(context, async (client) => {
    await rawRecord(client, context, "projects", projectId);
    const result = await client.query<Row>(
      `SELECT events.*, COALESCE(direct_user.full_name, member_user.full_name, 'System') AS actor_name
         FROM (
           SELECT 'created'::text AS event_type, 'project'::text AS entity_type, p.id AS entity_id, p.name AS title, p.status, NULL::numeric AS amount, p.currency_code, p.created_at AS occurred_at, NULL::uuid AS member_id, p.created_by_user_id AS user_id
             FROM management_projects p WHERE p.organization_id = $1 AND p.id = $2

           UNION ALL
           SELECT CASE WHEN ph.completed_date IS NOT NULL THEN 'completed' ELSE 'created' END, 'phase', ph.id, ph.name, ph.status, ph.planned_budget, pr.currency_code, COALESCE(ph.completed_date::timestamptz, ph.created_at), ph.responsible_member_id, NULL::uuid
             FROM management_project_phases ph JOIN management_projects pr ON pr.organization_id = ph.organization_id AND pr.id = ph.project_id WHERE ph.organization_id = $1 AND ph.project_id = $2
           UNION ALL
           SELECT CASE WHEN t.completed_date IS NOT NULL THEN 'completed' ELSE 'created' END, 'task'::text, t.id, t.title, t.status, t.estimated_cost, pr.currency_code, COALESCE(t.completed_date::timestamptz, t.created_at), t.assigned_member_id, t.created_by_user_id
             FROM management_project_tasks t JOIN management_projects pr ON pr.organization_id = t.organization_id AND pr.id = t.project_id WHERE t.organization_id = $1 AND t.project_id = $2
           UNION ALL
           SELECT CASE
                    WHEN r.decision <> 'pending' THEN 'risk_decided'
                    WHEN r.status = 'triggered' THEN 'risk_triggered'
                    ELSE 'risk_logged'
                  END,
                  'risk'::text,
                  r.id,
                  r.code || ' · ' || r.title,
                  r.status,
                  NULL::numeric,
                  pr.currency_code,
                  COALESCE(r.decided_at, r.triggered_at, r.created_at),
                  COALESCE(r.decided_by_member_id, r.owner_member_id, r.created_by_member_id),
                  NULL::uuid
             FROM management_project_risks r
             JOIN management_projects pr ON pr.organization_id = r.organization_id AND pr.id = r.project_id
            WHERE r.organization_id = $1 AND r.project_id = $2
           UNION ALL
           SELECT 'budget_line', 'budget', b.id, b.category, NULL::text, b.planned_amount, b.currency_code, b.created_at, NULL::uuid, NULL::uuid
             FROM management_project_budget_lines b WHERE b.organization_id = $1 AND b.project_id = $2
           UNION ALL
           SELECT 'procurement_requested', 'purchase_request', r.id, r.request_number, r.status, NULL::numeric, r.currency_code, r.created_at, r.requested_by_member_id, NULL::uuid
             FROM management_purchase_requests r WHERE r.organization_id = $1 AND r.project_id = $2
           UNION ALL
           SELECT 'procurement_ordered', 'purchase_order', o.id, o.order_number, o.status, NULL::numeric, o.currency_code, o.created_at, o.ordered_by_member_id, NULL::uuid
             FROM management_purchase_orders o WHERE o.organization_id = $1 AND o.project_id = $2
           UNION ALL
           SELECT 'received', 'receipt', r.id, r.receipt_number, r.status, NULL::numeric, p.currency_code, r.created_at, r.received_by_member_id, NULL::uuid
             FROM management_receipts r JOIN management_projects p ON p.organization_id = r.organization_id AND p.id = r.project_id WHERE r.organization_id = $1 AND r.project_id = $2
           UNION ALL
           SELECT 'expense_recorded', 'expense', e.id, e.expense_number || ' · ' || e.category, e.status, e.amount, e.currency_code, e.created_at, NULL::uuid, e.created_by_user_id
             FROM management_expenses e WHERE e.organization_id = $1 AND e.project_id = $2
           UNION ALL
           SELECT 'asset_registered', 'asset', a.id, a.name, a.status, a.purchase_price, a.currency_code, a.created_at, a.assigned_member_id, NULL::uuid
             FROM management_assets a WHERE a.organization_id = $1 AND a.project_id = $2
           UNION ALL
           SELECT 'document_attached', 'document', d.id, d.title, d.document_type, NULL::numeric, p.currency_code, d.created_at, d.uploaded_by_member_id, NULL::uuid
             FROM management_document_links d JOIN management_projects p ON p.organization_id = d.organization_id AND p.id = d.project_id WHERE d.organization_id = $1 AND d.project_id = $2

           UNION ALL
           SELECT CASE WHEN a.decided_at IS NULL THEN 'approval_requested' ELSE 'approval_decided' END, 'approval', a.id, a.approval_number || ' · ' || a.request_type, a.status, a.requested_amount, a.currency_code, COALESCE(a.decided_at, a.requested_at), COALESCE(a.decided_by_member_id, a.requested_by_member_id), NULL::uuid
             FROM management_approval_requests a WHERE a.organization_id = $1 AND a.project_id = $2
         ) events
         LEFT JOIN organization_members member ON member.organization_id = $1 AND member.id = events.member_id
         LEFT JOIN users member_user ON member_user.id = member.user_id
         LEFT JOIN users direct_user ON direct_user.id = events.user_id
        ORDER BY events.occurred_at DESC
        LIMIT 300`,
      [context.organizationId, projectId],
    );
    return result.rows.map(mapRow);
  });
}

/**
 * Budget changes are loaded separately from the project activity feed. The
 * audit log can contain old entries, and a legacy payload must never prevent
 * the ordinary project workspace from loading.
 */
export async function projectBudgetHistory(
  context: OwnerManagementContext,
  projectId: string,
): Promise<Row[]> {
  return withTenantContext(context, async (client) => {
    await rawRecord(client, context, "projects", projectId);
    const result = await client.query<Row>(
      `SELECT 'budget_adjusted'::text AS event_type,
              'budget_change'::text AS entity_type,
              a.entity_id,
              COALESCE(a.entity_label, 'Budget adjustment') AS title,
              (a.changes -> 'budgetChange')::text AS status,
              NULLIF(a.changes -> 'budgetChange' ->> 'after', '')::numeric AS amount,
              a.changes -> 'budgetChange' ->> 'currencyCode' AS currency_code,
              a.occurred_at,
              a.member_id,
              a.user_id,
              COALESCE(direct_user.full_name, member_user.full_name, a.actor_name, 'System') AS actor_name
         FROM audit_log a
         LEFT JOIN organization_members member
           ON member.organization_id = a.organization_id AND member.id = a.member_id
         LEFT JOIN users member_user ON member_user.id = member.user_id
         LEFT JOIN users direct_user ON direct_user.id = a.user_id
        WHERE a.organization_id = $1
          AND a.changes ? 'budgetChange'
          AND a.changes ->> 'projectId' = $2
        ORDER BY a.occurred_at DESC, a.id DESC
        LIMIT 100`,
      [context.organizationId, projectId],
    );
    return result.rows.map(mapRow);
  });
}
function excelValue(value: unknown): string | number | Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function addWorkbookSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: Array<{ header: string; key: string; width?: number }>,
  rows: Row[],
): void {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.columns = columns.map((column) => ({
    ...column,
    width: column.width ?? 22,
  }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF14532D" },
  };
  for (const row of rows)
    sheet.addRow(columns.map((column) => excelValue(row[column.key])));
  sheet.autoFilter = {
    from: "A1",
    to: { row: Math.max(sheet.rowCount, 1), column: columns.length },
  };
  sheet.eachRow((row, index) => {
    if (index > 1) row.alignment = { vertical: "top", wrapText: true };
  });
}

export async function exportProjectWorkbook(
  context: OwnerManagementContext,
  projectId: string,
): Promise<{ filename: string; buffer: Buffer }> {
  const query = { projectId, limit: 200, offset: 0 };
  const [
    summary,
    phases,
    tasks,
    budgets,
    materials,
    requests,
    orders,
    receipts,
    expenses,
    assets,
    documents,
    activity,
  ] = await Promise.all([
    projectSummary(context, projectId),
    listOwnerManagementRecords(context, "phases", query),
    listOwnerManagementRecords(context, "tasks", query),
    listOwnerManagementRecords(context, "budget-lines", query),
    listOwnerManagementRecords(context, "materials", query),
    listOwnerManagementRecords(context, "purchase-requests", query),
    listOwnerManagementRecords(context, "purchase-orders", query),
    listOwnerManagementRecords(context, "receipts", query),
    listOwnerManagementRecords(context, "expenses", query),
    listOwnerManagementRecords(context, "assets", query),
    listOwnerManagementRecords(context, "documents", query),
    projectActivity(context, projectId),
  ]);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = await organizationBrandName(context);
  workbook.created = new Date();
  const currency = String(summary.currencyCode ?? "CDF");
  addWorkbookSheet(
    workbook,
    "Project Overview",
    [
      { header: "Field", key: "field", width: 28 },
      { header: "Value", key: "value", width: 48 },
    ],
    [
      { id: "name", field: "Project", value: summary.name },
      { id: "code", field: "Code", value: summary.code },
      { id: "type", field: "Type", value: summary.projectType },
      { id: "status", field: "Status", value: summary.status },
      { id: "priority", field: "Priority", value: summary.priority },
      { id: "start", field: "Start date", value: summary.startDate },
      {
        id: "target",
        field: "Target completion",
        value: summary.targetCompletionDate,
      },
      {
        id: "progress",
        field: "Calculated progress %",
        value: summary.calculatedProgressPercent,
      },
      {
        id: "planned",
        field: "Planned budget",
        value: (summary.budget as Row | undefined)?.planned,
      },
      {
        id: "spent",
        field: "Spent",
        value: (summary.budget as Row | undefined)?.spent,
      },
      {
        id: "committed",
        field: "Committed",
        value: (summary.budget as Row | undefined)?.committed,
      },
      {
        id: "available",
        field: "Available",
        value: (summary.budget as Row | undefined)?.available,
      },
      { id: "currency", field: "Currency", value: currency },
      { id: "blueprint", field: "Blueprint", value: summary.blueprint },
    ],
  );
  addWorkbookSheet(
    workbook,
    "Budget",
    [
      { header: "Category", key: "category" },
      { header: "Description", key: "description", width: 34 },
      { header: "Planned", key: "plannedAmount" },
      { header: "Currency", key: "currencyCode" },
      { header: "Notes", key: "notes", width: 34 },
    ],
    budgets,
  );
  addWorkbookSheet(
    workbook,
    "Expenses",
    [
      { header: "Number", key: "expenseNumber" },
      { header: "Category", key: "category" },
      { header: "Description", key: "description", width: 34 },
      { header: "Amount", key: "amount" },
      { header: "Currency", key: "currencyCode" },
      { header: "Date", key: "expenseDate" },
      { header: "Status", key: "status" },
    ],
    expenses,
  );
  addWorkbookSheet(
    workbook,
    "Procurement",
    [
      { header: "Kind", key: "kind" },
      { header: "Reference", key: "reference" },
      { header: "Status", key: "status" },
      { header: "Date", key: "date" },
      { header: "Expected / note", key: "detail", width: 32 },
    ],
    [
      ...requests.map((row) => ({
        id: `request-${row.id}`,
        kind: "Request",
        reference: row.requestNumber,
        status: row.status,
        date: row.requestDate,
        detail: row.reason,
      })),
      ...orders.map((row) => ({
        id: `order-${row.id}`,
        kind: "Order",
        reference: row.orderNumber,
        status: row.status,
        date: row.orderDate,
        detail: row.expectedDeliveryDate,
      })),
      ...receipts.map((row) => ({
        id: `receipt-${row.id}`,
        kind: "Receipt",
        reference: row.receiptNumber,
        status: row.status,
        date: row.receivedDate,
        detail: row.deliveryNoteNumber,
      })),
    ],
  );
  addWorkbookSheet(
    workbook,
    "Tasks",
    [
      { header: "Task", key: "title", width: 34 },
      { header: "Type", key: "taskType" },
      { header: "Status", key: "status" },
      { header: "Priority", key: "priority" },
      { header: "Start", key: "startDate" },
      { header: "Due", key: "dueDate" },
      { header: "Progress %", key: "progressPercent" },
      { header: "Estimated cost", key: "estimatedCost" },
      { header: "Actual cost", key: "actualCost" },
      { header: "Committed cost", key: "committedCost" },
      { header: "Blocker", key: "blockedReason", width: 30 },
    ],
    tasks,
  );
  addWorkbookSheet(
    workbook,
    "Resources",
    [
      { header: "Type", key: "kind" },
      { header: "Name", key: "name" },
      { header: "Category", key: "category" },
      { header: "Status", key: "status" },
      { header: "Quantity / price", key: "value" },
      { header: "Unit", key: "unit" },
    ],
    [
      ...materials.map((row) => ({
        id: `material-${row.id}`,
        kind: "Material",
        name: row.name,
        category: row.category,
        status: "planned",
        value: row.plannedQuantity,
        unit: row.unit,
      })),
      ...assets.map((row) => ({
        id: `asset-${row.id}`,
        kind: "Asset",
        name: row.name,
        category: row.category,
        status: row.status,
        value: row.purchasePrice,
        unit: row.currencyCode,
      })),
    ],
  );
  addWorkbookSheet(
    workbook,
    "Equipment",
    [
      { header: "Asset number", key: "assetNumber" },
      { header: "Name", key: "name", width: 32 },
      { header: "Category", key: "category" },
      { header: "Status", key: "status" },
      { header: "Location", key: "currentLocation" },
      { header: "Purchase price", key: "purchasePrice" },
      { header: "Currency", key: "currencyCode" },
    ],
    assets,
  );
  addWorkbookSheet(
    workbook,
    "Documents Index",
    [
      { header: "Title", key: "title", width: 34 },
      { header: "Category", key: "documentType" },
      { header: "Type", key: "mimeType" },
      { header: "Size", key: "fileSizeBytes" },
      { header: "Uploaded", key: "createdAt" },
      { header: "Link", key: "storageUrl", width: 54 },
    ],
    documents,
  );
  addWorkbookSheet(
    workbook,
    "Activity",
    [
      { header: "When", key: "occurredAt" },
      { header: "Event", key: "eventType" },
      { header: "Area", key: "entityType" },
      { header: "Record", key: "title", width: 36 },
      { header: "Status", key: "status" },
      { header: "Amount", key: "amount" },
      { header: "Currency", key: "currencyCode" },
      { header: "By", key: "actorName" },
    ],
    activity,
  );
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const fileName = `${String(summary.code ?? "project").replace(/[^a-zA-Z0-9_-]/g, "-")}-project-report.xlsx`;
  return { filename: fileName, buffer };
}
function pdfText(value: unknown, maxLength = 150): string {
  if (value === null || value === undefined || value === "")
    return "Non renseigné";
  return String(value)
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function pdfMoney(value: unknown, currency: unknown): string {
  const amount = Number(value ?? 0);
  const code = String(currency ?? "CDF").toUpperCase();
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const amountText = new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0,
  })
    .format(safeAmount)
    .replace(/[\u00A0\u202F]/g, " ");
  return `${amountText} ${/^[A-Z]{3}$/.test(code) ? code : "CDF"}`;
}

function pdfDate(value: unknown): string {
  if (!value) return "Non renseignée";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? pdfText(value)
    : new Intl.DateTimeFormat("fr-CD", { dateStyle: "medium" }).format(date);
}

function pdfDateTime(value: unknown): string {
  if (!value) return "Non renseignée";
  const timestamp = new Date(String(value));
  return Number.isNaN(timestamp.getTime())
    ? pdfText(value)
    : new Intl.DateTimeFormat("fr-CD", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(timestamp);
}

function stockMovementPdfLabel(movementType: unknown): string {
  const labels: Record<string, string> = {
    receipt: "Entrée en stock",
    issue: "Sortie de stock",
    return: "Retour en stock",
    adjustment_in: "Correction positive",
    adjustment_out: "Correction négative",
    transfer_in: "Transfert reçu",
    transfer_out: "Transfert envoyé",
    maintenance_issue: "Sortie maintenance",
  };
  return labels[String(movementType)] ?? pdfText(movementType);
}

async function createInventoryMovementHistoryPdf(
  companyName: string,
  historyDate: string,
  rows: Row[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 44, bottom: 44, left: 38, right: 38 },
      bufferPages: true,
      info: {
        Title: `Historique de stock - ${historyDate}`,
        Author: companyName,
        Subject: "Historique journalier des mouvements de stock",
      },
    });
    const chunks: Buffer[] = [];
    const left = 38;
    const pageWidth = 595.28;
    const contentWidth = pageWidth - 76;
    const bottom = 788;
    const navy = "#152B52";
    const teal = "#087E8B";
    const muted = "#64748B";
    const border = "#D8E1EC";
    const columns = [
      { key: "time", label: "Heure", width: 72 },
      { key: "type", label: "Mouvement", width: 94 },
      { key: "item", label: "Article", width: 116 },
      { key: "warehouse", label: "Entrepôt", width: 96 },
      { key: "person", label: "Effectué par", width: 83 },
      { key: "quantity", label: "Quantité", width: 58 },
    ] as const;
    const header = () => {
      doc
        .fillColor(navy)
        .font("Helvetica-Bold")
        .fontSize(18)
        .text(companyName, left, 38, { width: 245, ellipsis: true });
      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(8.5)
        .text("INVENTAIRE - HISTORIQUE JOURNALIER", left, 63, { width: 250 });
      doc
        .fillColor(teal)
        .font("Helvetica-Bold")
        .fontSize(13)
        .text("MOUVEMENTS DE STOCK", 310, 40, { width: 247, align: "right" });
      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(8.5)
        .text(`Journée : ${pdfDate(`${historyDate}T12:00:00`)}`, 310, 62, {
          width: 247,
          align: "right",
        });
      doc
        .moveTo(left, 88)
        .lineTo(left + contentWidth, 88)
        .strokeColor(teal)
        .lineWidth(1.5)
        .stroke();
      doc.y = 104;
    };
    const tableHeader = () => {
      const y = doc.y;
      let x = left;
      doc.save().rect(left, y, contentWidth, 21).fill("#F0F6F8");
      doc.fillColor(navy).font("Helvetica-Bold").fontSize(7.2);
      for (const column of columns) {
        doc.text(column.label, x + 4, y + 7, {
          width: column.width - 7,
          ellipsis: true,
        });
        x += column.width;
      }
      doc.restore();
      doc.y = y + 27;
    };
    const nextPage = () => {
      doc.addPage();
      header();
      tableHeader();
    };
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    header();
    doc
      .fillColor(muted)
      .font("Helvetica")
      .fontSize(9)
      .text(
        `${rows.length} écriture(s) de registre. Les mouvements restent traçables et ne sont pas modifiables.`,
        left,
        doc.y,
        { width: contentWidth },
      );
    doc.moveDown(1.05);
    tableHeader();
    if (!rows.length) {
      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(10)
        .text("Aucun mouvement pour cette journée.", left, doc.y + 10, {
          width: contentWidth,
        });
    }
    for (const row of rows) {
      const delta = Number(row.quantityDelta ?? 0);
      const absolute = Math.abs(delta);
      const signed = delta < 0 ? `-${absolute}` : `+${absolute}`;
      const values = {
        time: pdfDateTime(row.createdAt),
        type: stockMovementPdfLabel(row.movementType),
        item: pdfText(row.itemName || row.itemCode),
        warehouse: pdfText(row.warehouseName),
        person: pdfText(row.performedByName),
        quantity: `${signed} ${pdfText(row.itemUnit, 18)}`,
      };
      const height = 35;
      if (doc.y + height > bottom) nextPage();
      const y = doc.y;
      let x = left;
      doc
        .moveTo(left, y + height)
        .lineTo(left + contentWidth, y + height)
        .strokeColor(border)
        .lineWidth(0.45)
        .stroke();
      for (const column of columns) {
        const color =
          column.key === "quantity" ? (delta < 0 ? "#B42318" : teal) : navy;
        doc
          .fillColor(color)
          .font(column.key === "quantity" ? "Helvetica-Bold" : "Helvetica")
          .fontSize(7.4)
          .text(values[column.key], x + 4, y + 5, {
            width: column.width - 7,
            height: height - 7,
            ellipsis: true,
          });
        x += column.width;
      }
      doc.y = y + height;
    }
    const pages = doc.bufferedPageRange();
    for (let page = 0; page < pages.count; page += 1) {
      doc.switchToPage(page);
      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(7.5)
        .text(
          `${companyName} - Historique de stock - ${historyDate} - Page ${page + 1}/${pages.count}`,
          left,
          808,
          { width: contentWidth, align: "center" },
        );
    }
    doc.end();
  });
}

export async function exportInventoryMovementHistoryPdf(
  context: OwnerManagementContext,
  query: InventoryMovementHistoryPdfQuery,
): Promise<{ filename: string; buffer: Buffer }> {
  const allForDay = await listOwnerManagementRecords(
    context,
    "stock-movements",
    {
      fromDate: query.date,
      toDate: query.date,
      provinceId: query.provinceId,
      siteId: query.siteId,
      limit: 1000,
      offset: 0,
    },
  );
  const movements = allForDay.filter(
    (row) =>
      (!query.warehouseId || String(row.warehouseId) === query.warehouseId) &&
      (!query.itemId || String(row.itemId) === query.itemId),
  );
  const companyName = await withTenantContext(context, async (client) => {
    const result = await client.query<{ name: string | null }>(
      "SELECT COALESCE(display_name, legal_name, slug) AS name FROM organizations WHERE id = $1",
      [context.organizationId],
    );
    return result.rows[0]?.name?.trim() || "Entreprise";
  });
  const detailed = await withTenantContext(context, async (client) => {
    if (!movements.length) return movements;
    const itemIds = [
      ...new Set(movements.map((row) => String(row.itemId)).filter(Boolean)),
    ];
    const warehouseIds = [
      ...new Set(
        movements.map((row) => String(row.warehouseId)).filter(Boolean),
      ),
    ];
    const [items, warehouses] = await Promise.all([
      client.query<Row>(
        "SELECT id, name, code, unit FROM management_inventory_items WHERE organization_id = $1 AND id = ANY($2::uuid[])",
        [context.organizationId, itemIds],
      ),
      client.query<Row>(
        "SELECT id, name FROM management_warehouses WHERE organization_id = $1 AND id = ANY($2::uuid[])",
        [context.organizationId, warehouseIds],
      ),
    ]);
    const itemById = new Map(items.rows.map((row) => [String(row.id), row]));
    const warehouseById = new Map(
      warehouses.rows.map((row) => [String(row.id), row]),
    );
    return movements.map((movement) => {
      const item = itemById.get(String(movement.itemId));
      const warehouse = warehouseById.get(String(movement.warehouseId));
      return {
        ...movement,
        itemName: item?.name ?? null,
        itemCode: item?.code ?? null,
        itemUnit: item?.unit ?? null,
        warehouseName: warehouse?.name ?? null,
      };
    });
  });
  return {
    filename: `historique-stock-${query.date}.pdf`,
    buffer: await createInventoryMovementHistoryPdf(
      companyName,
      query.date,
      detailed,
    ),
  };
}
type ProcurementPdfCompany = {
  name: string;
  address: string;
  logoUrl?: string | null;
};

type ProcurementPdfLine = {
  description: string;
  unit: string;
  quantity: number;
  orderedQuantity?: number | null;
  acceptedQuantity?: number | null;
  damagedQuantity?: number | null;
  rejectedQuantity?: number | null;
  unitCost?: number | null;
  taxAmount?: number | null;
  notes?: string | null;
};

const PROCUREMENT_DOCUMENT_META: Record<
  ProcurementDocumentType,
  {
    title: string;
    referenceKey: string;
    filenamePrefix: string;
    dateLabel: string;
  }
> = {
  "purchase-requests": {
    title: "DEMANDE D'ACHAT",
    referenceKey: "request_number",
    filenamePrefix: "demande-achat",
    dateLabel: "Date de la demande",
  },
  "purchase-orders": {
    title: "BON DE COMMANDE",
    referenceKey: "order_number",
    filenamePrefix: "bon-commande",
    dateLabel: "Date de commande",
  },
  receipts: {
    title: "BON DE RÉCEPTION",
    referenceKey: "receipt_number",
    filenamePrefix: "bon-reception",
    dateLabel: "Date de réception",
  },
};

async function procurementPdfLogo(
  url: string | null | undefined,
): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !/(^|\.)res\.cloudinary\.com$/i.test(parsed.hostname)
    )
      return null;
    const response = await fetch(parsed, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      !contentType.includes("image/png") &&
      !contentType.includes("image/jpeg")
    )
      return null;
    const declaredSize = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredSize) && declaredSize > 2_000_000) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length && bytes.length <= 2_000_000 ? bytes : null;
  } catch {
    // Branding must never prevent a controlled business document from downloading.
    return null;
  }
}

const procurementPdfValue = (value: unknown) => {
  const cleaned = pdfText(value, 180);
  return cleaned === "Non renseigné" ? "-" : cleaned;
};

const procurementPdfNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 })
        .format(number)
        .replace(/[\u00A0\u202F]/g, " ")
    : "0";
};

async function procurementDocumentData(
  context: OwnerManagementContext,
  documentType: ProcurementDocumentType,
  recordId: string,
): Promise<{
  company: ProcurementPdfCompany;
  record: Row;
  lines: ProcurementPdfLine[];
}> {
  return withTenantContext(context, async (client) => {
    const companyResult = await client.query<Row>(
      "SELECT COALESCE(o.display_name, o.legal_name, o.slug) AS name, o.address_line1, o.address_line2, o.city, o.region, o.postal_code, settings.logo_url FROM organizations o LEFT JOIN organization_settings settings ON settings.organization_id = o.id WHERE o.id = $1",
      [context.organizationId],
    );
    const companyRow = companyResult.rows[0];
    if (!companyRow) throw new NotFoundError("Organization not found");
    const address = [
      companyRow.address_line1,
      companyRow.address_line2,
      [companyRow.city, companyRow.region, companyRow.postal_code]
        .filter(Boolean)
        .join(", "),
    ]
      .filter(Boolean)
      .map((value) => String(value).trim())
      .filter(Boolean)
      .join("\n");
    const company: ProcurementPdfCompany = {
      name: String(companyRow.name ?? "Entreprise").trim() || "Entreprise",
      address,
      logoUrl: (companyRow.logo_url as string | null) ?? null,
    };

    let record: Row | undefined;
    let lines: ProcurementPdfLine[] = [];
    if (documentType === "purchase-requests") {
      const result = await client.query<Row>(
        "SELECT pr.*, p.name AS project_name, p.code AS project_code, province.name AS province_name, site.name AS site_name, supplier.name AS supplier_name, supplier.contact_name AS supplier_contact_name, supplier.email AS supplier_email, supplier.phone AS supplier_phone, supplier.address AS supplier_address, requester.full_name AS requester_name FROM management_purchase_requests pr JOIN management_projects p ON p.organization_id = pr.organization_id AND p.id = pr.project_id LEFT JOIN provinces province ON province.organization_id = pr.organization_id AND province.id = p.province_id LEFT JOIN sites site ON site.organization_id = pr.organization_id AND site.id = p.site_id LEFT JOIN management_suppliers supplier ON supplier.organization_id = pr.organization_id AND supplier.id = pr.supplier_id LEFT JOIN organization_members requested_member ON requested_member.organization_id = pr.organization_id AND requested_member.id = pr.requested_by_member_id LEFT JOIN users requester ON requester.id = requested_member.user_id WHERE pr.organization_id = $1 AND pr.id = $2",
        [context.organizationId, recordId],
      );
      record = result.rows[0];
      const lineResult = await client.query<Row>(
        "SELECT description, unit, requested_quantity, estimated_unit_cost, notes FROM management_purchase_request_lines WHERE organization_id = $1 AND purchase_request_id = $2 ORDER BY created_at, id",
        [context.organizationId, recordId],
      );
      lines = lineResult.rows.map((line) => ({
        description: String(line.description ?? ""),
        unit: String(line.unit ?? ""),
        quantity: Number(line.requested_quantity ?? 0),
        unitCost:
          line.estimated_unit_cost == null
            ? null
            : Number(line.estimated_unit_cost),
        notes: (line.notes as string | null) ?? null,
      }));
    } else if (documentType === "purchase-orders") {
      const result = await client.query<Row>(
        "SELECT po.*, pr.request_number, p.name AS project_name, p.code AS project_code, province.name AS province_name, site.name AS site_name, supplier.name AS supplier_name, supplier.contact_name AS supplier_contact_name, supplier.email AS supplier_email, supplier.phone AS supplier_phone, supplier.address AS supplier_address, ordered.full_name AS ordered_by_name FROM management_purchase_orders po JOIN management_projects p ON p.organization_id = po.organization_id AND p.id = po.project_id LEFT JOIN management_purchase_requests pr ON pr.organization_id = po.organization_id AND pr.id = po.purchase_request_id LEFT JOIN provinces province ON province.organization_id = po.organization_id AND province.id = p.province_id LEFT JOIN sites site ON site.organization_id = po.organization_id AND site.id = p.site_id LEFT JOIN management_suppliers supplier ON supplier.organization_id = po.organization_id AND supplier.id = po.supplier_id LEFT JOIN organization_members ordered_member ON ordered_member.organization_id = po.organization_id AND ordered_member.id = po.ordered_by_member_id LEFT JOIN users ordered ON ordered.id = ordered_member.user_id WHERE po.organization_id = $1 AND po.id = $2",
        [context.organizationId, recordId],
      );
      record = result.rows[0];
      const lineResult = await client.query<Row>(
        "SELECT description, unit, ordered_quantity, unit_cost, tax_amount, notes FROM management_purchase_order_lines WHERE organization_id = $1 AND purchase_order_id = $2 ORDER BY created_at, id",
        [context.organizationId, recordId],
      );
      lines = lineResult.rows.map((line) => ({
        description: String(line.description ?? ""),
        unit: String(line.unit ?? ""),
        quantity: Number(line.ordered_quantity ?? 0),
        unitCost: Number(line.unit_cost ?? 0),
        taxAmount: Number(line.tax_amount ?? 0),
        notes: (line.notes as string | null) ?? null,
      }));
    } else {
      const result = await client.query<Row>(
        "SELECT receipt.*, purchase_order.order_number, p.name AS project_name, p.code AS project_code, province.name AS province_name, site.name AS site_name, warehouse.name AS warehouse_name, supplier.name AS supplier_name, supplier.contact_name AS supplier_contact_name, supplier.email AS supplier_email, supplier.phone AS supplier_phone, supplier.address AS supplier_address, receiver.full_name AS receiver_name FROM management_receipts receipt JOIN management_purchase_orders purchase_order ON purchase_order.organization_id = receipt.organization_id AND purchase_order.id = receipt.purchase_order_id JOIN management_projects p ON p.organization_id = receipt.organization_id AND p.id = receipt.project_id LEFT JOIN provinces province ON province.organization_id = receipt.organization_id AND province.id = p.province_id LEFT JOIN sites site ON site.organization_id = receipt.organization_id AND site.id = p.site_id LEFT JOIN management_warehouses warehouse ON warehouse.organization_id = receipt.organization_id AND warehouse.id = receipt.warehouse_id LEFT JOIN management_suppliers supplier ON supplier.organization_id = purchase_order.organization_id AND supplier.id = purchase_order.supplier_id LEFT JOIN organization_members received_member ON received_member.organization_id = receipt.organization_id AND received_member.id = receipt.received_by_member_id LEFT JOIN users receiver ON receiver.id = received_member.user_id WHERE receipt.organization_id = $1 AND receipt.id = $2",
        [context.organizationId, recordId],
      );
      record = result.rows[0];
      const lineResult = await client.query<Row>(
        "SELECT order_line.description, order_line.unit, order_line.ordered_quantity, receipt_line.received_quantity, receipt_line.damaged_quantity, receipt_line.rejected_quantity, COALESCE(receipt_line.actual_unit_cost, order_line.unit_cost) AS unit_cost, receipt_line.receiver_notes FROM management_receipt_lines receipt_line JOIN management_purchase_order_lines order_line ON order_line.organization_id = receipt_line.organization_id AND order_line.id = receipt_line.purchase_order_line_id WHERE receipt_line.organization_id = $1 AND receipt_line.receipt_id = $2 ORDER BY receipt_line.created_at, receipt_line.id",
        [context.organizationId, recordId],
      );
      lines = lineResult.rows.map((line) => {
        const received = Number(line.received_quantity ?? 0);
        const damaged = Number(line.damaged_quantity ?? 0);
        const rejected = Number(line.rejected_quantity ?? 0);
        return {
          description: String(line.description ?? ""),
          unit: String(line.unit ?? ""),
          quantity: received,
          orderedQuantity: Number(line.ordered_quantity ?? 0),
          acceptedQuantity: Math.max(0, received - damaged - rejected),
          damagedQuantity: damaged,
          rejectedQuantity: rejected,
          unitCost: line.unit_cost == null ? null : Number(line.unit_cost),
          notes: (line.receiver_notes as string | null) ?? null,
        };
      });
    }
    if (!record) throw new NotFoundError("Procurement document not found");
    return { company, record, lines };
  });
}

export async function procurementDocumentPdf(
  company: ProcurementPdfCompany,
  documentType: ProcurementDocumentType,
  record: Row,
  lines: ProcurementPdfLine[],
): Promise<Buffer> {
  const meta = PROCUREMENT_DOCUMENT_META[documentType];
  const reference = procurementPdfValue(record[meta.referenceKey]);
  const currency = String(record.currency_code ?? "CDF").toUpperCase();
  const logo = await procurementPdfLogo(company.logoUrl);
  const navy = "#12384B";
  const brand = "#147D86";
  const pale = "#EFF7F7";
  const ink = "#18242C";
  const muted = "#5F6F79";
  const border = "#D5E2E5";
  const initials =
    company.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.slice(0, 1).toUpperCase())
      .join("") || "CO";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 42,
      bufferPages: true,
      info: { Title: `${meta.title} - ${reference}`, Author: company.name },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const left = doc.page.margins.left;
    const contentWidth = pageWidth - left * 2;
    const bottom = pageHeight - 52;
    const status = procurementPdfValue(record.status).replace(/_/g, " ");
    const documentDate =
      documentType === "purchase-requests"
        ? record.request_date
        : documentType === "purchase-orders"
          ? record.order_date
          : record.received_date;
    const dateLabel = meta.dateLabel;

    const drawHeader = () => {
      doc.rect(0, 0, pageWidth, 16).fill(navy);
      doc.roundedRect(left, 32, 48, 48, 10).fill("#FFFFFF");
      if (logo) {
        try {
          doc.image(logo, left + 6, 38, { fit: [36, 36] });
        } catch {
          doc
            .fillColor(navy)
            .font("Helvetica-Bold")
            .fontSize(15)
            .text(initials, left, 48, { width: 48, align: "center" });
        }
      } else {
        doc
          .fillColor(navy)
          .font("Helvetica-Bold")
          .fontSize(15)
          .text(initials, left, 48, { width: 48, align: "center" });
      }
      doc
        .fillColor(ink)
        .font("Helvetica-Bold")
        .fontSize(15)
        .text(company.name, left + 60, 38, { width: 235, ellipsis: true });
      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(7.5)
        .text(
          company.address || "Adresse officielle non renseignée",
          left + 60,
          58,
          { width: 245, height: 32, ellipsis: true },
        );
      doc
        .fillColor(navy)
        .font("Helvetica-Bold")
        .fontSize(17)
        .text(meta.title, pageWidth - left - 250, 36, {
          width: 250,
          align: "right",
        });
      doc
        .fillColor(brand)
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .text(reference, pageWidth - left - 250, 59, {
          width: 250,
          align: "right",
        });
      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(7.5)
        .text(
          `${dateLabel} : ${pdfDate(documentDate)}`,
          pageWidth - left - 250,
          75,
          { width: 250, align: "right" },
        );
      doc
        .moveTo(left, 101)
        .lineTo(pageWidth - left, 101)
        .strokeColor(border)
        .lineWidth(0.7)
        .stroke();
      doc.y = 118;
    };
    const newPage = () => {
      doc.addPage();
      drawHeader();
    };
    const ensure = (height: number) => {
      if (doc.y + height > bottom) newPage();
    };
    const infoBox = (
      x: number,
      y: number,
      width: number,
      heading: string,
      values: string[],
    ) => {
      const lines = values.filter((value) => value && value !== "-");
      const height = Math.max(60, 29 + Math.max(1, lines.length) * 11);
      doc.roundedRect(x, y, width, height, 7).fill(pale);
      doc
        .fillColor(brand)
        .font("Helvetica-Bold")
        .fontSize(7)
        .text(heading.toUpperCase(), x + 10, y + 9, { width: width - 20 });
      doc
        .fillColor(ink)
        .font("Helvetica")
        .fontSize(8)
        .text(lines.join("\n") || "-", x + 10, y + 21, {
          width: width - 20,
          height: height - 26,
          ellipsis: true,
        });
      return height;
    };
    const section = (heading: string) => {
      ensure(29);
      doc.roundedRect(left, doc.y, contentWidth, 21, 5).fill(navy);
      doc
        .fillColor("#FFFFFF")
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(heading.toUpperCase(), left + 10, doc.y + 7, {
          width: contentWidth - 20,
        });
      doc.y += 29;
    };
    const columns =
      documentType === "receipts"
        ? [
            { label: "ARTICLE", width: 180 },
            { label: "CMD.", width: 52 },
            { label: "RECU", width: 52 },
            { label: "ACCEPTE", width: 58 },
            { label: "NON CONFORME", width: 74 },
            { label: "VALEUR", width: 95 },
          ]
        : [
            { label: "ARTICLE / DESCRIPTION", width: 190 },
            { label: "QTE", width: 54 },
            { label: "UNITE", width: 52 },
            { label: "PRIX UNITAIRE", width: 98 },
            { label: "TOTAL", width: 117 },
          ];
    const tableHeader = () => {
      ensure(21);
      const y = doc.y;
      let x = left;
      doc.rect(left, y, contentWidth, 19).fill(brand);
      for (const column of columns) {
        doc
          .fillColor("#FFFFFF")
          .font("Helvetica-Bold")
          .fontSize(6.8)
          .text(column.label, x + 5, y + 6, {
            width: column.width - 10,
            align:
              column.label === "ARTICLE / DESCRIPTION" ||
              column.label === "ARTICLE"
                ? "left"
                : "center",
            lineBreak: false,
            ellipsis: true,
          });
        x += column.width;
      }
      doc.y = y + 19;
    };
    const lineCostKnown = (line: ProcurementPdfLine) =>
      line.unitCost !== null &&
      line.unitCost !== undefined &&
      Number.isFinite(Number(line.unitCost));
    const lineTotal = (line: ProcurementPdfLine) => {
      if (!lineCostKnown(line)) return null;
      const quantity =
        documentType === "receipts"
          ? Number(line.acceptedQuantity ?? 0)
          : line.quantity;
      return (
        quantity * Number(line.unitCost) +
        (documentType === "purchase-orders" ? Number(line.taxAmount ?? 0) : 0)
      );
    };
    const drawTable = () => {
      section(
        documentType === "purchase-requests"
          ? "Articles demandés"
          : documentType === "purchase-orders"
            ? "Articles commandés"
            : "Articles réceptionnés",
      );
      if (!lines.length) {
        doc
          .fillColor(muted)
          .font("Helvetica-Oblique")
          .fontSize(9)
          .text("Aucun article enregistré pour ce document.");
        doc.moveDown(0.8);
        return;
      }
      tableHeader();
      for (const line of lines) {
        const nonConforming =
          Number(line.damagedQuantity ?? 0) +
          Number(line.rejectedQuantity ?? 0);
        const cells =
          documentType === "receipts"
            ? [
                procurementPdfValue(line.description),
                procurementPdfNumber(line.orderedQuantity),
                procurementPdfNumber(line.quantity),
                procurementPdfNumber(line.acceptedQuantity),
                procurementPdfNumber(nonConforming),
                lineTotal(line) == null
                  ? "A chiffrer"
                  : pdfMoney(lineTotal(line), currency),
              ]
            : [
                procurementPdfValue(line.description),
                procurementPdfNumber(line.quantity),
                procurementPdfValue(line.unit),
                lineCostKnown(line)
                  ? pdfMoney(line.unitCost, currency)
                  : "A chiffrer",
                lineTotal(line) == null
                  ? "A chiffrer"
                  : pdfMoney(lineTotal(line), currency),
              ];
        doc.font("Helvetica").fontSize(7.7);
        const height = Math.max(
          25,
          doc.heightOfString(cells[0]!, { width: columns[0]!.width - 10 }) + 10,
        );
        if (doc.y + height > bottom) {
          newPage();
          section(
            documentType === "purchase-requests"
              ? "Articles demandés"
              : documentType === "purchase-orders"
                ? "Articles commandés"
                : "Articles réceptionnés",
          );
          tableHeader();
        }
        const y = doc.y;
        let x = left;
        doc
          .rect(left, y, contentWidth, height)
          .fill("#FFFFFF")
          .strokeColor(border)
          .lineWidth(0.45)
          .stroke();
        for (let index = 0; index < columns.length; index += 1) {
          const column = columns[index]!;
          doc
            .fillColor(ink)
            .font("Helvetica")
            .fontSize(7.7)
            .text(cells[index]!, x + 5, y + 6, {
              width: column.width - 10,
              height: height - 10,
              ellipsis: true,
              align: index === 0 ? "left" : "right",
            });
          if (index > 0)
            doc
              .moveTo(x, y)
              .lineTo(x, y + height)
              .strokeColor(border)
              .lineWidth(0.35)
              .stroke();
          x += column.width;
        }
        doc.y = y + height;
        if (line.notes) {
          ensure(19);
          doc
            .fillColor(muted)
            .font("Helvetica-Oblique")
            .fontSize(6.8)
            .text(
              `Note : ${procurementPdfValue(line.notes)}`,
              left + 8,
              doc.y + 3,
              { width: contentWidth - 16, height: 14, ellipsis: true },
            );
          doc.y += 18;
        }
      }
      doc.moveDown(0.65);
    };

    drawHeader();
    const boxGap = 12;
    const boxWidth = (contentWidth - boxGap) / 2;
    const sender =
      documentType === "purchase-requests"
        ? [
            procurementPdfValue(record.requester_name),
            procurementPdfValue(record.project_name),
            procurementPdfValue(record.site_name || record.province_name),
          ]
        : documentType === "purchase-orders"
          ? [
              company.name,
              `Commandé par : ${procurementPdfValue(record.ordered_by_name)}`,
              procurementPdfValue(record.project_name),
            ]
          : [
              company.name,
              `Réceptionné par : ${procurementPdfValue(record.receiver_name)}`,
              procurementPdfValue(record.project_name),
            ];
    const supplier = [
      procurementPdfValue(record.supplier_name),
      procurementPdfValue(record.supplier_contact_name),
      procurementPdfValue(record.supplier_address),
      [record.supplier_phone, record.supplier_email]
        .filter(Boolean)
        .join(" - "),
    ];
    const y = doc.y;
    const leftHeight = infoBox(
      left,
      y,
      boxWidth,
      documentType === "purchase-requests" ? "Demandeur / projet" : "Emetteur",
      sender,
    );
    const rightHeight = infoBox(
      left + boxWidth + boxGap,
      y,
      boxWidth,
      documentType === "receipts" ? "Fournisseur / livraison" : "Fournisseur",
      supplier,
    );
    doc.y = y + Math.max(leftHeight, rightHeight) + 14;

    section("Informations du document");
    const infoRows: Array<[string, string]> = [
      ["Statut", status],
      [dateLabel, pdfDate(documentDate)],
      ["Projet", procurementPdfValue(record.project_name)],
      [
        "Site / province",
        procurementPdfValue(record.site_name || record.province_name),
      ],
    ];
    if (documentType === "purchase-requests") {
      infoRows.push(
        ["Date requise", pdfDate(record.required_date)],
        ["Priorité", procurementPdfValue(record.priority)],
      );
    } else if (documentType === "purchase-orders") {
      infoRows.push(
        ["Demande source", procurementPdfValue(record.request_number)],
        ["Commandé par", procurementPdfValue(record.ordered_by_name)],
        ["Livraison prévue", pdfDate(record.expected_delivery_date)],
      );
    } else {
      infoRows.push(
        ["Bon de commande", procurementPdfValue(record.order_number)],
        ["Réceptionné par", procurementPdfValue(record.receiver_name)],
        ["Entrepôt", procurementPdfValue(record.warehouse_name)],
        [
          "Bon de livraison fournisseur",
          procurementPdfValue(record.delivery_note_number),
        ],
      );
    }
    for (let index = 0; index < infoRows.length; index += 2) {
      ensure(41);
      const rowY = doc.y;
      const first = infoRows[index]!;
      const second = infoRows[index + 1];
      const width = second ? (contentWidth - 8) / 2 : contentWidth;
      for (const [offset, item] of (second
        ? [
            [0, first],
            [width + 8, second],
          ]
        : [[0, first]]) as Array<[number, [string, string]]>) {
        doc
          .roundedRect(left + offset, rowY, width, 34, 5)
          .fill("#F8FBFC")
          .strokeColor(border)
          .lineWidth(0.35)
          .stroke();
        doc
          .fillColor(muted)
          .font("Helvetica-Bold")
          .fontSize(6.7)
          .text(item[0].toUpperCase(), left + offset + 8, rowY + 7, {
            width: width - 16,
          });
        doc
          .fillColor(ink)
          .font("Helvetica-Bold")
          .fontSize(8)
          .text(item[1] || "-", left + offset + 8, rowY + 18, {
            width: width - 16,
            ellipsis: true,
          });
      }
      doc.y = rowY + 41;
    }
    const reason =
      documentType === "purchase-requests" ? record.reason : record.notes;
    if (reason) {
      ensure(55);
      section(
        documentType === "purchase-requests" ? "Motif de la demande" : "Notes",
      );
      doc
        .fillColor(ink)
        .font("Helvetica")
        .fontSize(8.5)
        .text(procurementPdfValue(reason), { width: contentWidth, lineGap: 2 });
      doc.moveDown(0.8);
    }

    drawTable();
    const priced = lines.length > 0 && lines.every(lineCostKnown);
    const subtotal = priced
      ? lines.reduce(
          (sum, line) =>
            sum +
            (lineTotal(line) ?? 0) -
            (documentType === "purchase-orders"
              ? Number(line.taxAmount ?? 0)
              : 0),
          0,
        )
      : null;
    const taxes =
      documentType === "purchase-orders" && priced
        ? lines.reduce((sum, line) => sum + Number(line.taxAmount ?? 0), 0)
        : 0;
    const total = priced ? (subtotal ?? 0) + taxes : null;
    ensure(100);
    const totalWidth = 205;
    const totalX = left + contentWidth - totalWidth;
    const totalsY = doc.y;
    doc.roundedRect(totalX, totalsY, totalWidth, 81, 7).fill("#E8F2F4");
    const totalRows: Array<[string, string]> = [
      [
        "SOUS-TOTAL",
        subtotal == null ? "A chiffrer" : pdfMoney(subtotal, currency),
      ],
      ["TAXES", taxes ? pdfMoney(taxes, currency) : pdfMoney(0, currency)],
      ["TOTAL", total == null ? "A chiffrer" : pdfMoney(total, currency)],
    ];
    totalRows.forEach(([label, value], index) => {
      const rowY = totalsY + 10 + index * 22;
      doc
        .fillColor(index === 2 ? navy : muted)
        .font(index === 2 ? "Helvetica-Bold" : "Helvetica")
        .fontSize(index === 2 ? 9 : 7.5)
        .text(label, totalX + 12, rowY, { width: 82 });
      doc
        .fillColor(index === 2 ? navy : ink)
        .font(index === 2 ? "Helvetica-Bold" : "Helvetica")
        .fontSize(index === 2 ? 9 : 7.5)
        .text(value, totalX + 96, rowY, {
          width: totalWidth - 108,
          align: "right",
        });
    });
    doc.y = totalsY + 95;

    ensure(73);
    doc
      .moveTo(left, doc.y + 27)
      .lineTo(left + 205, doc.y + 27)
      .strokeColor(border)
      .lineWidth(0.7)
      .stroke();
    doc
      .moveTo(pageWidth - left - 205, doc.y + 27)
      .lineTo(pageWidth - left, doc.y + 27)
      .strokeColor(border)
      .lineWidth(0.7)
      .stroke();
    doc
      .fillColor(muted)
      .font("Helvetica-Bold")
      .fontSize(7)
      .text(
        documentType === "purchase-requests"
          ? "DEMANDEUR"
          : documentType === "purchase-orders"
            ? "COMMANDÉ PAR"
            : "RÉCEPTIONNAIRE",
        left,
        doc.y + 34,
        { width: 205 },
      );
    doc
      .fillColor(muted)
      .font("Helvetica-Bold")
      .fontSize(7)
      .text("VALIDATION / SIGNATURE", pageWidth - left - 205, doc.y + 34, {
        width: 205,
        align: "right",
      });
    const responsibleName =
      documentType === "purchase-requests"
        ? procurementPdfValue(record.requester_name)
        : documentType === "purchase-orders"
          ? procurementPdfValue(record.ordered_by_name)
          : procurementPdfValue(record.receiver_name);
    doc
      .fillColor(ink)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(responsibleName, left, doc.y + 46, { width: 205, ellipsis: true });
    doc.y += 65;

    const pageRange = doc.bufferedPageRange();
    for (let index = 0; index < pageRange.count; index += 1) {
      doc.switchToPage(pageRange.start + index);
      const footerLineY = pageHeight - 84;
      const footerTextY = pageHeight - 74;
      doc
        .moveTo(left, footerLineY)
        .lineTo(pageWidth - left, footerLineY)
        .strokeColor(border)
        .lineWidth(0.5)
        .stroke();
      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(7)
        .text(
          `${company.name} - ${reference} - Document contrôlé`,
          left,
          footerTextY,
          { width: contentWidth / 2, lineBreak: false },
        );
      doc.text(
        `Page ${index + 1} / ${pageRange.count}`,
        left + contentWidth / 2,
        footerTextY,
        { width: contentWidth / 2, align: "right", lineBreak: false },
      );
    }
    doc.end();
  });
}

/** A fillable two-step document: employee request first, owner decision second. */
export async function purchaseRequestFormPdf(
  company: ProcurementPdfCompany,
  provisionalReference: string,
): Promise<Buffer> {
  const logo = await procurementPdfLogo(company.logoUrl);
  const navy = "#233A7A";
  const blue = "#2563EB";
  const pale = "#EFF4FF";
  const ink = "#172033";
  const muted = "#61708B";
  const border = "#C7D2E8";
  const initials =
    company.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.slice(0, 1).toUpperCase())
      .join("") || "LH";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 42,
      bufferPages: true,
      info: {
        Title: `Formulaire de demande d'achat - ${company.name}`,
        Author: company.name,
        Subject: "Formulaire remplissable de demande d'achat",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.initForm();

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const left = doc.page.margins.left;
    const contentWidth = pageWidth - left * 2;
    const footerLineY = pageHeight - 84;
    const footerTextY = pageHeight - 74;

    const drawHeader = (title: string, pageLabel: string) => {
      doc.rect(0, 0, pageWidth, 17).fill(navy);
      doc.roundedRect(left, 33, 48, 48, 11).fill("#FFFFFF");
      if (logo) {
        try {
          doc.image(logo, left + 6, 39, { fit: [36, 36] });
        } catch {
          doc
            .fillColor(navy)
            .font("Helvetica-Bold")
            .fontSize(15)
            .text(initials, left, 49, { width: 48, align: "center" });
        }
      } else {
        doc
          .fillColor(navy)
          .font("Helvetica-Bold")
          .fontSize(15)
          .text(initials, left, 49, { width: 48, align: "center" });
      }
      doc
        .fillColor(ink)
        .font("Helvetica-Bold")
        .fontSize(15)
        .text(company.name, left + 60, 39, { width: 230, ellipsis: true });
      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(7.5)
        .text(
          company.address || "Adresse officielle non renseignée",
          left + 60,
          59,
          { width: 240, height: 25, ellipsis: true },
        );
      doc
        .fillColor(navy)
        .font("Helvetica-Bold")
        .fontSize(16)
        .text(title, pageWidth - left - 258, 38, {
          width: 258,
          align: "right",
        });
      doc
        .fillColor(blue)
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(pageLabel, pageWidth - left - 258, 62, {
          width: 258,
          align: "right",
        });
      doc
        .fillColor(muted)
        .font("Helvetica-Bold")
        .fontSize(7)
        .text(
          `RÉF. PRÉVISIONNELLE : ${provisionalReference}`,
          pageWidth - left - 258,
          76,
          { width: 258, align: "right" },
        );
      doc
        .moveTo(left, 101)
        .lineTo(pageWidth - left, 101)
        .strokeColor(border)
        .lineWidth(0.7)
        .stroke();
      doc.y = 118;
    };
    const section = (title: string) => {
      const y = doc.y;
      doc.roundedRect(left, y, contentWidth, 22, 6).fill(navy);
      doc
        .fillColor("#FFFFFF")
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(title.toUpperCase(), left + 11, y + 7, {
          width: contentWidth - 22,
        });
      doc.y = y + 31;
    };
    const field = (
      name: string,
      caption: string,
      x: number,
      y: number,
      width: number,
      height = 19,
      options: { multiline?: boolean; required?: boolean } = {},
    ) => {
      doc
        .fillColor(muted)
        .font("Helvetica-Bold")
        .fontSize(6.7)
        .text(caption.toUpperCase(), x, y, { width });
      doc
        .roundedRect(x, y + 10, width, height, 4)
        .lineWidth(0.65)
        .fillAndStroke("#FFFFFF", border);
      doc
        .font("Helvetica")
        .formText(name, x + 1, y + 11, width - 2, height - 2, {
          color: ink,
          fontSize: 8,
          multiline: options.multiline,
          required: options.required,
        });
    };
    const checkbox = (name: string, caption: string, x: number, y: number) => {
      doc.rect(x, y, 11, 11).lineWidth(0.8).fillAndStroke("#FFFFFF", blue);
      doc.font("Helvetica").formCheckbox(name, x, y, 11, 11, {});
      doc
        .fillColor(ink)
        .font("Helvetica")
        .fontSize(7.7)
        .text(caption, x + 16, y + 2, { width: 92 });
    };
    const footer = (page: number, total: number) => {
      doc
        .moveTo(left, footerLineY)
        .lineTo(pageWidth - left, footerLineY)
        .strokeColor(border)
        .lineWidth(0.5)
        .stroke();
      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(7)
        .text(
          `${company.name} - Formulaire contrôlé de demande d'achat`,
          left,
          footerTextY,
          { width: contentWidth / 2, lineBreak: false },
        );
      doc.text(
        `Page ${page} / ${total}`,
        left + contentWidth / 2,
        footerTextY,
        { width: contentWidth / 2, align: "right", lineBreak: false },
      );
    };

    drawHeader("DEMANDE D'ACHAT", "FORMULAIRE REMPLISSABLE - EMPLOYÉ");
    section("1. Informations du demandeur");
    const half = (contentWidth - 12) / 2;
    const third = (contentWidth - 24) / 3;
    let y = doc.y;
    field(
      "requester_full_name",
      "Nom complet du demandeur",
      left,
      y,
      half,
      19,
      { required: true },
    );
    field("request_date", "Date de la demande", left + half + 12, y, half, 19, {
      required: true,
    });
    y += 42;
    field("requester_department", "Service / département", left, y, third, 19);
    field("requester_phone", "Téléphone", left + third + 12, y, third, 19);
    field("requester_email", "E-mail", left + (third + 12) * 2, y, third, 19);
    doc.y = y + 43;

    section("2. Besoin et priorité");
    y = doc.y;
    field("request_site", "Site / lieu concerné", left, y, half, 19, {
      required: true,
    });
    field(
      "request_required_date",
      "Date nécessaire",
      left + half + 12,
      y,
      half,
      19,
    );
    y += 42;
    field(
      "request_project",
      "Projet ou activité concerné(e)",
      left,
      y,
      contentWidth,
      19,
    );
    y += 42;
    doc
      .fillColor(muted)
      .font("Helvetica-Bold")
      .fontSize(6.7)
      .text("PRIORITÉ", left, y, { width: contentWidth });
    checkbox("priority_low", "Faible", left, y + 11);
    checkbox("priority_medium", "Moyenne", left + 115, y + 11);
    checkbox("priority_high", "Élevée", left + 230, y + 11);
    checkbox("priority_critical", "Critique", left + 345, y + 11);
    doc.y = y + 35;

    section("3. Articles demandés");
    y = doc.y;
    const columns = [
      { label: "ARTICLE / DESCRIPTION", width: 238 },
      { label: "UNITÉ", width: 58 },
      { label: "QTÉ", width: 58 },
      { label: "COÛT ESTIMÉ", width: 157 },
    ];
    let x = left;
    doc.rect(left, y, contentWidth, 19).fill(blue);
    columns.forEach((column) => {
      doc
        .fillColor("#FFFFFF")
        .font("Helvetica-Bold")
        .fontSize(6.8)
        .text(column.label, x + 6, y + 6, {
          width: column.width - 12,
          align: column.label === "ARTICLE / DESCRIPTION" ? "left" : "center",
          lineBreak: false,
        });
      x += column.width;
    });
    y += 19;
    for (let index = 1; index <= 4; index += 1) {
      x = left;
      const rowHeight = 31;
      doc
        .rect(left, y, contentWidth, rowHeight)
        .lineWidth(0.45)
        .fillAndStroke("#FFFFFF", border);
      const inputNames = [
        `item_${index}_description`,
        `item_${index}_unit`,
        `item_${index}_quantity`,
        `item_${index}_estimated_cost`,
      ];
      columns.forEach((column, columnIndex) => {
        doc
          .font("Helvetica")
          .formText(
            inputNames[columnIndex]!,
            x + 2,
            y + 3,
            column.width - 4,
            rowHeight - 6,
            {
              borderColor: "#FFFFFF",
              backgroundColor: "#FFFFFF",
              color: ink,
              fontSize: 8,
              required: index === 1 && columnIndex < 3,
              align: columnIndex === 0 ? "left" : "right",
            },
          );
        if (columnIndex > 0)
          doc
            .moveTo(x, y)
            .lineTo(x, y + rowHeight)
            .strokeColor(border)
            .lineWidth(0.35)
            .stroke();
        x += column.width;
      });
      y += rowHeight;
    }
    doc.y = y + 11;
    field(
      "request_reason",
      "Motif / justification de l'achat",
      left,
      doc.y,
      contentWidth,
      44,
      { multiline: true, required: true },
    );
    doc.y += 69;
    field(
      "requester_signature",
      "Nom / signature du demandeur",
      left,
      doc.y,
      half,
      20,
      { required: true },
    );
    field(
      "requester_signature_date",
      "Date",
      left + half + 12,
      doc.y,
      half,
      20,
      { required: true },
    );

    doc.addPage();
    drawHeader("DÉCISION DU PROPRIÉTAIRE", "PARTIE RÉSERVÉE À L'APPROBATION");
    section("4. Référence et décision");
    y = doc.y;
    field(
      "official_request_reference",
      "Référence DA LiteHubs (après enregistrement)",
      left,
      y,
      half,
      19,
    );
    field(
      "owner_decision_date",
      "Date de décision",
      left + half + 12,
      y,
      half,
      19,
    );
    y += 43;
    doc
      .fillColor(muted)
      .font("Helvetica-Bold")
      .fontSize(6.7)
      .text("DÉCISION", left, y, { width: contentWidth });
    checkbox("owner_decision_approved", "Approuvée", left, y + 11);
    checkbox("owner_decision_partial", "Partielle", left + 125, y + 11);
    checkbox("owner_decision_rejected", "Refusée", left + 250, y + 11);
    doc.y = y + 37;

    section("5. Articles validés par le propriétaire");
    y = doc.y;
    const approvalColumns = [
      { label: "ARTICLE / DESCRIPTION", width: 244 },
      { label: "QTÉ APPROUVÉE", width: 104 },
      { label: "COÛT UNIT. APPROUVÉ", width: 163 },
    ];
    x = left;
    doc.rect(left, y, contentWidth, 19).fill(blue);
    approvalColumns.forEach((column) => {
      doc
        .fillColor("#FFFFFF")
        .font("Helvetica-Bold")
        .fontSize(6.8)
        .text(column.label, x + 6, y + 6, {
          width: column.width - 12,
          align: column.label === "ARTICLE / DESCRIPTION" ? "left" : "center",
          lineBreak: false,
        });
      x += column.width;
    });
    y += 19;
    for (let index = 1; index <= 4; index += 1) {
      x = left;
      const rowHeight = 32;
      doc
        .rect(left, y, contentWidth, rowHeight)
        .lineWidth(0.45)
        .fillAndStroke("#FFFFFF", border);
      const inputNames = [
        `owner_item_${index}_description`,
        `owner_item_${index}_approved_quantity`,
        `owner_item_${index}_approved_cost`,
      ];
      approvalColumns.forEach((column, columnIndex) => {
        doc
          .font("Helvetica")
          .formText(
            inputNames[columnIndex]!,
            x + 2,
            y + 3,
            column.width - 4,
            rowHeight - 6,
            {
              borderColor: "#FFFFFF",
              backgroundColor: "#FFFFFF",
              color: ink,
              fontSize: 8,
              align: columnIndex === 0 ? "left" : "right",
            },
          );
        if (columnIndex > 0)
          doc
            .moveTo(x, y)
            .lineTo(x, y + rowHeight)
            .strokeColor(border)
            .lineWidth(0.35)
            .stroke();
        x += column.width;
      });
      y += rowHeight;
    }
    doc.y = y + 12;
    field(
      "owner_decision_notes",
      "Décision, conditions ou motifs",
      left,
      doc.y,
      contentWidth,
      58,
      { multiline: true },
    );
    doc.y += 83;
    field(
      "owner_name_signature",
      "Nom / signature du propriétaire autorisé",
      left,
      doc.y,
      half,
      20,
      { required: true },
    );
    field("owner_signature_date", "Date", left + half + 12, doc.y, half, 20, {
      required: true,
    });
    doc.y += 47;
    doc.roundedRect(left, doc.y, contentWidth, 42, 7).fill(pale);
    doc
      .fillColor(navy)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text("ENREGISTREMENT DANS LITEHUBS", left + 12, doc.y + 10, {
        width: contentWidth - 24,
      });
    doc
      .fillColor(ink)
      .font("Helvetica")
      .fontSize(7.7)
      .text(
        "Après validation, le propriétaire crée ou met à jour la demande dans Achats. LiteHubs attribue automatiquement la référence DA et conserve la piste d'audit.",
        left + 12,
        doc.y + 22,
        { width: contentWidth - 24, lineGap: 1 },
      );

    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index += 1) {
      doc.switchToPage(pages.start + index);
      footer(index + 1, pages.count);
    }
    doc.end();
  });
}

type OwnerProcurementFormKind = "purchase-order" | "receipt";

/** Owner-only printable forms; official records remain in LiteHubs. */
export async function ownerProcurementFormPdf(
  company: ProcurementPdfCompany,
  kind: OwnerProcurementFormKind,
  provisionalReference: string,
): Promise<Buffer> {
  const logo = await procurementPdfLogo(company.logoUrl);
  const navy = "#233A7A";
  const blue = "#2563EB";
  const pale = "#EFF4FF";
  const ink = "#172033";
  const muted = "#61708B";
  const border = "#C7D2E8";
  const initials =
    company.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.slice(0, 1).toUpperCase())
      .join("") || "LH";
  const isOrder = kind === "purchase-order";
  const title = isOrder ? "BON DE COMMANDE" : "BON DE RÉCEPTION";
  const subtitle = isOrder
    ? "FORMULAIRE REMPLISSABLE - PROPRIÉTAIRE"
    : "FORMULAIRE REMPLISSABLE - RÉCEPTION";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 42,
      bufferPages: true,
      info: {
        Title: `${title} - ${company.name}`,
        Author: company.name,
        Subject: `Formulaire remplissable ${title.toLowerCase()}`,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.initForm();
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const left = doc.page.margins.left;
    const contentWidth = pageWidth - left * 2;
    const half = (contentWidth - 12) / 2;
    const header = () => {
      doc.rect(0, 0, pageWidth, 17).fill(navy);
      doc.roundedRect(left, 33, 48, 48, 11).fill("#FFFFFF");
      if (logo) {
        try {
          doc.image(logo, left + 6, 39, { fit: [36, 36] });
        } catch {
          doc
            .fillColor(navy)
            .font("Helvetica-Bold")
            .fontSize(15)
            .text(initials, left, 49, { width: 48, align: "center" });
        }
      } else
        doc
          .fillColor(navy)
          .font("Helvetica-Bold")
          .fontSize(15)
          .text(initials, left, 49, { width: 48, align: "center" });
      doc
        .fillColor(ink)
        .font("Helvetica-Bold")
        .fontSize(15)
        .text(company.name, left + 60, 39, { width: 230, ellipsis: true });
      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(7.5)
        .text(
          company.address || "Adresse officielle non renseignée",
          left + 60,
          59,
          { width: 240, height: 25, ellipsis: true },
        );
      doc
        .fillColor(navy)
        .font("Helvetica-Bold")
        .fontSize(16)
        .text(title, pageWidth - left - 258, 38, {
          width: 258,
          align: "right",
        });
      doc
        .fillColor(blue)
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(subtitle, pageWidth - left - 258, 62, {
          width: 258,
          align: "right",
        });
      doc
        .fillColor(muted)
        .font("Helvetica-Bold")
        .fontSize(7)
        .text(
          `RÉF. PRÉVISIONNELLE : ${provisionalReference}`,
          pageWidth - left - 258,
          76,
          { width: 258, align: "right" },
        );
      doc
        .moveTo(left, 101)
        .lineTo(pageWidth - left, 101)
        .strokeColor(border)
        .lineWidth(0.7)
        .stroke();
      doc.y = 118;
    };
    const section = (heading: string) => {
      const y = doc.y;
      doc.roundedRect(left, y, contentWidth, 22, 6).fill(navy);
      doc
        .fillColor("#FFFFFF")
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(heading.toUpperCase(), left + 11, y + 7, {
          width: contentWidth - 22,
        });
      doc.y = y + 31;
    };
    const field = (
      name: string,
      caption: string,
      x: number,
      y: number,
      width: number,
      height = 19,
      options: { multiline?: boolean; required?: boolean } = {},
    ) => {
      doc
        .fillColor(muted)
        .font("Helvetica-Bold")
        .fontSize(6.7)
        .text(caption.toUpperCase(), x, y, { width });
      doc
        .roundedRect(x, y + 10, width, height, 4)
        .lineWidth(0.65)
        .fillAndStroke("#FFFFFF", border);
      doc
        .font("Helvetica")
        .formText(name, x + 1, y + 11, width - 2, height - 2, {
          color: ink,
          fontSize: 8,
          multiline: options.multiline,
          required: options.required,
        });
    };
    const check = (name: string, caption: string, x: number, y: number) => {
      doc.rect(x, y, 11, 11).lineWidth(0.8).fillAndStroke("#FFFFFF", blue);
      doc.font("Helvetica").formCheckbox(name, x, y, 11, 11, {});
      doc
        .fillColor(ink)
        .font("Helvetica")
        .fontSize(7.7)
        .text(caption, x + 16, y + 2, { width: 95 });
    };
    const table = (
      prefix: string,
      columns: Array<{ label: string; width: number }>,
    ) => {
      let y = doc.y;
      let x = left;
      doc.rect(left, y, contentWidth, 19).fill(blue);
      columns.forEach((column, index) => {
        doc
          .fillColor("#FFFFFF")
          .font("Helvetica-Bold")
          .fontSize(6.4)
          .text(column.label, x + 5, y + 6, {
            width: column.width - 10,
            align: index === 0 ? "left" : "center",
            lineBreak: false,
          });
        x += column.width;
      });
      y += 19;
      for (let row = 1; row <= 4; row += 1) {
        x = left;
        const rowHeight = 29;
        doc
          .rect(left, y, contentWidth, rowHeight)
          .lineWidth(0.45)
          .fillAndStroke("#FFFFFF", border);
        columns.forEach((column, index) => {
          doc
            .font("Helvetica")
            .formText(
              `${prefix}_${row}_${index + 1}`,
              x + 2,
              y + 3,
              column.width - 4,
              rowHeight - 6,
              {
                borderColor: "#FFFFFF",
                backgroundColor: "#FFFFFF",
                color: ink,
                fontSize: 8,
                align: index === 0 ? "left" : "right",
                required: row === 1 && index < 3,
              },
            );
          if (index > 0)
            doc
              .moveTo(x, y)
              .lineTo(x, y + rowHeight)
              .strokeColor(border)
              .lineWidth(0.35)
              .stroke();
          x += column.width;
        });
        y += rowHeight;
      }
      doc.y = y + 11;
    };
    const footer = () => {
      const lineY = pageHeight - 84;
      const textY = pageHeight - 74;
      doc
        .moveTo(left, lineY)
        .lineTo(pageWidth - left, lineY)
        .strokeColor(border)
        .lineWidth(0.5)
        .stroke();
      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(7)
        .text(`${company.name} - ${title} contrôlé`, left, textY, {
          width: contentWidth / 2,
          lineBreak: false,
        });
      doc.text("Page 1 / 1", left + contentWidth / 2, textY, {
        width: contentWidth / 2,
        align: "right",
        lineBreak: false,
      });
    };

    header();
    if (isOrder) {
      section("1. Fournisseur et livraison");
      let y = doc.y;
      field("po_order_date", "Date de commande", left, y, half, 19, {
        required: true,
      });
      field("po_supplier_name", "Fournisseur", left + half + 12, y, half, 19, {
        required: true,
      });
      y += 42;
      field("po_supplier_contact", "Personne de contact", left, y, half, 19);
      field(
        "po_supplier_phone",
        "Téléphone / e-mail",
        left + half + 12,
        y,
        half,
        19,
      );
      y += 42;
      field(
        "po_delivery_address",
        "Adresse / site de livraison",
        left,
        y,
        half,
        19,
        { required: true },
      );
      field(
        "po_expected_delivery",
        "Livraison prévue",
        left + half + 12,
        y,
        half,
        19,
      );
      y += 42;
      field("po_project", "Projet, activité ou département", left, y, half, 19);
      field(
        "po_source_request",
        "Référence DA approuvée",
        left + half + 12,
        y,
        half,
        19,
      );
      doc.y = y + 43;
      const currencyY = doc.y;
      doc
        .fillColor(muted)
        .font("Helvetica-Bold")
        .fontSize(6.7)
        .text("DEVISE", left, currencyY, { width: 100 });
      check("po_currency_cdf", "CDF", left, currencyY + 11);
      check("po_currency_usd", "USD", left + 105, currencyY + 11);
      check("po_currency_eur", "EUR", left + 210, currencyY + 11);
      doc.y = currencyY + 35;
      section("2. Articles commandés");
      table("po_item", [
        { label: "ARTICLE / DESCRIPTION", width: 202 },
        { label: "UNITÉ", width: 55 },
        { label: "QTÉ", width: 55 },
        { label: "PRIX UNIT.", width: 100 },
        { label: "TAXES / TOTAL", width: 99 },
      ]);
      field(
        "po_notes",
        "Conditions, consignes ou notes",
        left,
        doc.y,
        contentWidth,
        38,
        { multiline: true },
      );
      doc.y += 62;
      field(
        "po_owner_name",
        "Nom du propriétaire autorisé",
        left,
        doc.y,
        half,
        20,
        { required: true },
      );
      field(
        "po_owner_signature",
        "Signature et date",
        left + half + 12,
        doc.y,
        half,
        20,
        { required: true },
      );
    } else {
      section("1. Réception et traçabilité");
      let y = doc.y;
      field("br_received_date", "Date de réception", left, y, half, 19, {
        required: true,
      });
      field(
        "br_purchase_order",
        "Référence bon de commande",
        left + half + 12,
        y,
        half,
        19,
        { required: true },
      );
      y += 42;
      field(
        "br_delivery_note",
        "Bon de livraison fournisseur",
        left,
        y,
        half,
        19,
      );
      field(
        "br_warehouse",
        "Entrepôt / lieu de stockage",
        left + half + 12,
        y,
        half,
        19,
      );
      y += 42;
      field("br_supplier", "Fournisseur", left, y, half, 19, {
        required: true,
      });
      field(
        "br_project",
        "Projet, site ou activité",
        left + half + 12,
        y,
        half,
        19,
      );
      y += 42;
      field("br_receiver_name", "Nom du réceptionnaire", left, y, half, 19, {
        required: true,
      });
      field(
        "br_receiver_phone",
        "Téléphone / e-mail",
        left + half + 12,
        y,
        half,
        19,
      );
      doc.y = y + 43;
      section("2. Articles réellement reçus");
      table("br_item", [
        { label: "ARTICLE / DESCRIPTION", width: 170 },
        { label: "UNITÉ", width: 42 },
        { label: "CMD.", width: 55 },
        { label: "REÇU", width: 55 },
        { label: "ACCEPTÉ", width: 62 },
        { label: "ABÎMÉ / REFUSÉ", width: 127 },
      ]);
      field(
        "br_notes",
        "Écarts, dommages, refus ou observations",
        left,
        doc.y,
        contentWidth,
        38,
        { multiline: true },
      );
      doc.y += 62;
      field(
        "br_receiver_signature",
        "Signature du réceptionnaire",
        left,
        doc.y,
        half,
        20,
        { required: true },
      );
      field(
        "br_owner_verification",
        "Vérification propriétaire / date",
        left + half + 12,
        doc.y,
        half,
        20,
      );
    }
    doc.roundedRect(left, doc.y + 42, contentWidth, 34, 7).fill(pale);
    doc
      .fillColor(navy)
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .text("ENREGISTREMENT OFFICIEL", left + 11, doc.y + 51, {
        width: contentWidth - 22,
      });
    doc
      .fillColor(ink)
      .font("Helvetica")
      .fontSize(7.2)
      .text(
        "Après remplissage, enregistrez les données finales dans Achats afin que LiteHubs conserve la référence officielle, les articles et la piste d’audit.",
        left + 11,
        doc.y + 62,
        { width: contentWidth - 22 },
      );
    footer();
    doc.end();
  });
}

async function inventoryManualFormCompany(
  context: OwnerManagementContext,
): Promise<ProcurementPdfCompany> {
  return withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      "SELECT COALESCE(o.display_name, o.legal_name, o.slug) AS name, o.address_line1, o.address_line2, o.city, o.region, o.postal_code, settings.logo_url FROM organizations o LEFT JOIN organization_settings settings ON settings.organization_id = o.id WHERE o.id = $1",
      [context.organizationId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError("Organization not found");
    const address = [
      row.address_line1,
      row.address_line2,
      [row.city, row.region, row.postal_code].filter(Boolean).join(", "),
    ]
      .filter(Boolean)
      .map((value) => String(value).trim())
      .filter(Boolean)
      .join("\n");
    return {
      name: String(row.name ?? "Entreprise").trim() || "Entreprise",
      address,
      logoUrl: (row.logo_url as string | null) ?? null,
    };
  });
}

async function inventoryManualStockFormPdf(
  company: ProcurementPdfCompany,
  kind: "issue" | "transfer",
): Promise<Buffer> {
  const logo = await procurementPdfLogo(company.logoUrl);
  const navy = "#233A7A";
  const blue = "#2563EB";
  const pale = "#EFF4FF";
  const ink = "#172033";
  const muted = "#61708B";
  const border = "#C7D2E8";
  const isTransfer = kind === "transfer";
  const title = isTransfer ? "TRANSFERT DE STOCK" : "SORTIE DE STOCK";
  const subtitle = isTransfer
    ? "FORMULAIRE REMPLISSABLE - ENTRE ENTREPÔTS"
    : "FORMULAIRE REMPLISSABLE - SORTIE MANUELLE";
  const initials =
    company.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.slice(0, 1).toUpperCase())
      .join("") || "LH";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 42,
      bufferPages: true,
      info: {
        Title: `${title} - ${company.name}`,
        Author: company.name,
        Subject: `Formulaire remplissable ${title.toLowerCase()}`,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.initForm();

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const left = doc.page.margins.left;
    const contentWidth = pageWidth - left * 2;
    const half = (contentWidth - 12) / 2;
    const third = (contentWidth - 24) / 3;
    const field = (
      name: string,
      label: string,
      x: number,
      y: number,
      width: number,
      height = 19,
      options: { multiline?: boolean; required?: boolean } = {},
    ) => {
      doc
        .fillColor(muted)
        .font("Helvetica-Bold")
        .fontSize(6.7)
        .text(label.toUpperCase(), x, y, { width });
      doc
        .roundedRect(x, y + 10, width, height, 4)
        .lineWidth(0.65)
        .fillAndStroke("#FFFFFF", border);
      doc
        .font("Helvetica")
        .formText(name, x + 1, y + 11, width - 2, height - 2, {
          color: ink,
          fontSize: 8,
          multiline: options.multiline,
          required: options.required,
        });
    };
    const section = (heading: string) => {
      const y = doc.y;
      doc.roundedRect(left, y, contentWidth, 22, 6).fill(navy);
      doc
        .fillColor("#FFFFFF")
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(heading.toUpperCase(), left + 11, y + 7, {
          width: contentWidth - 22,
        });
      doc.y = y + 31;
    };
    const header = () => {
      doc.rect(0, 0, pageWidth, 17).fill(navy);
      doc.roundedRect(left, 33, 48, 48, 11).fill("#FFFFFF");
      if (logo) {
        try {
          doc.image(logo, left + 6, 39, { fit: [36, 36] });
        } catch {
          doc
            .fillColor(navy)
            .font("Helvetica-Bold")
            .fontSize(15)
            .text(initials, left, 49, { width: 48, align: "center" });
        }
      } else
        doc
          .fillColor(navy)
          .font("Helvetica-Bold")
          .fontSize(15)
          .text(initials, left, 49, { width: 48, align: "center" });
      doc
        .fillColor(ink)
        .font("Helvetica-Bold")
        .fontSize(15)
        .text(company.name, left + 60, 39, { width: 230, ellipsis: true });
      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(7.5)
        .text(
          company.address || "Adresse officielle non renseignée",
          left + 60,
          59,
          { width: 240, height: 25, ellipsis: true },
        );
      doc
        .fillColor(navy)
        .font("Helvetica-Bold")
        .fontSize(16)
        .text(title, pageWidth - left - 258, 38, {
          width: 258,
          align: "right",
        });
      doc
        .fillColor(blue)
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(subtitle, pageWidth - left - 258, 62, {
          width: 258,
          align: "right",
        });
      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(7)
        .text(
          "Référence LiteHubs attribuée lors de la saisie",
          pageWidth - left - 258,
          76,
          { width: 258, align: "right" },
        );
      doc
        .moveTo(left, 101)
        .lineTo(pageWidth - left, 101)
        .strokeColor(border)
        .lineWidth(0.7)
        .stroke();
      doc.y = 118;
    };
    header();
    section("1. Identification de l’opération");
    let y = doc.y;
    field("operation_date", "Date de l’opération", left, y, half, 19, {
      required: true,
    });
    field(
      "paper_reference",
      "Référence interne papier",
      left + half + 12,
      y,
      half,
      19,
    );
    y += 42;
    field("prepared_by", "Préparé par", left, y, third, 19, { required: true });
    field("department", "Service / équipe", left + third + 12, y, third, 19);
    field("phone", "Téléphone", left + (third + 12) * 2, y, third, 19);
    doc.y = y + 43;

    section(
      isTransfer
        ? "2. Magasin de départ et magasin d’arrivée"
        : "2. Magasin et destination de la sortie",
    );
    y = doc.y;
    field(
      isTransfer ? "source_warehouse" : "issue_warehouse",
      isTransfer ? "Entrepôt de départ" : "Entrepôt / magasin",
      left,
      y,
      half,
      19,
      { required: true },
    );
    field(
      isTransfer ? "destination_warehouse" : "issue_destination",
      isTransfer ? "Entrepôt d’arrivée" : "Destination / service bénéficiaire",
      left + half + 12,
      y,
      half,
      19,
      { required: true },
    );
    y += 42;
    field(
      "source_site",
      isTransfer ? "Site de départ" : "Site concerné",
      left,
      y,
      half,
      19,
    );
    field(
      "destination_site",
      isTransfer ? "Site d’arrivée" : "Projet ou tâche concerné(e)",
      left + half + 12,
      y,
      half,
      19,
    );
    doc.y = y + 43;

    section("3. Article et quantité");
    y = doc.y;
    field("item_code", "Code article / SKU", left, y, third, 19);
    field(
      "item_name",
      "Article / désignation",
      left + third + 12,
      y,
      third,
      19,
      { required: true },
    );
    field("unit", "Unité", left + (third + 12) * 2, y, third, 19, {
      required: true,
    });
    y += 42;
    field(
      "quantity",
      isTransfer ? "Quantité transférée" : "Quantité sortie",
      left,
      y,
      half,
      19,
      { required: true },
    );
    field(
      "current_balance",
      "Solde observé avant opération",
      left + half + 12,
      y,
      half,
      19,
    );
    doc.y = y + 43;
    field(
      "reason",
      isTransfer ? "Motif du transfert" : "Motif de la sortie",
      left,
      doc.y,
      contentWidth,
      45,
      { multiline: true, required: true },
    );
    doc.y += 70;

    section("4. Contrôle et signatures");
    y = doc.y;
    field(
      "requester_signature",
      isTransfer
        ? "Nom / signature de l’expéditeur"
        : "Nom / signature du demandeur",
      left,
      y,
      half,
      20,
      { required: true },
    );
    field(
      "authorizer_signature",
      "Responsable autorisant la sortie",
      left + half + 12,
      y,
      half,
      20,
      { required: true },
    );
    y += 43;
    field(
      "receiver_signature",
      isTransfer
        ? "Nom / signature du réceptionnaire"
        : "Personne ayant reçu les articles",
      left,
      y,
      half,
      20,
    );
    field(
      "recorded_by",
      "Saisi dans LiteHubs par / date",
      left + half + 12,
      y,
      half,
      20,
    );
    doc.y = y + 47;
    doc.roundedRect(left, doc.y, contentWidth, 46, 7).fill(pale);
    doc
      .fillColor(navy)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text("SAISIE OFFICIELLE DANS LITEHUBS", left + 12, doc.y + 10, {
        width: contentWidth - 24,
      });
    doc
      .fillColor(ink)
      .font("Helvetica")
      .fontSize(7.5)
      .text(
        isTransfer
          ? "Après signature, utilisez Transférer dans Inventaire. LiteHubs créera une sortie dans le magasin de départ et une entrée liée dans le magasin d’arrivée."
          : "Après signature, utilisez Sortie de stock dans Inventaire. LiteHubs contrôlera le solde disponible et conservera le motif dans l’historique.",
        left + 12,
        doc.y + 22,
        { width: contentWidth - 24, lineGap: 1 },
      );

    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index += 1) {
      doc.switchToPage(pages.start + index);
      const footerLineY = pageHeight - 84;
      const footerTextY = pageHeight - 74;
      doc
        .moveTo(left, footerLineY)
        .lineTo(pageWidth - left, footerLineY)
        .strokeColor(border)
        .lineWidth(0.5)
        .stroke();
      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(7)
        .text(
          `${company.name} - ${title} - Document manuel contrôlé`,
          left,
          footerTextY,
          { width: contentWidth / 2, lineBreak: false },
        );
      doc.text(
        `Page ${index + 1} / ${pages.count}`,
        left + contentWidth / 2,
        footerTextY,
        { width: contentWidth / 2, align: "right", lineBreak: false },
      );
    }
    doc.end();
  });
}

export async function exportInventoryStockIssueFormPdf(
  context: OwnerManagementContext,
): Promise<{ filename: string; buffer: Buffer }> {
  const company = await inventoryManualFormCompany(context);
  return {
    filename: "formulaire-sortie-stock-remplissable.pdf",
    buffer: await inventoryManualStockFormPdf(company, "issue"),
  };
}

export async function exportInventoryStockTransferFormPdf(
  context: OwnerManagementContext,
): Promise<{ filename: string; buffer: Buffer }> {
  const company = await inventoryManualFormCompany(context);
  return {
    filename: "formulaire-transfert-stock-remplissable.pdf",
    buffer: await inventoryManualStockFormPdf(company, "transfer"),
  };
}
async function ownerProcurementFormCompany(
  context: OwnerManagementContext,
  kind: OwnerProcurementFormKind,
): Promise<{ company: ProcurementPdfCompany; provisionalReference: string }> {
  return withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      "SELECT COALESCE(o.display_name, o.legal_name, o.slug) AS name, o.address_line1, o.address_line2, o.city, o.region, o.postal_code, settings.logo_url FROM organizations o LEFT JOIN organization_settings settings ON settings.organization_id = o.id WHERE o.id = $1",
      [context.organizationId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError("Organization not found");
    const address = [
      row.address_line1,
      row.address_line2,
      [row.city, row.region, row.postal_code].filter(Boolean).join(", "),
    ]
      .filter(Boolean)
      .map((value) => String(value).trim())
      .filter(Boolean)
      .join("\n");
    const sequence = await client.query<Row>(
      kind === "purchase-order"
        ? "SELECT COALESCE(MAX(CASE WHEN order_number ~ '^BC-[0-9]+$' THEN substring(order_number FROM 4)::integer ELSE 0 END), 0) + 1 AS next_number FROM management_purchase_orders WHERE organization_id = $1"
        : "SELECT COALESCE(MAX(CASE WHEN receipt_number ~ '^BR-[0-9]+$' THEN substring(receipt_number FROM 4)::integer ELSE 0 END), 0) + 1 AS next_number FROM management_receipts WHERE organization_id = $1",
      [context.organizationId],
    );
    const prefix = kind === "purchase-order" ? "BC" : "BR";
    return {
      company: {
        name: String(row.name ?? "Entreprise").trim() || "Entreprise",
        address,
        logoUrl: (row.logo_url as string | null) ?? null,
      } satisfies ProcurementPdfCompany,
      provisionalReference: `${prefix}-${String(Number(sequence.rows[0]?.next_number ?? 1)).padStart(6, "0")}`,
    };
  });
}

export async function exportPurchaseOrderFormPdf(
  context: OwnerManagementContext,
): Promise<{ filename: string; buffer: Buffer }> {
  const { company, provisionalReference } = await ownerProcurementFormCompany(
    context,
    "purchase-order",
  );
  return {
    filename: "formulaire-bon-commande-remplissable.pdf",
    buffer: await ownerProcurementFormPdf(
      company,
      "purchase-order",
      provisionalReference,
    ),
  };
}

export async function exportReceiptFormPdf(
  context: OwnerManagementContext,
): Promise<{ filename: string; buffer: Buffer }> {
  const { company, provisionalReference } = await ownerProcurementFormCompany(
    context,
    "receipt",
  );
  return {
    filename: "formulaire-bon-reception-remplissable.pdf",
    buffer: await ownerProcurementFormPdf(
      company,
      "receipt",
      provisionalReference,
    ),
  };
}
export async function exportPurchaseRequestFormPdf(
  context: OwnerManagementContext,
): Promise<{ filename: string; buffer: Buffer }> {
  const { company, provisionalReference } = await withTenantContext(
    context,
    async (client) => {
      const result = await client.query<Row>(
        "SELECT COALESCE(o.display_name, o.legal_name, o.slug) AS name, o.address_line1, o.address_line2, o.city, o.region, o.postal_code, settings.logo_url FROM organizations o LEFT JOIN organization_settings settings ON settings.organization_id = o.id WHERE o.id = $1",
        [context.organizationId],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundError("Organization not found");
      const address = [
        row.address_line1,
        row.address_line2,
        [row.city, row.region, row.postal_code].filter(Boolean).join(", "),
      ]
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter(Boolean)
        .join("\n");
      const counter = await client.query<Row>(
        "SELECT last_number FROM management_purchase_request_number_counters WHERE organization_id = $1",
        [context.organizationId],
      );
      const nextNumber = Number(counter.rows[0]?.last_number ?? 0) + 1;
      return {
        company: {
          name: String(row.name ?? "Entreprise").trim() || "Entreprise",
          address,
          logoUrl: (row.logo_url as string | null) ?? null,
        } satisfies ProcurementPdfCompany,
        provisionalReference: `DA-${String(nextNumber).padStart(6, "0")}`,
      };
    },
  );
  return {
    filename: "formulaire-demande-achat-remplissable.pdf",
    buffer: await purchaseRequestFormPdf(company, provisionalReference),
  };
}
export async function exportProcurementDocumentPdf(
  context: OwnerManagementContext,
  documentType: ProcurementDocumentType,
  recordId: string,
): Promise<{ filename: string; buffer: Buffer }> {
  const data = await procurementDocumentData(context, documentType, recordId);
  const meta = PROCUREMENT_DOCUMENT_META[documentType];
  const reference = procurementPdfValue(data.record[meta.referenceKey]).replace(
    /[^A-Za-z0-9_-]/g,
    "-",
  );
  return {
    filename: `${meta.filenamePrefix}-${reference}.pdf`,
    buffer: await procurementDocumentPdf(
      data.company,
      documentType,
      data.record,
      data.lines,
    ),
  };
}
interface PdfColumn {
  label: string;
  key: string;
  width: number;
}

function projectBenefitTargetsPdfText(summary: Row): string {
  const targets = summary.benefitTargets;
  if (!targets || typeof targets !== "object" || Array.isArray(targets))
    return "";
  const value = targets as Record<string, unknown>;
  const period: Record<string, string> = {
    daily: "jour",
    weekly: "semaine",
    monthly: "mois",
    cycle: "cycle",
  };
  const entries: string[] = [];
  const quantity = Number(value.targetProductionQuantity);
  if (Number.isFinite(quantity) && quantity >= 0)
    entries.push(
      `Production: ${quantity.toLocaleString("fr-FR")} ${pdfText(value.targetProductionUnit, 30)} / ${period[String(value.targetProductionPeriod)] ?? pdfText(value.targetProductionPeriod, 20)}`,
    );
  const sales = Number(value.targetSalesAmount);
  if (Number.isFinite(sales) && sales >= 0)
    entries.push(`Ventes: ${pdfMoney(sales, summary.currencyCode)}`);
  const margin = Number(value.targetMarginPercent);
  if (Number.isFinite(margin) && margin >= 0) entries.push(`Marge: ${margin}%`);
  const mortality = Number(value.targetMortalityPercent);
  if (Number.isFinite(mortality) && mortality >= 0)
    entries.push(`Mortalité maximum: ${mortality}%`);
  const unitCost = Number(value.targetUnitCost);
  if (Number.isFinite(unitCost) && unitCost >= 0)
    entries.push(`Coût unitaire: ${pdfMoney(unitCost, summary.currencyCode)}`);
  return entries.join(" · ");
}

function projectPdfBuffer(
  companyName: string,
  summary: Row,
  data: {
    phases: Row[];
    tasks: Row[];
    budgets: Row[];
    materials: Row[];
    requests: Row[];
    orders: Row[];
    receipts: Row[];
    expenses: Row[];
    assets: Row[];
    documents: Row[];
    activity: Row[];
  },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      margins: { top: 48, bottom: 52, left: 42, right: 42 },
      bufferPages: true,
      info: {
        Title: `${pdfText(summary.name, 80)} - Rapport du projet`,
        Author: companyName,
        Subject: "Rapport de pilotage de projet",
      },
    });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));

    const pageWidth = document.page.width;
    const contentWidth =
      pageWidth - document.page.margins.left - document.page.margins.right;
    const bottom = document.page.height - document.page.margins.bottom;
    const brand = "#14532D";
    const ink = "#102A24";
    const muted = "#5B6D67";
    const pale = "#EFF7F1";

    const header = () => {
      document.save();
      document.rect(0, 0, pageWidth, 32).fill(brand);
      document
        .fillColor("#FFFFFF")
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(
          `${companyName.toLocaleUpperCase("fr-FR").slice(0, 54)} · RAPPORT DE PROJET`,
          42,
          11,
          { lineBreak: false },
        );
      document.restore();
      document.x = document.page.margins.left;
      document.y = document.page.margins.top;
    };
    const page = () => {
      document.addPage();
      header();
    };
    const ensure = (height: number) => {
      if (document.y + height > bottom) page();
    };
    const section = (title: string, subtitle?: string) => {
      ensure(subtitle ? 52 : 32);
      document.fillColor(brand).font("Helvetica-Bold").fontSize(13).text(title);
      if (subtitle)
        document
          .fillColor(muted)
          .font("Helvetica")
          .fontSize(8.5)
          .text(subtitle, {
            width: contentWidth,
          });
      document.moveDown(0.65);
    };
    const metricGrid = (metrics: Array<{ label: string; value: string }>) => {
      const gap = 10;
      const width = (contentWidth - gap) / 2;
      for (let index = 0; index < metrics.length; index += 2) {
        ensure(68);
        const y = document.y;
        for (let cell = 0; cell < 2; cell += 1) {
          const metric = metrics[index + cell];
          if (!metric) continue;
          const x = document.page.margins.left + cell * (width + gap);
          document.roundedRect(x, y, width, 56, 7).fill(pale);
          document
            .fillColor(muted)
            .font("Helvetica-Bold")
            .fontSize(7.5)
            .text(metric.label.toUpperCase(), x + 10, y + 10, {
              width: width - 20,
            });
          document
            .fillColor(ink)
            .font("Helvetica-Bold")
            .fontSize(15)
            .text(metric.value, x + 10, y + 25, {
              width: width - 20,
              ellipsis: true,
            });
        }
        document.y = y + 66;
      }
    };
    const table = (title: string, columns: PdfColumn[], rows: Row[]) => {
      section(
        title,
        rows.length ? `${rows.length} élément(s)` : "Aucun élément enregistré",
      );
      if (!rows.length) {
        document
          .fillColor(muted)
          .font("Helvetica-Oblique")
          .fontSize(9)
          .text("Aucune donnée disponible pour cette section.");
        document.moveDown(0.9);
        return;
      }
      const drawHeader = () => {
        ensure(22);
        const y = document.y;
        let x = document.page.margins.left;
        document.rect(x, y, contentWidth, 18).fill(brand);
        for (const column of columns) {
          document
            .fillColor("#FFFFFF")
            .font("Helvetica-Bold")
            .fontSize(7)
            .text(column.label, x + 4, y + 5, {
              width: column.width - 8,
              lineBreak: false,
              ellipsis: true,
            });
          x += column.width;
        }
        document.y = y + 21;
      };
      drawHeader();
      for (const row of rows) {
        const cells = columns.map((column) => pdfText(row[column.key], 96));
        document.font("Helvetica").fontSize(7.5);
        const height =
          Math.max(
            20,
            ...cells.map((cell, index) =>
              document.heightOfString(cell, {
                width: columns[index]!.width - 8,
              }),
            ),
          ) + 8;
        if (document.y + height > bottom) {
          page();
          drawHeader();
        }
        const y = document.y;
        let x = document.page.margins.left;
        document.rect(x, y, contentWidth, height).fill("#FFFFFF");
        document
          .strokeColor("#D8E5DC")
          .lineWidth(0.4)
          .rect(x, y, contentWidth, height)
          .stroke();
        for (let index = 0; index < columns.length; index += 1) {
          const column = columns[index]!;
          document
            .fillColor(ink)
            .font("Helvetica")
            .fontSize(7.5)
            .text(cells[index]!, x + 4, y + 4, {
              width: column.width - 8,
              height: height - 6,
              ellipsis: true,
            });
          x += column.width;
        }
        document.y = y + height;
      }
      document.moveDown(0.8);
    };

    header();
    document
      .fillColor(ink)
      .font("Helvetica-Bold")
      .fontSize(22)
      .text(pdfText(summary.name, 100), { width: contentWidth });
    document
      .fillColor(muted)
      .font("Helvetica")
      .fontSize(9.5)
      .text(
        `Code: ${pdfText(summary.code)}  |  Généré le ${pdfDate(new Date())}`,
        { width: contentWidth },
      );
    document.moveDown(1);

    const budget = (summary.budget as Row | undefined) ?? {};
    metricGrid([
      {
        label: "Budget prévu",
        value: pdfMoney(budget.planned, summary.currencyCode),
      },
      { label: "Dépensé", value: pdfMoney(budget.spent, summary.currencyCode) },
      {
        label: "Engagé",
        value: pdfMoney(budget.committed, summary.currencyCode),
      },
      {
        label: "Disponible",
        value: pdfMoney(budget.available, summary.currencyCode),
      },
      {
        label: "Avancement",
        value: `${Number(summary.calculatedProgressPercent ?? summary.progressPercent ?? 0).toFixed(0)}%`,
      },
      { label: "Statut", value: pdfText(summary.status) },
    ]);

    section("Vue d'ensemble");
    const overview = [
      ["Type", summary.projectType],
      ["Priorité", summary.priority],
      ["Province", summary.provinceName],
      ["Site / ferme", summary.siteName],
      ["Début", pdfDate(summary.startDate)],
      ["Démarrage opérationnel", pdfDate(summary.operationalStartDate)],
      ["Fin prévue", pdfDate(summary.targetCompletionDate)],
      ["Cycle de l’investissement", summary.lifecycleStage],
      ["Objectif", summary.expectedOutcome],
      ["Responsable des bénéfices", summary.benefitOwnerName],
      ["Revue des bénéfices", pdfDate(summary.benefitReviewDate)],
      ["Indicateurs cibles", projectBenefitTargetsPdfText(summary)],
      ["Description", summary.description],
      ["Plan directeur", summary.blueprint],
    ];
    for (const [name, value] of overview) {
      if (!value) continue;
      ensure(30);
      document
        .fillColor(muted)
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(`${name}:`, { continued: true });
      document
        .fillColor(ink)
        .font("Helvetica")
        .fontSize(8.5)
        .text(` ${pdfText(value, 360)}`, { width: contentWidth });
      document.moveDown(0.25);
    }
    document.moveDown(0.5);

    table(
      "Planification",
      [
        { label: "Phase", key: "name", width: 170 },
        { label: "Statut", key: "status", width: 78 },
        { label: "Début", key: "startDate", width: 68 },
        { label: "Fin", key: "targetEndDate", width: 68 },
        { label: "Avancement", key: "progressPercent", width: 78 },
      ],
      data.phases,
    );
    table(
      "Tâches",
      [
        { label: "Tâche", key: "title", width: 190 },
        { label: "Type", key: "taskType", width: 60 },
        { label: "Statut", key: "status", width: 78 },
        { label: "Échéance", key: "dueDate", width: 80 },
        { label: "Avancement", key: "progressPercent", width: 76 },
      ],
      data.tasks,
    );
    table(
      "Budget",
      [
        { label: "Catégorie", key: "category", width: 140 },
        { label: "Description", key: "description", width: 190 },
        { label: "Prévu", key: "plannedAmount", width: 96 },
        { label: "Devise", key: "currencyCode", width: 64 },
      ],
      data.budgets,
    );
    table(
      "Achats",
      [
        { label: "Référence", key: "reference", width: 120 },
        { label: "Type", key: "kind", width: 65 },
        { label: "Statut", key: "status", width: 75 },
        { label: "Date", key: "date", width: 75 },
        { label: "Détail", key: "detail", width: 160 },
      ],
      [
        ...data.requests.map((row) => ({
          id: `request-${row.id}`,
          reference: row.requestNumber,
          kind: "Demande",
          status: row.status,
          date: row.requestDate,
          detail: row.reason,
        })),
        ...data.orders.map((row) => ({
          id: `order-${row.id}`,
          reference: row.orderNumber,
          kind: "Commande",
          status: row.status,
          date: row.orderDate,
          detail: row.expectedDeliveryDate,
        })),
        ...data.receipts.map((row) => ({
          id: `receipt-${row.id}`,
          reference: row.receiptNumber,
          kind: "Réception",
          status: row.status,
          date: row.receivedDate,
          detail: row.deliveryNoteNumber,
        })),
      ],
    );
    table(
      "Dépenses",
      [
        { label: "Référence", key: "expenseNumber", width: 85 },
        { label: "Catégorie", key: "category", width: 85 },
        { label: "Montant", key: "amount", width: 75 },
        { label: "Devise", key: "currencyCode", width: 55 },
        { label: "Statut", key: "status", width: 75 },
        { label: "Date", key: "expenseDate", width: 95 },
      ],
      data.expenses,
    );
    table(
      "Ressources",
      [
        { label: "Nom", key: "name", width: 160 },
        { label: "Type", key: "kind", width: 80 },
        { label: "Catégorie", key: "category", width: 95 },
        { label: "Valeur", key: "value", width: 85 },
        { label: "Unité", key: "unit", width: 80 },
      ],
      [
        ...data.materials.map((row) => ({
          id: `material-${row.id}`,
          name: row.name,
          kind: "Matériel",
          category: row.category,
          value: row.plannedQuantity,
          unit: row.unit,
        })),
        ...data.assets.map((row) => ({
          id: `asset-${row.id}`,
          name: row.name,
          kind: "Équipement",
          category: row.category,
          value: row.purchasePrice,
          unit: row.currencyCode,
        })),
      ],
    );
    table(
      "Documents",
      [
        { label: "Document", key: "title", width: 185 },
        { label: "Catégorie", key: "documentType", width: 105 },
        { label: "Type", key: "mimeType", width: 145 },
        { label: "Ajouté", key: "createdAt", width: 70 },
      ],
      data.documents,
    );
    table(
      "Activité récente",
      [
        { label: "Date", key: "occurredAt", width: 85 },
        { label: "Événement", key: "eventType", width: 95 },
        { label: "Élément", key: "title", width: 175 },
        { label: "Par", key: "actorName", width: 145 },
      ],
      data.activity.slice(0, 60),
    );

    const pages = document.bufferedPageRange();
    for (let index = 0; index < pages.count; index += 1) {
      document.switchToPage(pages.start + index);
      document
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(7.5)
        .text(
          `${pdfText(summary.code)} - Page ${index + 1} / ${pages.count}`,
          document.page.margins.left,
          document.page.height - 28,
          { width: contentWidth, align: "center" },
        );
    }
    document.end();
  });
}

async function organizationBrandName(
  context: OwnerManagementContext,
): Promise<string> {
  return withTenantContext(context, async (client) => {
    const result = await client.query<{ display_name: string | null }>(
      "SELECT display_name FROM organizations WHERE id = $1",
      [context.organizationId],
    );
    return result.rows[0]?.display_name?.trim() || "Entreprise";
  });
}

export async function exportProjectPdf(
  context: OwnerManagementContext,
  projectId: string,
): Promise<{ filename: string; buffer: Buffer }> {
  const query = { projectId, limit: 200, offset: 0 };
  const [
    summary,
    phases,
    tasks,
    budgets,
    materials,
    requests,
    orders,
    receipts,
    expenses,
    assets,
    documents,
    activity,
  ] = await Promise.all([
    projectSummary(context, projectId),
    listOwnerManagementRecords(context, "phases", query),
    listOwnerManagementRecords(context, "tasks", query),
    listOwnerManagementRecords(context, "budget-lines", query),
    listOwnerManagementRecords(context, "materials", query),
    listOwnerManagementRecords(context, "purchase-requests", query),
    listOwnerManagementRecords(context, "purchase-orders", query),
    listOwnerManagementRecords(context, "receipts", query),
    listOwnerManagementRecords(context, "expenses", query),
    listOwnerManagementRecords(context, "assets", query),
    listOwnerManagementRecords(context, "documents", query),
    projectActivity(context, projectId),
  ]);
  const companyName = await organizationBrandName(context);
  const buffer = await projectPdfBuffer(companyName, summary, {
    phases,
    tasks,
    budgets,
    materials,
    requests,
    orders,
    receipts,
    expenses,
    assets,
    documents,
    activity,
  });
  const filename = `${String(summary.code ?? "project").replace(/[^a-zA-Z0-9_-]/g, "-")}-project-report.pdf`;
  return { filename, buffer };
}
export async function ownerDashboard(
  context: OwnerManagementContext,
  filters: { provinceId?: string; projectId?: string },
): Promise<Row> {
  return withTenantContext(context, async (client) => {
    const projectsResult = await client.query<Row>(
      "SELECT * FROM management_projects WHERE organization_id = $1" +
        (filters.projectId
          ? " AND id = $2"
          : filters.provinceId
            ? " AND province_id = $2"
            : "") +
        " ORDER BY updated_at DESC",
      filters.projectId || filters.provinceId
        ? [context.organizationId, filters.projectId ?? filters.provinceId]
        : [context.organizationId],
    );
    const visibleProjects: Row[] = [];
    for (const project of projectsResult.rows) {
      try {
        await assertVisible(client, context, "projects", String(project.id));
        visibleProjects.push(project);
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
      }
    }
    const summaries = await Promise.all(
      visibleProjects.map((project) =>
        projectSummaryFor(client, context, String(project.id)),
      ),
    );
    const projectIds = visibleProjects.map((project) => String(project.id));
    const totals = summaries.reduce<{
      planned: number;
      spent: number;
      committed: number;
      available: number;
    }>(
      (value, project) => ({
        planned: value.planned + Number(project.plannedBudget ?? 0),
        spent: value.spent + Number(project.actualSpent ?? 0),
        committed: value.committed + Number(project.committedAmount ?? 0),
        available: value.available + Number(project.availableBudget ?? 0),
      }),
      { planned: 0, spent: 0, committed: 0, available: 0 },
    );
    const assets = await client.query<Row>(
      "SELECT * FROM management_assets WHERE organization_id = $1",
      [context.organizationId],
    );
    const visibleAssets: Row[] = [];
    for (const asset of assets.rows) {
      try {
        await assertVisible(client, context, "assets", String(asset.id));
        visibleAssets.push(asset);
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
      }
    }
    const assetCounts = visibleAssets.reduce<Record<string, number>>(
      (counts, asset) => {
        const status = String(asset.status);
        counts[status] = (counts[status] ?? 0) + 1;
        return counts;
      },
      {},
    );
    const maintenance = await client.query<Row>(
      "SELECT mp.*, a.asset_number, a.name AS asset_name, a.current_meter_reading FROM management_maintenance_plans mp JOIN management_assets a ON a.organization_id = mp.organization_id AND a.id = mp.asset_id WHERE mp.organization_id = $1 AND mp.is_active",
      [context.organizationId],
    );
    const maintenanceAlerts = maintenance.rows
      .filter((plan) => {
        const asset = visibleAssets.find((item) => item.id === plan.asset_id);
        if (!asset) return false;
        return (
          (plan.next_due_date &&
            new Date(String(plan.next_due_date)) <=
              new Date(Date.now() + 7 * 86400000)) ||
          (plan.next_due_meter !== null &&
            Number(asset.current_meter_reading ?? 0) >=
              Number(plan.next_due_meter) -
                Number(plan.interval_meter ?? 0) * 0.1)
        );
      })
      .map(mapRow);
    const pendingApprovals = await client.query<Row>(
      "SELECT * FROM management_approval_requests WHERE organization_id = $1 AND status = 'pending' ORDER BY requested_at ASC",
      [context.organizationId],
    );
    const relevantApprovals: Row[] = [];
    for (const approval of pendingApprovals.rows) {
      try {
        await assertVisible(client, context, "approvals", String(approval.id));
        relevantApprovals.push(mapRow(approval));
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
      }
    }
    const overdueTasks = summaries.flatMap((project) =>
      (project.nextActions as Row[]).filter(
        (task) => task.dueDate && new Date(String(task.dueDate)) < new Date(),
      ),
    );
    const criticalMaterials = summaries
      .flatMap((project) =>
        (project.materials as Row[])
          .filter((material) => Number(material.stillNeeded ?? 0) > 0)
          .map((material) => ({
            projectId: project.id,
            projectName: project.name,
            ...material,
          })),
      )
      .slice(0, 20);
    return {
      organization: { id: context.organizationId },
      projects: {
        active: summaries.filter((project) =>
          ["planning", "approved", "in_progress", "on_hold"].includes(
            String(project.status),
          ),
        ).length,
        delayed: summaries.filter(
          (project) => Number(project.overdueTasks ?? 0) > 0,
        ).length,
        items: summaries,
      },
      financials: {
        ...totals,
        utilizationPercent: totals.planned
          ? Math.round(
              ((totals.spent + totals.committed) / totals.planned) * 10000,
            ) / 100
          : 0,
      },
      assets: {
        total: visibleAssets.length,
        byStatus: assetCounts,
        maintenanceDue: maintenanceAlerts.length,
      },
      criticalMaterials,
      alerts: {
        maintenance: maintenanceAlerts,
        pendingApprovals: relevantApprovals,
        overdueTasks,
      },
      nextActions: summaries
        .flatMap((project) => project.nextActions as Row[])
        .slice(0, 20),
      projectIds,
    };
  });
}
