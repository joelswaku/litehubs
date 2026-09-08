-- Structured project team roles and time-bound project assignments.
ALTER TABLE management_project_members
  DROP CONSTRAINT management_project_members_role_check;

UPDATE management_project_members
SET assignment_role = CASE
  WHEN assignment_role = 'manager' AND is_manager THEN 'project_manager'
  WHEN assignment_role = 'manager' THEN 'provincial_manager'
  WHEN assignment_role = 'site_manager' THEN 'provincial_manager'
  WHEN assignment_role = 'supervisor' THEN 'supervisor'
  WHEN assignment_role = 'storekeeper' THEN 'procurement'
  WHEN assignment_role = 'receiver' THEN 'procurement'
  WHEN assignment_role = 'operator' THEN 'worker'
  WHEN assignment_role = 'driver' THEN 'worker'
  WHEN assignment_role = 'worker' THEN 'worker'
  ELSE 'other'
END;

ALTER TABLE management_project_members
  ALTER COLUMN assignment_role SET DEFAULT 'other',
  ADD CONSTRAINT management_project_members_role_check CHECK (assignment_role IN (
    'project_manager', 'provincial_manager', 'supervisor', 'finance',
    'procurement', 'legal', 'administration', 'worker', 'contractor', 'other'
  )),
  ADD COLUMN assignment_start_date date NOT NULL DEFAULT current_date,
  ADD COLUMN assignment_end_date date,
  ADD CONSTRAINT management_project_members_assignment_dates_check CHECK (
    assignment_end_date IS NULL OR assignment_end_date >= assignment_start_date
  );

UPDATE management_project_members
SET assignment_start_date = assigned_at::date
WHERE assignment_start_date = current_date AND assigned_at::date <> current_date;

ALTER TABLE management_project_members
  DROP CONSTRAINT management_project_members_project_member_unique;

CREATE INDEX management_project_members_project_member_period_idx
  ON management_project_members (organization_id, project_id, member_id, assignment_start_date DESC);

CREATE INDEX management_project_members_active_project_idx
  ON management_project_members (organization_id, project_id, assignment_start_date, assignment_end_date);

-- Preserve a single active primary manager per historical project assignment.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY organization_id, project_id
    ORDER BY assigned_at DESC, id DESC
  ) AS position
  FROM management_project_members
  WHERE is_manager
)
UPDATE management_project_members m
SET is_manager = false
FROM ranked
WHERE ranked.id = m.id AND ranked.position > 1;

COMMENT ON COLUMN management_project_members.is_manager IS
  'Primary project manager for the assignment period. The service keeps overlapping primary-manager periods exclusive.';
