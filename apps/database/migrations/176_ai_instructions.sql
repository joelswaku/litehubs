BEGIN;

-- Instructions written by management for the AI assistants: shared ones
-- (website chat and e-mail drafts) and e-mail-only ones.  Example:
-- "Nous ne recrutons pas pour le moment."
CREATE TABLE organization_ai_instructions (
  organization_id      uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  shared_text          text,
  mail_text            text,
  updated_by_member_id uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_ai_instructions_shared_length CHECK (length(coalesce(shared_text, '')) <= 8000),
  CONSTRAINT organization_ai_instructions_mail_length CHECK (length(coalesce(mail_text, '')) <= 8000)
);
SELECT enable_tenant_rls('organization_ai_instructions');

COMMIT;
