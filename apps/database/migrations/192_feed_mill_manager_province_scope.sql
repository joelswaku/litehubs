-- 192_feed_mill_manager_province_scope.sql
-- Feed mill manager: province scope instead of the whole company. Sites,
-- warehouses, stock and production orders follow the provinces assigned to
-- the person; recipes and nutrition profiles stay shared company-wide, and a
-- project can still be linked to an order inside those provinces.
-- Owners can widen it again in Settings → Roles.

BEGIN;

UPDATE role_presets SET data_scope = 'province' WHERE code = 'feed_mill_manager';
UPDATE roles SET data_scope = 'province', updated_at = now()
 WHERE code = 'feed_mill_manager' AND data_scope = 'organization';

COMMIT;
