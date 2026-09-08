import type { PoolClient } from "pg";
import { ForbiddenError, NotFoundError } from "../utils/errors";

export type DocumentVisibility =
  | "company"
  | "project_team"
  | "owner_only"
  | "owner_partner"
  | "selected_roles"
  | "selected_people";

export interface DocumentAccessContext {
  organizationId: string;
  memberId: string;
  isOwner: boolean;
}

export type DocumentAccessMode = "read" | "download" | "edit";

type PolicyRow = {
  id: string;
  project_id: string | null;
  visibility: DocumentVisibility;
  can_download: boolean;
  can_edit: boolean;
  is_locked: boolean;
  category_visibility: "company" | "owner_only" | null;
};

/**
 * The policy is deliberately evaluated in the database's tenant transaction.
 * A document id alone is never enough to reveal a private file.
 */
export async function assertDocumentPolicy(
  client: PoolClient,
  context: DocumentAccessContext,
  documentId: string,
  mode: DocumentAccessMode,
): Promise<{ visibility: DocumentVisibility; requiresTargetAccess: boolean }> {
  const policy = await client.query<PolicyRow>(
    `SELECT d.id, d.project_id, d.visibility, d.can_download, d.can_edit, d.is_locked,
            c.visibility AS category_visibility
       FROM management_document_links d
       LEFT JOIN management_document_categories c
         ON c.organization_id = d.organization_id AND c.id = d.document_category_id
      WHERE d.organization_id = $1 AND d.id = $2`,
    [context.organizationId, documentId],
  );
  const document = policy.rows[0];
  if (!document) throw new NotFoundError("Document not found");

  // Owners retain recovery/control access even when a document has been
  // locked. This avoids a private document becoming impossible to manage.
  if (context.isOwner)
    return {
      visibility: document.visibility,
      requiresTargetAccess: document.visibility === "company",
    };

  if (document.category_visibility === "owner_only")
    throw new NotFoundError("Document not found");

  if (mode === "download" && !document.can_download)
    throw new NotFoundError("Document not found");
  if (mode === "edit" && (!document.can_edit || document.is_locked))
    throw new ForbiddenError("This document is locked for editing");

  if (document.visibility === "company") {
    // Company-visible files still require the normal record/module permission.
    return { visibility: document.visibility, requiresTargetAccess: true };
  }
  if (document.visibility === "owner_only")
    throw new NotFoundError("Document not found");

  if (document.visibility === "project_team") {
    const membership = await client.query(
      `SELECT 1
         FROM management_project_members
        WHERE organization_id = $1
          AND project_id = $2
          AND member_id = $3
          AND assignment_start_date <= current_date
          AND COALESCE(assignment_end_date, 'infinity'::date) >= current_date
        LIMIT 1`,
      [context.organizationId, document.project_id, context.memberId],
    );
    if (membership.rowCount)
      return { visibility: document.visibility, requiresTargetAccess: false };
    throw new NotFoundError("Document not found");
  }

  if (document.visibility === "owner_partner") {
    const partner = await client.query(
      `SELECT 1
         FROM member_roles mr
         JOIN roles r
           ON r.organization_id = mr.organization_id AND r.id = mr.role_id
        WHERE mr.organization_id = $1
          AND mr.member_id = $2
          AND r.code = 'partner'
        LIMIT 1`,
      [context.organizationId, context.memberId],
    );
    if (partner.rowCount)
      return { visibility: document.visibility, requiresTargetAccess: false };
    throw new NotFoundError("Document not found");
  }

  if (document.visibility === "selected_roles") {
    const role = await client.query(
      `SELECT 1
         FROM management_document_role_access access
         JOIN member_roles mr
           ON mr.organization_id = access.organization_id
          AND mr.role_id = access.role_id
        WHERE access.organization_id = $1
          AND access.document_id = $2
          AND mr.member_id = $3
        LIMIT 1`,
      [context.organizationId, documentId, context.memberId],
    );
    if (role.rowCount)
      return { visibility: document.visibility, requiresTargetAccess: false };
    throw new NotFoundError("Document not found");
  }

  const person = await client.query(
    `SELECT 1
       FROM management_document_member_access
      WHERE organization_id = $1 AND document_id = $2 AND member_id = $3
      LIMIT 1`,
    [context.organizationId, documentId, context.memberId],
  );
  if (person.rowCount)
    return { visibility: document.visibility, requiresTargetAccess: false };
  throw new NotFoundError("Document not found");
}

export async function visibleDocumentIds(
  client: PoolClient,
  context: DocumentAccessContext,
  documentIds: string[],
): Promise<Set<string>> {
  const visible = new Set<string>();
  for (const documentId of documentIds) {
    try {
      await assertDocumentPolicy(client, context, documentId, "read");
      visible.add(documentId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  return visible;
}
