import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Enter a valid identifier");
const date = z.string().date("Use YYYY-MM-DD");
const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const nullableText = (maximum: number) => text(maximum).nullable().optional();
const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9_]{1,62}$/,
    "Use lowercase letters, numbers and underscores",
  );
const optionalCode = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  code.optional(),
);
const positiveInteger = z.number().int().positive();
const nonNegativeInteger = z.number().int().nonnegative();
const positiveDecimal = z.number().positive();
const nonNegativeDecimal = z.number().nonnegative();
const nonEmptyUpdate = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one value to change",
  });

export const agricultureResources = [
  "farms",
  "fields",
  "plots",
  "crops",
  "seasons",
  "plantings",
  "operations",
  "irrigation",
  "fertilizer",
  "pesticides",
  "scouting",
  "weather",
  "harvest",
  "production-targets",
  "losses",
] as const;

export type AgricultureResource = (typeof agricultureResources)[number];

export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const agricultureResourceParams = organizationParams.extend({
  resource: z.enum(agricultureResources),
});
export const agricultureRecordParams = agricultureResourceParams.extend({
  recordId: id,
});

const farmTypes = z.enum([
  "crop",
  "livestock",
  "mixed",
  "nursery",
  "research",
  "other",
]);
const cropTypes = z.enum([
  "cereal",
  "legume",
  "root_tuber",
  "vegetable",
  "fruit",
  "oilseed",
  "forage",
  "cash_crop",
  "tree",
  "other",
]);
const plantingStatuses = z.enum([
  "planned",
  "planted",
  "growing",
  "harvested",
  "failed",
  "abandoned",
  "closed",
]);
const eventReferences = {
  fieldId: id,
  plotId: id.nullable().optional(),
  plantingId: id.nullable().optional(),
};

const farmCreate = z.object({
  siteId: id,
  code: optionalCode,
  name: text(150),
  farmType: farmTypes.default("mixed"),
  totalAreaHa: positiveDecimal.nullable().optional(),
  managerName: nullableText(150),
  notes: nullableText(2_000),
});
const farmUpdate = nonEmptyUpdate({
  siteId: id.optional(),
  code: code.optional(),
  name: text(150).optional(),
  farmType: farmTypes.optional(),
  totalAreaHa: positiveDecimal.nullable().optional(),
  managerName: nullableText(150),
  isActive: z.boolean().optional(),
  notes: nullableText(2_000),
});

const fieldCreate = z.object({
  farmId: id,
  code,
  name: text(150),
  areaHa: positiveDecimal,
  soilType: nullableText(150),
  irrigationSource: nullableText(150),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  notes: nullableText(2_000),
});
const fieldUpdate = nonEmptyUpdate({
  farmId: id.optional(),
  code: code.optional(),
  name: text(150).optional(),
  areaHa: positiveDecimal.optional(),
  soilType: nullableText(150),
  irrigationSource: nullableText(150),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  isActive: z.boolean().optional(),
  notes: nullableText(2_000),
});

const plotCreate = z.object({
  fieldId: id,
  code,
  name: text(150),
  areaHa: positiveDecimal,
  soilType: nullableText(150),
  status: z
    .enum([
      "available",
      "planted",
      "fallow",
      "resting",
      "quarantined",
      "closed",
    ])
    .default("available"),
  notes: nullableText(2_000),
});
const plotUpdate = nonEmptyUpdate({
  fieldId: id.optional(),
  code: code.optional(),
  name: text(150).optional(),
  areaHa: positiveDecimal.optional(),
  soilType: nullableText(150),
  status: z
    .enum([
      "available",
      "planted",
      "fallow",
      "resting",
      "quarantined",
      "closed",
    ])
    .optional(),
  notes: nullableText(2_000),
});

const cropCreate = z.object({
  code,
  name: text(150),
  scientificName: nullableText(150),
  cropType: cropTypes.default("other"),
  variety: nullableText(150),
  defaultGrowingDays: positiveInteger.nullable().optional(),
  defaultYieldUnit: text(30).default("kg"),
  notes: nullableText(2_000),
});
const cropUpdate = nonEmptyUpdate({
  code: code.optional(),
  name: text(150).optional(),
  scientificName: nullableText(150),
  cropType: cropTypes.optional(),
  variety: nullableText(150),
  defaultGrowingDays: positiveInteger.nullable().optional(),
  defaultYieldUnit: text(30).optional(),
  isActive: z.boolean().optional(),
  notes: nullableText(2_000),
});

