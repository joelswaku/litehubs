-- 004_memberships_roles.sql
-- Membership-scoped authorization.
--
-- The rule this migration exists to enforce: a role is held *within one
-- organization*. Being owner of Congo Omega must grant nothing anywhere else.
-- That is why there is no users -> roles link anywhere in this schema; the only
-- path is users -> organization_members -> member_roles -> roles.

-- ------------------------------------------------------------ membership ----
CREATE TABLE organization_members (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'active',
  -- Denormalised guard so the last owner cannot be removed or demoted.
  is_owner        boolean NOT NULL DEFAULT false,
  job_title       text,
  invited_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  -- A person joins a given organization once.
  CONSTRAINT organization_members_unique_per_org UNIQUE (organization_id, user_id),
  -- Target for the tenant-safe composite foreign keys below.
  CONSTRAINT organization_members_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT organization_members_status_check
    CHECK (status IN ('invited', 'active', 'suspended', 'removed'))
);

CREATE TRIGGER organization_members_set_updated_at
  BEFORE UPDATE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX organization_members_user_idx ON organization_members (user_id);
CREATE INDEX organization_members_active_idx
  ON organization_members (organization_id)
  WHERE status = 'active';

-- Custom policy rather than enable_tenant_rls: this table is read in two
-- different situations.
--   1. Before any organization context exists, to answer "which workspaces do
--      I belong to?" — matched by the user_id branch.
--   2. Inside a workspace, to list that organization's members — the
--      organization_id branch.
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members FORCE ROW LEVEL SECURITY;

CREATE POLICY membership_visibility ON organization_members
  USING (
    organization_id = current_organization_id()
    OR user_id = current_user_id()
  )
  WITH CHECK (organization_id = current_organization_id());

-- Now that membership exists, organizations can be made visible only to the
-- people who belong to them.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

CREATE POLICY organization_visibility ON organizations
  USING (
    id = current_organization_id()
    OR EXISTS (
      SELECT 1
        FROM organization_members m
       WHERE m.organization_id = organizations.id
         AND m.user_id = current_user_id()
         AND m.status = 'active'
    )
  );

-- --------------------------------------------------- permission catalogue ----
-- Platform-owned and shared by every tenant: the *set of things that can be
-- permitted*. Which of them a given role grants is per-organization, below.
CREATE TABLE permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  resource    text NOT NULL,
  action      text NOT NULL,
  -- Which module must be enabled for this permission to be usable.
  module_code text,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permissions_resource_action_unique UNIQUE (resource, action),
  CONSTRAINT permissions_code_matches_parts
    CHECK (code = resource || '.' || action),
  -- 'platform.' codes belong in platform_permissions.
  CONSTRAINT permissions_not_platform_namespace
    CHECK (code NOT LIKE 'platform.%')
);

CREATE INDEX permissions_resource_idx ON permissions (resource);
CREATE INDEX permissions_module_idx ON permissions (module_code);

-- --------------------------------------------------- per-organization roles ----
-- Each organization gets its own role rows, seeded from a template preset, so
-- one company can rename or re-scope "Supervisor" without touching another's.
CREATE TABLE roles (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  description     text,
  -- Lower number = more authority. Stops a manager editing an owner.
  level           integer NOT NULL DEFAULT 100,
  -- Seeded by provisioning; the API refuses to delete these.
  is_system       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  -- Composite, not global: two companies may both have an 'owner' role.
  CONSTRAINT roles_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT roles_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT roles_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT roles_level_range CHECK (level BETWEEN 0 AND 1000)
);

CREATE TRIGGER roles_set_updated_at
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enable_tenant_rls('roles');

-- Which catalogue permissions a role grants.
CREATE TABLE role_permissions (
  organization_id uuid NOT NULL,
  role_id         uuid NOT NULL,
  permission_id   uuid NOT NULL
    REFERENCES permissions (id) ON DELETE CASCADE,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id),
  -- Tenant-safe: a plain role_id FK would let one organization attach its
  -- grants to another organization's role.
  CONSTRAINT role_permissions_role_fk
    FOREIGN KEY (organization_id, role_id)
    REFERENCES roles (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX role_permissions_permission_idx ON role_permissions (permission_id);
CREATE INDEX role_permissions_org_idx ON role_permissions (organization_id);

SELECT enable_tenant_rls('role_permissions');

-- ------------------------------------------------------- member <-> role ----
CREATE TABLE member_roles (
  organization_id uuid NOT NULL,
  member_id       uuid NOT NULL,
  role_id         uuid NOT NULL,
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  assigned_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  PRIMARY KEY (member_id, role_id),
  -- Both composite FKs carry organization_id, so a membership in org A can only
  -- ever be given a role belonging to org A.
  CONSTRAINT member_roles_member_fk
    FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT member_roles_role_fk
    FOREIGN KEY (organization_id, role_id)
    REFERENCES roles (organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX member_roles_role_idx ON member_roles (role_id);
CREATE INDEX member_roles_org_idx ON member_roles (organization_id);

SELECT enable_tenant_rls('member_roles');

COMMENT ON TABLE member_roles IS
  'Roles are held per membership. There is deliberately no user -> role link.';

-- ----------------------------------------------------------- invitations ----
-- How an organization adds its second person. The token is stored as an HMAC,
-- matching the refresh/reset token handling.
CREATE TABLE organization_invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  email           citext NOT NULL,
  token_hash      text NOT NULL UNIQUE,
  -- Roles to grant on acceptance. Validated against roles in this org.
  role_ids        uuid[] NOT NULL DEFAULT '{}',
  job_title       text,
  invited_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  expires_at      timestamptz NOT NULL,
  accepted_at     timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_invitations_email_shape
    CHECK (position('@' IN email) > 1)
);

-- One live invitation per email per organization; spent ones are kept.
CREATE UNIQUE INDEX organization_invitations_pending_idx
  ON organization_invitations (organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX organization_invitations_expires_idx
  ON organization_invitations (expires_at);

SELECT enable_tenant_rls('organization_invitations');
