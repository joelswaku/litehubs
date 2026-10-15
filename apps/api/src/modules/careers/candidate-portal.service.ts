import type { PoolClient } from "pg";
import { db } from "../../config/database";
import { logger } from "../../config/logger";
import {
  deletePrivateDocument,
  readPrivateDocument,
  storePrivateDocument,
} from "../../services/file-storage.service";
import { sendMail, sendSms } from "../../services/notification.service";
import { createNotificationInTransaction } from "../notifications/notifications.service";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import {
  CANDIDATE_CONTACT_EMAIL,
  RECRUITMENT_FROM_ADDRESS,
  applicationById,
  assertSiteAccess,
  candidatePortalButtonHtml,
  escapeHtml,
  event,
  publicCareersBranding,
  recipients,
  type CareersContext,
  type Row,
} from "./careers.service";
import {
  hashCandidatePortalToken,
  issueCandidatePortalLink,
} from "./candidate-portal-links";
import type {
  DocumentRequestInput,
  CandidateMessageInput,
  DocumentDeadlineInput,
  DocumentReviewInput,
} from "./careers.validation";

/** Multer exposes multipart file names as latin1; restore UTF-8 accents. */
function uploadedName(name: string) {
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return (decoded.includes("\uFFFD") ? name : decoded).slice(0, 255);
}

/** Applications that are still being decided receive the automatic link. */
const OPEN_STATUSES = ["received", "reviewing", "shortlisted", "interview", "offered"];
const BACKFILL_BATCH = 25;
const MAX_LINK_ATTEMPTS = 3;
export const CANDIDATE_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/** Files one requested document may hold (ID front and back, several pages…). */
export const MAX_FILES_PER_DOCUMENT = 5;
/** Deadlines are calendar days in Kinshasa: the day itself is still open. */
const OVERDUE_SQL = `(r.due_date IS NOT NULL AND r.due_date < (now() AT TIME ZONE 'Africa/Kinshasa')::date)`;
const DEADLINE_PASSED_MESSAGE = `Le délai pour envoyer ce document est dépassé. Contactez l’équipe de recrutement (${CANDIDATE_CONTACT_EMAIL}) pour obtenir un nouveau délai.`;

const STATUS_STEPS = ["received", "reviewing", "shortlisted", "interview", "offered", "hired"] as const;

type TrackingLookup = {
  tokenId: string;
  organizationId: string;
  applicationId: string;
  expiresAt: string;
};

function mapDocumentRequest(row: Row, includeInternal: boolean) {
  return {
    id: row.id as string,
    label: row.label as string,
    description: (row.description as string | null) ?? null,
    status: row.status as string,
    dueDate: (row.due_date as string | null) ?? null,
    overdue: Boolean(row.overdue),
    // The candidate can no longer add or remove files once the deadline has
    // passed: the team extends it ("Prolonger le délai") to reopen uploads.
    uploadsClosed:
      Boolean(row.overdue) && ["requested", "rejected", "submitted"].includes(String(row.status)),
    files: ((row.files as Row[] | null) ?? []).map((file) => ({
      id: String(file.id),
      fileName: String(file.file_name),
      mimeType: String(file.mime_type),
      sizeBytes: Number(file.size_bytes ?? 0),
      uploadedAt: file.created_at,
    })),
    file: row.file_name
      ? {
          fileName: row.file_name as string,
          mimeType: row.mime_type as string,
          sizeBytes: Number(row.size_bytes ?? 0),
        }
      : null,
    submittedAt: row.submitted_at ?? null,
    reviewedAt: row.reviewed_at ?? null,
    reviewNote: (row.review_note as string | null) ?? null,
    createdAt: row.created_at,
    ...(includeInternal
      ? {
          requestedBy: (row.requested_by_name as string | null) ?? null,
          reviewedBy: (row.reviewed_by_name as string | null) ?? null,
        }
      : {}),
  };
}

async function documentRequests(
  client: PoolClient,
  organizationId: string,
  applicationId: string,
) {
  const result = await client.query<Row>(
    `SELECT r.*,r.due_date::text AS due_date,${OVERDUE_SQL} AS overdue,
            rq.full_name AS requested_by_name,rv.full_name AS reviewed_by_name,
            COALESCE((SELECT json_agg(json_build_object('id',f.id,'file_name',f.file_name,'mime_type',f.mime_type,
                                                        'size_bytes',f.size_bytes,'created_at',f.created_at)
                                      ORDER BY f.created_at)
                        FROM career_application_document_files f
                       WHERE f.organization_id=r.organization_id AND f.request_id=r.id),'[]'::json) AS files
       FROM career_application_document_requests r
       LEFT JOIN users rq ON rq.id=r.requested_by
       LEFT JOIN users rv ON rv.id=r.reviewed_by
      WHERE r.organization_id=$1 AND r.application_id=$2
      ORDER BY r.created_at`,
    [organizationId, applicationId],
  );
  return result.rows;
}

/* ------------------------------------------------------------------ */
/* Candidate e-mails                                                  */
/* ------------------------------------------------------------------ */

type PortalMail = {
  to: string;
  phone: string;
  french: boolean;
  organizationName: string;
  fullName: string;
  subject: string;
  heading: string;
  paragraphs: string[];
  url: string;
  sms: string;
};

