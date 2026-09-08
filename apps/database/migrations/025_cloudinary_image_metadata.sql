-- Images can be linked to Owner Management, Poultry, Pig and Agriculture
-- records through the existing tenant-isolated document-link table.

ALTER TABLE management_document_links
  ADD COLUMN storage_provider text NOT NULL DEFAULT 'external',
  ADD COLUMN storage_public_id text,
  ADD COLUMN storage_url text,
  ADD COLUMN alt_text text,
  ADD COLUMN width integer,
  ADD COLUMN height integer;

ALTER TABLE management_document_links
  ADD CONSTRAINT management_document_links_provider_check
    CHECK (storage_provider IN ('external', 'cloudinary')),
  ADD CONSTRAINT management_document_links_dimensions_check
    CHECK ((width IS NULL OR width > 0) AND (height IS NULL OR height > 0)),
  ADD CONSTRAINT management_document_links_cloudinary_check
    CHECK (storage_provider <> 'cloudinary' OR (storage_public_id IS NOT NULL AND storage_url IS NOT NULL)),
  ADD CONSTRAINT management_document_links_alt_text_check
    CHECK (alt_text IS NULL OR btrim(alt_text) <> '');

CREATE INDEX management_document_links_entity_created_idx
  ON management_document_links (organization_id, entity_type, entity_id, created_at DESC);
