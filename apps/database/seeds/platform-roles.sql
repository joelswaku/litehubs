-- platform-roles.sql — LiteHubs staff roles. Idempotent.

INSERT INTO platform_roles (code, name, description, level, is_system) VALUES
  ('platform_super_admin', 'Platform Super Admin', 'Full control of LiteHubs itself',                 0,  true),
  ('platform_admin',       'Platform Admin',       'Manages organizations, templates and the catalogue', 10, true),
  ('platform_support',     'Platform Support',     'Read-only, plus audited impersonation',           30, true),
  ('platform_billing',     'Platform Billing',     'Subscriptions and plans only',                    40, true)
ON CONFLICT (code) DO UPDATE
  SET name        = EXCLUDED.name,
      description = EXCLUDED.description,
      level       = EXCLUDED.level,
      is_system   = EXCLUDED.is_system;

-- Super admin: everything.
INSERT INTO platform_role_permissions (platform_role_id, platform_permission_id)
SELECT r.id, p.id
  FROM platform_roles r CROSS JOIN platform_permissions p
 WHERE r.code = 'platform_super_admin'
ON CONFLICT DO NOTHING;

-- Admin: everything except billing and platform settings.
INSERT INTO platform_role_permissions (platform_role_id, platform_permission_id)
SELECT r.id, p.id
  FROM platform_roles r CROSS JOIN platform_permissions p
 WHERE r.code = 'platform_admin'
   AND p.resource NOT IN ('platform.subscriptions', 'platform.settings')
ON CONFLICT DO NOTHING;

-- Support: read anything, plus impersonation (which is audited).
INSERT INTO platform_role_permissions (platform_role_id, platform_permission_id)
SELECT r.id, p.id
  FROM platform_roles r CROSS JOIN platform_permissions p
 WHERE r.code = 'platform_support'
   AND (p.action = 'read' OR p.code = 'platform.organizations.impersonate')
ON CONFLICT DO NOTHING;

-- Billing: subscriptions, and enough context to know who they belong to.
INSERT INTO platform_role_permissions (platform_role_id, platform_permission_id)
SELECT r.id, p.id
  FROM platform_roles r CROSS JOIN platform_permissions p
 WHERE r.code = 'platform_billing'
   AND (p.resource = 'platform.subscriptions'
        OR (p.action = 'read' AND p.resource = 'platform.organizations'))
ON CONFLICT DO NOTHING;
