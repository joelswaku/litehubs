-- 014_five_digit_employee_numbers.sql
-- Convert Congo Omega employee profiles to five-digit staff numbers only.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM employees e
    JOIN organizations o ON o.id = e.organization_id
    WHERE o.slug = 'congo-omega'
    GROUP BY e.organization_id, e.position_category
    HAVING COUNT(*) > 9999
  ) THEN
    RAISE EXCEPTION
      'Congo Omega has more than 9,999 employees in one position category';
  END IF;
END $$;

CREATE TABLE organization_employee_category_counters (
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  position_category text NOT NULL
    CHECK (position_category IN ('manager', 'supervisor', 'officer', 'employee')),
  last_number smallint NOT NULL DEFAULT 0
    CHECK (last_number BETWEEN 0 AND 9999),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, position_category)
);

CREATE TRIGGER organization_employee_category_counters_set_updated_at
  BEFORE UPDATE ON organization_employee_category_counters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enable_tenant_rls('organization_employee_category_counters');

-- Reformat Congo Omega's existing employee records only.
-- 1xxxx = employee, 2xxxx = supervisor, 3xxxx = officer, 4xxxx = manager.
WITH target AS (
  SELECT id
  FROM organizations
  WHERE slug = 'congo-omega'
), numbered AS (
  SELECT
    e.id,
    e.position_category,
    ROW_NUMBER() OVER (
      PARTITION BY e.organization_id, e.position_category
      ORDER BY e.created_at, e.id
    ) AS sequence_number
  FROM employees e
  JOIN target t ON t.id = e.organization_id
)
UPDATE employees e
SET employee_number = (
  CASE numbered.position_category
    WHEN 'employee' THEN 10000
    WHEN 'supervisor' THEN 20000
    WHEN 'officer' THEN 30000
    WHEN 'manager' THEN 40000
  END + numbered.sequence_number
)::text
FROM numbered
WHERE e.id = numbered.id;

INSERT INTO organization_employee_category_counters
  (organization_id, position_category, last_number)
SELECT
  e.organization_id,
  e.position_category,
  MAX(
    e.employee_number::integer - CASE e.position_category
      WHEN 'employee' THEN 10000
      WHEN 'supervisor' THEN 20000
      WHEN 'officer' THEN 30000
      WHEN 'manager' THEN 40000
    END
  )::smallint
FROM employees e
JOIN organizations o ON o.id = e.organization_id
WHERE o.slug = 'congo-omega'
GROUP BY e.organization_id, e.position_category
ON CONFLICT (organization_id, position_category) DO UPDATE
SET last_number = GREATEST(
  organization_employee_category_counters.last_number,
  EXCLUDED.last_number
);

COMMENT ON TABLE organization_employee_category_counters IS
  'Tenant-safe counters for five-digit employee numbers: 1xxxx employee, 2xxxx supervisor, 3xxxx officer, 4xxxx manager.';
