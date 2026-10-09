BEGIN;

-- Company mailboxes (for example Hostinger addresses) read and answered from
-- inside LiteHubs over standard IMAP / SMTP.  Messages stay on the mail
-- server; LiteHubs stores only the connection, an encrypted password and the
-- counters it needs for notifications.
CREATE TABLE organization_mailboxes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email_address       text NOT NULL,
  display_name        text,
  imap_host           text NOT NULL DEFAULT 'imap.hostinger.com',
  imap_port           integer NOT NULL DEFAULT 993,
  imap_secure         boolean NOT NULL DEFAULT true,
  smtp_host           text NOT NULL DEFAULT 'smtp.hostinger.com',
  smtp_port           integer NOT NULL DEFAULT 465,
  smtp_secure         boolean NOT NULL DEFAULT true,
  username            text NOT NULL,
  password_encrypted  text NOT NULL,
  signature           text,
  status              text NOT NULL DEFAULT 'active',
  last_error          text,
  last_checked_at     timestamptz,
  unseen_count        integer NOT NULL DEFAULT 0,
  last_notified_uid   bigint NOT NULL DEFAULT 0,
  inbox_uid_validity  bigint,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_mailboxes_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT organization_mailboxes_status_check CHECK (status IN ('active', 'error', 'disabled')),
  CONSTRAINT organization_mailboxes_email_check CHECK (email_address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT organization_mailboxes_ports_check CHECK (imap_port BETWEEN 1 AND 65535 AND smtp_port BETWEEN 1 AND 65535)
);
CREATE UNIQUE INDEX organization_mailboxes_email_unique
  ON organization_mailboxes(organization_id, lower(email_address));
CREATE TRIGGER organization_mailboxes_set_updated_at
  BEFORE UPDATE ON organization_mailboxes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT enable_tenant_rls('organization_mailboxes');

-- Who may open a mailbox.  Members with mail.manage see every mailbox.
CREATE TABLE organization_mailbox_members (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mailbox_id       uuid NOT NULL,
  member_id        uuid NOT NULL,
  can_send         boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, mailbox_id, member_id),
  CONSTRAINT organization_mailbox_members_mailbox_fk
    FOREIGN KEY (organization_id, mailbox_id)
    REFERENCES organization_mailboxes(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT organization_mailbox_members_member_fk
    FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE CASCADE
);
SELECT enable_tenant_rls('organization_mailbox_members');

-- AI reply drafts are counted per user and day, like other AI features.
CREATE TABLE mail_ai_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mailbox_id       uuid,
  action           text NOT NULL DEFAULT 'reply_draft',
  model            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mail_ai_requests_action_check CHECK (action IN ('reply_draft', 'compose_draft', 'improve_draft'))
);
CREATE INDEX mail_ai_requests_user_day_idx ON mail_ai_requests(organization_id, user_id, created_at DESC);
SELECT enable_tenant_rls('mail_ai_requests');

-- One row per AI reply draft, for the per-user daily limit (AI_DAILY_REQUEST_LIMIT).
CREATE TABLE mail_ai_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mailbox_id       uuid,
  action           text NOT NULL DEFAULT 'reply_draft',
  model            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mail_ai_requests_user_day_idx ON mail_ai_requests(organization_id, user_id, created_at DESC);
SELECT enable_tenant_rls('mail_ai_requests');

INSERT INTO permissions(code, resource, action, module_code, description)
VALUES
  ('mail.read', 'mail', 'read', 'mail', 'Read company mailboxes assigned to the member'),
  ('mail.send', 'mail', 'send', 'mail', 'Reply to and send e-mails from assigned company mailboxes'),
  ('mail.manage', 'mail', 'manage', 'mail', 'Connect company mailboxes and choose who can use them')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_preset_permissions(role_preset_code, permission_code)
SELECT rp.code, p.code FROM role_presets rp CROSS JOIN permissions p
WHERE rp.code IN ('owner', 'general_manager') AND p.resource = 'mail'
ON CONFLICT DO NOTHING;
INSERT INTO role_preset_permissions(role_preset_code, permission_code)
SELECT rp.code, p.code FROM role_presets rp CROSS JOIN permissions p
WHERE rp.code IN ('hr_officer') AND p.resource = 'mail' AND p.action IN ('read', 'send')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('owner', 'general_manager') AND p.resource = 'mail'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('hr_officer') AND p.resource = 'mail' AND p.action IN ('read', 'send')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE organization_mailboxes IS
  'Company mailboxes connected over IMAP/SMTP. Passwords are AES-256-GCM encrypted by the API; messages are never copied into LiteHubs.';

COMMIT;
