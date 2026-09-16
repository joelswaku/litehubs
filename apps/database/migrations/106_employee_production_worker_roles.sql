-- 106_employee_production_worker_roles.sql
-- Production access is chosen explicitly for each employee. The Employee role
-- keeps the personal workspace; each production worker role permits only safe
-- assigned-site field work in one production line.

-- Undo the temporary poultry field grants that were added to the general
-- Employee role in migration 105. Existing employees keep their personal
-- Employee role and receive a production role only when an owner selects it.
WITH poultry_permissions(code) AS (
  VALUES
    ('poultry.houses.read'), ('poultry.flocks.read'),
    ('poultry.daily_records.read'), ('poultry.daily_records.create'), ('poultry.daily_records.update'),
    ('poultry.mortality.read'), ('poultry.mortality.create'), ('poultry.mortality.update'),
    ('poultry.feed.read'), ('poultry.feed.create'), ('poultry.feed.update'),
    ('poultry.water.read'), ('poultry.water.create'), ('poultry.water.update'),
    ('poultry.weights.read'), ('poultry.weights.create'), ('poultry.weights.update'),
    ('poultry.eggs.read'), ('poultry.eggs.create'), ('poultry.eggs.update'),
    ('poultry.health.read'), ('poultry.health.create'),
    ('poultry.sanitation.read'), ('poultry.sanitation.create'), ('poultry.sanitation.update'),
    ('poultry.biosecurity.read'), ('poultry.biosecurity.create'), ('poultry.biosecurity.update'),
    ('poultry.losses.read'), ('poultry.losses.create'), ('poultry.losses.update')
)
DELETE FROM role_preset_permissions rpp
 USING poultry_permissions wanted
 WHERE rpp.role_preset_code = 'employee'
   AND rpp.permission_code = wanted.code;

WITH poultry_permissions(code) AS (
  VALUES
    ('poultry.houses.read'), ('poultry.flocks.read'),
    ('poultry.daily_records.read'), ('poultry.daily_records.create'), ('poultry.daily_records.update'),
    ('poultry.mortality.read'), ('poultry.mortality.create'), ('poultry.mortality.update'),
    ('poultry.feed.read'), ('poultry.feed.create'), ('poultry.feed.update'),
    ('poultry.water.read'), ('poultry.water.create'), ('poultry.water.update'),
    ('poultry.weights.read'), ('poultry.weights.create'), ('poultry.weights.update'),
    ('poultry.eggs.read'), ('poultry.eggs.create'), ('poultry.eggs.update'),
    ('poultry.health.read'), ('poultry.health.create'),
    ('poultry.sanitation.read'), ('poultry.sanitation.create'), ('poultry.sanitation.update'),
    ('poultry.biosecurity.read'), ('poultry.biosecurity.create'), ('poultry.biosecurity.update'),
    ('poultry.losses.read'), ('poultry.losses.create'), ('poultry.losses.update')
)
DELETE FROM role_permissions rp
 USING roles r, permissions p, poultry_permissions wanted
 WHERE rp.role_id = r.id
   AND rp.permission_id = p.id
   AND r.code = 'employee'
   AND p.code = wanted.code;

INSERT INTO role_presets
  (code, name, description, level, industry_code, is_owner_role, sort_order, data_scope)
VALUES
  ('poultry_worker', 'Poultry Worker',
   'Records assigned-site poultry checks and field data.', 85, 'mixed_farm', false, 112, 'self'),
  ('pig_worker', 'Pig Worker',
   'Records assigned-site pig checks and field data.', 85, 'mixed_farm', false, 113, 'self'),
  ('agriculture_worker', 'Agriculture Worker',
   'Records assigned-site crop and field work.', 85, 'mixed_farm', false, 114, 'self')
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      level = EXCLUDED.level,
      industry_code = EXCLUDED.industry_code,
      is_owner_role = EXCLUDED.is_owner_role,
      sort_order = EXCLUDED.sort_order,
      data_scope = EXCLUDED.data_scope;

-- Bring the three roles into every existing mixed-farm company. No member is
-- assigned automatically, so an owner deliberately chooses each worker role.
INSERT INTO roles
  (organization_id, code, name, description, level, data_scope, is_system)
SELECT o.id, rp.code, rp.name, rp.description, rp.level, rp.data_scope, true
  FROM organizations o
  JOIN role_presets rp ON rp.industry_code = o.industry_code
 WHERE rp.code IN ('poultry_worker', 'pig_worker', 'agriculture_worker')
