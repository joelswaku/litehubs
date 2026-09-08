import type { PoolClient } from "pg";
import { db } from "../../config/database";
import { env } from "../../config/env";
import { sendMail } from "../../services/notification.service";
import {
  BadRequestError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type {
  ListNotificationsInput,
  UpdateNotificationPreferencesInput,
} from "./notifications.validation";

export type NotificationPriority = "low" | "normal" | "high" | "urgent";

export interface NotificationContext {
  organizationId: string;
  userId: string;
  memberId: string;
}

export interface CreateNotificationInput {
  organizationId: string;
  recipientUserId?: string | null;
  recipientMemberId?: string | null;
  recipientEmployeeId?: string | null;
  actorUserId?: string | null;
  provinceId?: string | null;
  siteId?: string | null;
  type: string;
  category: string;
  priority?: NotificationPriority;
  title: string;
  message?: string | null;
  actionUrl?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  expiresAt?: string | null;
  deduplicationKey?: string | null;
}

type NotificationRow = {
  id: string;
  organization_id: string;
  member_id: string;
  recipient_user_id: string | null;
  recipient_employee_id: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  province_id: string | null;
  province_name: string | null;
  category: string;
  type: string;
  priority: NotificationPriority;
  title: string;
  message: string | null;
  action_url: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  is_read: boolean;
  read_at: Date | null;
  is_archived: boolean;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
  email_status: "not_required" | "pending" | "sent" | "failed";
  email_sent_at: Date | null;
  email_error: string | null;
};

type RecipientRow = {
  member_id: string;
  user_id: string;
  email: string;
  full_name: string;
};

type ProfilePreferenceRow = {
  in_app_enabled: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  push_enabled: boolean;
  digest_frequency: "none" | "daily" | "weekly";
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  preferred_language: "fr" | "en";
};

const notificationFields = `
  n.id,n.organization_id,n.member_id,n.recipient_user_id,n.recipient_employee_id,
  n.actor_user_id,actor.full_name AS actor_name,actor.email::text AS actor_email,
  n.province_id,p.name AS province_name,n.category,n.type,n.priority,n.title,
  n.message,n.action_url,n.entity_type,n.entity_id,n.metadata,n.is_read,n.read_at,
  n.is_archived,n.archived_at,n.created_at,n.updated_at,n.expires_at,n.email_status,
  n.email_sent_at,n.email_error
`;

const categories = new Set([
  "general", "alert", "escalation", "approval", "task", "project",
  "leave", "payroll", "training", "invitation", "maintenance",
  "inventory", "procurement", "finance", "document", "contract",
  "attendance", "schedule", "discipline", "incident", "security",
  "poultry", "pigs", "agriculture", "veterinary", "report",
]);

function mapNotification(row: NotificationRow) {
  return {
    id: row.id,
    category: row.category,
    type: row.type,
    priority: row.priority,
    title: row.title,
    message: row.message,
    actionUrl: row.action_url,
    entity: row.entity_id
      ? { type: row.entity_type, id: row.entity_id }
      : null,
    metadata: row.metadata ?? {},
    isRead: row.is_read,
    readAt: row.read_at,
    isArchived: row.is_archived,
    archivedAt: row.archived_at,
    province: row.province_id
      ? { id: row.province_id, name: row.province_name }
      : null,
    actor: row.actor_user_id
      ? { userId: row.actor_user_id, fullName: row.actor_name, email: row.actor_email }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

function severityFor(priority: NotificationPriority): "info" | "warning" | "critical" {
  if (priority === "urgent") return "critical";
  if (priority === "high") return "warning";
  return "info";
}

function minimumSeverityAllows(
  minimum: "info" | "warning" | "critical",
  priority: NotificationPriority,
): boolean {
  const rank = { info: 0, warning: 1, critical: 2 } as const;
  return rank[severityFor(priority)] >= rank[minimum];
}

function assertRelativeActionUrl(value: string | null | undefined): void {
  if (value && (!value.startsWith("/") || value.startsWith("//")))
    throw new BadRequestError("Notification action must be a safe app-relative path", {
      field: "actionUrl",
    });
}

async function recipientFor(
  client: PoolClient,
  input: CreateNotificationInput,
): Promise<RecipientRow | null> {
  if (!input.recipientMemberId && !input.recipientUserId)
    throw new BadRequestError("Choose a notification recipient", {
      field: "recipientUserId",
    });
  const result = await client.query<RecipientRow>(
    `SELECT m.id AS member_id,m.user_id,u.email::text,u.full_name
       FROM organization_members m
       JOIN users u ON u.id=m.user_id
      WHERE m.organization_id=$1 AND m.status='active'
        AND (${input.recipientMemberId ? "m.id=$2" : "m.user_id=$2"})`,
    [
      input.organizationId,
      input.recipientMemberId ?? input.recipientUserId,
    ],
  );
  return result.rows[0] ?? null;
}

async function assertOrganizationRecord(
  client: PoolClient,
  organizationId: string,
  table: "provinces" | "employees" | "sites",
  id: string | null | undefined,
  field: string,
): Promise<void> {
  if (!id) return;
  const result = await client.query(
    `SELECT 1 FROM ${table} WHERE organization_id=$1 AND id=$2`,
    [organizationId, id],
  );
  if (!result.rowCount)
    throw new BadRequestError("Choose a record in this company", { field });
}

async function profilePreferences(
  client: PoolClient,
  organizationId: string,
  memberId: string,
): Promise<ProfilePreferenceRow> {
  const result = await client.query<ProfilePreferenceRow>(
    `SELECT in_app_enabled,email_enabled,sms_enabled,push_enabled,digest_frequency,
            quiet_hours_start::text,quiet_hours_end::text,preferred_language
       FROM notification_profile_preferences
      WHERE organization_id=$1 AND member_id=$2`,
    [organizationId, memberId],
  );
  return (
    result.rows[0] ?? {
      in_app_enabled: true,
      email_enabled: false,
      sms_enabled: false,
      push_enabled: false,
      digest_frequency: "none",
      quiet_hours_start: null,
      quiet_hours_end: null,
      preferred_language: "fr",
    }
  );
}

async function inAppEnabledForCategory(
  client: PoolClient,
  organizationId: string,
  memberId: string,
  category: string,
): Promise<boolean> {
  const result = await client.query<{ in_app: boolean }>(
    `SELECT in_app FROM notification_preferences
      WHERE organization_id=$1 AND member_id=$2 AND category=$3`,
    [organizationId, memberId, category],
  );
  return result.rows[0]?.in_app ?? true;
}
async function emailEnabledForCategory(
  client: PoolClient,
  organizationId: string,
  memberId: string,
  category: string,
  priority: NotificationPriority,
  profile: ProfilePreferenceRow,
): Promise<boolean> {
  if (!profile.email_enabled) return false;
  const result = await client.query<{
    email: boolean;
    min_email_severity: "info" | "warning" | "critical";
  }>(
    `SELECT email,min_email_severity FROM notification_preferences
      WHERE organization_id=$1 AND member_id=$2 AND category=$3`,
    [organizationId, memberId, category],
  );
  const preference = result.rows[0];
  return Boolean(
    preference?.email &&
      minimumSeverityAllows(preference.min_email_severity, priority),
  );
}

async function notificationRow(
  client: PoolClient,
  organizationId: string,
  memberId: string,
  notificationId: string,
): Promise<NotificationRow> {
  const result = await client.query<NotificationRow>(
    `SELECT ${notificationFields}
       FROM notifications n
       LEFT JOIN provinces p ON p.organization_id=n.organization_id AND p.id=n.province_id
       LEFT JOIN users actor ON actor.id=n.actor_user_id
      WHERE n.organization_id=$1 AND n.member_id=$2 AND n.id=$3`,
    [organizationId, memberId, notificationId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Notification not found");
  return row;
}

async function audit(
  client: PoolClient,
  context: NotificationContext,
  action: "read" | "update" | "delete",
  notificationId: string | null,
  title: string,
  changes: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
      (organization_id,user_id,member_id,actor_email,actor_name,action,entity_table,entity_id,entity_label,changes)
     SELECT $1,$2,$3,u.email::text,u.full_name,$4,'notifications',$5,$6,$7::jsonb
       FROM users u WHERE u.id=$2`,
    [
      context.organizationId,
      context.userId,
      context.memberId,
      action,
      notificationId,
      title,
      JSON.stringify(changes),
    ],
  );
}

/**
 * The only write entry point used by LiteHubs modules.  It can share the
 * caller's transaction, so the business record and its notification either
 * commit together or neither does.
 */
export async function createNotificationInTransaction(
  client: PoolClient,
  input: CreateNotificationInput,
) {
  if (!categories.has(input.category))
    throw new BadRequestError("Unsupported notification category", {
      field: "category",
    });
  assertRelativeActionUrl(input.actionUrl);
  if ((input.entityType == null) !== (input.entityId == null))
    throw new BadRequestError("Provide both notification entity type and id", {
      field: "entityId",
    });
  const recipient = await recipientFor(client, input);
  // A former employee or an invitee who has not activated a membership cannot
  // receive an inbox item. The originating workflow remains successful.
  if (!recipient) return null;
  await Promise.all([
    assertOrganizationRecord(client, input.organizationId, "provinces", input.provinceId, "provinceId"),
    assertOrganizationRecord(client, input.organizationId, "employees", input.recipientEmployeeId, "recipientEmployeeId"),
    assertOrganizationRecord(client, input.organizationId, "sites", input.siteId, "siteId"),
  ]);
  const priority = input.priority ?? "normal";
  const profile = await profilePreferences(client, input.organizationId, recipient.member_id);
  // Urgent safety/compliance notices remain mandatory in the in-app inbox.
  const categoryAllowsInApp = await inAppEnabledForCategory(
    client, input.organizationId, recipient.member_id, input.category,
  );
  if ((!profile.in_app_enabled || !categoryAllowsInApp) && priority !== "urgent") return null;
  const emailPending = await emailEnabledForCategory(
    client,
    input.organizationId,
    recipient.member_id,
    input.category,
    priority,
    profile,
  );
  const metadata = { ...(input.metadata ?? {}), ...(input.siteId ? { siteId: input.siteId } : {}) };
  const insert = await client.query<{ id: string }>(
    `INSERT INTO notifications (
       organization_id,province_id,member_id,recipient_user_id,recipient_employee_id,
       actor_user_id,category,type,priority,title,body,message,severity,link_path,
       action_url,subject_table,subject_id,entity_type,entity_id,metadata,is_read,
       is_archived,expires_at,deduplication_key,email_status
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$13,$14,$15,$14,$15,$16,
       false,false,$17,$18,$19
     ) ON CONFLICT DO NOTHING RETURNING id`,
    [
      input.organizationId,
      input.provinceId ?? null,
      recipient.member_id,
      recipient.user_id,
      input.recipientEmployeeId ?? null,
      input.actorUserId ?? null,
      input.category,
      input.type,
      priority,
      input.title.trim(),
      input.message?.trim() || null,
      severityFor(priority),
      input.actionUrl ?? null,
      input.entityType ?? null,
      input.entityId ?? null,
      JSON.stringify(metadata),
      input.expiresAt ?? null,
      input.deduplicationKey ?? null,
      emailPending ? "pending" : "not_required",
    ],
  );
  const createdId = insert.rows[0]?.id;
  if (!createdId && input.deduplicationKey) {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM notifications
        WHERE organization_id=$1 AND member_id=$2 AND deduplication_key=$3
        ORDER BY created_at DESC LIMIT 1`,
      [input.organizationId, recipient.member_id, input.deduplicationKey],
    );
    if (existing.rows[0])
      return mapNotification(
        await notificationRow(
          client,
          input.organizationId,
          recipient.member_id,
          existing.rows[0].id,
        ),
      );
  }
  if (!createdId) return null;
  return mapNotification(
    await notificationRow(client, input.organizationId, recipient.member_id, createdId),
  );
}

export async function createNotification(
  context: NotificationContext,
  input: Omit<CreateNotificationInput, "organizationId" | "actorUserId"> & {
    actorUserId?: string | null;
  },
) {
  return withTenantContext(context, (client) =>
    createNotificationInTransaction(client, {
      ...input,
      organizationId: context.organizationId,
      actorUserId: input.actorUserId ?? context.userId,
    }),
  );
}

export async function notifyOrganizationOwnersInTransaction(
  client: PoolClient,
  input: Omit<CreateNotificationInput, "recipientUserId" | "recipientMemberId">,
) {
  const owners = await client.query<{ id: string }>(
    `SELECT id FROM organization_members
      WHERE organization_id=$1 AND status='active' AND is_owner`,
    [input.organizationId],
  );
  return Promise.all(
    owners.rows.map((owner) =>
      createNotificationInTransaction(client, {
        ...input,
        recipientMemberId: owner.id,
        deduplicationKey: input.deduplicationKey
          ? `${input.deduplicationKey}:${owner.id}`
          : null,
      }),
    ),
  );
}

export async function listNotifications(
  context: NotificationContext,
  input: ListNotificationsInput,
) {
  return withTenantContext(context, async (client) => {
    const values: unknown[] = [context.organizationId, context.memberId];
    const where = ["n.organization_id=$1", "n.member_id=$2"];
    const add = (condition: (index: number) => string, value: unknown) => {
      values.push(value);
      where.push(condition(values.length));
    };
    if (input.tab === "archived") where.push("n.is_archived");
    else where.push("n.is_archived=false");
    if (input.tab === "unread") where.push("n.is_read=false");
    if (input.tab === "important") where.push("n.priority IN ('high','urgent')");
    if (input.category) add((index) => `n.category=$${index}`, input.category);
    if (input.priority) add((index) => `n.priority=$${index}`, input.priority);
    if (input.provinceId) add((index) => `n.province_id=$${index}`, input.provinceId);
    if (input.siteId) add((index) => `n.metadata ->> 'siteId'=$${index}`, input.siteId);
    if (input.search)
      add(
        (index) => `(n.title ILIKE $${index} OR COALESCE(n.message,'') ILIKE $${index})`,
        `%${input.search}%`,
      );
    if (input.from) add((index) => `n.created_at >= $${index}::date`, input.from);
    if (input.to) add((index) => `n.created_at < ($${index}::date + interval '1 day')`, input.to);
    values.push(input.limit, input.offset);
    const result = await client.query<NotificationRow & { total_count: string }>(
      `SELECT ${notificationFields},COUNT(*) OVER() AS total_count
         FROM notifications n
         LEFT JOIN provinces p ON p.organization_id=n.organization_id AND p.id=n.province_id
         LEFT JOIN users actor ON actor.id=n.actor_user_id
        WHERE ${where.join(" AND ")}
        ORDER BY n.is_read ASC,
                 CASE n.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
                 n.created_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    return {
      notifications: result.rows.map(mapNotification),
      pagination: {
        limit: input.limit,
        offset: input.offset,
        total: Number(result.rows[0]?.total_count ?? 0),
      },
    };
  });
}

export async function unreadCount(context: NotificationContext) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications
        WHERE organization_id=$1 AND member_id=$2 AND is_archived=false AND is_read=false
          AND (expires_at IS NULL OR expires_at > now())`,
      [context.organizationId, context.memberId],
    );
    return { unreadCount: Number(result.rows[0]?.count ?? 0) };
  });
}

async function updateReadState(
  context: NotificationContext,
  notificationId: string,
  read: boolean,
) {
  return withTenantContext(context, async (client) => {
    const current = await notificationRow(client, context.organizationId, context.memberId, notificationId);
    await client.query(
      `UPDATE notifications SET is_read=$4,read_at=CASE WHEN $4 THEN COALESCE(read_at,now()) ELSE NULL END
        WHERE organization_id=$1 AND member_id=$2 AND id=$3`,
      [context.organizationId, context.memberId, notificationId, read],
    );
    await audit(client, context, read ? "read" : "update", notificationId, current.title, {
      event: read ? "marked_read" : "marked_unread",
    });
    return mapNotification(await notificationRow(client, context.organizationId, context.memberId, notificationId));
  });
}

export const markNotificationRead = (context: NotificationContext, notificationId: string) =>
  updateReadState(context, notificationId, true);
export const markNotificationUnread = (context: NotificationContext, notificationId: string) =>
  updateReadState(context, notificationId, false);

export async function archiveNotification(context: NotificationContext, notificationId: string) {
  return withTenantContext(context, async (client) => {
    const current = await notificationRow(client, context.organizationId, context.memberId, notificationId);
    await client.query(
      `UPDATE notifications SET is_archived=true,archived_at=COALESCE(archived_at,now())
        WHERE organization_id=$1 AND member_id=$2 AND id=$3`,
      [context.organizationId, context.memberId, notificationId],
    );
    await audit(client, context, "update", notificationId, current.title, { event: "archived" });
    return mapNotification(await notificationRow(client, context.organizationId, context.memberId, notificationId));
  });
}

export async function markAllRead(context: NotificationContext) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<{ id: string }>(
      `UPDATE notifications SET is_read=true,read_at=COALESCE(read_at,now())
        WHERE organization_id=$1 AND member_id=$2 AND is_archived=false AND is_read=false
        RETURNING id`,
      [context.organizationId, context.memberId],
    );
    if (result.rowCount)
      await audit(client, context, "read", null, "Notification inbox", {
        event: "marked_all_read",
        count: result.rowCount,
      });
    return { updated: result.rowCount ?? 0 };
  });
}

