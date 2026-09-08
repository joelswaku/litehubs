import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { query } from "../../src/config/database";
import {
  withTenantContext,
  withUserContext,
} from "../../src/utils/tenant-query";

const app = createApp();
const suffix = randomUUID().slice(0, 8);
const ownerEmail = "owner-management-" + suffix + "@test.invalid";
const organizationSlug = "owner-management-" + suffix;
const password = "SecurePass123";

function binaryParser(
  response: NodeJS.ReadableStream,
  done: (error: Error | null, body?: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer | string) =>
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
  );
  response.on("error", (error: Error) => done(error));
  response.on("end", () => done(null, Buffer.concat(chunks)));
}

async function cleanUp(email: string): Promise<void> {
  const found = await query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1",
    [email],
  );
  const userId = found.rows[0]?.id;
  if (!userId) return;
  const organizationIds = await withUserContext(userId, async (client) => {
    const result = await client.query<{ organization_id: string }>(
      "SELECT organization_id FROM organization_members WHERE user_id = $1",
      [userId],
    );
    return result.rows.map((item) => item.organization_id);
  });
  for (const organizationId of organizationIds) {
    await withTenantContext({ userId, organizationId }, (client) =>
      client.query("DELETE FROM organizations WHERE id = $1", [organizationId]),
    );
  }
  await query("DELETE FROM users WHERE id = $1", [userId]);
}

afterAll(async () => cleanUp(ownerEmail));

