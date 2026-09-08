-- A receipt line can contain several durable units. Each accepted unit becomes
-- its own permanent asset, so a delivery of three generators never collapses
-- into one asset record.

CREATE TABLE management_receipt_line_assets (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  receipt_line_id uuid NOT NULL,
  asset_id        uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (receipt_line_id, asset_id),
  CONSTRAINT management_receipt_line_assets_line_fk FOREIGN KEY (organization_id, receipt_line_id)
    REFERENCES management_receipt_lines (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_receipt_line_assets_asset_fk FOREIGN KEY (organization_id, asset_id)
    REFERENCES management_assets (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_receipt_line_assets_asset_unique UNIQUE (asset_id)
);
CREATE INDEX management_receipt_line_assets_line_idx ON management_receipt_line_assets (organization_id, receipt_line_id);
SELECT enable_tenant_rls('management_receipt_line_assets');
