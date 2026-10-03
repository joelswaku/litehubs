BEGIN;

-- A public customer may choose a phone-first account.  Employee accounts are
-- deliberately unrelated; this affects only the public website customer area.
ALTER TABLE public_customer_accounts
  ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public_customer_accounts
  DROP CONSTRAINT IF EXISTS public_customer_accounts_email_not_blank;
ALTER TABLE public_customer_accounts
  ADD COLUMN IF NOT EXISTS verification_channel text NOT NULL DEFAULT 'email'
    CHECK (verification_channel IN ('email', 'sms')),
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;
ALTER TABLE public_customer_accounts
  ADD CONSTRAINT public_customer_accounts_contact_not_blank
    CHECK (email IS NOT NULL OR phone IS NOT NULL) NOT VALID;
ALTER TABLE public_customer_accounts
  VALIDATE CONSTRAINT public_customer_accounts_contact_not_blank;

-- The browser receives only a six-digit code.  The database stores an HMAC
-- fingerprint, never the usable code.  A code is short-lived, one-use and is
-- limited to six attempts so it cannot become a replacement password.
CREATE TABLE public_customer_account_verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  delivery_channel text NOT NULL CHECK (delivery_channel IN ('email', 'sms')),
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 6),
  requested_ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_customer_account_verification_codes_account_fk
    FOREIGN KEY (organization_id, account_id)
    REFERENCES public_customer_accounts(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX public_customer_account_verification_codes_lookup_idx
  ON public_customer_account_verification_codes
  (organization_id, account_id, delivery_channel, created_at DESC);
SELECT enable_tenant_rls('public_customer_account_verification_codes');

COMMIT;
