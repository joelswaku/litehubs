import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "../../config/database";
import {
  deletePrivateDocument,
  readPrivateDocument,
  storePrivateDocument,
} from "../../services/file-storage.service";
import { sendMail, sendSms } from "../../services/notification.service";
import { createNotificationInTransaction } from "../notifications/notifications.service";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import { candidatePortalBaseUrl, issueCandidatePortalLink } from "./candidate-portal-links";
import type {
  ApplicationQuery,
  ApplicationUpdateInput,
  CareerSiteSettingsInput,
  JobPostInput,
  JobQuery,
  PublicApplicationInput,
  PublicOnboardingInput,
} from "./careers.validation";

export interface CareersContext {
  organizationId: string;
  organizationSlug: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
  permissions: string[];
}

type Scope = "organization" | "province" | "self";
export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const CANDIDATE_CONTACT_EMAIL = "recrutement@congoomega.com";
export const RECRUITMENT_FROM_ADDRESS = '"Congo Omega recrutement" <recrutement@congoomega.com>';

const jobColumns = `j.id,j.organization_id,j.province_id,j.site_id,j.code,j.title,j.department_name,j.employment_type,j.experience_level,j.positions_open,j.short_summary,j.description,j.responsibilities,j.requirements,j.benefits,j.salary_summary,j.application_deadline::text,j.status,j.published_at,j.closed_at,j.created_at,j.updated_at,s.code AS site_code,s.name AS site_name,p.code AS province_code,p.name AS province_name,COUNT(a.id)::int AS application_count`;

function mapJob(row: Row) {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    departmentName: row.department_name,
    employmentType: row.employment_type,
    experienceLevel: row.experience_level,
    positionsOpen: Number(row.positions_open),
    shortSummary: row.short_summary,
    description: row.description,
    responsibilities: row.responsibilities,
    requirements: row.requirements,
    benefits: row.benefits,
    salarySummary: row.salary_summary,
    applicationDeadline: row.application_deadline,
    status: row.status,
    publishedAt: row.published_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    applicationCount: Number(row.application_count ?? 0),
    site: { id: row.site_id, code: row.site_code, name: row.site_name },
    province: {
      id: row.province_id,
      code: row.province_code,
      name: row.province_name,
    },
  };
}

function mapApplication(row: Row) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    city: row.city,
    coverLetter: row.cover_letter,
    yearsExperience:
      row.years_experience === null ? null : Number(row.years_experience),
    availability: row.availability,
    preferredLanguage: row.preferred_language === "en" ? "en" : "fr",
    status: row.status,
    internalNotes: row.internal_notes,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by_name ?? null,
    job: { id: row.job_post_id, code: row.job_code, title: row.job_title },
    site: { id: row.site_id, code: row.site_code, name: row.site_name },
    province: {
      id: row.province_id,
      code: row.province_code,
      name: row.province_name,
    },
    resume: row.resume_id
      ? {
          id: row.resume_id,
          fileName: row.resume_file_name,
          mimeType: row.resume_mime_type,
          sizeBytes: Number(row.resume_size_bytes),
        }
      : null,
  };
}

async function scopeOf(
  client: PoolClient,
  context: CareersContext,
): Promise<Scope> {
  if (context.isOwner) return "organization";
  const result = await client.query<{
    organization_scope: boolean;
    province_scope: boolean;
  }>(
    `SELECT
      EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id=mr.organization_id AND r.id=mr.role_id WHERE mr.organization_id=$1 AND mr.member_id=$2 AND r.data_scope='organization') AS organization_scope,
      EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id=mr.organization_id AND r.id=mr.role_id WHERE mr.organization_id=$1 AND mr.member_id=$2 AND r.data_scope='province') AS province_scope`,
    [context.organizationId, context.memberId],
  );
  return result.rows[0]?.organization_scope
    ? "organization"
    : result.rows[0]?.province_scope
      ? "province"
      : "self";
}

export async function assertSiteAccess(
  client: PoolClient,
  context: CareersContext,
  siteId: string,
) {
  const site = await client.query<Row>(
    `SELECT id,province_id,code,name FROM sites WHERE organization_id=$1 AND id=$2 AND is_active`,
    [context.organizationId, siteId],
  );
  const row = site.rows[0];
  if (!row) throw new NotFoundError("Active site not found");
  const scope = await scopeOf(client, context);
  if (scope === "self") throw new NotFoundError("Site not found");
  if (scope === "province") {
    const allowed = await client.query(
      `SELECT 1 FROM member_provinces WHERE organization_id=$1 AND member_id=$2 AND province_id=$3`,
      [context.organizationId, context.memberId, row.province_id],
    );
    if (!allowed.rowCount) throw new NotFoundError("Site not found");
  }
  return row;
}

