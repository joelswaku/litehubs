import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Enter a valid identifier");

export const ownerManagementResources = [
  "projects",
  "project-members",
  "operational-links",
  "phases",
  "phase-dependencies",
  "risks",
  "quality-checks",
  "project-closeouts",
  "tasks",
  "task-dependencies",
  "budget-lines",
  "materials",
  "material-movements",
  "suppliers",
  "inventory-items",
  "warehouses",
  "stock-movements",
  "feed-batches",
  "feed-batch-inputs",
  "nutrition-profiles",
  "feed-recipes",
  "feed-recipe-lines",
  "feed-orders",
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
export const purchaseRequestReturnToDraftParams = organizationParams.extend({
  recordId: id,
});
export const purchaseRequestReturnToDraftBody = z.object({
  correctionNote: z.string().trim().max(2_000).optional(),
});
export const ownerManagementProjectParams = organizationParams.extend({
  projectId: id,
});

/**
 * Fleet work is deliberately separate from the generic owner-management
 * registry. A driver may submit their own signed start/return record without
 * receiving broad equipment permissions.
 */
const fleetBlankToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;
const fleetOptionalId = z.preprocess(
  fleetBlankToNull,
  z.string().uuid("Enter a valid identifier").nullable().optional(),
);
const fleetOptionalDate = z.preprocess(
  fleetBlankToNull,
  z
    .string()
    .date("Enter a valid date in YYYY-MM-DD format")
    .nullable()
    .optional(),
);
const fleetInspectionAnswer = z
  .object({
    itemCode: z.string().trim().min(1).max(80),
    itemLabel: z.string().trim().min(1).max(300),
    result: z.enum(["pass", "fail", "not_applicable"]),
    notes: z.string().trim().max(2_000).optional().nullable(),
    photoDocumentId: fleetOptionalId,
  })
  .strict();

export const fleetProfileParams = organizationParams.extend({
  profileId: id,
});
export const fleetRunParams = organizationParams.extend({ runId: id });

export const fleetProfileBody = z
  .object({
    assetId: id,
    operationKind: z.enum([
      "vehicle",
      "motorcycle",
      "tractor",
      "generator",
      "pump",
      "motorized_equipment",
    ]),
    fleetControllerMemberId: fleetOptionalId,
    maintenanceControllerMemberId: fleetOptionalId,
    requiresPreTrip: z.boolean().optional(),
    requiresPostTrip: z.boolean().optional(),
    requiresGateCheck: z.boolean().optional(),
    requiresOperatorLicence: z.boolean().optional(),
    requiredLicenceClass: z.string().trim().max(120).optional().nullable(),
    dailyMeterRequired: z.boolean().optional(),
    preventDispatchWhenDue: z.boolean().optional(),
    fuelTankCapacityLitres: z.number().positive().max(1_000_000).optional().nullable(),
    expectedConsumption: z.number().positive().max(100_000).optional().nullable(),
    expectedConsumptionUnit: z
      .enum(["litres_per_100km", "litres_per_hour"])
      .optional()
      .nullable(),
    consumptionTolerancePercent: z.number().min(0).max(200).optional(),
    isActive: z.boolean().optional(),
    notes: z.string().trim().max(4_000).optional().nullable(),
  })
  .strict()
  .superRefine((profile, issue) => {
    if (profile.expectedConsumption && !profile.expectedConsumptionUnit)
      issue.addIssue({
        code: "custom",
        path: ["expectedConsumptionUnit"],
        message: "Choose the unit used for the expected fuel consumption",
      });
    if (
      profile.expectedConsumptionUnit === "litres_per_100km" &&
      profile.operationKind !== "vehicle" &&
      profile.operationKind !== "motorcycle" &&
      profile.operationKind !== "tractor"
    )
      issue.addIssue({
        code: "custom",
        path: ["expectedConsumptionUnit"],
        message: "Use litres per hour for a stationary motorized asset",
      });
  });
export type FleetProfileInput = z.infer<typeof fleetProfileBody>;

/** Asset identity is immutable after a controlled profile is created.  Editing
 * a profile changes its safeguards, never moves its history to another asset. */
export const fleetProfileUpdateBody = z
  .object({
    operationKind: z.enum([
      "vehicle",
      "motorcycle",
      "tractor",
      "generator",
      "pump",
      "motorized_equipment",
    ]),
    requiresPreTrip: z.boolean().optional(),
    requiresPostTrip: z.boolean().optional(),
    requiresGateCheck: z.boolean().optional(),
    requiresOperatorLicence: z.boolean().optional(),
    requiredLicenceClass: z.string().trim().max(120).optional().nullable(),
    dailyMeterRequired: z.boolean().optional(),
    preventDispatchWhenDue: z.boolean().optional(),
    fuelTankCapacityLitres: z.number().positive().max(1_000_000).optional().nullable(),
    expectedConsumption: z.number().positive().max(100_000).optional().nullable(),
    expectedConsumptionUnit: z
      .enum(["litres_per_100km", "litres_per_hour"])
      .optional()
      .nullable(),
    consumptionTolerancePercent: z.number().min(0).max(200).optional(),
    isActive: z.boolean().optional(),
    notes: z.string().trim().max(4_000).optional().nullable(),
  })
  .strict()
  .superRefine((profile, issue) => {
    if (profile.expectedConsumption && !profile.expectedConsumptionUnit)
      issue.addIssue({
        code: "custom",
        path: ["expectedConsumptionUnit"],
        message: "Choose the unit used for the expected fuel consumption",
      });
    if (
      profile.expectedConsumptionUnit === "litres_per_100km" &&
      profile.operationKind !== "vehicle" &&
      profile.operationKind !== "motorcycle" &&
      profile.operationKind !== "tractor"
    )
      issue.addIssue({
        code: "custom",
        path: ["expectedConsumptionUnit"],
        message: "Use litres per hour for a stationary motorized asset",
      });
  });
export type FleetProfileUpdateInput = z.infer<typeof fleetProfileUpdateBody>;

export const fleetAuthorizationBody = z
  .object({
    memberId: id,
    responsibility: z.enum([
      "driver",
      "operator",
      "fleet_controller",
      "gate_verifier",
      "maintenance_controller",
    ]),
    licenceDocumentId: fleetOptionalId,
    licenceNumber: z.string().trim().max(160).optional().nullable(),
    licenceExpiresOn: fleetOptionalDate,
    startsOn: fleetOptionalDate,
    endsOn: fleetOptionalDate,
    isActive: z.boolean().optional(),
    notes: z.string().trim().max(2_000).optional().nullable(),
  })
  .strict()
  .superRefine((authorization, issue) => {
    if (
      authorization.startsOn &&
      authorization.endsOn &&
      authorization.endsOn < authorization.startsOn
    )
      issue.addIssue({
        code: "custom",
        path: ["endsOn"],
        message: "Authorization end cannot be before its start date",
      });
  });
export type FleetAuthorizationInput = z.infer<typeof fleetAuthorizationBody>;

export const fleetRunStartBody = z
  .object({
    profileId: id,
    // A controller may sign for an assigned driver. The selected operator
    // remains the person who physically used the engine.
    operatorMemberId: fleetOptionalId,
    // Defaults to the secure server day for older clients. The current form
    // always asks the person completing the sheet to choose this work date.
    runDate: fleetOptionalDate,
    projectId: fleetOptionalId,
    projectTaskId: fleetOptionalId,
    purpose: z.string().trim().min(3).max(1_000),
    destination: z.string().trim().max(1_000).optional().nullable(),
    startMeter: z.number().nonnegative().max(100_000_000).optional().nullable(),
    openingFuelLitres: z.number().nonnegative().max(1_000_000).optional().nullable(),
    gateVerifierMemberId: fleetOptionalId,
    preTripResponses: z.array(fleetInspectionAnswer).max(80).default([]),
  })
  .strict();
export type FleetRunStartInput = z.infer<typeof fleetRunStartBody>;

export const fleetRunReturnBody = z
  .object({
    endMeter: z.number().nonnegative().max(100_000_000).optional().nullable(),
    closingFuelLitres: z.number().nonnegative().max(1_000_000).optional().nullable(),
    fuelAddedLitres: z.number().positive().max(1_000_000).optional().nullable(),
    fuelAmount: z.number().nonnegative().max(100_000_000_000).optional().nullable(),
    fuelCurrencyCode: z.enum(["CDF", "USD", "EUR"]).optional().nullable(),
    fuelReceiptDocumentId: fleetOptionalId,
    returnNotes: z.string().trim().max(4_000).optional().nullable(),
    postTripResponses: z.array(fleetInspectionAnswer).max(80).default([]),
  })
  .strict()
  .superRefine((run, issue) => {
    if (run.fuelAmount !== undefined && run.fuelAmount !== null && !run.fuelAddedLitres)
      issue.addIssue({
        code: "custom",
        path: ["fuelAddedLitres"],
        message: "Enter the quantity of fuel when recording its amount",
      });
    if (run.fuelAddedLitres && !run.fuelCurrencyCode && run.fuelAmount)
      issue.addIssue({
        code: "custom",
        path: ["fuelCurrencyCode"],
        message: "Choose the fuel currency",
      });
  });
export type FleetRunReturnInput = z.infer<typeof fleetRunReturnBody>;

const simulationPercent = z
  .number()
  .finite("Enter a valid percentage")
  .min(-100, "A percentage cannot be below -100%")
  .max(1_000, "A percentage cannot exceed 1000%");
export const projectDecisionSimulationBody = z
  .object({
    eggPriceChangePercent: simulationPercent.optional().default(0),
    feedCostChangePercent: simulationPercent.optional().default(0),
    mortalityPercent: z
      .number()
      .finite("Enter a valid mortality rate")
      .min(0)
      .max(100)
      .optional()
      .default(0),
    saleDelayDays: z.number().int().min(0).max(3_650).optional().default(0),
    budgetChangePercent: simulationPercent.optional().default(0),
  })
  .strict();
export type ProjectDecisionSimulationInput = z.infer<
  typeof projectDecisionSimulationBody
>;

export const procurementDocumentParams = organizationParams.extend({
  documentType: z.enum(["purchase-requests", "purchase-orders", "receipts"]),
  recordId: id,
});
export type ProcurementDocumentType = z.infer<
  typeof procurementDocumentParams
>["documentType"];

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

const equipmentCategoryFields = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Equipment category name is required")
    .max(120)
    .optional(),
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});
export const equipmentCategoryCreateBody = equipmentCategoryFields.extend({
  name: z
    .string()
    .trim()
    .min(1, "Equipment category name is required")
    .max(120),
});
export const equipmentCategoryUpdateBody = equipmentCategoryFields.refine(
  (value) => Object.keys(value).length > 0,
  "Provide at least one category value to update",
);
export const ownerManagementEquipmentCategoryParams = organizationParams.extend(
  {
    categoryId: id,
  },
);
export type EquipmentCategoryCreateInput = z.infer<
  typeof equipmentCategoryCreateBody
