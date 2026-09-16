-- role-presets.sql — blueprints the provisioning service copies into each new
-- organization's own roles. Idempotent.
--
-- Replaces the old seeds/roles.sql, which inserted one global set of roles.
-- Roles are now per-organization, so what is shared is only the blueprint.

INSERT INTO role_presets (code, name, description, level, is_owner_role, sort_order) VALUES
  ('owner',            'Owner',            'Full access to every module and setting',            0,  true,  10),
  ('general_manager',  'General Manager',  'Runs the whole operation for the owner',            10, false, 20),
  ('farm_manager',     'Site Manager',     'Manages one site: production, staff, stock',        20, false, 30),
  ('supervisor',       'Supervisor',       'Supervises a unit and approves daily records',      30, false, 40),
  ('veterinarian',     'Veterinarian',     'Animal health, treatments and vaccinations',        35, false, 50),
  ('agronomist',       'Agronomist',       'Crops, soil, scouting and agronomy advice',         35, false, 60),
  ('accountant',       'Accountant',       'Finance, payroll and reconciliation',               40, false, 70),
  ('hr_officer',       'HR Officer',       'Employees, attendance, leave and discipline',       40, false, 80),
  ('storekeeper',      'Storekeeper',      'Inventory, warehouses and stock movements',         50, false, 90),
  ('security_officer', 'Security Officer', 'Gate register, visitors and asset movements',       50, false, 100),
  ('employee',                  'Employee',               'Records own daily work and views own data',                         90, false, 110),
  ('appointment_receptionist',  'Reception & Appointments','Receives visitors and manages site appointments and live queues',    55, false, 105),
  ('poultry_worker',            'Poultry Worker',         'Records assigned-site poultry checks and field data',                85, false, 112),
  ('pig_worker',                'Pig Worker',             'Records assigned-site pig checks and field data',                    85, false, 113),
  ('agriculture_worker',        'Agriculture Worker',     'Records assigned-site crop and field work',                          85, false, 114)
ON CONFLICT (code) DO UPDATE
  SET name          = EXCLUDED.name,
      description   = EXCLUDED.description,
      level         = EXCLUDED.level,
      is_owner_role = EXCLUDED.is_owner_role,
      sort_order    = EXCLUDED.sort_order;

-- ------------------------------------------------------- preset grants ----
-- Owner: everything in the catalogue.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'owner', p.code FROM permissions p
ON CONFLICT DO NOTHING;

-- Reception: manages only appointments and queues in assigned provinces.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'appointment_receptionist', p.code FROM permissions p
 WHERE p.resource = 'appointments'
   AND p.action IN ('read', 'create', 'update')
ON CONFLICT DO NOTHING;

-- General manager: everything except managing roles and members.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'general_manager', p.code FROM permissions p
 WHERE p.resource NOT IN ('roles', 'members', 'invitations', 'modules')
ON CONFLICT DO NOTHING;

-- Site manager: reads everything operational, writes production and stock.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'farm_manager', p.code FROM permissions p
 WHERE (p.action = 'read'
        AND p.resource NOT IN ('roles', 'members', 'invitations', 'modules', 'audit'))
    OR p.module_code IN ('poultry', 'pigs', 'agriculture', 'inventory')
    OR p.resource IN ('tasks', 'projects', 'daily_operations', 'critical_controls',
                      'corrective_actions', 'alerts', 'escalations', 'equipment',
                      'vehicles', 'maintenance', 'work_orders', 'incidents',
                      'losses', 'reports', 'documents', 'attendance')
    OR (p.resource = 'approvals' AND p.action IN ('read', 'approve', 'reject'))
ON CONFLICT DO NOTHING;

