BEGIN;

-- The visitor pressed "Parler à l'équipe" themselves.  An AI suggestion to
-- involve the team can be withdrawn (the visitor declined); this cannot.
ALTER TABLE website_chat_sessions
  ADD COLUMN IF NOT EXISTS human_requested boolean NOT NULL DEFAULT false;

COMMIT;
