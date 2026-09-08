-- A project may have many tasks or milestones without a manually assigned code.
ALTER TABLE management_project_tasks
  DROP CONSTRAINT management_project_tasks_code_unique;

ALTER TABLE management_project_tasks
  ADD CONSTRAINT management_project_tasks_code_unique
    UNIQUE (organization_id, project_id, code);
