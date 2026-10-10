import type { PoolClient } from "pg";
import { isAllowedDocumentMimeType } from "../../config/storage";
import {
  deletePrivateDocument,
  readPrivateDocument,
  storePrivateDocument,
} from "../../services/file-storage.service";
import { createNotificationInTransaction } from "../notifications/notifications.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type { ChatAccessInput, MessageInput, MessagesQuery } from "./chat.validation";

export interface ChatContext {
  organizationId: string;
  organizationSlug: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
  permissions: string[];
}

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const PAGE = 50;

/* ------------------------------------------------------------------ */
/* Rights                                                              */
/* ------------------------------------------------------------------ */

type Settings = {
  allowImages: boolean;
  allowDocuments: boolean;
  teamReadOnly: boolean;
  directionLabel: string;
  websiteChatEnabled: boolean;
  websiteAiEnabled: boolean;
  websiteWelcome: string | null;
  websiteKnowledge: string | null;
};
type Rights = {
  moderator: boolean;
  direction: boolean;
  /** Team room only: cannot write. */
  muted: boolean;
  /** Team room only: no access at all (the private thread stays open). */
  blocked: boolean;
  noFiles: boolean;
  /** Customer service: answers website visitors. */
  website: boolean;
  settings: Settings;
};

export async function settingsOf(client: PoolClient, organizationId: string): Promise<Settings> {
  const result = await client.query<Row>(`SELECT * FROM chat_settings WHERE organization_id=$1`, [organizationId]);
  const row = result.rows[0];
  return {
    allowImages: row ? Boolean(row.allow_images) : true,
    allowDocuments: row ? Boolean(row.allow_documents) : true,
    teamReadOnly: row ? Boolean(row.team_read_only) : false,
    directionLabel: String(row?.direction_label ?? "").trim() || "Direction",
    websiteChatEnabled: row && row.website_chat_enabled !== undefined ? Boolean(row.website_chat_enabled) : true,
    websiteAiEnabled: row && row.website_ai_enabled !== undefined ? Boolean(row.website_ai_enabled) : true,
    websiteWelcome: (row?.website_welcome as string | null) ?? null,
    websiteKnowledge: (row?.website_knowledge as string | null) ?? null,
  };
}

export async function rightsOf(client: PoolClient, context: ChatContext): Promise<Rights> {
  const settings = await settingsOf(client, context.organizationId);
  if (context.isOwner)
    return { moderator: true, direction: true, muted: false, blocked: false, noFiles: false, website: true, settings };
  const result = await client.query<Row>(
    `SELECT
       EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id=mr.organization_id AND r.id=mr.role_id
                WHERE mr.organization_id=$1 AND mr.member_id=$2 AND r.code='general_manager') AS manager,
       ca.can_moderate,ca.can_read_direction,ca.muted,ca.blocked,ca.no_files,ca.can_website
       FROM (SELECT 1) one
       LEFT JOIN chat_access ca ON ca.organization_id=$1 AND ca.member_id=$2`,
    [context.organizationId, context.memberId],
  );
  const row = result.rows[0];
  const moderator = Boolean(row?.manager || row?.can_moderate);
  const direction = Boolean(row?.manager || row?.can_read_direction);
  // Management is never restricted by the employee rules.
  const staff = moderator || direction;
  return {
    moderator,
    direction,
    muted: !staff && Boolean(row?.muted),
    blocked: !staff && Boolean(row?.blocked),
    noFiles: !staff && Boolean(row?.no_files),
    website: Boolean(row?.can_website),
    settings,
  };
}

/** What the composer may do in a conversation. */
function composerRules(rights: Rights, kind: string) {
  const staff = rights.moderator || rights.direction;
  if (kind !== "team")
    return { canWrite: true, canSendImages: !rights.noFiles, canSendDocuments: !rights.noFiles, reason: null as string | null };
  const readOnly = rights.muted || (rights.settings.teamReadOnly && !rights.moderator);
  return {
    canWrite: !readOnly,
    canSendImages: !readOnly && (staff || (rights.settings.allowImages && !rights.noFiles)),
    canSendDocuments: !readOnly && (staff || (rights.settings.allowDocuments && !rights.noFiles)),
    reason: rights.muted
      ? "muted"
      : rights.settings.teamReadOnly && !rights.moderator
        ? "read_only"
        : null,
  };
}

