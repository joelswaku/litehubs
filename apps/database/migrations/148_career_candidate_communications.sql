BEGIN;

-- Keep the public candidate's selected language so later recruitment updates
-- are drafted in the same language by default.
ALTER TABLE career_applications
  ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'fr';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'career_applications_preferred_language_check'
  ) THEN
    ALTER TABLE career_applications
      ADD CONSTRAINT career_applications_preferred_language_check
      CHECK (preferred_language IN ('fr', 'en'));
  END IF;
END $$;

COMMIT;