-- Supervisor: records and approves daily work for their unit.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'supervisor', p.code FROM permissions p
 WHERE (p.action = 'read'
        AND (p.module_code IN ('poultry', 'pigs', 'agriculture', 'inventory')
             AND p.resource NOT IN ('poultry.performance_models',
                                    'poultry.climate_profiles')
             OR p.resource IN ('tasks', 'projects', 'daily_operations', 'employees',
                               'attendance', 'shifts', 'alerts', 'reports',
                               'critical_controls')))
    OR (p.action IN ('create', 'update')
        AND (p.resource LIKE '%.daily_records'
             OR p.resource LIKE '%.mortality'
             OR p.resource LIKE '%.feed'
             OR p.resource LIKE '%.water'
             OR p.resource LIKE '%.weights'
             OR p.resource LIKE '%.eggs'
             OR p.resource IN ('tasks', 'daily_operations', 'attendance',
                               'corrective_actions', 'incidents')))
    OR p.code IN ('daily_operations.approve', 'daily_operations.reject',
                  'attendance.clock_self', 'attendance.clock_others',
                  'attendance.correct', 'attendance.approve')
ON CONFLICT DO NOTHING;

-- Veterinarian: animal health across both livestock lines.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'veterinarian', p.code FROM permissions p
 WHERE (p.action = 'read' AND p.module_code IN ('poultry', 'pigs'))
    OR p.resource LIKE '%.health'
    OR p.resource LIKE '%.vaccinations'
    OR p.resource LIKE '%.treatments'
    OR p.resource LIKE '%.mortality'
    OR p.resource LIKE '%.quarantine'
    OR p.resource IN ('veterinary', 'biosecurity', 'alerts', 'reports')
ON CONFLICT DO NOTHING;

-- Agronomist: crops and agronomy.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'agronomist', p.code FROM permissions p
 WHERE p.module_code = 'agriculture'
    OR p.resource IN ('agronomy', 'alerts', 'reports')
ON CONFLICT DO NOTHING;

-- Accountant: finance and payroll, read-only on what feeds them.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'accountant', p.code FROM permissions p
 WHERE p.module_code = 'finance'
    OR p.resource IN ('payroll', 'reports')
    OR (p.action = 'read'
        AND p.resource IN ('sales', 'procurement', 'suppliers', 'customers',
                           'employees', 'inventory.stock', 'projects'))
ON CONFLICT DO NOTHING;

-- HR officer: the people modules.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'hr_officer', p.code FROM permissions p
 WHERE p.resource IN ('employees', 'supervisors', 'attendance', 'shifts',
                      'leave', 'training', 'disciplinary_actions',
                      'performance', 'documents', 'contracts', 'reports')
    OR (p.action = 'read' AND p.resource IN ('payroll', 'departments', 'sites'))
ON CONFLICT DO NOTHING;

-- Storekeeper: inventory, and raises procurement requests.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'storekeeper', p.code FROM permissions p
 WHERE p.module_code = 'inventory'
    OR (p.resource = 'procurement' AND p.action IN ('read', 'create'))
    OR (p.action = 'read' AND p.resource IN ('suppliers', 'reports'))
ON CONFLICT DO NOTHING;

-- Security officer: gate and asset control.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'security_officer', p.code FROM permissions p
 WHERE p.resource = 'security'
    OR (p.resource = 'incidents' AND p.action IN ('read', 'create'))
    OR (p.action = 'read' AND p.resource IN ('equipment', 'vehicles'))
ON CONFLICT DO NOTHING;

-- Employee: personal workspace only. Production access is added by selecting
-- a Poultry Worker, Pig Worker or Agriculture Worker role for that person.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'employee', p.code FROM permissions p
 WHERE (p.action = 'read'
        AND p.resource IN ('tasks', 'daily_operations',
                           'attendance', 'leave', 'notifications'))
    OR (p.action = 'create'
        AND p.resource IN ('daily_operations', 'leave', 'incidents'))
    OR p.code IN ('tasks.update', 'attendance.clock_self')
ON CONFLICT DO NOTHING;


