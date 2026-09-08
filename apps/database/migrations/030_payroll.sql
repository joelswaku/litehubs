-- 030_payroll.sql
-- Payroll runs, payslips and the components that make them up.
--
-- Payroll is the one module where a bug costs someone their rent, so the
-- structure is built around three ideas:
--
-- **A payslip is a snapshot, not a view.** Every figure is stored on the
-- payslip: the salary in force, each allowance, each deduction, the tax. A
-- payslip must reprint identically in three years' time even though the
-- employee has since had two raises and the tax bands have changed. Deriving it
-- on read would silently rewrite history.
--
-- **Components are data, not code.** An organization defines its own
-- allowances and deductions — transport, housing, union dues, a salary advance
-- repayment, INSS in DR Congo. Hard-coding them would mean a migration per
-- customer, so they are rows, and a payslip line references the component it
-- came from *and* keeps its own copy of the amount.
--
-- **A run is closed, and then it is closed.** Once paid, a run cannot be
-- edited; an error is fixed by an adjustment in the next run or a reversal.
-- Enforced by trigger, same reasoning as the ledger in 029.

-- ---------------------------------------------------- payroll components ----
CREATE TABLE payroll_components (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  code              text NOT NULL,
  name              text NOT NULL,
  -- earning adds, deduction subtracts, employer_cost is neither: it is what the
  -- company pays on top and must not change net pay, only cost reporting.
  component_type    text NOT NULL,
  -- How the amount is arrived at.
  calculation       text NOT NULL DEFAULT 'fixed',
  -- For 'percentage': of what base. For 'fixed': ignored.
  percentage        numeric(7,4),
  default_amount    numeric(16,2),
  -- Whether income tax applies to this earning. Transport allowance is often
  -- exempt up to a ceiling; getting this wrong misstates every payslip.
  is_taxable        boolean NOT NULL DEFAULT true,
  -- Included in the base that percentage components are computed against.
  affects_gross     boolean NOT NULL DEFAULT true,
  -- Where it lands in the ledger when the run is posted.
  ledger_account_id uuid,
  sort_order        integer NOT NULL DEFAULT 100,
  is_active         boolean NOT NULL DEFAULT true,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT payroll_components_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT payroll_components_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT payroll_components_ledger_fk
    FOREIGN KEY (organization_id, ledger_account_id)
    REFERENCES finance_accounts (organization_id, id)
    ON DELETE SET NULL (ledger_account_id),
  CONSTRAINT payroll_components_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT payroll_components_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT payroll_components_type_check
    CHECK (component_type IN ('earning', 'deduction', 'employer_cost')),
  CONSTRAINT payroll_components_calculation_check
    CHECK (calculation IN ('fixed', 'percentage_of_basic',
                           'percentage_of_gross', 'per_day', 'per_hour',
                           'formula')),
  -- A percentage calculation needs a percentage; a fixed one needs an amount.
  CONSTRAINT payroll_components_percentage_present
    CHECK (calculation NOT IN ('percentage_of_basic', 'percentage_of_gross')
           OR percentage IS NOT NULL),
  CONSTRAINT payroll_components_percentage_range
    CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 1000)),
  CONSTRAINT payroll_components_amount_non_negative
    CHECK (default_amount IS NULL OR default_amount >= 0)
);

CREATE TRIGGER payroll_components_set_updated_at
  BEFORE UPDATE ON payroll_components
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enable_tenant_rls('payroll_components');

