-- 088_appointment_reception_role.sql
-- A narrowly scoped role for reception staff who handle visitors and the
-- appointment queue. It deliberately cannot delete appointment records.

INSERT INTO role_presets
  (code, name, description, level, industry_code, is_owner_role, sort_order, data_scope)
VALUES
  ('appointment_receptionist', 'Reception & Appointments',
   'Receives visitors and manages site appointments and live queues in assigned provinces.',
   55, NULL, false, 105, 'province')
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      level = EXCLUDED.level,
      industry_code = EXCLUDED.industry_code,
      is_owner_role = EXCLUDED.is_owner_role,
      sort_order = EXCLUDED.sort_order,
      data_scope = EXCLUDED.data_scope;

INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'appointment_receptionist', p.code
  FROM permissions p
 WHERE p.resource = 'appointments'
   AND p.action IN ('read', 'create', 'update')
ON CONFLICT DO NOTHING;

-- Add the system role to existing company workspaces. New organizations receive
-- it automatically from the preset through the provisioning service.
INSERT INTO roles
  (organization_id, code, name, description, level, data_scope, is_system)
SELECT o.id, rp.code, rp.name, rp.description, rp.level, rp.data_scope, true
  FROM organizations o
  JOIN role_presets rp ON rp.code = 'appointment_receptionist'
ON CONFLICT (organization_id, code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      level = EXCLUDED.level,
      data_scope = EXCLUDED.data_scope,
      is_system = true;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
  FROM roles r
  JOIN role_preset_permissions grants
    ON grants.role_preset_code = r.code
  JOIN permissions p ON p.code = grants.permission_code
 WHERE r.code = 'appointment_receptionist'
ON CONFLICT DO NOTHING;

