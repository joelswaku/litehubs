BEGIN;

-- TV screens ("tableaux d'affichage") that show farm statistics like an
-- airport board, and company videos when there is nothing to show.  Each
-- screen opens with its own secret link, so it needs no LiteHubs login.
CREATE TABLE farm_displays (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                 text NOT NULL CHECK (btrim(name) <> ''),
  site_id              uuid,
  token                text NOT NULL,
  sections             text[] NOT NULL DEFAULT ARRAY['poultry','pigs','agriculture'],
  rotate_seconds       integer NOT NULL DEFAULT 20 CHECK (rotate_seconds BETWEEN 8 AND 300),
  video_document_ids   uuid[] NOT NULL DEFAULT '{}',
  videos_between       boolean NOT NULL DEFAULT false,
  message              text,
  is_active            boolean NOT NULL DEFAULT true,
  last_seen_at         timestamptz,
  created_by_member_id uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT farm_displays_token_unique UNIQUE (token),
  CONSTRAINT farm_displays_sections_check CHECK (sections <@ ARRAY['poultry','pigs','agriculture']),
  CONSTRAINT farm_displays_site_fk FOREIGN KEY (organization_id, site_id) REFERENCES sites(organization_id, id) ON DELETE SET NULL (site_id)
);
CREATE INDEX farm_displays_org_idx ON farm_displays(organization_id);
SELECT enable_tenant_rls('farm_displays');

-- The public screen arrives with only its token: find its company.
CREATE OR REPLACE FUNCTION public_farm_display_lookup(requested_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('id', d.id, 'organizationId', d.organization_id, 'organizationSlug', o.slug)
  FROM farm_displays d
  JOIN organizations o ON o.id = d.organization_id
  WHERE d.token = requested_token AND d.is_active AND o.status = 'active'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public_farm_display_lookup(text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='litehubs_app') THEN
    GRANT EXECUTE ON FUNCTION public_farm_display_lookup(text) TO litehubs_app;
  END IF;
END $$;

COMMIT;