>;
export type EquipmentCategoryUpdateInput = z.infer<
  typeof equipmentCategoryUpdateBody
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
export const inventoryStockTransferBody = z
  .object({
    sourceWarehouseId: id,
    destinationWarehouseId: id,
    itemId: id,
    quantity: z
      .number("Enter a quantity")
      .finite("Enter a finite quantity")
      .positive("Enter a quantity greater than zero")
      .max(1_000_000_000, "Quantity is too large"),
    movementDate: z.string().date("Enter a valid transfer date"),
    notes: z.string().trim().max(2_000).optional(),
  })
  .superRefine((value, issue) => {
    if (value.sourceWarehouseId === value.destinationWarehouseId)
      issue.addIssue({
        code: "custom",
        path: ["destinationWarehouseId"],
        message: "Choose a different destination warehouse",
      });
  });
export const inventoryMovementHistoryPdfQuery = z.object({
  date: z.string().date("Enter a valid history date"),
  warehouseId: id.optional(),
  itemId: id.optional(),
  provinceId: id.optional(),
  siteId: id.optional(),
});
export type InventoryMovementHistoryPdfQuery = z.infer<
  typeof inventoryMovementHistoryPdfQuery
>;
export type InventoryStockTransferInput = z.infer<
  typeof inventoryStockTransferBody
