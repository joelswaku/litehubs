import type { PoolClient } from "pg";
import { db } from "../../config/database";
import { readPrivateDocument } from "../../services/file-storage.service";
import { sendMail, sendSms } from "../../services/notification.service";
import { notifyOrganizationOwnersInTransaction } from "../notifications/notifications.service";
import { BadRequestError, ConflictError, NotFoundError } from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type {
  AppointmentCallMessageInput, AppointmentDeskInput, AppointmentServiceInput, AppointmentSiteSettingsInput, CallNextInput,
  CreateStaffAppointmentInput, ListAppointmentsInput, ListCallMessagesInput, ListDesksInput, PublicBookingInput, PublicBookingSlotsInput,
  PublicCheckInInput, UpdateAppointmentStatusInput,
} from "./appointments.validation";

export interface AppointmentContext {
  organizationId: string;
  organizationSlug: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
  permissions: string[];
}

type Scope = "organization" | "province" | "self";
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const appointmentFields = `
  a.id,a.reference,a.organization_id,a.province_id,a.site_id,a.service_id,a.assigned_member_id,a.desk_id,
  a.queue_date::text,a.queue_number,a.source,a.visitor_name,a.visitor_email::text,
  a.visitor_phone,a.reason,a.scheduled_at,a.expected_duration_minutes,a.status,
  a.checked_in_at,a.waiting_since,a.called_at,a.started_at,a.completed_at,a.cancelled_at,
  a.no_show_at,a.queue_call_message,a.notification_channel,a.last_notified_at,a.created_at,a.updated_at,
  s.code AS site_code,s.name AS site_name,p.code AS province_code,p.name AS province_name,
  svc.code AS service_code,svc.name AS service_name,assignee_user.full_name AS assigned_member_name,
  desk.code AS desk_code,desk.name AS desk_name
`;

