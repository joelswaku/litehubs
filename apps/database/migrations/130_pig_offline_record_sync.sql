-- A field phone may retry a pig count, mortality or feed entry after losing
-- signal. This ledger keeps the retry idempotent: the same client key returns
-- the original record rather than adding a second entry or issuing stock twice.

CREATE TABLE pig_offline_sync_operations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource text NOT NULL,
  client_sync_key uuid NOT NULL,
  record_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT pig_offline_sync_operations_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT pig_offline_sync_operations_key_unique UNIQUE (organization_id, resource, client_sync_key),
  CONSTRAINT pig_offline_sync_operations_resource_check CHECK (resource IN ('daily-records', 'mortality', 'feed'))
);

CREATE INDEX pig_offline_sync_operations_record_idx
  ON pig_offline_sync_operations (organization_id, resource, record_id)
  WHERE record_id IS NOT NULL;

SELECT enable_tenant_rls('pig_offline_sync_operations');

COMMENT ON TABLE pig_offline_sync_operations IS
  'Idempotency ledger for locally queued pig field counts, mortality and feed records.';
