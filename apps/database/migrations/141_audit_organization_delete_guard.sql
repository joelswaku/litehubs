-- Audit events are immutable while an organization exists.  During a
-- permitted permanent purge, however, the organization row is already gone
-- when its AFTER DELETE trigger runs, so inserting one final audit row would
-- violate audit_log's organization foreign key and block the whole purge.
--
-- Keep create/update audit events for organizations, but deliberately omit the
-- terminal DELETE event: the audit rows themselves are removed by the same
-- tenant cascade and cannot be retained without their organization.
DO $$
BEGIN
  IF to_regclass('public.organizations') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS audit_business_change ON public.organizations;
    CREATE TRIGGER audit_business_change
      AFTER INSERT OR UPDATE ON public.organizations
      FOR EACH ROW EXECUTE FUNCTION audit_business_change();
  END IF;
END;
$$;
