-- 031_incidents_security_documents.sql
-- Three related record sets that all answer "what happened, and where is the
-- paper for it": incidents, the security register, and document/contract
-- storage.
--
-- Grouped because they share one mechanic — a dated record, optionally tied to
-- an employee or an asset, with files attached and often an alert raised. The
-- image-attachment table from 025 already handles photographs; this adds the
-- general document store for the things that are not images: contracts, permits,
-- signed statements, scanned delivery notes.

-- ------------------------------------------------------------- incidents ----
CREATE TABLE incidents (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  reference         text NOT NULL,
  province_id       uuid,
  site_id           uuid,
  occurred_at       timestamptz NOT NULL,
  reported_at       timestamptz NOT NULL DEFAULT now(),
  category          text NOT NULL,
  severity          text NOT NULL DEFAULT 'minor',
  title             text NOT NULL,
  description       text NOT NULL,
  -- Where it happened, in words. A site is often not precise enough — "House 3,
  -- feed store" — and creating a location table for free text is overkill.
  location_detail   text,
  -- People involved. An incident can involve someone who is not an employee
  -- (a visitor, a contractor), which is why the name is free text alongside the
  -- optional employee link.
  employee_id       uuid,
  other_parties     text,
  injury_occurred   boolean NOT NULL DEFAULT false,
  -- Days lost to injury: the figure every safety report is built on.
  days_lost         integer,
  -- Estimated cost, for the losses report. Nullable: often unknown at first.
  estimated_loss    numeric(16,2),
  currency          char(3),
  status            text NOT NULL DEFAULT 'open',
  immediate_action  text,
  root_cause        text,
  -- Whether the authorities had to be told. Legally significant.
  reported_to_authorities boolean NOT NULL DEFAULT false,
  authority_reference text,
  reported_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  investigated_by   uuid,
  closed_at         timestamptz,
  closed_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT incidents_reference_unique_per_org UNIQUE (organization_id, reference),
  CONSTRAINT incidents_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT incidents_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT incidents_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL (site_id),
  CONSTRAINT incidents_employee_fk
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees (organization_id, id) ON DELETE SET NULL (employee_id),
  CONSTRAINT incidents_investigator_fk
    FOREIGN KEY (organization_id, investigated_by)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL (investigated_by),
  CONSTRAINT incidents_category_check
    CHECK (category IN ('injury', 'near_miss', 'equipment_damage', 'fire',
                        'theft', 'disease_outbreak', 'environmental',
                        'vehicle_accident', 'security_breach', 'other')),
  CONSTRAINT incidents_severity_check
    CHECK (severity IN ('minor', 'moderate', 'serious', 'critical', 'fatal')),
  CONSTRAINT incidents_status_check
    CHECK (status IN ('open', 'investigating', 'action_required', 'closed')),
  CONSTRAINT incidents_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT incidents_description_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT incidents_reference_format
    CHECK (reference ~ '^[A-Za-z0-9][A-Za-z0-9_/-]{0,62}$'),
  CONSTRAINT incidents_reported_after_occurred CHECK (reported_at >= occurred_at),
  CONSTRAINT incidents_days_lost_non_negative
    CHECK (days_lost IS NULL OR days_lost >= 0),
  CONSTRAINT incidents_loss_non_negative
    CHECK (estimated_loss IS NULL OR estimated_loss >= 0),
  CONSTRAINT incidents_currency_format
    CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  -- A loss figure without a currency is unusable in a report.
  CONSTRAINT incidents_loss_has_currency
    CHECK (estimated_loss IS NULL OR currency IS NOT NULL),
  -- Days lost only makes sense if someone was hurt.
  CONSTRAINT incidents_days_lost_needs_injury
    CHECK (days_lost IS NULL OR days_lost = 0 OR injury_occurred),
  CONSTRAINT incidents_closed_complete
    CHECK (status <> 'closed' OR closed_at IS NOT NULL)
);