export async function event(
  client: PoolClient,
  organizationId: string,
  applicationId: string,
  eventType: string,
  actorUserId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await client.query(
    `INSERT INTO career_application_events(organization_id,application_id,event_type,actor_user_id,metadata) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [
      organizationId,
      applicationId,
      eventType,
      actorUserId,
      JSON.stringify(metadata),
    ],
  );
}

function mapSettings(row: Row) {
  return {
    id: row.id ?? null,
    site: {
      id: row.site_id,
      code: row.site_code,
      name: row.site_name,
      provinceId: row.province_id,
      provinceName: row.province_name,
    },
    publicCareersEnabled: Boolean(row.public_careers_enabled),
    careersIntro: row.careers_intro ?? null,
  };
}

async function jobById(
  client: PoolClient,
  organizationId: string,
  jobId: string,
) {
  const result = await client.query<Row>(
    `SELECT ${jobColumns} FROM career_job_posts j JOIN sites s ON s.organization_id=j.organization_id AND s.id=j.site_id JOIN provinces p ON p.organization_id=j.organization_id AND p.id=j.province_id LEFT JOIN career_applications a ON a.organization_id=j.organization_id AND a.job_post_id=j.id WHERE j.organization_id=$1 AND j.id=$2 GROUP BY j.id,s.code,s.name,p.code,p.name`,
    [organizationId, jobId],
  );
  if (!result.rowCount) throw new NotFoundError("Job post not found");
  return result.rows[0]!;
}

export async function applicationById(
  client: PoolClient,
  organizationId: string,
  applicationId: string,
) {
  const result = await client.query<Row>(
    `SELECT a.*,o.display_name AS organization_name,o.slug AS organization_slug,j.code AS job_code,j.title AS job_title,s.code AS site_code,s.name AS site_name,p.code AS province_code,p.name AS province_name,reviewer.full_name AS reviewed_by_name,f.id AS resume_id,f.file_name AS resume_file_name,f.mime_type AS resume_mime_type,f.size_bytes AS resume_size_bytes,f.storage_path AS resume_storage_path
       FROM career_applications a JOIN organizations o ON o.id=a.organization_id JOIN career_job_posts j ON j.organization_id=a.organization_id AND j.id=a.job_post_id JOIN sites s ON s.organization_id=a.organization_id AND s.id=a.site_id JOIN provinces p ON p.organization_id=a.organization_id AND p.id=a.province_id LEFT JOIN users reviewer ON reviewer.id=a.reviewed_by LEFT JOIN career_application_files f ON f.organization_id=a.organization_id AND f.application_id=a.id AND f.kind='resume' WHERE a.organization_id=$1 AND a.id=$2`,
    [organizationId, applicationId],
  );
  if (!result.rowCount) throw new NotFoundError("Application not found");
  return result.rows[0]!;
}

export async function summary(context: CareersContext) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context);
    const values: unknown[] = [context.organizationId];
    let filter = "";
    if (scope === "self") filter = " AND FALSE";
    if (scope === "province") {
      values.push(context.memberId);
      filter =
        " AND EXISTS (SELECT 1 FROM member_provinces mp WHERE mp.organization_id=j.organization_id AND mp.member_id=$2 AND mp.province_id=j.province_id)";
    }
    const result = await client.query<Row>(
      `SELECT COUNT(*) FILTER (WHERE j.status='published')::int AS published_jobs,COUNT(*) FILTER (WHERE j.status IN ('draft','paused'))::int AS inactive_jobs,COUNT(a.id)::int AS applications,COUNT(a.id) FILTER (WHERE a.status='received')::int AS new_applications,COUNT(a.id) FILTER (WHERE a.status IN ('shortlisted','interview'))::int AS active_candidates FROM career_job_posts j LEFT JOIN career_applications a ON a.organization_id=j.organization_id AND a.job_post_id=j.id WHERE j.organization_id=$1${filter}`,
      values,
    );
    return (
      result.rows[0] ?? {
        published_jobs: 0,
        inactive_jobs: 0,
        applications: 0,
        new_applications: 0,
        active_candidates: 0,
      }
    );
  });
}

export async function listSiteSettings(context: CareersContext) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context);
    const values: unknown[] = [context.organizationId];
    let filter = "";
    if (scope === "self") filter = " AND FALSE";
    if (scope === "province") {
      values.push(context.memberId);
      filter =
        " AND EXISTS (SELECT 1 FROM member_provinces mp WHERE mp.organization_id=s.organization_id AND mp.member_id=$2 AND mp.province_id=s.province_id)";
    }
    const result = await client.query<Row>(
      `SELECT settings.*,s.id AS site_id,s.code AS site_code,s.name AS site_name,s.province_id,p.name AS province_name FROM sites s JOIN provinces p ON p.organization_id=s.organization_id AND p.id=s.province_id LEFT JOIN career_site_settings settings ON settings.organization_id=s.organization_id AND settings.site_id=s.id WHERE s.organization_id=$1 AND s.is_active${filter} ORDER BY p.name,s.name`,
      values,
    );
    return result.rows.map(mapSettings);
  });
}

export async function saveSiteSettings(
  context: CareersContext,
  input: CareerSiteSettingsInput,
) {
  return withTenantContext(context, async (client) => {
    await assertSiteAccess(client, context, input.siteId);
    const saved = await client.query<Row>(
      `INSERT INTO career_site_settings(organization_id,site_id,public_careers_enabled,careers_intro,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,site_id) DO UPDATE SET public_careers_enabled=EXCLUDED.public_careers_enabled,careers_intro=EXCLUDED.careers_intro RETURNING *`,
      [
        context.organizationId,
        input.siteId,
        input.publicCareersEnabled,
        input.careersIntro ?? null,
        context.userId,
      ],
    );
    const site = await client.query<Row>(
      `SELECT s.id AS site_id,s.code AS site_code,s.name AS site_name,s.province_id,p.name AS province_name FROM sites s JOIN provinces p ON p.organization_id=s.organization_id AND p.id=s.province_id WHERE s.organization_id=$1 AND s.id=$2`,
      [context.organizationId, input.siteId],
    );
    return mapSettings({ ...saved.rows[0], ...site.rows[0] });
  });
}

export async function listJobs(context: CareersContext, input: JobQuery) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context);
    const values: unknown[] = [context.organizationId];
    const terms = ["j.organization_id=$1"];
    if (scope === "self") terms.push("FALSE");
    if (scope === "province") {
      values.push(context.memberId);
      terms.push(
        `EXISTS (SELECT 1 FROM member_provinces mp WHERE mp.organization_id=j.organization_id AND mp.member_id=$${values.length} AND mp.province_id=j.province_id)`,
      );
    }
    if (input.siteId) {
      await assertSiteAccess(client, context, input.siteId);
      values.push(input.siteId);
      terms.push(`j.site_id=$${values.length}`);
    }
    if (input.status) {
      values.push(input.status);
      terms.push(`j.status=$${values.length}`);
    }
    if (input.search) {
      values.push(`%${input.search}%`);
      terms.push(
        `(j.title ILIKE $${values.length} OR j.code ILIKE $${values.length} OR COALESCE(j.department_name,'') ILIKE $${values.length})`,
      );
    }
    values.push(input.limit);
    const result = await client.query<Row>(
      `SELECT ${jobColumns} FROM career_job_posts j JOIN sites s ON s.organization_id=j.organization_id AND s.id=j.site_id JOIN provinces p ON p.organization_id=j.organization_id AND p.id=j.province_id LEFT JOIN career_applications a ON a.organization_id=j.organization_id AND a.job_post_id=j.id WHERE ${terms.join(" AND ")} GROUP BY j.id,s.code,s.name,p.code,p.name ORDER BY CASE j.status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,j.published_at DESC NULLS LAST,j.created_at DESC LIMIT $${values.length}`,
      values,
    );
    return result.rows.map(mapJob);
  });
}

export async function saveJob(
  context: CareersContext,
  input: JobPostInput,
  jobId?: string,
) {
  return withTenantContext(context, async (client) => {
    const site = await assertSiteAccess(client, context, input.siteId);
    // Zod applies these defaults at the HTTP boundary. Keep the persistence
    // layer defensive as well: programmatic callers and older web bundles may
    // omit an optional select value, and PostgreSQL must never receive NULL for
    // these NOT NULL columns.
    const employmentType = input.employmentType ?? "permanent";
    const experienceLevel = input.experienceLevel ?? "not_specified";
    const positionsOpen = input.positionsOpen ?? 1;
    const status = input.status ?? "draft";
    if (status === "published" && input.applicationDeadline) {
      // A vacancy is advertised on Congo time, not the database or server's
      // potentially different UTC date. This keeps it open for the full date
      // shown to candidates and to the recruitment team.
      const currentDate = await client.query<{ today: string }>(
        "SELECT (now() AT TIME ZONE 'Africa/Kinshasa')::date::text AS today",
      );
      if (input.applicationDeadline < currentDate.rows[0]!.today)
        throw new BadRequestError(
          "A published vacancy cannot have a past application deadline",
          { field: "applicationDeadline" },
        );
    }
    if (jobId) {
      const current = await jobById(client, context.organizationId, jobId);
      await assertSiteAccess(client, context, current.site_id);
    }
    const updateValues = [
      context.organizationId,
      jobId ?? null,
      input.siteId,
      site.province_id,
      input.code,
      input.title,
      input.departmentName ?? null,
      employmentType,
      experienceLevel,
      positionsOpen,
      input.shortSummary,
      input.description,
      input.responsibilities ?? null,
      input.requirements ?? null,
      input.benefits ?? null,
      input.salarySummary ?? null,
      input.applicationDeadline ?? null,
      status,
      context.userId,
    ];
    // Do not reuse updateValues for INSERT. PostgreSQL cannot infer the type of
    // an unused $2 placeholder (the update-only job ID), which previously made
    // every new vacancy fail with "could not determine data type of parameter $2".
    const insertValues = [
      context.organizationId,
      input.siteId,
      site.province_id,
      input.code,
      input.title,
      input.departmentName ?? null,
      employmentType,
      experienceLevel,
      positionsOpen,
      input.shortSummary,
      input.description,
      input.responsibilities ?? null,
      input.requirements ?? null,
      input.benefits ?? null,
      input.salarySummary ?? null,
      input.applicationDeadline ?? null,
      status,
      context.userId,
    ];
    try {
      const saved = jobId
        ? await client.query<Row>(
            `UPDATE career_job_posts SET site_id=$3,province_id=$4,code=$5,title=$6,department_name=$7,employment_type=$8,experience_level=$9,positions_open=$10,short_summary=$11,description=$12,responsibilities=$13,requirements=$14,benefits=$15,salary_summary=$16,application_deadline=$17,status=$18,published_at=CASE WHEN $18='published' THEN COALESCE(published_at,now()) ELSE published_at END,closed_at=CASE WHEN $18 IN ('closed','archived') THEN now() ELSE NULL END,updated_by=$19 WHERE organization_id=$1 AND id=$2 RETURNING id`,
            updateValues,
          )
        : await client.query<Row>(
            `INSERT INTO career_job_posts(organization_id,province_id,site_id,code,title,department_name,employment_type,experience_level,positions_open,short_summary,description,responsibilities,requirements,benefits,salary_summary,application_deadline,status,published_at,created_by,updated_by) VALUES($1,$3,$2,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,CASE WHEN $17='published' THEN now() ELSE NULL END,$18,$18) RETURNING id`,
            insertValues,
          );
      const savedId = saved.rows[0]?.id;
      if (!savedId)
        throw new BadRequestError(
          "The vacancy could not be saved. Please check the required fields.",
        );
      return mapJob(await jobById(client, context.organizationId, savedId));
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      )
        throw new ConflictError("A job with that code already exists");
      throw error;
    }
  });
}

export async function listApplications(
  context: CareersContext,
  input: ApplicationQuery,
) {
  return withTenantContext(context, async (client) => {
    const scope = await scopeOf(client, context);
    const values: unknown[] = [context.organizationId];
    const terms = ["a.organization_id=$1"];
    if (scope === "self") terms.push("FALSE");
    if (scope === "province") {
      values.push(context.memberId);
      terms.push(
        `EXISTS (SELECT 1 FROM member_provinces mp WHERE mp.organization_id=a.organization_id AND mp.member_id=$${values.length} AND mp.province_id=a.province_id)`,
      );
    }
    if (input.jobId) {
      const job = await jobById(client, context.organizationId, input.jobId);
      await assertSiteAccess(client, context, job.site_id);
      values.push(input.jobId);
      terms.push(`a.job_post_id=$${values.length}`);
    }
    if (input.siteId) {
      await assertSiteAccess(client, context, input.siteId);
      values.push(input.siteId);
      terms.push(`a.site_id=$${values.length}`);
    }
    if (input.status) {
      values.push(input.status);
      terms.push(`a.status=$${values.length}`);
    }
    if (input.search) {
      values.push(`%${input.search}%`);
      terms.push(
        `(a.full_name ILIKE $${values.length} OR a.email::text ILIKE $${values.length} OR j.title ILIKE $${values.length})`,
      );
    }
    values.push(input.limit);
    const result = await client.query<Row>(
      `SELECT a.*,j.code AS job_code,j.title AS job_title,s.code AS site_code,s.name AS site_name,p.code AS province_code,p.name AS province_name,reviewer.full_name AS reviewed_by_name,f.id AS resume_id,f.file_name AS resume_file_name,f.mime_type AS resume_mime_type,f.size_bytes AS resume_size_bytes FROM career_applications a JOIN career_job_posts j ON j.organization_id=a.organization_id AND j.id=a.job_post_id JOIN sites s ON s.organization_id=a.organization_id AND s.id=a.site_id JOIN provinces p ON p.organization_id=a.organization_id AND p.id=a.province_id LEFT JOIN users reviewer ON reviewer.id=a.reviewed_by LEFT JOIN career_application_files f ON f.organization_id=a.organization_id AND f.application_id=a.id AND f.kind='resume' WHERE ${terms.join(" AND ")} ORDER BY CASE a.status WHEN 'received' THEN 0 WHEN 'reviewing' THEN 1 WHEN 'shortlisted' THEN 2 WHEN 'interview' THEN 3 ELSE 4 END,a.submitted_at DESC LIMIT $${values.length}`,
      values,
    );
    return result.rows.map(mapApplication);
  });
}

function hashOnboardingToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function candidateOnboardingUrl(orgSlug: string, token: string) {
  return `${candidatePortalBaseUrl(orgSlug)}/onboarding/${encodeURIComponent(token)}`;
}

/** Creates a single-use, expiring form when an offer is first sent.  The raw
 * token exists only long enough to place it in the candidate message. */
async function issueCandidateOnboarding(
  client: PoolClient,
  context: CareersContext,
  application: Row,
) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashOnboardingToken(token);
  const issued = await client.query<{ id: string }>(
    `INSERT INTO career_candidate_onboardings(
       organization_id,application_id,token_hash,status,expires_at,created_by_user_id
     ) VALUES($1,$2,$3,'pending',now() + interval '21 days',$4)
     ON CONFLICT(organization_id,application_id) DO UPDATE
       SET token_hash=EXCLUDED.token_hash,
           status='pending',
           expires_at=EXCLUDED.expires_at,
           submitted_at=NULL,
           completed_at=NULL,
           created_by_user_id=EXCLUDED.created_by_user_id
       WHERE career_candidate_onboardings.status <> 'completed'
     RETURNING id`,
    [context.organizationId, application.id, tokenHash, context.userId],
  );
  // A completed record is evidence. It is deliberately never overwritten by
  // resending an offer; HR can see and reuse the completed dossier instead.
  if (!issued.rowCount) return null;
  return candidateOnboardingUrl(context.organizationSlug, token);
}

export async function updateApplication(
  context: CareersContext,
  applicationId: string,
  input: ApplicationUpdateInput,
) {
  const updated = await withTenantContext(context, async (client) => {
    const current = await applicationById(
      client,
      context.organizationId,
      applicationId,
    );
    await assertSiteAccess(client, context, current.site_id);
    await client.query(
      `UPDATE career_applications SET status=$3,internal_notes=$4,reviewed_by=$5,reviewed_at=now() WHERE organization_id=$1 AND id=$2`,
      [
        context.organizationId,
        applicationId,
        input.status,
        input.internalNotes ?? null,
        context.userId,
      ],
    );
    await event(
      client,
      context.organizationId,
      applicationId,
      `status_${input.status}`,
      context.userId,
      {
        previousStatus: current.status,
        internalNotes: input.internalNotes ?? null,
        candidateNotificationRequested: input.notifyCandidate,
      },
    );
    const onboardingUrl =
      input.status === "offered" &&
      current.status !== "offered" &&
      Boolean(current.email || current.phone)
        ? await issueCandidateOnboarding(client, context, current)
        : null;
    const application = mapApplication(
      await applicationById(client, context.organizationId, applicationId),
    );
    // An offer always carries its integration form. The normal status notice
    // remains optional for all other stages, but never suppresses the form.
    const shouldNotify =
      (input.notifyCandidate || Boolean(onboardingUrl)) &&
      Boolean(current.email || current.phone);
    const message = (
      input.candidateMessage ||
      defaultCandidateStatusMessage({
        status: input.status,
        jobTitle: String(current.job_title ?? ""),
        siteName: String(current.site_name ?? ""),
        french: current.preferred_language !== "en",
      })
    ).trim();
    const trackingUrl =
      shouldNotify && message
        ? await issueCandidatePortalLink(
            client,
            context.organizationId,
            context.organizationSlug,
            applicationId,
          )
        : null;
    if (trackingUrl)
      await client.query(
        `UPDATE career_applications SET tracking_link_sent_at=now() WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, applicationId],
      );
    if (shouldNotify && message) {
      await event(
        client,
        context.organizationId,
        applicationId,
        "candidate_notification_queued",
        context.userId,
        {
          status: input.status,
          email: Boolean(current.email),
          sms: Boolean(current.phone),
          customMessage: Boolean(input.candidateMessage),
          messageLength: message.length,
          // Shown to the candidate in the Espace candidat timeline.
          candidateMessage: message,
          onboardingFormIssued: Boolean(onboardingUrl),
        },
      );
    }
    return {
      application,
      notification:
        shouldNotify && message
          ? {
              applicationId,
              organizationName:
                String(current.organization_name ?? "LiteHubs").trim() ||
                "LiteHubs",
              email: String(current.email ?? ""),
              phone: String(current.phone ?? ""),
              fullName: String(current.full_name ?? ""),
              jobTitle: String(current.job_title ?? ""),
              siteName: String(current.site_name ?? ""),
              status: input.status,
              message,
              french: current.preferred_language !== "en",
              onboardingUrl,
              trackingUrl,
            }
          : null,
    };
  });

  if (updated.notification) {
    const notification = updated.notification;
    const [email, sms] = await Promise.all([
      notification.email
        ? sendMail(buildCandidateStatusEmail(notification))
        : Promise.resolve({ sent: false, reason: "email_missing" }),
      notification.phone
        ? sendSms(buildCandidateStatusSms(notification))
        : Promise.resolve({ sent: false, reason: "phone_missing" }),
    ]);
    await withTenantContext(context, async (client) =>
      event(
        client,
        context.organizationId,
        notification.applicationId,
        "candidate_notification_dispatched",
        context.userId,
        {
          status: notification.status,
          emailSent: email.sent,
          emailReason: email.sent ? undefined : email.reason,
          smsSent: sms.sent,
          smsReason: sms.sent ? undefined : sms.reason,
        },
      ),
    );
  }
  return updated.application;
}

