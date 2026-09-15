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
const ownerEmail = `attendance-owner-${suffix}@test.invalid`;
const supervisorEmail = `attendance-supervisor-${suffix}@test.invalid`;
const organizationSlug = `attendance-congo-${suffix}`;

async function cleanUp(address: string): Promise<void> {
  const found = await query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1",
    [address],
  );
  const userId = found.rows[0]?.id;
  if (!userId) return;

  const memberships = await withUserContext(userId, async (client) => {
    const result = await client.query<{ organization_id: string }>(
      "SELECT organization_id FROM organization_members WHERE user_id = $1",
      [userId],
    );
    return result.rows.map((row) => row.organization_id);
  });

  for (const organizationId of memberships) {
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

describe("Shifts and attendance", () => {
  it("assigns a worker to a provincial farm shift and keeps a supervisor in their province", async () => {
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({
        fullName: "Attendance Owner",
        email: ownerEmail,
        password: PASSWORD,
        organization: {
          slug: organizationSlug,
          legalName: "Attendance Congo SARL",
          displayName: "Attendance Congo",
          industryCode: "mixed_farm",
          country: "CD",
          currency: "CDF",
        },
      });
    expect(registered.status).toBe(201);
    const ownerToken = registered.body.accessToken as string;
    const authorized = (call: request.Test) =>
      call.set("Authorization", `Bearer ${ownerToken}`);

    const kinshasa = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/provinces`)
        .send({ code: "kinshasa", name: "Kinshasa" }),
    );
    expect(kinshasa.status).toBe(201);

    const kongoCentral = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/provinces`)
        .send({ code: "kongo_central", name: "Kongo Central" }),
    );
    expect(kongoCentral.status).toBe(201);

    const kinshasaFarm = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/sites`)
        .send({
          provinceId: kinshasa.body.province.id,
          code: "kinshasa_farm",
          name: "Kinshasa Farm",
          siteType: "farm",
        }),
    );
    expect(kinshasaFarm.status).toBe(201);

    const kongoFarm = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/sites`)
        .send({
          provinceId: kongoCentral.body.province.id,
          code: "kongo_farm",
          name: "Kongo Farm",
          siteType: "farm",
        }),
    );
    expect(kongoFarm.status).toBe(201);

    const poultry = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/departments`)
        .send({
          siteId: kinshasaFarm.body.site.id,
          code: "poultry",
          name: "Poultry",
        }),
    );
    expect(poultry.status).toBe(201);

    const invitation = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/invitations`)
        .send({
          email: supervisorEmail,
          roleCodes: ["poultry_supervisor"],
          provinceIds: [kinshasa.body.province.id],
          jobTitle: "Poultry Supervisor",
        }),
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

    const members = await authorized(
      request(app).get(`/api/v1/organizations/${organizationSlug}/members`),
    );
    const supervisorMember = members.body.members.find(
      (member: { email: string }) => member.email === supervisorEmail,
    ) as { memberId: string } | undefined;
    expect(supervisorMember?.memberId).toBeTruthy();

    const supervisorEmployee = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/employees`)
        .send({
          memberId: supervisorMember!.memberId,
          fullName: "Kinshasa Poultry Supervisor",
          jobTitle: "Poultry Supervisor",
          departmentId: poultry.body.department.id,
          positionCategory: "supervisor",
          employmentStatus: "active",
          employmentType: "permanent",
        }),
    );
    expect(supervisorEmployee.status).toBe(201);
    expect(supervisorEmployee.body.employee.employeeNumber).toBe("20001");

    const kinshasaWorker = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/employees`)
        .send({
          fullName: "Kinshasa Farm Worker",
          jobTitle: "Poultry Farm Worker",
          departmentId: poultry.body.department.id,
          positionCategory: "employee",
          employmentStatus: "active",
          employmentType: "permanent",
        }),
    );
    expect(kinshasaWorker.status).toBe(201);
    expect(kinshasaWorker.body.employee.employeeNumber).toBe("10001");

    const kongoWorker = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/employees`)
        .send({
          fullName: "Kongo Farm Worker",
          jobTitle: "Farm Worker",
          provinceId: kongoCentral.body.province.id,
          positionCategory: "employee",
          employmentStatus: "active",
          employmentType: "casual",
        }),
    );
    expect(kongoWorker.status).toBe(201);
    expect(kongoWorker.body.employee.employeeNumber).toBe("10002");

    const kinshasaShift = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/shifts`)
        .send({
          code: "poultry_morning",
          name: "Poultry Morning",
          siteId: kinshasaFarm.body.site.id,
          departmentId: poultry.body.department.id,
          startsAt: "06:00",
          endsAt: "14:00",
        }),
    );
    expect(kinshasaShift.status).toBe(201);
    expect(kinshasaShift.body.shift.weeklySchedule).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ day: 1, enabled: true, startsAt: "06:00", endsAt: "14:00" }),
        expect.objectContaining({ day: 6, enabled: false }),
        expect.objectContaining({ day: 7, enabled: false }),
      ]),
    );

    const assignedKinshasa = await authorized(
      request(app)
        .post(
          `/api/v1/organizations/${organizationSlug}/shifts/${kinshasaShift.body.shift.id}/assignments`,
        )
        .send({
          employeeId: kinshasaWorker.body.employee.id,
          effectiveFrom: "2026-08-24",
        }),
    );
    expect(assignedKinshasa.status).toBe(201);

    const kongoShift = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/shifts`)
        .send({
          code: "kongo_morning",
          name: "Kongo Morning",
          siteId: kongoFarm.body.site.id,
          startsAt: "06:00",
          endsAt: "14:00",
        }),
    );
    expect(kongoShift.status).toBe(201);

    const assignedKongo = await authorized(
      request(app)
        .post(
          `/api/v1/organizations/${organizationSlug}/shifts/${kongoShift.body.shift.id}/assignments`,
        )
        .send({
          employeeId: kongoWorker.body.employee.id,
          effectiveFrom: "2026-08-24",
        }),
    );
    expect(assignedKongo.status).toBe(201);

    const clockedIn = await request(app)
      .post(`/api/v1/organizations/${organizationSlug}/attendance/clock-in`)
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({
        employeeNumber: "10001",
        workDate: "2026-08-24",
        occurredAt: "2026-08-24T06:00:00Z",
      });
    expect(clockedIn.status).toBe(201);
    expect(clockedIn.body.attendance).toEqual(
      expect.objectContaining({
        status: "present",
        employee: expect.objectContaining({ employeeNumber: "10001" }),
        shift: expect.objectContaining({ id: kinshasaShift.body.shift.id }),
      }),
    );

    const blockedOutsideClock = await request(app)
      .post(`/api/v1/organizations/${organizationSlug}/attendance/clock-in`)
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({
        employeeNumber: "10002",
        workDate: "2026-08-24",
        occurredAt: "2026-08-24T06:00:00Z",
      });
    expect(blockedOutsideClock.status).toBe(404);

    const clockedOut = await request(app)
      .post(`/api/v1/organizations/${organizationSlug}/attendance/clock-out`)
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({
        employeeNumber: "10001",
        workDate: "2026-08-24",
        occurredAt: "2026-08-24T15:00:00Z",
      });
    expect(clockedOut.status).toBe(200);
    expect(clockedOut.body.attendance.clockOutAt).toBe(
      "2026-08-24T15:00:00.000Z",
    );
    expect(clockedOut.body.attendance.expectedHours).toBe(8);
    expect(clockedOut.body.attendance.workedHours).toBe(9);
    expect(clockedOut.body.attendance.overtimeHours).toBe(1);

    const blockedRestDay = await request(app)
      .post(`/api/v1/organizations/${organizationSlug}/attendance/clock-in`)
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({
        employeeNumber: "10001",
        workDate: "2026-08-30",
        occurredAt: "2026-08-30T06:00:00Z",
      });
    expect(blockedRestDay.status).toBe(400);

    const sundayException = await authorized(
      request(app)
        .post(
          `/api/v1/organizations/${organizationSlug}/shifts/${kinshasaShift.body.shift.id}/assignments/${assignedKinshasa.body.assignment.id}/exceptions`,
        )
        .send({
          workDate: "2026-08-30",
          isWorking: true,
          startsAt: "06:00",
          endsAt: "14:00",
          breakMinutes: 0,
          note: "One-off Sunday livestock check.",
        }),
    );
    expect(sundayException.status).toBe(201);
    expect(sundayException.body.exception).toEqual(
      expect.objectContaining({ workDate: "2026-08-30", isWorking: true }),
    );

    const clockedInOnException = await request(app)
      .post(`/api/v1/organizations/${organizationSlug}/attendance/clock-in`)
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({
        employeeNumber: "10001",
        workDate: "2026-08-30",
        occurredAt: "2026-08-30T06:00:00Z",
      });
    expect(clockedInOnException.status).toBe(201);
    expect(clockedInOnException.body.attendance.expectedHours).toBe(8);

    const supervisorAttendance = await request(app)
      .get(
        `/api/v1/organizations/${organizationSlug}/attendance?workDate=2026-08-24`,
      )
      .set("Authorization", `Bearer ${supervisorToken}`);
    expect(supervisorAttendance.status).toBe(200);
    expect(supervisorAttendance.body.attendance).toHaveLength(1);

    const corrected = await authorized(
      request(app)
        .patch(
          `/api/v1/organizations/${organizationSlug}/attendance/${clockedIn.body.attendance.id}`,
        )
        .send({
          status: "late",
          correctionNote: "Corrected after reviewing the attendance sheet.",
        }),
    );
    expect(corrected.status).toBe(200);
    expect(corrected.body.attendance.status).toBe("late");

    const approved = await authorized(
      request(app).post(
        `/api/v1/organizations/${organizationSlug}/attendance/${clockedIn.body.attendance.id}/approve`,
      ),
    );
    expect(approved.status).toBe(200);
    expect(approved.body.attendance.approval.approvedAt).toBeTruthy();

    const compensation = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/employee-compensation`)
        .send({
          employeeId: kinshasaWorker.body.employee.id,
          effectiveFrom: "2026-08-01",
          currency: "CDF",
          basicSalary: 520,
          payFrequency: "monthly",
          contractHoursPerWeek: 40,
          overtimeMultiplier: 1.5,
          paymentMethod: "cash",
        }),
    );
    expect(compensation.status).toBe(201);

    const transportComponent = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/payroll-components`)
        .send({
          code: "transport_allowance",
          name: "Transport allowance",
          componentType: "earning",
          calculation: "fixed",
          defaultAmount: 150,
          isTaxable: true,
          affectsGross: true,
        }),
    );
    expect(transportComponent.status).toBe(201);

    const employeeComponent = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/employee-payroll-components`)
        .send({
          employeeId: kinshasaWorker.body.employee.id,
          componentId: transportComponent.body.component.id,
          amount: null,
          percentage: null,
          effectiveFrom: "2026-08-01",
          effectiveTo: null,
          // Simulates an old client that submitted zero for an omitted
          // recovery value. An earning must never be capped by that value.
          totalToRecover: 0,
          recoveredToDate: 0,
          isActive: true,
          notes: null,
        }),
    );
    expect(employeeComponent.status).toBe(201);
    expect(employeeComponent.body.assignment.component.name).toBe(
      "Transport allowance",
    );


    const payrollRun = await authorized(
      request(app)
        .post(`/api/v1/organizations/${organizationSlug}/payroll-runs`)
        .send({
          reference: "AUG-2026-OVERTIME",
          periodStart: "2026-08-01",
          periodEnd: "2026-08-31",
          payDate: "2026-08-31",
          currency: "CDF",
        }),
    );
    expect(payrollRun.status).toBe(201);

    const calculatedRun = await authorized(
      request(app).post(
        `/api/v1/organizations/${organizationSlug}/payroll-runs/${payrollRun.body.payrollRun.id}/calculate`,
      ),
    );
    expect(calculatedRun.status).toBe(200);
    const payrollSlips = await authorized(
      request(app).get(
        `/api/v1/organizations/${organizationSlug}/payroll-runs/${payrollRun.body.payrollRun.id}/payslips`,
      ),
    );
    expect(payrollSlips.status).toBe(200);
    expect(payrollSlips.body.payslips).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          overtimeHours: 1,
          grossPay: 674.5,
          lines: expect.arrayContaining([
            expect.objectContaining({ code: "verified_overtime", amount: 4.5 }),
            expect.objectContaining({ code: "transport_allowance", amount: 150 }),
          ]),
        }),
      ]),
    );

    const updatedEmployeeComponent = await authorized(
      request(app)
        .patch(
          `/api/v1/organizations/${organizationSlug}/employee-payroll-components/${employeeComponent.body.assignment.id}`,
        )
        .send({ amount: 175 }),
    );
    expect(updatedEmployeeComponent.status).toBe(200);
    expect(updatedEmployeeComponent.body.assignment.amount).toBe(175);
  });
});
