-- 009_company_setup_invitations.sql
-- Supports secure team invitations with role and province assignments.

-- Allows tenant-safe composite foreign keys from invitation children.
ALTER TABLE organization_invitations
  ADD CONSTRAINT organization_invitations_org_id_unique
  UNIQUE (organization_id, id);

-- Province assignments selected while creating an invitation. The assignments
-- are copied to member_provinces when the invitee accepts.
CREATE TABLE organization_invitation_provinces (
  organization_id uuid NOT NULL,
  invitation_id   uuid NOT NULL,
  province_id     uuid NOT NULL,
  PRIMARY KEY (invitation_id, province_id),
  CONSTRAINT invitation_provinces_invitation_fk
    FOREIGN KEY (organization_id, invitation_id)
    REFERENCES organization_invitations (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT invitation_provinces_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX organization_invitation_provinces_province_idx
  ON organization_invitation_provinces (organization_id, province_id);

SELECT enable_tenant_rls('organization_invitation_provinces');

COMMENT ON TABLE organization_invitation_provinces IS
  'Province access selected by an inviter and copied to a member on acceptance.';

-- A public invitation link must be able to add a new person before they are a
-- member. This narrowly scoped function is the only RLS exception: it accepts
-- a hashed opaque token, verifies the invited email and expiry, creates the
-- membership, copies approved roles/provinces, then consumes the invitation.
--
-- It returns no row for an invalid, expired, revoked, already-used or
-- email-mismatched invitation. That prevents the public endpoint from exposing
-- which condition failed.
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
    FROM roles
   WHERE organization_id = invitation.organization_id
     AND id = ANY(invitation.role_ids);

  -- A role may have been deleted after an invitation was issued. Do not create
  -- a partial membership in that case.
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

COMMENT ON FUNCTION accept_organization_invitation(text, uuid, citext) IS
  'Atomically accepts one opaque invitation for a newly-created user. Invalid tokens return no row.';

