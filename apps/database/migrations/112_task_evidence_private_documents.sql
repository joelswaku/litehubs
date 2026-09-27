-- 112_task_evidence_private_documents.sql
-- Employees can attach a secure PDF evidence file to a task assigned to them.

ALTER TABLE management_document_links
  DROP CONSTRAINT IF EXISTS management_document_links_provider_check;

ALTER TABLE management_document_links
  ADD CONSTRAINT management_document_links_provider_check
    CHECK (storage_provider IN ('external', 'cloudinary', 'private_document'));
