-- Administrator-approved, site-scoped phrases for the public queue display.
CREATE TABLE appointment_queue_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_queue_message_templates_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT appointment_queue_message_templates_site_title_unique UNIQUE (organization_id, site_id, title),
  CONSTRAINT appointment_queue_message_templates_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES sites(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT appointment_queue_message_templates_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT appointment_queue_message_templates_content_not_blank CHECK (btrim(content) <> ''),
  CONSTRAINT appointment_queue_message_templates_content_length CHECK (char_length(content) <= 500)
);
CREATE INDEX appointment_queue_message_templates_site_active_idx
  ON appointment_queue_message_templates(organization_id, site_id, is_active, title);
CREATE TRIGGER appointment_queue_message_templates_set_updated_at
  BEFORE UPDATE ON appointment_queue_message_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT enable_tenant_rls('appointment_queue_message_templates');

-- Preserve the first message configured before the library was introduced.
INSERT INTO appointment_queue_message_templates(organization_id, site_id, title, content, created_by)
SELECT organization_id, site_id, 'Message principal', default_queue_call_message, created_by
FROM appointment_site_settings
WHERE default_queue_call_message IS NOT NULL AND btrim(default_queue_call_message) <> ''
ON CONFLICT (organization_id, site_id, title) DO NOTHING;