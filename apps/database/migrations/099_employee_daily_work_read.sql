-- 099_employee_daily_work_read.sql
-- An employee must be able to read only the self-scoped daily-work records
-- exposed by the service before completing them. This does not grant template,
-- approval, or team-wide access.

INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'employee', p.code
FROM permissions p
WHERE p.code = 'daily_operations.read'
ON CONFLICT DO NOTHING;

-- Existing company Employee roles are copies of the preset. Keep the same
-- narrow read access for every tenant without changing other roles.
INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'daily_operations.read'
WHERE r.code = 'employee'
ON CONFLICT DO NOTHING;