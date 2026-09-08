-- 080_operational_sales_and_revenue.sql
-- Commercial availability is a thin layer over real operational production.
-- It stores a sellable offer and price, never a second stock balance.  The
-- available quantity is calculated by the sales service from the original
-- poultry, pig, harvest or inventory record minus confirmed deliveries.

CREATE TABLE sales_operational_offers (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  code                text NOT NULL,
  title               text NOT NULL,
  source_type         text NOT NULL,
  source_id           uuid NOT NULL,
  province_id         uuid,
  site_id             uuid,
  unit                text NOT NULL,
  default_unit_price  numeric(16,2),
  currency            char(3),
  minimum_quantity    numeric(14,3) NOT NULL DEFAULT 0,
  is_available        boolean NOT NULL DEFAULT true,
  ecommerce_status    text NOT NULL DEFAULT 'internal',
  notes               text,
  created_by          uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT sales_operational_offers_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT sales_operational_offers_code_unique UNIQUE (organization_id, code),
  CONSTRAINT sales_operational_offers_source_unique UNIQUE (organization_id, source_type, source_id),
  CONSTRAINT sales_operational_offers_code_format
    CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$'),
  CONSTRAINT sales_operational_offers_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT sales_operational_offers_source_type_check
    CHECK (source_type IN ('egg_flock', 'poultry_flock', 'pig_group', 'pig_animal', 'harvest_planting', 'inventory_item')),
  CONSTRAINT sales_operational_offers_unit_not_blank CHECK (btrim(unit) <> ''),
  CONSTRAINT sales_operational_offers_price_nonnegative
    CHECK (default_unit_price IS NULL OR default_unit_price >= 0),
  CONSTRAINT sales_operational_offers_minimum_nonnegative CHECK (minimum_quantity >= 0),
  CONSTRAINT sales_operational_offers_currency_format
    CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  CONSTRAINT sales_operational_offers_ecommerce_status_check
    CHECK (ecommerce_status IN ('internal', 'ready_for_sync', 'synced', 'paused')),
  CONSTRAINT sales_operational_offers_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT sales_operational_offers_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL (site_id)
);

CREATE TRIGGER sales_operational_offers_set_updated_at
  BEFORE UPDATE ON sales_operational_offers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX sales_operational_offers_available_idx
  ON sales_operational_offers (organization_id, source_type, site_id)
  WHERE is_available;
SELECT enable_tenant_rls('sales_operational_offers');

ALTER TABLE sales_order_lines
  ADD COLUMN operational_offer_id uuid;

ALTER TABLE sales_order_lines
  ADD CONSTRAINT sales_order_lines_operational_offer_fk
  FOREIGN KEY (organization_id, operational_offer_id)
  REFERENCES sales_operational_offers (organization_id, id)
  ON DELETE SET NULL (operational_offer_id);

CREATE INDEX sales_order_lines_offer_idx
  ON sales_order_lines (organization_id, operational_offer_id)
  WHERE operational_offer_id IS NOT NULL;

-- Explicitly keep the distinction between an order reservation and a real
-- physical delivery.  Only a delivery with status = delivered reduces supply.
COMMENT ON TABLE sales_operational_offers IS
  'Commercial listing linked to real production or inventory; it intentionally stores no stock balance.';
