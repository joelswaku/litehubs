import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Enter a valid identifier");

export const ownerManagementResources = [
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

export type OwnerManagementResource = (typeof ownerManagementResources)[number];

export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const ownerManagementResourceParams = organizationParams.extend({
  resource: z.enum(ownerManagementResources),
});
export const ownerManagementRecordParams = ownerManagementResourceParams.extend(
  {
    recordId: id,
  },
);
export const ownerManagementDecisionParams = organizationParams.extend({
  recordId: id,
});
export const ownerManagementProjectParams = organizationParams.extend({
  projectId: id,
});

export const ownerManagementTaskDocumentParams = organizationParams.extend({
  taskId: id,
});

export const ownerManagementDocumentAccessParams = organizationParams.extend({
  documentId: id,
});

export const documentVisibility = z.enum([
  "company",
  "project_team",
  "owner_only",
  "owner_partner",
  "selected_roles",
  "selected_people",
]);

export const documentAccessBody = z
  .object({
    visibility: documentVisibility,
    allowedRoleIds: z.array(id).max(100).default([]),
    allowedMemberIds: z.array(id).max(100).default([]),
    isLocked: z.boolean().default(false),
    canDownload: z.boolean().default(true),
    canEdit: z.boolean().default(true),
  })
  .superRefine((value, context) => {
    if (value.visibility === "selected_roles" && !value.allowedRoleIds.length)
      context.addIssue({
        code: "custom",
        path: ["allowedRoleIds"],
        message: "Choose at least one allowed role",
      });
    if (
      value.visibility === "selected_people" &&
      !value.allowedMemberIds.length
    )
      context.addIssue({
        code: "custom",
        path: ["allowedMemberIds"],
        message: "Choose at least one allowed person",
      });
  });

export type DocumentAccessInput = z.infer<typeof documentAccessBody>;

export const taskDocumentLinksBody = z.object({
  documentIds: z.array(id).max(100),
});

export const documentCategoryVisibility = z.enum(["company", "owner_only"]);

export const documentCategoryAssignmentBody = z.object({
  categoryId: id.nullable(),
});
export type DocumentCategoryAssignmentInput = z.infer<
  typeof documentCategoryAssignmentBody
>;

const documentCategoryCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9_-]{0,78}$/,
    "Use lowercase letters, numbers, underscores or hyphens",
  );
const documentCategoryFields = z.object({
  code: documentCategoryCode.optional(),
  name: z
    .string()
    .trim()
    .min(1, "Category name is required")
    .max(120)
    .optional(),
  description: z.string().trim().max(500).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  isActive: z.boolean().optional(),
  visibility: documentCategoryVisibility.optional(),
});
export const documentCategoryCreateBody = documentCategoryFields.extend({
  name: z.string().trim().min(1, "Category name is required").max(120),
});
export const documentCategoryUpdateBody = documentCategoryFields.refine(
  (value) => Object.keys(value).length > 0,
  "Provide at least one category value to update",
);
export const ownerManagementDocumentCategoryParams = organizationParams.extend({
  categoryId: id,
});
export type DocumentCategoryCreateInput = z.infer<
  typeof documentCategoryCreateBody
>;
export type DocumentCategoryUpdateInput = z.infer<
  typeof documentCategoryUpdateBody