const seasonCreate = z
  .object({
    farmId: id,
    code,
    name: text(150),
    seasonType: z
      .enum(["rainy", "dry", "irrigated", "perennial", "other"])
      .default("other"),
    startDate: date,
    endDate: date,
    notes: nullableText(2_000),
  })
  .refine((item) => item.endDate >= item.startDate, {
    path: ["endDate"],
    message: "End date must be on or after the start date",
  });
const seasonUpdate = nonEmptyUpdate({
  farmId: id.optional(),
  code: code.optional(),
  name: text(150).optional(),
  seasonType: z
    .enum(["rainy", "dry", "irrigated", "perennial", "other"])
    .optional(),
  startDate: date.optional(),
  endDate: date.optional(),
  isActive: z.boolean().optional(),
  notes: nullableText(2_000),
});

const plantingCreate = z.object({
  plotId: id,
  cropId: id,
  seasonId: id.nullable().optional(),
  code,
  name: text(150),
  variety: nullableText(150),
  plantingDate: date,
  expectedHarvestDate: date.nullable().optional(),
  plantedAreaHa: positiveDecimal,
  seedQuantity: positiveDecimal.nullable().optional(),
  seedUnit: nullableText(30),
  plantingMethod: nullableText(100),
  plantDensity: positiveDecimal.nullable().optional(),
  status: plantingStatuses.default("planned"),
  notes: nullableText(2_000),
});
const plantingUpdate = nonEmptyUpdate({
  plotId: id.optional(),
  cropId: id.optional(),
  seasonId: id.nullable().optional(),
  code: code.optional(),
  name: text(150).optional(),
  variety: nullableText(150),
  plantingDate: date.optional(),
  expectedHarvestDate: date.nullable().optional(),
  actualHarvestDate: date.nullable().optional(),
  plantedAreaHa: positiveDecimal.optional(),
  seedQuantity: positiveDecimal.nullable().optional(),
  seedUnit: nullableText(30),
  plantingMethod: nullableText(100),
  plantDensity: positiveDecimal.nullable().optional(),
  status: plantingStatuses.optional(),
  notes: nullableText(2_000),
});

const operationCreate = z.object({
  ...eventReferences,
  operationDate: date,
  operationType: z.enum([
    "land_preparation",
    "planting",
    "weeding",
    "pruning",
    "staking",
    "mulching",
    "harvesting",
    "inspection",
    "maintenance",
    "other",
  ]),
  status: z
    .enum(["planned", "in_progress", "completed", "cancelled"])
    .default("completed"),
  quantity: positiveDecimal.nullable().optional(),
  unit: nullableText(30),
  labourHours: nonNegativeDecimal.nullable().optional(),
  equipmentName: nullableText(150),
  notes: nullableText(2_000),
});
const operationUpdate = nonEmptyUpdate({
  ...eventReferences,
  operationDate: date.optional(),
  operationType: z
    .enum([
      "land_preparation",
      "planting",
      "weeding",
      "pruning",
      "staking",
      "mulching",
      "harvesting",
      "inspection",
      "maintenance",
      "other",
    ])
    .optional(),
  status: z
    .enum(["planned", "in_progress", "completed", "cancelled"])
    .optional(),
  quantity: positiveDecimal.nullable().optional(),
  unit: nullableText(30),
  labourHours: nonNegativeDecimal.nullable().optional(),
  equipmentName: nullableText(150),
  notes: nullableText(2_000),
});

const irrigationCreate = z.object({
  ...eventReferences,
  irrigationDate: date,
  method: z
    .enum([
      "drip",
      "sprinkler",
      "furrow",
      "flood",
      "manual",
      "rainfed",
      "other",
    ])
    .default("other"),
  volumeLiters: positiveDecimal.nullable().optional(),
  durationMinutes: positiveInteger.nullable().optional(),
  waterSource: nullableText(150),
  notes: nullableText(2_000),
});
const irrigationUpdate = nonEmptyUpdate({
  ...eventReferences,
  irrigationDate: date.optional(),
  method: z
    .enum([
      "drip",
      "sprinkler",
      "furrow",
      "flood",
      "manual",
      "rainfed",
      "other",
    ])
    .optional(),
  volumeLiters: positiveDecimal.nullable().optional(),
  durationMinutes: positiveInteger.nullable().optional(),
  waterSource: nullableText(150),
  notes: nullableText(2_000),
});

