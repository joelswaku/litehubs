-- 083_appointments.sql
-- Site-scoped appointments and visitor queue. Online booking, QR self check-in
-- and staff-created visits are one shared appointment record; this never
-- copies a visitor into the security visitor register.

CREATE TABLE appointment_site_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL,
  public_booking_enabled boolean NOT NULL DEFAULT false,
  qr_checkin_enabled boolean NOT NULL DEFAULT false,
  queue_display_enabled boolean NOT NULL DEFAULT false,
  checkin_token uuid NOT NULL DEFAULT gen_random_uuid(),
  booking_opens_at time NOT NULL DEFAULT '08:00',
  booking_closes_at time NOT NULL DEFAULT '17:00',
  slot_interval_minutes integer NOT NULL DEFAULT 30,
  default_service_minutes integer NOT NULL DEFAULT 20,
  welcome_message text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_site_settings_site_unique UNIQUE (organization_id, site_id),
  CONSTRAINT appointment_site_settings_token_unique UNIQUE (checkin_token),
  CONSTRAINT appointment_site_settings_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES sites(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT appointment_site_settings_booking_window CHECK (booking_closes_at > booking_opens_at),
  CONSTRAINT appointment_site_settings_slot_range CHECK (slot_interval_minutes BETWEEN 5 AND 240),
  CONSTRAINT appointment_site_settings_duration_range CHECK (default_service_minutes BETWEEN 5 AND 480)
);
CREATE TRIGGER appointment_site_settings_set_updated_at
  BEFORE UPDATE ON appointment_site_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT enable_tenant_rls('appointment_site_settings');

CREATE TABLE appointment_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  duration_minutes integer NOT NULL DEFAULT 20,
  allows_online_booking boolean NOT NULL DEFAULT true,
  allows_qr_checkin boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_services_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT appointment_services_code_unique UNIQUE (organization_id, site_id, code),
  CONSTRAINT appointment_services_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES sites(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT appointment_services_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT appointment_services_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT appointment_services_duration_range CHECK (duration_minutes BETWEEN 5 AND 480)
);
CREATE TRIGGER appointment_services_set_updated_at
  BEFORE UPDATE ON appointment_services FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX appointment_services_active_idx ON appointment_services(organization_id, site_id) WHERE is_active;
SELECT enable_tenant_rls('appointment_services');

-- A counter row makes ticket allocation concurrency-safe.
CREATE TABLE appointment_queue_counters (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL,
  queue_date date NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, site_id, queue_date),
  CONSTRAINT appointment_queue_counters_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES sites(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT appointment_queue_counters_number_check CHECK (last_number >= 0)
);
SELECT enable_tenant_rls('appointment_queue_counters');

CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  province_id uuid NOT NULL,
  site_id uuid NOT NULL,
  service_id uuid,
  assigned_member_id uuid,
  queue_date date,
  queue_number integer,
  source text NOT NULL,
  visitor_name text NOT NULL,
  visitor_email citext,
  visitor_phone text,
  reason text,
  scheduled_at timestamptz,
  expected_duration_minutes integer NOT NULL DEFAULT 20,
  status text NOT NULL DEFAULT 'scheduled',
  checked_in_at timestamptz,
  waiting_since timestamptz,
  called_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  no_show_at timestamptz,
  notification_channel text,
  last_notified_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT appointments_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES sites(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT appointments_province_fk FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT appointments_service_fk FOREIGN KEY (organization_id, service_id)
    REFERENCES appointment_services(organization_id, id) ON DELETE SET NULL,
  CONSTRAINT appointments_assignee_fk FOREIGN KEY (organization_id, assigned_member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE SET NULL,
  CONSTRAINT appointments_source_check CHECK (source IN ('online', 'qr', 'staff')),
  CONSTRAINT appointments_status_check CHECK (status IN ('scheduled', 'checked_in', 'waiting', 'called', 'serving', 'completed', 'cancelled', 'no_show')),
  CONSTRAINT appointments_channel_check CHECK (notification_channel IS NULL OR notification_channel IN ('email', 'manual_sms', 'manual_call', 'none')),
  CONSTRAINT appointments_name_not_blank CHECK (btrim(visitor_name) <> ''),
  CONSTRAINT appointments_duration_range CHECK (expected_duration_minutes BETWEEN 5 AND 480),
  CONSTRAINT appointments_queue_shape CHECK ((queue_number IS NULL AND queue_date IS NULL) OR (queue_number IS NOT NULL AND queue_date IS NOT NULL)),
  CONSTRAINT appointments_queue_number_check CHECK (queue_number IS NULL OR queue_number > 0),
  CONSTRAINT appointments_contact_present CHECK (visitor_email IS NOT NULL OR visitor_phone IS NOT NULL OR source = 'staff')
);
CREATE TRIGGER appointments_set_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE UNIQUE INDEX appointments_queue_ticket_unique
  ON appointments(organization_id, site_id, queue_date, queue_number) WHERE queue_number IS NOT NULL;
CREATE INDEX appointments_live_queue_idx
  ON appointments(organization_id, site_id, queue_date, status, waiting_since, created_at)
  WHERE status IN ('checked_in', 'waiting', 'called', 'serving');
CREATE INDEX appointments_schedule_idx ON appointments(organization_id, site_id, scheduled_at);
CREATE INDEX appointments_province_idx ON appointments(organization_id, province_id, created_at DESC);
SELECT enable_tenant_rls('appointments');

CREATE TABLE appointment_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL,
  channel text NOT NULL,
  status text NOT NULL,
  recipient text,
  body text NOT NULL,
  sent_at timestamptz,
  error_message text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_messages_appointment_fk FOREIGN KEY (organization_id, appointment_id)
    REFERENCES appointments(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT appointment_messages_channel_check CHECK (channel IN ('email', 'manual_sms', 'manual_call', 'system')),
  CONSTRAINT appointment_messages_status_check CHECK (status IN ('sent', 'pending_manual', 'failed', 'not_required'))
);
CREATE INDEX appointment_messages_appointment_idx ON appointment_messages(organization_id, appointment_id, created_at DESC);
SELECT enable_tenant_rls('appointment_messages');

CREATE TABLE appointment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_events_appointment_fk FOREIGN KEY (organization_id, appointment_id)
    REFERENCES appointments(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX appointment_events_appointment_idx ON appointment_events(organization_id, appointment_id, created_at DESC);
SELECT enable_tenant_rls('appointment_events');

INSERT INTO permissions(code, resource, action, module_code, description)
VALUES
  ('appointments.read', 'appointments', 'read', 'appointments', 'View appointments and site queues'),
  ('appointments.create', 'appointments', 'create', 'appointments', 'Create appointments, services and site queue settings'),
  ('appointments.update', 'appointments', 'update', 'appointments', 'Call, serve, complete and update appointments'),
  ('appointments.delete', 'appointments', 'delete', 'appointments', 'Cancel or remove appointments')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_preset_permissions(role_preset_code, permission_code)
SELECT rp.code, p.code FROM role_presets rp CROSS JOIN permissions p
WHERE rp.code IN ('owner', 'general_manager', 'farm_operations_manager', 'farm_manager', 'hr_officer', 'security_officer')
  AND p.resource = 'appointments'
ON CONFLICT DO NOTHING;
INSERT INTO role_preset_permissions(role_preset_code, permission_code)
SELECT rp.code, p.code FROM role_presets rp CROSS JOIN permissions p
WHERE rp.code IN ('provincial_manager', 'supervisor')
  AND p.resource = 'appointments' AND p.action IN ('read', 'create', 'update')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('owner', 'general_manager', 'farm_operations_manager', 'farm_manager', 'hr_officer', 'security_officer')
  AND p.resource = 'appointments'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('provincial_manager', 'supervisor')
  AND p.resource = 'appointments' AND p.action IN ('read', 'create', 'update')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE appointments IS 'One site-scoped appointment and visitor queue record, created online, by QR or staff.';
