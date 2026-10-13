-- 191_tighten_role_library.sql
-- Access review of the role library (presets) and of the matching roles
-- already copied into each company:
--  * Feed mill manager: province scope instead of the whole company. Sites,
--    warehouses, stock and production orders follow the provinces assigned to
--    the person; recipes and nutrition profiles stay shared company-wide, and a
--    project can still be linked to an order inside those provinces.
--  * Fleet controller: province scope instead of the whole company, and no
--    access to the company document library (drivers are still visible).
--  * Poultry / pig / agriculture supervisors: no access to the document
--    library, which holds private HR files.
--  * Social media manager: no mailbox access.
--  * Accountant: prepares payroll but can no longer approve or reject it;
--    approval stays with the owner and the general manager.
-- Owners can still grant any of these back in Settings → Roles.

BEGIN;

UPDATE role_presets SET data_scope = 'province' WHERE code IN ('fleet_controller', 'feed_mill_manager');
UPDATE roles SET data_scope = 'province', updated_at = now()
 WHERE code IN ('fleet_controller', 'feed_mill_manager') AND data_scope = 'organization';

CREATE TEMP TABLE removed_access (role_code text, permission_code text) ON COMMIT DROP;
INSERT INTO removed_access VALUES
  ('fleet_controller', 'documents.read'),
  ('poultry_supervisor', 'documents.read'),
  ('pig_supervisor', 'documents.read'),
  ('agriculture_supervisor', 'documents.read'),
  ('social_media_manager', 'mail.read'),
  ('social_media_manager', 'mail.send'),
  ('accountant', 'payroll.approve'),
  ('accountant', 'payroll.reject');

DELETE FROM role_preset_permissions preset_permission
 USING removed_access removed
 WHERE preset_permission.role_preset_code = removed.role_code
   AND preset_permission.permission_code = removed.permission_code;

DELETE FROM role_permissions role_permission
 USING roles role, permissions permission, removed_access removed
 WHERE role_permission.organization_id = role.organization_id
   AND role_permission.role_id = role.id
   AND role_permission.permission_id = permission.id
   AND role.code = removed.role_code
   AND permission.code = removed.permission_code;

COMMIT;
