-- 055_document_category_visibility.sql
-- Folder-level privacy: documents in an owner-only category remain inaccessible
-- to non-owners even if a direct file URL is guessed.

BEGIN;

ALTER TABLE management_document_categories
  ADD COLUMN visibility text NOT NULL DEFAULT 'company',
  ADD CONSTRAINT management_document_categories_visibility_check
    CHECK (visibility IN ('company', 'owner_only'));

CREATE INDEX management_document_categories_visibility_idx
  ON management_document_categories (organization_id, visibility, is_active, sort_order, name);

COMMENT ON COLUMN management_document_categories.visibility IS
  'Category-wide document access. owner_only is enforced by preview, download, list and task document APIs.';

COMMIT;