import path from "node:path";
import type { PoolClient } from "pg";
import { withTenantContext } from "../../utils/tenant-query";
import {
  assertDocumentPolicy,
  visibleDocumentIds,
} from "../../services/document-access.service";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import {
  deletePrivateDocument,
  deleteStoredImage,
  readPrivateDocument,
  storeImage,
  storePrivateDocument,
} from "../../services/file-storage.service";
import {
  getAgricultureRecord,
  type AgricultureContext,
} from "../agriculture/agriculture.service";
import type { AgricultureResource } from "../agriculture/agriculture.validation";
import {
  getOwnerManagementRecord,
  linkTaskDocumentInTransaction,
  type OwnerManagementContext,
} from "../owner-management/owner-management.service";
import type { OwnerManagementResource } from "../owner-management/owner-management.validation";
import { getPigRecord, type PigContext } from "../pigs/pig.service";
import type { PigResource } from "../pigs/pig.validation";
import {
  getPoultryRecord,
  type PoultryContext,
} from "../poultry/poultry.service";
import type { PoultryResource } from "../poultry/poultry.validation";
import {
  isAttachmentTarget,
  type AttachmentModule,
  type AttachmentResource,
  type AttachmentTarget,
  type AttachmentUploadInput,
} from "./file-upload.validation";

type Row = Record<string, unknown>;
export interface FileContext extends OwnerManagementContext {
  permissions: string[];
}

const ownerPermissions: Partial<Record<OwnerManagementResource, string>> = {
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
};
const poultryPermissions: Record<PoultryResource, string> = {
  houses: "houses",
  flocks: "flocks",
  "daily-records": "daily_records",
  mortality: "mortality",
  feed: "feed",
  water: "water",
  weights: "weights",
  eggs: "eggs",
  health: "health",
  vaccinations: "vaccinations",
  treatments: "treatments",
  sanitation: "sanitation",
  biosecurity: "biosecurity",
  "production-targets": "production_targets",
  losses: "losses",
};
const pigPermissions: Record<PigResource, string> = {
  pens: "pens",
  groups: "groups",
  animals: "animals",
  "daily-records": "daily_records",
  feed: "feed",
  water: "water",
  weights: "weights",
  movements: "movements",
  mortality: "mortality",
  losses: "losses",
  breeding: "breeding",
  pregnancies: "pregnancies",
  farrowing: "farrowing",
  piglets: "piglets",
  health: "health",
  vaccinations: "vaccinations",
  treatments: "treatments",
  quarantine: "quarantine",
  veterinary: "veterinary",
};
const agriculturePermissions: Record<AgricultureResource, string> = {
  farms: "farms",
  fields: "fields",
  plots: "plots",
  crops: "crops",
  seasons: "seasons",
  plantings: "plantings",
  operations: "operations",
  irrigation: "irrigation",
  fertilizer: "fertilizer",
  pesticides: "pesticides",
  scouting: "scouting",
  weather: "weather",
  harvest: "harvest",
  "production-targets": "production_targets",
  losses: "losses",
};

function industryContext(
  context: FileContext,
): PoultryContext & PigContext & AgricultureContext {
  return {
    organizationId: context.organizationId,
    userId: context.userId,
    memberId: context.memberId,
    isOwner: context.isOwner,
  };
}
function mapRow(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z0-9])/g, (_match, letter: string) =>
        letter.toUpperCase(),
      ),
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
}
function entityType(
  target: Pick<AttachmentTarget, "module" | "resource">,
): string {
  return `${target.module}:${target.resource}`;
}
function permissionFor(
  module: AttachmentModule,
  resource: AttachmentResource,
  action: "read" | "update",
): string {
  if (module === "owner-management") {
    const permission = ownerPermissions[resource as OwnerManagementResource];
    if (!permission)
      throw new BadRequestError(
        "This record type does not support image attachments. Use the secure Documents library for evidence files.",
      );
    return `${permission}.${action}`;
  }
  if (module === "poultry")
    return `poultry.${poultryPermissions[resource as PoultryResource]}.${action}`;
  if (module === "pigs")
    return `pigs.${pigPermissions[resource as PigResource]}.${action}`;
  return `agriculture.${agriculturePermissions[resource as AgricultureResource]}.${action}`;
}
function assertPermission(
  context: FileContext,
  target: Pick<AttachmentTarget, "module" | "resource" | "recordId">,
  action: "read" | "update",
): void {
  const required = permissionFor(
    target.module,
    target.resource as AttachmentResource,
    action,
  );
  if (!context.permissions.includes(required))
    throw new ForbiddenError(
      "You do not have permission to manage images on this record",
      { required: [required] },
    );
}
/**
 * An employee may attach evidence only to a work task assigned directly to
 * them. This deliberately does not grant access to the project workspace or
 * to another employee's task.
 */