function buildPortalEmail(mail: PortalMail) {
  const greeting = mail.french ? `Bonjour ${mail.fullName},` : `Hello ${mail.fullName},`;
  const footer = mail.french
    ? `Pour toute question concernant votre candidature, écrivez à ${CANDIDATE_CONTACT_EMAIL}.`
    : `For questions about your application, email ${CANDIDATE_CONTACT_EMAIL}.`;
  const text = [
    greeting,
    "",
    ...mail.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    mail.french ? `Votre Espace candidat : ${mail.url}` : `Your candidate space: ${mail.url}`,
    "",
    footer,
  ].join("\n");
  const body = mail.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 15px;color:#344b3d;font-size:15px;line-height:1.65;">${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`,
    )
    .join("");
  return {
    to: mail.to,
    from: RECRUITMENT_FROM_ADDRESS,
    subject: mail.subject,
    text,
    html: `<!doctype html><html lang="${mail.french ? "fr" : "en"}"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(mail.subject)}</title></head><body style="margin:0;padding:0;background:#f3f7f5;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#172b23;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#f3f7f5;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #d8e5dc;border-radius:16px;overflow:hidden;"><tr><td style="padding:25px 32px;background:#114b32;color:#fff;font-size:21px;font-weight:800;">${escapeHtml(mail.organizationName)}</td></tr><tr><td style="padding:34px 32px 30px;"><div style="width:42px;height:5px;margin:0 0 20px;background:#29a36a;border-radius:99px;"></div><h1 style="margin:0 0 19px;color:#14251d;font-size:25px;line-height:1.25;">${escapeHtml(mail.heading)}</h1><p style="margin:0 0 17px;color:#344b3d;font-size:15px;line-height:1.65;">${escapeHtml(greeting)}</p>${body}${candidatePortalButtonHtml(mail.url, mail.french)}</td></tr><tr><td style="padding:20px 32px;background:#f7faf8;border-top:1px solid #e1ebe5;color:#66776d;font-size:12px;line-height:1.55;">${escapeHtml(footer)}</td></tr></table></td></tr></table></body></html>`,
  };
}

/**
 * E-mail first. The SMS is sent only when the candidate has no e-mail or the
 * e-mail could not be delivered, so one update never costs two messages.
 * `explicit` is for a message where the recruiter ticked the channels
 * themselves: then every chosen channel is used.
 */
async function deliverPortalMail(mail: PortalMail, mode: "email_first" | "explicit" = "email_first") {
  if (mode === "explicit") {
    const [email, sms] = await Promise.all([
      mail.to
        ? sendMail(buildPortalEmail(mail))
        : Promise.resolve({ sent: false, reason: "email_not_selected" }),
      mail.phone
        ? sendSms({ to: mail.phone, content: mail.sms })
        : Promise.resolve({ sent: false, reason: "sms_not_selected" }),
    ]);
    return {
      emailSent: email.sent,
      emailReason: email.sent ? undefined : email.reason,
      smsSent: sms.sent,
      smsReason: sms.sent ? undefined : sms.reason,
    };
  }
  const email = mail.to
    ? await sendMail(buildPortalEmail(mail))
    : { sent: false, reason: "email_missing" };
  const sms = email.sent
    ? { sent: false, reason: "email_delivered" }
    : mail.phone
      ? await sendSms({ to: mail.phone, content: mail.sms })
      : { sent: false, reason: "phone_missing" };
  return {
    emailSent: email.sent,
    emailReason: email.sent ? undefined : email.reason,
    smsSent: sms.sent,
    smsReason: sms.sent ? undefined : sms.reason,
  };
}

function candidateBasics(application: Row) {
  const french = application.preferred_language !== "en";
  return {
    french,
    to: String(application.email ?? ""),
    phone: String(application.phone ?? ""),
    fullName: String(application.full_name ?? "").trim(),
    organizationName: String(application.organization_name ?? "LiteHubs").trim() || "LiteHubs",
    jobTitle: String(application.job_title ?? "").trim(),
  };
}

function smsLine(organizationName: string, text: string, url: string) {
  const suffix = ` ${url}`;
  return `${organizationName} : ${text}`.replace(/\s+/g, " ").slice(0, 600 - suffix.length) + suffix;
}

/* ------------------------------------------------------------------ */
/* Public Espace candidat                                              */
/* ------------------------------------------------------------------ */

async function lookup(orgSlug: string, token: string) {
  const result = await db.query<{ payload: TrackingLookup | null }>(
    `SELECT public_career_tracking_lookup($1,$2) AS payload`,
    [orgSlug, hashCandidatePortalToken(token)],
  );
  const payload = result.rows[0]?.payload;
  if (!payload)
    throw new NotFoundError(
      "This candidate link is unavailable or has expired. Request a new link from the careers page.",
    );
  return payload;
}

function candidateTimeline(events: Row[]) {
  const timeline: { type: string; status?: string; message?: string; label?: string; at: string }[] = [];
  for (const row of events) {
    const type = String(row.event_type);
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    if (type === "submitted_public") {
      timeline.push({ type: "status", status: "received", at: row.created_at });
    } else if (type.startsWith("status_")) {
      const status = type.slice("status_".length);
      const last = [...timeline].reverse().find((item) => item.type === "status");
      if (last?.status !== status) timeline.push({ type: "status", status, at: row.created_at });
    } else if (
      (type === "candidate_notification_queued" || type === "candidate_message") &&
      typeof metadata.candidateMessage === "string"
    ) {
      timeline.push({ type: "message", message: metadata.candidateMessage, at: row.created_at });
    } else if (type.startsWith("document_") && typeof metadata.label === "string") {
      timeline.push({ type, label: metadata.label, at: row.created_at });
    }
  }
  return timeline.reverse();
}

