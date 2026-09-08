-- platform-permissions.sql — the LiteHubs staff plane. Idempotent.
--
-- These are NOT organization permissions. Holding platform.organizations.read
-- lets a LiteHubs operator see that an organization exists; it does not make
-- them a member of it, and does not grant access to its business records.

INSERT INTO platform_permissions (code, resource, action, description)
SELECT r.resource || '.' || a.action,
       r.resource,
       a.action,
       a.action || ' ' || replace(replace(r.resource, 'platform.', ''), '_', ' ')
FROM (VALUES
  ('platform.organizations'),
  ('platform.industries'),
  ('platform.modules'),
  ('platform.templates'),
  ('platform.role_presets'),
  ('platform.subscriptions'),
  ('platform.users')
) AS r (resource)
CROSS JOIN (VALUES ('read'), ('create'), ('update'), ('delete')) AS a (action)
ON CONFLICT (code) DO NOTHING;

-- Actions that only make sense on their own resource.
INSERT INTO platform_permissions (code, resource, action, description) VALUES
  ('platform.organizations.suspend', 'platform.organizations', 'suspend', 'suspend an organization'),
  ('platform.organizations.impersonate', 'platform.organizations', 'impersonate', 'enter an organization workspace for support'),
  ('platform.audit.read',            'platform.audit',          'read',    'read the platform audit trail'),
  ('platform.settings.read',         'platform.settings',       'read',    'read platform settings'),
  ('platform.settings.update',       'platform.settings',       'update',  'change platform settings')
ON CONFLICT (code) DO NOTHING;