/** Owners, general managers and authorised members: who reads direction threads. */
export async function directionStaff(client: PoolClient, organizationId: string) {
  const result = await client.query<{ member_id: string }>(
    `SELECT DISTINCT m.id AS member_id
       FROM organization_members m
       LEFT JOIN member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id
       LEFT JOIN roles r ON r.organization_id=mr.organization_id AND r.id=mr.role_id
       LEFT JOIN chat_access ca ON ca.organization_id=m.organization_id AND ca.member_id=m.id
      WHERE m.organization_id=$1 AND m.status='active'
        AND (m.is_owner OR r.code='general_manager' OR ca.can_read_direction)`,
    [organizationId],
  );
  return result.rows.map((row) => row.member_id);
}

/** Customer service members; the owner when nobody has been chosen. */
export async function customerServiceStaff(client: PoolClient, organizationId: string) {
  const result = await client.query<{ member_id: string }>(
    `SELECT m.id AS member_id FROM organization_members m
       JOIN chat_access ca ON ca.organization_id=m.organization_id AND ca.member_id=m.id
      WHERE m.organization_id=$1 AND m.status='active' AND ca.can_website`,
    [organizationId],
  );
  if (result.rows.length) return result.rows.map((row) => row.member_id);
  const owners = await client.query<{ member_id: string }>(
    `SELECT id AS member_id FROM organization_members WHERE organization_id=$1 AND status='active' AND is_owner`,
    [organizationId],
  );
  return owners.rows.map((row) => row.member_id);
}

async function teamConversation(client: PoolClient, organizationId: string) {
  await client.query(
    `INSERT INTO chat_conversations(organization_id,kind,title) VALUES($1,'team','Équipe')
     ON CONFLICT (organization_id) WHERE kind='team' DO NOTHING`,
    [organizationId],
  );
  const result = await client.query<{ id: string }>(
    `SELECT id FROM chat_conversations WHERE organization_id=$1 AND kind='team'`,
    [organizationId],
  );
  return result.rows[0]!.id;
}

