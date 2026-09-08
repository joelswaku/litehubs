-- industries.sql — what a company picks during onboarding. Idempotent.
-- Only the three we actually support are active; the rest are placeholders so
-- the choice exists in the UI without pretending a template is ready.

INSERT INTO industries (code, name, description, sort_order, is_active) VALUES
  ('agriculture',  'Agriculture / Crops',   'Crop farming, fields, seasons, harvest',        10, true),
  ('poultry',      'Poultry',               'Broilers, layers, hatchery',                    20, true),
  ('livestock',    'Livestock / Pigs',      'Pig and other livestock production',            30, true),
  ('mixed_farm',   'Mixed Farm',            'More than one production line on one site',     40, true),
  ('construction', 'Construction',          'Projects, sites, equipment',                   100, false),
  ('restaurant',   'Restaurant / Food',     'Kitchen, stock, suppliers, sales',             110, false),
  ('retail',       'Retail',                'Stores, stock, sales',                         120, false),
  ('logistics',    'Logistics / Transport', 'Fleet, routes, deliveries',                    130, false),
  ('other',        'Other / Custom',        'Start from core modules and build your own',    900, true)
ON CONFLICT (code) DO UPDATE
  SET name        = EXCLUDED.name,
      description = EXCLUDED.description,
      sort_order  = EXCLUDED.sort_order,
      is_active   = EXCLUDED.is_active;
