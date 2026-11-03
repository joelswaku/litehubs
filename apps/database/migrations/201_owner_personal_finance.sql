-- 201_owner_personal_finance.sql
-- "Mes finances": the workspace owner's personal money — income, expenses,
-- monthly budgets per category, debts and credits, recurring entries — in
-- USD and Congolese francs.  Private to one user: every row carries the
-- owner's user_id and the API only ever reads that user's rows (owner-only
-- routes), on top of the usual tenant isolation.

BEGIN;

CREATE TABLE personal_finance_settings (
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Francs congolais for one US dollar.
  cdf_per_usd      numeric(12,2) NOT NULL DEFAULT 2850 CHECK (cdf_per_usd > 0),
  display_currency text NOT NULL DEFAULT 'USD' CHECK (display_currency IN ('USD', 'CDF')),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
SELECT enable_tenant_rls('personal_finance_settings');

CREATE TABLE personal_finance_categories (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('income', 'expense')),
  name             text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 80),
  -- Monthly limit, in budget_currency. NULL = no budget.
  monthly_budget   numeric(14,2) CHECK (monthly_budget IS NULL OR monthly_budget >= 0),
  budget_currency  text NOT NULL DEFAULT 'USD' CHECK (budget_currency IN ('USD', 'CDF')),
  color            text,
  sort_order       integer NOT NULL DEFAULT 0,
  archived_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personal_finance_categories_org_id_unique UNIQUE (organization_id, id)
);
CREATE INDEX personal_finance_categories_owner_idx
  ON personal_finance_categories(organization_id, user_id, kind, sort_order);
SELECT enable_tenant_rls('personal_finance_categories');

CREATE TABLE personal_finance_debts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- i_owe: a debt or credit I repay.  owed_to_me: money someone owes me.
  direction        text NOT NULL DEFAULT 'i_owe' CHECK (direction IN ('i_owe', 'owed_to_me')),
  name             text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 120),
  counterparty     text CHECK (counterparty IS NULL OR length(counterparty) <= 120),
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  currency         text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'CDF')),
  started_on       date,
  due_on           date,
  note             text CHECK (note IS NULL OR length(note) <= 1000),
  closed_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personal_finance_debts_org_id_unique UNIQUE (organization_id, id)
);
CREATE INDEX personal_finance_debts_owner_idx
  ON personal_finance_debts(organization_id, user_id, closed_at);
SELECT enable_tenant_rls('personal_finance_debts');

CREATE TABLE personal_finance_recurring (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('income', 'expense', 'debt_payment')),
  label            text NOT NULL CHECK (btrim(label) <> '' AND length(label) <= 120),
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  currency         text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'CDF')),
  category_id      uuid,
  debt_id          uuid,
  day_of_month     smallint NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
  active           boolean NOT NULL DEFAULT true,
  starts_on        date NOT NULL DEFAULT date_trunc('month', now())::date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personal_finance_recurring_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT personal_finance_recurring_category_fk FOREIGN KEY (organization_id, category_id)
    REFERENCES personal_finance_categories(organization_id, id) ON DELETE SET NULL (category_id),
  CONSTRAINT personal_finance_recurring_debt_fk FOREIGN KEY (organization_id, debt_id)
    REFERENCES personal_finance_debts(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX personal_finance_recurring_owner_idx
  ON personal_finance_recurring(organization_id, user_id, active);
SELECT enable_tenant_rls('personal_finance_recurring');

CREATE TABLE personal_finance_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- debt_payment: money paid on a debt I owe, or received on money owed to me.
  kind             text NOT NULL CHECK (kind IN ('income', 'expense', 'debt_payment')),
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  currency         text NOT NULL CHECK (currency IN ('USD', 'CDF')),
  -- Rate used when the entry was made, so old months never change when the
  -- franc moves.
  cdf_per_usd      numeric(12,2) NOT NULL CHECK (cdf_per_usd > 0),
  amount_usd       numeric(14,2) NOT NULL,
  category_id      uuid,
  debt_id          uuid,
  recurring_id     uuid,
  recurring_month  date,
  occurred_on      date NOT NULL DEFAULT CURRENT_DATE,
  note             text CHECK (note IS NULL OR length(note) <= 500),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personal_finance_transactions_category_fk FOREIGN KEY (organization_id, category_id)
    REFERENCES personal_finance_categories(organization_id, id) ON DELETE SET NULL (category_id),
  CONSTRAINT personal_finance_transactions_debt_fk FOREIGN KEY (organization_id, debt_id)
    REFERENCES personal_finance_debts(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT personal_finance_transactions_recurring_fk FOREIGN KEY (organization_id, recurring_id)
    REFERENCES personal_finance_recurring(organization_id, id) ON DELETE SET NULL (recurring_id),
  CONSTRAINT personal_finance_transactions_debt_kind CHECK (kind <> 'debt_payment' OR debt_id IS NOT NULL)
);
CREATE INDEX personal_finance_transactions_month_idx
  ON personal_finance_transactions(organization_id, user_id, occurred_on DESC);
CREATE INDEX personal_finance_transactions_debt_idx
  ON personal_finance_transactions(organization_id, debt_id) WHERE debt_id IS NOT NULL;
-- A recurring entry is generated once per month, never twice.
CREATE UNIQUE INDEX personal_finance_transactions_recurring_once
  ON personal_finance_transactions(organization_id, recurring_id, recurring_month)
  WHERE recurring_id IS NOT NULL;
SELECT enable_tenant_rls('personal_finance_transactions');

COMMIT;
