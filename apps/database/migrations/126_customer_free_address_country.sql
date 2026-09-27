-- Customer addresses are commercial contact data, not a country-code registry.
-- Keep existing ISO values, while allowing an operator to record the country
-- exactly as the customer supplied it.
ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_country_format;

ALTER TABLE customers
  ADD CONSTRAINT customers_country_not_blank
  CHECK (country IS NULL OR btrim(country) <> '');
