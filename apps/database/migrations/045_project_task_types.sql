-- Separate executable project work from delivery checkpoints.
ALTER TABLE management_project_tasks
  ADD COLUMN task_type text NOT NULL DEFAULT 'work',
  ADD CONSTRAINT management_project_tasks_type_check
    CHECK (task_type IN ('work', 'milestone'));

CREATE INDEX management_project_tasks_project_type_status_idx
  ON management_project_tasks (organization_id, project_id, task_type, status);

COMMENT ON COLUMN management_project_tasks.task_type IS
  'work is an actionable assignment; milestone is a project checkpoint and never appears in Daily Work.';
