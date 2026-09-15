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
const email = `lms-owner-${suffix}@test.invalid`;
const password = "SecurePass123";
const slug = `lms-${suffix}`;

async function cleanUp(): Promise<void> {
  const user = await query<{ id: string }>(
    "SELECT id FROM users WHERE email=$1",
    [email],
  );
  const userId = user.rows[0]?.id;
  if (!userId) return;
  const organizations = await withUserContext(userId, async (client) => {
    const result = await client.query<{ organization_id: string }>(
      "SELECT organization_id FROM organization_members WHERE user_id=$1",
      [userId],
    );
    return result.rows.map((row) => row.organization_id);
  });
  for (const organizationId of organizations) {
    await withTenantContext({ organizationId, userId }, (client) =>
      client.query("DELETE FROM organizations WHERE id=$1", [organizationId]),
    );
  }
  await query("DELETE FROM users WHERE id=$1", [userId]);
}

afterAll(cleanUp);

describe("Professional training journey", () => {
  it("keeps the course version, learner progress and certificate server verified", async () => {
    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({
        fullName: "LMS Owner",
        email,
        password,
        organization: {
          displayName: "LMS Test Company",
          slug,
          legalName: "LMS Test Company",
          country: "CD",
          currency: "CDF",
        },
      });
    expect(registration.status).toBe(201);
    const token = registration.body.accessToken as string;
    const organizationId = registration.body.organization.id as string;
    const userId = registration.body.user.id as string;
    const authorized = (test: request.Test) =>
      test.set("Authorization", `Bearer ${token}`);

    const employeeId = await withTenantContext(
      { organizationId, userId },
      async (client) => {
        const membership = await client.query<{ id: string }>(
          "SELECT id FROM organization_members WHERE organization_id=$1 AND user_id=$2",
          [organizationId, userId],
        );
        const existing = await client.query<{ id: string }>(
          "SELECT id FROM employees WHERE organization_id=$1 AND member_id=$2",
          [organizationId, membership.rows[0]!.id],
        );
        if (existing.rows[0]) return existing.rows[0].id;
        const inserted = await client.query<{ id: string }>(
          "INSERT INTO employees (organization_id,member_id,employee_number,full_name,job_title) VALUES ($1,$2,$3,$4,$5) RETURNING id",
          [
            organizationId,
            membership.rows[0]!.id,
            "90001",
            "LMS Owner",
            "Training owner",
          ],
        );
        return inserted.rows[0]!.id;
      },
    );

    // Personal performance derives the employee from the authenticated
    // membership. Supplying another id must not change the result.
    const otherEmployeeId = await withTenantContext(
      { organizationId, userId },
      async (client) => {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO employees (organization_id,employee_number,full_name,job_title)
             VALUES ($1,$2,$3,$4) RETURNING id`,
          [organizationId, "90002", "Other employee", "Worker"],
        );
        return inserted.rows[0]!.id;
      },
    );
    const mine = await authorized(
      request(app).get(
        `/api/v1/organizations/${slug}/my-performance?employeeId=${otherEmployeeId}`,
      ),
    );
    expect(mine.status).toBe(200);
    expect(mine.body.employees).toHaveLength(1);
    expect(mine.body.employees[0].employee.id).toBe(employeeId);

    const created = await authorized(
      request(app).post(
        `/api/v1/organizations/${slug}/professional-training-courses`,
      ),
    ).send({
      code: `lms_${suffix}`,
      name: "Professional induction",
      category: "induction",
      summary: "A secure course flow",
      learningObjectives: ["Read and acknowledge the policy"],
      languages: ["fr", "en"],
      isMandatory: true,
      defaultDueDays: 5,
      completionMode: "manager_validation",
    });
    expect(created.status).toBe(201);
    const courseId = created.body.course.courseId as string;
    const versionId = created.body.course.versionId as string;

    const module = await authorized(
      request(app).post(
        `/api/v1/organizations/${slug}/training-courses/${courseId}/modules`,
      ),
    ).send({ versionId, code: "welcome", title: "Welcome", sortOrder: 1 });
    expect(module.status).toBe(201);
    const moduleId = module.body.module.id as string;

    const lesson = await authorized(
      request(app).post(
        `/api/v1/organizations/${slug}/training-modules/${moduleId}/lessons`,
      ),
    ).send({
      versionId,
      code: "policy",
      title: "Policy",
      sortOrder: 1,
      isRequired: true,
    });
    expect(lesson.status).toBe(201);
    const lessonId = lesson.body.lesson.id as string;

    const block = await authorized(
      request(app).post(
        `/api/v1/organizations/${slug}/training-lessons/${lessonId}/blocks`,
      ),
    ).send({
      blockType: "text",
      title: "Read the policy",
      content: { body: "Safety first" },
      sortOrder: 1,
      isRequired: true,
    });
    expect(block.status).toBe(201);
    const blockId = block.body.block.id as string;
    const questionBank = await authorized(
      request(app).post(
        `/api/v1/organizations/${slug}/training-question-banks`,
      ),
    ).send({ name: "Induction assessment", category: "induction" });
    expect(questionBank.status).toBe(201);
    const questionBankId = questionBank.body.questionBank.id as string;
    const question = await authorized(
      request(app).post(
        `/api/v1/organizations/${slug}/training-question-banks/${questionBankId}/questions`,
      ),
    ).send({
      questionType: "single_choice",
      prompt: "What comes first?",
      options: ["Safety", "Speed"],
      correctAnswer: "Safety",
      points: 1,
    });
    expect(question.status).toBe(201);
    const quiz = await authorized(
      request(app).post(
        `/api/v1/organizations/${slug}/training-lessons/${lessonId}/blocks`,
      ),
    ).send({
      blockType: "quiz",
      title: "Knowledge check",
      content: { questionBankId, drawCount: 1, passingScore: 70 },
      sortOrder: 2,
      isRequired: false,
    });
    expect(quiz.status).toBe(201);
    const quizBlockId = quiz.body.block.id as string;
    const published = await authorized(
      request(app).post(
        `/api/v1/organizations/${slug}/training-courses/${courseId}/versions/${versionId}/publish`,
      ),
    ).send({ changeSummary: "Initial publication", requiresRetake: false });
    expect(published.status).toBe(200);

    const assigned = await authorized(
      request(app).post(`/api/v1/organizations/${slug}/training-assignments`),
    ).send({ courseId, employeeIds: [employeeId] });
    expect(assigned.status).toBe(201);
    const assignmentId = assigned.body.assignments[0].id as string;
    expect(assigned.body.assignments[0].dueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const learner = await authorized(
      request(app).get(
        `/api/v1/organizations/${slug}/my-trainings/${assignmentId}/course`,
      ),
    );
    expect(learner.status).toBe(200);
    expect(learner.body.modules[0].lessons[0].blocks[0].content).toEqual({
      body: "Safety first",
    });
    const learnerQuiz = learner.body.modules[0].lessons[0].blocks.find(
      (item: { id: string }) => item.id === quizBlockId,
    );
    expect(learnerQuiz.content.questions[0].question).toBe("What comes first?");
    expect(learnerQuiz.content.questions[0].correctAnswer).toBeUndefined();

    const completedBlock = await authorized(
      request(app).patch(
        `/api/v1/organizations/${slug}/my-trainings/${assignmentId}/blocks/${blockId}/progress`,
      ),
    ).send({ action: "confirm" });
    expect(completedBlock.status).toBe(200);
    expect(completedBlock.body.assignment.progressPercent).toBe(100);
    expect(completedBlock.body.assignment.status).toBe("awaiting_review");

    const validated = await authorized(
      request(app).patch(
        `/api/v1/organizations/${slug}/training-assignments/${assignmentId}/professional-validation`,
      ),
    ).send({ approved: true });
    expect(validated.status).toBe(200);

    const certificate = await authorized(
      request(app).get(
        `/api/v1/organizations/${slug}/my-trainings/${assignmentId}/professional-certificate.pdf`,
      ),
    );
    expect(certificate.status).toBe(200);
    expect(certificate.headers["content-type"]).toContain("application/pdf");

    // The learner portal is profile-scoped, not catalogue-permission-scoped.
    // Removing management/read grants must not prevent this linked employee
    // from opening their own assigned course.
    await withTenantContext({ organizationId, userId }, (client) =>
      client.query(
        `DELETE FROM role_permissions rp
           USING roles r, permissions p
          WHERE rp.organization_id=$1
            AND rp.role_id=r.id
            AND r.organization_id=$1
            AND r.code='owner'
            AND rp.permission_id=p.id
            AND p.code IN ('training.read','training.update')`,
        [organizationId],
      ),
    );
    const learnerWithoutManagementPermission = await authorized(
      request(app).get(
        `/api/v1/organizations/${slug}/my-trainings/${assignmentId}/course`,
      ),
    );
    expect(learnerWithoutManagementPermission.status).toBe(200);
  });
});
