-- 071_training_ai_assistant.sql
-- Server-side audit and daily quota for the optional Training AI assistant.

CREATE TABLE training_ai_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action text NOT NULL,
  model text NOT NULL,
  input_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_ai_requests_action_check CHECK (action IN (
    'course_outline', 'objectives', 'policy_to_lessons', 'quiz_questions',
    'simplify', 'translate', 'quiz_source_check'
  ))
);

CREATE INDEX training_ai_requests_daily_idx
  ON training_ai_requests (organization_id, user_id, created_at DESC);

SELECT enable_tenant_rls('training_ai_requests');