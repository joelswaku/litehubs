import type { PoolClient } from "pg";
import {
  deletePrivateDocument,
  readPrivateDocument,
  storePrivateDocument,
} from "../../services/file-storage.service";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors";
import { withTenantContext } from "../../utils/tenant-query";
import type {
  DocumentQuery,
  DocumentUpdateInput,
  DocumentUploadInput,
} from "./documents.validation";

type Row = Record<string, unknown>;
export interface DocumentsContext {
  organizationId: string;
  userId: string;
  memberId: string;
  isOwner: boolean;
}
function map(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z0-9])/g, (_match, letter: string) =>
        letter.toUpperCase(),
      ),
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
}
async function scopedProvinces(client: PoolClient, context: DocumentsContext) {
  if (context.isOwner) return null;
  const organizationScope = await client.query<{ organization: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM member_roles mr JOIN roles r ON r.organization_id=mr.organization_id AND r.id=mr.role_id WHERE mr.organization_id=$1 AND mr.member_id=$2 AND r.data_scope='organization') AS organization`,
    [context.organizationId, context.memberId],
  );
  if (organizationScope.rows[0]?.organization) return null;
  const provinces = await client.query<{ province_id: string }>(
    "SELECT province_id FROM member_provinces WHERE organization_id=$1 AND member_id=$2",
    [context.organizationId, context.memberId],
  );
  return provinces.rows.map((row) => row.province_id);
}
async function assertProvince(
  client: PoolClient,
  context: DocumentsContext,
  provinceId: string | null | undefined,
) {
  if (!provinceId) return;
  const exists = await client.query(
    "SELECT 1 FROM provinces WHERE organization_id=$1 AND id=$2",
    [context.organizationId, provinceId],
  );
  if (!exists.rowCount)
    throw new BadRequestError("Choose a province in this company", {
      field: "provinceId",
    });
  const allowed = await scopedProvinces(client, context);
  if (allowed && !allowed.includes(provinceId))
    throw new NotFoundError("Document not found");
}
async function resolveSite(
  client: PoolClient,
  context: DocumentsContext,
  siteId: string | null | undefined,
) {
  if (!siteId) return null;
  const site = await client.query<{ province_id: string }>(
    "SELECT province_id FROM sites WHERE organization_id=$1 AND id=$2 AND is_active=true",
    [context.organizationId, siteId],
  );
  if (!site.rows[0])
    throw new BadRequestError("Choose an active site in this company", {
      field: "siteId",
    });
  await assertProvince(client, context, site.rows[0].province_id);
  return site.rows[0].province_id;
}
const subjects: Record<string, string> = {
  incidents: "incidents",
  employees: "employees",
  sites: "sites",
  projects: "management_projects",
};
async function assertSubject(
  client: PoolClient,
  context: DocumentsContext,
  subjectTable: string | null | undefined,
  subjectId: string | null | undefined,
) {
  if (!subjectTable && !subjectId) return;
  if (!subjectTable || !subjectId)
    throw new BadRequestError("Choose both the linked record type and record", {
      field: "subjectId",
    });
  const table = subjects[subjectTable];
  if (!table)
    throw new BadRequestError("Unsupported linked record type", {
      field: "subjectTable",
    });
  const row = await client.query(
    `SELECT 1 FROM ${table} WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, subjectId],
  );
  if (!row.rowCount)
    throw new BadRequestError("Choose a record in this company", {
      field: "subjectId",
    });
}
async function rowFor(
  client: PoolClient,
  context: DocumentsContext,
  id: string,
) {
  const result = await client.query<Row>(
    `SELECT d.*,p.name AS province_name,s.name AS site_name,u.full_name AS uploaded_by_name
     FROM documents d LEFT JOIN provinces p ON p.organization_id=d.organization_id AND p.id=d.province_id
     LEFT JOIN sites s ON s.organization_id=d.organization_id AND s.id=d.site_id
     LEFT JOIN users u ON u.id=d.uploaded_by
     WHERE d.organization_id=$1 AND d.id=$2`,
    [context.organizationId, id],
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Document not found");
  if (row.is_confidential && !context.isOwner)
    throw new NotFoundError("Document not found");
  const provinces = await scopedProvinces(client, context);
  if (
    provinces &&
    row.province_id &&
    !provinces.includes(String(row.province_id))
  )
    throw new NotFoundError("Document not found");
  return row;
}
export async function listDocuments(
  context: DocumentsContext,
  query: DocumentQuery,
) {
  return withTenantContext(context, async (client) => {
    const provinces = await scopedProvinces(client, context);
    const params: unknown[] = [context.organizationId];
    const where = ["d.organization_id=$1"];
    if (!context.isOwner) where.push("d.is_confidential=false");
    for (const [column, value] of [
      ["category", query.category],
      ["province_id", query.provinceId],
      ["site_id", query.siteId],
      ["subject_table", query.subjectTable],
      ["subject_id", query.subjectId],
    ] as const) {
      if (value) {
        params.push(value);
        where.push(`d.${column}=$${params.length}`);
      }
    }
    if (query.expiringOnly)
      where.push(
        "d.expires_on IS NOT NULL AND d.expires_on <= current_date + 30",
      );
    if (provinces) {
      params.push(provinces);
      where.push(
        `(d.province_id IS NULL OR d.province_id=ANY($${params.length}::uuid[]))`,
      );
    }
    const result = await client.query<Row>(
      `SELECT d.id,d.title,d.description,d.category,d.file_name,d.mime_type,d.size_bytes,d.subject_table,d.subject_id,d.province_id,d.site_id,d.expires_on,d.is_confidential,d.version,d.supersedes_id,d.uploaded_by,d.created_at,d.updated_at,p.name AS province_name,s.name AS site_name,u.full_name AS uploaded_by_name
       FROM documents d LEFT JOIN provinces p ON p.organization_id=d.organization_id AND p.id=d.province_id
       LEFT JOIN sites s ON s.organization_id=d.organization_id AND s.id=d.site_id
       LEFT JOIN users u ON u.id=d.uploaded_by WHERE ${where.join(" AND ")}
       ORDER BY d.is_confidential DESC,d.created_at DESC`,
      params,
    );
    return result.rows.map(map);
  });
}
export async function uploadDocument(
  context: DocumentsContext,
  input: DocumentUploadInput,
  file: Express.Multer.File,
) {
  const stored = await storePrivateDocument({
    organizationId: context.organizationId,
    originalName: file.originalname,
    mimeType: file.mimetype,
    buffer: file.buffer,
  });
  try {
    return await withTenantContext(context, async (client) => {
      let provinceId = input.provinceId ?? null;
      const siteProvince = await resolveSite(
        client,
        context,
        input.siteId ?? null,
      );
      if (siteProvince) {
        if (provinceId && provinceId !== siteProvince)
          throw new BadRequestError("Choose a site in the selected province", {
            field: "siteId",
          });
        provinceId = siteProvince;
      } else await assertProvince(client, context, provinceId);
      if (input.isConfidential && !context.isOwner)
        throw new ForbiddenError(
          "Only the workspace owner can upload a confidential document",
        );
      await assertSubject(
        client,
        context,
        input.subjectTable ?? null,
        input.subjectId ?? null,
      );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO documents (organization_id,title,description,category,storage_path,file_name,mime_type,size_bytes,checksum_sha256,subject_table,subject_id,province_id,site_id,expires_on,is_confidential,uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [
          context.organizationId,
          input.title,
          input.description ?? null,
          input.category ?? "general",
          stored.storagePath,
          file.originalname,
          stored.mimeType,
          stored.bytes,
          stored.checksumSha256,
          input.subjectTable ?? null,
          input.subjectId ?? null,
          provinceId,
          input.siteId ?? null,
          input.expiresOn ?? null,
          input.isConfidential ?? false,
          context.userId,
        ],
      );
      return map(await rowFor(client, context, inserted.rows[0]!.id));
    });
  } catch (error) {
    await deletePrivateDocument(stored.storagePath).catch(() => undefined);
    throw error;
  }
}
export async function updateDocument(
  context: DocumentsContext,
  id: string,
  input: DocumentUpdateInput,
) {
  return withTenantContext(context, async (client) => {
    const existing = await rowFor(client, context, id);
    if (
      input.isConfidential !== undefined &&
      input.isConfidential !== existing.is_confidential &&
      !context.isOwner
    )
      throw new ForbiddenError(
        "Only the workspace owner can change document confidentiality",
      );
    let provinceId = (
      input.provinceId === undefined ? existing.province_id : input.provinceId
    ) as string | null;
    const siteId = (
      input.siteId === undefined ? existing.site_id : input.siteId
    ) as string | null;
    const siteProvince = await resolveSite(client, context, siteId);
    if (siteProvince) {
      if (provinceId && provinceId !== siteProvince)
        throw new BadRequestError("Choose a site in the selected province", {
          field: "siteId",
        });
      provinceId = siteProvince;
    } else await assertProvince(client, context, provinceId);
    const subjectTable = (
      input.subjectTable === undefined
        ? existing.subject_table
        : input.subjectTable
    ) as string | null;
    const subjectId = (
      input.subjectId === undefined ? existing.subject_id : input.subjectId
    ) as string | null;
    await assertSubject(client, context, subjectTable, subjectId);
    const values: Record<string, unknown> = {
      ...input,
      provinceId,
      siteId,
      subjectTable,
      subjectId,
    };
    const entries = Object.entries(values).filter(
      ([, value]) => value !== undefined,
    );
    const args = [
      context.organizationId,
      id,
      ...entries.map(([, value]) => value),
    ];
    const set = entries.map(
      ([key], index) =>
        `${key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}=$${index + 3}`,
    );
    await client.query(
      `UPDATE documents SET ${set.join(",")} WHERE organization_id=$1 AND id=$2`,
      args,
    );
    return map(await rowFor(client, context, id));
  });
}
export async function removeDocument(context: DocumentsContext, id: string) {
  return withTenantContext(context, async (client) => {
    const row = await rowFor(client, context, id);
    await deletePrivateDocument(String(row.storage_path));
    await client.query(
      "DELETE FROM documents WHERE organization_id=$1 AND id=$2",
      [context.organizationId, id],
    );
  });
}
export async function fileFor(context: DocumentsContext, id: string) {
  return withTenantContext(context, async (client) => {
    const row = await rowFor(client, context, id);
    return {
      document: map(row),
      buffer: await readPrivateDocument(String(row.storage_path)),
    };
  });
}
export async function summary(context: DocumentsContext) {
  const documents = await listDocuments(context, {});
  const now = new Date().toISOString().slice(0, 10);
  const deadline = new Date(Date.now() + 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  return {
    metrics: {
      total: documents.length,
      confidential: documents.filter((row) => row.isConfidential).length,
      expiring: documents.filter(
        (row) =>
          String(row.expiresOn ?? "") >= now &&
          String(row.expiresOn ?? "") <= deadline,
      ).length,
      contracts: documents.filter((row) => row.category === "contract").length,
    },
  };
}
