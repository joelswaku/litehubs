BEGIN;

-- A company website is deliberately a small, public-facing plane of the
-- workspace.  It never reads projects, people, stock, payroll or documents
-- directly: owners choose and publish the text and images they want visible.
CREATE TABLE organization_website_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  tagline text,
  default_locale text NOT NULL DEFAULT 'fr' CHECK (default_locale IN ('fr','en')),
  publication_status text NOT NULL DEFAULT 'draft'
    CHECK (publication_status IN ('draft','published','paused')),
  theme_preset text NOT NULL DEFAULT 'verdant'
    CHECK (theme_preset IN ('verdant','cobalt','sunrise','earth')),
  primary_color text NOT NULL DEFAULT '#166534'
    CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text NOT NULL DEFAULT '#f59e0b'
    CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_url text,
  contact_email text,
  contact_phone text,
  address_text text,
  footer_text text,
  custom_domain text,
  created_by_member_id uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  updated_by_member_id uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Multiple companies start without a custom domain. PostgreSQL's ordinary
  -- unique semantics keep those NULLs independent while still protecting an
  -- actual domain once an owner enters one.
  CONSTRAINT organization_website_settings_domain_unique UNIQUE (custom_domain),
  -- The pages table carries the tenant key as well as the settings key. This
  -- composite candidate key lets PostgreSQL enforce that both belong together.
  CONSTRAINT organization_website_settings_org_id_unique UNIQUE (organization_id, id)
);

CREATE TRIGGER organization_website_settings_set_updated_at
  BEFORE UPDATE ON organization_website_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT enable_tenant_rls('organization_website_settings');

