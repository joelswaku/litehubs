-- 140_feed_mill_and_fleet_access_roles.sql
--
-- Introduces two narrowly-scoped, organisation-wide operational roles.  They
-- are deliberately not broad inventory or vehicle roles: the owner can safely
-- delegate nutrition production or fleet controls without delegating buying,
-- finance, asset ownership or all stock changes.

-- ------------------------------------------------ permission catalogue ----

INSERT INTO permissions (code, resource, action, module_code, description)
SELECT resource || '.' || action,
       resource,
       action,
       split_part(resource, '.', 1),
       description
  FROM (
    VALUES
      ('inventory.nutrition', 'read',   'view feed recipes, nutrition profiles and manufacturing orders'),
      ('inventory.nutrition', 'create', 'create feed recipes, nutrition profiles and manufacturing orders'),
      ('inventory.nutrition', 'update', 'change feed recipes and confirm or cancel manufacturing orders'),
      ('inventory.nutrition', 'delete', 'delete draft nutrition records'),
      ('vehicles.fleet_control', 'read',   'view company fleet controls and daily records'),
      ('vehicles.fleet_control', 'create', 'create company fleet controls'),
      ('vehicles.fleet_control', 'update', 'manage company fleet controls and assignments'),
      ('vehicles.fleet_control', 'delete', 'delete draft company fleet controls')
  ) AS new_permissions(resource, action, description)
ON CONFLICT (code) DO NOTHING;

-- -------------------------------------------------------- role presets ----

INSERT INTO role_presets
  (code, name, description, level, industry_code, is_owner_role, sort_order, data_scope)
VALUES
  ('feed_mill_manager', 'Feed Mill Manager',
   'Controls feed recipes, manufacturing orders and nutrition planning.',
   45, 'mixed_farm', false, 55, 'organization'),
  ('fleet_controller', 'Fleet Controller',
   'Controls vehicle and engine safety, assignments and daily fleet records.',
   45, 'mixed_farm', false, 56, 'organization')
ON CONFLICT (code) DO UPDATE
  SET name          = EXCLUDED.name,
      description   = EXCLUDED.description,
      level         = EXCLUDED.level,
      industry_code = EXCLUDED.industry_code,
      is_owner_role = EXCLUDED.is_owner_role,
      sort_order    = EXCLUDED.sort_order,
      data_scope    = EXCLUDED.data_scope;

INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT role_grant.role_code, permission.code
  FROM (
    VALUES
      ('feed_mill_manager', 'inventory.nutrition.read'),
      ('feed_mill_manager', 'inventory.nutrition.create'),
      ('feed_mill_manager', 'inventory.nutrition.update'),
      ('feed_mill_manager', 'inventory.nutrition.delete'),
      ('feed_mill_manager', 'inventory.items.read'),
      ('feed_mill_manager', 'inventory.stock.read'),
      ('feed_mill_manager', 'inventory.warehouses.read'),
      ('feed_mill_manager', 'inventory.movements.read'),
      ('feed_mill_manager', 'projects.read'),
      ('feed_mill_manager', 'sites.read'),
      ('feed_mill_manager', 'reports.read'),
      ('fleet_controller', 'vehicles.fleet_control.read'),
      ('fleet_controller', 'vehicles.fleet_control.update'),
      ('fleet_controller', 'equipment.read'),
      ('fleet_controller', 'employees.read'),
      ('fleet_controller', 'sites.read'),
      ('fleet_controller', 'projects.read'),
      ('fleet_controller', 'maintenance.read'),
      ('fleet_controller', 'documents.read')
  ) AS role_grant(role_code, permission_code)
  JOIN permissions permission ON permission.code = role_grant.permission_code
ON CONFLICT DO NOTHING;

-- ------------------------------------------------ existing organisations --

INSERT INTO roles
  (organization_id, code, name, description, level, data_scope, is_system)
SELECT organization.id,
       preset.code,
       preset.name,
       preset.description,
       preset.level,
       preset.data_scope,
       true
  FROM organizations organization
  JOIN role_presets preset
    ON preset.industry_code IS NULL OR preset.industry_code = organization.industry_code
 WHERE preset.code IN ('feed_mill_manager', 'fleet_controller')
ON CONFLICT (organization_id, code) DO UPDATE
  SET name        = EXCLUDED.name,
      description = EXCLUDED.description,
      level       = EXCLUDED.level,
      data_scope  = EXCLUDED.data_scope,
      is_system   = true;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT role.organization_id, role.id, permission.id
  FROM roles role
  JOIN role_preset_permissions preset_grant
    ON preset_grant.role_preset_code = role.code
  JOIN permissions permission ON permission.code = preset_grant.permission_code
 WHERE role.code IN ('feed_mill_manager', 'fleet_controller')
ON CONFLICT DO NOTHING;

-- Owners retain all authority. General managers continue to operate the whole
-- company, including these two new functional areas, while normal inventory
-- and vehicle roles remain excluded until the owner assigns a dedicated role.
INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT role.organization_id, role.id, permission.id
  FROM roles role
  JOIN permissions permission
    ON permission.code IN (
      'inventory.nutrition.read', 'inventory.nutrition.create',
      'inventory.nutrition.update', 'inventory.nutrition.delete',
      'vehicles.fleet_control.read', 'vehicles.fleet_control.create',
      'vehicles.fleet_control.update', 'vehicles.fleet_control.delete'
    )
 WHERE role.code IN ('owner', 'general_manager')
ON CONFLICT DO NOTHING;