async function conversationFor(client: PoolClient, context: ChatContext, conversationId: string) {
  const result = await client.query<Row>(
    `SELECT * FROM chat_conversations WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, conversationId],
  );
  const conversation = result.rows[0];
  if (!conversation) throw new NotFoundError("Conversation not found");
  const rights = await rightsOf(client, context);
  if (conversation.kind === "direction" && conversation.employee_member_id !== context.memberId && !rights.direction)
    throw new NotFoundError("Conversation not found");
  if (conversation.kind === "team" && rights.blocked)
    throw new ForbiddenError("Vous n’avez plus accès au chat d’équipe. Vous pouvez écrire à la direction.");
  return { conversation, rights };
}

const memberName = `COALESCE(NULLIF(btrim(u.full_name),''), u.email::text)`;

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export async function overview(context: ChatContext) {
  return withTenantContext(context, async (client) => {
    const rights = await rightsOf(client, context);
    const teamId = await teamConversation(client, context.organizationId);
    const unread = async (conversationId: string) => {
      const result = await client.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM chat_messages msg
          WHERE msg.organization_id=$1 AND msg.conversation_id=$2 AND msg.deleted_at IS NULL
            AND msg.author_member_id IS DISTINCT FROM $3
            AND msg.created_at > COALESCE((SELECT last_read_at FROM chat_reads WHERE organization_id=$1 AND conversation_id=$2 AND member_id=$3), '-infinity')`,
        [context.organizationId, conversationId, context.memberId],
      );
      return Number(result.rows[0]?.total ?? 0);
    };
    const mine = await client.query<{ id: string }>(
      `SELECT id FROM chat_conversations WHERE organization_id=$1 AND kind='direction' AND employee_member_id=$2`,
      [context.organizationId, context.memberId],
    );
    let threads: Row[] = [];
    let members: Row[] = [];
    if (rights.direction) {
      const result = await client.query<Row>(
        `SELECT c.id,c.employee_member_id,c.last_message_at,${memberName} AS employee_name,
                (SELECT body FROM chat_messages x WHERE x.organization_id=c.organization_id AND x.conversation_id=c.id AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) AS last_body,
                (SELECT file_name FROM chat_messages x WHERE x.organization_id=c.organization_id AND x.conversation_id=c.id AND x.deleted_at IS NULL ORDER BY x.created_at DESC LIMIT 1) AS last_file,
                (SELECT COUNT(*) FROM chat_messages x
                  WHERE x.organization_id=c.organization_id AND x.conversation_id=c.id AND x.deleted_at IS NULL
                    AND x.author_member_id IS DISTINCT FROM $2
                    AND x.created_at > COALESCE((SELECT last_read_at FROM chat_reads cr WHERE cr.organization_id=c.organization_id AND cr.conversation_id=c.id AND cr.member_id=$2), '-infinity'))::int AS unread
           FROM chat_conversations c
           JOIN organization_members m ON m.organization_id=c.organization_id AND m.id=c.employee_member_id
           JOIN users u ON u.id=m.user_id
          WHERE c.organization_id=$1 AND c.kind='direction' AND c.last_message_at IS NOT NULL
          ORDER BY c.last_message_at DESC
          LIMIT 300`,
        [context.organizationId, context.memberId],
      );
      threads = result.rows;
      const people = await client.query<Row>(
        `SELECT m.id,${memberName} AS name FROM organization_members m JOIN users u ON u.id=m.user_id
          WHERE m.organization_id=$1 AND m.status='active' AND m.id<>$2 ORDER BY 2`,
        [context.organizationId, context.memberId],
      );
      members = people.rows;
    }
    let visitors: { enabled: boolean; pending: number } | null = null;
    if (rights.website) {
      const pending = await client.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM website_chat_sessions WHERE organization_id=$1 AND needs_human AND status='open'`,
        [context.organizationId],
      );
      visitors = { enabled: rights.settings.websiteChatEnabled, pending: Number(pending.rows[0]?.total ?? 0) };
    }
    return {
      visitors,
      me: {
        memberId: context.memberId,
        isOwner: context.isOwner,
        canModerate: rights.moderator,
        canReadDirection: rights.direction,
        blocked: rights.blocked,
        directionLabel: rights.settings.directionLabel,
      },
      team: rights.blocked ? null : { id: teamId, unread: await unread(teamId) },
      myDirection: mine.rows[0] ? { id: mine.rows[0].id, unread: await unread(mine.rows[0].id) } : null,
      threads: threads.map((row) => ({
        id: row.id,
        employee: { id: row.employee_member_id, name: row.employee_name },
        lastMessageAt: row.last_message_at,
        preview: row.last_body ? String(row.last_body).slice(0, 120) : row.last_file ? `📎 ${row.last_file}` : "",
        unread: Number(row.unread ?? 0),
      })),
      members: members.map((row) => ({ id: row.id, name: row.name })),
    };
  });
}

/** Opens (or creates) a private thread: the caller's own, or — for direction
 * staff — the thread of the chosen employee. */
export async function openDirection(context: ChatContext, memberId?: string) {
  return withTenantContext(context, async (client) => {
    let employee = context.memberId;
    if (memberId && memberId !== context.memberId) {
      const rights = await rightsOf(client, context);
      if (!rights.direction) throw new ForbiddenError("You cannot open this conversation");
      const exists = await client.query(
        `SELECT 1 FROM organization_members WHERE organization_id=$1 AND id=$2 AND status='active'`,
        [context.organizationId, memberId],
      );
      if (!exists.rowCount) throw new NotFoundError("Member not found");
      employee = memberId;
    }
    await client.query(
      `INSERT INTO chat_conversations(organization_id,kind,employee_member_id) VALUES($1,'direction',$2)
       ON CONFLICT (organization_id, employee_member_id) WHERE kind='direction' DO NOTHING`,
      [context.organizationId, employee],
    );
    const result = await client.query<{ id: string }>(
      `SELECT id FROM chat_conversations WHERE organization_id=$1 AND kind='direction' AND employee_member_id=$2`,
      [context.organizationId, employee],
    );
    return { id: result.rows[0]!.id };
  });
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

function mapMessage(row: Row, context: ChatContext, rights: Rights, kind: string) {
  const own = row.author_member_id === context.memberId;
  const deleted = Boolean(row.deleted_at);
  // Employees never see who in management wrote: only the direction label.
  // Management sees the real name so they know which colleague answered.
  const viewerIsStaff = rights.direction || context.isOwner;
  const hidden = Boolean(row.author_is_direction) && !viewerIsStaff;
  return {
    id: row.id as string,
    author: row.author_member_id
      ? hidden
        ? { id: "direction", name: rights.settings.directionLabel }
        : { id: row.author_member_id as string, name: row.author_name as string }
      : null,
    authorIsDirection: Boolean(row.author_is_direction),
    body: deleted ? null : ((row.body as string | null) ?? null),
    deleted,
    isAnnouncement: Boolean(row.is_announcement),
    pinned: Boolean(row.pinned_at),
    file:
      !deleted && row.file_name
        ? { name: row.file_name as string, mimeType: row.mime_type as string, size: Number(row.size_bytes ?? 0) }
        : null,
    createdAt: row.created_at,
    mine: own,
    canDelete: !deleted && (own || (kind === "team" && rights.moderator)),
    canPin: !deleted && kind === "team" && rights.moderator,
  };
}

const messageSelect = `SELECT msg.*,${memberName} AS author_name,
    (m.is_owner OR EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id=mr.organization_id AND r.id=mr.role_id
                             WHERE mr.organization_id=msg.organization_id AND mr.member_id=msg.author_member_id AND r.code='general_manager')
                OR COALESCE((SELECT can_read_direction FROM chat_access ca WHERE ca.organization_id=msg.organization_id AND ca.member_id=msg.author_member_id), false)) AS author_is_direction
  FROM chat_messages msg
  LEFT JOIN organization_members m ON m.organization_id=msg.organization_id AND m.id=msg.author_member_id
  LEFT JOIN users u ON u.id=m.user_id`;

export async function listMessages(context: ChatContext, conversationId: string, query: MessagesQuery) {
  return withTenantContext(context, async (client) => {
    const { conversation, rights } = await conversationFor(client, context, conversationId);
    const params: unknown[] = [context.organizationId, conversationId];
    let filter = "";
    if (query.after) {
      params.push(query.after);
      filter = ` AND msg.created_at > $${params.length}`;
    } else if (query.before) {
      params.push(query.before);
      filter = ` AND msg.created_at < $${params.length}`;
    }
    const result = await client.query<Row>(
      `${messageSelect}
        WHERE msg.organization_id=$1 AND msg.conversation_id=$2${filter}
        ORDER BY msg.created_at DESC
        LIMIT ${PAGE + 1}`,
      params,
    );
    const hasMore = result.rows.length > PAGE && !query.after;
    const rows = result.rows.slice(0, PAGE).reverse();
    if (!query.before) {
      await client.query(
        `INSERT INTO chat_reads(organization_id,conversation_id,member_id,last_read_at) VALUES($1,$2,$3,now())
         ON CONFLICT (organization_id,conversation_id,member_id) DO UPDATE SET last_read_at=now()`,
        [context.organizationId, conversationId, context.memberId],
      );
    }
    const pinned =
      conversation.kind === "team" && !query.after && !query.before
        ? (
            await client.query<Row>(
              `${messageSelect}
                WHERE msg.organization_id=$1 AND msg.conversation_id=$2 AND msg.pinned_at IS NOT NULL AND msg.deleted_at IS NULL
                ORDER BY msg.pinned_at DESC LIMIT 5`,
              [context.organizationId, conversationId],
            )
          ).rows
        : [];
    let employeeName: string | null = null;
    if (conversation.kind === "direction") {
      const who = await client.query<{ name: string }>(
        `SELECT ${memberName} AS name FROM organization_members m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.id=$2`,
        [context.organizationId, conversation.employee_member_id],
      );
      employeeName = who.rows[0]?.name ?? null;
    }
    return {
      conversation: {
        id: conversation.id,
        kind: conversation.kind,
        employee: conversation.employee_member_id
          ? { id: conversation.employee_member_id, name: employeeName }
          : null,
        canAnnounce: conversation.kind === "team" && rights.moderator,
        composer: composerRules(rights, conversation.kind),
      },
      messages: rows.map((row) => mapMessage(row, context, rights, conversation.kind)),
      pinned: pinned.map((row) => mapMessage(row, context, rights, conversation.kind)),
      hasMore,
    };
  });
}

export async function sendMessage(
  context: ChatContext,
  conversationId: string,
  input: MessageInput,
  file?: Express.Multer.File,
) {
  if (!input.body?.trim() && !file) throw new BadRequestError("Écrivez un message ou joignez un fichier.");
  if (file && !isAllowedDocumentMimeType(file.mimetype))
    throw new BadRequestError("Ce type de fichier n’est pas accepté (photos, PDF, Word, Excel…).");
  const stored = file
    ? await storePrivateDocument({
        organizationId: context.organizationId,
        originalName: file.originalname,
        mimeType: file.mimetype,
        buffer: file.buffer,
      })
    : null;
  try {
    return await withTenantContext(context, async (client) => {
      const { conversation, rights } = await conversationFor(client, context, conversationId);
      const rules = composerRules(rights, conversation.kind);
      if (!rules.canWrite)
        throw new ForbiddenError(
          rules.reason === "muted"
            ? "Vous êtes en lecture seule dans le chat d’équipe."
            : "Le chat d’équipe est en lecture seule : seuls les modérateurs écrivent.",
        );
      if (file) {
        const isImage = file.mimetype.startsWith("image/");
        if (isImage ? !rules.canSendImages : !rules.canSendDocuments)
          throw new ForbiddenError(
            isImage ? "L’envoi de photos est désactivé par le propriétaire." : "L’envoi de documents est désactivé par le propriétaire.",
          );
      }
      const announcement = Boolean(input.announcement) && conversation.kind === "team";
      if (announcement && !rights.moderator) throw new ForbiddenError("Only moderators can post announcements");
      const fileName = file ? Buffer.from(file.originalname, "latin1").toString("utf8").slice(0, 255) : null;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO chat_messages(organization_id,conversation_id,author_member_id,body,is_announcement,pinned_at,storage_path,file_name,mime_type,size_bytes)
         VALUES($1,$2,$3,$4,$5,CASE WHEN $5 THEN now() END,$6,$7,$8,$9) RETURNING id`,
        [
          context.organizationId,
          conversationId,
          context.memberId,
          input.body?.trim() || null,
          announcement,
          stored?.storagePath ?? null,
          fileName,
          stored?.mimeType ?? null,
          stored?.bytes ?? null,
        ],
      );
      await client.query(
        `UPDATE chat_conversations SET last_message_at=now() WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, conversationId],
      );
      // Notifications: private messages always, team room only for announcements.
      const author = await client.query<{ name: string }>(
        `SELECT ${memberName} AS name FROM organization_members m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.id=$2`,
        [context.organizationId, context.memberId],
      );
      const authorName = author.rows[0]?.name ?? "";
      const preview = (input.body?.trim() || (fileName ? `📎 ${fileName}` : "")).slice(0, 160);
      let recipients: string[] = [];
      let title = "";
      if (conversation.kind === "direction") {
        if (conversation.employee_member_id === context.memberId) {
          recipients = (await directionStaff(client, context.organizationId)).filter((id) => id !== context.memberId);
          title = `Message privé de ${authorName}`;
        } else {
          recipients = [conversation.employee_member_id];
          title = "Nouveau message de la direction";
        }
      } else if (announcement) {
        const everyone = await client.query<{ id: string }>(
          `SELECT id FROM organization_members WHERE organization_id=$1 AND status='active' AND id<>$2`,
          [context.organizationId, context.memberId],
        );
        recipients = everyone.rows.map((row) => row.id);
        title = `Annonce · ${rights.direction ? rights.settings.directionLabel : authorName}`;
      }
      for (const recipient of recipients) {
        await createNotificationInTransaction(client, {
          organizationId: context.organizationId,
          recipientMemberId: recipient,
          type: conversation.kind === "direction" ? "chat_private_message" : "chat_announcement",
          category: "general",
          priority: conversation.kind === "direction" ? "high" : "normal",
          title,
          message: conversation.kind === "direction" ? "Ouvrez le chat pour lire le message." : preview,
          actionUrl: `/${context.organizationSlug}/chat?c=${conversationId}`,
          entityType: "chat_conversation",
          entityId: conversationId,
          deduplicationKey: `chat:${inserted.rows[0]!.id}:${recipient}`,
        });
      }
      return { id: inserted.rows[0]!.id };
    });
  } catch (error) {
    if (stored) await deletePrivateDocument(stored.storagePath).catch(() => undefined);
    throw error;
  }
}

async function messageWithAccess(client: PoolClient, context: ChatContext, messageId: string) {
  const result = await client.query<Row>(
    `SELECT msg.*,c.kind FROM chat_messages msg
       JOIN chat_conversations c ON c.organization_id=msg.organization_id AND c.id=msg.conversation_id
      WHERE msg.organization_id=$1 AND msg.id=$2`,
    [context.organizationId, messageId],
  );
  const message = result.rows[0];
  if (!message) throw new NotFoundError("Message not found");
  const { rights } = await conversationFor(client, context, message.conversation_id);
  return { message, rights };
}

export async function deleteMessage(context: ChatContext, messageId: string) {
  const path = await withTenantContext(context, async (client) => {
    const { message, rights } = await messageWithAccess(client, context, messageId);
    const own = message.author_member_id === context.memberId;
    if (!own && !(message.kind === "team" && rights.moderator))
      throw new ForbiddenError("You cannot delete this message");
    await client.query(
      `UPDATE chat_messages SET deleted_at=now(),deleted_by_member_id=$3,body=NULL,pinned_at=NULL,
              storage_path=NULL,file_name=NULL,mime_type=NULL,size_bytes=NULL
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, messageId, context.memberId],
    );
    return message.storage_path as string | null;
  });
  if (path) await deletePrivateDocument(path).catch(() => undefined);
  return { deleted: true };
}

