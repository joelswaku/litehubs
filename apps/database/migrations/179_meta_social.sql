BEGIN;

-- Facebook Page + Instagram professional account connected through Meta.
-- Page access tokens are encrypted by the API (never stored in clear).
CREATE TABLE social_accounts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  page_id              text NOT NULL,
  page_name            text NOT NULL,
  page_token_enc       text NOT NULL,
  ig_user_id           text,
  ig_username          text,
  status               text NOT NULL DEFAULT 'active',
  last_error           text,
  connected_by_member_id uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_accounts_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT social_accounts_page_unique UNIQUE (page_id),
  CONSTRAINT social_accounts_status_check CHECK (status IN ('active', 'paused', 'error'))
);
CREATE UNIQUE INDEX social_accounts_ig_unique ON social_accounts(ig_user_id) WHERE ig_user_id IS NOT NULL;
SELECT enable_tenant_rls('social_accounts');

-- Messenger and Instagram conversations live with the website chat, so the
-- AI assistant and the customer service tab handle every channel.
ALTER TABLE website_chat_sessions
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'website',
  ADD COLUMN IF NOT EXISTS social_account_id uuid,
  ADD COLUMN IF NOT EXISTS external_user_id text,
  ADD COLUMN IF NOT EXISTS last_visitor_message_at timestamptz;
ALTER TABLE website_chat_sessions
  ADD CONSTRAINT website_chat_sessions_channel_check CHECK (channel IN ('website', 'facebook', 'instagram')),
  ADD CONSTRAINT website_chat_sessions_social_fk
    FOREIGN KEY (organization_id, social_account_id)
    REFERENCES social_accounts(organization_id, id) ON DELETE CASCADE;
CREATE UNIQUE INDEX website_chat_sessions_social_user_unique
  ON website_chat_sessions(organization_id, social_account_id, channel, external_user_id)
  WHERE external_user_id IS NOT NULL;

ALTER TABLE website_chat_messages
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS delivery_error text;
CREATE UNIQUE INDEX website_chat_messages_external_unique
  ON website_chat_messages(organization_id, external_id) WHERE external_id IS NOT NULL;

-- Comments on Facebook and Instagram posts.
CREATE TABLE social_comments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  social_account_id  uuid NOT NULL,
  platform           text NOT NULL,
  external_id        text NOT NULL,
  post_id            text,
  parent_external_id text,
  author_id          text,
  author_name        text,
  body               text NOT NULL DEFAULT '',
  permalink          text,
  reply_body         text,
  replied_at         timestamptz,
  replied_by_member_id uuid,
  reply_error        text,
  done               boolean NOT NULL DEFAULT false,
  received_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_comments_platform_check CHECK (platform IN ('facebook', 'instagram')),
  CONSTRAINT social_comments_account_fk
    FOREIGN KEY (organization_id, social_account_id)
    REFERENCES social_accounts(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT social_comments_external_unique UNIQUE (organization_id, platform, external_id)
);
CREATE INDEX social_comments_recent_idx ON social_comments(organization_id, done, received_at DESC);
SELECT enable_tenant_rls('social_comments');

-- Posts written in LiteHubs and published (now or later) to Facebook and/or Instagram.
CREATE TABLE social_posts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  social_account_id  uuid NOT NULL,
  to_facebook        boolean NOT NULL DEFAULT true,
  to_instagram       boolean NOT NULL DEFAULT false,
  message            text NOT NULL DEFAULT '',
  image_url          text,
  link_url           text,
  status             text NOT NULL DEFAULT 'scheduled',
  scheduled_at       timestamptz NOT NULL DEFAULT now(),
  published_at       timestamptz,
  facebook_post_id   text,
  instagram_media_id text,
  error              text,
  created_by_member_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_posts_status_check CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'partial', 'failed')),
  CONSTRAINT social_posts_target_check CHECK (to_facebook OR to_instagram),
  CONSTRAINT social_posts_account_fk
    FOREIGN KEY (organization_id, social_account_id)
    REFERENCES social_accounts(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX social_posts_due_idx ON social_posts(organization_id, status, scheduled_at);
SELECT enable_tenant_rls('social_posts');

-- Webhooks arrive without a workspace: find it from the Page / Instagram id.
CREATE OR REPLACE FUNCTION public_social_account_lookup(requested_external_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'id', a.id,
    'organizationId', a.organization_id,
    'organizationSlug', o.slug,
    'organizationName', o.display_name,
    'pageId', a.page_id,
    'igUserId', a.ig_user_id
  )
  FROM social_accounts a
  JOIN organizations o ON o.id = a.organization_id
  WHERE (a.page_id = requested_external_id OR a.ig_user_id = requested_external_id)
    AND a.status <> 'paused'
    AND o.status = 'active'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public_social_account_lookup(text) FROM PUBLIC;

-- Social media: a role the owner can give (role library).
INSERT INTO permissions(code, resource, action, module_code, description)
VALUES
  ('social.manage', 'social', 'manage', 'social', 'Publish posts and answer comments on Facebook and Instagram')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_presets
  (code, name, description, level, industry_code, is_owner_role, sort_order, data_scope)
VALUES
  ('social_media_manager', 'Social media manager',
   'Publishes on Facebook and Instagram and answers comments. Cannot connect or disconnect accounts.',
   55, NULL, false, 107, 'organization')
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, level = EXCLUDED.level,
      industry_code = EXCLUDED.industry_code, is_owner_role = EXCLUDED.is_owner_role,
      sort_order = EXCLUDED.sort_order, data_scope = EXCLUDED.data_scope;

INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT rp.code, p.code FROM role_presets rp CROSS JOIN permissions p
 WHERE rp.code IN ('social_media_manager', 'owner') AND p.resource = 'social'
ON CONFLICT DO NOTHING;

INSERT INTO roles (organization_id, code, name, description, level, data_scope, is_system)
SELECT o.id, rp.code, rp.name, rp.description, rp.level, rp.data_scope, true
  FROM organizations o JOIN role_presets rp ON rp.code = 'social_media_manager'
ON CONFLICT (organization_id, code) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, level = EXCLUDED.level,
      data_scope = EXCLUDED.data_scope, is_system = true;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id FROM roles r JOIN permissions p ON p.resource = 'social'
 WHERE r.code IN ('social_media_manager', 'owner')
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='litehubs_app') THEN
    GRANT EXECUTE ON FUNCTION public_social_account_lookup(text) TO litehubs_app;
  END IF;
END $$;

COMMIT;