function mapAppointment(row: Row) {
  return {
    id: row.id, reference: row.reference, source: row.source, status: row.status,
    visitor: { name: row.visitor_name, email: row.visitor_email, phone: row.visitor_phone },
    reason: row.reason, scheduledAt: row.scheduled_at,
    queue: row.queue_number ? { date: row.queue_date, number: Number(row.queue_number) } : null,
    expectedDurationMinutes: Number(row.expected_duration_minutes),
    site: { id: row.site_id, code: row.site_code, name: row.site_name },
    province: { id: row.province_id, code: row.province_code, name: row.province_name },
    service: row.service_id ? { id: row.service_id, code: row.service_code, name: row.service_name } : null,
    assignedMember: row.assigned_member_id ? { id: row.assigned_member_id, name: row.assigned_member_name } : null,
    desk: row.desk_id ? { id: row.desk_id, code: row.desk_code, name: row.desk_name } : null,
    checkedInAt: row.checked_in_at, waitingSince: row.waiting_since, calledAt: row.called_at,
    startedAt: row.started_at, completedAt: row.completed_at, cancelledAt: row.cancelled_at,
    noShowAt: row.no_show_at, queueCallMessage: row.queue_call_message ?? null, notificationChannel: row.notification_channel,
    lastNotifiedAt: row.last_notified_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function scopeOf(client: PoolClient, context: AppointmentContext): Promise<Scope> {
  if (context.isOwner) return "organization";
  const result = await client.query<{ organization_scope: boolean; province_scope: boolean }>(
    `SELECT
      EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id=mr.organization_id AND r.id=mr.role_id
        WHERE mr.organization_id=$1 AND mr.member_id=$2 AND r.data_scope='organization') AS organization_scope,
      EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id=mr.organization_id AND r.id=mr.role_id
        WHERE mr.organization_id=$1 AND mr.member_id=$2 AND r.data_scope='province') AS province_scope`,
    [context.organizationId, context.memberId],
  );
  if (result.rows[0]?.organization_scope) return "organization";
  return result.rows[0]?.province_scope ? "province" : "self";
}

async function assertProvinceAccess(client: PoolClient, context: AppointmentContext, provinceId: string) {
  if ((await scopeOf(client, context)) === "organization") return;
  const grant = await client.query(
    `SELECT 1 FROM member_provinces WHERE organization_id=$1 AND member_id=$2 AND province_id=$3`,
    [context.organizationId, context.memberId, provinceId],
  );
  if (!grant.rowCount) throw new NotFoundError("Site not found");
}

async function assertSiteAccess(client: PoolClient, context: AppointmentContext, siteId: string) {
  const site = await client.query<{ id: string; province_id: string; code: string; name: string }>(
    `SELECT id,province_id,code,name FROM sites WHERE organization_id=$1 AND id=$2 AND is_active`,
    [context.organizationId, siteId],
  );
  const row = site.rows[0];
  if (!row) throw new NotFoundError("Active site not found");
  const scope = await scopeOf(client, context);
  if (scope === "self") throw new NotFoundError("Site not found");
  if (scope === "province") await assertProvinceAccess(client, context, row.province_id);
  return row;
}

/** Claiming a desk is separate from queue selection: every desk draws from the
 * same ordered waiting list, while two agents cannot operate one desk at once. */
async function deskFor(
  client: PoolClient,
  context: AppointmentContext,
  siteId: string,
  deskId: string,
  claim = false,
) {
  const result = await client.query<Row>(
    `SELECT d.*, member_user.full_name AS active_member_name
       FROM appointment_desks d
       LEFT JOIN organization_members member
         ON member.organization_id=d.organization_id AND member.id=d.active_member_id
       LEFT JOIN users member_user ON member_user.id=member.user_id
      WHERE d.organization_id=$1 AND d.site_id=$2 AND d.id=$3 AND d.is_active
      FOR UPDATE OF d`,
    [context.organizationId, siteId, deskId],
  );
  const desk = result.rows[0];
  if (!desk) throw new BadRequestError("Choose an active desk for this site", { field: "deskId" });
  if (desk.active_member_id && desk.active_member_id !== context.memberId)
    throw new ConflictError("This desk is currently being used by another agent");
  if (claim && desk.active_member_id !== context.memberId) {
    await client.query(
      `UPDATE appointment_desks SET active_member_id=$3,claimed_at=now()
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, deskId, context.memberId],
    );
    desk.active_member_id = context.memberId;
  }
  return desk;
}

async function serviceFor(client: PoolClient, organizationId: string, siteId: string, serviceId: string | null | undefined) {
  if (!serviceId) return null;
  const result = await client.query<Row>(
    `SELECT * FROM appointment_services WHERE organization_id=$1 AND site_id=$2 AND id=$3 AND is_active`,
    [organizationId, siteId, serviceId],
  );
  if (!result.rowCount) throw new BadRequestError("Choose an active service for this site", { field: "serviceId" });
  return result.rows[0];
}

async function allocateQueue(client: PoolClient, organizationId: string, siteId: string) {
  const result = await client.query<{ last_number: number; queue_date: string }>(
    `INSERT INTO appointment_queue_counters(organization_id,site_id,queue_date,last_number)
      VALUES ($1,$2,CURRENT_DATE,1)
      ON CONFLICT(organization_id,site_id,queue_date)
      DO UPDATE SET last_number=appointment_queue_counters.last_number+1
      RETURNING last_number,queue_date::text`,
    [organizationId, siteId],
  );
  return { number: Number(result.rows[0]!.last_number), date: result.rows[0]!.queue_date };
}

async function event(client: PoolClient, organizationId: string, appointmentId: string, eventType: string, actorUserId: string | null, metadata: Record<string, unknown> = {}) {
  await client.query(
    `INSERT INTO appointment_events(organization_id,appointment_id,event_type,actor_user_id,metadata)
     VALUES($1,$2,$3,$4,$5::jsonb)`,
    [organizationId, appointmentId, eventType, actorUserId, JSON.stringify(metadata)],
  );
}

async function appointmentById(client: PoolClient, organizationId: string, appointmentId: string, lock = false) {
  const result = await client.query<Row>(
    `SELECT ${appointmentFields}
       FROM appointments a
       JOIN sites s ON s.organization_id=a.organization_id AND s.id=a.site_id
       JOIN provinces p ON p.organization_id=a.organization_id AND p.id=a.province_id
       LEFT JOIN appointment_services svc ON svc.organization_id=a.organization_id AND svc.id=a.service_id
       LEFT JOIN appointment_desks desk ON desk.organization_id=a.organization_id AND desk.id=a.desk_id
       LEFT JOIN organization_members assignee ON assignee.organization_id=a.organization_id AND assignee.id=a.assigned_member_id
       LEFT JOIN users assignee_user ON assignee_user.id=assignee.user_id
      WHERE a.organization_id=$1 AND a.id=$2${lock ? " FOR UPDATE OF a" : ""}`,
    [organizationId, appointmentId],
  );
  if (!result.rowCount) throw new NotFoundError("Appointment not found");
  return result.rows[0]!;
}

type VisitorDelivery = {
  primary: "email" | "brevo_sms" | "manual_sms" | "none";
  channels: Array<"email" | "sms" | "manual_sms">;
};

async function sendVisitorMessage(
  context: AppointmentContext,
  appointmentId: string,
  message: string,
  subject = "LiteHubs — Appointment update",
  smsContent = message,
): Promise<VisitorDelivery> {
  const appointment = await withTenantContext(context, async (client) => appointmentById(client, context.organizationId, appointmentId));
  const email = appointment.visitor_email as string | null;
  const phone = appointment.visitor_phone as string | null;
  const escaped = message.replace(/[&<>"']/g, (value) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!);
  const emailResult = email
    ? await sendMail({ to: email, subject, text: message, html: `<div style="max-width:620px;margin:0 auto;padding:24px;font:16px Arial,sans-serif;line-height:1.6;color:#1f2937"><p style="margin:0;white-space:pre-line">${escaped}</p></div>` })
    : null;
  const smsResult = phone ? await sendSms({ to: phone, content: smsContent }) : null;
  const manualSmsRequired = Boolean(phone && smsResult?.reason === "sms_not_configured");
  const primary: VisitorDelivery["primary"] = emailResult?.sent
    ? "email"
    : smsResult?.sent
      ? "brevo_sms"
      : manualSmsRequired
        ? "manual_sms"
        : "none";
  const channels: VisitorDelivery["channels"] = [
    ...(emailResult?.sent ? ["email" as const] : []),
    ...(smsResult?.sent ? ["sms" as const] : []),
    ...(manualSmsRequired ? ["manual_sms" as const] : []),
  ];

  await withTenantContext(context, async (client) => {
    if (email && emailResult) {
      await client.query(
        `INSERT INTO appointment_messages(organization_id,appointment_id,channel,status,recipient,body,sent_at,error_message,created_by)
         VALUES($1,$2,'email',$3,$4,$5,$6,$7,$8)`,
        [context.organizationId, appointmentId, emailResult.sent ? "sent" : "failed", email, message, emailResult.sent ? new Date() : null, emailResult.reason ?? null, context.userId || null],
      );
    }
    if (phone && smsResult) {
      if (manualSmsRequired) {
        await client.query(
          `INSERT INTO appointment_messages(organization_id,appointment_id,channel,status,recipient,body,created_by)
           VALUES($1,$2,'manual_sms','pending_manual',$3,$4,$5)`,
          [context.organizationId, appointmentId, phone, smsContent, context.userId || null],
        );
      } else {
        await client.query(
          `INSERT INTO appointment_messages(organization_id,appointment_id,channel,status,recipient,body,sent_at,error_message,created_by)
           VALUES($1,$2,'brevo_sms',$3,$4,$5,$6,$7,$8)`,
          [context.organizationId, appointmentId, smsResult.sent ? "sent" : "failed", smsResult.recipient ?? phone, smsContent, smsResult.sent ? new Date() : null, smsResult.reason ?? null, context.userId || null],
        );
      }
    }
    await client.query(`UPDATE appointments SET notification_channel=$3,last_notified_at=now() WHERE organization_id=$1 AND id=$2`, [context.organizationId, appointmentId, primary]);
  });
  return { primary, channels };
}

async function lookupPublicSite(orgSlug: string, siteCode: string) {
  const result = await db.query<Row>(
    `SELECT organization_id,organization_slug AS slug,organization_name AS display_name,
            organization_timezone AS timezone,site_id,site_code,site_name,province_id,
            public_booking_enabled,qr_checkin_enabled,queue_display_enabled,checkin_token,
            booking_opens_at,booking_closes_at,slot_interval_minutes,default_service_minutes,
            welcome_message,online_service_available,qr_service_available
       FROM public_appointment_sites($1,$2)`,
    [orgSlug, siteCode],
  );
  const site = result.rows[0];
  if (!site) throw new NotFoundError("This appointment site is not available");
  return site;
}

function publicContext(site: Row): AppointmentContext {
  return { organizationId: site.organization_id, organizationSlug: site.slug, userId: "", memberId: "", isOwner: false, permissions: [] };
}

function localMinutes(instant: Date, timeZone: string | null | undefined) {
  const safeTimeZone = timeZone || "UTC";
  try {
    const values = new Intl.DateTimeFormat("en-GB", { timeZone: safeTimeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
    const hour = Number(values.find((value) => value.type === "hour")?.value ?? "0");
    const minute = Number(values.find((value) => value.type === "minute")?.value ?? "0");
    return hour * 60 + minute;
  } catch {
    return instant.getUTCHours() * 60 + instant.getUTCMinutes();
  }
}

function clockMinutes(value: string) {
  const [hour = "0", minute = "0"] = value.slice(0, 5).split(":");
  return Number(hour) * 60 + Number(minute);
}

function zonedParts(instant: Date, timeZone: string | null | undefined) {
  const safeTimeZone = timeZone || "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: safeTimeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
    return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
  } catch {
    return { year: instant.getUTCFullYear(), month: instant.getUTCMonth() + 1, day: instant.getUTCDate(), hour: instant.getUTCHours(), minute: instant.getUTCMinutes() };
  }
}

function localDateTimeToInstant(date: string, minutes: number, timeZone: string | null | undefined) {
  const [year, month, day] = date.split("-").map(Number);
  const hour = Math.floor(minutes / 60); const minute = minutes % 60;
  const naive = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, hour, minute);
  const offsetAt = (instant: Date) => {
    const local = zonedParts(instant, timeZone);
    return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - instant.getTime();
  };
  let result = new Date(naive - offsetAt(new Date(naive)));
  result = new Date(naive - offsetAt(result));
  return result;
}

function localClock(instant: Date, timeZone: string | null | undefined) {
  const local = zonedParts(instant, timeZone);
  return `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
}
function assertPublicBookingSlot(site: Row, scheduledAt: Date, durationMinutes: number) {
  const selected = localMinutes(scheduledAt, site.timezone);
  const opens = clockMinutes(String(site.booking_opens_at));
  const closes = clockMinutes(String(site.booking_closes_at));
  const interval = Number(site.slot_interval_minutes ?? 30);
  if (selected < opens || selected + durationMinutes > closes)
    throw new BadRequestError("Choose a time within this site's booking hours", { field: "scheduledAt" });
  if ((selected - opens) % interval !== 0)
    throw new BadRequestError("Choose an available appointment interval", { field: "scheduledAt" });
}

function settingsMap(row: Row) {
  return {
    id: row.id ?? null,
    site: { id: row.site_id, code: row.site_code, name: row.site_name, provinceId: row.province_id, provinceName: row.province_name },
    publicBookingEnabled: Boolean(row.public_booking_enabled), qrCheckinEnabled: Boolean(row.qr_checkin_enabled),
    queueDisplayEnabled: Boolean(row.queue_display_enabled), checkinToken: row.checkin_token ?? null,
    bookingOpensAt: String(row.booking_opens_at ?? "08:00").slice(0, 5), bookingClosesAt: String(row.booking_closes_at ?? "17:00").slice(0, 5),
    slotIntervalMinutes: Number(row.slot_interval_minutes ?? 30), defaultServiceMinutes: Number(row.default_service_minutes ?? 20), welcomeMessage: row.welcome_message ?? null, queueCallMessage: row.default_queue_call_message ?? null, idleDisplayTitle: row.idle_display_title ?? null, idleDisplayMessage: row.idle_display_message ?? null,
    idleDisplayDocument: row.idle_display_document_id ? {
      id: row.idle_display_document_id,
      title: row.idle_display_document_title ?? row.idle_display_document_file_name ?? null,
      fileName: row.idle_display_document_file_name ?? null,
      mimeType: row.idle_display_document_mime_type ?? null,
    } : null,
  };
}

export async function listAppointments(context: AppointmentContext, input: ListAppointmentsInput) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context);
    const values: unknown[] = [context.organizationId];
    const terms = ["a.organization_id=$1"];
    if (scope === "self") terms.push("FALSE");
    if (scope === "province") { values.push(context.memberId); terms.push(`EXISTS (SELECT 1 FROM member_provinces mp WHERE mp.organization_id=a.organization_id AND mp.member_id=$${values.length} AND mp.province_id=a.province_id)`); }
    if (input.siteId) { await assertSiteAccess(client, context, input.siteId); values.push(input.siteId); terms.push(`a.site_id=$${values.length}`); }
    if (input.status) { values.push(input.status); terms.push(`a.status=$${values.length}`); }
    if (input.date) { values.push(input.date); terms.push(`COALESCE(a.queue_date,a.scheduled_at::date)=$${values.length}::date`); }
    if (input.search) { values.push(`%${input.search}%`); terms.push(`(a.visitor_name ILIKE $${values.length} OR a.visitor_email::text ILIKE $${values.length} OR a.visitor_phone ILIKE $${values.length} OR COALESCE(svc.name,'') ILIKE $${values.length})`); }
    values.push(input.limit + 1);
    const limitPosition = values.length;
    values.push(input.offset);
    const offsetPosition = values.length;
    const rows = await client.query<Row>(
      `SELECT ${appointmentFields} FROM appointments a
       JOIN sites s ON s.organization_id=a.organization_id AND s.id=a.site_id
       JOIN provinces p ON p.organization_id=a.organization_id AND p.id=a.province_id
       LEFT JOIN appointment_services svc ON svc.organization_id=a.organization_id AND svc.id=a.service_id
       LEFT JOIN appointment_desks desk ON desk.organization_id=a.organization_id AND desk.id=a.desk_id
       LEFT JOIN organization_members assignee ON assignee.organization_id=a.organization_id AND assignee.id=a.assigned_member_id
       LEFT JOIN users assignee_user ON assignee_user.id=assignee.user_id
       WHERE ${terms.join(" AND ")}
       ORDER BY CASE a.status WHEN 'serving' THEN 0 WHEN 'called' THEN 1 WHEN 'waiting' THEN 2 WHEN 'checked_in' THEN 3 WHEN 'scheduled' THEN 4 ELSE 5 END,
                a.queue_date DESC NULLS LAST,a.queue_number ASC NULLS LAST,a.scheduled_at ASC NULLS LAST,a.created_at DESC
       LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
      values,
    );
    const hasMore = rows.rows.length > input.limit;
    const appointments = rows.rows.slice(0, input.limit).map(mapAppointment);
    return { appointments, page: { offset: input.offset, limit: input.limit, hasMore, nextOffset: hasMore ? input.offset + input.limit : null } };
  });
}

export async function summary(context: AppointmentContext) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context); const values: unknown[] = [context.organizationId]; let filter = "";
    if (scope === "self") filter = " AND FALSE";
    if (scope === "province") { values.push(context.memberId); filter = " AND EXISTS (SELECT 1 FROM member_provinces mp WHERE mp.organization_id=a.organization_id AND mp.member_id=$2 AND mp.province_id=a.province_id)"; }
    const result = await client.query<Row>(
      `SELECT COUNT(*) FILTER (WHERE a.queue_date=CURRENT_DATE AND a.status IN ('waiting','checked_in'))::int AS waiting,
         COUNT(*) FILTER (WHERE a.queue_date=CURRENT_DATE AND a.status='called')::int AS called,
         COUNT(*) FILTER (WHERE a.queue_date=CURRENT_DATE AND a.status='serving')::int AS serving,
         COUNT(*) FILTER (WHERE a.scheduled_at::date=CURRENT_DATE AND a.status='scheduled')::int AS scheduled_today,
         COUNT(*) FILTER (WHERE a.queue_date=CURRENT_DATE AND a.status='completed')::int AS completed_today
       FROM appointments a WHERE a.organization_id=$1${filter}`, values);
    return result.rows[0] ?? { waiting: 0, called: 0, serving: 0, scheduled_today: 0, completed_today: 0 };
  });
}

export async function listSiteSettings(context: AppointmentContext) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context); const values: unknown[] = [context.organizationId]; let filter = "";
    if (scope === "self") filter = " AND FALSE";
    if (scope === "province") { values.push(context.memberId); filter = " AND EXISTS (SELECT 1 FROM member_provinces mp WHERE mp.organization_id=s.organization_id AND mp.member_id=$2 AND mp.province_id=s.province_id)"; }
    const result = await client.query<Row>(
      `SELECT settings.*,s.id AS site_id,s.code AS site_code,s.name AS site_name,s.province_id,p.name AS province_name, idle_document.title AS idle_display_document_title,idle_document.file_name AS idle_display_document_file_name,idle_document.mime_type AS idle_display_document_mime_type
       FROM sites s JOIN provinces p ON p.organization_id=s.organization_id AND p.id=s.province_id
       LEFT JOIN appointment_site_settings settings ON settings.organization_id=s.organization_id AND settings.site_id=s.id
       LEFT JOIN documents idle_document ON idle_document.organization_id=settings.organization_id AND idle_document.id=settings.idle_display_document_id
       WHERE s.organization_id=$1 AND s.is_active${filter} ORDER BY p.name,s.name`, values);
    return result.rows.map((row) => { const value = settingsMap(row); if (!context.permissions.includes("appointments.create")) value.checkinToken = null; return value; });
  });
}

export async function saveSiteSettings(context: AppointmentContext, input: AppointmentSiteSettingsInput) {
  return withTenantContext(context, async (client) => {
    await assertSiteAccess(client, context, input.siteId);
    if (input.idleDisplayDocumentId) {
      const selectedVideo = await client.query<Row>(
        `SELECT id FROM documents WHERE organization_id=$1 AND id=$2 AND mime_type IN ('video/mp4','video/webm')`,
        [context.organizationId, input.idleDisplayDocumentId],
      );
      if (!selectedVideo.rowCount)
        throw new BadRequestError("Choose a private MP4 or WebM video from this company", { field: "idleDisplayDocumentId" });
    }
    const result = await client.query<Row>(
      `INSERT INTO appointment_site_settings(organization_id,site_id,public_booking_enabled,qr_checkin_enabled,queue_display_enabled,booking_opens_at,booking_closes_at,slot_interval_minutes,default_service_minutes,welcome_message,default_queue_call_message,idle_display_title,idle_display_message,idle_display_document_id,created_by)
       VALUES($1,$2,$3,$4,$5,$6::time,$7::time,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT(organization_id,site_id) DO UPDATE SET public_booking_enabled=EXCLUDED.public_booking_enabled,qr_checkin_enabled=EXCLUDED.qr_checkin_enabled,
         queue_display_enabled=EXCLUDED.queue_display_enabled,booking_opens_at=EXCLUDED.booking_opens_at,booking_closes_at=EXCLUDED.booking_closes_at,
         slot_interval_minutes=EXCLUDED.slot_interval_minutes,default_service_minutes=EXCLUDED.default_service_minutes,welcome_message=EXCLUDED.welcome_message,default_queue_call_message=EXCLUDED.default_queue_call_message,
         idle_display_title=EXCLUDED.idle_display_title,idle_display_message=EXCLUDED.idle_display_message,idle_display_document_id=EXCLUDED.idle_display_document_id
       RETURNING *`,
      [context.organizationId,input.siteId,input.publicBookingEnabled,input.qrCheckinEnabled,input.queueDisplayEnabled,input.bookingOpensAt,input.bookingClosesAt,input.slotIntervalMinutes,input.defaultServiceMinutes,input.welcomeMessage ?? null,input.queueCallMessage ?? null,input.idleDisplayTitle ?? null,input.idleDisplayMessage ?? null,input.idleDisplayDocumentId ?? null,context.userId],
    );
    const site = await client.query<Row>(`SELECT s.code AS site_code,s.name AS site_name,s.province_id,p.name AS province_name,idle_document.title AS idle_display_document_title,idle_document.file_name AS idle_display_document_file_name,idle_document.mime_type AS idle_display_document_mime_type FROM sites s JOIN provinces p ON p.organization_id=s.organization_id AND p.id=s.province_id LEFT JOIN appointment_site_settings settings ON settings.organization_id=s.organization_id AND settings.site_id=s.id LEFT JOIN documents idle_document ON idle_document.organization_id=settings.organization_id AND idle_document.id=settings.idle_display_document_id WHERE s.organization_id=$1 AND s.id=$2`,[context.organizationId,input.siteId]);
    return settingsMap({ ...result.rows[0], ...site.rows[0] });
  });
}

export async function listServices(context: AppointmentContext, siteId?: string) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context); const values: unknown[] = [context.organizationId]; const terms = ["svc.organization_id=$1"];
    if (scope === "self") terms.push("FALSE");
    if (scope === "province") { values.push(context.memberId); terms.push(`EXISTS (SELECT 1 FROM member_provinces mp WHERE mp.organization_id=svc.organization_id AND mp.member_id=$${values.length} AND mp.province_id=s.province_id)`); }
    if (siteId) { await assertSiteAccess(client, context, siteId); values.push(siteId); terms.push(`svc.site_id=$${values.length}`); }
    const result = await client.query<Row>(
      `SELECT svc.*,s.code AS site_code,s.name AS site_name,s.province_id FROM appointment_services svc JOIN sites s ON s.organization_id=svc.organization_id AND s.id=svc.site_id WHERE ${terms.join(" AND ")} ORDER BY s.name,svc.is_active DESC,svc.name`, values);
    return result.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, description: row.description, durationMinutes: Number(row.duration_minutes),
      allowsOnlineBooking: row.allows_online_booking, allowsQrCheckin: row.allows_qr_checkin, isActive: row.is_active, site: { id: row.site_id, code: row.site_code, name: row.site_name, provinceId: row.province_id } }));
  });
}

export async function saveService(context: AppointmentContext, input: AppointmentServiceInput, serviceId?: string) {
  return withTenantContext(context, async (client) => {
    await assertSiteAccess(client, context, input.siteId);
    if (serviceId) { const existing = await client.query<Row>(`SELECT site_id FROM appointment_services WHERE organization_id=$1 AND id=$2`, [context.organizationId, serviceId]); const existingRow = existing.rows[0]; if (!existingRow) throw new NotFoundError("Service not found"); await assertSiteAccess(client, context, existingRow.site_id); }
    try {
      const result = serviceId
        ? await client.query<Row>(`UPDATE appointment_services SET site_id=$3,code=$4,name=$5,description=$6,duration_minutes=$7,allows_online_booking=$8,allows_qr_checkin=$9,is_active=$10 WHERE organization_id=$1 AND id=$2 RETURNING *`,[context.organizationId,serviceId,input.siteId,input.code,input.name,input.description ?? null,input.durationMinutes,input.allowsOnlineBooking,input.allowsQrCheckin,input.isActive])
        : await client.query<Row>(`INSERT INTO appointment_services(organization_id,site_id,code,name,description,duration_minutes,allows_online_booking,allows_qr_checkin,is_active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[context.organizationId,input.siteId,input.code,input.name,input.description ?? null,input.durationMinutes,input.allowsOnlineBooking,input.allowsQrCheckin,input.isActive,context.userId]);
      const row = result.rows[0]!; return { id: row.id, code: row.code, name: row.name, description: row.description, durationMinutes: Number(row.duration_minutes), allowsOnlineBooking: row.allows_online_booking, allowsQrCheckin: row.allows_qr_checkin, isActive: row.is_active, siteId: row.site_id };
    } catch (error: unknown) { if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") throw new ConflictError("A service with that code already exists for this site"); throw error; }
  });
}

/**
 * Services are retired instead of hard-deleted. Existing appointments retain their
 * service relationship and audit trail, while the retired service immediately
 * disappears from public booking and QR check-in choices.
 */
export async function deactivateService(context: AppointmentContext, serviceId: string) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      `SELECT id,site_id,name,is_active FROM appointment_services
       WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [context.organizationId, serviceId],
    );
    const service = result.rows[0];
    if (!service) throw new NotFoundError("Service not found");
    await assertSiteAccess(client, context, service.site_id);
    await client.query(
      `UPDATE appointment_services SET is_active=FALSE
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, serviceId],
    );
    return { id: service.id, name: service.name, isActive: false };
  });
}
export async function listCallMessages(context: AppointmentContext, input: ListCallMessagesInput) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context);
    const values: unknown[] = [context.organizationId];
    const terms = ["m.organization_id=$1"];
    if (scope === "self") terms.push("FALSE");
    if (scope === "province") {
      values.push(context.memberId);
      terms.push(`EXISTS (SELECT 1 FROM member_provinces mp WHERE mp.organization_id=m.organization_id AND mp.member_id=$${values.length} AND mp.province_id=s.province_id)`);
    }
    if (input.siteId) {
      await assertSiteAccess(client, context, input.siteId);
      values.push(input.siteId);
      terms.push(`m.site_id=$${values.length}`);
    }
    const result = await client.query<Row>(
      `SELECT m.*,s.code AS site_code,s.name AS site_name
         FROM appointment_queue_message_templates m
         JOIN sites s ON s.organization_id=m.organization_id AND s.id=m.site_id
        WHERE ${terms.join(" AND ")}
        ORDER BY s.name,m.is_active DESC,m.title`,
      values,
    );
    return result.rows.map((row) => ({
      id: row.id, title: row.title, content: row.content, isActive: Boolean(row.is_active),
      site: { id: row.site_id, code: row.site_code, name: row.site_name },
    }));
  });
}