const fertilizerCreate = z.object({
  ...eventReferences,
  applicationDate: date,
  productName: text(150),
  nutrientFormula: nullableText(100),
  quantityKg: positiveDecimal,
  applicationMethod: nullableText(100),
  batchNumber: nullableText(100),
  notes: nullableText(2_000),
});
const fertilizerUpdate = nonEmptyUpdate({
  ...eventReferences,
  applicationDate: date.optional(),
  productName: text(150).optional(),
  nutrientFormula: nullableText(100),
  quantityKg: positiveDecimal.optional(),
  applicationMethod: nullableText(100),
  batchNumber: nullableText(100),
  notes: nullableText(2_000),
});

const pesticideCreate = z.object({
  ...eventReferences,
  applicationDate: date,
  productName: text(150),
  activeIngredient: nullableText(150),
  targetPest: nullableText(150),
  dosage: nullableText(100),
  applicationMethod: nullableText(100),
  preHarvestIntervalDays: nonNegativeInteger.nullable().optional(),
  batchNumber: nullableText(100),
  notes: nullableText(2_000),
});
const pesticideUpdate = nonEmptyUpdate({
  ...eventReferences,
  applicationDate: date.optional(),
  productName: text(150).optional(),
  activeIngredient: nullableText(150),
  targetPest: nullableText(150),
  dosage: nullableText(100),
  applicationMethod: nullableText(100),
  preHarvestIntervalDays: nonNegativeInteger.nullable().optional(),
  batchNumber: nullableText(100),
  notes: nullableText(2_000),
});

const scoutingCreate = z.object({
  ...eventReferences,
  scoutingDate: date,
  observationType: z.enum([
    "pest",
    "disease",
    "weed",
    "nutrient_deficiency",
    "water_stress",
    "growth",
    "soil",
    "weather_damage",
    "other",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]).default("low"),
  affectedAreaHa: positiveDecimal.nullable().optional(),
  observedIssue: nullableText(2_000),
  pestOrDisease: nullableText(150),
  recommendation: nullableText(2_000),
  status: z.enum(["open", "monitoring", "resolved"]).default("open"),
  notes: nullableText(2_000),
});
const scoutingUpdate = nonEmptyUpdate({
  ...eventReferences,
  scoutingDate: date.optional(),
  observationType: z
    .enum([
      "pest",
      "disease",
      "weed",
      "nutrient_deficiency",
      "water_stress",
      "growth",
      "soil",
      "weather_damage",
      "other",
    ])
    .optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  affectedAreaHa: positiveDecimal.nullable().optional(),
  observedIssue: nullableText(2_000),
  pestOrDisease: nullableText(150),
  recommendation: nullableText(2_000),
  status: z.enum(["open", "monitoring", "resolved"]).optional(),
  notes: nullableText(2_000),
});

const weatherCreate = z.object({
  farmId: id,
  observationDate: date,
  rainfallMm: nonNegativeDecimal.nullable().optional(),
  minTemperatureC: z.number().nullable().optional(),
  maxTemperatureC: z.number().nullable().optional(),
  humidityPercent: z.number().min(0).max(100).nullable().optional(),
  windSpeedKph: nonNegativeDecimal.nullable().optional(),
  conditions: nullableText(150),
  notes: nullableText(2_000),
});
const weatherUpdate = nonEmptyUpdate({
  farmId: id.optional(),
  observationDate: date.optional(),
  rainfallMm: nonNegativeDecimal.nullable().optional(),
  minTemperatureC: z.number().nullable().optional(),
  maxTemperatureC: z.number().nullable().optional(),
  humidityPercent: z.number().min(0).max(100).nullable().optional(),
  windSpeedKph: nonNegativeDecimal.nullable().optional(),
  conditions: nullableText(150),
  notes: nullableText(2_000),
});

