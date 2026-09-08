import type { PoolClient } from "pg";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type {
  PigListQuery,
  PigOverviewQuery,
  PigResource,
} from "./pig.validation";

export interface PigContext {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
}

const events: Record<EventResource, EventConfig> = {
  "daily-records": {
    table: "pig_daily_records",
    dateColumn: "record_date",
    penColumn: "pen_id",
    group: true,
    animal: true,
  },
  feed: {
    table: "pig_feed_records",
    dateColumn: "feed_date",
    penColumn: "pen_id",
    group: true,
  },
  water: {
    table: "pig_water_records",
    dateColumn: "water_date",
    penColumn: "pen_id",
    group: true,
  },
  weights: {
    table: "pig_weight_records",
    dateColumn: "record_date",
    penColumn: "pen_id",
    group: true,
    animal: true,
  },
  movements: {
    table: "pig_movements",
    dateColumn: "movement_date",
    penColumn: "from_pen_id",
    group: true,
    animal: true,
  },
  mortality: {
    table: "pig_mortality_records",
    dateColumn: "mortality_date",
    penColumn: "pen_id",
    group: true,
    animal: true,
  },
  losses: {
    table: "pig_loss_records",
    dateColumn: "loss_date",
    penColumn: "pen_id",
  },
  breeding: {
    table: "pig_breeding_records",
    dateColumn: "breeding_date",
    penColumn: "pen_id",
  },
  pregnancies: {
    table: "pig_pregnancies",
    dateColumn: "confirmed_date",
    penColumn: "pen_id",
    status: true,
  },
  farrowing: {
    table: "pig_farrowing_records",
    dateColumn: "farrowing_date",
    penColumn: "pen_id",
  },
  piglets: {
    table: "pig_piglets",
    dateColumn: "record_date",
    penColumn: "pen_id",
    status: true,
    group: true,
  },
  health: {
    table: "pig_health_records",
    dateColumn: "record_date",
    penColumn: "pen_id",
    status: true,
    group: true,
    animal: true,
  },
  vaccinations: {
    table: "pig_vaccination_records",
    dateColumn: "vaccination_date",
    penColumn: "pen_id",
    group: true,
    animal: true,
  },
  treatments: {
    table: "pig_treatment_records",
    dateColumn: "treatment_date",
    penColumn: "pen_id",
    group: true,
    animal: true,
  },
  quarantine: {
    table: "pig_quarantine_records",
    dateColumn: "start_date",
    penColumn: "pen_id",
    status: true,
    group: true,
    animal: true,
  },
  veterinary: {
    table: "pig_veterinary_records",
    dateColumn: "visit_date",
    penColumn: "pen_id",
    status: true,
    group: true,
    animal: true,
  },
};

async function scopeOf(
  client: PoolClient,
  context: PigContext,
): Promise<Scope> {
  if (context.isOwner) return "organization";
  const result = await client.query<{
    organization_scope: boolean;
    province_scope: boolean;
  }>(
    `SELECT EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id = mr.organization_id AND r.id = mr.role_id WHERE mr.organization_id = $1 AND mr.member_id = $2 AND r.data_scope = 'organization') AS organization_scope, EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id = mr.organization_id AND r.id = mr.role_id WHERE mr.organization_id = $1 AND mr.member_id = $2 AND r.data_scope = 'province') AS province_scope`,
    [context.organizationId, context.memberId],
  );
  return result.rows[0]?.organization_scope
    ? "organization"
    : result.rows[0]?.province_scope
      ? "province"
      : "self";
}

type Scope = "organization" | "province" | "self";
type Row = Record<string, unknown>;
type Input = Record<string, unknown>;
type EventResource = Exclude<PigResource, "pens" | "groups" | "animals">;

interface EventConfig {
  table: string;
  dateColumn: string;
  penColumn: string;
  status?: boolean;
  group?: boolean;
  animal?: boolean;
}

const snake = (name: string) =>
  name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const camel = (name: string) =>
  name.replace(/_([a-z0-9])/g, (_, character: string) =>
    character.toUpperCase(),
  );
const locationColumns =
  "s.id AS site_id, s.code AS site_code, s.name AS site_name, " +
  "pr.id AS province_id, pr.code AS province_code, pr.name AS province_name";