export async function publicTracking(orgSlug: string, token: string) {
  const found = await lookup(orgSlug, token);
  const branding = await publicCareersBranding(orgSlug);
  return withTenantContext(
    { organizationId: found.organizationId, userId: null },
    async (client) => {
      const application = await applicationById(client, found.organizationId, found.applicationId);
      await client.query(
        `UPDATE career_application_access_tokens SET last_used_at=now() WHERE organization_id=$1 AND id=$2`,
        [found.organizationId, found.tokenId],
      );
      const events = await client.query<Row>(
        `SELECT event_type,metadata,created_at FROM career_application_events
          WHERE organization_id=$1 AND application_id=$2
          ORDER BY created_at, id`,
        [found.organizationId, found.applicationId],
      );
      const requests = await documentRequests(client, found.organizationId, found.applicationId);
      const status = String(application.status);
      return {
        branding,
        candidate: {
          organizationName: String(application.organization_name ?? ""),
          fullName: String(application.full_name ?? ""),
          email: String(application.email ?? ""),
          preferredLanguage: application.preferred_language === "en" ? "en" : "fr",
          status,
          steps: STATUS_STEPS,
          closed: ["rejected", "withdrawn"].includes(status),
          submittedAt: application.submitted_at,
          updatedAt: application.reviewed_at ?? application.submitted_at,
          job: {
            code: String(application.job_code ?? ""),
            title: String(application.job_title ?? ""),
            siteName: String(application.site_name ?? ""),
            provinceName: String(application.province_name ?? ""),
          },
          resume: application.resume_file_name
            ? { fileName: String(application.resume_file_name) }
            : null,
          documentRequests: requests
            .filter((row) => row.status !== "cancelled")
            .map((row) => mapDocumentRequest(row, false)),
          timeline: candidateTimeline(events.rows),
          linkExpiresAt: found.expiresAt,
          contactEmail: CANDIDATE_CONTACT_EMAIL,
        },
      };
    },
  );
}

export async function publicSubmitDocument(
  orgSlug: string,
  token: string,
  requestId: string,
  file: Express.Multer.File,
) {
  if (!CANDIDATE_DOCUMENT_MIME_TYPES.has(file.mimetype))
    throw new BadRequestError("Envoyez un PDF, une image (JPEG, PNG, WebP) ou un document Word.", { field: "file" });
  const found = await lookup(orgSlug, token);
  const stored = await storePrivateDocument({
    organizationId: found.organizationId,
    originalName: file.originalname,
    mimeType: file.mimetype,
    buffer: file.buffer,
  });
  try {
    const result = await withTenantContext(
      { organizationId: found.organizationId, userId: null },
      async (client) => {
        const application = await applicationById(client, found.organizationId, found.applicationId);
        if (["rejected", "withdrawn", "hired"].includes(String(application.status)))
          throw new BadRequestError("Cette candidature n’accepte plus de documents.");
        const current = await client.query<Row>(
          `SELECT r.*,${OVERDUE_SQL} AS overdue FROM career_application_document_requests r
            WHERE r.organization_id=$1 AND r.application_id=$2 AND r.id=$3
            FOR UPDATE`,
          [found.organizationId, found.applicationId, requestId],
        );
        const request = current.rows[0];
        if (!request || request.status === "cancelled")
          throw new NotFoundError("Document request not found");
        if (!["requested", "rejected", "submitted"].includes(String(request.status)))
          throw new BadRequestError("Ce document a déjà été validé par l’équipe de recrutement.");
        if (request.overdue) throw new BadRequestError(DEADLINE_PASSED_MESSAGE);
        // A rejected document starts a new round: the refused files go away.
        const removed: string[] = [];
        if (request.status === "rejected") {
          const old = await client.query<{ storage_path: string }>(
            `DELETE FROM career_application_document_files WHERE organization_id=$1 AND request_id=$2
             RETURNING storage_path`,
            [found.organizationId, requestId],
          );
          removed.push(...old.rows.map((row) => row.storage_path));
        } else {
          const count = await client.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM career_application_document_files WHERE organization_id=$1 AND request_id=$2`,
            [found.organizationId, requestId],
          );
          if ((count.rows[0]?.n ?? 0) >= MAX_FILES_PER_DOCUMENT)
            throw new BadRequestError(
              `Ce document contient déjà ${MAX_FILES_PER_DOCUMENT} fichiers. Retirez-en un avant d’en ajouter un autre.`,
            );
        }
        const name = uploadedName(file.originalname);
        await client.query(
          `INSERT INTO career_application_document_files
             (organization_id,request_id,storage_path,file_name,mime_type,size_bytes,checksum_sha256)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [found.organizationId, requestId, stored.storagePath, name, stored.mimeType, stored.bytes, stored.checksumSha256],
        );
        await client.query(
          `UPDATE career_application_document_requests
              SET status='submitted',storage_path=$4,file_name=$5,mime_type=$6,size_bytes=$7,checksum_sha256=$8,
                  submitted_at=now(),reviewed_at=NULL,reviewed_by=NULL,review_note=NULL
            WHERE organization_id=$1 AND application_id=$2 AND id=$3`,
          [
            found.organizationId,
            found.applicationId,
            requestId,
            stored.storagePath,
            name,
            stored.mimeType,
            stored.bytes,
            stored.checksumSha256,
          ],
        );
        await event(client, found.organizationId, found.applicationId, "document_submitted", null, {
          requestId,
          label: request.label,
        });
        const team = await recipients(client, found.organizationId);
        await Promise.all(
          team.map((recipient) =>
            createNotificationInTransaction(client, {
              organizationId: found.organizationId,
              recipientMemberId: recipient.member_id,
              provinceId: application.province_id,
              type: "career_document_submitted",
              category: "general",
              priority: "normal",
              title: "Document reçu d’un candidat",
              message: `${application.full_name} a envoyé « ${request.label} » pour ${application.job_title}.`,
              actionUrl: `/${application.organization_slug}/careers`,
              entityType: "career_application",
              entityId: found.applicationId,
              deduplicationKey: `career-document:${requestId}:${stored.checksumSha256.slice(0, 16)}:${recipient.member_id}`,
            }),
          ),
        );
        return { removed };
      },
    );
    for (const path of result.removed)
      if (path !== stored.storagePath) await deletePrivateDocument(path).catch(() => undefined);
    return { submitted: true };
  } catch (error) {
    await deletePrivateDocument(stored.storagePath).catch(() => undefined);
    throw error;
  }
}

