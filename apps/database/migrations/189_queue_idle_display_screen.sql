BEGIN;

-- While nobody waits, a site's queue TV plays the same kind of screen as the
-- display screens: several videos, farm statistics and a scrolling message.
-- It is set in the site's appointment settings and kept as a farm_displays row
-- owned by that site (hidden from the "Display screens" list).
ALTER TABLE farm_displays
  ADD COLUMN appointment_site_id uuid,
  ADD CONSTRAINT farm_displays_appointment_site_fk
    FOREIGN KEY (organization_id, appointment_site_id) REFERENCES sites(organization_id, id) ON DELETE CASCADE;

CREATE UNIQUE INDEX farm_displays_appointment_site_unique
  ON farm_displays(organization_id, appointment_site_id)
  WHERE appointment_site_id IS NOT NULL;

COMMIT;