const penColumns =
  "p.id AS pen_id, p.code AS pen_code, p.name AS pen_name, " +
  "p.pen_type AS pen_type, " +
  locationColumns;

function mapRow(row: Row): Row {
  const mapped: Row = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [camel(key), value]),
  );
  const numeric = [
    "capacity",
    "initialCount",
    "openingCount",
    "birthsCount",
    "purchasesCount",
    "transfersInCount",
    "transfersOutCount",
    "cullsCount",
    "mortalityCount",
    "closingCount",
    "quantityKg",
    "bagCount",
    "volumeLiters",
    "sampleSize",
    "averageWeightKg",
    "minimumWeightKg",
    "maximumWeightKg",
    "bodyConditionScore",
    "headCount",
    "deathCount",
    "quantity",
    "totalBornCount",
    "liveBornCount",
    "stillbornCount",
    "mummifiedCount",
    "fosteredInCount",
    "fosteredOutCount",
    "pigletCount",
    "femaleCount",
    "maleCount",
    "unknownSexCount",
    "averageBirthWeightKg",
    "animalsAffected",
    "activeGroups",
    "activeAnimals",
    "confirmedPregnancies",
    "activeQuarantines",
    "mortalityLast30Days",
    "feedKgLast30Days",
  ];
  for (const field of numeric)
    if (mapped[field] != null) mapped[field] = Number(mapped[field]);
  const dates = [
    "arrivalDate",
    "birthDate",
    "removedAt",
    "recordDate",
    "feedDate",
    "waterDate",
    "movementDate",
    "mortalityDate",
    "lossDate",
    "breedingDate",
    "expectedFarrowingDate",
    "confirmedDate",
    "farrowingDate",
    "vaccinationDate",
    "nextDueDate",
    "treatmentDate",
    "endDate",
    "withdrawalEndDate",
    "startDate",
    "visitDate",
    "followUpDate",
    "closedAt",
  ];
  for (const field of dates)
    if (mapped[field] instanceof Date)
      mapped[field] = (mapped[field] as Date).toISOString().slice(0, 10);
  if (mapped.siteId)
    mapped.site = {
      id: mapped.siteId,
      code: mapped.siteCode,
      name: mapped.siteName,
    };
  if (mapped.provinceId)
    mapped.province = {
      id: mapped.provinceId,
      code: mapped.provinceCode,
      name: mapped.provinceName,
    };
  if (mapped.penId)
    mapped.pen = {
      id: mapped.penId,
      code: mapped.penCode,
      name: mapped.penName,
      type: mapped.penType,
    };
  return mapped;
}