>;

export const ownerManagementDashboardQuery = z.object({
  provinceId: id.optional(),
  projectId: id.optional(),
});

/** Filters for the portfolio only. They never expand the caller's existing
 * project scope; the service first resolves visible projects, then narrows it. */
export const projectAnalyticsQuery = z.object({
  provinceId: id.optional(),
  siteId: id.optional(),
  projectType: z.string().trim().min(1).max(50).optional(),
  managerId: id.optional(),
  status: z.string().trim().min(1).max(50).optional(),
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional(),
});
export type ProjectAnalyticsQuery = z.infer<typeof projectAnalyticsQuery>;

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
const optionalPercentage = z.preprocess(
  blankToNull,
  z
    .number("Enter a percentage")
    .finite("Enter a finite percentage")
    .min(0, "Enter a percentage between 0 and 100")
    .max(100, "Enter a percentage between 0 and 100")
    .nullable()
    .optional(),
);

const investmentLifecycleStages = [
  "investment",
  "commissioning",
  "operating",
  "closed",
] as const;

/**
 * Benefit targets are intentionally structured instead of being a second
 * budget. Amounts use the project currency and are simply the owner’s target
 * baseline for the operational period after the investment is handed over.
 */
const projectBenefitTargetsInput = z
  .object({
    targetProductionQuantity: optionalAmount,
    targetProductionUnit: optionalText(60),
    targetProductionPeriod: z.preprocess(
      blankToNull,
      z.enum(["daily", "weekly", "monthly", "cycle"]).nullable().optional(),
    ),
    targetSalesAmount: optionalAmount,
    targetMarginPercent: optionalPercentage,
    targetMortalityPercent: optionalPercentage,
    targetUnitCost: optionalAmount,
  })
  .strict()
  .superRefine((target, issue) => {
    const hasProductionQuantity = target.targetProductionQuantity != null;
    const hasProductionUnit = target.targetProductionUnit != null;
    const hasProductionPeriod = target.targetProductionPeriod != null;
    if (hasProductionQuantity && !hasProductionUnit)
      issue.addIssue({
        code: "custom",
        path: ["targetProductionUnit"],
        message: "Choose the unit for the production target",
      });
    if (hasProductionQuantity && !hasProductionPeriod)
      issue.addIssue({
        code: "custom",
        path: ["targetProductionPeriod"],
        message: "Choose the period for the production target",
      });
    if (!hasProductionQuantity && (hasProductionUnit || hasProductionPeriod))
      issue.addIssue({
        code: "custom",
        path: ["targetProductionQuantity"],
        message: "Enter the production quantity for this target",
      });
  });