/** The candidate removes one of their files before the team has validated it. */
export async function publicDeleteDocumentFile(
  orgSlug: string,
  token: string,
  requestId: string,
  fileId: string,
) {
  const found = await lookup(orgSlug, token);
  const removed = await withTenantContext(
    { organizationId: found.organizationId, userId: null },
    async (client) => {
      const current = await client.query<Row>(
        `SELECT r.*,${OVERDUE_SQL} AS overdue FROM career_application_document_requests r
          WHERE r.organization_id=$1 AND r.application_id=$2 AND r.id=$3 FOR UPDATE`,
        [found.organizationId, found.applicationId, requestId],
      );
      const request = current.rows[0];
      if (!request || request.status === "cancelled") throw new NotFoundError("Document request not found");
      if (!["submitted", "rejected", "requested"].includes(String(request.status)))
        throw new BadRequestError("Ce document a déjà été validé par l’équipe de recrutement.");
      if (request.overdue) throw new BadRequestError(DEADLINE_PASSED_MESSAGE);
      const deleted = await client.query<{ storage_path: string; file_name: string }>(
        `DELETE FROM career_application_document_files WHERE organization_id=$1 AND request_id=$2 AND id=$3
         RETURNING storage_path,file_name`,
        [found.organizationId, requestId, fileId],
      );
      const file = deleted.rows[0];
      if (!file) throw new NotFoundError("File not found");
      const latest = await client.query<Row>(
        `SELECT * FROM career_application_document_files WHERE organization_id=$1 AND request_id=$2
          ORDER BY created_at DESC LIMIT 1`,
        [found.organizationId, requestId],
      );
      const next = latest.rows[0];
      if (next)
        await client.query(
          `UPDATE career_application_document_requests
              SET storage_path=$4,file_name=$5,mime_type=$6,size_bytes=$7,checksum_sha256=$8
            WHERE organization_id=$1 AND application_id=$2 AND id=$3`,
          [found.organizationId, found.applicationId, requestId, next.storage_path, next.file_name,
           next.mime_type, next.size_bytes, next.checksum_sha256],
        );
      else
        await client.query(
          `UPDATE career_application_document_requests
              SET status=CASE WHEN status='submitted' THEN 'requested' ELSE status END,
                  storage_path=NULL,file_name=NULL,mime_type=NULL,size_bytes=NULL,checksum_sha256=NULL,submitted_at=NULL
            WHERE organization_id=$1 AND application_id=$2 AND id=$3`,
          [found.organizationId, found.applicationId, requestId],
        );
      await event(client, found.organizationId, found.applicationId, "document_file_removed", null, {
        requestId,
        label: request.label,
        fileName: file.file_name,
      });
      return file.storage_path;
    },
  );
  await deletePrivateDocument(removed).catch(() => undefined);
  return { removed: true };
}

