-- 098_employee_daily_work_execution.sql
-- Employees may complete only their own, self-scoped daily execution records.
-- The service enforces the employee/site boundary; this grant never includes
-- approval or template management.

INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'employee', p.code
FROM permissions p
WHERE p.code = 'daily_operations.update'
ON CONFLICT DO NOTHING;

-- Existing company Employee roles are copies of the preset, so grant the same
-- narrowly scoped completion permission without changing any other role.
INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'daily_operations.update'
WHERE r.code = 'employee'
ON CONFLICT DO NOTHING;