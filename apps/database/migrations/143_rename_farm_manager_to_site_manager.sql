-- 143_rename_farm_manager_to_site_manager.sql
--
-- Farm Manager was already presented to users as "Site Manager", but the
-- legacy internal code remained in existing organizations.  Rename the role
-- in place so role permissions and member-role assignments keep their UUIDs.

DO $$
BEGIN
  -- A collision would make an in-place rename ambiguous.  Stop safely rather
  -- than merging two organization roles with potentially different grants.
  IF EXISTS (
    SELECT 1
    FROM roles legacy
    JOIN roles replacement
      ON replacement.organization_id = legacy.organization_id
     AND replacement.code = 'site_manager'
    WHERE legacy.code = 'farm_manager'
  ) THEN
    RAISE EXCEPTION
      'Cannot rename farm_manager: one or more organizations already have site_manager';
  END IF;
END $$;

-- Keep the platform preset current for organizations created after this
-- migration.  Copy grants before retiring the obsolete preset.
INSERT INTO role_presets
  (code, name, description, level, industry_code, is_owner_role, sort_order, data_scope)
SELECT
  'site_manager',
  'Site Manager',
  'Manages one site: production, staff and stock.',
  level,
  industry_code,
  is_owner_role,
  sort_order,
  data_scope
FROM role_presets
WHERE code = 'farm_manager'
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    level = EXCLUDED.level,
    industry_code = EXCLUDED.industry_code,
    is_owner_role = EXCLUDED.is_owner_role,
    sort_order = EXCLUDED.sort_order,
    data_scope = EXCLUDED.data_scope;

INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'site_manager', permission_code
FROM role_preset_permissions
WHERE role_preset_code = 'farm_manager'
ON CONFLICT DO NOTHING;

DELETE FROM role_preset_permissions WHERE role_preset_code = 'farm_manager';
DELETE FROM role_presets WHERE code = 'farm_manager';

-- This is an in-place code rename: existing role IDs, permission grants and
-- assignments are preserved exactly as they are.
UPDATE roles
SET code = 'site_manager',
    name = 'Site Manager',
    description = 'Manages one site: production, staff and stock.'
WHERE code = 'farm_manager';