export async function saveCallMessage(context: AppointmentContext, input: AppointmentCallMessageInput, messageTemplateId?: string) {
  return withTenantContext(context, async (client) => {
    await assertSiteAccess(client, context, input.siteId);
    if (messageTemplateId) {
      const existing = await client.query<Row>(
        `SELECT site_id FROM appointment_queue_message_templates WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, messageTemplateId],
      );
      if (!existing.rows[0]) throw new NotFoundError("Call message not found");
      await assertSiteAccess(client, context, existing.rows[0].site_id);
    }
    if (input.isActive) {
      const active = await client.query<Row>(
        `SELECT count(*)::int AS count
           FROM appointment_queue_message_templates
          WHERE organization_id=$1 AND site_id=$2 AND is_active
            AND ($3::uuid IS NULL OR id <> $3)`,
        [context.organizationId, input.siteId, messageTemplateId ?? null],
      );
      if (Number(active.rows[0]?.count ?? 0) >= 5)
        throw new BadRequestError("A site can have no more than five active call messages");
    }
    try {
      const result = messageTemplateId
        ? await client.query<Row>(
          `UPDATE appointment_queue_message_templates
             SET site_id=$3,title=$4,content=$5,is_active=$6
           WHERE organization_id=$1 AND id=$2 RETURNING *`,
          [context.organizationId, messageTemplateId, input.siteId, input.title, input.content, input.isActive],
        )
        : await client.query<Row>(
          `INSERT INTO appointment_queue_message_templates(organization_id,site_id,title,content,is_active,created_by)
           VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          [context.organizationId, input.siteId, input.title, input.content, input.isActive, context.userId],
        );
      const row = result.rows[0]!;
      return { id: row.id, title: row.title, content: row.content, isActive: Boolean(row.is_active), siteId: row.site_id };
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505")
        throw new ConflictError("A call message with that title already exists for this site");
      throw error;
    }
  });
}

