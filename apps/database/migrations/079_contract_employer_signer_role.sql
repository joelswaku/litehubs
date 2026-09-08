-- The representative's capacity is contractual metadata. It does not grant
-- LiteHubs permissions; authorization is always checked at countersignature.
ALTER TABLE contracts
  ADD COLUMN employer_signer_role text;

ALTER TABLE contracts
  ADD CONSTRAINT contracts_employer_signer_role_not_blank
  CHECK (employer_signer_role IS NULL OR btrim(employer_signer_role) <> '');