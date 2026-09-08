-- Shared Operations: a task may be company work or project work.  Project tasks
-- keep their existing project/phase links; a normal task carries its own location.
ALTER TABLE management_project_tasks
  ALTER COLUMN project_id DROP NOT NULL,
  ADD COLUMN province_id uuid,
  ADD COLUMN site_id uuid,
  ADD CONSTRAINT management_project_tasks_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT management_project_tasks_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL,
  ADD CONSTRAINT management_project_tasks_scope_check
    CHECK (project_id IS NOT NULL OR province_id IS NOT NULL),
  ADD CONSTRAINT management_project_tasks_normal_task_phase_check
    CHECK (project_id IS NOT NULL OR phase_id IS NULL);

CREATE INDEX management_project_tasks_province_status_due_idx
  ON management_project_tasks (organization_id, province_id, status, due_date)
  WHERE project_id IS NULL;
CREATE INDEX management_project_tasks_site_status_due_idx
  ON management_project_tasks (organization_id, site_id, status, due_date)
  WHERE project_id IS NULL AND site_id IS NOT NULL;

COMMENT ON COLUMN management_project_tasks.project_id IS
  'NULL for a normal company task; populated for a task created from Project Control Centre.';
COMMENT ON COLUMN management_project_tasks.province_id IS
  'Required for a normal company task so province-scoped roles remain isolated.';