-- ------------------------------------------------- employee compensation ----
-- The salary and standing components for one employee, valid from a date.
-- History rather than a mutable column, so a payslip can be recomputed against
-- the terms that were in force for its period.
CREATE TABLE employee_compensation (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL,
  effective_from    date NOT NULL,
  effective_to      date,
  currency          char(3) NOT NULL,
  basic_salary      numeric(16,2) NOT NULL,
  pay_frequency     text NOT NULL DEFAULT 'monthly',
  -- Needed for per-day and per-hour components and for overtime.
  contract_hours_per_week numeric(5,2),
  -- Where the money goes.
  payment_method    text NOT NULL DEFAULT 'bank_transfer',
  bank_name         text,
  bank_account      text,
  mobile_money_number text,
  notes             text,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT employee_compensation_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT employee_compensation_employee_fk
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT employee_compensation_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT employee_compensation_salary_non_negative CHECK (basic_salary >= 0),
  CONSTRAINT employee_compensation_frequency_check
    CHECK (pay_frequency IN ('monthly', 'fortnightly', 'weekly', 'daily',
                             'hourly')),
  CONSTRAINT employee_compensation_method_check
    CHECK (payment_method IN ('bank_transfer', 'cash', 'mobile_money',
                              'cheque')),
  CONSTRAINT employee_compensation_dates_check
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT employee_compensation_hours_range
    CHECK (contract_hours_per_week IS NULL
           OR (contract_hours_per_week > 0 AND contract_hours_per_week <= 168))
);

CREATE TRIGGER employee_compensation_set_updated_at
  BEFORE UPDATE ON employee_compensation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One employee cannot have two overlapping compensation records, or "what is
-- their salary on this date" has two answers and payroll picks one at random.
ALTER TABLE employee_compensation
  ADD CONSTRAINT employee_compensation_no_overlap
  EXCLUDE USING gist (
    organization_id WITH =,
    employee_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );

CREATE INDEX employee_compensation_employee_idx
  ON employee_compensation (organization_id, employee_id, effective_from DESC);

SELECT enable_tenant_rls('employee_compensation');

