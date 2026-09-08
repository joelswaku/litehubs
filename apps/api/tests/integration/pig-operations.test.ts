import { randomUUID } from "node:crypto";
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
const PASSWORD = "SecurePass123";
const ownerEmail = `pig-owner-${suffix}@test.invalid`;
const organizationSlug = `pig-congo-${suffix}`;
const workDate = "2026-08-26";

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

describe("Pig operations", () => {
  it("records production, breeding and health from pen to piglet", async () => {
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({
        fullName: "Pig Operations Owner",
        email: ownerEmail,
        password: PASSWORD,
        organization: {
          slug: organizationSlug,
          legalName: "Pig Operations Congo SARL",
          displayName: "Pig Operations Congo",
          industryCode: "mixed_farm",
          country: "CD",
          currency: "CDF",
        },
      });
    expect(registered.status).toBe(201);
    const owner = (call: request.Test) =>
      call.set(
        "Authorization",
        `Bearer ${registered.body.accessToken as string}`,
      );
    const post = (resource: string, body: object) =>
      owner(
        request(app)
          .post(`/api/v1/organizations/${organizationSlug}/pigs/${resource}`)
          .send(body),
      );

    const province = await owner(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/provinces`)
        .send({ code: "kinshasa", name: "Kinshasa" }),
    );
    const site = await owner(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/sites`)
        .send({
          provinceId: province.body.province.id,
          code: "pig_farm",
          name: "Pig Farm",
          siteType: "farm",
        }),
    );
    expect(site.status).toBe(201);

    const gestation = await post("pens", {
      siteId: site.body.site.id,
      code: "gestation_a",
      name: "Gestation A",
      penType: "gestation",
      capacity: 30,
    });
    const farrowing = await post("pens", {
      siteId: site.body.site.id,
      code: "farrowing_a",
      name: "Farrowing A",
      penType: "farrowing",
      capacity: 12,
    });
    expect(gestation.status).toBe(201);
    expect(farrowing.status).toBe(201);

    const group = await post("groups", {
      penId: gestation.body.record.id,
      code: "gilts_a",
      name: "Gilts A",
      productionStage: "breeding",
      sex: "female",
      initialCount: 5,
    });
    const sow = await post("animals", {
      penId: gestation.body.record.id,
      groupId: group.body.record.id,
      animalNumber: "SOW-0001",
      earTag: "EA-001",
      sex: "female",
      animalType: "sow",
      birthDate: "2025-01-10",
    });
    const boar = await post("animals", {
      penId: gestation.body.record.id,
      animalNumber: "BOAR-0001",
      earTag: "EB-001",
      sex: "male",
      animalType: "boar",
      birthDate: "2024-10-10",
    });
    expect(sow.status).toBe(201);
    expect(boar.status).toBe(201);

    const daily = await post("daily-records", {
      penId: gestation.body.record.id,
      groupId: group.body.record.id,
      recordDate: workDate,
      openingCount: 5,
      closingCount: 5,
    });
    expect(daily.status).toBe(201);

    const basicBodies: Array<[string, object]> = [
      [
        "feed",
        {
          penId: gestation.body.record.id,
          groupId: group.body.record.id,
          feedDate: workDate,
          feedName: "Gestation Feed",
          feedStage: "gestation",
          quantityKg: 25,
        },
      ],
      [
        "water",
        {
          penId: gestation.body.record.id,
          groupId: group.body.record.id,
          waterDate: workDate,
          volumeLiters: 90,
        },
      ],
      [
        "weights",
        {
          penId: gestation.body.record.id,
          animalId: sow.body.record.id,
          recordDate: workDate,
          sampleSize: 1,
          averageWeightKg: 182.5,
          bodyConditionScore: 3.5,
        },
      ],
      [
        "health",
        {
          penId: gestation.body.record.id,
          animalId: sow.body.record.id,
          recordDate: workDate,
          eventType: "observation",
          animalsAffected: 1,
          status: "monitoring",
        },
      ],
      [
        "vaccinations",
        {
          penId: gestation.body.record.id,
          groupId: group.body.record.id,
          vaccinationDate: workDate,
          vaccineName: "Parvovirus Vaccine",
          nextDueDate: "2026-11-26",
        },
      ],
      [
        "treatments",
        {
          penId: gestation.body.record.id,
          animalId: sow.body.record.id,
          treatmentDate: workDate,
          productName: "Iron Support",
          reason: "Preventive care",
        },
      ],
      [
        "veterinary",
        {
          penId: gestation.body.record.id,
          animalId: sow.body.record.id,
          visitDate: workDate,
          visitType: "routine",
          veterinarianName: "Dr. Kabasele",
          status: "open",
        },
      ],
      [
        "losses",
        {
          penId: gestation.body.record.id,
          lossDate: workDate,
          lossType: "feed_spoilage",
          quantity: 2,
          unit: "kg",
          description: "Damaged feed bag",
        },
      ],
    ];
    for (const [resource, body] of basicBodies) {
      const response = await post(resource, body);
      expect(response.status).toBe(201);
    }

    const breeding = await post("breeding", {
      penId: gestation.body.record.id,
      femaleAnimalId: sow.body.record.id,
      maleAnimalId: boar.body.record.id,
      breedingDate: workDate,
      breedingMethod: "natural",
      expectedFarrowingDate: "2026-12-20",
    });
    expect(breeding.status).toBe(201);
    const pregnancy = await post("pregnancies", {
      penId: gestation.body.record.id,
      sowAnimalId: sow.body.record.id,
      breedingId: breeding.body.record.id,
      confirmedDate: "2026-09-20",
      confirmationMethod: "ultrasound",
      expectedFarrowingDate: "2026-12-20",
    });
    expect(pregnancy.status).toBe(201);

    const move = await post("movements", {
      movementDate: "2026-12-19",
      animalId: sow.body.record.id,
      fromPenId: gestation.body.record.id,
      toPenId: farrowing.body.record.id,
      movementType: "internal",
    });
    expect(move.status).toBe(201);

    const farrow = await post("farrowing", {
      penId: farrowing.body.record.id,
      sowAnimalId: sow.body.record.id,
      pregnancyId: pregnancy.body.record.id,
      farrowingDate: "2026-12-20",
      totalBornCount: 12,
      liveBornCount: 10,
      stillbornCount: 1,
      mummifiedCount: 1,
    });
    expect(farrow.status).toBe(201);
    const piglets = await post("piglets", {
      penId: farrowing.body.record.id,
      farrowingId: farrow.body.record.id,
      recordDate: "2026-12-20",
      pigletCount: 10,
      femaleCount: 5,
      maleCount: 5,
      unknownSexCount: 0,
      averageBirthWeightKg: 1.4,
    });
    expect(piglets.status).toBe(201);

    const quarantine = await post("quarantine", {
      penId: farrowing.body.record.id,
      animalId: sow.body.record.id,
      startDate: "2026-12-21",
      reason: "Post-farrowing observation",
    });
    expect(quarantine.status).toBe(201);
    const mortality = await post("mortality", {
      penId: farrowing.body.record.id,
      mortalityDate: "2026-12-21",
      deathCount: 1,
      causeCategory: "crushing",
    });
    expect(mortality.status).toBe(201);

    const animals = await owner(
      request(app).get(
        `/api/v1/organizations/${organizationSlug}/pigs/animals`,
      ),
    );
    expect(animals.status).toBe(200);
    expect(
      animals.body.records.find(
        (item: { id: string }) => item.id === sow.body.record.id,
      ).pen.id,
    ).toBe(farrowing.body.record.id);

    const overview = await owner(
      request(app).get(
        `/api/v1/organizations/${organizationSlug}/pigs/overview`,
      ),
    );
    expect(overview.status).toBe(200);
    expect(overview.body.overview.pens).toBe(2);
    expect(overview.body.overview.mortalityLast30Days).toBeGreaterThanOrEqual(
      1,
    );
  });
});
