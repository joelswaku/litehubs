-- Employee acknowledgement and electronic-signature evidence for employment contracts.
-- The signed PDF remains in the private document library; these fields prove which
-- LiteHubs member accepted it and when, without exposing it to other employees.
ALTER TABLE contracts
  ADD COLUMN employee_signed_by_member_id uuid,
  ADD COLUMN employee_signature_name text,
  ADD COLUMN employee_signed_at timestamptz;

ALTER TABLE contracts
  ADD CONSTRAINT contracts_employee_signature_member_fk
    FOREIGN KEY (organization_id, employee_signed_by_member_id)
    REFERENCES organization_members (organization_id, id)
    ON DELETE SET NULL (employee_signed_by_member_id),
  ADD CONSTRAINT contracts_employee_signature_complete
    CHECK (
      employee_signed_at IS NULL
      OR (
        employee_signed_by_member_id IS NOT NULL
        AND btrim(COALESCE(employee_signature_name, '')) <> ''
      )
    );

CREATE INDEX contracts_employee_signature_idx
  ON contracts (organization_id, employee_id, employee_signed_at DESC)
  WHERE employee_signed_at IS NOT NULL;

COMMENT ON COLUMN contracts.employee_signature_name IS
  'Name displayed to the employee at the moment they acknowledge and sign their own employment contract.';