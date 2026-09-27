-- The project has one authoritative main budget. Budget lines only allocate it,
-- and each costed task must reserve its estimate from exactly one allocation.
ALTER TABLE management_project_tasks
  ADD COLUMN IF NOT EXISTS budget_line_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'management_project_tasks_budget_line_fk'
  ) THEN
    ALTER TABLE management_project_tasks
      ADD CONSTRAINT management_project_tasks_budget_line_fk
      FOREIGN KEY (organization_id, budget_line_id)
      REFERENCES management_project_budget_lines (organization_id, id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS management_project_tasks_budget_line_idx
  ON management_project_tasks (organization_id, budget_line_id)
  WHERE budget_line_id IS NOT NULL;

COMMENT ON COLUMN management_project_tasks.budget_line_id IS
  'Budget allocation funding this task estimate. The service verifies that the task belongs to the same project and that all task estimates stay inside the allocation.';