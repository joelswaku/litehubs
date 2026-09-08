-- 013_automatic_employee_numbers.sql
-- Employee numbers are generated per company and include a position category.

ALTER TABLE employees
  ADD COLUMN position_category text NOT NULL DEFAULT 'employee',
  ADD CONSTRAINT employees_position_category_check
    CHECK (position_category IN ('manager', 'supervisor', 'officer', 'employee'));

CREATE TABLE organization_employee_number_counters (
  organization_id uuid PRIMARY KEY
    REFERENCES organizations (id) ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER organization_employee_number_counters_set_updated_at
  BEFORE UPDATE ON organization_employee_number_counters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enable_tenant_rls('organization_employee_number_counters');

-- Keep the sequence ahead of any already generated automatic employee numbers.
INSERT INTO organization_employee_number_counters (organization_id, last_number)
SELECT
  organization_id,
  COALESCE(
    MAX(
      CASE
        WHEN employee_number ~ '^[A-Z0-9]+-[0-9]{6}-[A-Z]+$'
          THEN substring(
            employee_number FROM '^[A-Z0-9]+-([0-9]{6})-[A-Z]+$'
          )::integer
        ELSE 0
      END
    ),
    0
  )
FROM employees
GROUP BY organization_id
ON CONFLICT (organization_id) DO UPDATE
SET last_number = GREATEST(
  organization_employee_number_counters.last_number,
  EXCLUDED.last_number
);

COMMENT ON COLUMN employees.position_category IS
  'The job category shown in a generated employee number. Permissions remain controlled by roles.';
COMMENT ON TABLE organization_employee_number_counters IS
  'Tenant-safe sequential counter used to generate employee numbers.';
