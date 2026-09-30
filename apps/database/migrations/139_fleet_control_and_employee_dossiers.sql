-- 139_fleet_control_and_employee_dossiers.sql
--
-- A controlled fleet layer for vehicles and motorised equipment.  It extends
-- the existing asset, vehicle and maintenance records rather than creating a
-- second equipment register.  Every meter or fuel entry belongs to a signed
-- dispatch/return record and remains auditable.

-- ---------------------------------------------------------------- fleet ----

CREATE TABLE management_fleet_profiles (
  id                              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id                 uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id                        uuid NOT NULL,
  operation_kind                  text NOT NULL DEFAULT 'vehicle',
  fleet_controller_member_id      uuid,
  maintenance_controller_member_id uuid,
  requires_pre_trip               boolean NOT NULL DEFAULT true,
  requires_post_trip              boolean NOT NULL DEFAULT true,
  requires_gate_check             boolean NOT NULL DEFAULT false,
  requires_operator_licence       boolean NOT NULL DEFAULT false,
  required_licence_class          text,
  daily_meter_required            boolean NOT NULL DEFAULT true,
  prevent_dispatch_when_due       boolean NOT NULL DEFAULT true,
  fuel_tank_capacity_litres       numeric(12,3),
  expected_consumption             numeric(12,4),
  expected_consumption_unit        text,
  consumption_tolerance_percent   numeric(6,2) NOT NULL DEFAULT 20,
  is_active                        boolean NOT NULL DEFAULT true,
  notes                            text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_fleet_profiles_org_id_unique UNIQUE (organization_id,id),
  CONSTRAINT management_fleet_profiles_asset_unique UNIQUE (organization_id,asset_id),
  CONSTRAINT management_fleet_profiles_asset_fk FOREIGN KEY (organization_id,asset_id)
    REFERENCES management_assets(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT management_fleet_profiles_controller_fk FOREIGN KEY (organization_id,fleet_controller_member_id)
    REFERENCES organization_members(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_profiles_maintenance_controller_fk FOREIGN KEY (organization_id,maintenance_controller_member_id)
    REFERENCES organization_members(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_profiles_kind_check CHECK (operation_kind IN ('vehicle','motorcycle','tractor','generator','pump','motorized_equipment')),
  CONSTRAINT management_fleet_profiles_fuel_check CHECK (
    (fuel_tank_capacity_litres IS NULL OR fuel_tank_capacity_litres > 0) AND
    (expected_consumption IS NULL OR expected_consumption > 0) AND
    (expected_consumption_unit IS NULL OR expected_consumption_unit IN ('litres_per_100km','litres_per_hour')) AND
    consumption_tolerance_percent BETWEEN 0 AND 200
  )
);
CREATE TRIGGER management_fleet_profiles_set_updated_at BEFORE UPDATE ON management_fleet_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_fleet_profiles_asset_idx ON management_fleet_profiles(organization_id,asset_id);
SELECT enable_tenant_rls('management_fleet_profiles');

-- The owner or fleet controller appoints a person for a *specific* asset. A
-- driver's normal employee role never silently grants access to every vehicle.
CREATE TABLE management_fleet_authorizations (
  id                       uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fleet_profile_id         uuid NOT NULL,
  member_id                uuid NOT NULL,
  responsibility           text NOT NULL,
  licence_document_id      uuid,
  licence_number           text,
  licence_expires_on       date,
  starts_on                date NOT NULL DEFAULT current_date,
  ends_on                  date,
  is_active                boolean NOT NULL DEFAULT true,
  assigned_by_member_id    uuid,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(id),
  CONSTRAINT management_fleet_authorizations_org_id_unique UNIQUE(organization_id,id),
  CONSTRAINT management_fleet_authorizations_profile_member_role_unique UNIQUE(organization_id,fleet_profile_id,member_id,responsibility),
  CONSTRAINT management_fleet_authorizations_profile_fk FOREIGN KEY(organization_id,fleet_profile_id)
    REFERENCES management_fleet_profiles(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT management_fleet_authorizations_member_fk FOREIGN KEY(organization_id,member_id)
    REFERENCES organization_members(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT management_fleet_authorizations_assigned_by_fk FOREIGN KEY(organization_id,assigned_by_member_id)
    REFERENCES organization_members(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_authorizations_document_fk FOREIGN KEY(organization_id,licence_document_id)
    REFERENCES documents(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_authorizations_role_check CHECK(responsibility IN ('driver','operator','fleet_controller','gate_verifier','maintenance_controller')),
  CONSTRAINT management_fleet_authorizations_dates_check CHECK(ends_on IS NULL OR ends_on >= starts_on)
);
CREATE TRIGGER management_fleet_authorizations_set_updated_at BEFORE UPDATE ON management_fleet_authorizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_fleet_authorizations_member_idx ON management_fleet_authorizations(organization_id,member_id) WHERE is_active;
SELECT enable_tenant_rls('management_fleet_authorizations');

-- A company can tailor its checklist by class of engine.  Answers are copied
-- into the daily record, so changing a future template never alters history.
CREATE TABLE management_fleet_inspection_templates (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name               text NOT NULL,
  operation_kind     text NOT NULL DEFAULT 'vehicle',
  inspection_stage   text NOT NULL,
  is_active          boolean NOT NULL DEFAULT true,
  created_by_member_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(id),
  CONSTRAINT management_fleet_inspection_templates_org_id_unique UNIQUE(organization_id,id),
  CONSTRAINT management_fleet_inspection_templates_name_unique UNIQUE(organization_id,name,operation_kind,inspection_stage),
  CONSTRAINT management_fleet_inspection_templates_created_by_fk FOREIGN KEY(organization_id,created_by_member_id)
    REFERENCES organization_members(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_inspection_templates_kind_check CHECK(operation_kind IN ('vehicle','motorcycle','tractor','generator','pump','motorized_equipment')),
  CONSTRAINT management_fleet_inspection_templates_stage_check CHECK(inspection_stage IN ('pre_trip','post_trip')),
  CONSTRAINT management_fleet_inspection_templates_name_check CHECK(btrim(name) <> '')
);
CREATE TRIGGER management_fleet_inspection_templates_set_updated_at BEFORE UPDATE ON management_fleet_inspection_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT enable_tenant_rls('management_fleet_inspection_templates');

CREATE TABLE management_fleet_inspection_template_items (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id        uuid NOT NULL,
  item_code          text NOT NULL,
  label              text NOT NULL,
  guidance           text,
  is_required        boolean NOT NULL DEFAULT true,
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(id),
  CONSTRAINT management_fleet_inspection_template_items_org_id_unique UNIQUE(organization_id,id),
  CONSTRAINT management_fleet_inspection_template_items_unique UNIQUE(organization_id,template_id,item_code),
  CONSTRAINT management_fleet_inspection_template_items_template_fk FOREIGN KEY(organization_id,template_id)
    REFERENCES management_fleet_inspection_templates(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT management_fleet_inspection_template_items_code_check CHECK(item_code ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  CONSTRAINT management_fleet_inspection_template_items_label_check CHECK(btrim(label) <> '')
);
CREATE TRIGGER management_fleet_inspection_template_items_set_updated_at BEFORE UPDATE ON management_fleet_inspection_template_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT enable_tenant_rls('management_fleet_inspection_template_items');

CREATE TABLE management_fleet_daily_counters (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_date        date NOT NULL,
  last_number     integer NOT NULL DEFAULT 0,
  PRIMARY KEY(organization_id,run_date),
  CONSTRAINT management_fleet_daily_counters_positive CHECK(last_number >= 0)
);
SELECT enable_tenant_rls('management_fleet_daily_counters');

CREATE TABLE management_fleet_runs (
  id                       uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_code                 text,
  fleet_profile_id         uuid NOT NULL,
  asset_id                 uuid NOT NULL,
  project_id               uuid,
  project_task_id          uuid,
  site_id                  uuid,
  operator_member_id       uuid NOT NULL,
  gate_verified_by_member_id uuid,
  run_date                 date NOT NULL DEFAULT current_date,
  purpose                  text NOT NULL,
  destination              text,
  status                   text NOT NULL DEFAULT 'open',
  dispatched_at            timestamptz NOT NULL DEFAULT now(),
  returned_at              timestamptz,
  start_meter              numeric(14,2),
  end_meter                numeric(14,2),
  opening_fuel_litres      numeric(12,3),
  closing_fuel_litres      numeric(12,3),
  pre_trip_signed_at       timestamptz,
  pre_trip_signed_by_member_id uuid,
  post_trip_signed_at      timestamptz,
  post_trip_signed_by_member_id uuid,
  cancelled_at             timestamptz,
  cancelled_by_member_id   uuid,
  cancellation_reason      text,
  return_notes             text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(id),
  CONSTRAINT management_fleet_runs_org_id_unique UNIQUE(organization_id,id),
  CONSTRAINT management_fleet_runs_code_unique UNIQUE(organization_id,run_code),
  CONSTRAINT management_fleet_runs_profile_fk FOREIGN KEY(organization_id,fleet_profile_id)
    REFERENCES management_fleet_profiles(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT management_fleet_runs_asset_fk FOREIGN KEY(organization_id,asset_id)
    REFERENCES management_assets(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT management_fleet_runs_project_fk FOREIGN KEY(organization_id,project_id)
    REFERENCES management_projects(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_runs_task_fk FOREIGN KEY(organization_id,project_task_id)
    REFERENCES management_project_tasks(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_runs_site_fk FOREIGN KEY(organization_id,site_id)
    REFERENCES sites(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_runs_operator_fk FOREIGN KEY(organization_id,operator_member_id)
    REFERENCES organization_members(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT management_fleet_runs_gate_verifier_fk FOREIGN KEY(organization_id,gate_verified_by_member_id)
    REFERENCES organization_members(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_runs_pretrip_signer_fk FOREIGN KEY(organization_id,pre_trip_signed_by_member_id)
    REFERENCES organization_members(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_runs_posttrip_signer_fk FOREIGN KEY(organization_id,post_trip_signed_by_member_id)
    REFERENCES organization_members(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_runs_cancelled_by_fk FOREIGN KEY(organization_id,cancelled_by_member_id)
    REFERENCES organization_members(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_runs_status_check CHECK(status IN ('open','returned','rejected','cancelled')),
  CONSTRAINT management_fleet_runs_purpose_check CHECK(btrim(purpose) <> ''),
  CONSTRAINT management_fleet_runs_meter_check CHECK(
    (start_meter IS NULL OR start_meter >= 0) AND
    (end_meter IS NULL OR end_meter >= 0) AND
    (start_meter IS NULL OR end_meter IS NULL OR end_meter >= start_meter) AND
    (opening_fuel_litres IS NULL OR opening_fuel_litres >= 0) AND
    (closing_fuel_litres IS NULL OR closing_fuel_litres >= 0) AND
    (returned_at IS NULL OR returned_at >= dispatched_at)
  ),
  CONSTRAINT management_fleet_runs_cancel_check CHECK(
    status <> 'cancelled' OR (cancelled_at IS NOT NULL AND btrim(COALESCE(cancellation_reason,'')) <> '')
  )
);
CREATE OR REPLACE FUNCTION management_fleet_runs_assign_code()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE next_value integer;
BEGIN
  IF NEW.run_code IS NULL OR btrim(NEW.run_code) = '' THEN
    INSERT INTO management_fleet_daily_counters(organization_id,run_date,last_number)
    VALUES(NEW.organization_id,NEW.run_date,1)
    ON CONFLICT(organization_id,run_date)
    DO UPDATE SET last_number=management_fleet_daily_counters.last_number+1
    RETURNING last_number INTO next_value;
    NEW.run_code := 'FLEET-' || to_char(NEW.run_date,'YYYYMMDD') || '-' || lpad(next_value::text,4,'0');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER management_fleet_runs_assign_code BEFORE INSERT ON management_fleet_runs
  FOR EACH ROW EXECUTE FUNCTION management_fleet_runs_assign_code();
CREATE TRIGGER management_fleet_runs_set_updated_at BEFORE UPDATE ON management_fleet_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- A vehicle or engine cannot be checked out twice at the same time.
CREATE UNIQUE INDEX management_fleet_runs_open_asset_unique ON management_fleet_runs(organization_id,asset_id) WHERE status='open';
CREATE INDEX management_fleet_runs_asset_date_idx ON management_fleet_runs(organization_id,asset_id,run_date DESC);
CREATE INDEX management_fleet_runs_operator_date_idx ON management_fleet_runs(organization_id,operator_member_id,run_date DESC);
SELECT enable_tenant_rls('management_fleet_runs');

CREATE TABLE management_fleet_inspection_responses (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id              uuid NOT NULL,
  inspection_stage    text NOT NULL,
  template_item_id    uuid,
  item_code           text NOT NULL,
  item_label          text NOT NULL,
  is_required         boolean NOT NULL DEFAULT true,
  result              text NOT NULL,
  notes               text,
  photo_document_id   uuid,
  recorded_by_member_id uuid NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(id),
  CONSTRAINT management_fleet_inspection_responses_org_id_unique UNIQUE(organization_id,id),
  CONSTRAINT management_fleet_inspection_responses_one_answer UNIQUE(organization_id,run_id,inspection_stage,item_code),
  CONSTRAINT management_fleet_inspection_responses_run_fk FOREIGN KEY(organization_id,run_id)
    REFERENCES management_fleet_runs(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT management_fleet_inspection_responses_template_item_fk FOREIGN KEY(organization_id,template_item_id)
    REFERENCES management_fleet_inspection_template_items(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_inspection_responses_document_fk FOREIGN KEY(organization_id,photo_document_id)
    REFERENCES documents(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_inspection_responses_member_fk FOREIGN KEY(organization_id,recorded_by_member_id)
    REFERENCES organization_members(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT management_fleet_inspection_responses_stage_check CHECK(inspection_stage IN ('pre_trip','post_trip')),
  CONSTRAINT management_fleet_inspection_responses_result_check CHECK(result IN ('pass','fail','not_applicable')),
  CONSTRAINT management_fleet_inspection_responses_item_check CHECK(btrim(item_code) <> '' AND btrim(item_label) <> '')
);
CREATE INDEX management_fleet_inspection_responses_run_idx ON management_fleet_inspection_responses(organization_id,run_id,inspection_stage);
SELECT enable_tenant_rls('management_fleet_inspection_responses');

CREATE TABLE management_fleet_fuel_logs (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id              uuid,
  asset_id            uuid NOT NULL,
  project_id          uuid,
  log_type            text NOT NULL,
  meter_reading       numeric(14,2),
  quantity_litres     numeric(12,3) NOT NULL,
  unit_cost           numeric(16,2),
  total_cost          numeric(16,2),
  currency_code       char(3),
  supplier_id         uuid,
  receipt_document_id uuid,
  recorded_by_member_id uuid NOT NULL,
  verified_by_member_id uuid,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(id),
  CONSTRAINT management_fleet_fuel_logs_org_id_unique UNIQUE(organization_id,id),
  CONSTRAINT management_fleet_fuel_logs_run_fk FOREIGN KEY(organization_id,run_id)
    REFERENCES management_fleet_runs(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_fuel_logs_asset_fk FOREIGN KEY(organization_id,asset_id)
    REFERENCES management_assets(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT management_fleet_fuel_logs_project_fk FOREIGN KEY(organization_id,project_id)
    REFERENCES management_projects(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_fuel_logs_supplier_fk FOREIGN KEY(organization_id,supplier_id)
    REFERENCES management_suppliers(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_fuel_logs_receipt_document_fk FOREIGN KEY(organization_id,receipt_document_id)
    REFERENCES documents(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_fuel_logs_recorded_by_fk FOREIGN KEY(organization_id,recorded_by_member_id)
    REFERENCES organization_members(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT management_fleet_fuel_logs_verified_by_fk FOREIGN KEY(organization_id,verified_by_member_id)
    REFERENCES organization_members(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_fuel_logs_type_check CHECK(log_type IN ('issued_from_stock','purchased','tank_check','correction')),
  CONSTRAINT management_fleet_fuel_logs_amount_check CHECK(
    quantity_litres > 0 AND
    (meter_reading IS NULL OR meter_reading >= 0) AND
    (unit_cost IS NULL OR unit_cost >= 0) AND
    (total_cost IS NULL OR total_cost >= 0) AND
    (currency_code IS NULL OR currency_code IN ('CDF','USD','EUR'))
  )
);
CREATE INDEX management_fleet_fuel_logs_asset_idx ON management_fleet_fuel_logs(organization_id,asset_id,recorded_at DESC);
SELECT enable_tenant_rls('management_fleet_fuel_logs');

CREATE TABLE management_fleet_alerts (
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id             uuid NOT NULL,
  run_id               uuid,
  alert_type           text NOT NULL,
  severity             text NOT NULL DEFAULT 'warning',
  status               text NOT NULL DEFAULT 'open',
  title                text NOT NULL,
  details              text,
  detected_value       numeric(16,4),
  expected_value       numeric(16,4),
  assigned_member_id   uuid,
  resolved_by_member_id uuid,
  resolved_at          timestamptz,
  resolution_notes     text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(id),
  CONSTRAINT management_fleet_alerts_org_id_unique UNIQUE(organization_id,id),
  CONSTRAINT management_fleet_alerts_asset_fk FOREIGN KEY(organization_id,asset_id)
    REFERENCES management_assets(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT management_fleet_alerts_run_fk FOREIGN KEY(organization_id,run_id)
    REFERENCES management_fleet_runs(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_alerts_assigned_fk FOREIGN KEY(organization_id,assigned_member_id)
    REFERENCES organization_members(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_alerts_resolved_by_fk FOREIGN KEY(organization_id,resolved_by_member_id)
    REFERENCES organization_members(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_fleet_alerts_type_check CHECK(alert_type IN ('failed_inspection','missing_inspection','meter_anomaly','fuel_variance','fuel_capacity','maintenance_due','licence_expired','gate_check_missing')),
  CONSTRAINT management_fleet_alerts_severity_check CHECK(severity IN ('notice','warning','critical')),
  CONSTRAINT management_fleet_alerts_status_check CHECK(status IN ('open','investigating','resolved','dismissed')),
  CONSTRAINT management_fleet_alerts_title_check CHECK(btrim(title) <> '')
);
CREATE TRIGGER management_fleet_alerts_set_updated_at BEFORE UPDATE ON management_fleet_alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_fleet_alerts_open_idx ON management_fleet_alerts(organization_id,asset_id,created_at DESC) WHERE status IN ('open','investigating');
SELECT enable_tenant_rls('management_fleet_alerts');

-- Preventive plans can now explicitly protect dispatch when a safety-critical
-- service is late. Existing plans retain their behaviour until configured.
ALTER TABLE management_maintenance_plans
  ADD COLUMN IF NOT EXISTS service_category text,
  ADD COLUMN IF NOT EXISTS warning_window_days integer,
  ADD COLUMN IF NOT EXISTS warning_window_meter numeric(14,2),
  ADD COLUMN IF NOT EXISTS blocks_dispatch_when_due boolean NOT NULL DEFAULT false;
ALTER TABLE management_maintenance_plans
  ADD CONSTRAINT management_maintenance_plans_warning_window_check CHECK(
    (warning_window_days IS NULL OR warning_window_days >= 0) AND
    (warning_window_meter IS NULL OR warning_window_meter >= 0)
  );

-- ----------------------------------------------------- employee dossier ----
-- Files remain in the private company document store. This table only gives
-- each employee one organised dossier and adds structured expiry/credential
-- information without duplicating the file bytes.
CREATE TABLE management_employee_dossier_documents (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id           uuid NOT NULL,
  document_id           uuid NOT NULL,
  document_kind         text NOT NULL,
  credential_number     text,
  issued_on             date,
  expires_on            date,
  verified_by_member_id uuid,
  verified_at           timestamptz,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(id),
  CONSTRAINT management_employee_dossier_documents_org_id_unique UNIQUE(organization_id,id),
  CONSTRAINT management_employee_dossier_documents_document_unique UNIQUE(organization_id,document_id),
  CONSTRAINT management_employee_dossier_documents_employee_fk FOREIGN KEY(organization_id,employee_id)
    REFERENCES employees(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT management_employee_dossier_documents_document_fk FOREIGN KEY(organization_id,document_id)
    REFERENCES documents(organization_id,id) ON DELETE CASCADE,
  CONSTRAINT management_employee_dossier_documents_verified_by_fk FOREIGN KEY(organization_id,verified_by_member_id)
    REFERENCES organization_members(organization_id,id) ON DELETE SET NULL,
  CONSTRAINT management_employee_dossier_documents_kind_check CHECK(document_kind IN ('identity','driving_licence','contract','payroll','training_certificate','medical_clearance','disciplinary','other')),
  CONSTRAINT management_employee_dossier_documents_dates_check CHECK(expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);
CREATE TRIGGER management_employee_dossier_documents_set_updated_at BEFORE UPDATE ON management_employee_dossier_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_employee_dossier_documents_employee_idx ON management_employee_dossier_documents(organization_id,employee_id,document_kind);
CREATE INDEX management_employee_dossier_documents_expiry_idx ON management_employee_dossier_documents(organization_id,expires_on) WHERE expires_on IS NOT NULL;
SELECT enable_tenant_rls('management_employee_dossier_documents');

COMMENT ON TABLE management_fleet_runs IS 'Immutable daily dispatch and return evidence for vehicles and motorised assets.';
COMMENT ON TABLE management_fleet_fuel_logs IS 'Fuel ledger used to compare declared consumption with distance or engine-hours.';
COMMENT ON TABLE management_employee_dossier_documents IS 'One secure employee dossier: identity, licence, contract, payroll and qualifications link to existing private files.';

-- Keep fleet events inside the existing Operations audit filter instead of
-- leaving them hidden in the generic “other” bucket.
CREATE OR REPLACE FUNCTION audit_log_area(table_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN table_name LIKE 'management_project%' OR table_name LIKE 'management_purchase%' OR table_name LIKE 'management_receipt%' OR table_name LIKE 'management_expense%' OR table_name LIKE 'management_approval%' THEN 'projects'
    WHEN table_name LIKE 'management_asset%' OR table_name LIKE 'management_vehicle%' OR table_name LIKE 'management_fleet%' OR table_name LIKE 'management_maintenance%' OR table_name LIKE 'management_inventory%' OR table_name LIKE 'management_warehouse%' OR table_name LIKE 'management_material%' THEN 'operations'
    WHEN table_name LIKE 'poultry_%' THEN 'poultry'
    WHEN table_name LIKE 'pig_%' THEN 'pigs'
    WHEN table_name LIKE 'agriculture_%' THEN 'agriculture'
    WHEN table_name LIKE 'nutrition_%' THEN 'nutrition'
    WHEN table_name LIKE 'sales_%' OR table_name IN ('customers', 'customer_payments', 'payment_allocations', 'credit_notes') THEN 'sales'
    WHEN table_name LIKE 'finance_%' THEN 'finance'
    WHEN table_name IN ('employees', 'shifts', 'shift_assignments', 'shift_assignment_exceptions', 'attendance_records', 'leave_types', 'leave_requests', 'disciplinary_actions', 'performance_reviews', 'performance_review_goals') OR table_name LIKE 'payroll_%' OR table_name LIKE 'payslip%' OR table_name LIKE 'employee_%' OR table_name LIKE 'management_employee_dossier%' THEN 'people'
    WHEN table_name LIKE 'training_%' THEN 'training'
    WHEN table_name IN ('documents', 'contracts', 'contract_templates', 'contract_document_versions', 'contract_signature_fields', 'contract_signature_events') THEN 'documents'
    WHEN table_name LIKE 'security_%' OR table_name IN ('incidents', 'critical_controls', 'alerts', 'corrective_actions', 'escalations') THEN 'security'
    WHEN table_name LIKE 'appointment_%' OR table_name IN ('appointments', 'appointment_events', 'appointment_messages') THEN 'appointments'
    WHEN table_name LIKE 'career_%' THEN 'recruitment'
    WHEN table_name IN ('organizations', 'users', 'roles', 'role_permissions', 'member_roles', 'member_provinces', 'organization_members', 'organization_invitations', 'organization_invitation_provinces', 'organization_settings', 'provinces', 'sites', 'departments', 'notification_preferences', 'notification_profile_preferences') THEN 'access'
    WHEN table_name LIKE 'checklist_%' OR table_name IN ('daily_reports', 'shift_handovers', 'report_definitions', 'report_runs') THEN 'daily_work'
    ELSE 'other'
  END
$$;

-- Add the new safety records to the same immutable, privacy-safe audit trail
-- used by the rest of LiteHubs. The trigger writes in the transaction, so a
-- cancelled database operation never leaves false evidence behind.
CREATE OR REPLACE FUNCTION audit_entity_label(source_row jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    left(
      COALESCE(
        NULLIF(btrim(source_row ->> 'name'), ''),
        NULLIF(btrim(source_row ->> 'title'), ''),
        NULLIF(btrim(source_row ->> 'full_name'), ''),
        NULLIF(btrim(source_row ->> 'run_code'), ''),
        NULLIF(btrim(source_row ->> 'vehicle_number'), ''),
        NULLIF(btrim(source_row ->> 'asset_number'), ''),
        NULLIF(btrim(source_row ->> 'work_order_number'), ''),
        NULLIF(btrim(source_row ->> 'status'), '')
      ),
      240
    ),
    ''
  )
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'management_fleet_profiles','management_fleet_authorizations',
    'management_fleet_inspection_templates','management_fleet_inspection_template_items',
    'management_fleet_runs','management_fleet_inspection_responses',
    'management_fleet_fuel_logs','management_fleet_alerts',
    'management_employee_dossier_documents'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_business_change ON public.%I', table_name);
    EXECUTE format('CREATE TRIGGER audit_business_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION audit_business_change()', table_name);
  END LOOP;
END;
$$;
