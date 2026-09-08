-- Owner-configured automatic employee performance policy.
-- Scores are calculated from the existing attendance, daily report, task and
-- disciplinary records; this table stores rules only, never duplicate facts.
CREATE TABLE performance_policies (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  attendance_weight numeric(5,2) NOT NULL DEFAULT 35,
  punctuality_weight numeric(5,2) NOT NULL DEFAULT 15,
  daily_report_weight numeric(5,2) NOT NULL DEFAULT 20,
  task_weight numeric(5,2) NOT NULL DEFAULT 20,
  conduct_weight numeric(5,2) NOT NULL DEFAULT 10,
  working_days jsonb NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,
  daily_reports_required boolean NOT NULL DEFAULT true,
  grace_minutes integer NOT NULL DEFAULT 15,
  minimum_observations integer NOT NULL DEFAULT 3,
  minor_deduction numeric(5,2) NOT NULL DEFAULT 5,
  serious_deduction numeric(5,2) NOT NULL DEFAULT 15,
  gross_deduction numeric(5,2) NOT NULL DEFAULT 35,
  flagged_report_deduction numeric(5,2) NOT NULL DEFAULT 5,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT performance_policies_weights_check CHECK (
    attendance_weight BETWEEN 0 AND 100 AND punctuality_weight BETWEEN 0 AND 100 AND
    daily_report_weight BETWEEN 0 AND 100 AND task_weight BETWEEN 0 AND 100 AND
    conduct_weight BETWEEN 0 AND 100 AND
    attendance_weight + punctuality_weight + daily_report_weight + task_weight + conduct_weight = 100
  ),
  CONSTRAINT performance_policies_working_days_check CHECK (
    jsonb_typeof(working_days) = 'array' AND jsonb_array_length(working_days) BETWEEN 1 AND 7
  ),
  CONSTRAINT performance_policies_limits_check CHECK (
    grace_minutes BETWEEN 0 AND 180 AND minimum_observations BETWEEN 1 AND 60 AND
    minor_deduction BETWEEN 0 AND 100 AND serious_deduction BETWEEN 0 AND 100 AND
    gross_deduction BETWEEN 0 AND 100 AND flagged_report_deduction BETWEEN 0 AND 100
  )
);
CREATE TRIGGER performance_policies_set_updated_at BEFORE UPDATE ON performance_policies
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT enable_tenant_rls('performance_policies');
COMMENT ON TABLE performance_policies IS 'Owner-defined scoring rules for automatic employee performance; operational source records remain in their own modules.';