BEGIN;

-- A dependency can now connect two projects in the same organization.  The
-- existing tenant foreign keys already guarantee that both ends are local to
-- the company; the application additionally restricts cross-project links to
-- the workspace owner and checks cycles before an edge is stored.
COMMENT ON TABLE management_project_phase_dependencies IS
  'Prerequisite relationships between phases. Links may cross projects inside one organization.';
COMMENT ON TABLE management_task_dependencies IS
  'Prerequisite relationships between tasks. Links may cross projects inside one organization.';

-- The Gantt board repeatedly reads planned dates by project. These indices do
-- not change existing data and keep the board responsive as project history
-- grows.
CREATE INDEX IF NOT EXISTS management_project_phases_schedule_idx
  ON management_project_phases (organization_id, project_id, start_date, target_end_date);
CREATE INDEX IF NOT EXISTS management_project_tasks_schedule_idx
  ON management_project_tasks (organization_id, project_id, start_date, due_date);
CREATE INDEX IF NOT EXISTS management_task_dependencies_waiting_idx
  ON management_task_dependencies (organization_id, task_id);

COMMIT;
