import { ImapFlow, type ListResponse, type MessageAddressObject, type SearchObject } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type Mail from "nodemailer/lib/mailer";
import sanitizeHtml from "sanitize-html";
import type { PoolClient } from "pg";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { createNotificationInTransaction } from "../notifications/notifications.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import { decryptSecret, encryptSecret } from "./mail.crypto";
import type {
  MailboxInput,
  MarkAllReadInput,
  MessageFlagsInput,
  MessageListQuery,
  MessageMoveInput,
  SendInput,
} from "./mail.validation";

export interface MailContext {
  organizationId: string;
  organizationSlug: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
  permissions: string[];
}

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const PAGE_SIZE = 30;
const CONNECT_TIMEOUT = 20_000;

const canManage = (context: MailContext) =>
  context.isOwner || context.permissions.includes("mail.manage");

/* ------------------------------------------------------------------ */
/* Mailbox records                                                     */
/* ------------------------------------------------------------------ */

function mapMailbox(row: Row, includeSettings: boolean) {
  return {
    id: row.id as string,
    emailAddress: row.email_address as string,
    displayName: (row.display_name as string | null) ?? null,
    status: row.status as string,
    lastError: (row.last_error as string | null) ?? null,
    lastCheckedAt: row.last_checked_at ?? null,
    unseenCount: Number(row.unseen_count ?? 0),
    signature: (row.signature as string | null) ?? null,
    aliases: ((row.aliases as string[] | null) ?? []).filter(Boolean),
    canSend: Boolean(row.can_send),
    ...(includeSettings
      ? {
          username: row.username as string,
          imapHost: row.imap_host as string,
          imapPort: Number(row.imap_port),
          imapSecure: Boolean(row.imap_secure),
          smtpHost: row.smtp_host as string,
          smtpPort: Number(row.smtp_port),
          smtpSecure: Boolean(row.smtp_secure),
          memberIds: (row.member_ids as string[] | null) ?? [],
        }
      : {}),
  };
}

const mailboxSelect = `SELECT mb.*,
    COALESCE((SELECT array_agg(mm.member_id) FROM organization_mailbox_members mm
               WHERE mm.organization_id=mb.organization_id AND mm.mailbox_id=mb.id), '{}') AS member_ids
  FROM organization_mailboxes mb`;

async function accessibleMailbox(
  client: PoolClient,
  context: MailContext,
  mailboxId: string,
  needSend = false,
): Promise<Row> {
  const result = await client.query<Row>(
    `${mailboxSelect}
      WHERE mb.organization_id=$1 AND mb.id=$2`,
    [context.organizationId, mailboxId],
  );
  const mailbox = result.rows[0];
  if (!mailbox) throw new NotFoundError("Mailbox not found");
  if (canManage(context)) return { ...mailbox, can_send: true };
  const member = await client.query<{ can_send: boolean }>(
    `SELECT can_send FROM organization_mailbox_members WHERE organization_id=$1 AND mailbox_id=$2 AND member_id=$3`,
    [context.organizationId, mailboxId, context.memberId],
  );
  if (!member.rowCount) throw new NotFoundError("Mailbox not found");
  const canSend = Boolean(member.rows[0]!.can_send) && context.permissions.includes("mail.send");
  if (needSend && !canSend) throw new ForbiddenError("You cannot send from this mailbox");
  return { ...mailbox, can_send: canSend };
}

export async function listMailboxes(context: MailContext) {
  return withTenantContext(context, async (client) => {
    const manage = canManage(context);
    const result = await client.query<Row>(
      `${mailboxSelect}
        LEFT JOIN organization_mailbox_members me
          ON me.organization_id=mb.organization_id AND me.mailbox_id=mb.id AND me.member_id=$2
        WHERE mb.organization_id=$1 AND ($3 OR me.member_id IS NOT NULL)
        ORDER BY lower(mb.email_address)`,
      [context.organizationId, context.memberId, manage],
    );
    const members = manage
      ? await client.query<Row>(
          `SELECT m.id,COALESCE(u.full_name,u.email::text) AS name,u.email::text AS email
             FROM organization_members m JOIN users u ON u.id=m.user_id
            WHERE m.organization_id=$1 AND m.status='active'
            ORDER BY 2`,
          [context.organizationId],
        )
      : { rows: [] as Row[] };
    return {
      aiEnabled: Boolean(env.ai.enabled && env.ai.apiKey),
      canManage: manage,
      canSend: manage || context.permissions.includes("mail.send"),
      mailboxes: result.rows.map((row) =>
        mapMailbox(
          { ...row, can_send: manage || context.permissions.includes("mail.send") },
          manage,
        ),
      ),
      members: members.rows.map((row) => ({ id: row.id, name: row.name, email: row.email })),
    };
  });
}

