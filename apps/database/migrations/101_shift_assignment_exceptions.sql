-- 101_shift_assignment_exceptions.sql
-- Employee-specific, date-bound overrides to a recurring weekly shift.

CREATE TABLE shift_assignment_exceptions (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  shift_assignment_id uuid NOT NULL,
  work_date           date NOT NULL,
  is_working          boolean NOT NULL,
  starts_at           time,
  ends_at             time,
  break_minutes       integer NOT NULL DEFAULT 0,
  note                text,
  created_by          uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT shift_assignment_exceptions_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT shift_assignment_exceptions_one_per_day UNIQUE (organization_id, shift_assignment_id, work_date),
  CONSTRAINT shift_assignment_exceptions_assignment_fk
    FOREIGN KEY (organization_id, shift_assignment_id)
    REFERENCES shift_assignments (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT shift_assignment_exceptions_break_check
    CHECK (break_minutes >= 0 AND break_minutes <= 720),
  CONSTRAINT shift_assignment_exceptions_time_check
    CHECK (
      (NOT is_working AND starts_at IS NULL AND ends_at IS NULL AND break_minutes = 0)
      OR (is_working AND starts_at IS NOT NULL AND ends_at IS NOT NULL)
    ),
  CONSTRAINT shift_assignment_exceptions_note_not_blank
    CHECK (note IS NULL OR btrim(note) <> '')
);

CREATE TRIGGER shift_assignment_exceptions_set_updated_at
  BEFORE UPDATE ON shift_assignment_exceptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX shift_assignment_exceptions_lookup_idx
  ON shift_assignment_exceptions (organization_id, shift_assignment_id, work_date);

SELECT enable_tenant_rls('shift_assignment_exceptions');

COMMENT ON TABLE shift_assignment_exceptions IS
  'One-off employee work/rest overrides. They override only one assignment on one date and never modify the recurring weekly shift.';