-- Owner-configurable content displayed only when this site’s public queue is empty.
ALTER TABLE appointment_site_settings
  ADD COLUMN IF NOT EXISTS idle_display_title text,
  ADD COLUMN IF NOT EXISTS idle_display_message text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointment_site_settings_idle_display_title_length') THEN
    ALTER TABLE appointment_site_settings
      ADD CONSTRAINT appointment_site_settings_idle_display_title_length
      CHECK (idle_display_title IS NULL OR char_length(idle_display_title) <= 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointment_site_settings_idle_display_message_length') THEN
    ALTER TABLE appointment_site_settings
      ADD CONSTRAINT appointment_site_settings_idle_display_message_length
      CHECK (idle_display_message IS NULL OR char_length(idle_display_message) <= 600);
  END IF;
END $$;