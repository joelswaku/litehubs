-- 052_project_member_tenant_foreign_keys.sql
-- Keep project audit-member references inside the same organization.

BEGIN;

ALTER TABLE management_project_operational_links
  DROP CONSTRAINT IF EXISTS management_project_operational_links_linked_by_member_id_fkey,
  ADD CONSTRAINT management_project_operational_links_member_fk
    FOREIGN KEY (organization_id, linked_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL;

ALTER TABLE management_project_phase_dependencies
  DROP CONSTRAINT IF EXISTS management_project_phase_dependencies_created_by_member_id_fkey,
  ADD CONSTRAINT management_project_phase_dependencies_member_fk
    FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL;

COMMIT;
