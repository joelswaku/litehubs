BEGIN;

-- Public customers are deliberately not LiteHubs users.  A shopper must never
-- acquire a workspace membership, an employee role or access to operational
-- data merely by creating an account on a company website.
CREATE TABLE public_customer_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid,
  full_name text NOT NULL,
  email citext NOT NULL,
  phone text,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending_email_verification'
    CHECK (status IN ('pending_email_verification','active','suspended','closed')),
  email_verified_at timestamptz,
  newsletter_opt_in boolean NOT NULL DEFAULT false,
  newsletter_opted_in_at timestamptz,
  newsletter_opted_out_at timestamptz,
  failed_login_attempts integer NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_customer_accounts_full_name_not_blank CHECK (btrim(full_name) <> ''),
  CONSTRAINT public_customer_accounts_email_not_blank CHECK (btrim(email::text) <> ''),
  CONSTRAINT public_customer_accounts_newsletter_consent_check
    CHECK ((newsletter_opt_in = false) OR newsletter_opted_in_at IS NOT NULL),
  CONSTRAINT public_customer_accounts_customer_fk
    FOREIGN KEY (organization_id, customer_id)
    REFERENCES customers(organization_id, id) ON DELETE SET NULL (customer_id),
  CONSTRAINT public_customer_accounts_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT public_customer_accounts_email_unique UNIQUE (organization_id, email)
);

CREATE UNIQUE INDEX public_customer_accounts_phone_unique
  ON public_customer_accounts (organization_id, phone)
  WHERE phone IS NOT NULL;
CREATE INDEX public_customer_accounts_customer_idx
  ON public_customer_accounts (organization_id, customer_id);
CREATE INDEX public_customer_accounts_active_idx
  ON public_customer_accounts (organization_id, status)
  WHERE status = 'active';
CREATE TRIGGER public_customer_accounts_set_updated_at
  BEFORE UPDATE ON public_customer_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT enable_tenant_rls('public_customer_accounts');

-- Short-lived, one-use account links.  The opaque secret is only ever held by
-- the visitor; the database keeps an HMAC fingerprint so a database leak does
-- not turn into a usable confirmation or password-reset link.
CREATE TABLE public_customer_account_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  requested_ip inet,
  CONSTRAINT public_customer_account_tokens_account_fk
    FOREIGN KEY (organization_id, account_id)
    REFERENCES public_customer_accounts(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX public_customer_account_tokens_account_idx
  ON public_customer_account_tokens (organization_id, account_id, purpose, created_at DESC);
SELECT enable_tenant_rls('public_customer_account_tokens');

-- Browser sessions are rotated server-side.  They are separate from employee
-- refresh_tokens, so revoking a public customer session can never affect a
-- team member and vice versa.
CREATE TABLE public_customer_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  replaced_by_id uuid REFERENCES public_customer_refresh_tokens(id) ON DELETE SET NULL,
  user_agent text,
  ip_address inet,
  CONSTRAINT public_customer_refresh_tokens_account_fk
    FOREIGN KEY (organization_id, account_id)
    REFERENCES public_customer_accounts(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX public_customer_refresh_tokens_active_idx
  ON public_customer_refresh_tokens (organization_id, account_id)
  WHERE revoked_at IS NULL;
CREATE INDEX public_customer_refresh_tokens_expiry_idx
  ON public_customer_refresh_tokens (expires_at);
SELECT enable_tenant_rls('public_customer_refresh_tokens');

-- Resolve a verified and published public website without giving a browser a
-- direct read on internal company tables. Congo Omega's approved branded
-- fallback mirrors the existing public website recovery shell.
CREATE OR REPLACE FUNCTION public_website_account_context(requested_domain text)
RETURNS TABLE (
  organization_id uuid,
  canonical_domain text,
  display_name text,
  contact_email text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    o.id,
    COALESCE(NULLIF(lower(regexp_replace(ws.custom_domain, '^www\\.', '')), ''), 'congoomega.com'),
    ws.display_name,
    ws.contact_email
  FROM organizations o
  JOIN organization_website_settings ws ON ws.organization_id=o.id
  WHERE o.status='active'
    AND ws.publication_status='published'
    AND (
      lower(regexp_replace(COALESCE(ws.custom_domain, ''), '^www\\.', '')) =
        lower(regexp_replace(btrim(requested_domain), '^www\\.', ''))
      OR (
        lower(regexp_replace(btrim(requested_domain), '^www\\.', ''))='congoomega.com'
        AND o.slug IN ('congo-omega','kins')
      )
    )
  ORDER BY
    (lower(regexp_replace(COALESCE(ws.custom_domain, ''), '^www\\.', '')) =
      lower(regexp_replace(btrim(requested_domain), '^www\\.', ''))) DESC,
    (o.slug='kins') DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public_website_account_context(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='litehubs_app') THEN
    GRANT EXECUTE ON FUNCTION public_website_account_context(text) TO litehubs_app;
  END IF;
END $$;

COMMIT;
