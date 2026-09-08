-- 008_congo_omega_structure.sql
-- Congo Omega's first operational foundation:
-- country -> province -> farm/site -> department -> member assignment.
-- Every new table is tenant-scoped and has RLS from birth.

-- A role declares the intended reach of its data. Enforcement is added by
-- each operational module when it starts storing province or site data.
ALTER TABLE role_presets
  ADD COLUMN data_scope text NOT NULL DEFAULT 'organization',
  ADD CONSTRAINT role_presets_data_scope_check
    CHECK (data_scope IN ('organization', 'province', 'self'));

ALTER TABLE roles
  ADD COLUMN data_scope text NOT NULL DEFAULT 'organization',
  ADD CONSTRAINT roles_data_scope_check
    CHECK (data_scope IN ('organization', 'province', 'self'));

UPDATE role_presets
   SET data_scope = 'self'
 WHERE code = 'employee';

UPDATE roles
   SET data_scope = 'self'
 WHERE code = 'employee';

COMMENT ON COLUMN role_presets.data_scope IS
  'Organization, assigned province, or the member own records.';
COMMENT ON COLUMN roles.data_scope IS
  'Copy of the preset scope. A company may later change its own role.';

-- Provinces are company locations, not global platform data. One company can
-- use a province code independently of every other LiteHubs organization.
CREATE TABLE provinces (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT provinces_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT provinces_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT provinces_code_format
    CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT provinces_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TRIGGER provinces_set_updated_at
  BEFORE UPDATE ON provinces
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX provinces_active_idx
  ON provinces (organization_id)
  WHERE is_active;

SELECT enable_tenant_rls('provinces');

-- A site can be a farm, office, warehouse, or another operational location.
-- It belongs to exactly one company province.
CREATE TABLE sites (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  province_id     uuid NOT NULL,
  code            text NOT NULL,
  name            text NOT NULL,
  site_type       text NOT NULL DEFAULT 'farm',
  address_line1   text,
  address_line2   text,
  city            text,
  postal_code     text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT sites_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT sites_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT sites_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT sites_code_format
    CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT sites_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT sites_type_check
    CHECK (site_type IN ('farm', 'office', 'warehouse', 'other'))
);

CREATE TRIGGER sites_set_updated_at
  BEFORE UPDATE ON sites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX sites_province_idx ON sites (organization_id, province_id);
CREATE INDEX sites_active_idx
  ON sites (organization_id)
  WHERE is_active;

SELECT enable_tenant_rls('sites');

-- Departments can belong to the company as a whole or to a particular site.
CREATE TABLE departments (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  site_id           uuid,
  manager_member_id uuid,
  code              text NOT NULL,
  name              text NOT NULL,
  description       text,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT departments_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT departments_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT departments_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id)
    ON DELETE SET NULL (site_id),
  CONSTRAINT departments_manager_fk
    FOREIGN KEY (organization_id, manager_member_id)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL (manager_member_id),
  CONSTRAINT departments_code_format
    CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT departments_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TRIGGER departments_set_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX departments_site_idx ON departments (organization_id, site_id);
CREATE INDEX departments_active_idx
  ON departments (organization_id)
  WHERE is_active;

SELECT enable_tenant_rls('departments');

-- A provincial manager, supervisor, or employee is explicitly assigned to the
-- provinces they may see. This is separate from their role because one person
-- can cover more than one province.
CREATE TABLE member_provinces (
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  member_id       uuid NOT NULL,
  province_id     uuid NOT NULL,
  assigned_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, province_id),
  CONSTRAINT member_provinces_member_fk
    FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT member_provinces_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX member_provinces_province_idx
  ON member_provinces (organization_id, province_id);

SELECT enable_tenant_rls('member_provinces');

COMMENT ON TABLE provinces IS
  'Organization-owned geographical areas such as the provinces Congo Omega operates in.';
COMMENT ON TABLE sites IS
  'Company locations. A farm is a site and is always in one company province.';
COMMENT ON TABLE departments IS
  'Operational departments, optionally attached to one site.';
COMMENT ON TABLE member_provinces IS
  'Province assignments used by province-scoped roles.';

