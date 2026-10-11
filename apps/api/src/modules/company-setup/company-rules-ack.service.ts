/**
 * Acknowledgement of the company rules.
 *
 * For each published version, every active employee confirms that he
 * received, read and understood the rules:
 *  - in LiteHubs (My account): he reads the rules and signs electronically;
 *  - on paper: a manager prints the copy to sign, then records the scan.
 * The signed copy (generated PDF or scan) stays in the employee file.
 */
import type { PoolClient } from "pg";
import { readPrivateDocument, storePrivateDocument } from "../../services/file-storage.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import { createNotificationInTransaction } from "../notifications/notifications.service";
import { exportCompanyRulesPdf, type SetupContext } from "./company-setup.service";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const CONSENT = "J’ai reçu, lu et compris le règlement de l’entreprise et je m’engage à le respecter.";

export const canManageAcknowledgements = (context: SetupContext) =>
  context.isOwner || context.permissions.includes("employees.update");
function assertManager(context: SetupContext) {
  if (!canManageAcknowledgements(context)) throw new ForbiddenError("Réservé au propriétaire et aux ressources humaines.");
}

async function currentVersion(client: PoolClient, organizationId: string) {
  const result = await client.query<{ id: string; version_number: number; title: string; content: string; created_at: Date }>(
    `SELECT id,version_number,title,content,created_at FROM company_rules_versions
      WHERE organization_id=$1 AND status='published' ORDER BY version_number DESC LIMIT 1`,
    [organizationId],
  );
  return result.rows[0] ?? null;
}

async function ownEmployee(client: PoolClient, context: SetupContext) {
  const result = await client.query<{ id: string; full_name: string; employee_number: string | null; job_title: string | null }>(
    `SELECT id,full_name,employee_number,job_title FROM employees WHERE organization_id=$1 AND member_id=$2 LIMIT 1`,
    [context.organizationId, context.memberId],
  );
  return result.rows[0] ?? null;
}

function mapAck(row: Row | undefined) {
  if (!row) return null;
  return {
    id: row.id as string,
    method: row.method as "electronic" | "paper",
    signedName: row.signed_name as string,
    signedAt: row.signed_at as Date,
    recordedBy: (row.recorded_by as string | null) ?? null,
    note: (row.note as string | null) ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Employee side                                                       */
/* ------------------------------------------------------------------ */

export async function myRulesAcknowledgement(context: SetupContext) {
  return withTenantContext(context, async (client) => {
    const version = await currentVersion(client, context.organizationId);
    const employee = await ownEmployee(client, context);
    if (!version || !employee) return { version: null, employee: null, acknowledgement: null };
    const ack = await client.query<Row>(
      `SELECT * FROM company_rules_acknowledgements WHERE organization_id=$1 AND rules_version_id=$2 AND employee_id=$3`,
      [context.organizationId, version.id, employee.id],
    );
    return {
      version: { id: version.id, number: version.version_number, title: version.title, content: version.content, publishedAt: version.created_at },
      employee: { id: employee.id, name: employee.full_name },
      acknowledgement: mapAck(ack.rows[0]),
      consentText: CONSENT,
    };
  });
}

export async function signMyRules(
  context: SetupContext,
  input: { versionId: string; signedName: string; accepted: boolean },
  meta: { ipAddress: string | null; userAgent: string | null },
) {
  if (!input.accepted) throw new BadRequestError("Cochez la case pour confirmer que vous avez lu et compris le règlement.");
  await withTenantContext(context, async (client) => {
    const version = await currentVersion(client, context.organizationId);
    if (!version || version.id !== input.versionId)
      throw new BadRequestError("Le règlement a changé entre-temps : rechargez la page et relisez la nouvelle version.");
    const employee = await ownEmployee(client, context);
    if (!employee) throw new NotFoundError("Aucune fiche employé n’est liée à votre compte.");
    const name = input.signedName.trim().replace(/\s+/g, " ");
    if (name.length < 3) throw new BadRequestError("Écrivez votre nom complet pour signer.");
    const inserted = await client.query(
      `INSERT INTO company_rules_acknowledgements
         (organization_id,rules_version_id,employee_id,method,signed_name,consent_text,recorded_by_member_id,ip_address,user_agent)
       VALUES ($1,$2,$3,'electronic',$4,$5,$6,$7,$8)
       ON CONFLICT (organization_id,rules_version_id,employee_id) DO NOTHING`,
      [context.organizationId, version.id, employee.id, name.slice(0, 160), CONSENT, context.memberId, meta.ipAddress, meta.userAgent?.slice(0, 300) ?? null],
    );
    if (!inserted.rowCount) throw new BadRequestError("Vous avez déjà signé cette version du règlement.");
  });
  return myRulesAcknowledgement(context);
}

/* ------------------------------------------------------------------ */
/* Manager side                                                        */
/* ------------------------------------------------------------------ */

export async function listAcknowledgements(context: SetupContext) {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    const version = await currentVersion(client, context.organizationId);
    if (!version) return { version: null, employees: [], summary: { total: 0, signed: 0, electronic: 0, paper: 0, pending: 0 } };
    const result = await client.query<Row>(
      `SELECT e.id,e.full_name,e.employee_number,e.job_title,e.member_id,
              a.id AS ack_id,a.method,a.signed_name,a.signed_at,a.note,
              COALESCE(NULLIF(btrim(u.full_name),''),u.email::text) AS recorded_by
         FROM employees e
         LEFT JOIN company_rules_acknowledgements a
           ON a.organization_id=e.organization_id AND a.employee_id=e.id AND a.rules_version_id=$2
         LEFT JOIN organization_members m ON m.organization_id=a.organization_id AND m.id=a.recorded_by_member_id
         LEFT JOIN users u ON u.id=m.user_id
        WHERE e.organization_id=$1 AND e.employment_status='active'
        ORDER BY (a.id IS NULL) DESC, e.full_name`,
      [context.organizationId, version.id],
    );
    const employees = result.rows.map((row) => ({
      id: row.id as string,
      name: row.full_name as string,
      employeeNumber: (row.employee_number as string | null) ?? null,
      jobTitle: (row.job_title as string | null) ?? null,
      hasAccount: Boolean(row.member_id),
      acknowledgement: row.ack_id
        ? mapAck({ id: row.ack_id, method: row.method, signed_name: row.signed_name, signed_at: row.signed_at, note: row.note, recorded_by: row.recorded_by })
        : null,
    }));
    const signed = employees.filter((item) => item.acknowledgement);
    return {
      version: { id: version.id, number: version.version_number, title: version.title, publishedAt: version.created_at },
      employees,
      summary: {
        total: employees.length,
        signed: signed.length,
        electronic: signed.filter((item) => item.acknowledgement!.method === "electronic").length,
        paper: signed.filter((item) => item.acknowledgement!.method === "paper").length,
        pending: employees.length - signed.length,
      },
    };
  });
}