async function directTaskAssignment(
  context: FileContext,
  taskId: string,
): Promise<{ projectId: string | null } | null> {
  return withTenantContext(context, async (client) => {
    const result = await client.query<{ project_id: string | null }>(
      `SELECT project_id
         FROM management_project_tasks
        WHERE organization_id = $1
          AND id = $2
          AND assigned_member_id = $3
          AND COALESCE(task_type, 'work') = 'work'`,
      [context.organizationId, taskId, context.memberId],
    );
    const row = result.rows[0];
    return row ? { projectId: row.project_id } : null;
  });
}

async function assertTargetAccess(
  context: FileContext,
  target: Pick<AttachmentTarget, "module" | "resource" | "recordId">,
  action: "read" | "update",
): Promise<string | null> {
  if (target.module === "owner-management" && target.resource === "tasks") {
    const assigned = await directTaskAssignment(context, target.recordId);
    if (assigned) return assigned.projectId;
  }

  assertPermission(context, target, action);
  const industry = industryContext(context);
  if (target.module === "owner-management") {
    const record = await getOwnerManagementRecord(
      context,
      target.resource as OwnerManagementResource,
      target.recordId,
    );
    return target.resource === "projects"
      ? target.recordId
      : typeof record.projectId === "string"
        ? record.projectId
        : null;
  }
  if (target.module === "poultry")
    await getPoultryRecord(
      industry,
      target.resource as PoultryResource,
      target.recordId,
    );
  else if (target.module === "pigs")
    await getPigRecord(
      industry,
      target.resource as PigResource,
      target.recordId,
    );
  else
    await getAgricultureRecord(
      industry,
      target.resource as AgricultureResource,
      target.recordId,
    );
  return null;
}
function titleFor(
  file: Express.Multer.File,
  input: AttachmentUploadInput,
): string {
  if (input.title) return input.title;
  return (
    path
      .basename(file.originalname, path.extname(file.originalname))
      .trim()
      .slice(0, 200) || "Image"
  );
}

