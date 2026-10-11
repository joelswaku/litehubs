BEGIN;

-- Posts written by the AI content plan stay drafts until a manager approves them.
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS ai_generated boolean NOT NULL DEFAULT false;

COMMIT;
