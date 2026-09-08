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
const ownerEmail = `performance-owner-${suffix}@test.invalid`;
const organizationSlug = `performance-congo-${suffix}`;
const workDate = "2026-08-25";

afterAll(async () => {
  const found = await query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1",
    [ownerEmail],
  );
  const userId = found.rows[0]?.id;
  if (userId) {
    const organizationIds = await withUserContext(userId, async (client) => {
      const result = await client.query<{ organization_id: string }>(
        "SELECT organization_id FROM organization_members WHERE user_id = $1",
        [userId],
      );
      return result.rows.map((item) => item.organization_id);
    });
    for (const organizationId of organizationIds) {
      await withTenantContext({ userId, organizationId }, (client) =>
        client.query("DELETE FROM organizations WHERE id = $1", [
          organizationId,
        ]),
      );
    }
    await query("DELETE FROM users WHERE id = $1", [userId]);
  }
});

describe("Poultry performance models", () => {
  it("uses a company model and climate profile to calculate work, feed, mortality, egg rejection and vaccines", async () => {
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({
        fullName: "Performance Owner",
        email: ownerEmail,
        password: PASSWORD,
        organization: {
          slug: organizationSlug,
          legalName: "Performance Congo SARL",
          displayName: "Performance Congo",
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
    const post = (path: string, body: object) =>
      owner(request(app).post(path).send(body));
    const base = `/api/v1/organizations/${organizationSlug}`;

    const province = await post(`${base}/provinces`, {
      code: "kinshasa",
      name: "Kinshasa",
    });
    expect(province.status).toBe(201);
    const site = await post(`${base}/sites`, {
      provinceId: province.body.province.id,
      code: "performance_farm",
      name: "Performance Farm",
      siteType: "farm",
    });
    expect(site.status).toBe(201);

    const climate = await post(`${base}/poultry/climate-profiles`, {
      code: "kinshasa_hot_humid",
      name: "Kinshasa Hot Humid",
      provinceId: province.body.province.id,
      climateClass: "hot_humid",
      season: "rainy",
      temperatureC: 31,
      humidityPercent: 78,
      waterAdjustmentPercent: 10,
      feedAdjustmentPercent: 0,
      operationalNote: "Keep cool water available and inspect ventilation.",
    });
    expect(climate.status).toBe(201);

    const model = await post(`${base}/poultry/performance-models`, {
      code: "congo_layer_a",
      name: "Congo Omega Layer A",
      productionType: "layer",
      strain: "Congo Omega Custom",
      climateProfileId: climate.body.climateProfile.id,
    });
    expect(model.status).toBe(201);
    const modelId = model.body.performanceModel.id as string;

    const weekly = await post(
      `${base}/poultry/performance-models/${modelId}/weekly-targets`,
      {
        weekNumber: 1,
        targetWeightG: 500,
        feedGPerBirdPerDay: 100,
        waterLitersPerBirdPerDay: 0.3,
        expectedCumulativeMortalityPercent: 1,
        maxRejectedEggPercent: 1,
        tolerancePercent: 5,
      },
    );
    expect(weekly.status).toBe(201);
    const vaccine = await post(
      `${base}/poultry/performance-models/${modelId}/vaccine-schedules`,
      {
        dayAge: 0,
        vaccineName: "Newcastle Day Zero",
        dose: "Model dose",
        administrationRoute: "eye drop",
      },
    );
    expect(vaccine.status).toBe(201);

    const house = await post(`${base}/poultry/houses`, {
      siteId: site.body.site.id,
      code: "performance_house",
      name: "Performance House",
      houseType: "layer",
      capacity: 200,
    });
    expect(house.status).toBe(201);
    const flock = await post(`${base}/poultry/flocks`, {
      houseId: house.body.record.id,
      code: "performance_layer",
      name: "Performance Layer",
      birdType: "layer",
      productionType: "layer",
      performanceModelId: modelId,
      arrivalDate: workDate,
      initialBirdCount: 100,
    });
    expect(flock.status).toBe(201);
    const flockId = flock.body.record.id as string;

    expect(
      (
        await post(`${base}/poultry/mortality`, {
          flockId,
          mortalityDate: workDate,
          deathCount: 2,
          causeCategory: "heat_stress",
          requiresFollowUp: true,
          followUpStatus: "pending",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post(`${base}/poultry/daily-records`, {
          flockId,
          recordDate: workDate,
          liveBirdCount: 98,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post(`${base}/poultry/feed`, {
          flockId,
          feedDate: workDate,
          feedName: "Starter",
          quantityKg: 8,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post(`${base}/poultry/water`, {
          flockId,
          waterDate: workDate,
          volumeLiters: 32.34,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post(`${base}/poultry/weights`, {
          flockId,
          recordDate: workDate,
          sampleSize: 20,
          averageWeightG: 450,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post(`${base}/poultry/eggs`, {
          flockId,
          recordDate: workDate,
          totalEggs: 12,
          crackedEggs: 1,
          dirtyEggs: 1,
          rejectedEggs: 1,
        })
      ).status,
    ).toBe(201);

    const performance = await owner(
      request(app).get(
        `${base}/poultry/flocks/${flockId}/performance?date=${workDate}`,
      ),
    );
    expect(performance.status).toBe(200);
    expect(performance.body.performance).toEqual(
      expect.objectContaining({
        age: expect.objectContaining({ ageDays: 0, ageWeek: 1 }),
        model: expect.objectContaining({
          id: modelId,
          productionType: "layer",
        }),
        weeklyTarget: expect.objectContaining({ feedGPerBirdPerDay: 100 }),
      }),
    );
    expect(performance.body.performance.comparisons.feed).toEqual(
      expect.objectContaining({ target: 9.8, status: "below_target" }),
    );
    expect(performance.body.performance.comparisons.water).toEqual(
      expect.objectContaining({ target: 32.34, status: "on_target" }),
    );
    expect(
      performance.body.performance.comparisons.cumulativeMortality.status,
    ).toBe("above_target");
    expect(performance.body.performance.actual.eggs).toEqual(
      expect.objectContaining({
        brokenEggs: 1,
        rejectedEggs: 3,
        saleableEggs: 9,
      }),
    );
    expect(performance.body.performance.vaccines).toEqual([
      expect.objectContaining({
        vaccineName: "Newcastle Day Zero",
        status: "due",
      }),
    ]);
    expect(
      performance.body.performance.recommendations.some(
        (item: { category: string }) => item.category === "vaccination",
      ),
    ).toBe(true);

    const generated = await post(
      `${base}/poultry/flocks/${flockId}/daily-work/generate`,
      { workDate },
    );
    expect(generated.status).toBe(200);
    expect(
      generated.body.dailyWork.map(
        (item: { workType: string }) => item.workType,
      ),
    ).toEqual(
      expect.arrayContaining([
        "feed_record",
        "water_record",
        "weight_check",
        "mortality_review",
        "vaccination",
        "climate_check",
      ]),
    );
    const workItem = generated.body.dailyWork.find(
      (item: { workType: string }) => item.workType === "vaccination",
    );
    const completed = await owner(
      request(app)
        .patch(`${base}/poultry/daily-work/${workItem.id}`)
        .send({ status: "completed" }),
    );
    expect(completed.status).toBe(200);
    expect(completed.body.workItem.status).toBe("completed");
  });
});
