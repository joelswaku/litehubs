import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { query } from "../../src/config/database";
import { createNotification } from "../../src/modules/notifications/notifications.service";
import { withTenantContext, withUserContext } from "../../src/utils/tenant-query";

const app = createApp();
const suffix = randomUUID().slice(0, 8);
const password = "SecurePass123";
const ownerEmail = `notifications-owner-${suffix}@test.invalid`;
const secondOwnerEmail = `notifications-other-${suffix}@test.invalid`;
const organizationSlug = `notifications-${suffix}`;
const secondOrganizationSlug = `notifications-other-${suffix}`;

async function cleanUp(email: string): Promise<void> {
  const result = await query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email]);
  const userId = result.rows[0]?.id;
  if (!userId) return;
  const organizations = await withUserContext(userId, async (client) => {
    const memberships = await client.query<{ organization_id: string }>(
      "SELECT organization_id FROM organization_members WHERE user_id=$1",
      [userId],
    );
    return memberships.rows.map((row) => row.organization_id);
  });
  for (const organizationId of organizations)
    await withTenantContext({ organizationId, userId }, (client) =>
      client.query("DELETE FROM organizations WHERE id=$1", [organizationId]),
    );
  await query("DELETE FROM users WHERE id=$1", [userId]);
}

afterAll(async () => {
  await cleanUp(ownerEmail);
  await cleanUp(secondOwnerEmail);
});

describe("Notification centre", () => {
  it("keeps the inbox recipient-scoped, deduplicated and manageable through the API", async () => {
    const registered = await request(app).post("/api/v1/auth/register").send({
      fullName: "Notification Owner",
      email: ownerEmail,
      password,
      organization: {
        slug: organizationSlug,
        legalName: "Notification Test SARL",
        displayName: "Notification Test",
        industryCode: "mixed_farm",
        country: "CD",
        currency: "CDF",
      },
    });
    expect(registered.status).toBe(201);
    const organizationId = registered.body.organization.id as string;
    const userId = registered.body.user.id as string;
    const token = registered.body.accessToken as string;
    const memberId = await withTenantContext({ organizationId, userId }, async (client) => {
      const member = await client.query<{ id: string }>(
        "SELECT id FROM organization_members WHERE organization_id=$1 AND user_id=$2",
        [organizationId, userId],
      );
      return member.rows[0]!.id;
    });
    const context = { organizationId, userId, memberId };
    const first = await createNotification(context, {
      recipientMemberId: memberId,
      type: "task_assigned",
      category: "task",
      priority: "high",
      title: "Task assigned",
      message: "Inspect the water system.",
      actionUrl: "/tasks",
      entityType: "management_project_task",
      entityId: randomUUID(),
      deduplicationKey: `test-task:${suffix}`,
    });
    const duplicate = await createNotification(context, {
      recipientMemberId: memberId,
      type: "task_assigned",
      category: "task",
      priority: "high",
      title: "Task assigned",
      message: "Inspect the water system.",
      actionUrl: "/tasks",
      entityType: "management_project_task",
      entityId: first!.entity!.id,
      deduplicationKey: `test-task:${suffix}`,
    });
    expect(first?.id).toBeTruthy();
    expect(duplicate?.id).toBe(first?.id);

    const authorized = (call: request.Test) => call.set("Authorization", `Bearer ${token}`);
    const base = `/api/v1/organizations/${organizationSlug}`;
    const preferences = await authorized(request(app).get(`${base}/notification-preferences`));
    expect(preferences.status).toBe(200);
    const savedPreferences = await authorized(request(app).patch(`${base}/notification-preferences`)).send({
      emailEnabled: true,
      preferredLanguage: "en",
      categories: [
        { category: "task", inApp: true, email: true, minEmailSeverity: "info" },
        { category: "inventory", inApp: false, email: false, minEmailSeverity: "warning" },
      ],
    });
    expect(savedPreferences.status).toBe(200);
    expect(savedPreferences.body.profile).toMatchObject({ emailEnabled: true, preferredLanguage: "en" });
    const muted = await createNotification(context, {
      recipientMemberId: memberId,
      type: "low_stock",
      category: "inventory",
      priority: "normal",
      title: "Low stock",
      entityType: "inventory_item",
      entityId: randomUUID(),
      deduplicationKey: `muted-inventory:${suffix}`,
    });
    expect(muted).toBeNull();
    const before = await authorized(request(app).get(`${base}/notifications/unread-count`));
    expect(before.status).toBe(200);
    expect(before.body.unreadCount).toBe(1);

    const inbox = await authorized(request(app).get(`${base}/notifications?tab=unread`));
    expect(inbox.status).toBe(200);
    expect(inbox.body.notifications).toHaveLength(1);
    expect(inbox.body.notifications[0]).toMatchObject({ id: first!.id, isRead: false, actionUrl: "/tasks" });

    const read = await authorized(request(app).patch(`${base}/notifications/${first!.id}/read`));
    expect(read.status).toBe(200);
    expect(read.body.notification.isRead).toBe(true);
    const afterRead = await authorized(request(app).get(`${base}/notifications/unread-count`));
    expect(afterRead.body.unreadCount).toBe(0);

    const unread = await authorized(request(app).patch(`${base}/notifications/${first!.id}/unread`));
    expect(unread.status).toBe(200);
    const allRead = await authorized(request(app).patch(`${base}/notifications/read-all`));
    expect(allRead.status).toBe(200);
    expect(allRead.body.updated).toBe(1);
    const archived = await authorized(request(app).patch(`${base}/notifications/archive-read`));
    expect(archived.status).toBe(200);
    expect(archived.body.updated).toBe(1);
    const archivedList = await authorized(request(app).get(`${base}/notifications?tab=archived`));
    expect(archivedList.status).toBe(200);
    expect(archivedList.body.notifications[0]).toMatchObject({ id: first!.id, isArchived: true });

    const other = await request(app).post("/api/v1/auth/register").send({
      fullName: "Other Notification Owner",
      email: secondOwnerEmail,
      password,
      organization: {
        slug: secondOrganizationSlug,
        legalName: "Other Notification Test SARL",
        displayName: "Other Notification Test",
        industryCode: "mixed_farm",
        country: "CD",
        currency: "CDF",
      },
    });
    expect(other.status).toBe(201);
    const foreignRead = await request(app)
      .patch(`${base}/notifications/${first!.id}/read`)
      .set("Authorization", `Bearer ${other.body.accessToken as string}`);
    expect(foreignRead.status).not.toBe(200);
  });
});