export async function archiveReadNotifications(context: NotificationContext) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<{ id: string }>(
      `UPDATE notifications SET is_archived=true,archived_at=COALESCE(archived_at,now())
        WHERE organization_id=$1 AND member_id=$2 AND is_archived=false AND is_read=true
        RETURNING id`,
      [context.organizationId, context.memberId],
    );
    if (result.rowCount)
      await audit(client, context, "update", null, "Notification inbox", {
        event: "archived_read",
        count: result.rowCount,
      });
    return { updated: result.rowCount ?? 0 };
  });
}

export async function deleteNotification(context: NotificationContext, notificationId: string) {
  return withTenantContext(context, async (client) => {
    const current = await notificationRow(client, context.organizationId, context.memberId, notificationId);
    await client.query(
      `DELETE FROM notifications WHERE organization_id=$1 AND member_id=$2 AND id=$3`,
      [context.organizationId, context.memberId, notificationId],
    );
    await audit(client, context, "delete", notificationId, current.title, { event: "deleted" });
  });
}

const defaultProfile = {
  inAppEnabled: true,
  emailEnabled: false,
  smsEnabled: false,
  pushEnabled: false,
  digestFrequency: "none" as const,
  quietHoursStart: null,
  quietHoursEnd: null,
  preferredLanguage: "fr" as const,
};

