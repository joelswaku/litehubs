-- A project has two related but distinct lifecycles:
--   * execution status (planning, in progress, completed), and
--   * investment lifecycle (investment, commissioning, operating, closed).
-- Keeping them separate prevents a completed construction project from losing
-- its operational follow-up once it starts producing revenue.
BEGIN;

ALTER TABLE management_projects
  ADD COLUMN IF NOT EXISTS operational_start_date date,
  ADD COLUMN IF NOT EXISTS benefit_review_date date,
  ADD COLUMN IF NOT EXISTS benefit_owner_member_id uuid,
  ADD COLUMN IF NOT EXISTS lifecycle_stage text NOT NULL DEFAULT 'investment',
  ADD COLUMN IF NOT EXISTS benefit_targets jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'management_projects_benefit_owner_fk'
  ) THEN
    ALTER TABLE management_projects
      ADD CONSTRAINT management_projects_benefit_owner_fk
      FOREIGN KEY (organization_id, benefit_owner_member_id)
      REFERENCES organization_members (organization_id, id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE management_projects
  DROP CONSTRAINT IF EXISTS management_projects_dates_check,
  ADD CONSTRAINT management_projects_dates_check CHECK (
    (target_completion_date IS NULL OR start_date IS NULL OR target_completion_date >= start_date) AND
    (revised_completion_date IS NULL OR start_date IS NULL OR revised_completion_date >= start_date) AND
    (completed_date IS NULL OR start_date IS NULL OR completed_date >= start_date) AND
    (operational_start_date IS NULL OR start_date IS NULL OR operational_start_date >= start_date) AND
    (benefit_review_date IS NULL OR operational_start_date IS NULL OR benefit_review_date >= operational_start_date)
  ),
  ADD CONSTRAINT management_projects_lifecycle_stage_check CHECK (
    lifecycle_stage IN ('investment', 'commissioning', 'operating', 'closed')
  ),
  ADD CONSTRAINT management_projects_benefit_targets_check CHECK (
    jsonb_typeof(benefit_targets) = 'object'
  );

CREATE INDEX IF NOT EXISTS management_projects_lifecycle_stage_idx
  ON management_projects (organization_id, lifecycle_stage, operational_start_date);

COMMENT ON COLUMN management_projects.operational_start_date IS
  'Planned or actual date when the investment starts normal farm operations.';
COMMENT ON COLUMN management_projects.benefit_review_date IS
  'Date on which expected production, revenue and margin are reviewed.';
COMMENT ON COLUMN management_projects.benefit_owner_member_id IS
  'Active company member accountable for sustaining the project benefits after handover.';
COMMENT ON COLUMN management_projects.lifecycle_stage IS
  'Business lifecycle independent from execution status: investment, commissioning, operating or closed.';
COMMENT ON COLUMN management_projects.benefit_targets IS
  'Structured, optional targets for production, sales, margin, mortality and unit cost; all monetary values use project currency.';

COMMIT;
