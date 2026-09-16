-- 109_restore_readonly_poultry_setup.sql
-- Employees assigned Poultry Worker and operational supervisors can consult
-- company standards in the Setup tab. They still receive no configuration
-- create, update or delete rights (enforced by migration 108).

INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT rp.code, p.code
  FROM role_presets rp
  JOIN permissions p
    ON p.code IN (
      'poultry.performance_models.read',
      'poultry.climate_profiles.read'
    )
 WHERE rp.code IN ('poultry_worker', 'supervisor', 'poultry_supervisor')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
  FROM roles r
  JOIN permissions p
    ON p.code IN (
      'poultry.performance_models.read',
      'poultry.climate_profiles.read'
    )
 WHERE r.code IN ('poultry_worker', 'supervisor', 'poultry_supervisor')
ON CONFLICT DO NOTHING;