async function documentCategoryForUpload(
  client: PoolClient,
  context: FileContext,
  categoryId: string | undefined,
  defaultCategoryCode?: "general" | "task_evidence",
): Promise<{
  id: string;
  code: string;
  visibility: "company" | "owner_only";
} | null> {
  if (!categoryId && !defaultCategoryCode) return null;
  const category = await client.query<{
    id: string;
    code: string;
    visibility: "company" | "owner_only";
  }>(
    categoryId
      ? "SELECT id, code, visibility FROM management_document_categories WHERE organization_id = $1 AND id = $2 AND is_active = true"
      : "SELECT id, code, visibility FROM management_document_categories WHERE organization_id = $1 AND code = $2 AND is_active = true",
    [context.organizationId, categoryId ?? defaultCategoryCode],
  );
  const row = category.rows[0];
  if (!row && !categoryId) return null;
  if (!row)
    throw new BadRequestError(
      "Choose an active document category that belongs to this company",
      { field: "categoryId" },
    );
  if (row.visibility === "owner_only" && !context.isOwner)
    throw new ForbiddenError(
      "Only the workspace owner can add files to this private category",
    );
  return row;
}
export async function listAttachments(
  context: FileContext,
  target: AttachmentTarget,
): Promise<Row[]> {
  await assertTargetAccess(context, target, "read");
  return withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      "SELECT id, project_id, entity_type, entity_id, title, document_type, document_category_id, alt_text, storage_provider, mime_type, file_size_bytes, width, height, uploaded_by_member_id, created_at, visibility, can_download, can_edit, is_locked, locked_by_member_id, locked_at FROM management_document_links WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 ORDER BY created_at DESC",
      [context.organizationId, entityType(target), target.recordId],
    );
    const visible = await visibleDocumentIds(
      client,
      context,
      result.rows.map((row) => String(row.id)),
    );
    return result.rows.filter((row) => visible.has(String(row.id))).map(mapRow);
  });
}
export async function uploadAttachment(
  context: FileContext,
  target: AttachmentTarget,
  input: AttachmentUploadInput,
  file: Express.Multer.File,
): Promise<Row> {
  const projectId = await assertTargetAccess(context, target, "update");
  const stored = await storeImage({
    organizationId: context.organizationId,
    module: target.module,
    resource: target.resource,
    originalName: file.originalname,
    mimeType: file.mimetype,
    buffer: file.buffer,
  });
  try {
    return await withTenantContext(context, async (client) => {
      const defaultCategory =
        target.module === "owner-management" && projectId
          ? target.resource === "tasks"
            ? "task_evidence"
            : "general"
          : undefined;
      const category = await documentCategoryForUpload(
        client,
        context,
        input.categoryId,
        defaultCategory,
      );
      const result = await client.query<Row>(
        "INSERT INTO management_document_links (organization_id, project_id, entity_type, entity_id, title, document_type, document_category_id, alt_text, storage_provider, storage_key, storage_public_id, storage_url, mime_type, file_size_bytes, width, height, uploaded_by_member_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'cloudinary',$9,$9,$10,$11,$12,$13,$14,$15) RETURNING id, project_id, entity_type, entity_id, title, document_type, document_category_id, alt_text, storage_provider, mime_type, file_size_bytes, width, height, uploaded_by_member_id, created_at, visibility, can_download, can_edit, is_locked, locked_by_member_id, locked_at",
        [
          context.organizationId,
          projectId,
          entityType(target),
          target.recordId,
          titleFor(file, input),
          category?.code ?? input.imageType ?? null,
          category?.id ?? null,
          input.altText ?? null,
          stored.storageKey,
          stored.url,
          stored.mimeType,
          stored.bytes,
          stored.width,
          stored.height,
          context.memberId,
        ],
      );
      const attachment = result.rows[0] ?? {};
      // A task image remains a reusable project document. This lets an assignee
      // submit evidence without access to the owner-only Project Control Centre.
      if (
        target.module === "owner-management" &&
        target.resource === "tasks" &&
        projectId &&
        attachment.id
      ) {
        await linkTaskDocumentInTransaction(
          client,
          context,
          target.recordId,
          String(attachment.id),
        );
      }
      return mapRow(attachment);
    });
  } catch (error) {
    await deleteStoredImage({
      provider: stored.provider,
      publicId: stored.publicId,
    }).catch(() => undefined);
    throw error;
  }
}
/** Stores a PDF or other approved document privately, then links it only to
 * the work task the employee was assigned. It is also a project document, but
 * the uploader never needs broad project or document-library access. */
