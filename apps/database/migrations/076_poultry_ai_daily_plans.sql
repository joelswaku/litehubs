-- Optional, reviewable AI planning for poultry daily work.
-- Deterministic flock checks remain the source of truth; this stores a single
-- supplemental plan and a trace of the request used to create it.
ALTER TABLE poultry_daily_work_items
  DROP CONSTRAINT IF EXISTS poultry_daily_work_items_source_check;

ALTER TABLE poultry_daily_work_items
  ADD CONSTRAINT poultry_daily_work_items_source_check
  CHECK (source IN ('manual', 'model', 'ai'));

CREATE TABLE poultry_ai_daily_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  flock_id uuid NOT NULL,
  work_date date NOT NULL,
  input_fingerprint text NOT NULL,
  model text NOT NULL,
  summary text NOT NULL,
  priorities jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT poultry_ai_daily_plans_org_flock_fk
    FOREIGN KEY (organization_id, flock_id)
    REFERENCES poultry_flocks (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT poultry_ai_daily_plans_org_date_unique
    UNIQUE (organization_id, flock_id, work_date),
  CONSTRAINT poultry_ai_daily_plans_summary_not_blank CHECK (btrim(summary) <> ''),
  CONSTRAINT poultry_ai_daily_plans_priorities_array CHECK (jsonb_typeof(priorities) = 'array')
);
CREATE TRIGGER poultry_ai_daily_plans_set_updated_at
  BEFORE UPDATE ON poultry_ai_daily_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX poultry_ai_daily_plans_lookup_idx
  ON poultry_ai_daily_plans (organization_id, flock_id, work_date DESC);
SELECT enable_tenant_rls('poultry_ai_daily_plans');

CREATE TABLE poultry_ai_daily_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  flock_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  model text NOT NULL,
  input_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT poultry_ai_daily_requests_org_flock_fk
    FOREIGN KEY (organization_id, flock_id)
    REFERENCES poultry_flocks (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX poultry_ai_daily_requests_limit_idx
  ON poultry_ai_daily_requests (organization_id, user_id, created_at DESC);
SELECT enable_tenant_rls('poultry_ai_daily_requests');