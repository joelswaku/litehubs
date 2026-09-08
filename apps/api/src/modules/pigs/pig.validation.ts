import { z } from "zod";
import { organizationSlugSchema } from "../organization/organization.validation";

const id = z.string().uuid("Enter a valid identifier");
const date = z.string().date("Use YYYY-MM-DD");
const text = (max: number) => z.string().trim().min(1).max(max);
const nullableText = (max: number) => text(max).nullable().optional();
const code = z
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
const nonEmptyUpdate = (shape: z.ZodRawShape) =>
  z.object(shape).refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one value to change",
  });

export const pigResources = [
  "pens",
  "groups",
  "animals",
  "daily-records",
  "feed",
  "water",
  "weights",
  "movements",
  "mortality",
  "losses",
  "breeding",
  "pregnancies",
  "farrowing",
  "piglets",
  "health",
  "vaccinations",
  "treatments",
  "quarantine",
  "veterinary",
] as const;
export type PigResource = (typeof pigResources)[number];

export const organizationParams = z.object({ orgSlug: organizationSlugSchema });
export const pigResourceParams = organizationParams.extend({
  resource: z.enum(pigResources),
});
export const pigRecordParams = pigResourceParams.extend({ recordId: id });

const penTypes = z.enum([
  "gestation",
  "farrowing",
  "nursery",
  "weaner",
  "grower",
  "finisher",
  "boar",
  "gilt",
  "quarantine",
  "hospital",
  "holding",
  "other",
]);
const animalStatuses = z.enum([
  "active",
  "pregnant",
  "lactating",
  "quarantined",
  "sold",
  "deceased",
  "culled",
  "transferred",
]);
const referenceFields = {
  penId: id,
  groupId: id.nullable().optional(),
  animalId: id.nullable().optional(),
};

const penCreate = z.object({
  siteId: id,
  code,
  name: text(150),
  penType: penTypes.default("other"),
  capacity: positiveInteger,
  notes: nullableText(2_000),
});
const penUpdate = nonEmptyUpdate({
  siteId: id.optional(),
  code: code.optional(),
  name: text(150).optional(),
  penType: penTypes.optional(),
  capacity: positiveInteger.optional(),
  isActive: z.boolean().optional(),
  notes: nullableText(2_000),
});

const groupCreate = z.object({
  penId: id,
  code,
  name: text(150),
  productionStage: z
    .enum([
      "suckling",
      "weaner",
      "grower",
      "finisher",
      "breeding",
      "replacement",
      "quarantine",
      "other",
    ])
    .default("other"),
  breed: nullableText(150),
  sex: z.enum(["mixed", "female", "male", "unknown"]).default("mixed"),
  arrivalDate: date.nullable().optional(),
  initialCount: positiveInteger,
  status: z
    .enum(["active", "closed", "sold", "transferred", "depleted"])
    .default("active"),
  closedAt: date.nullable().optional(),
  notes: nullableText(2_000),
});
const groupUpdate = nonEmptyUpdate({
  penId: id.optional(),
  code: code.optional(),
  name: text(150).optional(),
  productionStage: z
    .enum([
      "suckling",
      "weaner",
      "grower",
      "finisher",
      "breeding",
      "replacement",
      "quarantine",
      "other",
    ])
    .optional(),
  breed: nullableText(150),
  sex: z.enum(["mixed", "female", "male", "unknown"]).optional(),
  arrivalDate: date.nullable().optional(),
  initialCount: positiveInteger.optional(),
  status: z
    .enum(["active", "closed", "sold", "transferred", "depleted"])
    .optional(),
  closedAt: date.nullable().optional(),
  notes: nullableText(2_000),
});

