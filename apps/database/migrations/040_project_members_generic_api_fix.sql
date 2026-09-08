-- 040_project_members_generic_api_fix.sql
-- Existing project-members uses a composite key. The shared owner-management
-- API needs a stable single record ID for detail/update/delete operations.

ALTER TABLE management_project_members
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS management_project_members_org_id_unique
  ON management_project_members (organization_id, id);

COMMENT ON COLUMN management_project_members.id IS
  'Stable API identifier; project_id + member_id remains the business uniqueness constraint.';