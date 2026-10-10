BEGIN;

-- Online shop on the company website.  Products are the existing sellable
-- offers (Ventes), so stock and prices come from production; the shop only
-- adds what customers see: photo, description, category and visibility.
CREATE TABLE shop_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name_fr         text NOT NULL,
  name_en         text,
  sort_order      integer NOT NULL DEFAULT 0,
  is_visible      boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_categories_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT shop_categories_name_check CHECK (btrim(name_fr) <> '')
);
SELECT enable_tenant_rls('shop_categories');

ALTER TABLE sales_operational_offers
  ADD COLUMN IF NOT EXISTS web_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS web_title text,
  ADD COLUMN IF NOT EXISTS web_description text,
  ADD COLUMN IF NOT EXISTS web_image_url text,
  ADD COLUMN IF NOT EXISTS web_category_id uuid,
  ADD COLUMN IF NOT EXISTS web_sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS web_quantity_step numeric(14,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS web_unit_label text;
ALTER TABLE sales_operational_offers
  ADD CONSTRAINT sales_offers_web_category_fk
    FOREIGN KEY (organization_id, web_category_id)
    REFERENCES shop_categories(organization_id, id) ON DELETE SET NULL (web_category_id),
  ADD CONSTRAINT sales_offers_web_step_check CHECK (web_quantity_step > 0);

CREATE TABLE shop_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  enabled         boolean NOT NULL DEFAULT false,
  delivery_enabled boolean NOT NULL DEFAULT true,
  pickup_enabled  boolean NOT NULL DEFAULT true,
  delivery_note   text,
  payment_note    text,
  order_note      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
SELECT enable_tenant_rls('shop_settings');

-- Orders placed on the website become draft sales orders.
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS public_token_hash text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS delivery_mode text,
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS customer_note text,
  ADD COLUMN IF NOT EXISTS cancelled_reason text;
ALTER TABLE sales_orders
  ADD CONSTRAINT sales_orders_channel_check CHECK (channel IN ('internal', 'website')),
  ADD CONSTRAINT sales_orders_delivery_mode_check CHECK (delivery_mode IS NULL OR delivery_mode IN ('delivery', 'pickup'));
CREATE UNIQUE INDEX sales_orders_public_token_unique ON sales_orders(public_token_hash) WHERE public_token_hash IS NOT NULL;
CREATE INDEX sales_orders_channel_idx ON sales_orders(organization_id, channel, created_at DESC);

-- Public resolver: is the shop open for this website?
CREATE OR REPLACE FUNCTION public_shop_target(requested_org_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'organizationId', o.id,
    'organizationSlug', o.slug,
    'organizationName', COALESCE(ws.display_name, o.display_name),
    'enabled', COALESCE(ss.enabled, false)
  )
  FROM organizations o
  LEFT JOIN organization_website_settings ws ON ws.organization_id=o.id
  LEFT JOIN shop_settings ss ON ss.organization_id=o.id
  WHERE o.slug=lower(btrim(requested_org_slug))
    AND o.status='active'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public_shop_target(text) FROM PUBLIC;

-- "Boutique" block and page template in the website builder.
ALTER TABLE organization_website_sections DROP CONSTRAINT organization_website_sections_section_type_check;
ALTER TABLE organization_website_sections ADD CONSTRAINT organization_website_sections_section_type_check
  CHECK (section_type IN ('hero','rich_text','feature_grid','metrics','image_callout','gallery','faq','cta','careers','contact','container','shop'));
ALTER TABLE organization_website_pages DROP CONSTRAINT organization_website_pages_template_code_check;
ALTER TABLE organization_website_pages ADD CONSTRAINT organization_website_pages_template_code_check
  CHECK (template_code IN ('blank','company','operations','project','impact','contact','careers','shop'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='litehubs_app') THEN
    GRANT EXECUTE ON FUNCTION public_shop_target(text) TO litehubs_app;
  END IF;
END $$;

COMMIT;
