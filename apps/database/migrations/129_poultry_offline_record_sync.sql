-- A field phone may retry the same eggs, mortality or feed entry after a signal
-- loss. This tenant-scoped receipt ledger makes that retry idempotent.
CREATE TABLE poultry_offline_sync_operations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource text NOT NULL,
  client_sync_key uuid NOT NULL,
  record_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_offline_sync_operations_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_offline_sync_operations_key_unique UNIQUE (organization_id, resource, client_sync_key),
  CONSTRAINT poultry_offline_sync_operations_resource_check CHECK (resource IN ('eggs', 'mortality', 'feed'))
);
CREATE INDEX poultry_offline_sync_operations_record_idx
  ON poultry_offline_sync_operations (organization_id, resource, record_id)
  WHERE record_id IS NOT NULL;
SELECT enable_tenant_rls('poultry_offline_sync_operations');

COMMENT ON TABLE poultry_offline_sync_operations IS
  'Idempotency ledger for locally queued poultry eggs, mortality and feed records.';