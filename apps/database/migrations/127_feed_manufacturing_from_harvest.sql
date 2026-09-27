-- Harvest can be transformed into finished feed rather than being sold directly.
-- A confirmed batch consumes its declared inputs and creates one stock balance
-- for the finished feed.  The actual ledger effects are performed atomically by
-- the application service so stock can never be issued twice.

ALTER TABLE poultry_feed_records
  ADD COLUMN IF NOT EXISTS warehouse_id uuid,
  ADD CONSTRAINT poultry_feed_warehouse_fk FOREIGN KEY (organization_id, warehouse_id)
    REFERENCES management_warehouses (organization_id, id) ON DELETE SET NULL;

ALTER TABLE pig_feed_records
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid,
  ADD COLUMN IF NOT EXISTS warehouse_id uuid,
  ADD CONSTRAINT pig_feed_inventory_item_fk FOREIGN KEY (organization_id, inventory_item_id)
    REFERENCES management_inventory_items (organization_id, id) ON DELETE SET NULL,
  ADD CONSTRAINT pig_feed_warehouse_fk FOREIGN KEY (organization_id, warehouse_id)
    REFERENCES management_warehouses (organization_id, id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS poultry_feed_warehouse_idx
  ON poultry_feed_records (organization_id, warehouse_id)
  WHERE warehouse_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pig_feed_inventory_item_idx
  ON pig_feed_records (organization_id, inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pig_feed_warehouse_idx
  ON pig_feed_records (organization_id, warehouse_id)
  WHERE warehouse_id IS NOT NULL;
-- A distribution record can write exactly one stock issue. This protects the
-- livestock ledger against accidental retries and keeps inventory immutable.
CREATE UNIQUE INDEX IF NOT EXISTS management_stock_poultry_feed_issue_unique
  ON management_inventory_stock_movements (organization_id, reference_type, reference_id)
  WHERE reference_type = 'poultry_feed' AND reference_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS management_stock_pig_feed_issue_unique
  ON management_inventory_stock_movements (organization_id, reference_type, reference_id)
  WHERE reference_type = 'pig_feed' AND reference_id IS NOT NULL;

CREATE TABLE management_feed_batches (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id            uuid,
  site_id               uuid NOT NULL,
  warehouse_id          uuid NOT NULL,
  batch_number          text NOT NULL,
  feed_name             text NOT NULL,
  target_species        text NOT NULL DEFAULT 'mixed',
  production_date       date NOT NULL DEFAULT current_date,
  output_item_id        uuid,
  output_quantity_kg    numeric(14,3) NOT NULL,
  bag_weight_kg         numeric(14,3) NOT NULL DEFAULT 50,
  bag_count             numeric(14,3) NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'draft',
  produced_by_member_id uuid,
  stock_applied_at      timestamptz,
  cancelled_at          timestamptz,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_feed_batches_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_feed_batches_number_unique UNIQUE (organization_id, batch_number),
  CONSTRAINT management_feed_batches_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_feed_batches_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_feed_batches_warehouse_fk FOREIGN KEY (organization_id, warehouse_id)
    REFERENCES management_warehouses (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_feed_batches_output_item_fk FOREIGN KEY (organization_id, output_item_id)
    REFERENCES management_inventory_items (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_feed_batches_producer_fk FOREIGN KEY (organization_id, produced_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_feed_batches_species_check CHECK (target_species IN ('poultry', 'pigs', 'mixed')),
  CONSTRAINT management_feed_batches_status_check CHECK (status IN ('draft', 'confirmed', 'cancelled')),
  CONSTRAINT management_feed_batches_values_check CHECK (
    output_quantity_kg > 0 AND bag_weight_kg > 0 AND bag_count >= 0
  ),
  CONSTRAINT management_feed_batches_text_check CHECK (
    btrim(batch_number) <> '' AND btrim(feed_name) <> '' AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER management_feed_batches_set_updated_at BEFORE UPDATE ON management_feed_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_feed_batches_site_date_idx
  ON management_feed_batches (organization_id, site_id, production_date DESC);
CREATE INDEX management_feed_batches_project_idx
  ON management_feed_batches (organization_id, project_id)
  WHERE project_id IS NOT NULL;
SELECT enable_tenant_rls('management_feed_batches');

CREATE TABLE management_feed_batch_inputs (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  batch_id            uuid NOT NULL,
  source_type         text NOT NULL,
  harvest_record_id   uuid,
  inventory_item_id   uuid,
  warehouse_id        uuid,
  quantity_kg         numeric(14,3) NOT NULL,
  unit_cost           numeric(16,2),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_feed_batch_inputs_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_feed_batch_inputs_batch_fk FOREIGN KEY (organization_id, batch_id)
    REFERENCES management_feed_batches (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_feed_batch_inputs_harvest_fk FOREIGN KEY (organization_id, harvest_record_id)
    REFERENCES agriculture_harvest_records (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_feed_batch_inputs_item_fk FOREIGN KEY (organization_id, inventory_item_id)
    REFERENCES management_inventory_items (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_feed_batch_inputs_warehouse_fk FOREIGN KEY (organization_id, warehouse_id)
    REFERENCES management_warehouses (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_feed_batch_inputs_source_check CHECK (
    (source_type = 'harvest' AND harvest_record_id IS NOT NULL AND inventory_item_id IS NULL AND warehouse_id IS NULL) OR
    (source_type = 'inventory' AND harvest_record_id IS NULL AND inventory_item_id IS NOT NULL AND warehouse_id IS NOT NULL)
  ),
  CONSTRAINT management_feed_batch_inputs_values_check CHECK (
    quantity_kg > 0 AND (unit_cost IS NULL OR unit_cost >= 0)
  ),
  CONSTRAINT management_feed_batch_inputs_text_check CHECK (
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER management_feed_batch_inputs_set_updated_at BEFORE UPDATE ON management_feed_batch_inputs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_feed_batch_inputs_batch_idx
  ON management_feed_batch_inputs (organization_id, batch_id);
CREATE INDEX management_feed_batch_inputs_harvest_idx
  ON management_feed_batch_inputs (organization_id, harvest_record_id)
  WHERE harvest_record_id IS NOT NULL;
SELECT enable_tenant_rls('management_feed_batch_inputs');

COMMENT ON TABLE management_feed_batches IS
  'Finished feed manufactured from agricultural harvests and/or stocked ingredients. A confirmed batch adds bags to inventory exactly once.';
COMMENT ON TABLE management_feed_batch_inputs IS
  'Inputs for one feed batch. Harvest inputs reduce the harvest available for sale; inventory inputs are issued from their declared warehouse.';
