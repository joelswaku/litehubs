-- 068_professional_training_lms.sql
-- Extends, rather than replaces, the original catalogue/material/assignment model.
-- Existing courses and assignments are preserved on version 1.

ALTER TABLE training_courses
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS learning_objectives jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cover_document_id uuid,
  ADD COLUMN IF NOT EXISTS estimated_duration_minutes integer,
  ADD COLUMN IF NOT EXISTS difficulty text NOT NULL DEFAULT 'foundation',
  ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT ARRAY['fr']::text[],
  ADD COLUMN IF NOT EXISTS instructor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS completion_mode text NOT NULL DEFAULT 'manager_validation',
  ADD COLUMN IF NOT EXISTS current_version_id uuid;

ALTER TABLE training_courses
  ADD CONSTRAINT training_courses_duration_range_v2
    CHECK (estimated_duration_minutes IS NULL OR estimated_duration_minutes BETWEEN 1 AND 10080),
  ADD CONSTRAINT training_courses_difficulty_check_v2
    CHECK (difficulty IN ('foundation','intermediate','advanced')),
  ADD CONSTRAINT training_courses_languages_array_v2
    CHECK (jsonb_typeof(to_jsonb(languages)) = 'array' AND cardinality(languages) > 0),
  ADD CONSTRAINT training_courses_objectives_array_v2
    CHECK (jsonb_typeof(learning_objectives) = 'array'),
  ADD CONSTRAINT training_courses_tags_array_v2
    CHECK (jsonb_typeof(tags) = 'array'),
  ADD CONSTRAINT training_courses_lifecycle_v2
    CHECK (lifecycle_status IN ('draft','published','archived')),
  ADD CONSTRAINT training_courses_completion_mode_v2
    CHECK (completion_mode IN ('automatic','manager_validation'));