async function assertProvince(
  client: PoolClient,
  context: PigContext,
  provinceId: string,
): Promise<void> {
  if ((await scopeOf(client, context)) === "organization") return;
  const allowed = await client.query(
    "SELECT 1 FROM member_provinces WHERE organization_id = $1 AND member_id = $2 AND province_id = $3",
    [context.organizationId, context.memberId, provinceId],
  );
  if (!allowed.rowCount) throw new NotFoundError("Pig record not found");
}
function scopeSql(
  scope: Scope,
  context: PigContext,
  provinceColumn: string,
  values: unknown[],
): string {
  if (scope === "organization") return "TRUE";
  if (scope === "self") return "FALSE";
  values.push(context.memberId);
  return `EXISTS (SELECT 1 FROM member_provinces mp WHERE mp.organization_id = $1 AND mp.member_id = $${values.length} AND mp.province_id = ${provinceColumn})`;
}
async function pen(
  client: PoolClient,
  context: PigContext,
  id: string,
): Promise<Row> {
  const result = await client.query<Row>(
    `SELECT p.*, ${locationColumns} FROM pig_pens p JOIN sites s ON s.organization_id = p.organization_id AND s.id = p.site_id JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id WHERE p.organization_id = $1 AND p.id = $2`,
    [context.organizationId, id],
  );
  const row = result.rows[0];
  if (!row || (await scopeOf(client, context)) === "self")
    throw new NotFoundError("Pig pen not found");
  await assertProvince(client, context, String(row.province_id));
  return row;
}
async function group(
  client: PoolClient,
  context: PigContext,
  id: string,
): Promise<Row> {
  const result = await client.query<Row>(
    `SELECT g.*, ${penColumns} FROM pig_groups g JOIN pig_pens p ON p.organization_id = g.organization_id AND p.id = g.pen_id JOIN sites s ON s.organization_id = p.organization_id AND s.id = p.site_id JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id WHERE g.organization_id = $1 AND g.id = $2`,
    [context.organizationId, id],
  );
  const row = result.rows[0];
  if (!row || (await scopeOf(client, context)) === "self")
    throw new NotFoundError("Pig group not found");
  await assertProvince(client, context, String(row.province_id));
  return row;
}
async function animal(
  client: PoolClient,
  context: PigContext,
  id: string,
): Promise<Row> {
  const result = await client.query<Row>(
    `SELECT a.*, ${penColumns} FROM pig_animals a JOIN pig_pens p ON p.organization_id = a.organization_id AND p.id = a.pen_id JOIN sites s ON s.organization_id = p.organization_id AND s.id = p.site_id JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id WHERE a.organization_id = $1 AND a.id = $2`,
    [context.organizationId, id],
  );
  const row = result.rows[0];
  if (!row || (await scopeOf(client, context)) === "self")
    throw new NotFoundError("Pig animal not found");
  await assertProvince(client, context, String(row.province_id));
  return row;
}
function idOf(input: Input, key: string): string | null {
  return typeof input[key] === "string" && input[key]
    ? String(input[key])
    : null;
}
async function assertRelated(
  client: PoolClient,
  context: PigContext,
  input: Input,
  needsPen = true,
): Promise<void> {
  const penId = idOf(input, "penId");
  if (needsPen && !penId) throw new BadRequestError("A pig pen is required");
  if (penId) await pen(client, context, penId);
  const groupId = idOf(input, "groupId");
  if (groupId) {
    const row = await group(client, context, groupId);
    if (penId && row.pen_id !== penId)
      throw new BadRequestError(
        "The pig group must belong to the selected pen",
      );
  }
  const animalId = idOf(input, "animalId");
  if (animalId) {
    const row = await animal(client, context, animalId);
    if (penId && row.pen_id !== penId)
      throw new BadRequestError(
        "The pig animal must belong to the selected pen",
      );
  }
}

function tableFor(resource: PigResource): string {
  if (resource === "pens") return "pig_pens";
  if (resource === "groups") return "pig_groups";
  if (resource === "animals") return "pig_animals";
  return events[resource].table;
}
function isEvent(resource: PigResource): resource is EventResource {
  return resource !== "pens" && resource !== "groups" && resource !== "animals";
}
function inputColumns(input: Input): { columns: string[]; values: unknown[] } {
  const entries = Object.entries(input).filter(
    ([, value]) => value !== undefined,
  );
  return {
    columns: entries.map(([key]) => snake(key)),
    values: entries.map(([, value]) => value),
  };
}

