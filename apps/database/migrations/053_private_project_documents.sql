-- 053_private_project_documents.sql
-- Confidential project files retain one document record while carrying an
-- explicit, tenant-safe visibility policy.

BEGIN;

ALTER TABLE management_document_links
  ADD COLUMN visibility text NOT NULL DEFAULT 'company',
  ADD COLUMN can_download boolean NOT NULL DEFAULT true,
  ADD COLUMN can_edit boolean NOT NULL DEFAULT true,
  ADD COLUMN is_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN locked_by_member_id uuid,
  ADD COLUMN locked_at timestamptz,
  ADD CONSTRAINT management_document_links_visibility_check
    CHECK (visibility IN (
      'company', 'project_team', 'owner_only', 'owner_partner',
      'selected_roles', 'selected_people'
    )),
  ADD CONSTRAINT management_document_links_lock_pair_check
    CHECK (
      (is_locked = false AND locked_by_member_id IS NULL AND locked_at IS NULL)
      OR (is_locked = true AND locked_by_member_id IS NOT NULL AND locked_at IS NOT NULL)
    ),
  ADD CONSTRAINT management_document_links_locked_by_member_fk
    FOREIGN KEY (organization_id, locked_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE RESTRICT;

CREATE TABLE management_document_role_access (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  document_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_document_role_access_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_document_role_access_unique UNIQUE (organization_id, document_id, role_id),
  CONSTRAINT management_document_role_access_document_fk
    FOREIGN KEY (organization_id, document_id)
    REFERENCES management_document_links (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_document_role_access_role_fk
    FOREIGN KEY (organization_id, role_id)
    REFERENCES roles (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX management_document_role_access_document_idx
  ON management_document_role_access (organization_id, document_id);
SELECT enable_tenant_rls('management_document_role_access');

CREATE TABLE management_document_member_access (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  document_id uuid NOT NULL,
  member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_document_member_access_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_document_member_access_unique UNIQUE (organization_id, document_id, member_id),
  CONSTRAINT management_document_member_access_document_fk
    FOREIGN KEY (organization_id, document_id)
    REFERENCES management_document_links (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_document_member_access_member_fk
    FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX management_document_member_access_document_idx
  ON management_document_member_access (organization_id, document_id);
SELECT enable_tenant_rls('management_document_member_access');

COMMENT ON COLUMN management_document_links.visibility IS
  'company, project_team, owner_only, owner_partner, selected_roles, or selected_people.';
COMMENT ON TABLE management_document_role_access IS
  'Explicit role grants for documents whose visibility is selected_roles.';
COMMENT ON TABLE management_document_member_access IS
  'Explicit member grants for documents whose visibility is selected_people.';

COMMIT;
