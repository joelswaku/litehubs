-- A site administrator defines the safe public message read on the queue display.
-- Agents can use it but cannot inject a different message into the public TV feed.
ALTER TABLE appointment_site_settings
  ADD COLUMN IF NOT EXISTS default_queue_call_message text;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS queue_call_message text;