function friendlyConnectionError(error: unknown, protocol: "IMAP" | "SMTP") {
  const raw = error instanceof Error ? error.message : String(error);
  const text = `${raw} ${(error as { responseText?: string })?.responseText ?? ""}`;
  if (/auth|credential|login|password|535|invalid/i.test(text))
    return `${protocol} : adresse ou mot de passe refusé par le serveur.`;
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) return `${protocol} : serveur introuvable. Vérifiez le nom du serveur.`;
  if (/timeout|ETIMEDOUT|ECONNREFUSED/i.test(text)) return `${protocol} : le serveur ne répond pas sur ce port.`;
  return `${protocol} : connexion impossible (${raw.slice(0, 160)}).`;
}

type Connection = {
  email: string;
  username: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  displayName: string | null;
};

function connectionOf(row: Row): Connection {
  return {
    email: row.email_address,
    username: row.username,
    password: decryptSecret(row.password_encrypted),
    imapHost: row.imap_host,
    imapPort: Number(row.imap_port),
    imapSecure: Boolean(row.imap_secure),
    smtpHost: row.smtp_host,
    smtpPort: Number(row.smtp_port),
    smtpSecure: Boolean(row.smtp_secure),
    displayName: row.display_name ?? null,
  };
}

function imapClient(connection: Connection) {
  return new ImapFlow({
    host: connection.imapHost,
    port: connection.imapPort,
    secure: connection.imapSecure,
    auth: { user: connection.username, pass: connection.password },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT,
    greetingTimeout: CONNECT_TIMEOUT,
    socketTimeout: 60_000,
  });
}

function smtpTransport(connection: Connection) {
  return nodemailer.createTransport({
    host: connection.smtpHost,
    port: connection.smtpPort,
    secure: connection.smtpSecure,
    auth: { user: connection.username, pass: connection.password },
    connectionTimeout: CONNECT_TIMEOUT,
    greetingTimeout: CONNECT_TIMEOUT,
  });
}

