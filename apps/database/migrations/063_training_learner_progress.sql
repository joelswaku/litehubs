-- 063_training_learner_progress.sql
-- A learner follows the same course/material records created in the Training
-- Centre.  Progress is tied to the assignment, never to an id supplied by a
-- browser, so it remains tenant-safe and auditable.

ALTER TABLE training_courses
  ADD COLUMN IF NOT EXISTS requires_acknowledgment boolean NOT NULL DEFAULT false;

ALTER TABLE training_materials
  ADD COLUMN IF NOT EXISTS estimated_duration_minutes integer,
  ADD COLUMN IF NOT EXISTS requires_acknowledgment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiz_questions jsonb,
  ADD COLUMN IF NOT EXISTS quiz_passing_score numeric(5,2);

ALTER TABLE training_materials
  ADD CONSTRAINT training_materials_duration_range
    CHECK (estimated_duration_minutes IS NULL OR estimated_duration_minutes BETWEEN 1 AND 1440),
  ADD CONSTRAINT training_materials_quiz_questions_array
    CHECK (quiz_questions IS NULL OR jsonb_typeof(quiz_questions) = 'array'),
  ADD CONSTRAINT training_materials_quiz_passing_score_range
    CHECK (quiz_passing_score IS NULL OR (quiz_passing_score >= 0 AND quiz_passing_score <= 100));

CREATE TABLE training_assignment_material_progress (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL,
  material_id uuid NOT NULL,
  started_at timestamptz,
  last_opened_at timestamptz,
  completed_at timestamptz,
  acknowledged_at timestamptz,
  quiz_score numeric(5,2),
  quiz_answers jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT training_assignment_material_progress_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT training_assignment_material_progress_unique UNIQUE (organization_id, assignment_id, material_id),
  CONSTRAINT training_assignment_material_progress_assignment_fk
    FOREIGN KEY (organization_id, assignment_id)
    REFERENCES training_assignments (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT training_assignment_material_progress_material_fk
    FOREIGN KEY (organization_id, material_id)
    REFERENCES training_materials (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT training_assignment_material_progress_score_range
    CHECK (quiz_score IS NULL OR (quiz_score >= 0 AND quiz_score <= 100)),
  CONSTRAINT training_assignment_material_progress_answers_array
    CHECK (quiz_answers IS NULL OR jsonb_typeof(quiz_answers) = 'array')
);

CREATE TRIGGER training_assignment_material_progress_set_updated_at
  BEFORE UPDATE ON training_assignment_material_progress
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX training_assignment_material_progress_assignment_idx
  ON training_assignment_material_progress (organization_id, assignment_id, material_id);

SELECT enable_tenant_rls('training_assignment_material_progress');
