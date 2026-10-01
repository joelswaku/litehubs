BEGIN;

-- Images selected for a public website deliberately live in their own media
-- library. They are not Documents, task evidence, HR files or operational
-- uploads, and never inherit their private permissions or retention rules.
CREATE TABLE organization_website_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  website_id uuid NOT NULL,
  title text NOT NULL CHECK (btrim(title) <> ''),
  original_name text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('cloudinary')),
  storage_key text NOT NULL,
  public_id text,
  public_url text NOT NULL CHECK (public_url ~ '^https://'),
  mime_type text NOT NULL CHECK (mime_type IN (
    'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'
  )),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  created_by_member_id uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_website_media_website_fk
    FOREIGN KEY (organization_id, website_id)
    REFERENCES organization_website_settings(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT organization_website_media_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT organization_website_media_storage_key_unique UNIQUE (storage_key)
);

CREATE INDEX organization_website_media_library_idx
  ON organization_website_media (organization_id, website_id, created_at DESC);

CREATE TRIGGER organization_website_media_set_updated_at
  BEFORE UPDATE ON organization_website_media
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT enable_tenant_rls('organization_website_media');

DROP TRIGGER IF EXISTS audit_business_change ON organization_website_media;
CREATE TRIGGER audit_business_change
  AFTER INSERT OR UPDATE OR DELETE ON organization_website_media
  FOR EACH ROW EXECUTE FUNCTION audit_business_change();

COMMIT;
