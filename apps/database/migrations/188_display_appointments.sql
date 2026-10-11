BEGIN;

-- Display screens can also show the appointment queue (live), next to the
-- farm boards and with the same company videos.
ALTER TABLE farm_displays DROP CONSTRAINT IF EXISTS farm_displays_sections_check;
ALTER TABLE farm_displays
  ADD CONSTRAINT farm_displays_sections_check CHECK (sections <@ ARRAY['poultry','pigs','agriculture','appointments']);

COMMIT;
