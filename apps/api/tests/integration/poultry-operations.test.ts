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
const ownerEmail = `poultry-owner-${suffix}@test.invalid`;
const supervisorEmail = `poultry-supervisor-${suffix}@test.invalid`;
const organizationSlug = `poultry-congo-${suffix}`;
const workDate = "2026-08-25";

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

afterAll(async () => {
  await cleanUp(ownerEmail);
  await cleanUp(supervisorEmail);
});

describe("Poultry operations", () => {
  it("tracks mortality deeply and protects a provincial supervisor from other farms", async () => {
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({
        fullName: "Poultry Owner",
        email: ownerEmail,
        password: PASSWORD,
        organization: {
          slug: organizationSlug,
          legalName: "Poultry Test Congo SARL",
          displayName: "Poultry Test Congo",
          industryCode: "mixed_farm",
          country: "CD",
          currency: "CDF",
        },
      });
    expect(registered.status).toBe(201);
    const ownerToken = registered.body.accessToken as string;
    const owner = (call: request.Test) =>
      call.set("Authorization", `Bearer ${ownerToken}`);
    const postOwner = (path: string, body: object) =>
      owner(request(app).post(path).send(body));

    const kinshasa = await postOwner(
      `/api/v1/organizations/${organizationSlug}/provinces`,
      { code: "kinshasa", name: "Kinshasa" },
    );
    const kongo = await postOwner(
      `/api/v1/organizations/${organizationSlug}/provinces`,
      { code: "kongo_central", name: "Kongo Central" },
    );
    expect(kinshasa.status).toBe(201);
    expect(kongo.status).toBe(201);

    const kinshasaFarm = await postOwner(
      `/api/v1/organizations/${organizationSlug}/sites`,
      {
        provinceId: kinshasa.body.province.id,
        code: "kinshasa_farm",
        name: "Kinshasa Farm",
        siteType: "farm",
      },
    );
    const kongoFarm = await postOwner(
      `/api/v1/organizations/${organizationSlug}/sites`,
      {
        provinceId: kongo.body.province.id,
        code: "kongo_farm",
        name: "Kongo Farm",
        siteType: "farm",
      },
    );
    expect(kinshasaFarm.status).toBe(201);
    expect(kongoFarm.status).toBe(201);

    const invitation = await postOwner(
      `/api/v1/organizations/${organizationSlug}/invitations`,
      {
        email: supervisorEmail,
        roleCodes: ["poultry_supervisor"],
        provinceIds: [kinshasa.body.province.id],
        jobTitle: "Poultry Supervisor",
      },
    );
    expect(invitation.status).toBe(201);
    const invitationToken = new URL(invitation.body.acceptUrl).searchParams.get(
      "token",
    );
    const accepted = await request(app)
      .post("/api/v1/auth/accept-invitation")
      .send({
        token: invitationToken,
        fullName: "Kinshasa Poultry Supervisor",
        email: supervisorEmail,
        password: PASSWORD,
      });
    expect(accepted.status).toBe(201);
    const supervisorToken = accepted.body.accessToken as string;
    const supervisor = (call: request.Test) =>
      call.set("Authorization", `Bearer ${supervisorToken}`);
    const poultryPath = (resource: string) =>
      `/api/v1/organizations/${organizationSlug}/poultry/${resource}`;

    const house = await postOwner(poultryPath("houses"), {
      siteId: kinshasaFarm.body.site.id,
      code: "house_a",
      name: "House A",
      houseType: "broiler",
      capacity: 500,
    });
    expect(house.status).toBe(201);
    const flock = await postOwner(poultryPath("flocks"), {
      houseId: house.body.record.id,
      code: "broiler_a",
      name: "Broiler A",
      birdType: "broiler",
      arrivalDate: workDate,
      initialBirdCount: 100,
      mortalityReviewThreshold: 2,
    });
    expect(flock.status).toBe(201);

    const outsideHouse = await postOwner(poultryPath("houses"), {
      siteId: kongoFarm.body.site.id,
      code: "house_kongo",
      name: "House Kongo",
      houseType: "broiler",
      capacity: 300,
    });
    const outsideFlock = await postOwner(poultryPath("flocks"), {
      houseId: outsideHouse.body.record.id,
      code: "broiler_kongo",
      name: "Broiler Kongo",
      birdType: "broiler",
      arrivalDate: workDate,
      initialBirdCount: 80,
    });
    expect(outsideFlock.status).toBe(201);

    const visibleFlocks = await supervisor(
      request(app).get(poultryPath("flocks")),
    );
    expect(visibleFlocks.status).toBe(200);
    expect(visibleFlocks.body.records).toHaveLength(1);
    expect(visibleFlocks.body.records[0].id).toBe(flock.body.record.id);

    const mortality = await supervisor(
      request(app).post(poultryPath("mortality")).send({
        flockId: flock.body.record.id,
        mortalityDate: workDate,
        deathCount: 3,
        causeCategory: "disease",
        suspectedCause: "Respiratory signs observed",
        clinicalSigns: "Coughing and low activity",
        postmortemStatus: "pending",
        disposalMethod: "incineration",
        requiresFollowUp: true,
        followUpStatus: "pending",
        followUpNotes: "Supervisor requested veterinary review",
      }),
    );
    expect(mortality.status).toBe(201);
    expect(mortality.body.record).toEqual(
      expect.objectContaining({
        deathCount: 3,
        dailyMortalityCount: 3,
        requiresDailyReview: true,
        followUpStatus: "pending",
      }),
    );

    const blockedMortality = await supervisor(
      request(app).post(poultryPath("mortality")).send({
        flockId: outsideFlock.body.record.id,
        mortalityDate: workDate,
        deathCount: 1,
      }),
    );
    expect(blockedMortality.status).toBe(404);

    const daily = await supervisor(
      request(app).post(poultryPath("daily-records")).send({
        flockId: flock.body.record.id,
        recordDate: workDate,
        liveBirdCount: 97,
      }),
    );
    expect(daily.status).toBe(201);
    expect(daily.body.record.mortalityCount).toBe(3);

    const recordBodies: Array<[string, object]> = [
      [
        "feed",
        {
          flockId: flock.body.record.id,
          feedDate: workDate,
          feedName: "Starter Feed",
          feedStage: "starter",
          quantityKg: 25,
        },
      ],
      [
        "water",
        {
          flockId: flock.body.record.id,
          waterDate: workDate,
          volumeLiters: 120,
        },
      ],
      [
        "weights",
        {
          flockId: flock.body.record.id,
          recordDate: workDate,
          sampleSize: 20,
          averageWeightG: 850,
          minimumWeightG: 700,
          maximumWeightG: 1000,
          uniformityPercent: 92,
        },
      ],
      [
        "health",
        {
          flockId: flock.body.record.id,
          recordDate: workDate,
          eventType: "suspected_disease",
          severity: "high",
          birdsAffected: 3,
          symptoms: "Coughing",
          status: "monitoring",
        },
      ],
      [
        "vaccinations",
        {
          flockId: flock.body.record.id,
          vaccinationDate: workDate,
          vaccineName: "Newcastle Vaccine",
          dose: "As prescribed",
          nextDueDate: "2026-09-25",
        },
      ],
      [
        "treatments",
        {
          flockId: flock.body.record.id,
          treatmentDate: workDate,
          productName: "Support Treatment",
          reason: "Veterinary instruction",
          dosage: "As prescribed",
          withdrawalEndDate: "2026-08-30",
        },
      ],
      [
        "sanitation",
        {
          houseId: house.body.record.id,
          sanitationDate: workDate,
          activityType: "disinfection",
          status: "completed",
        },
      ],
      [
        "biosecurity",
        {
          houseId: house.body.record.id,
          recordDate: workDate,
          checkType: "footbath",
          complianceStatus: "compliant",
          riskLevel: "low",
        },
      ],
      [
        "production-targets",
        {
          flockId: flock.body.record.id,
          metric: "mortality_percent",
          targetValue: 1,
          effectiveFrom: workDate,
        },
      ],
      [
        "losses",
        {
          flockId: flock.body.record.id,
          lossDate: workDate,
          lossType: "egg_breakage",
          quantity: 2,
          unit: "eggs",
          description: "Two cracked eggs during collection",
        },
      ],
    ];
    for (const [resource, body] of recordBodies) {
      const created = await supervisor(
        request(app).post(poultryPath(resource)).send(body),
      );
      expect(created.status, resource).toBe(201);
    }

    const corrected = await supervisor(
      request(app)
        .patch(`${poultryPath("mortality")}/${mortality.body.record.id}`)
        .send({
          confirmedDiagnosis: "Confirmed by veterinary review",
          followUpStatus: "resolved",
        }),
    );
    expect(corrected.status).toBe(200);
    expect(corrected.body.record.followUpStatus).toBe("resolved");

    const overview = await supervisor(
      request(app).get(
        `${poultryPath("overview")}?from=${workDate}&to=${workDate}`,
      ),
    );
    expect(overview.status).toBe(200);
    expect(overview.body.overview.totals).toEqual(
      expect.objectContaining({
        activeFlocks: 1,
        mortalityCount: 3,
        feedKg: 25,
        waterLiters: 120,
      }),
    );

    const mortalityList = await supervisor(
      request(app).get(
        `${poultryPath("mortality")}?flockId=${flock.body.record.id}&date=${workDate}`,
      ),
    );
    expect(mortalityList.status).toBe(200);
    expect(mortalityList.body.records).toHaveLength(1);
  });
});
