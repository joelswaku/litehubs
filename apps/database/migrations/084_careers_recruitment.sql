-- 084_careers_recruitment.sql
-- Public, site-scoped careers and private candidate records. A published job
-- remains invisible until its site explicitly enables public careers.

CREATE TABLE career_site_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL,
  public_careers_enabled boolean NOT NULL DEFAULT false,
  careers_intro text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT career_site_settings_site_unique UNIQUE (organization_id, site_id),
  CONSTRAINT career_site_settings_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES sites(organization_id, id) ON DELETE CASCADE
);
CREATE TRIGGER career_site_settings_set_updated_at
  BEFORE UPDATE ON career_site_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT enable_tenant_rls('career_site_settings');

CREATE TABLE career_job_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  province_id uuid NOT NULL,
  site_id uuid NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  department_name text,
  employment_type text NOT NULL DEFAULT 'permanent',
  experience_level text NOT NULL DEFAULT 'not_specified',
  positions_open integer NOT NULL DEFAULT 1,
  short_summary text NOT NULL,
  description text NOT NULL,
  responsibilities text,
  requirements text,
  benefits text,
  salary_summary text,
  application_deadline date,
  status text NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  closed_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT career_job_posts_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT career_job_posts_code_unique UNIQUE (organization_id, code),
  CONSTRAINT career_job_posts_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES sites(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT career_job_posts_province_fk FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT career_job_posts_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT career_job_posts_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT career_job_posts_summary_not_blank CHECK (btrim(short_summary) <> ''),
  CONSTRAINT career_job_posts_description_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT career_job_posts_positions_check CHECK (positions_open BETWEEN 1 AND 999),
  CONSTRAINT career_job_posts_employment_type_check CHECK (employment_type IN ('permanent','temporary','contract','casual','internship')),
  CONSTRAINT career_job_posts_experience_check CHECK (experience_level IN ('entry','junior','mid','senior','lead','not_specified')),
  CONSTRAINT career_job_posts_status_check CHECK (status IN ('draft','published','paused','closed','archived'))
);
CREATE TRIGGER career_job_posts_set_updated_at
  BEFORE UPDATE ON career_job_posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX career_job_posts_site_status_idx ON career_job_posts(organization_id, site_id, status, published_at DESC);
CREATE INDEX career_job_posts_province_idx ON career_job_posts(organization_id, province_id, status);
SELECT enable_tenant_rls('career_job_posts');

CREATE TABLE career_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_post_id uuid NOT NULL,
  province_id uuid NOT NULL,
  site_id uuid NOT NULL,
  full_name text NOT NULL,
  email citext NOT NULL,
  phone text NOT NULL,
  city text,
  cover_letter text,
  years_experience numeric(4,1),
  availability text,
  status text NOT NULL DEFAULT 'received',
  internal_notes text,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  consent_at timestamptz NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT career_applications_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT career_applications_job_fk FOREIGN KEY (organization_id, job_post_id)
    REFERENCES career_job_posts(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT career_applications_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES sites(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT career_applications_province_fk FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT career_applications_one_per_job_email UNIQUE (job_post_id, email),
  CONSTRAINT career_applications_name_not_blank CHECK (btrim(full_name) <> ''),
  CONSTRAINT career_applications_phone_not_blank CHECK (btrim(phone) <> ''),
  CONSTRAINT career_applications_experience_check CHECK (years_experience IS NULL OR years_experience BETWEEN 0 AND 80),
  CONSTRAINT career_applications_status_check CHECK (status IN ('received','reviewing','shortlisted','interview','offered','hired','rejected','withdrawn'))
);
CREATE TRIGGER career_applications_set_updated_at
  BEFORE UPDATE ON career_applications FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX career_applications_job_status_idx ON career_applications(organization_id, job_post_id, status, submitted_at DESC);
CREATE INDEX career_applications_site_idx ON career_applications(organization_id, site_id, submitted_at DESC);
SELECT enable_tenant_rls('career_applications');

CREATE TABLE career_application_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'resume',
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  checksum_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT career_application_files_application_fk FOREIGN KEY (organization_id, application_id)
    REFERENCES career_applications(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT career_application_files_kind_check CHECK (kind IN ('resume','cover_letter','portfolio','other')),
  CONSTRAINT career_application_files_size_check CHECK (size_bytes > 0),
  CONSTRAINT career_application_files_resume_unique UNIQUE (application_id, kind)
);
CREATE INDEX career_application_files_application_idx ON career_application_files(organization_id, application_id);
SELECT enable_tenant_rls('career_application_files');

CREATE TABLE career_application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT career_application_events_application_fk FOREIGN KEY (organization_id, application_id)
    REFERENCES career_applications(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX career_application_events_application_idx ON career_application_events(organization_id, application_id, created_at DESC);
SELECT enable_tenant_rls('career_application_events');

INSERT INTO permissions(code, resource, action, module_code, description)
VALUES
  ('careers.read', 'careers', 'read', 'careers', 'View job posts and private applications'),
  ('careers.create', 'careers', 'create', 'careers', 'Create job posts and enable site careers'),
  ('careers.update', 'careers', 'update', 'careers', 'Manage job posts and review applications'),
  ('careers.delete', 'careers', 'delete', 'careers', 'Archive or remove job posts')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_preset_permissions(role_preset_code, permission_code)
SELECT rp.code, p.code FROM role_presets rp CROSS JOIN permissions p
WHERE rp.code IN ('owner', 'general_manager', 'hr_officer') AND p.resource = 'careers'
ON CONFLICT DO NOTHING;
INSERT INTO role_preset_permissions(role_preset_code, permission_code)
SELECT rp.code, p.code FROM role_presets rp CROSS JOIN permissions p
WHERE rp.code IN ('provincial_manager', 'farm_manager') AND p.resource = 'careers' AND p.action IN ('read','update')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('owner', 'general_manager', 'hr_officer') AND p.resource = 'careers'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('provincial_manager', 'farm_manager') AND p.resource = 'careers' AND p.action IN ('read','update')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE career_job_posts IS 'Site-scoped job vacancies. Published posts stay private until their site enables public careers.';
COMMENT ON TABLE career_applications IS 'Private candidate data submitted through an organization public careers page.';