async function assertSpecialRelations(
  client: PoolClient,
  context: PigContext,
  resource: PigResource,
  input: Input,
): Promise<void> {
  if (resource === "movements") {
    const from = idOf(input, "fromPenId");
    const to = idOf(input, "toPenId");
    if (!from || !to)
      throw new BadRequestError(
        "Both source and destination pens are required",
      );
    await pen(client, context, from);
    await pen(client, context, to);
    const subject = idOf(input, "animalId") ?? idOf(input, "groupId");
    if (!subject)
      throw new BadRequestError("A pig animal or group is required");
    const row = idOf(input, "animalId")
      ? await animal(client, context, subject)
      : await group(client, context, subject);
    if (row.pen_id !== from)
      throw new BadRequestError(
        "The animal or group must be in the source pen",
      );
    return;
  }
  if (resource === "breeding") {
    await assertRelated(client, context, input);
    const female = await animal(client, context, String(input.femaleAnimalId));
    if (female.sex !== "female")
      throw new BadRequestError("The breeding female must be a sow or gilt");
    const maleId = idOf(input, "maleAnimalId");
    if (maleId) {
      const male = await animal(client, context, maleId);
      if (male.sex !== "male")
        throw new BadRequestError("The breeding male must be a boar");
    }
    return;
  }
  if (resource === "pregnancies" || resource === "farrowing") {
    await assertRelated(client, context, input);
    const sow = await animal(client, context, String(input.sowAnimalId));
    if (sow.sex !== "female")
      throw new BadRequestError("The sow must be a female animal");
    return;
  }
  if (resource === "piglets") {
    await assertRelated(client, context, input);
    return;
  }
  if (resource === "pens") {
    const result = await client.query<Row>(
      `SELECT s.province_id FROM sites s WHERE s.organization_id = $1 AND s.id = $2`,
      [context.organizationId, input.siteId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError("Site not found");
    await assertProvince(client, context, String(row.province_id));
    return;
  }
  if (resource === "groups" || resource === "animals") {
    await assertRelated(client, context, input);
    return;
  }
  await assertRelated(client, context, input);
}

async function details(
  client: PoolClient,
  context: PigContext,
  resource: PigResource,
  id: string,
): Promise<Row> {
  let result;
  if (resource === "pens") {
    result = await client.query<Row>(
      `SELECT p.*, ${locationColumns} FROM pig_pens p JOIN sites s ON s.organization_id = p.organization_id AND s.id = p.site_id JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id WHERE p.organization_id = $1 AND p.id = $2`,
      [context.organizationId, id],
    );
  } else if (resource === "groups") {
    result = await client.query<Row>(
      `SELECT g.*, ${penColumns} FROM pig_groups g JOIN pig_pens p ON p.organization_id = g.organization_id AND p.id = g.pen_id JOIN sites s ON s.organization_id = p.organization_id AND s.id = p.site_id JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id WHERE g.organization_id = $1 AND g.id = $2`,
      [context.organizationId, id],
    );
  } else if (resource === "animals") {
    result = await client.query<Row>(
      `SELECT a.*, ${penColumns} FROM pig_animals a JOIN pig_pens p ON p.organization_id = a.organization_id AND p.id = a.pen_id JOIN sites s ON s.organization_id = p.organization_id AND s.id = p.site_id JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id WHERE a.organization_id = $1 AND a.id = $2`,
      [context.organizationId, id],
    );
  } else {
    const config = events[resource];
    result = await client.query<Row>(
      `SELECT r.*, ${penColumns} FROM ${config.table} r JOIN pig_pens p ON p.organization_id = r.organization_id AND p.id = r.${config.penColumn} JOIN sites s ON s.organization_id = p.organization_id AND s.id = p.site_id JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id WHERE r.organization_id = $1 AND r.id = $2`,
      [context.organizationId, id],
    );
  }
  const row = result.rows[0];
  if (!row || (await scopeOf(client, context)) === "self")
    throw new NotFoundError("Pig record not found");
  await assertProvince(client, context, String(row.province_id));
  return row;
}

async function sideEffects(
  client: PoolClient,
  context: PigContext,
  resource: PigResource,
  input: Input,
): Promise<void> {
  if (resource === "movements") {
    const target = String(input.toPenId);
    if (idOf(input, "animalId"))
      await client.query(
        "UPDATE pig_animals SET pen_id = $3 WHERE organization_id = $1 AND id = $2",
        [context.organizationId, input.animalId, target],
      );
    if (idOf(input, "groupId"))
      await client.query(
        "UPDATE pig_groups SET pen_id = $3 WHERE organization_id = $1 AND id = $2",
        [context.organizationId, input.groupId, target],
      );
  }
  if (resource === "mortality" && idOf(input, "animalId"))
    await client.query(
      "UPDATE pig_animals SET status = 'deceased', removed_at = $3 WHERE organization_id = $1 AND id = $2",
      [context.organizationId, input.animalId, input.mortalityDate],
    );
  if (resource === "pregnancies" && input.status === "confirmed")
    await client.query(
      "UPDATE pig_animals SET status = 'pregnant' WHERE organization_id = $1 AND id = $2",
      [context.organizationId, input.sowAnimalId],
    );
  if (resource === "farrowing") {
    await client.query(
      "UPDATE pig_animals SET status = 'lactating' WHERE organization_id = $1 AND id = $2",
      [context.organizationId, input.sowAnimalId],
    );
    if (idOf(input, "pregnancyId"))
      await client.query(
        "UPDATE pig_pregnancies SET status = 'farrowed' WHERE organization_id = $1 AND id = $2",
        [context.organizationId, input.pregnancyId],
      );
  }
  if (resource === "quarantine" && idOf(input, "animalId"))
    await client.query(
      "UPDATE pig_animals SET status = $3 WHERE organization_id = $1 AND id = $2",
      [
        context.organizationId,
        input.animalId,
        input.status === "active" ? "quarantined" : "active",
      ],
    );
}

function duplicate(error: unknown, label: string): never {
  if ((error as { code?: string }).code === "23505")
    throw new ConflictError(`${label} already exists`);
  throw error;
}

function listFrom(resource: PigResource): { from: string; penId: string } {
  if (resource === "pens")
    return {
      from: "pig_pens r JOIN sites s ON s.organization_id = r.organization_id AND s.id = r.site_id JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id",
      penId: "r.id",
    };
  if (resource === "groups")
    return {
      from: "pig_groups r JOIN pig_pens p ON p.organization_id = r.organization_id AND p.id = r.pen_id JOIN sites s ON s.organization_id = p.organization_id AND s.id = p.site_id JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id",
      penId: "p.id",
    };
  if (resource === "animals")
    return {
      from: "pig_animals r JOIN pig_pens p ON p.organization_id = r.organization_id AND p.id = r.pen_id JOIN sites s ON s.organization_id = p.organization_id AND s.id = p.site_id JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id",
      penId: "p.id",
    };
  const config = events[resource];
  return {
    from: `${config.table} r JOIN pig_pens p ON p.organization_id = r.organization_id AND p.id = r.${config.penColumn} JOIN sites s ON s.organization_id = p.organization_id AND s.id = p.site_id JOIN provinces pr ON pr.organization_id = s.organization_id AND pr.id = s.province_id`,
    penId: "p.id",
  };
}

export async function listPigRecords(
  context: PigContext,
  resource: PigResource,
  query: PigListQuery,
): Promise<Row[]> {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context);
    const values: unknown[] = [context.organizationId];
    const source = listFrom(resource);
    const where = [
      `r.organization_id = $1`,
      scopeSql(scope, context, "pr.id", values),
    ];
    if (query.siteId) {
      values.push(query.siteId);
      where.push(`s.id = $${values.length}`);
    }
    if (query.penId) {
      values.push(query.penId);
      where.push(`${source.penId} = $${values.length}`);
    }
    if (query.groupId) {
      if (resource === "groups") {
        values.push(query.groupId);
        where.push(`r.id = $${values.length}`);
      } else if (
        resource === "animals" ||
        (isEvent(resource) && events[resource].group)
      ) {
        values.push(query.groupId);
        where.push(`r.group_id = $${values.length}`);
      }
    }
    if (query.animalId && isEvent(resource) && events[resource].animal) {
      values.push(query.animalId);
      where.push(`r.animal_id = $${values.length}`);
    }
    const config = isEvent(resource) ? events[resource] : null;
    if (
      query.status &&
      (resource === "groups" || resource === "animals" || config?.status)
    ) {
      values.push(query.status);
      where.push(`r.status = $${values.length}`);
    }
    if (query.date && config) {
      values.push(query.date);
      where.push(`r.${config.dateColumn} = $${values.length}`);
    }
    if (query.from && config) {
      values.push(query.from);
      where.push(`r.${config.dateColumn} >= $${values.length}`);
    }
    if (query.to && config) {
      values.push(query.to);
      where.push(`r.${config.dateColumn} <= $${values.length}`);
    }
    const order = config
      ? `r.${config.dateColumn} DESC, r.created_at DESC`
      : "r.created_at DESC";
    const result = await client.query<Row>(
      `SELECT r.*, ${resource === "pens" ? locationColumns : penColumns} FROM ${source.from} WHERE ${where.join(" AND ")} ORDER BY ${order}`,
      values,
    );
    return result.rows.map(mapRow);
  });
}

