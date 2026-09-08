-- 003_organizations.sql
-- The tenants themselves, plus the industry list onboarding chooses from.

-- ----------------------------------------------------------- industries ----
-- Platform-owned catalogue. Drives which templates are offered at onboarding.
CREATE TABLE industries (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  description text,
  sort_order  integer NOT NULL DEFAULT 100,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT industries_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$')
);

-- -------------------------------------------------------- organizations ----
CREATE TABLE organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Used in workspace URLs: /congo-omega/dashboard
  slug          text NOT NULL UNIQUE,
  legal_name    text NOT NULL,
  display_name  text NOT NULL,
  industry_code text REFERENCES industries (code) ON DELETE SET NULL,
  country       text,
  timezone      text NOT NULL DEFAULT 'UTC',
  currency      char(3) NOT NULL DEFAULT 'USD',
  status        text NOT NULL DEFAULT 'active',
  -- Cleared rather than cascaded: losing the creating user must not delete the
  -- company.
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_slug_format
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  CONSTRAINT organizations_status_check
    CHECK (status IN ('provisioning', 'active', 'suspended', 'archived')),
  CONSTRAINT organizations_legal_name_not_blank
    CHECK (btrim(legal_name) <> ''),
  CONSTRAINT organizations_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX organizations_status_idx ON organizations (status);
CREATE INDEX organizations_industry_idx ON organizations (industry_code);

-- Deliberately NOT enable_tenant_rls: this table's tenant key is `id`, not
-- `organization_id`, and the middleware must be able to resolve a slug to an id
-- *before* any organization context exists. Its visibility policy is added in
-- 004, once organization_members exists to define "may see".
COMMENT ON TABLE organizations IS
  'Tenants. Visibility policy is defined in 004 (needs organization_members).';

-- ---------------------------------------------- per-organization settings ----
CREATE TABLE organization_settings (
  organization_id      uuid PRIMARY KEY
    REFERENCES organizations (id) ON DELETE CASCADE,
  logo_url             text,
  primary_color        text,
  date_format          text NOT NULL DEFAULT 'yyyy-MM-dd',
  week_starts_on       smallint NOT NULL DEFAULT 1,
  fiscal_year_start    smallint NOT NULL DEFAULT 1,
  -- Module-specific knobs that do not deserve a column each.
  preferences          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_settings_week_start
    CHECK (week_starts_on BETWEEN 0 AND 6),
  CONSTRAINT organization_settings_fiscal_month
    CHECK (fiscal_year_start BETWEEN 1 AND 12)
);

CREATE TRIGGER organization_settings_set_updated_at
  BEFORE UPDATE ON organization_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enable_tenant_rls('organization_settings');

-- ------------------------------------------------------- subscriptions ----
CREATE TABLE organization_subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  plan_code            text NOT NULL DEFAULT 'trial',
  status               text NOT NULL DEFAULT 'trialing',
  seats                integer NOT NULL DEFAULT 5,
  trial_ends_at        timestamptz,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancelled_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_subscriptions_status_check
    CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled')),
  CONSTRAINT organization_subscriptions_seats_positive CHECK (seats > 0)
);

CREATE TRIGGER organization_subscriptions_set_updated_at
  BEFORE UPDATE ON organization_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One live subscription per organization; cancelled ones are kept for history.
CREATE UNIQUE INDEX organization_subscriptions_one_live_idx
  ON organization_subscriptions (organization_id)
  WHERE cancelled_at IS NULL;

SELECT enable_tenant_rls('organization_subscriptions');
