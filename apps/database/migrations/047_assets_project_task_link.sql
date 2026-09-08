-- Assets can be acquired for a specific executable project work item.
ALTER TABLE management_assets
  ADD COLUMN project_task_id uuid,
  ADD CONSTRAINT management_assets_task_fk FOREIGN KEY (organization_id, project_task_id)
    REFERENCES management_project_tasks (organization_id, id) ON DELETE SET NULL;

CREATE INDEX management_assets_project_task_idx
  ON management_assets (organization_id, project_task_id)
  WHERE project_task_id IS NOT NULL;

COMMENT ON COLUMN management_assets.project_task_id IS
  'Optional executable work item that acquired this asset; milestones cannot be linked.';