export async function resumeFor(
  context: CareersContext,
  applicationId: string,
  eventType: "resume_downloaded" | "resume_viewed" = "resume_downloaded",
) {
  return withTenantContext(context, async (client) => {
    const current = await applicationById(
      client,
      context.organizationId,
      applicationId,
    );
    await assertSiteAccess(client, context, current.site_id);
    if (!current.resume_storage_path)
      throw new NotFoundError("This candidate did not submit a résumé");
    await event(
      client,
      context.organizationId,
      applicationId,
      eventType,
      context.userId,
    );
    return {
      buffer: await readPrivateDocument(current.resume_storage_path),
      fileName: current.resume_file_name,
      mimeType: current.resume_mime_type,
    };
  });
}

async function publicJob(orgSlug: string, jobCode: string) {
  // RLS deliberately blocks unauthenticated table reads. The database function
  // exposes only published vacancies from sites that explicitly opened their
  // Careers portal; it never returns candidates, resumes, or private records.
  const result = await db.query<Row>(
    `SELECT * FROM public_career_jobs($1,$2)`,
    [orgSlug, jobCode],
  );
  if (!result.rowCount)
    throw new NotFoundError("This vacancy is not accepting applications");
  return result.rows[0]!;
}

export async function publicJobs(orgSlug: string) {
  const result = await db.query<Row>(
    `SELECT * FROM public_career_jobs($1,NULL) ORDER BY published_at DESC,title`,
    [orgSlug],
  );
  return {
    organizationName: result.rows[0]?.display_name ?? null,
    intro: result.rows.find((row) => row.careers_intro)?.careers_intro ?? null,
    jobs: result.rows.map((row) => ({
      code: row.code,
      title: row.title,
      departmentName: row.department_name,
      employmentType: row.employment_type,
      experienceLevel: row.experience_level,
      positionsOpen: Number(row.positions_open),
      shortSummary: row.short_summary,
      applicationDeadline: row.application_deadline,
      site: { code: row.site_code, name: row.site_name },
      province: { code: row.province_code, name: row.province_name },
    })),
  };
}

