-- 022_owner_management_assets_maintenance.sql
-- Durable assets, vehicles and machine maintenance for the Owner Management
-- layer. Consumables remain in project materials/inventory; every durable item
-- received becomes a permanent company asset with its own history.

CREATE TABLE management_asset_number_counters (
  organization_id uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  last_number     integer NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);
SELECT enable_tenant_rls('management_asset_number_counters');

CREATE TABLE management_assets (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  asset_number          text NOT NULL,
  project_id            uuid,
  phase_id              uuid,
  province_id           uuid,
  site_id               uuid,
  department_id         uuid,
  supplier_id           uuid,
  name                  text NOT NULL,
  category              text NOT NULL,
  brand                 text,
  model                 text,
  serial_number         text,
  purchase_price        numeric(16,2),
  purchase_date         date,
  currency_code         text NOT NULL DEFAULT 'USD',
  condition             text NOT NULL DEFAULT 'good',
  status                text NOT NULL DEFAULT 'available',
  current_location      text,
  assigned_member_id    uuid,
  meter_type            text NOT NULL DEFAULT 'none',
  current_meter_reading numeric(14,2),
  fuel_type             text,
  warranty_expires_on   date,
  insurance_expires_on  date,
  notes                 text,
  retired_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_assets_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_assets_number_unique UNIQUE (organization_id, asset_number),
  CONSTRAINT management_assets_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_assets_phase_fk FOREIGN KEY (organization_id, phase_id)
    REFERENCES management_project_phases (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_assets_province_fk FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_assets_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_assets_department_fk FOREIGN KEY (organization_id, department_id)
    REFERENCES departments (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_assets_supplier_fk FOREIGN KEY (organization_id, supplier_id)
    REFERENCES management_suppliers (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_assets_member_fk FOREIGN KEY (organization_id, assigned_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_assets_name_check CHECK (btrim(name) <> '' AND btrim(category) <> ''),
  CONSTRAINT management_assets_price_check CHECK (purchase_price IS NULL OR purchase_price >= 0),
  CONSTRAINT management_assets_meter_check CHECK (
    meter_type IN ('none', 'engine_hours', 'mileage_km', 'operating_hours', 'cycles') AND
    (current_meter_reading IS NULL OR current_meter_reading >= 0)
  ),
  CONSTRAINT management_assets_condition_check CHECK (condition IN ('new', 'excellent', 'good', 'fair', 'poor', 'damaged')),
  CONSTRAINT management_assets_status_check CHECK (status IN (
    'available', 'assigned', 'in_use', 'under_maintenance', 'out_of_service',
    'damaged', 'retired', 'sold', 'lost'
  )),
  CONSTRAINT management_assets_currency_check CHECK (currency_code ~ '^[A-Z]{3}$')
);
CREATE TRIGGER management_assets_set_updated_at BEFORE UPDATE ON management_assets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_assets_project_idx ON management_assets (organization_id, project_id);
CREATE INDEX management_assets_site_status_idx ON management_assets (organization_id, site_id, status);
CREATE INDEX management_assets_status_idx ON management_assets (organization_id, status);
SELECT enable_tenant_rls('management_assets');

CREATE OR REPLACE FUNCTION management_assign_asset_number()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  next_number integer;
BEGIN
  IF NEW.asset_number IS NOT NULL AND btrim(NEW.asset_number) <> '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO management_asset_number_counters (organization_id, last_number)
  VALUES (NEW.organization_id, 1)
  ON CONFLICT (organization_id) DO UPDATE
    SET last_number = management_asset_number_counters.last_number + 1
  RETURNING last_number INTO next_number;

  NEW.asset_number := 'AST-' || lpad(next_number::text, 5, '0');
  RETURN NEW;
END;
$$;
CREATE TRIGGER management_assets_assign_number BEFORE INSERT ON management_assets
  FOR EACH ROW EXECUTE FUNCTION management_assign_asset_number();

ALTER TABLE management_receipt_lines
  ADD COLUMN asset_id uuid,
  ADD CONSTRAINT management_receipt_lines_asset_fk FOREIGN KEY (organization_id, asset_id)
    REFERENCES management_assets (organization_id, id) ON DELETE SET NULL;
CREATE INDEX management_receipt_lines_asset_idx ON management_receipt_lines (organization_id, asset_id)
  WHERE asset_id IS NOT NULL;

CREATE TABLE management_asset_assignments (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  asset_id           uuid NOT NULL,
  assigned_member_id uuid,
  assigned_project_id uuid,
  assigned_site_id   uuid,
  assigned_by_member_id uuid,
  assigned_at        timestamptz NOT NULL DEFAULT now(),
  returned_at        timestamptz,
  condition_out      text,
  condition_in       text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_asset_assignments_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_asset_assignments_asset_fk FOREIGN KEY (organization_id, asset_id)
    REFERENCES management_assets (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_asset_assignments_member_fk FOREIGN KEY (organization_id, assigned_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_asset_assignments_project_fk FOREIGN KEY (organization_id, assigned_project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_asset_assignments_site_fk FOREIGN KEY (organization_id, assigned_site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_asset_assignments_by_fk FOREIGN KEY (organization_id, assigned_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_asset_assignments_time_check CHECK (returned_at IS NULL OR returned_at >= assigned_at),
  CONSTRAINT management_asset_assignments_target_check CHECK (
    assigned_member_id IS NOT NULL OR assigned_project_id IS NOT NULL OR assigned_site_id IS NOT NULL
  )
);
CREATE TRIGGER management_asset_assignments_set_updated_at BEFORE UPDATE ON management_asset_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_asset_assignments_open_idx ON management_asset_assignments (organization_id, asset_id)
  WHERE returned_at IS NULL;
SELECT enable_tenant_rls('management_asset_assignments');

CREATE TABLE management_asset_movements (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  asset_id            uuid NOT NULL,
  from_site_id        uuid,
  to_site_id          uuid,
  from_location       text,
  to_location         text,
  moved_by_member_id  uuid,
  moved_at            timestamptz NOT NULL DEFAULT now(),
  reason              text NOT NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_asset_movements_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_asset_movements_asset_fk FOREIGN KEY (organization_id, asset_id)
    REFERENCES management_assets (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_asset_movements_from_site_fk FOREIGN KEY (organization_id, from_site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_asset_movements_to_site_fk FOREIGN KEY (organization_id, to_site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_asset_movements_member_fk FOREIGN KEY (organization_id, moved_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_asset_movements_text_check CHECK (btrim(reason) <> '')
);
CREATE TRIGGER management_asset_movements_set_updated_at BEFORE UPDATE ON management_asset_movements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_asset_movements_asset_idx ON management_asset_movements (organization_id, asset_id, moved_at DESC);
SELECT enable_tenant_rls('management_asset_movements');

CREATE TABLE management_asset_usage_logs (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  asset_id              uuid NOT NULL,
  project_id            uuid,
  site_id               uuid,
  operator_member_id    uuid,
  usage_date            date NOT NULL DEFAULT current_date,
  meter_start           numeric(14,2),
  meter_end             numeric(14,2),
  fuel_consumed         numeric(14,3),
  fuel_unit             text NOT NULL DEFAULT 'litres',
  work_performed        text NOT NULL,
  area_covered          numeric(14,3),
  input_quantity        numeric(14,3),
  output_quantity       numeric(14,3),
  quantity_unit         text,
  downtime_minutes      integer NOT NULL DEFAULT 0,
  problem_reported      text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_asset_usage_logs_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_asset_usage_logs_asset_fk FOREIGN KEY (organization_id, asset_id)
    REFERENCES management_assets (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_asset_usage_logs_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_asset_usage_logs_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_asset_usage_logs_operator_fk FOREIGN KEY (organization_id, operator_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_asset_usage_logs_meter_check CHECK (
    (meter_start IS NULL OR meter_start >= 0) AND
    (meter_end IS NULL OR meter_end >= 0) AND
    (meter_start IS NULL OR meter_end IS NULL OR meter_end >= meter_start) AND
    (fuel_consumed IS NULL OR fuel_consumed >= 0) AND
    (area_covered IS NULL OR area_covered >= 0) AND
    (input_quantity IS NULL OR input_quantity >= 0) AND
    (output_quantity IS NULL OR output_quantity >= 0) AND
    downtime_minutes >= 0 AND btrim(work_performed) <> ''
  )
);
CREATE TRIGGER management_asset_usage_logs_set_updated_at BEFORE UPDATE ON management_asset_usage_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_asset_usage_logs_asset_idx ON management_asset_usage_logs (organization_id, asset_id, usage_date DESC);
SELECT enable_tenant_rls('management_asset_usage_logs');

CREATE TABLE management_vehicle_profiles (
  id                       uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  asset_id                 uuid NOT NULL,
  vehicle_number           text NOT NULL,
  registration_number      text,
  plate_number             text,
  vehicle_year             integer,
  vin                      text,
  make                     text,
  model                    text,
  default_driver_member_id uuid,
  insurance_provider       text,
  insurance_expires_on     date,
  registration_expires_on  date,
  inspection_expires_on    date,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_vehicle_profiles_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_vehicle_profiles_asset_unique UNIQUE (organization_id, asset_id),
  CONSTRAINT management_vehicle_profiles_number_unique UNIQUE (organization_id, vehicle_number),
  CONSTRAINT management_vehicle_profiles_asset_fk FOREIGN KEY (organization_id, asset_id)
    REFERENCES management_assets (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_vehicle_profiles_driver_fk FOREIGN KEY (organization_id, default_driver_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_vehicle_profiles_year_check CHECK (vehicle_year IS NULL OR vehicle_year BETWEEN 1900 AND 2200),
  CONSTRAINT management_vehicle_profiles_text_check CHECK (btrim(vehicle_number) <> '')
);
CREATE TRIGGER management_vehicle_profiles_set_updated_at BEFORE UPDATE ON management_vehicle_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT enable_tenant_rls('management_vehicle_profiles');

CREATE TABLE management_vehicle_trips (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  vehicle_id         uuid NOT NULL,
  project_id         uuid,
  driver_member_id   uuid,
  trip_date          date NOT NULL DEFAULT current_date,
  destination        text NOT NULL,
  purpose            text NOT NULL,
  start_mileage      numeric(14,2),
  end_mileage        numeric(14,2),
  fuel_used          numeric(14,3),
  fuel_cost          numeric(16,2),
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_vehicle_trips_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_vehicle_trips_vehicle_fk FOREIGN KEY (organization_id, vehicle_id)
    REFERENCES management_vehicle_profiles (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_vehicle_trips_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_vehicle_trips_driver_fk FOREIGN KEY (organization_id, driver_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_vehicle_trips_meter_check CHECK (
    (start_mileage IS NULL OR start_mileage >= 0) AND
    (end_mileage IS NULL OR end_mileage >= 0) AND
    (start_mileage IS NULL OR end_mileage IS NULL OR end_mileage >= start_mileage) AND
    (fuel_used IS NULL OR fuel_used >= 0) AND (fuel_cost IS NULL OR fuel_cost >= 0) AND
    btrim(destination) <> '' AND btrim(purpose) <> ''
  )
);
CREATE TRIGGER management_vehicle_trips_set_updated_at BEFORE UPDATE ON management_vehicle_trips
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_vehicle_trips_vehicle_idx ON management_vehicle_trips (organization_id, vehicle_id, trip_date DESC);
SELECT enable_tenant_rls('management_vehicle_trips');

CREATE TABLE management_maintenance_plans (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  asset_id              uuid NOT NULL,
  name                  text NOT NULL,
  maintenance_type      text NOT NULL DEFAULT 'preventive',
  description           text,
  interval_days         integer,
  interval_meter        numeric(14,2),
  next_due_date         date,
  next_due_meter        numeric(14,2),
  estimated_cost        numeric(16,2),
  is_active             boolean NOT NULL DEFAULT true,
  created_by_member_id  uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_maintenance_plans_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_maintenance_plans_asset_fk FOREIGN KEY (organization_id, asset_id)
    REFERENCES management_assets (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_maintenance_plans_member_fk FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_maintenance_plans_type_check CHECK (maintenance_type IN ('preventive', 'corrective', 'emergency', 'inspection', 'routine_service')),
  CONSTRAINT management_maintenance_plans_schedule_check CHECK (
    (interval_days IS NOT NULL AND interval_days > 0) OR
    (interval_meter IS NOT NULL AND interval_meter > 0) OR
    next_due_date IS NOT NULL OR next_due_meter IS NOT NULL
  ),
  CONSTRAINT management_maintenance_plans_amount_check CHECK (
    (interval_meter IS NULL OR interval_meter > 0) AND
    (next_due_meter IS NULL OR next_due_meter >= 0) AND
    (estimated_cost IS NULL OR estimated_cost >= 0) AND
    (interval_days IS NULL OR interval_days > 0) AND btrim(name) <> ''
  )
);
CREATE TRIGGER management_maintenance_plans_set_updated_at BEFORE UPDATE ON management_maintenance_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_maintenance_plans_due_idx ON management_maintenance_plans (organization_id, next_due_date) WHERE is_active;
SELECT enable_tenant_rls('management_maintenance_plans');

CREATE TABLE management_maintenance_work_orders (
  id                       uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  work_order_number        text NOT NULL,
  plan_id                  uuid,
  asset_id                 uuid NOT NULL,
  project_id               uuid,
  reported_by_member_id    uuid,
  assigned_member_id       uuid,
  maintenance_type         text NOT NULL DEFAULT 'preventive',
  status                   text NOT NULL DEFAULT 'reported',
  priority                 text NOT NULL DEFAULT 'normal',
  title                    text NOT NULL,
  problem_description      text,
  due_date                 date,
  opened_at                timestamptz NOT NULL DEFAULT now(),
  started_at               timestamptz,
  completed_at             timestamptz,
  meter_reading            numeric(14,2),
  work_performed           text,
  problem_found            text,
  recommendation           text,
  labor_cost               numeric(16,2) NOT NULL DEFAULT 0,
  parts_cost               numeric(16,2) NOT NULL DEFAULT 0,
  other_cost               numeric(16,2) NOT NULL DEFAULT 0,
  next_due_date            date,
  next_due_meter           numeric(14,2),
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_maintenance_work_orders_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_maintenance_work_orders_number_unique UNIQUE (organization_id, work_order_number),
  CONSTRAINT management_maintenance_work_orders_plan_fk FOREIGN KEY (organization_id, plan_id)
    REFERENCES management_maintenance_plans (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_maintenance_work_orders_asset_fk FOREIGN KEY (organization_id, asset_id)
    REFERENCES management_assets (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_maintenance_work_orders_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_maintenance_work_orders_reported_by_fk FOREIGN KEY (organization_id, reported_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_maintenance_work_orders_assigned_fk FOREIGN KEY (organization_id, assigned_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_maintenance_work_orders_type_check CHECK (maintenance_type IN ('preventive', 'corrective', 'emergency', 'inspection', 'routine_service')),
  CONSTRAINT management_maintenance_work_orders_status_check CHECK (status IN ('reported', 'waiting_approval', 'approved', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT management_maintenance_work_orders_priority_check CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  CONSTRAINT management_maintenance_work_orders_cost_check CHECK (
    labor_cost >= 0 AND parts_cost >= 0 AND other_cost >= 0 AND
    (meter_reading IS NULL OR meter_reading >= 0) AND
    (next_due_meter IS NULL OR next_due_meter >= 0) AND
    (started_at IS NULL OR started_at >= opened_at) AND
    (completed_at IS NULL OR completed_at >= opened_at) AND btrim(title) <> ''
  )
);
CREATE TRIGGER management_maintenance_work_orders_set_updated_at BEFORE UPDATE ON management_maintenance_work_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_maintenance_work_orders_asset_idx ON management_maintenance_work_orders (organization_id, asset_id, status);
CREATE INDEX management_maintenance_work_orders_due_idx ON management_maintenance_work_orders (organization_id, due_date) WHERE status NOT IN ('completed', 'cancelled');
SELECT enable_tenant_rls('management_maintenance_work_orders');

CREATE TABLE management_maintenance_parts (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  work_order_id         uuid NOT NULL,
  inventory_item_id     uuid,
  warehouse_id          uuid,
  part_name             text NOT NULL,
  quantity              numeric(14,3) NOT NULL,
  unit                  text NOT NULL,
  unit_cost             numeric(16,2) NOT NULL DEFAULT 0,
  issued_at             timestamptz NOT NULL DEFAULT now(),
  issued_by_member_id   uuid,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_maintenance_parts_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_maintenance_parts_work_order_fk FOREIGN KEY (organization_id, work_order_id)
    REFERENCES management_maintenance_work_orders (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_maintenance_parts_item_fk FOREIGN KEY (organization_id, inventory_item_id)
    REFERENCES management_inventory_items (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_maintenance_parts_warehouse_fk FOREIGN KEY (organization_id, warehouse_id)
    REFERENCES management_warehouses (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_maintenance_parts_member_fk FOREIGN KEY (organization_id, issued_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_maintenance_parts_amount_check CHECK (quantity > 0 AND unit_cost >= 0 AND btrim(part_name) <> '' AND btrim(unit) <> '')
);
CREATE TRIGGER management_maintenance_parts_set_updated_at BEFORE UPDATE ON management_maintenance_parts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_maintenance_parts_work_order_idx ON management_maintenance_parts (organization_id, work_order_id);
SELECT enable_tenant_rls('management_maintenance_parts');

-- Existing organizations receive this role when the setup endpoint is used.
-- This clause also makes the project role available to Congo Omega immediately.
INSERT INTO roles (organization_id, code, name, description, level, data_scope, is_system)
SELECT o.id, 'project_manager', 'Project Manager',
  'Manages only projects explicitly assigned to them.', 30, 'project', true
FROM organizations o
WHERE o.slug = 'congo-omega'
ON CONFLICT (organization_id, code) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, level = EXCLUDED.level,
  data_scope = EXCLUDED.data_scope, is_system = EXCLUDED.is_system;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM roles r
JOIN role_preset_permissions rpp ON rpp.role_preset_code = r.code
JOIN permissions p ON p.code = rpp.permission_code
WHERE r.code = 'project_manager'
ON CONFLICT DO NOTHING;
