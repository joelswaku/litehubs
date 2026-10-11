BEGIN;

-- A contract can be printed, signed by hand and its scanned copy recorded:
-- each signature field then carries the method « paper ».
ALTER TABLE contract_signature_fields DROP CONSTRAINT IF EXISTS contract_signature_fields_method;
ALTER TABLE contract_signature_fields
  ADD CONSTRAINT contract_signature_fields_method
  CHECK (signature_method IS NULL OR signature_method IN ('typed','drawn','uploaded','paper'));

COMMIT;