>;
export const ownerManagementListQuery = z.object({
  projectId: id.optional(),
  phaseId: id.optional(),
  provinceId: id.optional(),
  siteId: id.optional(),
  status: z.string().trim().min(1).max(50).optional(),
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type OwnerManagementListQuery = z.infer<typeof ownerManagementListQuery>;
export const inventoryStockQuery = z.object({
  warehouseId: id.optional(),
  itemId: id.optional(),
  provinceId: id.optional(),
  siteId: id.optional(),
  lowStock: z.coerce.boolean().optional(),
});
export type InventoryStockQuery = z.infer<typeof inventoryStockQuery>;

export const ownerManagementDashboardQuery = z.object({
  provinceId: id.optional(),
  projectId: id.optional(),
});

const recordInput = z
  .object({})
  .passthrough()
  .refine((value) => !Array.isArray(value), {
    message: "Send one JSON object",
  });

/** Blank optional form controls must become NULL, never an empty UUID/date. */
const blankToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const optionalId = z.preprocess(
  blankToNull,
  z.string().uuid("Enter a valid identifier").nullable().optional(),
);
const optionalDate = z.preprocess(
  blankToNull,
  z
    .string()
    .date("Enter a valid date in YYYY-MM-DD format")
    .nullable()
    .optional(),
);
const optionalText = (max = 10_000) =>
  z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .min(1, "This value cannot be blank")
      .max(max)
      .nullable()
      .optional(),
  );
const optionalAmount = z.preprocess(
  blankToNull,
  z
    .number("Enter a number")
    .finite("Enter a finite number")
    .nonnegative("Enter zero or a positive amount")
    .nullable()
    .optional(),
);

/**
 * Tasks are submitted from a rich form and contain UUIDs, dates and decimals.
 * They used to fall through the generic registry parser and let PostgreSQL
 * discover malformed values. Validate the task contract here so the response
 * identifies the exact field instead of returning a generic database format
 * error.
 */
const taskInput = z
  .object({
    projectId: optionalId,
    provinceId: optionalId,
    siteId: optionalId,
    phaseId: optionalId,
    taskType: z
      .enum(["work", "milestone"], {
        message: "Choose Work or Milestone",
      })
      .optional(),
    code: optionalText(100),
    title: z
      .string()
      .trim()
      .min(1, "Task title is required")
      .max(500)
      .optional(),
    description: optionalText(),
    assignedMemberId: optionalId,
    assignedDepartmentId: optionalId,
    startDate: optionalDate,
    dueDate: optionalDate,
    completedDate: optionalDate,
    priority: z
      .enum(["low", "medium", "high", "critical"], {
        message: "Choose a valid priority",
      })
      .optional(),
    status: z
      .enum(
        [
          "not_started",
          "in_progress",
          "blocked",
          "waiting_approval",
          "completed",
          "cancelled",
        ],
        { message: "Choose a valid task status" },
      )
      .optional(),
    progressPercent: z
      .number("Progress must be a number")
      .finite("Progress must be a finite number")
      .min(0, "Progress must be between 0 and 100")
      .max(100, "Progress must be between 0 and 100")
      .optional(),
    estimatedCost: optionalAmount,
    blockedReason: optionalText(),
    notes: optionalText(),
  })
  .strict()
  .superRefine((task, issue) => {
    if (task.startDate && task.dueDate && task.dueDate < task.startDate)
      issue.addIssue({
        code: "custom",
        path: ["dueDate"],
        message: "Due date cannot be before the start date",
      });
    if (
      task.startDate &&
      task.completedDate &&
      task.completedDate < task.startDate
    )
      issue.addIssue({
        code: "custom",
        path: ["completedDate"],
        message: "Completed date cannot be before the start date",
      });
    if (
      task.taskType === "milestone" &&
      task.estimatedCost !== undefined &&
      task.estimatedCost !== null
    )
      issue.addIssue({
        code: "custom",
        path: ["estimatedCost"],
        message: "Milestones cannot have an estimated cost",
      });
  });

const createTaskInput = taskInput
  .required({ title: true })
  .superRefine((task, issue) => {
    if (!task.projectId && !task.provinceId)
      issue.addIssue({
        code: "custom",
        path: ["provinceId"],
        message: "Choose a province for a normal company task",
      });
    if (!task.projectId && task.phaseId)
      issue.addIssue({
        code: "custom",
        path: ["phaseId"],
        message: "A normal company task cannot be linked to a project phase",
      });
  });

/**
 * The service keeps a per-record allow-list for fields. This parser is kept
 * deliberately generic so the same API can support every connected owner
 * record without accepting raw SQL or arbitrary column names.
 */
export function parseOwnerManagementBody(
  resource: OwnerManagementResource,
  value: unknown,
  mode: "create" | "update",
): Record<string, unknown> {
  if (resource === "tasks")
    return (mode === "create" ? createTaskInput : taskInput).parse(value);

  const parsed = recordInput.parse(value);
  if (mode === "update" && Object.keys(parsed).length === 0) {
    throw new z.ZodError([
      {
        code: "custom",
        path: [],
        message: "Provide at least one value to change",
      },
    ]);
  }
  return parsed;
}

export const approvalDecisionBody = z
  .object({
    decision: z.enum(["approved", "rejected", "partially_approved"]),
    approvedAmount: z.number().nonnegative().optional(),
    decisionNotes: z.string().trim().min(1).max(2_000).optional(),
  })
  .superRefine((value, issue) => {
    if (
      value.decision === "partially_approved" &&
      value.approvedAmount === undefined
    )
      issue.addIssue({
        code: "custom",
        path: ["approvedAmount"],
        message: "Enter the amount that is approved",
      });
    if (value.decision === "rejected" && !value.decisionNotes)
      issue.addIssue({
        code: "custom",
        path: ["decisionNotes"],
        message: "Explain why this request is rejected",
      });
  });