export async function getNotificationPreferences(context: NotificationContext) {
  return withTenantContext(context, async (client) => {
    const profile = await profilePreferences(client, context.organizationId, context.memberId);
    const categoryPreferences = await client.query<{
      category: string;
      in_app: boolean;
      email: boolean;
      min_email_severity: string;
    }>(
      `SELECT category,in_app,email,min_email_severity FROM notification_preferences
        WHERE organization_id=$1 AND member_id=$2 ORDER BY category`,
      [context.organizationId, context.memberId],
    );
    return {
      profile: {
        inAppEnabled: profile.in_app_enabled,
        emailEnabled: profile.email_enabled,
        smsEnabled: profile.sms_enabled,
        pushEnabled: profile.push_enabled,
        digestFrequency: profile.digest_frequency,
        quietHoursStart: profile.quiet_hours_start,
        quietHoursEnd: profile.quiet_hours_end,
        preferredLanguage: profile.preferred_language,
      },
      categories: categoryPreferences.rows.map((row) => ({
        category: row.category,
        inApp: row.in_app,
        email: row.email,
        minEmailSeverity: row.min_email_severity,
      })),
    };
  });
}

export async function updateNotificationPreferences(
  context: NotificationContext,
  input: UpdateNotificationPreferencesInput,
) {
  return withTenantContext(context, async (client) => {
    const current = await profilePreferences(client, context.organizationId, context.memberId);
    const next = {
      inAppEnabled: input.inAppEnabled ?? current.in_app_enabled,
      emailEnabled: input.emailEnabled ?? current.email_enabled,
      smsEnabled: input.smsEnabled ?? current.sms_enabled,
      pushEnabled: input.pushEnabled ?? current.push_enabled,
      digestFrequency: input.digestFrequency ?? current.digest_frequency,
      quietHoursStart: input.quietHoursStart === undefined ? current.quiet_hours_start : input.quietHoursStart,
      quietHoursEnd: input.quietHoursEnd === undefined ? current.quiet_hours_end : input.quietHoursEnd,
      preferredLanguage: input.preferredLanguage ?? current.preferred_language,
    };
    await client.query(
      `INSERT INTO notification_profile_preferences
       (organization_id,member_id,in_app_enabled,email_enabled,sms_enabled,push_enabled,digest_frequency,quiet_hours_start,quiet_hours_end,preferred_language)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (organization_id,member_id) DO UPDATE SET
         in_app_enabled=EXCLUDED.in_app_enabled,email_enabled=EXCLUDED.email_enabled,
         sms_enabled=EXCLUDED.sms_enabled,push_enabled=EXCLUDED.push_enabled,
         digest_frequency=EXCLUDED.digest_frequency,quiet_hours_start=EXCLUDED.quiet_hours_start,
         quiet_hours_end=EXCLUDED.quiet_hours_end,preferred_language=EXCLUDED.preferred_language`,
      [context.organizationId, context.memberId, next.inAppEnabled, next.emailEnabled, next.smsEnabled, next.pushEnabled, next.digestFrequency, next.quietHoursStart, next.quietHoursEnd, next.preferredLanguage],
    );
    for (const preference of input.categories ?? []) {
      if (!categories.has(preference.category)) continue;
      await client.query(
        `INSERT INTO notification_preferences (organization_id,member_id,category,in_app,email,min_email_severity)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (organization_id,member_id,category) DO UPDATE SET
           in_app=EXCLUDED.in_app,email=EXCLUDED.email,min_email_severity=EXCLUDED.min_email_severity`,
        [context.organizationId, context.memberId, preference.category, preference.inApp, preference.email, preference.minEmailSeverity],
      );
    }
    await audit(client, context, "update", null, "Notification preferences", { event: "preferences_updated" });
    const categoryPreferences = await client.query<{
      category: string;
      in_app: boolean;
      email: boolean;
      min_email_severity: string;
    }>(
      `SELECT category,in_app,email,min_email_severity FROM notification_preferences
        WHERE organization_id=$1 AND member_id=$2 ORDER BY category`,
      [context.organizationId, context.memberId],
    );
    return {
      profile: next,
      categories: categoryPreferences.rows.map((row) => ({
        category: row.category,
        inApp: row.in_app,
        email: row.email,
        minEmailSeverity: row.min_email_severity,
      })),
    };
  });
}

