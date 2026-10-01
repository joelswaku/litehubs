-- Adds the impact page to the public website collection.  It remains a
-- content-only public page: no operational or financial LiteHubs data is
-- exposed through this template.
ALTER TABLE organization_website_pages
  DROP CONSTRAINT IF EXISTS organization_website_pages_template_code_check;

ALTER TABLE organization_website_pages
  ADD CONSTRAINT organization_website_pages_template_code_check
  CHECK (template_code IN (
    'blank','company','operations','project','impact','contact','careers'
  ));
