-- 064_notification_centre.sql
-- Turns the original alert-inbox table into the shared LiteHubs notification
-- centre.  The existing columns remain for backwards compatibility; the new
-- columns give every item an explicit recipient, priority, lifecycle and
-- idempotency key.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS province_id uuid,
  ADD COLUMN IF NOT EXISTS recipient_user_id uuid,
  ADD COLUMN IF NOT EXISTS recipient_employee_id uuid,
  ADD COLUMN IF NOT EXISTS actor_user_id uuid,
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS action_url text,
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS deduplication_key text,
  ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_delivery_attempt_at timestamptz;

-- Preserve records created by the first notification migration.
UPDATE notifications n
   SET recipient_user_id = m.user_id,
       message = COALESCE(n.message, n.body),
       action_url = COALESCE(n.action_url, n.link_path),
       entity_type = COALESCE(n.entity_type, n.subject_table),
       entity_id = COALESCE(n.entity_id, n.subject_id),
       is_read = COALESCE(n.is_read, n.read_at IS NOT NULL),
       deduplication_key = n.deduplication_key
  FROM organization_members m
 WHERE m.organization_id = n.organization_id
   AND m.id = n.member_id;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_province_v2_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL,
  ADD CONSTRAINT notifications_recipient_employee_v2_fk
    FOREIGN KEY (organization_id, recipient_employee_id)
    REFERENCES employees (organization_id, id) ON DELETE SET NULL,
  ADD CONSTRAINT notifications_priority_v2_check
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  ADD CONSTRAINT notifications_action_url_v2_check
    CHECK (action_url IS NULL OR action_url ~ '^/'),
  ADD CONSTRAINT notifications_entity_v2_complete
    CHECK ((entity_type IS NULL) = (entity_id IS NULL)),
  ADD CONSTRAINT notifications_archive_v2_complete
    CHECK (NOT is_archived OR archived_at IS NOT NULL),
  ADD CONSTRAINT notifications_delivery_attempts_v2_check
    CHECK (delivery_attempts >= 0);

ALTER TABLE notifications DROP CONSTRAINT notifications_category_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_category_v2_check
    CHECK (category IN (
      'general', 'alert', 'escalation', 'approval', 'task', 'project',
      'leave', 'payroll', 'training', 'invitation', 'maintenance',
      'inventory', 'procurement', 'finance', 'document', 'contract',
      'attendance', 'schedule', 'discipline', 'incident', 'security',
      'poultry', 'pigs', 'agriculture', 'veterinary', 'report'
    ));

ALTER TABLE notification_preferences DROP CONSTRAINT notification_preferences_category_check;
ALTER TABLE notification_preferences
  ADD CONSTRAINT notification_preferences_category_v2_check
    CHECK (category IN (
      'general', 'alert', 'escalation', 'approval', 'task', 'project',
      'leave', 'payroll', 'training', 'invitation', 'maintenance',
      'inventory', 'procurement', 'finance', 'document', 'contract',
      'attendance', 'schedule', 'discipline', 'incident', 'security',
      'poultry', 'pigs', 'agriculture', 'veterinary', 'report'
    ));

CREATE TRIGGER notifications_set_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX notifications_recipient_inbox_v2_idx
  ON notifications (organization_id, recipient_user_id, created_at DESC)
  WHERE is_archived = false;
CREATE INDEX notifications_recipient_unread_v2_idx
  ON notifications (organization_id, recipient_user_id, created_at DESC)
  WHERE is_archived = false AND is_read = false;
CREATE INDEX notifications_province_v2_idx
  ON notifications (organization_id, province_id, created_at DESC)
  WHERE province_id IS NOT NULL;
CREATE UNIQUE INDEX notifications_deduplication_v2_idx
  ON notifications (organization_id, deduplication_key)
  WHERE deduplication_key IS NOT NULL;
CREATE INDEX notifications_expiry_v2_idx
  ON notifications (organization_id, expires_at)
  WHERE expires_at IS NOT NULL AND is_archived = false;

CREATE TABLE notification_profile_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  in_app_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT false,
  sms_enabled boolean NOT NULL DEFAULT false,
  push_enabled boolean NOT NULL DEFAULT false,
  digest_frequency text NOT NULL DEFAULT 'none',
  quiet_hours_start time,
  quiet_hours_end time,
  preferred_language text NOT NULL DEFAULT 'fr',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_profile_preferences_unique
    UNIQUE (organization_id, member_id),
  CONSTRAINT notification_profile_preferences_member_fk
    FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT notification_profile_preferences_digest_check
    CHECK (digest_frequency IN ('none', 'daily', 'weekly')),
  CONSTRAINT notification_profile_preferences_language_check
    CHECK (preferred_language IN ('fr', 'en'))
);
CREATE TRIGGER notification_profile_preferences_set_updated_at
  BEFORE UPDATE ON notification_profile_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX notification_profile_preferences_member_idx
  ON notification_profile_preferences (organization_id, member_id);
SELECT enable_tenant_rls('notification_profile_preferences');

-- A controlled system function lets the scheduler enumerate tenant ids without
-- weakening row-level policies on operational tables.
CREATE OR REPLACE FUNCTION notification_scheduler_organization_ids()
RETURNS TABLE (organization_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM organizations
$$;
REVOKE ALL ON FUNCTION notification_scheduler_organization_ids() FROM PUBLIC;

-- A fresh Railway database may run migrations before the least-privilege API
-- role is provisioned by db:setup. Do not make schema setup depend on that
-- later operational step; grant this controlled scheduler capability whenever
-- the application role exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'litehubs_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION notification_scheduler_organization_ids() TO litehubs_app';
  END IF;
END;
$$;