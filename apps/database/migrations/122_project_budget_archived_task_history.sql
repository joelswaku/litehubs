-- Archived (cancelled) work remains part of the financial history and budget
-- allocation. Rebuild the index created by migration 121 accordingly.
DROP INDEX IF EXISTS management_project_tasks_project_budget_idx;
CREATE INDEX management_project_tasks_project_budget_idx
  ON management_project_tasks (organization_id, project_id)
  WHERE task_type = 'work';