-- 020_agriculture_operations.sql
-- Complete crop production records for Congo Omega. The site is the physical
-- location; farm, field and plot give each record a province-safe location.

CREATE TABLE agriculture_farms (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  site_id         uuid NOT NULL,
  code            text NOT NULL,
  name            text NOT NULL,
  farm_type       text NOT NULL DEFAULT 'mixed',
  total_area_ha   numeric(14,3),
  manager_name    text,
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT agriculture_farms_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT agriculture_farms_code_unique UNIQUE (organization_id, code),
  CONSTRAINT agriculture_farms_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT agriculture_farms_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT agriculture_farms_type_check CHECK (farm_type IN ('crop', 'livestock', 'mixed', 'nursery', 'research', 'other')),
  CONSTRAINT agriculture_farms_area_check CHECK (total_area_ha IS NULL OR total_area_ha > 0),
  CONSTRAINT agriculture_farms_text_check CHECK (
    btrim(name) <> '' AND
    (manager_name IS NULL OR btrim(manager_name) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER agriculture_farms_set_updated_at BEFORE UPDATE ON agriculture_farms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX agriculture_farms_site_idx ON agriculture_farms (organization_id, site_id) WHERE is_active;
SELECT enable_tenant_rls('agriculture_farms');

CREATE TABLE agriculture_fields (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  farm_id           uuid NOT NULL,
  code              text NOT NULL,
  name              text NOT NULL,
  area_ha           numeric(14,3) NOT NULL,
  soil_type         text,
  irrigation_source text,
  latitude          numeric(10,7),
  longitude         numeric(10,7),
  is_active         boolean NOT NULL DEFAULT true,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT agriculture_fields_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT agriculture_fields_code_unique UNIQUE (organization_id, code),
  CONSTRAINT agriculture_fields_farm_fk FOREIGN KEY (organization_id, farm_id)
    REFERENCES agriculture_farms (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT agriculture_fields_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT agriculture_fields_area_check CHECK (area_ha > 0),
  CONSTRAINT agriculture_fields_coordinates_check CHECK (
    (latitude IS NULL OR latitude BETWEEN -90 AND 90) AND
    (longitude IS NULL OR longitude BETWEEN -180 AND 180)
  ),
  CONSTRAINT agriculture_fields_text_check CHECK (
    btrim(name) <> '' AND
    (soil_type IS NULL OR btrim(soil_type) <> '') AND
    (irrigation_source IS NULL OR btrim(irrigation_source) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER agriculture_fields_set_updated_at BEFORE UPDATE ON agriculture_fields
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX agriculture_fields_farm_idx ON agriculture_fields (organization_id, farm_id) WHERE is_active;
SELECT enable_tenant_rls('agriculture_fields');

CREATE TABLE agriculture_plots (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  field_id        uuid NOT NULL,
  code            text NOT NULL,
  name            text NOT NULL,
  area_ha         numeric(14,3) NOT NULL,
  soil_type       text,
  status          text NOT NULL DEFAULT 'available',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT agriculture_plots_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT agriculture_plots_code_unique UNIQUE (organization_id, code),
  CONSTRAINT agriculture_plots_field_fk FOREIGN KEY (organization_id, field_id)
    REFERENCES agriculture_fields (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT agriculture_plots_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT agriculture_plots_area_check CHECK (area_ha > 0),
  CONSTRAINT agriculture_plots_status_check CHECK (status IN ('available', 'planted', 'fallow', 'resting', 'quarantined', 'closed')),
  CONSTRAINT agriculture_plots_text_check CHECK (
    btrim(name) <> '' AND
    (soil_type IS NULL OR btrim(soil_type) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER agriculture_plots_set_updated_at BEFORE UPDATE ON agriculture_plots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX agriculture_plots_field_idx ON agriculture_plots (organization_id, field_id, status);
SELECT enable_tenant_rls('agriculture_plots');

CREATE TABLE agriculture_crops (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  code                  text NOT NULL,
  name                  text NOT NULL,
  scientific_name       text,
  crop_type             text NOT NULL DEFAULT 'other',
  variety               text,
  default_growing_days  integer,
  default_yield_unit    text NOT NULL DEFAULT 'kg',
  is_active             boolean NOT NULL DEFAULT true,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT agriculture_crops_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT agriculture_crops_code_unique UNIQUE (organization_id, code),
  CONSTRAINT agriculture_crops_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT agriculture_crops_type_check CHECK (crop_type IN ('cereal', 'legume', 'root_tuber', 'vegetable', 'fruit', 'oilseed', 'forage', 'cash_crop', 'tree', 'other')),
  CONSTRAINT agriculture_crops_days_check CHECK (default_growing_days IS NULL OR default_growing_days > 0),
  CONSTRAINT agriculture_crops_text_check CHECK (
    btrim(name) <> '' AND btrim(default_yield_unit) <> '' AND
    (scientific_name IS NULL OR btrim(scientific_name) <> '') AND
    (variety IS NULL OR btrim(variety) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER agriculture_crops_set_updated_at BEFORE UPDATE ON agriculture_crops
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX agriculture_crops_active_idx ON agriculture_crops (organization_id, is_active);
SELECT enable_tenant_rls('agriculture_crops');

CREATE TABLE agriculture_seasons (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  farm_id         uuid NOT NULL,
  code            text NOT NULL,
  name            text NOT NULL,
  season_type     text NOT NULL DEFAULT 'other',
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT agriculture_seasons_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT agriculture_seasons_code_unique UNIQUE (organization_id, code),
  CONSTRAINT agriculture_seasons_farm_fk FOREIGN KEY (organization_id, farm_id)
    REFERENCES agriculture_farms (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT agriculture_seasons_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT agriculture_seasons_type_check CHECK (season_type IN ('rainy', 'dry', 'irrigated', 'perennial', 'other')),
  CONSTRAINT agriculture_seasons_dates_check CHECK (end_date >= start_date),
  CONSTRAINT agriculture_seasons_text_check CHECK (btrim(name) <> '' AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER agriculture_seasons_set_updated_at BEFORE UPDATE ON agriculture_seasons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX agriculture_seasons_farm_dates_idx ON agriculture_seasons (organization_id, farm_id, start_date DESC);
SELECT enable_tenant_rls('agriculture_seasons');

CREATE TABLE agriculture_plantings (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  plot_id               uuid NOT NULL,
  crop_id               uuid NOT NULL,
  season_id             uuid,
  code                  text NOT NULL,
  name                  text NOT NULL,
  variety               text,
  planting_date         date NOT NULL,
  expected_harvest_date date,
  actual_harvest_date   date,
  planted_area_ha       numeric(14,3) NOT NULL,
  seed_quantity         numeric(14,3),
  seed_unit             text,
  planting_method       text,
  plant_density         numeric(14,3),
  status                text NOT NULL DEFAULT 'planned',
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT agriculture_plantings_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT agriculture_plantings_code_unique UNIQUE (organization_id, code),
  CONSTRAINT agriculture_plantings_plot_fk FOREIGN KEY (organization_id, plot_id)
    REFERENCES agriculture_plots (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT agriculture_plantings_crop_fk FOREIGN KEY (organization_id, crop_id)
    REFERENCES agriculture_crops (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT agriculture_plantings_season_fk FOREIGN KEY (organization_id, season_id)
    REFERENCES agriculture_seasons (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT agriculture_plantings_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT agriculture_plantings_status_check CHECK (status IN ('planned', 'planted', 'growing', 'harvested', 'failed', 'abandoned', 'closed')),
  CONSTRAINT agriculture_plantings_values_check CHECK (
    planted_area_ha > 0 AND
    (seed_quantity IS NULL OR seed_quantity > 0) AND
    (plant_density IS NULL OR plant_density > 0)
  ),
  CONSTRAINT agriculture_plantings_dates_check CHECK (
    (expected_harvest_date IS NULL OR expected_harvest_date >= planting_date) AND
    (actual_harvest_date IS NULL OR actual_harvest_date >= planting_date)
  ),
  CONSTRAINT agriculture_plantings_text_check CHECK (
    btrim(name) <> '' AND
    (variety IS NULL OR btrim(variety) <> '') AND
    (seed_unit IS NULL OR btrim(seed_unit) <> '') AND
    (planting_method IS NULL OR btrim(planting_method) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER agriculture_plantings_set_updated_at BEFORE UPDATE ON agriculture_plantings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX agriculture_plantings_plot_status_idx ON agriculture_plantings (organization_id, plot_id, status);
CREATE INDEX agriculture_plantings_crop_date_idx ON agriculture_plantings (organization_id, crop_id, planting_date DESC);
SELECT enable_tenant_rls('agriculture_plantings');

CREATE TABLE agriculture_operations (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  field_id            uuid NOT NULL,
  plot_id             uuid,
  planting_id         uuid,
  operation_date      date NOT NULL,
  operation_type      text NOT NULL,
  status              text NOT NULL DEFAULT 'completed',
  quantity            numeric(14,3),
  unit                text,
  labour_hours        numeric(12,2),
  equipment_name      text,
  notes               text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT agriculture_operations_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT agriculture_operations_field_fk FOREIGN KEY (organization_id, field_id) REFERENCES agriculture_fields (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT agriculture_operations_plot_fk FOREIGN KEY (organization_id, plot_id) REFERENCES agriculture_plots (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT agriculture_operations_planting_fk FOREIGN KEY (organization_id, planting_id) REFERENCES agriculture_plantings (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT agriculture_operations_type_check CHECK (operation_type IN ('land_preparation', 'planting', 'weeding', 'pruning', 'staking', 'mulching', 'harvesting', 'inspection', 'maintenance', 'other')),
  CONSTRAINT agriculture_operations_status_check CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT agriculture_operations_values_check CHECK ((quantity IS NULL OR quantity > 0) AND (labour_hours IS NULL OR labour_hours >= 0)),
  CONSTRAINT agriculture_operations_text_check CHECK (
    (unit IS NULL OR btrim(unit) <> '') AND
    (equipment_name IS NULL OR btrim(equipment_name) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER agriculture_operations_set_updated_at BEFORE UPDATE ON agriculture_operations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX agriculture_operations_field_date_idx ON agriculture_operations (organization_id, field_id, operation_date DESC);
SELECT enable_tenant_rls('agriculture_operations');

CREATE TABLE agriculture_irrigation_records (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  field_id            uuid NOT NULL,
  plot_id             uuid,
  planting_id         uuid,
  irrigation_date     date NOT NULL,
  method              text NOT NULL DEFAULT 'other',
  volume_liters       numeric(14,3),
  duration_minutes    integer,
  water_source        text,
  notes               text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT agriculture_irrigation_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT agriculture_irrigation_field_fk FOREIGN KEY (organization_id, field_id) REFERENCES agriculture_fields (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT agriculture_irrigation_plot_fk FOREIGN KEY (organization_id, plot_id) REFERENCES agriculture_plots (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT agriculture_irrigation_planting_fk FOREIGN KEY (organization_id, planting_id) REFERENCES agriculture_plantings (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT agriculture_irrigation_method_check CHECK (method IN ('drip', 'sprinkler', 'furrow', 'flood', 'manual', 'rainfed', 'other')),
  CONSTRAINT agriculture_irrigation_values_check CHECK ((volume_liters IS NULL OR volume_liters > 0) AND (duration_minutes IS NULL OR duration_minutes > 0)),
  CONSTRAINT agriculture_irrigation_text_check CHECK ((water_source IS NULL OR btrim(water_source) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER agriculture_irrigation_set_updated_at BEFORE UPDATE ON agriculture_irrigation_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX agriculture_irrigation_field_date_idx ON agriculture_irrigation_records (organization_id, field_id, irrigation_date DESC);
SELECT enable_tenant_rls('agriculture_irrigation_records');

CREATE TABLE agriculture_fertilizer_records (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  field_id            uuid NOT NULL,
  plot_id             uuid,
  planting_id         uuid,
  application_date    date NOT NULL,
  product_name        text NOT NULL,
  nutrient_formula    text,
  quantity_kg         numeric(14,3) NOT NULL,
  application_method  text,
  batch_number        text,
  notes               text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT agriculture_fertilizer_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT agriculture_fertilizer_field_fk FOREIGN KEY (organization_id, field_id) REFERENCES agriculture_fields (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT agriculture_fertilizer_plot_fk FOREIGN KEY (organization_id, plot_id) REFERENCES agriculture_plots (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT agriculture_fertilizer_planting_fk FOREIGN KEY (organization_id, planting_id) REFERENCES agriculture_plantings (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT agriculture_fertilizer_quantity_check CHECK (quantity_kg > 0),
  CONSTRAINT agriculture_fertilizer_text_check CHECK (
    btrim(product_name) <> '' AND
    (nutrient_formula IS NULL OR btrim(nutrient_formula) <> '') AND
    (application_method IS NULL OR btrim(application_method) <> '') AND
    (batch_number IS NULL OR btrim(batch_number) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER agriculture_fertilizer_set_updated_at BEFORE UPDATE ON agriculture_fertilizer_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX agriculture_fertilizer_field_date_idx ON agriculture_fertilizer_records (organization_id, field_id, application_date DESC);
SELECT enable_tenant_rls('agriculture_fertilizer_records');

CREATE TABLE agriculture_pesticide_records (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  field_id              uuid NOT NULL,
  plot_id               uuid,
  planting_id           uuid,
  application_date      date NOT NULL,
  product_name          text NOT NULL,
  active_ingredient     text,
  target_pest           text,
  dosage                text,
  application_method    text,
  pre_harvest_interval_days integer,
  batch_number          text,
  notes                 text,
  recorded_by_user_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT agriculture_pesticide_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT agriculture_pesticide_field_fk FOREIGN KEY (organization_id, field_id) REFERENCES agriculture_fields (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT agriculture_pesticide_plot_fk FOREIGN KEY (organization_id, plot_id) REFERENCES agriculture_plots (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT agriculture_pesticide_planting_fk FOREIGN KEY (organization_id, planting_id) REFERENCES agriculture_plantings (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT agriculture_pesticide_interval_check CHECK (pre_harvest_interval_days IS NULL OR pre_harvest_interval_days >= 0),
  CONSTRAINT agriculture_pesticide_text_check CHECK (
    btrim(product_name) <> '' AND
    (active_ingredient IS NULL OR btrim(active_ingredient) <> '') AND
    (target_pest IS NULL OR btrim(target_pest) <> '') AND
    (dosage IS NULL OR btrim(dosage) <> '') AND
    (application_method IS NULL OR btrim(application_method) <> '') AND
    (batch_number IS NULL OR btrim(batch_number) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER agriculture_pesticide_set_updated_at BEFORE UPDATE ON agriculture_pesticide_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX agriculture_pesticide_field_date_idx ON agriculture_pesticide_records (organization_id, field_id, application_date DESC);
SELECT enable_tenant_rls('agriculture_pesticide_records');

CREATE TABLE agriculture_scouting_records (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  field_id            uuid NOT NULL,
  plot_id             uuid,
  planting_id         uuid,
  scouting_date       date NOT NULL,
  observation_type    text NOT NULL,
  severity            text NOT NULL DEFAULT 'low',
  affected_area_ha    numeric(14,3),
  observed_issue      text,
  pest_or_disease     text,
  recommendation      text,
  status              text NOT NULL DEFAULT 'open',
  notes               text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT agriculture_scouting_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT agriculture_scouting_field_fk FOREIGN KEY (organization_id, field_id) REFERENCES agriculture_fields (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT agriculture_scouting_plot_fk FOREIGN KEY (organization_id, plot_id) REFERENCES agriculture_plots (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT agriculture_scouting_planting_fk FOREIGN KEY (organization_id, planting_id) REFERENCES agriculture_plantings (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT agriculture_scouting_type_check CHECK (observation_type IN ('pest', 'disease', 'weed', 'nutrient_deficiency', 'water_stress', 'growth', 'soil', 'weather_damage', 'other')),
  CONSTRAINT agriculture_scouting_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT agriculture_scouting_status_check CHECK (status IN ('open', 'monitoring', 'resolved')),
  CONSTRAINT agriculture_scouting_area_check CHECK (affected_area_ha IS NULL OR affected_area_ha > 0),
  CONSTRAINT agriculture_scouting_text_check CHECK (
    (observed_issue IS NULL OR btrim(observed_issue) <> '') AND
    (pest_or_disease IS NULL OR btrim(pest_or_disease) <> '') AND
    (recommendation IS NULL OR btrim(recommendation) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER agriculture_scouting_set_updated_at BEFORE UPDATE ON agriculture_scouting_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX agriculture_scouting_field_date_idx ON agriculture_scouting_records (organization_id, field_id, scouting_date DESC);
SELECT enable_tenant_rls('agriculture_scouting_records');

CREATE TABLE agriculture_weather_records (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  farm_id             uuid NOT NULL,
  observation_date    date NOT NULL,
  rainfall_mm         numeric(12,3),
  min_temperature_c   numeric(6,2),
  max_temperature_c   numeric(6,2),
  humidity_percent    numeric(6,2),
  wind_speed_kph      numeric(8,2),
  conditions          text,
  notes               text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT agriculture_weather_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT agriculture_weather_farm_fk FOREIGN KEY (organization_id, farm_id) REFERENCES agriculture_farms (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT agriculture_weather_unique UNIQUE (organization_id, farm_id, observation_date),
  CONSTRAINT agriculture_weather_values_check CHECK (
    (rainfall_mm IS NULL OR rainfall_mm >= 0) AND
    (humidity_percent IS NULL OR humidity_percent BETWEEN 0 AND 100) AND
    (wind_speed_kph IS NULL OR wind_speed_kph >= 0) AND
    (min_temperature_c IS NULL OR max_temperature_c IS NULL OR max_temperature_c >= min_temperature_c)
  ),
  CONSTRAINT agriculture_weather_text_check CHECK ((conditions IS NULL OR btrim(conditions) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER agriculture_weather_set_updated_at BEFORE UPDATE ON agriculture_weather_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX agriculture_weather_farm_date_idx ON agriculture_weather_records (organization_id, farm_id, observation_date DESC);
SELECT enable_tenant_rls('agriculture_weather_records');

CREATE TABLE agriculture_harvest_records (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  planting_id         uuid NOT NULL,
  harvest_date        date NOT NULL,
  quantity            numeric(14,3) NOT NULL,
  unit                text NOT NULL DEFAULT 'kg',
  quality_grade       text,
  rejected_quantity   numeric(14,3) NOT NULL DEFAULT 0,
  moisture_percent    numeric(6,2),
  storage_location    text,
  notes               text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT agriculture_harvest_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT agriculture_harvest_planting_fk FOREIGN KEY (organization_id, planting_id) REFERENCES agriculture_plantings (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT agriculture_harvest_values_check CHECK (
    quantity > 0 AND rejected_quantity >= 0 AND rejected_quantity <= quantity AND
    (moisture_percent IS NULL OR moisture_percent BETWEEN 0 AND 100)
  ),
  CONSTRAINT agriculture_harvest_text_check CHECK (
    btrim(unit) <> '' AND
    (quality_grade IS NULL OR btrim(quality_grade) <> '') AND
    (storage_location IS NULL OR btrim(storage_location) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER agriculture_harvest_set_updated_at BEFORE UPDATE ON agriculture_harvest_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX agriculture_harvest_planting_date_idx ON agriculture_harvest_records (organization_id, planting_id, harvest_date DESC);
SELECT enable_tenant_rls('agriculture_harvest_records');

CREATE TABLE agriculture_production_targets (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  planting_id         uuid NOT NULL,
  target_yield        numeric(14,3) NOT NULL,
  unit                text NOT NULL DEFAULT 'kg',
  target_harvest_date date,
  quality_target      text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT agriculture_targets_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT agriculture_targets_planting_fk FOREIGN KEY (organization_id, planting_id) REFERENCES agriculture_plantings (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT agriculture_targets_yield_check CHECK (target_yield > 0),
  CONSTRAINT agriculture_targets_text_check CHECK (
    btrim(unit) <> '' AND
    (quality_target IS NULL OR btrim(quality_target) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER agriculture_targets_set_updated_at BEFORE UPDATE ON agriculture_production_targets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX agriculture_targets_planting_idx ON agriculture_production_targets (organization_id, planting_id);
SELECT enable_tenant_rls('agriculture_production_targets');

CREATE TABLE agriculture_loss_records (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  field_id            uuid NOT NULL,
  plot_id             uuid,
  planting_id         uuid,
  loss_date           date NOT NULL,
  loss_type           text NOT NULL,
  quantity            numeric(14,3),
  unit                text,
  estimated_value     numeric(14,2),
  cause_description   text,
  action_taken        text,
  notes               text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT agriculture_losses_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT agriculture_losses_field_fk FOREIGN KEY (organization_id, field_id) REFERENCES agriculture_fields (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT agriculture_losses_plot_fk FOREIGN KEY (organization_id, plot_id) REFERENCES agriculture_plots (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT agriculture_losses_planting_fk FOREIGN KEY (organization_id, planting_id) REFERENCES agriculture_plantings (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT agriculture_losses_type_check CHECK (loss_type IN ('crop_damage', 'pest', 'disease', 'drought', 'flood', 'fire', 'theft', 'input_spoilage', 'equipment', 'other')),
  CONSTRAINT agriculture_losses_values_check CHECK ((quantity IS NULL OR quantity > 0) AND (estimated_value IS NULL OR estimated_value >= 0)),
  CONSTRAINT agriculture_losses_text_check CHECK (
    (unit IS NULL OR btrim(unit) <> '') AND
    (cause_description IS NULL OR btrim(cause_description) <> '') AND
    (action_taken IS NULL OR btrim(action_taken) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER agriculture_losses_set_updated_at BEFORE UPDATE ON agriculture_loss_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX agriculture_losses_field_date_idx ON agriculture_loss_records (organization_id, field_id, loss_date DESC);
SELECT enable_tenant_rls('agriculture_loss_records');

COMMENT ON TABLE agriculture_plantings IS 'A crop production cycle on one plot, from planting through harvest or failure.';
COMMENT ON TABLE agriculture_scouting_records IS 'Field observations such as pests, disease, nutrient deficiency and water stress.';
COMMENT ON TABLE agriculture_harvest_records IS 'Harvest output. Creating a harvest marks its planting as harvested.';

-- The agriculture permission catalogue is global. Existing role grants apply
-- only to Congo Omega; provisioned agriculture/livestock companies inherit the
-- role preset grants at organization creation.
INSERT INTO permissions (code, resource, action, module_code, description)
SELECT 'agriculture.' || r.resource || '.' || a.action,
       'agriculture.' || r.resource, a.action, 'agriculture',
       a.action || ' agriculture ' || replace(r.resource, '_', ' ')
  FROM (VALUES
    ('farms'), ('fields'), ('plots'), ('crops'), ('seasons'), ('plantings'),
    ('operations'), ('scouting'), ('irrigation'), ('fertilizer'),
    ('pesticides'), ('weather'), ('harvest'), ('production_targets'), ('losses')
  ) AS r(resource)
 CROSS JOIN (VALUES ('read'), ('create'), ('update'), ('delete')) AS a(action)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT rp.code, p.code
  FROM role_presets rp CROSS JOIN permissions p
 WHERE rp.code IN ('owner', 'general_manager', 'farm_operations_manager', 'farm_manager')
   AND p.module_code = 'agriculture'
ON CONFLICT DO NOTHING;

INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT rp.code, p.code
  FROM role_presets rp CROSS JOIN permissions p
 WHERE rp.code IN ('agriculture_supervisor', 'agronomist', 'supervisor', 'provincial_manager')
   AND p.module_code = 'agriculture'
   AND p.action IN ('create', 'read', 'update')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
  FROM roles r
  JOIN organizations o ON o.id = r.organization_id
 CROSS JOIN permissions p
 WHERE o.slug = 'congo-omega'
   AND r.code IN ('owner', 'general_manager', 'farm_operations_manager', 'farm_manager')
   AND p.module_code = 'agriculture'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
  FROM roles r
  JOIN organizations o ON o.id = r.organization_id
 CROSS JOIN permissions p
 WHERE o.slug = 'congo-omega'
   AND r.code IN ('agriculture_supervisor', 'agronomist', 'supervisor', 'provincial_manager')
   AND p.module_code = 'agriculture'
   AND p.action IN ('create', 'read', 'update')
ON CONFLICT DO NOTHING;
