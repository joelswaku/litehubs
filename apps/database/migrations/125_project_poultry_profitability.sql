-- Keeps the project-to-flock reporting path fast without copying financial or
-- production records into a second ledger.  The report derives revenue from
-- delivered sales and costs from the existing project budget records.

CREATE INDEX IF NOT EXISTS management_project_operational_links_poultry_flock_profitability_idx
  ON management_project_operational_links (organization_id, project_id, record_id)
  WHERE module_code = 'poultry' AND resource_code = 'flocks';

CREATE INDEX IF NOT EXISTS sales_orders_profitability_status_currency_idx
  ON sales_orders (organization_id, status, currency, id)
  WHERE status IN ('partially_delivered', 'delivered', 'invoiced');

CREATE INDEX IF NOT EXISTS sales_invoices_profitability_order_currency_idx
  ON sales_invoices (organization_id, order_id, currency, id)
  WHERE status NOT IN ('draft', 'cancelled', 'written_off');

COMMENT ON TABLE management_project_operational_links IS
  'A tenant-safe, non-duplicating link from an investment project to operations. Linked poultry flocks automatically feed project production profitability from delivered sales and recorded project costs.';