-- Production workers: the owner assigns one or more of these roles to an employee.
WITH worker_permissions(role_code, permission_code) AS (
  VALUES
    ('poultry_worker', 'poultry.houses.read'),
    ('poultry_worker', 'poultry.flocks.read'),
    ('poultry_worker', 'poultry.daily_records.read'),
    ('poultry_worker', 'poultry.daily_records.create'),
    ('poultry_worker', 'poultry.daily_records.update'),
    ('poultry_worker', 'poultry.mortality.read'),
    ('poultry_worker', 'poultry.mortality.create'),
    ('poultry_worker', 'poultry.mortality.update'),
    ('poultry_worker', 'poultry.feed.read'),
    ('poultry_worker', 'poultry.feed.create'),
    ('poultry_worker', 'poultry.feed.update'),
    ('poultry_worker', 'poultry.water.read'),
    ('poultry_worker', 'poultry.water.create'),
    ('poultry_worker', 'poultry.water.update'),
    ('poultry_worker', 'poultry.weights.read'),
    ('poultry_worker', 'poultry.weights.create'),
    ('poultry_worker', 'poultry.weights.update'),
    ('poultry_worker', 'poultry.eggs.read'),
    ('poultry_worker', 'poultry.eggs.create'),
    ('poultry_worker', 'poultry.eggs.update'),
    ('poultry_worker', 'poultry.health.read'),
    ('poultry_worker', 'poultry.health.create'),
    ('poultry_worker', 'poultry.sanitation.read'),
    ('poultry_worker', 'poultry.sanitation.create'),
    ('poultry_worker', 'poultry.sanitation.update'),
    ('poultry_worker', 'poultry.biosecurity.read'),
    ('poultry_worker', 'poultry.biosecurity.create'),
    ('poultry_worker', 'poultry.biosecurity.update'),
    ('poultry_worker', 'poultry.losses.read'),
    ('poultry_worker', 'poultry.losses.create'),
    ('poultry_worker', 'poultry.losses.update'),

    ('pig_worker', 'pigs.pens.read'),
    ('pig_worker', 'pigs.groups.read'),
    ('pig_worker', 'pigs.animals.read'),
    ('pig_worker', 'pigs.daily_records.read'),
    ('pig_worker', 'pigs.daily_records.create'),
    ('pig_worker', 'pigs.daily_records.update'),
    ('pig_worker', 'pigs.feed.read'),
    ('pig_worker', 'pigs.feed.create'),
    ('pig_worker', 'pigs.feed.update'),
    ('pig_worker', 'pigs.water.read'),
    ('pig_worker', 'pigs.water.create'),
    ('pig_worker', 'pigs.water.update'),
    ('pig_worker', 'pigs.weights.read'),
    ('pig_worker', 'pigs.weights.create'),
    ('pig_worker', 'pigs.weights.update'),
    ('pig_worker', 'pigs.mortality.read'),
    ('pig_worker', 'pigs.mortality.create'),
    ('pig_worker', 'pigs.mortality.update'),
    ('pig_worker', 'pigs.health.read'),
    ('pig_worker', 'pigs.health.create'),
    ('pig_worker', 'pigs.losses.read'),
    ('pig_worker', 'pigs.losses.create'),
    ('pig_worker', 'pigs.losses.update'),

    ('agriculture_worker', 'agriculture.farms.read'),
    ('agriculture_worker', 'agriculture.fields.read'),
    ('agriculture_worker', 'agriculture.plots.read'),
    ('agriculture_worker', 'agriculture.crops.read'),
    ('agriculture_worker', 'agriculture.seasons.read'),
    ('agriculture_worker', 'agriculture.plantings.read'),
    ('agriculture_worker', 'agriculture.operations.read'),
    ('agriculture_worker', 'agriculture.operations.create'),
    ('agriculture_worker', 'agriculture.operations.update'),
    ('agriculture_worker', 'agriculture.irrigation.read'),
    ('agriculture_worker', 'agriculture.irrigation.create'),
    ('agriculture_worker', 'agriculture.irrigation.update'),
    ('agriculture_worker', 'agriculture.scouting.read'),
    ('agriculture_worker', 'agriculture.scouting.create'),
    ('agriculture_worker', 'agriculture.scouting.update'),
    ('agriculture_worker', 'agriculture.weather.read'),
    ('agriculture_worker', 'agriculture.weather.create'),
    ('agriculture_worker', 'agriculture.weather.update'),
    ('agriculture_worker', 'agriculture.harvest.read'),
    ('agriculture_worker', 'agriculture.harvest.create'),
    ('agriculture_worker', 'agriculture.harvest.update'),
    ('agriculture_worker', 'agriculture.losses.read'),
    ('agriculture_worker', 'agriculture.losses.create'),
    ('agriculture_worker', 'agriculture.losses.update')
)
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT wanted.role_code, p.code
  FROM worker_permissions wanted
  JOIN permissions p ON p.code = wanted.permission_code
