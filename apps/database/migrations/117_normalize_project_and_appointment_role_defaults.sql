-- 117_normalize_project_and_appointment_role_defaults.sql
-- Keep investment control and public appointment administration with the owner.
-- Operational staff can run the queue but cannot publish settings, messages, or
-- permanently remove appointment records.

BEGIN;


-- Only the workspace owner manages public appointment configuration and keeps
-- the final right to remove an appointment. Reception and security use status
-- updates instead, preserving the audit trail.
DELETE FROM role_preset_permissions preset_permission
USING permissions permission
WHERE preset_permission.permission_code = permission.code
  AND preset_permission.role_preset_code <> 'owner'
  AND permission.code IN ('appointments.delete', 'appointments.manage_messages');

DELETE FROM role_permissions role_permission
USING roles role, permissions permission
WHERE role_permission.organization_id = role.organization_id
  AND permission.id = role_permission.permission_id
  AND role_permission.role_id = role.id
  AND role.is_system
  AND role.code <> 'owner'
  AND permission.code IN ('appointments.delete', 'appointments.manage_messages');

COMMIT;