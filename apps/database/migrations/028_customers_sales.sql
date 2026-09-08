-- 028_customers_sales.sql
-- The revenue side: who buys, what they ordered, what was invoiced, what was
-- paid. Mirrors the purchasing side already built in 021/022, deliberately —
-- a supplier and a customer are the same shape pointed the other way, and
-- keeping the two symmetrical means reports can treat them alike.
--
-- Money rules that shape every table here:
--
--   1. **Amounts are numeric, never float.** `numeric(16,2)` for totals,
--      `numeric(14,3)` for quantities. `utils/money.ts` does the arithmetic in
--      Decimal so a hundred invoice lines still add up to the footer.
--   2. **Currency is recorded on the document, not just the organization.** An
--      organization can trade in more than one, and an invoice reprinted years
--      later must show the currency it was issued in, not today's default.
--   3. **Totals are stored, not derived on read.** An issued invoice is a legal
--      document; if a tax rate changes, last year's invoice must not silently
--      re-total. The service recomputes on edit while the invoice is a draft
--      and freezes it on issue.

-- ------------------------------------------------------------- customers ----
CREATE TABLE customers (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  code              text NOT NULL,
  name              text NOT NULL,
  customer_type     text NOT NULL DEFAULT 'business',
  -- Who to talk to. Kept flat rather than a contacts table until a customer
  -- demonstrably needs several; a premature join costs every read.
  contact_name      text,
  phone             text,
  email             citext,
  tax_number        text,
  address_line1     text,
  address_line2     text,
  city              text,
  region            text,
  postal_code       text,
  country           text,
  -- Commercial terms.
  currency          char(3),
  payment_terms_days integer NOT NULL DEFAULT 0,
  credit_limit      numeric(16,2),
  province_id       uuid,
  is_active         boolean NOT NULL DEFAULT true,
  notes             text,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT customers_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT customers_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT customers_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT customers_code_format
    CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$'),
  CONSTRAINT customers_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT customers_type_check
    CHECK (customer_type IN ('business', 'individual', 'government',
                             'cooperative', 'internal')),
  CONSTRAINT customers_currency_format
    CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  CONSTRAINT customers_terms_range CHECK (payment_terms_days BETWEEN 0 AND 365),
  CONSTRAINT customers_credit_limit_non_negative
    CHECK (credit_limit IS NULL OR credit_limit >= 0),
  CONSTRAINT customers_country_format
    CHECK (country IS NULL OR country ~ '^[A-Z]{2}$')
);

CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX customers_name_idx ON customers (organization_id, name) WHERE is_active;
CREATE INDEX customers_province_idx ON customers (organization_id, province_id);

SELECT enable_tenant_rls('customers');