/** Best-effort queued e-mail delivery. Email failures stay visible on the row
 * and are retried on later scheduler runs (up to three attempts). */
export async function deliverPendingEmailsForOrganization(organizationId: string) {
  return withTenantContext({ organizationId, userId: null }, async (client) => {
    const pending = await client.query<NotificationRow & RecipientRow>(
      `SELECT ${notificationFields},u.email::text,u.full_name
         FROM notifications n
         JOIN organization_members m ON m.organization_id=n.organization_id AND m.id=n.member_id
         JOIN users u ON u.id=m.user_id
         LEFT JOIN provinces p ON p.organization_id=n.organization_id AND p.id=n.province_id
         LEFT JOIN users actor ON actor.id=n.actor_user_id
        WHERE n.organization_id=$1 AND n.email_status='pending' AND n.delivery_attempts<3
        ORDER BY n.created_at ASC LIMIT 100`,
      [organizationId],
    );
    let delivered = 0;
    for (const item of pending.rows) {
      const actionUrl = item.action_url ? new URL(item.action_url, env.frontendUrl).toString() : null;
      const result = await sendMail({
        to: item.email,
        subject: item.title,
        text: [item.title, item.message ?? "", actionUrl ? `Open: ${actionUrl}` : ""].filter(Boolean).join("\n\n"),
        html: `<h1>${escapeForHtml(item.title)}</h1><p>${escapeForHtml(item.message ?? "")}</p>${actionUrl ? `<p><a href="${escapeForHtml(actionUrl)}">Open in LiteHubs</a></p>` : ""}`,
      });
      await client.query(
        `UPDATE notifications SET email_status=$3,email_sent_at=CASE WHEN $3='sent' THEN now() ELSE email_sent_at END,
             email_error=$4,delivery_attempts=delivery_attempts+1,last_delivery_attempt_at=now()
          WHERE organization_id=$1 AND id=$2`,
        [organizationId, item.id, result.sent ? "sent" : "failed", result.reason ?? null],
      );
      if (result.sent) delivered += 1;
    }
    return { delivered, attempted: pending.rows.length };
  });
}

function escapeForHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export async function runScheduledNotificationRemindersForOrganization(organizationId: string) {
  return withTenantContext({ organizationId, userId: null }, async (client) => {
    const dueTraining = await client.query<{
      assignment_id: string;
      due_on: string;
      course_name: string;
      employee_id: string;
      member_id: string | null;
      province_id: string | null;
    }>(
      `SELECT a.id AS assignment_id,a.due_on::text,c.name AS course_name,e.id AS employee_id,e.member_id,e.province_id
         FROM training_assignments a
         JOIN training_courses c ON c.organization_id=a.organization_id AND c.id=a.course_id
         JOIN employees e ON e.organization_id=a.organization_id AND e.id=a.employee_id
        WHERE a.organization_id=$1 AND a.due_on BETWEEN CURRENT_DATE AND CURRENT_DATE+7
          AND a.status IN ('assigned','in_progress')`,
      [organizationId],
    );
    for (const assignment of dueTraining.rows) {
      if (!assignment.member_id) continue;
      await createNotificationInTransaction(client, {
        organizationId,
        recipientMemberId: assignment.member_id,
        recipientEmployeeId: assignment.employee_id,
        provinceId: assignment.province_id,
        type: "training_deadline_approaching",
        category: "training",
        priority: "high",
        title: "Training deadline approaching",
        message: `${assignment.course_name} is due on ${assignment.due_on}.`,
        actionUrl: `/my-trainings/${assignment.assignment_id}`,
        entityType: "training_assignment",
        entityId: assignment.assignment_id,
        deduplicationKey: `training_due:${assignment.assignment_id}:${assignment.due_on}`,
      });
    }
    const overdueTraining = await client.query<{
      assignment_id: string;
      due_on: string;
      course_name: string;
      employee_id: string;
      member_id: string | null;
      province_id: string | null;
    }>(
      `SELECT a.id AS assignment_id,a.due_on::text,c.name AS course_name,e.id AS employee_id,e.member_id,e.province_id
         FROM training_assignments a
         JOIN training_courses c ON c.organization_id=a.organization_id AND c.id=a.course_id
         JOIN employees e ON e.organization_id=a.organization_id AND e.id=a.employee_id
        WHERE a.organization_id=$1 AND a.due_on<CURRENT_DATE
          AND a.status IN ('assigned','in_progress','overdue')`,
      [organizationId],
    );
    for (const assignment of overdueTraining.rows) {
      if (!assignment.member_id) continue;
      await createNotificationInTransaction(client, {
        organizationId,
        recipientMemberId: assignment.member_id,
        recipientEmployeeId: assignment.employee_id,
        provinceId: assignment.province_id,
        type: "training_overdue",
        category: "training",
        priority: "urgent",
        title: "Training is overdue",
        message: `${assignment.course_name} was due on ${assignment.due_on}.`,
        actionUrl: `/my-trainings/${assignment.assignment_id}`,
        entityType: "training_assignment",
        entityId: assignment.assignment_id,
        deduplicationKey: `training_overdue:${assignment.assignment_id}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
    const dueTasks = await client.query<{
      id: string;
      title: string;
      due_date: string;
      assigned_member_id: string | null;
      province_id: string | null;
    }>(
      `SELECT t.id,t.title,t.due_date::text,t.assigned_member_id,COALESCE(p.province_id,t.province_id) AS province_id
         FROM management_project_tasks t
         LEFT JOIN management_projects p ON p.organization_id=t.organization_id AND p.id=t.project_id
        WHERE t.organization_id=$1 AND t.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE+3
          AND t.status NOT IN ('completed','cancelled')`,
      [organizationId],
    );
    for (const task of dueTasks.rows) {
      if (!task.assigned_member_id) continue;
      await createNotificationInTransaction(client, {
        organizationId,
        recipientMemberId: task.assigned_member_id,
        provinceId: task.province_id,
        type: "task_deadline_approaching",
        category: "task",
        priority: "high",
        title: "Task deadline approaching",
        message: `${task.title} is due on ${task.due_date}.`,
        actionUrl: "/tasks",
        entityType: "management_project_task",
        entityId: task.id,
        deduplicationKey: `task-due:${task.id}:${task.due_date}`,
      });
    }
    const overdueTasks = await client.query<{
      id: string;
      title: string;
      due_date: string;
      assigned_member_id: string | null;
      province_id: string | null;
    }>(
      `SELECT t.id,t.title,t.due_date::text,t.assigned_member_id,COALESCE(p.province_id,t.province_id) AS province_id
         FROM management_project_tasks t
         LEFT JOIN management_projects p ON p.organization_id=t.organization_id AND p.id=t.project_id
        WHERE t.organization_id=$1 AND t.due_date<CURRENT_DATE
          AND t.status NOT IN ('completed','cancelled')`,
      [organizationId],
    );
    for (const task of overdueTasks.rows) {
      if (!task.assigned_member_id) continue;
      await createNotificationInTransaction(client, {
        organizationId,
        recipientMemberId: task.assigned_member_id,
        provinceId: task.province_id,
        type: "task_overdue",
        category: "task",
        priority: "urgent",
        title: "Task is overdue",
        message: `${task.title} was due on ${task.due_date}.`,
        actionUrl: "/tasks",
        entityType: "management_project_task",
        entityId: task.id,
        deduplicationKey: `task-overdue:${task.id}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
    const dueMaintenance = await client.query<{
      id: string;
      work_order_number: string;
      due_date: string;
      assigned_member_id: string | null;
      province_id: string | null;
    }>(
      `SELECT work.id,work.work_order_number,work.due_date::text,work.assigned_member_id,asset.province_id
         FROM management_maintenance_work_orders work
         JOIN management_assets asset ON asset.organization_id=work.organization_id AND asset.id=work.asset_id
        WHERE work.organization_id=$1 AND work.due_date<=CURRENT_DATE+7
          AND work.status NOT IN ('completed','cancelled')`,
      [organizationId],
    );
    for (const work of dueMaintenance.rows) {
      const input: Omit<CreateNotificationInput, "recipientMemberId" | "recipientUserId"> = {
        organizationId,
        provinceId: work.province_id,
        type: work.due_date < new Date().toISOString().slice(0, 10) ? "maintenance_overdue" : "maintenance_due",
        category: "maintenance",
        priority: work.due_date < new Date().toISOString().slice(0, 10) ? "urgent" : "high",
        title: work.due_date < new Date().toISOString().slice(0, 10) ? "Maintenance is overdue" : "Maintenance is due soon",
        message: work.work_order_number,
        actionUrl: "/maintenance",
        entityType: "maintenance_work_order",
        entityId: work.id,
        deduplicationKey: `maintenance-reminder:${work.id}:${new Date().toISOString().slice(0, 10)}`,
      };
      if (work.assigned_member_id)
        await createNotificationInTransaction(client, { ...input, recipientMemberId: work.assigned_member_id });
      else await notifyOrganizationOwnersInTransaction(client, input);
    }
    return {
      trainingDue: dueTraining.rows.length,
      trainingOverdue: overdueTraining.rows.length,
      tasksDue: dueTasks.rows.length,
      tasksOverdue: overdueTasks.rows.length,
      maintenanceDue: dueMaintenance.rows.length,
    };
  });
}

export async function scheduledOrganizationIds(): Promise<string[]> {
  const result = await db.query<{ organization_id: string }>(
    "SELECT organization_id FROM notification_scheduler_organization_ids()",
  );
  return result.rows.map((row) => row.organization_id);
}