/** Always answers the same way so the form cannot reveal who applied. */
export async function publicRecoverTracking(orgSlug: string, email: string) {
  const result = await db.query<{
    payload: { organizationId: string; applicationIds: string[] } | null;
  }>(`SELECT public_career_applications_by_email($1,$2) AS payload`, [orgSlug, email]);
  const payload = result.rows[0]?.payload;
  if (payload?.applicationIds.length) {
    const slug = orgSlug.trim().toLowerCase();
    for (const applicationId of payload.applicationIds) {
      try {
        const prepared = await withTenantContext(
          { organizationId: payload.organizationId, userId: null },
          async (client) => {
            // One recovery e-mail per application every 48 hours: the previous
            // link stays valid, so repeated requests send nothing new.
            const recent = await client.query(
              `SELECT 1 FROM career_application_events
                WHERE organization_id=$1 AND application_id=$2 AND event_type='tracking_link_recovered'
                  AND created_at > now() - interval '48 hours' LIMIT 1`,
              [payload.organizationId, applicationId],
            );
            if (recent.rowCount) return null;
            const application = await applicationById(client, payload.organizationId, applicationId);
            const url = await issueCandidatePortalLink(client, payload.organizationId, slug, applicationId);
            await event(client, payload.organizationId, applicationId, "tracking_link_recovered", null, {});
            return { application, url };
          },
        );
        if (!prepared) continue;
        const basics = candidateBasics(prepared.application);
        await sendMail(
          buildPortalEmail({
            ...basics,
            phone: "",
            subject: basics.french
              ? `Votre lien de suivi · ${basics.jobTitle}`
              : `Your tracking link · ${basics.jobTitle}`,
            heading: basics.french ? "Votre Espace candidat" : "Your candidate space",
            paragraphs: [
              basics.french
                ? `Vous avez demandé un lien pour suivre votre candidature au poste « ${basics.jobTitle} ». Si vous n’êtes pas à l’origine de cette demande, ignorez simplement ce message.`
                : `You asked for a link to follow your application for ${basics.jobTitle}. If you did not request it, simply ignore this message.`,
            ],
            url: prepared.url,
            sms: "",
          }),
        );
      } catch (error) {
        logger.error({ err: error, applicationId }, "Candidate tracking link recovery failed");
      }
    }
  }
  return {
    message:
      "Si une candidature correspond à cette adresse, un lien de suivi vient d’être envoyé par e-mail. Un nouveau lien ne peut être demandé qu’une fois toutes les 48 heures : utilisez celui déjà reçu.",
  };
}

/* ------------------------------------------------------------------ */
/* HR side                                                             */
/* ------------------------------------------------------------------ */

async function hrApplication(client: PoolClient, context: CareersContext, applicationId: string) {
  const application = await applicationById(client, context.organizationId, applicationId);
  await assertSiteAccess(client, context, application.site_id);
  return application;
}

export async function listDocumentRequests(context: CareersContext, applicationId: string) {
  return withTenantContext(context, async (client) => {
    const application = await hrApplication(client, context, applicationId);
    const rows = await documentRequests(client, context.organizationId, applicationId);
    const link = await client.query<Row>(
      `SELECT max(created_at) AS last_issued_at,max(last_used_at) AS last_opened_at
         FROM career_application_access_tokens WHERE organization_id=$1 AND application_id=$2`,
      [context.organizationId, applicationId],
    );
    const sent = await client.query<Row>(
      `SELECT e.created_at,e.metadata,u.full_name AS sent_by
         FROM career_application_events e LEFT JOIN users u ON u.id=e.actor_user_id
        WHERE e.organization_id=$1 AND e.application_id=$2 AND e.event_type='candidate_message'
        ORDER BY e.created_at DESC LIMIT 30`,
      [context.organizationId, applicationId],
    );
    return {
      requests: rows.map((row) => mapDocumentRequest(row, true)),
      messages: sent.rows.map((row) => {
        const metadata = (row.metadata ?? {}) as Record<string, unknown>;
        return {
          subject: (metadata.subject as string | null) ?? null,
          body: String(metadata.candidateMessage ?? ""),
          channels: (metadata.channels as string[]) ?? [],
          delivery: (metadata.delivery as Record<string, unknown>) ?? {},
          sentBy: (row.sent_by as string | null) ?? null,
          createdAt: row.created_at,
        };
      }),
      contact: { email: application.email ?? null, phone: application.phone ?? null },
      tracking: {
        linkSentAt: application.tracking_link_sent_at ?? null,
        lastIssuedAt: link.rows[0]?.last_issued_at ?? null,
        lastOpenedAt: link.rows[0]?.last_opened_at ?? null,
      },
    };
  });
}