CREATE TRIGGER incidents_set_updated_at
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX incidents_occurred_idx
  ON incidents (organization_id, occurred_at DESC);
CREATE INDEX incidents_open_idx
  ON incidents (organization_id, province_id, occurred_at DESC)
  WHERE status <> 'closed';
CREATE INDEX incidents_category_idx
  ON incidents (organization_id, category, occurred_at DESC);

SELECT enable_tenant_rls('incidents');

-- ------------------------------------------------------- visitor register ----
-- The gate book. Kept as its own table rather than folded into incidents
-- because it is a high-volume, low-drama log: hundreds of rows a week, and the
-- question asked of it is "who was on site when" rather than "what went wrong".
CREATE TABLE security_visitors (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  province_id       uuid,
  site_id           uuid NOT NULL,
  visitor_name      text NOT NULL,
  organization_name text,
  phone             text,
  id_number         text,
  purpose           text NOT NULL,
  -- Who they came to see. Optional: a delivery driver sees nobody in particular.
  host_employee_id  uuid,
  vehicle_plate     text,
  entered_at        timestamptz NOT NULL DEFAULT now(),
  exited_at         timestamptz,
  -- Biosecurity is the reason a poultry farm cares about this table at all: a
  -- visitor who was on another farm this morning is a real disease risk.
  last_farm_visit_days integer,
  disinfected       boolean NOT NULL DEFAULT false,
  recorded_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT security_visitors_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT security_visitors_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT security_visitors_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT security_visitors_host_fk
    FOREIGN KEY (organization_id, host_employee_id)
    REFERENCES employees (organization_id, id)
    ON DELETE SET NULL (host_employee_id),
  CONSTRAINT security_visitors_name_not_blank CHECK (btrim(visitor_name) <> ''),
  CONSTRAINT security_visitors_purpose_not_blank CHECK (btrim(purpose) <> ''),
  CONSTRAINT security_visitors_exit_after_entry
    CHECK (exited_at IS NULL OR exited_at >= entered_at),
  CONSTRAINT security_visitors_last_visit_non_negative
    CHECK (last_farm_visit_days IS NULL OR last_farm_visit_days >= 0)
);

CREATE TRIGGER security_visitors_set_updated_at
  BEFORE UPDATE ON security_visitors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX security_visitors_site_idx
  ON security_visitors (organization_id, site_id, entered_at DESC);
-- "Who is on site right now" — the question asked at a shift handover.
CREATE INDEX security_visitors_on_site_idx
  ON security_visitors (organization_id, site_id, entered_at)
  WHERE exited_at IS NULL;

SELECT enable_tenant_rls('security_visitors');

-- ------------------------------------------------- asset gate movements ----
-- Things leaving or entering the gate. The control against quiet asset loss:
-- an asset that left and never came back is a theft report waiting to happen.
CREATE TABLE security_asset_movements (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  province_id       uuid,
  site_id           uuid NOT NULL,
  direction         text NOT NULL,
  -- Optional link to a tracked asset; a bag of feed leaving the gate is not one.
  asset_id          uuid,
  description       text NOT NULL,
  quantity          numeric(14,3),
  unit              text,
  -- Who authorised it and who carried it.
  authorised_by     uuid,
  carried_by        text,
  vehicle_plate     text,
  gate_pass_number  text,
  moved_at          timestamptz NOT NULL DEFAULT now(),
  expected_return_at timestamptz,
  returned_at       timestamptz,
  recorded_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT security_asset_movements_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT security_asset_movements_gate_pass_unique
    UNIQUE (organization_id, gate_pass_number),
  CONSTRAINT security_asset_movements_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT security_asset_movements_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT security_asset_movements_asset_fk
    FOREIGN KEY (organization_id, asset_id)
    REFERENCES management_assets (organization_id, id)
    ON DELETE SET NULL (asset_id),
  CONSTRAINT security_asset_movements_authoriser_fk
    FOREIGN KEY (organization_id, authorised_by)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL (authorised_by),
  CONSTRAINT security_asset_movements_direction_check
    CHECK (direction IN ('out', 'in')),
  CONSTRAINT security_asset_movements_description_not_blank
    CHECK (btrim(description) <> ''),
  CONSTRAINT security_asset_movements_quantity_positive
    CHECK (quantity IS NULL OR quantity > 0),
  CONSTRAINT security_asset_movements_return_after_move
    CHECK (returned_at IS NULL OR returned_at >= moved_at)
);

