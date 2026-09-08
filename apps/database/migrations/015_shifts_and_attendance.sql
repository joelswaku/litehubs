-- 015_shifts_and_attendance.sql
-- Operational shift schedules, employee assignments and attendance records.

CREATE TABLE shifts (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  province_id     uuid NOT NULL,
  site_id         uuid NOT NULL,
  department_id   uuid,
  code            text NOT NULL,
  name            text NOT NULL,
  starts_at       time NOT NULL,
  ends_at         time NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT shifts_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT shifts_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT shifts_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT shifts_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT shifts_department_fk
    FOREIGN KEY (organization_id, department_id)
    REFERENCES departments (organization_id, id) ON DELETE SET NULL (department_id),
  CONSTRAINT shifts_code_format
    CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT shifts_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT shifts_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE TRIGGER shifts_set_updated_at
  BEFORE UPDATE ON shifts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX shifts_location_idx
  ON shifts (organization_id, province_id, site_id)
  WHERE is_active;

SELECT enable_tenant_rls('shifts');

CREATE TABLE shift_assignments (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  shift_id        uuid NOT NULL,
  employee_id     uuid NOT NULL,
  effective_from  date NOT NULL DEFAULT CURRENT_DATE,
  effective_to    date,
  assigned_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT shift_assignments_unique UNIQUE (organization_id, shift_id, employee_id),
  CONSTRAINT shift_assignments_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT shift_assignments_shift_fk
    FOREIGN KEY (organization_id, shift_id)
    REFERENCES shifts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT shift_assignments_employee_fk
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT shift_assignments_dates_check
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TRIGGER shift_assignments_set_updated_at
  BEFORE UPDATE ON shift_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX shift_assignments_employee_idx
  ON shift_assignments (organization_id, employee_id, effective_from);

SELECT enable_tenant_rls('shift_assignments');

CREATE TABLE attendance_records (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  employee_id         uuid NOT NULL,
  shift_id            uuid,
  province_id         uuid NOT NULL,
  site_id             uuid NOT NULL,
  department_id       uuid,
  work_date           date NOT NULL,
  status              text NOT NULL DEFAULT 'present',
  clock_in_at         timestamptz,
  clock_out_at        timestamptz,
  clock_in_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  clock_out_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  correction_note     text,
  approved_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  approved_at         timestamptz,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT attendance_employee_day_unique UNIQUE (organization_id, employee_id, work_date),
  CONSTRAINT attendance_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT attendance_employee_fk
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT attendance_shift_fk
    FOREIGN KEY (organization_id, shift_id)
    REFERENCES shifts (organization_id, id) ON DELETE SET NULL (shift_id),
  CONSTRAINT attendance_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT attendance_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT attendance_department_fk
    FOREIGN KEY (organization_id, department_id)
    REFERENCES departments (organization_id, id) ON DELETE SET NULL (department_id),
  CONSTRAINT attendance_status_check
    CHECK (status IN ('present', 'late', 'absent', 'leave')),
  CONSTRAINT attendance_time_order_check
    CHECK (clock_out_at IS NULL OR clock_in_at IS NULL OR clock_out_at >= clock_in_at),
  CONSTRAINT attendance_correction_not_blank
    CHECK (correction_note IS NULL OR btrim(correction_note) <> ''),
  CONSTRAINT attendance_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> '')
);

CREATE TRIGGER attendance_records_set_updated_at
  BEFORE UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX attendance_employee_date_idx
  ON attendance_records (organization_id, employee_id, work_date DESC);
CREATE INDEX attendance_location_date_idx
  ON attendance_records (organization_id, province_id, work_date DESC);

SELECT enable_tenant_rls('attendance_records');

COMMENT ON TABLE shifts IS
  'Operational shift templates for a farm/site and optional department.';
COMMENT ON TABLE shift_assignments IS
  'Effective-date assignments connecting employee profiles to a shift.';
COMMENT ON TABLE attendance_records IS
  'One attendance record per employee per work date, recorded using the employee number.';
