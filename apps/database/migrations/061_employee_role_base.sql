-- 061_employee_role_base.sql
-- A promotion adds responsibility; it never removes an employee's personal
-- self-service role. Backfill linked profiles and make future access
-- activations preserve that invariant atomically.

BEGIN;

INSERT INTO member_roles (organization_id, member_id, role_id)
SELECT e.organization_id, e.member_id, r.id
  FROM employees e
  JOIN roles r
    ON r.organization_id = e.organization_id
   AND r.code = 'employee'
 WHERE e.member_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION accept_organization_invitation(
  p_token_hash text,
  p_user_id uuid,
  p_email citext
)
RETURNS TABLE (
  accepted_organization_id uuid,
  accepted_organization_slug text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  access_assignment organization_invitations%ROWTYPE;
  accepted_member_id uuid;
  expected_roles integer;
  valid_roles integer;
BEGIN
  SELECT *
    INTO access_assignment
    FROM organization_invitations
   WHERE token_hash = p_token_hash
   FOR UPDATE;

  IF NOT FOUND
     OR access_assignment.accepted_at IS NOT NULL
     OR access_assignment.revoked_at IS NOT NULL
     OR access_assignment.expires_at <= now()
     OR access_assignment.email <> p_email THEN
    RETURN;
  END IF;

  expected_roles := COALESCE(array_length(access_assignment.role_ids, 1), 0);

  SELECT count(*)
    INTO valid_roles
    FROM roles r
   WHERE r.organization_id = access_assignment.organization_id
     AND r.id = ANY(access_assignment.role_ids);

  IF valid_roles <> expected_roles THEN
    RETURN;
  END IF;

  INSERT INTO organization_members (
    organization_id, user_id, status, is_owner, job_title, invited_by, joined_at
  )
  VALUES (
    access_assignment.organization_id, p_user_id, 'active', false,
    access_assignment.job_title, access_assignment.invited_by, now()
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET status = 'active',
        job_title = COALESCE(EXCLUDED.job_title, organization_members.job_title),
        updated_at = now()
  RETURNING id INTO accepted_member_id;

  INSERT INTO member_roles (organization_id, member_id, role_id)
  SELECT access_assignment.organization_id, accepted_member_id, r.id
    FROM roles r
   WHERE r.organization_id = access_assignment.organization_id
     AND r.id = ANY(access_assignment.role_ids)
  ON CONFLICT DO NOTHING;

  INSERT INTO member_provinces (organization_id, member_id, province_id)
  SELECT access_assignment.organization_id, accepted_member_id, ip.province_id
    FROM organization_invitation_provinces ip
    JOIN provinces p
      ON p.organization_id = ip.organization_id
     AND p.id = ip.province_id
   WHERE ip.organization_id = access_assignment.organization_id
     AND ip.invitation_id = access_assignment.id
  ON CONFLICT DO NOTHING;

  IF access_assignment.employee_id IS NOT NULL THEN
    UPDATE employees
       SET member_id = accepted_member_id
     WHERE organization_id = access_assignment.organization_id
       AND id = access_assignment.employee_id
       AND member_id IS NULL;

    IF NOT FOUND THEN
      RETURN;
    END IF;

    -- Every linked employee keeps the self-service base role, regardless of
    -- the management role selected in the access assignment.
    INSERT INTO member_roles (organization_id, member_id, role_id)
    SELECT r.organization_id, accepted_member_id, r.id
      FROM roles r
     WHERE r.organization_id = access_assignment.organization_id
       AND r.code = 'employee'
    ON CONFLICT DO NOTHING;
  END IF;

  UPDATE organization_invitations
     SET accepted_at = now()
   WHERE id = access_assignment.id;

  RETURN QUERY
  SELECT o.id, o.slug
    FROM organizations o
   WHERE o.id = access_assignment.organization_id;
END;
$$;

COMMENT ON FUNCTION accept_organization_invitation(text, uuid, citext) IS
  'Atomically activates one opaque company access assignment and keeps the Employee self-service role on linked HR profiles.';

COMMIT;