export async function publicJobDetail(orgSlug: string, jobCode: string) {
  const row = await publicJob(orgSlug, jobCode);
  return {
    organizationName: row.display_name,
    intro: row.careers_intro ?? null,
    job: mapJob({ ...row, application_count: 0 }),
  };
}

/** Marks yesterday's vacancies closed so the private register matches public access. */
export async function closeExpiredJobsForOrganization(
  organizationId: string,
): Promise<number> {
  return withTenantContext({ organizationId, userId: null }, async (client) => {
    const result = await client.query(
      `UPDATE career_job_posts
          SET status='closed',closed_at=COALESCE(closed_at,now()),updated_at=now()
        WHERE organization_id=$1
          AND status='published'
          AND application_deadline IS NOT NULL
          AND application_deadline < (now() AT TIME ZONE 'Africa/Kinshasa')::date`,
      [organizationId],
    );
    return result.rowCount ?? 0;
  });
}

export async function recipients(client: PoolClient, organizationId: string) {
  const result = await client.query<{ member_id: string; email: string }>(
    `SELECT DISTINCT m.id AS member_id,u.email::text FROM organization_members m JOIN users u ON u.id=m.user_id LEFT JOIN member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id LEFT JOIN roles r ON r.organization_id=mr.organization_id AND r.id=mr.role_id WHERE m.organization_id=$1 AND m.status='active' AND (m.is_owner OR r.code IN ('hr_officer','general_manager'))`,
    [organizationId],
  );
  return result.rows;
}

