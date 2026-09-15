BEGIN;

-- A payroll run may intentionally exclude individual employees before approval.
-- The record is tenant-scoped and retained as part of the draft/calculated run audit.
CREATE TABLE payroll_run_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  reason text,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_run_exclusions_org_run_employee_unique
    UNIQUE (organization_id, run_id, employee_id),
  CONSTRAINT payroll_run_exclusions_run_fk
    FOREIGN KEY (organization_id, run_id)
    REFERENCES payroll_runs (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT payroll_run_exclusions_employee_fk
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees (organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX payroll_run_exclusions_run_idx
  ON payroll_run_exclusions (organization_id, run_id, created_at DESC);

SELECT enable_tenant_rls('payroll_run_exclusions');

COMMIT;