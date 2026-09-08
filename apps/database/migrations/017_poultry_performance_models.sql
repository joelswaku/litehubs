-- 017_poultry_performance_models.sql
-- Editable performance standards and climate-aware daily work for poultry.
-- Targets belong to the company model; no breed standard is hard-coded in API logic.

CREATE TABLE poultry_climate_profiles (
  id                        uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  province_id               uuid,
  code                      text NOT NULL,
  name                      text NOT NULL,
  country_code              char(2) NOT NULL DEFAULT 'CD',
  climate_class             text NOT NULL DEFAULT 'other',
  season                    text,
  temperature_c             numeric(5,2),
  humidity_percent          numeric(5,2),
  water_adjustment_percent  numeric(6,2) NOT NULL DEFAULT 0,
  feed_adjustment_percent   numeric(6,2) NOT NULL DEFAULT 0,
  operational_note          text,
  is_active                 boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_climate_profiles_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_climate_profiles_code_unique UNIQUE (organization_id, code),
  CONSTRAINT poultry_climate_profiles_province_fk FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT poultry_climate_profiles_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT poultry_climate_profiles_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT poultry_climate_profiles_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT poultry_climate_profiles_class_check
    CHECK (climate_class IN ('hot_humid', 'hot_dry', 'temperate', 'cool', 'highland', 'other')),
  CONSTRAINT poultry_climate_profiles_temperature_check
    CHECK (temperature_c IS NULL OR temperature_c BETWEEN -30 AND 70),
  CONSTRAINT poultry_climate_profiles_humidity_check
    CHECK (humidity_percent IS NULL OR humidity_percent BETWEEN 0 AND 100),
  CONSTRAINT poultry_climate_profiles_water_adjustment_check
    CHECK (water_adjustment_percent BETWEEN -90 AND 500),
  CONSTRAINT poultry_climate_profiles_feed_adjustment_check
    CHECK (feed_adjustment_percent BETWEEN -90 AND 500),
  CONSTRAINT poultry_climate_profiles_text_not_blank
    CHECK ((season IS NULL OR btrim(season) <> '') AND (operational_note IS NULL OR btrim(operational_note) <> ''))
);

CREATE TRIGGER poultry_climate_profiles_set_updated_at
  BEFORE UPDATE ON poultry_climate_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX poultry_climate_profiles_province_idx ON poultry_climate_profiles (organization_id, province_id);
SELECT enable_tenant_rls('poultry_climate_profiles');