export async function publicApply(
  orgSlug: string,
  jobCode: string,
  input: PublicApplicationInput,
  file: Express.Multer.File,
) {
  const job = await publicJob(orgSlug, jobCode);
  const stored = await storePrivateDocument({
    organizationId: job.organization_id,
    originalName: file.originalname,
    mimeType: file.mimetype,
    buffer: file.buffer,
  });
  try {
    const created = await withTenantContext(
      { organizationId: job.organization_id, userId: null },
      async (client) => {
        try {
          // The database key protects the email. The transaction-scoped lock
          // adds the same protection for a normalized phone number, including
          // simultaneous retries from a poor connection.
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            `career-application:${job.id}:${input.phone}`,
          ]);
          const duplicatePhone = await client.query<{ id: string }>(
            `SELECT id
               FROM career_applications
              WHERE organization_id=$1
                AND job_post_id=$2
                AND regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace($3, '[^0-9]', '', 'g')
              LIMIT 1`,
            [job.organization_id, job.id, input.phone],
          );
          if (duplicatePhone.rowCount) {
            throw new ConflictError(
              "An application has already been received from this phone number for this vacancy",
            );
          }
          const insert = await client.query<Row>(
            `INSERT INTO career_applications(organization_id,job_post_id,province_id,site_id,full_name,email,phone,city,cover_letter,years_experience,availability,preferred_language,consent_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()) RETURNING id`,
            [
              job.organization_id,
              job.id,
              job.province_id,
              job.site_id,
              input.fullName,
              input.email,
              input.phone,
              input.city ?? null,
              input.coverLetter ?? null,
              input.yearsExperience ?? null,
              input.availability ?? null,
              input.preferredLanguage,
            ],
          );
          const applicationId = insert.rows[0]!.id;
          await client.query(
            `INSERT INTO career_application_files(organization_id,application_id,kind,storage_path,file_name,mime_type,size_bytes,checksum_sha256) VALUES($1,$2,'resume',$3,$4,$5,$6,$7)`,
            [
              job.organization_id,
              applicationId,
              stored.storagePath,
              file.originalname,
              stored.mimeType,
              stored.bytes,
              stored.checksumSha256,
            ],
          );
          await event(
            client,
            job.organization_id,
            applicationId,
            "submitted_public",
            null,
            { jobCode },
          );
          // Every applicant receives a personal Espace candidat link with the
          // acknowledgement, so the status can be followed without an account.
          const trackingUrl = await issueCandidatePortalLink(
            client,
            job.organization_id,
            orgSlug.trim().toLowerCase(),
            applicationId,
          );
          await client.query(
            `UPDATE career_applications SET tracking_link_sent_at=now() WHERE organization_id=$1 AND id=$2`,
            [job.organization_id, applicationId],
          );
          const team = await recipients(client, job.organization_id);
          await Promise.all(
            team.map((recipient) =>
              createNotificationInTransaction(client, {
                organizationId: job.organization_id,
                recipientMemberId: recipient.member_id,
                provinceId: job.province_id,
                type: "career_application_received",
                category: "general",
                priority: "high",
                title: "New job application",
                message: `${input.fullName} applied for ${job.title} at ${job.site_name}.`,
                actionUrl: `/${orgSlug}/careers`,
                entityType: "career_application",
                entityId: applicationId,
                deduplicationKey: `career-application:${applicationId}:${recipient.member_id}`,
              }),
            ),
          );
          return { applicationId, team, trackingUrl };
        } catch (error: unknown) {
          if (error instanceof ConflictError) throw error;
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "23505"
          )
            throw new ConflictError(
              "An application has already been received from this email for this vacancy",
            );
          throw error;
        }
      },
    );
    await Promise.allSettled([
      ...created.team.map((recipient) =>
        sendMail({
          to: recipient.email,
          subject: `New application · ${job.title}`,
          text: `${input.fullName} applied for ${job.title} at ${job.site_name}. Open LiteHubs to review the private application and résumé.`,
          html: `<p><strong>${escapeHtml(input.fullName)}</strong> applied for <strong>${escapeHtml(job.title)}</strong> at ${escapeHtml(job.site_name)}.</p><p>Open LiteHubs to review the private application and résumé.</p>`,
        }),
      ),
      sendMail(buildApplicantConfirmationEmail(input, job, created.trackingUrl)),
      // Candidates provide a phone number in the public form.  The SMS is an
      // acknowledgement only: never include the CV, application details or
      // any hiring decision in a message that can be seen on a lock screen.
      sendSms(buildApplicantConfirmationSms(input, job, created.trackingUrl)),
    ]);
    return {
      applicationId: created.applicationId,
      confirmation: "Your application has been received.",
      trackingUrl: created.trackingUrl,
    };
  } catch (error) {
    await deletePrivateDocument(stored.storagePath).catch(() => undefined);
    throw error;
  }
}

type PublicOnboardingContext = {
  onboardingId: string;
  organizationId: string;
  organizationName: string;
  applicationId: string;
  candidate: { fullName: string; email: string; phone: string };
  job: { title: string; siteName: string };
  expiresAt: string;
  profile: Record<string, string | null>;
};

async function onboardingContext(orgSlug: string, token: string) {
  const result = await db.query<{ payload: PublicOnboardingContext | null }>(
    `SELECT public_career_onboarding_context($1,$2) AS payload`,
    [orgSlug, hashOnboardingToken(token)],
  );
  const payload = result.rows[0]?.payload;
  if (!payload)
    throw new NotFoundError(
      "This secure onboarding form is unavailable, expired, or has already been completed",
    );
  return payload;
}

/** Public read is token-bound, non-cacheable and contains no document URL. */
export async function publicOnboarding(orgSlug: string, token: string) {
  const context = await onboardingContext(orgSlug, token);
  return {
    onboarding: {
      organizationName: context.organizationName,
      candidate: context.candidate,
      job: context.job,
      expiresAt: context.expiresAt,
      profile: context.profile,
    },
  };
}

function assertOnboardingFile(
  file: Express.Multer.File,
  accepted: Set<string>,
  field: string,
) {
  if (!accepted.has(file.mimetype))
    throw new BadRequestError(`Upload a valid ${field}`, { field });
}

