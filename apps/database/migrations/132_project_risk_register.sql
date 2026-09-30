-- Structured project risk, issue and decision register.  A risk stays in the
-- project record rather than being buried in notes, and each organization has
-- its own readable RSK sequence.
BEGIN;

CREATE TABLE IF NOT EXISTS management_project_risk_number_counters (
  organization_id uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0)
);
SELECT enable_tenant_rls('management_project_risk_number_counters');

CREATE TABLE IF NOT EXISTS management_project_risks (
  id                       uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id               uuid NOT NULL,
  code                     text NOT NULL,
  record_type              text NOT NULL DEFAULT 'risk',
  category                 text NOT NULL DEFAULT 'other',
  title                    text NOT NULL,
  description              text,
  probability              text NOT NULL DEFAULT 'medium',
  impact                   text NOT NULL DEFAULT 'medium',
  owner_member_id          uuid NOT NULL,
  trigger_condition        text NOT NULL,
  alert_threshold          text NOT NULL,
  prevention_action        text NOT NULL,
  contingency_action       text,
  review_date              date NOT NULL,
  status                   text NOT NULL DEFAULT 'open',
  triggered_at             timestamptz,
  resolved_at              timestamptz,
  decision                 text NOT NULL DEFAULT 'pending',
  decision_taken           text,
  decision_justification   text,
  decided_by_member_id     uuid,
  decided_at               timestamptz,
  created_by_member_id     uuid,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT management_project_risks_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT management_project_risks_code_unique UNIQUE (organization_id, code),
  CONSTRAINT management_project_risks_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT management_project_risks_owner_fk FOREIGN KEY (organization_id, owner_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT management_project_risks_decider_fk FOREIGN KEY (organization_id, decided_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_risks_creator_fk FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE SET NULL,
  CONSTRAINT management_project_risks_code_check CHECK (code ~ '^RSK-[0-9]{6}$'),
  CONSTRAINT management_project_risks_type_check CHECK (record_type IN ('risk', 'issue')),
  CONSTRAINT management_project_risks_category_check CHECK (category IN (
    'disease', 'supplier_delay', 'commodity_price', 'water', 'theft', 'permit', 'weather', 'other'
  )),
  CONSTRAINT management_project_risks_probability_check CHECK (probability IN ('low', 'medium', 'high')),
  CONSTRAINT management_project_risks_impact_check CHECK (impact IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT management_project_risks_status_check CHECK (status IN (
    'open', 'monitoring', 'triggered', 'mitigating', 'accepted', 'closed'
  )),
  CONSTRAINT management_project_risks_decision_check CHECK (decision IN (
    'pending', 'monitor', 'mitigate', 'avoid', 'transfer', 'accept', 'escalate'
  )),
  CONSTRAINT management_project_risks_text_check CHECK (
    btrim(title) <> '' AND btrim(trigger_condition) <> '' AND
    btrim(alert_threshold) <> '' AND btrim(prevention_action) <> '' AND
    (description IS NULL OR btrim(description) <> '') AND
    (contingency_action IS NULL OR btrim(contingency_action) <> '') AND
    (decision_taken IS NULL OR btrim(decision_taken) <> '') AND
    (decision_justification IS NULL OR btrim(decision_justification) <> '') AND
    (notes IS NULL OR btrim(notes) <> '')
  ),
  CONSTRAINT management_project_risks_decision_detail_check CHECK (
    decision = 'pending' OR (
      decision_taken IS NOT NULL AND decision_justification IS NOT NULL AND
      decided_by_member_id IS NOT NULL AND decided_at IS NOT NULL
    )
  ),
  CONSTRAINT management_project_risks_dates_check CHECK (
    (resolved_at IS NULL OR triggered_at IS NULL OR resolved_at >= triggered_at)
  )
);

CREATE INDEX IF NOT EXISTS management_project_risks_project_status_review_idx
  ON management_project_risks (organization_id, project_id, status, review_date);
CREATE INDEX IF NOT EXISTS management_project_risks_owner_review_idx
  ON management_project_risks (organization_id, owner_member_id, review_date)
  WHERE status <> 'closed';
SELECT enable_tenant_rls('management_project_risks');

CREATE OR REPLACE FUNCTION management_assign_project_risk_number()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  next_number integer;
BEGIN
  IF NEW.code IS NOT NULL AND btrim(NEW.code) <> '' THEN
    RETURN NEW;
  END IF;
  INSERT INTO management_project_risk_number_counters (organization_id, last_number)
  VALUES (NEW.organization_id, 1)
  ON CONFLICT (organization_id) DO UPDATE
    SET last_number = management_project_risk_number_counters.last_number + 1
  RETURNING last_number INTO next_number;
  NEW.code := 'RSK-' || lpad(next_number::text, 6, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS management_project_risks_assign_number
  ON management_project_risks;
CREATE TRIGGER management_project_risks_assign_number
  BEFORE INSERT ON management_project_risks
  FOR EACH ROW EXECUTE FUNCTION management_assign_project_risk_number();

DROP TRIGGER IF EXISTS management_project_risks_set_updated_at
  ON management_project_risks;
CREATE TRIGGER management_project_risks_set_updated_at
  BEFORE UPDATE ON management_project_risks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE management_project_risks IS
  'Project-owned register of anticipated risks, active issues, review thresholds, mitigation actions and accountable decisions.';

COMMIT;
