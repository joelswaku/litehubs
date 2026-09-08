-- 012_employee_profiles.sql
-- Employee profiles are HR records, separate from a login/member and roles.

CREATE TABLE employees (
  id                       uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  member_id                uuid,
  employee_number          text NOT NULL,
  full_name                text NOT NULL,
  job_title                text NOT NULL,
  province_id              uuid,
  site_id                  uuid,
  department_id            uuid,
  employment_status        text NOT NULL DEFAULT 'active',
  employment_type          text NOT NULL DEFAULT 'permanent',
  start_date               date,
  phone                    text,
  emergency_contact_name   text,
  emergency_contact_phone  text,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT employees_number_unique_per_org UNIQUE (organization_id, employee_number),
  CONSTRAINT employees_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT employees_member_fk
    FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL (member_id),
  CONSTRAINT employees_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT employees_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id)
    ON DELETE SET NULL (site_id),
  CONSTRAINT employees_department_fk
    FOREIGN KEY (organization_id, department_id)
    REFERENCES departments (organization_id, id)
    ON DELETE SET NULL (department_id),
  CONSTRAINT employees_number_format
    CHECK (employee_number ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$'),
  CONSTRAINT employees_name_not_blank CHECK (btrim(full_name) <> ''),
  CONSTRAINT employees_title_not_blank CHECK (btrim(job_title) <> ''),
  CONSTRAINT employees_status_check
    CHECK (employment_status IN ('active', 'probation', 'on_leave', 'suspended', 'terminated')),
  CONSTRAINT employees_type_check
    CHECK (employment_type IN ('permanent', 'temporary', 'contract', 'casual', 'intern'))
);

CREATE UNIQUE INDEX employees_member_unique_per_org
  ON employees (organization_id, member_id)
  WHERE member_id IS NOT NULL;

CREATE INDEX employees_province_idx ON employees (organization_id, province_id);
CREATE INDEX employees_site_idx ON employees (organization_id, site_id);
CREATE INDEX employees_department_idx ON employees (organization_id, department_id);

CREATE TRIGGER employees_set_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enable_tenant_rls('employees');

COMMENT ON TABLE employees IS
  'Organization HR records. A member/login and a role are optional, separate links.';
COMMENT ON COLUMN employees.member_id IS
  'Optional login membership. Staff can exist before receiving LiteHubs access.';
COMMENT ON COLUMN employees.province_id IS
  'Primary work province, not the same as the provinces a member may access.';