const animalCreate = z.object({
  penId: id,
  groupId: id.nullable().optional(),
  animalNumber: text(100),
  name: nullableText(150),
  earTag: nullableText(100),
  sex: z.enum(["female", "male", "unknown"]),
  animalType: z
    .enum([
      "sow",
      "boar",
      "gilt",
      "barrow",
      "piglet",
      "grower",
      "finisher",
      "other",
    ])
    .default("other"),
  breed: nullableText(150),
  birthDate: date.nullable().optional(),
  arrivalDate: date.nullable().optional(),
  sourceName: nullableText(150),
  status: animalStatuses.default("active"),
  removedAt: date.nullable().optional(),
  notes: nullableText(2_000),
});
const animalUpdate = nonEmptyUpdate({
  penId: id.optional(),
  groupId: id.nullable().optional(),
  animalNumber: text(100).optional(),
  name: nullableText(150),
  earTag: nullableText(100),
  sex: z.enum(["female", "male", "unknown"]).optional(),
  animalType: z
    .enum([
      "sow",
      "boar",
      "gilt",
      "barrow",
      "piglet",
      "grower",
      "finisher",
      "other",
    ])
    .optional(),
  breed: nullableText(150),
  birthDate: date.nullable().optional(),
  arrivalDate: date.nullable().optional(),
  sourceName: nullableText(150),
  status: animalStatuses.optional(),
  removedAt: date.nullable().optional(),
  notes: nullableText(2_000),
});

const dailyCreate = z.object({
  ...referenceFields,
  recordDate: date,
  openingCount: nonNegativeInteger.nullable().optional(),
  birthsCount: nonNegativeInteger.default(0),
  purchasesCount: nonNegativeInteger.default(0),
  transfersInCount: nonNegativeInteger.default(0),
  transfersOutCount: nonNegativeInteger.default(0),
  cullsCount: nonNegativeInteger.default(0),
  mortalityCount: nonNegativeInteger.default(0),
  closingCount: nonNegativeInteger.nullable().optional(),
  notes: nullableText(2_000),
});
const dailyUpdate = nonEmptyUpdate({
  penId: id.optional(),
  groupId: id.nullable().optional(),
  animalId: id.nullable().optional(),
  recordDate: date.optional(),
  openingCount: nonNegativeInteger.nullable().optional(),
  birthsCount: nonNegativeInteger.optional(),
  purchasesCount: nonNegativeInteger.optional(),
  transfersInCount: nonNegativeInteger.optional(),
  transfersOutCount: nonNegativeInteger.optional(),
  cullsCount: nonNegativeInteger.optional(),
  mortalityCount: nonNegativeInteger.optional(),
  closingCount: nonNegativeInteger.nullable().optional(),
  notes: nullableText(2_000),
});

const feedCreate = z.object({
  penId: id,
  groupId: id.nullable().optional(),
  feedDate: date,
  feedName: text(150),
  feedStage: z
    .enum([
      "creep",
      "starter",
      "weaner",
      "grower",
      "finisher",
      "gestation",
      "lactation",
      "boar",
      "medicated",
      "other",
    ])
    .default("other"),
  quantityKg: positiveDecimal,
  bagCount: nonNegativeDecimal.nullable().optional(),
  batchNumber: nullableText(150),
  notes: nullableText(2_000),
});
const feedUpdate = nonEmptyUpdate({
  penId: id.optional(),
  groupId: id.nullable().optional(),
  feedDate: date.optional(),
  feedName: text(150).optional(),
  feedStage: z
    .enum([
      "creep",
      "starter",
      "weaner",
      "grower",
      "finisher",
      "gestation",
      "lactation",
      "boar",
      "medicated",
      "other",
    ])
    .optional(),
  quantityKg: positiveDecimal.optional(),
  bagCount: nonNegativeDecimal.nullable().optional(),
  batchNumber: nullableText(150),
  notes: nullableText(2_000),
});

const waterCreate = z.object({
  penId: id,
  groupId: id.nullable().optional(),
  waterDate: date,
  volumeLiters: positiveDecimal,
  sourceName: nullableText(150),
  notes: nullableText(2_000),
});
const waterUpdate = nonEmptyUpdate({
  penId: id.optional(),
  groupId: id.nullable().optional(),
  waterDate: date.optional(),
  volumeLiters: positiveDecimal.optional(),
  sourceName: nullableText(150),
  notes: nullableText(2_000),
});

