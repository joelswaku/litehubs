-- 108_restrict_poultry_setup_to_managers.sql
-- Houses, flock lifecycle and company performance standards are management
-- configuration. Supervisors retain operational records and read-only flock
-- context, but cannot change this foundation.

WITH setup_permissions(code) AS (
  VALUES
    ('poultry.houses.create'),
    ('poultry.houses.update'),
    ('poultry.houses.delete'),
    ('poultry.flocks.create'),
    ('poultry.flocks.update'),
    ('poultry.flocks.delete'),
    ('poultry.production_targets.create'),
    ('poultry.production_targets.update'),
    ('poultry.production_targets.delete'),
    ('poultry.performance_models.read'),
    ('poultry.performance_models.create'),
    ('poultry.performance_models.update'),
    ('poultry.performance_models.delete'),
    ('poultry.climate_profiles.read'),
    ('poultry.climate_profiles.create'),
    ('poultry.climate_profiles.update'),
    ('poultry.climate_profiles.delete')
)
DELETE FROM role_preset_permissions rpp
 USING setup_permissions wanted
 WHERE rpp.role_preset_code IN ('employee', 'supervisor', 'poultry_supervisor')
   AND rpp.permission_code = wanted.code;

WITH setup_permissions(code) AS (
  VALUES
    ('poultry.houses.create'),
    ('poultry.houses.update'),
    ('poultry.houses.delete'),
    ('poultry.flocks.create'),
    ('poultry.flocks.update'),
    ('poultry.flocks.delete'),
    ('poultry.production_targets.create'),
    ('poultry.production_targets.update'),
    ('poultry.production_targets.delete'),
    ('poultry.performance_models.read'),
    ('poultry.performance_models.create'),
    ('poultry.performance_models.update'),
    ('poultry.performance_models.delete'),
    ('poultry.climate_profiles.read'),
    ('poultry.climate_profiles.create'),
    ('poultry.climate_profiles.update'),
    ('poultry.climate_profiles.delete')
)
DELETE FROM role_permissions rp
 USING roles r, permissions p, setup_permissions wanted
 WHERE rp.role_id = r.id
   AND rp.permission_id = p.id
   AND r.code IN ('employee', 'supervisor', 'poultry_supervisor')
   AND p.code = wanted.code;