export async function getPigRecord(
  context: PigContext,
  resource: PigResource,
  recordId: string,
): Promise<Row> {
  return withTenantContext(context, async (client) =>
    mapRow(await details(client, context, resource, recordId)),
  );
}

export async function createPigRecord(
  context: PigContext,
  resource: PigResource,
  input: Input,
): Promise<Row> {
  return withTenantContext(context, async (client) => {
    await assertSpecialRelations(client, context, resource, input);
    const { columns, values } = inputColumns(input);
    const event = isEvent(resource);
    if (event) {
      columns.push("recorded_by_user_id");
      values.push(context.userId);
    }
    const allColumns = ["organization_id", ...columns];
    const allValues = [context.organizationId, ...values];
    const placeholders = allValues
      .map((_, index) => `$${index + 1}`)
      .join(", ");
    let created;
    try {
      created = await client.query<{ id: string }>(
        `INSERT INTO ${tableFor(resource)} (${allColumns.join(", ")}) VALUES (${placeholders}) RETURNING id`,
        allValues,
      );
    } catch (error) {
      duplicate(
        error,
        resource === "animals"
          ? "Pig animal number or ear tag"
          : `Pig ${resource.slice(0, -1)}`,
      );
    }
    const id = created.rows[0]!.id;
    await sideEffects(client, context, resource, input);
    return mapRow(await details(client, context, resource, id));
  });
}

