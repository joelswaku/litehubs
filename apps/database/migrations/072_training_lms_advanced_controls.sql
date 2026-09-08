-- 072_training_lms_advanced_controls.sql
-- Adds reusable audiences, question banks, renewal controls and explicit lifecycle states.

ALTER TABLE training_courses
  ADD COLUMN IF NOT EXISTS renewal_months integer,
  ADD COLUMN IF NOT EXISTS renewal_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_assign_new_employees boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_due_days integer;

ALTER TABLE training_courses
  ADD CONSTRAINT training_courses_renewal_months_range_v3
    CHECK (renewal_months IS NULL OR renewal_months BETWEEN 1 AND 600),
  ADD CONSTRAINT training_courses_default_due_days_range_v3
    CHECK (default_due_days IS NULL OR default_due_days BETWEEN 1 AND 3650),
  ADD CONSTRAINT training_courses_renewal_requirement_v3
    CHECK (NOT renewal_required OR renewal_months IS NOT NULL);

ALTER TABLE training_assignments
  DROP CONSTRAINT IF EXISTS training_assignments_status_check;
ALTER TABLE training_assignments
  ADD CONSTRAINT training_assignments_status_check
  CHECK (status IN (
    'assigned','in_progress','awaiting_review','awaiting_grading','completed',
    'overdue','waived','failed','expired','revoked'
  ));
ALTER TABLE training_assignments
  DROP CONSTRAINT IF EXISTS training_assignments_completion_date;
ALTER TABLE training_assignments
  ADD CONSTRAINT training_assignments_completion_date
  CHECK (
    (status <> 'completed' OR completed_on IS NOT NULL)
    AND (status <> 'awaiting_review' OR submitted_on IS NOT NULL)
  );

CREATE TABLE training_course_audiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  target_value text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_course_audiences_course_fk
    FOREIGN KEY (organization_id,course_id)
    REFERENCES training_courses(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT training_course_audiences_type_check CHECK (target_type IN (
    'organization','province','site','department','role','employee_category','employee'
  )),
  CONSTRAINT training_course_audiences_target_check CHECK (
    (target_type='organization' AND target_id IS NULL AND target_value IS NULL)
    OR (target_type='employee_category' AND target_id IS NULL AND btrim(COALESCE(target_value,'')) <> '')
    OR (target_type IN ('province','site','department','role','employee') AND target_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX training_course_audiences_unique_idx
  ON training_course_audiences (organization_id,course_id,target_type,COALESCE(target_id,'00000000-0000-0000-0000-000000000000'::uuid),COALESCE(target_value,''));
CREATE INDEX training_course_audiences_course_idx
  ON training_course_audiences (organization_id,course_id,target_type);
SELECT enable_tenant_rls('training_course_audiences');

CREATE TABLE training_course_prerequisites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL,
  prerequisite_course_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_course_prerequisites_course_fk
    FOREIGN KEY (organization_id,course_id)
    REFERENCES training_courses(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT training_course_prerequisites_required_fk
    FOREIGN KEY (organization_id,prerequisite_course_id)
    REFERENCES training_courses(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT training_course_prerequisites_no_self CHECK (course_id <> prerequisite_course_id),
  CONSTRAINT training_course_prerequisites_unique UNIQUE (organization_id,course_id,prerequisite_course_id)
);
SELECT enable_tenant_rls('training_course_prerequisites');

CREATE TABLE training_question_banks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_question_banks_org_id_unique UNIQUE (organization_id,id),
  CONSTRAINT training_question_banks_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT training_question_banks_unique UNIQUE (organization_id,name)
);
CREATE TRIGGER training_question_banks_set_updated_at
  BEFORE UPDATE ON training_question_banks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT enable_tenant_rls('training_question_banks');

CREATE TABLE training_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  question_bank_id uuid NOT NULL,
  question_type text NOT NULL,
  prompt text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct_answer jsonb NOT NULL DEFAULT '{}'::jsonb,
  explanation text,
  source_reference text,
  points numeric(8,2) NOT NULL DEFAULT 1,
  requires_manual_grading boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_questions_bank_fk
    FOREIGN KEY (organization_id,question_bank_id)
    REFERENCES training_question_banks(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT training_questions_type_check CHECK (question_type IN (
    'single_choice','multiple_choice','true_false','matching','ordering',
    'fill_blank','numerical','short_written','scenario','image_based'
  )),
  CONSTRAINT training_questions_prompt_check CHECK (btrim(prompt) <> ''),
  CONSTRAINT training_questions_points_check CHECK (points > 0 AND points <= 1000),
  CONSTRAINT training_questions_options_json_check CHECK (jsonb_typeof(options)='array'),
  CONSTRAINT training_questions_correct_json_check CHECK (jsonb_typeof(correct_answer) IN ('object','array','string','number','boolean'))
);
CREATE TRIGGER training_questions_set_updated_at
  BEFORE UPDATE ON training_questions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX training_questions_bank_idx ON training_questions(organization_id,question_bank_id,is_active);
SELECT enable_tenant_rls('training_questions');