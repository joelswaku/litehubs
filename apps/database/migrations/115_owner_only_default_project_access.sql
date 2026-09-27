-- Only the workspace owner receives project access by default. A person becomes
-- a Project Manager only when the owner assigns them as responsible for a
-- specific project; their visibility remains limited to that assignment.

BEGIN;

-- Future organizations: remove generic project access from every non-owner
-- system preset, then restore the minimal assigned-manager permission set.
DELETE FROM role_preset_permissions preset_permission
USING permissions permission
WHERE preset_permission.permission_code = permission.code
  AND permission.code LIKE 'projects.%'
  AND preset_permission.role_preset_code <> 'owner';

INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'project_manager', permission.code
FROM permissions permission
WHERE permission.code IN ('projects.read', 'projects.update')
ON CONFLICT DO NOTHING;

-- Existing organizations: align only protected system roles. Custom roles keep
-- their administrator-defined permissions and are never altered by this policy.
DELETE FROM role_permissions role_permission
USING roles role, permissions permission
WHERE role_permission.organization_id = role.organization_id
  AND role_permission.role_id = role.id
  AND role_permission.permission_id = permission.id
  AND role.is_system
  AND role.code <> 'owner'
  AND permission.code LIKE 'projects.%';

-- The owner remains the sole default project administrator.
INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT role.organization_id, role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.is_system
  AND role.code = 'owner'
  AND permission.code LIKE 'projects.%'
ON CONFLICT DO NOTHING;

-- An assigned responsible manager can open and update only projects for which
-- they hold a current primary-manager assignment. They cannot create or delete
-- a project.
INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT role.organization_id, role.id, permission.id
FROM roles role
JOIN permissions permission
  ON permission.code IN ('projects.read', 'projects.update')
WHERE role.is_system
  AND role.code = 'project_manager'
ON CONFLICT DO NOTHING;

COMMIT;