export async function deactivateCallMessage(context: AppointmentContext, messageTemplateId: string) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      `SELECT id,site_id,title FROM appointment_queue_message_templates
       WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [context.organizationId, messageTemplateId],
    );
    const template = result.rows[0];
    if (!template) throw new NotFoundError("Call message not found");
    await assertSiteAccess(client, context, template.site_id);
    await client.query(
      `UPDATE appointment_queue_message_templates SET is_active=FALSE
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, messageTemplateId],
    );
    return { id: template.id, title: template.title, isActive: false };
  });
}
export async function listDesks(context: AppointmentContext, input: ListDesksInput) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context);
    const values: unknown[] = [context.organizationId];
    const terms = ["d.organization_id=$1"];
    if (scope === "self") terms.push("FALSE");
    if (scope === "province") {
      values.push(context.memberId);
      terms.push(`EXISTS (SELECT 1 FROM member_provinces mp WHERE mp.organization_id=d.organization_id AND mp.member_id=$${values.length} AND mp.province_id=s.province_id)`);
    }
    if (input.siteId) {
      await assertSiteAccess(client, context, input.siteId);
      values.push(input.siteId);
      terms.push(`d.site_id=$${values.length}`);
    }
    const result = await client.query<Row>(
      `SELECT d.*,s.code AS site_code,s.name AS site_name,
              active_user.full_name AS active_member_name
         FROM appointment_desks d
         JOIN sites s ON s.organization_id=d.organization_id AND s.id=d.site_id
         LEFT JOIN organization_members active_member
           ON active_member.organization_id=d.organization_id AND active_member.id=d.active_member_id
         LEFT JOIN users active_user ON active_user.id=active_member.user_id
        WHERE ${terms.join(" AND ")}
        ORDER BY s.name,d.is_active DESC,d.name`,
      values,
    );
    return result.rows.map((row) => ({
      id: row.id, code: row.code, name: row.name, isActive: Boolean(row.is_active),
      claimedAt: row.claimed_at ?? null,
      site: { id: row.site_id, code: row.site_code, name: row.site_name },
      activeMember: row.active_member_id ? { id: row.active_member_id, name: row.active_member_name } : null,
      isCurrentOperator: row.active_member_id === context.memberId,
    }));
  });
}

