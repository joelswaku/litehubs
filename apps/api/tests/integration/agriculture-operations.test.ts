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
const ownerEmail = "agriculture-owner-" + suffix + "@test.invalid";
const organizationSlug = "agriculture-congo-" + suffix;
const password = "SecurePass123";
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

describe("Agriculture operations", () => {
  it("records a crop cycle from field setup to harvest and loss", async () => {
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({
        fullName: "Agriculture Operations Owner",
        email: ownerEmail,
        password,
        organization: {
          slug: organizationSlug,
          legalName: "Agriculture Operations Congo SARL",
          displayName: "Agriculture Operations Congo",
          industryCode: "mixed_farm",
          country: "CD",
          currency: "CDF",
        },
      });
    expect(registered.status).toBe(201);
    const owner = (call: request.Test) =>
      call.set(
        "Authorization",
        "Bearer " + String(registered.body.accessToken),
      );
    const post = (resource: string, body: object) =>
      owner(
        request(app)
          .post(
            "/api/v1/organizations/" +
              organizationSlug +
              "/agriculture/" +
              resource,
          )
          .send(body),
      );

    const province = await owner(
      request(app)
        .post("/api/v1/organizations/" + organizationSlug + "/provinces")
        .send({ code: "kinshasa", name: "Kinshasa" }),
    );
    const site = await owner(
      request(app)
        .post("/api/v1/organizations/" + organizationSlug + "/sites")
        .send({
          provinceId: province.body.province.id,
          code: "crop_farm",
          name: "Crop Farm",
          siteType: "farm",
        }),
    );
    expect(site.status).toBe(201);

    const farm = await post("farms", {
      siteId: site.body.site.id,
      code: "kin_crop_farm",
      name: "Kinshasa Crop Farm",
      farmType: "crop",
      totalAreaHa: 12,
    });
    const field = await post("fields", {
      farmId: farm.body.record.id,
      code: "north_field",
      name: "North Field",
      areaHa: 6,
      soilType: "loam",
    });
    const plot = await post("plots", {
      fieldId: field.body.record.id,
      code: "north_plot_a",
      name: "North Plot A",
      areaHa: 2.5,
    });
    const crop = await post("crops", {
      code: "maize_hybrid",
      name: "Hybrid Maize",
      cropType: "cereal",
      defaultGrowingDays: 115,
      defaultYieldUnit: "kg",
    });
    const season = await post("seasons", {
      farmId: farm.body.record.id,
      code: "rainy_2026",
      name: "Rainy Season 2026",
      seasonType: "rainy",
      startDate: "2026-08-01",
      endDate: "2026-12-31",
    });
    expect(farm.status).toBe(201);
    expect(field.status).toBe(201);
    expect(plot.status).toBe(201);
    expect(crop.status).toBe(201);
    expect(season.status).toBe(201);

    const planting = await post("plantings", {
      plotId: plot.body.record.id,
      cropId: crop.body.record.id,
      seasonId: season.body.record.id,
      code: "maize_north_2026",
      name: "Maize North 2026",
      plantingDate: workDate,
      expectedHarvestDate: "2026-12-19",
      plantedAreaHa: 2.5,
      seedQuantity: 62.5,
      seedUnit: "kg",
      plantingMethod: "row planting",
      status: "planted",
    });
    expect(planting.status).toBe(201);

    const records: Array<[string, object]> = [
      [
        "operations",
        {
          fieldId: field.body.record.id,
          plotId: plot.body.record.id,
          plantingId: planting.body.record.id,
          operationDate: workDate,
          operationType: "weeding",
          labourHours: 14,
        },
      ],
      [
        "irrigation",
        {
          fieldId: field.body.record.id,
          plotId: plot.body.record.id,
          plantingId: planting.body.record.id,
          irrigationDate: workDate,
          method: "drip",
          volumeLiters: 1200,
        },
      ],
      [
        "fertilizer",
        {
          fieldId: field.body.record.id,
          plotId: plot.body.record.id,
          plantingId: planting.body.record.id,
          applicationDate: workDate,
          productName: "NPK 17-17-17",
          nutrientFormula: "17-17-17",
          quantityKg: 100,
        },
      ],
      [
        "pesticides",
        {
          fieldId: field.body.record.id,
          plotId: plot.body.record.id,
          plantingId: planting.body.record.id,
          applicationDate: workDate,
          productName: "Fall Armyworm Control",
          targetPest: "Fall armyworm",
          dosage: "20 ml per 20 litres",
          preHarvestIntervalDays: 14,
        },
      ],
      [
        "scouting",
        {
          fieldId: field.body.record.id,
          plotId: plot.body.record.id,
          plantingId: planting.body.record.id,
          scoutingDate: workDate,
          observationType: "growth",
          severity: "low",
          observedIssue: "Uniform early growth",
          status: "monitoring",
        },
      ],
      [
        "weather",
        {
          farmId: farm.body.record.id,
          observationDate: workDate,
          rainfallMm: 8.5,
          minTemperatureC: 21,
          maxTemperatureC: 30,
          humidityPercent: 74,
        },
      ],
      [
        "production-targets",
        {
          plantingId: planting.body.record.id,
          targetYield: 14000,
          unit: "kg",
          targetHarvestDate: "2026-12-19",
        },
      ],
    ];
    for (const [resource, body] of records) {
      const response = await post(resource, body);
      expect(response.status).toBe(201);
    }

    const harvest = await post("harvest", {
      plantingId: planting.body.record.id,
      harvestDate: "2026-12-19",
      quantity: 13250,
      unit: "kg",
      qualityGrade: "Grade A",
      rejectedQuantity: 150,
    });
    const loss = await post("losses", {
      fieldId: field.body.record.id,
      plotId: plot.body.record.id,
      plantingId: planting.body.record.id,
      lossDate: "2026-12-20",
      lossType: "pest",
      quantity: 75,
      unit: "kg",
      causeDescription: "Localized pest damage",
    });
    expect(harvest.status).toBe(201);
    expect(loss.status).toBe(201);

    const plantingAfterHarvest = await owner(
      request(app).get(
        "/api/v1/organizations/" +
          organizationSlug +
          "/agriculture/plantings/" +
          planting.body.record.id,
      ),
    );
    expect(plantingAfterHarvest.status).toBe(200);
    expect(plantingAfterHarvest.body.record.status).toBe("harvested");

    const overview = await owner(
      request(app).get(
        "/api/v1/organizations/" + organizationSlug + "/agriculture/overview",
      ),
    );
    expect(overview.status).toBe(200);
    expect(overview.body.overview.farms).toBe(1);
    expect(overview.body.overview.fields).toBe(1);
    expect(overview.body.overview.activePlantings).toBe(0);
  });
});
