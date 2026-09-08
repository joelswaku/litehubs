import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const idSchema = z.string().uuid("Enter a valid identifier");
const dateSchema = z.string().date("Use YYYY-MM-DD");
const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const nullableText = (maximum: number) => text(maximum).nullable().optional();
const codeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9_]{1,62}$/,
    "Use lowercase letters, numbers and underscores",
  );
const positiveInteger = z.number().int().positive();
const nonNegativeInteger = z.number().int().nonnegative();
const positiveDecimal = z.number().positive();
const nonNegativeDecimal = z.number().nonnegative();
const nonEmptyUpdate = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one value to change",
  });

export const poultryResources = [
  "houses",
  "flocks",
  "daily-records",
  "mortality",
  "feed",
  "water",
  "weights",
  "eggs",
  "health",
  "vaccinations",
  "treatments",
  "sanitation",
  "biosecurity",
  "production-targets",
  "losses",
] as const;

export type PoultryResource = (typeof poultryResources)[number];

export const organizationParams = z.object({
  orgSlug: organizationSlugSchema,
});

export const poultryResourceParams = organizationParams.extend({
  resource: z.enum(poultryResources),
});

export const poultryRecordParams = poultryResourceParams.extend({
  recordId: idSchema,
});

export const flockProfileParams = organizationParams.extend({
  flockId: idSchema,
});

const houseTypes = z.enum([
  "broiler",
  "layer",
  "breeder",
  "mixed",
  "pullet",
  "chick",
  "quarantine",
  "other",
]);
const houseStatuses = z.enum([
  "active",
  "inactive",
  "under_cleaning",
  "maintenance",
]);
const birdTypes = z.enum([
  "broiler",
  "layer",
  "breeder",
  "pullet",
  "chick",
  "other",
]);
const productionTypes = z.enum(["broiler", "layer", "breeder"]);
const flockStatus = z.enum([
  "planned",
  "active",
  "ready_for_sale",
  "closed",
  "cancelled",
  "quarantined",
  "sold",
  "depleted",
]);
const nullablePositiveDecimal = z.number().positive().nullable().optional();
const nullableNonNegativeDecimal = z
  .number()
  .nonnegative()
  .nullable()
  .optional();
const nullableNonNegativeInteger = z
  .number()
  .int()
  .nonnegative()
  .nullable()
  .optional();

const houseCreate = z.object({
  siteId: idSchema,
  code: codeSchema,
  name: text(150),
  houseType: houseTypes.default("other"),
  capacity: positiveInteger,
  operationalStatus: houseStatuses.default("active"),
  description: nullableText(2_000),
  lengthM: nullablePositiveDecimal,
  widthM: nullablePositiveDecimal,
  floorAreaM2: nullablePositiveDecimal,
  ventilationType: nullableText(150),
  waterSystem: nullableText(150),
  feedingSystem: nullableText(150),
  heatingSystem: nullableText(150),
  notes: nullableText(2_000),
});
const houseUpdate = nonEmptyUpdate({
  siteId: idSchema.optional(),
  code: codeSchema.optional(),
  name: text(150).optional(),
  houseType: houseTypes.optional(),
  capacity: positiveInteger.optional(),
  operationalStatus: houseStatuses.optional(),
  // Kept for existing API clients; the service keeps it consistent with operationalStatus.
  isActive: z.boolean().optional(),
  description: nullableText(2_000),
  lengthM: nullablePositiveDecimal,
  widthM: nullablePositiveDecimal,
  floorAreaM2: nullablePositiveDecimal,
  ventilationType: nullableText(150),
  waterSystem: nullableText(150),
  feedingSystem: nullableText(150),
  heatingSystem: nullableText(150),
  notes: nullableText(2_000),
});