export async function updatePigRecord(
  context: PigContext,
  resource: PigResource,
  recordId: string,
  input: Input,
): Promise<Row> {
  return withTenantContext(context, async (client) => {
    const existing = await details(client, context, resource, recordId);
    const merged: Input = Object.fromEntries(
      Object.entries(existing).map(([key, value]) => [camel(key), value]),
    );
    Object.assign(merged, input);
    if (
      Object.keys(input).some((key) =>
        [
          "penId",
          "siteId",
          "groupId",
          "animalId",
          "fromPenId",
          "toPenId",
          "femaleAnimalId",
          "maleAnimalId",
          "sowAnimalId",
        ].includes(key),
      )
    )
      await assertSpecialRelations(client, context, resource, merged);
    const { columns, values } = inputColumns(input);
    const assignments = columns
      .map((column, index) => `${column} = $${index + 3}`)
      .join(", ");
    try {
      await client.query(
        `UPDATE ${tableFor(resource)} SET ${assignments} WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, recordId, ...values],
      );
    } catch (error) {
      duplicate(error, "Pig record");
    }
    await sideEffects(client, context, resource, merged);
    return mapRow(await details(client, context, resource, recordId));
  });
}

export async function deletePigRecord(
  context: PigContext,
  resource: PigResource,
  recordId: string,
): Promise<void> {
  await withTenantContext(context, async (client) => {
    await details(client, context, resource, recordId);
    const result = await client.query(
      `DELETE FROM ${tableFor(resource)} WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, recordId],
    );
    if (!result.rowCount) throw new NotFoundError("Pig record not found");
  });
}

export async function pigOverview(
  context: PigContext,
  query: PigOverviewQuery,
): Promise<Row> {
  const pens = await listPigRecords(context, "pens", { siteId: query.siteId });
  const penIds = pens.map((item) => String(item.id));
  if (!penIds.length)
    return {
      pens: 0,
      activeGroups: 0,
      activeAnimals: 0,
      confirmedPregnancies: 0,
      activeQuarantines: 0,
      mortalityLast30Days: 0,
      feedKgLast30Days: 0,
    };
  return withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      `SELECT
        $2::int AS pens,
        (SELECT count(*) FROM pig_groups WHERE organization_id = $1 AND pen_id = ANY($3::uuid[]) AND status = 'active') AS active_groups,
        (SELECT count(*) FROM pig_animals WHERE organization_id = $1 AND pen_id = ANY($3::uuid[]) AND status IN ('active', 'pregnant', 'lactating', 'quarantined')) AS active_animals,
        (SELECT count(*) FROM pig_pregnancies WHERE organization_id = $1 AND pen_id = ANY($3::uuid[]) AND status IN ('suspected', 'confirmed')) AS confirmed_pregnancies,
        (SELECT count(*) FROM pig_quarantine_records WHERE organization_id = $1 AND pen_id = ANY($3::uuid[]) AND status = 'active') AS active_quarantines,
        (SELECT COALESCE(sum(death_count), 0) FROM pig_mortality_records WHERE organization_id = $1 AND pen_id = ANY($3::uuid[]) AND mortality_date >= current_date - interval '30 days') AS mortality_last_30_days,
        (SELECT COALESCE(sum(quantity_kg), 0) FROM pig_feed_records WHERE organization_id = $1 AND pen_id = ANY($3::uuid[]) AND feed_date >= current_date - interval '30 days') AS feed_kg_last_30_days`,
      [context.organizationId, penIds.length, penIds],
    );
    return mapRow(result.rows[0] ?? {});
  });
}
