-- Quality control, commissioning and formal investment close-out.
-- These records supplement a receipt; they never create a second inventory or
-- budget movement. A receipt remains the sole source of accepted quantities.
BEGIN;

CREATE TABLE IF NOT EXISTS management_project_quality_check_number_counters (
  organization_id uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);
SELECT enable_tenant_rls('management_project_quality_check_number_counters');

CREATE TABLE IF NOT EXISTS management_project_quality_checks (
  id                         uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id            uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id                 uuid NOT NULL,
  receipt_id                 uuid,
  asset_id                   uuid,
  check_number               text NOT NULL,
  quality_status             text NOT NULL DEFAULT 'pending',
  quantity_matches           boolean NOT NULL DEFAULT false,
  condition_accepted         boolean NOT NULL DEFAULT false,
  documents_complete         boolean NOT NULL DEFAULT false,
  functional_test_passed     boolean NOT NULL DEFAULT false,
  safety_check_passed        boolean NOT NULL DEFAULT false,
  returned_quantity          numeric(18,3) NOT NULL DEFAULT 0,
  return_reason              text,
  warranty_provider          text,
  warranty_reference         text,
  warranty_expires_on        date,
  before_photo_document_id   uuid,
  after_photo_document_id    uuid,
  checked_by_member_id       uuid,
  checked_at                 timestamptz,
  commissioning_status       text NOT NULL DEFAULT 'not_required',
  commissioned_by_member_id  uuid,
  commissioned_at            timestamptz,
  commissioning_notes        text,
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_project_quality_checks_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_project_quality_checks_number_unique UNIQUE (organization_id, check_number),
  CONSTRAINT management_project_quality_checks_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_project_quality_checks_receipt_fk FOREIGN KEY (organization_id, receipt_id)
    REFERENCES management_receipts (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_project_quality_checks_asset_fk FOREIGN KEY (organization_id, asset_id)
    REFERENCES management_assets (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_project_quality_checks_before_photo_fk FOREIGN KEY (organization_id, before_photo_document_id)
    REFERENCES documents (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_quality_checks_after_photo_fk FOREIGN KEY (organization_id, after_photo_document_id)
    REFERENCES documents (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_quality_checks_checked_by_fk FOREIGN KEY (organization_id, checked_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_quality_checks_commissioned_by_fk FOREIGN KEY (organization_id, commissioned_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_quality_checks_target_check CHECK (receipt_id IS NOT NULL OR asset_id IS NOT NULL),
  CONSTRAINT management_project_quality_checks_number_check CHECK (check_number ~ '^QC-[0-9]{6}$'),
  CONSTRAINT management_project_quality_checks_status_check CHECK (
    quality_status IN ('pending', 'accepted', 'accepted_with_observations', 'rejected', 'returned')
  ),
  CONSTRAINT management_project_quality_checks_commissioning_check CHECK (
    commissioning_status IN ('not_required', 'pending', 'validated', 'failed')
  ),
  CONSTRAINT management_project_quality_checks_return_check CHECK (
    returned_quantity >= 0 AND
    (returned_quantity = 0 OR return_reason IS NOT NULL)
  ),
  CONSTRAINT management_project_quality_checks_text_check CHECK (
    (return_reason IS NULL OR btrim(return_reason) <> '') AND
    (warranty_provider IS NULL OR btrim(warranty_provider) <> '') AND
    (warranty_reference IS NULL OR btrim(warranty_reference) <> '') AND
    (commissioning_notes IS NULL OR btrim(commissioning_notes) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  ),
  CONSTRAINT management_project_quality_checks_commissioning_detail_check CHECK (
    commissioning_status <> 'validated' OR (
      functional_test_passed AND safety_check_passed AND
      commissioned_by_member_id IS NOT NULL AND commissioned_at IS NOT NULL
    )
  )
);
CREATE INDEX IF NOT EXISTS management_project_quality_checks_project_status_idx
  ON management_project_quality_checks (organization_id, project_id, quality_status, checked_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS management_project_quality_checks_receipt_unique
  ON management_project_quality_checks (organization_id, receipt_id)
  WHERE receipt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS management_project_quality_checks_asset_idx
  ON management_project_quality_checks (organization_id, asset_id)
  WHERE asset_id IS NOT NULL;
SELECT enable_tenant_rls('management_project_quality_checks');

CREATE OR REPLACE FUNCTION management_assign_project_quality_check_number()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  next_number integer;
BEGIN
  IF NEW.check_number IS NOT NULL AND btrim(NEW.check_number) <> '' THEN
    RETURN NEW;
  END IF;
  INSERT INTO management_project_quality_check_number_counters (organization_id, last_number)
  VALUES (NEW.organization_id, 1)
  ON CONFLICT (organization_id) DO UPDATE
    SET last_number = management_project_quality_check_number_counters.last_number + 1
  RETURNING last_number INTO next_number;
  NEW.check_number := 'QC-' || lpad(next_number::text, 6, '0');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS management_project_quality_checks_assign_number
  ON management_project_quality_checks;
CREATE TRIGGER management_project_quality_checks_assign_number
  BEFORE INSERT ON management_project_quality_checks
  FOR EACH ROW EXECUTE FUNCTION management_assign_project_quality_check_number();
DROP TRIGGER IF EXISTS management_project_quality_checks_set_updated_at
  ON management_project_quality_checks;
CREATE TRIGGER management_project_quality_checks_set_updated_at
  BEFORE UPDATE ON management_project_quality_checks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS management_project_closeouts (
  id                          uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id                  uuid NOT NULL,
  status                      text NOT NULL DEFAULT 'draft',
  expected_outcome_achieved   boolean,
  achievement_summary         text,
  actual_outcome              text,
  lessons_learned             text,
  handover_member_id          uuid,
  commissioning_validated     boolean NOT NULL DEFAULT false,
  commissioning_summary       text,
  closeout_document_id        uuid,
  prepared_by_member_id       uuid,
  approved_by_member_id       uuid,
  completed_at                timestamptz,
  notes                       text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_project_closeouts_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_project_closeouts_project_unique UNIQUE (organization_id, project_id),
  CONSTRAINT management_project_closeouts_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_project_closeouts_handover_fk FOREIGN KEY (organization_id, handover_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_closeouts_prepared_by_fk FOREIGN KEY (organization_id, prepared_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_closeouts_approved_by_fk FOREIGN KEY (organization_id, approved_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_closeouts_document_fk FOREIGN KEY (organization_id, closeout_document_id)
    REFERENCES documents (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_closeouts_status_check CHECK (status IN ('draft', 'completed')),
  CONSTRAINT management_project_closeouts_text_check CHECK (
    (achievement_summary IS NULL OR btrim(achievement_summary) <> '') AND
    (actual_outcome IS NULL OR btrim(actual_outcome) <> '') AND
    (lessons_learned IS NULL OR btrim(lessons_learned) <> '') AND
    (commissioning_summary IS NULL OR btrim(commissioning_summary) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  ),
  CONSTRAINT management_project_closeouts_completion_check CHECK (
    status <> 'completed' OR (
      expected_outcome_achieved IS NOT NULL AND
      achievement_summary IS NOT NULL AND
      lessons_learned IS NOT NULL AND
      commissioning_validated AND
      prepared_by_member_id IS NOT NULL AND
      approved_by_member_id IS NOT NULL AND
      completed_at IS NOT NULL
    )
  )
);
CREATE INDEX IF NOT EXISTS management_project_closeouts_status_idx
  ON management_project_closeouts (organization_id, status, completed_at DESC);
SELECT enable_tenant_rls('management_project_closeouts');
DROP TRIGGER IF EXISTS management_project_closeouts_set_updated_at
  ON management_project_closeouts;
CREATE TRIGGER management_project_closeouts_set_updated_at
  BEFORE UPDATE ON management_project_closeouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE management_project_quality_checks IS
  'Physical and documentary quality checks for a project receipt or durable asset. Receipt quantities and budget effects remain the source of truth.';
COMMENT ON TABLE management_project_closeouts IS
  'Formal close-out record with expected-result assessment, commissioning validation, lessons learned and accountable sign-off.';

COMMIT;
