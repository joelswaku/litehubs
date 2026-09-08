-- 007_organization_address.sql
-- Where the company actually is.
--
-- 003 recorded only `country`, which is enough to pick a currency and a date
-- format and nothing else. An address is needed the moment the company issues
-- an invoice, signs a contract, or has goods delivered to a site — all of which
-- print a postal address, not a country code.
--
-- Separate columns rather than one jsonb blob: these are queried and printed
-- individually (group suppliers by city, sort employees by province), and a
-- jsonb payload would push that formatting into every caller.
--
-- All nullable. Requiring a full address to finish signing up would turn away
-- a company that has not got its paperwork to hand, and the address can be
-- completed later from workspace settings. The API accepts it at registration
-- for the company that does have it ready.

ALTER TABLE organizations
  -- Street and number. `line2` carries the parts that have no other home:
  -- building, floor, PO box, "opposite the market".
  ADD COLUMN address_line1 text,
  ADD COLUMN address_line2 text,
  ADD COLUMN city          text,
  -- Province in DR Congo, state elsewhere, county elsewhere again. One neutral
  -- column rather than a name that is wrong in most countries.
  ADD COLUMN region        text,
  ADD COLUMN postal_code   text;

-- A stored blank is not a real address and would print as an empty line on an
-- invoice, so it is refused. NULL stays the way to say "not recorded".
ALTER TABLE organizations
  ADD CONSTRAINT organizations_address_line1_not_blank
    CHECK (address_line1 IS NULL OR btrim(address_line1) <> ''),
  ADD CONSTRAINT organizations_address_line2_not_blank
    CHECK (address_line2 IS NULL OR btrim(address_line2) <> ''),
  ADD CONSTRAINT organizations_city_not_blank
    CHECK (city IS NULL OR btrim(city) <> ''),
  ADD CONSTRAINT organizations_region_not_blank
    CHECK (region IS NULL OR btrim(region) <> ''),
  ADD CONSTRAINT organizations_postal_code_not_blank
    CHECK (postal_code IS NULL OR btrim(postal_code) <> '');

-- Suppliers and customers get grouped by city often enough to be worth an
-- index; the rest are read with the row, never searched on.
CREATE INDEX organizations_city_idx ON organizations (city) WHERE city IS NOT NULL;

COMMENT ON COLUMN organizations.address_line2 IS
  'Building, floor, PO box, or a landmark where street numbering is absent.';
COMMENT ON COLUMN organizations.region IS
  'Province / state / county — whatever the country calls the level above city.';
