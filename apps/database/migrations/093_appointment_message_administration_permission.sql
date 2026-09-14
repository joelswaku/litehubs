-- Separate public queue-message administration from day-to-day reception work.
-- Reception agents can select a message when calling a visitor, but only approved
-- administrative roles can create, change, or retire public TV announcements.
INSERT INTO permissions(code, resource, action, module_code, description)
VALUES ('appointments.manage_messages', 'appointments', 'manage_messages', 'appointments', 'Manage approved public queue call messages')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_preset_permissions(role_preset_code, permission_code)
SELECT rp.code, p.code
  FROM role_presets rp
  JOIN permissions p ON p.code = 'appointments.manage_messages'
 WHERE rp.code IN ('owner', 'general_manager')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code = 'appointments.manage_messages'
 WHERE r.code IN ('owner', 'general_manager')
ON CONFLICT DO NOTHING;