BEGIN;

-- Hostinger aliases (recrutement@, contact@…) have no password of their own:
-- they deliver into a main mailbox and can be used as the sender address
-- with that mailbox's login.
ALTER TABLE organization_mailboxes
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';

COMMIT;