const flockCreate = z.object({
  houseId: idSchema,
  code: codeSchema,
  name: text(150),
  birdType: birdTypes,
  breed: nullableText(150),
  sourceName: nullableText(150),
  chickSource: nullableText(150),
  sex: z.enum(["mixed", "male", "female"]).default("mixed"),
  hatchDate: dateSchema.nullable().optional(),
  arrivalDate: dateSchema,
  startingAgeDays: z.number().int().min(0).max(1_000).default(0),
  initialBirdCount: positiveInteger,
  purchaseCostTotal: nullableNonNegativeDecimal,
  costPerBird: nullableNonNegativeDecimal,
  expectedProductionEndDate: dateSchema.nullable().optional(),
  parentFlockId: idSchema.nullable().optional(),
  productionType: productionTypes.optional(),
  performanceModelId: idSchema.nullable().optional(),
  capacityOverrideReason: nullableText(2_000),
  mortalityReviewThreshold: positiveInteger.default(1),
  notes: nullableText(2_000),
});
const flockUpdate = nonEmptyUpdate({
  houseId: idSchema.optional(),
  code: codeSchema.optional(),
  name: text(150).optional(),
  birdType: birdTypes.optional(),
  breed: nullableText(150),
  sourceName: nullableText(150),
  chickSource: nullableText(150),
  sex: z.enum(["mixed", "male", "female"]).optional(),
  hatchDate: dateSchema.nullable().optional(),
  arrivalDate: dateSchema.optional(),
  startingAgeDays: z.number().int().min(0).max(1_000).optional(),
  initialBirdCount: positiveInteger.optional(),
  purchaseCostTotal: nullableNonNegativeDecimal,
  costPerBird: nullableNonNegativeDecimal,
  expectedProductionEndDate: dateSchema.nullable().optional(),
  parentFlockId: idSchema.nullable().optional(),
  status: flockStatus.optional(),
  closedAt: dateSchema.nullable().optional(),
  closingReason: nullableText(2_000),
  closingNotes: nullableText(4_000),
  birdsSold: nullableNonNegativeInteger,
  birdsTransferred: nullableNonNegativeInteger,
  finalLiveBirdCount: nullableNonNegativeInteger,
  finalMortality: nullableNonNegativeInteger,
  productionType: productionTypes.nullable().optional(),
  performanceModelId: idSchema.nullable().optional(),
  capacityOverrideReason: nullableText(2_000),
  mortalityReviewThreshold: positiveInteger.optional(),
  notes: nullableText(2_000),
});

const dailyRecordCreate = z.object({
  flockId: idSchema,
  recordDate: dateSchema,
  liveBirdCount: nonNegativeInteger,
  arrivalsCount: nonNegativeInteger.default(0),
  transfersOutCount: nonNegativeInteger.default(0),
  cullsCount: nonNegativeInteger.default(0),
  temperatureC: z.number().min(-20).max(70).nullable().optional(),
  humidityPercent: z.number().min(0).max(100).nullable().optional(),
  notes: nullableText(2_000),
});
const dailyRecordUpdate = nonEmptyUpdate({
  recordDate: dateSchema.optional(),
  liveBirdCount: nonNegativeInteger.optional(),
  arrivalsCount: nonNegativeInteger.optional(),
  transfersOutCount: nonNegativeInteger.optional(),
  cullsCount: nonNegativeInteger.optional(),
  temperatureC: z.number().min(-20).max(70).nullable().optional(),
  humidityPercent: z.number().min(0).max(100).nullable().optional(),
  notes: nullableText(2_000),
});

const mortalityCause = z.enum([
  "unknown",
  "disease",
  "heat_stress",
  "cold_stress",
  "injury",
  "predation",
  "deformity",
  "management",
  "other",
]);
const mortalityCreate = z.object({
  flockId: idSchema,
  mortalityDate: dateSchema,
  deathCount: positiveInteger,
  causeCategory: mortalityCause.default("unknown"),
  suspectedCause: nullableText(2_000),
  confirmedDiagnosis: nullableText(2_000),
  clinicalSigns: nullableText(4_000),
  postmortemStatus: z.enum(["not_done", "pending", "done"]).default("not_done"),
  disposalMethod: z
    .enum(["burial", "incineration", "composting", "rendering", "other"])
    .default("other"),
  veterinarianName: nullableText(150),
  requiresFollowUp: z.boolean().default(false),
  followUpStatus: z
    .enum(["not_required", "pending", "in_progress", "resolved"])
    .optional(),
  followUpNotes: nullableText(4_000),
  notes: nullableText(4_000),
});
const mortalityUpdate = nonEmptyUpdate({
  mortalityDate: dateSchema.optional(),
  deathCount: positiveInteger.optional(),
  causeCategory: mortalityCause.optional(),
  suspectedCause: nullableText(2_000),
  confirmedDiagnosis: nullableText(2_000),
  clinicalSigns: nullableText(4_000),
  postmortemStatus: z.enum(["not_done", "pending", "done"]).optional(),
  disposalMethod: z
    .enum(["burial", "incineration", "composting", "rendering", "other"])
    .optional(),
  veterinarianName: nullableText(150),
  requiresFollowUp: z.boolean().optional(),
  followUpStatus: z
    .enum(["not_required", "pending", "in_progress", "resolved"])
    .optional(),
  followUpNotes: nullableText(4_000),
  notes: nullableText(4_000),
});

