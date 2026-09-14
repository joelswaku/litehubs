-- 086_appointment_references_and_localized_messages.sql
-- A permanent human-readable reference is assigned to every appointment.
-- It is safe to share with the visitor and unique within each organization.

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reference text;

UPDATE appointments
SET reference = 'RDV-' || upper(replace(id::text, '-', ''))
WHERE reference IS NULL;

ALTER TABLE appointments
  ALTER COLUMN reference SET DEFAULT ('RDV-' || upper(replace(gen_random_uuid()::text, '-', ''))),
  ALTER COLUMN reference SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_reference_unique
  ON appointments(organization_id, reference);

COMMENT ON COLUMN appointments.reference IS 'Stable visitor-facing appointment reference. Safe to share in confirmation emails and the queue workspace.';