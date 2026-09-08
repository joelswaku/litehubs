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
const ownerEmail = "owner-scope-" + suffix + "@test.invalid";
const managerEmail = "project-manager-scope-" + suffix + "@test.invalid";
const organizationSlug = "owner-scope-" + suffix;
const password = "SecurePass123";

async function cleanOrganization(email: string): Promise<void> {
  const user = await query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1",
    [email],
  );
  const userId = user.rows[0]?.id;
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
  await cleanOrganization(ownerEmail);
  await cleanOrganization(managerEmail);
});

describe("Owner Management project scope", () => {
  it("lets an assigned project manager execute scoped work without owner controls", async () => {
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({
        fullName: "Scope Owner",
        email: ownerEmail,
        password,
        organization: {
          slug: organizationSlug,
          legalName: "Scope Congo SARL",
          displayName: "Scope Congo",
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
    const base = "/api/v1/organizations/" + organizationSlug;
    const province = await owner(
      request(app)
        .post(base + "/provinces")
        .send({ code: "kinshasa", name: "Kinshasa" }),
    );
    expect(province.status).toBe(201);

    const createProject = (code: string, name: string) =>
      owner(
        request(app)
          .post(base + "/owner-management/projects")
          .send({
            code,
            name,
            projectType: "construction",
            provinceId: province.body.province.id,
            status: "planning",
          }),
      );
    const assignedProject = await createProject(
      "assigned_project",
      "Assigned Project",
    );
    const otherProject = await createProject("other_project", "Other Project");
    expect(assignedProject.status).toBe(201);
    expect(otherProject.status).toBe(201);

    const invalidPhase = await owner(
      request(app)
        .post(base + "/owner-management/phases")
        .send({
          projectId: assignedProject.body.record.id,
          code: "invalid_phase_" + suffix,
          name: "Invalid phase order",
          phaseOrder: 0,
          status: "not_started",
          priority: "medium",
        }),
    );
    expect(invalidPhase.status).toBe(400);
    expect(invalidPhase.body.error.message).toContain(
      "Phase order must be 1 or higher",
    );

    const validPhase = await owner(
      request(app)
        .post(base + "/owner-management/phases")
        .send({
          projectId: assignedProject.body.record.id,
          code: "land_phase_" + suffix,
          name: "Land verification",
          phaseOrder: 1,
          status: "not_started",
          priority: "medium",
        }),
    );
    expect(validPhase.status).toBe(201);

    const constructionPhase = await owner(
      request(app)
        .post(base + "/owner-management/phases")
        .send({
          projectId: assignedProject.body.record.id,
          code: "construction_phase_" + suffix,
          name: "Construction",
          phaseOrder: 2,
          status: "not_started",
          priority: "medium",
        }),
    );
    expect(constructionPhase.status).toBe(201);
    const phaseDependency = await owner(
      request(app)
        .post(base + "/owner-management/phase-dependencies")
        .send({
          phaseId: constructionPhase.body.record.id,
          dependsOnPhaseId: validPhase.body.record.id,
          dependencyType: "finish_to_start",
        }),
    );
    expect(phaseDependency.status).toBe(201);
    const circularDependency = await owner(
      request(app)
        .post(base + "/owner-management/phase-dependencies")
        .send({
          phaseId: validPhase.body.record.id,
          dependsOnPhaseId: constructionPhase.body.record.id,
          dependencyType: "finish_to_start",
        }),
    );
    expect(circularDependency.status).toBe(400);
    expect(circularDependency.body.error.message).toContain("cycle");
    const blockedPhaseStart = await owner(
      request(app)
        .patch(
          base + "/owner-management/phases/" + constructionPhase.body.record.id,
        )
        .send({ status: "in_progress" }),
    );
    expect(blockedPhaseStart.status).toBe(400);
    expect(blockedPhaseStart.body.error.message).toContain(
      "prerequisite phase",
    );
    const completedPrerequisite = await owner(
      request(app)
        .patch(base + "/owner-management/phases/" + validPhase.body.record.id)
        .send({ status: "completed" }),
    );
    expect(completedPrerequisite.status).toBe(200);
    const allowedPhaseStart = await owner(
      request(app)
        .patch(
          base + "/owner-management/phases/" + constructionPhase.body.record.id,
        )
        .send({ status: "in_progress" }),
    );
    expect(allowedPhaseStart.status).toBe(200);

    const invitation = await owner(
      request(app)
        .post(base + "/invitations")
        .send({
          email: managerEmail,
          roleCodes: ["employee"],
          provinceIds: [],
          jobTitle: "Project Manager",
        }),
    );
    expect(invitation.status).toBe(201);
    const token = new URL(invitation.body.acceptUrl).searchParams.get("token");
    expect(token).toBeTruthy();
    const accepted = await request(app)
      .post("/api/v1/auth/accept-invitation")
      .send({
        token,
        fullName: "Assigned Project Manager",
        email: managerEmail,
        password,
      });
    expect(accepted.status).toBe(201);

    const members = await owner(request(app).get(base + "/members"));
    const managerMember = members.body.members.find(
      (member: { email: string }) => member.email === managerEmail,
    );
    expect(managerMember.roleCodes).toEqual(["employee"]);
    const assignment = await owner(
      request(app)
        .post(base + "/owner-management/project-members")
        .send({
          projectId: assignedProject.body.record.id,
          memberId: managerMember.memberId,
          assignmentRole: "project_manager",
          isManager: true,
          assignmentStartDate: "2026-01-01",
          assignmentEndDate: "2026-12-31",
        }),
    );
    expect(assignment.status).toBe(201);
    expect(assignment.body.record).toEqual(
      expect.objectContaining({
        assignmentRole: "project_manager",
        isManager: true,
        assignmentStartDate: "2026-01-01",
        assignmentEndDate: "2026-12-31",
      }),
    );
    const membersAfterAssignment = await owner(
      request(app).get(base + "/members"),
    );
    const managerAfterAssignment = membersAfterAssignment.body.members.find(
      (member: { email: string }) => member.email === managerEmail,
    );
    expect(managerAfterAssignment.roleCodes).toEqual(
      expect.arrayContaining(["employee", "project_manager"]),
    );
    const refreshedManagerLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: managerEmail, password });
    expect(refreshedManagerLogin.status).toBe(200);
    const manager = (call: request.Test) =>
      call.set(
        "Authorization",
        "Bearer " + String(refreshedManagerLogin.body.accessToken),
      );

    const visibleProjects = await manager(
      request(app).get(base + "/owner-management/projects"),
    );
    expect(visibleProjects.status).toBe(200);
    expect(visibleProjects.body.records).toEqual([
      expect.objectContaining({ id: assignedProject.body.record.id }),
    ]);

    const projectSummary = await manager(
      request(app).get(
        base +
          "/owner-management/projects/" +
          assignedProject.body.record.id +
          "/summary",
      ),
    );
    expect(projectSummary.status).toBe(200);
    const projectActivity = await manager(
      request(app).get(
        base +
          "/owner-management/projects/" +
          assignedProject.body.record.id +
          "/activity",
      ),
    );
    expect(projectActivity.status).toBe(200);

    const managerTask = await manager(
      request(app)
        .post(base + "/owner-management/tasks")
        .send({
          projectId: assignedProject.body.record.id,
          title: "Verify land documents",
          taskType: "work",
          status: "not_started",
        }),
    );
    expect(managerTask.status).toBe(201);
    expect(managerTask.body.record.taskType).toBe("work");

    const landMilestone = await owner(
      request(app)
        .post(base + "/owner-management/tasks")
        .send({
          projectId: assignedProject.body.record.id,
          title: "Land title verified",
          taskType: "milestone",
          status: "not_started",
        }),
    );
    expect(landMilestone.status).toBe(201);
    expect(landMilestone.body.record.taskType).toBe("milestone");

    const taskDependency = await owner(
      request(app)
        .post(base + "/owner-management/task-dependencies")
        .send({
          taskId: landMilestone.body.record.id,
          dependsOnTaskId: managerTask.body.record.id,
          dependencyType: "finish_to_start",
        }),
    );
    expect(taskDependency.status).toBe(201);
    expect(taskDependency.body.record.id).toEqual(expect.any(String));
    const taskDependencies = await owner(
      request(app).get(base + "/owner-management/task-dependencies"),
    );
    expect(taskDependencies.status).toBe(200);
    expect(taskDependencies.body.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: taskDependency.body.record.id }),
      ]),
    );

    const rejectedMilestoneExpense = await owner(
      request(app)
        .post(base + "/owner-management/expenses")
        .send({
          expenseNumber: "milestone_expense_" + suffix,
          projectId: assignedProject.body.record.id,
          projectTaskId: landMilestone.body.record.id,
          provinceId: province.body.province.id,
          category: "legal",
          description: "A milestone must not receive an expense",
          amount: 1,
          currencyCode: "CDF",
          expenseDate: "2026-01-15",
          status: "approved",
        }),
    );
    expect(rejectedMilestoneExpense.status).toBe(400);

    const assignedTasks = await manager(
      request(app).get(base + "/owner-management/tasks"),
    );
    expect(assignedTasks.status).toBe(200);
    expect(assignedTasks.body.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: managerTask.body.record.id }),
      ]),
    );
    const auditedTask = assignedTasks.body.records.find(
      (record: { id: string }) => record.id === managerTask.body.record.id,
    );
    expect(auditedTask).toEqual(
      expect.objectContaining({
        lastAction: "create",
        lastActionByName: "Assigned Project Manager",
        lastActionByRole: expect.stringContaining("Project Manager"),
        lastActionAt: expect.any(String),
      }),
    );

    const completedTask = await manager(
      request(app)
        .patch(base + "/owner-management/tasks/" + managerTask.body.record.id)
        .send({ status: "completed", progressPercent: 42 }),
    );
    expect(completedTask.status).toBe(200);
    expect(Number(completedTask.body.record.progressPercent)).toBe(100);
    const restartedTask = await manager(
      request(app)
        .patch(base + "/owner-management/tasks/" + managerTask.body.record.id)
        .send({ status: "not_started", progressPercent: 42 }),
    );
    expect(restartedTask.status).toBe(200);
    expect(Number(restartedTask.body.record.progressPercent)).toBe(0);
    const activeTask = await manager(
      request(app)
        .patch(base + "/owner-management/tasks/" + managerTask.body.record.id)
        .send({ status: "in_progress", progressPercent: 37.5 }),
    );
    expect(activeTask.status).toBe(200);
    expect(Number(activeTask.body.record.progressPercent)).toBe(37.5);

    const approvedTaskExpense = await owner(
      request(app)
        .post(base + "/owner-management/expenses")
        .send({
          expenseNumber: "task_actual_cost_" + suffix,
          projectId: assignedProject.body.record.id,
          projectTaskId: managerTask.body.record.id,
          provinceId: province.body.province.id,
          category: "legal",
          description: "Approved cost of title verification",
          amount: 180,
          currencyCode: "CDF",
          expenseDate: "2026-01-15",
          status: "approved",
        }),
    );
    expect(approvedTaskExpense.status).toBe(201);
    const tasksWithCost = await manager(
      request(app).get(base + "/owner-management/tasks"),
    );
    const taskWithCost = tasksWithCost.body.records.find(
      (record: { id: string }) => record.id === managerTask.body.record.id,
    );
    expect(Number(taskWithCost.actualCost)).toBe(180);

    const submittedExpense = await manager(
      request(app)
        .post(base + "/owner-management/expenses")
        .send({
          expenseNumber: "scope_expense_" + suffix,
          projectId: assignedProject.body.record.id,
          provinceId: province.body.province.id,
          category: "legal",
          description: "Land verification receipt",
          amount: 120,
          currencyCode: "CDF",
          expenseDate: "2026-01-15",
          status: "submitted",
        }),
    );
    expect(submittedExpense.status).toBe(201);
    const forbiddenExpenseDecision = await manager(
      request(app)
        .post(base + "/owner-management/expenses")
        .send({
          expenseNumber: "scope_expense_decision_" + suffix,
          projectId: assignedProject.body.record.id,
          provinceId: province.body.province.id,
          category: "legal",
          description: "An owner decision is required",
          amount: 100,
          currencyCode: "CDF",
          expenseDate: "2026-01-15",
          status: "approved",
        }),
    );
    expect(forbiddenExpenseDecision.status).toBe(403);

    const forbiddenProjectCreate = await manager(
      request(app)
        .post(base + "/owner-management/projects")
        .send({
          code: "manager_project",
          name: "Manager Project",
          projectType: "construction",
          provinceId: province.body.province.id,
          status: "planning",
        }),
    );
    expect(forbiddenProjectCreate.status).toBe(403);
    const hiddenOtherProject = await manager(
      request(app).get(
        base +
          "/owner-management/projects/" +
          otherProject.body.record.id +
          "/summary",
      ),
    );
    expect(hiddenOtherProject.status).toBe(404);
    const hiddenOtherProjectActivity = await manager(
      request(app).get(
        base +
          "/owner-management/projects/" +
          otherProject.body.record.id +
          "/activity",
      ),
    );
    expect(hiddenOtherProjectActivity.status).toBe(404);
    const forbiddenOtherTask = await manager(
      request(app)
        .post(base + "/owner-management/tasks")
        .send({
          projectId: otherProject.body.record.id,
          title: "Hidden project task",
          status: "not_started",
        }),
    );
    expect(forbiddenOtherTask.status).toBe(404);
    const exportFile = await manager(
      request(app).get(
        base +
          "/owner-management/projects/" +
          assignedProject.body.record.id +
          "/export.xlsx",
      ),
    );
    expect(exportFile.status).toBe(403);

    const endAssignment = await owner(
      request(app)
        .patch(
          base +
            "/owner-management/project-members/" +
            assignment.body.record.id,
        )
        .send({ assignmentEndDate: "2026-01-02" }),
    );
    expect(endAssignment.status).toBe(200);
    const expiredManagerProjects = await manager(
      request(app).get(base + "/owner-management/projects"),
    );
    expect(expiredManagerProjects.status).toBe(200);
    expect(expiredManagerProjects.body.records).toEqual([]);
  });
});
