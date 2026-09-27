-- 116_project_manager_read_only_project_record.sql
-- Project Managers operate assigned work only. The workspace owner remains the
-- only person who can change the project record, its plan, team, or budget.

BEGIN;

DELETE FROM role_preset_permissions preset_permission
USING permissions permission
WHERE preset_permission.permission_code = permission.code
  AND preset_permission.role_preset_code = 'project_manager'
  AND permission.code = 'projects.update';

DELETE FROM role_permissions role_permission
USING roles role, permissions permission
WHERE role_permission.organization_id = role.organization_id
  AND permission.id = role_permission.permission_id
  AND role_permission.role_id = role.id
  AND role.is_system
  AND role.code = 'project_manager'
  AND permission.code = 'projects.update';

COMMIT;