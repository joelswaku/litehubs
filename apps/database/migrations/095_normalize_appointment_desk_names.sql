-- Replace generic workstation labels left by early appointment setup.
-- New desks are named in the UI (Guichet 1 / Desk 1) before being saved.
WITH generic_desks AS (
  SELECT id,
         row_number() OVER (PARTITION BY organization_id, site_id ORDER BY created_at, id) AS position
  FROM appointment_desks
  WHERE lower(btrim(name)) IN ('desk', 'guichet')
)
UPDATE appointment_desks desk
SET name = 'Guichet ' || generic_desks.position
FROM generic_desks
WHERE desk.id = generic_desks.id;