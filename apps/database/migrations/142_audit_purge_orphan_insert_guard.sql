-- A tenant purge cascades through many audited records.  PostgreSQL runs those
-- DELETE triggers after the parent organization is no longer a valid foreign
-- key target, so an audit trigger must not attempt to append a brand-new row.
-- Returning NULL only in that narrow situation keeps the audit log immutable
-- during normal operation while allowing the organization and its audit trail
-- to be removed together during an authorised permanent purge.
CREATE OR REPLACE FUNCTION audit_log_skip_orphan_purge_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = NEW.organization_id) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_log_skip_orphan_purge_insert ON audit_log;
CREATE TRIGGER audit_log_skip_orphan_purge_insert
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_skip_orphan_purge_insert();
