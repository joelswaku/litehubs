-- 138_private_litehubs_assistant.sql
-- Privacy-first operational guidance. The original question and the answer are
-- deliberately never persisted: this table is only an auditable usage ledger.

CREATE TABLE IF NOT EXISTS private_assistant_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module text NOT NULL,
  locale text NOT NULL,
  model text NOT NULL,
  question_fingerprint text NOT NULL,
  redaction_applied boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT private_assistant_requests_module_check CHECK (module IN (
    'dashboard','projects','poultry','pigs','agriculture','feed_mill',
    'procurement','inventory','sales','finance','people','daily_work',
    'training','documents','general'
  )),
  CONSTRAINT private_assistant_requests_locale_check CHECK (locale IN ('fr','en'))
);

CREATE INDEX IF NOT EXISTS private_assistant_requests_daily_idx
  ON private_assistant_requests (organization_id, user_id, created_at DESC);

SELECT enable_tenant_rls('private_assistant_requests');

COMMENT ON TABLE private_assistant_requests IS
  'Privacy-preserving usage audit for the LiteHubs guide. It never stores a question, answer, document, record value, contact detail, or financial amount.';