CREATE TRIGGER security_asset_movements_set_updated_at
  BEFORE UPDATE ON security_asset_movements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX security_asset_movements_site_idx
  ON security_asset_movements (organization_id, site_id, moved_at DESC);
-- Drives the overdue-return alert: went out, was expected back, still isn't.
CREATE INDEX security_asset_movements_overdue_idx
  ON security_asset_movements (organization_id, expected_return_at)
  WHERE direction = 'out' AND returned_at IS NULL
    AND expected_return_at IS NOT NULL;

SELECT enable_tenant_rls('security_asset_movements');

-- ------------------------------------------------------------ key register ----
CREATE TABLE security_keys (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  site_id           uuid NOT NULL,
  code              text NOT NULL,
  name              text NOT NULL,
  -- What it opens.
  location_detail   text,
  copies_total      integer NOT NULL DEFAULT 1,
  is_active         boolean NOT NULL DEFAULT true,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT security_keys_code_unique_per_org UNIQUE (organization_id, code),
  CONSTRAINT security_keys_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT security_keys_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT security_keys_code_format
    CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$'),
  CONSTRAINT security_keys_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT security_keys_copies_positive CHECK (copies_total >= 1)
);

CREATE TRIGGER security_keys_set_updated_at
  BEFORE UPDATE ON security_keys
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT enable_tenant_rls('security_keys');

