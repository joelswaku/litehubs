-- 110_remove_employee_project_read.sql
-- A standard Employee works through assigned tasks and personal workspaces.
-- Project portfolios are reserved for explicitly authorised management roles.
-- This prevents a province-scoped secondary role from expanding Employee
-- project visibility across an entire province.

DELETE FROM role_preset_permissions
 WHERE role_preset_code = 'employee'
   AND permission_code = 'projects.read';

DELETE FROM role_permissions rp
 USING roles r, permissions p
 WHERE rp.role_id = r.id
   AND rp.permission_id = p.id
   AND r.code = 'employee'
   AND p.code = 'projects.read';