ON CONFLICT DO NOTHING;

-- ------------------------------------------------ Congo Omega role set ----
-- These roles are for the Mixed Farm template used by Congo Omega. They do not
-- grant finance, sales, subscription, or payment permissions.

UPDATE role_presets
   SET data_scope = CASE
     WHEN code IN ('employee', 'poultry_worker', 'pig_worker', 'agriculture_worker') THEN 'self'
     WHEN code IN ('farm_manager', 'supervisor', 'veterinarian', 'agronomist',
                   'storekeeper', 'security_officer', 'appointment_receptionist') THEN 'province'
     ELSE 'organization'
   END;

-- Bring existing system roles in line with the clarified preset scopes.
UPDATE roles r
   SET data_scope = rp.data_scope
  FROM role_presets rp
 WHERE r.code = rp.code
   AND r.is_system = true
   AND r.data_scope IS DISTINCT FROM rp.data_scope;

INSERT INTO role_presets
  (code, name, description, level, industry_code, is_owner_role, sort_order, data_scope)
VALUES
  ('provincial_manager', 'Provincial Manager',
   'Runs approved work for the provinces assigned to them.', 20, 'mixed_farm', false, 25, 'province'),
  ('farm_operations_manager', 'Farm Operations Manager',
   'Runs poultry, pigs and agriculture across Congo Omega.', 25, 'mixed_farm', false, 30, 'organization'),
  ('poultry_supervisor', 'Poultry Supervisor',
   'Supervises poultry work in assigned provinces.', 35, 'mixed_farm', false, 40, 'province'),
  ('pig_supervisor', 'Pig Supervisor',
   'Supervises pig work in assigned provinces.', 35, 'mixed_farm', false, 45, 'province'),
  ('agriculture_supervisor', 'Agriculture Supervisor',
   'Supervises crop and field work in assigned provinces.', 35, 'mixed_farm', false, 50, 'province')
ON CONFLICT (code) DO UPDATE
  SET name          = EXCLUDED.name,
      description   = EXCLUDED.description,
      level         = EXCLUDED.level,
      industry_code = EXCLUDED.industry_code,
      is_owner_role = EXCLUDED.is_owner_role,
      sort_order    = EXCLUDED.sort_order,
      data_scope    = EXCLUDED.data_scope;

-- Provincial manager: sees all three production lines, but only in assigned
-- provinces once the operational records are added.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'provincial_manager', p.code
  FROM permissions p
 WHERE (p.action = 'read'
        AND (p.module_code IN ('poultry', 'pigs', 'agriculture')
             OR p.resource IN ('veterinary', 'agronomy', 'biosecurity',
                               'sites', 'departments', 'employees', 'supervisors',
                               'attendance', 'shifts', 'tasks', 'projects',
                               'daily_operations', 'alerts', 'incidents',
                               'reports', 'documents')))
    OR (p.action IN ('create', 'update')
        AND p.resource IN ('tasks', 'daily_operations', 'alerts',
                           'corrective_actions', 'incidents'))
    OR p.code IN ('daily_operations.approve', 'daily_operations.reject',
                  'attendance.clock_others', 'attendance.correct',
                  'attendance.approve')
ON CONFLICT DO NOTHING;

-- One Farm Operations Manager may run poultry, pigs and agriculture for the
-- whole company. This role deliberately excludes money and sales.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'farm_operations_manager', p.code
  FROM permissions p
 WHERE p.module_code IN ('poultry', 'pigs', 'agriculture')
    OR p.resource IN ('veterinary', 'agronomy', 'biosecurity',
                      'tasks', 'projects', 'daily_operations',
                      'critical_controls', 'alerts', 'corrective_actions',
                      'escalations', 'incidents', 'losses', 'reports',
                      'documents')
    OR (p.action = 'read'
        AND p.resource IN ('sites', 'departments', 'employees', 'supervisors',
                           'attendance', 'shifts', 'training'))
    OR p.code IN ('attendance.clock_others', 'attendance.correct',
                  'attendance.approve', 'daily_operations.approve',
                  'daily_operations.reject', 'corrective_actions.approve',
                  'corrective_actions.reject')