-- ---------------------------------------------------------- sales orders ----
CREATE TABLE sales_orders (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  customer_id       uuid NOT NULL,
  province_id       uuid,
  site_id           uuid,
  order_number      text NOT NULL,
  order_date        date NOT NULL DEFAULT CURRENT_DATE,
  required_date     date,
  status            text NOT NULL DEFAULT 'draft',
  currency          char(3) NOT NULL,
  -- Frozen from the lines when the order is confirmed.
  subtotal          numeric(16,2) NOT NULL DEFAULT 0,
  tax_total         numeric(16,2) NOT NULL DEFAULT 0,
  discount_total    numeric(16,2) NOT NULL DEFAULT 0,
  total             numeric(16,2) NOT NULL DEFAULT 0,
  notes             text,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  confirmed_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  confirmed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT sales_orders_number_unique_per_org UNIQUE (organization_id, order_number),
  CONSTRAINT sales_orders_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT sales_orders_customer_fk
    FOREIGN KEY (organization_id, customer_id)
    REFERENCES customers (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_orders_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT sales_orders_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL (site_id),
  CONSTRAINT sales_orders_status_check
    CHECK (status IN ('draft', 'confirmed', 'partially_delivered', 'delivered',
                      'invoiced', 'cancelled')),
  CONSTRAINT sales_orders_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT sales_orders_number_format
    CHECK (order_number ~ '^[A-Za-z0-9][A-Za-z0-9_/-]{0,62}$'),
  CONSTRAINT sales_orders_amounts_non_negative
    CHECK (subtotal >= 0 AND tax_total >= 0 AND discount_total >= 0 AND total >= 0),
  CONSTRAINT sales_orders_required_after_order
    CHECK (required_date IS NULL OR required_date >= order_date),
  CONSTRAINT sales_orders_confirmed_complete
    CHECK (status = 'draft' OR confirmed_at IS NOT NULL)
);

CREATE TRIGGER sales_orders_set_updated_at
  BEFORE UPDATE ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX sales_orders_customer_idx
  ON sales_orders (organization_id, customer_id, order_date DESC);
CREATE INDEX sales_orders_open_idx
  ON sales_orders (organization_id, order_date DESC)
  WHERE status IN ('confirmed', 'partially_delivered');

SELECT enable_tenant_rls('sales_orders');

-- ----------------------------------------------------- sales order lines ----
CREATE TABLE sales_order_lines (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  order_id          uuid NOT NULL,
  line_number       integer NOT NULL,
  -- Optional link to a stocked item. A farm also sells things it does not keep
  -- in inventory — a live flock, a standing crop — so this is nullable and the
  -- description is what always prints.
  item_id           uuid,
  description       text NOT NULL,
  quantity          numeric(14,3) NOT NULL,
  unit              text NOT NULL DEFAULT 'unit',
  unit_price        numeric(16,2) NOT NULL,
  discount_percent  numeric(5,2) NOT NULL DEFAULT 0,
  tax_percent       numeric(5,2) NOT NULL DEFAULT 0,
  -- Stored so the printed line and the stored line can never disagree.
  line_total        numeric(16,2) NOT NULL DEFAULT 0,
  delivered_quantity numeric(14,3) NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT sales_order_lines_number_unique
    UNIQUE (organization_id, order_id, line_number),
  CONSTRAINT sales_order_lines_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT sales_order_lines_order_fk
    FOREIGN KEY (organization_id, order_id)
    REFERENCES sales_orders (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT sales_order_lines_item_fk
    FOREIGN KEY (organization_id, item_id)
    REFERENCES management_inventory_items (organization_id, id)
    ON DELETE SET NULL (item_id),
  CONSTRAINT sales_order_lines_description_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT sales_order_lines_quantity_positive CHECK (quantity > 0),
  CONSTRAINT sales_order_lines_price_non_negative CHECK (unit_price >= 0),
  CONSTRAINT sales_order_lines_discount_range
    CHECK (discount_percent >= 0 AND discount_percent <= 100),
  CONSTRAINT sales_order_lines_tax_range
    CHECK (tax_percent >= 0 AND tax_percent <= 100),
  CONSTRAINT sales_order_lines_line_number_positive CHECK (line_number > 0),
  -- Cannot deliver more than was ordered.
  CONSTRAINT sales_order_lines_delivered_within_ordered
    CHECK (delivered_quantity >= 0 AND delivered_quantity <= quantity)
);

CREATE TRIGGER sales_order_lines_set_updated_at
  BEFORE UPDATE ON sales_order_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX sales_order_lines_order_idx
  ON sales_order_lines (organization_id, order_id, line_number);

SELECT enable_tenant_rls('sales_order_lines');

-- ---------------------------------------------------------- deliveries ----
CREATE TABLE sales_deliveries (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  order_id          uuid NOT NULL,
  delivery_number   text NOT NULL,
  delivered_on      date NOT NULL DEFAULT CURRENT_DATE,
  -- Where it left from, for stock movement.
  warehouse_id      uuid,
  vehicle_id        uuid,
  driver_name       text,
  received_by       text,
  status            text NOT NULL DEFAULT 'draft',
  notes             text,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT sales_deliveries_number_unique_per_org
    UNIQUE (organization_id, delivery_number),
  CONSTRAINT sales_deliveries_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT sales_deliveries_order_fk
    FOREIGN KEY (organization_id, order_id)
    REFERENCES sales_orders (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT sales_deliveries_warehouse_fk
    FOREIGN KEY (organization_id, warehouse_id)
    REFERENCES management_warehouses (organization_id, id)
    ON DELETE SET NULL (warehouse_id),
  CONSTRAINT sales_deliveries_vehicle_fk
    FOREIGN KEY (organization_id, vehicle_id)
    REFERENCES management_vehicle_profiles (organization_id, id)
    ON DELETE SET NULL (vehicle_id),
  CONSTRAINT sales_deliveries_status_check
    CHECK (status IN ('draft', 'dispatched', 'delivered', 'returned',
                      'cancelled')),
  CONSTRAINT sales_deliveries_number_format
    CHECK (delivery_number ~ '^[A-Za-z0-9][A-Za-z0-9_/-]{0,62}$')
);

CREATE TRIGGER sales_deliveries_set_updated_at
  BEFORE UPDATE ON sales_deliveries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX sales_deliveries_order_idx
  ON sales_deliveries (organization_id, order_id, delivered_on DESC);

SELECT enable_tenant_rls('sales_deliveries');

CREATE TABLE sales_delivery_lines (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  delivery_id       uuid NOT NULL,
  order_line_id     uuid NOT NULL,
  quantity          numeric(14,3) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT sales_delivery_lines_unique
    UNIQUE (organization_id, delivery_id, order_line_id),
  CONSTRAINT sales_delivery_lines_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT sales_delivery_lines_delivery_fk
    FOREIGN KEY (organization_id, delivery_id)
    REFERENCES sales_deliveries (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT sales_delivery_lines_order_line_fk
    FOREIGN KEY (organization_id, order_line_id)
    REFERENCES sales_order_lines (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_delivery_lines_quantity_positive CHECK (quantity > 0)
);

SELECT enable_tenant_rls('sales_delivery_lines');

-- ------------------------------------------------------------- invoices ----
CREATE TABLE sales_invoices (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  customer_id       uuid NOT NULL,
  -- An invoice usually follows an order but can be raised standalone.
  order_id          uuid,
  province_id       uuid,
  invoice_number    text NOT NULL,
  invoice_date      date NOT NULL DEFAULT CURRENT_DATE,
  due_date          date NOT NULL,
  status            text NOT NULL DEFAULT 'draft',
  currency          char(3) NOT NULL,
  subtotal          numeric(16,2) NOT NULL DEFAULT 0,
  tax_total         numeric(16,2) NOT NULL DEFAULT 0,
  discount_total    numeric(16,2) NOT NULL DEFAULT 0,
  total             numeric(16,2) NOT NULL DEFAULT 0,
  -- Maintained by the payment allocation logic, so "what is outstanding" is a
  -- column read rather than a sum over payments on every list query.
  paid_total        numeric(16,2) NOT NULL DEFAULT 0,
  notes             text,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  issued_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT sales_invoices_number_unique_per_org
    UNIQUE (organization_id, invoice_number),
  CONSTRAINT sales_invoices_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT sales_invoices_customer_fk
    FOREIGN KEY (organization_id, customer_id)
    REFERENCES customers (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_invoices_order_fk
    FOREIGN KEY (organization_id, order_id)
    REFERENCES sales_orders (organization_id, id) ON DELETE SET NULL (order_id),
  CONSTRAINT sales_invoices_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT sales_invoices_status_check
    CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'overdue',
                      'cancelled', 'written_off')),
  CONSTRAINT sales_invoices_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT sales_invoices_number_format
    CHECK (invoice_number ~ '^[A-Za-z0-9][A-Za-z0-9_/-]{0,62}$'),
  CONSTRAINT sales_invoices_due_after_invoice CHECK (due_date >= invoice_date),
  CONSTRAINT sales_invoices_amounts_non_negative
    CHECK (subtotal >= 0 AND tax_total >= 0 AND discount_total >= 0
           AND total >= 0 AND paid_total >= 0),
  -- Cannot be paid more than it is worth. Overpayment is a credit note, not a
  -- bigger paid_total.
  CONSTRAINT sales_invoices_paid_within_total CHECK (paid_total <= total),
  -- A draft has no legal standing; anything beyond draft must be issued.
  CONSTRAINT sales_invoices_issued_complete
    CHECK (status = 'draft' OR issued_at IS NOT NULL)
);

CREATE TRIGGER sales_invoices_set_updated_at
  BEFORE UPDATE ON sales_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX sales_invoices_customer_idx
  ON sales_invoices (organization_id, customer_id, invoice_date DESC);
-- The receivables ageing report and the overdue-invoice job.
CREATE INDEX sales_invoices_outstanding_idx
  ON sales_invoices (organization_id, due_date)
  WHERE status IN ('issued', 'partially_paid', 'overdue');

SELECT enable_tenant_rls('sales_invoices');

CREATE TABLE sales_invoice_lines (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  invoice_id        uuid NOT NULL,
  line_number       integer NOT NULL,
  item_id           uuid,
  description       text NOT NULL,
  quantity          numeric(14,3) NOT NULL,
  unit              text NOT NULL DEFAULT 'unit',
  unit_price        numeric(16,2) NOT NULL,
  discount_percent  numeric(5,2) NOT NULL DEFAULT 0,
  tax_percent       numeric(5,2) NOT NULL DEFAULT 0,
  line_total        numeric(16,2) NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT sales_invoice_lines_number_unique
    UNIQUE (organization_id, invoice_id, line_number),
  CONSTRAINT sales_invoice_lines_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT sales_invoice_lines_invoice_fk
    FOREIGN KEY (organization_id, invoice_id)
    REFERENCES sales_invoices (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT sales_invoice_lines_item_fk
    FOREIGN KEY (organization_id, item_id)
    REFERENCES management_inventory_items (organization_id, id)
    ON DELETE SET NULL (item_id),
  CONSTRAINT sales_invoice_lines_description_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT sales_invoice_lines_quantity_positive CHECK (quantity > 0),
  CONSTRAINT sales_invoice_lines_price_non_negative CHECK (unit_price >= 0),
  CONSTRAINT sales_invoice_lines_discount_range
    CHECK (discount_percent >= 0 AND discount_percent <= 100),
  CONSTRAINT sales_invoice_lines_tax_range
    CHECK (tax_percent >= 0 AND tax_percent <= 100),
  CONSTRAINT sales_invoice_lines_line_number_positive CHECK (line_number > 0)
);

CREATE TRIGGER sales_invoice_lines_set_updated_at
  BEFORE UPDATE ON sales_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX sales_invoice_lines_invoice_idx
  ON sales_invoice_lines (organization_id, invoice_id, line_number);

SELECT enable_tenant_rls('sales_invoice_lines');

-- ------------------------------------------------------------- payments ----
CREATE TABLE customer_payments (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  customer_id       uuid NOT NULL,
  payment_number    text NOT NULL,
  received_on       date NOT NULL DEFAULT CURRENT_DATE,
  method            text NOT NULL DEFAULT 'cash',
  currency          char(3) NOT NULL,
  amount            numeric(16,2) NOT NULL,
  -- A payment can arrive before it is applied to invoices, so the unapplied
  -- remainder is tracked rather than assumed zero.
  allocated_amount  numeric(16,2) NOT NULL DEFAULT 0,
  reference         text,
  notes             text,
  recorded_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT customer_payments_number_unique_per_org
    UNIQUE (organization_id, payment_number),
  CONSTRAINT customer_payments_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT customer_payments_customer_fk
    FOREIGN KEY (organization_id, customer_id)
    REFERENCES customers (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT customer_payments_method_check
    CHECK (method IN ('cash', 'bank_transfer', 'mobile_money', 'cheque',
                      'card', 'offset')),
  CONSTRAINT customer_payments_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT customer_payments_amount_positive CHECK (amount > 0),
  CONSTRAINT customer_payments_allocated_within_amount
    CHECK (allocated_amount >= 0 AND allocated_amount <= amount),
  CONSTRAINT customer_payments_number_format
    CHECK (payment_number ~ '^[A-Za-z0-9][A-Za-z0-9_/-]{0,62}$')
);

CREATE TRIGGER customer_payments_set_updated_at
  BEFORE UPDATE ON customer_payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX customer_payments_customer_idx
  ON customer_payments (organization_id, customer_id, received_on DESC);
CREATE INDEX customer_payments_unallocated_idx
  ON customer_payments (organization_id, received_on)
  WHERE allocated_amount < amount;

SELECT enable_tenant_rls('customer_payments');

-- Which payment paid which invoice, and how much of it. A separate table
-- because one payment can settle several invoices and one invoice can be
-- settled by several payments — the classic many-to-many that a
-- payment.invoice_id column cannot express.
CREATE TABLE payment_allocations (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  payment_id        uuid NOT NULL,
  invoice_id        uuid NOT NULL,
  amount            numeric(16,2) NOT NULL,
  allocated_at      timestamptz NOT NULL DEFAULT now(),
  allocated_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  PRIMARY KEY (id),
  CONSTRAINT payment_allocations_unique
    UNIQUE (organization_id, payment_id, invoice_id),
  CONSTRAINT payment_allocations_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT payment_allocations_payment_fk
    FOREIGN KEY (organization_id, payment_id)
    REFERENCES customer_payments (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT payment_allocations_invoice_fk
    FOREIGN KEY (organization_id, invoice_id)
    REFERENCES sales_invoices (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT payment_allocations_amount_positive CHECK (amount > 0)
);

CREATE INDEX payment_allocations_invoice_idx
  ON payment_allocations (organization_id, invoice_id);

SELECT enable_tenant_rls('payment_allocations');

-- --------------------------------------------------------- credit notes ----
-- The correct answer to an overpayment or a return, rather than editing an
-- issued invoice.
CREATE TABLE credit_notes (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  customer_id       uuid NOT NULL,
  invoice_id        uuid,
  note_number       text NOT NULL,
  issued_on         date NOT NULL DEFAULT CURRENT_DATE,
  reason            text NOT NULL DEFAULT 'return',
  currency          char(3) NOT NULL,
  amount            numeric(16,2) NOT NULL,
  status            text NOT NULL DEFAULT 'draft',
  notes             text,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT credit_notes_number_unique_per_org UNIQUE (organization_id, note_number),
  CONSTRAINT credit_notes_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT credit_notes_customer_fk
    FOREIGN KEY (organization_id, customer_id)
    REFERENCES customers (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT credit_notes_invoice_fk
    FOREIGN KEY (organization_id, invoice_id)
    REFERENCES sales_invoices (organization_id, id) ON DELETE SET NULL (invoice_id),
  CONSTRAINT credit_notes_reason_check
    CHECK (reason IN ('return', 'overpayment', 'price_correction', 'damage',
                      'goodwill', 'write_off')),
  CONSTRAINT credit_notes_status_check
    CHECK (status IN ('draft', 'issued', 'applied', 'cancelled')),
  CONSTRAINT credit_notes_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT credit_notes_amount_positive CHECK (amount > 0),
  CONSTRAINT credit_notes_number_format
    CHECK (note_number ~ '^[A-Za-z0-9][A-Za-z0-9_/-]{0,62}$')
);

CREATE TRIGGER credit_notes_set_updated_at
  BEFORE UPDATE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX credit_notes_customer_idx
  ON credit_notes (organization_id, customer_id, issued_on DESC);

SELECT enable_tenant_rls('credit_notes');

COMMENT ON TABLE sales_invoices IS
  'Totals are stored, not derived: an issued invoice is a legal document and must not re-total when a tax rate changes.';
COMMENT ON TABLE payment_allocations IS
  'Many-to-many by necessity: one payment can settle several invoices and one invoice can take several payments.';
