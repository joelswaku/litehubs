-- An optional, organization-private short video for an otherwise idle public queue screen.
-- The public TV endpoint streams only the video explicitly selected by the owner for this site.
ALTER TABLE appointment_site_settings
  ADD COLUMN IF NOT EXISTS idle_display_document_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointment_site_settings_idle_display_document_fk'
  ) THEN
    ALTER TABLE appointment_site_settings
      ADD CONSTRAINT appointment_site_settings_idle_display_document_fk
      FOREIGN KEY (organization_id, idle_display_document_id)
      REFERENCES documents(organization_id, id)
      ON DELETE SET NULL (idle_display_document_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS appointment_site_settings_idle_display_document_idx
  ON appointment_site_settings(organization_id, idle_display_document_id)
  WHERE idle_display_document_id IS NOT NULL;