export async function saveDesk(context: AppointmentContext, input: AppointmentDeskInput, deskId?: string) {
  return withTenantContext(context, async (client) => {
    await assertSiteAccess(client, context, input.siteId);
    if (deskId) {
      const existing = await client.query<Row>(
        `SELECT site_id FROM appointment_desks WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, deskId],
      );
      const row = existing.rows[0];
      if (!row) throw new NotFoundError("Desk not found");
      await assertSiteAccess(client, context, row.site_id);
    }
    try {
      const result = deskId
        ? await client.query<Row>(
          `UPDATE appointment_desks SET site_id=$3,code=$4,name=$5,is_active=$6,
             active_member_id=CASE WHEN $6 THEN active_member_id ELSE NULL END,
             claimed_at=CASE WHEN $6 THEN claimed_at ELSE NULL END
           WHERE organization_id=$1 AND id=$2 RETURNING *`,
          [context.organizationId, deskId, input.siteId, input.code, input.name, input.isActive],
        )
        : await client.query<Row>(
          `INSERT INTO appointment_desks(organization_id,site_id,code,name,is_active,created_by)
           VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          [context.organizationId, input.siteId, input.code, input.name, input.isActive, context.userId],
        );
      const desk = result.rows[0]!;
      return { id: desk.id, code: desk.code, name: desk.name, isActive: Boolean(desk.is_active), siteId: desk.site_id };
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505")
        throw new ConflictError("A desk with that code already exists for this site");
      throw error;
    }
  });
}

/** An agent may hand the desk to the next shift; owners can resolve a stuck desk. */
export async function releaseDesk(context: AppointmentContext, deskId: string) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      `SELECT id,site_id,name,active_member_id FROM appointment_desks
       WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [context.organizationId, deskId],
    );
    const desk = result.rows[0];
    if (!desk) throw new NotFoundError("Desk not found");
    await assertSiteAccess(client, context, desk.site_id);
    if (desk.active_member_id && desk.active_member_id !== context.memberId && !context.isOwner)
      throw new ConflictError("Only the agent using this desk or an owner can release it");
    await client.query(
      `UPDATE appointment_desks SET active_member_id=NULL,claimed_at=NULL
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, deskId],
    );
    return { id: desk.id, name: desk.name, released: true };
  });
}
/** Deactivation preserves assignment history while making the desk unavailable. */
export async function deactivateDesk(context: AppointmentContext, deskId: string) {
  return withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      `SELECT id,site_id,name FROM appointment_desks WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [context.organizationId, deskId],
    );
    const desk = result.rows[0];
    if (!desk) throw new NotFoundError("Desk not found");
    await assertSiteAccess(client, context, desk.site_id);
    await client.query(
      `UPDATE appointment_desks SET is_active=FALSE,active_member_id=NULL,claimed_at=NULL
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, deskId],
    );
    return { id: desk.id, name: desk.name, isActive: false };
  });
}
export async function createStaffAppointment(context: AppointmentContext, input: CreateStaffAppointmentInput) {
  const created = await withTenantContext(context, async (client) => {
    const site = await assertSiteAccess(client, context, input.siteId);
    const service = await serviceFor(client, context.organizationId, input.siteId, input.serviceId);
    if (input.assignedMemberId) {
      const member = await client.query(
        `SELECT 1 FROM organization_members WHERE organization_id=$1 AND id=$2 AND status='active'`,
        [context.organizationId, input.assignedMemberId],
      );
      if (!member.rowCount)
        throw new BadRequestError("Choose an active team member", { field: "assignedMemberId" });
    }
    const result = await client.query<Row>(
      `INSERT INTO appointments(organization_id,province_id,site_id,service_id,assigned_member_id,source,visitor_name,visitor_email,visitor_phone,reason,scheduled_at,expected_duration_minutes,status,created_by)
       VALUES($1,$2,$3,$4,$5,'staff',$6,$7,$8,$9,$10,$11,'scheduled',$12) RETURNING id`,
      [
        context.organizationId, site.province_id, input.siteId, input.serviceId ?? null,
        input.assignedMemberId ?? null, input.visitorName, input.visitorEmail ?? null,
        input.visitorPhone ?? null, input.reason ?? null, input.scheduledAt ?? null,
        Number(service?.duration_minutes ?? 20), context.userId,
      ],
    );
    await event(client, context.organizationId, result.rows[0]!.id, "created_by_staff", context.userId);
    return mapAppointment(await appointmentById(client, context.organizationId, result.rows[0]!.id));
  });

  // A staff-recorded visit must give the visitor the same confirmation as an
  // online booking. Delivery failures are stored by sendVisitorMessage but
  // never prevent the appointment itself from being created.
  const when = created.scheduledAt
    ? new Date(created.scheduledAt).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" })
    : "horaire à confirmer";
  const serviceName = created.service?.name ?? "votre rendez-vous";
  const message = [
    `Bonjour ${created.visitor.name},`,
    "",
    "Votre rendez-vous a été enregistré par l’équipe Congo Omega.",
    `Référence : ${created.reference}`,
    `Site : ${created.site.name}`,
    `Service : ${serviceName}`,
    `Date et heure : ${when}`,
    "",
    "Conservez cette référence. Nous vous informerons si votre rendez-vous change ou lorsque votre tour sera appelé.",
  ].join("\n");
  const sms = `Congo Omega: RDV ${created.reference} enregistré. ${serviceName}, ${created.site.name}, ${when}. Gardez ce code.`;
  const delivery = await sendVisitorMessage(
    context,
    created.id,
    message,
    "Congo Omega — Rendez-vous enregistré",
    sms,
  );

  return { ...created, notificationChannel: delivery.primary, notificationChannels: delivery.channels };
}
export async function checkInStaffAppointment(context: AppointmentContext, appointmentId: string) {
  return withTenantContext(context, async (client) => {
    const appointment = await appointmentById(client,context.organizationId,appointmentId,true); await assertSiteAccess(client,context,appointment.site_id);
    if (["completed","cancelled","no_show"].includes(appointment.status)) throw new BadRequestError("This appointment can no longer be checked in");
    if (appointment.queue_number) return mapAppointment(appointment);
    const ticket = await allocateQueue(client,context.organizationId,appointment.site_id);
    await client.query(`UPDATE appointments SET queue_date=$3::date,queue_number=$4,status='waiting',checked_in_at=now(),waiting_since=now() WHERE organization_id=$1 AND id=$2`,[context.organizationId,appointmentId,ticket.date,ticket.number]);
    await event(client,context.organizationId,appointmentId,"checked_in_by_staff",context.userId,{ ticket: ticket.number });
    return mapAppointment(await appointmentById(client,context.organizationId,appointmentId));
  });
}