export async function pinMessage(context: ChatContext, messageId: string, pinned: boolean) {
  return withTenantContext(context, async (client) => {
    const { message, rights } = await messageWithAccess(client, context, messageId);
    if (message.kind !== "team" || !rights.moderator) throw new ForbiddenError("Only moderators can pin messages");
    await client.query(
      `UPDATE chat_messages SET pinned_at=CASE WHEN $3 THEN now() END WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL`,
      [context.organizationId, messageId, pinned],
    );
    return { pinned };
  });
}

export async function messageFile(context: ChatContext, messageId: string) {
  return withTenantContext(context, async (client) => {
    const { message } = await messageWithAccess(client, context, messageId);
    if (!message.storage_path || message.deleted_at) throw new NotFoundError("File not found");
    return {
      buffer: await readPrivateDocument(String(message.storage_path)),
      fileName: String(message.file_name ?? "fichier"),
      mimeType: String(message.mime_type ?? "application/octet-stream"),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Owner settings: who moderates, who reads private messages           */
/* ------------------------------------------------------------------ */

export async function getAccess(context: ChatContext) {
  if (!context.isOwner) throw new ForbiddenError("Only the owner can manage chat access");
  return withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      `SELECT m.id,${memberName} AS name,m.is_owner,
              EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id=mr.organization_id AND r.id=mr.role_id
                       WHERE mr.organization_id=m.organization_id AND mr.member_id=m.id AND r.code='general_manager') AS manager,
              COALESCE(ca.can_moderate,false) AS can_moderate,COALESCE(ca.can_read_direction,false) AS can_read_direction,
              COALESCE(ca.muted,false) AS muted,COALESCE(ca.blocked,false) AS blocked,COALESCE(ca.no_files,false) AS no_files,
              COALESCE(ca.can_website,false) AS can_website
         FROM organization_members m JOIN users u ON u.id=m.user_id
         LEFT JOIN chat_access ca ON ca.organization_id=m.organization_id AND ca.member_id=m.id
        WHERE m.organization_id=$1 AND m.status='active'
        ORDER BY m.is_owner DESC, 2`,
      [context.organizationId],
    );
    return {
      settings: await settingsOf(client, context.organizationId),
      members: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        locked: Boolean(row.is_owner || row.manager),
        role: row.is_owner ? "owner" : row.manager ? "general_manager" : null,
        canModerate: Boolean(row.is_owner || row.manager || row.can_moderate),
        canReadDirection: Boolean(row.is_owner || row.manager || row.can_read_direction),
        muted: Boolean(row.muted),
        blocked: Boolean(row.blocked),
        noFiles: Boolean(row.no_files),
        canWebsite: Boolean(row.is_owner || row.can_website),
      })),
    };
  });
}

