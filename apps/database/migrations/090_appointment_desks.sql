-- 090_appointment_desks.sql
-- A bank-style shared queue: many reception desks can independently call the
-- next waiting visitor from one site queue without creating parallel queues.

CREATE TABLE appointment_desks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  active_member_id uuid,
  claimed_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_desks_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT appointment_desks_code_unique UNIQUE (organization_id, site_id, code),
  CONSTRAINT appointment_desks_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES sites(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT appointment_desks_active_member_fk FOREIGN KEY (organization_id, active_member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE SET NULL,
  CONSTRAINT appointment_desks_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT appointment_desks_name_not_blank CHECK (btrim(name) <> '')
);
CREATE TRIGGER appointment_desks_set_updated_at
  BEFORE UPDATE ON appointment_desks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX appointment_desks_site_active_idx
  ON appointment_desks(organization_id, site_id, is_active, name);
SELECT enable_tenant_rls('appointment_desks');

ALTER TABLE appointments ADD COLUMN desk_id uuid;
ALTER TABLE appointments ADD CONSTRAINT appointments_desk_fk
  FOREIGN KEY (organization_id, desk_id)
  REFERENCES appointment_desks(organization_id, id) ON DELETE SET NULL;
CREATE INDEX appointments_live_queue_desk_idx
  ON appointments(organization_id, site_id, desk_id, queue_date, status)
  WHERE status IN ('called', 'serving');

COMMENT ON TABLE appointment_desks IS 'Operator workstations for one shared site queue; desks never create separate visitor lines.';
COMMENT ON COLUMN appointments.desk_id IS 'Desk that called or served a queued visitor; waiting visitors remain unassigned in one shared queue.';