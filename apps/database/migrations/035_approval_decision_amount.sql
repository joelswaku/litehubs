-- 035_approval_decision_amount.sql
-- Preserve the original request and the decision separately.  Replacing the
-- request amount with a partial approval would destroy the audit trail.

ALTER TABLE management_approval_requests
  ADD COLUMN approved_amount numeric(16,2);

ALTER TABLE management_approval_requests
  ADD CONSTRAINT management_approval_requests_approved_amount_check CHECK (
    approved_amount IS NULL OR (
      approved_amount >= 0 AND
      (requested_amount IS NULL OR approved_amount <= requested_amount)
    )
  );