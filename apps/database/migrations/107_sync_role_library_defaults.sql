-- 107_sync_role_library_defaults.sql
-- Keep built-in roles operational when a new permission is added to the role
-- library. This adds missing default grants only; it never removes a company
-- administrator's deliberate custom grants.

-- Reception staff must be able to see the queue, create a walk-in or a manual
-- appointment, create a service/desk, and progress a visitor through the
-- shared queue. Public channel configuration and TV call-message templates
-- remain owner-only because they publish company-wide public content.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'appointment_receptionist', p.code
  FROM permissions p
 WHERE p.code IN (
   'appointments.read',
   'appointments.create',
   'appointments.update'
 )
ON CONFLICT DO NOTHING;

-- Copy every missing current role-library grant into every built-in role of
-- every tenant. Existing company-specific grants remain untouched.
INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
  FROM roles r
  JOIN role_presets rp
    ON rp.code = r.code
  JOIN role_preset_permissions rpp
    ON rpp.role_preset_code = rp.code
  JOIN permissions p
    ON p.code = rpp.permission_code
 WHERE r.is_system = true
ON CONFLICT DO NOTHING;