const projectInvestmentProfileInput = z
  .object({
    startDate: optionalDate,
    operationalStartDate: optionalDate,
    benefitReviewDate: optionalDate,
    benefitOwnerMemberId: optionalId,
    lifecycleStage: z.preprocess(
      blankToNull,
      z.enum(investmentLifecycleStages).nullable().optional(),
    ),
    benefitTargets: projectBenefitTargetsInput.nullable().optional(),
  })
  .strict()
  .superRefine((project, issue) => {
    if (
      project.startDate &&
      project.operationalStartDate &&
      project.operationalStartDate < project.startDate
    )
      issue.addIssue({
        code: "custom",
        path: ["operationalStartDate"],
        message: "Operational start cannot be before the project start date",
      });
    if (
      project.operationalStartDate &&
      project.benefitReviewDate &&
      project.benefitReviewDate < project.operationalStartDate
    )
      issue.addIssue({
        code: "custom",
        path: ["benefitReviewDate"],
        message: "Benefit review cannot be before operational start",
      });
  });

/**
 * A person working on an assigned task may update its status, report a blocker
 * or add a work note. They cannot change its project, assignee, dates, budget or
 * priority through the private task workspace.
 */
export const myTaskUpdateBody = z
  .object({
    status: z
      .enum(["in_progress", "blocked", "waiting_approval", "completed"], {
        message: "Choose a valid work status",
      })
      .optional(),

    blockedReason: optionalText(),
    notes: optionalText(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide a work update",
  });
export type MyTaskUpdateInput = z.infer<typeof myTaskUpdateBody>;

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
    budgetCurrencyCode: z.enum(["CDF", "USD", "EUR"]).optional(),
    budgetOverrideReason: optionalText(2_000),
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

const projectRiskInput = z
  .object({
    projectId: optionalId,
    recordType: z.enum(["risk", "issue"]).optional(),
    category: z
      .enum([
        "disease",
        "supplier_delay",
        "commodity_price",
        "water",
        "theft",
        "permit",
        "weather",
        "other",
      ])
      .optional(),
    title: z
      .string()
      .trim()
      .min(1, "Risk title is required")
      .max(500)
      .optional(),
    description: optionalText(),
    probability: z.enum(["low", "medium", "high"]).optional(),
    impact: z.enum(["low", "medium", "high", "critical"]).optional(),
    ownerMemberId: optionalId,
    triggerCondition: optionalText(2_000),
    alertThreshold: optionalText(1_000),
    preventionAction: optionalText(4_000),
    contingencyAction: optionalText(4_000),
    reviewDate: optionalDate,
    status: z
      .enum([
        "open",
        "monitoring",
        "triggered",
        "mitigating",
        "accepted",
        "closed",
      ])
      .optional(),
    decision: z
      .enum([
        "pending",
        "monitor",
        "mitigate",
        "avoid",
        "transfer",
        "accept",
        "escalate",
      ])
      .optional(),
    decisionTaken: optionalText(2_000),
    decisionJustification: optionalText(4_000),
    notes: optionalText(),
  })
  .strict()
  .superRefine((risk, issue) => {
    if (risk.decision && risk.decision !== "pending") {
      if (!risk.decisionTaken)
        issue.addIssue({
          code: "custom",
          path: ["decisionTaken"],
          message: "Record the decision that was taken",
        });
      if (!risk.decisionJustification)
        issue.addIssue({
          code: "custom",
          path: ["decisionJustification"],
          message: "Explain the decision",
        });
    }
  });

const createProjectRiskInput = projectRiskInput
  .required({
    projectId: true,
    title: true,
    ownerMemberId: true,
    triggerCondition: true,
    alertThreshold: true,
    preventionAction: true,
    reviewDate: true,
  })
  .superRefine((risk, issue) => {
    for (const [field, message] of [
      ["projectId", "Choose the project"],
      ["ownerMemberId", "Choose the person responsible for this risk"],
      ["triggerCondition", "Describe what triggers this risk"],
      ["alertThreshold", "Set an alert threshold"],
      ["preventionAction", "Describe the preventive action"],
      ["reviewDate", "Choose the review date"],
    ] as const) {
      const value = (risk as Record<string, unknown>)[field];
      if (value == null || !String(value).trim())
        issue.addIssue({ code: "custom", path: [field], message });
    }
  });

const projectQualityCheckInput = z
  .object({
    projectId: optionalId,
    receiptId: optionalId,
    assetId: optionalId,
    qualityStatus: z
      .enum([
        "pending",
        "accepted",
        "accepted_with_observations",
        "rejected",
        "returned",
      ])
      .optional(),
    quantityMatches: z.boolean().optional(),
    conditionAccepted: z.boolean().optional(),
    documentsComplete: z.boolean().optional(),
    functionalTestPassed: z.boolean().optional(),
    safetyCheckPassed: z.boolean().optional(),
    returnedQuantity: optionalAmount,
    returnReason: optionalText(2_000),
    warrantyProvider: optionalText(300),
    warrantyReference: optionalText(300),
    warrantyExpiresOn: optionalDate,
    beforePhotoDocumentId: optionalId,
    afterPhotoDocumentId: optionalId,
    checkedByMemberId: optionalId,
    checkedAt: z.preprocess(
      blankToNull,
      z.string().datetime().nullable().optional(),
    ),
    commissioningStatus: z
      .enum(["not_required", "pending", "validated", "failed"])
      .optional(),
    commissionedByMemberId: optionalId,
    commissionedAt: z.preprocess(
      blankToNull,
      z.string().datetime().nullable().optional(),
    ),
    commissioningNotes: optionalText(4_000),
    notes: optionalText(),
  })
  .strict()
  .superRefine((check, issue) => {
    if (check.returnedQuantity && !check.returnReason)
      issue.addIssue({
        code: "custom",
        path: ["returnReason"],
        message: "Explain the returned quantity",
      });
    if (check.qualityStatus === "returned" && !check.returnedQuantity)
      issue.addIssue({
        code: "custom",
        path: ["returnedQuantity"],
        message: "Record the quantity returned to the supplier",
      });
    if (check.qualityStatus === "accepted") {
      const incomplete = [
        ["quantityMatches", check.quantityMatches],
        ["conditionAccepted", check.conditionAccepted],
        ["documentsComplete", check.documentsComplete],
      ].find(([, completed]) => completed === false);
      if (incomplete)
        issue.addIssue({
          code: "custom",
          path: [String(incomplete[0])],
          message: "Complete the required reception checks before accepting",
        });
    }
    if (check.commissioningStatus === "validated") {
      if (!check.functionalTestPassed)
        issue.addIssue({
          code: "custom",
          path: ["functionalTestPassed"],
          message: "Confirm the functional test before commissioning",
        });
      if (!check.safetyCheckPassed)
        issue.addIssue({
          code: "custom",
          path: ["safetyCheckPassed"],
          message: "Confirm the safety check before commissioning",
        });
    }
  });

const createProjectQualityCheckInput = projectQualityCheckInput
  .required({ projectId: true })
  .superRefine((check, issue) => {
    if (!check.receiptId && !check.assetId)
      issue.addIssue({
        code: "custom",
        path: ["receiptId"],
        message: "Choose a receipt or an equipment asset to inspect",
      });
  });

const projectCloseoutInput = z
  .object({
    projectId: optionalId,
    status: z.enum(["draft", "completed"]).optional(),
    expectedOutcomeAchieved: z.boolean().nullable().optional(),
    achievementSummary: optionalText(6_000),
    actualOutcome: optionalText(6_000),
    lessonsLearned: optionalText(6_000),
    handoverMemberId: optionalId,
    commissioningValidated: z.boolean().optional(),
    commissioningSummary: optionalText(6_000),
    closeoutDocumentId: optionalId,
    notes: optionalText(),
  })
  .strict()
  .superRefine((closeout, issue) => {
    if (closeout.status !== "completed") return;
    if (closeout.expectedOutcomeAchieved == null)
      issue.addIssue({
        code: "custom",
        path: ["expectedOutcomeAchieved"],
        message: "Confirm whether the expected result was achieved",
      });
    for (const [field, value, message] of [
      [
        "achievementSummary",
        closeout.achievementSummary,
        "Describe the achieved result",
      ],
      [
        "lessonsLearned",
        closeout.lessonsLearned,
        "Record what the team learned",
      ],
    ] as const)
      if (!value) issue.addIssue({ code: "custom", path: [field], message });
    if (!closeout.commissioningValidated)
      issue.addIssue({
        code: "custom",
        path: ["commissioningValidated"],
        message: "Confirm operational commissioning before closing the project",
      });
  });

const createProjectCloseoutInput = projectCloseoutInput.required({
  projectId: true,
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
  if (resource === "risks")
    return (
      mode === "create" ? createProjectRiskInput : projectRiskInput
    ).parse(value);
  if (resource === "quality-checks")
    return (
      mode === "create"
        ? createProjectQualityCheckInput
        : projectQualityCheckInput
    ).parse(value);
  if (resource === "project-closeouts")
    return (
      mode === "create" ? createProjectCloseoutInput : projectCloseoutInput
    ).parse(value);

  const parsed = recordInput.parse(value);
  if (resource === "projects") {
    // Keep the generic registry contract for established project fields, while
    // validating every field introduced by the structured investment profile.
    // This avoids returning opaque PostgreSQL errors for dates or KPI targets.
    const profile = projectInvestmentProfileInput.parse({
      startDate: parsed.startDate,
      operationalStartDate: parsed.operationalStartDate,
      benefitReviewDate: parsed.benefitReviewDate,
      benefitOwnerMemberId: parsed.benefitOwnerMemberId,
      lifecycleStage: parsed.lifecycleStage,
      benefitTargets: parsed.benefitTargets,
    });
    return { ...parsed, ...profile };
  }
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
