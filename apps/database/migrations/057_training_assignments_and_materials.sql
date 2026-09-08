-- 057_training_assignments_and_materials.sql
-- Turns the existing course/certificate register into an operational learning
-- workflow: an employee can be assigned a course and complete its materials.

CREATE TABLE training_materials (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  course_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  material_type text NOT NULL DEFAULT 'document',
  external_url text,
  document_id uuid,
  sort_order integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT training_materials_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT training_materials_course_fk
    FOREIGN KEY (organization_id, course_id)
    REFERENCES training_courses (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT training_materials_type_check
    CHECK (material_type IN ('document', 'video', 'link', 'assessment', 'other')),
  CONSTRAINT training_materials_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT training_materials_url_or_document
    CHECK (external_url IS NOT NULL OR document_id IS NOT NULL),
  CONSTRAINT training_materials_sort_order_non_negative CHECK (sort_order >= 0)
);

CREATE TRIGGER training_materials_set_updated_at
  BEFORE UPDATE ON training_materials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX training_materials_course_idx
  ON training_materials (organization_id, course_id, is_active, sort_order);

SELECT enable_tenant_rls('training_materials');

CREATE TABLE training_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  course_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  province_id uuid,
  site_id uuid,
  assigned_by uuid REFERENCES users (id) ON DELETE SET NULL,
  assigned_on date NOT NULL DEFAULT CURRENT_DATE,
  due_on date,
  status text NOT NULL DEFAULT 'assigned',
  started_on date,
  completed_on date,
  score numeric(5,2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT training_assignments_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT training_assignments_course_fk
    FOREIGN KEY (organization_id, course_id)
    REFERENCES training_courses (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT training_assignments_employee_fk
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT training_assignments_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT training_assignments_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL (site_id),
  CONSTRAINT training_assignments_status_check
    CHECK (status IN ('assigned', 'in_progress', 'completed', 'overdue', 'waived')),
  CONSTRAINT training_assignments_score_range CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  CONSTRAINT training_assignments_due_after_assignment CHECK (due_on IS NULL OR due_on >= assigned_on),
  CONSTRAINT training_assignments_completion_date
    CHECK ((status = 'completed' AND completed_on IS NOT NULL) OR status <> 'completed')
);

CREATE TRIGGER training_assignments_set_updated_at
  BEFORE UPDATE ON training_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX training_assignments_employee_idx
  ON training_assignments (organization_id, employee_id, status, due_on);
CREATE INDEX training_assignments_course_idx
  ON training_assignments (organization_id, course_id, status, due_on);
CREATE UNIQUE INDEX training_assignments_unique_open_course
  ON training_assignments (organization_id, course_id, employee_id)
  WHERE status IN ('assigned', 'in_progress', 'overdue');

SELECT enable_tenant_rls('training_assignments');

-- Employees need to see their own assignments and mark progress/completion.
-- The API limits these grants to their own linked employee record.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
VALUES ('employee', 'training.read'), ('employee', 'training.update')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('training.read', 'training.update')
WHERE r.code = 'employee' AND r.is_system = true
ON CONFLICT DO NOTHING;