export async function completePublicOnboarding(
  orgSlug: string,
  token: string,
  input: PublicOnboardingInput,
  files: { portrait: Express.Multer.File; identityDocument: Express.Multer.File },
) {
  const publicContext = await onboardingContext(orgSlug, token);
  assertOnboardingFile(
    files.portrait,
    new Set(["image/jpeg", "image/png", "image/webp"]),
    "portrait",
  );
  assertOnboardingFile(
    files.identityDocument,
    new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
    "identityDocument",
  );
  let portrait: Awaited<ReturnType<typeof storePrivateDocument>> | null = null;
  let identityDocument: Awaited<ReturnType<typeof storePrivateDocument>> | null = null;
  try {
    // Store sequentially so a partial upload can always be cleaned if the
    // second private file fails (for example after a network interruption).
    portrait = await storePrivateDocument({
      organizationId: publicContext.organizationId,
      originalName: files.portrait.originalname,
      mimeType: files.portrait.mimetype,
      buffer: files.portrait.buffer,
    });
    identityDocument = await storePrivateDocument({
      organizationId: publicContext.organizationId,
      originalName: files.identityDocument.originalname,
      mimeType: files.identityDocument.mimetype,
      buffer: files.identityDocument.buffer,
    });
    if (!portrait || !identityDocument)
      throw new BadRequestError("The private documents could not be saved");
    const storedPortrait = portrait;
    const storedIdentityDocument = identityDocument;
    const completed = await withTenantContext(
      { organizationId: publicContext.organizationId, userId: null },
      async (client) => {
        const current = await client.query<Row>(
          `SELECT ob.*,a.full_name,a.email,a.phone,a.status AS application_status,j.title AS job_title,j.site_id,j.province_id
             FROM career_candidate_onboardings ob
             JOIN career_applications a ON a.organization_id=ob.organization_id AND a.id=ob.application_id
             JOIN career_job_posts j ON j.organization_id=a.organization_id AND j.id=a.job_post_id
            WHERE ob.organization_id=$1 AND ob.id=$2 AND ob.token_hash=$3
              AND ob.status='pending' AND ob.expires_at > now()
              AND a.status IN ('offered','hired')
            FOR UPDATE`,
          [publicContext.organizationId, publicContext.onboardingId, hashOnboardingToken(token)],
        );
        const record = current.rows[0];
        if (!record)
          throw new NotFoundError(
            "This secure onboarding form is unavailable, expired, or has already been completed",
          );
        const createdDocuments = await client.query<{ id: string }>(
          `INSERT INTO documents(
             organization_id,title,description,category,storage_path,file_name,mime_type,size_bytes,checksum_sha256,
             subject_table,subject_id,province_id,site_id,is_confidential,uploaded_by
           ) VALUES
             ($1,$2,$3,'employee',$4,$5,$6,$7,$8,'career_candidate_onboardings',$9,$10,$11,true,NULL),
             ($1,$12,$13,'employee',$14,$15,$16,$17,$18,'career_candidate_onboardings',$9,$10,$11,true,NULL)
           RETURNING id`,
          [
            publicContext.organizationId,
            `Portrait · ${input.lastName} ${input.firstName}`,
            "Portrait fourni via la fiche d’intégration sécurisée.",
            storedPortrait.storagePath,
            files.portrait.originalname,
            storedPortrait.mimeType,
            storedPortrait.bytes,
            storedPortrait.checksumSha256,
            publicContext.onboardingId,
            record.province_id,
            record.site_id,
            `Pièce d’identité · ${input.lastName} ${input.firstName}`,
            "Pièce d’identité fournie via la fiche d’intégration sécurisée.",
            storedIdentityDocument.storagePath,
            files.identityDocument.originalname,
            storedIdentityDocument.mimeType,
            storedIdentityDocument.bytes,
            storedIdentityDocument.checksumSha256,
          ],
        );
        const [portraitDocument, identityDocumentRecord] = createdDocuments.rows;
        if (!portraitDocument || !identityDocumentRecord)
          throw new BadRequestError("The private documents could not be saved");
        await client.query(
          `UPDATE career_candidate_onboardings
              SET status='completed',last_name=$4,post_name=$5,first_name=$6,date_of_birth=$7,place_of_birth=$8,
                  address_line1=$9,address_line2=$10,address_city=$11,address_region=$12,address_postal_code=$13,address_country=$14,
                  identity_document_type=$15,identity_document_number=$16,social_security_number=$17,
                  emergency_contact_name=$18,emergency_contact_relationship=$19,emergency_contact_phone=$20,
                  portrait_document_id=$21,identity_document_id=$22,submitted_at=now(),completed_at=now()
            WHERE organization_id=$1 AND id=$2 AND application_id=$3`,
          [
            publicContext.organizationId,
            publicContext.onboardingId,
            publicContext.applicationId,
            input.lastName,
            input.postName,
            input.firstName,
            input.dateOfBirth,
            input.placeOfBirth,
            input.addressLine1,
            input.addressLine2 ?? null,
            input.addressCity,
            input.addressRegion,
            input.addressPostalCode ?? null,
            input.addressCountry,
            input.identityDocumentType,
            input.identityDocumentNumber ?? null,
            input.socialSecurityNumber ?? null,
            input.emergencyContactName,
            input.emergencyContactRelationship ?? null,
            input.emergencyContactPhone,
            portraitDocument.id,
            identityDocumentRecord.id,
          ],
        );
        await event(
          client,
          publicContext.organizationId,
          publicContext.applicationId,
          "onboarding_completed",
          null,
          { submittedViaSecureForm: true },
        );
        const team = await recipients(client, publicContext.organizationId);
        await Promise.all(
          team.map((recipient) =>
            createNotificationInTransaction(client, {
              organizationId: publicContext.organizationId,
              recipientMemberId: recipient.member_id,
              provinceId: record.province_id,
              type: "career_onboarding_completed",
              category: "general",
              priority: "high",
              title: "Fiche d’intégration reçue",
              message: `${record.full_name} a complété sa fiche d’intégration pour ${record.job_title}. La fiche employé peut maintenant être créée depuis Ressources humaines.`,
              actionUrl: `/${orgSlug}/employees`,
              entityType: "career_application",
              entityId: publicContext.applicationId,
              deduplicationKey: `career-onboarding:${publicContext.onboardingId}:${recipient.member_id}`,
            }),
          ),
        );
        return { team };
      },
    );
    await Promise.allSettled(
      completed.team.map((recipient) =>
        sendMail({
          to: recipient.email,
          from: RECRUITMENT_FROM_ADDRESS,
          subject: "Fiche d’intégration reçue",
          text: `${publicContext.candidate.fullName} a complété sa fiche d’intégration pour ${publicContext.job.title}. Ouvrez Ressources humaines pour créer sa fiche employé préremplie.`,
          html: `<p><strong>${escapeHtml(publicContext.candidate.fullName)}</strong> a complété sa fiche d’intégration pour <strong>${escapeHtml(publicContext.job.title)}</strong>.</p><p>Ouvrez Ressources humaines pour créer sa fiche employé préremplie.</p>`,
        }),
      ),
    );
    return { completed: true };
  } catch (error) {
    await Promise.allSettled([
      ...(portrait ? [deletePrivateDocument(portrait.storagePath)] : []),
      ...(identityDocument
        ? [deletePrivateDocument(identityDocument.storagePath)]
        : []),
    ]);
    throw error;
  }
}

