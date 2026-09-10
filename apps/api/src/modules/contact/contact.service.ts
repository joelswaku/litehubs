import { query } from "../../config/database";
import { logger } from "../../config/logger";
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
