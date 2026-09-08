-- Project managers already receive operational project permissions from the
-- owner-management foundation. This migration adds the same execution access
-- to general and provincial managers only. It deliberately does not grant
-- projects.create, projects.update, budget access, approval decisions, or
-- project export: those actions remain owner-only in the API.

WITH manager_permissions AS (
  SELECT code
    FROM permissions
   WHERE code IN (
     'projects.read',
     'tasks.create', 'tasks.read', 'tasks.update',
     'procurement.create', 'procurement.read', 'procurement.update',
     'finance.expenses.create', 'finance.expenses.read', 'finance.expenses.update',
     'approvals.read'
   )
)
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT preset.code, permission.code
  FROM role_presets preset
 CROSS JOIN manager_permissions permission
 WHERE preset.code IN ('general_manager', 'provincial_manager')
ON CONFLICT DO NOTHING;

WITH manager_permissions AS (
  SELECT id
    FROM permissions
   WHERE code IN (
     'projects.read',
     'tasks.create', 'tasks.read', 'tasks.update',
     'procurement.create', 'procurement.read', 'procurement.update',
     'finance.expenses.create', 'finance.expenses.read', 'finance.expenses.update',
     'approvals.read'
   )
)
INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT role.organization_id, role.id, permission.id
  FROM roles role
 CROSS JOIN manager_permissions permission
 WHERE role.code IN ('general_manager', 'provincial_manager')
ON CONFLICT DO NOTHING;