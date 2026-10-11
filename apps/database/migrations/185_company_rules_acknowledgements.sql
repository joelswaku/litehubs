BEGIN;

-- Each employee confirms receiving and understanding a published version of
-- the company rules: signed in LiteHubs (electronic) or on paper, the scan
-- being recorded by a manager.
CREATE TABLE company_rules_acknowledgements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rules_version_id      uuid NOT NULL REFERENCES company_rules_versions(id) ON DELETE CASCADE,
  employee_id           uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  method                text NOT NULL CHECK (method IN ('electronic', 'paper')),
  signed_name           text NOT NULL CHECK (btrim(signed_name) <> ''),
  consent_text          text NOT NULL,
  signed_at             timestamptz NOT NULL DEFAULT now(),
  document_id           uuid REFERENCES documents(id),
  recorded_by_member_id uuid,
  note                  text,
  ip_address            text,
  user_agent            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_rules_ack_unique UNIQUE (organization_id, rules_version_id, employee_id),
  CONSTRAINT company_rules_ack_paper_scan CHECK (method <> 'paper' OR document_id IS NOT NULL)
);
CREATE INDEX company_rules_ack_employee_idx ON company_rules_acknowledgements(organization_id, employee_id);
SELECT enable_tenant_rls('company_rules_acknowledgements');

COMMIT;