ON CONFLICT (organization_id, code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      level = EXCLUDED.level,
      data_scope = EXCLUDED.data_scope,
      is_system = true;

-- Safe worker permissions: reference data for the assigned site, plus field
-- records they may create and update themselves. No setup, delete, finance,
-- vaccination, treatment, breeding, target or performance-model privileges.
WITH worker_permissions(role_code, permission_code) AS (
  VALUES
    ('poultry_worker', 'poultry.houses.read'),
    ('poultry_worker', 'poultry.flocks.read'),
    ('poultry_worker', 'poultry.daily_records.read'),
    ('poultry_worker', 'poultry.daily_records.create'),
    ('poultry_worker', 'poultry.daily_records.update'),
    ('poultry_worker', 'poultry.mortality.read'),
    ('poultry_worker', 'poultry.mortality.create'),
    ('poultry_worker', 'poultry.mortality.update'),
    ('poultry_worker', 'poultry.feed.read'),
    ('poultry_worker', 'poultry.feed.create'),
    ('poultry_worker', 'poultry.feed.update'),
    ('poultry_worker', 'poultry.water.read'),
    ('poultry_worker', 'poultry.water.create'),
    ('poultry_worker', 'poultry.water.update'),
    ('poultry_worker', 'poultry.weights.read'),
    ('poultry_worker', 'poultry.weights.create'),
    ('poultry_worker', 'poultry.weights.update'),
    ('poultry_worker', 'poultry.eggs.read'),
    ('poultry_worker', 'poultry.eggs.create'),
    ('poultry_worker', 'poultry.eggs.update'),
    ('poultry_worker', 'poultry.health.read'),
    ('poultry_worker', 'poultry.health.create'),
    ('poultry_worker', 'poultry.sanitation.read'),
    ('poultry_worker', 'poultry.sanitation.create'),
    ('poultry_worker', 'poultry.sanitation.update'),
    ('poultry_worker', 'poultry.biosecurity.read'),
    ('poultry_worker', 'poultry.biosecurity.create'),
    ('poultry_worker', 'poultry.biosecurity.update'),
    ('poultry_worker', 'poultry.losses.read'),
    ('poultry_worker', 'poultry.losses.create'),
    ('poultry_worker', 'poultry.losses.update'),

    ('pig_worker', 'pigs.pens.read'),
    ('pig_worker', 'pigs.groups.read'),
    ('pig_worker', 'pigs.animals.read'),
    ('pig_worker', 'pigs.daily_records.read'),
    ('pig_worker', 'pigs.daily_records.create'),
    ('pig_worker', 'pigs.daily_records.update'),
    ('pig_worker', 'pigs.feed.read'),
    ('pig_worker', 'pigs.feed.create'),
    ('pig_worker', 'pigs.feed.update'),
    ('pig_worker', 'pigs.water.read'),
    ('pig_worker', 'pigs.water.create'),
    ('pig_worker', 'pigs.water.update'),
    ('pig_worker', 'pigs.weights.read'),
    ('pig_worker', 'pigs.weights.create'),
    ('pig_worker', 'pigs.weights.update'),
    ('pig_worker', 'pigs.mortality.read'),
    ('pig_worker', 'pigs.mortality.create'),
    ('pig_worker', 'pigs.mortality.update'),
    ('pig_worker', 'pigs.health.read'),
    ('pig_worker', 'pigs.health.create'),
    ('pig_worker', 'pigs.losses.read'),
    ('pig_worker', 'pigs.losses.create'),
    ('pig_worker', 'pigs.losses.update'),

    ('agriculture_worker', 'agriculture.farms.read'),
    ('agriculture_worker', 'agriculture.fields.read'),
    ('agriculture_worker', 'agriculture.plots.read'),
    ('agriculture_worker', 'agriculture.crops.read'),
    ('agriculture_worker', 'agriculture.seasons.read'),
    ('agriculture_worker', 'agriculture.plantings.read'),
    ('agriculture_worker', 'agriculture.operations.read'),
    ('agriculture_worker', 'agriculture.operations.create'),
    ('agriculture_worker', 'agriculture.operations.update'),
    ('agriculture_worker', 'agriculture.irrigation.read'),
    ('agriculture_worker', 'agriculture.irrigation.create'),
    ('agriculture_worker', 'agriculture.irrigation.update'),
    ('agriculture_worker', 'agriculture.scouting.read'),
    ('agriculture_worker', 'agriculture.scouting.create'),
    ('agriculture_worker', 'agriculture.scouting.update'),
    ('agriculture_worker', 'agriculture.weather.read'),
    ('agriculture_worker', 'agriculture.weather.create'),
    ('agriculture_worker', 'agriculture.weather.update'),
    ('agriculture_worker', 'agriculture.harvest.read'),
    ('agriculture_worker', 'agriculture.harvest.create'),
    ('agriculture_worker', 'agriculture.harvest.update'),
    ('agriculture_worker', 'agriculture.losses.read'),
    ('agriculture_worker', 'agriculture.losses.create'),
    ('agriculture_worker', 'agriculture.losses.update')
)
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT wanted.role_code, p.code
  FROM worker_permissions wanted
  JOIN permissions p ON p.code = wanted.permission_code
ON CONFLICT DO NOTHING;

WITH worker_permissions(role_code, permission_code) AS (
  VALUES
    ('poultry_worker', 'poultry.houses.read'), ('poultry_worker', 'poultry.flocks.read'),
    ('poultry_worker', 'poultry.daily_records.read'), ('poultry_worker', 'poultry.daily_records.create'), ('poultry_worker', 'poultry.daily_records.update'),
    ('poultry_worker', 'poultry.mortality.read'), ('poultry_worker', 'poultry.mortality.create'), ('poultry_worker', 'poultry.mortality.update'),
    ('poultry_worker', 'poultry.feed.read'), ('poultry_worker', 'poultry.feed.create'), ('poultry_worker', 'poultry.feed.update'),
    ('poultry_worker', 'poultry.water.read'), ('poultry_worker', 'poultry.water.create'), ('poultry_worker', 'poultry.water.update'),
    ('poultry_worker', 'poultry.weights.read'), ('poultry_worker', 'poultry.weights.create'), ('poultry_worker', 'poultry.weights.update'),
    ('poultry_worker', 'poultry.eggs.read'), ('poultry_worker', 'poultry.eggs.create'), ('poultry_worker', 'poultry.eggs.update'),
    ('poultry_worker', 'poultry.health.read'), ('poultry_worker', 'poultry.health.create'),
    ('poultry_worker', 'poultry.sanitation.read'), ('poultry_worker', 'poultry.sanitation.create'), ('poultry_worker', 'poultry.sanitation.update'),
    ('poultry_worker', 'poultry.biosecurity.read'), ('poultry_worker', 'poultry.biosecurity.create'), ('poultry_worker', 'poultry.biosecurity.update'),
    ('poultry_worker', 'poultry.losses.read'), ('poultry_worker', 'poultry.losses.create'), ('poultry_worker', 'poultry.losses.update'),
    ('pig_worker', 'pigs.pens.read'), ('pig_worker', 'pigs.groups.read'), ('pig_worker', 'pigs.animals.read'),
    ('pig_worker', 'pigs.daily_records.read'), ('pig_worker', 'pigs.daily_records.create'), ('pig_worker', 'pigs.daily_records.update'),
    ('pig_worker', 'pigs.feed.read'), ('pig_worker', 'pigs.feed.create'), ('pig_worker', 'pigs.feed.update'),
    ('pig_worker', 'pigs.water.read'), ('pig_worker', 'pigs.water.create'), ('pig_worker', 'pigs.water.update'),
    ('pig_worker', 'pigs.weights.read'), ('pig_worker', 'pigs.weights.create'), ('pig_worker', 'pigs.weights.update'),
    ('pig_worker', 'pigs.mortality.read'), ('pig_worker', 'pigs.mortality.create'), ('pig_worker', 'pigs.mortality.update'),
    ('pig_worker', 'pigs.health.read'), ('pig_worker', 'pigs.health.create'),
    ('pig_worker', 'pigs.losses.read'), ('pig_worker', 'pigs.losses.create'), ('pig_worker', 'pigs.losses.update'),
    ('agriculture_worker', 'agriculture.farms.read'), ('agriculture_worker', 'agriculture.fields.read'), ('agriculture_worker', 'agriculture.plots.read'),
    ('agriculture_worker', 'agriculture.crops.read'), ('agriculture_worker', 'agriculture.seasons.read'), ('agriculture_worker', 'agriculture.plantings.read'),
    ('agriculture_worker', 'agriculture.operations.read'), ('agriculture_worker', 'agriculture.operations.create'), ('agriculture_worker', 'agriculture.operations.update'),
    ('agriculture_worker', 'agriculture.irrigation.read'), ('agriculture_worker', 'agriculture.irrigation.create'), ('agriculture_worker', 'agriculture.irrigation.update'),
    ('agriculture_worker', 'agriculture.scouting.read'), ('agriculture_worker', 'agriculture.scouting.create'), ('agriculture_worker', 'agriculture.scouting.update'),
    ('agriculture_worker', 'agriculture.weather.read'), ('agriculture_worker', 'agriculture.weather.create'), ('agriculture_worker', 'agriculture.weather.update'),
    ('agriculture_worker', 'agriculture.harvest.read'), ('agriculture_worker', 'agriculture.harvest.create'), ('agriculture_worker', 'agriculture.harvest.update'),
    ('agriculture_worker', 'agriculture.losses.read'), ('agriculture_worker', 'agriculture.losses.create'), ('agriculture_worker', 'agriculture.losses.update')
)
INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
  FROM roles r
  JOIN worker_permissions wanted ON wanted.role_code = r.code
  JOIN permissions p ON p.code = wanted.permission_code
 WHERE r.code IN ('poultry_worker', 'pig_worker', 'agriculture_worker')
ON CONFLICT DO NOTHING;