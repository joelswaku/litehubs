-- 105_employee_poultry_field_work.sql
-- Field employees need the Poultry permissions required to perform their own
-- assigned-site work. They never receive flock/house configuration, deletion,
-- production targets, performance models, vaccinations or treatments.
--
-- The API additionally enforces the employee's active site and, for records,
-- their own recorded_by_user_id. These grants are therefore operational rather
-- than managerial and remain safe for the Employee role's self scope.

WITH employee_poultry_permissions(code) AS (
  VALUES
    ('poultry.houses.read'),
    ('poultry.flocks.read'),
    ('poultry.daily_records.read'),
    ('poultry.daily_records.create'),
    ('poultry.daily_records.update'),
    ('poultry.mortality.read'),
    ('poultry.mortality.create'),
    ('poultry.mortality.update'),
    ('poultry.feed.read'),
    ('poultry.feed.create'),
    ('poultry.feed.update'),
    ('poultry.water.read'),
    ('poultry.water.create'),
    ('poultry.water.update'),
    ('poultry.weights.read'),
    ('poultry.weights.create'),
    ('poultry.weights.update'),
    ('poultry.eggs.read'),
    ('poultry.eggs.create'),
    ('poultry.eggs.update'),
    ('poultry.health.read'),
    ('poultry.health.create'),
    ('poultry.sanitation.read'),
    ('poultry.sanitation.create'),
    ('poultry.sanitation.update'),
    ('poultry.biosecurity.read'),
    ('poultry.biosecurity.create'),
    ('poultry.biosecurity.update'),
    ('poultry.losses.read'),
    ('poultry.losses.create'),
    ('poultry.losses.update')
)
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'employee', p.code
  FROM permissions p
  JOIN employee_poultry_permissions wanted ON wanted.code = p.code
ON CONFLICT DO NOTHING;

-- Existing organizations have their own copy of the Employee system role.
-- Grant the same field-work permissions immediately without changing any other
-- role or a tenant's scope settings.
WITH employee_poultry_permissions(code) AS (
  VALUES
    ('poultry.houses.read'),
    ('poultry.flocks.read'),
    ('poultry.daily_records.read'),
    ('poultry.daily_records.create'),
    ('poultry.daily_records.update'),
    ('poultry.mortality.read'),
    ('poultry.mortality.create'),
    ('poultry.mortality.update'),
    ('poultry.feed.read'),
    ('poultry.feed.create'),
    ('poultry.feed.update'),
    ('poultry.water.read'),
    ('poultry.water.create'),
    ('poultry.water.update'),
    ('poultry.weights.read'),
    ('poultry.weights.create'),
    ('poultry.weights.update'),
    ('poultry.eggs.read'),
    ('poultry.eggs.create'),
    ('poultry.eggs.update'),
    ('poultry.health.read'),
    ('poultry.health.create'),
    ('poultry.sanitation.read'),
    ('poultry.sanitation.create'),
    ('poultry.sanitation.update'),
    ('poultry.biosecurity.read'),
    ('poultry.biosecurity.create'),
    ('poultry.biosecurity.update'),
    ('poultry.losses.read'),
    ('poultry.losses.create'),
    ('poultry.losses.update')
)
INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
  FROM roles r
  JOIN permissions p ON TRUE
  JOIN employee_poultry_permissions wanted ON wanted.code = p.code
 WHERE r.code = 'employee'
ON CONFLICT DO NOTHING;