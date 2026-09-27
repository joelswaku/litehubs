-- Project budget by task. The project estimated_total_budget remains the sole
-- budget authority; task estimates only allocate that existing amount.
ALTER TABLE management_project_tasks
  ADD COLUMN IF NOT EXISTS budget_currency_code char(3),
  ADD COLUMN IF NOT EXISTS budget_override_reason text;

ALTER TABLE management_purchase_orders
  ADD COLUMN IF NOT EXISTS budget_override_reason text;
ALTER TABLE management_receipts
  ADD COLUMN IF NOT EXISTS budget_override_reason text;
ALTER TABLE management_expenses
  ADD COLUMN IF NOT EXISTS budget_override_reason text;

-- Preserve valid historical currencies, discard only legacy values outside the
-- supported project-budget currencies, then inherit a valid project currency.
UPDATE management_project_tasks
SET budget_currency_code = NULL
WHERE budget_currency_code IS NOT NULL
  AND UPPER(BTRIM(budget_currency_code)) NOT IN ('CDF', 'USD', 'EUR');

UPDATE management_project_tasks task
SET budget_currency_code = UPPER(BTRIM(project.currency_code))::char(3)
FROM management_projects project
WHERE project.organization_id = task.organization_id
  AND project.id = task.project_id
  AND task.budget_currency_code IS NULL
  AND UPPER(BTRIM(project.currency_code)) IN ('CDF', 'USD', 'EUR');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'management_project_tasks_budget_currency_check'
  ) THEN
    ALTER TABLE management_project_tasks
      ADD CONSTRAINT management_project_tasks_budget_currency_check
      CHECK (budget_currency_code IS NULL OR budget_currency_code IN ('CDF', 'USD', 'EUR'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS management_project_tasks_project_budget_idx
  ON management_project_tasks (organization_id, project_id)
  WHERE task_type = 'work' AND status <> 'cancelled';

COMMENT ON COLUMN management_project_tasks.estimated_cost IS
  'Budget planned for this individual work task. It allocates the main project budget and is not an additional budget.';
COMMENT ON COLUMN management_project_tasks.budget_override_reason IS
  'Owner justification retained when task allocations exceed the project main budget.';