export async function updateStatus(context: AppointmentContext, appointmentId: string, input: UpdateAppointmentStatusInput) {
  const updated = await withTenantContext(context, async (client) => {
    const appointment = await appointmentById(client, context.organizationId, appointmentId, true);
    await assertSiteAccess(client, context, appointment.site_id);
    const allowed: Record<string, string[]> = {
      scheduled: ["waiting", "cancelled", "no_show"],
      waiting: ["called", "serving", "completed", "cancelled", "no_show"],
      called: ["serving", "waiting", "completed", "cancelled", "no_show"],
      serving: ["completed"], completed: [], cancelled: [], no_show: [],
    };
    if (!allowed[appointment.status]?.includes(input.status))
      throw new BadRequestError("This status change is not allowed");

    const needsDesk = Boolean(appointment.queue_number) && ["called", "serving", "completed"].includes(input.status);
    const effectiveDeskId = input.deskId ?? appointment.desk_id ?? null;
    if (needsDesk && !effectiveDeskId)
      throw new BadRequestError("Choose a desk before calling or serving a visitor", { field: "deskId" });
    let desk: Row | null = null;
    if (effectiveDeskId) {
      desk = await deskFor(client, context, appointment.site_id, effectiveDeskId, true);
      if (appointment.desk_id && appointment.desk_id !== effectiveDeskId)
        throw new ConflictError("This visitor is currently assigned to another desk");
    }

    const stamp: Record<string, string> = {
      called: "called_at=now()", serving: "started_at=now()", completed: "completed_at=now()",
      cancelled: "cancelled_at=now()", no_show: "no_show_at=now()",
    };
    await client.query(
      `UPDATE appointments SET status=$3,desk_id=COALESCE($4,desk_id)${stamp[input.status] ? "," + stamp[input.status] : ""}
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, appointmentId, input.status, effectiveDeskId],
    );
    await event(client, context.organizationId, appointmentId, `status_${input.status}`, context.userId, {
      note: input.note ?? null, deskId: desk?.id ?? appointment.desk_id ?? null, deskName: desk?.name ?? null,
    });
    return mapAppointment(await appointmentById(client, context.organizationId, appointmentId));
  });
  if (input.status === "called") {
    const ticket = updated.queue ? `#${updated.queue.number}` : "";
    const destination = updated.desk?.name ? `au ${updated.desk.name}` : "à l’accueil";
    const message = `Bonjour ${updated.visitor.name},\n\nVotre numéro ${ticket} est appelé pour ${updated.service?.name ?? "votre rendez-vous"} à ${updated.site.name}.\n\nPrésentez-vous maintenant ${destination}.`;
    const sms = `Congo Omega: numéro ${ticket} appelé pour ${updated.service?.name ?? "votre rendez-vous"}. Présentez-vous ${destination}.`;
    await sendVisitorMessage(context, updated.id, message, "LiteHubs — Votre tour", sms);
  }
  return updated;
}

/**
 * Bank-style queue operation: complete only the visitor served at this desk,
 * then atomically claim the next person from the one shared site queue.
 */
export async function completeAndCallNext(context: AppointmentContext, input: CallNextInput) {
  const target = await withTenantContext(context, async (client) => {
    await assertSiteAccess(client, context, input.siteId);
    const desk = await deskFor(client, context, input.siteId, input.deskId, true);

    const serving = await client.query<Row>(
      `SELECT id FROM appointments
       WHERE organization_id=$1 AND site_id=$2 AND queue_date=CURRENT_DATE
         AND desk_id=$3 AND status IN ('serving','called')
       ORDER BY CASE status WHEN 'serving' THEN 0 ELSE 1 END,called_at
       LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [context.organizationId, input.siteId, input.deskId],
    );
    if (serving.rows[0]) {
      await client.query(
        `UPDATE appointments SET status='completed',completed_at=now()
         WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, serving.rows[0].id],
      );
      await event(client, context.organizationId, serving.rows[0].id, "completed_and_next", context.userId, {
        deskId: desk.id, deskName: desk.name,
      });
    }

    const next = await client.query<Row>(
      `SELECT id FROM appointments
       WHERE organization_id=$1 AND site_id=$2 AND queue_date=CURRENT_DATE
         AND desk_id IS NULL AND status IN ('waiting','checked_in')
       ORDER BY queue_number,waiting_since,created_at
       LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [context.organizationId, input.siteId],
    );
    if (!next.rows[0]) return null;
    let queueCallMessage: string | null = null;
    if (input.messageTemplateId) {
      const messageTemplate = await client.query<Row>(
        `SELECT content FROM appointment_queue_message_templates
         WHERE organization_id=$1 AND site_id=$2 AND id=$3 AND is_active`,
        [context.organizationId, input.siteId, input.messageTemplateId],
      );
      if (!messageTemplate.rows[0]) throw new BadRequestError("This call message is not available for the selected site");
      queueCallMessage = messageTemplate.rows[0].content;
    }
    await client.query(
      `UPDATE appointments SET desk_id=$3,status='called',called_at=now(),queue_call_message=$4
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, next.rows[0].id, input.deskId, queueCallMessage],
    );
    await event(client, context.organizationId, next.rows[0].id, "called_next", context.userId, {
      deskId: desk.id, deskName: desk.name,
    });
    return mapAppointment(await appointmentById(client, context.organizationId, next.rows[0].id));
  });
  if (!target) return { appointment: null, notificationChannel: null, notificationChannels: [] };
  const ticket = target.queue ? `#${target.queue.number}` : "";
  const destination = target.desk?.name ? `au ${target.desk.name}` : "à l’accueil";
  const queueInstruction = target.queueCallMessage?.trim();
  const message = queueInstruction
    ? `Bonjour ${target.visitor.name},\n\nVotre numéro ${ticket} est appelé pour ${target.service?.name ?? "votre rendez-vous"} à ${target.site.name}.\n\n${queueInstruction}`
    : `Bonjour ${target.visitor.name},\n\nVotre numéro ${ticket} est appelé pour ${target.service?.name ?? "votre rendez-vous"} à ${target.site.name}.\n\nPrésentez-vous maintenant ${destination}.`;
  const sms = queueInstruction
    ? `Congo Omega: numéro ${ticket} appelé pour ${target.service?.name ?? "votre rendez-vous"}. ${queueInstruction}`
    : `Congo Omega: numéro ${ticket} appelé pour ${target.service?.name ?? "votre rendez-vous"}. Présentez-vous ${destination}.`;
  const delivery = await sendVisitorMessage(context, target.id, message, "LiteHubs — Votre tour", sms);
  return { appointment: target, notificationChannel: delivery.primary, notificationChannels: delivery.channels };
}
/** Public opt-in directory. Only active sites that have explicitly enabled
 * online booking and offer at least one active online service are exposed. */
export async function publicBookingDirectory() {
  const result = await db.query<Row>(
    `SELECT organization_slug,organization_name,site_code,site_name,province_name,
            booking_opens_at,booking_closes_at
       FROM public_appointment_sites(NULL,NULL)
      WHERE public_booking_enabled AND online_service_available
      ORDER BY organization_name,province_name,site_name`,
  );
  return result.rows.map((row) => ({
    organizationSlug: row.organization_slug,
    organizationName: row.organization_name,
    code: row.site_code,
    name: row.site_name,
    provinceName: row.province_name,
    bookingOpensAt: String(row.booking_opens_at).slice(0, 5),
    bookingClosesAt: String(row.booking_closes_at).slice(0, 5),
  }));
}
export async function publicCatalog(orgSlug: string) {
  const result = await db.query<Row>(
    `SELECT organization_name AS display_name,site_code,site_name,province_name,
            booking_opens_at,booking_closes_at,slot_interval_minutes
       FROM public_appointment_sites($1,NULL)
      WHERE public_booking_enabled AND online_service_available
      ORDER BY province_name,site_name`, [orgSlug]);
  return result.rows.map((row) => ({ code: row.site_code, name: row.site_name, provinceName: row.province_name, bookingOpensAt: String(row.booking_opens_at).slice(0,5), bookingClosesAt: String(row.booking_closes_at).slice(0,5), slotIntervalMinutes: Number(row.slot_interval_minutes), organizationName: row.display_name }));
}