export async function createDocumentRequest(
  context: CareersContext,
  applicationId: string,
  input: DocumentRequestInput,
) {
  const prepared = await withTenantContext(context, async (client) => {
    const application = await hrApplication(client, context, applicationId);
    if (["rejected", "withdrawn"].includes(String(application.status)))
      throw new BadRequestError("This application is closed");
    const created: Row[] = [];
    for (const item of input.documents) {
      const inserted = await client.query<Row>(
        `INSERT INTO career_application_document_requests(organization_id,application_id,label,description,due_date,requested_by)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id,label`,
        [context.organizationId, applicationId, item.label, item.description ?? null, input.dueDate ?? null, context.userId],
      );
      created.push(inserted.rows[0]!);
      await event(client, context.organizationId, applicationId, "document_requested", context.userId, {
        requestId: inserted.rows[0]!.id,
        label: item.label,
      });
    }
    const url = input.notifyCandidate
      ? await issueCandidatePortalLink(client, context.organizationId, context.organizationSlug, applicationId)
      : null;
    if (url)
      await client.query(
        `UPDATE career_applications SET tracking_link_sent_at=now() WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, applicationId],
      );
    return { application, created, url };
  });
  if (prepared.url) {
    const basics = candidateBasics(prepared.application);
    const list = prepared.created.map((row) => `• ${row.label}`).join("\n");
    const due = input.dueDate
      ? new Date(`${input.dueDate}T12:00:00Z`).toLocaleDateString(basics.french ? "fr-FR" : "en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : null;
    const result = await deliverPortalMail({
      ...basics,
      subject: basics.french
        ? `Documents demandés · ${basics.jobTitle}`
        : `Documents requested · ${basics.jobTitle}`,
      heading: basics.french ? "Documents à envoyer" : "Documents to send",
      paragraphs: [
        basics.french
          ? `Pour poursuivre l’étude de votre candidature au poste « ${basics.jobTitle} », l’équipe de recrutement vous demande :`
          : `To continue reviewing your application for ${basics.jobTitle}, the recruitment team needs:`,
        list,
        ...(input.message ? [input.message] : []),
        ...(due
          ? [basics.french ? `Merci de les envoyer avant le ${due}.` : `Please send them before ${due}.`]
          : []),
        basics.french
          ? "Envoyez-les directement depuis votre Espace candidat (PDF, photo ou document Word)."
          : "Upload them directly from your candidate space (PDF, photo or Word document).",
      ],
      url: prepared.url,
      sms: smsLine(
        basics.organizationName,
        basics.french
          ? `des documents sont demandés pour votre candidature « ${basics.jobTitle} ». Envoyez-les ici :`
          : `documents are requested for your application ${basics.jobTitle}. Upload them here:`,
        prepared.url,
      ),
    });
    await withTenantContext(context, (client) =>
      event(client, context.organizationId, applicationId, "document_request_dispatched", context.userId, result),
    );
  }
  return listDocumentRequests(context, applicationId);
}

export async function reviewDocumentRequest(
  context: CareersContext,
  applicationId: string,
  requestId: string,
  input: DocumentReviewInput,
) {
  const prepared = await withTenantContext(context, async (client) => {
    const application = await hrApplication(client, context, applicationId);
    const current = await client.query<Row>(
      `SELECT * FROM career_application_document_requests WHERE organization_id=$1 AND application_id=$2 AND id=$3 FOR UPDATE`,
      [context.organizationId, applicationId, requestId],
    );
    const request = current.rows[0];
    if (!request) throw new NotFoundError("Document request not found");
    if (input.decision === "cancelled") {
      if (request.status === "accepted")
        throw new BadRequestError("An accepted document cannot be cancelled");
    } else if (request.status !== "submitted" && !(request.status === "accepted" && input.decision === "rejected")) {
      throw new BadRequestError("Only a submitted document can be reviewed");
    }
    await client.query(
      `UPDATE career_application_document_requests
          SET status=$4,review_note=$5,reviewed_at=now(),reviewed_by=$6
        WHERE organization_id=$1 AND application_id=$2 AND id=$3`,
      [context.organizationId, applicationId, requestId, input.decision, input.note ?? null, context.userId],
    );
    await event(client, context.organizationId, applicationId, `document_${input.decision}`, context.userId, {
      requestId,
      label: request.label,
    });
    const url =
      input.decision === "rejected" && input.notifyCandidate
        ? await issueCandidatePortalLink(client, context.organizationId, context.organizationSlug, applicationId)
        : null;
    return { application, request, url };
  });
  if (prepared.url) {
    const basics = candidateBasics(prepared.application);
    const label = String(prepared.request.label);
    const result = await deliverPortalMail({
      ...basics,
      subject: basics.french ? `Document à renvoyer · ${label}` : `Document to send again · ${label}`,
      heading: basics.french ? "Un document doit être renvoyé" : "A document needs to be sent again",
      paragraphs: [
        basics.french
          ? `Le document « ${label} » envoyé pour votre candidature « ${basics.jobTitle} » n’a pas pu être accepté.`
          : `The document “${label}” sent for your application ${basics.jobTitle} could not be accepted.`,
        ...(input.note ? [basics.french ? `Motif : ${input.note}` : `Reason: ${input.note}`] : []),
        basics.french
          ? "Merci d’envoyer une nouvelle version depuis votre Espace candidat."
          : "Please upload a new version from your candidate space.",
      ],
      url: prepared.url,
      sms: smsLine(
        basics.organizationName,
        basics.french
          ? `le document « ${label} » doit être renvoyé. Détails :`
          : `the document “${label}” must be sent again. Details:`,
        prepared.url,
      ),
    });
    await withTenantContext(context, (client) =>
      event(client, context.organizationId, applicationId, "document_review_dispatched", context.userId, result),
    );
  }
  return listDocumentRequests(context, applicationId);
}

/**
 * Changes (usually extends) the deadline of an open document request. Once a
 * deadline has passed the portal refuses uploads, so extending it is how the
 * team reopens them; the candidate is told the new date when asked.
 */
export async function changeDocumentDeadline(
  context: CareersContext,
  applicationId: string,
  requestId: string,
  input: DocumentDeadlineInput,
) {
  const prepared = await withTenantContext(context, async (client) => {
    const application = await hrApplication(client, context, applicationId);
    if (["rejected", "withdrawn", "hired"].includes(String(application.status)))
      throw new BadRequestError("This application is closed");
    const current = await client.query<Row>(
      `SELECT id,label,status,due_date::text AS due_date FROM career_application_document_requests
        WHERE organization_id=$1 AND application_id=$2 AND id=$3 FOR UPDATE`,
      [context.organizationId, applicationId, requestId],
    );
    const request = current.rows[0];
    if (!request) throw new NotFoundError("Document request not found");
    if (!["requested", "rejected", "submitted"].includes(String(request.status)))
      throw new BadRequestError("Only a document still awaited from the candidate can get a new deadline");
    await client.query(
      `UPDATE career_application_document_requests SET due_date=$4
        WHERE organization_id=$1 AND application_id=$2 AND id=$3`,
      [context.organizationId, applicationId, requestId, input.dueDate],
    );
    await event(client, context.organizationId, applicationId, "document_deadline_changed", context.userId, {
      requestId,
      label: request.label,
      previousDueDate: request.due_date ?? null,
      dueDate: input.dueDate,
    });
    const url = input.notifyCandidate
      ? await issueCandidatePortalLink(client, context.organizationId, context.organizationSlug, applicationId)
      : null;
    if (url)
      await client.query(
        `UPDATE career_applications SET tracking_link_sent_at=now() WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, applicationId],
      );
    return { application, request, url };
  });
  if (prepared.url) {
    const basics = candidateBasics(prepared.application);
    const label = String(prepared.request.label);
    const due = input.dueDate
      ? new Date(`${input.dueDate}T12:00:00Z`).toLocaleDateString(basics.french ? "fr-FR" : "en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : null;
    const result = await deliverPortalMail({
      ...basics,
      subject: basics.french ? `Nouveau délai · ${label}` : `New deadline · ${label}`,
      heading: basics.french ? "Le délai a été modifié" : "The deadline has changed",
      paragraphs: [
        due
          ? basics.french
            ? `Vous avez jusqu’au ${due} pour envoyer le document « ${label} » demandé pour votre candidature « ${basics.jobTitle} ».`
            : `You now have until ${due} to send the document “${label}” requested for your application ${basics.jobTitle}.`
          : basics.french
            ? `Le document « ${label} » demandé pour votre candidature « ${basics.jobTitle} » n’a plus de date limite. Envoyez-le dès que possible.`
            : `The document “${label}” requested for your application ${basics.jobTitle} no longer has a deadline. Please send it as soon as you can.`,
        ...(input.message ? [input.message] : []),
        basics.french
          ? "Envoyez-le directement depuis votre Espace candidat (PDF, photo ou document Word)."
          : "Upload it directly from your candidate space (PDF, photo or Word document).",
      ],
      url: prepared.url,
      sms: smsLine(
        basics.organizationName,
        due
          ? basics.french
            ? `nouveau délai : envoyez « ${label} » avant le ${due} ici :`
            : `new deadline: send “${label}” before ${due} here:`
          : basics.french
            ? `le délai pour « ${label} » a été retiré. Envoyez-le ici :`
            : `the deadline for “${label}” was removed. Send it here:`,
        prepared.url,
      ),
    });
    await withTenantContext(context, (client) =>
      event(client, context.organizationId, applicationId, "document_deadline_dispatched", context.userId, result),
    );
  }
  return listDocumentRequests(context, applicationId);
}

