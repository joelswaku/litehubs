-- 033_platform_cross_tenant_read.sql
-- Lets LiteHubs staff see the *list* of tenants, without making them members.
--
-- The problem this solves. structure.md §1 is explicit: a platform super-admin
-- is **not** implicitly a member of every organization. That is enforced today
-- by RLS — `organization_visibility` shows a row only when it is the active
-- organization or the caller is an active member — which is correct, and which
-- also means the staff console cannot list a single tenant. A platform admin
-- currently sees nothing at all.
--
-- The wrong fixes, and why:
--
--   * Connect the API as a superuser for staff routes. Superusers bypass RLS
--     entirely, so one mistake in one handler exposes every tenant's business
--     data. This is the option that must never be taken.
--   * Give `litehubs_app` BYPASSRLS. Same outcome, permanently, for every
--     request rather than just staff ones.
--   * Insert platform staff as members of every organization. Corrupts the
--     membership model, shows up in every customer's member list, and makes
--     "who works here" unanswerable.
--
-- What this does instead: adds a **narrow, SELECT-only** policy scoped to a
-- specific platform permission, on exactly the tables the console needs.
--
-- What it deliberately does NOT grant. Only `organizations` and
-- `organization_subscriptions` — the tenant *registry*, not tenant *data*. No
-- policy is added to employees, flocks, payroll, the ledger or anything else,
-- so a platform admin still cannot read a customer's business records. Reading
-- those stays what §1 calls it: an explicit, audited action, which would mean
-- impersonation through `platform.organizations.impersonate` and an audit_log
-- entry — not a silent SELECT.

/**
 * Whether the current user holds a platform permission.
 *
 * Reads only the platform plane, which has no RLS of its own — a session
 * belongs to a person, not a company (§4.5) — so this cannot recurse into a
 * tenant policy and deadlock.
 *
 * SECURITY INVOKER (the default), deliberately: it needs no privilege the app
 * role does not already have, and a SECURITY DEFINER function here would be a
 * standing escalation for no benefit.
 */
CREATE OR REPLACE FUNCTION current_user_has_platform_permission(permission_code text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM user_platform_roles upr
      JOIN platform_role_permissions prp
        ON prp.platform_role_id = upr.platform_role_id
      JOIN platform_permissions pp
        ON pp.id = prp.platform_permission_id
     WHERE upr.user_id = current_user_id()
       AND pp.code = permission_code
  )
$$;

COMMENT ON FUNCTION current_user_has_platform_permission(text) IS
  'True when the signed-in user holds this platform.* permission. Used by the staff-console read policies; reads only the RLS-free platform plane.';

-- Permissive policies are OR'd with the existing one, so this widens what staff
-- can read without touching what a tenant member can.
CREATE POLICY organization_platform_read ON organizations
  FOR SELECT
  USING (current_user_has_platform_permission('platform.organizations.read'));

COMMENT ON POLICY organization_platform_read ON organizations IS
  'Staff console: read the tenant registry. SELECT only — staff still cannot read tenant business data, and are not members.';

CREATE POLICY organization_subscriptions_platform_read ON organization_subscriptions
  FOR SELECT
  USING (current_user_has_platform_permission('platform.subscriptions.read'));

COMMENT ON POLICY organization_subscriptions_platform_read ON organization_subscriptions IS
  'Staff console: read plans and billing status across tenants. SELECT only.';

-- Suspending a tenant is a platform action — a customer cannot suspend
-- themselves, and support must be able to. Separate from the read policy and
-- behind its own permission, so read access does not imply write access.
CREATE POLICY organization_platform_update ON organizations
  FOR UPDATE
  USING (current_user_has_platform_permission('platform.organizations.update'))
  WITH CHECK (current_user_has_platform_permission('platform.organizations.update'));

COMMENT ON POLICY organization_platform_update ON organizations IS
  'Staff console: suspend, reactivate or correct a tenant record. Gated on platform.organizations.update, which read access does not confer.';
