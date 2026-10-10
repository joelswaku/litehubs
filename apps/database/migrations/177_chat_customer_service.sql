BEGIN;

-- Customer service: the members who answer website visitors.  Only they (and
-- the owner) see the "Clients du site" tab and receive visitor alerts.
ALTER TABLE chat_access
  ADD COLUMN IF NOT EXISTS can_website boolean NOT NULL DEFAULT false;

COMMIT;