CREATE TABLE training_course_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL,
  version_number integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  title_snapshot text NOT NULL,
  content_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  change_summary text,
  requires_retake boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  published_by uuid REFERENCES users(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_course_versions_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT training_course_versions_org_course_fk
    FOREIGN KEY (organization_id, course_id)
    REFERENCES training_courses(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT training_course_versions_number_unique UNIQUE (organization_id, course_id, version_number),
  CONSTRAINT training_course_versions_status_check CHECK (status IN ('draft','published','archived')),
  CONSTRAINT training_course_versions_published_check CHECK ((status <> 'published') OR published_at IS NOT NULL)
);
CREATE TRIGGER training_course_versions_set_updated_at
  BEFORE UPDATE ON training_course_versions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX training_course_versions_current_idx
  ON training_course_versions (organization_id, course_id, status, version_number DESC);
SELECT enable_tenant_rls('training_course_versions');

ALTER TABLE training_courses
  ADD CONSTRAINT training_courses_current_version_fk_v2
  FOREIGN KEY (organization_id, current_version_id)
  REFERENCES training_course_versions(organization_id, id) DEFERRABLE INITIALLY DEFERRED;

INSERT INTO training_course_versions (organization_id, course_id, version_number, status, title_snapshot, content_snapshot, published_at)
SELECT c.organization_id, c.id, 1,
       CASE WHEN c.is_active THEN 'published' ELSE 'archived' END,
       c.name,
       jsonb_build_object('description', c.description, 'category', c.category, 'legacy', true),
       CASE WHEN c.is_active THEN now() ELSE NULL END
  FROM training_courses c
ON CONFLICT (organization_id, course_id, version_number) DO NOTHING;

UPDATE training_courses c
   SET current_version_id = v.id
  FROM training_course_versions v
 WHERE v.organization_id=c.organization_id
   AND v.course_id=c.id
   AND v.version_number=1
   AND c.current_version_id IS NULL;

ALTER TABLE training_assignments
  ADD COLUMN IF NOT EXISTS course_version_id uuid;
ALTER TABLE training_assignments
  ADD CONSTRAINT training_assignments_course_version_fk_v2
  FOREIGN KEY (organization_id, course_version_id)
  REFERENCES training_course_versions(organization_id, id) ON DELETE RESTRICT;
UPDATE training_assignments a
   SET course_version_id=c.current_version_id
  FROM training_courses c
 WHERE c.organization_id=a.organization_id
   AND c.id=a.course_id
   AND a.course_version_id IS NULL;
CREATE INDEX training_assignments_course_version_idx_v2
  ON training_assignments (organization_id, course_version_id, employee_id, status);

CREATE TABLE training_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL,
  version_id uuid NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  introduction text,
  summary text,
  sort_order integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_modules_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT training_modules_course_fk FOREIGN KEY (organization_id, course_id) REFERENCES training_courses(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT training_modules_version_fk FOREIGN KEY (organization_id, version_id) REFERENCES training_course_versions(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT training_modules_code_unique UNIQUE (organization_id, version_id, code),
  CONSTRAINT training_modules_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT training_modules_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT training_modules_sort_non_negative CHECK (sort_order >= 0)
);
CREATE TRIGGER training_modules_set_updated_at BEFORE UPDATE ON training_modules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX training_modules_outline_idx ON training_modules(organization_id, version_id, sort_order, created_at);
SELECT enable_tenant_rls('training_modules');

CREATE TABLE training_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL,
  version_id uuid NOT NULL,
  module_id uuid NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  summary text,
  estimated_duration_minutes integer,
  sort_order integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  require_sequential boolean NOT NULL DEFAULT false,
  completion_mode text NOT NULL DEFAULT 'learner_confirmation',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_lessons_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT training_lessons_course_fk FOREIGN KEY (organization_id, course_id) REFERENCES training_courses(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT training_lessons_version_fk FOREIGN KEY (organization_id, version_id) REFERENCES training_course_versions(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT training_lessons_module_fk FOREIGN KEY (organization_id, module_id) REFERENCES training_modules(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT training_lessons_code_unique UNIQUE (organization_id, version_id, code),
  CONSTRAINT training_lessons_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT training_lessons_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT training_lessons_duration_range CHECK (estimated_duration_minutes IS NULL OR estimated_duration_minutes BETWEEN 1 AND 1440),
  CONSTRAINT training_lessons_sort_non_negative CHECK (sort_order >= 0),
  CONSTRAINT training_lessons_completion_mode CHECK (completion_mode IN ('learner_confirmation','supervisor_validation'))
);
CREATE TRIGGER training_lessons_set_updated_at BEFORE UPDATE ON training_lessons FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX training_lessons_outline_idx ON training_lessons(organization_id, module_id, sort_order, created_at);
SELECT enable_tenant_rlS('training_lessons');

CREATE TABLE training_content_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL,
  block_type text NOT NULL,
  title text,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_id uuid,
  external_url text,
  captions text,
  transcript text,
  minimum_watched_percent numeric(5,2) NOT NULL DEFAULT 90,
  allow_download boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_content_blocks_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT training_content_blocks_lesson_fk FOREIGN KEY (organization_id, lesson_id) REFERENCES training_lessons(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT training_content_blocks_document_fk FOREIGN KEY (organization_id, document_id) REFERENCES documents(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT training_content_blocks_type_check CHECK (block_type IN ('heading','text','image','document','video','audio','file','link','callout','checklist','procedure','acknowledgment','reflection','single_question','quiz','supervisor_verification')),
  CONSTRAINT training_content_blocks_content_object CHECK (jsonb_typeof(content) = 'object'),
  CONSTRAINT training_content_blocks_watch_range CHECK (minimum_watched_percent BETWEEN 1 AND 100),
  CONSTRAINT training_content_blocks_sort_non_negative CHECK (sort_order >= 0)
);
CREATE TRIGGER training_content_blocks_set_updated_at BEFORE UPDATE ON training_content_blocks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX training_content_blocks_lesson_idx ON training_content_blocks(organization_id, lesson_id, sort_order, created_at);
SELECT enable_tenant_rls('training_content_blocks');

CREATE TABLE training_assignment_lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'not_started',
  completed_at timestamptz,
  supervisor_verified_at timestamptz,
  supervisor_verified_by uuid REFERENCES users(id) ON DELETE SET NULL,
  last_opened_at timestamptz,
  last_block_id uuid,
  last_video_position_seconds integer NOT NULL DEFAULT 0,
  watched_seconds integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_assignment_lesson_progress_assignment_fk FOREIGN KEY (organization_id, assignment_id) REFERENCES training_assignments(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT training_assignment_lesson_progress_lesson_fk FOREIGN KEY (organization_id, lesson_id) REFERENCES training_lessons(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT training_assignment_lesson_progress_unique UNIQUE (organization_id, assignment_id, lesson_id),
  CONSTRAINT training_assignment_lesson_progress_status CHECK (status IN ('not_started','in_progress','awaiting_validation','completed','failed')),
  CONSTRAINT training_assignment_lesson_progress_position_non_negative CHECK (last_video_position_seconds >= 0 AND watched_seconds >= 0)
);
CREATE TRIGGER training_assignment_lesson_progress_set_updated_at BEFORE UPDATE ON training_assignment_lesson_progress FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX training_assignment_lesson_progress_assignment_idx ON training_assignment_lesson_progress(organization_id, assignment_id, status);
SELECT enable_tenant_rls('training_assignment_lesson_progress');

CREATE TABLE training_quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL,
  lesson_id uuid,
  block_id uuid,
  attempt_number integer NOT NULL,
  status text NOT NULL DEFAULT 'submitted',
  score numeric(5,2),
  passed boolean,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  graded_at timestamptz,
  graded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_quiz_attempts_assignment_fk FOREIGN KEY (organization_id, assignment_id) REFERENCES training_assignments(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT training_quiz_attempts_lesson_fk FOREIGN KEY (organization_id, lesson_id) REFERENCES training_lessons(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT training_quiz_attempts_block_fk FOREIGN KEY (organization_id, block_id) REFERENCES training_content_blocks(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT training_quiz_attempts_unique UNIQUE (organization_id, assignment_id, block_id, attempt_number),
  CONSTRAINT training_quiz_attempts_status CHECK (status IN ('submitted','awaiting_grading','graded')),
  CONSTRAINT training_quiz_attempts_score_range CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  CONSTRAINT training_quiz_attempts_answers_array CHECK (jsonb_typeof(answers)='array')
);
CREATE INDEX training_quiz_attempts_assignment_idx ON training_quiz_attempts(organization_id, assignment_id, block_id, submitted_at DESC);
SELECT enable_tenant_rls('training_quiz_attempts');

CREATE TABLE training_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  course_id uuid NOT NULL,
  course_version_id uuid,
  certificate_number text NOT NULL,
  verification_token uuid NOT NULL DEFAULT gen_random_uuid(),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_on date,
  score numeric(5,2),
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_certificates_assignment_unique UNIQUE (organization_id, assignment_id),
  CONSTRAINT training_certificates_number_unique UNIQUE (organization_id, certificate_number),
  CONSTRAINT training_certificates_token_unique UNIQUE (verification_token),
  CONSTRAINT training_certificates_assignment_fk FOREIGN KEY (organization_id, assignment_id) REFERENCES training_assignments(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT training_certificates_employee_fk FOREIGN KEY (organization_id, employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT training_certificates_course_fk FOREIGN KEY (organization_id, course_id) REFERENCES training_courses(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT training_certificates_version_fk FOREIGN KEY (organization_id, course_version_id) REFERENCES training_course_versions(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT training_certificates_score_range CHECK (score IS NULL OR score BETWEEN 0 AND 100)
);
CREATE INDEX training_certificates_employee_idx ON training_certificates(organization_id, employee_id, expires_on DESC);
SELECT enable_tenant_rls('training_certificates');

CREATE TABLE training_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id uuid,
  version_id uuid,
  assignment_id uuid,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_audit_events_detail_object CHECK (jsonb_typeof(detail)='object')
);
CREATE INDEX training_audit_events_timeline_idx ON training_audit_events(organization_id, course_id, assignment_id, created_at DESC);
SELECT enable_tenant_rls('training_audit_events');