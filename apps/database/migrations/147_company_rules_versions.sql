BEGIN;

-- The company rulebook is a controlled document.  Every owner edit creates a
-- new immutable version rather than overwriting the policy employees relied on.
CREATE TABLE company_rules_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number >= 1),
  title text NOT NULL DEFAULT 'Règlement général d’exploitation et de gestion'
    CHECK (btrim(title) <> ''),
  content text NOT NULL CHECK (char_length(btrim(content)) >= 80),
  change_note text,
  status text NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'superseded')),
  created_by_member_id uuid REFERENCES organization_members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_rules_versions_org_number_unique
    UNIQUE (organization_id, version_number)
);

CREATE INDEX company_rules_versions_current_idx
  ON company_rules_versions (organization_id, version_number DESC);

SELECT enable_tenant_rls('company_rules_versions');

-- The generic audit trigger deliberately excludes long policy content, but it
-- records every new version, its number, status and author in the audit log.
DROP TRIGGER IF EXISTS audit_business_change ON company_rules_versions;
CREATE TRIGGER audit_business_change
  AFTER INSERT OR UPDATE OR DELETE ON company_rules_versions
  FOR EACH ROW EXECUTE FUNCTION audit_business_change();

COMMIT;
