-- 200_chat_off_topic_guard.sql
-- The website / Messenger / Instagram assistant only answers questions about
-- the company. Off-topic requests (poems, stories, homework, politics…) and
-- photos / videos get a short fixed reply; after several in a row, or at once
-- for sexual or abusive content, the sender is blocked: their next messages
-- are dropped (not stored, no AI reply, no alert) until an admin unblocks.

BEGIN;

ALTER TABLE website_chat_sessions
  ADD COLUMN IF NOT EXISTS off_topic_streak integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS off_topic_total  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocked_at       timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_reason   text,
  ADD COLUMN IF NOT EXISTS blocked_by       uuid;

ALTER TABLE website_chat_sessions
  DROP CONSTRAINT IF EXISTS website_chat_sessions_blocked_reason_check;
ALTER TABLE website_chat_sessions
  ADD CONSTRAINT website_chat_sessions_blocked_reason_check
  CHECK (blocked_reason IS NULL OR blocked_reason IN ('off_topic', 'abusive', 'manual'));

COMMIT;