const feedCreate = z.object({
  flockId: idSchema,
  feedDate: dateSchema,
  feedName: text(150),
  feedStage: z
    .enum([
      "starter",
      "grower",
      "finisher",
      "layer",
      "breeder",
      "medicated",
      "other",
    ])
    .default("other"),
  quantityKg: positiveDecimal,
  bagCount: nonNegativeDecimal.nullable().optional(),
  batchNumber: nullableText(150),
  inventoryItemId: idSchema.nullable().optional(),
  notes: nullableText(2_000),
});
const feedUpdate = nonEmptyUpdate({
  feedDate: dateSchema.optional(),
  feedName: text(150).optional(),
  feedStage: z
    .enum([
      "starter",
      "grower",
      "finisher",
      "layer",
      "breeder",
      "medicated",
      "other",
    ])
    .optional(),
  quantityKg: positiveDecimal.optional(),
  bagCount: nonNegativeDecimal.nullable().optional(),
  batchNumber: nullableText(150),
  inventoryItemId: idSchema.nullable().optional(),
  notes: nullableText(2_000),
});

const waterCreate = z.object({
  flockId: idSchema,
  waterDate: dateSchema,
  volumeLiters: positiveDecimal,
  sourceName: nullableText(150),
  notes: nullableText(2_000),
});
const waterUpdate = nonEmptyUpdate({
  waterDate: dateSchema.optional(),
  volumeLiters: positiveDecimal.optional(),
  sourceName: nullableText(150),
  notes: nullableText(2_000),
});

const weightCreate = z.object({
  flockId: idSchema,
  recordDate: dateSchema,
  sampleSize: positiveInteger,
  averageWeightG: positiveDecimal,
  minimumWeightG: positiveDecimal.nullable().optional(),
  maximumWeightG: positiveDecimal.nullable().optional(),
  uniformityPercent: z.number().min(0).max(100).nullable().optional(),
  notes: nullableText(2_000),
});
const weightUpdate = nonEmptyUpdate({
  recordDate: dateSchema.optional(),
  sampleSize: positiveInteger.optional(),
  averageWeightG: positiveDecimal.optional(),
  minimumWeightG: positiveDecimal.nullable().optional(),
  maximumWeightG: positiveDecimal.nullable().optional(),
  uniformityPercent: z.number().min(0).max(100).nullable().optional(),
  notes: nullableText(2_000),
});

const eggCreate = z
  .object({
    flockId: idSchema,
    recordDate: dateSchema,
    totalEggs: nonNegativeInteger,
    crackedEggs: nonNegativeInteger.default(0),
    dirtyEggs: nonNegativeInteger.default(0),
    hatchingEggs: nonNegativeInteger.default(0),
    rejectedEggs: nonNegativeInteger.default(0),
    notes: nullableText(2_000),
  })
  .refine(
    (value) =>
      value.crackedEggs +
        value.dirtyEggs +
        value.hatchingEggs +
        value.rejectedEggs <=
      value.totalEggs,
    { message: "Egg categories cannot exceed total eggs" },
  );
const eggUpdate = nonEmptyUpdate({
  recordDate: dateSchema.optional(),
  totalEggs: nonNegativeInteger.optional(),
  crackedEggs: nonNegativeInteger.optional(),
  dirtyEggs: nonNegativeInteger.optional(),
  hatchingEggs: nonNegativeInteger.optional(),
  rejectedEggs: nonNegativeInteger.optional(),
  notes: nullableText(2_000),
});