CREATE TABLE organization_website_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  website_id uuid NOT NULL,
  slug text NOT NULL,
  navigation_label_fr text NOT NULL,
  navigation_label_en text NOT NULL,
  title_fr text NOT NULL,
  title_en text NOT NULL,
  description_fr text,
  description_en text,
  seo_title_fr text,
  seo_title_en text,
  seo_description_fr text,
  seo_description_en text,
  template_code text NOT NULL DEFAULT 'blank'
    CHECK (template_code IN ('blank','company','operations','project','contact','careers')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  is_home boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_by_member_id uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  updated_by_member_id uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_website_pages_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT organization_website_pages_settings_fk
    FOREIGN KEY (organization_id, website_id)
    REFERENCES organization_website_settings(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT organization_website_pages_slug_format
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT organization_website_pages_slug_unique UNIQUE (organization_id, slug)
);

CREATE UNIQUE INDEX organization_website_pages_one_home_idx
  ON organization_website_pages (website_id) WHERE is_home;
CREATE INDEX organization_website_pages_visible_idx
  ON organization_website_pages (organization_id, status, sort_order, slug);
CREATE TRIGGER organization_website_pages_set_updated_at
  BEFORE UPDATE ON organization_website_pages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT enable_tenant_rls('organization_website_pages');

CREATE TABLE organization_website_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  page_id uuid NOT NULL,
  section_type text NOT NULL CHECK (section_type IN (
    'hero','rich_text','feature_grid','metrics','image_callout','gallery','faq','cta','careers','contact'
  )),
  section_order integer NOT NULL DEFAULT 0 CHECK (section_order >= 0),
  is_visible boolean NOT NULL DEFAULT true,
  content jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_website_sections_page_fk
    FOREIGN KEY (organization_id, page_id)
    REFERENCES organization_website_pages(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT organization_website_sections_page_order_unique UNIQUE (page_id, section_order)
);

CREATE INDEX organization_website_sections_page_idx
  ON organization_website_sections (organization_id, page_id, section_order);
CREATE TRIGGER organization_website_sections_set_updated_at
  BEFORE UPDATE ON organization_website_sections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT enable_tenant_rls('organization_website_sections');

-- Platform staff can see only publishing metadata in the Super Admin registry.
-- The UI endpoint itself is still limited to the platform_super_admin role;
-- this policy merely allows the scoped aggregate SELECT to execute under RLS.
CREATE POLICY organization_website_settings_platform_read ON organization_website_settings
  FOR SELECT USING (current_user_has_platform_permission('platform.organizations.read'));
CREATE POLICY organization_website_pages_platform_read ON organization_website_pages
  FOR SELECT USING (current_user_has_platform_permission('platform.organizations.read'));

-- The public API never reads the tables directly. This narrow function exposes
-- only a website intentionally published by its owner and only a page the
-- owner explicitly published. There are no joins to operational tables.
CREATE OR REPLACE FUNCTION public_organization_website_page(
  requested_org_slug text,
  requested_page_slug text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'website', jsonb_build_object(
      'organizationSlug', o.slug,
      'displayName', ws.display_name,
      'tagline', ws.tagline,
      'defaultLocale', ws.default_locale,
      'themePreset', ws.theme_preset,
      'primaryColor', ws.primary_color,
      'accentColor', ws.accent_color,
      'logoUrl', ws.logo_url,
      'contactEmail', ws.contact_email,
      'contactPhone', ws.contact_phone,
      'addressText', ws.address_text,
      'footerText', ws.footer_text,
      'pages', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'slug', nav.slug,
          'labelFr', nav.navigation_label_fr,
          'labelEn', nav.navigation_label_en,
          'isHome', nav.is_home
        ) ORDER BY nav.sort_order, nav.slug)
        FROM organization_website_pages nav
        WHERE nav.organization_id=o.id AND nav.website_id=ws.id
          AND nav.status='published'
      ), '[]'::jsonb)
    ),
    'page', jsonb_build_object(
      'slug', p.slug,
      'titleFr', p.title_fr,
      'titleEn', p.title_en,
      'descriptionFr', p.description_fr,
      'descriptionEn', p.description_en,
      'seoTitleFr', p.seo_title_fr,
      'seoTitleEn', p.seo_title_en,
      'seoDescriptionFr', p.seo_description_fr,
      'seoDescriptionEn', p.seo_description_en,
      'isHome', p.is_home,
      'sections', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', s.id,
          'type', s.section_type,
          'content', s.content
        ) ORDER BY s.section_order)
        FROM organization_website_sections s
        WHERE s.organization_id=o.id AND s.page_id=p.id AND s.is_visible
      ), '[]'::jsonb)
    )
  )
  FROM organizations o
  JOIN organization_website_settings ws
    ON ws.organization_id=o.id AND ws.publication_status='published'
  JOIN organization_website_pages p
    ON p.organization_id=o.id AND p.website_id=ws.id AND p.status='published'
  WHERE o.slug=lower(btrim(requested_org_slug))
    AND o.status='active'
    AND (
      (NULLIF(lower(btrim(requested_page_slug)), '') IS NULL AND p.is_home)
      OR p.slug=lower(btrim(requested_page_slug))
    )
  ORDER BY p.is_home DESC, p.sort_order
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public_organization_website_page(text, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='litehubs_app') THEN
    GRANT EXECUTE ON FUNCTION public_organization_website_page(text, text) TO litehubs_app;
  END IF;
END $$;

COMMENT ON FUNCTION public_organization_website_page(text, text) IS
  'Public website renderer: returns only owner-published settings, navigation and blocks; never operational data.';

DROP TRIGGER IF EXISTS audit_business_change ON organization_website_settings;
CREATE TRIGGER audit_business_change
  AFTER INSERT OR UPDATE OR DELETE ON organization_website_settings
  FOR EACH ROW EXECUTE FUNCTION audit_business_change();
DROP TRIGGER IF EXISTS audit_business_change ON organization_website_pages;
CREATE TRIGGER audit_business_change
  AFTER INSERT OR UPDATE OR DELETE ON organization_website_pages
  FOR EACH ROW EXECUTE FUNCTION audit_business_change();
DROP TRIGGER IF EXISTS audit_business_change ON organization_website_sections;
CREATE TRIGGER audit_business_change
  AFTER INSERT OR UPDATE OR DELETE ON organization_website_sections
  FOR EACH ROW EXECUTE FUNCTION audit_business_change();

COMMIT;
