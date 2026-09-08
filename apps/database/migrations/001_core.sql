-- 001_core.sql
-- Extensions, shared helpers, and the tenancy primitives every later migration
-- depends on.

-- Case-insensitive text, so 'Joel@farm.cd' and 'joel@farm.cd' are one email.
CREATE EXTENSION IF NOT EXISTS citext;

-- ------------------------------------------------------------ updated_at ----
-- Attached as a BEFORE UPDATE trigger on any table with an updated_at column,
-- so callers never have to remember to set it.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_updated_at() IS
  'BEFORE UPDATE trigger: stamps updated_at with the current transaction time.';

-- ---------------------------------------------------------- request scope ----
-- organization.middleware.ts opens each request transaction with
--   SET LOCAL app.user_id = '<uuid>'
--   SET LOCAL app.organization_id = '<uuid>'
-- and every tenant policy below reads them through these accessors.
--
-- The `true` argument to current_setting means "return NULL if unset" instead
-- of raising. Unset therefore resolves to NULL, and `col = NULL` is NULL, so an
-- unscoped connection sees no tenant rows at all. Fail closed, not open.

CREATE OR REPLACE FUNCTION current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.organization_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

COMMENT ON FUNCTION current_organization_id() IS
  'Active organization for this transaction, or NULL when unscoped.';

-- -------------------------------------------------------------------- RLS ----
-- Called by each migration immediately after creating a tenant table, so a
-- table cannot exist without an isolation policy. Requires an organization_id
-- column.
--
-- FORCE applies the policy to the table owner too. Note that superusers and
-- roles with BYPASSRLS ignore RLS regardless — which is exactly why the API
-- connects as litehubs_app (see scripts/setup-database.ts).
CREATE OR REPLACE FUNCTION enable_tenant_rls(p_table text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = p_table
       AND column_name = 'organization_id'
  ) THEN
    RAISE EXCEPTION
      'enable_tenant_rls(%): table has no organization_id column', p_table;
  END IF;

  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', p_table);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON public.%I
       USING (organization_id = current_organization_id())
       WITH CHECK (organization_id = current_organization_id())',
    p_table
  );
END;
$$;

COMMENT ON FUNCTION enable_tenant_rls(text) IS
  'Enables forced row-level security scoped to current_organization_id().';

-- Lets scripts/check-tenant-isolation.ts assert that nothing was missed.
CREATE OR REPLACE VIEW tenant_tables_without_rls AS
SELECT c.relname AS table_name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN information_schema.columns col
    ON col.table_schema = 'public'
   AND col.table_name = c.relname
   AND col.column_name = 'organization_id'
 WHERE n.nspname = 'public'
   AND c.relkind = 'r'
   AND NOT c.relrowsecurity;

COMMENT ON VIEW tenant_tables_without_rls IS
  'Any table with organization_id but no RLS enabled. Must always be empty.';
