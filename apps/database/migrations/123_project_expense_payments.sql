-- Project expenses are deliberately separate from supplier settlements.  A
-- receipt consumes project budget; paying that receipt is only a payable
-- settlement and must never consume the budget again.
ALTER TABLE management_expenses
  ADD COLUMN IF NOT EXISTS expense_type text NOT NULL DEFAULT 'direct_expense',
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS beneficiary_name text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_idempotency_key text,
  ADD COLUMN IF NOT EXISTS reimburses_expense_id uuid,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

UPDATE management_expenses
SET expense_type = CASE
  WHEN receipt_id IS NOT NULL THEN 'receipt_payment'
  ELSE 'direct_expense'
END
WHERE expense_type IS NULL OR expense_type = 'direct_expense';

ALTER TABLE management_expenses
  DROP CONSTRAINT IF EXISTS management_expenses_status_check;

ALTER TABLE management_expenses
  ADD CONSTRAINT management_expenses_status_check CHECK (
    status IN ('draft', 'submitted', 'approved', 'paid', 'rejected', 'void',
      'cancelled', 'refunded', 'reimbursed')
  );

ALTER TABLE management_expenses
  DROP CONSTRAINT IF EXISTS management_expenses_expense_type_check;
ALTER TABLE management_expenses
  ADD CONSTRAINT management_expenses_expense_type_check CHECK (
    expense_type IN ('direct_expense', 'receipt_payment', 'reimbursement')
  );

ALTER TABLE management_expenses
  DROP CONSTRAINT IF EXISTS management_expenses_reimbursement_fk;
ALTER TABLE management_expenses
  ADD CONSTRAINT management_expenses_reimbursement_fk
  FOREIGN KEY (organization_id, reimburses_expense_id)
  REFERENCES management_expenses (organization_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS management_expenses_project_type_status_idx
  ON management_expenses (organization_id, project_id, expense_type, status);
CREATE INDEX IF NOT EXISTS management_expenses_receipt_payment_idx
  ON management_expenses (organization_id, receipt_id, expense_type, status)
  WHERE receipt_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS management_expenses_receipt_payment_idempotency_idx
  ON management_expenses (organization_id, payment_idempotency_key)
  WHERE payment_idempotency_key IS NOT NULL AND expense_type = 'receipt_payment';

COMMENT ON COLUMN management_expenses.expense_type IS
  'direct_expense affects the budget once approved; receipt_payment settles a confirmed receipt and is budget-neutral; reimbursement reverses the linked direct expense or payable settlement.';
COMMENT ON COLUMN management_expenses.payment_idempotency_key IS
  'Client retry key for receipt payments; prevents a double settlement after network retry.';

-- A per-organization advisory lock makes automatic expense references safe even
-- when two accounting users save at the same time.
CREATE OR REPLACE FUNCTION management_expenses_assign_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE next_number integer;
BEGIN
  IF NEW.expense_number IS NULL OR BTRIM(NEW.expense_number) = '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text, 9123));
    SELECT COALESCE(MAX(CASE WHEN expense_number ~ '^DEP-[0-9]+$'
      THEN substring(expense_number FROM 5)::integer ELSE 0 END), 0) + 1
      INTO next_number
      FROM management_expenses
     WHERE organization_id = NEW.organization_id;
    NEW.expense_number := 'DEP-' || LPAD(next_number::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS management_expenses_assign_number_before_insert ON management_expenses;
CREATE TRIGGER management_expenses_assign_number_before_insert
  BEFORE INSERT ON management_expenses
  FOR EACH ROW EXECUTE FUNCTION management_expenses_assign_number();