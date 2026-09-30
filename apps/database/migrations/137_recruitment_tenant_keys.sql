-- Recruitment records are tenant-scoped.  The former keys were safe in
-- practice because UUID foreign keys are globally unique, but including the
-- organization identifier makes the isolation rule explicit and enforceable
-- by schema review tooling.

ALTER TABLE career_applications
  DROP CONSTRAINT IF EXISTS career_applications_one_per_job_email;

ALTER TABLE career_applications
  ADD CONSTRAINT career_applications_one_per_job_email
  UNIQUE (organization_id, job_post_id, email);

ALTER TABLE career_application_files
  DROP CONSTRAINT IF EXISTS career_application_files_resume_unique;

ALTER TABLE career_application_files
  ADD CONSTRAINT career_application_files_resume_unique
  UNIQUE (organization_id, application_id, kind);
