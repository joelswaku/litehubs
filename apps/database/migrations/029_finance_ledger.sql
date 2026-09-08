-- 029_finance_ledger.sql
-- Chart of accounts, double-entry journal, cash accounts, payables,
-- receivables and bank reconciliation.
--
-- 021/022 already record *operational* money — an expense against a project, a
-- purchase order, a receipt. This migration adds the accounting layer those
-- feed into. The distinction matters: an expense is "we spent 40,000 CDF on
-- feed"; a journal entry is "debit Feed Expense, credit Bank" and must balance.
--
-- Design decisions worth stating, because getting them wrong is expensive:
--
-- **Double entry, enforced.** A journal entry's lines must sum to zero. Not a
-- convention, a deferred constraint — checked at COMMIT so the service can
-- insert the header, then the lines, then let the database refuse an unbalanced
-- set. Single-sided bookkeeping does not survive its first audit.
--
-- **Signed amounts, one column.** A line carries `amount`, positive for debit
-- and negative for credit, instead of separate debit/credit columns. Two
-- columns require a CHECK that exactly one is populated, make "sum to zero" a
-- subtraction, and double every aggregate. One signed column makes balance
-- checks `SUM(amount) = 0` and account balances a plain SUM.
--
-- **Posted entries are immutable.** Correcting a posted entry means posting a
-- reversal, never editing. Enforced by trigger, because a UI that "just
-- disables the edit button" is not a control.

