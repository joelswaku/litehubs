BEGIN;

-- The public renderer may be reached through its LiteHubs preview slug or the
-- company domain once DNS points at the same application. Both selectors share
-- this one deliberately narrow function: no workspace data becomes public.
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
  WHERE (
      o.slug=lower(btrim(requested_org_slug))
      OR ws.custom_domain=lower(regexp_replace(btrim(requested_org_slug), '^www\\.', ''))
    )
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
  'Public website renderer by organization slug or verified custom domain; returns owner-published content only.';

COMMIT;
