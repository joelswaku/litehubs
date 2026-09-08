-- 006_organization_creation_policy.sql
-- Lets a signed-in user create an organization as the app role.
--
-- Why this is needed: the organization_visibility policy in 004 defines only
-- USING. PostgreSQL reuses a USING expression as the WITH CHECK for INSERT when
-- no WITH CHECK is given, so creating an organization failed its own policy —
-- at insert time the row is neither the active organization nor one the creator
-- is already a member of.
--
-- Permissive policies are OR'd, so this adds a narrow insert path without
-- widening what anyone can read. The only row you may insert is one attributed
-- to yourself, which the provisioning service then makes you the owner of.

CREATE POLICY organization_self_service_insert ON organizations
  FOR INSERT
  WITH CHECK (
    current_user_id() IS NOT NULL
    AND created_by = current_user_id()
  );

COMMENT ON POLICY organization_self_service_insert ON organizations IS
  'Self-serve onboarding: a user may create an organization attributed to themselves.';
