-- 056_employee_creation_allowances.sql
-- Owner-controlled delegation: an HR Officer or Manager may create only a
-- limited number of employees in the province explicitly granted to them.

BEGIN;

ALTER TABLE employees
  ADD COLUMN created_by_member_id uuid,
  ADD CONSTRAINT employees_created_by_member_fk
    FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL;

CREATE INDEX employees_creation_quota_audit_idx
  ON employees (organization_id, created_by_member_id, province_id)
  WHERE created_by_member_id IS NOT NULL;

CREATE TABLE employee_creation_allowances (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  member_id             uuid NOT NULL,
  province_id           uuid NOT NULL,
  max_employees         integer NOT NULL,
  used_employees        integer NOT NULL DEFAULT 0,
  granted_by_member_id  uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT employee_creation_allowances_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT employee_creation_allowances_member_province_unique
    UNIQUE (organization_id, member_id, province_id),
  CONSTRAINT employee_creation_allowances_member_fk
    FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT employee_creation_allowances_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT employee_creation_allowances_granted_by_fk
    FOREIGN KEY (organization_id, granted_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT employee_creation_allowances_limit_check
    CHECK (max_employees >= 1 AND max_employees <= 100000),
  CONSTRAINT employee_creation_allowances_usage_check
    CHECK (used_employees >= 0 AND used_employees <= max_employees)
);

CREATE INDEX employee_creation_allowances_member_idx
  ON employee_creation_allowances (organization_id, member_id, province_id);

CREATE TRIGGER employee_creation_allowances_set_updated_at
  BEFORE UPDATE ON employee_creation_allowances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enable_tenant_rls('employee_creation_allowances');

COMMENT ON TABLE employee_creation_allowances IS
  'Owner-granted, province-specific caps for HR Officers and Managers creating employee profiles.';
COMMENT ON COLUMN employee_creation_allowances.used_employees IS
  'Atomically reserved on employee creation so concurrent requests cannot exceed the Owner limit.';
COMMENT ON COLUMN employees.created_by_member_id IS
  'Member who created the employee profile; used for creation allowance audit and quota enforcement.';

COMMIT;