-- 146_remove_project_manager_hr_directory_access.sql
-- A Project Manager may allocate work only through the project-scoped
-- task-assignee endpoint.  The company employee directory contains personal
-- contact and employment data and must never be granted merely to assign a
-- project task.

BEGIN;

DELETE FROM role_preset_permissions preset_permission
 USING permissions permission
 WHERE preset_permission.permission_code = permission.code
   AND preset_permission.role_preset_code = 'project_manager'
   AND permission.code = 'employees.read';

DELETE FROM role_permissions role_permission
 USING roles role, permissions permission
 WHERE role_permission.organization_id = role.organization_id
   AND role_permission.role_id = role.id
   AND role_permission.permission_id = permission.id
   AND role.code = 'project_manager'
   AND permission.code = 'employees.read';

COMMIT;