-- Standing components attached to one employee, e.g. their housing allowance
-- or an ongoing advance repayment.
CREATE TABLE employee_payroll_components (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL,
  component_id      uuid NOT NULL,
  amount            numeric(16,2),
  percentage        numeric(7,4),
  effective_from    date NOT NULL DEFAULT CURRENT_DATE,
  effective_to      date,
  -- For a repayment: stop once this much has been recovered.
  total_to_recover  numeric(16,2),
  recovered_to_date numeric(16,2) NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT employee_payroll_components_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT employee_payroll_components_employee_fk
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT employee_payroll_components_component_fk
    FOREIGN KEY (organization_id, component_id)
    REFERENCES payroll_components (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT employee_payroll_components_dates_check
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT employee_payroll_components_amounts_non_negative
    CHECK ((amount IS NULL OR amount >= 0)
           AND (percentage IS NULL OR percentage >= 0)
           AND (total_to_recover IS NULL OR total_to_recover >= 0)
           AND recovered_to_date >= 0),
  CONSTRAINT employee_payroll_components_recovery_within_total
    CHECK (total_to_recover IS NULL OR recovered_to_date <= total_to_recover)
);

CREATE TRIGGER employee_payroll_components_set_updated_at
  BEFORE UPDATE ON employee_payroll_components
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX employee_payroll_components_employee_idx
  ON employee_payroll_components (organization_id, employee_id)
  WHERE is_active;

SELECT enable_tenant_rls('employee_payroll_components');

-- --------------------------------------------------------- payroll runs ----
CREATE TABLE payroll_runs (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  reference         text NOT NULL,
  period_start      date NOT NULL,
  period_end        date NOT NULL,
  pay_date          date NOT NULL,
  currency          char(3) NOT NULL,
  status            text NOT NULL DEFAULT 'draft',
  -- Scope: a run can cover the whole company or one province.
  province_id       uuid,
  employee_count    integer NOT NULL DEFAULT 0,
  -- Totals frozen when the run is approved, so the summary cannot drift from
  -- the payslips it summarises.
  gross_total       numeric(16,2) NOT NULL DEFAULT 0,
  deduction_total   numeric(16,2) NOT NULL DEFAULT 0,
  net_total         numeric(16,2) NOT NULL DEFAULT 0,
  employer_cost_total numeric(16,2) NOT NULL DEFAULT 0,
  journal_entry_id  uuid,
  notes             text,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  approved_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  approved_at       timestamptz,
  paid_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT payroll_runs_reference_unique_per_org UNIQUE (organization_id, reference),
  CONSTRAINT payroll_runs_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT payroll_runs_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT payroll_runs_journal_fk
    FOREIGN KEY (organization_id, journal_entry_id)
    REFERENCES finance_journal_entries (organization_id, id)
    ON DELETE SET NULL (journal_entry_id),
  CONSTRAINT payroll_runs_status_check
    CHECK (status IN ('draft', 'calculated', 'approved', 'paid', 'cancelled')),
  CONSTRAINT payroll_runs_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT payroll_runs_period_check CHECK (period_end >= period_start),
  CONSTRAINT payroll_runs_pay_after_period CHECK (pay_date >= period_start),
  CONSTRAINT payroll_runs_reference_format
    CHECK (reference ~ '^[A-Za-z0-9][A-Za-z0-9_/-]{0,62}$'),
  CONSTRAINT payroll_runs_totals_non_negative
    CHECK (gross_total >= 0 AND deduction_total >= 0 AND net_total >= 0
           AND employer_cost_total >= 0 AND employee_count >= 0),
  CONSTRAINT payroll_runs_approved_complete
    CHECK (status IN ('draft', 'calculated', 'cancelled') OR approved_at IS NOT NULL),
  CONSTRAINT payroll_runs_paid_complete
    CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);

CREATE TRIGGER payroll_runs_set_updated_at
  BEFORE UPDATE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX payroll_runs_period_idx
  ON payroll_runs (organization_id, period_end DESC);

SELECT enable_tenant_rls('payroll_runs');

-- ------------------------------------------------------------- payslips ----
CREATE TABLE payslips (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  run_id            uuid NOT NULL,
  employee_id       uuid NOT NULL,
  -- Snapshotted so a payslip reprints correctly after the employee is renamed,
  -- transferred or has left the company entirely.
  employee_number   text NOT NULL,
  employee_name     text NOT NULL,
  job_title         text,
  province_id       uuid,
  site_id           uuid,
  department_id     uuid,
  currency          char(3) NOT NULL,
  basic_salary      numeric(16,2) NOT NULL DEFAULT 0,
  -- Attendance inputs that fed the calculation, kept for the query "why is this
  -- payslip lower than last month's".
  days_worked       numeric(5,1),
  days_absent       numeric(5,1),
  overtime_hours    numeric(7,2),
  leave_days_unpaid numeric(5,1),
  gross_pay         numeric(16,2) NOT NULL DEFAULT 0,
  total_deductions  numeric(16,2) NOT NULL DEFAULT 0,
  net_pay           numeric(16,2) NOT NULL DEFAULT 0,
  employer_cost     numeric(16,2) NOT NULL DEFAULT 0,
  payment_method    text,
  payment_reference text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  -- One payslip per employee per run.
  CONSTRAINT payslips_unique_per_run UNIQUE (organization_id, run_id, employee_id),
  CONSTRAINT payslips_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT payslips_run_fk
    FOREIGN KEY (organization_id, run_id)
    REFERENCES payroll_runs (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT payslips_employee_fk
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT payslips_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT payslips_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL (site_id),
  CONSTRAINT payslips_department_fk
    FOREIGN KEY (organization_id, department_id)
    REFERENCES departments (organization_id, id) ON DELETE SET NULL (department_id),
  CONSTRAINT payslips_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT payslips_name_not_blank CHECK (btrim(employee_name) <> ''),
  CONSTRAINT payslips_amounts_non_negative
    CHECK (basic_salary >= 0 AND gross_pay >= 0 AND total_deductions >= 0
           AND employer_cost >= 0),
  -- Net pay may not be negative: an over-deduction has to be carried forward,
  -- not turned into the employee owing money on a payslip.
  CONSTRAINT payslips_net_non_negative CHECK (net_pay >= 0),
  CONSTRAINT payslips_net_matches
    CHECK (net_pay = gross_pay - total_deductions)
);

CREATE TRIGGER payslips_set_updated_at
  BEFORE UPDATE ON payslips
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX payslips_employee_idx
  ON payslips (organization_id, employee_id, created_at DESC);
CREATE INDEX payslips_run_idx ON payslips (organization_id, run_id);

SELECT enable_tenant_rls('payslips');

-- -------------------------------------------------------- payslip lines ----
CREATE TABLE payslip_lines (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  payslip_id        uuid NOT NULL,
  -- Nullable so a component deleted years later does not erase the line; the
  -- snapshotted code and name keep it readable.
  component_id      uuid,
  component_code    text NOT NULL,
  component_name    text NOT NULL,
  component_type    text NOT NULL,
  amount            numeric(16,2) NOT NULL,
  -- How it was worked out, for the payslip's own explanation column.
  basis             text,
  sort_order        integer NOT NULL DEFAULT 100,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT payslip_lines_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT payslip_lines_payslip_fk
    FOREIGN KEY (organization_id, payslip_id)
    REFERENCES payslips (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT payslip_lines_component_fk
    FOREIGN KEY (organization_id, component_id)
    REFERENCES payroll_components (organization_id, id)
    ON DELETE SET NULL (component_id),
  CONSTRAINT payslip_lines_type_check
    CHECK (component_type IN ('earning', 'deduction', 'employer_cost')),
  CONSTRAINT payslip_lines_name_not_blank CHECK (btrim(component_name) <> ''),
  CONSTRAINT payslip_lines_amount_non_negative CHECK (amount >= 0)
);

CREATE INDEX payslip_lines_payslip_idx
  ON payslip_lines (organization_id, payslip_id, sort_order);

SELECT enable_tenant_rls('payslip_lines');

-- ------------------------------------------- approved payroll is frozen ----
-- Same principle as the ledger: an approved run has been signed off and, once
-- paid, money has moved. Corrections go in the next run.
CREATE OR REPLACE FUNCTION payroll_reject_closed_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved', 'paid') THEN
      RAISE EXCEPTION
        'Payroll run % is %; it cannot be deleted',
        OLD.reference, OLD.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'paid' AND NEW.status <> 'paid' THEN
    RAISE EXCEPTION
      'Payroll run % is paid; money has moved and it is final',
      OLD.reference USING ERRCODE = 'check_violation';
  END IF;

  -- An approved run may only be paid or cancelled, and its figures are fixed.
  IF OLD.status = 'approved' THEN
    IF NEW.status NOT IN ('approved', 'paid', 'cancelled') THEN
      RAISE EXCEPTION
        'Payroll run % is approved; it cannot return to %',
        OLD.reference, NEW.status USING ERRCODE = 'check_violation';
    END IF;

    IF (NEW.gross_total, NEW.net_total, NEW.deduction_total,
        NEW.period_start, NEW.period_end)
       IS DISTINCT FROM
       (OLD.gross_total, OLD.net_total, OLD.deduction_total,
        OLD.period_start, OLD.period_end) THEN
      RAISE EXCEPTION
        'Payroll run % is approved; its totals cannot be changed',
        OLD.reference USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER payroll_runs_frozen
  BEFORE UPDATE OR DELETE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION payroll_reject_closed_change();

-- Payslips and their lines follow the run's state.
CREATE OR REPLACE FUNCTION payroll_reject_closed_payslip_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_status text;
  target_run uuid;
BEGIN
  IF TG_TABLE_NAME = 'payslips' THEN
    target_run := COALESCE(NEW.run_id, OLD.run_id);
  ELSE
    SELECT run_id INTO target_run FROM payslips
     WHERE id = COALESCE(NEW.payslip_id, OLD.payslip_id);
  END IF;

  IF target_run IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT status INTO run_status FROM payroll_runs WHERE id = target_run;

  -- Null means the run is being deleted in this statement; the cascade is
  -- legitimate and the run trigger has already vetted it.
  IF run_status IN ('approved', 'paid') THEN
    RAISE EXCEPTION
      'Payroll run is %; its payslips cannot be changed', run_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER payslips_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON payslips
  FOR EACH ROW EXECUTE FUNCTION payroll_reject_closed_payslip_change();

CREATE TRIGGER payslip_lines_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON payslip_lines
  FOR EACH ROW EXECUTE FUNCTION payroll_reject_closed_payslip_change();

COMMENT ON TABLE payslips IS
  'A snapshot, not a view: every figure is stored so a payslip reprints identically years later.';
COMMENT ON COLUMN payslips.employee_name IS
  'Copied at calculation time so a payslip survives the employee being renamed, transferred or leaving.';
