-- 089_public_careers_directory.sql
-- RLS protects every organization-owned table. The public careers pages need a
-- deliberately narrow read-only view of vacancies that have been published by
-- a company and whose site has explicitly opened its Careers portal.

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
    AND (j.application_deadline IS NULL OR j.application_deadline >= CURRENT_DATE);
$$;

REVOKE ALL ON FUNCTION public_career_jobs(text, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'litehubs_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public_career_jobs(text, text) TO litehubs_app';
  END IF;
END;
$$;