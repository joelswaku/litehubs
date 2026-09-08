BEGIN;

-- A task describes the work. Its actual cost is derived from approved financial
-- evidence, never typed by an operator. These links keep expenses and purchase
-- commitments in the same tenant/project/task scope.
ALTER TABLE management_expenses
  ADD COLUMN project_task_id uuid,
  ADD CONSTRAINT management_expenses_task_fk FOREIGN KEY (organization_id, project_task_id)
    REFERENCES management_project_tasks (organization_id, id) ON DELETE SET NULL;

ALTER TABLE management_purchase_requests
  ADD COLUMN project_task_id uuid,
  ADD CONSTRAINT management_purchase_requests_task_fk FOREIGN KEY (organization_id, project_task_id)
    REFERENCES management_project_tasks (organization_id, id) ON DELETE SET NULL;

ALTER TABLE management_purchase_orders
  ADD COLUMN project_task_id uuid,
  ADD CONSTRAINT management_purchase_orders_task_fk FOREIGN KEY (organization_id, project_task_id)
    REFERENCES management_project_tasks (organization_id, id) ON DELETE SET NULL;

CREATE INDEX management_expenses_task_status_idx
  ON management_expenses (organization_id, project_task_id, status)
  WHERE project_task_id IS NOT NULL;

CREATE INDEX management_purchase_requests_task_idx
  ON management_purchase_requests (organization_id, project_task_id)
  WHERE project_task_id IS NOT NULL;

CREATE INDEX management_purchase_orders_task_status_idx
  ON management_purchase_orders (organization_id, project_task_id, status)
  WHERE project_task_id IS NOT NULL;

COMMENT ON COLUMN management_project_tasks.actual_cost IS
  'Legacy cache only. LiteHubs now derives task actual cost from linked approved or paid expenses.';
COMMENT ON COLUMN management_expenses.project_task_id IS
  'Optional task funded by this expense; must belong to the same project.';
COMMENT ON COLUMN management_purchase_requests.project_task_id IS
  'Optional task that requested this purchase; must belong to the same project.';
COMMENT ON COLUMN management_purchase_orders.project_task_id IS
  'Optional task fulfilled by this purchase order; must belong to the same project.';

COMMIT;

