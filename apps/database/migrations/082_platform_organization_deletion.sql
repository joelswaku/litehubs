-- 082_platform_organization_deletion.sql
--
-- A company deletion is a platform-super-admin operation with a recovery
-- window.  It deliberately does not remove any organization when this
-- migration is applied: the only state created here is the ability to schedule
-- a future purge.

BEGIN;

ALTER TABLE organizations
  ADD COLUMN deletion_requested_at timestamptz,
  ADD COLUMN deletion_requested_by uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN purge_after timestamptz,
  ADD COLUMN deletion_status text NOT NULL DEFAULT 'none';

ALTER TABLE organizations
  ADD CONSTRAINT organizations_deletion_status_check
    CHECK (deletion_status IN ('none', 'scheduled', 'cancelled', 'purging', 'purged')),
  ADD CONSTRAINT organizations_scheduled_deletion_complete
    CHECK (
      deletion_status <> 'scheduled'
      OR (deletion_requested_at IS NOT NULL AND purge_after IS NOT NULL)
    );

CREATE INDEX organizations_scheduled_purge_idx
  ON organizations (purge_after)
  WHERE deletion_status = 'scheduled';

COMMENT ON COLUMN organizations.deletion_status IS
  'none, scheduled, cancelled, purging or purged. Scheduled organizations are unavailable to company members.';
COMMENT ON COLUMN organizations.purge_after IS
  'Earliest time at which an explicitly authorized platform purge may run.';

-- Kept in the platform plane, without a foreign key to organizations, so the
-- evidence survives the eventual tenant cascade. It exposes no business data:
-- only the company identity, operator and deletion lifecycle event.
CREATE TABLE platform_organization_deletion_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  organization_slug text NOT NULL,
  organization_name text NOT NULL,
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_organization_deletion_audit_event_check
    CHECK (event_type IN ('deletion_requested', 'deletion_cancelled', 'organization_restored', 'permanent_purge')),
  CONSTRAINT platform_organization_deletion_audit_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX platform_organization_deletion_audit_org_idx
  ON platform_organization_deletion_audit (organization_id, created_at DESC);

-- File deletion is necessarily outside the database transaction.  This durable
-- queue lets the API commit the tenant purge atomically, then retry an external
-- storage deletion without ever guessing paths or touching another company.
CREATE TABLE platform_organization_file_purge_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  storage_provider text NOT NULL,
  storage_key text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_organization_file_purge_provider_check
    CHECK (storage_provider IN ('private_document', 'cloudinary')),
  CONSTRAINT platform_organization_file_purge_attempts_check
    CHECK (attempts >= 0),
  CONSTRAINT platform_organization_file_purge_unique
    UNIQUE (organization_id, storage_provider, storage_key)
);

CREATE TRIGGER platform_organization_file_purge_jobs_set_updated_at
  BEFORE UPDATE ON platform_organization_file_purge_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX platform_organization_file_purge_pending_idx
  ON platform_organization_file_purge_jobs (created_at)
  WHERE completed_at IS NULL;

-- The check is intentionally narrower than platform.organizations.update.
-- It is used only by the aggregate counts and file inventory required by the
-- deletion workspace, and only by a Platform Super Admin.
CREATE OR REPLACE FUNCTION current_user_has_platform_role(role_code text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM user_platform_roles upr
      JOIN platform_roles pr ON pr.id = upr.platform_role_id
     WHERE upr.user_id = current_user_id()
       AND pr.code = role_code
  )
$$;

CREATE POLICY organization_members_platform_super_admin_deletion_read
  ON organization_members FOR SELECT
  USING (current_user_has_platform_role('platform_super_admin'));

CREATE POLICY employees_platform_super_admin_deletion_read
  ON employees FOR SELECT
  USING (current_user_has_platform_role('platform_super_admin'));

CREATE POLICY management_projects_platform_super_admin_deletion_read
  ON management_projects FOR SELECT
  USING (current_user_has_platform_role('platform_super_admin'));

CREATE POLICY documents_platform_super_admin_deletion_read
  ON documents FOR SELECT
  USING (current_user_has_platform_role('platform_super_admin'));

CREATE POLICY management_document_links_platform_super_admin_deletion_read
  ON management_document_links FOR SELECT
  USING (current_user_has_platform_role('platform_super_admin'));

CREATE POLICY poultry_flocks_platform_super_admin_deletion_read
  ON poultry_flocks FOR SELECT
  USING (current_user_has_platform_role('platform_super_admin'));

CREATE POLICY pig_groups_platform_super_admin_deletion_read
  ON pig_groups FOR SELECT
  USING (current_user_has_platform_role('platform_super_admin'));

CREATE POLICY agriculture_farms_platform_super_admin_deletion_read
  ON agriculture_farms FOR SELECT
  USING (current_user_has_platform_role('platform_super_admin'));

CREATE POLICY daily_reports_platform_super_admin_deletion_read
  ON daily_reports FOR SELECT
  USING (current_user_has_platform_role('platform_super_admin'));

CREATE POLICY management_inventory_stock_movements_platform_super_admin_deletion_read
  ON management_inventory_stock_movements FOR SELECT
  USING (current_user_has_platform_role('platform_super_admin'));

CREATE POLICY management_maintenance_work_orders_platform_super_admin_deletion_read
  ON management_maintenance_work_orders FOR SELECT
  USING (current_user_has_platform_role('platform_super_admin'));

COMMIT;
