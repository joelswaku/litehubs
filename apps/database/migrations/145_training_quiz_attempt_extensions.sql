-- A targeted, auditable way to reopen a quiz for one learner without changing
-- the course-wide attempt policy or deleting the learner's prior attempts.
CREATE TABLE training_quiz_attempt_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL,
  block_id uuid NOT NULL,
  additional_attempts integer NOT NULL,
  reason text NOT NULL,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_quiz_attempt_extensions_assignment_fk
    FOREIGN KEY (organization_id, assignment_id)
    REFERENCES training_assignments(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT training_quiz_attempt_extensions_block_fk
    FOREIGN KEY (organization_id, block_id)
    REFERENCES training_content_blocks(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT training_quiz_attempt_extensions_count_positive
    CHECK (additional_attempts BETWEEN 1 AND 20),
  CONSTRAINT training_quiz_attempt_extensions_reason_not_blank
    CHECK (length(btrim(reason)) > 0)
);

CREATE INDEX training_quiz_attempt_extensions_lookup_idx
  ON training_quiz_attempt_extensions(organization_id, assignment_id, block_id);

SELECT enable_tenant_rls('training_quiz_attempt_extensions');
