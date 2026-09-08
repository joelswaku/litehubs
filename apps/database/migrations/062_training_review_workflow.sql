-- 062_training_review_workflow.sql
-- Learners can start and submit their own assigned learning. A training manager
-- validates the completion before a certificate/record is issued.

ALTER TABLE training_assignments
  ADD COLUMN IF NOT EXISTS submitted_on date;

ALTER TABLE training_assignments
  DROP CONSTRAINT IF EXISTS training_assignments_status_check;

ALTER TABLE training_assignments
  ADD CONSTRAINT training_assignments_status_check
  CHECK (status IN ('assigned', 'in_progress', 'awaiting_review', 'completed', 'overdue', 'waived'));

ALTER TABLE training_assignments
  DROP CONSTRAINT IF EXISTS training_assignments_completion_date;

ALTER TABLE training_assignments
  ADD CONSTRAINT training_assignments_completion_date
  CHECK (
    (status <> 'completed' OR completed_on IS NOT NULL)
    AND (status <> 'awaiting_review' OR submitted_on IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS training_assignments_review_idx
  ON training_assignments (organization_id, status, submitted_on)
  WHERE status = 'awaiting_review';