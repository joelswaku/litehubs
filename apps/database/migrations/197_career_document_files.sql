-- 197_career_document_files.sql
-- A requested document can now hold several files (ID front and back, several
-- certificates…). Until now each new upload replaced the previous one, so a
-- candidate sending three files ended up with only the last.

BEGIN;

CREATE TABLE career_application_document_files (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id       uuid NOT NULL,
  storage_path     text NOT NULL,
  file_name        text NOT NULL,
  mime_type        text NOT NULL,
  size_bytes       bigint NOT NULL DEFAULT 0,
  checksum_sha256  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT career_application_document_files_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT career_application_document_files_request_fk FOREIGN KEY (organization_id, request_id)
    REFERENCES career_application_document_requests(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX career_application_document_files_request_idx
  ON career_application_document_files(organization_id, request_id, created_at);
SELECT enable_tenant_rls('career_application_document_files');

-- Files already received become the first file of their request.
INSERT INTO career_application_document_files
  (organization_id, request_id, storage_path, file_name, mime_type, size_bytes, checksum_sha256, created_at)
SELECT organization_id, id, storage_path, COALESCE(file_name, 'document'),
       COALESCE(mime_type, 'application/octet-stream'), COALESCE(size_bytes, 0), checksum_sha256,
       COALESCE(submitted_at, updated_at)
  FROM career_application_document_requests
 WHERE storage_path IS NOT NULL;

COMMIT;
