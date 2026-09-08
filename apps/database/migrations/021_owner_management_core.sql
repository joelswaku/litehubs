-- 021_owner_management_core.sql
-- Owner Management foundation: projects, money plans, materials, controlled
-- purchasing, receiving, stock, expenses, approvals and linked documents.

-- A Project Manager is scoped to projects explicitly assigned to them. Existing
-- organization, province and self scopes are preserved.
ALTER TABLE role_presets DROP CONSTRAINT role_presets_data_scope_check;
ALTER TABLE role_presets
  ADD CONSTRAINT role_presets_data_scope_check
  CHECK (data_scope IN ('organization', 'province', 'project', 'self'));
ALTER TABLE roles DROP CONSTRAINT roles_data_scope_check;
ALTER TABLE roles
  ADD CONSTRAINT roles_data_scope_check
  CHECK (data_scope IN ('organization', 'province', 'project', 'self'));

INSERT INTO role_presets
  (code, name, description, level, industry_code, is_owner_role, sort_order, data_scope)
VALUES
  ('project_manager', 'Project Manager',
   'Runs only projects explicitly assigned to them.', 25, 'mixed_farm', false, 35, 'project')
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      level = EXCLUDED.level,
      industry_code = EXCLUDED.industry_code,
      is_owner_role = EXCLUDED.is_owner_role,
      sort_order = EXCLUDED.sort_order,
      data_scope = EXCLUDED.data_scope;

