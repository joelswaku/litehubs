-- Keep the existing full_name field as the display/search name so existing HR
-- records remain valid.  New identity and residential address fields provide
-- the structured information required for employee dossiers and documents.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS post_name text,
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS address_city text,
  ADD COLUMN IF NOT EXISTS address_region text,
  ADD COLUMN IF NOT EXISTS address_postal_code text,
  ADD COLUMN IF NOT EXISTS address_country text;

ALTER TABLE employees
  ADD CONSTRAINT employees_last_name_not_blank
    CHECK (last_name IS NULL OR btrim(last_name) <> ''),
  ADD CONSTRAINT employees_post_name_not_blank
    CHECK (post_name IS NULL OR btrim(post_name) <> ''),
  ADD CONSTRAINT employees_first_name_not_blank
    CHECK (first_name IS NULL OR btrim(first_name) <> ''),
  ADD CONSTRAINT employees_address_line1_not_blank
    CHECK (address_line1 IS NULL OR btrim(address_line1) <> ''),
  ADD CONSTRAINT employees_address_city_not_blank
    CHECK (address_city IS NULL OR btrim(address_city) <> ''),
  ADD CONSTRAINT employees_address_region_not_blank
    CHECK (address_region IS NULL OR btrim(address_region) <> ''),
  ADD CONSTRAINT employees_address_country_not_blank
    CHECK (address_country IS NULL OR btrim(address_country) <> '');

COMMENT ON COLUMN employees.last_name IS 'Employee family name / Nom.';
COMMENT ON COLUMN employees.post_name IS 'Employee post-name / Post-nom.';
COMMENT ON COLUMN employees.first_name IS 'Employee given name / Prénom.';
COMMENT ON COLUMN employees.address_line1 IS 'Employee residential street, avenue, plot or village.';
COMMENT ON COLUMN employees.address_line2 IS 'Employee residential quarter, commune or address complement.';
COMMENT ON COLUMN employees.address_region IS 'Employee residential province or region, distinct from work scope.';