export async function publicSiteCatalog(orgSlug: string, siteCode: string, purpose: "booking" | "checkin") {
  const site = await lookupPublicSite(orgSlug,siteCode);
  if (purpose === "booking" && !site.public_booking_enabled) throw new NotFoundError("Online booking is not enabled for this site");
  if (purpose === "checkin" && !site.qr_checkin_enabled) throw new NotFoundError("QR check-in is not enabled for this site");
  const context = publicContext(site);
  return withTenantContext(context, async (client) => {
    const services = await client.query<Row>(`SELECT id,code,name,description,duration_minutes FROM appointment_services WHERE organization_id=$1 AND site_id=$2 AND is_active AND ${purpose === "booking" ? "allows_online_booking" : "allows_qr_checkin"} ORDER BY name`,[site.organization_id,site.site_id]);
    return { organizationName: site.display_name, site: { code: site.site_code, name: site.site_name }, settings: { bookingOpensAt: String(site.booking_opens_at).slice(0,5), bookingClosesAt: String(site.booking_closes_at).slice(0,5), slotIntervalMinutes: Number(site.slot_interval_minutes), welcomeMessage: site.welcome_message ?? null }, services: services.rows.map((service) => ({ id: service.id, code: service.code, name: service.name, description: service.description, durationMinutes: Number(service.duration_minutes) })) };
  });
}

/** Public slot calculation is server-side so passed or already-booked times are
 * never sent to visitors as selectable choices. */
export async function publicAvailableSlots(orgSlug: string, siteCode: string, input: PublicBookingSlotsInput) {
  const site = await lookupPublicSite(orgSlug, siteCode);
  if (!site.public_booking_enabled) throw new NotFoundError("Online booking is not enabled for this site");
  const context = publicContext(site);
  return withTenantContext(context, async (client) => {
    const service = await serviceFor(client, site.organization_id, site.site_id, input.serviceId);
    if (!service?.allows_online_booking) throw new BadRequestError("This service is not available for online booking", { field: "serviceId" });
    const durationMinutes = Number(service.duration_minutes);
    const opens = clockMinutes(String(site.booking_opens_at));
    const closes = clockMinutes(String(site.booking_closes_at));
    const interval = Number(site.slot_interval_minutes ?? 30);
    const now = Date.now() + 5 * 60_000;
    const candidates: Array<{ value: string; localTime: string; start: Date }> = [];
    for (let minute = opens; minute + durationMinutes <= closes; minute += interval) {
      const start = localDateTimeToInstant(input.date, minute, site.timezone);
      if (start.getTime() <= now) continue;
      candidates.push({ value: start.toISOString(), localTime: localClock(start, site.timezone), start });
    }
    if (!candidates.length) return { date: input.date, timeZone: site.timezone ?? "UTC", serviceId: service.id, slots: [] };
    const rangeStart = candidates[0]!.start.toISOString();
    const rangeEnd = new Date(candidates[candidates.length - 1]!.start.getTime() + durationMinutes * 60_000).toISOString();
    const occupied = await client.query<Row>(
      `SELECT scheduled_at,expected_duration_minutes FROM appointments
       WHERE organization_id=$1 AND site_id=$2 AND service_id=$3
         AND status NOT IN ('cancelled','no_show')
         AND scheduled_at < $5::timestamptz
         AND scheduled_at + (expected_duration_minutes * interval '1 minute') > $4::timestamptz`,
      [site.organization_id, site.site_id, service.id, rangeStart, rangeEnd],
    );
    const slots = candidates.filter((candidate) => {
      const candidateStart = candidate.start.getTime();
      const candidateEnd = candidateStart + durationMinutes * 60_000;
      return !occupied.rows.some((row) => {
        const occupiedStart = new Date(row.scheduled_at).getTime();
        const occupiedEnd = occupiedStart + Number(row.expected_duration_minutes) * 60_000;
        return occupiedStart < candidateEnd && occupiedEnd > candidateStart;
      });
    }).map(({ value, localTime }) => ({ value, localTime }));
    return { date: input.date, timeZone: site.timezone ?? "UTC", serviceId: service.id, slots };
  });
}
export async function publicBook(orgSlug: string, input: PublicBookingInput) {
  const site = await lookupPublicSite(orgSlug,input.siteCode);
  if (!site.public_booking_enabled) throw new NotFoundError("Online booking is not enabled for this site");
  const scheduled = new Date(input.scheduledAt);
  if (!Number.isFinite(scheduled.getTime()) || scheduled.getTime() <= Date.now()) throw new BadRequestError("Choose a future appointment time", { field: "scheduledAt" });
  // A visitor must submit one of the exact timestamps calculated by the server.
  // This avoids browser/local-time conversion turning a valid slot into a
  // non-aligned time when a site uses an offset opening time (such as 01:01).
  const local = zonedParts(scheduled, site.timezone);
  const scheduledLocalDate = `${String(local.year).padStart(4, "0")}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
  const availability = await publicAvailableSlots(orgSlug, site.site_code, { date: scheduledLocalDate, serviceId: input.serviceId });
  if (!availability.slots.some((slot) => slot.value === scheduled.toISOString()))
    throw new BadRequestError("That appointment time is no longer available. Choose a listed time.", { field: "scheduledAt" });
  const context = publicContext(site);
  const booked = await withTenantContext(context, async (client) => {
    const service = await serviceFor(client,site.organization_id,site.site_id,input.serviceId);
    if (!service?.allows_online_booking) throw new BadRequestError("This service is not available for online booking", { field: "serviceId" });
    const durationMinutes = Number(service.duration_minutes);
    const clash = await client.query(
      `SELECT 1 FROM appointments
        WHERE organization_id=$1 AND site_id=$2 AND service_id=$3
          AND status NOT IN ('cancelled','no_show')
          AND scheduled_at < $4::timestamptz + ($5::int * interval '1 minute')
          AND scheduled_at + (expected_duration_minutes * interval '1 minute') > $4::timestamptz`,
      [site.organization_id, site.site_id, input.serviceId, input.scheduledAt, durationMinutes],
    );
    if (clash.rowCount) throw new ConflictError("That time is no longer available. Choose another slot.");
    const insert = await client.query<Row>(`INSERT INTO appointments(organization_id,province_id,site_id,service_id,source,visitor_name,visitor_email,visitor_phone,reason,scheduled_at,expected_duration_minutes,status) VALUES($1,$2,$3,$4,'online',$5,$6,$7,$8,$9,$10,'scheduled') RETURNING id`,[site.organization_id,site.province_id,site.site_id,input.serviceId,input.visitorName,input.visitorEmail ?? null,input.visitorPhone ?? null,input.reason ?? null,input.scheduledAt,Number(service.duration_minutes)]);
    const appointmentId = insert.rows[0]!.id; await event(client,site.organization_id,appointmentId,"booked_online",null);
    await notifyOrganizationOwnersInTransaction(client,{ organizationId: site.organization_id, provinceId: site.province_id, siteId: site.site_id, type:"appointment_booked",category:"general",priority:"normal",title:"New online appointment",message:`${input.visitorName} booked ${service.name} at ${site.site_name}.`,actionUrl:"/appointments",entityType:"appointment",entityId:appointmentId,deduplicationKey:`appointment-booked:${appointmentId}` });
    return { appointment: mapAppointment(await appointmentById(client,site.organization_id,appointmentId)), confirmation: "Your appointment has been booked." };
  });
  const english = input.preferredLanguage === "en";
  const localDate = new Date(booked.appointment.scheduledAt).toLocaleString(english ? "en-US" : "fr-FR", { dateStyle: "full", timeStyle: "short", timeZone: site.timezone || "UTC" });
  const reference = booked.appointment.reference;
  const message = english
    ? `Hello ${booked.appointment.visitor.name},\n\nAppointment reference: ${reference}\n\nYour appointment at ${site.site_name} for ${booked.appointment.service?.name ?? "the requested service"} is confirmed for ${localDate}.\n\nPlease keep this reference. We will notify you if anything important changes.`
    : `Bonjour ${booked.appointment.visitor.name},\n\nRéférence du rendez-vous : ${reference}\n\nVotre rendez-vous est confirmé à ${site.site_name} pour ${booked.appointment.service?.name ?? "le service demandé"}, le ${localDate}.\n\nConservez cette référence. Nous vous préviendrons si un changement important intervient.`;
  const shortDate = new Intl.DateTimeFormat(english ? "en-GB" : "fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: site.timezone || "UTC" }).format(new Date(booked.appointment.scheduledAt));
  const sms = english
    ? `Congo Omega: appointment ${reference} confirmed. ${booked.appointment.service?.name ?? "Service"}, ${site.site_name}, ${shortDate}. Keep this code.`
    : `Congo Omega: RDV ${reference} confirmé. ${booked.appointment.service?.name ?? "Service"}, ${site.site_name}, ${shortDate}. Gardez ce code.`;
  const delivery = await sendVisitorMessage(context, booked.appointment.id, message, english ? "LiteHubs — Appointment confirmed" : "LiteHubs — Rendez-vous confirmé", sms);
  return { ...booked, confirmationChannel: delivery.primary, confirmationChannels: delivery.channels };
}
export async function publicCheckIn(orgSlug: string, siteCode: string, input: PublicCheckInInput) {
  const site = await lookupPublicSite(orgSlug,siteCode);
  if (!site.qr_checkin_enabled || String(site.checkin_token) !== input.token) throw new NotFoundError("This QR check-in link is not available");
  const context = publicContext(site);
  const checkedIn = await withTenantContext(context, async (client) => {
    const service = await serviceFor(client,site.organization_id,site.site_id,input.serviceId);
    if (!service?.allows_qr_checkin) throw new BadRequestError("This service is not available at QR check-in", { field: "serviceId" });
    const ticket = await allocateQueue(client,site.organization_id,site.site_id);
    const result = await client.query<Row>(`INSERT INTO appointments(organization_id,province_id,site_id,service_id,queue_date,queue_number,source,visitor_name,visitor_email,visitor_phone,reason,expected_duration_minutes,status,checked_in_at,waiting_since) VALUES($1,$2,$3,$4,$5::date,$6,'qr',$7,$8,$9,$10,$11,'waiting',now(),now()) RETURNING id`,[site.organization_id,site.province_id,site.site_id,input.serviceId,ticket.date,ticket.number,input.visitorName,input.visitorEmail ?? null,input.visitorPhone ?? null,input.reason,Number(service.duration_minutes)]);
    const appointmentId = result.rows[0]!.id; await event(client,site.organization_id,appointmentId,"checked_in_by_qr",null,{ ticket:ticket.number });
    await notifyOrganizationOwnersInTransaction(client,{ organizationId: site.organization_id,provinceId:site.province_id,siteId:site.site_id,type:"appointment_waiting",category:"general",priority:"normal",title:"Visitor joined the queue",message:`Ticket #${ticket.number} is waiting for ${service.name} at ${site.site_name}.`,actionUrl:"/appointments",entityType:"appointment",entityId:appointmentId,deduplicationKey:`appointment-waiting:${appointmentId}` });
    return { appointmentId, ticket, serviceName: service.name, siteName: site.site_name, welcomeMessage: site.welcome_message ?? null };
  });
  const english = input.preferredLanguage === "en";
  const message = english
    ? `Hello ${input.visitorName},\n\nYour check-in at ${site.site_name} is confirmed. Your queue ticket is #${checkedIn.ticket.number} for ${checkedIn.serviceName}.\n\nKeep this ticket: we will email you when it is your turn.`
    : `Bonjour ${input.visitorName},\n\nVotre arrivée est confirmée à ${site.site_name}. Votre numéro de file est #${checkedIn.ticket.number} pour ${checkedIn.serviceName}.\n\nGardez ce numéro : nous vous enverrons un e-mail lorsque ce sera votre tour.`;
  const sms = english
    ? `Congo Omega: check-in confirmed at ${site.site_name}. Your ticket is #${checkedIn.ticket.number} for ${checkedIn.serviceName}. We will message you when called.`
    : `Congo Omega: arrivée confirmée à ${site.site_name}. Votre numéro est #${checkedIn.ticket.number} pour ${checkedIn.serviceName}. Nous vous écrirons quand il sera appelé.`;
  const delivery = await sendVisitorMessage(context, checkedIn.appointmentId, message, english ? "LiteHubs — Queue ticket confirmed" : "LiteHubs — Numéro de file confirmé", sms);
  return { ticket: checkedIn.ticket, siteName: checkedIn.siteName, welcomeMessage: checkedIn.welcomeMessage, confirmationChannel: delivery.primary, confirmationChannels: delivery.channels };
}
/** Public TV screens show a recognisable, but privacy-preserving, visitor name. */
function queueDisplayName(value: string | null | undefined): string {
  const words = (value ?? "").trim().split(/\s+/).filter(Boolean);
  // An e-mail can accidentally be entered in the name field. It must never be
  // echoed on a public TV screen.
  if (!words.length || words.some((word) => word.includes("@"))) return "Visitor";

  const firstNameCharacters = Array.from(words[0]!);
  const firstName = firstNameCharacters.slice(0, 10).join("")
    + (firstNameCharacters.length > 10 ? "…" : "");
  if (words.length === 1) return firstName;

  const lastInitial = Array.from(words[words.length - 1]!)[0]?.toUpperCase();
  return lastInitial ? firstName + " " + lastInitial + "." : firstName;
}