describe("Owner Management", () => {
  it("connects a project from plan through purchasing, receipt, asset and maintenance", async () => {
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({
        fullName: "Owner Management Owner",
        email: ownerEmail,
        password,
        organization: {
          slug: organizationSlug,
          legalName: "Owner Management Congo SARL",
          displayName: "Owner Management Congo",
          industryCode: "mixed_farm",
          country: "CD",
          currency: "CDF",
        },
      });
    expect(registered.status).toBe(201);
    const owner = (call: request.Test) =>
      call.set(
        "Authorization",
        "Bearer " + String(registered.body.accessToken),
      );
    const base = "/api/v1/organizations/" + organizationSlug;
    const post = (resource: string, body: object) =>
      owner(
        request(app)
          .post(base + "/owner-management/" + resource)
          .send(body),
      );

    const province = await owner(
      request(app)
        .post(base + "/provinces")
        .send({ code: "kinshasa", name: "Kinshasa" }),
    );
    const site = await owner(
      request(app)
        .post(base + "/sites")
        .send({
          provinceId: province.body.province.id,
          code: "owner_farm",
          name: "Owner Farm",
          siteType: "farm",
        }),
    );
    expect(site.status).toBe(201);

    const invalidProject = await post("projects", {
      code: "New Mixed Farm 2026",
      name: "Invalid code example",
      projectType: "construction",
      provinceId: province.body.province.id,
      status: "planning",
    });
    expect(invalidProject.status).toBe(400);
    expect(invalidProject.body.error.message).toContain(
      "Project code must use lowercase",
    );

    const project = await post("projects", {
      code: "poultry_expansion",
      name: "Kinshasa Poultry Expansion",
      projectType: "expansion",
      provinceId: province.body.province.id,
      siteId: site.body.site.id,
      startDate: "2026-08-01",
      targetCompletionDate: "2026-12-31",
      status: "in_progress",
      priority: "high",
      estimatedTotalBudget: 50000,
      currencyCode: "USD",
      blueprint: "Build capacity for 10,000 additional broilers.",
    });
    expect(project.status).toBe(201);
    const projectId = project.body.record.id;

    const phase = await post("phases", {
      projectId,
      code: "construction",
      name: "Construction",
      phaseOrder: 1,
      status: "in_progress",
      plannedBudget: 12000,
    });
    const task = await post("tasks", {
      projectId,
      phaseId: phase.body.record.id,
      title: "Install poultry house roofing",
      dueDate: "2026-09-12",
      status: "in_progress",
      priority: "high",
      estimatedCost: 4500,
    });
    const budget = await post("budget-lines", {
      projectId,
      phaseId: phase.body.record.id,
      category: "Construction",
      plannedAmount: 12000,
      currencyCode: "USD",
    });
    expect(phase.status).toBe(201);
    expect(task.status).toBe(201);
    expect(budget.status).toBe(201);

    // Task form regression coverage: optional task fields must use NULL rather
    // than empty strings, while valid dates, decimals and progress values save.
    const ownerMembership = await withUserContext(
      registered.body.user.id,
      async (client) =>
        client.query<{ id: string }>(
          "SELECT id FROM organization_members WHERE user_id = $1 LIMIT 1",
          [registered.body.user.id],
        ),
    );
    const ownerMemberId = ownerMembership.rows[0]?.id;
    expect(ownerMemberId).toBeDefined();

    const workWithoutPhase = await post("tasks", {
      projectId,
      phaseId: null,
      taskType: "work",
      code: "0001",
      title: "Pay the land surveyor",
      assignedMemberId: null,
      startDate: null,
      dueDate: "2026-08-29",
      status: "in_progress",
      priority: "medium",
      progressPercent: 0,
      estimatedCost: null,
      blockedReason: null,
      description: null,
    });
    expect(workWithoutPhase.status).toBe(201);
    expect(workWithoutPhase.body.record.phaseId).toBeNull();
    expect(workWithoutPhase.body.record.startDate).toBeNull();
    expect(Number(workWithoutPhase.body.record.progressPercent)).toBe(0);

    const milestone = await post("tasks", {
      projectId,
      taskType: "milestone",
      code: "land_title_verified",
      title: "Land title verified",
      dueDate: "2026-09-01",
      status: "not_started",
      priority: "medium",
      progressPercent: 0,
      estimatedCost: null,
    });
    expect(milestone.status).toBe(201);
    expect(milestone.body.record.taskType).toBe("milestone");

    const workWithProgressAndDecimalCost = await post("tasks", {
      projectId,
      phaseId: phase.body.record.id,
      taskType: "work",
      code: "survey_payment",
      title: "Pay survey invoice",
      assignedMemberId: ownerMemberId,
      startDate: "2026-08-28",
      dueDate: "2026-08-29",
      status: "in_progress",
      priority: "medium",
      progressPercent: 50,
      estimatedCost: 1250.75,
    });
    expect(workWithProgressAndDecimalCost.status).toBe(201);
    expect(
      Number(workWithProgressAndDecimalCost.body.record.progressPercent),
    ).toBe(50);
    expect(
      Number(workWithProgressAndDecimalCost.body.record.estimatedCost),
    ).toBe(1250.75);
    expect(workWithProgressAndDecimalCost.body.record.assignedMemberId).toBe(
      ownerMemberId,
    );

    const editedTask = await owner(
      request(app)
        .patch(
          base +
            "/owner-management/tasks/" +
            workWithProgressAndDecimalCost.body.record.id,
        )
        .send({
          title: "Pay approved survey invoice",
          phaseId: phase.body.record.id,
          assignedMemberId: ownerMemberId,
          startDate: null,
          dueDate: "2026-09-02",
          status: "in_progress",
          priority: "medium",
          progressPercent: 50,
          estimatedCost: 1300.5,
        }),
    );
    expect(editedTask.status).toBe(200);
    expect(editedTask.body.record.title).toBe("Pay approved survey invoice");
    expect(Number(editedTask.body.record.estimatedCost)).toBe(1300.5);

    const invalidDueDate = await post("tasks", {
      projectId,
      title: "Invalid task dates",
      startDate: "2026-09-02",
      dueDate: "2026-09-01",
    });
    expect(invalidDueDate.status).toBe(422);
    expect(invalidDueDate.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "dueDate" })]),
    );

    const invalidProgress = await post("tasks", {
      projectId,
      title: "Invalid progress",
      progressPercent: 101,
    });
    expect(invalidProgress.status).toBe(422);
    expect(invalidProgress.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "progressPercent" }),
      ]),
    );

    const invalidCost = await post("tasks", {
      projectId,
      title: "Invalid estimated cost",
      estimatedCost: -0.01,
    });
    expect(invalidCost.status).toBe(422);
    expect(invalidCost.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "estimatedCost" }),
      ]),
    );

    const blankPhaseIsNormalized = await post("tasks", {
      projectId,
      title: "Blank phase becomes null",
      phaseId: "",
    });
    expect(blankPhaseIsNormalized.status).toBe(201);
    expect(blankPhaseIsNormalized.body.record.phaseId).toBeNull();

    const invalidPhaseId = await post("tasks", {
      projectId,
      title: "Invalid phase identifier",
      phaseId: "not-a-uuid",
    });
    expect(invalidPhaseId.status).toBe(422);
    expect(invalidPhaseId.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "phaseId" })]),
    );

    const landDocument = await post("documents", {
      projectId,
      entityType: "owner-management:projects",
      entityId: projectId,
      title: "Land title deed.pdf",
      documentType: "legal",
      storageKey: "tests/land-title-deed.pdf",
      storageUrl: "https://files.example.invalid/land-title-deed.pdf",
      storageProvider: "external",
      mimeType: "application/pdf",
      fileSizeBytes: 42,
    });
    expect(landDocument.status).toBe(201);
    // Normal Project APIs must never expose a provider URL. The browser uses
    // the authenticated preview/download endpoint instead.
    expect(landDocument.body.record.storageUrl).toBeUndefined();

    const defaultDocumentAccess = await owner(
      request(app).get(
        base +
          "/owner-management/documents/" +
          landDocument.body.record.id +
          "/access",
      ),
    );
    expect(defaultDocumentAccess.status).toBe(200);
    expect(defaultDocumentAccess.body.access).toMatchObject({
      visibility: "company",
      canDownload: true,
      canEdit: true,
      isLocked: false,
    });
    const invalidDocumentAccess = await owner(
      request(app)
        .patch(
          base +
            "/owner-management/documents/" +
            landDocument.body.record.id +
            "/access",
        )
        .send({
          visibility: "selected_roles",
          allowedRoleIds: [],
          allowedMemberIds: [],
          isLocked: false,
          canDownload: true,
          canEdit: true,
        }),
    );
    expect(invalidDocumentAccess.status).toBe(422);
    expect(invalidDocumentAccess.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "allowedRoleIds" }),
      ]),
    );
    const privateDocumentAccess = await owner(
      request(app)
        .patch(
          base +
            "/owner-management/documents/" +
            landDocument.body.record.id +
            "/access",
        )
        .send({
          visibility: "owner_only",
          allowedRoleIds: [],
          allowedMemberIds: [],
          isLocked: true,
          canDownload: false,
          canEdit: false,
        }),
    );
    expect(privateDocumentAccess.status).toBe(200);
    expect(privateDocumentAccess.body.access).toMatchObject({
      visibility: "owner_only",
      isLocked: true,
      canDownload: false,
      canEdit: false,
    });

    const linkTaskDocument = await owner(
      request(app)
        .put(
          base +
            "/owner-management/tasks/" +
            task.body.record.id +
            "/documents",
        )
        .send({ documentIds: [landDocument.body.record.id] }),
    );
    expect(linkTaskDocument.status).toBe(200);
    expect(linkTaskDocument.body.documents).toHaveLength(1);
    expect(linkTaskDocument.body.documents[0].title).toBe(
      "Land title deed.pdf",
    );
    expect(linkTaskDocument.body.documents[0].linkedPhaseId).toBe(
      phase.body.record.id,
    );

    const linkedTaskDocuments = await owner(
      request(app).get(
        base + "/owner-management/tasks/" + task.body.record.id + "/documents",
      ),
    );
    expect(linkedTaskDocuments.status).toBe(200);
    expect(linkedTaskDocuments.body.documents).toHaveLength(1);
    expect(
      linkedTaskDocuments.body.documents[0].taskDocumentLinkId,
    ).toBeDefined();
    const projectDocumentsWithUsage = await owner(
      request(app).get(
        base + "/owner-management/documents?projectId=" + projectId,
      ),
    );
    expect(projectDocumentsWithUsage.status).toBe(200);
    const linkedProjectDocument = projectDocumentsWithUsage.body.records.find(
      (document: { id: string }) => document.id === landDocument.body.record.id,
    );
    expect(linkedProjectDocument.taskUsageCount).toBe(1);

    const otherProjectForDocument = await post("projects", {
      code: "other_doc_project",
      name: "Other project document",
      projectType: "other",
      provinceId: province.body.province.id,
      siteId: site.body.site.id,
      status: "cancelled",
      priority: "low",
    });
    expect(otherProjectForDocument.status).toBe(201);
    const foreignProjectDocument = await post("documents", {
      projectId: otherProjectForDocument.body.record.id,
      entityType: "owner-management:projects",
      entityId: otherProjectForDocument.body.record.id,
      title: "Other project contract.pdf",
      documentType: "legal",
      storageKey: "tests/other-project-contract.pdf",
      storageUrl: "https://files.example.invalid/other-project-contract.pdf",
      storageProvider: "external",
      mimeType: "application/pdf",
      fileSizeBytes: 42,
    });
    expect(foreignProjectDocument.status).toBe(201);
    const crossProjectLink = await owner(
      request(app)
        .put(
          base +
            "/owner-management/tasks/" +
            task.body.record.id +
            "/documents",
        )
        .send({ documentIds: [foreignProjectDocument.body.record.id] }),
    );
    expect(crossProjectLink.status).toBe(400);
    expect(crossProjectLink.body.error.details.field).toBe("documentIds");

    const unlinkTaskDocument = await owner(
      request(app)
        .put(
          base +
            "/owner-management/tasks/" +
            task.body.record.id +
            "/documents",
        )
        .send({ documentIds: [] }),
    );
    expect(unlinkTaskDocument.status).toBe(200);
    expect(unlinkTaskDocument.body.documents).toHaveLength(0);
    const originalDocumentStillExists = await owner(
      request(app).get(
        base + "/owner-management/documents?projectId=" + projectId,
      ),
    );
    expect(originalDocumentStillExists.status).toBe(200);
    expect(
      originalDocumentStillExists.body.records.some(
        (document: { id: string }) =>
          document.id === landDocument.body.record.id,
      ),
    ).toBe(true);

    const supplier = await post("suppliers", {
      code: "build_supply",
      name: "Build Supply Congo",
      supplierType: "materials",
      status: "active",
    });
    const item = await post("inventory-items", {
      code: "cement_bag",
      name: "Cement bag",
      unit: "bag",
      reorderLevel: 50,
      standardUnitCost: 10,
    });
    const warehouse = await post("warehouses", {
      siteId: site.body.site.id,
      code: "main_store",
      name: "Main Store",
    });
    expect(supplier.status).toBe(201);
    expect(item.status).toBe(201);
    expect(warehouse.status).toBe(201);

    const material = await post("materials", {
      projectId,
      phaseId: phase.body.record.id,
      inventoryItemId: item.body.record.id,
      defaultWarehouseId: warehouse.body.record.id,
      preferredSupplierId: supplier.body.record.id,
      code: "cement",
      name: "Cement",
      category: "Construction",
      unit: "bag",
      plannedQuantity: 500,
      estimatedUnitCost: 10,
    });
    expect(material.status).toBe(201);

    const purchaseRequest = await post("purchase-requests", {
      requestNumber: "PR-00001",
      projectId,
      phaseId: phase.body.record.id,
      supplierId: supplier.body.record.id,
      reason: "Cement needed for the poultry house foundation",
      currencyCode: "USD",
      status: "submitted",
      approvalStatus: "pending",
    });
    const requestLine = await post("purchase-request-lines", {
      purchaseRequestId: purchaseRequest.body.record.id,
      projectMaterialId: material.body.record.id,
      inventoryItemId: item.body.record.id,
      description: "Cement",
      itemKind: "material",
      unit: "bag",
      requestedQuantity: 500,
      approvedQuantity: 500,
      estimatedUnitCost: 10,
    });
    expect(requestLine.status).toBe(201);

    const approval = await post("approvals", {
      approvalNumber: "APR-00001",
      projectId,
      entityType: "purchase_request",
      entityId: purchaseRequest.body.record.id,
      requestType: "purchase_request",
      requestedAmount: 5000,
      currencyCode: "USD",
      requestNotes: "Approve cement purchase",
    });
    const decision = await owner(
      request(app)
        .post(
          base +
            "/owner-management/approvals/" +
            approval.body.record.id +
            "/decide",
        )
        .send({
          decision: "approved",
          decisionNotes: "Approved for construction.",
        }),
    );
    expect(decision.status).toBe(200);
    expect(decision.body.approval.status).toBe("approved");

    const order = await post("purchase-orders", {
      orderNumber: "PO-00001",
      projectId,
      phaseId: phase.body.record.id,
      purchaseRequestId: purchaseRequest.body.record.id,
      supplierId: supplier.body.record.id,
      warehouseId: warehouse.body.record.id,
      orderDate: "2026-08-26",
      status: "sent",
      currencyCode: "USD",
    });
    const orderLine = await post("purchase-order-lines", {
      purchaseOrderId: order.body.record.id,
      purchaseRequestLineId: requestLine.body.record.id,
      projectMaterialId: material.body.record.id,
      inventoryItemId: item.body.record.id,
      description: "Cement",
      itemKind: "material",
      unit: "bag",
      orderedQuantity: 500,
      unitCost: 10,
      taxAmount: 0,
    });
    const receipt = await post("receipts", {
      receiptNumber: "GRN-00001",
      purchaseOrderId: order.body.record.id,
      projectId,
      warehouseId: warehouse.body.record.id,
      receivedDate: "2026-08-26",
      status: "received",
    });
    const receiptLine = await post("receipt-lines", {
      receiptId: receipt.body.record.id,
      purchaseOrderLineId: orderLine.body.record.id,
      projectMaterialId: material.body.record.id,
      inventoryItemId: item.body.record.id,
      receivedQuantity: 350,
      damagedQuantity: 0,
      rejectedQuantity: 0,
      actualUnitCost: 10,
    });
    expect(receiptLine.status).toBe(201);

    const materialUse = await post("material-movements", {
      projectMaterialId: material.body.record.id,
      warehouseId: warehouse.body.record.id,
      movementDate: "2026-08-26",
      movementType: "used",
      quantity: 280,
      projectTaskId: task.body.record.id,
    });
    expect(materialUse.status).toBe(201);

    const expense = await post("expenses", {
      expenseNumber: "EXP-00001",
      projectId,
      phaseId: phase.body.record.id,
      provinceId: province.body.province.id,
      siteId: site.body.site.id,
      supplierId: supplier.body.record.id,
      purchaseOrderId: order.body.record.id,
      receiptId: receipt.body.record.id,
      category: "Construction materials",
      description: "Cement delivered and accepted",
      amount: 3500,
      currencyCode: "USD",
      expenseDate: "2026-08-26",
      status: "paid",
    });
    expect(expense.status).toBe(201);

    const durableOrder = await post("purchase-orders", {
      orderNumber: "PO-00002",
      projectId,
      phaseId: phase.body.record.id,
      supplierId: supplier.body.record.id,
      warehouseId: warehouse.body.record.id,
      orderDate: "2026-08-26",
      status: "sent",
      currencyCode: "USD",
    });
    const durableOrderLine = await post("purchase-order-lines", {
      purchaseOrderId: durableOrder.body.record.id,
      description: "Generator",
      itemKind: "asset",
      unit: "each",
      orderedQuantity: 2,
      unitCost: 5000,
      assetName: "Generator",
      assetCategory: "Generator",
    });
    const durableReceipt = await post("receipts", {
      receiptNumber: "GRN-00002",
      purchaseOrderId: durableOrder.body.record.id,
      projectId,
      warehouseId: warehouse.body.record.id,
      receivedDate: "2026-08-26",
      status: "received",
    });
    const durableReceiptLine = await post("receipt-lines", {
      receiptId: durableReceipt.body.record.id,
      purchaseOrderLineId: durableOrderLine.body.record.id,
      receivedQuantity: 2,
      damagedQuantity: 0,
      rejectedQuantity: 0,
      actualUnitCost: 5000,
    });
    expect(durableReceiptLine.status).toBe(201);
    const receivedAssets = await owner(
      request(app).get(
        base + "/owner-management/assets?projectId=" + projectId,
      ),
    );
    expect(receivedAssets.status).toBe(200);
    expect(receivedAssets.body.records).toHaveLength(2);
    expect(receivedAssets.body.records[0].assetNumber).toMatch(/^AST-\d{5}$/);
    const asset = await post("assets", {
      projectId,
      provinceId: province.body.province.id,
      siteId: site.body.site.id,
      name: "Tractor 01",
      category: "Tractor",
      purchasePrice: 25000,
      purchaseDate: "2026-08-26",
      currencyCode: "USD",
      meterType: "engine_hours",
      currentMeterReading: 1200,
      status: "available",
    });
    expect(asset.status).toBe(201);
    expect(asset.body.record.assetNumber).toMatch(/^AST-\d{5}$/);

    const usage = await post("asset-usage", {
      assetId: asset.body.record.id,
      projectId,
      siteId: site.body.site.id,
      usageDate: "2026-08-26",
      meterStart: 1200,
      meterEnd: 1210,
      fuelConsumed: 14,
      workPerformed: "Prepared the poultry expansion site",
      areaCovered: 1.5,
    });
    const plan = await post("maintenance-plans", {
      assetId: asset.body.record.id,
      name: "Tractor 100-hour service",
      maintenanceType: "preventive",
      intervalMeter: 100,
      nextDueMeter: 1300,
      estimatedCost: 180,
    });
    const workOrder = await post("maintenance-work-orders", {
      workOrderNumber: "WO-00001",
      planId: plan.body.record.id,
      assetId: asset.body.record.id,
      projectId,
      maintenanceType: "preventive",
      status: "in_progress",
      title: "Tractor routine service",
      meterReading: 1210,
      laborCost: 40,
    });
    expect(usage.status).toBe(201);
    expect(plan.status).toBe(201);
    expect(workOrder.status).toBe(201);

    const part = await post("maintenance-parts", {
      workOrderId: workOrder.body.record.id,
      inventoryItemId: item.body.record.id,
      warehouseId: warehouse.body.record.id,
      partName: "Cement bag used as test stock item",
      quantity: 1,
      unit: "bag",
      unitCost: 10,
    });
    expect(part.status).toBe(201);
    const completed = await owner(
      request(app)
        .patch(
          base +
            "/owner-management/maintenance-work-orders/" +
            workOrder.body.record.id,
        )
        .send({ status: "completed", meterReading: 1210 }),
    );
    expect(completed.status).toBe(200);

    const poultryHouse = await owner(
      request(app)
        .post(base + "/poultry/houses")
        .send({
          siteId: site.body.site.id,
          code: "project_house",
          name: "Project poultry house",
          houseType: "broiler",
          capacity: 500,
        }),
    );
    expect(poultryHouse.status).toBe(201);
    const poultryFlock = await owner(
      request(app)
        .post(base + "/poultry/flocks")
        .send({
          houseId: poultryHouse.body.record.id,
          code: "project_flock",
          name: "Project broiler flock",
          birdType: "broiler",
          arrivalDate: "2026-08-26",
          initialBirdCount: 500,
        }),
    );
    expect(poultryFlock.status).toBe(201);
    const operationalLink = await post("operational-links", {
      projectId,
      moduleCode: "poultry",
      resourceCode: "flocks",
      recordId: poultryFlock.body.record.id,
      linkType: "acquired_for_project",
    });
    expect(operationalLink.status).toBe(201);

    const otherSite = await owner(
      request(app)
        .post(base + "/sites")
        .send({
          provinceId: province.body.province.id,
          code: "other_project_site",
          name: "Other Project Site",
          siteType: "farm",
        }),
    );
    expect(otherSite.status).toBe(201);
    const otherWarehouse = await post("warehouses", {
      siteId: otherSite.body.site.id,
      code: "other_project_store",
      name: "Other Project Store",
    });
    expect(otherWarehouse.status).toBe(201);
    const otherHouse = await owner(
      request(app)
        .post(base + "/poultry/houses")
        .send({
          siteId: otherSite.body.site.id,
          code: "other_project_house",
          name: "Other project house",
          houseType: "broiler",
          capacity: 500,
        }),
    );
    expect(otherHouse.status).toBe(201);
    const otherFlock = await owner(
      request(app)
        .post(base + "/poultry/flocks")
        .send({
          houseId: otherHouse.body.record.id,
          code: "other_project_flock",
          name: "Other project flock",
          birdType: "broiler",
          arrivalDate: "2026-08-26",
          initialBirdCount: 500,
        }),
    );
    expect(otherFlock.status).toBe(201);
    const outsideProjectSite = await post("operational-links", {
      projectId,
      moduleCode: "poultry",
      resourceCode: "flocks",
      recordId: otherFlock.body.record.id,
      linkType: "acquired_for_project",
    });
    expect(outsideProjectSite.status).toBe(400);
    expect(outsideProjectSite.body.error.details.field).toBe("recordId");
    const summary = await owner(
      request(app).get(
        base + "/owner-management/projects/" + projectId + "/summary",
      ),
    );
    expect(summary.status).toBe(200);
    expect(summary.body.project.operationalLinks).toHaveLength(1);
    expect(summary.body.project.operationalLinks[0].targetName).toBe(
      "Project broiler flock",
    );
    expect(Number(summary.body.project.budget.spent)).toBe(3500);
    expect(Number(summary.body.project.materials[0].availableQuantity)).toBe(
      70,
    );
    expect(Number(summary.body.project.materials[0].stillNeeded)).toBe(0);

    // Relational dropdown APIs must return a real identifier and a human label.
    // The Project Control Centre normalizes these fields before rendering options.
    const selectorChecks = [
      {
        resource: "suppliers",
        expectedId: supplier.body.record.id,
        labelFields: ["name", "code"],
      },
      {
        resource: "inventory-items",
        expectedId: item.body.record.id,
        labelFields: ["name", "code"],
      },
      {
        resource: "warehouses?siteId=" + site.body.site.id,
        expectedId: warehouse.body.record.id,
        labelFields: ["name", "code"],
      },
      {
        resource: "phases?projectId=" + projectId,
        expectedId: phase.body.record.id,
        labelFields: ["name", "code"],
      },
      {
        resource: "tasks?projectId=" + projectId,
        expectedId: task.body.record.id,
        labelFields: ["title", "code"],
      },
      {
        resource: "materials?projectId=" + projectId,
        expectedId: material.body.record.id,
        labelFields: ["name", "code"],
      },
      {
        resource: "purchase-requests?projectId=" + projectId,
        expectedId: purchaseRequest.body.record.id,
        labelFields: ["requestNumber"],
      },
      {
        resource: "purchase-orders?projectId=" + projectId,
        expectedId: order.body.record.id,
        labelFields: ["orderNumber"],
      },
      {
        resource: "receipts?projectId=" + projectId,
        expectedId: receipt.body.record.id,
        labelFields: ["receiptNumber"],
      },
      {
        resource: "assets?projectId=" + projectId,
        expectedId: asset.body.record.id,
        labelFields: ["name", "assetNumber", "code"],
      },
      {
        resource: "maintenance-work-orders?projectId=" + projectId,
        expectedId: workOrder.body.record.id,
        labelFields: ["workOrderNumber", "title"],
      },
    ];
    for (const selector of selectorChecks) {
      const response = await owner(
        request(app).get(base + "/owner-management/" + selector.resource),
      );
      expect(response.status, selector.resource).toBe(200);
      const record = response.body.records.find(
        (row: { id: string }) => row.id === selector.expectedId,
      );
      expect(record, selector.resource).toBeTruthy();
      expect(
        selector.labelFields
          .map((field) => String(record?.[field] ?? "").trim())
          .some(Boolean),
        selector.resource,
      ).toBe(true);
    }
    const siteWarehouses = await owner(
      request(app).get(
        base + "/owner-management/warehouses?siteId=" + site.body.site.id,
      ),
    );
    expect(siteWarehouses.status).toBe(200);
    expect(
      siteWarehouses.body.records.every(
        (record: { siteId: string }) => record.siteId === site.body.site.id,
      ),
    ).toBe(true);
    expect(
      siteWarehouses.body.records.some(
        (record: { id: string }) => record.id === otherWarehouse.body.record.id,
      ),
    ).toBe(false);

    const directProjectResources = [
      "phases",
      "project-members",
      "operational-links",
      "tasks",
      "budget-lines",
      "materials",
      "purchase-requests",
      "purchase-orders",
      "receipts",
      "assets",
      "asset-usage",
      "vehicle-trips",
      "maintenance-work-orders",
      "expenses",
      "approvals",
      "documents",
    ];
    for (const resource of directProjectResources) {
      const response = await owner(
        request(app).get(
          base + "/owner-management/" + resource + "?projectId=" + projectId,
        ),
      );
      expect(response.status, resource).toBe(200);
    }
    const childResources = [
      "material-movements",
      "purchase-request-lines",
      "purchase-order-lines",
      "receipt-lines",
      "asset-assignments",
      "asset-movements",
      "vehicle-profiles",
      "maintenance-plans",
      "maintenance-parts",
    ];
    for (const resource of childResources) {
      const response = await owner(
        request(app).get(base + "/owner-management/" + resource),
      );
      expect(response.status, resource).toBe(200);
    }
    const activity = await owner(
      request(app).get(
        base + "/owner-management/projects/" + projectId + "/activity",
      ),
    );
    expect(activity.status).toBe(200);
    expect(
      activity.body.activity.some(
        (event: { entityType: string }) => event.entityType === "task",
      ),
    ).toBe(true);

    const exportFile = await owner(
      request(app)
        .get(base + "/owner-management/projects/" + projectId + "/export.xlsx")
        .buffer(true)
        .parse(binaryParser),
    );
    expect(exportFile.status).toBe(200);
    expect(exportFile.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(Number(exportFile.headers["content-length"])).toBeGreaterThan(1000);
    expect(Buffer.isBuffer(exportFile.body)).toBe(true);
    const exportedWorkbook = new ExcelJS.Workbook();
    await exportedWorkbook.xlsx.load(exportFile.body as Buffer);
    expect(exportedWorkbook.worksheets.map((sheet) => sheet.name)).toEqual(
      expect.arrayContaining([
        "Project Overview",
        "Budget",
        "Expenses",
        "Procurement",
        "Tasks",
        "Resources",
        "Equipment",
        "Documents Index",
        "Activity",
      ]),
    );
    const pdfFile = await owner(
      request(app)
        .get(base + "/owner-management/projects/" + projectId + "/export.pdf")
        .buffer(true)
        .parse(binaryParser),
    );
    expect(pdfFile.status).toBe(200);
    expect(pdfFile.headers["content-type"]).toContain("application/pdf");
    expect(Number(pdfFile.headers["content-length"])).toBeGreaterThan(1000);
    expect(Buffer.isBuffer(pdfFile.body)).toBe(true);
    expect((pdfFile.body as Buffer).subarray(0, 5).toString("ascii")).toBe(
      "%PDF-",
    );
    const dashboard = await owner(
      request(app).get(base + "/owner-management/dashboard"),
    );
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.dashboard.projects.active).toBe(1);
    expect(dashboard.body.dashboard.assets.total).toBe(3);
  });
});