/** Asks employees who have not signed yet (and have an account) to sign. */
export async function remindEmployees(context: SetupContext, employeeIds: string[] | "pending") {
  assertManager(context);
  return withTenantContext(context, async (client) => {
    const version = await currentVersion(client, context.organizationId);
    if (!version) throw new BadRequestError("Publiez d’abord le règlement.");
    const targets = await client.query<{ id: string; member_id: string }>(
      `SELECT e.id,e.member_id FROM employees e
        WHERE e.organization_id=$1 AND e.employment_status='active' AND e.member_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM company_rules_acknowledgements a
                           WHERE a.organization_id=e.organization_id AND a.employee_id=e.id AND a.rules_version_id=$2)
          ${employeeIds === "pending" ? "" : "AND e.id = ANY($3::uuid[])"}`,
      employeeIds === "pending" ? [context.organizationId, version.id] : [context.organizationId, version.id, employeeIds],
    );
    for (const target of targets.rows) {
      await createNotificationInTransaction(client, {
        organizationId: context.organizationId,
        recipientMemberId: target.member_id,
        recipientEmployeeId: target.id,
        actorUserId: context.userId,
        category: "document",
        type: "company_rules_signature_requested",
        priority: "high",
        title: "Règlement de l’entreprise à lire et signer",
        message: `Lisez le règlement (version n° ${version.version_number}) puis confirmez que vous l’avez compris.`,
        actionUrl: "/my-account?rules=1",
        entityType: "company_rules_version",
        entityId: version.id,
        deduplicationKey: `company-rules:${version.id}:${target.id}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
    return { notified: targets.rows.length };
  });
}

async function employeeSheet(client: PoolClient, organizationId: string, employeeId: string) {
  const result = await client.query<{ id: string; full_name: string; employee_number: string | null; job_title: string | null }>(
    `SELECT id,full_name,employee_number,job_title FROM employees WHERE organization_id=$1 AND id=$2`,
    [organizationId, employeeId],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Employé introuvable");
  return row;
}

/** Copy to print: the rules followed by the acknowledgement page to sign by hand. */
export async function printForEmployee(context: SetupContext, employeeId: string) {
  assertManager(context);
  const employee = await withTenantContext(context, (client) => employeeSheet(client, context.organizationId, employeeId));
  const buffer = await exportCompanyRulesPdf(context, true, {
    acknowledgement: { employeeName: employee.full_name, employeeNumber: employee.employee_number, jobTitle: employee.job_title, signed: null },
  });
  return { buffer, fileName: `reglement-a-signer-${(employee.employee_number ?? employee.id.slice(0, 8)).replace(/[^\w-]/g, "")}.pdf` };
}

export async function recordPaperAcknowledgement(
  context: SetupContext,
  employeeId: string,
  input: { signedOn: string; note?: string | null },
  file: Express.Multer.File,
) {
  assertManager(context);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.signedOn) || input.signedOn > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10))
    throw new BadRequestError("Indiquez une date de signature valide (pas dans le futur).");
  await withTenantContext(context, async (client) => {
    const version = await currentVersion(client, context.organizationId);
    if (!version) throw new BadRequestError("Publiez d’abord le règlement.");
    const employee = await employeeSheet(client, context.organizationId, employeeId);
    const existing = await client.query(
      `SELECT 1 FROM company_rules_acknowledgements WHERE organization_id=$1 AND rules_version_id=$2 AND employee_id=$3`,
      [context.organizationId, version.id, employee.id],
    );
    if (existing.rowCount) throw new BadRequestError("Cet employé a déjà signé cette version du règlement.");
    const stored = await storePrivateDocument({
      organizationId: context.organizationId,
      originalName: file.originalname || "reglement-signe.pdf",
      mimeType: file.mimetype,
      buffer: file.buffer,
    });
    const extension = file.mimetype === "application/pdf" ? "pdf" : file.mimetype === "image/png" ? "png" : "jpg";
    const doc = await client.query<{ id: string }>(
      `INSERT INTO documents (organization_id,title,description,category,storage_path,file_name,mime_type,size_bytes,checksum_sha256,subject_table,subject_id,is_confidential,uploaded_by)
       VALUES ($1,$2,$3,'employee',$4,$5,$6,$7,$8,'employees',$9,true,$10) RETURNING id`,
      [
        context.organizationId,
        `Règlement v${version.version_number} signé · ${employee.full_name}`,
        input.note?.trim() || "Accusé de réception du règlement signé à la main, scanné et enregistré dans LiteHubs",
        stored.storagePath,
        `reglement-v${version.version_number}-signe.${extension}`,
        file.mimetype,
        stored.bytes,
        stored.checksumSha256,
        employee.id,
        context.userId,
      ],
    );
    await client.query(
      `INSERT INTO company_rules_acknowledgements
         (organization_id,rules_version_id,employee_id,method,signed_name,consent_text,signed_at,document_id,recorded_by_member_id,note)
       VALUES ($1,$2,$3,'paper',$4,$5,$6::date + time '12:00',$7,$8,$9)`,
      [context.organizationId, version.id, employee.id, employee.full_name, CONSENT, input.signedOn, doc.rows[0]!.id, context.memberId, input.note?.trim() || null],
    );
  });
  return listAcknowledgements(context);
}

/** The signed copy: the scan (paper) or the rules with the signature page (electronic). */
export async function acknowledgementDocument(context: SetupContext, acknowledgementId: string) {
  const data = await withTenantContext(context, async (client) => {
    const result = await client.query<Row>(
      `SELECT a.*,e.full_name,e.employee_number,e.job_title,e.member_id,d.storage_path,d.mime_type,d.file_name
         FROM company_rules_acknowledgements a
         JOIN employees e ON e.organization_id=a.organization_id AND e.id=a.employee_id
         LEFT JOIN documents d ON d.organization_id=a.organization_id AND d.id=a.document_id
        WHERE a.organization_id=$1 AND a.id=$2`,
      [context.organizationId, acknowledgementId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError("Signature introuvable");
    if (!canManageAcknowledgements(context) && row.member_id !== context.memberId) throw new NotFoundError("Signature introuvable");
    return row;
  });
  if (data.method === "paper" && data.storage_path) {
    return { buffer: await readPrivateDocument(String(data.storage_path)), mimeType: String(data.mime_type), fileName: String(data.file_name ?? "reglement-signe.pdf") };
  }
  const buffer = await exportCompanyRulesPdf(context, true, {
    versionId: String(data.rules_version_id),
    acknowledgement: {
      employeeName: String(data.full_name),
      employeeNumber: (data.employee_number as string | null) ?? null,
      jobTitle: (data.job_title as string | null) ?? null,
      signed: { name: String(data.signed_name), at: new Date(data.signed_at), method: "electronic", ipAddress: (data.ip_address as string | null) ?? null },
    },
  });
  return { buffer, mimeType: "application/pdf", fileName: "reglement-signe.pdf" };
}
