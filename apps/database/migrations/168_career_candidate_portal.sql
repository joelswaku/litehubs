BEGIN;

-- Espace candidat: a private, token-based page where an applicant follows the
-- progress of a single application and sends documents requested by HR.  Raw
-- tokens are never stored.  Several links can be valid at the same time so an
-- older e-mail keeps working until it expires.
ALTER TABLE career_applications
  ADD COLUMN IF NOT EXISTS tracking_link_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS tracking_link_attempts integer NOT NULL DEFAULT 0;

CREATE TABLE career_application_access_tokens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id   uuid NOT NULL,
  token_hash       text NOT NULL,
  purpose          text NOT NULL DEFAULT 'tracking',
  expires_at       timestamptz NOT NULL,
  last_used_at     timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT career_application_access_tokens_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT career_application_access_tokens_hash_unique UNIQUE (token_hash),
  CONSTRAINT career_application_access_tokens_application_fk
    FOREIGN KEY (organization_id, application_id)
    REFERENCES career_applications(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT career_application_access_tokens_purpose_check
    CHECK (purpose IN ('tracking'))
);
CREATE INDEX career_application_access_tokens_application_idx
  ON career_application_access_tokens(organization_id, application_id, expires_at DESC);
SELECT enable_tenant_rls('career_application_access_tokens');

CREATE TABLE career_application_document_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id    uuid NOT NULL,
  label             text NOT NULL,
  description       text,
  status            text NOT NULL DEFAULT 'requested',
  due_date          date,
  storage_path      text,
  file_name         text,
  mime_type         text,
  size_bytes        bigint,
  checksum_sha256   text,
  submitted_at      timestamptz,
  reviewed_at       timestamptz,
  reviewed_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  review_note       text,
  requested_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT career_application_document_requests_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT career_application_document_requests_application_fk
    FOREIGN KEY (organization_id, application_id)
    REFERENCES career_applications(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT career_application_document_requests_label_check CHECK (btrim(label) <> ''),
  CONSTRAINT career_application_document_requests_status_check
    CHECK (status IN ('requested', 'submitted', 'accepted', 'rejected', 'cancelled')),
  CONSTRAINT career_application_document_requests_file_check
    CHECK (status NOT IN ('submitted', 'accepted') OR storage_path IS NOT NULL)
);
CREATE INDEX career_application_document_requests_application_idx
  ON career_application_document_requests(organization_id, application_id, created_at);
CREATE TRIGGER career_application_document_requests_set_updated_at
  BEFORE UPDATE ON career_application_document_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT enable_tenant_rls('career_application_document_requests');

CREATE INDEX IF NOT EXISTS career_applications_tracking_backfill_idx
  ON career_applications(organization_id, submitted_at)
  WHERE tracking_link_sent_at IS NULL;

-- Narrow public resolver: a valid token reveals only which application it
-- belongs to.  All reads that follow run inside the tenant context.
CREATE OR REPLACE FUNCTION public_career_tracking_lookup(
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
    'tokenId', t.id,
    'organizationId', t.organization_id,
    'applicationId', t.application_id,
    'expiresAt', t.expires_at
  )
  FROM career_application_access_tokens t
  JOIN organizations o ON o.id=t.organization_id
  WHERE o.slug=lower(btrim(requested_org_slug))
    AND t.token_hash=requested_token_hash
    AND t.revoked_at IS NULL
    AND t.expires_at > now()
  LIMIT 1;
$$;

-- Used by "Retrouver ma candidature".  It returns identifiers only; the API
-- never tells the visitor whether an address matched.
CREATE OR REPLACE FUNCTION public_career_applications_by_email(
  requested_org_slug text,
  requested_email text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'organizationId', o.id,
    'applicationIds', COALESCE(
      (SELECT jsonb_agg(a.id ORDER BY a.submitted_at DESC)
         FROM (SELECT id, submitted_at FROM career_applications
                WHERE organization_id=o.id
                  AND lower(email::text)=lower(btrim(requested_email))
                ORDER BY submitted_at DESC
                LIMIT 5) a),
      '[]'::jsonb)
  )
  FROM organizations o
  WHERE o.slug=lower(btrim(requested_org_slug))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public_career_tracking_lookup(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public_career_applications_by_email(text, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='litehubs_app') THEN
    GRANT EXECUTE ON FUNCTION public_career_tracking_lookup(text, text) TO litehubs_app;
    GRANT EXECUTE ON FUNCTION public_career_applications_by_email(text, text) TO litehubs_app;
  END IF;
END $$;

COMMENT ON TABLE career_application_access_tokens IS
  'Hashed personal links for the candidate portal (Espace candidat).';
COMMENT ON TABLE career_application_document_requests IS
  'Documents requested by HR from a candidate and uploaded through the candidate portal.';

COMMIT;