CREATE TABLE management_projects (
  id                     uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  code                   text NOT NULL,
  name                   text NOT NULL,
  description            text,
  project_type           text NOT NULL DEFAULT 'other',
  province_id            uuid NOT NULL,
  site_id                uuid,
  department_id          uuid,
  responsible_member_id  uuid,
  start_date             date,
  target_completion_date date,
  completed_date         date,
  status                 text NOT NULL DEFAULT 'planning',
  priority               text NOT NULL DEFAULT 'medium',
  estimated_total_budget numeric(16,2),
  currency_code          char(3) NOT NULL DEFAULT 'CDF',
  progress_percent       numeric(5,2) NOT NULL DEFAULT 0,
  blueprint              text,
  notes                  text,
  created_by_user_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_projects_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_projects_code_unique UNIQUE (organization_id, code),
  CONSTRAINT management_projects_province_fk FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_projects_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_projects_department_fk FOREIGN KEY (organization_id, department_id)
    REFERENCES departments (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_projects_member_fk FOREIGN KEY (organization_id, responsible_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_projects_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT management_projects_type_check CHECK (project_type IN (
    'land', 'construction', 'expansion', 'infrastructure', 'equipment',
    'livestock', 'housing', 'technology', 'maintenance', 'other'
  )),
  CONSTRAINT management_projects_status_check CHECK (status IN (
    'planning', 'approved', 'in_progress', 'on_hold', 'completed', 'cancelled'
  )),
  CONSTRAINT management_projects_priority_check CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT management_projects_values_check CHECK (
    (estimated_total_budget IS NULL OR estimated_total_budget >= 0) AND
    progress_percent BETWEEN 0 AND 100
  ),
  CONSTRAINT management_projects_dates_check CHECK (
    (target_completion_date IS NULL OR start_date IS NULL OR target_completion_date >= start_date) AND
    (completed_date IS NULL OR start_date IS NULL OR completed_date >= start_date)
  ),
  CONSTRAINT management_projects_text_check CHECK (
    btrim(name) <> '' AND
    (description IS NULL OR btrim(description) <> '') AND
    (blueprint IS NULL OR btrim(blueprint) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER management_projects_set_updated_at BEFORE UPDATE ON management_projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_projects_province_status_idx ON management_projects (organization_id, province_id, status);
CREATE INDEX management_projects_site_idx ON management_projects (organization_id, site_id) WHERE site_id IS NOT NULL;
SELECT enable_tenant_rls('management_projects');

CREATE TABLE management_project_members (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id      uuid NOT NULL,
  member_id       uuid NOT NULL,
  assignment_role text NOT NULL DEFAULT 'member',
  is_manager      boolean NOT NULL DEFAULT false,
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  assigned_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  notes           text,
  PRIMARY KEY (project_id, member_id),
  CONSTRAINT management_project_members_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_project_members_member_fk FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_project_members_role_check CHECK (assignment_role IN (
    'manager', 'site_manager', 'engineer', 'supervisor', 'storekeeper',
    'operator', 'driver', 'receiver', 'technician', 'worker', 'member'
  )),
  CONSTRAINT management_project_members_notes_check CHECK (notes IS NULL OR btrim(notes) <> '')
);
CREATE INDEX management_project_members_member_idx ON management_project_members (organization_id, member_id);
SELECT enable_tenant_rls('management_project_members');

CREATE TABLE management_project_phases (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id          uuid NOT NULL,
  code                text NOT NULL,
  name                text NOT NULL,
  description         text,
  phase_order         integer NOT NULL,
  responsible_member_id uuid,
  start_date          date,
  target_end_date     date,
  completed_date      date,
  status              text NOT NULL DEFAULT 'not_started',
  priority            text NOT NULL DEFAULT 'medium',
  planned_budget      numeric(16,2),
  progress_percent    numeric(5,2) NOT NULL DEFAULT 0,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_project_phases_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_project_phases_code_unique UNIQUE (organization_id, project_id, code),
  CONSTRAINT management_project_phases_order_unique UNIQUE (organization_id, project_id, phase_order),
  CONSTRAINT management_project_phases_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_project_phases_member_fk FOREIGN KEY (organization_id, responsible_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_phases_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT management_project_phases_status_check CHECK (status IN (
    'not_started', 'in_progress', 'blocked', 'waiting_approval', 'completed', 'cancelled'
  )),
  CONSTRAINT management_project_phases_priority_check CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT management_project_phases_values_check CHECK (
    phase_order > 0 AND
    (planned_budget IS NULL OR planned_budget >= 0) AND
    progress_percent BETWEEN 0 AND 100
  ),
  CONSTRAINT management_project_phases_dates_check CHECK (
    (target_end_date IS NULL OR start_date IS NULL OR target_end_date >= start_date) AND
    (completed_date IS NULL OR start_date IS NULL OR completed_date >= start_date)
  ),
  CONSTRAINT management_project_phases_text_check CHECK (
    btrim(name) <> '' AND
    (description IS NULL OR btrim(description) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER management_project_phases_set_updated_at BEFORE UPDATE ON management_project_phases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_project_phases_project_status_idx ON management_project_phases (organization_id, project_id, status);
SELECT enable_tenant_rls('management_project_phases');

CREATE TABLE management_project_tasks (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id            uuid NOT NULL,
  phase_id              uuid,
  code                  text,
  title                 text NOT NULL,
  description           text,
  assigned_member_id    uuid,
  assigned_department_id uuid,
  start_date            date,
  due_date              date,
  completed_date        date,
  priority              text NOT NULL DEFAULT 'medium',
  status                text NOT NULL DEFAULT 'not_started',
  progress_percent      numeric(5,2) NOT NULL DEFAULT 0,
  estimated_cost        numeric(16,2),
  actual_cost           numeric(16,2) NOT NULL DEFAULT 0,
  blocked_reason        text,
  notes                 text,
  created_by_user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_project_tasks_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_project_tasks_code_unique UNIQUE NULLS NOT DISTINCT (organization_id, project_id, code),
  CONSTRAINT management_project_tasks_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_project_tasks_phase_fk FOREIGN KEY (organization_id, phase_id)
    REFERENCES management_project_phases (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_tasks_member_fk FOREIGN KEY (organization_id, assigned_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_tasks_department_fk FOREIGN KEY (organization_id, assigned_department_id)
    REFERENCES departments (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_tasks_status_check CHECK (status IN (
    'not_started', 'in_progress', 'blocked', 'waiting_approval', 'completed', 'cancelled'
  )),
  CONSTRAINT management_project_tasks_priority_check CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT management_project_tasks_values_check CHECK (
    progress_percent BETWEEN 0 AND 100 AND
    (estimated_cost IS NULL OR estimated_cost >= 0) AND actual_cost >= 0
  ),
  CONSTRAINT management_project_tasks_dates_check CHECK (
    (due_date IS NULL OR start_date IS NULL OR due_date >= start_date) AND
    (completed_date IS NULL OR start_date IS NULL OR completed_date >= start_date)
  ),
  CONSTRAINT management_project_tasks_text_check CHECK (
    btrim(title) <> '' AND
    (description IS NULL OR btrim(description) <> '') AND
    (blocked_reason IS NULL OR btrim(blocked_reason) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER management_project_tasks_set_updated_at BEFORE UPDATE ON management_project_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_project_tasks_project_status_due_idx ON management_project_tasks (organization_id, project_id, status, due_date);
CREATE INDEX management_project_tasks_assignee_idx ON management_project_tasks (organization_id, assigned_member_id, status) WHERE assigned_member_id IS NOT NULL;
SELECT enable_tenant_rls('management_project_tasks');

CREATE TABLE management_task_dependencies (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  task_id         uuid NOT NULL,
  depends_on_task_id uuid NOT NULL,
  dependency_type text NOT NULL DEFAULT 'finish_to_start',
  PRIMARY KEY (task_id, depends_on_task_id),
  CONSTRAINT management_task_dependencies_task_fk FOREIGN KEY (organization_id, task_id)
    REFERENCES management_project_tasks (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_task_dependencies_dependency_fk FOREIGN KEY (organization_id, depends_on_task_id)
    REFERENCES management_project_tasks (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_task_dependencies_not_self CHECK (task_id <> depends_on_task_id),
  CONSTRAINT management_task_dependencies_type_check CHECK (dependency_type IN (
    'finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish'
  ))
);
CREATE INDEX management_task_dependencies_dependency_idx ON management_task_dependencies (organization_id, depends_on_task_id);
SELECT enable_tenant_rls('management_task_dependencies');

CREATE TABLE management_project_budget_lines (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id          uuid NOT NULL,
  phase_id            uuid,
  category            text NOT NULL,
  description         text,
  planned_amount      numeric(16,2) NOT NULL,
  currency_code       char(3) NOT NULL DEFAULT 'CDF',
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_budget_lines_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_budget_lines_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_budget_lines_phase_fk FOREIGN KEY (organization_id, phase_id)
    REFERENCES management_project_phases (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_budget_lines_amount_check CHECK (planned_amount >= 0),
  CONSTRAINT management_budget_lines_text_check CHECK (
    btrim(category) <> '' AND
    (description IS NULL OR btrim(description) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER management_budget_lines_set_updated_at BEFORE UPDATE ON management_project_budget_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_budget_lines_project_idx ON management_project_budget_lines (organization_id, project_id);
SELECT enable_tenant_rls('management_project_budget_lines');

CREATE TABLE management_suppliers (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  code                text NOT NULL,
  name                text NOT NULL,
  supplier_type       text NOT NULL DEFAULT 'other',
  contact_name        text,
  email               text,
  phone               text,
  tax_number          text,
  address             text,
  status              text NOT NULL DEFAULT 'active',
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_suppliers_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_suppliers_code_unique UNIQUE (organization_id, code),
  CONSTRAINT management_suppliers_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT management_suppliers_type_check CHECK (supplier_type IN (
    'materials', 'equipment', 'livestock', 'services', 'fuel', 'transport', 'other'
  )),
  CONSTRAINT management_suppliers_status_check CHECK (status IN ('active', 'inactive', 'blocked')),
  CONSTRAINT management_suppliers_text_check CHECK (
    btrim(name) <> '' AND
    (contact_name IS NULL OR btrim(contact_name) <> '') AND
    (email IS NULL OR btrim(email) <> '') AND
    (phone IS NULL OR btrim(phone) <> '') AND
    (tax_number IS NULL OR btrim(tax_number) <> '') AND
    (address IS NULL OR btrim(address) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER management_suppliers_set_updated_at BEFORE UPDATE ON management_suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_suppliers_status_idx ON management_suppliers (organization_id, status);
SELECT enable_tenant_rls('management_suppliers');

CREATE TABLE management_inventory_items (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  code                text NOT NULL,
  name                text NOT NULL,
  category            text,
  unit                text NOT NULL,
  reorder_level       numeric(14,3),
  standard_unit_cost  numeric(16,2),
  is_active           boolean NOT NULL DEFAULT true,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_inventory_items_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_inventory_items_code_unique UNIQUE (organization_id, code),
  CONSTRAINT management_inventory_items_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT management_inventory_items_values_check CHECK (
    (reorder_level IS NULL OR reorder_level >= 0) AND
    (standard_unit_cost IS NULL OR standard_unit_cost >= 0)
  ),
  CONSTRAINT management_inventory_items_text_check CHECK (
    btrim(name) <> '' AND btrim(unit) <> '' AND
    (category IS NULL OR btrim(category) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER management_inventory_items_set_updated_at BEFORE UPDATE ON management_inventory_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_inventory_items_active_idx ON management_inventory_items (organization_id) WHERE is_active;
SELECT enable_tenant_rls('management_inventory_items');

CREATE TABLE management_warehouses (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  site_id             uuid NOT NULL,
  code                text NOT NULL,
  name                text NOT NULL,
  manager_member_id   uuid,
  is_active           boolean NOT NULL DEFAULT true,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_warehouses_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_warehouses_code_unique UNIQUE (organization_id, code),
  CONSTRAINT management_warehouses_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_warehouses_manager_fk FOREIGN KEY (organization_id, manager_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_warehouses_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT management_warehouses_text_check CHECK (btrim(name) <> '' AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER management_warehouses_set_updated_at BEFORE UPDATE ON management_warehouses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_warehouses_site_idx ON management_warehouses (organization_id, site_id) WHERE is_active;
SELECT enable_tenant_rls('management_warehouses');

CREATE TABLE management_inventory_stock (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  warehouse_id    uuid NOT NULL,
  item_id         uuid NOT NULL,
  quantity_on_hand numeric(14,3) NOT NULL DEFAULT 0,
  quantity_reserved numeric(14,3) NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, item_id),
  CONSTRAINT management_inventory_stock_warehouse_fk FOREIGN KEY (organization_id, warehouse_id)
    REFERENCES management_warehouses (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_inventory_stock_item_fk FOREIGN KEY (organization_id, item_id)
    REFERENCES management_inventory_items (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_inventory_stock_values_check CHECK (
    quantity_on_hand >= 0 AND quantity_reserved >= 0 AND quantity_reserved <= quantity_on_hand
  )
);
CREATE INDEX management_inventory_stock_item_idx ON management_inventory_stock (organization_id, item_id);
SELECT enable_tenant_rls('management_inventory_stock');

CREATE TABLE management_project_materials (
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id           uuid NOT NULL,
  phase_id             uuid,
  inventory_item_id    uuid,
  default_warehouse_id uuid,
  preferred_supplier_id uuid,
  code                 text,
  name                 text NOT NULL,
  category             text,
  unit                 text NOT NULL,
  planned_quantity     numeric(14,3) NOT NULL,
  estimated_unit_cost  numeric(16,2),
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_project_materials_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_project_materials_code_unique UNIQUE NULLS NOT DISTINCT (organization_id, project_id, code),
  CONSTRAINT management_project_materials_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_project_materials_phase_fk FOREIGN KEY (organization_id, phase_id)
    REFERENCES management_project_phases (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_materials_item_fk FOREIGN KEY (organization_id, inventory_item_id)
    REFERENCES management_inventory_items (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_materials_warehouse_fk FOREIGN KEY (organization_id, default_warehouse_id)
    REFERENCES management_warehouses (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_materials_supplier_fk FOREIGN KEY (organization_id, preferred_supplier_id)
    REFERENCES management_suppliers (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_materials_values_check CHECK (
    planned_quantity > 0 AND
    (estimated_unit_cost IS NULL OR estimated_unit_cost >= 0)
  ),
  CONSTRAINT management_project_materials_text_check CHECK (
    btrim(name) <> '' AND btrim(unit) <> '' AND
    (category IS NULL OR btrim(category) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER management_project_materials_set_updated_at BEFORE UPDATE ON management_project_materials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_project_materials_project_idx ON management_project_materials (organization_id, project_id);
SELECT enable_tenant_rls('management_project_materials');

CREATE TABLE management_purchase_requests (
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  request_number       text NOT NULL,
  project_id           uuid NOT NULL,
  phase_id             uuid,
  requested_by_member_id uuid NOT NULL,
  reviewed_by_member_id uuid,
  supplier_id          uuid,
  request_date         date NOT NULL DEFAULT current_date,
  required_date        date,
  priority             text NOT NULL DEFAULT 'medium',
  status               text NOT NULL DEFAULT 'draft',
  approval_status      text NOT NULL DEFAULT 'not_requested',
  reason               text NOT NULL,
  currency_code        char(3) NOT NULL DEFAULT 'CDF',
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_purchase_requests_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_purchase_requests_number_unique UNIQUE (organization_id, request_number),
  CONSTRAINT management_purchase_requests_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_purchase_requests_phase_fk FOREIGN KEY (organization_id, phase_id)
    REFERENCES management_project_phases (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_purchase_requests_requester_fk FOREIGN KEY (organization_id, requested_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_purchase_requests_reviewer_fk FOREIGN KEY (organization_id, reviewed_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_purchase_requests_supplier_fk FOREIGN KEY (organization_id, supplier_id)
    REFERENCES management_suppliers (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_purchase_requests_priority_check CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT management_purchase_requests_status_check CHECK (status IN (
    'draft', 'submitted', 'under_review', 'approved', 'partially_approved',
    'rejected', 'ordered', 'closed', 'cancelled'
  )),
  CONSTRAINT management_purchase_requests_approval_check CHECK (approval_status IN (
    'not_requested', 'pending', 'approved', 'rejected', 'partially_approved'
  )),
  CONSTRAINT management_purchase_requests_dates_check CHECK (required_date IS NULL OR required_date >= request_date),
  CONSTRAINT management_purchase_requests_text_check CHECK (btrim(request_number) <> '' AND btrim(reason) <> '' AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER management_purchase_requests_set_updated_at BEFORE UPDATE ON management_purchase_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_purchase_requests_project_status_idx ON management_purchase_requests (organization_id, project_id, status);
SELECT enable_tenant_rls('management_purchase_requests');

CREATE TABLE management_purchase_request_lines (
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  purchase_request_id  uuid NOT NULL,
  project_material_id  uuid,
  inventory_item_id    uuid,
  description          text NOT NULL,
  item_kind            text NOT NULL DEFAULT 'material',
  unit                 text NOT NULL,
  requested_quantity   numeric(14,3) NOT NULL,
  approved_quantity    numeric(14,3) NOT NULL DEFAULT 0,
  estimated_unit_cost  numeric(16,2),
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_purchase_request_lines_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_purchase_request_lines_request_fk FOREIGN KEY (organization_id, purchase_request_id)
    REFERENCES management_purchase_requests (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_purchase_request_lines_material_fk FOREIGN KEY (organization_id, project_material_id)
    REFERENCES management_project_materials (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_purchase_request_lines_item_fk FOREIGN KEY (organization_id, inventory_item_id)
    REFERENCES management_inventory_items (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_purchase_request_lines_kind_check CHECK (item_kind IN ('material', 'inventory', 'asset', 'service', 'other')),
  CONSTRAINT management_purchase_request_lines_values_check CHECK (
    requested_quantity > 0 AND approved_quantity >= 0 AND approved_quantity <= requested_quantity AND
    (estimated_unit_cost IS NULL OR estimated_unit_cost >= 0)
  ),
  CONSTRAINT management_purchase_request_lines_text_check CHECK (btrim(description) <> '' AND btrim(unit) <> '' AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER management_purchase_request_lines_set_updated_at BEFORE UPDATE ON management_purchase_request_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_purchase_request_lines_request_idx ON management_purchase_request_lines (organization_id, purchase_request_id);
SELECT enable_tenant_rls('management_purchase_request_lines');

CREATE TABLE management_purchase_orders (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  order_number          text NOT NULL,
  project_id            uuid NOT NULL,
  phase_id              uuid,
  purchase_request_id   uuid,
  supplier_id           uuid NOT NULL,
  warehouse_id          uuid,
  ordered_by_member_id  uuid,
  order_date            date NOT NULL DEFAULT current_date,
  expected_delivery_date date,
  status                text NOT NULL DEFAULT 'draft',
  currency_code         char(3) NOT NULL DEFAULT 'CDF',
  supplier_reference    text,
  delivery_address      text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_purchase_orders_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_purchase_orders_number_unique UNIQUE (organization_id, order_number),
  CONSTRAINT management_purchase_orders_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_purchase_orders_phase_fk FOREIGN KEY (organization_id, phase_id)
    REFERENCES management_project_phases (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_purchase_orders_request_fk FOREIGN KEY (organization_id, purchase_request_id)
    REFERENCES management_purchase_requests (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_purchase_orders_supplier_fk FOREIGN KEY (organization_id, supplier_id)
    REFERENCES management_suppliers (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_purchase_orders_warehouse_fk FOREIGN KEY (organization_id, warehouse_id)
    REFERENCES management_warehouses (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_purchase_orders_ordered_by_fk FOREIGN KEY (organization_id, ordered_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_purchase_orders_status_check CHECK (status IN (
    'draft', 'sent', 'partially_received', 'received', 'closed', 'cancelled'
  )),
  CONSTRAINT management_purchase_orders_dates_check CHECK (expected_delivery_date IS NULL OR expected_delivery_date >= order_date),
  CONSTRAINT management_purchase_orders_text_check CHECK (
    btrim(order_number) <> '' AND
    (supplier_reference IS NULL OR btrim(supplier_reference) <> '') AND
    (delivery_address IS NULL OR btrim(delivery_address) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER management_purchase_orders_set_updated_at BEFORE UPDATE ON management_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_purchase_orders_project_status_idx ON management_purchase_orders (organization_id, project_id, status);
SELECT enable_tenant_rls('management_purchase_orders');

CREATE TABLE management_purchase_order_lines (
  id                     uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  purchase_order_id      uuid NOT NULL,
  purchase_request_line_id uuid,
  project_material_id    uuid,
  inventory_item_id      uuid,
  description            text NOT NULL,
  item_kind              text NOT NULL DEFAULT 'material',
  unit                   text NOT NULL,
  ordered_quantity       numeric(14,3) NOT NULL,
  unit_cost              numeric(16,2) NOT NULL,
  tax_amount             numeric(16,2) NOT NULL DEFAULT 0,
  asset_name             text,
  asset_category         text,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_purchase_order_lines_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_purchase_order_lines_order_fk FOREIGN KEY (organization_id, purchase_order_id)
    REFERENCES management_purchase_orders (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_purchase_order_lines_request_line_fk FOREIGN KEY (organization_id, purchase_request_line_id)
    REFERENCES management_purchase_request_lines (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_purchase_order_lines_material_fk FOREIGN KEY (organization_id, project_material_id)
    REFERENCES management_project_materials (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_purchase_order_lines_item_fk FOREIGN KEY (organization_id, inventory_item_id)
    REFERENCES management_inventory_items (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_purchase_order_lines_kind_check CHECK (item_kind IN ('material', 'inventory', 'asset', 'service', 'other')),
  CONSTRAINT management_purchase_order_lines_values_check CHECK (
    ordered_quantity > 0 AND unit_cost >= 0 AND tax_amount >= 0
  ),
  CONSTRAINT management_purchase_order_lines_text_check CHECK (
    btrim(description) <> '' AND btrim(unit) <> '' AND
    (asset_name IS NULL OR btrim(asset_name) <> '') AND
    (asset_category IS NULL OR btrim(asset_category) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER management_purchase_order_lines_set_updated_at BEFORE UPDATE ON management_purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_purchase_order_lines_order_idx ON management_purchase_order_lines (organization_id, purchase_order_id);
SELECT enable_tenant_rls('management_purchase_order_lines');

CREATE TABLE management_receipts (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  receipt_number        text NOT NULL,
  purchase_order_id     uuid NOT NULL,
  project_id            uuid NOT NULL,
  warehouse_id          uuid,
  received_by_member_id uuid NOT NULL,
  received_date         date NOT NULL DEFAULT current_date,
  delivery_note_number  text,
  status                text NOT NULL DEFAULT 'received',
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_receipts_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_receipts_number_unique UNIQUE (organization_id, receipt_number),
  CONSTRAINT management_receipts_order_fk FOREIGN KEY (organization_id, purchase_order_id)
    REFERENCES management_purchase_orders (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_receipts_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_receipts_warehouse_fk FOREIGN KEY (organization_id, warehouse_id)
    REFERENCES management_warehouses (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_receipts_receiver_fk FOREIGN KEY (organization_id, received_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_receipts_status_check CHECK (status IN ('draft', 'received', 'verified', 'rejected', 'cancelled')),
  CONSTRAINT management_receipts_text_check CHECK (
    btrim(receipt_number) <> '' AND
    (delivery_note_number IS NULL OR btrim(delivery_note_number) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER management_receipts_set_updated_at BEFORE UPDATE ON management_receipts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_receipts_order_idx ON management_receipts (organization_id, purchase_order_id, received_date DESC);
SELECT enable_tenant_rls('management_receipts');

CREATE TABLE management_receipt_lines (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  receipt_id            uuid NOT NULL,
  purchase_order_line_id uuid NOT NULL,
  project_material_id   uuid,
  inventory_item_id     uuid,
  received_quantity     numeric(14,3) NOT NULL,
  damaged_quantity      numeric(14,3) NOT NULL DEFAULT 0,
  rejected_quantity     numeric(14,3) NOT NULL DEFAULT 0,
  actual_unit_cost      numeric(16,2),
  asset_required        boolean NOT NULL DEFAULT false,
  asset_name            text,
  asset_category        text,
  receiver_notes        text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_receipt_lines_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_receipt_lines_receipt_fk FOREIGN KEY (organization_id, receipt_id)
    REFERENCES management_receipts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_receipt_lines_order_line_fk FOREIGN KEY (organization_id, purchase_order_line_id)
    REFERENCES management_purchase_order_lines (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_receipt_lines_material_fk FOREIGN KEY (organization_id, project_material_id)
    REFERENCES management_project_materials (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_receipt_lines_item_fk FOREIGN KEY (organization_id, inventory_item_id)
    REFERENCES management_inventory_items (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_receipt_lines_values_check CHECK (
    received_quantity > 0 AND damaged_quantity >= 0 AND rejected_quantity >= 0 AND
    damaged_quantity + rejected_quantity <= received_quantity AND
    (actual_unit_cost IS NULL OR actual_unit_cost >= 0)
  ),
  CONSTRAINT management_receipt_lines_asset_check CHECK (
    NOT asset_required OR (asset_name IS NOT NULL AND asset_category IS NOT NULL)
  ),
  CONSTRAINT management_receipt_lines_text_check CHECK (
    (asset_name IS NULL OR btrim(asset_name) <> '') AND
    (asset_category IS NULL OR btrim(asset_category) <> '') AND
    (receiver_notes IS NULL OR btrim(receiver_notes) <> '')
  )
);
CREATE TRIGGER management_receipt_lines_set_updated_at BEFORE UPDATE ON management_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_receipt_lines_receipt_idx ON management_receipt_lines (organization_id, receipt_id);
SELECT enable_tenant_rls('management_receipt_lines');

CREATE TABLE management_material_movements (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_material_id   uuid NOT NULL,
  warehouse_id          uuid,
  movement_date         date NOT NULL DEFAULT current_date,
  movement_type         text NOT NULL,
  quantity              numeric(14,3) NOT NULL,
  used_by_member_id     uuid,
  issued_by_member_id   uuid,
  project_task_id       uuid,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_material_movements_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_material_movements_material_fk FOREIGN KEY (organization_id, project_material_id)
    REFERENCES management_project_materials (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_material_movements_warehouse_fk FOREIGN KEY (organization_id, warehouse_id)
    REFERENCES management_warehouses (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_material_movements_used_by_fk FOREIGN KEY (organization_id, used_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_material_movements_issued_by_fk FOREIGN KEY (organization_id, issued_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_material_movements_task_fk FOREIGN KEY (organization_id, project_task_id)
    REFERENCES management_project_tasks (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_material_movements_type_check CHECK (movement_type IN (
    'used', 'returned', 'adjustment_in', 'adjustment_out', 'damaged'
  )),
  CONSTRAINT management_material_movements_quantity_check CHECK (quantity > 0),
  CONSTRAINT management_material_movements_text_check CHECK (notes IS NULL OR btrim(notes) <> '')
);
CREATE TRIGGER management_material_movements_set_updated_at BEFORE UPDATE ON management_material_movements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_material_movements_material_date_idx ON management_material_movements (organization_id, project_material_id, movement_date DESC);
SELECT enable_tenant_rls('management_material_movements');

CREATE TABLE management_inventory_stock_movements (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  warehouse_id          uuid NOT NULL,
  item_id               uuid NOT NULL,
  project_id            uuid,
  project_material_id   uuid,
  movement_date         date NOT NULL DEFAULT current_date,
  movement_type         text NOT NULL,
  quantity_delta        numeric(14,3) NOT NULL,
  unit_cost             numeric(16,2),
  reference_type        text,
  reference_id          uuid,
  performed_by_member_id uuid,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_stock_movements_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_stock_movements_warehouse_fk FOREIGN KEY (organization_id, warehouse_id)
    REFERENCES management_warehouses (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_stock_movements_item_fk FOREIGN KEY (organization_id, item_id)
    REFERENCES management_inventory_items (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_stock_movements_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_stock_movements_material_fk FOREIGN KEY (organization_id, project_material_id)
    REFERENCES management_project_materials (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_stock_movements_member_fk FOREIGN KEY (organization_id, performed_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_stock_movements_type_check CHECK (movement_type IN (
    'receipt', 'issue', 'return', 'adjustment_in', 'adjustment_out', 'transfer_in', 'transfer_out', 'maintenance_issue'
  )),
  CONSTRAINT management_stock_movements_delta_check CHECK (quantity_delta <> 0),
  CONSTRAINT management_stock_movements_cost_check CHECK (unit_cost IS NULL OR unit_cost >= 0),
  CONSTRAINT management_stock_movements_text_check CHECK (
    (reference_type IS NULL OR btrim(reference_type) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE INDEX management_stock_movements_stock_date_idx ON management_inventory_stock_movements (organization_id, warehouse_id, item_id, movement_date DESC);
SELECT enable_tenant_rls('management_inventory_stock_movements');

CREATE TABLE management_expenses (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  expense_number        text NOT NULL,
  project_id            uuid,
  phase_id              uuid,
  province_id           uuid NOT NULL,
  site_id               uuid,
  department_id         uuid,
  supplier_id           uuid,
  purchase_order_id     uuid,
  receipt_id            uuid,
  category              text NOT NULL,
  description           text NOT NULL,
  amount                numeric(16,2) NOT NULL,
  currency_code         char(3) NOT NULL DEFAULT 'CDF',
  expense_date          date NOT NULL DEFAULT current_date,
  payment_method        text,
  paid_by_member_id     uuid,
  approved_by_member_id uuid,
  status                text NOT NULL DEFAULT 'draft',
  receipt_reference     text,
  notes                 text,
  created_by_user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_expenses_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_expenses_number_unique UNIQUE (organization_id, expense_number),
  CONSTRAINT management_expenses_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_expenses_phase_fk FOREIGN KEY (organization_id, phase_id)
    REFERENCES management_project_phases (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_expenses_province_fk FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_expenses_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_expenses_department_fk FOREIGN KEY (organization_id, department_id)
    REFERENCES departments (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_expenses_supplier_fk FOREIGN KEY (organization_id, supplier_id)
    REFERENCES management_suppliers (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_expenses_order_fk FOREIGN KEY (organization_id, purchase_order_id)
    REFERENCES management_purchase_orders (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_expenses_receipt_fk FOREIGN KEY (organization_id, receipt_id)
    REFERENCES management_receipts (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_expenses_paid_by_fk FOREIGN KEY (organization_id, paid_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_expenses_approved_by_fk FOREIGN KEY (organization_id, approved_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_expenses_amount_check CHECK (amount >= 0),
  CONSTRAINT management_expenses_status_check CHECK (status IN (
    'draft', 'submitted', 'approved', 'paid', 'rejected', 'void'
  )),
  CONSTRAINT management_expenses_text_check CHECK (
    btrim(expense_number) <> '' AND btrim(category) <> '' AND btrim(description) <> '' AND
    (payment_method IS NULL OR btrim(payment_method) <> '') AND
    (receipt_reference IS NULL OR btrim(receipt_reference) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  )
);
CREATE TRIGGER management_expenses_set_updated_at BEFORE UPDATE ON management_expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX management_expenses_project_status_idx ON management_expenses (organization_id, project_id, status) WHERE project_id IS NOT NULL;
CREATE INDEX management_expenses_province_date_idx ON management_expenses (organization_id, province_id, expense_date DESC);
SELECT enable_tenant_rls('management_expenses');

CREATE TABLE management_approval_requests (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  approval_number       text NOT NULL,
  project_id            uuid,
  entity_type           text NOT NULL,
  entity_id             uuid NOT NULL,
  request_type          text NOT NULL,
  requested_by_member_id uuid NOT NULL,
  requested_amount      numeric(16,2),
  currency_code         char(3) NOT NULL DEFAULT 'CDF',
  status                text NOT NULL DEFAULT 'pending',
  decided_by_member_id  uuid,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  decided_at            timestamptz,
  request_notes         text,
  decision_notes        text,
  PRIMARY KEY (id),
  CONSTRAINT management_approval_requests_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_approval_requests_number_unique UNIQUE (organization_id, approval_number),
  CONSTRAINT management_approval_requests_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_approval_requests_requester_fk FOREIGN KEY (organization_id, requested_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_approval_requests_decider_fk FOREIGN KEY (organization_id, decided_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_approval_requests_type_check CHECK (request_type IN (
    'purchase_request', 'expense', 'material_adjustment', 'asset_purchase',
    'asset_disposal', 'maintenance_expense', 'budget_increase', 'phase_completion', 'other'
  )),
  CONSTRAINT management_approval_requests_status_check CHECK (status IN (
    'pending', 'approved', 'rejected', 'partially_approved', 'cancelled'
  )),
  CONSTRAINT management_approval_requests_amount_check CHECK (requested_amount IS NULL OR requested_amount >= 0),
  CONSTRAINT management_approval_requests_text_check CHECK (
    btrim(approval_number) <> '' AND btrim(entity_type) <> '' AND
    (request_notes IS NULL OR btrim(request_notes) <> '') AND
    (decision_notes IS NULL OR btrim(decision_notes) <> '')
  )
);
CREATE INDEX management_approval_requests_project_status_idx ON management_approval_requests (organization_id, project_id, status);
SELECT enable_tenant_rls('management_approval_requests');

CREATE TABLE management_document_links (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id            uuid,
  entity_type           text NOT NULL,
  entity_id             uuid NOT NULL,
  title                 text NOT NULL,
  document_type         text,
  storage_key           text NOT NULL,
  mime_type             text,
  file_size_bytes       bigint,
  uploaded_by_member_id uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_document_links_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_document_links_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_document_links_member_fk FOREIGN KEY (organization_id, uploaded_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_document_links_size_check CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  CONSTRAINT management_document_links_text_check CHECK (
    btrim(entity_type) <> '' AND btrim(title) <> '' AND btrim(storage_key) <> '' AND
    (document_type IS NULL OR btrim(document_type) <> '') AND
    (mime_type IS NULL OR btrim(mime_type) <> '')
  )
);
CREATE INDEX management_document_links_project_idx ON management_document_links (organization_id, project_id) WHERE project_id IS NOT NULL;
CREATE INDEX management_document_links_entity_idx ON management_document_links (organization_id, entity_type, entity_id);
SELECT enable_tenant_rls('management_document_links');

-- New organizations receive the Project Manager role through presets. Existing
-- Congo Omega receives the role and matching role permissions immediately.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'project_manager', p.code
  FROM permissions p
 WHERE (p.resource IN ('projects', 'tasks', 'procurement', 'documents') AND p.action IN ('create', 'read', 'update'))
    OR (p.resource IN ('approvals', 'reports') AND p.action = 'read')
    OR (p.resource = 'finance.expenses' AND p.action IN ('create', 'read', 'update'))
    OR (p.action = 'read' AND p.resource IN ('sites', 'departments', 'employees', 'suppliers', 'inventory.items', 'inventory.stock'))
ON CONFLICT DO NOTHING;

INSERT INTO roles
  (organization_id, code, name, description, level, data_scope, is_system)
SELECT o.id, rp.code, rp.name, rp.description, rp.level, rp.data_scope, true
  FROM organizations o
  JOIN role_presets rp ON rp.code = 'project_manager'
 WHERE o.slug = 'congo-omega'
ON CONFLICT (organization_id, code) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      level = EXCLUDED.level, data_scope = EXCLUDED.data_scope, is_system = true;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
  FROM roles r
  JOIN organizations o ON o.id = r.organization_id
  JOIN role_preset_permissions rpp ON rpp.role_preset_code = r.code
  JOIN permissions p ON p.code = rpp.permission_code
 WHERE o.slug = 'congo-omega' AND r.code = 'project_manager'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE management_projects IS 'Organization projects with location, manager, blueprint and budget context.';
COMMENT ON TABLE management_receipt_lines IS 'Received, damaged and rejected quantities. Only accepted quantity enters stock.';
COMMENT ON TABLE management_inventory_stock_movements IS 'Immutable stock ledger. The current stock table is the fast, current balance.';
