-- Tenant-managed equipment classifications. Asset records keep the category
-- label so existing equipment remains intact when categories are renamed.

BEGIN;

CREATE TABLE management_equipment_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_equipment_categories_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_equipment_categories_code_unique UNIQUE (organization_id, code),
  CONSTRAINT management_equipment_categories_name_unique UNIQUE (organization_id, name),
  CONSTRAINT management_equipment_categories_code_check CHECK (code ~ '^[a-z0-9][a-z0-9_-]{0,78}$'),
  CONSTRAINT management_equipment_categories_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT management_equipment_categories_member_fk
    FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL
);

CREATE INDEX management_equipment_categories_active_idx
  ON management_equipment_categories (organization_id, is_active, name);

SELECT enable_tenant_rls('management_equipment_categories');

-- Preserve every current equipment label and make it available as a category.
INSERT INTO management_equipment_categories (organization_id, code, name)
SELECT
  source.organization_id,
  source.code,
  source.name
FROM (
  SELECT DISTINCT
    organization_id,
    'legacy_' || substr(md5(lower(btrim(category))), 1, 12) AS code,
    btrim(category) AS name
  FROM management_assets
  WHERE nullif(btrim(category), '') IS NOT NULL
) AS source
ON CONFLICT (organization_id, code) DO NOTHING;

COMMENT ON TABLE management_equipment_categories IS
  'Company-managed classifications used to filter and register durable equipment.';

COMMIT;
