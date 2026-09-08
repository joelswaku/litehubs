-- 037_poultry_daily_management.sql
-- Make Poultry a daily management workflow: environmental evidence, assigned
-- work completion, supervisor review and an immutable review audit trail.

ALTER TABLE poultry_daily_records
  ADD COLUMN temperature_c numeric(5,2),
  ADD COLUMN humidity_percent numeric(5,2);

ALTER TABLE poultry_daily_records
  ADD CONSTRAINT poultry_daily_records_temperature_check
    CHECK (temperature_c IS NULL OR temperature_c BETWEEN -20 AND 70),
  ADD CONSTRAINT poultry_daily_records_humidity_check
    CHECK (humidity_percent IS NULL OR humidity_percent BETWEEN 0 AND 100);

ALTER TABLE poultry_daily_work_items
  ADD COLUMN completion_note text,
  ADD COLUMN completed_by_member_id uuid,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN requires_supervisor_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN approval_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN reviewed_by_member_id uuid,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN review_notes text;

ALTER TABLE poultry_daily_work_items
  ADD CONSTRAINT poultry_daily_work_items_completed_by_fk
    FOREIGN KEY (organization_id, completed_by_member_id)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL,
  ADD CONSTRAINT poultry_daily_work_items_reviewed_by_fk
    FOREIGN KEY (organization_id, reviewed_by_member_id)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL,
  ADD CONSTRAINT poultry_daily_work_items_approval_status_check
    CHECK (approval_status IN ('pending', 'approved', 'returned', 'not_required')),
  ADD CONSTRAINT poultry_daily_work_items_completion_note_not_blank
    CHECK (completion_note IS NULL OR btrim(completion_note) <> ''),
  ADD CONSTRAINT poultry_daily_work_items_review_notes_not_blank
    CHECK (review_notes IS NULL OR btrim(review_notes) <> '');

ALTER TABLE poultry_daily_work_items
  DROP CONSTRAINT poultry_daily_work_items_status_check;
ALTER TABLE poultry_daily_work_items
  ADD CONSTRAINT poultry_daily_work_items_status_check
    CHECK (status IN ('planned', 'in_progress', 'completed', 'skipped', 'missed'));

-- Historical records predate supervisor review. Do not make a previously
-- completed task appear as pending after this migration.
UPDATE poultry_daily_work_items
   SET approval_status = CASE WHEN status = 'completed' THEN 'approved' ELSE 'pending' END,
       requires_supervisor_approval = CASE WHEN status = 'completed' THEN false ELSE true END;

CREATE INDEX poultry_daily_work_items_review_idx
  ON poultry_daily_work_items (organization_id, approval_status, work_date DESC)
  WHERE approval_status IN ('pending', 'returned');

CREATE TABLE poultry_daily_work_reviews (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  work_item_id          uuid NOT NULL,
  decision              text NOT NULL,
  review_notes          text,
  reviewed_by_member_id uuid NOT NULL,
  reviewed_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT poultry_daily_work_reviews_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT poultry_daily_work_reviews_item_fk
    FOREIGN KEY (organization_id, work_item_id)
    REFERENCES poultry_daily_work_items (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT poultry_daily_work_reviews_member_fk
    FOREIGN KEY (organization_id, reviewed_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT poultry_daily_work_reviews_decision_check
    CHECK (decision IN ('approved', 'returned')),
  CONSTRAINT poultry_daily_work_reviews_notes_check
    CHECK (review_notes IS NULL OR btrim(review_notes) <> '')
);
CREATE INDEX poultry_daily_work_reviews_item_idx
  ON poultry_daily_work_reviews (organization_id, work_item_id, reviewed_at DESC);
SELECT enable_tenant_rls('poultry_daily_work_reviews');

-- An employee receives only read/update grants. The service additionally
-- restricts self-scope users to tasks assigned directly to them.
INSERT INTO role_preset_permissions (role_preset_code, permission_code)
SELECT 'employee', p.code
  FROM permissions p
 WHERE p.code IN ('poultry.daily_records.read', 'poultry.daily_records.update')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code IN ('poultry.daily_records.read', 'poultry.daily_records.update')
 WHERE r.code = 'employee'
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN poultry_daily_records.temperature_c IS
  'Actual house temperature recorded by the field team for this flock day.';
COMMENT ON COLUMN poultry_daily_records.humidity_percent IS
  'Actual house humidity recorded by the field team for this flock day.';
COMMENT ON TABLE poultry_daily_work_reviews IS
  'Immutable supervisor review history for assigned Poultry work; a returned task can be corrected and submitted again.';