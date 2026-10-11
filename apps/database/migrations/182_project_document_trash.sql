BEGIN;

-- Project document trash.  Deleting a project document or photo moves it here
-- instead of erasing it: the stored file is kept, the original row (and its
-- access rules) are saved as JSON so it can be restored exactly, and it can be
-- deleted for good from the trash.
CREATE TABLE management_document_trash (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  document_id uuid NOT NULL,
  project_id uuid,
  entity_type text NOT NULL,
  entity_id uuid,
  title text,
  document_type text,
  document_category_id uuid,
  document_category_name text,
  mime_type text,
  file_size_bytes bigint,
  storage_provider text NOT NULL,
  storage_key text,
  storage_public_id text,
  record jsonb NOT NULL,
  role_ids uuid[] NOT NULL DEFAULT '{}',
  member_ids uuid[] NOT NULL DEFAULT '{}',
  uploaded_by_member_id uuid,
  uploaded_at timestamptz,
  deleted_by_member_id uuid,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_document_trash_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_document_trash_document_unique UNIQUE (organization_id, document_id)
);
CREATE INDEX management_document_trash_project_idx
  ON management_document_trash (organization_id, project_id, deleted_at DESC);
SELECT enable_tenant_rls('management_document_trash');

COMMIT;
