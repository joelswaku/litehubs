-- 081_platform_contact_requests.sql
-- Public messages to LiteHubs are platform data, never tenant data. They are
-- deliberately kept outside organization tables so a person can ask for help
-- before they have an account or a workspace.

CREATE TABLE platform_contact_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name           text NOT NULL,
  email               citext NOT NULL,
  phone               text,
  company_name        text,
  category            text NOT NULL DEFAULT 'general',
  subject             text NOT NULL,
  message             text NOT NULL,
  preferred_language  text NOT NULL DEFAULT 'fr',
  status              text NOT NULL DEFAULT 'new',
  admin_note          text,
  handled_by_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  handled_at          timestamptz,
  source_ip           inet,
  user_agent          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_contact_requests_name_not_blank
    CHECK (btrim(full_name) <> ''),
  CONSTRAINT platform_contact_requests_subject_not_blank
    CHECK (btrim(subject) <> ''),
  CONSTRAINT platform_contact_requests_message_not_blank
    CHECK (btrim(message) <> ''),
  CONSTRAINT platform_contact_requests_category_check
    CHECK (category IN ('general', 'access', 'technical', 'billing', 'demo', 'other')),
  CONSTRAINT platform_contact_requests_language_check
    CHECK (preferred_language IN ('fr', 'en')),
  CONSTRAINT platform_contact_requests_status_check
    CHECK (status IN ('new', 'in_progress', 'resolved', 'closed'))
);

CREATE TRIGGER platform_contact_requests_set_updated_at
  BEFORE UPDATE ON platform_contact_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX platform_contact_requests_status_created_idx
  ON platform_contact_requests (status, created_at DESC);
CREATE INDEX platform_contact_requests_email_idx
  ON platform_contact_requests (email, created_at DESC);

-- Platform permissions are seeded here as well as in the idempotent seed file,
-- because existing installations do not re-run the whole seed catalogue on a
-- deployment. Support may read and triage requests but cannot manage staff.
INSERT INTO platform_permissions (code, resource, action, description) VALUES
  ('platform.contact_requests.read', 'platform.contact_requests', 'read', 'read contact requests'),
  ('platform.contact_requests.update', 'platform.contact_requests', 'update', 'triage contact requests')
ON CONFLICT (code) DO NOTHING;

INSERT INTO platform_role_permissions (platform_role_id, platform_permission_id)
SELECT r.id, p.id
  FROM platform_roles r
  JOIN platform_permissions p
    ON p.code IN ('platform.contact_requests.read', 'platform.contact_requests.update')
 WHERE r.code IN ('platform_super_admin', 'platform_admin', 'platform_support')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE platform_contact_requests IS
  'Public LiteHubs contact requests. Platform staff only; no organization data is required or inferred.';
