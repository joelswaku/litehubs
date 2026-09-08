-- 060_employee_access_assignments.sql
-- An Owner assigns LiteHubs access to an employee. The secure activation link
-- creates the account and automatically connects its membership to the HR record.

BEGIN;

ALTER TABLE organization_invitations
  ADD COLUMN employee_id uuid;

ALTER TABLE organization_invitations
  ADD CONSTRAINT organization_invitations_employee_fk
  FOREIGN KEY (organization_id, employee_id)
  REFERENCES employees (organization_id, id)
  ON DELETE SET NULL (employee_id);

CREATE INDEX organization_invitations_pending_employee_idx
  ON organization_invitations (organization_id, employee_id)
  WHERE employee_id IS NOT NULL
    AND accepted_at IS NULL
    AND revoked_at IS NULL;

DROP FUNCTION accept_organization_invitation(text, uuid, citext);

CREATE FUNCTION accept_organization_invitation(
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

    -- A profile linked by another assignment while this link was open must not
    -- be silently reassigned to a different person.
    IF NOT FOUND THEN
      RETURN;
    END IF;
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

COMMENT ON COLUMN organization_invitations.employee_id IS
  'Optional HR employee profile automatically linked to the member when this access assignment is activated.';
COMMENT ON FUNCTION accept_organization_invitation(text, uuid, citext) IS
  'Atomically activates one opaque company access assignment for a newly-created user. Invalid links return no row.';

COMMIT;
