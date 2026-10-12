BEGIN;

-- Photo bank of the social pages: the manager drops photos; the AI looks at
-- them, writes the posts and uses photos never published first.
--   kind = 'normal'  : free to use in any post
--   kind = 'event'   : kept for one event (name + date)
--   kind = 'poster'  : a finished poster, published as it is on its date
CREATE TABLE social_photos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url                  text NOT NULL CHECK (url LIKE 'https://%'),
  provider             text,
  storage_key          text,
  public_id            text,
  mime_type            text,
  width                integer,
  height               integer,
  original_name        text,
  kind                 text NOT NULL DEFAULT 'normal',
  event_name           text,
  event_date           date,
  ai_description       text,
  created_by_member_id uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_photos_kind_check CHECK (kind IN ('normal', 'event', 'poster')),
  CONSTRAINT social_photos_event_check CHECK (kind = 'normal' OR event_date IS NOT NULL),
  CONSTRAINT social_photos_org_id_unique UNIQUE (organization_id, id)
);
CREATE INDEX social_photos_org_idx ON social_photos(organization_id, kind, created_at);
SELECT enable_tenant_rls('social_photos');

-- Special days the AI plans for (every year when year is null).
CREATE TABLE social_special_days (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (btrim(name) <> ''),
  month           smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  day             smallint NOT NULL CHECK (day BETWEEN 1 AND 31),
  year            smallint,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX social_special_days_org_idx ON social_special_days(organization_id, month, day);
SELECT enable_tenant_rls('social_special_days');

-- Which bank photo a post uses, and the AI poster made for it.
ALTER TABLE social_posts
  ADD COLUMN photo_id uuid,
  ADD COLUMN poster_status text,
  ADD COLUMN poster_spec jsonb,
  ADD CONSTRAINT social_posts_photo_fk
    FOREIGN KEY (organization_id, photo_id) REFERENCES social_photos(organization_id, id) ON DELETE SET NULL (photo_id),
  ADD CONSTRAINT social_posts_poster_status_check CHECK (poster_status IS NULL OR poster_status IN ('pending', 'done', 'failed'));
CREATE INDEX social_posts_photo_idx ON social_posts(organization_id, photo_id) WHERE photo_id IS NOT NULL;

COMMIT;
