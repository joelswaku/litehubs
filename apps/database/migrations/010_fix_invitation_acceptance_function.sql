-- 010_fix_invitation_acceptance_function.sql
-- The return-column names in the previous function overlap with table columns.
-- Qualify the role lookup so PostgreSQL cannot treat organization_id as the
-- PL/pgSQL output variable.

CREATE OR REPLACE FUNCTION accept_organization_invitation(
  p_token_hash text,
  p_user_id uuid,
  p_email citext
)
RETURNS TABLE (
  organization_id uuid,
  organization_slug text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  invitation organization_invitations%ROWTYPE;
  accepted_member_id uuid;
  expected_roles integer;
  valid_roles integer;
BEGIN
  SELECT *
    INTO invitation
    FROM organization_invitations
   WHERE token_hash = p_token_hash
   FOR UPDATE;

  IF NOT FOUND
     OR invitation.accepted_at IS NOT NULL
     OR invitation.revoked_at IS NOT NULL
     OR invitation.expires_at <= now()
     OR invitation.email <> p_email THEN
    RETURN;
  END IF;

  expected_roles := COALESCE(array_length(invitation.role_ids, 1), 0);

  SELECT count(*)
    INTO valid_roles
    FROM roles r
   WHERE r.organization_id = invitation.organization_id
     AND r.id = ANY(invitation.role_ids);

  IF valid_roles <> expected_roles THEN
    RETURN;
  END IF;

  INSERT INTO organization_members (
    organization_id, user_id, status, is_owner, job_title, invited_by, joined_at
  )
  VALUES (
    invitation.organization_id, p_user_id, 'active', false,
    invitation.job_title, invitation.invited_by, now()
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET status = 'active',
        job_title = COALESCE(EXCLUDED.job_title, organization_members.job_title),
        updated_at = now()
  RETURNING id INTO accepted_member_id;

  INSERT INTO member_roles (organization_id, member_id, role_id)
  SELECT invitation.organization_id, accepted_member_id, r.id
    FROM roles r
   WHERE r.organization_id = invitation.organization_id
     AND r.id = ANY(invitation.role_ids)
  ON CONFLICT DO NOTHING;

  INSERT INTO member_provinces (organization_id, member_id, province_id)
  SELECT invitation.organization_id, accepted_member_id, ip.province_id
    FROM organization_invitation_provinces ip
    JOIN provinces p
      ON p.organization_id = ip.organization_id
     AND p.id = ip.province_id
   WHERE ip.organization_id = invitation.organization_id
     AND ip.invitation_id = invitation.id
  ON CONFLICT DO NOTHING;

  UPDATE organization_invitations
     SET accepted_at = now()
   WHERE id = invitation.id;

  RETURN QUERY
  SELECT o.id, o.slug
    FROM organizations o
   WHERE o.id = invitation.organization_id;
END;
$$;

