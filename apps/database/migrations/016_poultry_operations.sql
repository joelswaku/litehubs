-- 016_poultry_operations.sql
-- Congo Omega poultry operations. Mortality is recorded independently and is
-- the source of truth for bird deaths; daily records read the mortality total.

CREATE TABLE poultry_houses (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  site_id         uuid NOT NULL,
  code            text NOT NULL,
  name            text NOT NULL,
  house_type      text NOT NULL DEFAULT 'other',
  capacity        integer NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_houses_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT poultry_houses_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_houses_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT poultry_houses_code_format
    CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT poultry_houses_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT poultry_houses_type_check
    CHECK (house_type IN ('broiler', 'layer', 'breeder', 'pullet', 'chick', 'quarantine', 'other')),
  CONSTRAINT poultry_houses_capacity_check CHECK (capacity > 0),
  CONSTRAINT poultry_houses_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE TRIGGER poultry_houses_set_updated_at
  BEFORE UPDATE ON poultry_houses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX poultry_houses_site_idx ON poultry_houses (organization_id, site_id);
SELECT enable_tenant_rls('poultry_houses');

CREATE TABLE poultry_flocks (
  id                                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id                   uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  house_id                          uuid NOT NULL,
  code                              text NOT NULL,
  name                              text NOT NULL,
  bird_type                         text NOT NULL,
  breed                             text,
  source_name                       text,
  hatch_date                        date,
  arrival_date                      date NOT NULL,
  initial_bird_count                integer NOT NULL,
  status                            text NOT NULL DEFAULT 'active',
  closed_at                         date,
  mortality_review_threshold        integer NOT NULL DEFAULT 1,
  notes                             text,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_flocks_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT poultry_flocks_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_flocks_house_fk
    FOREIGN KEY (organization_id, house_id)
    REFERENCES poultry_houses (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT poultry_flocks_code_format
    CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT poultry_flocks_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT poultry_flocks_type_check
    CHECK (bird_type IN ('broiler', 'layer', 'breeder', 'pullet', 'chick', 'other')),
  CONSTRAINT poultry_flocks_initial_count_check CHECK (initial_bird_count > 0),
  CONSTRAINT poultry_flocks_status_check
    CHECK (status IN ('active', 'quarantined', 'closed', 'sold', 'depleted')),
  CONSTRAINT poultry_flocks_closed_at_check
    CHECK (closed_at IS NULL OR closed_at >= arrival_date),
  CONSTRAINT poultry_flocks_review_threshold_check CHECK (mortality_review_threshold > 0),
  CONSTRAINT poultry_flocks_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE TRIGGER poultry_flocks_set_updated_at
  BEFORE UPDATE ON poultry_flocks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX poultry_flocks_house_idx ON poultry_flocks (organization_id, house_id);
CREATE INDEX poultry_flocks_active_idx ON poultry_flocks (organization_id) WHERE status IN ('active', 'quarantined');
SELECT enable_tenant_rls('poultry_flocks');

CREATE TABLE poultry_daily_records (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flock_id            uuid NOT NULL,
  record_date         date NOT NULL,
  live_bird_count     integer NOT NULL,
  arrivals_count      integer NOT NULL DEFAULT 0,
  transfers_out_count integer NOT NULL DEFAULT 0,
  culls_count         integer NOT NULL DEFAULT 0,
  notes               text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_daily_records_unique_per_flock_date UNIQUE (organization_id, flock_id, record_date),
  CONSTRAINT poultry_daily_records_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_daily_records_flock_fk
    FOREIGN KEY (organization_id, flock_id)
    REFERENCES poultry_flocks (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT poultry_daily_records_counts_check
    CHECK (live_bird_count >= 0 AND arrivals_count >= 0 AND transfers_out_count >= 0 AND culls_count >= 0),
  CONSTRAINT poultry_daily_records_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE TRIGGER poultry_daily_records_set_updated_at
  BEFORE UPDATE ON poultry_daily_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX poultry_daily_records_flock_date_idx ON poultry_daily_records (organization_id, flock_id, record_date DESC);
SELECT enable_tenant_rls('poultry_daily_records');

CREATE TABLE poultry_mortality_records (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flock_id              uuid NOT NULL,
  mortality_date        date NOT NULL,
  death_count           integer NOT NULL,
  cause_category        text NOT NULL DEFAULT 'unknown',
  suspected_cause       text,
  confirmed_diagnosis   text,
  clinical_signs        text,
  postmortem_status     text NOT NULL DEFAULT 'not_done',
  disposal_method       text NOT NULL DEFAULT 'other',
  veterinarian_name     text,
  requires_follow_up    boolean NOT NULL DEFAULT false,
  follow_up_status      text NOT NULL DEFAULT 'not_required',
  follow_up_notes       text,
  notes                 text,
  recorded_by_user_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_mortality_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_mortality_flock_fk
    FOREIGN KEY (organization_id, flock_id)
    REFERENCES poultry_flocks (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT poultry_mortality_death_count_check CHECK (death_count > 0),
  CONSTRAINT poultry_mortality_cause_check
    CHECK (cause_category IN ('unknown', 'disease', 'heat_stress', 'cold_stress', 'injury', 'predation', 'deformity', 'management', 'other')),
  CONSTRAINT poultry_mortality_postmortem_check
    CHECK (postmortem_status IN ('not_done', 'pending', 'done')),
  CONSTRAINT poultry_mortality_disposal_check
    CHECK (disposal_method IN ('burial', 'incineration', 'composting', 'rendering', 'other')),
  CONSTRAINT poultry_mortality_follow_up_check
    CHECK (follow_up_status IN ('not_required', 'pending', 'in_progress', 'resolved')),
  CONSTRAINT poultry_mortality_follow_up_required_check
    CHECK (requires_follow_up = (follow_up_status <> 'not_required')),
  CONSTRAINT poultry_mortality_text_not_blank CHECK (
    (suspected_cause IS NULL OR btrim(suspected_cause) <> '') AND
    (confirmed_diagnosis IS NULL OR btrim(confirmed_diagnosis) <> '') AND
    (clinical_signs IS NULL OR btrim(clinical_signs) <> '') AND
    (veterinarian_name IS NULL OR btrim(veterinarian_name) <> '') AND
    (follow_up_notes IS NULL OR btrim(follow_up_notes) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);

CREATE TRIGGER poultry_mortality_records_set_updated_at
  BEFORE UPDATE ON poultry_mortality_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX poultry_mortality_flock_date_idx ON poultry_mortality_records (organization_id, flock_id, mortality_date DESC);
CREATE INDEX poultry_mortality_follow_up_idx ON poultry_mortality_records (organization_id, follow_up_status) WHERE follow_up_status IN ('pending', 'in_progress');
SELECT enable_tenant_rls('poultry_mortality_records');

CREATE TABLE poultry_feed_records (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flock_id            uuid NOT NULL,
  feed_date           date NOT NULL,
  feed_name           text NOT NULL,
  feed_stage          text NOT NULL DEFAULT 'other',
  quantity_kg         numeric(12,3) NOT NULL,
  bag_count           numeric(12,3),
  batch_number        text,
  notes               text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_feed_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_feed_flock_fk FOREIGN KEY (organization_id, flock_id)
    REFERENCES poultry_flocks (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT poultry_feed_name_not_blank CHECK (btrim(feed_name) <> ''),
  CONSTRAINT poultry_feed_stage_check CHECK (feed_stage IN ('starter', 'grower', 'finisher', 'layer', 'breeder', 'medicated', 'other')),
  CONSTRAINT poultry_feed_quantity_check CHECK (quantity_kg > 0 AND (bag_count IS NULL OR bag_count >= 0)),
  CONSTRAINT poultry_feed_text_not_blank CHECK ((batch_number IS NULL OR btrim(batch_number) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);

CREATE TRIGGER poultry_feed_records_set_updated_at BEFORE UPDATE ON poultry_feed_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX poultry_feed_flock_date_idx ON poultry_feed_records (organization_id, flock_id, feed_date DESC);
SELECT enable_tenant_rls('poultry_feed_records');

CREATE TABLE poultry_water_records (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flock_id            uuid NOT NULL,
  water_date          date NOT NULL,
  volume_liters       numeric(12,3) NOT NULL,
  source_name         text,
  notes               text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_water_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_water_flock_fk FOREIGN KEY (organization_id, flock_id)
    REFERENCES poultry_flocks (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT poultry_water_volume_check CHECK (volume_liters > 0),
  CONSTRAINT poultry_water_text_not_blank CHECK ((source_name IS NULL OR btrim(source_name) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);

CREATE TRIGGER poultry_water_records_set_updated_at BEFORE UPDATE ON poultry_water_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX poultry_water_flock_date_idx ON poultry_water_records (organization_id, flock_id, water_date DESC);
SELECT enable_tenant_rls('poultry_water_records');

CREATE TABLE poultry_weight_records (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flock_id            uuid NOT NULL,
  record_date         date NOT NULL,
  sample_size         integer NOT NULL,
  average_weight_g    numeric(12,2) NOT NULL,
  minimum_weight_g    numeric(12,2),
  maximum_weight_g    numeric(12,2),
  uniformity_percent  numeric(5,2),
  notes               text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_weights_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_weights_flock_fk FOREIGN KEY (organization_id, flock_id)
    REFERENCES poultry_flocks (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT poultry_weights_values_check CHECK (
    sample_size > 0 AND average_weight_g > 0 AND
    (minimum_weight_g IS NULL OR minimum_weight_g > 0) AND
    (maximum_weight_g IS NULL OR maximum_weight_g >= average_weight_g) AND
    (minimum_weight_g IS NULL OR minimum_weight_g <= average_weight_g) AND
    (uniformity_percent IS NULL OR uniformity_percent BETWEEN 0 AND 100)
  ),
  CONSTRAINT poultry_weights_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE TRIGGER poultry_weight_records_set_updated_at BEFORE UPDATE ON poultry_weight_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX poultry_weights_flock_date_idx ON poultry_weight_records (organization_id, flock_id, record_date DESC);
SELECT enable_tenant_rls('poultry_weight_records');

CREATE TABLE poultry_egg_records (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flock_id            uuid NOT NULL,
  record_date         date NOT NULL,
  total_eggs          integer NOT NULL,
  cracked_eggs        integer NOT NULL DEFAULT 0,
  dirty_eggs          integer NOT NULL DEFAULT 0,
  hatching_eggs       integer NOT NULL DEFAULT 0,
  notes               text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_eggs_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_eggs_flock_fk FOREIGN KEY (organization_id, flock_id)
    REFERENCES poultry_flocks (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT poultry_eggs_counts_check CHECK (
    total_eggs >= 0 AND cracked_eggs >= 0 AND dirty_eggs >= 0 AND hatching_eggs >= 0 AND
    cracked_eggs + dirty_eggs + hatching_eggs <= total_eggs
  ),
  CONSTRAINT poultry_eggs_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE TRIGGER poultry_egg_records_set_updated_at BEFORE UPDATE ON poultry_egg_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX poultry_eggs_flock_date_idx ON poultry_egg_records (organization_id, flock_id, record_date DESC);
SELECT enable_tenant_rls('poultry_egg_records');

CREATE TABLE poultry_health_records (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flock_id            uuid NOT NULL,
  record_date         date NOT NULL,
  event_type          text NOT NULL,
  severity            text NOT NULL DEFAULT 'low',
  birds_affected      integer NOT NULL DEFAULT 0,
  symptoms            text,
  diagnosis           text,
  action_taken        text,
  veterinarian_name   text,
  status              text NOT NULL DEFAULT 'open',
  notes               text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_health_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_health_flock_fk FOREIGN KEY (organization_id, flock_id)
    REFERENCES poultry_flocks (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT poultry_health_type_check CHECK (event_type IN ('observation', 'suspected_disease', 'confirmed_disease', 'outbreak', 'injury', 'other')),
  CONSTRAINT poultry_health_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT poultry_health_status_check CHECK (status IN ('open', 'monitoring', 'resolved')),
  CONSTRAINT poultry_health_birds_affected_check CHECK (birds_affected >= 0),
  CONSTRAINT poultry_health_text_not_blank CHECK (
    (symptoms IS NULL OR btrim(symptoms) <> '') AND (diagnosis IS NULL OR btrim(diagnosis) <> '') AND
    (action_taken IS NULL OR btrim(action_taken) <> '') AND (veterinarian_name IS NULL OR btrim(veterinarian_name) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);

CREATE TRIGGER poultry_health_records_set_updated_at BEFORE UPDATE ON poultry_health_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX poultry_health_flock_date_idx ON poultry_health_records (organization_id, flock_id, record_date DESC);
CREATE INDEX poultry_health_open_idx ON poultry_health_records (organization_id, status) WHERE status IN ('open', 'monitoring');
SELECT enable_tenant_rls('poultry_health_records');

CREATE TABLE poultry_vaccination_records (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flock_id            uuid NOT NULL,
  vaccination_date    date NOT NULL,
  vaccine_name        text NOT NULL,
  manufacturer        text,
  batch_number        text,
  dose                text,
  administration_route text,
  next_due_date       date,
  administered_by     text,
  notes               text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_vaccinations_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_vaccinations_flock_fk FOREIGN KEY (organization_id, flock_id)
    REFERENCES poultry_flocks (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT poultry_vaccinations_name_not_blank CHECK (btrim(vaccine_name) <> ''),
  CONSTRAINT poultry_vaccinations_next_due_check CHECK (next_due_date IS NULL OR next_due_date >= vaccination_date),
  CONSTRAINT poultry_vaccinations_text_not_blank CHECK (
    (manufacturer IS NULL OR btrim(manufacturer) <> '') AND (batch_number IS NULL OR btrim(batch_number) <> '') AND
    (dose IS NULL OR btrim(dose) <> '') AND (administration_route IS NULL OR btrim(administration_route) <> '') AND
    (administered_by IS NULL OR btrim(administered_by) <> '') AND (notes IS NULL OR btrim(notes) <> '')
  )
);

CREATE TRIGGER poultry_vaccination_records_set_updated_at BEFORE UPDATE ON poultry_vaccination_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX poultry_vaccinations_flock_date_idx ON poultry_vaccination_records (organization_id, flock_id, vaccination_date DESC);
SELECT enable_tenant_rls('poultry_vaccination_records');

CREATE TABLE poultry_treatment_records (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flock_id            uuid NOT NULL,
  treatment_date      date NOT NULL,
  product_name        text NOT NULL,
  reason              text NOT NULL,
  dosage              text,
  administration_route text,
  end_date            date,
  withdrawal_end_date date,
  prescribed_by       text,
  notes               text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_treatments_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_treatments_flock_fk FOREIGN KEY (organization_id, flock_id)
    REFERENCES poultry_flocks (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT poultry_treatments_product_not_blank CHECK (btrim(product_name) <> ''),
  CONSTRAINT poultry_treatments_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT poultry_treatments_dates_check CHECK (
    (end_date IS NULL OR end_date >= treatment_date) AND
    (withdrawal_end_date IS NULL OR withdrawal_end_date >= treatment_date)
  ),
  CONSTRAINT poultry_treatments_text_not_blank CHECK (
    (dosage IS NULL OR btrim(dosage) <> '') AND (administration_route IS NULL OR btrim(administration_route) <> '') AND
    (prescribed_by IS NULL OR btrim(prescribed_by) <> '') AND (notes IS NULL OR btrim(notes) <> '')
  )
);

CREATE TRIGGER poultry_treatment_records_set_updated_at BEFORE UPDATE ON poultry_treatment_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX poultry_treatments_flock_date_idx ON poultry_treatment_records (organization_id, flock_id, treatment_date DESC);
SELECT enable_tenant_rls('poultry_treatment_records');

CREATE TABLE poultry_sanitation_records (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  house_id            uuid NOT NULL,
  sanitation_date     date NOT NULL,
  activity_type       text NOT NULL,
  product_name        text,
  status              text NOT NULL DEFAULT 'completed',
  performed_by        text,
  notes               text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_sanitation_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_sanitation_house_fk FOREIGN KEY (organization_id, house_id)
    REFERENCES poultry_houses (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT poultry_sanitation_type_check CHECK (activity_type IN ('cleaning', 'disinfection', 'litter_change', 'downtime', 'waste_removal', 'other')),
  CONSTRAINT poultry_sanitation_status_check CHECK (status IN ('completed', 'partial', 'failed')),
  CONSTRAINT poultry_sanitation_text_not_blank CHECK (
    (product_name IS NULL OR btrim(product_name) <> '') AND (performed_by IS NULL OR btrim(performed_by) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);

CREATE TRIGGER poultry_sanitation_records_set_updated_at BEFORE UPDATE ON poultry_sanitation_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX poultry_sanitation_house_date_idx ON poultry_sanitation_records (organization_id, house_id, sanitation_date DESC);
SELECT enable_tenant_rls('poultry_sanitation_records');

CREATE TABLE poultry_biosecurity_records (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  house_id            uuid NOT NULL,
  record_date         date NOT NULL,
  check_type          text NOT NULL,
  compliance_status   text NOT NULL,
  risk_level          text NOT NULL DEFAULT 'low',
  action_taken        text,
  notes               text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_biosecurity_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_biosecurity_house_fk FOREIGN KEY (organization_id, house_id)
    REFERENCES poultry_houses (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT poultry_biosecurity_type_check CHECK (check_type IN ('access_control', 'visitor', 'vehicle', 'footbath', 'ppe', 'pest_control', 'quarantine', 'other')),
  CONSTRAINT poultry_biosecurity_compliance_check CHECK (compliance_status IN ('compliant', 'non_compliant', 'not_checked')),
  CONSTRAINT poultry_biosecurity_risk_check CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT poultry_biosecurity_text_not_blank CHECK ((action_taken IS NULL OR btrim(action_taken) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);

CREATE TRIGGER poultry_biosecurity_records_set_updated_at BEFORE UPDATE ON poultry_biosecurity_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX poultry_biosecurity_house_date_idx ON poultry_biosecurity_records (organization_id, house_id, record_date DESC);
SELECT enable_tenant_rls('poultry_biosecurity_records');

CREATE TABLE poultry_production_targets (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flock_id            uuid NOT NULL,
  metric              text NOT NULL,
  target_value        numeric(14,3) NOT NULL,
  effective_from      date NOT NULL,
  effective_to        date,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_targets_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_targets_flock_fk FOREIGN KEY (organization_id, flock_id)
    REFERENCES poultry_flocks (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT poultry_targets_metric_check CHECK (metric IN ('mortality_percent', 'feed_kg_per_bird', 'water_liters_per_bird', 'average_weight_g', 'egg_count', 'egg_lay_percent')),
  CONSTRAINT poultry_targets_value_check CHECK (target_value >= 0),
  CONSTRAINT poultry_targets_dates_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT poultry_targets_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE TRIGGER poultry_production_targets_set_updated_at BEFORE UPDATE ON poultry_production_targets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX poultry_targets_flock_dates_idx ON poultry_production_targets (organization_id, flock_id, effective_from DESC);
SELECT enable_tenant_rls('poultry_production_targets');

CREATE TABLE poultry_loss_records (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flock_id            uuid NOT NULL,
  loss_date           date NOT NULL,
  loss_type           text NOT NULL,
  quantity            numeric(14,3) NOT NULL,
  unit                text NOT NULL DEFAULT 'count',
  description         text NOT NULL,
  notes               text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_losses_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_losses_flock_fk FOREIGN KEY (organization_id, flock_id)
    REFERENCES poultry_flocks (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT poultry_losses_type_check CHECK (loss_type IN ('bird_missing', 'predation', 'egg_breakage', 'feed_spoilage', 'equipment_damage', 'other')),
  CONSTRAINT poultry_losses_quantity_check CHECK (quantity > 0),
  CONSTRAINT poultry_losses_unit_not_blank CHECK (btrim(unit) <> ''),
  CONSTRAINT poultry_losses_description_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT poultry_losses_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE TRIGGER poultry_loss_records_set_updated_at BEFORE UPDATE ON poultry_loss_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX poultry_losses_flock_date_idx ON poultry_loss_records (organization_id, flock_id, loss_date DESC);
SELECT enable_tenant_rls('poultry_loss_records');

COMMENT ON TABLE poultry_mortality_records IS
  'Source-of-truth events for poultry deaths. Daily records report totals from this table; they do not duplicate mortality input.';
COMMENT ON COLUMN poultry_flocks.mortality_review_threshold IS
  'Daily death count at which the flock must be reviewed. Default 1 means every death is visible for review.';
