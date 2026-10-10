BEGIN;

-- Name shown in the chat instead of the real names of the owner, general
-- managers and authorised members (e.g. "Direction", "Direction Congo Omega").
ALTER TABLE chat_settings
  ADD COLUMN IF NOT EXISTS direction_label text NOT NULL DEFAULT 'Direction';

COMMIT;