CREATE TABLE security_key_handovers (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  key_id            uuid NOT NULL,
  employee_id       uuid,
  holder_name       text,
  issued_at         timestamptz NOT NULL DEFAULT now(),
  returned_at       timestamptz,
  issued_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  received_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT security_key_handovers_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT security_key_handovers_key_fk
    FOREIGN KEY (organization_id, key_id)
    REFERENCES security_keys (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT security_key_handovers_employee_fk
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees (organization_id, id) ON DELETE SET NULL (employee_id),
  CONSTRAINT security_key_handovers_return_after_issue
    CHECK (returned_at IS NULL OR returned_at >= issued_at),
  -- A key is held by somebody; an unnamed holder makes the register pointless.
  CONSTRAINT security_key_handovers_holder_named
    CHECK (employee_id IS NOT NULL OR btrim(COALESCE(holder_name, '')) <> '')
);

CREATE TRIGGER security_key_handovers_set_updated_at
  BEFORE UPDATE ON security_key_handovers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX security_key_handovers_outstanding_idx
  ON security_key_handovers (organization_id, key_id, issued_at DESC)
  WHERE returned_at IS NULL;

SELECT enable_tenant_rls('security_key_handovers');

-- ------------------------------------------------------------- documents ----
-- The general file store. 025 already covers images with Cloudinary metadata;
-- this is for everything else, and for files that belong to the company rather
-- than to one record — a business licence, an insurance policy.
CREATE TABLE documents (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  title             text NOT NULL,
  description       text,
  category          text NOT NULL DEFAULT 'general',
  -- Storage location. Per §4 of structure.md, storage is prefixed per
  -- organization, so this path always begins with the organization id.
  storage_path      text NOT NULL,
  file_name         text NOT NULL,
  mime_type         text NOT NULL,
  size_bytes        bigint NOT NULL,
  -- Content hash, so re-uploading the same file is detectable and a corrupted
  -- download is provable.
  checksum_sha256   text,
  -- Same polymorphic-owner reasoning as alerts.subject_*: a document can hang
  -- off any record, or off none.
  subject_table     text,
  subject_id        uuid,
  province_id       uuid,
  site_id           uuid,
  -- Documents expire: permits, licences, insurance, employee visas.
  expires_on        date,
  is_confidential   boolean NOT NULL DEFAULT false,
  version           integer NOT NULL DEFAULT 1,
  supersedes_id     uuid,
  uploaded_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT documents_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT documents_storage_path_unique UNIQUE (organization_id, storage_path),
  CONSTRAINT documents_supersedes_fk
    FOREIGN KEY (organization_id, supersedes_id)
    REFERENCES documents (organization_id, id) ON DELETE SET NULL (supersedes_id),
  CONSTRAINT documents_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT documents_site_fk
    FOREIGN KEY (organization_id, site_id)
    REFERENCES sites (organization_id, id) ON DELETE SET NULL (site_id),
  CONSTRAINT documents_category_check
    CHECK (category IN ('general', 'contract', 'permit', 'licence', 'insurance',
                        'certificate', 'invoice', 'receipt', 'report',
                        'policy', 'employee', 'legal', 'statement')),
  CONSTRAINT documents_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT documents_file_name_not_blank CHECK (btrim(file_name) <> ''),
  CONSTRAINT documents_size_positive CHECK (size_bytes > 0),
  CONSTRAINT documents_subject_complete
    CHECK ((subject_table IS NULL) = (subject_id IS NULL)),
  CONSTRAINT documents_version_positive CHECK (version >= 1),
  CONSTRAINT documents_no_self_supersede
    CHECK (supersedes_id IS NULL OR supersedes_id <> id),
  CONSTRAINT documents_checksum_format
    CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[a-f0-9]{64}$'),
  -- Every stored file must sit under its own organization's prefix. This is the
  -- storage-layer half of tenant isolation: RLS protects the row, this protects
  -- the bytes.
  CONSTRAINT documents_path_is_org_prefixed
    CHECK (storage_path LIKE 'organizations/' || organization_id::text || '/%')
);

CREATE TRIGGER documents_set_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX documents_subject_idx
  ON documents (organization_id, subject_table, subject_id)
  WHERE subject_id IS NOT NULL;
CREATE INDEX documents_category_idx
  ON documents (organization_id, category, created_at DESC);
-- Drives the expiring-document alert.
CREATE INDEX documents_expiring_idx
  ON documents (organization_id, expires_on)
  WHERE expires_on IS NOT NULL;

SELECT enable_tenant_rls('documents');

-- ------------------------------------------------------------- contracts ----
-- A contract is not just a document: it has parties, a value, a term and
-- renewal dates that things depend on. The signed PDF lives in `documents`;
-- this is the structured record.
CREATE TABLE contracts (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  reference         text NOT NULL,
  title             text NOT NULL,
  contract_type     text NOT NULL,
  -- Exactly one counterparty kind applies, checked below. Three nullable
  -- columns beat a polymorphic pair here because each is a real FK that must
  -- not cross tenants.
  supplier_id       uuid,
  customer_id       uuid,
  employee_id       uuid,
  counterparty_name text,
  starts_on         date NOT NULL,
  ends_on           date,
  -- Auto-renewal is why this table exists: a contract that renews silently and
  -- nobody noticed is a recurring cost nobody approved.
  auto_renews       boolean NOT NULL DEFAULT false,
  renewal_notice_days integer,
  currency          char(3),
  contract_value    numeric(16,2),
  payment_terms     text,
  status            text NOT NULL DEFAULT 'draft',
  document_id       uuid,
  province_id       uuid,
  owner_member_id   uuid,
  notes             text,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  signed_on         date,
  terminated_on     date,
  termination_reason text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT contracts_reference_unique_per_org UNIQUE (organization_id, reference),
  CONSTRAINT contracts_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT contracts_supplier_fk
    FOREIGN KEY (organization_id, supplier_id)
    REFERENCES management_suppliers (organization_id, id)
    ON DELETE SET NULL (supplier_id),
  CONSTRAINT contracts_customer_fk
    FOREIGN KEY (organization_id, customer_id)
    REFERENCES customers (organization_id, id) ON DELETE SET NULL (customer_id),
  CONSTRAINT contracts_employee_fk
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES employees (organization_id, id) ON DELETE SET NULL (employee_id),
  CONSTRAINT contracts_document_fk
    FOREIGN KEY (organization_id, document_id)
    REFERENCES documents (organization_id, id) ON DELETE SET NULL (document_id),
  CONSTRAINT contracts_province_fk
    FOREIGN KEY (organization_id, province_id)
    REFERENCES provinces (organization_id, id) ON DELETE SET NULL (province_id),
  CONSTRAINT contracts_owner_fk
    FOREIGN KEY (organization_id, owner_member_id)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL (owner_member_id),
  CONSTRAINT contracts_type_check
    CHECK (contract_type IN ('supply', 'sales', 'employment', 'service',
                             'lease', 'loan', 'insurance', 'nda', 'other')),
  CONSTRAINT contracts_status_check
    CHECK (status IN ('draft', 'pending_signature', 'active', 'expired',
                      'terminated', 'renewed', 'cancelled')),
  CONSTRAINT contracts_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT contracts_reference_format
    CHECK (reference ~ '^[A-Za-z0-9][A-Za-z0-9_/-]{0,62}$'),
  CONSTRAINT contracts_dates_check CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT contracts_currency_format
    CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  CONSTRAINT contracts_value_non_negative
    CHECK (contract_value IS NULL OR contract_value >= 0),
  CONSTRAINT contracts_value_has_currency
    CHECK (contract_value IS NULL OR currency IS NOT NULL),
  CONSTRAINT contracts_notice_non_negative
    CHECK (renewal_notice_days IS NULL OR renewal_notice_days >= 0),
  -- Exactly one counterparty, or a free-text name when it is none of the three.
  CONSTRAINT contracts_one_counterparty
    CHECK (
      (CASE WHEN supplier_id IS NOT NULL THEN 1 ELSE 0 END
       + CASE WHEN customer_id IS NOT NULL THEN 1 ELSE 0 END
       + CASE WHEN employee_id IS NOT NULL THEN 1 ELSE 0 END) <= 1
    ),
  CONSTRAINT contracts_counterparty_identified
    CHECK (supplier_id IS NOT NULL OR customer_id IS NOT NULL
           OR employee_id IS NOT NULL
           OR btrim(COALESCE(counterparty_name, '')) <> ''),
  -- An employment contract must name an employee, not a supplier.
  CONSTRAINT contracts_employment_names_employee
    CHECK (contract_type <> 'employment' OR employee_id IS NOT NULL),
  CONSTRAINT contracts_terminated_complete
    CHECK (status <> 'terminated' OR terminated_on IS NOT NULL),
  CONSTRAINT contracts_terminated_after_start
    CHECK (terminated_on IS NULL OR terminated_on >= starts_on)
);

CREATE TRIGGER contracts_set_updated_at
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX contracts_status_idx
  ON contracts (organization_id, status, ends_on);
-- The renewal alert: active, ending, and nobody has decided yet.
CREATE INDEX contracts_expiring_idx
  ON contracts (organization_id, ends_on)
  WHERE status = 'active' AND ends_on IS NOT NULL;
CREATE INDEX contracts_supplier_idx
  ON contracts (organization_id, supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX contracts_customer_idx
  ON contracts (organization_id, customer_id) WHERE customer_id IS NOT NULL;

SELECT enable_tenant_rls('contracts');

COMMENT ON CONSTRAINT documents_path_is_org_prefixed ON documents IS
  'The storage half of tenant isolation: RLS protects the row, this guarantees the bytes sit under the right organization prefix.';
COMMENT ON TABLE contracts IS
  'The structured record; the signed file lives in documents. auto_renews exists because a silent renewal is an unapproved recurring cost.';
