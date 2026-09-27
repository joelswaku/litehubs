-- 111_daily_work_ai_checklists.sql
-- Audit and rate-limit records for review-only AI checklist drafts.

CREATE TABLE daily_work_ai_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action text NOT NULL DEFAULT 'checklist_draft',
  model text NOT NULL,
  input_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_work_ai_requests_action_check
    CHECK (action = 'checklist_draft')
);

CREATE INDEX daily_work_ai_requests_daily_idx
  ON daily_work_ai_requests (organization_id, user_id, created_at DESC);

SELECT enable_tenant_rls('daily_work_ai_requests');
