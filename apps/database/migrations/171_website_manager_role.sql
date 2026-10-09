-- 171_website_manager_role.sql
-- Lets the owner hand the public website to any employee, like the reception
-- role does for appointments: assign "Website manager" in the role library.
-- The custom domain stays owner-only (enforced by the API).

INSERT INTO permissions(code, resource, action, module_code, description)
VALUES
  ('website.read', 'website', 'read', 'website', 'Open the website builder and preview pages'),
  ('website.edit', 'website', 'edit', 'website', 'Edit website pages, design, media and customer activities'),
  ('website.publish', 'website', 'publish', 'website', 'Publish or unpublish website pages, design and the site')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_presets
  (code, name, description, level, industry_code, is_owner_role, sort_order, data_scope)
VALUES
  ('website_manager', 'Website manager',
   'Edits and publishes the company public website. Cannot change the domain.',
   55, NULL, false, 106, 'organization')
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      level = EXCLUDED.level,
      industry_code = EXCLUDED.industry_code,
      is_owner_role = EXCLUDED.is_owner_role,
      sort_order = EXCLUDED.sort_order,
      data_scope = EXCLUDED.data_scope;

INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT rp.code, p.code
  FROM role_presets rp CROSS JOIN permissions p
 WHERE rp.code IN ('website_manager', 'owner')
   AND p.resource = 'website'
ON CONFLICT DO NOTHING;

INSERT INTO roles
  (organization_id, code, name, description, level, data_scope, is_system)
SELECT o.id, rp.code, rp.name, rp.description, rp.level, rp.data_scope, true
  FROM organizations o
  JOIN role_presets rp ON rp.code = 'website_manager'
ON CONFLICT (organization_id, code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      level = EXCLUDED.level,
      data_scope = EXCLUDED.data_scope,
      is_system = true;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
  FROM roles r
  JOIN permissions p ON p.resource = 'website'
 WHERE r.code IN ('website_manager', 'owner')
ON CONFLICT DO NOTHING;
