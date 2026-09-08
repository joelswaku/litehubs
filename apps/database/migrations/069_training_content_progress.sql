-- 069_training_content_progress.sql
-- A learner's official evidence is per content block. The server uses the
-- heartbeat timestamps to cap video progress, so a seek-to-end cannot pass a video.

CREATE TABLE training_assignment_content_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  block_id uuid NOT NULL,
  opened_at timestamptz,
  completed_at timestamptz,
  acknowledged_at timestamptz,
  checklist_state jsonb NOT NULL DEFAULT '[]'::jsonb,
  response_text text,
  watched_seconds integer NOT NULL DEFAULT 0,
  last_video_position_seconds integer NOT NULL DEFAULT 0,
  last_heartbeat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_assignment_content_progress_org_id_unique UNIQUE (organization_id,id),
  CONSTRAINT training_assignment_content_progress_assignment_fk FOREIGN KEY (organization_id,assignment_id) REFERENCES training_assignments(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT training_assignment_content_progress_lesson_fk FOREIGN KEY (organization_id,lesson_id) REFERENCES training_lessons(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT training_assignment_content_progress_block_fk FOREIGN KEY (organization_id,block_id) REFERENCES training_content_blocks(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT training_assignment_content_progress_unique UNIQUE (organization_id,assignment_id,block_id),
  CONSTRAINT training_assignment_content_progress_checklist_array CHECK (jsonb_typeof(checklist_state)='array'),
  CONSTRAINT training_assignment_content_progress_video_non_negative CHECK (watched_seconds >= 0 AND last_video_position_seconds >= 0)
);
CREATE TRIGGER training_assignment_content_progress_set_updated_at
  BEFORE UPDATE ON training_assignment_content_progress FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX training_assignment_content_progress_assignment_idx
  ON training_assignment_content_progress (organization_id,assignment_id,lesson_id,completed_at);
SELECT enable_tenant_rls('training_assignment_content_progress');