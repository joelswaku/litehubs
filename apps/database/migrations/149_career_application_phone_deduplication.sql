BEGIN;

-- Public applicants often retry on an unstable connection or write the same
-- DRC number as +243…, 243…, or with spaces.  This index supports the
-- transaction-locked duplicate check in the API without changing historical
-- candidate records.
CREATE INDEX IF NOT EXISTS career_applications_job_phone_normalized_idx
  ON career_applications (
    organization_id,
    job_post_id,
    (regexp_replace(phone, '[^0-9]', '', 'g'))
  );

COMMIT;