const harvestCreate = z.object({
  plantingId: id,
  harvestDate: date,
  quantity: positiveDecimal,
  unit: text(30).default("kg"),
  qualityGrade: nullableText(100),
  rejectedQuantity: nonNegativeDecimal.default(0),
  moisturePercent: z.number().min(0).max(100).nullable().optional(),
  storageLocation: nullableText(150),
  notes: nullableText(2_000),
});
const harvestUpdate = nonEmptyUpdate({
  plantingId: id.optional(),
  harvestDate: date.optional(),
  quantity: positiveDecimal.optional(),
  unit: text(30).optional(),
  qualityGrade: nullableText(100),
  rejectedQuantity: nonNegativeDecimal.optional(),
  moisturePercent: z.number().min(0).max(100).nullable().optional(),
  storageLocation: nullableText(150),
  notes: nullableText(2_000),
});

const targetCreate = z.object({
  plantingId: id,
  targetYield: positiveDecimal,
  unit: text(30).default("kg"),
  targetHarvestDate: date.nullable().optional(),
  qualityTarget: nullableText(150),
  notes: nullableText(2_000),
});
const targetUpdate = nonEmptyUpdate({
  plantingId: id.optional(),
  targetYield: positiveDecimal.optional(),
  unit: text(30).optional(),
  targetHarvestDate: date.nullable().optional(),
  qualityTarget: nullableText(150),
  notes: nullableText(2_000),
});

const lossCreate = z.object({
  ...eventReferences,
  lossDate: date,
  lossType: z.enum([
    "crop_damage",
    "pest",
    "disease",
    "drought",
    "flood",
    "fire",
    "theft",
    "input_spoilage",
    "equipment",
    "other",
  ]),
  quantity: positiveDecimal.nullable().optional(),
  unit: nullableText(30),
  estimatedValue: nonNegativeDecimal.nullable().optional(),
  causeDescription: nullableText(2_000),
  actionTaken: nullableText(2_000),
  notes: nullableText(2_000),
});
const lossUpdate = nonEmptyUpdate({
  ...eventReferences,
  lossDate: date.optional(),
  lossType: z
    .enum([
      "crop_damage",
      "pest",
      "disease",
      "drought",
      "flood",
      "fire",
      "theft",
      "input_spoilage",
      "equipment",
      "other",
    ])
    .optional(),
  quantity: positiveDecimal.nullable().optional(),
  unit: nullableText(30),
  estimatedValue: nonNegativeDecimal.nullable().optional(),
  causeDescription: nullableText(2_000),
  actionTaken: nullableText(2_000),
  notes: nullableText(2_000),
});

const createSchemas: Record<AgricultureResource, z.ZodType> = {
  farms: farmCreate,
  fields: fieldCreate,
  plots: plotCreate,
  crops: cropCreate,
  seasons: seasonCreate,
  plantings: plantingCreate,
  operations: operationCreate,
  irrigation: irrigationCreate,
  fertilizer: fertilizerCreate,
  pesticides: pesticideCreate,
  scouting: scoutingCreate,
  weather: weatherCreate,
  harvest: harvestCreate,
  "production-targets": targetCreate,
  losses: lossCreate,
};

const updateSchemas: Record<AgricultureResource, z.ZodType> = {
  farms: farmUpdate,
  fields: fieldUpdate,
  plots: plotUpdate,
  crops: cropUpdate,
  seasons: seasonUpdate,
  plantings: plantingUpdate,
  operations: operationUpdate,
  irrigation: irrigationUpdate,
  fertilizer: fertilizerUpdate,
  pesticides: pesticideUpdate,
  scouting: scoutingUpdate,
  weather: weatherUpdate,
  harvest: harvestUpdate,
  "production-targets": targetUpdate,
  losses: lossUpdate,
};

export const agricultureListQuery = z.object({
  siteId: id.optional(),
  farmId: id.optional(),
  fieldId: id.optional(),
  plotId: id.optional(),
  cropId: id.optional(),
  seasonId: id.optional(),
  plantingId: id.optional(),
  status: z.string().trim().min(1).max(50).optional(),
  fromDate: date.optional(),
  toDate: date.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type AgricultureListQuery = z.infer<typeof agricultureListQuery>;

export const agricultureOverviewQuery = z.object({ siteId: id.optional() });
export type AgricultureOverviewQuery = z.infer<typeof agricultureOverviewQuery>;

export function parseAgricultureBody(
  resource: AgricultureResource,
  body: unknown,
  mode: "create" | "update",
): Record<string, unknown> {
  return (
    mode === "create" ? createSchemas[resource] : updateSchemas[resource]
  ).parse(body) as Record<string, unknown>;
}