export async function saveAccess(context: ChatContext, input: ChatAccessInput) {
  if (!context.isOwner) throw new ForbiddenError("Only the owner can manage chat access");
  await withTenantContext(context, async (client) => {
    if (input.settings) {
      const current = await settingsOf(client, context.organizationId);
      const next = input.settings;
      await client.query(
        `INSERT INTO chat_settings(organization_id,allow_images,allow_documents,team_read_only,direction_label,
                                   website_chat_enabled,website_ai_enabled,website_welcome,website_knowledge,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
         ON CONFLICT (organization_id) DO UPDATE SET allow_images=EXCLUDED.allow_images,allow_documents=EXCLUDED.allow_documents,
           team_read_only=EXCLUDED.team_read_only,direction_label=EXCLUDED.direction_label,
           website_chat_enabled=EXCLUDED.website_chat_enabled,website_ai_enabled=EXCLUDED.website_ai_enabled,
           website_welcome=EXCLUDED.website_welcome,website_knowledge=EXCLUDED.website_knowledge,updated_at=now()`,
        [
          context.organizationId,
          next.allowImages,
          next.allowDocuments,
          next.teamReadOnly,
          next.directionLabel?.trim() || "Direction",
          next.websiteChatEnabled ?? current.websiteChatEnabled,
          next.websiteAiEnabled ?? current.websiteAiEnabled,
          next.websiteWelcome === undefined ? current.websiteWelcome : next.websiteWelcome?.trim() || null,
          next.websiteKnowledge === undefined ? current.websiteKnowledge : next.websiteKnowledge?.trim() || null,
        ],
      );
    }
    for (const item of input.members) {
      if (!item.canModerate && !item.canReadDirection && !item.muted && !item.blocked && !item.noFiles && !item.canWebsite) {
        await client.query(`DELETE FROM chat_access WHERE organization_id=$1 AND member_id=$2`, [
          context.organizationId,
          item.memberId,
        ]);
        continue;
      }
      await client.query(
        `INSERT INTO chat_access(organization_id,member_id,can_moderate,can_read_direction,muted,blocked,no_files,can_website,updated_at)
         SELECT $1,m.id,$3,$4,$5,$6,$7,$8,now() FROM organization_members m WHERE m.organization_id=$1 AND m.id=$2 AND NOT m.is_owner
         ON CONFLICT (organization_id,member_id) DO UPDATE SET can_moderate=EXCLUDED.can_moderate,can_read_direction=EXCLUDED.can_read_direction,
           muted=EXCLUDED.muted,blocked=EXCLUDED.blocked,no_files=EXCLUDED.no_files,can_website=EXCLUDED.can_website,updated_at=now()`,
        [context.organizationId, item.memberId, item.canModerate, item.canReadDirection, item.muted, item.blocked, item.noFiles, item.canWebsite],
      );
    }
  });
  return getAccess(context);
}

/** Unread total for the navigation badge. */
export async function unreadTotal(context: ChatContext) {
  const data = await overview(context);
  return {
    unread:
      (data.team?.unread ?? 0) +
      (data.myDirection?.unread ?? 0) +
      data.threads.reduce((sum, thread) => sum + (thread.employee.id === context.memberId ? 0 : thread.unread), 0) +
      (data.visitors?.pending ?? 0),
  };
}

/** Owner or chat moderators: the name shown for management in the chat. */
export async function saveDirectionLabel(context: ChatContext, label: string) {
  return withTenantContext(context, async (client) => {
    const rights = await rightsOf(client, context);
    if (!context.isOwner && !rights.moderator) throw new ForbiddenError("You cannot change this setting");
    const clean = label.trim().slice(0, 60) || "Direction";
    await client.query(
      `INSERT INTO chat_settings(organization_id,direction_label,updated_at) VALUES($1,$2,now())
       ON CONFLICT (organization_id) DO UPDATE SET direction_label=EXCLUDED.direction_label,updated_at=now()`,
      [context.organizationId, clean],
    );
    return { directionLabel: clean };
  });
}
