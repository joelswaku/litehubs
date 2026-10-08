-- 166_poultry_management_insights.sql
-- Data needed by the poultry management cockpit: house ambiance, sanitary
-- downtime between flocks, a feed price for feed that is not issued from
-- stock, and the other running costs of a flock.  Every indicator (IEP, cost
-- per kg, egg stock, alerts, forecasts) is calculated from these records; no
-- result is stored twice.

ALTER TABLE poultry_daily_records
  ADD COLUMN IF NOT EXISTS light_hours numeric(4,1),
  ADD COLUMN IF NOT EXISTS ammonia_ppm numeric(6,1);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'poultry_daily_records_light_check') THEN
    ALTER TABLE poultry_daily_records
      ADD CONSTRAINT poultry_daily_records_light_check
        CHECK (light_hours IS NULL OR light_hours BETWEEN 0 AND 24);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'poultry_daily_records_ammonia_check') THEN
    ALTER TABLE poultry_daily_records
      ADD CONSTRAINT poultry_daily_records_ammonia_check
        CHECK (ammonia_ppm IS NULL OR ammonia_ppm BETWEEN 0 AND 500);
  END IF;
END $$;

-- Minimum empty period (vide sanitaire) between two flocks in the same house.
-- 0 disables the check for that house.
ALTER TABLE poultry_houses
  ADD COLUMN IF NOT EXISTS min_downtime_days integer NOT NULL DEFAULT 14;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'poultry_houses_min_downtime_check') THEN
    ALTER TABLE poultry_houses
      ADD CONSTRAINT poultry_houses_min_downtime_check
        CHECK (min_downtime_days BETWEEN 0 AND 180);
  END IF;
END $$;

-- Price per kg for feed bought outside the stock module.  Feed issued from a
-- warehouse keeps using the cost of its stock movement.
ALTER TABLE poultry_feed_records
  ADD COLUMN IF NOT EXISTS unit_price numeric(14,4);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'poultry_feed_records_unit_price_check') THEN
    ALTER TABLE poultry_feed_records
      ADD CONSTRAINT poultry_feed_records_unit_price_check
        CHECK (unit_price IS NULL OR unit_price >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS poultry_flock_costs (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flock_id            uuid NOT NULL,
  cost_date           date NOT NULL,
  category            text NOT NULL,
  description         text,
  amount              numeric(16,2) NOT NULL,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_flock_costs_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_flock_costs_flock_fk
    FOREIGN KEY (organization_id, flock_id)
    REFERENCES poultry_flocks (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT poultry_flock_costs_category_check
    CHECK (category IN ('feed', 'health', 'labour', 'energy', 'litter', 'water', 'transport', 'slaughter', 'equipment', 'other')),
  CONSTRAINT poultry_flock_costs_amount_check CHECK (amount >= 0),
  CONSTRAINT poultry_flock_costs_description_check
    CHECK (description IS NULL OR btrim(description) <> '')
);

DROP TRIGGER IF EXISTS poultry_flock_costs_set_updated_at ON poultry_flock_costs;
CREATE TRIGGER poultry_flock_costs_set_updated_at
  BEFORE UPDATE ON poultry_flock_costs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS poultry_flock_costs_flock_idx
  ON poultry_flock_costs (organization_id, flock_id, cost_date);

SELECT enable_tenant_rls('poultry_flock_costs');

COMMENT ON TABLE poultry_flock_costs IS
  'Running costs of a flock not already captured by stock issues (labour, energy, litter, health, transport...). Feeds the real-time cost price.';