-- ------------------------------------------------------ chart of accounts ----
CREATE TABLE finance_accounts (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  code              text NOT NULL,
  name              text NOT NULL,
  -- The five classical types. Determines which side of the balance sheet or
  -- income statement the account lands on, and whether a debit increases it.
  account_type      text NOT NULL,
  -- Sub-classification for statement grouping, e.g. 'current_asset'.
  category          text,
  -- Self-referencing tree for statement roll-ups. Composite so a parent cannot
  -- belong to another tenant.
  parent_id         uuid,
  currency          char(3),
  -- Postings are only allowed to leaf accounts; a header exists to total its
  -- children. Without this, a balance double-counts.
  is_postable       boolean NOT NULL DEFAULT true,
  is_active         boolean NOT NULL DEFAULT true,
  description       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT finance_accounts_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT finance_accounts_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT finance_accounts_parent_fk
    FOREIGN KEY (organization_id, parent_id)
    REFERENCES finance_accounts (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT finance_accounts_code_format
    CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,30}$'),
  CONSTRAINT finance_accounts_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT finance_accounts_type_check
    CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  CONSTRAINT finance_accounts_currency_format
    CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  -- An account cannot be its own parent. Deeper cycles are prevented by the
  -- service, which walks the chain on write.
  CONSTRAINT finance_accounts_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE TRIGGER finance_accounts_set_updated_at
  BEFORE UPDATE ON finance_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX finance_accounts_type_idx
  ON finance_accounts (organization_id, account_type, code) WHERE is_active;
CREATE INDEX finance_accounts_parent_idx
  ON finance_accounts (organization_id, parent_id) WHERE parent_id IS NOT NULL;

SELECT enable_tenant_rls('finance_accounts');

-- ------------------------------------------------------- fiscal periods ----
-- Closing a period is what stops someone posting into a month that has already
-- been reported. Without it, last quarter's numbers change under you.
CREATE TABLE finance_periods (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  code              text NOT NULL,
  starts_on         date NOT NULL,
  ends_on           date NOT NULL,
  status            text NOT NULL DEFAULT 'open',
  closed_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  closed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT finance_periods_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT finance_periods_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT finance_periods_dates_check CHECK (ends_on >= starts_on),
  CONSTRAINT finance_periods_status_check
    CHECK (status IN ('open', 'closed', 'locked')),
  CONSTRAINT finance_periods_closed_complete
    CHECK (status = 'open' OR closed_at IS NOT NULL)
);

CREATE TRIGGER finance_periods_set_updated_at
  BEFORE UPDATE ON finance_periods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Periods must not overlap, or a date belongs to two of them and "is this month
-- closed?" has no answer.
ALTER TABLE finance_periods
  ADD CONSTRAINT finance_periods_no_overlap
  EXCLUDE USING gist (
    organization_id WITH =,
    daterange(starts_on, ends_on, '[]') WITH &&
  );

SELECT enable_tenant_rls('finance_periods');

-- ------------------------------------------------------- journal entries ----
CREATE TABLE finance_journal_entries (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  entry_number      text NOT NULL,
  entry_date        date NOT NULL DEFAULT CURRENT_DATE,
  period_id         uuid,
  -- What kind of transaction, for filtering and for finding the automation that
  -- created it.
  entry_type        text NOT NULL DEFAULT 'manual',
  description       text NOT NULL,
  currency          char(3) NOT NULL,
  status            text NOT NULL DEFAULT 'draft',
  -- Polymorphic link back to whatever operational record caused this posting —
  -- an invoice, a payment, a payroll run. Same reasoning as alerts.subject_*:
  -- it can address many tables, so it is a validated pair, not 20 nullable FKs.
  source_table      text,
  source_id         uuid,
  -- Set on the reversing entry, pointing at what it reverses.
  reverses_entry_id uuid,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  posted_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  posted_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT finance_journal_entries_number_unique_per_org
    UNIQUE (organization_id, entry_number),
  CONSTRAINT finance_journal_entries_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT finance_journal_entries_period_fk
    FOREIGN KEY (organization_id, period_id)
    REFERENCES finance_periods (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT finance_journal_entries_reverses_fk
    FOREIGN KEY (organization_id, reverses_entry_id)
    REFERENCES finance_journal_entries (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT finance_journal_entries_type_check
    CHECK (entry_type IN ('manual', 'sales_invoice', 'customer_payment',
                          'credit_note', 'purchase', 'supplier_payment',
                          'payroll', 'expense', 'stock', 'depreciation',
                          'opening_balance', 'reversal', 'closing')),
  CONSTRAINT finance_journal_entries_status_check
    CHECK (status IN ('draft', 'posted', 'reversed')),
  CONSTRAINT finance_journal_entries_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT finance_journal_entries_description_not_blank
    CHECK (btrim(description) <> ''),
  CONSTRAINT finance_journal_entries_number_format
    CHECK (entry_number ~ '^[A-Za-z0-9][A-Za-z0-9_/-]{0,62}$'),
  CONSTRAINT finance_journal_entries_source_complete
    CHECK ((source_table IS NULL) = (source_id IS NULL)),
  CONSTRAINT finance_journal_entries_posted_complete
    CHECK (status = 'draft' OR (posted_at IS NOT NULL)),
  CONSTRAINT finance_journal_entries_no_self_reversal
    CHECK (reverses_entry_id IS NULL OR reverses_entry_id <> id)
);

CREATE TRIGGER finance_journal_entries_set_updated_at
  BEFORE UPDATE ON finance_journal_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX finance_journal_entries_date_idx
  ON finance_journal_entries (organization_id, entry_date DESC);
CREATE INDEX finance_journal_entries_source_idx
  ON finance_journal_entries (organization_id, source_table, source_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX finance_journal_entries_draft_idx
  ON finance_journal_entries (organization_id, entry_date)
  WHERE status = 'draft';

SELECT enable_tenant_rls('finance_journal_entries');

-- --------------------------------------------------------- journal lines ----
CREATE TABLE finance_journal_lines (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  entry_id          uuid NOT NULL,
  line_number       integer NOT NULL,
  account_id        uuid NOT NULL,
  -- Positive is a debit, negative is a credit. See the header comment for why
  -- this is one signed column rather than two.
  amount            numeric(16,2) NOT NULL,
  description       text,
  -- Optional analysis dimensions, so a posting can be reported by site or
  -- project without a separate cost-centre table.
  province_id       uuid,
  site_id           uuid,
  project_id        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT finance_journal_lines_number_unique
    UNIQUE (organization_id, entry_id, line_number),
  CONSTRAINT finance_journal_lines_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT finance_journal_lines_entry_fk
    FOREIGN KEY (organization_id, entry_id)
    REFERENCES finance_journal_entries (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT finance_journal_lines_account_fk
    FOREIGN KEY (organization_id, account_id)
    REFERENCES finance_accounts (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT finance_journal_lines_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT finance_journal_lines_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL (site_id),
  CONSTRAINT finance_journal_lines_project_fk
    FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id)
    ON DELETE SET NULL (project_id),
  -- A zero line carries no information and would hide a data-entry mistake.
  CONSTRAINT finance_journal_lines_amount_not_zero CHECK (amount <> 0),
  CONSTRAINT finance_journal_lines_line_number_positive CHECK (line_number > 0)
);

CREATE INDEX finance_journal_lines_entry_idx
  ON finance_journal_lines (organization_id, entry_id, line_number);
-- The account-balance and trial-balance queries.
CREATE INDEX finance_journal_lines_account_idx
  ON finance_journal_lines (organization_id, account_id);

SELECT enable_tenant_rls('finance_journal_lines');

-- ------------------------------------------------- the balance guarantee ----
-- Debits must equal credits. A DEFERRED constraint trigger, so the service can
-- insert a header and then its lines inside one transaction and be judged only
-- at COMMIT — an IMMEDIATE check would fail on the first line, when the entry
-- is legitimately half-built.
--
-- This is the single most important object in this migration. Every report that
-- claims to balance depends on it, and no amount of application-layer care is
-- equivalent: one forgotten code path and the ledger is quietly wrong.
CREATE OR REPLACE FUNCTION finance_assert_entry_balances()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_entry uuid := COALESCE(NEW.entry_id, OLD.entry_id);
  entry_status text;
  line_count   integer;
  imbalance    numeric(16,2);
BEGIN
  SELECT status INTO entry_status
    FROM finance_journal_entries
   WHERE id = target_entry;

  -- The entry itself was deleted; its lines went with it by cascade.
  IF entry_status IS NULL THEN
    RETURN NULL;
  END IF;

  -- A draft is allowed to be unbalanced while it is being worked on.
  IF entry_status = 'draft' THEN
    RETURN NULL;
  END IF;

  SELECT count(*), COALESCE(sum(amount), 0)
    INTO line_count, imbalance
    FROM finance_journal_lines
   WHERE entry_id = target_entry;

  IF line_count < 2 THEN
    RAISE EXCEPTION
      'Journal entry % has % line(s); double entry needs at least two',
      target_entry, line_count
      USING ERRCODE = 'check_violation';
  END IF;

  IF imbalance <> 0 THEN
    RAISE EXCEPTION
      'Journal entry % does not balance: debits minus credits = %',
      target_entry, imbalance
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER finance_journal_lines_balance
  AFTER INSERT OR UPDATE OR DELETE ON finance_journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION finance_assert_entry_balances();

-- Posting is what makes an entry real, so the balance must also be checked when
-- the status flips from draft to posted — at that moment the lines have not
-- changed and the row trigger above would not fire.
CREATE OR REPLACE FUNCTION finance_assert_entry_balances_for_header()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  line_count integer;
  imbalance  numeric(16,2);
BEGIN
  SELECT count(*), COALESCE(sum(amount), 0)
    INTO line_count, imbalance
    FROM finance_journal_lines
   WHERE entry_id = NEW.id;

  IF line_count < 2 THEN
    RAISE EXCEPTION
      'Cannot post journal entry % with % line(s)', NEW.entry_number, line_count
      USING ERRCODE = 'check_violation';
  END IF;

  IF imbalance <> 0 THEN
    RAISE EXCEPTION
      'Cannot post journal entry %: debits minus credits = %',
      NEW.entry_number, imbalance
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER finance_journal_entries_balance_on_post
  AFTER UPDATE OF status ON finance_journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status = 'posted')
  EXECUTE FUNCTION finance_assert_entry_balances_for_header();

-- ----------------------------------------------- posted is immutable ----
-- Correcting a posted entry means posting a reversal. Enforced here because a
-- disabled button in the UI is not a control, and the whole value of a ledger
-- is that yesterday's numbers are still yesterday's numbers.
CREATE OR REPLACE FUNCTION finance_reject_posted_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION
        'Journal entry % is % and cannot be deleted; post a reversal instead',
        OLD.entry_number, OLD.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- Posted entries may only move to 'reversed', and nothing else may change.
  IF OLD.status = 'posted' THEN
    IF NEW.status NOT IN ('posted', 'reversed') THEN
      RAISE EXCEPTION
        'Journal entry % is posted; it cannot return to %',
        OLD.entry_number, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;

    IF (NEW.entry_date, NEW.currency, NEW.description, NEW.entry_number)
       IS DISTINCT FROM
       (OLD.entry_date, OLD.currency, OLD.description, OLD.entry_number) THEN
      RAISE EXCEPTION
        'Journal entry % is posted; its details cannot be edited',
        OLD.entry_number
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF OLD.status = 'reversed' AND NEW.status <> 'reversed' THEN
    RAISE EXCEPTION 'Journal entry % is reversed and is now final',
      OLD.entry_number USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER finance_journal_entries_immutable
  BEFORE UPDATE OR DELETE ON finance_journal_entries
  FOR EACH ROW EXECUTE FUNCTION finance_reject_posted_change();

-- The lines of a posted entry are equally frozen.
CREATE OR REPLACE FUNCTION finance_reject_posted_line_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entry_status text;
  target_entry uuid := COALESCE(NEW.entry_id, OLD.entry_id);
BEGIN
  SELECT status INTO entry_status
    FROM finance_journal_entries WHERE id = target_entry;

  -- Null means the parent is being deleted in this same statement; the cascade
  -- is legitimate and the header trigger has already vetted it.
  IF entry_status IS NOT NULL AND entry_status <> 'draft' THEN
    RAISE EXCEPTION
      'Journal entry % is %; its lines cannot be changed',
      target_entry, entry_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER finance_journal_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON finance_journal_lines
  FOR EACH ROW EXECUTE FUNCTION finance_reject_posted_line_change();

-- --------------------------------------------------------- cash accounts ----
-- Bank accounts, tills and mobile-money wallets. Separate from
-- finance_accounts: the ledger account is where postings land, this is the
-- real-world account with a number, a balance and statements to reconcile.
CREATE TABLE finance_cash_accounts (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  code              text NOT NULL,
  name              text NOT NULL,
  account_kind      text NOT NULL DEFAULT 'bank',
  -- The ledger account this maps to, so a cash movement can be posted.
  ledger_account_id uuid,
  currency          char(3) NOT NULL,
  bank_name         text,
  account_number    text,
  province_id       uuid,
  site_id           uuid,
  opening_balance   numeric(16,2) NOT NULL DEFAULT 0,
  -- Maintained by the movement logic so a balance is a column read.
  current_balance   numeric(16,2) NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT finance_cash_accounts_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT finance_cash_accounts_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT finance_cash_accounts_ledger_fk
    FOREIGN KEY (organization_id, ledger_account_id)
    REFERENCES finance_accounts (organization_id, id)
    ON DELETE SET NULL (ledger_account_id),
  CONSTRAINT finance_cash_accounts_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT finance_cash_accounts_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL (site_id),
  CONSTRAINT finance_cash_accounts_kind_check
    CHECK (account_kind IN ('bank', 'cash_box', 'mobile_money', 'card',
                            'petty_cash')),
  CONSTRAINT finance_cash_accounts_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT finance_cash_accounts_code_format
    CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$'),
  CONSTRAINT finance_cash_accounts_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TRIGGER finance_cash_accounts_set_updated_at
  BEFORE UPDATE ON finance_cash_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enable_tenant_rls('finance_cash_accounts');

-- ------------------------------------------------------- cash movements ----
CREATE TABLE finance_cash_movements (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  cash_account_id   uuid NOT NULL,
  moved_on          date NOT NULL DEFAULT CURRENT_DATE,
  direction         text NOT NULL,
  -- Always positive; `direction` carries the sign. Keeps "total in" and "total
  -- out" separable, which a signed column would not.
  amount            numeric(16,2) NOT NULL,
  method            text NOT NULL DEFAULT 'cash',
  reference         text,
  description       text NOT NULL,
  -- The other side of a transfer between two of the company's own accounts.
  counterpart_account_id uuid,
  journal_entry_id  uuid,
  -- Set when matched against a bank statement line.
  reconciled_at     timestamptz,
  reconciliation_id uuid,
  recorded_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT finance_cash_movements_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT finance_cash_movements_account_fk
    FOREIGN KEY (organization_id, cash_account_id)
    REFERENCES finance_cash_accounts (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT finance_cash_movements_counterpart_fk
    FOREIGN KEY (organization_id, counterpart_account_id)
    REFERENCES finance_cash_accounts (organization_id, id)
    ON DELETE SET NULL (counterpart_account_id),
  CONSTRAINT finance_cash_movements_journal_fk
    FOREIGN KEY (organization_id, journal_entry_id)
    REFERENCES finance_journal_entries (organization_id, id)
    ON DELETE SET NULL (journal_entry_id),
  CONSTRAINT finance_cash_movements_direction_check
    CHECK (direction IN ('in', 'out')),
  CONSTRAINT finance_cash_movements_amount_positive CHECK (amount > 0),
  CONSTRAINT finance_cash_movements_method_check
    CHECK (method IN ('cash', 'bank_transfer', 'mobile_money', 'cheque',
                      'card', 'internal_transfer')),
  CONSTRAINT finance_cash_movements_description_not_blank
    CHECK (btrim(description) <> ''),
  -- A transfer must not name the same account on both sides.
  CONSTRAINT finance_cash_movements_transfer_differs
    CHECK (counterpart_account_id IS NULL
           OR counterpart_account_id <> cash_account_id)
);

CREATE TRIGGER finance_cash_movements_set_updated_at
  BEFORE UPDATE ON finance_cash_movements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX finance_cash_movements_account_idx
  ON finance_cash_movements (organization_id, cash_account_id, moved_on DESC);
CREATE INDEX finance_cash_movements_unreconciled_idx
  ON finance_cash_movements (organization_id, cash_account_id, moved_on)
  WHERE reconciled_at IS NULL;

SELECT enable_tenant_rls('finance_cash_movements');

-- ------------------------------------------------------- reconciliations ----
CREATE TABLE finance_reconciliations (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  cash_account_id   uuid NOT NULL,
  reference         text NOT NULL,
  statement_date    date NOT NULL,
  -- What the bank says.
  statement_balance numeric(16,2) NOT NULL,
  -- What the books say at that date, frozen when the reconciliation is closed.
  book_balance      numeric(16,2) NOT NULL DEFAULT 0,
  -- statement minus book. Must be zero to close.
  difference        numeric(16,2) NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'in_progress',
  notes             text,
  reconciled_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT finance_reconciliations_reference_unique_per_org
    UNIQUE (organization_id, reference),
  CONSTRAINT finance_reconciliations_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT finance_reconciliations_account_fk
    FOREIGN KEY (organization_id, cash_account_id)
    REFERENCES finance_cash_accounts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT finance_reconciliations_status_check
    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  -- Cannot claim a reconciliation is done while the books and the bank differ.
  CONSTRAINT finance_reconciliations_completed_balances
    CHECK (status <> 'completed' OR (difference = 0 AND completed_at IS NOT NULL))
);

CREATE TRIGGER finance_reconciliations_set_updated_at
  BEFORE UPDATE ON finance_reconciliations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enable_tenant_rls('finance_reconciliations');

ALTER TABLE finance_cash_movements
  ADD CONSTRAINT finance_cash_movements_reconciliation_fk
  FOREIGN KEY (organization_id, reconciliation_id)
  REFERENCES finance_reconciliations (organization_id, id)
  ON DELETE SET NULL (reconciliation_id);

-- ------------------------------------------------------------- payables ----
-- What the company owes a supplier. The mirror of sales_invoices.
CREATE TABLE finance_payables (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  supplier_id       uuid NOT NULL,
  purchase_order_id uuid,
  reference         text NOT NULL,
  -- The supplier's own invoice number, which is what they will quote at you.
  supplier_invoice_number text,
  invoice_date      date NOT NULL DEFAULT CURRENT_DATE,
  due_date          date NOT NULL,
  currency          char(3) NOT NULL,
  total             numeric(16,2) NOT NULL,
  paid_total        numeric(16,2) NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'open',
  journal_entry_id  uuid,
  province_id       uuid,
  notes             text,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT finance_payables_reference_unique_per_org
    UNIQUE (organization_id, reference),
  CONSTRAINT finance_payables_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT finance_payables_supplier_fk
    FOREIGN KEY (organization_id, supplier_id)
    REFERENCES management_suppliers (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT finance_payables_order_fk
    FOREIGN KEY (organization_id, purchase_order_id)
    REFERENCES management_purchase_orders (organization_id, id)
    ON DELETE SET NULL (purchase_order_id),
  CONSTRAINT finance_payables_journal_fk
    FOREIGN KEY (organization_id, journal_entry_id)
    REFERENCES finance_journal_entries (organization_id, id)
    ON DELETE SET NULL (journal_entry_id),
  CONSTRAINT finance_payables_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT finance_payables_status_check
    CHECK (status IN ('open', 'partially_paid', 'paid', 'overdue', 'disputed',
                      'cancelled')),
  CONSTRAINT finance_payables_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT finance_payables_total_positive CHECK (total > 0),
  CONSTRAINT finance_payables_paid_within_total
    CHECK (paid_total >= 0 AND paid_total <= total),
  CONSTRAINT finance_payables_due_after_invoice CHECK (due_date >= invoice_date)
);

CREATE TRIGGER finance_payables_set_updated_at
  BEFORE UPDATE ON finance_payables
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX finance_payables_supplier_idx
  ON finance_payables (organization_id, supplier_id, invoice_date DESC);
-- The payables ageing report and the "what is due this week" job.
CREATE INDEX finance_payables_outstanding_idx
  ON finance_payables (organization_id, due_date)
  WHERE status IN ('open', 'partially_paid', 'overdue');

SELECT enable_tenant_rls('finance_payables');

-- ------------------------------------------------------ supplier payments ----
CREATE TABLE finance_supplier_payments (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  supplier_id       uuid NOT NULL,
  payable_id        uuid,
  cash_account_id   uuid,
  payment_number    text NOT NULL,
  paid_on           date NOT NULL DEFAULT CURRENT_DATE,
  method            text NOT NULL DEFAULT 'bank_transfer',
  currency          char(3) NOT NULL,
  amount            numeric(16,2) NOT NULL,
  reference         text,
  journal_entry_id  uuid,
  recorded_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT finance_supplier_payments_number_unique_per_org
    UNIQUE (organization_id, payment_number),
  CONSTRAINT finance_supplier_payments_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT finance_supplier_payments_supplier_fk
    FOREIGN KEY (organization_id, supplier_id)
    REFERENCES management_suppliers (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT finance_supplier_payments_payable_fk
    FOREIGN KEY (organization_id, payable_id)
    REFERENCES finance_payables (organization_id, id) ON DELETE SET NULL (payable_id),
  CONSTRAINT finance_supplier_payments_cash_fk
    FOREIGN KEY (organization_id, cash_account_id)
    REFERENCES finance_cash_accounts (organization_id, id)
    ON DELETE SET NULL (cash_account_id),
  CONSTRAINT finance_supplier_payments_journal_fk
    FOREIGN KEY (organization_id, journal_entry_id)
    REFERENCES finance_journal_entries (organization_id, id)
    ON DELETE SET NULL (journal_entry_id),
  CONSTRAINT finance_supplier_payments_method_check
    CHECK (method IN ('cash', 'bank_transfer', 'mobile_money', 'cheque',
                      'card', 'offset')),
  CONSTRAINT finance_supplier_payments_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT finance_supplier_payments_amount_positive CHECK (amount > 0)
);

CREATE TRIGGER finance_supplier_payments_set_updated_at
  BEFORE UPDATE ON finance_supplier_payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX finance_supplier_payments_supplier_idx
  ON finance_supplier_payments (organization_id, supplier_id, paid_on DESC);

SELECT enable_tenant_rls('finance_supplier_payments');

-- ------------------------------------------------------------- budgets ----
-- Company-level budget by account and period. 022 already budgets a *project*;
-- this is the annual operating budget a general manager is measured against.
CREATE TABLE finance_budgets (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  code              text NOT NULL,
  name              text NOT NULL,
  fiscal_year       integer NOT NULL,
  currency          char(3) NOT NULL,
  status            text NOT NULL DEFAULT 'draft',
  province_id       uuid,
  site_id           uuid,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  approved_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  approved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT finance_budgets_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT finance_budgets_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT finance_budgets_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT finance_budgets_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL (site_id),
  CONSTRAINT finance_budgets_status_check
    CHECK (status IN ('draft', 'approved', 'active', 'closed')),
  CONSTRAINT finance_budgets_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT finance_budgets_year_range CHECK (fiscal_year BETWEEN 2000 AND 2200),
  CONSTRAINT finance_budgets_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT finance_budgets_approved_complete
    CHECK (status = 'draft' OR approved_at IS NOT NULL)
);

CREATE TRIGGER finance_budgets_set_updated_at
  BEFORE UPDATE ON finance_budgets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enable_tenant_rls('finance_budgets');

CREATE TABLE finance_budget_lines (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  budget_id         uuid NOT NULL,
  account_id        uuid NOT NULL,
  -- 1-12, or NULL for a whole-year figure not split by month.
  period_month      smallint,
  budgeted_amount   numeric(16,2) NOT NULL DEFAULT 0,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT finance_budget_lines_unique
    UNIQUE (organization_id, budget_id, account_id, period_month),
  CONSTRAINT finance_budget_lines_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT finance_budget_lines_budget_fk
    FOREIGN KEY (organization_id, budget_id)
    REFERENCES finance_budgets (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT finance_budget_lines_account_fk
    FOREIGN KEY (organization_id, account_id)
    REFERENCES finance_accounts (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT finance_budget_lines_month_range
    CHECK (period_month IS NULL OR period_month BETWEEN 1 AND 12)
);

CREATE TRIGGER finance_budget_lines_set_updated_at
  BEFORE UPDATE ON finance_budget_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX finance_budget_lines_budget_idx
  ON finance_budget_lines (organization_id, budget_id, account_id);

SELECT enable_tenant_rls('finance_budget_lines');

COMMENT ON TABLE finance_journal_lines IS
  'Signed amount: positive debit, negative credit. Entries must sum to zero, enforced by a deferred constraint trigger.';
COMMENT ON FUNCTION finance_assert_entry_balances() IS
  'The double-entry guarantee. Deferred so a service can insert a header then its lines and be judged at COMMIT.';
