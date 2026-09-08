-- 038_poultry_setup_management.sql
-- Owner/admin configuration for poultry houses, flock lifecycle and editable
-- performance standards. Operational history remains in the existing records.

ALTER TABLE poultry_houses
  DROP CONSTRAINT poultry_houses_code_unique_per_org,
  DROP CONSTRAINT poultry_houses_type_check;

ALTER TABLE poultry_houses
  ADD COLUMN operational_status text NOT NULL DEFAULT 'active',
  ADD COLUMN description text,
  ADD COLUMN length_m numeric(10,2),
  ADD COLUMN width_m numeric(10,2),
  ADD COLUMN floor_area_m2 numeric(12,2),
  ADD COLUMN ventilation_type text,
  ADD COLUMN water_system text,
  ADD COLUMN feeding_system text,
  ADD COLUMN heating_system text,
  ADD COLUMN created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN updated_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL;

UPDATE poultry_houses
   SET operational_status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END;

ALTER TABLE poultry_houses
  ADD CONSTRAINT poultry_houses_code_unique_per_site UNIQUE (organization_id, site_id, code),
  ADD CONSTRAINT poultry_houses_type_check
    CHECK (house_type IN ('broiler', 'layer', 'breeder', 'mixed', 'pullet', 'chick', 'quarantine', 'other')),
  ADD CONSTRAINT poultry_houses_operational_status_check
    CHECK (operational_status IN ('active', 'inactive', 'under_cleaning', 'maintenance')),
  ADD CONSTRAINT poultry_houses_dimensions_check CHECK (
    (length_m IS NULL OR length_m > 0) AND
    (width_m IS NULL OR width_m > 0) AND
    (floor_area_m2 IS NULL OR floor_area_m2 > 0)
  ),
  ADD CONSTRAINT poultry_houses_system_text_check CHECK (
    (description IS NULL OR btrim(description) <> '') AND
    (ventilation_type IS NULL OR btrim(ventilation_type) <> '') AND
    (water_system IS NULL OR btrim(water_system) <> '') AND
    (feeding_system IS NULL OR btrim(feeding_system) <> '') AND
    (heating_system IS NULL OR btrim(heating_system) <> '')
  );

ALTER TABLE poultry_performance_models
  DROP CONSTRAINT poultry_performance_models_type_check;
ALTER TABLE poultry_performance_models
  ADD CONSTRAINT poultry_performance_models_type_check
    CHECK (production_type IN ('broiler', 'layer', 'breeder')),
  ADD COLUMN updated_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE poultry_flocks
  DROP CONSTRAINT poultry_flocks_status_check,
  DROP CONSTRAINT poultry_flocks_production_type_check;

