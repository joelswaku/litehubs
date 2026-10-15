/**
 * Direct messages to one employee from their HR record.
 *
 * The HR user writes once and picks the channels: e-mail (to the employee's
 * LiteHubs login address), SMS (to the phone on the record) and/or a LiteHubs
 * notification. Every message is kept on the record with its delivery result,
 * so the team can see what was said, by whom and whether it arrived.
 */
import type { PoolClient } from "pg";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import { sendMail, sendSms } from "../../services/notification.service";
import { createNotificationInTransaction } from "../notifications/notifications.service";
import { escapeHtml } from "../careers/careers.service";
import { assertEmployeeAccess, type EmployeeContext } from "./employee.service";

export type EmployeeMessageChannel = "email" | "sms" | "app";

export type EmployeeMessageInput = {
  subject?: string;
  body: string;
  channels: EmployeeMessageChannel[];
};

type Recipient = {
  id: string;
  full_name: string;
  phone: string | null;
  member_id: string | null;
  email: string | null;
  organization_name: string;
  province_id: string | null;
  site_id: string | null;
};

type Delivery = {
  email?: { sent: boolean; reason?: string };
  sms?: { sent: boolean; reason?: string };
  app?: { sent: boolean; reason?: string };
};

async function recipient(
  client: PoolClient,
  context: EmployeeContext,
  employeeId: string,
): Promise<Recipient> {
  // Same visibility rules as opening the employee record (provinces, sites).
  await assertEmployeeAccess(client, context, employeeId);
  const result = await client.query<Recipient>(
    `SELECT e.id,e.full_name,e.phone,e.member_id,e.province_id,e.site_id,u.email::text AS email,
            COALESCE(o.display_name,o.legal_name) AS organization_name
       FROM employees e
       JOIN organizations o ON o.id=e.organization_id
       LEFT JOIN organization_members m ON m.organization_id=e.organization_id AND m.id=e.member_id
       LEFT JOIN users u ON u.id=m.user_id
      WHERE e.organization_id=$1 AND e.id=$2`,
    [context.organizationId, employeeId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Employee not found");
  return row;
}

async function senderInfo(client: PoolClient, context: EmployeeContext) {
  const result = await client.query<{ full_name: string | null; email: string | null }>(
    `SELECT full_name,email::text AS email FROM users WHERE id=$1`,
    [context.userId],
  );
  return result.rows[0] ?? { full_name: null, email: null };
}

function messageEmail(input: {
  to: string;
  replyTo: string | null;
  organizationName: string;
  employeeName: string;
  senderName: string | null;
  subject: string;
  body: string;
}) {
  const greeting = `Bonjour ${input.employeeName},`;
  const signature = input.senderName
    ? `${input.senderName} · ${input.organizationName}`
    : input.organizationName;
  const paragraphs = input.body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(input.subject)}</title></head><body style="margin:0;padding:0;background:#f3f6fa;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#14233a;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#f3f6fa;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #dde5ef;border-radius:16px;overflow:hidden;"><tr><td style="padding:24px 32px;background:#184f95;color:#fff;font-size:20px;font-weight:800;">${escapeHtml(input.organizationName)}</td></tr><tr><td style="padding:32px;"><h1 style="margin:0 0 18px;color:#14233a;font-size:22px;line-height:1.3;">${escapeHtml(input.subject)}</h1><p style="margin:0 0 16px;color:#33445c;font-size:15px;line-height:1.65;">${escapeHtml(greeting)}</p>${paragraphs
    .map(
      (part) =>
        `<p style="margin:0 0 16px;color:#33445c;font-size:15px;line-height:1.65;">${escapeHtml(part).replace(/\n/g, "<br />")}</p>`,
    )
    .join("")}<p style="margin:24px 0 0;color:#5b6b80;font-size:14px;line-height:1.6;">${escapeHtml(signature)}</p></td></tr><tr><td style="padding:18px 32px;background:#f7f9fc;border-top:1px solid #e3e9f1;color:#6b7a8f;font-size:12px;line-height:1.55;">Message envoyé depuis LiteHubs par ${escapeHtml(input.organizationName)}.${input.replyTo ? ` Vous pouvez répondre directement à cet e-mail.` : ""}</td></tr></table></td></tr></table></body></html>`;
  const text = [greeting, "", ...paragraphs.flatMap((part) => [part, ""]), signature].join("\n");
  return {
    to: input.to,
    subject: input.subject,
    text,
    html,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  };
}

function mapMessage(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    subject: (row.subject as string | null) ?? null,
    body: String(row.body),
    channels: (row.channels as string[]) ?? [],
    delivery: (row.delivery as Delivery) ?? {},
    sentBy: (row.sent_by_name as string | null) ?? null,
    createdAt: row.created_at,
  };
}

export async function listEmployeeMessages(context: EmployeeContext, employeeId: string) {
  return withTenantContext(context, async (client) => {
    const person = await recipient(client, context, employeeId);
    const rows = await client.query(
      `SELECT m.*,u.full_name AS sent_by_name
         FROM employee_messages m LEFT JOIN users u ON u.id=m.sent_by
        WHERE m.organization_id=$1 AND m.employee_id=$2
        ORDER BY m.created_at DESC LIMIT 50`,
      [context.organizationId, employeeId],
    );
    return {
      contact: {
        email: person.email,
        phone: person.phone,
        hasAccount: Boolean(person.member_id && person.email),
      },
      messages: rows.rows.map(mapMessage),
    };
  });
}

export async function sendEmployeeMessage(
  context: EmployeeContext,
  employeeId: string,
  input: EmployeeMessageInput,
) {
  const body = input.body.trim();
  const channels = [...new Set(input.channels)];
  if (!body) throw new BadRequestError("Write a message", { field: "body" });
  if (!channels.length) throw new BadRequestError("Choose at least one channel", { field: "channels" });

  const prepared = await withTenantContext(context, async (client) => {
    const person = await recipient(client, context, employeeId);
    const sender = await senderInfo(client, context);
    if (channels.includes("email") && !person.email)
      throw new BadRequestError("This employee has no LiteHubs e-mail address yet", { field: "channels" });
    if (channels.includes("sms") && !person.phone)
      throw new BadRequestError("Add a phone number to this employee before sending an SMS", { field: "channels" });
    if (channels.includes("app") && !person.member_id)
      throw new BadRequestError("This employee has no LiteHubs account yet", { field: "channels" });
    return { person, sender };
  });

  const { person, sender } = prepared;
  const subject =
    input.subject?.trim() || `Message de ${person.organization_name}`;
  const delivery: Delivery = {};
  const [email, sms] = await Promise.all([
    channels.includes("email") && person.email
      ? sendMail(
          messageEmail({
            to: person.email,
            replyTo: sender.email,
            organizationName: person.organization_name,
            employeeName: person.full_name,
            senderName: sender.full_name,
            subject,
            body,
          }),
        )
      : Promise.resolve(null),
    channels.includes("sms") && person.phone
      ? sendSms({
          to: person.phone,
          content: `${person.organization_name} : ${body}`.replace(/\s+/g, " ").slice(0, 600),
        })
      : Promise.resolve(null),
  ]);
  if (email) delivery.email = { sent: email.sent, ...(email.sent ? {} : { reason: email.reason }) };
  if (sms) delivery.sms = { sent: sms.sent, ...(sms.sent ? {} : { reason: sms.reason }) };

  await withTenantContext(context, async (client) => {
    if (channels.includes("app")) {
      const created = await createNotificationInTransaction(client, {
        organizationId: context.organizationId,
        recipientMemberId: person.member_id,
        recipientEmployeeId: person.id,
        actorUserId: context.userId,
        provinceId: person.province_id,
        siteId: person.site_id,
        type: "direct_message",
        category: "general",
        priority: "normal",
        title: subject,
        message: body.slice(0, 1000),
        skipEmailDelivery: true,
      });
      delivery.app = created ? { sent: true } : { sent: false, reason: "no_active_account" };
    }
    await client.query(
      `INSERT INTO employee_messages(organization_id,employee_id,subject,body,channels,delivery,sent_by)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        context.organizationId,
        person.id,
        input.subject?.trim() || null,
        body,
        channels,
        JSON.stringify(delivery),
        context.userId,
      ],
    );
  });

  return { delivery, ...(await listEmployeeMessages(context, employeeId)) };
}