export async function uploadTaskEvidence(
  context: FileContext,
  taskId: string,
  input: AttachmentUploadInput,
  file: Express.Multer.File,
): Promise<Row> {
  const target = {
    module: "owner-management",
    resource: "tasks",
    recordId: taskId,
  } as AttachmentTarget;
  const projectId = await assertTargetAccess(context, target, "update");
  if (!projectId)
    throw new BadRequestError("This work task is not linked to a project");

  const stored = await storePrivateDocument({
    organizationId: context.organizationId,
    originalName: file.originalname,
    mimeType: file.mimetype,
    buffer: file.buffer,
  });
  try {
    return await withTenantContext(context, async (client) => {
      // Evidence is already linked to the task and project below. Put it in the
      // company’s Task Evidence folder too, falling back to Photo Evidence for
      // older workspaces that do not yet have the dedicated folder.
      const categoryResult = await client.query<{ id: string; code: string }>(
        `SELECT id, code
         FROM management_document_categories
         WHERE organization_id = $1
           AND is_active = true
           AND code IN ('task_evidence', 'photo')
         ORDER BY CASE code WHEN 'task_evidence' THEN 0 WHEN 'photo' THEN 1 ELSE 2 END
         LIMIT 1`,
        [context.organizationId],
      );
      const category = categoryResult.rows[0] ?? null;

      const result = await client.query<Row>(
        `INSERT INTO management_document_links
           (organization_id,project_id,entity_type,entity_id,title,document_type,document_category_id,alt_text,storage_provider,storage_key,mime_type,file_size_bytes,uploaded_by_member_id)
         VALUES ($1,$2,$3,$4,$5,'task_evidence',$6,$7,'private_document',$8,$9,$10,$11)
         RETURNING id,project_id,entity_type,entity_id,title,document_type,document_category_id,alt_text,storage_provider,mime_type,file_size_bytes,uploaded_by_member_id,created_at,visibility,can_download,can_edit,is_locked,locked_by_member_id,locked_at`,
        [
          context.organizationId,
          projectId,
          entityType(target),
          taskId,
          input.title ??
            `${path.basename(file.originalname, path.extname(file.originalname)).trim() || "Evidence"}`,
          category?.id ?? null,
          input.altText ?? null,
          stored.storagePath,
          stored.mimeType,
          stored.bytes,
          context.memberId,
        ],
      );
      const attachment = result.rows[0];
      if (!attachment)
        throw new BadRequestError("Could not save the task evidence document");
      await linkTaskDocumentInTransaction(
        client,
        context,
        taskId,
        String(attachment.id),
      );
      return mapRow(attachment);
    });
  } catch (error) {
    await deletePrivateDocument(stored.storagePath).catch(() => undefined);
    throw error;
  }
}

/** Stores a supplier delivery note, invoice or photo against the exact receipt.
 * The file remains a project document as well, so it appears in Documents and
 * follows the same permission checks for preview and download. */
export async function uploadReceiptEvidence(
  context: FileContext,
  receiptId: string,
  input: AttachmentUploadInput,
  file: Express.Multer.File,
): Promise<Row> {
  const target = {
    module: "owner-management",
    resource: "receipts",
    recordId: receiptId,
  } as AttachmentTarget;
  const projectId = await assertTargetAccess(context, target, "update");
  if (!projectId)
    throw new BadRequestError("This receipt is not linked to a project");

  const receipt = await getOwnerManagementRecord(context, "receipts", receiptId);
  const receiptNumber = String(receipt.receiptNumber ?? "Receipt").trim() || "Receipt";
  const stored = await storePrivateDocument({
    organizationId: context.organizationId,
    originalName: file.originalname,
    mimeType: file.mimetype,
    buffer: file.buffer,
  });
  try {
    return await withTenantContext(context, async (client) => {
      const category = await documentCategoryForUpload(
        client,
        context,
        input.categoryId,
        "general",
      );
      const title = `${receiptNumber} · ${titleFor(file, input)}`.slice(0, 200);
      const result = await client.query<Row>(
        `INSERT INTO management_document_links
           (organization_id,project_id,entity_type,entity_id,title,document_type,document_category_id,alt_text,storage_provider,storage_key,mime_type,file_size_bytes,uploaded_by_member_id)
         VALUES ($1,$2,$3,$4,$5,'receipt_evidence',$6,$7,'private_document',$8,$9,$10,$11)
         RETURNING id,project_id,entity_type,entity_id,title,document_type,document_category_id,alt_text,storage_provider,mime_type,file_size_bytes,uploaded_by_member_id,created_at,visibility,can_download,can_edit,is_locked,locked_by_member_id,locked_at`,
        [
          context.organizationId,
          projectId,
          entityType(target),
          receiptId,
          title,
          category?.id ?? null,
          input.altText ?? null,
          stored.storagePath,
          stored.mimeType,
          stored.bytes,
          context.memberId,
        ],
      );
      const document = result.rows[0];
      if (!document)
        throw new BadRequestError("Could not save the receipt document");
      return mapRow(document);
    });
  } catch (error) {
    await deletePrivateDocument(stored.storagePath).catch(() => undefined);
    throw error;
  }
}
/** Stores an invoice, receipt or payment proof against one expense. The document
 * remains in the project library and inherits the same tenant and role checks. */
