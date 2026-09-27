-- Receipt references are assigned by the database, just like purchase requests
-- and purchase orders. This prevents manual numbering mistakes and remains
-- safe when multiple authorized users create receipts at the same time.

CREATE TABLE management_receipt_number_counters (
  organization_id uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  last_number     integer NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);
SELECT enable_tenant_rls('management_receipt_number_counters');

-- Continue an existing BR sequence when a workspace already has receipt records.
INSERT INTO management_receipt_number_counters (organization_id, last_number)
SELECT organization_id,
       COALESCE(MAX(CASE WHEN receipt_number ~ '^BR-[0-9]+$'
                         THEN substring(receipt_number FROM 4)::integer
                         ELSE 0 END), 0)
FROM management_receipts
GROUP BY organization_id
ON CONFLICT (organization_id) DO UPDATE
  SET last_number = GREATEST(
    management_receipt_number_counters.last_number,
    EXCLUDED.last_number
  );

CREATE OR REPLACE FUNCTION management_assign_receipt_number()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  next_number integer;
BEGIN
  INSERT INTO management_receipt_number_counters (organization_id, last_number)
  VALUES (NEW.organization_id, 1)
  ON CONFLICT (organization_id) DO UPDATE
    SET last_number = management_receipt_number_counters.last_number + 1
  RETURNING last_number INTO next_number;

  NEW.receipt_number := 'BR-' || lpad(next_number::text, 6, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS management_receipts_assign_number ON management_receipts;
CREATE TRIGGER management_receipts_assign_number
  BEFORE INSERT ON management_receipts
  FOR EACH ROW EXECUTE FUNCTION management_assign_receipt_number();