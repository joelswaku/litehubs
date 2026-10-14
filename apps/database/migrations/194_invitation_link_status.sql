-- 194_invitation_link_status.sql
-- The "Set your password" page checks the link before showing the form, so a
-- link that was already used, revoked or expired says so instead of offering a
-- password form that can only fail. Returns no personal data beyond the
-- workspace name and a masked e-mail.

BEGIN;

CREATE OR REPLACE FUNCTION public_invitation_status(p_token_hash text)
RETURNS TABLE (
  link_status text,
  organization_name text,
  email_hint text,
  existing_account boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  invitation organization_invitations%ROWTYPE;
  local_part text;
BEGIN
  SELECT * INTO invitation FROM organization_invitations WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text, NULL::text, false;
    RETURN;
  END IF;
  local_part := split_part(invitation.email::text, '@', 1);
  RETURN QUERY
  SELECT
    CASE
      WHEN invitation.accepted_at IS NOT NULL THEN 'used'
      WHEN invitation.revoked_at IS NOT NULL THEN 'revoked'
      WHEN invitation.expires_at <= now() THEN 'expired'
      ELSE 'valid'
    END,
    COALESCE(o.display_name, o.legal_name),
    left(local_part, 2) || repeat('•', greatest(length(local_part) - 2, 1)) || '@' || split_part(invitation.email::text, '@', 2),
    EXISTS (SELECT 1 FROM users u WHERE u.email = invitation.email)
  FROM organizations o
  WHERE o.id = invitation.organization_id;
END;
$$;

REVOKE ALL ON FUNCTION public_invitation_status(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='litehubs_app') THEN
    GRANT EXECUTE ON FUNCTION public_invitation_status(text) TO litehubs_app;
  END IF;
END $$;

COMMIT;