ALTER TABLE poultry_flocks
  ADD COLUMN starting_age_days integer NOT NULL DEFAULT 0,
  ADD COLUMN chick_source text,
  ADD COLUMN sex text NOT NULL DEFAULT 'mixed',
  ADD COLUMN purchase_cost_total numeric(14,2),
  ADD COLUMN cost_per_bird numeric(14,4),
  ADD COLUMN expected_production_end_date date,
  ADD COLUMN parent_flock_id uuid,
  ADD COLUMN capacity_override_reason text,
  ADD COLUMN capacity_override_authorized_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN closing_reason text,
  ADD COLUMN closing_notes text,
  ADD COLUMN birds_sold integer,
  ADD COLUMN birds_transferred integer,
  ADD COLUMN final_live_bird_count integer,
  ADD COLUMN final_mortality integer,
  ADD COLUMN created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN updated_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN closed_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE poultry_flocks
  ADD CONSTRAINT poultry_flocks_status_check
    CHECK (status IN ('planned', 'active', 'ready_for_sale', 'closed', 'cancelled', 'quarantined', 'sold', 'depleted')),
  ADD CONSTRAINT poultry_flocks_production_type_check
    CHECK (production_type IS NULL OR production_type IN ('broiler', 'layer', 'breeder')),
  ADD CONSTRAINT poultry_flocks_starting_age_check CHECK (starting_age_days BETWEEN 0 AND 1000),
  ADD CONSTRAINT poultry_flocks_sex_check CHECK (sex IN ('mixed', 'male', 'female')),
  ADD CONSTRAINT poultry_flocks_cost_check CHECK (
    (purchase_cost_total IS NULL OR purchase_cost_total >= 0) AND
    (cost_per_bird IS NULL OR cost_per_bird >= 0)
  ),
  ADD CONSTRAINT poultry_flocks_expected_end_check
    CHECK (expected_production_end_date IS NULL OR expected_production_end_date >= arrival_date),
  ADD CONSTRAINT poultry_flocks_closing_values_check CHECK (
    (birds_sold IS NULL OR birds_sold >= 0) AND
    (birds_transferred IS NULL OR birds_transferred >= 0) AND
    (final_live_bird_count IS NULL OR final_live_bird_count >= 0) AND
    (final_mortality IS NULL OR final_mortality >= 0)
  ),
  ADD CONSTRAINT poultry_flocks_lifecycle_text_check CHECK (
    (chick_source IS NULL OR btrim(chick_source) <> '') AND
    (capacity_override_reason IS NULL OR btrim(capacity_override_reason) <> '') AND
    (closing_reason IS NULL OR btrim(closing_reason) <> '') AND
    (closing_notes IS NULL OR btrim(closing_notes) <> '')
  ),
  ADD CONSTRAINT poultry_flocks_parent_fk FOREIGN KEY (organization_id, parent_flock_id)
    REFERENCES poultry_flocks (organization_id, id) ON DELETE SET NULL;

CREATE INDEX poultry_flocks_parent_idx
  ON poultry_flocks (organization_id, parent_flock_id) WHERE parent_flock_id IS NOT NULL;
CREATE UNIQUE INDEX poultry_flocks_one_operational_per_house_idx
  ON poultry_flocks (organization_id, house_id)
  WHERE status IN ('active', 'quarantined', 'ready_for_sale');

ALTER TABLE poultry_model_week_targets
  ADD COLUMN cumulative_feed_g_per_bird numeric(12,3),
  ADD COLUMN target_fcr numeric(8,3),
  ADD COLUMN target_daily_gain_g numeric(12,3),
  ADD COLUMN target_egg_count integer,
  ADD COLUMN target_egg_weight_g numeric(12,3),
  ADD COLUMN expected_live_bird_percent numeric(7,3),
  ADD COLUMN min_temperature_c numeric(5,2),
  ADD COLUMN max_temperature_c numeric(5,2),
  ADD COLUMN min_humidity_percent numeric(5,2),
  ADD COLUMN max_humidity_percent numeric(5,2);

ALTER TABLE poultry_model_week_targets
  DROP CONSTRAINT poultry_model_week_targets_values_check,
  DROP CONSTRAINT poultry_model_week_targets_has_target;