async function withImap<T>(connection: Connection, work: (client: ImapFlow) => Promise<T>) {
  const client = imapClient(connection);
  // ImapFlow reports socket problems as events; without a listener Node
  // would treat them as unhandled.
  client.on("error", (error) => logger.warn({ err: error }, "IMAP connection error"));
  try {
    await client.connect();
  } catch (error) {
    throw new BadRequestError(friendlyConnectionError(error, "IMAP"));
  }
  try {
    return await work(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

async function testConnection(connection: Connection) {
  await withImap(connection, async () => undefined);
  try {
    await smtpTransport(connection).verify();
  } catch (error) {
    throw new BadRequestError(friendlyConnectionError(error, "SMTP"));
  }
}

export async function saveMailbox(context: MailContext, input: MailboxInput, mailboxId?: string) {
  if (!canManage(context)) throw new ForbiddenError("You cannot manage mailboxes");
  const existing = mailboxId
    ? await withTenantContext(context, (client) => accessibleMailbox(client, context, mailboxId))
    : null;
  if (!existing && !input.password) throw new BadRequestError("Enter the mailbox password", { field: "password" });
  const password = input.password ?? decryptSecret(existing!.password_encrypted);
  const connection: Connection = {
    email: input.emailAddress,
    username: input.username || input.emailAddress,
    password,
    imapHost: input.imapHost,
    imapPort: input.imapPort,
    imapSecure: input.imapSecure,
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    smtpSecure: input.smtpSecure,
    displayName: input.displayName ?? null,
  };
  // Never store a mailbox that cannot actually connect.
  if (input.status !== "disabled") await testConnection(connection);
  return withTenantContext(context, async (client) => {
    const values = [
      context.organizationId,
      input.emailAddress,
      input.displayName ?? null,
      connection.username,
      encryptSecret(password),
      input.imapHost,
      input.imapPort,
      input.imapSecure,
      input.smtpHost,
      input.smtpPort,
      input.smtpSecure,
      input.signature ?? null,
      input.status ?? "active",
    ];
    let id = mailboxId;
    try {
      if (mailboxId) {
        await client.query(
          `UPDATE organization_mailboxes
              SET email_address=$2,display_name=$3,username=$4,password_encrypted=$5,imap_host=$6,imap_port=$7,
                  imap_secure=$8,smtp_host=$9,smtp_port=$10,smtp_secure=$11,signature=$12,status=$13,last_error=NULL
            WHERE organization_id=$1 AND id=$14`,
          [...values, mailboxId],
        );
      } else {
        const created = await client.query<{ id: string }>(
          `INSERT INTO organization_mailboxes(organization_id,email_address,display_name,username,password_encrypted,
             imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,signature,status,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
          [...values, context.userId],
        );
        id = created.rows[0]!.id;
      }
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new BadRequestError("This address is already connected");
      throw error;
    }
    const aliases = [...new Set(input.aliases)].filter((alias) => alias !== input.emailAddress);
    await client.query(
      `UPDATE organization_mailboxes SET aliases=$3::text[] WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, id, aliases],
    );
    await client.query(
      `DELETE FROM organization_mailbox_members WHERE organization_id=$1 AND mailbox_id=$2 AND NOT (member_id = ANY($3::uuid[]))`,
      [context.organizationId, id, input.memberIds],
    );
    for (const memberId of input.memberIds) {
      await client.query(
        `INSERT INTO organization_mailbox_members(organization_id,mailbox_id,member_id)
         SELECT $1,$2,m.id FROM organization_members m WHERE m.organization_id=$1 AND m.id=$3
         ON CONFLICT DO NOTHING`,
        [context.organizationId, id, memberId],
      );
    }
    const saved = await accessibleMailbox(client, context, id!);
    return mapMailbox(saved, true);
  });
}

export async function deleteMailbox(context: MailContext, mailboxId: string) {
  if (!canManage(context)) throw new ForbiddenError("You cannot manage mailboxes");
  return withTenantContext(context, async (client) => {
    const result = await client.query(
      `DELETE FROM organization_mailboxes WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, mailboxId],
    );
    if (!result.rowCount) throw new NotFoundError("Mailbox not found");
    return { deleted: true };
  });
}

async function mailboxConnection(context: MailContext, mailboxId: string, needSend = false) {
  const row = await withTenantContext(context, (client) =>
    accessibleMailbox(client, context, mailboxId, needSend),
  );
  if (row.status === "disabled") throw new BadRequestError("This mailbox is disabled");
  return { row, connection: connectionOf(row) };
}

/* ------------------------------------------------------------------ */
/* Folders and messages                                                */
/* ------------------------------------------------------------------ */

const SPECIAL_ORDER: Record<string, number> = {
  "\\Inbox": 0,
  "\\Flagged": 1,
  "\\Sent": 2,
  "\\Drafts": 3,
  "\\Archive": 4,
  "\\Junk": 5,
  "\\Trash": 6,
};

function folderKind(folder: ListResponse) {
  if (folder.path.toUpperCase() === "INBOX") return "\\Inbox";
  return folder.specialUse ?? null;
}

export async function listFolders(context: MailContext, mailboxId: string) {
  const { connection } = await mailboxConnection(context, mailboxId);
  return withImap(connection, async (client) => {
    const folders = await client.list({ statusQuery: { messages: true, unseen: true } });
    return {
      folders: folders
        .filter((folder) => !folder.flags.has("\\Noselect"))
        .map((folder) => ({
          path: folder.path,
          name: folder.name,
          kind: folderKind(folder),
          total: folder.status?.messages ?? 0,
          unseen: folder.status?.unseen ?? 0,
        }))
        .sort(
          (a, b) =>
            (SPECIAL_ORDER[a.kind ?? ""] ?? 10) - (SPECIAL_ORDER[b.kind ?? ""] ?? 10) ||
            a.path.localeCompare(b.path),
        ),
    };
  });
}

function addressText(list?: MessageAddressObject[]) {
  return (list ?? []).map((item) => ({ name: item.name ?? "", address: item.address ?? "" }));
}

/* « À répondre » : messages received from a real person that nobody has
 * answered yet — neither from LiteHubs (\Answered flag) nor from another
 * mail app (a reply found in the Sent folder). */
const AUTOMATED_SENDER = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?|newsletters?|info-?noreply|automated|alerts?)([+._-]|$)/i;
const TO_ANSWER_WINDOW = 500;
const SENT_SCAN = 800;

async function repliedMessageIds(client: ImapFlow) {
  const folders = await client.list();
  const sent = folders.find((folder) => folder.specialUse === "\\Sent") ?? folders.find((folder) => /^(inbox[./])?sent( items| messages)?$/i.test(folder.path));
  const replied = new Set<string>();
  if (!sent) return replied;
  const lock = await client.getMailboxLock(sent.path).catch(() => null);
  if (!lock) return replied;
  try {
    const all = ((await client.search({ all: true }, { uid: true })) || []).sort((a, b) => b - a).slice(0, SENT_SCAN);
    if (all.length)
      for await (const message of client.fetch(all, { uid: true, envelope: true }, { uid: true })) {
        const id = message.envelope?.inReplyTo?.trim();
        if (id) replied.add(id.toLowerCase());
      }
  } finally {
    lock.release();
  }
  return replied;
}

export async function listMessages(context: MailContext, mailboxId: string, query: MessageListQuery) {
  const { connection, row } = await mailboxConnection(context, mailboxId);
  const ownAddresses = new Set(
    [String(row.email_address), ...(((row.aliases as string[] | null) ?? []) as string[])].map((item) => item.toLowerCase()),
  );
  return withImap(connection, async (client) => {
    const replied = query.unanswered ? await repliedMessageIds(client) : null;
    const lock = await client.getMailboxLock(query.folder).catch(() => {
      throw new NotFoundError("Folder not found");
    });
    try {
      const criteria: SearchObject = query.search
        ? {
            or: [
              { subject: query.search },
              { from: query.search },
              { to: query.search },
              { body: query.search },
            ],
          }
        : { all: true };
      if (query.unread) criteria.seen = false;
      // « À répondre »: not answered from LiteHubs; refined below.
      if (query.unanswered) criteria.answered = false;
      // Messages received on one alias (e.g. recrutement@) of the mailbox.
      if (query.to) criteria.to = query.to;
      let uids = ((await client.search(criteria, { uid: true })) || []).sort((a, b) => b - a);
      if (query.unanswered && uids.length) {
        const window = uids.slice(0, TO_ANSWER_WINDOW);
        const keep: number[] = [];
        const answeredElsewhere: number[] = [];
        for await (const message of client.fetch(window, { uid: true, envelope: true }, { uid: true })) {
          const sender = (message.envelope?.from?.[0]?.address ?? "").toLowerCase();
          const localPart = sender.split("@")[0] ?? "";
          if (!sender || ownAddresses.has(sender) || AUTOMATED_SENDER.test(localPart)) continue;
          const id = message.envelope?.messageId?.trim().toLowerCase();
          if (id && replied?.has(id)) {
            answeredElsewhere.push(message.uid);
            continue;
          }
          keep.push(message.uid);
        }
        // Replies sent from webmail or a phone: remember them on the server.
        if (answeredElsewhere.length)
          await client.messageFlagsAdd(answeredElsewhere, ["\\Answered"], { uid: true }).catch(() => undefined);
        uids = keep.sort((a, b) => b - a);
      }
      const total = uids.length;
      const pageUids = uids.slice((query.page - 1) * PAGE_SIZE, query.page * PAGE_SIZE);
      const messages: Row[] = [];
      if (pageUids.length) {
        for await (const message of client.fetch(
          pageUids,
          { uid: true, envelope: true, flags: true, internalDate: true, size: true, bodyStructure: true },
          { uid: true },
        )) {
          const structure = message.bodyStructure;
          const hasAttachments = Boolean(
            structure?.childNodes?.some(
              (node) => node.disposition === "attachment" || (node.type ?? "").startsWith("application/"),
            ),
          );
          messages.push({
            uid: message.uid,
            subject: message.envelope?.subject ?? "",
            from: addressText(message.envelope?.from),
            to: addressText(message.envelope?.to),
            date: message.envelope?.date ?? message.internalDate ?? null,
            seen: message.flags?.has("\\Seen") ?? false,
            flagged: message.flags?.has("\\Flagged") ?? false,
            answered: message.flags?.has("\\Answered") ?? false,
            hasAttachments,
            size: message.size ?? 0,
          });
        }
      }
      messages.sort((a, b) => b.uid - a.uid);
      return { folder: query.folder, page: query.page, pageSize: PAGE_SIZE, total, messages };
    } finally {
      lock.release();
    }
  });
}

function parsedAddresses(value?: AddressObject | AddressObject[]) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.flatMap((item) =>
    item.value.map((entry) => ({ name: entry.name ?? "", address: entry.address ?? "" })),
  );
}

/** Untrusted e-mail HTML: scripts, forms, iframes and event handlers are
 * removed.  The web app also displays it in a sandboxed frame. */
function safeEmailHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img", "span", "font", "center", "style", "h1", "h2", "h5", "h6", "u", "s", "small", "big", "hr",
    ]),
    allowedAttributes: {
      "*": ["style", "align", "valign", "width", "height", "bgcolor", "color", "dir", "class", "border", "cellpadding", "cellspacing", "colspan", "rowspan"],
      a: ["href", "name", "title", "style"],
      img: ["src", "alt", "title", "width", "height", "style"],
      font: ["face", "size", "color"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel", "data", "cid"],
    allowedSchemesByTag: { img: ["http", "https", "data", "cid"] },
    allowVulnerableTags: true,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
    },
  });
}

async function fetchParsed(client: ImapFlow, uid: number) {
  const message = await client.fetchOne(String(uid), { uid: true, source: true, flags: true }, { uid: true });
  if (!message || !message.source) throw new NotFoundError("Message not found");
  const parsed = await simpleParser(message.source);
  return { message, parsed };
}

async function linkedCandidates(context: MailContext, addresses: string[]) {
  const emails = [...new Set(addresses.map((item) => item.toLowerCase()).filter(Boolean))];
  if (!emails.length || !(context.isOwner || context.permissions.includes("careers.read"))) return [];
  return withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      `SELECT a.id,a.full_name,a.status,a.email::text AS email,j.title AS job_title
         FROM career_applications a
         JOIN career_job_posts j ON j.organization_id=a.organization_id AND j.id=a.job_post_id
        WHERE a.organization_id=$1 AND lower(a.email::text) = ANY($2::text[])
        ORDER BY a.submitted_at DESC LIMIT 5`,
      [context.organizationId, emails],
    );
    return result.rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      status: row.status,
      email: row.email,
      jobTitle: row.job_title,
    }));
  });
}

function summarize(parsed: ParsedMail) {
  return {
    subject: parsed.subject ?? "",
    from: parsedAddresses(parsed.from),
    to: parsedAddresses(parsed.to),
    cc: parsedAddresses(parsed.cc),
    replyTo: parsedAddresses(parsed.replyTo),
    date: parsed.date ?? null,
    messageId: parsed.messageId ?? null,
  };
}

/**
 * Which of the mailbox's own addresses received a message, so a reply goes
 * out from that same address.  Looks at To/Cc, then the delivery headers
 * (Delivered-To, X-Original-To), and finally matches the local part: replies
 * to mail sent through a relay (e.g. recrutement@123.brevosend.com) still
 * belong to recrutement@.
 */
export function receivingAddress(parsed: ParsedMail, own: string[]) {
  const lowerOwn = own.map((item) => item.toLowerCase());
  const headerValues = ["delivered-to", "x-original-to", "envelope-to"].flatMap((name) => {
    const value = parsed.headers.get(name);
    const list = Array.isArray(value) ? value : value ? [value] : [];
    return list.map((item) => String(typeof item === "object" && item && "text" in item ? (item as { text: string }).text : item));
  });
  const candidates = [
    ...parsedAddresses(parsed.to).map((item) => item.address),
    ...parsedAddresses(parsed.cc).map((item) => item.address),
    ...headerValues.flatMap((value) => value.match(/[^\s<>,;"]+@[^\s<>,;"]+/g) ?? []),
  ].map((item) => item.toLowerCase());
  const exact = candidates.find((address) => lowerOwn.includes(address));
  if (exact) return exact;
  // Prefer an alias over the main address when only the local part matches.
  const byLocal = (address: string) => lowerOwn.find((item) => item.split("@")[0] === address.split("@")[0]);
  for (const address of candidates) {
    const match = byLocal(address);
    if (match) return match;
  }
  return null;
}

export async function getMessage(context: MailContext, mailboxId: string, uid: number, folder: string) {
  const { row, connection } = await mailboxConnection(context, mailboxId);
  const ownAddresses = [String(row.email_address), ...(((row.aliases as string[] | null) ?? []) as string[])];
  const detail = await withImap(connection, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const { message, parsed } = await fetchParsed(client, uid);
      const wasSeen = message.flags?.has("\\Seen") ?? false;
      if (!wasSeen) await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      const html = parsed.html
        ? safeEmailHtml(parsed.html)
        : safeEmailHtml(parsed.textAsHtml ?? `<pre>${sanitizeHtml(parsed.text ?? "")}</pre>`);
      return {
        uid,
        folder,
        ...summarize(parsed),
        receivedOn: receivingAddress(parsed, ownAddresses),
        flagged: message.flags?.has("\\Flagged") ?? false,
        html,
        text: parsed.text ?? "",
        attachments: parsed.attachments
          .map((attachment, index) => ({
            index,
            fileName: attachment.filename ?? `piece-jointe-${index + 1}`,
            mimeType: attachment.contentType,
            size: attachment.size,
            inline: attachment.contentDisposition === "inline" && Boolean(attachment.cid),
          }))
          .filter((attachment) => !attachment.inline),
      };
    } finally {
      lock.release();
    }
  });
  const candidates = await linkedCandidates(
    context,
    [...detail.from, ...detail.replyTo].map((item) => item.address),
  );
  return { message: { ...detail, candidates } };
}

/** Raw source of one message, for the AI drafting assistant. */
export async function readMessageSource(
  context: MailContext,
  mailboxId: string,
  uid: number | null,
  folder: string | null,
) {
  const { row, connection } = await mailboxConnection(context, mailboxId);
  const organization = await withTenantContext(context, async (client) => {
    const result = await client.query<{ display_name: string }>(
      `SELECT display_name FROM organizations WHERE id=$1`,
      [context.organizationId],
    );
    return result.rows[0]?.display_name ?? "";
  });
  if (!uid || !folder)
    return {
      source: Buffer.alloc(0),
      mailboxAddress: row.email_address as string,
      aliases: ((row.aliases as string[] | null) ?? []) as string[],
      organizationName: organization,
    };
  const source = await withImap(connection, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const message = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
      if (!message || !message.source) throw new NotFoundError("Message not found");
      return message.source;
    } finally {
      lock.release();
    }
  });
  return {
    source,
    mailboxAddress: row.email_address as string,
    aliases: ((row.aliases as string[] | null) ?? []) as string[],
    organizationName: organization,
  };
}

export async function getAttachment(
  context: MailContext,
  mailboxId: string,
  uid: number,
  folder: string,
  index: number,
) {
  const { connection } = await mailboxConnection(context, mailboxId);
  return withImap(connection, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const { parsed } = await fetchParsed(client, uid);
      const attachment = parsed.attachments[index];
      if (!attachment) throw new NotFoundError("Attachment not found");
      return {
        buffer: attachment.content,
        fileName: attachment.filename ?? `piece-jointe-${index + 1}`,
        mimeType: attachment.contentType || "application/octet-stream",
      };
    } finally {
      lock.release();
    }
  });
}

/** Marks every unread message of a folder (optionally one alias) as read. */
export async function markAllRead(context: MailContext, mailboxId: string, input: MarkAllReadInput) {
  const { connection } = await mailboxConnection(context, mailboxId);
  return withImap(connection, async (client) => {
    const lock = await client.getMailboxLock(input.folder);
    try {
      const criteria: SearchObject = { seen: false };
      if (input.to) criteria.to = input.to;
      const uids = (await client.search(criteria, { uid: true })) || [];
      if (uids.length) await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
      return { updated: uids.length };
    } finally {
      lock.release();
    }
  });
}

export async function updateFlags(context: MailContext, mailboxId: string, uid: number, input: MessageFlagsInput) {
  const { connection } = await mailboxConnection(context, mailboxId);
  return withImap(connection, async (client) => {
    const lock = await client.getMailboxLock(input.folder);
    try {
      const range = String(uid);
      if (input.seen === true) await client.messageFlagsAdd(range, ["\\Seen"], { uid: true });
      if (input.seen === false) await client.messageFlagsRemove(range, ["\\Seen"], { uid: true });
      if (input.flagged === true) await client.messageFlagsAdd(range, ["\\Flagged"], { uid: true });
      if (input.flagged === false) await client.messageFlagsRemove(range, ["\\Flagged"], { uid: true });
      return { updated: true };
    } finally {
      lock.release();
    }
  });
}

async function specialFolder(client: ImapFlow, kind: "\\Trash" | "\\Archive" | "\\Sent" | "\\Junk") {
  const folders = await client.list();
  const found = folders.find((folder) => folder.specialUse === kind);
  if (found) return found.path;
  const names: Record<string, RegExp> = {
    "\\Trash": /^(inbox\.)?(trash|corbeille|deleted)/i,
    "\\Archive": /^(inbox\.)?(archive|archives)/i,
    "\\Sent": /^(inbox\.)?(sent|envoy)/i,
    "\\Junk": /^(inbox\.)?(junk|spam|ind[eé]sirables)/i,
  };
  const byName = folders.find((folder) => names[kind]!.test(folder.path));
  if (byName) return byName.path;
  // Hostinger creates Archive on demand; other special folders exist by default.
  const delimiter = folders.find((folder) => folder.delimiter)?.delimiter ?? ".";
  const prefix = folders.some((folder) => folder.path.toUpperCase().startsWith(`INBOX${delimiter}`)) ? `INBOX${delimiter}` : "";
  const path = `${prefix}${kind.slice(1)}`;
  await client.mailboxCreate(path).catch(() => undefined);
  return path;
}

export async function moveMessage(context: MailContext, mailboxId: string, uid: number, input: MessageMoveInput) {
  const { connection } = await mailboxConnection(context, mailboxId);
  return withImap(connection, async (client) => {
    const target =
      input.target === "inbox"
        ? "INBOX"
        : await specialFolder(
            client,
            input.target === "trash" ? "\\Trash" : input.target === "junk" ? "\\Junk" : "\\Archive",
          );
    if (target === input.folder) return { moved: false, folder: target };
    const lock = await client.getMailboxLock(input.folder);
    try {
      await client.messageMove(String(uid), target, { uid: true });
      return { moved: true, folder: target };
    } finally {
      lock.release();
    }
  });
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

function bodyHtml(body: string, signature: string | null) {
  const escape = (value: string) =>
    value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const paragraphs = escape(body).replace(/\r?\n/g, "<br />");
  const sign = signature ? `<br /><br /><div style="color:#555">${escape(signature).replace(/\r?\n/g, "<br />")}</div>` : "";
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2933">${paragraphs}${sign}</div>`;
}

function quoteBlock(parsed: ParsedMail, french = true) {
  const from = parsedAddresses(parsed.from)[0];
  const who = from ? `${from.name ? `${from.name} ` : ""}<${from.address}>` : "";
  const when = parsed.date
    ? parsed.date.toLocaleString(french ? "fr-FR" : "en-GB", { dateStyle: "long", timeStyle: "short" })
    : "";
  const header = `Le ${when}, ${who} a écrit :`;
  const original = parsed.html ? safeEmailHtml(parsed.html) : (parsed.textAsHtml ?? "");
  return {
    html: `<br /><div style="color:#555;font-size:13px">${sanitizeHtml(header)}</div><blockquote style="margin:6px 0 0;padding-left:12px;border-left:3px solid #d0d7de">${original}</blockquote>`,
    text: `\n\n${header}\n${(parsed.text ?? "")
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}`,
  };
}

export async function sendMessage(
  context: MailContext,
  mailboxId: string,
  input: SendInput,
  files: Express.Multer.File[],
) {
  if (!(canManage(context) || context.permissions.includes("mail.send")))
    throw new ForbiddenError("You cannot send e-mails");
  const { row, connection } = await mailboxConnection(context, mailboxId, true);
  return withImap(connection, async (client) => {
    let original: ParsedMail | null = null;
    if (input.replyToUid && input.replyFolder) {
      const lock = await client.getMailboxLock(input.replyFolder);
      try {
        original = (await fetchParsed(client, input.replyToUid)).parsed;
      } finally {
        lock.release();
      }
    }
    const quote = original ? quoteBlock(original) : null;
    const signature = (row.signature as string | null) ?? null;
    const attachments: Mail.Attachment[] = files.map((file) => ({
      filename: Buffer.from(file.originalname, "latin1").toString("utf8"),
      content: file.buffer,
      contentType: file.mimetype,
    }));
    if (original && input.forwardAttachments)
      for (const attachment of original.attachments)
        if (!(attachment.contentDisposition === "inline" && attachment.cid))
          attachments.push({
            filename: attachment.filename ?? "piece-jointe",
            content: attachment.content,
            contentType: attachment.contentType,
          });
    const references = original
      ? [
          ...(Array.isArray(original.references)
            ? original.references
            : original.references
              ? [original.references]
              : []),
          ...(original.messageId ? [original.messageId] : []),
        ]
      : [];
    // Hostinger lets a mailbox send as any of its aliases with the same login.
    const allowedFrom = [connection.email.toLowerCase(), ...((row.aliases as string[] | null) ?? [])];
    const fromAddress = input.fromAddress && allowedFrom.includes(input.fromAddress) ? input.fromAddress : connection.email;
    if (input.fromAddress && !allowedFrom.includes(input.fromAddress))
      throw new BadRequestError("This sender address is not an alias of the mailbox");
    const options: Mail.Options = {
      from: connection.displayName ? { name: connection.displayName, address: fromAddress } : fromAddress,
      to: input.to,
      cc: input.cc.length ? input.cc : undefined,
      bcc: input.bcc.length ? input.bcc : undefined,
      subject: input.subject,
      text: `${input.body}${signature ? `\n\n${signature}` : ""}${quote?.text ?? ""}`,
      html: `${bodyHtml(input.body, signature)}${quote?.html ?? ""}`,
      attachments,
      inReplyTo: original?.messageId,
      references: references.length ? references : undefined,
    };
    const raw = await new MailComposer(options).compile().build();
    try {
      await smtpTransport(connection).sendMail({
        envelope: {
          from: fromAddress,
          to: [...input.to, ...input.cc, ...input.bcc].map((item) => item.replace(/^.*<(.+)>$/, "$1")),
        },
        raw,
      });
    } catch (error) {
      throw new BadRequestError(friendlyConnectionError(error, "SMTP"));
    }
    // Most hosted mailboxes (Hostinger included) do not file SMTP mail in
    // "Sent" by themselves; keep the same copy the recipient received.
    try {
      const sent = await specialFolder(client, "\\Sent");
      await client.append(sent, raw, ["\\Seen"]);
    } catch (error) {
      logger.warn({ err: error, mailboxId }, "Sent copy could not be stored");
    }
    if (original && input.replyToUid && input.replyFolder) {
      const lock = await client.getMailboxLock(input.replyFolder);
      try {
        await client.messageFlagsAdd(String(input.replyToUid), ["\\Answered"], { uid: true });
      } finally {
        lock.release();
      }
    }
    return { sent: true };
  });
}

/* ------------------------------------------------------------------ */
/* Background check: unread counters and new-mail notifications        */
/* ------------------------------------------------------------------ */

async function notificationRecipients(client: PoolClient, organizationId: string, mailboxId: string) {
  const assigned = await client.query<{ member_id: string }>(
    `SELECT mm.member_id FROM organization_mailbox_members mm
       JOIN organization_members m ON m.organization_id=mm.organization_id AND m.id=mm.member_id AND m.status='active'
      WHERE mm.organization_id=$1 AND mm.mailbox_id=$2`,
    [organizationId, mailboxId],
  );
  if (assigned.rowCount) return assigned.rows.map((row) => row.member_id);
  const managers = await client.query<{ member_id: string }>(
    `SELECT DISTINCT m.id AS member_id FROM organization_members m
       LEFT JOIN member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id
       LEFT JOIN role_permissions rp ON rp.organization_id=mr.organization_id AND rp.role_id=mr.role_id
       LEFT JOIN permissions p ON p.id=rp.permission_id
      WHERE m.organization_id=$1 AND m.status='active' AND (m.is_owner OR p.code='mail.manage')`,
    [organizationId],
  );
  return managers.rows.map((row) => row.member_id);
}

export async function checkMailboxesForOrganization(organizationId: string) {
  const mailboxes = await withTenantContext({ organizationId, userId: null }, async (client) => {
    const result = await client.query<Row>(
      `SELECT mb.*,o.slug AS organization_slug FROM organization_mailboxes mb
         JOIN organizations o ON o.id=mb.organization_id
        WHERE mb.organization_id=$1 AND mb.status <> 'disabled'`,
      [organizationId],
    );
    return result.rows;
  });
  for (const mailbox of mailboxes) {
    try {
      const connection = connectionOf(mailbox);
      const state = await withImap(connection, async (client) => {
        const status = await client.status("INBOX", { unseen: true, uidNext: true, uidValidity: true });
        if (!status) return null;
        const uidValidity = Number(status.uidValidity ?? 0);
        const baseline = Number(mailbox.last_notified_uid ?? 0);
        const fresh: Row[] = [];
        // First check (or a server-side reset) only records a baseline so
        // connecting a mailbox never floods people with old messages.
        if (baseline > 0 && Number(mailbox.inbox_uid_validity ?? 0) === uidValidity) {
          const lock = await client.getMailboxLock("INBOX");
          try {
            for await (const message of client.fetch(
              `${baseline + 1}:*`,
              { uid: true, envelope: true, flags: true },
              { uid: true },
            )) {
              if (message.uid > baseline && !message.flags?.has("\\Seen") && fresh.length < 20) fresh.push(message);
            }
          } finally {
            lock.release();
          }
        }
        return {
          unseen: Number(status.unseen ?? 0),
          lastUid: Math.max(0, Number(status.uidNext ?? 1) - 1),
          uidValidity,
          fresh,
        };
      });
      if (!state) continue;
      await withTenantContext({ organizationId, userId: null }, async (client) => {
        await client.query(
          `UPDATE organization_mailboxes
              SET unseen_count=$3,last_notified_uid=GREATEST($4, CASE WHEN inbox_uid_validity IS DISTINCT FROM $5 THEN 0 ELSE last_notified_uid END),
                  inbox_uid_validity=$5,last_checked_at=now(),status='active',last_error=NULL
            WHERE organization_id=$1 AND id=$2`,
          [organizationId, mailbox.id, state.unseen, state.lastUid, state.uidValidity],
        );
        if (!state.fresh.length) return;
        const recipients = await notificationRecipients(client, organizationId, mailbox.id);
        for (const message of state.fresh) {
          const from = message.envelope?.from?.[0];
          const sender = from?.name || from?.address || "Expéditeur inconnu";
          for (const memberId of recipients) {
            await createNotificationInTransaction(client, {
              organizationId,
              recipientMemberId: memberId,
              type: "mail_received",
              category: "general",
              priority: "normal",
              title: `Nouvel e-mail · ${mailbox.email_address}`,
              message: `${sender} : ${String(message.envelope?.subject ?? "(sans objet)").slice(0, 160)}`,
              actionUrl: `/${mailbox.organization_slug}/mail?mailbox=${mailbox.id}&uid=${message.uid}`,
              entityType: "mailbox",
              entityId: mailbox.id,
              deduplicationKey: `mail:${mailbox.id}:${state.uidValidity}:${message.uid}:${memberId}`,
            });
          }
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await withTenantContext({ organizationId, userId: null }, (client) =>
        client.query(
          `UPDATE organization_mailboxes SET status='error',last_error=$3,last_checked_at=now() WHERE organization_id=$1 AND id=$2`,
          [organizationId, mailbox.id, message.slice(0, 300)],
        ),
      ).catch(() => undefined);
      logger.warn({ err: error, mailboxId: mailbox.id }, "Mailbox check failed");
    }
  }
}
