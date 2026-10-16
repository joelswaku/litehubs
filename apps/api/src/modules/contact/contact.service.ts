import { query } from "../../config/database";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { sendMail } from "../../services/notification.service";
import { NotFoundError } from "../../utils/errors";
import type {
  CreateContactRequestInput,
  ListContactRequestsInput,
  UpdateContactRequestInput,
} from "./contact.validation";

type ContactRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  company_name: string | null;
  category: string;
  subject: string;
  message: string;
  preferred_language: "fr" | "en";
  status: "new" | "in_progress" | "resolved" | "closed";
  admin_note: string | null;
  handled_by_user_id: string | null;
  handled_by_name: string | null;
  handled_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type ContactRequest = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  companyName: string | null;
  category: string;
  subject: string;
  message: string;
  preferredLanguage: "fr" | "en";
  status: "new" | "in_progress" | "resolved" | "closed";
  adminNote: string | null;
  handledBy: { id: string; fullName: string } | null;
  handledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const SELECT_CONTACT = `
  SELECT c.id, c.full_name, c.email, c.phone, c.company_name, c.category,
         c.subject, c.message, c.preferred_language, c.status, c.admin_note,
         c.handled_by_user_id, u.full_name AS handled_by_name, c.handled_at,
         c.created_at, c.updated_at
    FROM platform_contact_requests c
    LEFT JOIN users u ON u.id = c.handled_by_user_id`;

