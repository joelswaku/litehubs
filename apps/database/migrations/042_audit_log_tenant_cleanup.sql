-- Audit history is immutable during the life of an organization. A tenant
-- deletion, however, must be able to cascade its own audit rows; otherwise a
-- foreign-key cascade is blocked by the append-only trigger.
CREATE OR REPLACE FUNCTION audit_log_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM organizations WHERE id = OLD.organization_id
  ) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'audit_log is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'check_violation',
          HINT = 'Record a compensating entry instead of altering history.';
END;
$$;
