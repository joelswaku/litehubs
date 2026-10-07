BEGIN;

-- A free "container" block for the visual website builder: an empty section
-- the owner fills with headings, text, buttons, images and nested containers.
-- The original CHECK was declared inline, so it carries PostgreSQL's default
-- name. Drop whichever section_type CHECK exists, then restate the full list.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'organization_website_sections'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%section_type%'
  LOOP
    EXECUTE format(
      'ALTER TABLE organization_website_sections DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END $$;

ALTER TABLE organization_website_sections
  ADD CONSTRAINT organization_website_sections_section_type_check
  CHECK (section_type IN (
    'hero','rich_text','feature_grid','metrics','image_callout','gallery',
    'faq','cta','careers','contact','container'
  ));

COMMIT;