/**
 * A free message from the recruitment team. It goes out by e-mail and/or SMS
 * with the link to the candidate space, and also appears in that space's
 * timeline so the candidate can read it again later.
 */
export async function sendCandidateMessage(
  context: CareersContext,
  applicationId: string,
  input: CandidateMessageInput,
) {
  const body = input.body.trim();
  const channels = [...new Set(input.channels)];
  const prepared = await withTenantContext(context, async (client) => {
    const application = await hrApplication(client, context, applicationId);
    if (channels.includes("email") && !application.email)
      throw new BadRequestError("This candidate has no e-mail address", { field: "channels" });
    if (channels.includes("sms") && !application.phone)
      throw new BadRequestError("This candidate has no phone number", { field: "channels" });
    const url = await issueCandidatePortalLink(client, context.organizationId, context.organizationSlug, applicationId);
    await client.query(
      `UPDATE career_applications SET tracking_link_sent_at=now() WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, applicationId],
    );
    return { application, url };
  });
  const basics = candidateBasics(prepared.application);
  const subject =
    input.subject?.trim() ||
    (basics.french
      ? `Message de l’équipe de recrutement · ${basics.jobTitle}`
      : `Message from the recruitment team · ${basics.jobTitle}`);
  const result = await deliverPortalMail({
    ...basics,
    to: channels.includes("email") ? basics.to : "",
    phone: channels.includes("sms") ? basics.phone : "",
    subject,
    heading: input.subject?.trim() || (basics.french ? "Un message pour vous" : "A message for you"),
    paragraphs: body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean),
    url: prepared.url,
    sms: smsLine(basics.organizationName, body, prepared.url),
  }, "explicit");
  const delivery = {
    ...(channels.includes("email") ? { email: { sent: result.emailSent, reason: result.emailReason } } : {}),
    ...(channels.includes("sms") ? { sms: { sent: result.smsSent, reason: result.smsReason } } : {}),
  };
  await withTenantContext(context, (client) =>
    event(client, context.organizationId, applicationId, "candidate_message", context.userId, {
      candidateMessage: body,
      subject: input.subject?.trim() || null,
      channels,
      delivery,
    }),
  );
  return { delivery, ...(await listDocumentRequests(context, applicationId)) };
}

export async function documentRequestFile(
  context: CareersContext,
  applicationId: string,
  requestId: string,
  fileId?: string,
) {
  return withTenantContext(context, async (client) => {
    await hrApplication(client, context, applicationId);
    // One file of the request, or the most recent one when none is named.
    const current = await client.query<Row>(
      `SELECT r.label,f.storage_path,f.file_name,f.mime_type
         FROM career_application_document_requests r
         JOIN career_application_document_files f ON f.organization_id=r.organization_id AND f.request_id=r.id
        WHERE r.organization_id=$1 AND r.application_id=$2 AND r.id=$3 AND ($4::uuid IS NULL OR f.id=$4::uuid)
        ORDER BY f.created_at DESC LIMIT 1`,
      [context.organizationId, applicationId, requestId, fileId ?? null],
    );
    const request = current.rows[0];
    if (!request?.storage_path) throw new NotFoundError("No file has been sent for this request");
    await event(client, context.organizationId, applicationId, "document_downloaded", context.userId, {
      requestId,
      ...(fileId ? { fileId } : {}),
    });
    return {
      buffer: await readPrivateDocument(String(request.storage_path)),
      fileName: String(request.file_name ?? "document"),
      mimeType: String(request.mime_type ?? "application/octet-stream"),
    };
  });
}

function trackingLinkMail(application: Row, url: string): PortalMail {
  const basics = candidateBasics(application);
  return {
    ...basics,
    subject: basics.french
      ? `Suivez votre candidature · ${basics.jobTitle}`
      : `Follow your application · ${basics.jobTitle}`,
    heading: basics.french ? "Votre Espace candidat est disponible" : "Your candidate space is available",
    paragraphs: [
      basics.french
        ? `Votre candidature au poste « ${basics.jobTitle} » est bien enregistrée. Vous pouvez désormais suivre son avancement en ligne, lire les messages de l’équipe de recrutement et envoyer les documents qui vous seront demandés.`
        : `Your application for ${basics.jobTitle} is registered. You can now follow its progress online, read messages from the recruitment team and send any documents requested from you.`,
      basics.french
        ? "Aucun compte ni mot de passe n’est nécessaire : ce lien est personnel."
        : "No account or password is needed: this link is personal.",
    ],
    url,
    sms: smsLine(
      basics.organizationName,
      basics.french
        ? `suivez votre candidature « ${basics.jobTitle} » en ligne :`
        : `follow your application ${basics.jobTitle} online:`,
      url,
    ),
  };
}

export async function sendTrackingLink(context: CareersContext, applicationId: string) {
  const prepared = await withTenantContext(context, async (client) => {
    const application = await hrApplication(client, context, applicationId);
    const url = await issueCandidatePortalLink(client, context.organizationId, context.organizationSlug, applicationId);
    return { application, url };
  });
  const result = await deliverPortalMail(trackingLinkMail(prepared.application, prepared.url));
  await withTenantContext(context, async (client) => {
    if (result.emailSent || result.smsSent)
      await client.query(
        `UPDATE career_applications SET tracking_link_sent_at=now() WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, applicationId],
      );
    await event(client, context.organizationId, applicationId, "tracking_link_sent", context.userId, result);
  });
  if (!result.emailSent && !result.smsSent)
    throw new BadRequestError("The link could not be sent by e-mail or SMS. Check the messaging configuration.");
  return listDocumentRequests(context, applicationId);
}

