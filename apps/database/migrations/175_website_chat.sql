BEGIN;

-- Public chat on the company website: visitors ask questions, an AI assistant
-- answers from the published website and available offers, and the team can
-- take over from LiteHubs at any time.
CREATE TABLE website_chat_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash         text NOT NULL,
  visitor_name       text,
  visitor_email      text,
  visitor_phone      text,
  page_url           text,
  status             text NOT NULL DEFAULT 'open',
  mode               text NOT NULL DEFAULT 'ai',
  needs_human        boolean NOT NULL DEFAULT false,
  assigned_member_id uuid,
  ai_replies         integer NOT NULL DEFAULT 0,
  last_message_at    timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_chat_sessions_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT website_chat_sessions_token_unique UNIQUE (token_hash),
  CONSTRAINT website_chat_sessions_status_check CHECK (status IN ('open', 'closed')),
  CONSTRAINT website_chat_sessions_mode_check CHECK (mode IN ('ai', 'human')),
  CONSTRAINT website_chat_sessions_member_fk
    FOREIGN KEY (organization_id, assigned_member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE SET NULL
);
CREATE INDEX website_chat_sessions_recent_idx
  ON website_chat_sessions(organization_id, needs_human DESC, last_message_at DESC);
SELECT enable_tenant_rls('website_chat_sessions');

CREATE TABLE website_chat_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id       uuid NOT NULL,
  sender           text NOT NULL,
  member_id        uuid,
  body             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_chat_messages_session_fk
    FOREIGN KEY (organization_id, session_id)
    REFERENCES website_chat_sessions(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT website_chat_messages_sender_check CHECK (sender IN ('visitor', 'ai', 'staff', 'system')),
  CONSTRAINT website_chat_messages_body_check CHECK (btrim(body) <> '')
);
CREATE INDEX website_chat_messages_session_idx
  ON website_chat_messages(organization_id, session_id, created_at);
SELECT enable_tenant_rls('website_chat_messages');

ALTER TABLE chat_settings
  ADD COLUMN IF NOT EXISTS website_chat_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS website_ai_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS website_welcome text,
  ADD COLUMN IF NOT EXISTS website_knowledge text;

-- Public resolver: which active workspace a website chat belongs to.
CREATE OR REPLACE FUNCTION public_website_chat_target(requested_org_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'organizationId', o.id,
    'organizationSlug', o.slug,
    'organizationName', COALESCE(ws.display_name, o.display_name),
    'enabled', COALESCE(cs.website_chat_enabled, true),
    'aiEnabled', COALESCE(cs.website_ai_enabled, true),
    'welcome', cs.website_welcome
  )
  FROM organizations o
  LEFT JOIN organization_website_settings ws ON ws.organization_id=o.id
  LEFT JOIN chat_settings cs ON cs.organization_id=o.id
  WHERE o.slug=lower(btrim(requested_org_slug))
    AND o.status='active'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public_website_chat_target(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='litehubs_app') THEN
    GRANT EXECUTE ON FUNCTION public_website_chat_target(text) TO litehubs_app;
  END IF;
END $$;

COMMIT;