ON CONFLICT DO NOTHING;

-- Production supervisors receive their own production line plus the daily work
-- and people information needed to supervise it. They do not get other lines.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'poultry_supervisor', p.code
  FROM permissions p
 WHERE ((p.module_code = 'poultry'
         AND p.action IN ('create', 'read', 'update')
         AND p.resource NOT IN ('poultry.houses', 'poultry.flocks',
                                'poultry.production_targets',
                                'poultry.performance_models',
                                'poultry.climate_profiles'))
       OR (p.resource IN ('poultry.houses', 'poultry.flocks',
                          'poultry.production_targets')
           AND p.action = 'read'))
    OR (p.action = 'read'
        AND p.resource IN ('sites', 'departments', 'employees', 'supervisors',
                           'attendance', 'shifts', 'tasks', 'daily_operations',
                           'alerts', 'reports', 'documents'))
    OR (p.action IN ('create', 'update')
        AND p.resource IN ('tasks', 'daily_operations', 'alerts',
                           'corrective_actions', 'incidents'))
    OR p.code IN ('attendance.clock_others', 'attendance.correct',
                  'daily_operations.approve', 'daily_operations.reject')
ON CONFLICT DO NOTHING;

INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'pig_supervisor', p.code
  FROM permissions p
 WHERE (p.module_code = 'pigs' AND p.action IN ('create', 'read', 'update'))
    OR (p.action = 'read'
        AND p.resource IN ('sites', 'departments', 'employees', 'supervisors',
                           'attendance', 'shifts', 'tasks', 'daily_operations',
                           'alerts', 'reports', 'documents'))
    OR (p.action IN ('create', 'update')
        AND p.resource IN ('tasks', 'daily_operations', 'alerts',
                           'corrective_actions', 'incidents'))
    OR p.code IN ('attendance.clock_others', 'attendance.correct',
                  'daily_operations.approve', 'daily_operations.reject')
ON CONFLICT DO NOTHING;

INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'agriculture_supervisor', p.code
  FROM permissions p
 WHERE (p.module_code = 'agriculture' AND p.action IN ('create', 'read', 'update'))
    OR (p.action = 'read'
        AND p.resource IN ('sites', 'departments', 'employees', 'supervisors',
                           'attendance', 'shifts', 'tasks', 'daily_operations',
                           'alerts', 'reports', 'documents'))
    OR (p.action IN ('create', 'update')
        AND p.resource IN ('tasks', 'daily_operations', 'alerts',
                           'corrective_actions', 'incidents'))
    OR p.code IN ('attendance.clock_others', 'attendance.correct',
                  'daily_operations.approve', 'daily_operations.reject')
ON CONFLICT DO NOTHING;

-- The seed also brings the new roles into existing Mixed Farm organizations.
-- New organizations receive them through the provisioning service.
INSERT INTO roles
  (organization_id, code, name, description, level, data_scope, is_system)
SELECT o.id, rp.code, rp.name, rp.description, rp.level, rp.data_scope, true
  FROM organizations o
  JOIN role_presets rp ON rp.industry_code = o.industry_code
 WHERE rp.code IN ('provincial_manager', 'farm_operations_manager',
                   'poultry_supervisor', 'pig_supervisor',
                   'agriculture_supervisor')
ON CONFLICT (organization_id, code) DO UPDATE
  SET name        = EXCLUDED.name,
      description = EXCLUDED.description,
      level       = EXCLUDED.level,
      data_scope  = EXCLUDED.data_scope,
      is_system   = true;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
  FROM roles r
  JOIN role_preset_permissions rpp ON rpp.role_preset_code = r.code
  JOIN permissions p ON p.code = rpp.permission_code
 WHERE r.code IN ('provincial_manager', 'farm_operations_manager',
                  'poultry_supervisor', 'pig_supervisor',
                  'agriculture_supervisor')
ON CONFLICT DO NOTHING;