ALTER TABLE poultry_model_week_targets
  ADD CONSTRAINT poultry_model_week_targets_values_check CHECK (
    (target_weight_g IS NULL OR target_weight_g > 0) AND
    (feed_g_per_bird_per_day IS NULL OR feed_g_per_bird_per_day >= 0) AND
    (water_liters_per_bird_per_day IS NULL OR water_liters_per_bird_per_day >= 0) AND
    (expected_cumulative_mortality_percent IS NULL OR expected_cumulative_mortality_percent BETWEEN 0 AND 100) AND
    (target_egg_lay_percent IS NULL OR target_egg_lay_percent BETWEEN 0 AND 100) AND
    (max_rejected_egg_percent IS NULL OR max_rejected_egg_percent BETWEEN 0 AND 100) AND
    (cumulative_feed_g_per_bird IS NULL OR cumulative_feed_g_per_bird >= 0) AND
    (target_fcr IS NULL OR target_fcr >= 0) AND
    (target_daily_gain_g IS NULL OR target_daily_gain_g >= 0) AND
    (target_egg_count IS NULL OR target_egg_count >= 0) AND
    (target_egg_weight_g IS NULL OR target_egg_weight_g > 0) AND
    (expected_live_bird_percent IS NULL OR expected_live_bird_percent BETWEEN 0 AND 100) AND
    (min_temperature_c IS NULL OR min_temperature_c BETWEEN -30 AND 70) AND
    (max_temperature_c IS NULL OR max_temperature_c BETWEEN -30 AND 70) AND
    (min_humidity_percent IS NULL OR min_humidity_percent BETWEEN 0 AND 100) AND
    (max_humidity_percent IS NULL OR max_humidity_percent BETWEEN 0 AND 100) AND
    (min_temperature_c IS NULL OR max_temperature_c IS NULL OR min_temperature_c <= max_temperature_c) AND
    (min_humidity_percent IS NULL OR max_humidity_percent IS NULL OR min_humidity_percent <= max_humidity_percent) AND
    tolerance_percent BETWEEN 0 AND 100
  ),
  ADD CONSTRAINT poultry_model_week_targets_has_target CHECK (
    target_weight_g IS NOT NULL OR feed_g_per_bird_per_day IS NOT NULL OR
    water_liters_per_bird_per_day IS NOT NULL OR expected_cumulative_mortality_percent IS NOT NULL OR
    target_egg_lay_percent IS NOT NULL OR max_rejected_egg_percent IS NOT NULL OR
    cumulative_feed_g_per_bird IS NOT NULL OR target_fcr IS NOT NULL OR
    target_daily_gain_g IS NOT NULL OR target_egg_count IS NOT NULL OR
    target_egg_weight_g IS NOT NULL OR expected_live_bird_percent IS NOT NULL OR
    min_temperature_c IS NOT NULL OR max_temperature_c IS NOT NULL OR
    min_humidity_percent IS NOT NULL OR max_humidity_percent IS NOT NULL
  );

ALTER TABLE poultry_feed_records
  ADD COLUMN inventory_item_id uuid,
  ADD CONSTRAINT poultry_feed_inventory_item_fk FOREIGN KEY (organization_id, inventory_item_id)
    REFERENCES management_inventory_items (organization_id, id) ON DELETE SET NULL;
ALTER TABLE poultry_vaccination_records
  ADD COLUMN inventory_item_id uuid,
  ADD CONSTRAINT poultry_vaccination_inventory_item_fk FOREIGN KEY (organization_id, inventory_item_id)
    REFERENCES management_inventory_items (organization_id, id) ON DELETE SET NULL;
ALTER TABLE poultry_treatment_records
  ADD COLUMN inventory_item_id uuid,
  ADD CONSTRAINT poultry_treatment_inventory_item_fk FOREIGN KEY (organization_id, inventory_item_id)
    REFERENCES management_inventory_items (organization_id, id) ON DELETE SET NULL;
ALTER TABLE poultry_sanitation_records
  ADD COLUMN inventory_item_id uuid,
  ADD CONSTRAINT poultry_sanitation_inventory_item_fk FOREIGN KEY (organization_id, inventory_item_id)
    REFERENCES management_inventory_items (organization_id, id) ON DELETE SET NULL;

CREATE INDEX poultry_feed_inventory_item_idx
  ON poultry_feed_records (organization_id, inventory_item_id) WHERE inventory_item_id IS NOT NULL;

COMMENT ON COLUMN poultry_flocks.initial_bird_count IS
  'Starting population entered once when the flock is created. Expected live birds are calculated from this count, movement/cull records and mortality.';
COMMENT ON COLUMN poultry_feed_records.inventory_item_id IS
  'Optional preparation for inventory issue linkage. This migration does not deduct stock.';
COMMENT ON TABLE poultry_model_week_targets IS
  'Company-editable weekly standards. No poultry target is hard-coded in application logic.';