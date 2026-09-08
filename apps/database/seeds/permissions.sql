-- permissions.sql — the organization-plane permission catalogue. Idempotent.
--
-- This is only the list of things that *can* be permitted. Which of them a role
-- grants is per-organization and lives in role_permissions, seeded from
-- role-presets.sql when an organization is provisioned.
--
-- Codes are always '<resource>.<action>'. module_code is the first segment of
-- the resource, and is what module-enabled.middleware.ts checks against the
-- organization's enabled modules.

INSERT INTO permissions (code, resource, action, module_code, description)
SELECT r.resource || '.' || a.action,
       r.resource,
       a.action,
       split_part(r.resource, '.', 1),
       a.action || ' ' || replace(replace(r.resource, '.', ' '), '_', ' ')
FROM (VALUES
  -- workspace administration
  ('users'), ('roles'), ('members'), ('invitations'),
  ('organization'), ('sites'), ('departments'), ('modules'),
  -- people
  ('employees'), ('supervisors'), ('attendance'), ('shifts'), ('leave'),
  ('training'), ('disciplinary_actions'), ('payroll'), ('performance'),
  -- work
  ('projects'), ('tasks'), ('daily_operations'), ('critical_controls'),
  ('alerts'), ('corrective_actions'), ('escalations'), ('approvals'),
  -- poultry
  ('poultry.houses'), ('poultry.flocks'), ('poultry.daily_records'),
  ('poultry.mortality'), ('poultry.feed'), ('poultry.water'),
  ('poultry.weights'), ('poultry.eggs'), ('poultry.health'),
  ('poultry.vaccinations'), ('poultry.treatments'), ('poultry.sanitation'),
  ('poultry.biosecurity'), ('poultry.production_targets'), ('poultry.losses'),
  ('poultry.performance_models'), ('poultry.climate_profiles'),
  -- pigs
  ('pigs.pens'), ('pigs.animals'), ('pigs.groups'), ('pigs.daily_records'),
  ('pigs.weights'), ('pigs.feed'), ('pigs.water'), ('pigs.breeding'),
  ('pigs.pregnancies'), ('pigs.farrowing'), ('pigs.piglets'), ('pigs.health'),
  ('pigs.vaccinations'), ('pigs.treatments'), ('pigs.movements'),
  ('pigs.quarantine'), ('pigs.production_targets'), ('pigs.losses'),
  ('pigs.veterinary'),
  -- agriculture
  ('agriculture.farms'), ('agriculture.fields'), ('agriculture.plots'),
  ('agriculture.crops'), ('agriculture.seasons'), ('agriculture.plantings'), ('agriculture.operations'),
  ('agriculture.scouting'), ('agriculture.irrigation'),
  ('agriculture.fertilizer'), ('agriculture.pesticides'),
  ('agriculture.weather'), ('agriculture.harvest'),
  ('agriculture.production_targets'), ('agriculture.losses'),
  -- specialists
  ('veterinary'), ('agronomy'), ('biosecurity'),
  -- stock and trade
  ('inventory.items'), ('inventory.warehouses'), ('inventory.stock'),
  ('inventory.movements'), ('inventory.transfers'), ('inventory.adjustments'),
  ('inventory.stock_counts'),
  ('procurement'), ('suppliers'), ('customers'), ('sales'),
  -- money
  ('finance.accounts'), ('finance.transactions'), ('finance.cash_management'),
  ('finance.expenses'), ('finance.income'), ('finance.budgets'),
  ('finance.payables'), ('finance.receivables'), ('finance.reconciliation'),
  -- assets
  ('equipment'), ('vehicles'), ('maintenance'), ('work_orders'),
  ('incidents'), ('losses'), ('security'),
  -- records
  ('reports'), ('documents'), ('contracts'), ('notifications'), ('audit'),
  -- custom module builder
  ('custom_modules'), ('custom_records')
) AS r (resource)
CROSS JOIN (VALUES ('read'), ('create'), ('update'), ('delete')) AS a (action)
ON CONFLICT (code) DO NOTHING;

-- Workflow actions, only where they mean something.
INSERT INTO permissions (code, resource, action, module_code, description)
SELECT r.resource || '.' || a.action, r.resource, a.action,
       split_part(r.resource, '.', 1),
       a.action || ' ' || replace(r.resource, '_', ' ')
FROM (VALUES ('approvals'), ('leave'), ('procurement'), ('payroll'),
             ('daily_operations'), ('corrective_actions'), ('attendance'))
  AS r (resource)
CROSS JOIN (VALUES ('approve'), ('reject')) AS a (action)
ON CONFLICT (code) DO NOTHING;

-- Clock-in is a feature of attendance, not a separate module.
INSERT INTO permissions (code, resource, action, module_code, description) VALUES
  ('attendance.clock_self',   'attendance', 'clock_self',   'attendance', 'clock yourself in and out'),
  ('attendance.clock_others', 'attendance', 'clock_others', 'attendance', 'clock other employees in and out'),
  ('attendance.correct',      'attendance', 'correct',      'attendance', 'correct a recorded time entry')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code, resource, action, module_code, description)
SELECT r.resource || '.export', r.resource, 'export',
       split_part(r.resource, '.', 1), 'export ' || r.resource
FROM (VALUES ('reports'), ('payroll'), ('audit'), ('attendance'),
             ('inventory.stock'), ('finance.transactions')) AS r (resource)
ON CONFLICT (code) DO NOTHING;
