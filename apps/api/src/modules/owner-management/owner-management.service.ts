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
import { createNotificationInTransaction, notifyOrganizationOwnersInTransaction } from "../notifications/notifications.service";
import {
  assertDocumentPolicy,
  visibleDocumentIds,
} from "../../services/document-access.service";
import type {
  DocumentAccessInput,
  DocumentCategoryAssignmentInput,
  DocumentCategoryCreateInput,
  DocumentCategoryUpdateInput,
  InventoryStockQuery,
  OwnerManagementListQuery,
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
}

const PROJECT_ASSIGNMENT_ROLES = [
  "project_manager",
  "provincial_manager",
  "supervisor",
  "finance",
  "procurement",
  "legal",
  "administration",
  "worker",
  "contractor",
  "other",
] as const;

const snake = (name: string) =>
  name.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase());
const camel = (name: string) =>
  name.replace(/_([a-z0-9])/g, (_, character: string) =>
    character.toUpperCase(),
  );

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
      "startDate",
      "targetCompletionDate",
      "revisedCompletionDate",
      "completedDate",
      "status",
      "priority",
      "estimatedTotalBudget",
      "currencyCode",
      "progressPercent",
      "blueprint",
      "fundingSource",
      "expectedOutcome",
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
  tasks: {
    table: "management_project_tasks",
    fields: [
      "projectId",
      "provinceId",
      "siteId",
      "phaseId",
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
    immutable: true,
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
    immutable: true,
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
      "projectId",
      "provinceId",
      "siteId",
      "phaseId",
      "projectTaskId",
      "provinceId",
      "siteId",
      "departmentId",
      "supplierId",
      "purchaseOrderId",
      "receiptId",
      "category",
      "description",
      "amount",
      "currencyCode",
      "expenseDate",
      "paymentMethod",
      "paidByMemberId",
      "approvedByMemberId",
      "status",
      "receiptReference",
      "notes",
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
      }),
    ],
  );
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
  if (pg.code === "23505")
    throw new ConflictError("A record with that value already exists");
  if (resource === "projects" && pg.code === "23514") {
    const message: Record<string, string> = {
      management_projects_code_format:
        "Project code must use lowercase letters, numbers and underscores, and start with a letter (for example kongo_farm_2026)",
      management_projects_values_check:
        "Project budget must be zero or higher, and progress must be between 0 and 100",
      management_projects_dates_check:
        "Target completion and actual completion cannot be before the project start date",
      management_projects_text_check:
        "Project name and any supplied description, blueprint or notes cannot be blank",
      management_projects_type_check: "Choose a valid project type",
      management_projects_status_check: "Choose a valid project status",
      management_projects_priority_check: "Choose a valid project priority",
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
  const scope = await scopeOf(client, context);
  // Suppliers and stock items are organization-wide catalog records. They do
  // not carry a province, so a province-scoped operator with the matching
  // permission may read the company catalogue while warehouse stock remains
  // limited by the warehouse's province/site.
  if (
    scope === "organization" ||
    resource === "suppliers" ||
    resource === "inventory-items"
  )
    return;
  const info = await scopeInfo(client, context, resource, recordId);
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
  if (!info.project_id)
    throw new NotFoundError("Owner Management record not found");
  const allowed = await client.query(
    "SELECT 1 FROM management_project_members WHERE organization_id = $1 AND project_id = $2 AND member_id = $3 AND is_manager AND assignment_start_date <= current_date AND (assignment_end_date IS NULL OR assignment_end_date >= current_date)",
    [context.organizationId, info.project_id, context.memberId],
  );
  if (!allowed.rowCount)
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
  if (context.isOwner) return;
  const status = typeof input.status === "string" ? input.status : undefined;
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
  if (resource === "purchase-requests") {
    if (status && !["draft", "submitted"].includes(status))
      throw new ForbiddenError(
        "Managers can submit purchase requests, but only the owner can approve them",
      );
    const approvalStatus =
      typeof input.approvalStatus === "string"
        ? input.approvalStatus
        : undefined;
    if (
      approvalStatus &&
      !["not_requested", "pending"].includes(approvalStatus)
    )
      throw new ForbiddenError("Managers cannot approve a purchase request");
    if (input.reviewedByMemberId !== undefined)
      throw new ForbiddenError("Managers cannot review a purchase request");
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
  if (
    resource === "project-members" &&
    input.assignmentRole !== undefined &&
    !PROJECT_ASSIGNMENT_ROLES.includes(
      String(input.assignmentRole) as (typeof PROJECT_ASSIGNMENT_ROLES)[number],
    )
  )
    throw new BadRequestError("Choose a valid project role", {
      field: "assignmentRole",
    });
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
  if (resource === "project-members") result.assignedBy = context.userId;
  if (resource === "operational-links" && !result.linkedByMemberId)
    result.linkedByMemberId = context.memberId;
  if (resource === "phase-dependencies" && !result.createdByMemberId)
    result.createdByMemberId = context.memberId;
  if (resource === "purchase-requests" && !result.requestedByMemberId)
    result.requestedByMemberId = context.memberId;
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
  if (resource === "expenses") result.createdByUserId = context.userId;
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
    const match = await client.query(
      "SELECT p1.project_id = p2.project_id AS same_project FROM management_project_phases p1 JOIN management_project_phases p2 ON p2.organization_id = p1.organization_id AND p2.id = $3 WHERE p1.organization_id = $1 AND p1.id = $2",
      [org, row.phase_id, row.depends_on_phase_id],
    );
    if (!match.rows[0]?.same_project)
      throw new BadRequestError(
        "Phase dependencies must be inside the same project",
      );
    const cycle = await client.query(
      "WITH RECURSIVE upstream(id) AS (SELECT depends_on_phase_id FROM management_project_phase_dependencies WHERE organization_id = $1 AND phase_id = $3 UNION SELECT d.depends_on_phase_id FROM management_project_phase_dependencies d JOIN upstream u ON u.id = d.phase_id WHERE d.organization_id = $1) SELECT 1 FROM upstream WHERE id = $2 LIMIT 1",
      [org, row.phase_id, row.depends_on_phase_id],
    );
    if (cycle.rowCount)
      throw new BadRequestError("A phase dependency cannot create a cycle");
  }
  if (resource === "task-dependencies") {
    const match = await client.query(
      "SELECT t1.project_id = t2.project_id AS same_project FROM management_project_tasks t1 JOIN management_project_tasks t2 ON t2.organization_id = t1.organization_id AND t2.id = $3 WHERE t1.organization_id = $1 AND t1.id = $2",
      [org, row.task_id, row.depends_on_task_id],
    );
    if (!match.rows[0]?.same_project)
      throw new BadRequestError(
        "Task dependencies must be inside the same project",
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
  if (resource === "purchase-orders" && row.purchase_request_id) {
    const match = await client.query(
      "SELECT 1 FROM management_purchase_requests WHERE organization_id = $1 AND id = $2 AND project_id = $3",
      [org, row.purchase_request_id, row.project_id],
    );
    if (!match.rowCount)
      throw new BadRequestError(
        "The purchase request must belong to the order project",
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
    const match = await client.query(
      "SELECT 1 FROM management_receipts re JOIN management_purchase_order_lines pol ON pol.organization_id = re.organization_id AND pol.purchase_order_id = re.purchase_order_id WHERE re.organization_id = $1 AND re.id = $2 AND pol.id = $3",
      [org, row.receipt_id, row.purchase_order_line_id],
    );
    if (!match.rowCount)
      throw new BadRequestError(
        "The received item must belong to the receipt's purchase order",
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

async function writeStockLedger(
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
    "SELECT COALESCE(SUM(pol.ordered_quantity), 0) AS ordered, COALESCE(SUM(COALESCE(x.accepted, 0)), 0) AS accepted, po.status AS current_status FROM management_purchase_orders po LEFT JOIN management_purchase_order_lines pol ON pol.organization_id = po.organization_id AND pol.purchase_order_id = po.id LEFT JOIN LATERAL (SELECT SUM(rl.received_quantity - rl.damaged_quantity - rl.rejected_quantity) AS accepted FROM management_receipt_lines rl WHERE rl.organization_id = pol.organization_id AND rl.purchase_order_line_id = pol.id) x ON true WHERE po.organization_id = $1 AND po.id = $2 GROUP BY po.status",
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
async function applyEffects(
  client: PoolClient,
  context: OwnerManagementContext,
  resource: OwnerManagementResource,
  row: Row,
): Promise<void> {
  if (resource === "projects" && String(row.status) === "completed") {
    await client.query(
      "UPDATE management_projects SET completed_date = COALESCE(completed_date, current_date) WHERE organization_id = $1 AND id = $2",
      [context.organizationId, row.id],
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
  if (
    resource === "purchase-orders" &&
    !row.project_task_id &&
    row.purchase_request_id
  )
    await client.query(
      "UPDATE management_purchase_orders po SET project_task_id = pr.project_task_id FROM management_purchase_requests pr WHERE po.organization_id = $1 AND po.id = $2 AND po.project_task_id IS NULL AND pr.organization_id = po.organization_id AND pr.id = po.purchase_request_id",
      [context.organizationId, row.id],
    );
  if (resource === "expenses" && !row.project_task_id) {
    if (row.purchase_order_id)
      await client.query(
        "UPDATE management_expenses e SET project_task_id = po.project_task_id FROM management_purchase_orders po WHERE e.organization_id = $1 AND e.id = $2 AND e.project_task_id IS NULL AND po.organization_id = e.organization_id AND po.id = e.purchase_order_id",
        [context.organizationId, row.id],
      );
    else if (row.receipt_id)
      await client.query(
        "UPDATE management_expenses e SET project_task_id = po.project_task_id FROM management_receipts r JOIN management_purchase_orders po ON po.organization_id = r.organization_id AND po.id = r.purchase_order_id WHERE e.organization_id = $1 AND e.id = $2 AND e.project_task_id IS NULL AND r.organization_id = e.organization_id AND r.id = e.receipt_id",
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
      "SELECT re.project_id, re.warehouse_id AS receipt_warehouse_id, po.id AS order_id, po.supplier_id, po.warehouse_id AS order_warehouse_id, po.currency_code, pol.inventory_item_id AS order_item_id, pol.project_material_id AS order_material_id, pol.item_kind, pol.asset_name AS order_asset_name, pol.asset_category AS order_asset_category, pol.unit_cost FROM management_receipt_lines rl JOIN management_receipts re ON re.organization_id = rl.organization_id AND re.id = rl.receipt_id JOIN management_purchase_orders po ON po.organization_id = re.organization_id AND po.id = re.purchase_order_id JOIN management_purchase_order_lines pol ON pol.organization_id = rl.organization_id AND pol.id = rl.purchase_order_line_id WHERE rl.organization_id = $1 AND rl.id = $2",
      [context.organizationId, row.id],
    );
    const receipt = details.rows[0];
    if (!receipt) throw new BadRequestError("Receipt line cannot be completed");
    const accepted =
      Number(row.received_quantity) -
      Number(row.damaged_quantity) -
      Number(row.rejected_quantity);
    const itemId = row.inventory_item_id ?? receipt.order_item_id;
    const materialId = row.project_material_id ?? receipt.order_material_id;
    const warehouseId =
      receipt.receipt_warehouse_id ?? receipt.order_warehouse_id;
    await client.query(
      "UPDATE management_receipt_lines SET project_material_id = COALESCE(project_material_id, $3), inventory_item_id = COALESCE(inventory_item_id, $4) WHERE organization_id = $1 AND id = $2",
      [context.organizationId, row.id, materialId ?? null, itemId ?? null],
    );
    if (accepted > 0 && itemId && warehouseId) {
      await writeStockLedger(client, context, {
        warehouseId: String(warehouseId),
        itemId: String(itemId),
        projectId: String(receipt.project_id),
        projectMaterialId: materialId ? String(materialId) : null,
        movementType: "receipt",
        quantityDelta: accepted,
        unitCost: Number(row.actual_unit_cost ?? receipt.unit_cost),
        referenceType: "receipt_line",
        referenceId: String(row.id),
        notes: row.receiver_notes as string | null,
      });
    }
    const isDurable =
      Boolean(row.asset_required) || receipt.item_kind === "asset";
    if (isDurable && accepted > 0) {
      if (!Number.isInteger(accepted))
        throw new BadRequestError(
          "A durable asset receipt must use a whole accepted quantity",
        );
      const assetName = row.asset_name ?? receipt.order_asset_name;
      const assetCategory = row.asset_category ?? receipt.order_asset_category;
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
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is Row => Boolean(row));
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
      "SELECT t.id, COALESCE(expenses.actual_cost, 0) + COALESCE(received.actual_purchase_cost, 0) AS actual_cost, COALESCE(orders.committed_cost, 0) AS committed_cost FROM management_project_tasks t LEFT JOIN LATERAL (SELECT SUM(e.amount) AS actual_cost FROM management_expenses e WHERE e.organization_id = t.organization_id AND e.project_task_id = t.id AND e.status IN ('approved', 'paid')) expenses ON true LEFT JOIN LATERAL (SELECT SUM((rl.received_quantity - rl.damaged_quantity - rl.rejected_quantity) * COALESCE(rl.actual_unit_cost, pol.unit_cost, 0)) AS actual_purchase_cost FROM management_purchase_orders po JOIN management_purchase_order_lines pol ON pol.organization_id = po.organization_id AND pol.purchase_order_id = po.id JOIN management_receipt_lines rl ON rl.organization_id = pol.organization_id AND rl.purchase_order_line_id = pol.id WHERE po.organization_id = t.organization_id AND po.project_task_id = t.id AND NOT EXISTS (SELECT 1 FROM management_expenses e WHERE e.organization_id = po.organization_id AND e.project_task_id = t.id AND e.purchase_order_id = po.id AND e.status IN ('approved', 'paid'))) received ON true LEFT JOIN LATERAL (SELECT SUM(GREATEST(pol.ordered_quantity - COALESCE(received_line.accepted_quantity, 0), 0) * pol.unit_cost + CASE WHEN pol.ordered_quantity = 0 THEN 0 ELSE pol.tax_amount * GREATEST(pol.ordered_quantity - COALESCE(received_line.accepted_quantity, 0), 0) / pol.ordered_quantity END) AS committed_cost FROM management_purchase_orders po JOIN management_purchase_order_lines pol ON pol.organization_id = po.organization_id AND pol.purchase_order_id = po.id LEFT JOIN LATERAL (SELECT SUM(received_quantity - damaged_quantity - rejected_quantity) AS accepted_quantity FROM management_receipt_lines WHERE organization_id = pol.organization_id AND purchase_order_line_id = pol.id) received_line ON true WHERE po.organization_id = t.organization_id AND po.project_task_id = t.id AND po.status IN ('sent', 'partially_received')) orders ON true WHERE t.organization_id = $1 AND t.id = ANY($2::uuid[])",
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
    "SELECT l.document_id, COUNT(DISTINCT l.task_id)::integer AS task_usage_count, string_agg(DISTINCT concat_ws(' · ', t.title, ph.name), ' | ') AS task_usage_summary FROM management_project_task_document_links l JOIN management_project_tasks t ON t.organization_id = l.organization_id AND t.id = l.task_id LEFT JOIN management_project_phases ph ON ph.organization_id = l.organization_id AND ph.id = l.phase_id WHERE l.organization_id = $1 AND l.document_id = ANY($2::uuid[]) GROUP BY l.document_id",
    [context.organizationId, documentIds],
  );
  const byDocumentId = new Map(
    usages.rows.map((row) => [String(row.document_id), mapRow(row)]),
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
      usageSummary:
        [directSummary, taskSummary]
          .filter((value) => typeof value === "string" && value.trim())
          .join(" | ") || null,
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
          : resource === "tasks"
            ? await enrichTaskCostRows(client, context, readablePage)
            : resource === "documents"
              ? await enrichDocumentRows(client, context, readablePage)
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
          : resource === "tasks"
            ? ((await enrichTaskCostRows(client, context, [mapRow(row)]))[0] ??
              mapRow(row))
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
  const label = String(row.title ?? row.name ?? row.code ?? row.request_number ?? row.work_order_number ?? "record");
  const provinceId = row.province_id ? String(row.province_id) : null;
  const projectId = row.project_id ? String(row.project_id) : null;
  const owner = async (type: string, category: string, priority: "normal" | "high", title: string, message: string, actionUrl: string) =>
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
    const assignedMemberId = row.assigned_member_id ? String(row.assigned_member_id) : null;
    if (assignedMemberId && assignedMemberId !== context.memberId && action === "created") {
      await createNotificationInTransaction(client, {
        organizationId: context.organizationId,
        recipientMemberId: assignedMemberId,
        actorUserId: context.userId,
        provinceId,
        type: "task_assigned",
        category: "task",
        priority: String(row.priority) === "critical" ? "urgent" : String(row.priority) === "high" ? "high" : "normal",
        title: "New task assigned",
        message: label,
        actionUrl: "/tasks",
        entityType: "management_project_task",
        entityId: recordId,
        metadata: projectId ? { projectId } : {},
        deduplicationKey: `task-assigned:${recordId}:${assignedMemberId}`,
      });
    }
    if (String(row.status) === "completed" && previousStatus !== "completed")
      await owner("task_completed", "task", "normal", "Task completed", label, "/projects");
    return;
  }
  if (resource === "phases" && String(row.status) === "completed" && previousStatus !== "completed") {
    await owner("phase_completed", "project", "normal", "Project phase completed", label, "/projects");
    return;
  }
  if (resource === "purchase-requests" && action === "created") {
    await owner("purchase_request_created", "procurement", "high", "Purchase request needs review", label, "/procurement");
    return;
  }
  if (resource === "expenses" && String(row.status) === "submitted" && previousStatus !== "submitted") {
    await owner("expense_submitted", "finance", "high", "Expense awaiting approval", label, "/approvals");
    return;
  }
  if (resource === "maintenance-work-orders" && action === "created")
    await owner("maintenance_scheduled", "maintenance", "normal", "Maintenance work scheduled", label, "/maintenance");
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
    assertManagerWorkflowInput(context, resource, defaults);
    await assertProjectWriteScope(client, context, resource, defaults);
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
    await assertConsistency(
      client,
      context,
      resource,
      await rawRecord(client, context, resource, recordId),
    );
    const row = await rawRecord(client, context, resource, recordId);
    await applyEffects(client, context, resource, row);
    const saved = await rawRecord(client, context, resource, recordId);
    await notifyManagementEvent(client, context, "created", resource, saved);
    await writeOwnerManagementAudit(
      client,
      context,
      "create",
      resource,
      saved,
      Object.keys(input),
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
    if (
      !context.isOwner &&
      resource === "expenses" &&
      !["draft", "submitted"].includes(String(current.status))
    )
      throw new ForbiddenError(
        "Managers cannot change an expense after the owner has decided it",
      );
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
    await applyEffects(client, context, resource, row);
    const saved = await rawRecord(client, context, resource, recordId);
    await notifyManagementEvent(client, context, "updated", resource, saved, String(current.status ?? ""));
    await writeOwnerManagementAudit(
      client,
      context,
      "update",
      resource,
      saved,
      Object.keys(input),
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
  await withTenantContext(context, async (client) => {
    const deleted = await rawRecord(client, context, resource, recordId);
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
    const settledAmount =
      decision === "approved"
        ? approval.requested_amount
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
    "SELECT pm.id, pm.code, pm.name, pm.unit, pm.planned_quantity, pm.estimated_unit_cost, COALESCE(pr.requested_quantity, 0) AS requested_quantity, COALESCE(pr.approved_quantity, 0) AS approved_quantity, COALESCE(po.ordered_quantity, 0) AS purchased_quantity, COALESCE(re.received_quantity, 0) AS received_quantity, COALESCE(mu.used_quantity, 0) AS used_quantity, GREATEST(pm.planned_quantity - COALESCE(po.ordered_quantity, 0), 0) AS still_needed, GREATEST(COALESCE(re.received_quantity, 0) - COALESCE(mu.used_quantity, 0), 0) AS available_quantity, CASE WHEN pm.planned_quantity = 0 THEN 0 ELSE ROUND((COALESCE(po.ordered_quantity, 0) / pm.planned_quantity) * 100, 2) END AS material_completion_percent, pm.planned_quantity * COALESCE(pm.estimated_unit_cost, 0) AS planned_total, COALESCE(re.actual_total, 0) AS actual_total FROM management_project_materials pm LEFT JOIN LATERAL (SELECT SUM(requested_quantity) AS requested_quantity, SUM(approved_quantity) AS approved_quantity FROM management_purchase_request_lines WHERE organization_id = pm.organization_id AND project_material_id = pm.id) pr ON true LEFT JOIN LATERAL (SELECT SUM(ordered_quantity) AS ordered_quantity FROM management_purchase_order_lines WHERE organization_id = pm.organization_id AND project_material_id = pm.id) po ON true LEFT JOIN LATERAL (SELECT SUM(received_quantity - damaged_quantity - rejected_quantity) AS received_quantity, SUM((received_quantity - damaged_quantity - rejected_quantity) * COALESCE(actual_unit_cost, 0)) AS actual_total FROM management_receipt_lines WHERE organization_id = pm.organization_id AND project_material_id = pm.id) re ON true LEFT JOIN LATERAL (SELECT SUM(CASE WHEN movement_type IN ('used', 'damaged', 'adjustment_out') THEN quantity ELSE -quantity END) AS used_quantity FROM management_material_movements WHERE organization_id = pm.organization_id AND project_material_id = pm.id) mu ON true WHERE pm.organization_id = $1 AND pm.project_id = $2 ORDER BY pm.name",
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
async function projectSummaryFor(
  client: PoolClient,
  context: OwnerManagementContext,
  projectId: string,
): Promise<Row> {
  await rawRecord(client, context, "projects", projectId);
  const result = await client.query<Row>(
    "SELECT p.*, COALESCE(b.planned, p.estimated_total_budget, 0) AS planned_budget, COALESCE(e.spent, 0) AS actual_spent, COALESCE(c.committed, 0) AS committed_amount, COALESCE(b.planned, p.estimated_total_budget, 0) - COALESCE(e.spent, 0) - COALESCE(c.committed, 0) AS available_budget, CASE WHEN COALESCE(b.planned, p.estimated_total_budget, 0) = 0 THEN 0 ELSE ROUND(((COALESCE(e.spent, 0) + COALESCE(c.committed, 0)) / COALESCE(b.planned, p.estimated_total_budget, 0)) * 100, 2) END AS budget_utilization_percent, COALESCE(t.progress_percent, p.progress_percent) AS calculated_progress_percent, COALESCE(t.open_tasks, 0) AS open_tasks, COALESCE(t.overdue_tasks, 0) AS overdue_tasks FROM management_projects p LEFT JOIN LATERAL (SELECT SUM(planned_amount) AS planned FROM management_project_budget_lines WHERE organization_id = p.organization_id AND project_id = p.id) b ON true LEFT JOIN LATERAL (SELECT SUM(amount) AS spent FROM management_expenses WHERE organization_id = p.organization_id AND project_id = p.id AND status IN ('approved', 'paid')) e ON true LEFT JOIN LATERAL (SELECT SUM(GREATEST(pol.ordered_quantity - COALESCE(rec.accepted, 0), 0) * pol.unit_cost + CASE WHEN pol.ordered_quantity = 0 THEN 0 ELSE pol.tax_amount * GREATEST(pol.ordered_quantity - COALESCE(rec.accepted, 0), 0) / pol.ordered_quantity END) AS committed FROM management_purchase_orders po JOIN management_purchase_order_lines pol ON pol.organization_id = po.organization_id AND pol.purchase_order_id = po.id LEFT JOIN LATERAL (SELECT SUM(received_quantity - damaged_quantity - rejected_quantity) AS accepted FROM management_receipt_lines WHERE organization_id = pol.organization_id AND purchase_order_line_id = pol.id) rec ON true WHERE po.organization_id = p.organization_id AND po.project_id = p.id AND po.status IN ('sent', 'partially_received')) c ON true LEFT JOIN LATERAL (SELECT COALESCE(AVG(progress_percent) FILTER (WHERE task_type = 'work'), AVG(progress_percent)) AS progress_percent, COUNT(*) FILTER (WHERE task_type = 'work' AND status NOT IN ('completed', 'cancelled')) AS open_tasks, COUNT(*) FILTER (WHERE task_type = 'work' AND due_date < current_date AND status NOT IN ('completed', 'cancelled')) AS overdue_tasks FROM management_project_tasks WHERE organization_id = p.organization_id AND project_id = p.id) t ON true WHERE p.organization_id = $1 AND p.id = $2",
    [context.organizationId, projectId],
  );
  const summary = result.rows[0];
  if (!summary) throw new NotFoundError("Project not found");
  const phaseCosts = await client.query<Row>(
    "SELECT ph.id AS phase_id, COALESCE(e.spent, 0) AS actual_spent, COALESCE(c.committed, 0) AS committed_amount FROM management_project_phases ph LEFT JOIN LATERAL (SELECT SUM(amount) AS spent FROM management_expenses e WHERE e.organization_id = ph.organization_id AND e.phase_id = ph.id AND e.status IN ('approved', 'paid')) e ON true LEFT JOIN LATERAL (SELECT SUM(GREATEST(pol.ordered_quantity - COALESCE(rec.accepted, 0), 0) * pol.unit_cost) AS committed FROM management_purchase_orders po JOIN management_purchase_order_lines pol ON pol.organization_id = po.organization_id AND pol.purchase_order_id = po.id LEFT JOIN LATERAL (SELECT SUM(received_quantity - damaged_quantity - rejected_quantity) AS accepted FROM management_receipt_lines WHERE organization_id = pol.organization_id AND purchase_order_line_id = pol.id) rec ON true WHERE po.organization_id = ph.organization_id AND po.phase_id = ph.id AND po.status IN ('sent', 'partially_received')) c ON true WHERE ph.organization_id = $1 AND ph.project_id = $2 ORDER BY ph.phase_order",
    [context.organizationId, projectId],
  );
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
  const nextActions = await client.query<Row>(
    "SELECT id, title, status, priority, due_date, blocked_reason, assigned_member_id FROM management_project_tasks WHERE organization_id = $1 AND project_id = $2 AND task_type = 'work' AND status NOT IN ('completed', 'cancelled') ORDER BY CASE WHEN status = 'blocked' THEN 0 ELSE 1 END, due_date NULLS LAST, priority DESC LIMIT 10",
    [context.organizationId, projectId],
  );
  return {
    ...mapRow(summary),
    budget: {
      planned: summary.planned_budget,
      spent: summary.actual_spent,
      committed: summary.committed_amount,
      available: summary.available_budget,
      utilizationPercent: summary.budget_utilization_percent,
    },
    phaseCosts: phaseCosts.rows.map(mapRow),
    materials,
    operationalLinks,
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

/** A project-only timeline assembled from the existing transaction records. */
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

interface PdfColumn {
  label: string;
  key: string;
  width: number;
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
        .text(`${companyName.toLocaleUpperCase("fr-FR").slice(0, 54)} · RAPPORT DE PROJET`, 42, 11, { lineBreak: false });
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
      ["Fin prévue", pdfDate(summary.targetCompletionDate)],
      ["Objectif", summary.expectedOutcome],
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

async function organizationBrandName(context: OwnerManagementContext): Promise<string> {
  return withTenantContext(context, async (client) => {
    const result = await client.query<{ display_name: string | null }>("SELECT display_name FROM organizations WHERE id = $1", [context.organizationId]);
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