export async function uploadExpenseEvidence(
  context: FileContext,
  expenseId: string,
  input: AttachmentUploadInput,
  file: Express.Multer.File,
): Promise<Row> {
  const target = {
    module: "owner-management",
    resource: "expenses",
    recordId: expenseId,
  } as AttachmentTarget;
  const projectId = await assertTargetAccess(context, target, "update");
  if (!projectId)
    throw new BadRequestError("This expense is not linked to a project");

  const expense = await getOwnerManagementRecord(context, "expenses", expenseId);
  const expenseNumber = String(expense.expenseNumber ?? "Expense").trim() || "Expense";
  const stored = await storePrivateDocument({
    organizationId: context.organizationId,
    originalName: file.originalname,
    mimeType: file.mimetype,
    buffer: file.buffer,
  });
  try {
    return await withTenantContext(context, async (client) => {
      const category = await documentCategoryForUpload(
        client,
        context,
        input.categoryId,
        "general",
      );
      const title = `${expenseNumber} · ${titleFor(file, input)}`.slice(0, 200);
      const result = await client.query<Row>(
        `INSERT INTO management_document_links
           (organization_id,project_id,entity_type,entity_id,title,document_type,document_category_id,alt_text,storage_provider,storage_key,mime_type,file_size_bytes,uploaded_by_member_id)
         VALUES ($1,$2,$3,$4,$5,'expense_evidence',$6,$7,'private_document',$8,$9,$10,$11)
         RETURNING id,project_id,entity_type,entity_id,title,document_type,document_category_id,alt_text,storage_provider,mime_type,file_size_bytes,uploaded_by_member_id,created_at,visibility,can_download,can_edit,is_locked,locked_by_member_id,locked_at`,
        [
          context.organizationId,
          projectId,
          entityType(target),
          expenseId,
          title,
          category?.id ?? null,
          input.altText ?? null,
          stored.storagePath,
          stored.mimeType,
          stored.bytes,
          context.memberId,
        ],
      );
      const document = result.rows[0];
      if (!document)
        throw new BadRequestError("Could not save the expense document");
      return mapRow(document);
    });
  } catch (error) {
    await deletePrivateDocument(stored.storagePath).catch(() => undefined);
    throw error;
  }
}
type StoredAttachment = Row & { buffer?: Buffer };
async function materializeStoredAttachment(
  attachment: Row,
): Promise<StoredAttachment> {
  const mapped = mapRow(attachment);
  if (attachment.storage_provider !== "private_document") return mapped;
  const storageKey =
    typeof attachment.storage_key === "string" ? attachment.storage_key : "";
  if (!storageKey)
    throw new BadRequestError("This private evidence document has no file");
  return { ...mapped, buffer: await readPrivateDocument(storageKey) };
}

/** Resolves a stored project file only after either its original record or a
 * linked, visible task has passed the same tenant and permission checks. */
