import { createHash, randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { query } from "../../src/config/database";
import { withTenantContext, withUserContext } from "../../src/utils/tenant-query";

const app = createApp();
const suffix = randomUUID().slice(0, 8);
const ownerEmail = `careers-owner-${suffix}@test.invalid`;
const organizationSlug = `careers-${suffix}`;
const PASSWORD = "SecurePass123";

async function cleanUp(): Promise<void> {
  const found = await query<{ id: string }>("SELECT id FROM users WHERE email = $1", [ownerEmail]);
  const userId = found.rows[0]?.id;
  if (!userId) return;

  const organizationIds = await withUserContext(userId, async (client) => {
    const memberships = await client.query<{ organization_id: string }>(
      "SELECT organization_id FROM organization_members WHERE user_id = $1",
      [userId],
    );
    return memberships.rows.map((row) => row.organization_id);
  });

  for (const organizationId of organizationIds) {
    await withTenantContext({ userId, organizationId }, (client) =>
      client.query("DELETE FROM organizations WHERE id = $1", [organizationId]),
    );
  }
  await query("DELETE FROM users WHERE id = $1", [userId]);
}

afterAll(cleanUp);

describe("Careers job posts", () => {
  it("creates a site-scoped vacancy and applies safe defaults", async () => {
    const registered = await request(app).post("/api/v1/auth/register").send({
      fullName: "Careers test owner",
      email: ownerEmail,
      password: PASSWORD,
      organization: {
        slug: organizationSlug,
        legalName: "Careers test company",
        displayName: "Careers test company",
        industryCode: "poultry",
        country: "CD",
        currency: "CDF",
      },
    });
    expect(registered.status).toBe(201);
    const authorized = (call: request.Test) => call.set("Authorization", `Bearer ${registered.body.accessToken}`);

    const province = await authorized(
      request(app).post(`/api/v1/organizations/${organizationSlug}/provinces`).send({ code: "kinshasa", name: "Kinshasa" }),
    );
    expect(province.status).toBe(201);

    const site = await authorized(
      request(app).post(`/api/v1/organizations/${organizationSlug}/sites`).send({
        provinceId: province.body.province.id,
        code: "career_site",
        name: "Career Site",
        siteType: "farm",
      }),
    );
    expect(site.status).toBe(201);

    const portal = await authorized(
      request(app).put(`/api/v1/organizations/${organizationSlug}/careers/settings`).send({
        siteId: site.body.site.id,
        publicCareersEnabled: true,
      }),
    );
    expect(portal.status).toBe(200);

    const created = await authorized(
      request(app).post(`/api/v1/organizations/${organizationSlug}/careers/jobs`).send({
        siteId: site.body.site.id,
        code: "poultry_worker",
        title: "Poultry worker",
        shortSummary: "Support daily poultry production and animal welfare.",
        description: "Complete role description for daily poultry production work.",
        status: "published",
      }),
    );
    expect(created.status).toBe(201);
    expect(created.body.job).toMatchObject({
      code: "poultry_worker",
      employmentType: "permanent",
      experienceLevel: "not_specified",
      positionsOpen: 1,
      status: "published",
      site: { id: site.body.site.id },
    });

    const listed = await authorized(request(app).get(`/api/v1/organizations/${organizationSlug}/careers/jobs`));
    expect(listed.status).toBe(200);
    expect(listed.body.jobs).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.job.id })]));

    const publicCatalog = await request(app).get(`/api/v1/public/organizations/${organizationSlug}/careers/jobs`);
    expect(publicCatalog.status).toBe(200);
    expect(publicCatalog.body.jobs).toEqual(expect.arrayContaining([expect.objectContaining({ code: "poultry_worker" })]));

    const publicDetail = await request(app).get(`/api/v1/public/organizations/${organizationSlug}/careers/jobs/poultry_worker`);
    expect(publicDetail.status).toBe(200);
    expect(publicDetail.body.job).toMatchObject({ code: "poultry_worker", title: "Poultry worker" });

    const application = await request(app)
      .post(`/api/v1/public/organizations/${organizationSlug}/careers/jobs/poultry_worker/applications`)
      .field("fullName", "Candidate Example")
      .field("email", `candidate-${suffix}@test.invalid`)
      .field("phone", "+243898869772")
      .field("preferredLanguage", "fr")
      .field("consent", "true")
      .attach("resume", Buffer.from("%PDF-1.4\nCandidate résumé"), {
        filename: "candidate-resume.pdf",
        contentType: "application/pdf",
      });
    expect(application.status).toBe(201);
    expect(application.body).toMatchObject({
      confirmation: "Your application has been received.",
    });

    const duplicatePhone = await request(app)
      .post(`/api/v1/public/organizations/${organizationSlug}/careers/jobs/poultry_worker/applications`)
      .field("fullName", "Candidate duplicate phone")
      .field("email", `another-candidate-${suffix}@test.invalid`)
      .field("phone", "243 898 869 772")
      .field("preferredLanguage", "fr")
      .field("consent", "true")
      .attach("resume", Buffer.from("%PDF-1.4\nCandidate résumé"), {
        filename: "candidate-duplicate-phone.pdf",
        contentType: "application/pdf",
      });
    expect(duplicatePhone.status).toBe(409);
    expect(duplicatePhone.body.error.message).toMatch(/phone number/i);

    const applications = await authorized(
      request(app).get(`/api/v1/organizations/${organizationSlug}/careers/applications`),
    );
    expect(applications.status).toBe(200);
    expect(applications.body.applications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fullName: "Candidate Example",
          phone: "+243898869772",
          status: "received",
        }),
      ]),
    );

    const candidate = applications.body.applications.find(
      (item: { fullName: string }) => item.fullName === "Candidate Example",
    );
    const statusUpdate = await authorized(
      request(app)
        .patch(
          `/api/v1/organizations/${organizationSlug}/careers/applications/${candidate.id}`,
        )
        .send({
          status: "interview",
          internalNotes: "Candidate requested an afternoon slot.",
          notifyCandidate: true,
          candidateMessage:
            "Votre candidature est retenue pour un entretien le 5 octobre à 10 h.",
        }),
    );
    expect(statusUpdate.status).toBe(200);
    expect(statusUpdate.body.application).toMatchObject({
      id: candidate.id,
      status: "interview",
      internalNotes: "Candidate requested an afternoon slot.",
      preferredLanguage: "fr",
    });

    const offer = await authorized(
      request(app)
        .patch(
          `/api/v1/organizations/${organizationSlug}/careers/applications/${candidate.id}`,
        )
        .send({ status: "offered", internalNotes: "Offer approved." }),
    );
    expect(offer.status).toBe(200);
    expect(offer.body.application.status).toBe("offered");

    // The actual offer token is intentionally never returned by the API.
    // Replace its hash inside the tenant transaction only so the public
    // onboarding flow can be exercised with a deterministic test token.
    const organizationId = registered.body.organization.id as string;
    const ownerId = registered.body.user.id as string;
    const onboardingToken = randomBytes(32).toString("base64url");
    await withTenantContext(
      { organizationId, userId: ownerId },
      (client) =>
        client.query(
          `UPDATE career_candidate_onboardings
              SET token_hash=$3
            WHERE organization_id=$1 AND application_id=$2`,
          [
            organizationId,
            candidate.id,
            createHash("sha256").update(onboardingToken).digest("hex"),
          ],
        ),
    );

    const onboarding = await request(app).get(
      `/api/v1/public/organizations/${organizationSlug}/careers/onboarding/${onboardingToken}`,
    );
    expect(onboarding.status).toBe(200);
    expect(onboarding.body.onboarding).toMatchObject({
      candidate: { email: `candidate-${suffix}@test.invalid` },
      job: { title: "Poultry worker" },
    });

    const submittedOnboarding = await request(app)
      .post(
        `/api/v1/public/organizations/${organizationSlug}/careers/onboarding/${onboardingToken}`,
      )
      .field("lastName", "Kabongo")
      .field("postName", "Mbuyi")
      .field("firstName", "Marie")
      .field("dateOfBirth", "1998-06-20")
      .field("placeOfBirth", "Kinshasa")
      .field("addressLine1", "12 avenue de la Paix")
      .field("addressCity", "Kinshasa")
      .field("addressRegion", "Kinshasa")
      .field("addressCountry", "République démocratique du Congo")
      .field("identityDocumentType", "national_id")
      .field("identityDocumentNumber", "ID-2026-01")
      .field("socialSecurityNumber", "INSS-7788")
      .field("emergencyContactName", "Jean Kabongo")
      .field("emergencyContactPhone", "+243898869772")
      .field("consent", "true")
      .attach("portrait", Buffer.from("portrait"), {
        filename: "portrait.jpg",
        contentType: "image/jpeg",
      })
      .attach("identityDocument", Buffer.from("%PDF-1.4\nidentity"), {
        filename: "identity.pdf",
        contentType: "application/pdf",
      });
    expect(submittedOnboarding.status).toBe(201);
    expect(submittedOnboarding.body.completed).toBe(true);

    const hired = await authorized(
      request(app)
        .patch(
          `/api/v1/organizations/${organizationSlug}/careers/applications/${candidate.id}`,
        )
        .send({ status: "hired", internalNotes: "HR approved the file." }),
    );
    expect(hired.status).toBe(200);

    const recruitmentCandidates = await authorized(
      request(app).get(
        `/api/v1/organizations/${organizationSlug}/employees/recruitment-candidates`,
      ),
    );
    expect(recruitmentCandidates.status).toBe(200);
    expect(recruitmentCandidates.body.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          applicationId: candidate.id,
          profile: expect.objectContaining({ lastName: "Kabongo" }),
        }),
      ]),
    );

    const employee = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/employees`)
        .send({
          careerApplicationId: candidate.id,
          jobTitle: "Poultry worker",
          employmentStatus: "active",
          employmentType: "permanent",
        }),
    );
    expect(employee.status).toBe(201);
    expect(employee.body.employee).toMatchObject({
      fullName: "Kabongo Mbuyi Marie",
      identity: expect.objectContaining({
        dateOfBirth: expect.stringMatching(/^1998-06-20T/),
        identityDocumentNumber: "ID-2026-01",
        socialSecurityNumber: "INSS-7788",
      }),
      contact: expect.objectContaining({ phone: "+243898869772" }),
      site: { id: site.body.site.id },
    });
    const candidatesAfterHire = await authorized(
      request(app).get(
        `/api/v1/organizations/${organizationSlug}/employees/recruitment-candidates`,
      ),
    );
    expect(candidatesAfterHire.body.candidates).toHaveLength(0);
  });
});
