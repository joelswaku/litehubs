BEGIN;

-- Owner-controlled restrictions for the team chat.
CREATE TABLE IF NOT EXISTS chat_settings (
  organization_id  uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  allow_images     boolean NOT NULL DEFAULT true,
  allow_documents  boolean NOT NULL DEFAULT true,
  team_read_only   boolean NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
SELECT enable_tenant_rls('chat_settings');

-- Per member: read only (muted), blocked from the team room, no files.
ALTER TABLE chat_access
  ADD COLUMN IF NOT EXISTS muted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_files boolean NOT NULL DEFAULT false;

COMMIT;