function buildApplicantConfirmationEmail(
  input: PublicApplicationInput,
  job: Row,
  trackingUrl: string,
) {
  const french = input.preferredLanguage !== "en";
  const organizationName =
    String(job.display_name ?? "LiteHubs").trim() || "LiteHubs";
  const applicantName = input.fullName.trim();
  const title = String(job.title ?? "").trim();
  const siteName = String(job.site_name ?? "").trim();
  const subject = french
    ? `Candidature reçue · ${title}`
    : `Application received · ${title}`;
  const text = french
    ? [
        `Bonjour ${applicantName},`,
        "",
        `Nous confirmons la réception de votre candidature pour le poste « ${title} » sur le site ${siteName}.`,
        "",
        `Votre CV et vos informations restent accessibles uniquement à l’équipe de recrutement autorisée de ${organizationName}.`,
        "",
        "L’équipe examinera votre dossier de manière confidentielle et vous contactera si votre profil correspond aux besoins du poste ou si des documents et informations complémentaires sont nécessaires.",
        "",
        `Suivez l’avancement de votre candidature et envoyez les documents demandés dans votre Espace candidat personnel : ${trackingUrl}`,
        "",
        `Pour toute question concernant votre candidature, écrivez à ${CANDIDATE_CONTACT_EMAIL}.`,
        "",
        `Merci,\n${organizationName}`,
      ].join("\n")
    : [
        `Hello ${applicantName},`,
        "",
        `We confirm that we received your application for ${title} at ${siteName}.`,
        "",
        `Your résumé and details are accessible only to ${organizationName}'s authorised recruitment team.`,
        "",
        "The team will review your application confidentially and contact you if your profile matches the needs of the role or if further documents and information are needed.",
        "",
        `Follow your application and send any requested documents from your personal candidate space: ${trackingUrl}`,
        "",
        `For questions about your application, email ${CANDIDATE_CONTACT_EMAIL}.`,
        "",
        `Thank you,\n${organizationName}`,
      ].join("\n");

  const safe = {
    organizationName: escapeHtml(organizationName),
    applicantName: escapeHtml(applicantName),
    title: escapeHtml(title),
    siteName: escapeHtml(siteName),
  };
  const heading = french
    ? "Votre candidature a été reçue"
    : "Your application was received";
  const preview = french
    ? `Confirmation de votre candidature chez ${organizationName}.`
    : `Confirmation of your application with ${organizationName}.`;
  const intro = french
    ? `Bonjour <strong>${safe.applicantName}</strong>,`
    : `Hello <strong>${safe.applicantName}</strong>,`;
  const receipt = french
    ? `Nous confirmons la réception de votre candidature pour le poste <strong>${safe.title}</strong> sur le site <strong>${safe.siteName}</strong>.`
    : `We confirm that we received your application for <strong>${safe.title}</strong> at <strong>${safe.siteName}</strong>.`;
  const privacy = french
    ? `Votre CV et vos informations restent accessibles uniquement à l’équipe de recrutement autorisée de ${safe.organizationName}.`
    : `Your résumé and details are accessible only to ${safe.organizationName}'s authorised recruitment team.`;
  const next = french
    ? "L’équipe examinera votre dossier de manière confidentielle et vous contactera si votre profil correspond aux besoins du poste ou si des documents et informations complémentaires sont nécessaires."
    : "The team will review your application confidentially and contact you if your profile matches the needs of the role or if further documents and information are needed.";
  const footer = french
    ? `Pour toute question concernant votre candidature, écrivez à ${CANDIDATE_CONTACT_EMAIL}.`
    : `For questions about your application, email ${CANDIDATE_CONTACT_EMAIL}.`;

  return {
    to: input.email,
    from: RECRUITMENT_FROM_ADDRESS,
    subject,
    text,
    html: `<!doctype html>
<html lang="${french ? "fr" : "en"}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f7f5;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#172b23;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preview)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#f3f7f5;"><tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #d8e5dc;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:25px 32px;background:#114b32;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-size:21px;font-weight:800;letter-spacing:-.35px;color:#ffffff;">${safe.organizationName}</td>
            <td align="right" style="font-size:11px;font-weight:700;letter-spacing:1.2px;color:#b9e7cb;text-transform:uppercase;">LiteHubs</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:34px 32px 30px;">
          <div style="width:42px;height:5px;margin:0 0 20px;background:#29a36a;border-radius:99px;"></div>
          <h1 style="margin:0 0 19px;color:#14251d;font-size:27px;line-height:1.25;letter-spacing:-.4px;">${escapeHtml(heading)}</h1>
          <p style="margin:0 0 17px;color:#344b3d;font-size:15px;line-height:1.65;">${intro}</p>
          <p style="margin:0 0 20px;color:#344b3d;font-size:15px;line-height:1.65;">${receipt}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 21px;background:#edf8f1;border:1px solid #ccebd7;border-radius:10px;"><tr><td style="padding:15px 17px;color:#215e3c;font-size:13px;line-height:1.55;">${privacy}</td></tr></table>
          <p style="margin:0;color:#344b3d;font-size:15px;line-height:1.65;">${next}</p>
          ${candidatePortalButtonHtml(trackingUrl, french)}
        </td></tr>
        <tr><td style="padding:20px 32px;background:#f7faf8;border-top:1px solid #e1ebe5;color:#66776d;font-size:12px;line-height:1.55;">${footer}<br />© ${new Date().getFullYear()} ${safe.organizationName} · LiteHubs</td></tr>
      </table>
    </td></tr></table>
  </body>
</html>`,
  };
}

function buildApplicantConfirmationSms(
  input: PublicApplicationInput,
  job: Row,
  trackingUrl: string,
) {
  const french = input.preferredLanguage !== "en";
  const organizationName =
    String(job.display_name ?? "LiteHubs").trim() || "LiteHubs";
  const title = String(job.title ?? "").trim().slice(0, 180);
  const siteName = String(job.site_name ?? "").trim().slice(0, 120);
  const content = french
    ? `${organizationName} : votre candidature pour « ${title} » au site ${siteName} a été reçue. Suivez-la ici : ${trackingUrl}`
    : `${organizationName}: your application for ${title} at ${siteName} was received. Follow it here: ${trackingUrl}`;

  return { to: input.phone, content: content.slice(0, 600) };
}

type CandidateStatusNotification = {
  applicationId: string;
  organizationName: string;
  email: string;
  phone: string;
  fullName: string;
  jobTitle: string;
  siteName: string;
  status: string;
  message: string;
  french: boolean;
  onboardingUrl: string | null;
  trackingUrl: string | null;
};

/** Shared call-to-action used in every candidate e-mail. */
export function candidatePortalButtonHtml(url: string, french: boolean) {
  const label = french ? "Ouvrir mon Espace candidat" : "Open my candidate space";
  const note = french
    ? "Lien personnel : ne le partagez avec personne. Vous pouvez demander un nouveau lien à tout moment depuis la page carrières."
    : "Personal link: do not share it. You can request a new link at any time from the careers page.";
  return `<div style="margin-top:24px;padding:18px;border:1px solid #d6e4f5;border-radius:12px;background:#f2f7fd;"><p style="margin:0 0 14px;color:#1e3a5f;font-size:14px;line-height:1.6;">${french ? "Suivez l’avancement de votre candidature, lisez les messages de l’équipe et envoyez les documents demandés." : "Follow your application, read messages from the team and send requested documents."}</p><a href="${escapeHtml(url)}" style="display:inline-block;border-radius:8px;background:#1d4ed8;padding:12px 17px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">${label}</a><p style="margin:14px 0 0;color:#66776d;font-size:11px;line-height:1.5;">${note}</p></div>`;
}