const healthCreate = z.object({
  flockId: idSchema,
  recordDate: dateSchema,
  eventType: z.enum([
    "observation",
    "suspected_disease",
    "confirmed_disease",
    "outbreak",
    "injury",
    "other",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]).default("low"),
  birdsAffected: nonNegativeInteger.default(0),
  symptoms: nullableText(4_000),
  diagnosis: nullableText(2_000),
  actionTaken: nullableText(4_000),
  veterinarianName: nullableText(150),
  status: z.enum(["open", "monitoring", "resolved"]).default("open"),
  notes: nullableText(4_000),
});
const healthUpdate = nonEmptyUpdate({
  recordDate: dateSchema.optional(),
  eventType: z
    .enum([
      "observation",
      "suspected_disease",
      "confirmed_disease",
      "outbreak",
      "injury",
      "other",
    ])
    .optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  birdsAffected: nonNegativeInteger.optional(),
  symptoms: nullableText(4_000),
  diagnosis: nullableText(2_000),
  actionTaken: nullableText(4_000),
  veterinarianName: nullableText(150),
  status: z.enum(["open", "monitoring", "resolved"]).optional(),
  notes: nullableText(4_000),
});

const vaccinationCreate = z.object({
  flockId: idSchema,
  vaccinationDate: dateSchema,
  vaccineName: text(150),
  manufacturer: nullableText(150),
  batchNumber: nullableText(150),
  dose: nullableText(150),
  administrationRoute: nullableText(150),
  nextDueDate: dateSchema.nullable().optional(),
  administeredBy: nullableText(150),
  inventoryItemId: idSchema.nullable().optional(),
  notes: nullableText(2_000),
});
const vaccinationUpdate = nonEmptyUpdate({
  vaccinationDate: dateSchema.optional(),
  vaccineName: text(150).optional(),
  manufacturer: nullableText(150),
  batchNumber: nullableText(150),
  dose: nullableText(150),
  administrationRoute: nullableText(150),
  nextDueDate: dateSchema.nullable().optional(),
  administeredBy: nullableText(150),
  inventoryItemId: idSchema.nullable().optional(),
  notes: nullableText(2_000),
});

const treatmentCreate = z.object({
  flockId: idSchema,
  treatmentDate: dateSchema,
  productName: text(150),
  reason: text(2_000),
  dosage: nullableText(150),
  administrationRoute: nullableText(150),
  endDate: dateSchema.nullable().optional(),
  withdrawalEndDate: dateSchema.nullable().optional(),
  prescribedBy: nullableText(150),
  inventoryItemId: idSchema.nullable().optional(),
  notes: nullableText(2_000),
});
const treatmentUpdate = nonEmptyUpdate({
  treatmentDate: dateSchema.optional(),
  productName: text(150).optional(),
  reason: text(2_000).optional(),
  dosage: nullableText(150),
  administrationRoute: nullableText(150),
  endDate: dateSchema.nullable().optional(),
  withdrawalEndDate: dateSchema.nullable().optional(),
  prescribedBy: nullableText(150),
  inventoryItemId: idSchema.nullable().optional(),
  notes: nullableText(2_000),
});

const sanitationCreate = z.object({
  houseId: idSchema,
  sanitationDate: dateSchema,
  activityType: z.enum([
    "cleaning",
    "disinfection",
    "litter_change",
    "downtime",
    "waste_removal",
    "other",
  ]),
  productName: nullableText(150),
  status: z.enum(["completed", "partial", "failed"]).default("completed"),
  performedBy: nullableText(150),
  inventoryItemId: idSchema.nullable().optional(),
  notes: nullableText(2_000),
});
const sanitationUpdate = nonEmptyUpdate({
  sanitationDate: dateSchema.optional(),
  activityType: z
    .enum([
      "cleaning",
      "disinfection",
      "litter_change",
      "downtime",
      "waste_removal",
      "other",
    ])
    .optional(),
  productName: nullableText(150),
  status: z.enum(["completed", "partial", "failed"]).optional(),
  performedBy: nullableText(150),
  inventoryItemId: idSchema.nullable().optional(),
  notes: nullableText(2_000),
});