CREATE TABLE poultry_performance_models (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  climate_profile_id  uuid,
  code                text NOT NULL,
  name                text NOT NULL,
  production_type     text NOT NULL,
  strain              text,
  country_code        char(2) NOT NULL DEFAULT 'CD',
  version             integer NOT NULL DEFAULT 1,
  is_active           boolean NOT NULL DEFAULT true,
  notes               text,
  created_by_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_performance_models_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_performance_models_code_unique UNIQUE (organization_id, code),
  CONSTRAINT poultry_performance_models_climate_fk FOREIGN KEY (organization_id, climate_profile_id)
    REFERENCES poultry_climate_profiles (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT poultry_performance_models_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT poultry_performance_models_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT poultry_performance_models_type_check CHECK (production_type IN ('broiler', 'layer')),
  CONSTRAINT poultry_performance_models_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT poultry_performance_models_version_check CHECK (version > 0),
  CONSTRAINT poultry_performance_models_text_not_blank
    CHECK ((strain IS NULL OR btrim(strain) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);

CREATE TRIGGER poultry_performance_models_set_updated_at
  BEFORE UPDATE ON poultry_performance_models
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX poultry_performance_models_type_idx ON poultry_performance_models (organization_id, production_type) WHERE is_active;
SELECT enable_tenant_rls('poultry_performance_models');

CREATE TABLE poultry_model_week_targets (
  id                                      uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id                         uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  performance_model_id                    uuid NOT NULL,
  week_number                             integer NOT NULL,
  target_weight_g                         numeric(12,2),
  feed_g_per_bird_per_day                 numeric(12,3),
  water_liters_per_bird_per_day           numeric(12,3),
  expected_cumulative_mortality_percent   numeric(7,3),
  target_egg_lay_percent                  numeric(7,3),
  max_rejected_egg_percent                numeric(7,3),
  tolerance_percent                       numeric(7,3) NOT NULL DEFAULT 5,
  notes                                   text,
  created_at                              timestamptz NOT NULL DEFAULT now(),
  updated_at                              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_model_week_targets_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_model_week_targets_model_week_unique UNIQUE (organization_id, performance_model_id, week_number),
  CONSTRAINT poultry_model_week_targets_model_fk FOREIGN KEY (organization_id, performance_model_id)
    REFERENCES poultry_performance_models (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT poultry_model_week_targets_week_check CHECK (week_number BETWEEN 1 AND 150),
  CONSTRAINT poultry_model_week_targets_values_check CHECK (
    (target_weight_g IS NULL OR target_weight_g > 0) AND
    (feed_g_per_bird_per_day IS NULL OR feed_g_per_bird_per_day >= 0) AND
    (water_liters_per_bird_per_day IS NULL OR water_liters_per_bird_per_day >= 0) AND
    (expected_cumulative_mortality_percent IS NULL OR expected_cumulative_mortality_percent BETWEEN 0 AND 100) AND
    (target_egg_lay_percent IS NULL OR target_egg_lay_percent BETWEEN 0 AND 100) AND
    (max_rejected_egg_percent IS NULL OR max_rejected_egg_percent BETWEEN 0 AND 100) AND
    tolerance_percent BETWEEN 0 AND 100
  ),
  CONSTRAINT poultry_model_week_targets_has_target CHECK (
    target_weight_g IS NOT NULL OR feed_g_per_bird_per_day IS NOT NULL OR
    water_liters_per_bird_per_day IS NOT NULL OR expected_cumulative_mortality_percent IS NOT NULL OR
    target_egg_lay_percent IS NOT NULL OR max_rejected_egg_percent IS NOT NULL
  ),
  CONSTRAINT poultry_model_week_targets_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE TRIGGER poultry_model_week_targets_set_updated_at
  BEFORE UPDATE ON poultry_model_week_targets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX poultry_model_week_targets_model_idx ON poultry_model_week_targets (organization_id, performance_model_id, week_number);
SELECT enable_tenant_rls('poultry_model_week_targets');

CREATE TABLE poultry_model_vaccine_schedules (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  performance_model_id  uuid NOT NULL,
  day_age               integer NOT NULL,
  vaccine_name          text NOT NULL,
  dose                  text,
  administration_route  text,
  notes                 text,
  is_required           boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_model_vaccine_schedules_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_model_vaccine_schedules_unique UNIQUE (organization_id, performance_model_id, day_age, vaccine_name),
  CONSTRAINT poultry_model_vaccine_schedules_model_fk FOREIGN KEY (organization_id, performance_model_id)
    REFERENCES poultry_performance_models (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT poultry_model_vaccine_schedules_day_age_check CHECK (day_age BETWEEN 0 AND 1000),
  CONSTRAINT poultry_model_vaccine_schedules_name_not_blank CHECK (btrim(vaccine_name) <> ''),
  CONSTRAINT poultry_model_vaccine_schedules_text_not_blank CHECK (
    (dose IS NULL OR btrim(dose) <> '') AND (administration_route IS NULL OR btrim(administration_route) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);

CREATE TRIGGER poultry_model_vaccine_schedules_set_updated_at
  BEFORE UPDATE ON poultry_model_vaccine_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX poultry_model_vaccine_schedules_model_age_idx ON poultry_model_vaccine_schedules (organization_id, performance_model_id, day_age);
SELECT enable_tenant_rls('poultry_model_vaccine_schedules');

ALTER TABLE poultry_flocks
  ADD COLUMN production_type text,
  ADD COLUMN performance_model_id uuid;
ALTER TABLE poultry_flocks
  ADD CONSTRAINT poultry_flocks_production_type_check CHECK (production_type IS NULL OR production_type IN ('broiler', 'layer')),
  ADD CONSTRAINT poultry_flocks_performance_model_fk FOREIGN KEY (organization_id, performance_model_id)
    REFERENCES poultry_performance_models (organization_id, id) ON DELETE SET NULL;
CREATE INDEX poultry_flocks_performance_model_idx ON poultry_flocks (organization_id, performance_model_id) WHERE performance_model_id IS NOT NULL;

ALTER TABLE poultry_egg_records ADD COLUMN rejected_eggs integer NOT NULL DEFAULT 0;
ALTER TABLE poultry_egg_records DROP CONSTRAINT poultry_eggs_counts_check;
ALTER TABLE poultry_egg_records ADD CONSTRAINT poultry_eggs_counts_check CHECK (
  total_eggs >= 0 AND cracked_eggs >= 0 AND dirty_eggs >= 0 AND hatching_eggs >= 0 AND rejected_eggs >= 0 AND
  cracked_eggs + dirty_eggs + hatching_eggs + rejected_eggs <= total_eggs
);

CREATE TABLE poultry_daily_work_items (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flock_id              uuid NOT NULL,
  model_schedule_id     uuid,
  work_date             date NOT NULL,
  work_type             text NOT NULL,
  title                 text NOT NULL,
  details               text,
  due_at                time,
  assigned_member_id    uuid,
  status                text NOT NULL DEFAULT 'planned',
  source                text NOT NULL DEFAULT 'manual',
  created_by_user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_daily_work_items_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_daily_work_items_flock_fk FOREIGN KEY (organization_id, flock_id)
    REFERENCES poultry_flocks (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT poultry_daily_work_items_schedule_fk FOREIGN KEY (organization_id, model_schedule_id)
    REFERENCES poultry_model_vaccine_schedules (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT poultry_daily_work_items_member_fk FOREIGN KEY (organization_id, assigned_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT poultry_daily_work_items_unique_model_item UNIQUE (organization_id, flock_id, work_date, work_type, source),
  CONSTRAINT poultry_daily_work_items_type_check CHECK (work_type IN ('feed_record', 'water_record', 'weight_check', 'egg_collection', 'mortality_review', 'vaccination', 'health_check', 'climate_check', 'other')),
  CONSTRAINT poultry_daily_work_items_status_check CHECK (status IN ('planned', 'in_progress', 'completed', 'skipped')),
  CONSTRAINT poultry_daily_work_items_source_check CHECK (source IN ('manual', 'model')),
  CONSTRAINT poultry_daily_work_items_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT poultry_daily_work_items_text_not_blank CHECK (details IS NULL OR btrim(details) <> '')
);

CREATE TRIGGER poultry_daily_work_items_set_updated_at
  BEFORE UPDATE ON poultry_daily_work_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX poultry_daily_work_items_flock_date_idx ON poultry_daily_work_items (organization_id, flock_id, work_date, status);
CREATE INDEX poultry_daily_work_items_assignee_idx ON poultry_daily_work_items (organization_id, assigned_member_id, work_date) WHERE status IN ('planned', 'in_progress');
SELECT enable_tenant_rls('poultry_daily_work_items');

-- New explicit controls for standards and regional profiles.
INSERT INTO permissions (code, resource, action, module_code, description)
SELECT 'poultry.' || r.resource || '.' || a.action, 'poultry.' || r.resource, a.action, 'poultry',
       a.action || ' poultry ' || replace(r.resource, '_', ' ')
  FROM (VALUES ('performance_models'), ('climate_profiles')) AS r(resource)
 CROSS JOIN (VALUES ('read'), ('create'), ('update'), ('delete')) AS a(action)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT rp.code, p.code
  FROM role_presets rp CROSS JOIN permissions p
 WHERE rp.code IN ('owner', 'general_manager', 'farm_operations_manager', 'farm_manager')
   AND p.resource IN ('poultry.performance_models', 'poultry.climate_profiles')
ON CONFLICT DO NOTHING;

INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT rp.code, p.code
  FROM role_presets rp CROSS JOIN permissions p
 WHERE rp.code IN ('poultry_supervisor', 'supervisor', 'veterinarian', 'provincial_manager')
   AND p.resource IN ('poultry.performance_models', 'poultry.climate_profiles')
   AND p.action = 'read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
  FROM roles r CROSS JOIN permissions p
 WHERE r.code IN ('owner', 'general_manager', 'farm_operations_manager', 'farm_manager')
   AND p.resource IN ('poultry.performance_models', 'poultry.climate_profiles')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
  FROM roles r CROSS JOIN permissions p
 WHERE r.code IN ('poultry_supervisor', 'supervisor', 'veterinarian', 'provincial_manager')
   AND p.resource IN ('poultry.performance_models', 'poultry.climate_profiles')
   AND p.action = 'read'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE poultry_performance_models IS
  'Company-owned editable standards such as Cobb, Ross, Lohmann, ISA Brown or a custom Congo Omega model.';
COMMENT ON TABLE poultry_model_week_targets IS
  'Weekly performance targets used for comparisons; no poultry standard is embedded in application code.';
COMMENT ON TABLE poultry_model_vaccine_schedules IS
  'Model-specific vaccine requirements by bird age in days.';
COMMENT ON TABLE poultry_daily_work_items IS
  'Daily poultry work generated from the selected performance model or created manually.';