function defaultCandidateStatusMessage({
  status,
  jobTitle,
  siteName,
  french,
}: Pick<CandidateStatusNotification, "status" | "jobTitle" | "siteName" | "french">) {
  const role = jobTitle || (french ? "ce poste" : "this role");
  const location = siteName
    ? french
      ? ` sur le site ${siteName}`
      : ` at ${siteName}`
    : "";
  const frenchMessages: Record<string, string> = {
    received: `Votre candidature pour « ${role} » est bien reçue. Notre équipe vous contactera si des documents ou informations complémentaires sont nécessaires.`,
    reviewing: `Votre candidature pour « ${role} » est maintenant en cours d’examen par notre équipe.`,
    shortlisted: `Votre candidature pour « ${role} » a été présélectionnée. Nous vous contacterons prochainement pour la suite.`,
    interview: `Votre candidature pour « ${role} » est retenue pour un entretien${location}. Notre équipe vous communiquera les modalités.`,
    offered: `Une offre relative au poste « ${role} » est disponible. Notre équipe vous contactera pour les prochaines étapes.`,
    hired: `Félicitations, votre candidature pour « ${role} » a été retenue. Notre équipe vous contactera pour votre intégration.`,
    rejected: `Après étude de votre candidature pour « ${role} », nous ne pouvons pas y donner une suite favorable. Nous vous remercions de votre intérêt.`,
    withdrawn: `Votre candidature pour « ${role} » est maintenant enregistrée comme retirée.`,
  };
  const englishMessages: Record<string, string> = {
    received: `Your application for ${role} was received. Our team will contact you if further documents or information are needed.`,
    reviewing: `Your application for ${role} is now under review by our team.`,
    shortlisted: `Your application for ${role} has been shortlisted. We will contact you soon about the next steps.`,
    interview: `Your application for ${role} has been selected for an interview${location}. Our team will share the arrangements.`,
    offered: `An offer for the ${role} position is available. Our team will contact you about the next steps.`,
    hired: `Congratulations, your application for ${role} has been successful. Our team will contact you about onboarding.`,
    rejected: `After reviewing your application for ${role}, we are unable to proceed further. Thank you for your interest.`,
    withdrawn: `Your application for ${role} is now recorded as withdrawn.`,
  };
  return (french ? frenchMessages : englishMessages)[status] ?? (french ? "Votre candidature a été mise à jour." : "Your application was updated.");
}

function buildCandidateStatusEmail(notification: CandidateStatusNotification) {
  const subject = notification.french
    ? `Mise à jour de votre candidature · ${notification.jobTitle}`
    : `Update on your application · ${notification.jobTitle}`;
  const greeting = notification.french
    ? `Bonjour ${notification.fullName},`
    : `Hello ${notification.fullName},`;
  const footer = notification.french
    ? `Pour toute question concernant votre candidature, écrivez à ${CANDIDATE_CONTACT_EMAIL}.`
    : `For questions about your application, email ${CANDIDATE_CONTACT_EMAIL}.`;
  const htmlMessage = escapeHtml(notification.message).replace(/\n/g, "<br />");
  const onboardingText = notification.onboardingUrl
    ? notification.french
      ? "Avant de rejoindre l’équipe, complétez votre fiche d’intégration sécurisée. Elle nous permet de préparer votre dossier RH, vos contacts d’urgence et vos documents d’identité."
      : "Before joining the team, complete your secure onboarding form. It lets us prepare your HR file, emergency contacts and identity documents."
    : null;
  const onboardingAction = notification.onboardingUrl
    ? notification.french
      ? "Compléter ma fiche d’intégration"
      : "Complete my onboarding form"
    : null;
  const text = [
    greeting,
    "",
    notification.message,
    ...(onboardingText && notification.onboardingUrl
      ? ["", onboardingText, notification.onboardingUrl]
      : []),
    ...(notification.trackingUrl
      ? [
          "",
          notification.french
            ? `Votre Espace candidat : ${notification.trackingUrl}`
            : `Your candidate space: ${notification.trackingUrl}`,
        ]
      : []),
    "",
    footer,
  ].join("\n");
  const onboardingHtml =
    onboardingText && notification.onboardingUrl && onboardingAction
      ? `<div style="margin-top:24px;padding:18px;border:1px solid #ccebd7;border-radius:12px;background:#edf8f1;"><p style="margin:0 0 15px;color:#215e3c;font-size:14px;line-height:1.6;">${escapeHtml(onboardingText)}</p><a href="${escapeHtml(notification.onboardingUrl)}" style="display:inline-block;border-radius:8px;background:#114b32;padding:12px 17px;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">${escapeHtml(onboardingAction)}</a><p style="margin:14px 0 0;color:#66776d;font-size:11px;line-height:1.5;">${notification.french ? "Ce lien personnel expire dans 21 jours. Ne le partagez avec personne." : "This personal link expires in 21 days. Do not share it with anyone."}</p></div>`
      : "";
  return {
    to: notification.email,
    from: RECRUITMENT_FROM_ADDRESS,
    subject,
    text,
    html: `<!doctype html><html lang="${notification.french ? "fr" : "en"}"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f3f7f5;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#172b23;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#f3f7f5;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #d8e5dc;border-radius:16px;overflow:hidden;"><tr><td style="padding:25px 32px;background:#114b32;color:#fff;font-size:21px;font-weight:800;">${escapeHtml(notification.organizationName)}</td></tr><tr><td style="padding:34px 32px 30px;"><div style="width:42px;height:5px;margin:0 0 20px;background:#29a36a;border-radius:99px;"></div><h1 style="margin:0 0 19px;color:#14251d;font-size:27px;line-height:1.25;">${escapeHtml(subject)}</h1><p style="margin:0 0 17px;color:#344b3d;font-size:15px;line-height:1.65;">${escapeHtml(greeting)}</p><p style="margin:0;color:#344b3d;font-size:15px;line-height:1.65;">${htmlMessage}</p>${onboardingHtml}${notification.trackingUrl ? candidatePortalButtonHtml(notification.trackingUrl, notification.french) : ""}</td></tr><tr><td style="padding:20px 32px;background:#f7faf8;border-top:1px solid #e1ebe5;color:#66776d;font-size:12px;line-height:1.55;">${escapeHtml(footer)}</td></tr></table></td></tr></table></body></html>`,
  };
}

function buildCandidateStatusSms(notification: CandidateStatusNotification) {
  // Keep the link intact: shorten the message, never the URL.
  const suffix = notification.onboardingUrl
    ? ` Fiche d’intégration sécurisée : ${notification.onboardingUrl}`
    : notification.trackingUrl
      ? ` Suivi : ${notification.trackingUrl}`
      : ` Contact : ${CANDIDATE_CONTACT_EMAIL}`;
  const body = `${notification.organizationName} : ${notification.message}`
    .replace(/\s+/g, " ")
    .slice(0, Math.max(80, 600 - suffix.length));
  return { to: notification.phone, content: `${body}${suffix}`.slice(0, 610) };
}

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}
