BEGIN;

-- Published posts can be archived: they leave the main list but stay in
-- LiteHubs (and on Facebook / Instagram).
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS social_posts_history_idx ON social_posts(organization_id, archived_at, published_at DESC);

COMMIT;
