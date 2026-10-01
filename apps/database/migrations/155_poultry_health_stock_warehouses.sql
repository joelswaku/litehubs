-- Medical and sanitation records may identify the stock location from which a
-- product was issued. The field is optional, so existing records remain valid.
ALTER TABLE poultry_vaccination_records
  ADD COLUMN IF NOT EXISTS warehouse_id uuid;

ALTER TABLE poultry_treatment_records
  ADD COLUMN IF NOT EXISTS warehouse_id uuid;

ALTER TABLE poultry_sanitation_records
  ADD COLUMN IF NOT EXISTS warehouse_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'poultry_vaccination_warehouse_fk') THEN
    ALTER TABLE poultry_vaccination_records
      ADD CONSTRAINT poultry_vaccination_warehouse_fk
      FOREIGN KEY (organization_id, warehouse_id)
      REFERENCES management_warehouses (organization_id, id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'poultry_treatment_warehouse_fk') THEN
    ALTER TABLE poultry_treatment_records
      ADD CONSTRAINT poultry_treatment_warehouse_fk
      FOREIGN KEY (organization_id, warehouse_id)
      REFERENCES management_warehouses (organization_id, id)
      ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'poultry_sanitation_warehouse_fk') THEN
    ALTER TABLE poultry_sanitation_records
      ADD CONSTRAINT poultry_sanitation_warehouse_fk
      FOREIGN KEY (organization_id, warehouse_id)
      REFERENCES management_warehouses (organization_id, id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS poultry_vaccination_warehouse_idx
  ON poultry_vaccination_records (organization_id, warehouse_id)
  WHERE warehouse_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS poultry_treatment_warehouse_idx
  ON poultry_treatment_records (organization_id, warehouse_id)
  WHERE warehouse_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS poultry_sanitation_warehouse_idx
  ON poultry_sanitation_records (organization_id, warehouse_id)
  WHERE warehouse_id IS NOT NULL;
