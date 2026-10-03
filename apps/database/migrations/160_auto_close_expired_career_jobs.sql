BEGIN;

-- A public vacancy is a time-bound offer.  Close already-expired posts now so
-- the administration shows the same state that the public application API
-- enforces.  Future expiry is handled every night by the application scheduler.
UPDATE career_job_posts
   SET status = 'closed',
       closed_at = COALESCE(closed_at, now()),
       updated_at = now()
 WHERE status = 'published'
   AND application_deadline IS NOT NULL
   AND application_deadline < (now() AT TIME ZONE 'Africa/Kinshasa')::date;

CREATE INDEX IF NOT EXISTS career_job_posts_expiry_idx
  ON career_job_posts (organization_id, application_deadline)
  WHERE status = 'published' AND application_deadline IS NOT NULL;

-- Public reads and submissions both use this function.  The explicit Congo
-- time zone keeps an offer open until the end of its displayed closing day,
-- regardless of the database server's own time zone.
CREATE OR REPLACE FUNCTION public_career_jobs(
  p_organization_slug text,
  p_job_code text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  province_id uuid,
  site_id uuid,
  code text,
  title text,
  department_name text,
  employment_type text,
  experience_level text,
  positions_open integer,
  short_summary text,
  description text,
  responsibilities text,
  requirements text,
  benefits text,
  salary_summary text,
  application_deadline date,
  status text,
  published_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  display_name text,
  site_code text,
  site_name text,
  province_code text,
  province_name text,
  careers_intro text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    j.id, j.organization_id, j.province_id, j.site_id, j.code, j.title,
    j.department_name, j.employment_type, j.experience_level, j.positions_open,
    j.short_summary, j.description, j.responsibilities, j.requirements,
    j.benefits, j.salary_summary, j.application_deadline, j.status,
    j.published_at, j.closed_at, j.created_at, j.updated_at,
    o.display_name, s.code, s.name, p.code, p.name, settings.careers_intro
  FROM organizations o
  JOIN career_job_posts j
    ON j.organization_id = o.id
   AND j.status = 'published'
  JOIN sites s
    ON s.organization_id = j.organization_id
   AND s.id = j.site_id
   AND s.is_active
  JOIN provinces p
    ON p.organization_id = j.organization_id
   AND p.id = j.province_id
  JOIN career_site_settings settings
    ON settings.organization_id = j.organization_id
   AND settings.site_id = j.site_id
   AND settings.public_careers_enabled
  WHERE o.slug = p_organization_slug
    AND o.status = 'active'
    AND (p_job_code IS NULL OR j.code = p_job_code)
    AND (
      j.application_deadline IS NULL
      OR j.application_deadline >= (now() AT TIME ZONE 'Africa/Kinshasa')::date
    );
$$;

REVOKE ALL ON FUNCTION public_career_jobs(text, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'litehubs_app') THEN
    GRANT EXECUTE ON FUNCTION public_career_jobs(text, text) TO litehubs_app;
  END IF;
END;
$$;

COMMIT;