export async function publicQueueDisplay(orgSlug: string, siteCode: string) {
  const site = await lookupPublicSite(orgSlug, siteCode);
  if (!site.queue_display_enabled) throw new NotFoundError("Queue display is not enabled for this site");
  const context = publicContext(site);
  return withTenantContext(context, async (client) => {
    const idleSettings = await client.query<Row>(
      `SELECT idle_display_title,idle_display_message,idle_display_document_id FROM appointment_site_settings WHERE organization_id=$1 AND site_id=$2`,
      [site.organization_id, site.site_id],
    );    const rows = await client.query<Row>(
      `SELECT a.queue_number,a.status,a.visitor_name,a.queue_call_message,svc.name AS service_name,desk.name AS desk_name
         FROM appointments a
         LEFT JOIN appointment_services svc ON svc.organization_id=a.organization_id AND svc.id=a.service_id
         LEFT JOIN appointment_desks desk ON desk.organization_id=a.organization_id AND desk.id=a.desk_id
        WHERE a.organization_id=$1 AND a.site_id=$2 AND a.queue_date=CURRENT_DATE
          AND a.status IN ('waiting','checked_in','called','serving')
        ORDER BY CASE a.status WHEN 'serving' THEN 0 WHEN 'called' THEN 1 ELSE 2 END,a.called_at,a.queue_number
        LIMIT 30`,
      [site.organization_id, site.site_id],
    );
    const nowServing = rows.rows
      .filter((row) => row.status === "serving" || row.status === "called")
      .map((row) => ({
        ticket: Number(row.queue_number), visitorName: queueDisplayName(row.visitor_name as string | null),
        serviceName: row.service_name, deskName: row.desk_name ?? null, message: row.queue_call_message ?? null, status: row.status,
      }));
    return {
      organizationName: site.display_name,
      siteName: site.site_name,
      nowServing,
      waiting: rows.rows.filter((row) => ["waiting", "checked_in"].includes(row.status)).map((row) => ({
        ticket: Number(row.queue_number), visitorName: queueDisplayName(row.visitor_name as string | null), serviceName: row.service_name,
      })),
      idleDisplay: {
        title: idleSettings.rows[0]?.idle_display_title ?? null,
        message: idleSettings.rows[0]?.idle_display_message ?? null,
        videoId: idleSettings.rows[0]?.idle_display_document_id ?? null,
        hasVideo: Boolean(idleSettings.rows[0]?.idle_display_document_id),
      },
      refreshedAt: new Date().toISOString(),
    };
  });
}




/** A public queue display can play only the owner-selected MP4/WebM for its own site. */
export async function publicIdleDisplayVideo(orgSlug: string, siteCode: string) {
  const site = await lookupPublicSite(orgSlug, siteCode);
  if (!site.queue_display_enabled)
    throw new NotFoundError("Queue display is not enabled for this site");
  return withTenantContext(publicContext(site), async (client) => {
    const result = await client.query<Row>(
      `SELECT d.file_name,d.mime_type,d.storage_path
         FROM appointment_site_settings settings
         JOIN documents d ON d.organization_id=settings.organization_id AND d.id=settings.idle_display_document_id
        WHERE settings.organization_id=$1 AND settings.site_id=$2
          AND d.mime_type IN ('video/mp4','video/webm')`,
      [site.organization_id, site.site_id],
    );
    const video = result.rows[0];
    if (!video) throw new NotFoundError("No idle display video is configured for this site");
    return {
      fileName: String(video.file_name),
      mimeType: String(video.mime_type),
      buffer: await readPrivateDocument(String(video.storage_path)),
    };
  });
}
