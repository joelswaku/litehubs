-- 067_training_assignment_progress_fields.sql
-- The learner portal stores an overall completion percentage and last access time
-- on the assignment. These fields are deliberately separate from per-lesson
-- progress, which remains in training_assignment_material_progress.

ALTER TABLE training_assignments
  ADD COLUMN IF NOT EXISTS progress_percent numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_opened_at timestamptz;

UPDATE training_assignments
   SET progress_percent = 100
 WHERE status = 'completed'
   AND progress_percent = 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'training_assignments_progress_percent_range'
       AND conrelid = 'training_assignments'::regclass
  ) THEN
    ALTER TABLE training_assignments
      ADD CONSTRAINT training_assignments_progress_percent_range
      CHECK (progress_percent >= 0 AND progress_percent <= 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS training_assignments_learner_inbox_idx
  ON training_assignments (organization_id, employee_id, status, due_on, last_opened_at DESC);