function toContact(row: ContactRow): ContactRequest {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    companyName: row.company_name,
    category: row.category,
    subject: row.subject,
    message: row.message,
    preferredLanguage: row.preferred_language,
    status: row.status,
    adminNote: row.admin_note,
    handledBy:
      row.handled_by_user_id && row.handled_by_name
        ? { id: row.handled_by_user_id, fullName: row.handled_by_name }
        : null,
    handledAt: row.handled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createContactRequest(
  input: CreateContactRequestInput,
  context: { ipAddress: string | null; userAgent: string | null },
): Promise<{ id: string }> {
  const result = await query<{ id: string }>(
    `INSERT INTO platform_contact_requests
       (full_name, email, phone, company_name, category, subject, message,
        preferred_language, source_ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::inet, $10)
     RETURNING id`,
    [
      input.fullName,
      input.email,
      input.phone ?? null,
      input.companyName ?? null,
      input.category,
      input.subject,
      input.message,
      input.preferredLanguage,
      context.ipAddress,
      context.userAgent,
    ],
  );
  const id = result.rows[0]!.id;
  logger.info(
    { contactRequestId: id, category: input.category },
    "Public contact request created",
  );
  // E-mails are best effort: the request is already saved for the platform team.
  void notifyContactRequest(id, input).catch((error) =>
    logger.error({ err: error, contactRequestId: id }, "Contact request e-mails failed"),
  );
  return { id };
}

export async function listContactRequests(
  filter: ListContactRequestsInput,
): Promise<{ requests: ContactRequest[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`c.status = $${params.length}`);
  }
  if (filter.search) {
    params.push(`%${filter.search}%`);
    conditions.push(
      `(c.full_name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.subject ILIKE $${params.length} OR c.message ILIKE $${params.length})`,
    );
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const count = await query<{ total: string }>(
    `SELECT count(*)::text AS total FROM platform_contact_requests c${where}`,
    params,
  );
  params.push(filter.limit, filter.offset);
  const result = await query<ContactRow>(
    `${SELECT_CONTACT}${where}
      ORDER BY CASE c.status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,
               c.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    requests: result.rows.map(toContact),
    total: Number(count.rows[0]?.total ?? 0),
  };
}

export async function updateContactRequest(
  id: string,
  staffUserId: string,
  input: UpdateContactRequestInput,
): Promise<ContactRequest> {
  const result = await query<ContactRow>(
    `WITH updated AS (
        UPDATE platform_contact_requests
           SET status = $2,
               admin_note = $3,
               handled_by_user_id = $1,
               handled_at = CASE WHEN $2 IN ('resolved', 'closed') THEN now() ELSE NULL END
         WHERE id = $4
         RETURNING *
      )
      SELECT c.id, c.full_name, c.email, c.phone, c.company_name, c.category,
             c.subject, c.message, c.preferred_language, c.status, c.admin_note,
             c.handled_by_user_id, u.full_name AS handled_by_name, c.handled_at,
             c.created_at, c.updated_at
        FROM updated c
        LEFT JOIN users u ON u.id = c.handled_by_user_id`,
    [staffUserId, input.status, input.adminNote ?? null, id],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Contact request not found");
  logger.info(
    { contactRequestId: id, staffUserId, status: input.status },
    "Contact request triaged",
  );
  return toContact(row);
}

const CATEGORY_LABELS: Record<string, string> = {
  general: "Question générale",
  access: "Accès ou connexion",
  technical: "Problème technique",
  billing: "Facturation",
  demo: "Démonstration",
  privacy: "Confidentialité et données",
  other: "Autre demande",
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Sends the request to the LiteHubs inbox and a receipt to the sender. */
async function notifyContactRequest(id: string, input: CreateContactRequestInput) {
  const inbox = env.mail.contactInbox;
  const topic = CATEGORY_LABELS[input.category] ?? input.category;
  const rows: [string, string][] = [
    ["Nom", input.fullName],
    ["E-mail", input.email],
    ["Téléphone", input.phone ?? "—"],
    ["Entreprise", input.companyName ?? "—"],
    ["Sujet", topic],
    ["Langue", input.preferredLanguage === "en" ? "Anglais" : "Français"],
  ];
  const tasks: Promise<unknown>[] = [];
  if (inbox) {
    tasks.push(
      sendMail({
        to: inbox,
        replyTo: input.email,
        subject: `[Contact LiteHubs] ${topic} — ${input.subject}`,
        text: [
          ...rows.map(([label, value]) => `${label} : ${value}`),
          "",
          input.message,
          "",
          `Référence : ${id}`,
          "Répondez directement à cet e-mail pour écrire à la personne.",
        ].join("\n"),
        html: `<div style="font-family:Arial,sans-serif;color:#14233a;font-size:14px;line-height:1.6"><h2 style="margin:0 0 12px">Nouvelle demande de contact</h2><table cellpadding="4" style="border-collapse:collapse">${rows
          .map(([label, value]) => `<tr><td style="color:#5b6b80;padding-right:12px">${label}</td><td><strong>${escapeHtml(value)}</strong></td></tr>`)
          .join("")}</table><h3 style="margin:18px 0 6px">${escapeHtml(input.subject)}</h3><p style="white-space:pre-line;margin:0">${escapeHtml(input.message)}</p><p style="color:#6b7a8f;font-size:12px;margin-top:18px">Référence ${id}. Répondez directement à cet e-mail pour écrire à la personne.</p></div>`,
      }),
    );
  } else {
    logger.warn({ contactRequestId: id }, "No contact inbox configured (CONTACT_INBOX_EMAIL / MAIL_FROM_EMAIL)");
  }
  const french = input.preferredLanguage !== "en";
  const receiptSubject = french
    ? `Nous avons bien reçu votre demande — ${input.subject}`
    : `We received your request — ${input.subject}`;
  const receiptLines = french
    ? [
        `Bonjour ${input.fullName},`,
        "",
        "Merci pour votre message. L’équipe LiteHubs l’a bien reçu et vous répondra à cette adresse.",
        "",
        `Votre demande : ${input.subject}`,
        "",
        "Pour des raisons de sécurité, n’envoyez jamais votre mot de passe ou un code de connexion.",
        "",
        "L’équipe LiteHubs — un produit de Lakenah LLC",
      ]
    : [
        `Hello ${input.fullName},`,
        "",
        "Thank you for your message. The LiteHubs team received it and will reply to this address.",
        "",
        `Your request: ${input.subject}`,
        "",
        "For your security, never send your password or a sign-in code.",
        "",
        "The LiteHubs team — a Lakenah LLC product",
      ];
  tasks.push(
    sendMail({
      to: input.email,
      ...(inbox ? { replyTo: inbox } : {}),
      subject: receiptSubject,
      text: receiptLines.join("\n"),
      html: `<div style="font-family:Arial,sans-serif;color:#14233a;font-size:14px;line-height:1.65">${receiptLines
        .map((line) => (line ? `<p style="margin:0 0 4px">${escapeHtml(line)}</p>` : "<br />"))
        .join("")}</div>`,
    }),
  );
  await Promise.all(tasks);
}
