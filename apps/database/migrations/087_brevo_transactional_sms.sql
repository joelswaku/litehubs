-- 087_brevo_transactional_sms.sql
-- Preserve a separate audit record for each Brevo transactional SMS attempt.

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_channel_check;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_channel_check
  CHECK (notification_channel IS NULL OR notification_channel IN ('email', 'brevo_sms', 'manual_sms', 'manual_call', 'none'));

ALTER TABLE appointment_messages DROP CONSTRAINT IF EXISTS appointment_messages_channel_check;
ALTER TABLE appointment_messages
  ADD CONSTRAINT appointment_messages_channel_check
  CHECK (channel IN ('email', 'brevo_sms', 'manual_sms', 'manual_call', 'system'));

COMMENT ON COLUMN appointments.notification_channel IS 'Most recent delivery channel: email, Brevo SMS, manual SMS, manual call, or none.';