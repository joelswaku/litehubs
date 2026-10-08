-- 167_training_learner_notes_questions.sql
-- A learner can keep a private note per lesson and ask the trainer a question
-- about a lesson. Notes are only ever read by their author; questions are read
-- by the author and by the people who manage training, who answer them.

CREATE TABLE IF NOT EXISTS training_learner_notes (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assignment_id   uuid NOT NULL,
  lesson_id       uuid NOT NULL,
  note            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT training_learner_notes_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT training_learner_notes_assignment_fk FOREIGN KEY (organization_id, assignment_id)
    REFERENCES training_assignments (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT training_learner_notes_lesson_fk FOREIGN KEY (organization_id, lesson_id)
    REFERENCES training_lessons (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT training_learner_notes_unique UNIQUE (organization_id, assignment_id, lesson_id),
  CONSTRAINT training_learner_notes_length CHECK (char_length(note) <= 20000)
);

DROP TRIGGER IF EXISTS training_learner_notes_set_updated_at ON training_learner_notes;
CREATE TRIGGER training_learner_notes_set_updated_at
  BEFORE UPDATE ON training_learner_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enable_tenant_rls('training_learner_notes');

CREATE TABLE IF NOT EXISTS training_lesson_questions (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assignment_id       uuid NOT NULL,
  lesson_id           uuid NOT NULL,
  course_id           uuid NOT NULL,
  employee_id         uuid NOT NULL,
  asked_by_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  question            text NOT NULL,
  answer              text,
  answered_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  answered_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT training_lesson_questions_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT training_lesson_questions_assignment_fk FOREIGN KEY (organization_id, assignment_id)
    REFERENCES training_assignments (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT training_lesson_questions_lesson_fk FOREIGN KEY (organization_id, lesson_id)
    REFERENCES training_lessons (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT training_lesson_questions_question_check
    CHECK (btrim(question) <> '' AND char_length(question) <= 4000),
  CONSTRAINT training_lesson_questions_answer_check
    CHECK (answer IS NULL OR (btrim(answer) <> '' AND char_length(answer) <= 8000)),
  CONSTRAINT training_lesson_questions_answered_check
    CHECK ((answer IS NULL) = (answered_at IS NULL))
);

DROP TRIGGER IF EXISTS training_lesson_questions_set_updated_at ON training_lesson_questions;
CREATE TRIGGER training_lesson_questions_set_updated_at
  BEFORE UPDATE ON training_lesson_questions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS training_lesson_questions_open_idx
  ON training_lesson_questions (organization_id, answered_at, created_at DESC);
CREATE INDEX IF NOT EXISTS training_lesson_questions_assignment_idx
  ON training_lesson_questions (organization_id, assignment_id, lesson_id);

SELECT enable_tenant_rls('training_lesson_questions');