/** Scheduled: gives every open application received before the Espace
 * candidat existed its personal link.  Idempotent and rate-limited. */
export async function sendPendingTrackingLinksForOrganization(organizationId: string) {
  const pending = await withTenantContext({ organizationId, userId: null }, async (client) => {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM career_applications
        WHERE organization_id=$1 AND tracking_link_sent_at IS NULL
          AND tracking_link_attempts < $2 AND status = ANY($3::text[])
        ORDER BY submitted_at
        LIMIT $4`,
      [organizationId, MAX_LINK_ATTEMPTS, OPEN_STATUSES, BACKFILL_BATCH],
    );
    return result.rows.map((row) => row.id);
  });
  let sent = 0;
  for (const applicationId of pending) {
    try {
      const prepared = await withTenantContext({ organizationId, userId: null }, async (client) => {
        // Claim the row first so overlapping runs never send twice.
        const claim = await client.query(
          `UPDATE career_applications SET tracking_link_attempts=tracking_link_attempts+1
            WHERE organization_id=$1 AND id=$2 AND tracking_link_sent_at IS NULL AND tracking_link_attempts < $3
            RETURNING id`,
          [organizationId, applicationId, MAX_LINK_ATTEMPTS],
        );
        if (!claim.rowCount) return null;
        const application = await applicationById(client, organizationId, applicationId);
        const url = await issueCandidatePortalLink(
          client,
          organizationId,
          String(application.organization_slug),
          applicationId,
        );
        return { application, url };
      });
      if (!prepared) continue;
      const result = await deliverPortalMail(trackingLinkMail(prepared.application, prepared.url));
      await withTenantContext({ organizationId, userId: null }, async (client) => {
        if (result.emailSent || result.smsSent) {
          sent += 1;
          await client.query(
            `UPDATE career_applications SET tracking_link_sent_at=now() WHERE organization_id=$1 AND id=$2`,
            [organizationId, applicationId],
          );
        }
        await event(client, organizationId, applicationId, "tracking_link_sent", null, {
          automatic: true,
          ...result,
        });
      });
    } catch (error) {
      logger.error({ err: error, organizationId, applicationId }, "Automatic candidate link failed");
    }
  }
  return sent;
}
