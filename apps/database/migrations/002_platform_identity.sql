-- 002_platform_identity.sql
-- The platform plane: who can sign in to LiteHubs, and who runs LiteHubs
-- itself. Nothing here is tenant-scoped.
--
-- A person is one row in `users` no matter how many organizations they belong
-- to, so sessions and password resets live at this level too. Organization
-- membership and organization roles are in 004.

-- ---------------------------------------------------------------- users ----
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 citext NOT NULL UNIQUE,
  password_hash         text NOT NULL,
  full_name             text NOT NULL,
  phone                 text,
  status                text NOT NULL DEFAULT 'active',
  must_change_password  boolean NOT NULL DEFAULT false,
  email_verified_at     timestamptz,
  last_login_at         timestamptz,
  -- Feeds the lockout check in the auth service.
  failed_login_attempts integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_status_check
    CHECK (status IN ('active', 'suspended', 'disabled')),
  CONSTRAINT users_email_shape CHECK (position('@' IN email) > 1),
  CONSTRAINT users_full_name_not_blank CHECK (btrim(full_name) <> ''),
  CONSTRAINT users_failed_attempts_non_negative
    CHECK (failed_login_attempts >= 0)
);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX users_status_idx ON users (status);

COMMENT ON TABLE users IS
  'Platform-level identity. Deliberately has no organization_id — see organization_members.';

-- ------------------------------------------------- platform authorization ----
-- Distinct from the organization plane. Being a LiteHubs platform admin does
-- NOT make you a member of any customer organization; reaching tenant data
-- requires an explicit, audited membership.
CREATE TABLE platform_permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  resource    text NOT NULL,
  action      text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_permissions_resource_action_unique
    UNIQUE (resource, action),
  CONSTRAINT platform_permissions_code_matches_parts
    CHECK (code = resource || '.' || action),
  CONSTRAINT platform_permissions_namespaced
    CHECK (code LIKE 'platform.%')
);

CREATE TABLE platform_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  -- Lower number = more authority.
  level       integer NOT NULL DEFAULT 100,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_roles_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT platform_roles_level_range CHECK (level BETWEEN 0 AND 1000)
);

CREATE TRIGGER platform_roles_set_updated_at
  BEFORE UPDATE ON platform_roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE platform_role_permissions (
  platform_role_id       uuid NOT NULL
    REFERENCES platform_roles (id) ON DELETE CASCADE,
  platform_permission_id uuid NOT NULL
    REFERENCES platform_permissions (id) ON DELETE CASCADE,
  granted_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform_role_id, platform_permission_id)
);

CREATE INDEX platform_role_permissions_permission_idx
  ON platform_role_permissions (platform_permission_id);

CREATE TABLE user_platform_roles (
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform_role_id uuid NOT NULL
    REFERENCES platform_roles (id) ON DELETE RESTRICT,
  assigned_at      timestamptz NOT NULL DEFAULT now(),
  assigned_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, platform_role_id)
);

CREATE INDEX user_platform_roles_role_idx
  ON user_platform_roles (platform_role_id);

-- ------------------------------------------------------------- sessions ----
-- Sessions belong to a person, not to an organization: switching workspace
-- must not require signing in again.
--
-- Opaque tokens stored only as an HMAC, so a database leak hands out no usable
-- refresh tokens, and rotation makes replay detectable.
CREATE TABLE refresh_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash     text NOT NULL UNIQUE,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  -- Set when rotated, so a replayed token can be traced.
  replaced_by_id uuid REFERENCES refresh_tokens (id) ON DELETE SET NULL,
  user_agent     text,
  ip_address     inet
);

CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_expires_at_idx ON refresh_tokens (expires_at);
CREATE INDEX refresh_tokens_active_idx ON refresh_tokens (user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE password_reset_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_address inet
);

CREATE INDEX password_reset_tokens_user_id_idx
  ON password_reset_tokens (user_id);