const weightCreate = z.object({
  ...referenceFields,
  recordDate: date,
  sampleSize: positiveInteger.default(1),
  averageWeightKg: positiveDecimal,
  minimumWeightKg: positiveDecimal.nullable().optional(),
  maximumWeightKg: positiveDecimal.nullable().optional(),
  bodyConditionScore: z.number().min(1).max(5).nullable().optional(),
  notes: nullableText(2_000),
});
const weightUpdate = nonEmptyUpdate({
  penId: id.optional(),
  groupId: id.nullable().optional(),
  animalId: id.nullable().optional(),
  recordDate: date.optional(),
  sampleSize: positiveInteger.optional(),
  averageWeightKg: positiveDecimal.optional(),
  minimumWeightKg: positiveDecimal.nullable().optional(),
  maximumWeightKg: positiveDecimal.nullable().optional(),
  bodyConditionScore: z.number().min(1).max(5).nullable().optional(),
  notes: nullableText(2_000),
});

const movementCreate = z
  .object({
    movementDate: date,
    animalId: id.nullable().optional(),
    groupId: id.nullable().optional(),
    fromPenId: id,
    toPenId: id,
    movementType: z
      .enum([
        "internal",
        "purchase",
        "sale",
        "transfer",
        "quarantine",
        "hospital",
        "return",
        "other",
      ])
      .default("internal"),
    headCount: positiveInteger.default(1),
    reason: nullableText(2_000),
    referenceNumber: nullableText(100),
    notes: nullableText(2_000),
  })
  .refine(
    (value) =>
      Number(value.animalId != null) + Number(value.groupId != null) === 1,
    { message: "Choose exactly one animal or group" },
  )
  .refine((value) => value.fromPenId !== value.toPenId, {
    message: "Source and destination pens must be different",
  });
const movementUpdate = nonEmptyUpdate({
  movementDate: date.optional(),
  animalId: id.nullable().optional(),
  groupId: id.nullable().optional(),
  fromPenId: id.optional(),
  toPenId: id.optional(),
  movementType: z
    .enum([
      "internal",
      "purchase",
      "sale",
      "transfer",
      "quarantine",
      "hospital",
      "return",
      "other",
    ])
    .optional(),
  headCount: positiveInteger.optional(),
  reason: nullableText(2_000),
  referenceNumber: nullableText(100),
  notes: nullableText(2_000),
});

