-- 018_pig_operations.sql
-- Complete Congo Omega pig production records. Every table is organization
-- owned, connected to a site through a pen, and protected by tenant RLS.

CREATE TABLE pig_pens (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  site_id         uuid NOT NULL,
  code            text NOT NULL,
  name            text NOT NULL,
  pen_type        text NOT NULL DEFAULT 'other',
  capacity        integer NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT pig_pens_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_pens_code_unique UNIQUE (organization_id, code),
  CONSTRAINT pig_pens_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_pens_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT pig_pens_type_check CHECK (pen_type IN ('gestation', 'farrowing', 'nursery', 'weaner', 'grower', 'finisher', 'boar', 'gilt', 'quarantine', 'hospital', 'holding', 'other')),
  CONSTRAINT pig_pens_capacity_check CHECK (capacity > 0),
  CONSTRAINT pig_pens_text_not_blank CHECK ((btrim(name) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER pig_pens_set_updated_at BEFORE UPDATE ON pig_pens FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_pens_site_idx ON pig_pens (organization_id, site_id) WHERE is_active;
SELECT enable_tenant_rls('pig_pens');

CREATE TABLE pig_groups (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pen_id           uuid NOT NULL,
  code             text NOT NULL,
  name             text NOT NULL,
  production_stage text NOT NULL DEFAULT 'other',
  breed            text,
  sex              text NOT NULL DEFAULT 'mixed',
  arrival_date     date,
  initial_count    integer NOT NULL,
  status           text NOT NULL DEFAULT 'active',
  closed_at        date,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT pig_groups_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_groups_code_unique UNIQUE (organization_id, code),
  CONSTRAINT pig_groups_pen_fk FOREIGN KEY (organization_id, pen_id)
    REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_groups_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT pig_groups_stage_check CHECK (production_stage IN ('suckling', 'weaner', 'grower', 'finisher', 'breeding', 'replacement', 'quarantine', 'other')),
  CONSTRAINT pig_groups_sex_check CHECK (sex IN ('mixed', 'female', 'male', 'unknown')),
  CONSTRAINT pig_groups_status_check CHECK (status IN ('active', 'closed', 'sold', 'transferred', 'depleted')),
  CONSTRAINT pig_groups_count_check CHECK (initial_count > 0),
  CONSTRAINT pig_groups_dates_check CHECK (closed_at IS NULL OR arrival_date IS NULL OR closed_at >= arrival_date),
  CONSTRAINT pig_groups_text_not_blank CHECK ((btrim(name) <> '') AND (breed IS NULL OR btrim(breed) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER pig_groups_set_updated_at BEFORE UPDATE ON pig_groups FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_groups_pen_idx ON pig_groups (organization_id, pen_id, status);
SELECT enable_tenant_rls('pig_groups');

CREATE TABLE pig_animals (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pen_id            uuid NOT NULL,
  group_id          uuid,
  animal_number     text NOT NULL,
  name              text,
  ear_tag           text,
  sex               text NOT NULL,
  animal_type       text NOT NULL DEFAULT 'other',
  breed             text,
  birth_date        date,
  arrival_date      date,
  source_name       text,
  status            text NOT NULL DEFAULT 'active',
  removed_at        date,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT pig_animals_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_animals_number_unique UNIQUE (organization_id, animal_number),
  CONSTRAINT pig_animals_ear_tag_unique UNIQUE NULLS NOT DISTINCT (organization_id, ear_tag),
  CONSTRAINT pig_animals_pen_fk FOREIGN KEY (organization_id, pen_id)
    REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_animals_group_fk FOREIGN KEY (organization_id, group_id)
    REFERENCES pig_groups (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_animals_sex_check CHECK (sex IN ('female', 'male', 'unknown')),
  CONSTRAINT pig_animals_type_check CHECK (animal_type IN ('sow', 'boar', 'gilt', 'barrow', 'piglet', 'grower', 'finisher', 'other')),
  CONSTRAINT pig_animals_status_check CHECK (status IN ('active', 'pregnant', 'lactating', 'quarantined', 'sold', 'deceased', 'culled', 'transferred')),
  CONSTRAINT pig_animals_dates_check CHECK ((arrival_date IS NULL OR birth_date IS NULL OR arrival_date >= birth_date) AND (removed_at IS NULL OR birth_date IS NULL OR removed_at >= birth_date)),
  CONSTRAINT pig_animals_text_not_blank CHECK ((btrim(animal_number) <> '') AND (name IS NULL OR btrim(name) <> '') AND (ear_tag IS NULL OR btrim(ear_tag) <> '') AND (breed IS NULL OR btrim(breed) <> '') AND (source_name IS NULL OR btrim(source_name) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER pig_animals_set_updated_at BEFORE UPDATE ON pig_animals FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_animals_pen_idx ON pig_animals (organization_id, pen_id, status);
CREATE INDEX pig_animals_group_idx ON pig_animals (organization_id, group_id) WHERE group_id IS NOT NULL;
SELECT enable_tenant_rls('pig_animals');

CREATE TABLE pig_daily_records (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pen_id             uuid NOT NULL,
  group_id           uuid,
  animal_id          uuid,
  record_date        date NOT NULL,
  opening_count      integer,
  births_count       integer NOT NULL DEFAULT 0,
  purchases_count    integer NOT NULL DEFAULT 0,
  transfers_in_count integer NOT NULL DEFAULT 0,
  transfers_out_count integer NOT NULL DEFAULT 0,
  culls_count        integer NOT NULL DEFAULT 0,
  mortality_count    integer NOT NULL DEFAULT 0,
  closing_count      integer,
  notes              text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT pig_daily_records_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_daily_records_unique UNIQUE NULLS NOT DISTINCT (organization_id, pen_id, group_id, animal_id, record_date),
  CONSTRAINT pig_daily_records_pen_fk FOREIGN KEY (organization_id, pen_id) REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_daily_records_group_fk FOREIGN KEY (organization_id, group_id) REFERENCES pig_groups (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_daily_records_animal_fk FOREIGN KEY (organization_id, animal_id) REFERENCES pig_animals (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_daily_records_count_check CHECK (COALESCE(opening_count, 0) >= 0 AND births_count >= 0 AND purchases_count >= 0 AND transfers_in_count >= 0 AND transfers_out_count >= 0 AND culls_count >= 0 AND mortality_count >= 0 AND COALESCE(closing_count, 0) >= 0),
  CONSTRAINT pig_daily_records_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);
CREATE TRIGGER pig_daily_records_set_updated_at BEFORE UPDATE ON pig_daily_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_daily_records_pen_date_idx ON pig_daily_records (organization_id, pen_id, record_date DESC);
SELECT enable_tenant_rls('pig_daily_records');

CREATE TABLE pig_feed_records (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pen_id             uuid NOT NULL,
  group_id           uuid,
  feed_date          date NOT NULL,
  feed_name          text NOT NULL,
  feed_stage         text NOT NULL DEFAULT 'other',
  quantity_kg        numeric(14,3) NOT NULL,
  bag_count          numeric(14,3),
  batch_number       text,
  notes              text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT pig_feed_records_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_feed_records_pen_fk FOREIGN KEY (organization_id, pen_id) REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_feed_records_group_fk FOREIGN KEY (organization_id, group_id) REFERENCES pig_groups (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_feed_records_stage_check CHECK (feed_stage IN ('creep', 'starter', 'weaner', 'grower', 'finisher', 'gestation', 'lactation', 'boar', 'medicated', 'other')),
  CONSTRAINT pig_feed_records_values_check CHECK (quantity_kg > 0 AND (bag_count IS NULL OR bag_count >= 0)),
  CONSTRAINT pig_feed_records_text_not_blank CHECK ((btrim(feed_name) <> '') AND (batch_number IS NULL OR btrim(batch_number) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER pig_feed_records_set_updated_at BEFORE UPDATE ON pig_feed_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_feed_records_pen_date_idx ON pig_feed_records (organization_id, pen_id, feed_date DESC);
SELECT enable_tenant_rls('pig_feed_records');

CREATE TABLE pig_water_records (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pen_id             uuid NOT NULL,
  group_id           uuid,
  water_date         date NOT NULL,
  volume_liters      numeric(14,3) NOT NULL,
  source_name        text,
  notes              text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT pig_water_records_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_water_records_pen_fk FOREIGN KEY (organization_id, pen_id) REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_water_records_group_fk FOREIGN KEY (organization_id, group_id) REFERENCES pig_groups (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_water_records_volume_check CHECK (volume_liters > 0),
  CONSTRAINT pig_water_records_text_not_blank CHECK ((source_name IS NULL OR btrim(source_name) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER pig_water_records_set_updated_at BEFORE UPDATE ON pig_water_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_water_records_pen_date_idx ON pig_water_records (organization_id, pen_id, water_date DESC);
SELECT enable_tenant_rls('pig_water_records');

CREATE TABLE pig_weight_records (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pen_id             uuid NOT NULL,
  group_id           uuid,
  animal_id          uuid,
  record_date        date NOT NULL,
  sample_size        integer NOT NULL DEFAULT 1,
  average_weight_kg  numeric(12,3) NOT NULL,
  minimum_weight_kg  numeric(12,3),
  maximum_weight_kg  numeric(12,3),
  body_condition_score numeric(5,2),
  notes              text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT pig_weight_records_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_weight_records_pen_fk FOREIGN KEY (organization_id, pen_id) REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_weight_records_group_fk FOREIGN KEY (organization_id, group_id) REFERENCES pig_groups (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_weight_records_animal_fk FOREIGN KEY (organization_id, animal_id) REFERENCES pig_animals (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_weight_records_values_check CHECK (sample_size > 0 AND average_weight_kg > 0 AND (minimum_weight_kg IS NULL OR minimum_weight_kg > 0) AND (maximum_weight_kg IS NULL OR maximum_weight_kg > 0) AND (minimum_weight_kg IS NULL OR maximum_weight_kg IS NULL OR maximum_weight_kg >= minimum_weight_kg) AND (body_condition_score IS NULL OR body_condition_score BETWEEN 1 AND 5)),
  CONSTRAINT pig_weight_records_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);
CREATE TRIGGER pig_weight_records_set_updated_at BEFORE UPDATE ON pig_weight_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_weight_records_pen_date_idx ON pig_weight_records (organization_id, pen_id, record_date DESC);
CREATE INDEX pig_weight_records_animal_date_idx ON pig_weight_records (organization_id, animal_id, record_date DESC) WHERE animal_id IS NOT NULL;
SELECT enable_tenant_rls('pig_weight_records');

CREATE TABLE pig_movements (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  movement_date      date NOT NULL,
  animal_id          uuid,
  group_id           uuid,
  from_pen_id        uuid NOT NULL,
  to_pen_id          uuid NOT NULL,
  movement_type      text NOT NULL DEFAULT 'internal',
  head_count         integer NOT NULL DEFAULT 1,
  reason             text,
  reference_number   text,
  notes              text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT pig_movements_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_movements_animal_fk FOREIGN KEY (organization_id, animal_id) REFERENCES pig_animals (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_movements_group_fk FOREIGN KEY (organization_id, group_id) REFERENCES pig_groups (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_movements_from_pen_fk FOREIGN KEY (organization_id, from_pen_id) REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_movements_to_pen_fk FOREIGN KEY (organization_id, to_pen_id) REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_movements_subject_check CHECK ((animal_id IS NOT NULL)::integer + (group_id IS NOT NULL)::integer = 1),
  CONSTRAINT pig_movements_pen_check CHECK (from_pen_id <> to_pen_id),
  CONSTRAINT pig_movements_type_check CHECK (movement_type IN ('internal', 'purchase', 'sale', 'transfer', 'quarantine', 'hospital', 'return', 'other')),
  CONSTRAINT pig_movements_count_check CHECK (head_count > 0),
  CONSTRAINT pig_movements_text_not_blank CHECK ((reason IS NULL OR btrim(reason) <> '') AND (reference_number IS NULL OR btrim(reference_number) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER pig_movements_set_updated_at BEFORE UPDATE ON pig_movements FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_movements_from_pen_date_idx ON pig_movements (organization_id, from_pen_id, movement_date DESC);
CREATE INDEX pig_movements_to_pen_date_idx ON pig_movements (organization_id, to_pen_id, movement_date DESC);
SELECT enable_tenant_rls('pig_movements');

CREATE TABLE pig_mortality_records (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pen_id             uuid NOT NULL,
  group_id           uuid,
  animal_id          uuid,
  mortality_date     date NOT NULL,
  death_count        integer NOT NULL DEFAULT 1,
  cause_category     text NOT NULL DEFAULT 'unknown',
  suspected_cause    text,
  confirmed_diagnosis text,
  clinical_signs     text,
  postmortem_status  text NOT NULL DEFAULT 'not_done',
  disposal_method    text NOT NULL DEFAULT 'other',
  veterinarian_name  text,
  requires_follow_up boolean NOT NULL DEFAULT false,
  follow_up_status   text NOT NULL DEFAULT 'not_required',
  follow_up_notes    text,
  notes              text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT pig_mortality_records_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_mortality_records_pen_fk FOREIGN KEY (organization_id, pen_id) REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_mortality_records_group_fk FOREIGN KEY (organization_id, group_id) REFERENCES pig_groups (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_mortality_records_animal_fk FOREIGN KEY (organization_id, animal_id) REFERENCES pig_animals (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_mortality_records_subject_check CHECK (animal_id IS NULL OR death_count = 1),
  CONSTRAINT pig_mortality_records_count_check CHECK (death_count > 0),
  CONSTRAINT pig_mortality_records_cause_check CHECK (cause_category IN ('unknown', 'disease', 'injury', 'crushing', 'starvation', 'heat_stress', 'respiratory', 'digestive', 'reproductive', 'management', 'other')),
  CONSTRAINT pig_mortality_records_postmortem_check CHECK (postmortem_status IN ('not_done', 'pending', 'done')),
  CONSTRAINT pig_mortality_records_disposal_check CHECK (disposal_method IN ('burial', 'incineration', 'composting', 'rendering', 'other')),
  CONSTRAINT pig_mortality_records_follow_up_check CHECK (follow_up_status IN ('not_required', 'pending', 'in_progress', 'resolved')),
  CONSTRAINT pig_mortality_records_text_not_blank CHECK ((suspected_cause IS NULL OR btrim(suspected_cause) <> '') AND (confirmed_diagnosis IS NULL OR btrim(confirmed_diagnosis) <> '') AND (clinical_signs IS NULL OR btrim(clinical_signs) <> '') AND (veterinarian_name IS NULL OR btrim(veterinarian_name) <> '') AND (follow_up_notes IS NULL OR btrim(follow_up_notes) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER pig_mortality_records_set_updated_at BEFORE UPDATE ON pig_mortality_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_mortality_records_pen_date_idx ON pig_mortality_records (organization_id, pen_id, mortality_date DESC);
SELECT enable_tenant_rls('pig_mortality_records');

CREATE TABLE pig_loss_records (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pen_id             uuid NOT NULL,
  loss_date          date NOT NULL,
  loss_type          text NOT NULL,
  quantity           numeric(14,3) NOT NULL,
  unit               text NOT NULL DEFAULT 'count',
  description        text NOT NULL,
  notes              text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT pig_loss_records_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_loss_records_pen_fk FOREIGN KEY (organization_id, pen_id) REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_loss_records_type_check CHECK (loss_type IN ('pig_missing', 'feed_spoilage', 'equipment_damage', 'theft', 'medication_waste', 'other')),
  CONSTRAINT pig_loss_records_quantity_check CHECK (quantity > 0),
  CONSTRAINT pig_loss_records_text_not_blank CHECK ((btrim(unit) <> '') AND (btrim(description) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER pig_loss_records_set_updated_at BEFORE UPDATE ON pig_loss_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_loss_records_pen_date_idx ON pig_loss_records (organization_id, pen_id, loss_date DESC);
SELECT enable_tenant_rls('pig_loss_records');

CREATE TABLE pig_breeding_records (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pen_id             uuid NOT NULL,
  female_animal_id   uuid NOT NULL,
  male_animal_id     uuid,
  breeding_date      date NOT NULL,
  breeding_method    text NOT NULL DEFAULT 'natural',
  status             text NOT NULL DEFAULT 'completed',
  expected_farrowing_date date,
  notes              text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT pig_breeding_records_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_breeding_records_pen_fk FOREIGN KEY (organization_id, pen_id) REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_breeding_records_female_fk FOREIGN KEY (organization_id, female_animal_id) REFERENCES pig_animals (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_breeding_records_male_fk FOREIGN KEY (organization_id, male_animal_id) REFERENCES pig_animals (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_breeding_records_method_check CHECK (breeding_method IN ('natural', 'artificial_insemination', 'embryo_transfer', 'other')),
  CONSTRAINT pig_breeding_records_status_check CHECK (status IN ('planned', 'completed', 'failed', 'cancelled')),
  CONSTRAINT pig_breeding_records_dates_check CHECK (expected_farrowing_date IS NULL OR expected_farrowing_date >= breeding_date),
  CONSTRAINT pig_breeding_records_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);
CREATE TRIGGER pig_breeding_records_set_updated_at BEFORE UPDATE ON pig_breeding_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_breeding_records_sow_date_idx ON pig_breeding_records (organization_id, female_animal_id, breeding_date DESC);
SELECT enable_tenant_rls('pig_breeding_records');

CREATE TABLE pig_pregnancies (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pen_id             uuid NOT NULL,
  sow_animal_id      uuid NOT NULL,
  breeding_id        uuid,
  confirmed_date     date NOT NULL,
  confirmation_method text NOT NULL DEFAULT 'observation',
  expected_farrowing_date date,
  status             text NOT NULL DEFAULT 'confirmed',
  notes              text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT pig_pregnancies_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_pregnancies_pen_fk FOREIGN KEY (organization_id, pen_id) REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_pregnancies_sow_fk FOREIGN KEY (organization_id, sow_animal_id) REFERENCES pig_animals (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_pregnancies_breeding_fk FOREIGN KEY (organization_id, breeding_id) REFERENCES pig_breeding_records (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_pregnancies_method_check CHECK (confirmation_method IN ('observation', 'ultrasound', 'blood_test', 'other')),
  CONSTRAINT pig_pregnancies_status_check CHECK (status IN ('suspected', 'confirmed', 'aborted', 'farrowed', 'lost', 'closed')),
  CONSTRAINT pig_pregnancies_dates_check CHECK (expected_farrowing_date IS NULL OR expected_farrowing_date >= confirmed_date),
  CONSTRAINT pig_pregnancies_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);
CREATE TRIGGER pig_pregnancies_set_updated_at BEFORE UPDATE ON pig_pregnancies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_pregnancies_sow_status_idx ON pig_pregnancies (organization_id, sow_animal_id, status);
SELECT enable_tenant_rls('pig_pregnancies');

CREATE TABLE pig_farrowing_records (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pen_id             uuid NOT NULL,
  sow_animal_id      uuid NOT NULL,
  pregnancy_id       uuid,
  farrowing_date     date NOT NULL,
  total_born_count   integer NOT NULL,
  live_born_count    integer NOT NULL,
  stillborn_count    integer NOT NULL DEFAULT 0,
  mummified_count    integer NOT NULL DEFAULT 0,
  fostered_in_count  integer NOT NULL DEFAULT 0,
  fostered_out_count integer NOT NULL DEFAULT 0,
  assistance_required boolean NOT NULL DEFAULT false,
  notes              text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT pig_farrowing_records_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_farrowing_records_pen_fk FOREIGN KEY (organization_id, pen_id) REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_farrowing_records_sow_fk FOREIGN KEY (organization_id, sow_animal_id) REFERENCES pig_animals (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_farrowing_records_pregnancy_fk FOREIGN KEY (organization_id, pregnancy_id) REFERENCES pig_pregnancies (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_farrowing_records_counts_check CHECK (total_born_count >= 0 AND live_born_count >= 0 AND stillborn_count >= 0 AND mummified_count >= 0 AND fostered_in_count >= 0 AND fostered_out_count >= 0 AND live_born_count + stillborn_count + mummified_count <= total_born_count),
  CONSTRAINT pig_farrowing_records_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);
CREATE TRIGGER pig_farrowing_records_set_updated_at BEFORE UPDATE ON pig_farrowing_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_farrowing_records_sow_date_idx ON pig_farrowing_records (organization_id, sow_animal_id, farrowing_date DESC);
SELECT enable_tenant_rls('pig_farrowing_records');

CREATE TABLE pig_piglets (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pen_id             uuid NOT NULL,
  group_id           uuid,
  farrowing_id       uuid,
  record_date        date NOT NULL,
  piglet_count       integer NOT NULL,
  female_count       integer NOT NULL DEFAULT 0,
  male_count         integer NOT NULL DEFAULT 0,
  unknown_sex_count  integer NOT NULL DEFAULT 0,
  average_birth_weight_kg numeric(12,3),
  status             text NOT NULL DEFAULT 'active',
  notes              text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT pig_piglets_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_piglets_pen_fk FOREIGN KEY (organization_id, pen_id) REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_piglets_group_fk FOREIGN KEY (organization_id, group_id) REFERENCES pig_groups (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_piglets_farrowing_fk FOREIGN KEY (organization_id, farrowing_id) REFERENCES pig_farrowing_records (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_piglets_status_check CHECK (status IN ('active', 'weaned', 'sold', 'deceased', 'transferred')),
  CONSTRAINT pig_piglets_counts_check CHECK (piglet_count > 0 AND female_count >= 0 AND male_count >= 0 AND unknown_sex_count >= 0 AND female_count + male_count + unknown_sex_count = piglet_count AND (average_birth_weight_kg IS NULL OR average_birth_weight_kg > 0)),
  CONSTRAINT pig_piglets_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);
CREATE TRIGGER pig_piglets_set_updated_at BEFORE UPDATE ON pig_piglets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_piglets_pen_date_idx ON pig_piglets (organization_id, pen_id, record_date DESC);
SELECT enable_tenant_rls('pig_piglets');

CREATE TABLE pig_health_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pen_id uuid NOT NULL, group_id uuid, animal_id uuid, record_date date NOT NULL,
  event_type text NOT NULL, severity text NOT NULL DEFAULT 'low', animals_affected integer NOT NULL DEFAULT 0,
  symptoms text, diagnosis text, action_taken text, veterinarian_name text, status text NOT NULL DEFAULT 'open', notes text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id), CONSTRAINT pig_health_records_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_health_records_pen_fk FOREIGN KEY (organization_id, pen_id) REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_health_records_group_fk FOREIGN KEY (organization_id, group_id) REFERENCES pig_groups (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_health_records_animal_fk FOREIGN KEY (organization_id, animal_id) REFERENCES pig_animals (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_health_records_type_check CHECK (event_type IN ('observation', 'suspected_disease', 'confirmed_disease', 'outbreak', 'injury', 'lameness', 'reproductive', 'other')),
  CONSTRAINT pig_health_records_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT pig_health_records_status_check CHECK (status IN ('open', 'monitoring', 'resolved')),
  CONSTRAINT pig_health_records_count_check CHECK (animals_affected >= 0),
  CONSTRAINT pig_health_records_text_not_blank CHECK ((symptoms IS NULL OR btrim(symptoms) <> '') AND (diagnosis IS NULL OR btrim(diagnosis) <> '') AND (action_taken IS NULL OR btrim(action_taken) <> '') AND (veterinarian_name IS NULL OR btrim(veterinarian_name) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER pig_health_records_set_updated_at BEFORE UPDATE ON pig_health_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_health_records_pen_date_idx ON pig_health_records (organization_id, pen_id, record_date DESC);
SELECT enable_tenant_rls('pig_health_records');

CREATE TABLE pig_vaccination_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pen_id uuid NOT NULL, group_id uuid, animal_id uuid, vaccination_date date NOT NULL,
  vaccine_name text NOT NULL, manufacturer text, batch_number text, dose text, administration_route text, next_due_date date, administered_by text, notes text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id), CONSTRAINT pig_vaccination_records_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_vaccination_records_pen_fk FOREIGN KEY (organization_id, pen_id) REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_vaccination_records_group_fk FOREIGN KEY (organization_id, group_id) REFERENCES pig_groups (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_vaccination_records_animal_fk FOREIGN KEY (organization_id, animal_id) REFERENCES pig_animals (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_vaccination_records_dates_check CHECK (next_due_date IS NULL OR next_due_date >= vaccination_date),
  CONSTRAINT pig_vaccination_records_text_not_blank CHECK ((btrim(vaccine_name) <> '') AND (manufacturer IS NULL OR btrim(manufacturer) <> '') AND (batch_number IS NULL OR btrim(batch_number) <> '') AND (dose IS NULL OR btrim(dose) <> '') AND (administration_route IS NULL OR btrim(administration_route) <> '') AND (administered_by IS NULL OR btrim(administered_by) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER pig_vaccination_records_set_updated_at BEFORE UPDATE ON pig_vaccination_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_vaccination_records_pen_date_idx ON pig_vaccination_records (organization_id, pen_id, vaccination_date DESC);
SELECT enable_tenant_rls('pig_vaccination_records');

CREATE TABLE pig_treatment_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pen_id uuid NOT NULL, group_id uuid, animal_id uuid, treatment_date date NOT NULL,
  product_name text NOT NULL, reason text NOT NULL, dosage text, administration_route text, end_date date, withdrawal_end_date date, prescribed_by text, notes text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id), CONSTRAINT pig_treatment_records_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_treatment_records_pen_fk FOREIGN KEY (organization_id, pen_id) REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_treatment_records_group_fk FOREIGN KEY (organization_id, group_id) REFERENCES pig_groups (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_treatment_records_animal_fk FOREIGN KEY (organization_id, animal_id) REFERENCES pig_animals (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_treatment_records_dates_check CHECK ((end_date IS NULL OR end_date >= treatment_date) AND (withdrawal_end_date IS NULL OR withdrawal_end_date >= treatment_date)),
  CONSTRAINT pig_treatment_records_text_not_blank CHECK ((btrim(product_name) <> '') AND (btrim(reason) <> '') AND (dosage IS NULL OR btrim(dosage) <> '') AND (administration_route IS NULL OR btrim(administration_route) <> '') AND (prescribed_by IS NULL OR btrim(prescribed_by) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER pig_treatment_records_set_updated_at BEFORE UPDATE ON pig_treatment_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_treatment_records_pen_date_idx ON pig_treatment_records (organization_id, pen_id, treatment_date DESC);
SELECT enable_tenant_rls('pig_treatment_records');

CREATE TABLE pig_quarantine_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pen_id uuid NOT NULL, group_id uuid, animal_id uuid, start_date date NOT NULL, end_date date,
  reason text NOT NULL, status text NOT NULL DEFAULT 'active', clearance_notes text, notes text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id), CONSTRAINT pig_quarantine_records_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_quarantine_records_pen_fk FOREIGN KEY (organization_id, pen_id) REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_quarantine_records_group_fk FOREIGN KEY (organization_id, group_id) REFERENCES pig_groups (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_quarantine_records_animal_fk FOREIGN KEY (organization_id, animal_id) REFERENCES pig_animals (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_quarantine_records_subject_check CHECK ((animal_id IS NOT NULL)::integer + (group_id IS NOT NULL)::integer >= 1),
  CONSTRAINT pig_quarantine_records_status_check CHECK (status IN ('active', 'released', 'extended', 'cancelled')),
  CONSTRAINT pig_quarantine_records_dates_check CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT pig_quarantine_records_text_not_blank CHECK ((btrim(reason) <> '') AND (clearance_notes IS NULL OR btrim(clearance_notes) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER pig_quarantine_records_set_updated_at BEFORE UPDATE ON pig_quarantine_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_quarantine_records_pen_status_idx ON pig_quarantine_records (organization_id, pen_id, status);
SELECT enable_tenant_rls('pig_quarantine_records');

CREATE TABLE pig_veterinary_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pen_id uuid NOT NULL, group_id uuid, animal_id uuid, visit_date date NOT NULL, visit_type text NOT NULL,
  veterinarian_name text NOT NULL, diagnosis text, recommendations text, follow_up_date date, status text NOT NULL DEFAULT 'open', notes text,
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id), CONSTRAINT pig_veterinary_records_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_veterinary_records_pen_fk FOREIGN KEY (organization_id, pen_id) REFERENCES pig_pens (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT pig_veterinary_records_group_fk FOREIGN KEY (organization_id, group_id) REFERENCES pig_groups (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_veterinary_records_animal_fk FOREIGN KEY (organization_id, animal_id) REFERENCES pig_animals (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT pig_veterinary_records_type_check CHECK (visit_type IN ('routine', 'emergency', 'diagnostic', 'follow_up', 'advisory', 'other')),
  CONSTRAINT pig_veterinary_records_status_check CHECK (status IN ('open', 'monitoring', 'closed')),
  CONSTRAINT pig_veterinary_records_dates_check CHECK (follow_up_date IS NULL OR follow_up_date >= visit_date),
  CONSTRAINT pig_veterinary_records_text_not_blank CHECK ((btrim(veterinarian_name) <> '') AND (diagnosis IS NULL OR btrim(diagnosis) <> '') AND (recommendations IS NULL OR btrim(recommendations) <> '') AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER pig_veterinary_records_set_updated_at BEFORE UPDATE ON pig_veterinary_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX pig_veterinary_records_pen_date_idx ON pig_veterinary_records (organization_id, pen_id, visit_date DESC);
SELECT enable_tenant_rls('pig_veterinary_records');

COMMENT ON TABLE pig_mortality_records IS 'Source-of-truth pig death events. Daily records may report the daily balance but do not replace this history.';
COMMENT ON TABLE pig_breeding_records IS 'Mating or insemination records between a sow/gilt and a boar or approved breeding method.';
COMMENT ON TABLE pig_veterinary_records IS 'Veterinary visits, diagnosis and recommendations for a pen, group or individual animal.';

-- The catalogue is global. Existing role grants are limited to the exact
-- Congo Omega organization; future mixed-farm companies receive their grants
-- when the role template is provisioned for them.
INSERT INTO permissions (code, resource, action, module_code, description)
SELECT 'pigs.' || r.resource || '.' || a.action, 'pigs.' || r.resource, a.action, 'pigs',
       a.action || ' pig ' || replace(r.resource, '_', ' ')
  FROM (VALUES
    ('pens'), ('groups'), ('animals'), ('daily_records'), ('feed'), ('water'),
    ('weights'), ('movements'), ('mortality'), ('losses'), ('breeding'),
    ('pregnancies'), ('farrowing'), ('piglets'), ('health'), ('vaccinations'),
    ('treatments'), ('quarantine'), ('veterinary')
  ) AS r(resource)
 CROSS JOIN (VALUES ('read'), ('create'), ('update'), ('delete')) AS a(action)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT rp.code, p.code FROM role_presets rp CROSS JOIN permissions p
 WHERE rp.code IN ('owner', 'general_manager', 'farm_operations_manager', 'farm_manager') AND p.module_code = 'pigs'
ON CONFLICT DO NOTHING;

INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT rp.code, p.code FROM role_presets rp CROSS JOIN permissions p
 WHERE rp.code IN ('pig_supervisor', 'supervisor', 'provincial_manager') AND p.module_code = 'pigs' AND p.action IN ('create', 'read', 'update')
ON CONFLICT DO NOTHING;

INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT rp.code, p.code
FROM role_presets rp
CROSS JOIN permissions p
WHERE rp.code = 'veterinarian'
  AND p.resource IN (
    'pigs.health',
    'pigs.vaccinations',
    'pigs.treatments',
    'pigs.quarantine',
    'pigs.veterinary',
    'pigs.mortality'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id FROM roles r
 JOIN organizations o ON o.id = r.organization_id CROSS JOIN permissions p
 WHERE o.slug = 'congo-omega'
   AND r.code IN ('owner', 'general_manager', 'farm_operations_manager', 'farm_manager')
   AND p.module_code = 'pigs'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id FROM roles r
 JOIN organizations o ON o.id = r.organization_id CROSS JOIN permissions p
 WHERE o.slug = 'congo-omega'
   AND r.code IN ('pig_supervisor', 'supervisor', 'provincial_manager')
   AND p.module_code = 'pigs' AND p.action IN ('create', 'read', 'update')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id FROM roles r
 JOIN organizations o ON o.id = r.organization_id CROSS JOIN permissions p
 WHERE o.slug = 'congo-omega' AND r.code = 'veterinarian'
   AND p.resource IN ('pigs.health', 'pigs.vaccinations', 'pigs.treatments', 'pigs.quarantine', 'pigs.veterinary', 'pigs.mortality')
ON CONFLICT DO NOTHING;