const biosecurityCreate = z.object({
  houseId: idSchema,
  recordDate: dateSchema,
  checkType: z.enum([
    "access_control",
    "visitor",
    "vehicle",
    "footbath",
    "ppe",
    "pest_control",
    "quarantine",
    "other",
  ]),
  complianceStatus: z.enum(["compliant", "non_compliant", "not_checked"]),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("low"),
  actionTaken: nullableText(2_000),
  notes: nullableText(2_000),
});
const biosecurityUpdate = nonEmptyUpdate({
  recordDate: dateSchema.optional(),
  checkType: z
    .enum([
      "access_control",
      "visitor",
      "vehicle",
      "footbath",
      "ppe",
      "pest_control",
      "quarantine",
      "other",
    ])
    .optional(),
  complianceStatus: z
    .enum(["compliant", "non_compliant", "not_checked"])
    .optional(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
  actionTaken: nullableText(2_000),
  notes: nullableText(2_000),
});

const targetCreate = z.object({
  flockId: idSchema,
  metric: z.enum([
    "mortality_percent",
    "feed_kg_per_bird",
    "water_liters_per_bird",
    "average_weight_g",
    "egg_count",
    "egg_lay_percent",
  ]),
  targetValue: nonNegativeDecimal,
  effectiveFrom: dateSchema,
  effectiveTo: dateSchema.nullable().optional(),
  notes: nullableText(2_000),
});
const targetUpdate = nonEmptyUpdate({
  metric: z
    .enum([
      "mortality_percent",
      "feed_kg_per_bird",
      "water_liters_per_bird",
      "average_weight_g",
      "egg_count",
      "egg_lay_percent",
    ])
    .optional(),
  targetValue: nonNegativeDecimal.optional(),
  effectiveFrom: dateSchema.optional(),
  effectiveTo: dateSchema.nullable().optional(),
  notes: nullableText(2_000),
});

const lossCreate = z.object({
  flockId: idSchema,
  lossDate: dateSchema,
  lossType: z.enum([
    "bird_missing",
    "predation",
    "egg_breakage",
    "feed_spoilage",
    "equipment_damage",
    "other",
  ]),
  quantity: positiveDecimal,
  unit: text(32).default("count"),
  description: text(2_000),
  notes: nullableText(2_000),
});
const lossUpdate = nonEmptyUpdate({
  lossDate: dateSchema.optional(),
  lossType: z
    .enum([
      "bird_missing",
      "predation",
      "egg_breakage",
      "feed_spoilage",
      "equipment_damage",
      "other",
    ])
    .optional(),
  quantity: positiveDecimal.optional(),
  unit: text(32).optional(),
  description: text(2_000).optional(),
  notes: nullableText(2_000),
});

export const createSchemaByResource: Record<PoultryResource, z.ZodType> = {
  houses: houseCreate,
  flocks: flockCreate,
  "daily-records": dailyRecordCreate,
  mortality: mortalityCreate,
  feed: feedCreate,
  water: waterCreate,
  weights: weightCreate,
  eggs: eggCreate,
  health: healthCreate,
  vaccinations: vaccinationCreate,
  treatments: treatmentCreate,
  sanitation: sanitationCreate,
  biosecurity: biosecurityCreate,
  "production-targets": targetCreate,
  losses: lossCreate,
};

export const updateSchemaByResource: Record<PoultryResource, z.ZodType> = {
  houses: houseUpdate,
  flocks: flockUpdate,
  "daily-records": dailyRecordUpdate,
  mortality: mortalityUpdate,
  feed: feedUpdate,
  water: waterUpdate,
  weights: weightUpdate,
  eggs: eggUpdate,
  health: healthUpdate,
  vaccinations: vaccinationUpdate,
  treatments: treatmentUpdate,
  sanitation: sanitationUpdate,
  biosecurity: biosecurityUpdate,
  "production-targets": targetUpdate,
  losses: lossUpdate,
};

export const poultryListQuery = z.object({
  flockId: idSchema.optional(),
  houseId: idSchema.optional(),
  siteId: idSchema.optional(),
  provinceId: idSchema.optional(),
  productionType: productionTypes.optional(),
  date: dateSchema.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  status: z.string().trim().min(1).max(32).optional(),
});

export const poultryOverviewQuery = z.object({
  siteId: idSchema.optional(),
  provinceId: idSchema.optional(),
  productionType: productionTypes.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

export function parsePoultryBody(
  resource: PoultryResource,
  body: unknown,
  mode: "create" | "update",
): Record<string, unknown> {
  const schema =
    mode === "create"
      ? createSchemaByResource[resource]
      : updateSchemaByResource[resource];
  return schema.parse(body ?? {}) as Record<string, unknown>;
}

export type PoultryListQuery = z.infer<typeof poultryListQuery>;
export type PoultryOverviewQuery = z.infer<typeof poultryOverviewQuery>;