export async function getStoredAttachment(
  context: FileContext,
  fileId: string,
  mode: "preview" | "download" = "preview",
): Promise<Row> {
  const attachment = await withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      "SELECT id, entity_type, entity_id, title, document_type, storage_provider, storage_key, storage_url, mime_type, file_size_bytes, uploaded_by_member_id, created_at FROM management_document_links WHERE organization_id = $1 AND id = $2",
      [context.organizationId, fileId],
    );
    if (!result.rows[0]) throw new NotFoundError("Document not found");
    const policy = await assertDocumentPolicy(
      client,
      context,
      fileId,
      mode === "download" ? "download" : "read",
    );
    return { attachment: result.rows[0], policy };
  });

  // An explicit document grant is sufficient for a restricted file. Company
  // files retain the existing target/module permission check below.
  if (!attachment.policy.requiresTargetAccess)
    return materializeStoredAttachment(attachment.attachment);

  const [rawModule, rawResource] = String(
    attachment.attachment.entity_type,
  ).split(":", 2);
  const directTarget = {
    module: rawModule ?? "",
    resource: rawResource ?? "",
    recordId: String(attachment.attachment.entity_id),
  } as AttachmentTarget;
  if (isAttachmentTarget(directTarget.module, directTarget.resource)) {
    try {
      await assertTargetAccess(context, directTarget, "read");
      return materializeStoredAttachment(attachment.attachment);
    } catch (error) {
      if (
        !(error instanceof ForbiddenError) &&
        !(error instanceof NotFoundError)
      )
        throw error;
    }
  }
  const taskLinks = await withTenantContext(context, async (client) => {
    const result = await client.query<{ task_id: string }>(
      "SELECT task_id FROM management_project_task_document_links WHERE organization_id = $1 AND document_id = $2 ORDER BY created_at DESC",
      [context.organizationId, fileId],
    );
    return result.rows;
  });
  for (const link of taskLinks) {
    try {
      await assertTargetAccess(
        context,
        {
          module: "owner-management",
          resource: "tasks",
          recordId: link.task_id,
        },
        "read",
      );
      return materializeStoredAttachment(attachment.attachment);
    } catch (error) {
      if (
        !(error instanceof ForbiddenError) &&
        !(error instanceof NotFoundError)
      )
        throw error;
    }
  }
  throw new NotFoundError("Document not found");
}
export async function deleteAttachment(
  context: FileContext,
  imageId: string,
): Promise<void> {
  const attachment = await withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      "SELECT id, entity_type, entity_id, storage_provider, storage_key, storage_public_id FROM management_document_links WHERE organization_id = $1 AND id = $2",
      [context.organizationId, imageId],
    );
    if (!result.rows[0]) throw new NotFoundError("Image attachment not found");
    return result.rows[0];
  });
  await withTenantContext(context, async (client) => {
    await assertDocumentPolicy(client, context, imageId, "edit");
  });
  const usage = await withTenantContext(context, async (client) =>
    client.query(
      "SELECT 1 FROM management_project_task_document_links WHERE organization_id = $1 AND document_id = $2 LIMIT 1",
      [context.organizationId, imageId],
    ),
  );
  if (usage.rowCount)
    throw new BadRequestError(
      "Remove the document from its tasks before deleting the original project file",
    );
  const [rawModule, rawResource] = String(attachment.entity_type).split(":", 2);
  const module = rawModule ?? "";
  const resource = rawResource ?? "";
  if (!isAttachmentTarget(module, resource))
    throw new NotFoundError("Evidence attachment not found");
  const target = {
    module,
    resource,
    recordId: String(attachment.entity_id),
  } as AttachmentTarget;
  await assertTargetAccess(context, target, "update");
  if (attachment.storage_provider === "cloudinary") {
    await deleteStoredImage({
      provider: "cloudinary",
      publicId:
        typeof attachment.storage_public_id === "string"
          ? attachment.storage_public_id
          : null,
    });
  } else if (attachment.storage_provider === "private_document") {
    const storageKey =
      typeof attachment.storage_key === "string" ? attachment.storage_key : "";
    if (!storageKey)
      throw new BadRequestError("This private evidence document has no file");
    await deletePrivateDocument(storageKey);
  } else {
    throw new NotFoundError("Evidence attachment not found");
  }
  await withTenantContext(context, async (client) => {
    await client.query(
      "DELETE FROM management_document_links WHERE organization_id = $1 AND id = $2",
      [context.organizationId, imageId],
    );
  });
}
