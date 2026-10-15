-- 196_appointment_contact_preference.sql
-- A visitor chooses how to be told about their appointment: e-mail or SMS.
-- Messages go to that channel only; the other is used only if it fails.
-- NULL (older appointments, no choice) means e-mail first.

BEGIN;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS contact_preference text;
ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_contact_preference_check;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_contact_preference_check
  CHECK (contact_preference IS NULL OR contact_preference IN ('email', 'sms'));

COMMIT;
