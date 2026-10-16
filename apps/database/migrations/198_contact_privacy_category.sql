-- 198_contact_privacy_category.sql
-- The public contact form gets a "privacy / data deletion" topic, used by the
-- privacy policy's deletion instructions (litehubs.com/contact?sujet=privacy).

BEGIN;

ALTER TABLE platform_contact_requests
  DROP CONSTRAINT platform_contact_requests_category_check;
ALTER TABLE platform_contact_requests
  ADD CONSTRAINT platform_contact_requests_category_check
  CHECK (category IN ('general', 'access', 'technical', 'billing', 'demo', 'privacy', 'other'));

COMMIT;
