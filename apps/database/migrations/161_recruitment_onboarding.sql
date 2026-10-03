BEGIN;

-- A private bridge between recruitment and the employee dossier.  The raw
-- token is never stored: the public form is reachable only through a short-
-- lived, high-entropy link sent with an employment offer.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS place_of_birth text,
  ADD COLUMN IF NOT EXISTS identity_document_number text,
  ADD COLUMN IF NOT EXISTS social_security_number text,
  ADD COLUMN IF NOT EXISTS career_application_id uuid;

ALTER TABLE employees
  DROP CONSTRAINT IF EXISTS employees_career_application_fk,
  ADD CONSTRAINT employees_career_application_fk
    FOREIGN KEY (organization_id, career_application_id)
    REFERENCES career_applications(organization_id, id)
    ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS employees_career_application_unique_idx
  ON employees(organization_id, career_application_id)
  WHERE career_application_id IS NOT NULL;

CREATE TABLE career_candidate_onboardings (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id                 uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id                  uuid NOT NULL,
  token_hash                      text NOT NULL,
  status                          text NOT NULL DEFAULT 'pending',
  expires_at                      timestamptz NOT NULL,
  last_name                       text,
  post_name                       text,
  first_name                      text,
  date_of_birth                   date,
  place_of_birth                  text,
  address_line1                   text,
  address_line2                   text,
  address_city                    text,
  address_region                  text,
  address_postal_code             text,
  address_country                 text,
  identity_document_type          text,
  identity_document_number        text,
  social_security_number          text,
  emergency_contact_name          text,
  emergency_contact_relationship  text,
  emergency_contact_phone         text,
  portrait_document_id            uuid,
  identity_document_id            uuid,
  submitted_at                    timestamptz,
  completed_at                    timestamptz,
  linked_employee_id              uuid,
  created_by_user_id              uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT career_candidate_onboardings_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT career_candidate_onboardings_application_unique UNIQUE (organization_id, application_id),
  CONSTRAINT career_candidate_onboardings_token_unique UNIQUE (token_hash),
  CONSTRAINT career_candidate_onboardings_application_fk
    FOREIGN KEY (organization_id, application_id)
    REFERENCES career_applications(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT career_candidate_onboardings_portrait_fk
    FOREIGN KEY (organization_id, portrait_document_id)
    REFERENCES documents(organization_id, id) ON DELETE SET NULL,
  CONSTRAINT career_candidate_onboardings_identity_fk
    FOREIGN KEY (organization_id, identity_document_id)
    REFERENCES documents(organization_id, id) ON DELETE SET NULL,
  CONSTRAINT career_candidate_onboardings_employee_fk
    FOREIGN KEY (organization_id, linked_employee_id)
    REFERENCES employees(organization_id, id) ON DELETE SET NULL,
  CONSTRAINT career_candidate_onboardings_status_check
    CHECK (status IN ('pending', 'completed', 'expired', 'cancelled')),
  CONSTRAINT career_candidate_onboardings_identity_type_check
    CHECK (identity_document_type IS NULL OR identity_document_type IN ('national_id', 'passport', 'voter_card', 'driving_licence', 'other')),
  CONSTRAINT career_candidate_onboardings_completed_check
    CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

CREATE INDEX career_candidate_onboardings_pending_idx
  ON career_candidate_onboardings(organization_id, status, expires_at)
  WHERE status = 'pending';
CREATE TRIGGER career_candidate_onboardings_set_updated_at
  BEFORE UPDATE ON career_candidate_onboardings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT enable_tenant_rls('career_candidate_onboardings');

-- Portraits are HR dossier evidence, not website images.  They stay in the
-- private document store and can only be read through HR permissions.
ALTER TABLE management_employee_dossier_documents
  DROP CONSTRAINT IF EXISTS management_employee_dossier_documents_kind_check,
  ADD CONSTRAINT management_employee_dossier_documents_kind_check
    CHECK(document_kind IN ('identity','portrait','driving_licence','contract','payroll','training_certificate','medical_clearance','disciplinary','other'));

-- Deliberately narrow public read.  A token can reveal only the candidate's
-- own pending onboarding form; it cannot enumerate a candidate or company.
CREATE OR REPLACE FUNCTION public_career_onboarding_context(
  requested_org_slug text,
  requested_token_hash text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'onboardingId', ob.id,
    'organizationId', ob.organization_id,
    'organizationName', COALESCE(ws.display_name, o.display_name),
    'applicationId', a.id,
    'candidate', jsonb_build_object('fullName', a.full_name, 'email', a.email, 'phone', a.phone),
    'job', jsonb_build_object('title', j.title, 'siteName', s.name),
    'expiresAt', ob.expires_at,
    'profile', jsonb_build_object(
      'lastName', ob.last_name,
      'postName', ob.post_name,
      'firstName', ob.first_name,
      'dateOfBirth', ob.date_of_birth,
      'placeOfBirth', ob.place_of_birth,
      'addressLine1', ob.address_line1,
      'addressLine2', ob.address_line2,
      'addressCity', ob.address_city,
      'addressRegion', ob.address_region,
      'addressPostalCode', ob.address_postal_code,
      'addressCountry', ob.address_country,
      'identityDocumentType', ob.identity_document_type,
      'identityDocumentNumber', ob.identity_document_number,
      'socialSecurityNumber', ob.social_security_number,
      'emergencyContactName', ob.emergency_contact_name,
      'emergencyContactRelationship', ob.emergency_contact_relationship,
      'emergencyContactPhone', ob.emergency_contact_phone
    )
  )
  FROM career_candidate_onboardings ob
  JOIN career_applications a ON a.organization_id=ob.organization_id AND a.id=ob.application_id
  JOIN career_job_posts j ON j.organization_id=a.organization_id AND j.id=a.job_post_id
  JOIN sites s ON s.organization_id=a.organization_id AND s.id=a.site_id
  JOIN organizations o ON o.id=ob.organization_id
  LEFT JOIN organization_website_settings ws ON ws.organization_id=o.id
  WHERE o.slug=lower(btrim(requested_org_slug))
    AND ob.token_hash=requested_token_hash
    AND ob.status='pending'
    AND ob.expires_at > now()
    AND a.status IN ('offered', 'hired')
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public_career_onboarding_context(text, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='litehubs_app') THEN
    GRANT EXECUTE ON FUNCTION public_career_onboarding_context(text, text) TO litehubs_app;
  END IF;
END $$;

COMMENT ON TABLE career_candidate_onboardings IS
  'Private offer-stage onboarding form. Tokens are stored only as hashes; submitted evidence is transferred into the confidential employee dossier.';

COMMIT;