const mortalityCause = z.enum([
  "unknown",
  "disease",
  "injury",
  "crushing",
  "starvation",
  "heat_stress",
  "respiratory",
  "digestive",
  "reproductive",
  "management",
  "other",
]);
const mortalityCreate = z.object({
  ...referenceFields,
  mortalityDate: date,
  deathCount: positiveInteger.default(1),
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
    .default("not_required"),
  followUpNotes: nullableText(4_000),
  notes: nullableText(4_000),
});
const mortalityUpdate = nonEmptyUpdate({
  penId: id.optional(),
  groupId: id.nullable().optional(),
  animalId: id.nullable().optional(),
  mortalityDate: date.optional(),
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

const lossCreate = z.object({
  penId: id,
  lossDate: date,
  lossType: z.enum([
    "pig_missing",
    "feed_spoilage",
    "equipment_damage",
    "theft",
    "medication_waste",
    "other",
  ]),
  quantity: positiveDecimal,
  unit: text(32).default("count"),
  description: text(2_000),
  notes: nullableText(2_000),
});
const lossUpdate = nonEmptyUpdate({
  penId: id.optional(),
  lossDate: date.optional(),
  lossType: z
    .enum([
      "pig_missing",
      "feed_spoilage",
      "equipment_damage",
      "theft",
      "medication_waste",
      "other",
    ])
    .optional(),
  quantity: positiveDecimal.optional(),
  unit: text(32).optional(),
  description: text(2_000).optional(),
  notes: nullableText(2_000),
});

const breedingCreate = z.object({
  penId: id,
  femaleAnimalId: id,
  maleAnimalId: id.nullable().optional(),
  breedingDate: date,
  breedingMethod: z
    .enum(["natural", "artificial_insemination", "embryo_transfer", "other"])
    .default("natural"),
  status: z
    .enum(["planned", "completed", "failed", "cancelled"])
    .default("completed"),
  expectedFarrowingDate: date.nullable().optional(),
  notes: nullableText(2_000),
});
const breedingUpdate = nonEmptyUpdate({
  penId: id.optional(),
  femaleAnimalId: id.optional(),
  maleAnimalId: id.nullable().optional(),
  breedingDate: date.optional(),
  breedingMethod: z
    .enum(["natural", "artificial_insemination", "embryo_transfer", "other"])
    .optional(),
  status: z.enum(["planned", "completed", "failed", "cancelled"]).optional(),
  expectedFarrowingDate: date.nullable().optional(),
  notes: nullableText(2_000),
});

const pregnancyCreate = z.object({
  penId: id,
  sowAnimalId: id,
  breedingId: id.nullable().optional(),
  confirmedDate: date,
  confirmationMethod: z
    .enum(["observation", "ultrasound", "blood_test", "other"])
    .default("observation"),
  expectedFarrowingDate: date.nullable().optional(),
  status: z
    .enum(["suspected", "confirmed", "aborted", "farrowed", "lost", "closed"])
    .default("confirmed"),
  notes: nullableText(2_000),
});
const pregnancyUpdate = nonEmptyUpdate({
  penId: id.optional(),
  sowAnimalId: id.optional(),
  breedingId: id.nullable().optional(),
  confirmedDate: date.optional(),
  confirmationMethod: z
    .enum(["observation", "ultrasound", "blood_test", "other"])
    .optional(),
  expectedFarrowingDate: date.nullable().optional(),
  status: z
    .enum(["suspected", "confirmed", "aborted", "farrowed", "lost", "closed"])
    .optional(),
  notes: nullableText(2_000),
});

const farrowingCreate = z
  .object({
    penId: id,
    sowAnimalId: id,
    pregnancyId: id.nullable().optional(),
    farrowingDate: date,
    totalBornCount: nonNegativeInteger,
    liveBornCount: nonNegativeInteger,
    stillbornCount: nonNegativeInteger.default(0),
    mummifiedCount: nonNegativeInteger.default(0),
    fosteredInCount: nonNegativeInteger.default(0),
    fosteredOutCount: nonNegativeInteger.default(0),
    assistanceRequired: z.boolean().default(false),
    notes: nullableText(2_000),
  })
  .refine(
    (value) =>
      value.liveBornCount + value.stillbornCount + value.mummifiedCount <=
      value.totalBornCount,
    {
      message: "Live, stillborn and mummified counts cannot exceed total born",
    },
  );
const farrowingUpdate = nonEmptyUpdate({
  penId: id.optional(),
  sowAnimalId: id.optional(),
  pregnancyId: id.nullable().optional(),
  farrowingDate: date.optional(),
  totalBornCount: nonNegativeInteger.optional(),
  liveBornCount: nonNegativeInteger.optional(),
  stillbornCount: nonNegativeInteger.optional(),
  mummifiedCount: nonNegativeInteger.optional(),
  fosteredInCount: nonNegativeInteger.optional(),
  fosteredOutCount: nonNegativeInteger.optional(),
  assistanceRequired: z.boolean().optional(),
  notes: nullableText(2_000),
});

const pigletCreate = z
  .object({
    penId: id,
    groupId: id.nullable().optional(),
    farrowingId: id.nullable().optional(),
    recordDate: date,
    pigletCount: positiveInteger,
    femaleCount: nonNegativeInteger.default(0),
    maleCount: nonNegativeInteger.default(0),
    unknownSexCount: nonNegativeInteger.default(0),
    averageBirthWeightKg: positiveDecimal.nullable().optional(),
    status: z
      .enum(["active", "weaned", "sold", "deceased", "transferred"])
      .default("active"),
    notes: nullableText(2_000),
  })
  .refine(
    (value) =>
      value.femaleCount + value.maleCount + value.unknownSexCount ===
      value.pigletCount,
    { message: "Sex counts must equal the piglet count" },
  );
const pigletUpdate = nonEmptyUpdate({
  penId: id.optional(),
  groupId: id.nullable().optional(),
  farrowingId: id.nullable().optional(),
  recordDate: date.optional(),
  pigletCount: positiveInteger.optional(),
  femaleCount: nonNegativeInteger.optional(),
  maleCount: nonNegativeInteger.optional(),
  unknownSexCount: nonNegativeInteger.optional(),
  averageBirthWeightKg: positiveDecimal.nullable().optional(),
  status: z
    .enum(["active", "weaned", "sold", "deceased", "transferred"])
    .optional(),
  notes: nullableText(2_000),
});

const healthCreate = z.object({
  ...referenceFields,
  recordDate: date,
  eventType: z.enum([
    "observation",
    "suspected_disease",
    "confirmed_disease",
    "outbreak",
    "injury",
    "lameness",
    "reproductive",
    "other",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]).default("low"),
  animalsAffected: nonNegativeInteger.default(0),
  symptoms: nullableText(4_000),
  diagnosis: nullableText(2_000),
  actionTaken: nullableText(4_000),
  veterinarianName: nullableText(150),
  status: z.enum(["open", "monitoring", "resolved"]).default("open"),
  notes: nullableText(4_000),
});
const healthUpdate = nonEmptyUpdate({
  penId: id.optional(),
  groupId: id.nullable().optional(),
  animalId: id.nullable().optional(),
  recordDate: date.optional(),
  eventType: z
    .enum([
      "observation",
      "suspected_disease",
      "confirmed_disease",
      "outbreak",
      "injury",
      "lameness",
      "reproductive",
      "other",
    ])
    .optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  animalsAffected: nonNegativeInteger.optional(),
  symptoms: nullableText(4_000),
  diagnosis: nullableText(2_000),
  actionTaken: nullableText(4_000),
  veterinarianName: nullableText(150),
  status: z.enum(["open", "monitoring", "resolved"]).optional(),
  notes: nullableText(4_000),
});

const vaccinationCreate = z.object({
  ...referenceFields,
  vaccinationDate: date,
  vaccineName: text(150),
  manufacturer: nullableText(150),
  batchNumber: nullableText(150),
  dose: nullableText(150),
  administrationRoute: nullableText(150),
  nextDueDate: date.nullable().optional(),
  administeredBy: nullableText(150),
  notes: nullableText(2_000),
});
const vaccinationUpdate = nonEmptyUpdate({
  penId: id.optional(),
  groupId: id.nullable().optional(),
  animalId: id.nullable().optional(),
  vaccinationDate: date.optional(),
  vaccineName: text(150).optional(),
  manufacturer: nullableText(150),
  batchNumber: nullableText(150),
  dose: nullableText(150),
  administrationRoute: nullableText(150),
  nextDueDate: date.nullable().optional(),
  administeredBy: nullableText(150),
  notes: nullableText(2_000),
});

const treatmentCreate = z.object({
  ...referenceFields,
  treatmentDate: date,
  productName: text(150),
  reason: text(2_000),
  dosage: nullableText(150),
  administrationRoute: nullableText(150),
  endDate: date.nullable().optional(),
  withdrawalEndDate: date.nullable().optional(),
  prescribedBy: nullableText(150),
  notes: nullableText(2_000),
});
const treatmentUpdate = nonEmptyUpdate({
  penId: id.optional(),
  groupId: id.nullable().optional(),
  animalId: id.nullable().optional(),
  treatmentDate: date.optional(),
  productName: text(150).optional(),
  reason: text(2_000).optional(),
  dosage: nullableText(150),
  administrationRoute: nullableText(150),
  endDate: date.nullable().optional(),
  withdrawalEndDate: date.nullable().optional(),
  prescribedBy: nullableText(150),
  notes: nullableText(2_000),
});

const quarantineCreate = z
  .object({
    ...referenceFields,
    startDate: date,
    endDate: date.nullable().optional(),
    reason: text(2_000),
    status: z
      .enum(["active", "released", "extended", "cancelled"])
      .default("active"),
    clearanceNotes: nullableText(2_000),
    notes: nullableText(2_000),
  })
  .refine((value) => value.groupId != null || value.animalId != null, {
    message: "Choose a group or an animal for quarantine",
  });
const quarantineUpdate = nonEmptyUpdate({
  penId: id.optional(),
  groupId: id.nullable().optional(),
  animalId: id.nullable().optional(),
  startDate: date.optional(),
  endDate: date.nullable().optional(),
  reason: text(2_000).optional(),
  status: z.enum(["active", "released", "extended", "cancelled"]).optional(),
  clearanceNotes: nullableText(2_000),
  notes: nullableText(2_000),
});

const veterinaryCreate = z.object({
  ...referenceFields,
  visitDate: date,
  visitType: z.enum([
    "routine",
    "emergency",
    "diagnostic",
    "follow_up",
    "advisory",
    "other",
  ]),
  veterinarianName: text(150),
  diagnosis: nullableText(2_000),
  recommendations: nullableText(4_000),
  followUpDate: date.nullable().optional(),
  status: z.enum(["open", "monitoring", "closed"]).default("open"),
  notes: nullableText(4_000),
});
const veterinaryUpdate = nonEmptyUpdate({
  penId: id.optional(),
  groupId: id.nullable().optional(),
  animalId: id.nullable().optional(),
  visitDate: date.optional(),
  visitType: z
    .enum([
      "routine",
      "emergency",
      "diagnostic",
      "follow_up",
      "advisory",
      "other",
    ])
    .optional(),
  veterinarianName: text(150).optional(),
  diagnosis: nullableText(2_000),
  recommendations: nullableText(4_000),
  followUpDate: date.nullable().optional(),
  status: z.enum(["open", "monitoring", "closed"]).optional(),
  notes: nullableText(4_000),
});

export const createSchemaByResource: Record<PigResource, z.ZodType> = {
  pens: penCreate,
  groups: groupCreate,
  animals: animalCreate,
  "daily-records": dailyCreate,
  feed: feedCreate,
  water: waterCreate,
  weights: weightCreate,
  movements: movementCreate,
  mortality: mortalityCreate,
  losses: lossCreate,
  breeding: breedingCreate,
  pregnancies: pregnancyCreate,
  farrowing: farrowingCreate,
  piglets: pigletCreate,
  health: healthCreate,
  vaccinations: vaccinationCreate,
  treatments: treatmentCreate,
  quarantine: quarantineCreate,
  veterinary: veterinaryCreate,
};
export const updateSchemaByResource: Record<PigResource, z.ZodType> = {
  pens: penUpdate,
  groups: groupUpdate,
  animals: animalUpdate,
  "daily-records": dailyUpdate,
  feed: feedUpdate,
  water: waterUpdate,
  weights: weightUpdate,
  movements: movementUpdate,
  mortality: mortalityUpdate,
  losses: lossUpdate,
  breeding: breedingUpdate,
  pregnancies: pregnancyUpdate,
  farrowing: farrowingUpdate,
  piglets: pigletUpdate,
  health: healthUpdate,
  vaccinations: vaccinationUpdate,
  treatments: treatmentUpdate,
  quarantine: quarantineUpdate,
  veterinary: veterinaryUpdate,
};

export const pigListQuery = z.object({
  siteId: id.optional(),
  penId: id.optional(),
  groupId: id.optional(),
  animalId: id.optional(),
  date: date.optional(),
  from: date.optional(),
  to: date.optional(),
  status: z.string().trim().min(1).max(32).optional(),
});
export const pigOverviewQuery = z.object({
  siteId: id.optional(),
  from: date.optional(),
  to: date.optional(),
});
export function parsePigBody(
  resource: PigResource,
  body: unknown,
  mode: "create" | "update",
): Record<string, unknown> {
  return (
    mode === "create"
      ? createSchemaByResource[resource]
      : updateSchemaByResource[resource]
  ).parse(body ?? {}) as Record<string, unknown>;
}
export type PigListQuery = z.infer<typeof pigListQuery>;
export type PigOverviewQuery = z.infer<typeof pigOverviewQuery>;
